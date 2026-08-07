'use strict';

/**
 * State role definitions for different state types
 */
const STATE_ROLES = {
    consumption: 'value.power.consumption',
    // 'value.money' / 'value.price' are not part of the ioBroker role catalogue
    // enforced by the repository checker, so read-only monetary states use the
    // generic read-only number role 'value'.
    cost: 'value',
    meterReading: 'value',
    price: 'value',
    timestamp: 'value.time',
    indicator: 'indicator',
    value: 'value',
    // Writable numeric inputs (e.g. the meter reading a user enters). The role
    // 'value' is read-only in the catalogue, so writable states need 'level'.
    writable: 'level',
};

module.exports = STATE_ROLES;
