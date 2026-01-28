'use strict';

const STATE_ROLES = require('./roles');

/**
 * Creates the totals state structure for a utility type
 * Totals show the sum of all meters (main + additional)
 *
 * @param {object} adapter - The adapter instance
 * @param {string} type - Utility type: 'gas', 'water', 'electricity', 'pv'
 * @returns {Promise<void>}
 */
async function createTotalsStructure(adapter, type) {
    const labels = {
        gas: { name: 'Gas (Gesamt)', unit: 'kWh' },
        water: { name: 'Wasser (Gesamt)', unit: 'm³' },
        electricity: { name: 'Strom (Gesamt)', unit: 'kWh' },
        pv: { name: 'PV (Gesamt)', unit: 'kWh' },
    };

    const label = labels[type];
    if (!label) {
        adapter.log.error(`MISSING LABEL for type "${type}" in createTotalsStructure!`);
        return;
    }
    const basePath = `${type}.totals`;

    // Create main channel
    await adapter.setObjectNotExistsAsync(basePath, {
        type: 'channel',
        common: { name: `${label.name} - Summe aller Zähler` },
        native: {},
    });

    // --- CONSUMPTION STATES (totals) ---
    await adapter.setObjectNotExistsAsync(`${basePath}.consumption`, {
        type: 'channel',
        common: { name: 'Gesamtverbrauch' },
        native: {},
    });

    const periods = [
        { id: 'daily', name: 'Tagesverbrauch Gesamt' },
        { id: 'monthly', name: 'Monatsverbrauch Gesamt' },
        { id: 'yearly', name: 'Jahresverbrauch Gesamt' },
        { id: 'weekly', name: 'Wochenverbrauch Gesamt' },
    ];

    for (const p of periods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${p.id}`, {
            type: 'state',
            common: {
                name: `${p.name} (${label.unit})`,
                type: 'number',
                role: STATE_ROLES.consumption,
                read: true,
                write: false,
                unit: label.unit,
                def: 0,
            },
            native: {},
        });
    }

    if (type === 'gas') {
        await adapter.setObjectNotExistsAsync(`${basePath}.consumption.weeklyVolume`, {
            type: 'state',
            common: {
                name: 'Wochenverbrauch Gesamt (m³)',
                type: 'number',
                role: STATE_ROLES.consumption,
                read: true,
                write: false,
                unit: 'm³',
                def: 0,
            },
            native: {},
        });

        if (adapter.config.gasHtNtEnabled) {
            const hntVolumeStates = [
                { id: 'weeklyVolumeHT', name: 'Wochenverbrauch Gesamt Haupttarif (HT) (m³)' },
                { id: 'weeklyVolumeNT', name: 'Wochenverbrauch Gesamt Nebentarif (NT) (m³)' },
            ];
            for (const s of hntVolumeStates) {
                await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${s.id}`, {
                    type: 'state',
                    common: {
                        name: s.name,
                        type: 'number',
                        role: STATE_ROLES.consumption,
                        read: true,
                        write: false,
                        unit: 'm³',
                        def: 0,
                    },
                    native: {},
                });
            }
        }
    }

    // --- COST STATES (totals) ---
    await adapter.setObjectNotExistsAsync(`${basePath}.costs`, {
        type: 'channel',
        common: { name: 'Gesamtkosten' },
        native: {},
    });

    const costPeriods = [
        { id: 'daily', name: 'Tageskosten Gesamt' },
        { id: 'monthly', name: 'Monatskosten Gesamt' },
        { id: 'weekly', name: 'Wochenkosten Gesamt' },
        { id: 'totalYearly', name: 'Jahreskosten Gesamt' },
    ];

    for (const p of costPeriods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.costs.${p.id}`, {
            type: 'state',
            common: {
                name: `${p.name} (€)`,
                type: 'number',
                role: STATE_ROLES.cost,
                read: true,
                write: false,
                unit: '€',
                def: 0,
            },
            native: {},
        });
    }

    adapter.log.debug(`Totals state structure created for ${type}`);
}

module.exports = createTotalsStructure;
