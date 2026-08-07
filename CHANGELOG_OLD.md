# Older changelog entries

The current changelog is in [README.md](README.md).

### 1.5.1 (2026-01-26)

- **FIX:** 🕛 **Reset timing** - automatic resets now run at 23:59 (instead of 00:00)
- **FIX:** Implausible values in monthly/monthlyVolume

### 1.5.0 (2026-01-25)

- **NEW:** 📥 **CSV import** - import historical meter readings by drag and drop:
    - new "Import" tab in the configuration
    - modular backend structure for CSV parsing
    - support for generic and EhB+ formats
    - modern React-based UI component for smooth operation
- **NEW:** 📊 **Weekly tracking** - consumption monitoring on a weekly basis
- **FIX:** 🕛 **Reset timing** - automatic resets now run at 23:59 (instead of 00:00) to avoid losing data at the end of a period
- **ARCHITECTURE:** 🏗️ **Improved backend modularisation**:
    - introduced the `ImportManager` to separate that logic from `main.js`

### 1.4.6 (2026-01-20)

- **⚠️ BREAKING CHANGE:** 🔄 **Naming of the main meter** - the main meter now requires a name:
    - **state paths changed**: `gas.*` → `gas.METER_NAME.*` (e.g. `gas.main.*`)
    - **new configuration fields**: "Name of the main meter" for gas/water/electricity/PV
    - **default name**: "main" (used automatically when left empty)
    - **consistent structure**: all meters (main + additional) now use `type.meterName.*`
    - **flexibility**: the main meter can be named freely (e.g. "flat", "groundfloor", "total")
    - **no special cases**: simplified logic in the code
- **NEW:** 🔔 **Smart notifications** - meter selection for notifications:
    - choose per utility type which meters trigger notifications
    - a multi-select dropdown shows all configured meters
    - if empty: all meters are included (default)
    - if selected: only the chosen meters trigger notifications
    - applies to the end of the billing period, contract changes and monthly reports
- **IMPROVED:** 🏗️ **Code architecture** - removed 19 special-case checks across 7 files:
    - simplified basePath calculation in multiMeterManager, billingManager and stateManager
    - unified configuration access (every meter uses `meter.config.contractStart`)
    - the peak/off-peak logic is now based on `config.htNtEnabled` instead of the meter name
    - the button trigger only recognises the unified path structure
    - removed legacy code: updateBillingCountdown and updateCurrentPrice now work per meter
- **MIGRATION:** 📋 **Upgrade notes**:
    - new installation: enter a name for the main meter (or accept "main")
    - upgrade: reconfigure the adapter and adjust scripts/visualisations
    - history: old states remain, new states are created alongside them
    - recommendation: use "main" as the name for an easier migration

### 1.4.5 (2026-01-20)

- **FIX:** 🐛 **Critical multi-meter cost calculation errors** - comprehensive corrections for the multi-meter functionality:
    - **main meter sync problem**: removed a duplicate initialisation that prevented `lastSync` updates
    - **basicCharge accumulation**: now correctly calculates `basicCharge = base fee × months` (previously only one month)
    - **paidTotal accumulation**: now correctly calculates `paidTotal = advance payment × months` (previously only one month)
    - **annual fee as a fixed value**: the annual fee is now used as a fixed yearly value (e.g. 60 € stays 60 €)
        - previously treated as monthly by mistake
        - the entered value is now used directly as intended
    - **balance formula corrected**: the formula `balance = totalYearly - paidTotal` was fixed
        - positive balance = additional payment (you owe money)
        - negative balance = credit (you get money back)
- **IMPROVED:** 📦 **Development dependencies**: switched from tilde (~) to caret (^) versioning for better security updates
- **CLEANUP:** 🧹 **Repository compliance**: removed unpublished versions from the changelog (resolves ioBroker bot issue #1)

---
