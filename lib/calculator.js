const helpers = require('./utils/helpers');

/**
 * Converts gas volume from m³ to kWh
 * Formula: kWh = m³ × Brennwert × Z-Zahl
 *
 * @param {number} m3 - Volume in cubic meters
 * @param {number} brennwert - Calorific value (typically ~11.5 kWh/m³)
 * @param {number} zZahl - Z-number/state number (typically ~0.95)
 * @returns {number} Energy in kWh
 */
function convertGasM3ToKWh(m3, brennwert = 11.5, zZahl = 0.95) {
    // Hier number zu string
    const cleanM3 = helpers.ensureNumber(m3);
    const cleanBrennwert = helpers.ensureNumber(brennwert);
    const cleanZZahl = helpers.ensureNumber(zZahl);

    // Validierung der Logik (jetzt mit den konvertierten Zahlen)
    if (cleanM3 < 0 || cleanBrennwert <= 0 || cleanZZahl <= 0 || cleanZZahl > 1) {
        throw new RangeError('Ungültige Parameterwerte für die Gas-Umrechnung');
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
 * Checks if the current time is within the High Tariff (HT) period
 *
 * @param {object} config - Adapter configuration
 * @param {string} type - Utility type: 'gas' or 'strom'
 * @returns {boolean} True if current time is HT, false if NT
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
