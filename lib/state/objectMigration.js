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
 * Updates roles of existing state objects to match the current definitions.
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
            let newRole;

            if (WRITABLE_SUFFIXES.some(suffix => id.endsWith(suffix))) {
                if (role !== 'level') {
                    newRole = 'level';
                }
            } else if (role && Object.prototype.hasOwnProperty.call(REPLACED_ROLES, role)) {
                newRole = REPLACED_ROLES[role];
            }

            if (newRole) {
                await adapter.extendObjectAsync(id, { common: { role: newRole } });
                changed++;
            }
        }

        if (changed > 0) {
            adapter.log.info(`Objekt-Migration: ${changed} Datenpunkt-Rolle(n) aktualisiert`);
        }
    } catch (error) {
        adapter.log.warn(`Objekt-Migration der Rollen fehlgeschlagen: ${error.message}`);
    }
    return changed;
}

module.exports = { migrateStateRoles };
