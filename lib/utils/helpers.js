'use strict';

/**
 * Helper utilities for iobroker.utility-monitor
 */

/**
 * Ensures a value is a number, handling German decimal commas if provided as string.
 *
 * @param {any} value - Value to convert
 * @returns {number} The numeric value
 */
function ensureNumber(value) {
    if (value === undefined || value === null || value === '') {
        return 0;
    }
    if (typeof value === 'number') {
        return isNaN(value) ? 0 : value;
    }
    if (typeof value === 'string') {
        let normalized = value.trim();
        // Handle common European formats: 1.234,56 -> 1234.56 or 1234,56 -> 1234.56
        if (normalized.includes(',') && normalized.includes('.')) {
            // Assume . is thousands and , is decimal
            normalized = normalized.replace(/\./g, '').replace(',', '.');
        } else if (normalized.includes(',')) {
            // Assume , is decimal
            normalized = normalized.replace(',', '.');
        }
        const parsed = parseFloat(normalized);
        return isNaN(parsed) ? 0 : parsed;
    }
    const num = Number(value);
    return isNaN(num) ? 0 : num;
}

/**
 * Rounds a number to specified decimal places
 *
 * @param {number|string} value - Value to round
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {number} Rounded value
 */
function roundToDecimals(value, decimals = 2) {
    const numValue = ensureNumber(value);
    const factor = Math.pow(10, decimals);
    return Math.round(numValue * factor) / factor;
}

/**
 * Parses a German date string (DD.MM.YYYY) into a Date object
 *
 * @param {string} dateStr - Date string in format DD.MM.YYYY
 * @returns {Date|null} Date object or null if invalid
 */
function parseGermanDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return null;
    }

    const trimmed = dateStr.trim();

    // 1. Try German format (DD.MM.YYYY)
    if (trimmed.includes('.') && !trimmed.includes('-')) {
        const parts = trimmed.split('.');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            let year = parseInt(parts[2], 10);

            if (year < 70) {
                year += 2000;
            } else if (year < 100) {
                year += 1900;
            }

            if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                return new Date(year, month, day, 12, 0, 0);
            }
        }
    }

    // 2. Try ISO or other standard formats
    const fallback = new Date(trimmed);
    if (!isNaN(fallback.getTime())) {
        return fallback;
    }

    return null;
}

/**
 * Formats a Date object to YYYY-MM-DD HH:mm:ss string
 *
 * @param {Date} date - Date object
 * @returns {string|null} Formatted date string or null
 */
function formatDateString(date) {
    if (!date || !(date instanceof Date)) {
        return null;
    }

    const pad = num => num.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Formats a Date as YYYY-MM-DD in local time.
 *
 * Deliberately not using toISOString(), which converts to UTC and therefore
 * returns the previous day for local times before the UTC offset (e.g. 00:00
 * CEST is 22:00 UTC on the day before).
 *
 * @param {Date} date - Date to format
 * @returns {string} Date as YYYY-MM-DD in local time
 */
function formatLocalDate(date) {
    const pad = num => num.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Checks if a year is a leap year
 *
 * @param {number} year - Year to check
 * @returns {boolean} True if leap year
 */
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Calculates the difference in months between two dates
 *
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {number} Difference in months
 */
function getMonthsDifference(startDate, endDate) {
    if (!startDate || !endDate) {
        return 0;
    }
    return (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
}

/**
 * Returns the contract anniversary within a given year.
 * Clamps the day to the last day of the month so a 29.02. contract
 * does not roll over into March in non-leap years.
 *
 * @param {Date} startDate - Contract start date
 * @param {number} year - Year to place the anniversary in
 * @returns {Date} Anniversary date at 12:00 local time
 */
function getAnniversaryInYear(startDate, year) {
    const month = startDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(startDate.getDate(), daysInMonth), 12, 0, 0);
}

/**
 * Calculates the billing countdown for a rolling annual contract.
 *
 * The contract renews itself every year on its anniversary, so the current
 * period always ends the day before the next anniversary. On the anniversary
 * itself a new period starts, which is why the countdown rolls forward to the
 * following year on that day.
 *
 * All dates are normalized to 12:00 local time so that daylight saving
 * transitions cannot shift the result by a day.
 *
 * @param {string|Date} contractStart - Contract start (German date string or Date)
 * @param {Date} [now] - Reference date, defaults to the current time
 * @returns {{daysRemaining: number, periodEnd: Date, nextAnniversary: Date}|null} Countdown info or null if the start date is invalid
 */
function calculateBillingCountdown(contractStart, now = new Date()) {
    const startDate = contractStart instanceof Date ? contractStart : parseGermanDate(contractStart);
    if (!startDate || isNaN(startDate.getTime())) {
        return null;
    }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);

    let nextAnniversary;
    if (startDate > today) {
        // Contract has not started yet: the first period ends before the first anniversary
        nextAnniversary = getAnniversaryInYear(startDate, startDate.getFullYear() + 1);
    } else {
        nextAnniversary = getAnniversaryInYear(startDate, today.getFullYear());
        if (nextAnniversary <= today) {
            // Anniversary already reached this year: a new period has begun
            nextAnniversary = getAnniversaryInYear(startDate, today.getFullYear() + 1);
        }
    }

    const periodEnd = new Date(nextAnniversary);
    periodEnd.setDate(periodEnd.getDate() - 1);

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRemaining = Math.round((nextAnniversary.getTime() - today.getTime()) / msPerDay);

    return { daysRemaining, periodEnd, nextAnniversary };
}

/**
 * Normalizes a meter name to a valid ioBroker ID part
 *
 * @param {string} name - The name to normalize
 * @returns {string} The normalized name
 */
function normalizeMeterName(name) {
    if (!name) {
        return 'unknown';
    }

    return name
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 32);
}

/**
 * Safe wrapper for setObjectNotExistsAsync with error handling
 *
 * @param {object} adapter - Adapter instance
 * @param {string} id - State ID
 * @param {object} obj - Object definition
 */
async function safeSetObjectNotExists(adapter, id, obj) {
    try {
        await adapter.setObjectNotExistsAsync(id, obj);
    } catch (e) {
        adapter.log.error(`Error creating object ${id}: ${e.message}`);
    }
}

/**
 * Safe execution wrapper for async operations with error handling.
 * Catches errors and logs them without crashing the adapter.
 *
 * @param {object} adapter - Adapter instance
 * @param {Function} fn - Async function to execute
 * @param {string} context - Context description for error logging
 * @param {any} fallback - Fallback value to return on error
 * @returns {Promise<any>} Result of fn() or fallback on error
 */
async function safeExecute(adapter, fn, context, fallback = null) {
    try {
        return await fn();
    } catch (error) {
        if (adapter && adapter.log) {
            adapter.log.error(`[${context}] ${error.message}`);
        }
        return fallback;
    }
}

/**
 * Debounce function to limit execution frequency
 *
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Validates that a value is within a specified range
 *
 * @param {number} value - Value to validate
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {number} [defaultValue] - Default value if out of range
 * @returns {number} Validated value or default
 */
function validateRange(value, min, max, defaultValue = min) {
    const num = ensureNumber(value);
    if (num < min || num > max) {
        return defaultValue;
    }
    return num;
}

module.exports = {
    ensureNumber,
    roundToDecimals,
    parseGermanDate,
    formatDateString,
    formatLocalDate,
    isLeapYear,
    getMonthsDifference,
    getAnniversaryInYear,
    calculateBillingCountdown,
    normalizeMeterName,
    safeSetObjectNotExists,
    safeExecute,
    debounce,
    validateRange,
};
