'use strict';
const expect = require('chai').expect;
const sinon = require('sinon');
const MessagingHandler = require('../../lib/messagingHandler');
const { formatLocalDate } = require('../../lib/utils/helpers');

describe('MessagingHandler', () => {
    let messagingHandler;
    let adapterMock;

    beforeEach(() => {
        adapterMock = {
            config: {
                notificationEnabled: true,
                notificationInstance: 'telegram.0',
                notificationMonthlyEnabled: true,
                notificationMonthlyDay: new Date().getDate(), // Set to today
                notificationStromEnabled: true,
                notificationGasEnabled: true,
                notificationWasserEnabled: true,
                notificationPvEnabled: true,
                gasAktiv: true,
                wasserAktiv: true,
                stromAktiv: true,
                pvAktiv: true,
                gasAbschlag: 10,
                stromAbschlag: 20,
            },
            consumptionManager: {
                getConfigType: sinon.stub().callsFake(type => {
                    const map = { electricity: 'strom', water: 'wasser', gas: 'gas', pv: 'pv' };
                    return map[type] || type;
                }),
            },
            multiMeterManager: {
                getMetersForType: sinon.stub().callsFake(type => {
                    // Return single main meter for each type
                    return [{ name: 'main', displayName: 'Hauptzähler' }];
                }),
            },
            log: {
                info: sinon.stub(),
                error: sinon.stub(),
                debug: sinon.stub(),
            },
            getStateAsync: sinon.stub(),
            setStateAsync: sinon.stub(),
            sendToAsync: sinon.stub(),
        };

        messagingHandler = new MessagingHandler(adapterMock);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('checkMonthlyReport', () => {
        it('should send a report if enabled and today is the configured day', async () => {
            // Mock states
            adapterMock.getStateAsync.withArgs('info.lastMonthlyReport').resolves({ val: '2020-01-01' }); // Old date

            // Electricity (new structure with meter name)
            adapterMock.getStateAsync.withArgs('electricity.main.consumption.yearly').resolves({ val: 1000 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.totalYearly').resolves({ val: 300 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.paidTotal').resolves({ val: 240 }); // 20 * 12
            adapterMock.getStateAsync.withArgs('electricity.main.costs.balance').resolves({ val: 60 });

            // Gas (new structure with meter name)
            adapterMock.getStateAsync.withArgs('gas.main.consumption.yearly').resolves({ val: 5000 });
            adapterMock.getStateAsync.withArgs('gas.main.costs.totalYearly').resolves({ val: 500 });
            adapterMock.getStateAsync.withArgs('gas.main.costs.paidTotal').resolves({ val: 600 });
            adapterMock.getStateAsync.withArgs('gas.main.costs.balance').resolves({ val: -100 });

            // Allow any for others
            adapterMock.getStateAsync.resolves({ val: 0 });

            await messagingHandler.checkMonthlyReport();

            expect(adapterMock.sendToAsync.calledOnce).to.be.true;
            const callArgs = adapterMock.sendToAsync.firstCall.args;
            expect(callArgs[0]).to.equal('telegram.0');
            expect(callArgs[1]).to.equal('send');

            // Default language is English (adapter.language is not set)
            const message = callArgs[2].text;
            expect(message).to.contain('📊 *Monthly report*');
            expect(message).to.contain('⚡️ Electricity');
            expect(message).to.contain('Consumption (year): 1000 kWh');
            expect(message).to.contain('Consumption costs: 300.00 €');
            expect(message).to.contain('❌ Additional payment');

            expect(message).to.contain('🔥 Gas');
            expect(message).to.contain('Consumption (year): 5000 kWh');
            expect(message).to.contain('✅ Credit');

            const todayStr = formatLocalDate(new Date());
            expect(adapterMock.setStateAsync.calledWith('info.lastMonthlyReport', todayStr, true)).to.be.true;
        });

        it('should send the report in German when the system language is German', async () => {
            adapterMock.language = 'de';
            adapterMock.getStateAsync.withArgs('info.lastMonthlyReport').resolves({ val: '2020-01-01' });
            adapterMock.getStateAsync.withArgs('electricity.main.consumption.yearly').resolves({ val: 1000 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.totalYearly').resolves({ val: 300 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.paidTotal').resolves({ val: 240 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.balance').resolves({ val: 60 });
            adapterMock.getStateAsync.resolves({ val: 0 });

            await messagingHandler.checkMonthlyReport();

            const message = adapterMock.sendToAsync.firstCall.args[2].text;
            expect(message).to.contain('📊 *Monats-Report*');
            expect(message).to.contain('⚡️ Strom');
            expect(message).to.contain('Verbrauch (Jahr): 1000 kWh');
            expect(message).to.contain('❌ Nachzahlung');
        });

        it('should NOT send a report if disabled', async () => {
            adapterMock.config.notificationMonthlyEnabled = false;
            await messagingHandler.checkMonthlyReport();
            expect(adapterMock.sendToAsync.called).to.be.false;
        });

        it('should NOT send a report if not the configured day', async () => {
            const today = new Date().getDate();
            adapterMock.config.notificationMonthlyDay = today === 1 ? 2 : 1; // Set to different day
            await messagingHandler.checkMonthlyReport();
            expect(adapterMock.sendToAsync.called).to.be.false;
        });

        it('should NOT send a report if already sent today', async () => {
            const todayStr = formatLocalDate(new Date());
            adapterMock.getStateAsync.withArgs('info.lastMonthlyReport').resolves({ val: todayStr });
            await messagingHandler.checkMonthlyReport();
            expect(adapterMock.sendToAsync.called).to.be.false;
        });

        it('should NOT send a second report later the same day (UTC offset regression)', async () => {
            // The stored marker must be the local date. With toISOString() the
            // report sent at 00:00 CEST was stored under the previous day, so the
            // guard no longer matched at 02:00 and a duplicate was sent.
            const todayStr = formatLocalDate(new Date());
            adapterMock.getStateAsync.withArgs('info.lastMonthlyReport').resolves({ val: todayStr });

            await messagingHandler.checkMonthlyReport();
            await messagingHandler.checkMonthlyReport();

            expect(adapterMock.sendToAsync.called).to.be.false;
            expect(todayStr).to.not.equal(new Date(Date.now() - 86400000).toISOString().split('T')[0]);
        });

        it('should not contain escaped newlines in the report', async () => {
            adapterMock.getStateAsync.withArgs('info.lastMonthlyReport').resolves({ val: '2020-01-01' });
            adapterMock.getStateAsync.withArgs('electricity.main.consumption.yearly').resolves({ val: 1000 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.totalYearly').resolves({ val: 300 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.paidTotal').resolves({ val: 240 });
            adapterMock.getStateAsync.withArgs('electricity.main.costs.balance').resolves({ val: 60 });

            await messagingHandler.checkMonthlyReport();

            const message = adapterMock.sendToAsync.getCall(0).args[2].text;
            expect(message).to.not.contain('\\n');
        });
    });
});
