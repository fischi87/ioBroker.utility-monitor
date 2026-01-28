'use strict';

const calculator = require('./calculator');
const stateManager = require('./stateManager');
const { parseConfigNumber } = require('./configParser');
const { getConfigType } = require('./utils/typeMapper');
const MeterRegistry = require('./meter/MeterRegistry');
const helpers = require('./utils/helpers');
const consumptionHelper = require('./utils/consumptionHelper');
const billingHelper = require('./utils/billingHelper');

// Default constants
const DEFAULT_SPIKE_THRESHOLD = 500; // Default sensor spike detection limit

/**
 * MultiMeterManager handles multiple meters per utility type
 * Supports unlimited custom-named meters (e.g., "Erdgeschoss", "Werkstatt")
 */
class MultiMeterManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} consumptionManager - ConsumptionManager instance
     * @param {object} billingManager - BillingManager instance
     */
    constructor(adapter, consumptionManager, billingManager) {
        this.adapter = adapter;
        this.consumptionManager = consumptionManager;
        this.billingManager = billingManager;
        this.lastSensorValues = {};
        this.meterRegistry = new MeterRegistry();
        this.tempBaselineStore = {}; // Tracks first value after start to prevent peaks
    }

    /**
     * Maps internal utility type to config/state name
     *
     * @deprecated Use getConfigType from utils/typeMapper directly
     * @param {string} type - gas, water, or electricity
     * @returns {string} - gas, wasser, or strom
     */
    getConfigType(type) {
        return getConfigType(type);
    }

    /**
     * Gets all configured meters for a utility type
     * Returns array with main meter + additional meters
     *
     * @param {string} type - Utility type
     * @returns {Array} - Array of {name, config} objects
     */
    getMetersForType(type) {
        const configType = this.getConfigType(type);
        const meters = [];

        // Main meter (always present if type is active)
        const mainActive = this.adapter.config[`${configType}Aktiv`];
        if (mainActive) {
            // Get main meter name from config and normalize
            const mainMeterName = this.adapter.config[`${configType}MainMeterName`] || 'main';
            const normalizedName = helpers.normalizeMeterName(mainMeterName);
            const displayName = mainMeterName; // Original name for display

            meters.push({
                name: normalizedName,
                displayName: displayName,
                config: {
                    sensorDP: this.adapter.config[`${configType}SensorDP`],
                    preis: parseConfigNumber(this.adapter.config[`${configType}Preis`], 0),
                    offset: parseConfigNumber(this.adapter.config[`${configType}Offset`], 0),
                    initialReading: parseConfigNumber(this.adapter.config[`${configType}InitialReading`], 0),
                    contractStart: this.adapter.config[`${configType}ContractStart`],
                    grundgebuehr: parseConfigNumber(this.adapter.config[`${configType}Grundgebuehr`], 0),
                    jahresgebuehr: parseConfigNumber(this.adapter.config[`${configType}Jahresgebuehr`], 0),
                    abschlag: parseConfigNumber(this.adapter.config[`${configType}Abschlag`], 0),
                    htNtEnabled: this.adapter.config[`${configType}HtNtEnabled`] || false,
                },
            });
        }

        // Additional meters from array config
        const additionalMeters = this.adapter.config[`${configType}AdditionalMeters`];
        if (Array.isArray(additionalMeters)) {
            for (const meterConfig of additionalMeters) {
                if (meterConfig && meterConfig.name && meterConfig.sensorDP) {
                    const normalizedName = helpers.normalizeMeterName(meterConfig.name);

                    // Debug: Log raw config for troubleshooting
                    this.adapter.log.debug(
                        `[${type}] Meter "${normalizedName}": preis=${meterConfig.preis} (${typeof meterConfig.preis}), grundgebuehr=${meterConfig.grundgebuehr} (${typeof meterConfig.grundgebuehr}), abschlag=${meterConfig.abschlag} (${typeof meterConfig.abschlag})`,
                    );

                    const parsedConfig = {
                        sensorDP: meterConfig.sensorDP,
                        preis: parseConfigNumber(meterConfig.preis, 0),
                        offset: parseConfigNumber(meterConfig.offset, 0),
                        initialReading: parseConfigNumber(meterConfig.initialReading, 0),
                        contractStart: meterConfig.contractStart,
                        grundgebuehr: parseConfigNumber(meterConfig.grundgebuehr, 0),
                        jahresgebuehr: parseConfigNumber(meterConfig.jahresgebuehr, 0),
                        abschlag: parseConfigNumber(meterConfig.abschlag, 0),
                        htNtEnabled: false, // Additional meters don't support HT/NT
                    };

                    meters.push({
                        name: normalizedName,
                        displayName: meterConfig.name,
                        config: parsedConfig,
                    });
                }
            }
        }

        return meters;
    }

    /**
     * Finds meters by sensor datapoint
     *
     * @param {string} sensorDP - Sensor datapoint ID
     * @returns {Array} - Array of {type, meterName} objects
     */
    findMeterBySensor(sensorDP) {
        return this.meterRegistry.findBySensor(sensorDP);
    }

    /**
     * Initializes all meters for a utility type
     *
     * @param {string} type - Utility type
     * @returns {Promise<void>}
     */
    async initializeType(type) {
        const meters = this.getMetersForType(type);

        if (meters.length === 0) {
            this.adapter.log.debug(`No meters configured for ${type}`);
            return;
        }

        this.adapter.log.info(`Initializing ${meters.length} meter(s) for ${type}`);

        // Initialize each meter
        for (const meter of meters) {
            await this.initializeMeter(type, meter.name, meter.config, meter.displayName);
        }

        // Create totals structure if multiple meters exist
        if (meters.length > 1) {
            await stateManager.createTotalsStructure(this.adapter, type);
            await this.updateTotalCosts(type);
        }

        // Cleanup removed meters
        await this.cleanupRemovedMeters(type, meters);
    }

    /**
     * Initializes a specific meter
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name ('main' or normalized custom name)
     * @param {object} config - Meter configuration
     * @param {string} displayName - Original display name (optional)
     * @returns {Promise<void>}
     */
    async initializeMeter(type, meterName, config, displayName) {
        const basePath = `${type}.${meterName}`;
        const label = displayName || meterName;

        this.adapter.log.info(`Initializing ${type} meter: ${label}`);

        if (!config.sensorDP) {
            this.adapter.log.warn(`${type} meter "${label}" has no sensor datapoint configured!`);
            try {
                await this.adapter.setStateAsync(`${basePath}.info.sensorActive`, false, true);
            } catch (error) {
                this.adapter.log.warn(`Could not set sensorActive state for ${basePath}: ${error.message}`);
            }
            return;
        }

        // Create state structure with error handling
        try {
            await stateManager.createMeterStructure(this.adapter, type, meterName, config);
        } catch (error) {
            this.adapter.log.error(`Failed to create state structure for ${basePath}: ${error.message}`);
            return;
        }

        // Register sensor mapping
        this.meterRegistry.register(config.sensorDP, type, meterName);

        this.adapter.log.debug(`Using sensor datapoint for ${type}.${meterName}: ${config.sensorDP}`);

        // Log configured contract start
        if (config.contractStart) {
            this.adapter.log.info(`${type}.${meterName}: Contract start: ${config.contractStart}`);
        }

        // Subscribe to sensor datapoint
        this.adapter.subscribeForeignStates(config.sensorDP);
        await this.adapter.setStateAsync(`${basePath}.info.sensorActive`, true, true);
        this.adapter.log.debug(`Subscribed to ${type}.${meterName} sensor: ${config.sensorDP}`);

        // Restore last sensor value from persistent state
        const lastReading = await this.adapter.getStateAsync(`${basePath}.info.meterReading`);
        if (lastReading && typeof lastReading.val === 'number') {
            this.lastSensorValues[config.sensorDP] = lastReading.val;
            this.adapter.log.debug(`${type}.${meterName}: Restored last sensor value: ${lastReading.val}`);
        }

        // Initialize with current sensor value
        try {
            const sensorState = await this.adapter.getForeignStateAsync(config.sensorDP);
            if (sensorState && sensorState.val != null) {
                // Convert to number (handles strings, German commas, etc.)
                const numValue = calculator.ensureNumber(sensorState.val);
                await this.handleSensorUpdate(type, meterName, config.sensorDP, numValue);
            }
        } catch (error) {
            this.adapter.log.warn(`Could not read initial value from ${config.sensorDP}: ${error.message}`);
            await this.adapter.setStateAsync(`${basePath}.info.sensorActive`, false, true);
        }

        // Initialize period start timestamps
        const timestampRoles = ['lastDayStart', 'lastWeekStart', 'lastMonthStart', 'lastYearStart'];

        for (const role of timestampRoles) {
            const statePath = `${basePath}.statistics.timestamps.${role}`;
            const state = await this.adapter.getStateAsync(statePath);

            if (role === 'lastYearStart') {
                // Calculate expected yearStart based on contract
                const contractStart = calculator.parseGermanDate(config.contractStart);
                let expectedYearStart;

                if (contractStart && !isNaN(contractStart.getTime())) {
                    const now = new Date();
                    expectedYearStart = new Date(
                        now.getFullYear(),
                        contractStart.getMonth(),
                        contractStart.getDate(),
                        12,
                        0,
                        0,
                    );

                    if (expectedYearStart > now) {
                        expectedYearStart.setFullYear(now.getFullYear() - 1);
                    }
                }

                if (!expectedYearStart) {
                    expectedYearStart = new Date(new Date().getFullYear(), 0, 1, 12, 0, 0);
                }

                // Always set to expected value (fixes mismatches from config changes)
                await this.adapter.setStateAsync(statePath, expectedYearStart.getTime(), true);
            } else {
                // For lastDayStart and lastMonthStart
                if (!state || !state.val || typeof state.val === 'string') {
                    // Initialize with current timestamp (convert string to number if needed)
                    await this.adapter.setStateAsync(statePath, Date.now(), true);
                }
                // If already a valid number, no action needed (already correct in state)
            }
        }

        // NOTE: Initial yearly consumption is calculated in handleSensorUpdate()
        // which is called immediately after this initialization (line 224)
        // This avoids race conditions where state objects aren't fully created yet

        // Update current price
        await this.updateCurrentPrice(type, meterName, config);

        // Update billing countdown
        if (config.contractStart) {
            const startDate = calculator.parseGermanDate(config.contractStart);
            if (startDate) {
                const today = new Date();
                const nextAnniversary = new Date(startDate);
                nextAnniversary.setFullYear(today.getFullYear());

                if (nextAnniversary < today) {
                    nextAnniversary.setFullYear(today.getFullYear() + 1);
                }

                const msPerDay = 1000 * 60 * 60 * 24;
                const daysRemaining = Math.ceil((nextAnniversary.getTime() - today.getTime()) / msPerDay);
                const displayPeriodEnd = new Date(nextAnniversary);
                displayPeriodEnd.setDate(displayPeriodEnd.getDate() - 1);

                this.adapter.log.debug(
                    `[${basePath}] Billing countdown: contractStart=${config.contractStart}, daysRemaining=${daysRemaining}, periodEnd=${displayPeriodEnd.toLocaleDateString('de-DE')}`,
                );

                await this.adapter.setStateAsync(`${basePath}.billing.daysRemaining`, daysRemaining, true);
                await this.adapter.setStateAsync(
                    `${basePath}.billing.periodEnd`,
                    displayPeriodEnd.toLocaleDateString('de-DE'),
                    true,
                );
            }
        }

        // Initial cost calculation
        await this.updateCosts(type, meterName, config);

        // Reconstruct weekly consumption from daily values if needed
        await this.reconstructPeriodConsumption(type, meterName, basePath);

        this.adapter.log.debug(`Meter initialization completed for ${type}.${meterName}`);
    }

    /**
     * Reconstructs weekly and monthly consumption values after adapter restart
     * This fixes data loss when adapter was offline and missed delta accumulation
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {string} basePath - State base path
     */
    async reconstructPeriodConsumption(type, meterName, basePath) {
        const now = Date.now();

        // Get period start timestamps
        const lastWeekStartState = await this.adapter.getStateAsync(`${basePath}.statistics.timestamps.lastWeekStart`);
        const lastDayStartState = await this.adapter.getStateAsync(`${basePath}.statistics.timestamps.lastDayStart`);

        if (!lastWeekStartState?.val || !lastDayStartState?.val) {
            this.adapter.log.debug(`[${basePath}] No period timestamps found, skipping reconstruction`);
            return;
        }

        const lastWeekStart = lastWeekStartState.val;
        const lastDayStart = lastDayStartState.val;

        // Calculate days since week start
        const daysSinceWeekStart = (now - lastWeekStart) / (24 * 60 * 60 * 1000);

        // Only reconstruct if we're within a valid week (0-7 days)
        if (daysSinceWeekStart < 0 || daysSinceWeekStart > 7) {
            this.adapter.log.debug(
                `[${basePath}] Week period out of range (${daysSinceWeekStart.toFixed(1)} days), skipping reconstruction`,
            );
            return;
        }

        // Get current consumption values
        const weeklyState = await this.adapter.getStateAsync(`${basePath}.consumption.weekly`);
        const dailyState = await this.adapter.getStateAsync(`${basePath}.consumption.daily`);
        const lastDayState = await this.adapter.getStateAsync(`${basePath}.statistics.consumption.lastDay`);

        const currentWeekly = weeklyState?.val || 0;
        const currentDaily = dailyState?.val || 0;
        const lastDay = lastDayState?.val || 0;

        // Calculate expected weekly based on lastDay values accumulated since lastWeekStart
        // Simple approach: If daily counter was reset today and we have lastDay,
        // weekly should be at least lastDay + currentDaily
        const daysSinceDayReset = (now - lastDayStart) / (24 * 60 * 60 * 1000);

        // If daily was reset (daysSinceDayReset < 1) and weekly seems too low
        if (daysSinceDayReset < 1 && currentWeekly < lastDay + currentDaily) {
            // Weekly might have missed the lastDay value
            // This can happen if adapter restarted after daily reset
            const reconstructedWeekly = calculator.roundToDecimals(currentWeekly + lastDay, 2);

            if (reconstructedWeekly > currentWeekly) {
                this.adapter.log.info(
                    `[${basePath}] Reconstructing weekly: ${currentWeekly} -> ${reconstructedWeekly} (added lastDay: ${lastDay})`,
                );
                await this.adapter.setStateAsync(`${basePath}.consumption.weekly`, reconstructedWeekly, true);

                // Also reconstruct gas volume if applicable
                if (type === 'gas') {
                    const weeklyVolumeState = await this.adapter.getStateAsync(`${basePath}.consumption.weeklyVolume`);
                    const lastDayVolumeState = await this.adapter.getStateAsync(
                        `${basePath}.statistics.consumption.lastDayVolume`,
                    );
                    const currentWeeklyVolume = weeklyVolumeState?.val || 0;
                    const lastDayVolume = lastDayVolumeState?.val || 0;

                    if (lastDayVolume > 0) {
                        const reconstructedWeeklyVolume = calculator.roundToDecimals(
                            currentWeeklyVolume + lastDayVolume,
                            4,
                        );
                        await this.adapter.setStateAsync(
                            `${basePath}.consumption.weeklyVolume`,
                            reconstructedWeeklyVolume,
                            true,
                        );
                    }
                }
            }
        }

        // Similar logic for monthly reconstruction
        const lastMonthStartState = await this.adapter.getStateAsync(
            `${basePath}.statistics.timestamps.lastMonthStart`,
        );
        if (lastMonthStartState?.val) {
            const lastMonthStart = lastMonthStartState.val;
            const daysSinceMonthStart = (now - lastMonthStart) / (24 * 60 * 60 * 1000);

            // Only if within valid month range (0-31 days)
            if (daysSinceMonthStart >= 0 && daysSinceMonthStart <= 31) {
                const monthlyState = await this.adapter.getStateAsync(`${basePath}.consumption.monthly`);
                const currentMonthly = monthlyState?.val || 0;

                // If daily was reset and monthly seems to be missing the lastDay
                if (daysSinceDayReset < 1 && currentMonthly < lastDay + currentDaily) {
                    const reconstructedMonthly = calculator.roundToDecimals(currentMonthly + lastDay, 2);

                    if (reconstructedMonthly > currentMonthly) {
                        this.adapter.log.info(
                            `[${basePath}] Reconstructing monthly: ${currentMonthly} -> ${reconstructedMonthly} (added lastDay: ${lastDay})`,
                        );
                        await this.adapter.setStateAsync(`${basePath}.consumption.monthly`, reconstructedMonthly, true);

                        // Also reconstruct gas volume if applicable
                        if (type === 'gas') {
                            const monthlyVolumeState = await this.adapter.getStateAsync(
                                `${basePath}.consumption.monthlyVolume`,
                            );
                            const lastDayVolumeState = await this.adapter.getStateAsync(
                                `${basePath}.statistics.consumption.lastDayVolume`,
                            );
                            const currentMonthlyVolume = monthlyVolumeState?.val || 0;
                            const lastDayVolume = lastDayVolumeState?.val || 0;

                            if (lastDayVolume > 0) {
                                const reconstructedMonthlyVolume = calculator.roundToDecimals(
                                    currentMonthlyVolume + lastDayVolume,
                                    4,
                                );
                                await this.adapter.setStateAsync(
                                    `${basePath}.consumption.monthlyVolume`,
                                    reconstructedMonthlyVolume,
                                    true,
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Handles sensor value updates
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {string} sensorDP - Sensor datapoint ID
     * @param {number} value - New sensor value
     */
    async handleSensorUpdate(type, meterName, sensorDP, value) {
        if (typeof value !== 'number' || value < 0) {
            this.adapter.log.warn(`Invalid sensor value for ${type}.${meterName}: ${value}`);
            return;
        }

        const basePath = `${type}.${meterName}`;
        this.adapter.log.debug(`[${basePath}] handleSensorUpdate: value=${value}, sensorDP=${sensorDP}`);

        const now = Date.now();

        // Get meter config
        const meters = this.getMetersForType(type);
        const meter = meters.find(m => m.name === meterName);
        if (!meter) {
            this.adapter.log.warn(`Meter ${type}.${meterName} not found in configuration`);
            return;
        }

        const config = meter.config;

        // Pre-process consumption value (offset, gas conversion)
        const processed = await this._preprocessValue(type, value, config);
        const { consumption, consumptionM3 } = processed;

        // 1. Initialization Logic (Per Session)
        if (this.lastSensorValues[sensorDP] === undefined) {
            await this._handleFirstSensorValue(type, meterName, sensorDP, processed, basePath, config, now);
            return;
        }

        // 2. Update meter reading states
        await this.adapter.setStateAsync(`${basePath}.info.meterReading`, consumption, true);
        if (type === 'gas') {
            await this.adapter.setStateAsync(`${basePath}.info.meterReadingVolume`, consumptionM3 || 0, true);
        }

        // 3. Delta Calibration & Spike Protection
        const lastValue = this.lastSensorValues[sensorDP];
        this.lastSensorValues[sensorDP] = consumption;

        if (consumption < lastValue) {
            await this._handleMeterReset(type, meterName, lastValue, consumption, config);
            return;
        }

        const delta = calculator.roundToDecimals(consumption - lastValue, 4);
        if (delta <= 0) {
            return;
        }

        const spikeThreshold = this.adapter.config.sensorSpikeThreshold || DEFAULT_SPIKE_THRESHOLD;
        if (delta > spikeThreshold) {
            await this._handleSuspiciousDelta(
                type,
                meterName,
                delta,
                consumption,
                consumptionM3,
                config,
                basePath,
                now,
            );
            return;
        }

        this.adapter.log.debug(`${type}.${meterName} delta: ${delta}`);

        // 4. Update Consumption Values (Daily, Weekly, Monthly)
        const deltaVolume =
            type === 'gas'
                ? delta /
                  ((this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT) *
                      (this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL))
                : 0;
        await this._updateTotalConsumptionStates(basePath, type, delta, deltaVolume);

        // 5. HT/NT Tracking
        await this._updateHTNTConsumptionStates(basePath, type, delta, config);

        // 6. Yearly & Costs
        const yearlyAmountFinal = await this._updateYearlyConsumption(
            type,
            meterName,
            config,
            consumption,
            consumptionM3,
            delta,
            basePath,
        );

        await this.updateCosts(type, meterName, config, yearlyAmountFinal);
        await this.updateTotalCosts(type);

        await this.adapter.setStateAsync(`${basePath}.consumption.lastUpdate`, now, true);
        await this.adapter.setStateAsync(`${basePath}.info.lastSync`, now, true);
    }

    /**
     * Preprocesses raw sensor value (offset, gas conversion)
     *
     * @param {string} type - Utility type
     * @param {number} value - Raw sensor value
     * @param {object} config - Meter configuration
     * @returns {Promise<{consumption: number, consumptionM3: number|null}>} Processed values
     */
    async _preprocessValue(type, value, config) {
        let consumption = value;
        let consumptionM3 = null;

        if (config.offset !== 0) {
            consumption = consumption - config.offset;
        }

        if (type === 'gas') {
            const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
            const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;

            const res = consumptionHelper.calculateGas(consumption, brennwert, zZahl);
            consumptionM3 = res.volume;
            consumption = res.energy;
        }

        return { consumption, consumptionM3 };
    }

    /**
     * Handles the very first sensor value in a session (recovery or initial)
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {string} sensorDP - Sensor data point path
     * @param {object} processed - Processed consumption values
     * @param {string} basePath - State base path
     * @param {object} config - Meter configuration
     * @param {number} now - Current timestamp
     */
    async _handleFirstSensorValue(type, meterName, sensorDP, processed, basePath, config, now) {
        const { consumption, consumptionM3 } = processed;
        const currentState = await this.adapter.getStateAsync(`${basePath}.info.meterReading`);
        const recoveredValue = currentState?.val ?? 0;

        if (recoveredValue > 0 && Math.abs(consumption - recoveredValue) < 100) {
            this.adapter.log.info(`[${basePath}] Recovered persistent baseline: ${recoveredValue}`);
            this.lastSensorValues[sensorDP] = recoveredValue;

            // Validate period consumption values against spike threshold
            // This catches cases where old consumption values are unrealistically high
            await this._validatePeriodConsumption(type, basePath, now);
        } else {
            if (recoveredValue > 0) {
                this.adapter.log.warn(
                    `[${basePath}] Recovered state (${recoveredValue}) differs significantly from new value (${consumption}).`,
                );
            } else {
                this.adapter.log.info(
                    `[${basePath}] No previous reading found. Setting initial baseline to ${consumption}`,
                );
            }
            this.lastSensorValues[sensorDP] = consumption;
            await this.adapter.setStateAsync(`${basePath}.info.meterReading`, consumption, true);
            if (type === 'gas') {
                await this.adapter.setStateAsync(`${basePath}.info.meterReadingVolume`, consumptionM3 || 0, true);
            }

            // On baseline reset, validate and potentially reset period consumption values
            await this._validatePeriodConsumption(type, basePath, now);

            if (config.initialReading > 0) {
                await this.calculateAbsoluteYearly(type, meterName, config, consumption, consumptionM3 || 0, now);
                await this.updateCosts(type, meterName, config);
                await this.updateTotalCosts(type);
            }
        }
        await this.adapter.setStateAsync(`${basePath}.info.lastSync`, now, true);
        await this.adapter.setStateAsync(`${basePath}.consumption.lastUpdate`, now, true);
    }

    /**
     * Validates period consumption values and resets them if they exceed the spike threshold.
     * This prevents unrealistic values after adapter restart or database inconsistencies.
     *
     * @param {string} type - Utility type
     * @param {string} basePath - State base path
     * @param {number} now - Current timestamp
     */
    async _validatePeriodConsumption(type, basePath, now) {
        const spikeThreshold = this.adapter.config.sensorSpikeThreshold || DEFAULT_SPIKE_THRESHOLD;

        // Check and reset period consumption values that exceed the spike threshold
        const periods = ['daily', 'weekly', 'monthly'];
        for (const period of periods) {
            const state = await this.adapter.getStateAsync(`${basePath}.consumption.${period}`);
            const value = state?.val || 0;

            // Get period start timestamp to calculate expected max consumption
            const periodKey =
                period === 'daily' ? 'Day' : period === 'weekly' ? 'Week' : period === 'monthly' ? 'Month' : 'Year';
            const periodStartState = await this.adapter.getStateAsync(
                `${basePath}.statistics.timestamps.last${periodKey}Start`,
            );
            const periodStart = periodStartState?.val || now;
            const daysSincePeriodStart = (now - periodStart) / (24 * 60 * 60 * 1000);

            // Calculate reasonable max: spike threshold per day * days in period
            // Add buffer of 2x for safety
            const maxReasonableConsumption = spikeThreshold * Math.max(1, daysSincePeriodStart) * 2;

            if (value > maxReasonableConsumption) {
                this.adapter.log.warn(
                    `[${basePath}] Resetting ${period} consumption: ${value} exceeds reasonable max of ${maxReasonableConsumption.toFixed(0)} (${daysSincePeriodStart.toFixed(1)} days * ${spikeThreshold} threshold * 2)`,
                );
                await this.adapter.setStateAsync(`${basePath}.consumption.${period}`, 0, true);

                // Also reset volume states for gas
                if (type === 'gas') {
                    await this.adapter.setStateAsync(`${basePath}.consumption.${period}Volume`, 0, true);
                }
            }
        }
    }

    /**
     * Handles meter reset or replacement condition
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {number} lastValue - Previous sensor value
     * @param {number} consumption - Current consumption value
     * @param {object} config - Meter configuration
     */
    async _handleMeterReset(type, meterName, lastValue, consumption, config) {
        this.adapter.log.warn(
            `${type}.${meterName}: Zählerstand gesunken (${lastValue} -> ${consumption}). Gehe von Zählerwechsel oder Reset aus.`,
        );
        await this.updateCosts(type, meterName, config);
        await this.updateTotalCosts(type);
    }

    /**
     * Handles suspicious delta (spike detection)
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {number} delta - Calculated delta
     * @param {number} consumption - Current consumption value
     * @param {number|null} consumptionM3 - Current gas volume
     * @param {object} config - Meter configuration
     * @param {string} basePath - State base path
     * @param {number} now - Current timestamp
     */
    async _handleSuspiciousDelta(type, meterName, delta, consumption, consumptionM3, config, basePath, now) {
        this.adapter.log.warn(`[${basePath}] Discarding suspicious delta of ${delta}. Treating as baseline reset.`);
        if (config.initialReading > 0) {
            await this.calculateAbsoluteYearly(type, meterName, config, consumption, consumptionM3 || 0, now);
        }
    }

    /**
     * Updates all period consumption states
     *
     * @param {string} basePath - State base path
     * @param {string} type - Utility type
     * @param {number} delta - Consumption delta
     * @param {number} deltaVolume - Gas volume delta
     */
    async _updateTotalConsumptionStates(basePath, type, delta, deltaVolume) {
        const periods = ['daily', 'weekly', 'monthly'];
        for (const period of periods) {
            const state = await this.adapter.getStateAsync(`${basePath}.consumption.${period}`);
            await this.adapter.setStateAsync(
                `${basePath}.consumption.${period}`,
                calculator.roundToDecimals((state?.val || 0) + delta, 2),
                true,
            );

            if (type === 'gas' && deltaVolume > 0) {
                const volState = await this.adapter.getStateAsync(`${basePath}.consumption.${period}Volume`);
                await this.adapter.setStateAsync(
                    `${basePath}.consumption.${period}Volume`,
                    calculator.roundToDecimals((volState?.val || 0) + deltaVolume, 2),
                    true,
                );
            }
        }
    }

    /**
     * Updates HT/NT specific consumption states
     *
     * @param {string} basePath - State base path
     * @param {string} type - Utility type
     * @param {number} delta - Consumption delta
     * @param {object} config - Meter configuration
     */
    async _updateHTNTConsumptionStates(basePath, type, delta, config) {
        if (!config.htNtEnabled) {
            return;
        }

        const configType = this.getConfigType(type);
        const suffix = consumptionHelper.getHTNTSuffix(this.adapter.config, configType);
        if (!suffix) {
            return;
        }

        const periods = ['daily', 'weekly', 'monthly'];
        for (const period of periods) {
            const state = await this.adapter.getStateAsync(`${basePath}.consumption.${period}${suffix}`);
            await this.adapter.setStateAsync(
                `${basePath}.consumption.${period}${suffix}`,
                calculator.roundToDecimals((state?.val || 0) + delta, 2),
                true,
            );
        }

        if (type === 'gas') {
            const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
            const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
            const deltaVolume = delta / (brennwert * zZahl);

            const state = await this.adapter.getStateAsync(`${basePath}.consumption.weeklyVolume${suffix}`);
            await this.adapter.setStateAsync(
                `${basePath}.consumption.weeklyVolume${suffix}`,
                calculator.roundToDecimals((state?.val || 0) + deltaVolume, 2),
                true,
            );
        }
    }

    /**
     * Updates yearly consumption
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {object} config - Meter configuration
     * @param {number} consumption - Current consumption value
     * @param {number|null} consumptionM3 - Current gas volume
     * @param {number} delta - Consumption delta
     * @param {string} basePath - State base path
     * @returns {Promise<number>} final yearly amount
     */
    async _updateYearlyConsumption(type, meterName, config, consumption, consumptionM3, delta, basePath) {
        let yearlyAmountFinal;
        if (config.initialReading > 0) {
            let yearlyAmount;
            if (type === 'gas') {
                const yearlyM3 = Math.max(0, (consumptionM3 || 0) - config.initialReading);
                await this.adapter.setStateAsync(
                    `${basePath}.consumption.yearlyVolume`,
                    calculator.roundToDecimals(yearlyM3, 2),
                    true,
                );
                const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
                const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
                yearlyAmount = calculator.convertGasM3ToKWh(yearlyM3, brennwert, zZahl);
            } else {
                yearlyAmount = Math.max(0, consumption - config.initialReading);
            }
            yearlyAmountFinal = calculator.roundToDecimals(yearlyAmount, 2);
            await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, yearlyAmountFinal, true);
        } else {
            const yState = await this.adapter.getStateAsync(`${basePath}.consumption.yearly`);
            yearlyAmountFinal = calculator.roundToDecimals((yState?.val || 0) + delta, 2);
            await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, yearlyAmountFinal, true);
        }
        return yearlyAmountFinal;
    }

    /**
     * Helper to calculate absolute yearly consumption (usually on start/reset)
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {object} config - Meter configuration
     * @param {number} consumption - Current consumption value
     * @param {number} consumptionM3 - Current consumption in m³ (for gas)
     * @param {number} now - Current timestamp
     */
    async calculateAbsoluteYearly(type, meterName, config, consumption, consumptionM3, now) {
        const basePath = `${type}.${meterName}`;
        let yearlyAmountFinal;

        let yearlyAmount;
        if (type === 'gas') {
            const yearlyM3 = Math.max(0, (consumptionM3 || 0) - config.initialReading);
            this.adapter.log.debug(
                `[${basePath}] Yearly absolute (Gas): consumptionM3=${consumptionM3}, initialReading=${config.initialReading}, resultM3=${yearlyM3}`,
            );
            await this.adapter.setStateAsync(
                `${basePath}.consumption.yearlyVolume`,
                calculator.roundToDecimals(yearlyM3, 2),
                true,
            );
            const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
            const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
            yearlyAmount = calculator.convertGasM3ToKWh(yearlyM3, brennwert, zZahl);
        } else {
            yearlyAmount = Math.max(0, consumption - config.initialReading);
            this.adapter.log.debug(
                `[${basePath}] Yearly absolute: consumption=${consumption}, initialReading=${config.initialReading}, result=${yearlyAmount}`,
            );
        }
        yearlyAmountFinal = calculator.roundToDecimals(yearlyAmount, 2);
        await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, yearlyAmountFinal, true);

        // Pass direct calculated values to updateCosts to avoid race condition with DB
        await this.updateCosts(type, meterName, config, yearlyAmountFinal);
        await this.updateTotalCosts(type);

        await this.adapter.setStateAsync(`${basePath}.consumption.lastUpdate`, now, true);
        await this.adapter.setStateAsync(`${basePath}.info.lastSync`, now, true);
    }

    /**
     * Updates the current price display
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {object} config - Meter configuration
     */
    async updateCurrentPrice(type, meterName, config) {
        const basePath = `${type}.${meterName}`;
        const configType = this.getConfigType(type);

        let tariffName = 'Standard';
        let activePrice = config.preis || 0;

        // Only meters with HT/NT enabled support it
        if (config.htNtEnabled) {
            const isHT = calculator.isHTTime(this.adapter.config, configType);
            if (isHT) {
                activePrice = this.adapter.config[`${configType}HtPrice`] || 0;
                tariffName = 'Haupttarif (HT)';
            } else {
                activePrice = this.adapter.config[`${configType}NtPrice`] || 0;
                tariffName = 'Nebentarif (NT)';
            }
            this.adapter.log.debug(`[${basePath}] Price update: tariff=${tariffName}, price=${activePrice}`);
        }

        await this.adapter.setStateAsync(
            `${basePath}.info.currentPrice`,
            calculator.roundToDecimals(activePrice, 4),
            true,
        );
        await this.adapter.setStateAsync(`${basePath}.info.currentTariff`, tariffName, true);
        await this.adapter.setStateAsync(`${basePath}.info.lastSync`, Date.now(), true);
    }

    /**
     * Updates costs for a specific meter
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {object} config - Meter configuration
     * @param {number} [forcedYearly] - Optional already calculated yearly consumption (avoids DB race)
     */
    async updateCosts(type, meterName, config, forcedYearly) {
        const basePath = `${type}.${meterName}`;

        // Get consumption values
        const daily = (await this.adapter.getStateAsync(`${basePath}.consumption.daily`))?.val || 0;
        const monthly = (await this.adapter.getStateAsync(`${basePath}.consumption.monthly`))?.val || 0;

        let yearly;
        if (forcedYearly !== undefined && forcedYearly !== null) {
            yearly = forcedYearly;
        } else {
            yearly = (await this.adapter.getStateAsync(`${basePath}.consumption.yearly`))?.val || 0;
        }

        // Get price
        const price = config.preis || 0;

        this.adapter.log.debug(
            `[${basePath}] Cost update: daily=${daily}, monthly=${monthly}, yearly=${yearly}, price=${price}`,
        );

        // Calculate consumption costs
        const dailyCost = daily * price;
        const weeklyState = await this.adapter.getStateAsync(`${basePath}.consumption.weekly`);
        const weeklyCost = (weeklyState?.val || 0) * price;
        const monthlyCost = monthly * price;
        const yearlyCost = yearly * price;

        await this.adapter.setStateAsync(`${basePath}.costs.daily`, calculator.roundToDecimals(dailyCost, 2), true);
        await this.adapter.setStateAsync(`${basePath}.costs.weekly`, calculator.roundToDecimals(weeklyCost, 2), true);
        await this.adapter.setStateAsync(`${basePath}.costs.monthly`, calculator.roundToDecimals(monthlyCost, 2), true);
        await this.adapter.setStateAsync(`${basePath}.costs.yearly`, calculator.roundToDecimals(yearlyCost, 2), true);

        // Calculate accumulated costs based on contract start
        const monthsSinceYearStart = await this._calculateMonthsSinceYearStart(basePath);

        const charges = billingHelper.calculateAccumulatedCharges(
            config.grundgebuehr,
            config.jahresgebuehr,
            monthsSinceYearStart,
        );
        const basicChargeAccumulated = charges.basicCharge;
        const annualFeeAccumulated = charges.annualFee;

        // Update basicCharge and annualFee states
        await this.adapter.setStateAsync(`${basePath}.costs.basicCharge`, basicChargeAccumulated, true);
        await this.adapter.setStateAsync(`${basePath}.costs.annualFee`, annualFeeAccumulated, true);

        // Calculate total yearly costs and balance
        const totalYearlyCost = Math.max(0, yearlyCost + charges.total);
        await this.adapter.setStateAsync(
            `${basePath}.costs.totalYearly`,
            calculator.roundToDecimals(totalYearlyCost, 2),
            true,
        );

        const balanceRes = billingHelper.calculateBalance(config.abschlag, monthsSinceYearStart, totalYearlyCost);

        this.adapter.log.debug(
            `[${basePath}] Cost calculation (MultiMeter): daily=${daily}, monthly=${monthly}, yearly=${yearly}, price=${price}, totalYearly=${totalYearlyCost}, paidTotal=${balanceRes.paid}, balance=${balanceRes.balance}`,
        );

        await this.adapter.setStateAsync(`${basePath}.costs.paidTotal`, balanceRes.paid, true);
        await this.adapter.setStateAsync(`${basePath}.costs.balance`, balanceRes.balance, true);
    }

    /**
     * Calculates months since year start for a meter
     *
     * @param {string} basePath - State base path
     * @returns {Promise<number>} Months since start (at least 1)
     */
    async _calculateMonthsSinceYearStart(basePath) {
        const yearStartState = await this.adapter.getStateAsync(`${basePath}.statistics.timestamps.lastYearStart`);
        let monthsSinceYearStart = 1;

        if (yearStartState && yearStartState.val) {
            const yearStartDate = new Date(yearStartState.val);
            if (!isNaN(yearStartDate.getTime())) {
                monthsSinceYearStart = calculator.getMonthsDifference(yearStartDate, new Date()) + 1;
            }
        }
        return Math.max(1, monthsSinceYearStart);
    }

    /**
     * Updates total costs (sum of all meters)
     *
     * @param {string} type - Utility type
     */
    async updateTotalCosts(type) {
        const meters = this.getMetersForType(type);

        if (meters.length <= 1) {
            // No totals needed for single meter
            return;
        }

        // Check if totals structure exists before trying to update
        const totalsExists = await this.adapter.getObjectAsync(`${type}.totals`);
        if (!totalsExists) {
            // Totals structure not yet created, skip update
            // This happens during initialization when handleSensorUpdate is called
            // before createTotalsStructure has run
            this.adapter.log.debug(`Skipping total costs update for ${type} - totals structure not yet created`);
            return;
        }

        let totalDaily = 0;
        let totalWeekly = 0;
        let totalMonthly = 0;
        let totalYearly = 0;
        let totalCostsDaily = 0;
        let totalCostsWeekly = 0;
        let totalCostsMonthly = 0;
        let totalCostsYearly = 0;

        for (const meter of meters) {
            const basePath = `${type}.${meter.name}`;

            totalDaily += (await this.adapter.getStateAsync(`${basePath}.consumption.daily`))?.val || 0;
            totalWeekly += (await this.adapter.getStateAsync(`${basePath}.consumption.weekly`))?.val || 0;
            totalMonthly += (await this.adapter.getStateAsync(`${basePath}.consumption.monthly`))?.val || 0;
            totalYearly += (await this.adapter.getStateAsync(`${basePath}.consumption.yearly`))?.val || 0;

            totalCostsDaily += (await this.adapter.getStateAsync(`${basePath}.costs.daily`))?.val || 0;
            totalCostsWeekly += (await this.adapter.getStateAsync(`${basePath}.costs.weekly`))?.val || 0;
            totalCostsMonthly += (await this.adapter.getStateAsync(`${basePath}.costs.monthly`))?.val || 0;
            totalCostsYearly += (await this.adapter.getStateAsync(`${basePath}.costs.totalYearly`))?.val || 0;
        }

        await this.adapter.setStateAsync(
            `${type}.totals.consumption.daily`,
            calculator.roundToDecimals(totalDaily, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.consumption.weekly`,
            calculator.roundToDecimals(totalWeekly, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.consumption.monthly`,
            calculator.roundToDecimals(totalMonthly, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.consumption.yearly`,
            calculator.roundToDecimals(totalYearly, 2),
            true,
        );

        await this.adapter.setStateAsync(
            `${type}.totals.costs.daily`,
            calculator.roundToDecimals(totalCostsDaily, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.costs.weekly`,
            calculator.roundToDecimals(totalCostsWeekly, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.costs.monthly`,
            calculator.roundToDecimals(totalCostsMonthly, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.costs.totalYearly`,
            calculator.roundToDecimals(totalCostsYearly, 2),
            true,
        );
    }

    /**
     * Cleanup removed meters
     *
     * @param {string} type - Utility type
     * @param {Array} currentMeters - Currently configured meters
     */
    async cleanupRemovedMeters(type, currentMeters) {
        // Get all existing meter folders
        try {
            const obj = await this.adapter.getObjectAsync(type);
            if (!obj) {
                return;
            }

            const children = await this.adapter.getObjectListAsync({
                startkey: `${this.adapter.namespace}.${type}.`,
                endkey: `${this.adapter.namespace}.${type}.\u9999`,
            });

            const PROTECTED_CATEGORIES = [
                'consumption',
                'costs',
                'billing',
                'info',
                'statistics',
                'adjustment',
                'history',
                'totals',
            ];
            const currentMeterNames = new Set(currentMeters.map(m => m.name));
            const existingMeterFolders = new Set();

            // Find all meter folders
            for (const item of children.rows) {
                const id = item.id.replace(`${this.adapter.namespace}.`, '');
                const parts = id.split('.');
                // Only consider it a meter folder if it's the second part and not a protected category
                if (parts.length >= 2 && parts[0] === type && !PROTECTED_CATEGORIES.includes(parts[1])) {
                    existingMeterFolders.add(parts[1]);
                }
            }

            // Delete meters that no longer exist in config
            for (const folderName of existingMeterFolders) {
                if (!currentMeterNames.has(folderName)) {
                    this.adapter.log.info(`Removing deleted meter: ${type}.${folderName}`);
                    await this.adapter.delObjectAsync(`${type}.${folderName}`, { recursive: true });
                }
            }
        } catch (error) {
            this.adapter.log.warn(`Could not cleanup removed meters for ${type}: ${error.message}`);
        }
    }
}

module.exports = MultiMeterManager;
