'use strict';

const STATE_ROLES = require('./roles');

/**
 * Creates the state structure for an individual meter
 *
 * @param {object} adapter - The adapter instance
 * @param {string} type - Utility type: 'gas', 'water', 'electricity', 'pv'
 * @param {string} meterName - Name of the meter
 * @param {object} _config - Configuration for this utility
 * @returns {Promise<void>}
 */
async function createMeterStructure(adapter, type, meterName, _config) {
    const labels = {
        gas: { name: 'Gas', unit: 'kWh', volumeUnit: 'm³' },
        water: { name: 'Wasser', unit: 'm³' },
        electricity: { name: 'Strom', unit: 'kWh' },
        pv: { name: 'PV', unit: 'kWh', consumption: 'Einspeisung', cost: 'Vergütung' },
    };

    const label = labels[type];
    if (!label) {
        adapter.log.error(`MISSING LABEL for type "${type}" in createMeterStructure!`);
        return;
    }

    const basePath = `${type}.${meterName}`;
    const isGas = type === 'gas';

    // Create meter channel
    await adapter.setObjectNotExistsAsync(basePath, {
        type: 'channel',
        common: { name: `Zähler: ${meterName}` },
        native: {},
    });

    // --- CONSUMPTION STATES ---
    await adapter.setObjectNotExistsAsync(`${basePath}.consumption`, {
        type: 'channel',
        common: { name: label.consumption || 'Verbrauch' },
        native: {},
    });

    if (isGas) {
        const volumeStates = [
            { id: 'dailyVolume', name: 'Täglicher Verbrauch (m³)' },
            { id: 'monthlyVolume', name: 'Monatlicher Verbrauch (m³)' },
            { id: 'yearlyVolume', name: 'Jährlicher Verbrauch (m³)' },
        ];
        for (const s of volumeStates) {
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

    const periods = [
        { id: 'daily', name: 'Tages' },
        { id: 'monthly', name: 'Monats' },
        { id: 'yearly', name: 'Jahres' },
        { id: 'weekly', name: 'Wochen' },
    ];

    for (const p of periods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${p.id}`, {
            type: 'state',
            common: {
                name: `${p.name}-${(label.consumption || 'Verbrauch').toLowerCase()} (${label.unit})`,
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
            await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${id}`, {
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

    await adapter.setObjectNotExistsAsync(`${basePath}.consumption.lastUpdate`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.costs`, {
        type: 'channel',
        common: { name: label.cost || 'Kosten' },
        native: {},
    });

    for (const p of periods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.costs.${p.id}`, {
            type: 'state',
            common: {
                name: `${p.name}-${(label.cost || 'Kosten').toLowerCase()} (€)`,
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
            await adapter.setObjectNotExistsAsync(`${basePath}.costs.${id}`, {
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
        await adapter.setObjectNotExistsAsync(`${basePath}.costs.${item.id}`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.billing`, {
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
        await adapter.setObjectNotExistsAsync(`${basePath}.billing.${s.id}`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.adjustment`, {
        type: 'channel',
        common: { name: 'Manuelle Anpassung' },
        native: {},
    });
    await adapter.setObjectNotExistsAsync(`${basePath}.adjustment.value`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.adjustment.note`, {
        type: 'state',
        common: { name: 'Notiz/Grund für Anpassung', type: 'string', role: 'text', read: true, write: true, def: '' },
        native: {},
    });
    await adapter.setObjectNotExistsAsync(`${basePath}.adjustment.applied`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.info`, {
        type: 'channel',
        common: { name: 'Informationen' },
        native: {},
    });
    if (isGas) {
        await adapter.setObjectNotExistsAsync(`${basePath}.info.meterReadingVolume`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.info.meterReading`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.info.currentPrice`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.info.lastSync`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.info.sensorActive`, {
        type: 'state',
        common: {
            name: 'Sensor aktiv',
            type: 'boolean',
            role: 'indicator.reachable',
            read: true,
            write: false,
            def: false,
        },
        native: {},
    });
    await adapter.setObjectNotExistsAsync(`${basePath}.info.currentTariff`, {
        type: 'state',
        common: { name: 'Aktueller Tarif', type: 'string', role: 'text', read: true, write: false, def: 'Standard' },
        native: {},
    });

    // --- STATISTICS STATES (NEW STRUCTURE) ---
    await adapter.setObjectNotExistsAsync(`${basePath}.statistics`, {
        type: 'channel',
        common: { name: 'Statistiken' },
        native: {},
    });

    // Consumption Statistics
    await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption`, {
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
        await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption.${item.id}`, {
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
        const consumptionHTNT = [
            { id: 'lastDayHT', name: `Verbrauch gestern HT (${label.unit})` },
            { id: 'lastDayNT', name: `Verbrauch gestern NT (${label.unit})` },
            { id: 'lastWeekHT', name: `Verbrauch letzte Woche HT (${label.unit})` },
            { id: 'lastWeekNT', name: `Verbrauch letzte Woche NT (${label.unit})` },
            { id: 'lastMonthHT', name: `Verbrauch letzter Monat HT (${label.unit})` },
            { id: 'lastMonthNT', name: `Verbrauch letzter Monat NT (${label.unit})` },
            { id: 'lastYearHT', name: `Verbrauch letztes Jahr HT (${label.unit})` },
            { id: 'lastYearNT', name: `Verbrauch letztes Jahr NT (${label.unit})` },
        ];
        for (const item of consumptionHTNT) {
            await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption.${item.id}`, {
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
    if (isGas) {
        const statGasVolume = [
            { id: 'lastDayVolume', name: `Verbrauch gestern (${label.volumeUnit})` },
            { id: 'lastWeekVolume', name: `Verbrauch letzte Woche (${label.volumeUnit})` },
            { id: 'lastMonthVolume', name: `Verbrauch letzter Monat (${label.volumeUnit})` },
            { id: 'lastYearVolume', name: `Verbrauch letztes Jahr (${label.volumeUnit})` },
        ];
        for (const item of statGasVolume) {
            await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption.${item.id}`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.statistics.cost`, {
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
        await adapter.setObjectNotExistsAsync(`${basePath}.statistics.cost.${item.id}`, {
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
            await adapter.setObjectNotExistsAsync(`${basePath}.statistics.cost.${item.id}`, {
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
    await adapter.setObjectNotExistsAsync(`${basePath}.statistics.timestamps`, {
        type: 'channel',
        common: { name: 'Zeitstempel' },
        native: {},
    });
    const statTimestamps = [
        { id: 'lastDayStart', name: 'Tageszähler zurückgesetzt am' },
        { id: 'lastWeekStart', name: 'Wochenzähler zurückgesetzt am' },
        { id: 'lastMonthStart', name: 'Monatszähler zurückgesetzt am' },
        { id: 'lastYearStart', name: 'Jahreszähler zurückgesetzt am' },
    ];
    for (const ts of statTimestamps) {
        await adapter.setObjectNotExistsAsync(`${basePath}.statistics.timestamps.${ts.id}`, {
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
            const obj = await adapter.getObjectAsync(`${basePath}.statistics.${id}`);
            if (obj) {
                await adapter.delObjectAsync(`${basePath}.statistics.${id}`);
                adapter.log.debug(`Deleted old statistics object: ${basePath}.statistics.${id}`);
            }
        } catch {
            /* ignore */
        }
    }

    adapter.log.debug(`Meter state structure created for ${basePath} (including new statistics)`);
}

module.exports = createMeterStructure;
