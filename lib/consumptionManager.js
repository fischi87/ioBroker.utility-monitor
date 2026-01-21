'use strict';

const calculator = require('./calculator');
const stateManager = require('./stateManager');

/**
 * ConsumptionManager handles all sensor-related logic,
 * including initialization, unit conversion, and sensor updates.
 */
class ConsumptionManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
        this.lastSensorValues = {};
    }

    /**
     * Maps internal utility type to config/state name
     *
     * @param {string} type - gas, water, or electricity
     * @returns {string} - gas, wasser, or strom
     */
    getConfigType(type) {
        const mapping = {
            electricity: 'strom',
            water: 'wasser',
            gas: 'gas',
        };
        return mapping[type] || type;
    }

    /**
     * Initializes a utility type (gas, water, or electricity)
     *
     * @param {string} type - Utility type
     * @param {boolean} isActive - Whether this utility is active
     */
    async initializeUtility(type, isActive) {
        if (!isActive) {
            this.adapter.log.debug(`${type} monitoring is disabled`);
            // Clean up states if utility was disabled
            await stateManager.deleteUtilityStateStructure(this.adapter, type);
            return;
        }

        this.adapter.log.info(`Initializing ${type} monitoring...`);

        // State structure is now created by MultiMeterManager per meter (v1.4.6)
        // Old createUtilityStateStructure removed - states are created under type.meterName.*

        const configType = this.getConfigType(type);
        const sensorDPKey = `${configType}SensorDP`;
        const sensorDP = this.adapter.config[sensorDPKey];

        if (!sensorDP) {
            this.adapter.log.warn(`${type} is active but no sensor datapoint configured!`);
            // Note: sensorActive state is now created per meter by MultiMeterManager
            return;
        }

        this.adapter.log.debug(`Using sensor datapoint for ${type}: ${sensorDP}`);

        // Log configured contract start for user verification
        const contractStartKey = `${configType}ContractStart`;
        const contractStartDateStr = this.adapter.config[contractStartKey];
        if (contractStartDateStr) {
            this.adapter.log.info(`${type}: Managed with contract start: ${contractStartDateStr}`);
        }

        // Sensor subscription is now handled by MultiMeterManager per meter
        this.adapter.log.debug(`${type} sensor will be subscribed by MultiMeterManager: ${sensorDP}`);

        // Initialize all meters (main + additional) via MultiMeterManager
        // This handles everything now: state creation, sensor subscription, costs calculation
        if (this.adapter.multiMeterManager) {
            await this.adapter.multiMeterManager.initializeType(type);
        }

        // Note: All initialization moved to MultiMeterManager in v1.4.6:
        // - Sensor value restoration (per meter)
        // - Period start timestamps (per meter)
        // - Current price updates (per meter)
        // - Cost calculations (per meter)
        // Old type-level states (gas.info.*, gas.statistics.*) are no longer used

        // Initialize yearly consumption from initial reading if set
        // NOTE: This is now handled per meter by MultiMeterManager in v1.4.6
        // This legacy code path should not execute for new setups, but is kept for safety
        const initialReadingKey = `${configType}InitialReading`;
        const initialReading = this.adapter.config[initialReadingKey] || 0;

        if (initialReading > 0 && sensorDP) {
            // Get the main meter name to use the correct path
            const mainMeterNameKey = `${configType}MainMeterName`;
            const mainMeterName = this.adapter.config[mainMeterNameKey] || 'main';
            const basePath = `${type}.${mainMeterName}`;

            const sensorState = await this.adapter.getForeignStateAsync(sensorDP);
            if (sensorState && sensorState.val != null) {
                // Convert to number (handles strings, German commas, etc.)
                let currentRaw = calculator.ensureNumber(sensorState.val);

                // Apply offset if configured (in original unit)
                const offsetKey = `${configType}Offset`;
                const offset = this.adapter.config[offsetKey] || 0;
                if (offset !== 0) {
                    currentRaw = currentRaw - offset;
                    this.adapter.log.debug(`Applied offset for ${type}: -${offset}, new value: ${currentRaw}`);
                }
                let yearlyConsumption = Math.max(0, currentRaw - initialReading);

                // For gas: convert m³ to kWh AFTER calculating the difference
                if (type === 'gas') {
                    const brennwert = this.adapter.config.gasBrennwert || 11.5;
                    const zZahl = this.adapter.config.gasZahl || 0.95;
                    const yearlyVolume = yearlyConsumption;
                    yearlyConsumption = calculator.convertGasM3ToKWh(yearlyConsumption, brennwert, zZahl);
                    await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, yearlyVolume, true);
                    this.adapter.log.info(
                        `Init yearly ${type}: ${yearlyConsumption.toFixed(2)} kWh = ${(currentRaw - initialReading).toFixed(2)} m³ (current: ${currentRaw.toFixed(2)} m³, initial: ${initialReading} m³)`,
                    );
                } else {
                    this.adapter.log.info(
                        `Init yearly ${type}: ${yearlyConsumption.toFixed(2)} (current: ${currentRaw.toFixed(2)}, initial: ${initialReading})`,
                    );
                }

                await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, yearlyConsumption, true);
                if (typeof this.adapter.updateCosts === 'function') {
                    await this.adapter.updateCosts(type);
                }
            }
        }

        // Note: Billing countdown is now handled per meter by billingManager.updateBillingCountdown()
        // which is called during checkPeriodResets()

        this.adapter.log.debug(`Initial cost calculation completed for ${type}`);
    }

    /**
     * Handles sensor value updates
     *
     * NOTE: This method is DEPRECATED since v1.4.6!
     * All sensor updates are now handled by MultiMeterManager.handleSensorUpdate()
     * This method remains only as fallback but should NEVER be called in normal operation.
     *
     * @param {string} type - Utility type
     * @param {string} sensorDP - Sensor datapoint ID
     * @param {number} value - New sensor value
     */
    async handleSensorUpdate(type, sensorDP, value) {
        this.adapter.log.warn(
            `consumptionManager.handleSensorUpdate() called - this is deprecated! All sensors should be handled by MultiMeterManager.`,
        );

        if (typeof value !== 'number' || value < 0) {
            this.adapter.log.warn(`Invalid sensor value for ${type}: ${value}`);
            return;
        }

        this.adapter.log.debug(`[DEPRECATED] Sensor update for ${type}: ${value}`);

        const now = Date.now();
        let consumption = value;
        let consumptionM3 = null;

        const configType = this.getConfigType(type);

        // Apply offset FIRST
        const offsetKey = `${configType}Offset`;
        const offset = this.adapter.config[offsetKey] || 0;
        if (offset !== 0) {
            consumption = consumption - offset;
            this.adapter.log.debug(`Applied offset for ${type}: -${offset}, new value: ${consumption}`);
        }

        // For gas, convert m³ to kWh
        if (type === 'gas') {
            const brennwert = this.adapter.config.gasBrennwert || 11.5;
            const zZahl = this.adapter.config.gasZahl || 0.95;
            consumptionM3 = consumption;
            await this.adapter.setStateAsync(`${type}.info.meterReadingVolume`, consumption, true);
            consumption = calculator.convertGasM3ToKWh(consumption, brennwert, zZahl);
            consumption = calculator.roundToDecimals(consumption, 2);
        }

        // Update meter reading
        await this.adapter.setStateAsync(`${type}.info.meterReading`, consumption, true);

        // Calculate deltas
        const lastValue = this.lastSensorValues[sensorDP];
        this.lastSensorValues[sensorDP] = consumption;

        if (lastValue === undefined || consumption < lastValue) {
            if (lastValue !== undefined && consumption < lastValue) {
                this.adapter.log.warn(
                    `${type}: Sensor value decreased (${lastValue} -> ${consumption}). Assuming meter reset or replacement.`,
                );
            }
            if (typeof this.adapter.updateCosts === 'function') {
                await this.adapter.updateCosts(type);
            }
            return;
        }

        const delta = consumption - lastValue;
        this.adapter.log.debug(`${type} delta: ${delta}`);

        // Track volume for gas
        if (type === 'gas') {
            const brennwert = this.adapter.config.gasBrennwert || 11.5;
            const zZahl = this.adapter.config.gasZahl || 0.95;
            const deltaVolume = delta / (brennwert * zZahl);

            const dailyVolume = await this.adapter.getStateAsync(`${type}.consumption.dailyVolume`);
            const monthlyVolume = await this.adapter.getStateAsync(`${type}.consumption.monthlyVolume`);
            const yearlyVolume = await this.adapter.getStateAsync(`${type}.consumption.yearlyVolume`);

            await this.adapter.setStateAsync(
                `${type}.consumption.dailyVolume`,
                calculator.roundToDecimals((dailyVolume?.val || 0) + deltaVolume, 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${type}.consumption.monthlyVolume`,
                calculator.roundToDecimals((monthlyVolume?.val || 0) + deltaVolume, 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${type}.consumption.yearlyVolume`,
                calculator.roundToDecimals((yearlyVolume?.val || 0) + deltaVolume, 3),
                true,
            );
        }

        // Update consumption values
        const dailyState = await this.adapter.getStateAsync(`${type}.consumption.daily`);
        await this.adapter.setStateAsync(
            `${type}.consumption.daily`,
            calculator.roundToDecimals((dailyState?.val || 0) + delta, 2),
            true,
        );

        const monthlyState = await this.adapter.getStateAsync(`${type}.consumption.monthly`);
        await this.adapter.setStateAsync(
            `${type}.consumption.monthly`,
            calculator.roundToDecimals((monthlyState?.val || 0) + delta, 2),
            true,
        );

        // HT/NT tracking
        const htNtEnabledKey = `${configType}HtNtEnabled`;
        if (this.adapter.config[htNtEnabledKey]) {
            const isHT = calculator.isHTTime(this.adapter.config, configType);
            const suffix = isHT ? 'HT' : 'NT';

            const dHTNT = await this.adapter.getStateAsync(`${type}.consumption.daily${suffix}`);
            await this.adapter.setStateAsync(
                `${type}.consumption.daily${suffix}`,
                calculator.roundToDecimals((dHTNT?.val || 0) + delta, 2),
                true,
            );

            const mHTNT = await this.adapter.getStateAsync(`${type}.consumption.monthly${suffix}`);
            await this.adapter.setStateAsync(
                `${type}.consumption.monthly${suffix}`,
                calculator.roundToDecimals((mHTNT?.val || 0) + delta, 2),
                true,
            );

            const yHTNT = await this.adapter.getStateAsync(`${type}.consumption.yearly${suffix}`);
            await this.adapter.setStateAsync(
                `${type}.consumption.yearly${suffix}`,
                calculator.roundToDecimals((yHTNT?.val || 0) + delta, 2),
                true,
            );
        }

        // Yearly consumption
        const initialReadingKey = `${configType}InitialReading`;
        const initialReading = this.adapter.config[initialReadingKey] || 0;

        if (initialReading > 0) {
            let yearlyAmount;
            if (type === 'gas') {
                const yearlyM3 = Math.max(0, (consumptionM3 || 0) - initialReading);
                await this.adapter.setStateAsync(
                    `${type}.consumption.yearlyVolume`,
                    calculator.roundToDecimals(yearlyM3, 2),
                    true,
                );
                const brennwert = this.adapter.config.gasBrennwert || 11.5;
                const zZahl = this.adapter.config.gasZahl || 0.95;
                yearlyAmount = calculator.convertGasM3ToKWh(yearlyM3, brennwert, zZahl);
            } else {
                yearlyAmount = Math.max(0, consumption - initialReading);
            }
            await this.adapter.setStateAsync(
                `${type}.consumption.yearly`,
                calculator.roundToDecimals(yearlyAmount, 2),
                true,
            );
        } else {
            const yState = await this.adapter.getStateAsync(`${type}.consumption.yearly`);
            await this.adapter.setStateAsync(
                `${type}.consumption.yearly`,
                calculator.roundToDecimals((yState?.val || 0) + delta, 2),
                true,
            );
        }

        if (typeof this.adapter.updateCosts === 'function') {
            await this.adapter.updateCosts(type);
        }

        await this.adapter.setStateAsync(`${type}.consumption.lastUpdate`, now, true);
        await this.adapter.setStateAsync(`${type}.info.lastSync`, now, true);
    }

    /**
     * Updates the current price display for all meters of a type
     * NOTE: Since v1.4.6, this updates ALL meters (main + additional)
     * Only main meters support HT/NT, additional meters have fixed price
     *
     * @param {string} type - Utility type
     */
    async updateCurrentPrice(type) {
        const configType = this.getConfigType(type);

        // Get all meters for this type
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        for (const meter of meters) {
            let tariffName = 'Standard';
            let activePrice = 0;

            // Check if this meter has HT/NT enabled
            const htNtEnabled = meter.config?.htNtEnabled || false;

            if (htNtEnabled) {
                const isHT = calculator.isHTTime(this.adapter.config, configType);
                if (isHT) {
                    activePrice = this.adapter.config[`${configType}HtPrice`] || 0;
                    tariffName = 'Haupttarif (HT)';
                } else {
                    activePrice = this.adapter.config[`${configType}NtPrice`] || 0;
                    tariffName = 'Nebentarif (NT)';
                }
            } else {
                // Use meter's configured price
                activePrice = meter.config?.preis || 0;
            }

            const basePath = `${type}.${meter.name}`;
            await this.adapter.setStateAsync(
                `${basePath}.info.currentPrice`,
                calculator.roundToDecimals(activePrice, 4),
                true,
            );
            await this.adapter.setStateAsync(`${basePath}.info.currentTariff`, tariffName, true);
        }
    }
}

module.exports = ConsumptionManager;
