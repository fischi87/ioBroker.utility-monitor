'use strict';

const calculator = require('../calculator');

/**
 * Shared consumption logic for different managers
 */

/**
 * Calculates gas energy (kWh) and volume (m³)
 *
 * @param {number} value - Raw sensor value (m³)
 * @param {number} brennwert - Calorific value
 * @param {number} zZahl - Z-number
 * @returns {object} { energy, volume }
 */
function calculateGas(value, brennwert, zZahl) {
    const energy = calculator.convertGasM3ToKWh(value, brennwert, zZahl);
    return {
        energy: calculator.roundToDecimals(energy, 2),
        volume: calculator.roundToDecimals(value, 2),
    };
}

/**
 * Returns the suffix (HT/NT) based on current time
 *
 * @param {object} config - Adapter config
 * @param {string} type - Utility type (config name)
 * @returns {string} 'HT', 'NT' or empty if disabled
 */
function getHTNTSuffix(config, type) {
    if (!config || !type) {
        return '';
    }
    const enabled = config[`${type}HtNtEnabled`];
    if (!enabled) {
        return '';
    }

    return calculator.isHTTime(config, type) ? 'HT' : 'NT';
}

module.exports = {
    calculateGas,
    getHTNTSuffix,
};
