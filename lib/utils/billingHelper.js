'use strict';

const calculator = require('../calculator');

/**
 * Shared billing and cost calculation logic
 */

/**
 * Calculates accumulated basic charges over a period
 *
 * @param {number} monthlyFee - Monthly basic charge
 * @param {number} annualFee - Fixed annual fee
 * @param {number} months - Number of months since contract start
 * @returns {object} { basicCharge, annualFee, total }
 */
function calculateAccumulatedCharges(monthlyFee, annualFee, months) {
    const basicCharge = (monthlyFee || 0) * months;
    const annual = annualFee || 0;
    return {
        basicCharge: calculator.roundToDecimals(basicCharge, 2),
        annualFee: calculator.roundToDecimals(annual, 2),
        total: calculator.roundToDecimals(basicCharge + annual, 2),
    };
}

/**
 * Calculates total paid and balance
 *
 * @param {number} monthlyAbschlag - Monthly installment
 * @param {number} months - Months since start
 * @param {number} totalCosts - Total costs calculated
 * @returns {object} { paid, balance }
 */
function calculateBalance(monthlyAbschlag, months, totalCosts) {
    const paid = (monthlyAbschlag || 0) * months;
    const balance = totalCosts > 0.01 || paid > 0.01 ? paid - totalCosts : 0;

    return {
        paid: calculator.roundToDecimals(paid, 2),
        balance: calculator.roundToDecimals(balance, 2),
    };
}

/**
 * Calculates costs for HT/NT split
 *
 * @param {number} htQty - High tariff quantity
 * @param {number} htPrice - High tariff price
 * @param {number} ntQty - Low tariff quantity
 * @param {number} ntPrice - Low tariff price
 * @returns {object} { htCosts, ntCosts, total }
 */
function calculateHTNTCosts(htQty, htPrice, ntQty, ntPrice) {
    const ht = (htQty || 0) * (htPrice || 0);
    const nt = (ntQty || 0) * (ntPrice || 0);

    return {
        htCosts: calculator.roundToDecimals(ht, 2),
        ntCosts: calculator.roundToDecimals(nt, 2),
        total: calculator.roundToDecimals(ht + nt, 2),
    };
}

module.exports = {
    calculateAccumulatedCharges,
    calculateBalance,
    calculateHTNTCosts,
};
