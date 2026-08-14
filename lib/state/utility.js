'use strict';

/**
 * Deletes all states for a utility type
 *
 * @param {object} adapter - The adapter instance
 * @param {string} type - Utility type: 'gas', 'water', or 'electricity'
 * @returns {Promise<void>}
 */
async function deleteUtilityStateStructure(adapter, type) {
    try {
        await adapter.delObjectAsync(type, { recursive: true });
        adapter.log.debug(`State structure deleted for ${type}`);
    } catch (error) {
        adapter.log.warn(`Could not delete state structure for ${type}: ${error.message}`);
    }
}

module.exports = {
    deleteUtilityStateStructure,
};
