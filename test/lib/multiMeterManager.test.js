/**
 * Unit tests for MultiMeterManager module
 */

const { expect } = require('chai');

// Mock adapter for testing
function createMockAdapter(config = {}) {
    const states = {};
    const objects = {};

    return {
        config: {
            gasAktiv: true,
            gasMainMeterName: 'main',
            gasSensorDP: 'test.0.gas.sensor',
            gasOffset: 0,
            gasInitialReading: 1000,
            gasContractStart: '01.01.2025',
            gasPreis: 0.12,
            gasGrundgebuehr: 15,
            gasAbschlag: 100,
            gasBrennwert: 11.5,
            gasZahl: 0.95,
            gasAdditionalMeters: [],
            sensorSpikeThreshold: 500,
            ...config,
        },
        log: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
        },
        namespace: 'utility-monitor.0',
        states,
        objects,
        async getStateAsync(id) {
            return states[id] || null;
        },
        async setStateAsync(id, value, ack) {
            states[id] = { val: value, ack };
        },
        async getForeignStateAsync(id) {
            return states[id] || null;
        },
        async getObjectAsync(id) {
            return objects[id] || null;
        },
        async setObjectNotExistsAsync(id, obj) {
            if (!objects[id]) {
                objects[id] = obj;
            }
        },
        async delObjectAsync(id, opts) {
            delete objects[id];
        },
        async getObjectListAsync(opts) {
            return { rows: /** @type {any[]} */ ([]) };
        },
        subscribeForeignStates: () => {},
    };
}

// Import the module after mocking
const MultiMeterManager = require('../../lib/multiMeterManager');

describe('MultiMeterManager Module', () => {
    describe('getMetersForType()', () => {
        it('should return main meter when type is active', () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const meters = manager.getMetersForType('gas');

            expect(meters).to.have.lengthOf(1);
            expect(meters[0].name).to.equal('main');
            expect(meters[0].config.sensorDP).to.equal('test.0.gas.sensor');
            expect(meters[0].config.preis).to.equal(0.12);
        });

        it('should return empty array when type is inactive', () => {
            const adapter = createMockAdapter({ gasAktiv: false });
            const manager = new MultiMeterManager(adapter, null, null);

            const meters = manager.getMetersForType('gas');

            expect(meters).to.have.lengthOf(0);
        });

        it('should include additional meters', () => {
            const adapter = createMockAdapter({
                gasAdditionalMeters: [
                    {
                        name: 'Werkstatt',
                        sensorDP: 'test.0.gas.werkstatt',
                        preis: 0.15,
                        offset: 0,
                        initialReading: 500,
                        contractStart: '01.06.2024',
                        grundgebuehr: 10,
                        abschlag: 50,
                    },
                ],
            });
            const manager = new MultiMeterManager(adapter, null, null);

            const meters = manager.getMetersForType('gas');

            expect(meters).to.have.lengthOf(2);
            expect(meters[0].name).to.equal('main');
            expect(meters[1].name).to.equal('werkstatt'); // Normalized
            expect(meters[1].displayName).to.equal('Werkstatt');
            expect(meters[1].config.preis).to.equal(0.15);
        });

        it('should normalize meter names with umlauts', () => {
            const adapter = createMockAdapter({
                gasMainMeterName: 'Gebäude Süd',
            });
            const manager = new MultiMeterManager(adapter, null, null);

            const meters = manager.getMetersForType('gas');

            expect(meters[0].name).to.equal('gebaeude_sued');
            expect(meters[0].displayName).to.equal('Gebäude Süd');
        });

        it('should skip additional meters without name or sensorDP', () => {
            const adapter = createMockAdapter({
                gasAdditionalMeters: [
                    { name: '', sensorDP: 'test.0.sensor1' },
                    { name: 'Valid', sensorDP: '' },
                    { name: 'Complete', sensorDP: 'test.0.sensor2', preis: 0.1 },
                ],
            });
            const manager = new MultiMeterManager(adapter, null, null);

            const meters = manager.getMetersForType('gas');

            expect(meters).to.have.lengthOf(2); // main + Complete
            expect(meters[1].name).to.equal('complete');
        });
    });

    describe('getConfigType()', () => {
        it('should map gas to gas', () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            expect(manager.getConfigType('gas')).to.equal('gas');
        });

        it('should map water to wasser', () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            expect(manager.getConfigType('water')).to.equal('wasser');
        });

        it('should map electricity to strom', () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            expect(manager.getConfigType('electricity')).to.equal('strom');
        });

        it('should map pv to pv', () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            expect(manager.getConfigType('pv')).to.equal('pv');
        });
    });

    describe('MeterRegistry', () => {
        it('should register and find sensors', () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            manager.meterRegistry.register('test.0.sensor1', 'gas', 'main');
            manager.meterRegistry.register('test.0.sensor2', 'gas', 'werkstatt');

            const result = manager.findMeterBySensor('test.0.sensor1');

            expect(result).to.have.lengthOf(1);
            expect(result[0].type).to.equal('gas');
            expect(result[0].meterName).to.equal('main');
        });

        it('should return empty array for unknown sensor', () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const result = manager.findMeterBySensor('unknown.sensor');

            expect(result).to.have.lengthOf(0);
        });
    });

    describe('_preprocessValue()', () => {
        it('should apply offset correctly', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const config = { offset: 100, htNtEnabled: false };
            const result = await manager._preprocessValue('electricity', 500, config);

            expect(result.consumption).to.equal(400);
            expect(result.consumptionM3).to.be.null;
        });

        it('should convert gas m³ to kWh', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const config = { offset: 0, htNtEnabled: false };
            const result = await manager._preprocessValue('gas', 100, config);

            // 100 m³ * 11.5 brennwert * 0.95 zZahl = 1092.5 kWh
            expect(result.consumption).to.equal(1092.5);
            expect(result.consumptionM3).to.equal(100);
        });

        it('should apply offset before gas conversion', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const config = { offset: 10, htNtEnabled: false };
            const result = await manager._preprocessValue('gas', 100, config);

            // (100 - 10) m³ * 11.5 * 0.95 = 983.25 kWh
            expect(result.consumption).to.equal(983.25);
            expect(result.consumptionM3).to.equal(90);
        });
    });

    describe('Spike Detection', () => {
        it('should use configurable spike threshold', async () => {
            const adapter = createMockAdapter({ sensorSpikeThreshold: 100 });
            const manager = new MultiMeterManager(adapter, null, null);

            // Initialize with a value
            manager.lastSensorValues['test.0.sensor'] = 1000;

            // Simulate a spike of 150 (above threshold of 100)
            // The method should detect this as suspicious
            const consumption = 1150;
            const lastValue = manager.lastSensorValues['test.0.sensor'];
            const delta = consumption - lastValue;
            const threshold = adapter.config.sensorSpikeThreshold;

            expect(delta).to.equal(150);
            expect(delta > threshold).to.be.true;
        });

        it('should use default threshold when not configured', () => {
            const adapter = createMockAdapter({ sensorSpikeThreshold: undefined });
            const manager = new MultiMeterManager(adapter, null, null);

            const threshold = adapter.config.sensorSpikeThreshold || 500;
            expect(threshold).to.equal(500);
        });
    });

    describe('Cost Calculation', () => {
        it('should calculate daily cost correctly', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // Set up consumption state
            adapter.states['gas.main.consumption.daily'] = { val: 10, ack: true };
            adapter.states['gas.main.consumption.weekly'] = { val: 50, ack: true };
            adapter.states['gas.main.consumption.monthly'] = { val: 100, ack: true };
            adapter.states['gas.main.consumption.yearly'] = { val: 500, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastYearStart'] = { val: Date.now(), ack: true };

            const config = { preis: 0.12, grundgebuehr: 15, jahresgebuehr: 0, abschlag: 100 };
            await manager.updateCosts('gas', 'main', config);

            // Daily cost: 10 * 0.12 = 1.2
            expect(adapter.states['gas.main.costs.daily'].val).to.equal(1.2);
            // Weekly cost: 50 * 0.12 = 6
            expect(adapter.states['gas.main.costs.weekly'].val).to.equal(6);
            // Monthly cost: 100 * 0.12 = 12
            expect(adapter.states['gas.main.costs.monthly'].val).to.equal(12);
            // Yearly cost: 500 * 0.12 = 60
            expect(adapter.states['gas.main.costs.yearly'].val).to.equal(60);
        });

        it('should calculate total yearly with basic charge', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // Set up consumption state
            adapter.states['gas.main.consumption.daily'] = { val: 0, ack: true };
            adapter.states['gas.main.consumption.weekly'] = { val: 0, ack: true };
            adapter.states['gas.main.consumption.monthly'] = { val: 0, ack: true };
            adapter.states['gas.main.consumption.yearly'] = { val: 1000, ack: true };

            // Set lastYearStart to 6 months ago
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            adapter.states['gas.main.statistics.timestamps.lastYearStart'] = { val: sixMonthsAgo.getTime(), ack: true };

            const config = { preis: 0.12, grundgebuehr: 15, jahresgebuehr: 0, abschlag: 100 };
            await manager.updateCosts('gas', 'main', config);

            // Yearly consumption cost: 1000 * 0.12 = 120
            // Basic charge: 15 * 7 months = 105 (at least 1 month + 6 months)
            // Total: 120 + 105 = 225
            expect(adapter.states['gas.main.costs.yearly'].val).to.equal(120);
            expect(adapter.states['gas.main.costs.basicCharge'].val).to.be.at.least(105);
        });
    });

    describe('Multi-Meter Totals', () => {
        it('should not create totals for single meter', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const meters = manager.getMetersForType('gas');
            expect(meters).to.have.lengthOf(1);

            await manager.updateTotalCosts('gas');

            // No totals should be created
            expect(adapter.states['gas.totals.consumption.daily']).to.be.undefined;
        });

        it('should calculate totals for multiple meters', async () => {
            const adapter = createMockAdapter({
                gasAdditionalMeters: [
                    {
                        name: 'Werkstatt',
                        sensorDP: 'test.0.gas.werkstatt',
                        preis: 0.15,
                        offset: 0,
                        initialReading: 0,
                    },
                ],
            });

            // Create totals structure
            adapter.objects['gas.totals'] = { type: 'channel' };

            const manager = new MultiMeterManager(adapter, null, null);

            // Set up states for both meters
            adapter.states['gas.main.consumption.daily'] = { val: 10, ack: true };
            adapter.states['gas.main.consumption.weekly'] = { val: 50, ack: true };
            adapter.states['gas.main.consumption.monthly'] = { val: 100, ack: true };
            adapter.states['gas.main.consumption.yearly'] = { val: 500, ack: true };
            adapter.states['gas.main.costs.daily'] = { val: 1.2, ack: true };
            adapter.states['gas.main.costs.weekly'] = { val: 6, ack: true };
            adapter.states['gas.main.costs.monthly'] = { val: 12, ack: true };
            adapter.states['gas.main.costs.totalYearly'] = { val: 75, ack: true };

            adapter.states['gas.werkstatt.consumption.daily'] = { val: 5, ack: true };
            adapter.states['gas.werkstatt.consumption.weekly'] = { val: 25, ack: true };
            adapter.states['gas.werkstatt.consumption.monthly'] = { val: 50, ack: true };
            adapter.states['gas.werkstatt.consumption.yearly'] = { val: 250, ack: true };
            adapter.states['gas.werkstatt.costs.daily'] = { val: 0.75, ack: true };
            adapter.states['gas.werkstatt.costs.weekly'] = { val: 3.75, ack: true };
            adapter.states['gas.werkstatt.costs.monthly'] = { val: 7.5, ack: true };
            adapter.states['gas.werkstatt.costs.totalYearly'] = { val: 45, ack: true };

            await manager.updateTotalCosts('gas');

            // Totals should be sum of both meters
            expect(adapter.states['gas.totals.consumption.daily'].val).to.equal(15);
            expect(adapter.states['gas.totals.consumption.weekly'].val).to.equal(75);
            expect(adapter.states['gas.totals.consumption.monthly'].val).to.equal(150);
            expect(adapter.states['gas.totals.consumption.yearly'].val).to.equal(750);
            expect(adapter.states['gas.totals.costs.daily'].val).to.equal(1.95);
            expect(adapter.states['gas.totals.costs.totalYearly'].val).to.equal(120);
        });
    });

    describe('handleSensorUpdate()', () => {
        it('should reject negative sensor values', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // Register the sensor
            manager.meterRegistry.register('test.0.gas.sensor', 'gas', 'main');

            // Try to update with a negative value
            await manager.handleSensorUpdate('gas', 'main', 'test.0.gas.sensor', -10);

            // Should not have updated lastSensorValues
            expect(manager.lastSensorValues['test.0.gas.sensor']).to.be.undefined;
        });

        it('should detect meter reset when value decreases', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // For gas, the value is converted from m³ to kWh
            // 100 m³ * 11.5 * 0.95 = 1092.5 kWh
            // So we need to set lastSensorValue in kWh terms

            // Set up initial state (in kWh after conversion)
            manager.lastSensorValues['test.0.gas.sensor'] = 1092.5; // 100 m³ converted
            adapter.states['gas.main.info.meterReading'] = { val: 1092.5, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastYearStart'] = { val: Date.now(), ack: true };

            let warnCalled = false;
            adapter.log.warn = msg => {
                if (msg.includes('Zählerstand gesunken') || msg.includes('Reset')) {
                    warnCalled = true;
                }
            };

            // Simulate meter reset: send 50 m³ which converts to 546.25 kWh (less than 1092.5)
            await manager.handleSensorUpdate('gas', 'main', 'test.0.gas.sensor', 50);

            expect(warnCalled).to.be.true;
        });

        it('should ignore zero or negative deltas', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // Set up initial state
            manager.lastSensorValues['test.0.gas.sensor'] = 1000;
            adapter.states['gas.main.info.meterReading'] = { val: 1000, ack: true };
            adapter.states['gas.main.consumption.daily'] = { val: 5, ack: true };

            // Same value (delta = 0) should not change consumption
            await manager.handleSensorUpdate('gas', 'main', 'test.0.gas.sensor', 1000);

            // Daily consumption should remain unchanged (delta was 0)
            expect(adapter.states['gas.main.consumption.daily'].val).to.equal(5);
        });
    });

    describe('_validatePeriodConsumption()', () => {
        it('should reset monthly consumption if it exceeds spike threshold', async () => {
            const adapter = createMockAdapter();
            adapter.config.sensorSpikeThreshold = 500;
            const manager = new MultiMeterManager(adapter, null, null);

            const now = Date.now();
            const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

            // Set up unrealistically high monthly consumption
            adapter.states['gas.main.consumption.monthly'] = { val: 50000, ack: true }; // Way too high
            adapter.states['gas.main.consumption.monthlyVolume'] = { val: 5000, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastMonthStart'] = { val: twoDaysAgo, ack: true };

            // Set up reasonable daily/weekly values
            adapter.states['gas.main.consumption.daily'] = { val: 10, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastDayStart'] = {
                val: now - 12 * 60 * 60 * 1000,
                ack: true,
            };
            adapter.states['gas.main.consumption.weekly'] = { val: 50, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastWeekStart'] = { val: twoDaysAgo, ack: true };

            await manager._validatePeriodConsumption('gas', 'gas.main', now);

            // Monthly should be reset (50000 > 500 * 2 days * 2 buffer = 2000)
            expect(adapter.states['gas.main.consumption.monthly'].val).to.equal(0);
            expect(adapter.states['gas.main.consumption.monthlyVolume'].val).to.equal(0);

            // Daily and weekly should remain (within reasonable range)
            expect(adapter.states['gas.main.consumption.daily'].val).to.equal(10);
            expect(adapter.states['gas.main.consumption.weekly'].val).to.equal(50);
        });

        it('should keep valid consumption values unchanged', async () => {
            const adapter = createMockAdapter();
            adapter.config.sensorSpikeThreshold = 500;
            const manager = new MultiMeterManager(adapter, null, null);

            const now = Date.now();
            const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;

            // Set up reasonable monthly consumption
            adapter.states['gas.main.consumption.monthly'] = { val: 100, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastMonthStart'] = { val: fiveDaysAgo, ack: true };

            await manager._validatePeriodConsumption('gas', 'gas.main', now);

            // Monthly should stay (100 < 500 * 5 days * 2 buffer = 5000)
            expect(adapter.states['gas.main.consumption.monthly'].val).to.equal(100);
        });
    });

    describe('reconstructPeriodConsumption()', () => {
        it('should skip reconstruction if no timestamps exist', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // No timestamps set
            await manager.reconstructPeriodConsumption('gas', 'main', 'gas.main');

            // Should not throw and not modify any states
            expect(adapter.states['gas.main.consumption.weekly']).to.be.undefined;
        });

        it('should reconstruct weekly consumption after adapter restart', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const now = Date.now();
            const halfDayAgo = now - 12 * 60 * 60 * 1000; // 12 hours ago
            const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000; // 3 days ago

            // Set up states simulating adapter restart after daily reset
            adapter.states['gas.main.statistics.timestamps.lastWeekStart'] = { val: threeDaysAgo, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastDayStart'] = { val: halfDayAgo, ack: true };
            adapter.states['gas.main.consumption.weekly'] = { val: 10, ack: true };
            adapter.states['gas.main.consumption.daily'] = { val: 5, ack: true };
            adapter.states['gas.main.statistics.consumption.lastDay'] = { val: 15, ack: true };

            await manager.reconstructPeriodConsumption('gas', 'main', 'gas.main');

            // Weekly should be reconstructed: 10 + 15 = 25
            expect(adapter.states['gas.main.consumption.weekly'].val).to.equal(25);
        });

        it('should skip reconstruction if week is out of range', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            const now = Date.now();
            const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago

            adapter.states['gas.main.statistics.timestamps.lastWeekStart'] = { val: tenDaysAgo, ack: true };
            adapter.states['gas.main.statistics.timestamps.lastDayStart'] = { val: now, ack: true };
            adapter.states['gas.main.consumption.weekly'] = { val: 10, ack: true };

            await manager.reconstructPeriodConsumption('gas', 'main', 'gas.main');

            // Should not be modified (week out of range)
            expect(adapter.states['gas.main.consumption.weekly'].val).to.equal(10);
        });
    });

    describe('_calculateMonthsSinceYearStart()', () => {
        it('should return at least 1 month', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // No yearStart state
            const months = await manager._calculateMonthsSinceYearStart('gas.main');

            expect(months).to.be.at.least(1);
        });

        it('should calculate months correctly', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // Set yearStart to 6 months ago
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            adapter.states['gas.main.statistics.timestamps.lastYearStart'] = { val: sixMonthsAgo.getTime(), ack: true };

            const months = await manager._calculateMonthsSinceYearStart('gas.main');

            // Should be 7 (6 months difference + 1)
            expect(months).to.equal(7);
        });
    });

    describe('cleanupRemovedMeters()', () => {
        it('should not delete protected categories', async () => {
            const adapter = createMockAdapter();
            const manager = new MultiMeterManager(adapter, null, null);

            // Mock object list with protected and custom meter
            // @ts-ignore - Mock implementation return type mismatch
            adapter.getObjectListAsync = async () => ({
                rows: [
                    { id: 'utility-monitor.0.gas.main' },
                    { id: 'utility-monitor.0.gas.consumption' },
                    { id: 'utility-monitor.0.gas.costs' },
                    { id: 'utility-monitor.0.gas.removed_meter' },
                ],
            });

            let deletedIds = [];
            adapter.delObjectAsync = async (id, opts) => {
                deletedIds.push(id);
            };

            adapter.objects['gas'] = { type: 'device' };

            const currentMeters = [{ name: 'main' }];
            await manager.cleanupRemovedMeters('gas', currentMeters);

            // Should only delete 'removed_meter', not 'consumption' or 'costs'
            expect(deletedIds).to.include('gas.removed_meter');
            expect(deletedIds).to.not.include('gas.consumption');
            expect(deletedIds).to.not.include('gas.costs');
        });
    });
});
