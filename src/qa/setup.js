// Populate window.QA / window.QATheme / window.qa* mirrors used across the ported modules.
import './data.js';
import './engine.js';
import './theme.js';
import { qaParseImport } from './import-parser.js';
import demoCollectionRaw from '../../demo/public-apis.postman_collection.json?raw';

// Auto-load the bundled public-apis Postman collection so a fresh launch
// has a real, callable workspace. The demo collection's URLs are absolute
// (JSONPlaceholder, Open-Meteo, REST Countries, …) so they work regardless of the active
// environment. Failures are non-fatal — the app still boots with an empty
// workspace if the demo file is ever removed or malformed.
//
// Idempotency: window.QA persists across Vite HMR re-evaluations of this
// module, so without a guard each hot-reload would push another copy of
// the demo collection. The flag lives on the QA object itself so it
// survives module replacement.
if (!window.QA._demoLoaded) {
  try {
    const parsed = qaParseImport(demoCollectionRaw);
    if (parsed && !parsed.error) {
      Object.assign(window.QA.REQUEST_DETAILS, parsed.details);
      Object.assign(window.QA.RESPONSES, parsed.responses);
      window.QA.COLLECTIONS.push(parsed.collection);
      window.QA._demoLoaded = true;
    } else if (typeof console !== 'undefined') {
      console.warn('Demo collection auto-load skipped:', parsed && parsed.error);
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('Demo collection auto-load failed:', e);
  }
}
