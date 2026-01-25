'use strict';

const calculator = require('./calculator');
const { getConfigType } = require('./utils/typeMapper');
const stateManager = require('./stateManager');

/**
 * ConsumptionManager handles utility initialization and price updates.
 * NOTE: Sensor handling has been moved to MultiMeterManager since v1.4.6.
 */
class ConsumptionManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
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

        const configType = getConfigType(type);
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
        // - State creation (per meter)
        // - Sensor value restoration (per meter)
        // - Period start timestamps (per meter)
        // - Initial yearly consumption calculation (per meter)
        // - Current price updates (per meter)
        // - Cost calculations (per meter)
        // - Billing countdown (per meter)
        // Old type-level states (gas.info.*, gas.statistics.*) are no longer used

        this.adapter.log.debug(`${type} initialization delegated to MultiMeterManager`);
    }

    /**
     * Updates the current price display for all meters of a type
     * NOTE: Since v1.4.6, this updates ALL meters (main + additional)
     * Only main meters support HT/NT, additional meters have fixed price
     *
     * @param {string} type - Utility type
     */
    async updateCurrentPrice(type) {
        const configType = getConfigType(type);

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
