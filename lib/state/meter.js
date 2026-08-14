'use strict';

const STATE_ROLES = require('./roles');

/**
 * Builds a multilingual name object. ioBroker uses common.name for the object
 * tree in Admin; providing an { en, de } object keeps German for German users
 * while exposing an English name for the repository checker and other locales.
 *
 * @param {string} en - English name
 * @param {string} de - German name
 * @returns {{en: string, de: string}} Multilingual name object
 */
const tr = (en, de) => ({ en, de });

/**
 * Converts info.monthlyInstallment from the former text representation
 * ("25.00 €") into a numeric state.
 *
 * setObjectNotExistsAsync() never modifies an existing object, so installations
 * created before this change keep the old string definition. Writing a number
 * into such a state makes the js-controller log a type mismatch on every
 * update, which is why existing objects are converted explicitly.
 *
 * @param {object} adapter - The adapter instance
 * @param {string} id - Full state id of the installment state
 * @returns {Promise<void>}
 */
async function migrateInstallmentToNumber(adapter, id) {
    try {
        const obj = await adapter.getObjectAsync(id);
        if (!obj || obj.common?.type !== 'string') {
            return;
        }

        await adapter.extendObjectAsync(id, {
            common: { type: 'number', role: STATE_ROLES.cost, unit: '€', def: 0 },
        });

        // Carry the previously stored text over: parseFloat('25.00 €') === 25
        const state = await adapter.getStateAsync(id);
        if (typeof state?.val === 'string') {
            const numeric = parseFloat(state.val);
            await adapter.setStateAsync(id, isNaN(numeric) ? 0 : numeric, true);
        }

        adapter.log.info(`${id}: converted from text to number`);
    } catch (error) {
        adapter.log.warn(`${id} could not be converted to a number: ${error.message}`);
    }
}

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
        gas: {
            nameEn: 'Gas',
            nameDe: 'Gas',
            unit: 'kWh',
            volumeUnit: 'm³',
            consEn: 'Consumption',
            consDe: 'Verbrauch',
            costEn: 'Costs',
            costDe: 'Kosten',
        },
        water: {
            nameEn: 'Water',
            nameDe: 'Wasser',
            unit: 'm³',
            consEn: 'Consumption',
            consDe: 'Verbrauch',
            costEn: 'Costs',
            costDe: 'Kosten',
        },
        electricity: {
            nameEn: 'Electricity',
            nameDe: 'Strom',
            unit: 'kWh',
            consEn: 'Consumption',
            consDe: 'Verbrauch',
            costEn: 'Costs',
            costDe: 'Kosten',
        },
        pv: {
            nameEn: 'PV',
            nameDe: 'PV',
            unit: 'kWh',
            consEn: 'Feed-in',
            consDe: 'Einspeisung',
            costEn: 'Compensation',
            costDe: 'Vergütung',
        },
    };

    const label = labels[type];
    if (!label) {
        adapter.log.error(`MISSING LABEL for type "${type}" in createMeterStructure!`);
        return;
    }

    const basePath = `${type}.${meterName}`;
    const isGas = type === 'gas';

    // Create the utility-type container (gas/water/electricity/pv) so that the
    // meter channels below it have a valid parent object (checker rule E3009).
    await adapter.setObjectNotExistsAsync(type, {
        type: 'folder',
        common: { name: tr(label.nameEn, label.nameDe) },
        native: {},
    });

    // Create meter channel
    await adapter.setObjectNotExistsAsync(basePath, {
        type: 'channel',
        common: { name: tr(`Meter: ${meterName}`, `Zähler: ${meterName}`) },
        native: {},
    });

    // --- CONSUMPTION STATES ---
    await adapter.setObjectNotExistsAsync(`${basePath}.consumption`, {
        type: 'channel',
        common: { name: tr(label.consEn, label.consDe) },
        native: {},
    });

    if (isGas) {
        const volumeStates = [
            { id: 'dailyVolume', en: 'Daily consumption (m³)', de: 'Täglicher Verbrauch (m³)' },
            { id: 'weeklyVolume', en: 'Weekly consumption (m³)', de: 'Wöchentlicher Verbrauch (m³)' },
            { id: 'monthlyVolume', en: 'Monthly consumption (m³)', de: 'Monatlicher Verbrauch (m³)' },
            { id: 'yearlyVolume', en: 'Yearly consumption (m³)', de: 'Jährlicher Verbrauch (m³)' },
        ];
        for (const s of volumeStates) {
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

    const periods = [
        { id: 'daily', en: 'Daily', de: 'Tages' },
        { id: 'monthly', en: 'Monthly', de: 'Monats' },
        { id: 'yearly', en: 'Yearly', de: 'Jahres' },
        { id: 'weekly', en: 'Weekly', de: 'Wochen' },
    ];

    for (const p of periods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${p.id}`, {
            type: 'state',
            common: {
                name: tr(
                    `${p.en} ${label.consEn.toLowerCase()} (${label.unit})`,
                    `${p.de}-${label.consDe.toLowerCase()} (${label.unit})`,
                ),
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
            dailyHT: { en: 'Daily consumption peak tariff (HT)', de: 'Tagesverbrauch Haupttarif (HT)' },
            dailyNT: { en: 'Daily consumption off-peak tariff (NT)', de: 'Tagesverbrauch Nebentarif (NT)' },
            monthlyHT: { en: 'Monthly consumption peak tariff (HT)', de: 'Monatsverbrauch Haupttarif (HT)' },
            monthlyNT: { en: 'Monthly consumption off-peak tariff (NT)', de: 'Monatsverbrauch Nebentarif (NT)' },
            yearlyHT: { en: 'Yearly consumption peak tariff (HT)', de: 'Jahresverbrauch Haupttarif (HT)' },
            yearlyNT: { en: 'Yearly consumption off-peak tariff (NT)', de: 'Jahresverbrauch Nebentarif (NT)' },
            weeklyHT: { en: 'Weekly consumption peak tariff (HT)', de: 'Wochenverbrauch Haupttarif (HT)' },
            weeklyNT: { en: 'Weekly consumption off-peak tariff (NT)', de: 'Wochenverbrauch Nebentarif (NT)' },
        };
        for (const id of htNtStates) {
            await adapter.setObjectNotExistsAsync(`${basePath}.consumption.${id}`, {
                type: 'state',
                common: {
                    name: tr(`${htNtLabels[id].en} (${label.unit})`, `${htNtLabels[id].de} (${label.unit})`),
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
            name: tr('Last update', 'Letzte Aktualisierung'),
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
        common: { name: tr(label.costEn, label.costDe) },
        native: {},
    });

    for (const p of periods) {
        await adapter.setObjectNotExistsAsync(`${basePath}.costs.${p.id}`, {
            type: 'state',
            common: {
                name: tr(`${p.en} ${label.costEn.toLowerCase()} (€)`, `${p.de}-${label.costDe.toLowerCase()} (€)`),
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
            yearlyHT: { en: 'Yearly costs peak tariff (HT)', de: 'Jahreskosten Haupttarif (HT)' },
            yearlyNT: { en: 'Yearly costs off-peak tariff (NT)', de: 'Jahreskosten Nebentarif (NT)' },
            monthlyHT: { en: 'Monthly costs peak tariff (HT)', de: 'Monatskosten Haupttarif (HT)' },
            monthlyNT: { en: 'Monthly costs off-peak tariff (NT)', de: 'Monatskosten Nebentarif (NT)' },
            dailyHT: { en: 'Daily costs peak tariff (HT)', de: 'Tageskosten Haupttarif (HT)' },
            dailyNT: { en: 'Daily costs off-peak tariff (NT)', de: 'Tageskosten Nebentarif (NT)' },
            weeklyHT: { en: 'Weekly costs peak tariff (HT)', de: 'Wochenkosten Haupttarif (HT)' },
            weeklyNT: { en: 'Weekly costs off-peak tariff (NT)', de: 'Wochenkosten Nebentarif (NT)' },
        };
        for (const id of htNtCostStates) {
            await adapter.setObjectNotExistsAsync(`${basePath}.costs.${id}`, {
                type: 'state',
                common: {
                    name: tr(`${htNtCostLabels[id].en} (€)`, `${htNtCostLabels[id].de} (€)`),
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
            en: `Total ${label.costEn.toLowerCase()} year (consumption + basic charge) (€)`,
            de: `Gesamt-${label.costDe.toLowerCase()} Jahr (Verbrauch + Grundgebühr) (€)`,
        },
        { id: 'annualFee', en: 'Annual fee accumulated (€)', de: 'Jahresgebühr akkumuliert (€)' },
        { id: 'basicCharge', en: 'Basic charge (€/month)', de: 'Grundgebühr (€/Monat)' },
        { id: 'paidTotal', en: 'Paid total (installment × months) (€)', de: 'Bezahlt gesamt (Abschlag × Monate) (€)' },
        { id: 'balance', en: 'Balance (paid - consumed) (€)', de: 'Saldo (Bezahlt - Verbraucht) (€)' },
    ];
    for (const item of costInfo) {
        await adapter.setObjectNotExistsAsync(`${basePath}.costs.${item.id}`, {
            type: 'state',
            common: {
                name: tr(item.en, item.de),
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
        common: { name: tr('Billing period', 'Abrechnungszeitraum') },
        native: {},
    });
    const billingStates = [
        {
            id: 'endReading',
            en: 'Final meter reading (enter manually)',
            de: 'Endzählerstand (manuell eintragen)',
            type: 'number',
            role: STATE_ROLES.writable,
            unit: label.volumeUnit || label.unit,
            write: true,
        },
        {
            id: 'closePeriod',
            en: 'Close period now (button)',
            de: 'Zeitraum jetzt abschließen (Button)',
            type: 'boolean',
            role: 'button',
            read: false,
            write: true,
            def: false,
        },
        {
            id: 'periodEnd',
            en: 'Billing period ends on',
            de: 'Abrechnungszeitraum endet am',
            type: 'string',
            role: 'text',
            def: '',
        },
        {
            id: 'daysRemaining',
            en: 'Days until billing period end',
            de: 'Tage bis Abrechnungsende',
            type: 'number',
            role: 'value',
            unit: 'days',
            def: 0,
        },
        {
            id: 'newInitialReading',
            en: 'New start value (apply to config!)',
            de: 'Neuer Startwert (für Config übernehmen!)',
            type: 'number',
            role: STATE_ROLES.meterReading,
            unit: label.volumeUnit || label.unit,
            def: 0,
        },
        {
            id: 'notificationSent',
            en: 'Meter reading notification sent',
            de: 'Benachrichtigung Zählerstand versendet',
            type: 'boolean',
            role: 'indicator',
            def: false,
        },
        {
            id: 'notificationChangeSent',
            en: 'Contract change notification sent',
            de: 'Benachrichtigung Vertragswechsel versendet',
            type: 'boolean',
            role: 'indicator',
            def: false,
        },
    ];
    for (const s of billingStates) {
        await adapter.setObjectNotExistsAsync(`${basePath}.billing.${s.id}`, {
            type: 'state',
            common: {
                name: tr(s.en, s.de),
                type: s.type,
                role: s.role,
                read: s.read === undefined ? true : s.read,
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
        common: { name: tr('Manual adjustment', 'Manuelle Anpassung') },
        native: {},
    });
    await adapter.setObjectNotExistsAsync(`${basePath}.adjustment.value`, {
        type: 'state',
        common: {
            name: tr('Correction value (difference to the real meter)', 'Korrekturwert (Differenz zum echten Zähler)'),
            type: 'number',
            role: STATE_ROLES.writable,
            read: true,
            write: true,
            unit: label.volumeUnit || label.unit,
            def: 0,
        },
        native: {},
    });
    await adapter.setObjectNotExistsAsync(`${basePath}.adjustment.note`, {
        type: 'state',
        common: {
            name: tr('Note/reason for adjustment', 'Notiz/Grund für Anpassung'),
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            def: '',
        },
        native: {},
    });
    await adapter.setObjectNotExistsAsync(`${basePath}.adjustment.applied`, {
        type: 'state',
        common: {
            name: tr('Timestamp of last application', 'Zeitstempel der letzten Anwendung'),
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
        common: { name: tr('Information', 'Informationen') },
        native: {},
    });
    if (isGas) {
        await adapter.setObjectNotExistsAsync(`${basePath}.info.meterReadingVolume`, {
            type: 'state',
            common: {
                name: tr(`Meter reading volume (${label.volumeUnit})`, `Zählerstand Volumen (${label.volumeUnit})`),
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
            name: tr(`Meter reading (${label.unit})`, `Zählerstand (${label.unit})`),
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
            name: tr(`Current price (€/${label.unit})`, `Aktueller Preis (€/${label.unit})`),
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
            name: tr('Last synchronization', 'Letzte Synchronisation'),
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
            name: tr('Sensor active', 'Sensor aktiv'),
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
        common: {
            name: tr('Current tariff', 'Aktueller Tarif'),
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: 'Standard',
        },
        native: {},
    });
    await adapter.setObjectNotExistsAsync(`${basePath}.info.monthlyInstallment`, {
        type: 'state',
        common: {
            name: tr('Monthly installment', 'Monatliche Abschlagszahlung'),
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    // Migration: until v1.6.4 this state was a formatted string ("25.00 €"), which
    // made it unusable for history, charts and scripts. setObjectNotExistsAsync
    // leaves existing objects untouched, so convert them explicitly (see #11).
    await migrateInstallmentToNumber(adapter, `${basePath}.info.monthlyInstallment`);

    // --- STATISTICS STATES (NEW STRUCTURE) ---
    await adapter.setObjectNotExistsAsync(`${basePath}.statistics`, {
        type: 'channel',
        common: { name: tr('Statistics', 'Statistiken') },
        native: {},
    });

    // Consumption Statistics
    await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption`, {
        type: 'channel',
        common: { name: tr(label.consEn, label.consDe) },
        native: {},
    });
    const statConsumption = [
        { id: 'averageDaily', en: `Average per day (${label.unit})`, de: `Durchschnitt pro Tag (${label.unit})` },
        {
            id: 'averageMonthly',
            en: `Average per month (${label.unit})`,
            de: `Durchschnitt pro Monat (${label.unit})`,
        },
        { id: 'lastDay', en: `Consumption yesterday (${label.unit})`, de: `Verbrauch gestern (${label.unit})` },
        { id: 'lastWeek', en: `Consumption last week (${label.unit})`, de: `Verbrauch letzte Woche (${label.unit})` },
        {
            id: 'lastMonth',
            en: `Consumption last month (${label.unit})`,
            de: `Verbrauch letzter Monat (${label.unit})`,
        },
        { id: 'lastYear', en: `Consumption last year (${label.unit})`, de: `Verbrauch letztes Jahr (${label.unit})` },
    ];
    for (const item of statConsumption) {
        await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption.${item.id}`, {
            type: 'state',
            common: {
                name: tr(item.en, item.de),
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
            {
                id: 'lastDayHT',
                en: `Consumption yesterday HT (${label.unit})`,
                de: `Verbrauch gestern HT (${label.unit})`,
            },
            {
                id: 'lastDayNT',
                en: `Consumption yesterday NT (${label.unit})`,
                de: `Verbrauch gestern NT (${label.unit})`,
            },
            {
                id: 'lastWeekHT',
                en: `Consumption last week HT (${label.unit})`,
                de: `Verbrauch letzte Woche HT (${label.unit})`,
            },
            {
                id: 'lastWeekNT',
                en: `Consumption last week NT (${label.unit})`,
                de: `Verbrauch letzte Woche NT (${label.unit})`,
            },
            {
                id: 'lastMonthHT',
                en: `Consumption last month HT (${label.unit})`,
                de: `Verbrauch letzter Monat HT (${label.unit})`,
            },
            {
                id: 'lastMonthNT',
                en: `Consumption last month NT (${label.unit})`,
                de: `Verbrauch letzter Monat NT (${label.unit})`,
            },
            {
                id: 'lastYearHT',
                en: `Consumption last year HT (${label.unit})`,
                de: `Verbrauch letztes Jahr HT (${label.unit})`,
            },
            {
                id: 'lastYearNT',
                en: `Consumption last year NT (${label.unit})`,
                de: `Verbrauch letztes Jahr NT (${label.unit})`,
            },
        ];
        for (const item of consumptionHTNT) {
            await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption.${item.id}`, {
                type: 'state',
                common: {
                    name: tr(item.en, item.de),
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
            {
                id: 'lastDayVolume',
                en: `Consumption yesterday (${label.volumeUnit})`,
                de: `Verbrauch gestern (${label.volumeUnit})`,
            },
            {
                id: 'lastWeekVolume',
                en: `Consumption last week (${label.volumeUnit})`,
                de: `Verbrauch letzte Woche (${label.volumeUnit})`,
            },
            {
                id: 'lastMonthVolume',
                en: `Consumption last month (${label.volumeUnit})`,
                de: `Verbrauch letzter Monat (${label.volumeUnit})`,
            },
            {
                id: 'lastYearVolume',
                en: `Consumption last year (${label.volumeUnit})`,
                de: `Verbrauch letztes Jahr (${label.volumeUnit})`,
            },
        ];
        for (const item of statGasVolume) {
            await adapter.setObjectNotExistsAsync(`${basePath}.statistics.consumption.${item.id}`, {
                type: 'state',
                common: {
                    name: tr(item.en, item.de),
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
        common: { name: tr('Costs', 'Kosten') },
        native: {},
    });
    const statCosts = [
        { id: 'averageDaily', en: 'Average per day (€)', de: 'Durchschnitt pro Tag (€)' },
        { id: 'averageMonthly', en: 'Average per month (€)', de: 'Durchschnitt pro Monat (€)' },
        { id: 'lastDay', en: 'Costs yesterday (€)', de: 'Kosten gestern (€)' },
        { id: 'lastWeek', en: 'Costs last week (€)', de: 'Kosten letzte Woche (€)' },
        { id: 'lastMonth', en: 'Costs last month (€)', de: 'Kosten letzter Monat (€)' },
        { id: 'lastYear', en: 'Costs last year (€)', de: 'Kosten letztes Jahr (€)' },
    ];
    for (const item of statCosts) {
        await adapter.setObjectNotExistsAsync(`${basePath}.statistics.cost.${item.id}`, {
            type: 'state',
            common: {
                name: tr(item.en, item.de),
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
            { id: 'lastDayHT', en: 'Costs yesterday HT (€)', de: 'Kosten gestern HT (€)' },
            { id: 'lastDayNT', en: 'Costs yesterday NT (€)', de: 'Kosten gestern NT (€)' },
            { id: 'lastWeekHT', en: 'Costs last week HT (€)', de: 'Kosten letzte Woche HT (€)' },
            { id: 'lastWeekNT', en: 'Costs last week NT (€)', de: 'Kosten letzte Woche NT (€)' },
            { id: 'lastMonthHT', en: 'Costs last month HT (€)', de: 'Kosten letzter Monat HT (€)' },
            { id: 'lastMonthNT', en: 'Costs last month NT (€)', de: 'Kosten letzter Monat NT (€)' },
            { id: 'lastYearHT', en: 'Costs last year HT (€)', de: 'Kosten letztes Jahr HT (€)' },
            { id: 'lastYearNT', en: 'Costs last year NT (€)', de: 'Kosten letztes Jahr NT (€)' },
        ];
        for (const item of costHTNT) {
            await adapter.setObjectNotExistsAsync(`${basePath}.statistics.cost.${item.id}`, {
                type: 'state',
                common: {
                    name: tr(item.en, item.de),
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
        common: { name: tr('Timestamps', 'Zeitstempel') },
        native: {},
    });
    const statTimestamps = [
        { id: 'lastDayStart', en: 'Daily counter reset on', de: 'Tageszähler zurückgesetzt am' },
        { id: 'lastWeekStart', en: 'Weekly counter reset on', de: 'Wochenzähler zurückgesetzt am' },
        { id: 'lastMonthStart', en: 'Monthly counter reset on', de: 'Monatszähler zurückgesetzt am' },
        { id: 'lastYearStart', en: 'Yearly counter reset on', de: 'Jahreszähler zurückgesetzt am' },
    ];
    for (const ts of statTimestamps) {
        await adapter.setObjectNotExistsAsync(`${basePath}.statistics.timestamps.${ts.id}`, {
            type: 'state',
            common: { name: tr(ts.en, ts.de), type: 'number', role: STATE_ROLES.timestamp, read: true, write: false },
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
// Exposed for unit tests; the module itself stays callable as a function
module.exports.migrateInstallmentToNumber = migrateInstallmentToNumber;
