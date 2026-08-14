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
 * Creates history structure for a specific year
 *
 * @param {object} adapter - The adapter instance
 * @param {string} type - 'gas', 'water', 'electricity', 'pv'
 * @param {string} meterName - Meter name
 * @param {number|string} year - Year (YYYY)
 * @returns {Promise<void>}
 */
async function createHistoryStructure(adapter, type, meterName, year) {
    const basePath = `${type}.${meterName}.history.${year}`;

    await adapter.setObjectNotExistsAsync(`${type}.${meterName}.history`, {
        type: 'channel',
        common: { name: tr('History', 'Historie') },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(basePath, {
        type: 'channel',
        common: { name: tr(`Year ${year}`, `Jahr ${year}`) },
        native: { year },
    });

    let consumptionUnit = 'kWh';
    if (type === 'water') {
        consumptionUnit = 'm³';
    } else if (type === 'gas') {
        consumptionUnit = 'kWh';
    }

    await adapter.setObjectNotExistsAsync(`${basePath}.consumption`, {
        type: 'state',
        common: {
            name: tr(`Yearly consumption ${year} (${consumptionUnit})`, `Jahresverbrauch ${year} (${consumptionUnit})`),
            type: 'number',
            role: STATE_ROLES.consumption,
            read: true,
            write: false,
            unit: consumptionUnit,
            def: 0,
        },
        native: {},
    });

    if (type === 'gas') {
        await adapter.setObjectNotExistsAsync(`${basePath}.volume`, {
            type: 'state',
            common: {
                name: tr(`Yearly consumption ${year} (m³)`, `Jahresverbrauch ${year} (m³)`),
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

    await adapter.setObjectNotExistsAsync(`${basePath}.costs`, {
        type: 'state',
        common: {
            name: tr(`Yearly costs ${year} (€)`, `Jahreskosten ${year} (€)`),
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${basePath}.balance`, {
        type: 'state',
        common: {
            name: tr(`Balance ${year} (€)`, `Bilanz ${year} (€)`),
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

module.exports = createHistoryStructure;
