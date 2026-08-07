'use strict';

/**
 * Unit tests for the object role migration (checker rules E1008 / E1011).
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { migrateStateRoles } = require('../../lib/state/objectMigration');

/**
 * Builds an adapter mock whose getAdapterObjectsAsync returns the given objects.
 *
 * @param {object} objects - Map of id -> object
 * @returns {object} Adapter mock
 */
function makeAdapter(objects) {
    return {
        getAdapterObjectsAsync: sinon.stub().resolves(objects),
        extendObjectAsync: sinon.stub().resolves(),
        log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub() },
    };
}

/**
 * Convenience for a state object with a role.
 *
 * @param {string} role - The common.role value
 * @returns {object} A minimal state object
 */
function state(role) {
    return { type: 'state', common: { role } };
}

describe('migrateStateRoles()', () => {
    afterEach(() => sinon.restore());

    it('should replace value.money with value', async () => {
        const adapter = makeAdapter({ 'gas.main.costs.yearly': state('value.money') });

        const changed = await migrateStateRoles(adapter);

        expect(changed).to.equal(1);
        expect(adapter.extendObjectAsync.calledWith('gas.main.costs.yearly', { common: { role: 'value' } })).to.be.true;
    });

    it('should replace value.price with value', async () => {
        const adapter = makeAdapter({ 'gas.main.info.currentPrice': state('value.price') });

        await migrateStateRoles(adapter);

        expect(adapter.extendObjectAsync.calledWith('gas.main.info.currentPrice', { common: { role: 'value' } })).to.be
            .true;
    });

    it('should switch a writable endReading from value to level', async () => {
        const adapter = makeAdapter({ 'gas.main.billing.endReading': state('value') });

        await migrateStateRoles(adapter);

        expect(adapter.extendObjectAsync.calledWith('gas.main.billing.endReading', { common: { role: 'level' } })).to.be
            .true;
    });

    it('should switch a writable adjustment.value from value to level', async () => {
        const adapter = makeAdapter({ 'water.haus.adjustment.value': state('value') });

        await migrateStateRoles(adapter);

        expect(adapter.extendObjectAsync.calledWith('water.haus.adjustment.value', { common: { role: 'level' } })).to.be
            .true;
    });

    it('should leave a correct read-only value state untouched', async () => {
        const adapter = makeAdapter({ 'gas.main.billing.daysRemaining': state('value') });

        const changed = await migrateStateRoles(adapter);

        expect(changed).to.equal(0);
        expect(adapter.extendObjectAsync.called).to.be.false;
    });

    it('should leave states with already correct roles untouched', async () => {
        const adapter = makeAdapter({
            'gas.main.billing.endReading': state('level'),
            'gas.main.consumption.daily': state('value.power.consumption'),
        });

        const changed = await migrateStateRoles(adapter);

        expect(changed).to.equal(0);
    });

    it('should ignore non-state objects', async () => {
        const adapter = makeAdapter({ gas: { type: 'folder', common: {} } });

        const changed = await migrateStateRoles(adapter);

        expect(changed).to.equal(0);
    });

    it('should not throw when enumeration fails', async () => {
        const adapter = makeAdapter({});
        adapter.getAdapterObjectsAsync.rejects(new Error('DB down'));

        const changed = await migrateStateRoles(adapter);

        expect(changed).to.equal(0);
        expect(adapter.log.warn.calledOnce).to.be.true;
    });
});
