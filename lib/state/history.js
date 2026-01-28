'use strict';

const STATE_ROLES = require('./roles');

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
        common: { name: 'Historie' },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(basePath, {
        type: 'channel',
        common: { name: `Jahr ${year}` },
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
            name: `Jahresverbrauch ${year} (${consumptionUnit})`,
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
                name: `Jahresverbrauch ${year} (m³)`,
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
            name: `Jahreskosten ${year} (€)`,
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
            name: `Bilanz ${year} (€)`,
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
