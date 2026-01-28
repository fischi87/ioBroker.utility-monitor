'use strict';

const STATE_ROLES = require('./roles');

/**
 * Creates the complete state structure for a utility type (gas, water, electricity)
 *
 * @param {object} adapter - The adapter instance
 * @param {string} type - Utility type: 'gas', 'water', or 'electricity'
 * @param {object} _config - Configuration for this utility
 * @returns {Promise<void>}
 */
async function createUtilityStateStructure(adapter, type, _config = {}) {
    const labels = {
        gas: { name: 'Gas', unit: 'kWh', volumeUnit: 'm³' },
        water: { name: 'Wasser', unit: 'm³' },
        electricity: { name: 'Strom', unit: 'kWh' },
        pv: { name: 'PV', unit: 'kWh', consumption: 'Einspeisung', cost: 'Vergütung' },
    };

    const label = labels[type];
    if (!label) {
        adapter.log.error(`MISSING LABEL for type "${type}" in createUtilityStateStructure!`);
        return;
    }

    // Create main channel
    await adapter.setObjectNotExistsAsync(type, {
        type: 'channel',
        common: { name: `${label.name}-Überwachung` },
        native: {},
    });

    // --- CONSUMPTION STATES ---
    await adapter.setObjectNotExistsAsync(`${type}.consumption`, {
        type: 'channel',
        common: { name: label.consumption || 'Verbrauch' },
        native: {},
    });

    if (type === 'gas') {
        const volumeStates = [
            { id: 'dailyVolume', name: 'Täglicher Verbrauch (m³)' },
            { id: 'monthlyVolume', name: 'Monatlicher Verbrauch (m³)' },
            { id: 'yearlyVolume', name: 'Jährlicher Verbrauch (m³)' },
        ];
        for (const state of volumeStates) {
            await adapter.setObjectNotExistsAsync(`${type}.consumption.${state.id}`, {
                type: 'state',
                common: {
                    name: state.name,
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

    const mainPeriods = [
        { id: 'daily', name: 'Tages' },
        { id: 'monthly', name: 'Monats' },
        { id: 'yearly', name: 'Jahres' },
        { id: 'weekly', name: 'Wochen' },
    ];

    for (const period of mainPeriods) {
        await adapter.setObjectNotExistsAsync(`${type}.consumption.${period.id}`, {
            type: 'state',
            common: {
                name: `${period.name}-${(label.consumption || 'Verbrauch').toLowerCase()} (${label.unit})`,
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

    const configTypeMap = { electricity: 'strom', water: 'wasser', gas: 'gas', pv: 'pv' };
    const configType = configTypeMap[type] || type;
    const htNtEnabled = _config[`${configType}HtNtEnabled`];

    if (htNtEnabled) {
        const htNtStates = [
            'dailyHT',
            'dailyNT',
            'monthlyHT',
            'monthlyNT',
            'yearlyHT',
            'yearlyNT',
            'weeklyHT',
            'weeklyNT',
        ];
        const htNtLabels = {
            dailyHT: 'Tagesverbrauch Haupttarif (HT)',
            dailyNT: 'Tagesverbrauch Nebentarif (NT)',
            monthlyHT: 'Monatsverbrauch Haupttarif (HT)',
            monthlyNT: 'Monatsverbrauch Nebentarif (NT)',
            yearlyHT: 'Jahresverbrauch Haupttarif (HT)',
            yearlyNT: 'Jahresverbrauch Nebentarif (NT)',
            weeklyHT: 'Wochenverbrauch Haupttarif (HT)',
            weeklyNT: 'Wochenverbrauch Nebentarif (NT)',
        };

        for (const id of htNtStates) {
            await adapter.setObjectNotExistsAsync(`${type}.consumption.${id}`, {
                type: 'state',
                common: {
                    name: `${htNtLabels[id]} (${label.unit})`,
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
    }

    await adapter.setObjectNotExistsAsync(`${type}.consumption.lastUpdate`, {
        type: 'state',
        common: {
            name: 'Letzte Aktualisierung',
            type: 'number',
            role: STATE_ROLES.timestamp,
            read: true,
            write: false,
        },
        native: {},
    });

    // --- COST STATES ---
    await adapter.setObjectNotExistsAsync(`${type}.costs`, {
        type: 'channel',
        common: { name: label.cost || 'Kosten' },
        native: {},
    });

    for (const period of mainPeriods) {
        await adapter.setObjectNotExistsAsync(`${type}.costs.${period.id}`, {
            type: 'state',
            common: {
                name: `${period.name}-${(label.cost || 'Kosten').toLowerCase()} (€)`,
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

    if (htNtEnabled) {
        const htNtCostStates = [
            'yearlyHT',
            'yearlyNT',
            'monthlyHT',
            'monthlyNT',
            'dailyHT',
            'dailyNT',
            'weeklyHT',
            'weeklyNT',
        ];
        const htNtCostLabels = {
            yearlyHT: 'Jahreskosten Haupttarif (HT)',
            yearlyNT: 'Jahreskosten Nebentarif (NT)',
            monthlyHT: 'Monatskosten Haupttarif (HT)',
            monthlyNT: 'Monatskosten Nebentarif (NT)',
            dailyHT: 'Tageskosten Haupttarif (HT)',
            dailyNT: 'Tageskosten Nebentarif (NT)',
            weeklyHT: 'Wochenkosten Haupttarif (HT)',
            weeklyNT: 'Wochenkosten Nebentarif (NT)',
        };

        for (const id of htNtCostStates) {
            await adapter.setObjectNotExistsAsync(`${type}.costs.${id}`, {
                type: 'state',
                common: {
                    name: `${htNtCostLabels[id]} (€)`,
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
    }

    const costInfo = [
        {
            id: 'totalYearly',
            name: `Gesamt-${(label.cost || 'Kosten').toLowerCase()} Jahr (Verbrauch + Grundgebühr) (€)`,
        },
        { id: 'annualFee', name: 'Jahresgebühr akkumuliert (€)' },
        { id: 'basicCharge', name: 'Grundgebühr (€/Monat)' },
        { id: 'paidTotal', name: 'Bezahlt gesamt (Abschlag × Monate) (€)' },
        { id: 'balance', name: 'Saldo (Bezahlt - Verbraucht) (€)' },
    ];

    for (const item of costInfo) {
        await adapter.setObjectNotExistsAsync(`${type}.costs.${item.id}`, {
            type: 'state',
            common: {
                name: item.name,
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

    // --- BILLING STATES ---
    await adapter.setObjectNotExistsAsync(`${type}.billing`, {
        type: 'channel',
        common: { name: 'Abrechnungszeitraum' },
        native: {},
    });

    const billingStates = [
        {
            id: 'endReading',
            name: 'Endzählerstand (manuell eintragen)',
            type: 'number',
            role: STATE_ROLES.meterReading,
            unit: label.volumeUnit || label.unit,
            write: true,
        },
        {
            id: 'closePeriod',
            name: 'Zeitraum jetzt abschließen (Button)',
            type: 'boolean',
            role: 'button',
            write: true,
            def: false,
        },
        { id: 'periodEnd', name: 'Abrechnungszeitraum endet am', type: 'string', role: 'text', def: '' },
        { id: 'daysRemaining', name: 'Tage bis Abrechnungsende', type: 'number', role: 'value', unit: 'Tage', def: 0 },
        {
            id: 'newInitialReading',
            name: 'Neuer Startwert (für Config übernehmen!)',
            type: 'number',
            role: STATE_ROLES.meterReading,
            unit: label.volumeUnit || label.unit,
            def: 0,
        },
        {
            id: 'notificationSent',
            name: 'Benachrichtigung Zählerstand versendet',
            type: 'boolean',
            role: 'indicator',
            def: false,
        },
        {
            id: 'notificationChangeSent',
            name: 'Benachrichtigung Vertragswechsel versendet',
            type: 'boolean',
            role: 'indicator',
            def: false,
        },
    ];

    for (const s of billingStates) {
        await adapter.setObjectNotExistsAsync(`${type}.billing.${s.id}`, {
            type: 'state',
            common: {
                name: s.name,
                type: s.type,
                role: s.role,
                read: true,
                write: s.write || false,
                unit: s.unit || '',
                def: s.def === undefined ? 0 : s.def,
            },
            native: {},
        });
    }

    // --- ADJUSTMENT STATES ---
    await adapter.setObjectNotExistsAsync(`${type}.adjustment`, {
        type: 'channel',
        common: { name: 'Manuelle Anpassung' },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.adjustment.value`, {
        type: 'state',
        common: {
            name: 'Korrekturwert (Differenz zum echten Zähler)',
            type: 'number',
            role: STATE_ROLES.value,
            read: true,
            write: true,
            unit: label.volumeUnit || label.unit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.adjustment.note`, {
        type: 'state',
        common: { name: 'Notiz/Grund für Anpassung', type: 'string', role: 'text', read: true, write: true, def: '' },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.adjustment.applied`, {
        type: 'state',
        common: {
            name: 'Zeitstempel der letzten Anwendung',
            type: 'number',
            role: 'value.time',
            read: true,
            write: false,
            def: 0,
        },
        native: {},
    });

    // --- INFO STATES ---
    await adapter.setObjectNotExistsAsync(`${type}.info`, {
        type: 'channel',
        common: { name: 'Informationen' },
        native: {},
    });

    if (type === 'gas') {
        await adapter.setObjectNotExistsAsync(`${type}.info.meterReadingVolume`, {
            type: 'state',
            common: {
                name: `Zählerstand Volumen (${label.volumeUnit})`,
                type: 'number',
                role: STATE_ROLES.meterReading,
                read: true,
                write: false,
                unit: label.volumeUnit || label.unit,
                def: 0,
            },
            native: {},
        });
    }

    await adapter.setObjectNotExistsAsync(`${type}.info.meterReading`, {
        type: 'state',
        common: {
            name: `Zählerstand (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.meterReading,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.currentPrice`, {
        type: 'state',
        common: {
            name: `Aktueller Preis (€/${label.unit})`,
            type: 'number',
            role: STATE_ROLES.price,
            read: true,
            write: false,
            unit: `€/${label.unit}`,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.lastSync`, {
        type: 'state',
        common: {
            name: 'Letzte Synchronisation',
            type: 'number',
            role: STATE_ROLES.timestamp,
            read: true,
            write: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.sensorActive`, {
        type: 'state',
        common: {
            name: 'Sensor aktiv',
            type: 'boolean',
            role: STATE_ROLES.indicator,
            read: true,
            write: false,
            def: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.currentTariff`, {
        type: 'state',
        common: {
            name: 'Aktueller Tarif (HT/NT)',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: 'Standard',
        },
        native: {},
    });

    // --- STATISTICS STATES (NEW STRUCTURE) ---
    await adapter.setObjectNotExistsAsync(`${type}.statistics`, {
        type: 'channel',
        common: { name: 'Statistiken' },
        native: {},
    });

    // Consumption Statistics
    await adapter.setObjectNotExistsAsync(`${type}.statistics.consumption`, {
        type: 'channel',
        common: { name: 'Verbrauch' },
        native: {},
    });

    const statConsumption = [
        { id: 'averageDaily', name: `Durchschnitt pro Tag (${label.unit})` },
        { id: 'averageMonthly', name: `Durchschnitt pro Monat (${label.unit})` },
        { id: 'lastDay', name: `Verbrauch gestern (${label.unit})` },
        { id: 'lastWeek', name: `Verbrauch letzte Woche (${label.unit})` },
        { id: 'lastMonth', name: `Verbrauch letzter Monat (${label.unit})` },
        { id: 'lastYear', name: `Verbrauch letztes Jahr (${label.unit})` },
    ];

    for (const item of statConsumption) {
        await adapter.setObjectNotExistsAsync(`${type}.statistics.consumption.${item.id}`, {
            type: 'state',
            common: {
                name: item.name,
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

    if (htNtEnabled) {
        const statHTNT = [
            { id: 'lastDayHT', name: `Verbrauch gestern HT (${label.unit})` },
            { id: 'lastDayNT', name: `Verbrauch gestern NT (${label.unit})` },
            { id: 'lastWeekHT', name: `Verbrauch letzte Woche HT (${label.unit})` },
            { id: 'lastWeekNT', name: `Verbrauch letzte Woche NT (${label.unit})` },
            { id: 'lastMonthHT', name: `Verbrauch letzter Monat HT (${label.unit})` },
            { id: 'lastMonthNT', name: `Verbrauch letzter Monat NT (${label.unit})` },
            { id: 'lastYearHT', name: `Verbrauch letztes Jahr HT (${label.unit})` },
            { id: 'lastYearNT', name: `Verbrauch letztes Jahr NT (${label.unit})` },
        ];
        for (const item of statHTNT) {
            await adapter.setObjectNotExistsAsync(`${type}.statistics.consumption.${item.id}`, {
                type: 'state',
                common: {
                    name: item.name,
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
    }

    if (type === 'gas') {
        const statGasVolume = [
            { id: 'lastDayVolume', name: `Verbrauch gestern (${label.volumeUnit})` },
            { id: 'lastWeekVolume', name: `Verbrauch letzte Woche (${label.volumeUnit})` },
            { id: 'lastMonthVolume', name: `Verbrauch letzter Monat (${label.volumeUnit})` },
            { id: 'lastYearVolume', name: `Verbrauch letztes Jahr (${label.volumeUnit})` },
        ];
        for (const item of statGasVolume) {
            await adapter.setObjectNotExistsAsync(`${type}.statistics.consumption.${item.id}`, {
                type: 'state',
                common: {
                    name: item.name,
                    type: 'number',
                    role: STATE_ROLES.consumption,
                    read: true,
                    write: false,
                    unit: label.volumeUnit || label.unit,
                    def: 0,
                },
                native: {},
            });
        }
    }

    // Cost Statistics
    await adapter.setObjectNotExistsAsync(`${type}.statistics.cost`, {
        type: 'channel',
        common: { name: 'Kosten' },
        native: {},
    });

    const statCosts = [
        { id: 'averageDaily', name: 'Durchschnitt pro Tag (€)' },
        { id: 'averageMonthly', name: 'Durchschnitt pro Monat (€)' },
        { id: 'lastDay', name: 'Kosten gestern (€)' },
        { id: 'lastWeek', name: 'Kosten letzte Woche (€)' },
        { id: 'lastMonth', name: 'Kosten letzter Monat (€)' },
        { id: 'lastYear', name: 'Kosten letztes Jahr (€)' },
    ];

    for (const item of statCosts) {
        await adapter.setObjectNotExistsAsync(`${type}.statistics.cost.${item.id}`, {
            type: 'state',
            common: {
                name: item.name,
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

    if (htNtEnabled) {
        const costHTNT = [
            { id: 'lastDayHT', name: 'Kosten gestern HT (€)' },
            { id: 'lastDayNT', name: 'Kosten gestern NT (€)' },
            { id: 'lastWeekHT', name: 'Kosten letzte Woche HT (€)' },
            { id: 'lastWeekNT', name: 'Kosten letzte Woche NT (€)' },
            { id: 'lastMonthHT', name: 'Kosten letzter Monat HT (€)' },
            { id: 'lastMonthNT', name: 'Kosten letzter Monat NT (€)' },
            { id: 'lastYearHT', name: 'Kosten letztes Jahr HT (€)' },
            { id: 'lastYearNT', name: 'Kosten letztes Jahr NT (€)' },
        ];
        for (const item of costHTNT) {
            await adapter.setObjectNotExistsAsync(`${type}.statistics.cost.${item.id}`, {
                type: 'state',
                common: {
                    name: item.name,
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
    }

    // Timestamps Statistics
    await adapter.setObjectNotExistsAsync(`${type}.statistics.timestamps`, {
        type: 'channel',
        common: { name: 'Zeitstempel' },
        native: {},
    });

    const timestamps = [
        { id: 'lastDayStart', name: 'Tageszähler zurückgesetzt am' },
        { id: 'lastWeekStart', name: 'Wochenzähler zurückgesetzt am' },
        { id: 'lastMonthStart', name: 'Monatszähler zurückgesetzt am' },
        { id: 'lastYearStart', name: 'Jahreszähler zurückgesetzt am' },
    ];

    for (const ts of timestamps) {
        await adapter.setObjectNotExistsAsync(`${type}.statistics.timestamps.${ts.id}`, {
            type: 'state',
            common: { name: ts.name, type: 'number', role: STATE_ROLES.timestamp, read: true, write: false },
            native: {},
        });
    }

    // --- CLEANUP OLD STATS ---
    const oldStats = [
        'averageDaily',
        'averageMonthly',
        'lastDay',
        'lastDayHT',
        'lastDayNT',
        'lastDayVolume',
        'lastWeek',
        'lastWeekVolume',
        'lastMonth',
        'lastMonthVolume',
        'lastDayStart',
        'lastWeekStart',
        'lastMonthStart',
        'lastYearStart',
    ];
    for (const id of oldStats) {
        try {
            const obj = await adapter.getObjectAsync(`${type}.statistics.${id}`);
            if (obj) {
                await adapter.delObjectAsync(`${type}.statistics.${id}`);
                adapter.log.debug(`Deleted old statistics object: ${type}.statistics.${id}`);
            }
        } catch {
            // ignore
        }
    }

    adapter.log.debug(`State structure created for ${type} (including new statistics)`);
}

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
    createUtilityStateStructure,
    deleteUtilityStateStructure,
};
