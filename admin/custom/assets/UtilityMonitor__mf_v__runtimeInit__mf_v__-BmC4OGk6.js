const globalKey = "__mf_init____mf__virtual/UtilityMonitor__mf_v__runtimeInit__mf_v__.js__";
    if (!globalThis[globalKey]) {
      let initResolve, initReject;
      const initPromise = new Promise((re, rj) => {
        initResolve = re;
        initReject = rj;
      });
      globalThis[globalKey] = {
        initPromise,
        initResolve,
        initReject
      };
    }
    var UtilityMonitor__mf_v__runtimeInit__mf_v__ = globalThis[globalKey];

export { UtilityMonitor__mf_v__runtimeInit__mf_v__ as U };
