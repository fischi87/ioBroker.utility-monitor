import { g as getDefaultExportFromCjs } from './_commonjsHelpers-Dj2_voLF.js';
import { U as UtilityMonitor__mf_v__runtimeInit__mf_v__ } from './UtilityMonitor__mf_v__runtimeInit__mf_v__-BmC4OGk6.js';

function _mergeNamespaces(n, m) {
  for (var i = 0; i < m.length; i++) {
    const e = m[i];
    if (typeof e !== 'string' && !Array.isArray(e)) { for (const k in e) {
      if (k !== 'default' && !(k in n)) {
        const d = Object.getOwnPropertyDescriptor(e, k);
        if (d) {
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: () => e[k]
          });
        }
      }
    } }
  }
  return Object.freeze(Object.defineProperty(n, Symbol.toStringTag, { value: 'Module' }));
}

// dev uses dynamic import to separate chunks
    
    const {initPromise} = UtilityMonitor__mf_v__runtimeInit__mf_v__;
    const res = initPromise.then(runtime => runtime.loadShare("react", {
      customShareInfo: {shareConfig:{
        singleton: true,
        strictVersion: false,
        requiredVersion: "^18.3.1"
      }}
    }));
    const exportModule = await res.then(factory => factory());
    var UtilityMonitor__loadShare__react__loadShare__ = exportModule;

const React = /*@__PURE__*/getDefaultExportFromCjs(UtilityMonitor__loadShare__react__loadShare__);

const React$1 = /*#__PURE__*/_mergeNamespaces({
  __proto__: null,
  default: React
}, [UtilityMonitor__loadShare__react__loadShare__]);

export { React as R, UtilityMonitor__loadShare__react__loadShare__ as U, React$1 as a };
