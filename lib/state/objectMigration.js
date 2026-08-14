'use strict';

/**
 * One-time migrations for object definitions of already existing installations.
 *
 * setObjectNotExistsAsync() never touches an object that already exists, so
 * changes to roles or write flags only reach fresh installations. The functions
 * here bring existing objects in line with the current definitions.
 */

// Roles that are no longer used and their replacement (checker rule E1008:
// 'value.money' / 'value.price' are not part of the role catalogue).
const REPLACED_ROLES = {
    'value.money': 'value',
    'value.price': 'value',
};

// Writable inputs that used to have the read-only role 'value' and must use the
// writable role 'level' instead (checker rule E1011).
const WRITABLE_SUFFIXES = ['.billing.endReading', '.adjustment.value'];

/**
 * Updates roles and read flags of existing state objects to match the current
 * definitions.
 *
 * @param {object} adapter - The adapter instance
 * @returns {Promise<number>} Number of objects that were changed
 */
async function migrateStateRoles(adapter) {
    let changed = 0;
    try {
        const objects = await adapter.getAdapterObjectsAsync();

        for (const [id, obj] of Object.entries(objects)) {
            if (!obj || obj.type !== 'state' || !obj.common) {
                continue;
            }

            const role = obj.common.role;
            const update = {};

            if (WRITABLE_SUFFIXES.some(suffix => id.endsWith(suffix))) {
                if (role !== 'level') {
                    update.role = 'level';
                }
            } else if (role && Object.prototype.hasOwnProperty.call(REPLACED_ROLES, role)) {
                update.role = REPLACED_ROLES[role];
            }

            // Button states are triggers, not readable values: role 'button'
            // requires read:false (checker rule for the button role).
            if (role === 'button' && obj.common.read !== false) {
                update.read = false;
            }

            if (Object.keys(update).length > 0) {
                await adapter.extendObjectAsync(id, { common: update });
                changed++;
            }
        }

        if (changed > 0) {
            adapter.log.info(`Object migration: updated ${changed} datapoint(s)`);
        }
    } catch (error) {
        adapter.log.warn(`Object role migration failed: ${error.message}`);
    }
    return changed;
}

module.exports = { migrateStateRoles };
