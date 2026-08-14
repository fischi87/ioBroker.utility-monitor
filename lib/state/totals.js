'use strict';

const STATE_ROLES = require('./roles');

/**
 * Builds a multilingual name object ({ en, de }) for common.name.
 *
 * @param {string} en - English name
 * @param {string} de - German name
 * @returns {{en: string, de: string}} Multilingual name object
 */
const tr = (en, de) => ({ en, de });

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
        gas: { nameEn: 'Gas', nameDe: 'Gas', unit: 'kWh' },
        water: { nameEn: 'Water', nameDe: 'Wasser', unit: 'm³' },
        electricity: { nameEn: 'Electricity', nameDe: 'Strom', unit: 'kWh' },
        pv: { nameEn: 'PV', nameDe: 'PV', unit: 'kWh' },
    };

    const label = labels[type];
    if (!label) {
        adapter.log.error(`MISSING LABEL for type "${type}" in createTotalsStructure!`);
        return;
    }
    const basePath = `${type}.totals`;

    // Ensure the utility-type container exists so that totals has a valid
    // parent object (checker rule E3009). Idempotent via setObjectNotExists.
    await adapter.setObjectNotExistsAsync(type, {
        type: 'folder',
        common: { name: tr(label.nameEn, label.nameDe) },
        native: {},
    });

    // Create main channel
    await adapter.setObjectNotExistsAsync(basePath, {
        type: 'channel',
        common: {
            name: tr(`${label.nameEn} (total) - sum of all meters`, `${label.nameDe} (Gesamt) - Summe aller Zähler`),
        },
        native: {},
    });

    // --- CONSUMPTION STATES (totals) ---
    await adapter.setObjectNotExistsAsync(`${basePath}.consumption`, {
        type: 'channel',
        common: { name: tr('Total consumption', 'Gesamtverbrauch') },
        native: {},
    });

    const periods = [
        { id: 'daily', en: 'Total daily consumption', de: 'Tagesverbrauch Gesamt' },
        { id: 'monthly', en: 'Total monthly consumption', de: 'Monatsverbrauch Gesamt' },
        { id: 'yearly', en: 'Total yearly consumption', de: 'Jahresverbrauch Gesamt' },
        { id: 'weekly', en: 'Total weekly consumption', de: 'Wochenverbrauch Gesamt' },
    ];

    for (const p of periods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${p.id}`, {
            type: 'state',
            common: {
                name: tr(`${p.en} (${label.unit})`, `${p.de} (${label.unit})`),
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
                name: tr('Total weekly consumption (m³)', 'Wochenverbrauch Gesamt (m³)'),
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
                {
                    id: 'weeklyVolumeHT',
                    en: 'Total weekly consumption peak tariff (HT) (m³)',
                    de: 'Wochenverbrauch Gesamt Haupttarif (HT) (m³)',
                },
                {
                    id: 'weeklyVolumeNT',
                    en: 'Total weekly consumption off-peak tariff (NT) (m³)',
                    de: 'Wochenverbrauch Gesamt Nebentarif (NT) (m³)',
                },
            ];
            for (const s of hntVolumeStates) {
                await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${s.id}`, {
                    type: 'state',
                    common: {
                        name: tr(s.en, s.de),
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
        common: { name: tr('Total costs', 'Gesamtkosten') },
        native: {},
    });

    const costPeriods = [
        { id: 'daily', en: 'Total daily costs', de: 'Tageskosten Gesamt' },
        { id: 'monthly', en: 'Total monthly costs', de: 'Monatskosten Gesamt' },
        { id: 'weekly', en: 'Total weekly costs', de: 'Wochenkosten Gesamt' },
        { id: 'totalYearly', en: 'Total yearly costs', de: 'Jahreskosten Gesamt' },
    ];

    for (const p of costPeriods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.costs.${p.id}`, {
            type: 'state',
            common: {
                name: tr(`${p.en} (€)`, `${p.de} (€)`),
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
