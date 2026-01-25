const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["CSVImporter_v15_11.js","assets/virtualExposes-CqCLUNLT.js","assets/preload-helper-BelkbqnE.js","assets/UtilityMonitor__mf_v__runtimeInit__mf_v__-BmC4OGk6.js"])))=>i.map(i=>d[i]);
import { _ as __vitePreload } from './preload-helper-BelkbqnE.js';

const remoteEntryPromise = __vitePreload(() => import('../CSVImporter_v15_11.js'),true?__vite__mapDeps([0,1,2,3]):void 0);
    // __tla only serves as a hack for vite-plugin-top-level-await.
    Promise.resolve(remoteEntryPromise)
      .then(remoteEntry => {
        return Promise.resolve(remoteEntry.__tla)
          .then(remoteEntry.init).catch(remoteEntry.init)
      });
