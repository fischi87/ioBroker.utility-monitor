'use strict';

/**
 * State role definitions for different state types
 */
const STATE_ROLES = {
    consumption: 'value.power.consumption',
    cost: 'value.money',
    meterReading: 'value',
    price: 'value.price',
    timestamp: 'value.time',
    indicator: 'indicator',
    value: 'value',
};

module.exports = STATE_ROLES;
