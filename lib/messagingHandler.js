'use strict';

const { getConfigType } = require('./utils/typeMapper');
const { formatLocalDate } = require('./utils/helpers');

/**
 * MessagingHandler handles all incoming adapter messages
 * and outgoing notifications.
 */
class MessagingHandler {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Is called when adapter receives message from config window.
     *
     * @param {Record<string, any>} obj - Message object from config
     */
    async handleMessage(obj) {
        if (!obj || !obj.command) {
            return;
        }

        this.adapter.log.debug(`[onMessage] Received command: ${obj.command} from ${obj.from}`);

        if (obj.command === 'getMeters') {
            try {
                // Get the utility type from the message
                const type = obj.message?.type;

                if (!type) {
                    this.adapter.sendTo(obj.from, obj.command, [], obj.callback);
                    return;
                }

                // Get all meters for this type from multiMeterManager
                const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

                if (meters.length === 0) {
                    this.adapter.sendTo(obj.from, obj.command, [], obj.callback);
                    return;
                }

                // Build options array: [{ value: "main", label: "Hauptzähler (main)" }, ...]
                const result = meters.map(meter => ({
                    value: meter.name,
                    label: meter.displayName ? `${meter.displayName} (${meter.name})` : meter.name,
                }));

                this.adapter.sendTo(obj.from, obj.command, result, obj.callback);
            } catch (error) {
                this.adapter.log.error(`Error in getMeters callback: ${error.message}`);
                this.adapter.sendTo(obj.from, obj.command, [], obj.callback);
            }
        } else if (obj.command === 'getInstances') {
            try {
                const instances = await this.adapter.getForeignObjectsAsync('system.adapter.*', 'instance');
                const messengerTypes = [
                    'telegram',
                    'pushover',
                    'email',
                    'whatsapp',
                    'whatsapp-cmb',
                    'signal',
                    'signal-cmb',
                    'discord',
                    'notification-manager',
                ];
                const result = [{ value: '', label: 'kein' }];

                for (const id in instances) {
                    const parts = id.split('.');
                    const adapterName = parts[parts.length - 2];
                    if (messengerTypes.includes(adapterName)) {
                        const instanceName = id.replace('system.adapter.', '');
                        result.push({ value: instanceName, label: instanceName });
                    }
                }

                this.adapter.sendTo(obj.from, obj.command, result, obj.callback);
            } catch (error) {
                this.adapter.log.error(`Error in getInstances callback: ${error.message}`);
                this.adapter.sendTo(obj.from, obj.command, [{ value: '', label: 'Fehler' }], obj.callback);
            }
        } else if (obj.command === 'testNotification') {
            this.adapter.log.info(`[testNotification] Message data: ${JSON.stringify(obj.message)}`);
            try {
                let instance = obj.message?.instance;

                // Handle cases where Admin UI doesn't resolve the placeholder ${data.notificationInstance}
                if (!instance || instance.includes('${data.') || instance === 'none' || instance === 'kein') {
                    this.adapter.log.info('[testNotification] Using instance from saved configuration as fallback');
                    instance = this.adapter.config.notificationInstance;
                }

                if (!instance || instance === 'none' || instance === 'kein') {
                    this.adapter.sendTo(
                        obj.from,
                        obj.command,
                        { error: 'Keine Instanz ausgewählt. Bitte auswählen und einmal SPEICHERN!' },
                        obj.callback,
                    );
                    return;
                }

                this.adapter.log.info(`Sending test notification via ${instance}...`);

                const testMsg =
                    '🔔 *Nebenkosten-Monitor Test*\n\nDiese Nachricht bestätigt, dass deine Benachrichtigungseinstellungen korrekt sind! 🚀';

                // We wrap sendTo in a promise to capture success/error for the popup
                const sendResult = await new Promise(resolve => {
                    const timeout = this.adapter.setTimeout(() => {
                        resolve({
                            error: `Timeout: ${instance} hat nicht rechtzeitig geantwortet. Ist der Adapter aktiv?`,
                        });
                    }, 10000);

                    this.adapter.sendTo(
                        instance,
                        'send',
                        {
                            text: testMsg,
                            message: testMsg,
                            parse_mode: 'Markdown',
                        },
                        res => {
                            this.adapter.clearTimeout(timeout);
                            this.adapter.log.info(
                                `[testNotification] Response from ${instance}: ${JSON.stringify(res)}`,
                            );

                            if (res && (res.error || res.err)) {
                                resolve({ error: `Fehler von ${instance}: ${res.error || res.err}` });
                            } else if (
                                res &&
                                (res.sent ||
                                    res.result === 'OK' ||
                                    typeof res === 'string' ||
                                    (res.response && res.response.includes('250')))
                            ) {
                                // Specific handling for email (res.response contains SMTP code) and others
                                resolve({ result: `Erfolgreich! Antwort von ${instance}: ${JSON.stringify(res)}` });
                            } else {
                                // Fallback success if response is there but format unknown
                                resolve({ result: `Test-Nachricht an ${instance} übergeben.` });
                            }
                        },
                    );
                });

                // Respond to Admin UI - this triggers the popup
                if (obj.callback) {
                    this.adapter.sendTo(obj.from, obj.command, sendResult, obj.callback);
                }
            } catch (error) {
                this.adapter.log.error(`Failed to send test notification: ${error.message}`);
                if (obj.callback) {
                    this.adapter.sendTo(
                        obj.from,
                        obj.command,
                        { error: `Interner Fehler: ${error.message}` },
                        obj.callback,
                    );
                }
            }
        } else {
            this.adapter.log.warn(`[onMessage] Unknown command: ${obj.command}`);
            if (obj.callback) {
                this.adapter.sendTo(obj.from, obj.command, { error: 'Unknown command' }, obj.callback);
            }
        }
    }

    /**
     * Checks if any notifications need to be sent (reminders for billing period end or contract change)
     */
    async checkNotifications() {
        if (!this.adapter.config.notificationEnabled || !this.adapter.config.notificationInstance) {
            return;
        }

        const types = ['gas', 'water', 'electricity', 'pv'];
        const typesDe = { gas: 'Gas', water: 'Wasser', electricity: 'Strom', pv: 'PV' };

        for (const type of types) {
            const configType = getConfigType(type);
            const enabledKey = `notification${configType.charAt(0).toUpperCase() + configType.slice(1)}Enabled`;

            if (!this.adapter.config[enabledKey] || !this.adapter.config[`${configType}Aktiv`]) {
                continue;
            }

            // Get all meters for this type (main + additional)
            const allMeters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
            if (allMeters.length === 0) {
                continue;
            }

            // Filter meters based on configuration
            // If notificationXXXMeters is empty or undefined, notify ALL meters
            const configKey = `notification${configType.charAt(0).toUpperCase() + configType.slice(1)}Meters`;
            const selectedMeters = this.adapter.config[configKey];

            let metersToNotify = allMeters;
            if (selectedMeters && Array.isArray(selectedMeters) && selectedMeters.length > 0) {
                // Filter: only notify selected meters
                metersToNotify = allMeters.filter(meter => selectedMeters.includes(meter.name));
            }

            // Check notifications for each meter individually
            for (const meter of metersToNotify) {
                const basePath = `${type}.${meter.name}`;
                const meterLabel = meter.displayName || meter.name;

                // Get current days remaining for THIS meter
                const daysRemainingState = await this.adapter.getStateAsync(`${basePath}.billing.daysRemaining`);
                const daysRemaining = typeof daysRemainingState?.val === 'number' ? daysRemainingState.val : 999;
                const periodEndState = await this.adapter.getStateAsync(`${basePath}.billing.periodEnd`);
                const periodEnd = periodEndState?.val || '--.--.----';

                // 1. BILLING END REMINDER (Zählerstand ablesen)
                if (this.adapter.config.notificationBillingEnabled) {
                    const billingSent = await this.adapter.getStateAsync(`${basePath}.billing.notificationSent`);
                    const billingDaysThreshold = this.adapter.config.notificationBillingDays || 7;

                    if (billingSent?.val !== true && daysRemaining <= billingDaysThreshold) {
                        const message =
                            `🔔 *Nebenkosten-Monitor: Zählerstand ablesen*\n\n` +
                            `Dein Abrechnungszeitraum für *${typesDe[type]} (${meterLabel})* endet in ${daysRemaining} Tagen!\n\n` +
                            `📅 Datum: ${periodEnd}\n\n` +
                            `Bitte trage den Zählerstand rechtzeitig ein:\n` +
                            `1️⃣ Datenpunkt: ${basePath}.billing.endReading\n` +
                            `2️⃣ Zeitraum abschließen: ${basePath}.billing.closePeriod = true`;

                        await this.sendNotification(basePath, message, 'billing');
                    }
                }

                // 2. CONTRACT CHANGE REMINDER (Tarif wechseln / Kündigungsfrist)
                if (this.adapter.config.notificationChangeEnabled) {
                    const changeSent = await this.adapter.getStateAsync(`${basePath}.billing.notificationChangeSent`);
                    const changeDaysThreshold = this.adapter.config.notificationChangeDays || 60;

                    if (changeSent?.val !== true && daysRemaining <= changeDaysThreshold) {
                        const message =
                            `💡 *Nebenkosten-Monitor: Tarif-Check*\n\n` +
                            `Dein Vertrag für *${typesDe[type]} (${meterLabel})* endet am ${periodEnd}.\n\n` +
                            `⏰ Noch ${daysRemaining} Tage bis zum Ende des Zeitraums.\n\n` +
                            `Jetzt ist ein guter Zeitpunkt, um Preise zu vergleichen oder die Kündigungsfrist zu prüfen! 💸`;

                        await this.sendNotification(basePath, message, 'change');
                    }
                }
            }
        }

        await this.checkMonthlyReport();
    }

    /**
     * Checks and sends monthly status report
     *
     * @param {boolean} forceRun - If true, bypass all checks and send immediately
     */
    async checkMonthlyReport(forceRun = false) {
        if (
            !forceRun &&
            (!this.adapter.config.notificationMonthlyEnabled || !this.adapter.config.notificationInstance)
        ) {
            return;
        }

        if (!this.adapter.config.notificationInstance) {
            this.adapter.log.warn('Cannot send monthly report: No notification instance configured');
            return;
        }

        const today = new Date();
        const configDay = this.adapter.config.notificationMonthlyDay || 1;

        // Check if today is the configured day (skip if forced)
        if (!forceRun && today.getDate() !== configDay) {
            return;
        }

        // Check if already sent today (skip if forced)
        // Must use the local date: toISOString() would return the previous day
        // between midnight and the UTC offset, so the guard failed to match and
        // the report was sent a second time (e.g. at 00:00 and again at 02:00 CEST).
        const lastSentState = await this.adapter.getStateAsync('info.lastMonthlyReport');
        const todayStr = formatLocalDate(today);

        if (!forceRun && lastSentState?.val === todayStr) {
            return;
        }

        // Generate Report
        let message = `📊 *Monats-Report* (${today.toLocaleDateString('de-DE')})\n\n`;
        const types = ['electricity', 'gas', 'water', 'pv'];
        const typesDe = { electricity: '⚡️ Strom', gas: '🔥 Gas', water: '💧 Wasser', pv: '☀️ PV' };
        let hasData = false;

        for (const type of types) {
            const configType = getConfigType(type); // strom, gas, wasser, pv

            // Skip if utility type is not active
            if (!this.adapter.config[`${configType}Aktiv`]) {
                continue;
            }

            // Skip if notifications are not enabled for this type (unless forced)
            const enabledKey = `notification${configType.charAt(0).toUpperCase() + configType.slice(1)}Enabled`;
            if (!forceRun && !this.adapter.config[enabledKey]) {
                continue;
            }

            hasData = true;
            message += `*${typesDe[type]}*\n`;

            // Check if this is a multi-meter setup
            const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
            const isMultiMeter = meters.length > 1;

            // Consumption - use totals for multi-meter, main meter for single meter
            let yearlyState, totalYearlyState, paidTotalState, balanceState;

            if (isMultiMeter) {
                // Multi-meter: use totals
                yearlyState = await this.adapter.getStateAsync(`${type}.totals.consumption.yearly`);
                totalYearlyState = await this.adapter.getStateAsync(`${type}.totals.costs.totalYearly`);
                // Balance/paidTotal not available in totals, use first meter as representative
                const firstMeter = meters[0];
                if (firstMeter) {
                    paidTotalState = await this.adapter.getStateAsync(`${type}.${firstMeter.name}.costs.paidTotal`);
                    balanceState = await this.adapter.getStateAsync(`${type}.${firstMeter.name}.costs.balance`);
                }
                message += `(${meters.length} Zähler gesamt)\n`;
            } else if (meters.length === 1) {
                // Single meter: use first meter values (new path structure)
                const meter = meters[0];
                const basePath = `${type}.${meter.name}`;
                yearlyState = await this.adapter.getStateAsync(`${basePath}.consumption.yearly`);
                totalYearlyState = await this.adapter.getStateAsync(`${basePath}.costs.totalYearly`);
                paidTotalState = await this.adapter.getStateAsync(`${basePath}.costs.paidTotal`);
                balanceState = await this.adapter.getStateAsync(`${basePath}.costs.balance`);
            } else {
                // No meters configured - skip this type
                continue;
            }

            let val = yearlyState?.val || 0;
            // Round
            val = Math.round(val * 100) / 100;

            // Get unit
            const units = {
                electricity: 'kWh',
                gas: 'kWh',
                water: 'm³',
                pv: 'kWh',
            };
            const displayUnit = units[type];

            message += `Verbrauch (Jahr): ${val} ${displayUnit}\n`;

            // Costs
            const cost = (totalYearlyState?.val || 0).toFixed(2);
            message += `Verbrauchs-Kosten: ${cost} €\n`;

            // Only show balance if Abschlag is configured (paidTotal > 0)
            const paid = paidTotalState?.val || 0;
            if (paid > 0) {
                const balance = balanceState?.val || 0;
                const balanceStr = balance.toFixed(2);
                const status = balance > 0 ? '❌ Nachzahlung' : '✅ Guthaben';

                message += `Bezahlt: ${paid.toFixed(2)} €\n`;
                message += `Saldo: *${balanceStr} €* (${status})\n`;
            }

            message += `\n`;
        }

        if (hasData) {
            await this.sendNotification('system', message, 'report');
            // Update state to prevent resending
            await this.adapter.setStateAsync('info.lastMonthlyReport', todayStr, true);
        }
    }

    /**
     * Helper to send notification and mark as sent
     *
     * @param {string} pathOrType - Full path like "gas.main" or just "system" for reports
     * @param {string} message - Message text
     * @param {string} reminderType - billing, change, or report
     */
    async sendNotification(pathOrType, message, reminderType) {
        try {
            const instance = this.adapter.config.notificationInstance;
            this.adapter.log.info(`Sending ${reminderType} notification for ${pathOrType} via ${instance}`);

            await this.adapter.sendToAsync(instance, 'send', {
                text: message,
                message: message,
                parse_mode: 'Markdown',
            });

            // Mark as sent (only for billing/change)
            // pathOrType is now the full path like "gas.main" or "gas.werkstatt"
            if (reminderType !== 'report') {
                const stateKey = reminderType === 'change' ? 'notificationChangeSent' : 'notificationSent';
                await this.adapter.setStateAsync(`${pathOrType}.billing.${stateKey}`, true, true);
            }
        } catch (error) {
            this.adapter.log.error(`Failed to send ${reminderType} notification for ${pathOrType}: ${error.message}`);
        }
    }
}

module.exports = MessagingHandler;
