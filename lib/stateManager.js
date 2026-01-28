'use strict';

/**
 * Manages the creation and structure of all adapter states
 * This file acts as a facade for the modularized state structures in ./state/
 */

const STATE_ROLES = require('./state/roles');
const { createUtilityStateStructure, deleteUtilityStateStructure } = require('./state/utility');
const createMeterStructure = require('./state/meter');
const createTotalsStructure = require('./state/totals');
const createHistoryStructure = require('./state/history');

module.exports = {
    createUtilityStateStructure,
    createMeterStructure,
    createTotalsStructure,
    createHistoryStructure,
    deleteUtilityStateStructure,
    STATE_ROLES,
};
