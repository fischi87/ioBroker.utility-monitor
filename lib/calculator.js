const helpers = require('./utils/helpers');

/**
 * @file Calculator module for utility consumption and cost calculations.
 * Contains functions for gas conversion, cost calculation, and tariff handling.
 * @module calculator
 */

/**
 * Converts gas volume from cubic meters (m³) to kilowatt-hours (kWh).
 * The conversion uses the standard German gas billing formula:
 * kWh = m³ × Brennwert (calorific value) × Z-Zahl (state number)
 * Brennwert: Energy content per cubic meter, typically 9.5-11.5 kWh/m³.
 * Z-Zahl: Correction factor for temperature and pressure differences.
 *
 * @param {number} m3 - Gas volume in cubic meters (must be >= 0)
 * @param {number} brennwert - Calorific value in kWh/m³ (must be > 0)
 * @param {number} zZahl - State number (must be > 0 and <= 1)
 * @returns {number} Energy consumption in kWh
 * @throws {RangeError} If parameters are outside valid ranges
 */
function convertGasM3ToKWh(m3, brennwert = 11.5, zZahl = 0.95) {
    const cleanM3 = helpers.ensureNumber(m3);
    const cleanBrennwert = helpers.ensureNumber(brennwert);
    const cleanZZahl = helpers.ensureNumber(zZahl);

    // Validate parameters
    if (cleanM3 < 0 || cleanBrennwert <= 0 || cleanZZahl <= 0 || cleanZZahl > 1) {
        throw new RangeError(
            'Invalid parameters for gas conversion: m3 must be >= 0, brennwert must be > 0, zZahl must be > 0 and <= 1',
        );
    }

    return cleanM3 * cleanBrennwert * cleanZZahl;
}

/**
 * Gets the current price - simplified version
 *
 * @param {number} price - Current price per unit
 * @param {number} basicCharge - Basic charge per month
 * @returns {object} Price object {price, basicCharge}
 */
function getCurrentPrice(price, basicCharge = 0) {
    return {
        price: price || 0,
        basicCharge: basicCharge || 0,
    };
}

/**
 * Calculates cost for a consumption value using current price
 *
 * @param {number} consumption - Consumption in kWh or m³
 * @param {number} price - Current price per unit
 * @returns {number} Cost in €
 */
function calculateCost(consumption, price) {
    if (typeof consumption !== 'number' || consumption < 0) {
        throw new TypeError('Consumption must be a non-negative number');
    }

    return consumption * (price || 0);
}

/**
 * Checks if the current time falls within the High Tariff (HT) period.
 * German electricity providers often offer dual-tariff rates:
 * HT (Haupttarif): Higher rate during peak hours (typically 6:00-22:00)
 * NT (Nebentarif): Lower rate during off-peak hours (typically 22:00-6:00)
 *
 * @param {object} config - Adapter configuration object with HT/NT settings
 * @param {string} type - Utility type identifier: 'gas', 'strom', 'wasser', or 'pv'
 * @returns {boolean} True if current time is within HT period, false for NT
 */
function isHTTime(config, type) {
    if (!config || !type) {
        return true;
    }

    const enabled = config[`${type}HtNtEnabled`];
    if (!enabled) {
        return true;
    }

    const startTimeStr = config[`${type}HtStart`];
    const endTimeStr = config[`${type}HtEnd`];

    if (!startTimeStr || !endTimeStr) {
        return true;
    }

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTimeMinutes = currentHours * 60 + currentMinutes;

    const [startH, startM] = startTimeStr.split(':').map(val => parseInt(val, 10));
    const [endH, endM] = endTimeStr.split(':').map(val => parseInt(val, 10));

    const startTimeMinutes = startH * 60 + (startM || 0);
    const endTimeMinutes = endH * 60 + (endM || 0);

    if (startTimeMinutes <= endTimeMinutes) {
        // HT period during the day (e.g. 06:00 - 22:00)
        return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;
    }

    // HT period over midnight (e.g. 22:00 - 06:00)
    return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes < endTimeMinutes;
}

/**
 * Default constants for the nebenkosten-monitor adapter
 */
const DEFAULTS = {
    // Gas conversion defaults
    GAS_BRENNWERT: 11.5, // kWh/m³
    GAS_Z_ZAHL: 0.95, // State number (dimensionless)

    // Rounding precision
    ROUNDING_DECIMALS: 2,

    // Time constants
    MILLISECONDS_PER_DAY: 1000 * 60 * 60 * 24,
    DAYS_IN_NORMAL_YEAR: 365,
    DAYS_IN_LEAP_YEAR: 366,

    // Validation constraints
    MIN_PRICE: 0,
    MAX_PRICE: 9999,
    MIN_CONSUMPTION: 0,
};

module.exports = {
    convertGasM3ToKWh,
    getCurrentPrice,
    calculateCost,
    isHTTime,
    DEFAULTS,
    // Re-export helpers for backward compatibility
    ensureNumber: helpers.ensureNumber,
    roundToDecimals: helpers.roundToDecimals,
    parseGermanDate: helpers.parseGermanDate,
    formatDateString: helpers.formatDateString,
    parseDateString: s => helpers.parseGermanDate(s),
    isLeapYear: helpers.isLeapYear,
    getMonthsDifference: helpers.getMonthsDifference,
};
