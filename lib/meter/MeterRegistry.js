'use strict';

/**
 * MeterRegistry manages the mapping between sensor data points and meters.
 * Each sensor can be associated with one or more meters of different types.
 */
class MeterRegistry {
    /**
     * Initializes the registry
     */
    constructor() {
        // Maps sensorDP to array of {type, meterName}
        this.registry = {};
    }

    /**
     * Registers a sensor with a meter
     *
     * @param {string} sensorDP - Sensor data point ID
     * @param {string} type - Utility type (gas, water, electricity, pv)
     * @param {string} meterName - Name of the meter
     */
    register(sensorDP, type, meterName) {
        if (!sensorDP) {
            return;
        }

        if (!this.registry[sensorDP]) {
            this.registry[sensorDP] = [];
        }

        // Check if already registered
        const exists = this.registry[sensorDP].some(entry => entry.type === type && entry.meterName === meterName);

        if (!exists) {
            this.registry[sensorDP].push({ type, meterName });
        }
    }

    /**
     * Finds all meters associated with a sensor
     *
     * @param {string} sensorDP - Sensor data point ID
     * @returns {Array<{type: string, meterName: string}>} Array of meter entries
     */
    findBySensor(sensorDP) {
        return this.registry[sensorDP] || [];
    }

    /**
     * Removes a meter from a sensor
     *
     * @param {string} sensorDP - Sensor data point ID
     * @param {string} type - Utility type
     * @param {string} meterName - Name of the meter
     */
    unregister(sensorDP, type, meterName) {
        if (!this.registry[sensorDP]) {
            return;
        }

        this.registry[sensorDP] = this.registry[sensorDP].filter(
            entry => !(entry.type === type && entry.meterName === meterName),
        );

        // Clean up empty entries
        if (this.registry[sensorDP].length === 0) {
            delete this.registry[sensorDP];
        }
    }

    /**
     * Clears all registrations for a sensor
     *
     * @param {string} sensorDP - Sensor data point ID
     */
    clearSensor(sensorDP) {
        delete this.registry[sensorDP];
    }

    /**
     * Gets all registered sensors
     *
     * @returns {string[]} Array of sensor data point IDs
     */
    getAllSensors() {
        return Object.keys(this.registry);
    }

    /**
     * Gets the complete registry
     *
     * @returns {object} The registry object
     */
    getRegistry() {
        return this.registry;
    }

    /**
     * Checks if a sensor is registered
     *
     * @param {string} sensorDP - Sensor data point ID
     * @returns {boolean} True if sensor is registered
     */
    hasSensor(sensorDP) {
        return !!this.registry[sensorDP];
    }
}

module.exports = MeterRegistry;
