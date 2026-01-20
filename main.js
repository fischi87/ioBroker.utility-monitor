'use strict';

/*
 * ioBroker Utility Monitor Adapter
 * Monitors gas, water, and electricity consumption with cost calculation
 */

const utils = require('@iobroker/adapter-core');
const ConsumptionManager = require('./lib/consumptionManager');
const BillingManager = require('./lib/billingManager');
const MessagingHandler = require('./lib/messagingHandler');
const MultiMeterManager = require('./lib/multiMeterManager');

class UtilityMonitor extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    constructor(options) {
        super({
            ...options,
            name: 'utility-monitor',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('message', this.onMessage.bind(this));

        // Initialize Managers
        this.consumptionManager = new ConsumptionManager(this);
        this.billingManager = new BillingManager(this);
        this.messagingHandler = new MessagingHandler(this);
        this.multiMeterManager = null; // Initialized in onReady after other managers

        this.periodicTimers = {};
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.log.info('Nebenkosten-Monitor starting...');

        // Initialize MultiMeterManager
        this.multiMeterManager = new MultiMeterManager(this, this.consumptionManager, this.billingManager);

        // Initialize each utility type based on configuration
        // Note: initializeUtility() internally calls multiMeterManager.initializeType()
        await this.initializeUtility('gas', this.config.gasAktiv);
        await this.initializeUtility('water', this.config.wasserAktiv);
        await this.initializeUtility('electricity', this.config.stromAktiv);
        await this.initializeUtility('pv', this.config.pvAktiv);

        // Initialize General Info States
        await this.setObjectNotExistsAsync('info', {
            type: 'channel',
            common: { name: 'General Information' },
            native: {},
        });
        await this.setObjectNotExistsAsync('info.lastMonthlyReport', {
            type: 'state',
            common: {
                name: 'Last Monthly Report Sent Date',
                type: 'string', // Storing ISO date string 'YYYY-MM-DD'
                role: 'date',
                read: true,
                write: true,
                def: '',
            },
            native: {},
        });

        // Subscribe to billing period closure triggers
        this.subscribeStates('*.billing.closePeriod');

        // Subscribe to manual adjustment changes
        this.subscribeStates('*.adjustment.value');
        this.subscribeStates('*.adjustment.note');

        // Set up periodic tasks
        this.setupPeriodicTasks();

        this.log.info('Nebenkosten-Monitor initialized successfully');
    }

    // --- Delegation Methods (backward compatibility for internal calls) ---

    async initializeUtility(type, isActive) {
        return this.consumptionManager.initializeUtility(type, isActive);
    }

    async handleSensorUpdate(type, sensorDP, value) {
        return this.consumptionManager.handleSensorUpdate(type, sensorDP, value);
    }

    async updateCurrentPrice(type) {
        return this.consumptionManager.updateCurrentPrice(type);
    }

    async updateCosts(type) {
        // For Multi-Meter setups, delegate to multiMeterManager
        if (this.multiMeterManager) {
            const meters = this.multiMeterManager.getMetersForType(type);
            if (meters.length > 0) {
                // Update costs for each meter
                for (const meter of meters) {
                    await this.multiMeterManager.updateCosts(type, meter.name, meter.config);
                }
                // Update totals if multiple meters exist
                if (meters.length > 1) {
                    await this.multiMeterManager.updateTotalCosts(type);
                }
                return;
            }
        }
        // Fallback to legacy billingManager for single-meter setups (backward compatibility)
        return this.billingManager.updateCosts(type);
    }

    async closeBillingPeriod(type) {
        return this.billingManager.closeBillingPeriod(type);
    }

    async updateBillingCountdown(type) {
        return this.billingManager.updateBillingCountdown(type);
    }

    async resetDailyCounters(type) {
        return this.billingManager.resetDailyCounters(type);
    }

    async resetMonthlyCounters(type) {
        return this.billingManager.resetMonthlyCounters(type);
    }

    async resetYearlyCounters(type) {
        return this.billingManager.resetYearlyCounters(type);
    }

    async checkPeriodResets() {
        return this.billingManager.checkPeriodResets();
    }

    async checkNotifications() {
        return this.messagingHandler.checkNotifications();
    }

    /**
     * Sets up periodic tasks (daily reset, etc.)
     */
    setupPeriodicTasks() {
        // Check every minute for period changes
        this.periodicTimers.checkPeriods = setInterval(async () => {
            await this.checkPeriodResets();
        }, 60000); // Every minute

        // Initial check
        this.checkPeriodResets();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param {() => void} callback - Callback function
     */
    onUnload(callback) {
        try {
            this.log.info('Nebenkosten-Monitor shutting down...');

            // Clear all timers
            Object.values(this.periodicTimers).forEach(timer => {
                if (timer) {
                    clearInterval(timer);
                }
            });

            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${error.message}`);
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param {string} id - State ID
     * @param {ioBroker.State | null | undefined} state - State object
     */
    async onStateChange(id, state) {
        if (!state || state.val === null || state.val === undefined) {
            return;
        }

        // Check if this is a closePeriod button press
        if (id.includes('.billing.closePeriod') && state.val === true && !state.ack) {
            const parts = id.split('.');

            // Parse state ID: nebenkosten-monitor.0.gas.meterName.billing.closePeriod
            // Remove adapter prefix: gas.meterName.billing.closePeriod
            const statePathParts = parts.slice(2); // Remove "nebenkosten-monitor" and "0"

            // All meters now use: gas.meterName.billing.closePeriod (length === 4)
            if (statePathParts.length === 4) {
                const type = statePathParts[0];
                const meterName = statePathParts[1];

                this.log.info(`User triggered billing period closure for ${type}.${meterName}`);

                // Find the meter object from multiMeterManager
                const meters = this.multiMeterManager?.getMetersForType(type) || [];
                const meter = meters.find(m => m.name === meterName);

                if (meter) {
                    await this.billingManager.closeBillingPeriodForMeter(type, meter);
                } else {
                    this.log.error(`Meter "${meterName}" not found for type ${type}!`);
                    await this.setStateAsync(`${type}.${meterName}.billing.closePeriod`, false, true);
                }
            } else {
                // Invalid path format
                this.log.warn(`Invalid billing period closure trigger: ${id}`);
            }
            return;
        }

        // Check if this is an adjustment value change
        // New structure: gas.meterName.adjustment.value (4 parts after namespace)
        if (id.includes('.adjustment.value') && !state.ack) {
            const parts = id.split('.');
            // Parse: nebenkosten-monitor.0.gas.meterName.adjustment.value
            const statePathParts = parts.slice(2); // Remove "nebenkosten-monitor" and "0"

            if (statePathParts.length === 3) {
                // New structure: gas.meterName.adjustment.value
                const type = statePathParts[0];
                const meterName = statePathParts[1];

                this.log.info(`Adjustment value changed for ${type}.${meterName}: ${state.val}`);
                await this.setStateAsync(`${type}.${meterName}.adjustment.applied`, Date.now(), true);

                // Update costs for THIS specific meter
                if (this.multiMeterManager) {
                    const meters = this.multiMeterManager.getMetersForType(type);
                    const meter = meters.find(m => m.name === meterName);
                    if (meter) {
                        await this.multiMeterManager.updateCosts(type, meterName, meter.config);
                    }
                }
                return;
            }
        }

        // Determine which utility this sensor belongs to
        // All meters (including main) are now handled by multiMeterManager
        if (this.multiMeterManager) {
            const meterInfo = this.multiMeterManager.findMeterBySensor(id);
            if (meterInfo && typeof state.val === 'number') {
                await this.multiMeterManager.handleSensorUpdate(meterInfo.type, meterInfo.meterName, id, state.val);
                return;
            }
        }
    }

    /**
     * Is called when adapter receives message from config window.
     *
     * @param {Record<string, any>} obj - Message object from config
     */
    async onMessage(obj) {
        await this.messagingHandler.handleMessage(obj);
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    module.exports = options => new UtilityMonitor(options);
} else {
    // otherwise start the instance directly
    new UtilityMonitor();
}
