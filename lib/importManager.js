'use strict';

const calculator = require('./calculator');
const { getConfigType } = require('./utils/typeMapper');
const stateManager = require('./stateManager');

/**
 * ImportManager handles CSV file parsing and data importing
 * for utility-monitor historical data.
 */
class ImportManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Handles the 'importCSV' message from the Admin UI
     *
     * @param {Record<string, any>} obj - Message object
     */
    async handleImportCSV(obj) {
        if (!obj || !obj.message) {
            return;
        }

        const { type, meterName, content, format } = obj.message;

        this.adapter.log.info(`[Import] Starting CSV import for ${type}.${meterName} (Format: ${format || 'generic'})`);

        try {
            const result = await this.processImport(type, meterName, content, format);

            if (obj.callback) {
                this.adapter.sendTo(obj.from, obj.command, result, obj.callback);
            }
        } catch (error) {
            this.adapter.log.error(`[Import] Failed to process CSV: ${error.message}`);
            if (obj.callback) {
                this.adapter.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
            }
        }
    }

    /**
     * Parses and processes the CSV content
     *
     * @param {string} type - gas, water, electricity
     * @param {string} meterName - technical name of the meter
     * @param {string} content - raw CSV content (base64 or string)
     * @param {string} _format - format profile (e.g. 'ehb')
     */
    async processImport(type, meterName, content, _format) {
        // Decode base64 if necessary
        let csvBody = content;
        if (content.startsWith('data:') && content.includes('base64,')) {
            const base64Data = content.split('base64,')[1];
            csvBody = Buffer.from(base64Data, 'base64').toString('utf-8');
        }

        const lines = csvBody.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) {
            throw new Error('Die Datei ist leer oder enthält zu wenige Daten.');
        }

        // Detect separator by looking at the first 5 lines and picking the most frequent separator
        const possibleSeparators = [';', ',', '|', '\t'];
        let separator = ';';
        let maxTotalCols = 0;

        for (const sep of possibleSeparators) {
            let totalCols = 0;
            for (let i = 0; i < Math.min(lines.length, 5); i++) {
                totalCols += lines[i].split(sep).length;
            }
            if (totalCols > maxTotalCols) {
                maxTotalCols = totalCols;
                separator = sep;
            }
        }

        let headers = lines[0].split(separator).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));

        // Column detection
        let dateIdx = -1;
        let valueIdx = -1;

        const dateHeaders = ['date', 'datum', 'zeit', 'timestamp', 'zeitstempel', 'day', 'tag', 'ablesedatum'];
        const valueHeaders = [
            'value',
            'wert',
            'reading',
            'zählerstand',
            'stand',
            'verbrauch',
            'amount',
            'kwh',
            'm³',
            'm3',
            'ablesewert',
            'wasserstand',
            'gasstand',
            'stromstand',
            'kaltwasser',
            'warmwasser',
            'energie',
        ];

        dateIdx = headers.findIndex(h => dateHeaders.some(dh => h.includes(dh)));
        valueIdx = headers.findIndex(h => valueHeaders.some(vh => h.includes(vh)));

        // Special case: If header is just numbers or very common terms, try searching for the specific media name
        if (valueIdx === -1) {
            const mediaTerms = { gas: 'gas', water: 'wasser', electricity: 'strom', pv: 'pv' };
            const term = mediaTerms[type];
            valueIdx = headers.findIndex(h => h.includes(term));
        }

        // Fallback to defaults if not found by header
        if (dateIdx === -1) {
            dateIdx = 0;
        }
        if (valueIdx === -1) {
            valueIdx = 1;
        }

        this.adapter.log.info(
            `[Import] Found headers: [${headers.join(' | ')}]. Selected columns: Date="${headers[dateIdx]}" (Index ${dateIdx}), Value="${headers[valueIdx]}" (Index ${valueIdx}) (Separator: "${separator}")`,
        );

        // Check if first line is actually data (contains numbers or date-like string)
        let startIndex = 1;
        const firstLineCols = lines[0].split(separator).map(c => c.trim().replace(/^"|"$/g, ''));
        const dateStrFirst = firstLineCols[dateIdx] || '';
        const isFirstLineData = !isNaN(parseFloat(firstLineCols[valueIdx])) || dateStrFirst.includes(':');

        if (isFirstLineData) {
            const hasHeaderText = headers.some(h =>
                [...dateHeaders, ...valueHeaders].some(term => h.includes(term) && h.length > 2),
            );
            if (!hasHeaderText) {
                startIndex = 0;
                this.adapter.log.info('[Import] First line appears to be data, including it.');
            }
        }

        const dataPoints = [];
        for (let i = startIndex; i < lines.length; i++) {
            const columns = lines[i].split(separator).map(c => c.trim().replace(/^"|"$/g, ''));
            if (columns.length <= Math.max(dateIdx, valueIdx)) {
                continue;
            }

            const dateStr = columns[dateIdx];
            const valueStr = columns[valueIdx];

            let timestamp = null;
            let value = calculator.ensureNumber(valueStr);

            // Robust Date Parsing
            timestamp = calculator.parseDateString(dateStr);

            if (!timestamp && !isNaN(Number(dateStr)) && dateStr.length > 10) {
                // Possibly Unix Timestamp (ms)
                timestamp = new Date(Number(dateStr));
            }

            if (timestamp && !isNaN(timestamp.getTime()) && value > 0) {
                dataPoints.push({ timestamp, value });
            }
        }

        if (dataPoints.length === 0) {
            this.adapter.log.warn(
                `[Import] No valid data found. Headers: ${headers.join('|')}, First Data Line: ${lines[1]}`,
            );
            throw new Error(
                'Keine gültigen Datenpunkte gefunden. Bitte sicherstellen, dass die Datei Spalten für Datum und Wert enthält.',
            );
        }

        // Sort by timestamp
        dataPoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        this.adapter.log.info(
            `[Import] Found ${dataPoints.length} valid records from ${dataPoints[0].timestamp.toLocaleDateString()} to ${dataPoints[dataPoints.length - 1].timestamp.toLocaleDateString()}`,
        );

        // Pure History Import: Aggregates only
        const basePath = `${type}.${meterName}`;

        // Ensure channel and metadata structure
        await this.ensureMeterObjects(type, meterName);

        const currentYear = new Date().getFullYear();
        const yearStats = {};

        let count = 0;
        for (const dp of dataPoints) {
            try {
                const year = dp.timestamp.getFullYear();

                // Group by year for history states
                if (year < currentYear) {
                    if (!yearStats[year]) {
                        yearStats[year] = { consumption: 0, volume: 0, count: 0 };
                        await stateManager.createHistoryStructure(this.adapter, type, meterName, year);
                    }
                    yearStats[year].consumption += dp.value;
                    if (type === 'gas') {
                        const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
                        const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
                        yearStats[year].volume += dp.value / (brennwert * zZahl);
                    }
                    yearStats[year].count++;
                }

                // No individual writing to meterReading state needed for pure history
                count++;
            } catch (e) {
                this.adapter.log.error(`[Import] Error writing data point ${dp.timestamp.toISOString()}: ${e.message}`);
            }
        }

        // Write aggregated history states
        for (const year in yearStats) {
            const hPath = `${basePath}.history.${year}`;
            const stats = yearStats[year];
            await this.adapter.setStateAsync(
                `${hPath}.consumption`,
                calculator.roundToDecimals(stats.consumption, 2),
                true,
            );
            if (type === 'gas') {
                await this.adapter.setStateAsync(`${hPath}.volume`, calculator.roundToDecimals(stats.volume, 2), true);
            }
            // Recalculate costs for history year roughly using current price
            const configType = getConfigType(type);
            const price = this.adapter.config[`${configType}Preis`] || 0;
            await this.adapter.setStateAsync(
                `${hPath}.costs`,
                calculator.roundToDecimals(stats.consumption * price, 2),
                true,
            );
        }

        // Update metadata for pure history import
        await this.adapter.setStateAsync(`${basePath}.lastImport`, Date.now(), true);

        return {
            success: true,
            count: count,
            first: dataPoints[0].timestamp.toLocaleDateString(),
            last: dataPoints[dataPoints.length - 1].timestamp.toLocaleDateString(),
        };
    }

    /**
     * Ensures that the minimal object structure for a meter exists (FLAT structure for imports)
     *
     * @param {string} type - gas, water, electricity, pv
     * @param {string} meterName - name of the meter
     */
    async ensureMeterObjects(type, meterName) {
        const basePath = `${type}.${meterName}`;
        const typeDe = { gas: 'Gas', water: 'Wasser', electricity: 'Strom', pv: 'PV' };

        // 1. Create Channel for Type (if not exists)
        await this.adapter.setObjectNotExistsAsync(type, {
            type: 'channel',
            common: { name: typeDe[type] || type },
            native: {},
        });

        // 2. Create Channel for Meter
        await this.adapter.setObjectNotExistsAsync(basePath, {
            type: 'channel',
            common: { name: `Zähler: ${meterName}` },
            native: { meterName },
        });

        // 3. Create metadata (last import timestamp)
        await this.adapter.setObjectNotExistsAsync(`${basePath}.lastImport`, {
            type: 'state',
            common: {
                name: 'Letzter Import',
                type: 'number',
                role: 'value.time',
                read: true,
                write: false,
                def: 0,
            },
            native: {},
        });
    }
}

module.exports = ImportManager;
