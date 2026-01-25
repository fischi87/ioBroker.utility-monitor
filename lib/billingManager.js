'use strict';

const calculator = require('./calculator');
const { getConfigType } = require('./utils/typeMapper');
const billingHelper = require('./utils/billingHelper');

/**
 * BillingManager handles all cost calculations,
 * billing period management, and automatic resets.
 */
class BillingManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Updates cost calculations for a utility type
     *
     * @param {string} type - Utility type
     */
    async updateCosts(type) {
        const configType = getConfigType(type);

        // Get price and basic charge from config
        const priceKey = `${configType}Preis`;
        const grundgebuehrKey = `${configType}Grundgebuehr`;
        const jahresgebuehrKey = `${configType}Jahresgebuehr`;
        const price = this.adapter.config[priceKey] || 0;
        const basicChargeMonthly = this.adapter.config[grundgebuehrKey] || 0;
        const annualFeePerYear = this.adapter.config[jahresgebuehrKey] || 0;

        const htNtEnabledKey = `${configType}HtNtEnabled`;
        const htNtEnabled = this.adapter.config[htNtEnabledKey] || false;

        if (price === 0 && !htNtEnabled) {
            this.adapter.log.debug(`No price configured for ${type} (${configType}) and HT/NT is disabled`);
            return;
        }

        // Get current consumptions
        const dailyState = await this.adapter.getStateAsync(`${type}.consumption.daily`);
        const monthlyState = await this.adapter.getStateAsync(`${type}.consumption.monthly`);
        const yearlyState = await this.adapter.getStateAsync(`${type}.consumption.yearly`);

        const daily = typeof dailyState?.val === 'number' ? dailyState.val : 0;
        const monthly = typeof monthlyState?.val === 'number' ? monthlyState.val : 0;
        let yearly = typeof yearlyState?.val === 'number' ? yearlyState.val : 0;

        // Apply manual adjustment
        const adjustmentState = await this.adapter.getStateAsync(`${type}.adjustment.value`);
        const adjustment = typeof adjustmentState?.val === 'number' ? adjustmentState.val : 0;
        if (adjustment !== 0) {
            if (type === 'gas') {
                const yearlyVolumeState = await this.adapter.getStateAsync(`${type}.consumption.yearlyVolume`);
                const yearlyVolume = typeof yearlyVolumeState?.val === 'number' ? yearlyVolumeState.val : 0;
                const totalM3 = yearlyVolume + adjustment;
                const brennwert = this.adapter.config.gasBrennwert || 11.5;
                const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
                yearly = calculator.convertGasM3ToKWh(totalM3, brennwert, zZahl);
            } else {
                yearly += adjustment;
            }
        }

        // Consumption cost calculation
        let dailyConsumptionCost, monthlyConsumptionCost, yearlyConsumptionCost;

        if (htNtEnabled) {
            const htPrice = this.adapter.config[`${configType}HtPrice`] || 0;
            const ntPrice = this.adapter.config[`${configType}NtPrice`] || 0;

            const dailyHT = (await this.adapter.getStateAsync(`${type}.consumption.dailyHT`))?.val || 0;
            const dailyNT = (await this.adapter.getStateAsync(`${type}.consumption.dailyNT`))?.val || 0;
            const monthlyHT = (await this.adapter.getStateAsync(`${type}.consumption.monthlyHT`))?.val || 0;
            const monthlyNT = (await this.adapter.getStateAsync(`${type}.consumption.monthlyNT`))?.val || 0;

            let yearlyHT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyHT`))?.val || 0;
            const yearlyNT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyNT`))?.val || 0;

            if (adjustment !== 0) {
                if (type === 'gas') {
                    const brennwert = this.adapter.config.gasBrennwert || 11.5;
                    const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
                    yearlyHT = Number(yearlyHT) + calculator.convertGasM3ToKWh(adjustment, brennwert, zZahl);
                } else {
                    yearlyHT = Number(yearlyHT) + Number(adjustment);
                }
            }

            const dailyRes = billingHelper.calculateHTNTCosts(dailyHT, htPrice, dailyNT, ntPrice);
            const monthlyRes = billingHelper.calculateHTNTCosts(monthlyHT, htPrice, monthlyNT, ntPrice);
            const yearlyRes = billingHelper.calculateHTNTCosts(yearlyHT, htPrice, yearlyNT, ntPrice);

            dailyConsumptionCost = dailyRes.total;
            monthlyConsumptionCost = monthlyRes.total;
            yearlyConsumptionCost = yearlyRes.total;

            await this.adapter.setStateAsync(`${type}.costs.dailyHT`, dailyRes.htCosts, true);
            await this.adapter.setStateAsync(`${type}.costs.dailyNT`, dailyRes.ntCosts, true);
            await this.adapter.setStateAsync(`${type}.costs.monthlyHT`, monthlyRes.htCosts, true);
            await this.adapter.setStateAsync(`${type}.costs.monthlyNT`, monthlyRes.ntCosts, true);
            await this.adapter.setStateAsync(`${type}.costs.yearlyHT`, yearlyRes.htCosts, true);
            await this.adapter.setStateAsync(`${type}.costs.yearlyNT`, yearlyRes.ntCosts, true);
        } else {
            dailyConsumptionCost = calculator.calculateCost(daily, price);
            monthlyConsumptionCost = calculator.calculateCost(monthly, price);
            yearlyConsumptionCost = calculator.calculateCost(yearly, price);
        }

        // Basic charge calculation
        const monthsSinceContract = await this._calculateMonthsSinceStart(type, configType);

        const charges = billingHelper.calculateAccumulatedCharges(
            basicChargeMonthly,
            annualFeePerYear,
            monthsSinceContract,
        );
        const basicChargeAccumulated = charges.basicCharge;
        const annualFeeAccumulated = charges.annualFee;
        const totalYearlyCost = yearlyConsumptionCost + charges.total;

        // Update basic charge states
        await this.adapter.setStateAsync(
            `${type}.costs.daily`,
            calculator.roundToDecimals(dailyConsumptionCost, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.monthly`,
            calculator.roundToDecimals(monthlyConsumptionCost, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.yearly`,
            calculator.roundToDecimals(yearlyConsumptionCost, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.totalYearly`,
            calculator.roundToDecimals(totalYearlyCost, 2),
            true,
        );
        await this.adapter.setStateAsync(`${type}.costs.annualFee`, annualFeeAccumulated, true);
        await this.adapter.setStateAsync(`${type}.costs.basicCharge`, basicChargeAccumulated, true);

        // Abschlag / Installment
        const abschlagKey = `${configType}Abschlag`;
        const monthlyAbschlag = this.adapter.config[abschlagKey] || 0;

        const balanceRes = billingHelper.calculateBalance(monthlyAbschlag, monthsSinceContract, totalYearlyCost);
        await this.adapter.setStateAsync(`${type}.costs.paidTotal`, balanceRes.paid, true);
        await this.adapter.setStateAsync(`${type}.costs.balance`, balanceRes.balance, true);
    }

    /**
     * Calculates months since contract or year start
     *
     * @param {string} type - Utility type
     * @param {string} configType - Mapped config type
     * @returns {Promise<number>} Number of months (at least 1)
     */
    async _calculateMonthsSinceStart(type, configType) {
        const contractStartDate = this.adapter.config[`${configType}ContractStart`];
        let startDate;

        if (contractStartDate) {
            startDate = calculator.parseGermanDate(contractStartDate);
        }

        if (!startDate || isNaN(startDate.getTime())) {
            const lastYearStart = await this.adapter.getStateAsync(`${type}.statistics.lastYearStart`);
            startDate = new Date(lastYearStart?.val || Date.now());
        }

        return Math.max(1, calculator.getMonthsDifference(startDate, new Date()) + 1);
    }

    /**
     * Closes the billing period and archives data
     *
     * @param {string} type - Utility type
     */
    async closeBillingPeriod(type) {
        this.adapter.log.info(`🔔 Schließe Abrechnungszeitraum für ${type}...`);

        const endReadingState = await this.adapter.getStateAsync(`${type}.billing.endReading`);
        const endReading = typeof endReadingState?.val === 'number' ? endReadingState.val : null;

        if (!endReading || endReading <= 0) {
            this.adapter.log.error(
                `❌ Kein gültiger Endzählerstand für ${type}. Bitte trage zuerst einen Wert in ${type}.billing.endReading ein!`,
            );
            await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        const configType = getConfigType(type);
        const contractStartKey = `${configType}ContractStart`;
        const contractStart = this.adapter.config[contractStartKey];

        if (!contractStart) {
            this.adapter.log.error(`❌ Kein Vertragsbeginn für ${type} konfiguriert. Kann Jahr nicht bestimmen.`);
            await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        const startDate = calculator.parseGermanDate(contractStart);
        if (!startDate) {
            this.adapter.log.error(`❌ Ungültiges Datum-Format für Vertragsbeginn: ${contractStart}`);
            await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        const year = startDate.getFullYear();

        // Check if this is a multi-meter setup
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
        const isMultiMeter = meters.length > 1;

        // Archives - use totals for multi-meter, main meter for single meter
        let yearlyState, totalYearlyState, balanceState;

        if (isMultiMeter) {
            // Multi-meter: use totals
            yearlyState = await this.adapter.getStateAsync(`${type}.totals.consumption.yearly`);
            totalYearlyState = await this.adapter.getStateAsync(`${type}.totals.costs.totalYearly`);
            // Balance is not available in totals, use main meter's balance as representative
            balanceState = await this.adapter.getStateAsync(`${type}.costs.balance`);
            this.adapter.log.info(`Archiving multi-meter totals for ${type} (${meters.length} meters)`);
        } else {
            // Single meter: use main meter values
            yearlyState = await this.adapter.getStateAsync(`${type}.consumption.yearly`);
            totalYearlyState = await this.adapter.getStateAsync(`${type}.costs.totalYearly`);
            balanceState = await this.adapter.getStateAsync(`${type}.costs.balance`);
        }

        const yearly = yearlyState?.val || 0;
        const totalYearly = totalYearlyState?.val || 0;
        const balance = balanceState?.val || 0;

        const htNtEnabledKey = `${configType}HtNtEnabled`;
        const htNtEnabled = this.adapter.config[htNtEnabledKey] || false;

        // ... truncated history creation for brevity, assuming standard implementation ...
        // In reality, I should copy the full logic from main.js but adapt 'this' to 'this.adapter'
        // I will do that now.

        this.adapter.log.info(`📦 Archiviere Daten für ${type} Jahr ${year}...`);

        await this.adapter.setObjectNotExistsAsync(`${type}.history`, {
            type: 'channel',
            common: { name: 'Historie' },
            native: {},
        });
        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}`, {
            type: 'channel',
            common: { name: `Jahr ${year}` },
            native: {},
        });

        const consumptionUnit = type === 'gas' ? 'kWh' : type === 'water' ? 'm³' : 'kWh';

        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.yearly`, {
            type: 'state',
            common: {
                name: `Jahresverbrauch ${year}`,
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                unit: consumptionUnit,
            },
            native: {},
        });
        await this.adapter.setStateAsync(`${type}.history.${year}.yearly`, yearly, true);

        if (htNtEnabled) {
            const htNtStates = [
                { id: 'yearlyHT', name: 'Haupttarif (HT)' },
                { id: 'yearlyNT', name: 'Nebentarif (NT)' },
            ];
            for (const htn of htNtStates) {
                await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.${htn.id}`, {
                    type: 'state',
                    common: {
                        name: `Jahresverbrauch ${year} ${htn.name}`,
                        type: 'number',
                        role: 'value',
                        read: true,
                        write: false,
                        unit: consumptionUnit,
                    },
                    native: {},
                });
            }
            const yHT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyHT`))?.val || 0;
            const yNT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyNT`))?.val || 0;
            await this.adapter.setStateAsync(`${type}.history.${year}.yearlyHT`, yHT, true);
            await this.adapter.setStateAsync(`${type}.history.${year}.yearlyNT`, yNT, true);
        }

        if (type === 'gas' || type === 'water') {
            const yearlyVolume = (await this.adapter.getStateAsync(`${type}.consumption.yearlyVolume`))?.val || 0;
            await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.yearlyVolume`, {
                type: 'state',
                common: {
                    name: `Jahresverbrauch ${year} (m³)`,
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'm³',
                },
                native: {},
            });
            await this.adapter.setStateAsync(`${type}.history.${year}.yearlyVolume`, yearlyVolume, true);
        }

        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.totalYearly`, {
            type: 'state',
            common: {
                name: `Gesamtkosten ${year}`,
                type: 'number',
                role: 'value.money',
                read: true,
                write: false,
                unit: '€',
            },
            native: {},
        });
        await this.adapter.setStateAsync(`${type}.history.${year}.totalYearly`, totalYearly, true);

        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.balance`, {
            type: 'state',
            common: {
                name: `Bilanz ${year}`,
                type: 'number',
                role: 'value.money',
                read: true,
                write: false,
                unit: '€',
            },
            native: {},
        });
        await this.adapter.setStateAsync(`${type}.history.${year}.balance`, balance, true);

        // Reset and Info
        await this.adapter.setStateAsync(`${type}.billing.newInitialReading`, endReading, true);
        await this.adapter.setStateAsync(`${type}.consumption.yearly`, 0, true);
        if (htNtEnabled) {
            await this.adapter.setStateAsync(`${type}.consumption.yearlyHT`, 0, true);
            await this.adapter.setStateAsync(`${type}.consumption.yearlyNT`, 0, true);
        }
        if (type === 'gas') {
            await this.adapter.setStateAsync(`${type}.consumption.yearlyVolume`, 0, true);
        }
        await this.adapter.setStateAsync(`${type}.costs.yearly`, 0, true);
        await this.adapter.setStateAsync(`${type}.costs.totalYearly`, 0, true);
        // NOTE: basicCharge and annualFee are NOT reset - they stay from config!
        // User is responsible for updating config if tariff changes
        await this.adapter.setStateAsync(`${type}.costs.balance`, 0, true);
        await this.adapter.setStateAsync(`${type}.costs.paidTotal`, 0, true);
        await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
        await this.adapter.setStateAsync(`${type}.billing.notificationSent`, false, true);
        await this.adapter.setStateAsync(`${type}.billing.notificationChangeSent`, false, true);

        // Update lastYearStart to the contract anniversary date (NOT Date.now()!)
        // This ensures the next automatic reset happens on the contract date,
        // even if the user closes the period early (e.g. 2 days before)
        const thisYearAnniversary = new Date(startDate);
        thisYearAnniversary.setFullYear(new Date().getFullYear());
        await this.adapter.setStateAsync(`${type}.statistics.lastYearStart`, thisYearAnniversary.getTime(), true);

        this.adapter.log.info(`✅ Abrechnungszeitraum ${year} für ${type} erfolgreich abgeschlossen!`);
        this.adapter.log.info(
            `💡 Tipp: Prüfe deine Adapter-Konfiguration! Hat sich dein Tarif, Abschlag oder die Grundgebühr geändert?`,
        );
    }

    /**
     * Closes the billing period for a specific meter (main or additional)
     *
     * @param {string} type - Utility type
     * @param {object} meter - Meter object from multiMeterManager
     */
    async closeBillingPeriodForMeter(type, meter) {
        const basePath = `${type}.${meter.name}`;
        const label = meter.displayName || meter.name;

        this.adapter.log.info(`🔔 Schließe Abrechnungszeitraum für ${basePath} (${label})...`);

        const endReadingState = await this.adapter.getStateAsync(`${basePath}.billing.endReading`);
        const endReading = typeof endReadingState?.val === 'number' ? endReadingState.val : null;

        if (!endReading || endReading <= 0) {
            this.adapter.log.error(
                `❌ Kein gültiger Endzählerstand für ${basePath}. Bitte trage zuerst einen Wert ein!`,
            );
            await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
            return;
        }

        // Get contract date for THIS meter (all meters have config.contractStart)
        const contractStartDate = meter.config?.contractStart;

        if (!contractStartDate) {
            this.adapter.log.error(`❌ Kein Vertragsbeginn für ${basePath} konfiguriert.`);
            await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
            return;
        }

        const startDate = calculator.parseGermanDate(contractStartDate);
        if (!startDate) {
            this.adapter.log.error(`❌ Ungültiges Datum-Format für Vertragsbeginn: ${contractStartDate}`);
            await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
            return;
        }

        const year = startDate.getFullYear();

        // Archive data for this meter
        // TODO: Implement full history archiving for individual meters
        // For now, just reset the meter

        // Reset consumption and costs for this meter
        await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, 0, true);
        if (type === 'gas') {
            await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, 0, true);
        }
        await this.adapter.setStateAsync(`${basePath}.costs.yearly`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.costs.totalYearly`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.costs.balance`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.costs.paidTotal`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationSent`, false, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationChangeSent`, false, true);

        // Update lastYearStart to contract anniversary
        const thisYearAnniversary = new Date(startDate);
        thisYearAnniversary.setFullYear(new Date().getFullYear());
        await this.adapter.setStateAsync(`${basePath}.statistics.lastYearStart`, thisYearAnniversary.getTime(), true);

        // Update totals if multiple meters exist
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }

        this.adapter.log.info(`✅ Abrechnungszeitraum ${year} für ${basePath} erfolgreich abgeschlossen!`);
        this.adapter.log.info(
            `💡 Tipp: Prüfe deine Adapter-Konfiguration! Hat sich dein Tarif, Abschlag oder die Grundgebühr geändert?`,
        );
    }

    /**
     * Updates billing countdown for all meters of a type
     * NOTE: Since v1.4.6, this updates ALL meters (main + additional)
     *
     * @param {string} type - Utility type
     */
    async updateBillingCountdown(type) {
        // Get all meters for this type
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        // Update countdown for each meter based on its contract date
        for (const meter of meters) {
            const contractStart = meter.config?.contractStart;

            if (!contractStart) {
                continue;
            }

            const startDate = calculator.parseGermanDate(contractStart);
            if (!startDate) {
                continue;
            }

            const today = new Date();
            const nextAnniversary = new Date(startDate);
            nextAnniversary.setFullYear(today.getFullYear());

            if (nextAnniversary < today) {
                nextAnniversary.setFullYear(today.getFullYear() + 1);
            }

            const msPerDay = 1000 * 60 * 60 * 24;
            const daysRemaining = Math.ceil((nextAnniversary.getTime() - today.getTime()) / msPerDay);
            const displayPeriodEnd = new Date(nextAnniversary);
            displayPeriodEnd.setDate(displayPeriodEnd.getDate() - 1);

            const basePath = `${type}.${meter.name}`;
            await this.adapter.setStateAsync(`${basePath}.billing.daysRemaining`, daysRemaining, true);
            await this.adapter.setStateAsync(
                `${basePath}.billing.periodEnd`,
                displayPeriodEnd.toLocaleDateString('de-DE'),
                true,
            );
        }
    }

    /**
     * Checks if any period resets are needed
     */
    async checkPeriodResets() {
        if (typeof this.adapter.messagingHandler?.checkNotifications === 'function') {
            await this.adapter.messagingHandler.checkNotifications();
        }

        const now = new Date();
        const types = ['gas', 'water', 'electricity', 'pv'];

        for (const type of types) {
            const configType = getConfigType(type);
            if (!this.adapter.config[`${configType}Aktiv`]) {
                continue;
            }

            // Update current price and tariff (e.g. for switching HT/NT)
            if (this.adapter.consumptionManager) {
                await this.adapter.consumptionManager.updateCurrentPrice(type);
            }

            const nowDate = new Date(now);

            // Get all meters for this type (needed for all reset checks)
            const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

            if (meters.length === 0) {
                continue;
            }

            const firstMeter = meters[0];
            const basePath = `${type}.${firstMeter.name}`;

            // Reset time window: 23:59 (last minute of the day)
            // This ensures History adapter sees clean day boundaries
            const isResetTime = nowDate.getHours() === 23 && nowDate.getMinutes() === 59;

            // Helper: Check if timestamp is from today
            const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
            const isFromToday = timestamp => timestamp >= todayStart;

            // DAILY RESET: Trigger at 23:59 if today's reset hasn't happened yet
            const lastDayStart = await this.adapter.getStateAsync(`${basePath}.statistics.lastDayStart`);
            if (lastDayStart?.val) {
                const lastResetTime = lastDayStart.val;
                const alreadyResetToday = isFromToday(lastResetTime);

                // Reset at 23:59 if not yet reset today, OR catch up if we missed it (e.g. adapter was offline)
                if (isResetTime && !alreadyResetToday) {
                    this.adapter.log.info(`Täglicher Reset für ${type} um 23:59`);
                    await this.resetDailyCounters(type);
                } else if (!alreadyResetToday && nowDate.getTime() > lastResetTime + 24 * 60 * 60 * 1000) {
                    // Catch-up: More than 24h since last reset (adapter was offline)
                    this.adapter.log.info(`Täglicher Reset für ${type} (Nachholung - Adapter war offline)`);
                    await this.resetDailyCounters(type);
                }
            }

            // WEEKLY RESET: Trigger at 23:59 on Sunday if this week's reset hasn't happened yet
            const lastWeekStart = await this.adapter.getStateAsync(`${basePath}.statistics.lastWeekStart`);
            if (lastWeekStart?.val) {
                const lastWeekTime = lastWeekStart.val;
                const isSunday = nowDate.getDay() === 0; // 0 = Sunday

                // Check if we're in a new week (more than 6 days since last reset)
                const daysSinceLastReset = (nowDate.getTime() - lastWeekTime) / (24 * 60 * 60 * 1000);
                const needsWeeklyReset = daysSinceLastReset >= 6;

                if (isSunday && isResetTime && needsWeeklyReset) {
                    this.adapter.log.info(`Wöchentlicher Reset für ${type} um 23:59`);
                    await this.resetWeeklyCounters(type);
                } else if (needsWeeklyReset && daysSinceLastReset > 7) {
                    // Catch-up: More than 7 days since last reset
                    this.adapter.log.info(`Wöchentlicher Reset für ${type} (Nachholung)`);
                    await this.resetWeeklyCounters(type);
                }
            }

            // MONTHLY RESET: Trigger at 23:59 on last day of month
            if (meters.length > 0) {
                const lastMonthStartState = await this.adapter.getStateAsync(`${basePath}.statistics.lastMonthStart`);
                if (lastMonthStartState?.val) {
                    const lastMonthTime = lastMonthStartState.val;
                    const lastMonthDate = new Date(lastMonthTime);
                    const isLastDayOfMonth =
                        new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate() === nowDate.getDate();
                    const monthChanged = nowDate.getMonth() !== lastMonthDate.getMonth();

                    if (isLastDayOfMonth && isResetTime && monthChanged) {
                        this.adapter.log.info(`Monatlicher Reset für ${type} um 23:59`);
                        await this.resetMonthlyCounters(type);
                    } else if (monthChanged && nowDate.getDate() > 1) {
                        // Catch-up: We're past the 1st of a new month and haven't reset yet
                        this.adapter.log.info(`Monatlicher Reset für ${type} (Nachholung)`);
                        await this.resetMonthlyCounters(type);
                    }
                }
            }

            // YEARLY RESET: Each meter resets individually based on ITS contract date
            // Trigger at 23:59 on the day BEFORE the anniversary (so the new year starts fresh)
            for (const meter of meters) {
                const meterBasePath = `${type}.${meter.name}`;
                const lastYearStartState = await this.adapter.getStateAsync(
                    `${meterBasePath}.statistics.lastYearStart`,
                );

                if (lastYearStartState?.val) {
                    const lastYearStartDate = new Date(lastYearStartState.val);
                    const contractStartDate = meter.config?.contractStart;

                    if (contractStartDate) {
                        const contractStart = calculator.parseGermanDate(contractStartDate);
                        if (contractStart) {
                            const annMonth = contractStart.getMonth();
                            const annDay = contractStart.getDate();

                            // Check if today is the day BEFORE the anniversary (for 23:59 reset)
                            // or if we're past it and haven't reset yet (catch-up)
                            const anniversaryThisYear = new Date(nowDate.getFullYear(), annMonth, annDay);
                            const dayBeforeAnniversary = new Date(anniversaryThisYear.getTime() - 24 * 60 * 60 * 1000);

                            const isTodayDayBefore =
                                nowDate.getMonth() === dayBeforeAnniversary.getMonth() &&
                                nowDate.getDate() === dayBeforeAnniversary.getDate();

                            const isPastAnniversary =
                                nowDate.getMonth() > annMonth ||
                                (nowDate.getMonth() === annMonth && nowDate.getDate() >= annDay);

                            const needsReset = lastYearStartDate.getFullYear() < nowDate.getFullYear();

                            if (isTodayDayBefore && isResetTime && needsReset) {
                                this.adapter.log.info(
                                    `Yearly reset for ${meterBasePath} um 23:59 (Vertragsjubiläum morgen: ${contractStartDate})`,
                                );
                                await this.resetYearlyCountersForMeter(type, meter);

                                if (meters.length > 1) {
                                    await this.adapter.multiMeterManager.updateTotalCosts(type);
                                }
                            } else if (isPastAnniversary && needsReset) {
                                // Catch-up: Anniversary has passed but we haven't reset yet
                                this.adapter.log.info(
                                    `Yearly reset for ${meterBasePath} (Nachholung - Jubiläum: ${contractStartDate})`,
                                );
                                await this.resetYearlyCountersForMeter(type, meter);

                                if (meters.length > 1) {
                                    await this.adapter.multiMeterManager.updateTotalCosts(type);
                                }
                            }
                        }
                    } else {
                        // No contract date: reset at 23:59 on December 31st (or catch up in January)
                        const isDecember31 = nowDate.getMonth() === 11 && nowDate.getDate() === 31;
                        const needsReset = nowDate.getFullYear() > lastYearStartDate.getFullYear();

                        if (isDecember31 && isResetTime && !needsReset) {
                            // Reset at 23:59 on Dec 31 for the upcoming year
                            this.adapter.log.info(`Yearly reset for ${meterBasePath} um 23:59 (Kalenderjahr)`);
                            await this.resetYearlyCountersForMeter(type, meter);

                            if (meters.length > 1) {
                                await this.adapter.multiMeterManager.updateTotalCosts(type);
                            }
                        } else if (needsReset) {
                            // Catch-up: We're in a new year but haven't reset yet
                            this.adapter.log.info(`Yearly reset for ${meterBasePath} (Nachholung - Kalenderjahr)`);
                            await this.resetYearlyCountersForMeter(type, meter);

                            if (meters.length > 1) {
                                await this.adapter.multiMeterManager.updateTotalCosts(type);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Resets daily counters
     *
     * @param {string} type - Utility type
     */
    async resetDailyCounters(type) {
        this.adapter.log.info(`Resetting daily counters for ${type}`);

        // Get all meters for this type (main + additional meters)
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        if (meters.length === 0) {
            this.adapter.log.warn(`No meters found for ${type}, skipping daily reset`);
            return;
        }

        // Reset each meter
        for (const meter of meters) {
            const basePath = `${type}.${meter.name}`;
            const label = meter.displayName || meter.name;

            this.adapter.log.debug(`Resetting daily counter for ${basePath} (${label})`);

            const dailyState = await this.adapter.getStateAsync(`${basePath}.consumption.daily`);
            const dailyValue = dailyState?.val || 0;

            // Save last day consumption
            await this.adapter.setStateAsync(`${basePath}.statistics.lastDay`, dailyValue, true);

            await this.adapter.setStateAsync(`${basePath}.consumption.daily`, 0, true);

            if (type === 'gas') {
                const dailyVolume = await this.adapter.getStateAsync(`${basePath}.consumption.dailyVolume`);
                const dailyVolumeValue = dailyVolume?.val || 0;
                // Save last day volume for gas
                await this.adapter.setStateAsync(`${basePath}.statistics.lastDayVolume`, dailyVolumeValue, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.dailyVolume`, 0, true);
            }

            // Reset HT/NT daily counters if enabled
            const configType = getConfigType(type);
            const htNtEnabled = this.adapter.config[`${configType}HtNtEnabled`] || false;
            if (htNtEnabled) {
                const dailyHT = await this.adapter.getStateAsync(`${basePath}.consumption.dailyHT`);
                const dailyNT = await this.adapter.getStateAsync(`${basePath}.consumption.dailyNT`);
                await this.adapter.setStateAsync(`${basePath}.statistics.lastDayHT`, dailyHT?.val || 0, true);
                await this.adapter.setStateAsync(`${basePath}.statistics.lastDayNT`, dailyNT?.val || 0, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.dailyHT`, 0, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.dailyNT`, 0, true);
            }

            await this.adapter.setStateAsync(`${basePath}.costs.daily`, 0, true);

            // Update lastDayStart timestamp
            await this.adapter.setStateAsync(`${basePath}.statistics.lastDayStart`, Date.now(), true);

            await this.adapter.setStateAsync(
                `${basePath}.statistics.averageDaily`,
                calculator.roundToDecimals(dailyValue, 2),
                true,
            );
        }

        // Update totals if multiple meters exist
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }
    }

    /**
     * Resets monthly counters
     *
     * @param {string} type - Utility type
     */
    async resetMonthlyCounters(type) {
        this.adapter.log.info(`Resetting monthly counters for ${type}`);

        // Get all meters for this type (main + additional meters)
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        if (meters.length === 0) {
            this.adapter.log.warn(`No meters found for ${type}, skipping monthly reset`);
            return;
        }

        // Reset each meter
        for (const meter of meters) {
            const basePath = `${type}.${meter.name}`;
            const label = meter.displayName || meter.name;

            this.adapter.log.debug(`Resetting monthly counter for ${basePath} (${label})`);

            // Get current values before reset
            const monthlyState = await this.adapter.getStateAsync(`${basePath}.consumption.monthly`);
            const monthlyValue = monthlyState?.val || 0;

            // Save last month consumption
            await this.adapter.setStateAsync(`${basePath}.statistics.lastMonth`, monthlyValue, true);

            // For gas: also save volume
            if (type === 'gas') {
                const monthlyVolume = await this.adapter.getStateAsync(`${basePath}.consumption.monthlyVolume`);
                const monthlyVolumeValue = monthlyVolume?.val || 0;
                await this.adapter.setStateAsync(`${basePath}.statistics.lastMonthVolume`, monthlyVolumeValue, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.monthlyVolume`, 0, true);
            }

            // Reset monthly counters
            await this.adapter.setStateAsync(`${basePath}.consumption.monthly`, 0, true);

            // Reset HT/NT monthly counters if enabled
            const configType = getConfigType(type);
            const htNtEnabled = this.adapter.config[`${configType}HtNtEnabled`] || false;
            if (htNtEnabled) {
                await this.adapter.setStateAsync(`${basePath}.consumption.monthlyHT`, 0, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.monthlyNT`, 0, true);
            }

            await this.adapter.setStateAsync(`${basePath}.costs.monthly`, 0, true);

            // Update lastMonthStart timestamp
            await this.adapter.setStateAsync(`${basePath}.statistics.lastMonthStart`, Date.now(), true);

            await this.adapter.setStateAsync(
                `${basePath}.statistics.averageMonthly`,
                calculator.roundToDecimals(monthlyValue, 2),
                true,
            );
        }

        // Update totals if multiple meters exist
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }
    }

    /**
     * Resets yearly counters
     *
     * @param {string} type - Utility type
     */
    async resetYearlyCounters(type) {
        this.adapter.log.info(`Resetting yearly counters for ${type}`);

        // Get all meters for this type (main + additional meters)
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        if (meters.length === 0) {
            this.adapter.log.warn(`No meters found for ${type}, skipping yearly reset`);
            return;
        }

        // Reset each meter
        for (const meter of meters) {
            const basePath = `${type}.${meter.name}`;
            const label = meter.displayName || meter.name;

            this.adapter.log.debug(`Resetting yearly counter for ${basePath} (${label})`);

            await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, 0, true);

            if (type === 'gas') {
                await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, 0, true);
            }

            await this.adapter.setStateAsync(`${basePath}.costs.yearly`, 0, true);
            await this.adapter.setStateAsync(`${basePath}.billing.notificationSent`, false, true);
            await this.adapter.setStateAsync(`${basePath}.billing.notificationChangeSent`, false, true);

            // Update lastYearStart timestamp
            await this.adapter.setStateAsync(`${basePath}.statistics.lastYearStart`, Date.now(), true);
        }

        // Update totals if multiple meters exist
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }
    }

    /**
     * Resets yearly counters for a SINGLE meter (used for individual contract anniversaries)
     *
     * @param {string} type - Utility type
     * @param {object} meter - Meter object from multiMeterManager
     */
    async resetYearlyCountersForMeter(type, meter) {
        const basePath = `${type}.${meter.name}`;
        const label = meter.displayName || meter.name;

        this.adapter.log.debug(`Resetting yearly counter for ${basePath} (${label})`);

        await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, 0, true);

        if (type === 'gas') {
            await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, 0, true);
        }

        await this.adapter.setStateAsync(`${basePath}.costs.yearly`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationSent`, false, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationChangeSent`, false, true);

        // Update lastYearStart timestamp
        await this.adapter.setStateAsync(`${basePath}.statistics.lastYearStart`, Date.now(), true);
    }

    /**
     * Resets weekly counters
     *
     * @param {string} type - Utility type
     */
    async resetWeeklyCounters(type) {
        this.adapter.log.info(`Resetting weekly counters for ${type}`);

        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
        for (const meter of meters) {
            const basePath = `${type}.${meter.name}`;

            // Save last week consumption before reset
            const weeklyState = await this.adapter.getStateAsync(`${basePath}.consumption.weekly`);
            const weeklyValue = weeklyState?.val || 0;
            await this.adapter.setStateAsync(`${basePath}.statistics.lastWeek`, weeklyValue, true);

            // For gas: also save volume
            if (type === 'gas') {
                const weeklyVolume = await this.adapter.getStateAsync(`${basePath}.consumption.weeklyVolume`);
                const weeklyVolumeValue = weeklyVolume?.val || 0;
                await this.adapter.setStateAsync(`${basePath}.statistics.lastWeekVolume`, weeklyVolumeValue, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.weeklyVolume`, 0, true);
            }

            // Reset weekly counters
            await this.adapter.setStateAsync(`${basePath}.consumption.weekly`, 0, true);
            await this.adapter.setStateAsync(`${basePath}.costs.weekly`, 0, true);

            const configType = getConfigType(type);
            const htNtEnabled = this.adapter.config[`${configType}HtNtEnabled`] || false;
            if (htNtEnabled) {
                await this.adapter.setStateAsync(`${basePath}.consumption.weeklyHT`, 0, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.weeklyNT`, 0, true);
                await this.adapter.setStateAsync(`${basePath}.costs.weeklyHT`, 0, true);
                await this.adapter.setStateAsync(`${basePath}.costs.weeklyNT`, 0, true);
            }

            await this.adapter.setStateAsync(`${basePath}.statistics.lastWeekStart`, Date.now(), true);
        }

        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }
    }
}

module.exports = BillingManager;
