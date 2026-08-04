/**
 * Unit tests for the billing countdown calculation
 *
 * Regression coverage for issue #9 ("Falscher Zeitraum"), where daysRemaining
 * stayed frozen at the value calculated during the last adapter start and never
 * rolled over into the following contract period.
 */

const { expect } = require('chai');
const calculator = require('../../lib/calculator');

const { calculateBillingCountdown } = calculator;

/**
 * Formats a Date as DD.MM.YYYY for readable assertions
 *
 * @param {Date} date - Date to format
 * @returns {string} Formatted date
 */
function fmt(date) {
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/**
 * Calculates a countdown that is expected to succeed
 *
 * @param {string|Date} contractStart - Contract start
 * @param {Date} now - Reference date
 * @returns {{daysRemaining: number, periodEnd: Date, nextAnniversary: Date}} Countdown info
 */
function countdown(contractStart, now) {
    const result = calculateBillingCountdown(contractStart, now);
    if (!result) {
        throw new Error(`Expected a valid countdown for ${contractStart}`);
    }
    return result;
}

describe('calculateBillingCountdown()', () => {
    describe('rolling annual periods', () => {
        it('should count down towards the end of the running period', () => {
            // Contract 01.05.2025, checked on 12.04.2026
            const result = countdown('01.05.2025', new Date(2026, 3, 12, 10, 0));

            expect(result.daysRemaining).to.equal(19);
            expect(fmt(result.periodEnd)).to.equal('30.04.2026');
        });

        it('should show 1 day left on the last day of the period', () => {
            const result = countdown('01.05.2025', new Date(2026, 3, 30, 8, 0));

            expect(result.daysRemaining).to.equal(1);
            expect(fmt(result.periodEnd)).to.equal('30.04.2026');
        });

        it('should roll over into the new period on the anniversary itself', () => {
            // 01.05.2026 starts the period 01.05.2026 - 30.04.2027
            const result = countdown('01.05.2025', new Date(2026, 4, 1, 9, 0));

            expect(result.daysRemaining).to.equal(365);
            expect(fmt(result.periodEnd)).to.equal('30.04.2027');
        });

        it('should report the new period after the anniversary has passed (issue #9)', () => {
            // The reported bug: on 02.05.2026 the adapter still showed 19 days
            // and 30.04.2026 because the value was never refreshed after startup.
            const result = countdown('01.05.2025', new Date(2026, 4, 2, 11, 41));

            expect(result.daysRemaining).to.equal(364);
            expect(fmt(result.periodEnd)).to.equal('30.04.2027');
            expect(result.daysRemaining).to.not.equal(19);
        });

        it('should keep working many periods after the contract start', () => {
            const result = countdown('01.05.2020', new Date(2026, 4, 2, 11, 41));

            expect(result.daysRemaining).to.equal(364);
            expect(fmt(result.periodEnd)).to.equal('30.04.2027');
        });
    });

    describe('stability', () => {
        it('should not depend on the time of day', () => {
            const morning = countdown('01.05.2025', new Date(2026, 3, 12, 0, 1));
            const evening = countdown('01.05.2025', new Date(2026, 3, 12, 23, 59));

            expect(morning.daysRemaining).to.equal(evening.daysRemaining);
            expect(fmt(morning.periodEnd)).to.equal(fmt(evening.periodEnd));
        });

        it('should return whole days across a daylight saving transition', () => {
            // 15.03.2026 -> 01.05.2026 crosses the start of DST
            const result = countdown('01.05.2025', new Date(2026, 2, 15, 12, 0));

            expect(result.daysRemaining).to.equal(47);
            expect(fmt(result.periodEnd)).to.equal('30.04.2026');
        });

        it('should decrease by exactly one day per day', () => {
            const first = countdown('01.05.2025', new Date(2026, 3, 10, 6, 0));
            const second = countdown('01.05.2025', new Date(2026, 3, 11, 22, 0));

            expect(first.daysRemaining - second.daysRemaining).to.equal(1);
        });
    });

    describe('edge cases', () => {
        it('should clamp a 29.02. contract to 28.02. in non-leap years', () => {
            const result = countdown('29.02.2024', new Date(2026, 0, 1, 12, 0));

            expect(fmt(result.nextAnniversary)).to.equal('28.02.2026');
            expect(result.daysRemaining).to.equal(58);
        });

        it('should use 29.02. as anniversary in leap years', () => {
            const result = countdown('29.02.2024', new Date(2028, 0, 1, 12, 0));

            expect(fmt(result.nextAnniversary)).to.equal('29.02.2028');
        });

        it('should accept two-digit years', () => {
            const result = countdown('01.05.25', new Date(2026, 3, 12, 10, 0));

            expect(result.daysRemaining).to.equal(19);
            expect(fmt(result.periodEnd)).to.equal('30.04.2026');
        });

        it('should accept a Date object as contract start', () => {
            const result = countdown(new Date(2025, 4, 1, 12, 0), new Date(2026, 3, 12, 10, 0));

            expect(result.daysRemaining).to.equal(19);
        });

        it('should handle a contract that has not started yet', () => {
            // Contract starts 01.05.2027, checked on 01.08.2026
            const result = countdown('01.05.2027', new Date(2026, 7, 1, 12, 0));

            expect(fmt(result.periodEnd)).to.equal('30.04.2028');
            expect(result.daysRemaining).to.be.greaterThan(365);
        });

        it('should return null for invalid input', () => {
            // @ts-ignore - Testing invalid input
            expect(calculateBillingCountdown(null)).to.equal(null);
            expect(calculateBillingCountdown('')).to.equal(null);
            expect(calculateBillingCountdown('not a date')).to.equal(null);
            // @ts-ignore - Testing invalid input
            expect(calculateBillingCountdown(undefined)).to.equal(null);
        });
    });
});
