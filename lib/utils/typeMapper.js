'use strict';

/**
 * Maps internal utility type to config/state name
 *
 * @param {string} type - gas, water, electricity, pv
 * @returns {string} - gas, wasser, strom, pv
 */
function getConfigType(type) {
    const mapping = {
        electricity: 'strom',
        water: 'wasser',
        gas: 'gas',
        pv: 'pv',
    };
    return mapping[type] || type;
}

module.exports = { getConfigType };
