'use strict';

/**
 * Unit tests for the migration of info.monthlyInstallment from a formatted
 * string ("25.00 €") to a numeric state (issue #11).
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { migrateInstallmentToNumber } = require('../../lib/state/meter');

const ID = 'gas.main.info.monthlyInstallment';

/**
 * Builds an adapter mock with the given stored object and state
 *
 * @param {object|null} obj - Object as returned by getObjectAsync
 * @param {object|null} state - State as returned by getStateAsync
 * @returns {object} Adapter mock
 */
function makeAdapter(obj, state) {
    return {
        getObjectAsync: sinon.stub().resolves(obj),
        getStateAsync: sinon.stub().resolves(state),
        extendObjectAsync: sinon.stub().resolves(),
        setStateAsync: sinon.stub().resolves(),
        log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub() },
    };
}

describe('migrateInstallmentToNumber()', () => {
    afterEach(() => sinon.restore());

    it('should convert a string state into a number state', async () => {
        const adapter = makeAdapter({ common: { type: 'string' } }, { val: '25.00 €' });

        await migrateInstallmentToNumber(adapter, ID);

        expect(adapter.extendObjectAsync.calledOnce).to.be.true;
        const common = adapter.extendObjectAsync.getCall(0).args[1].common;
        expect(common.type).to.equal('number');
        expect(common.unit).to.equal('€');
        expect(common.role).to.equal('value.money');
    });

    it('should carry the previously stored amount over', async () => {
        const adapter = makeAdapter({ common: { type: 'string' } }, { val: '25.00 €' });

        await migrateInstallmentToNumber(adapter, ID);

        expect(adapter.setStateAsync.calledWith(ID, 25, true)).to.be.true;
    });

    it('should fall back to 0 for an unparsable value', async () => {
        const adapter = makeAdapter({ common: { type: 'string' } }, { val: 'kein Betrag' });

        await migrateInstallmentToNumber(adapter, ID);

        expect(adapter.setStateAsync.calledWith(ID, 0, true)).to.be.true;
    });

    it('should leave an already numeric state untouched', async () => {
        const adapter = makeAdapter({ common: { type: 'number' } }, { val: 25 });

        await migrateInstallmentToNumber(adapter, ID);

        expect(adapter.extendObjectAsync.called).to.be.false;
        expect(adapter.setStateAsync.called).to.be.false;
    });

    it('should do nothing when the object does not exist', async () => {
        const adapter = makeAdapter(null, null);

        await migrateInstallmentToNumber(adapter, ID);

        expect(adapter.extendObjectAsync.called).to.be.false;
    });

    it('should not throw when the adapter call fails', async () => {
        const adapter = makeAdapter({ common: { type: 'string' } }, { val: '25.00 €' });
        adapter.extendObjectAsync.rejects(new Error('DB nicht erreichbar'));

        await migrateInstallmentToNumber(adapter, ID);

        expect(adapter.log.warn.calledOnce).to.be.true;
    });
});
