/**
 * features/manuscript/writingAssistant/waDictAssets.js — 120.md §6.
 *
 * The ONLY module in the feature that knows how dictionary bytes are obtained. It is
 * deliberately separate from engine/ (which is pure and Node-testable) and from
 * waWorker.js (which is protocol glue), because this is the one place with build-tool
 * knowledge: Vite's `?url` asset imports.
 *
 * WHY `?url` AND NOT `?raw` / a direct package import:
 *   - `dictionary-en`'s own entry point is `index.js`, which does
 *     `await fs.readFile(...)` at module scope. That is Node-only and cannot run in a
 *     Worker, so the package's JS entry is unusable here; the `.aff`/`.dic` DATA
 *     files are what we want. Its `exports` map does not expose them by subpath
 *     (verified: `import('dictionary-en/index.dic')` throws
 *     ERR_PACKAGE_PATH_NOT_EXPORTED), hence the explicit relative path.
 *   - `?raw` would inline ~1.1 MB of dictionary text into the worker chunk for BOTH
 *     variants, whether or not the user ever enables the feature.
 *   - `?url` emits each file as a separate hashed build asset and gives us a string.
 *     The worker chunk stays tiny; the 555 KB word list is fetched ONCE, from the
 *     app's own origin, only after the user turns the assistant on, and only for the
 *     variant they chose. That is the lazy loading 120.md §6 asks for.
 *
 * CSP / PRIVACY (§6): these are same-origin bundled assets. There is no CDN, no
 * external host, and no request that carries any manuscript text. `fetch` here reads
 * a static file the app itself shipped — the same shape as the staged OCR assets.
 *
 * CSP GOTCHA, handled here: the production policy is `connect-src 'self'` with NO
 * `data:` (server/security/csp.js:195). Vite inlines any asset under
 * `build.assetsInlineLimit` (4 KB) as a data: URI, and the two 3,086-byte `.aff`
 * files fall under it — so `fetch()`ing them would be blocked in production while
 * working perfectly in dev. `readAsset` therefore decodes data: URIs itself and only
 * calls `fetch` for real same-origin URLs. Verified against a production-shaped Vite
 * build: `.dic` files are emitted to /assets (551.76 kB, 552.11 kB), `.aff` files
 * come back as data: URIs.
 *
 * SIZES (measured): index.dic 551,762 B (190,834 B gzip) for en-US and 552,106 B
 * (190,840 B gzip) for en-GB; index.aff 3,086 B each. Only one variant is ever
 * loaded, and only after the user enables the assistant.
 */

import enAffUrl from '../../../../node_modules/dictionary-en/index.aff?url';
import enDicUrl from '../../../../node_modules/dictionary-en/index.dic?url';
import gbAffUrl from '../../../../node_modules/dictionary-en-gb/index.aff?url';
import gbDicUrl from '../../../../node_modules/dictionary-en-gb/index.dic?url';

/** variant → the two asset URLs Vite emitted for it. */
export const DICTIONARY_URLS = Object.freeze({
  'en-US': Object.freeze({ aff: enAffUrl, dic: enDicUrl }),
  'en-GB': Object.freeze({ aff: gbAffUrl, dic: gbDicUrl }),
});

/**
 * Fetch one variant's Hunspell pair as UTF-8 text (both `.aff` files declare
 * `SET UTF-8`; nspell accepts strings).
 *
 * Loaded lazily: nothing here runs until the worker receives its first `init`, which
 * only happens after the user enables the assistant.
 *
 * @param {'en-US'|'en-GB'} variant
 * @returns {Promise<{aff:string, dic:string, bytes:number}>}
 */
export async function loadDictionary(variant) {
  const urls = DICTIONARY_URLS[variant] || DICTIONARY_URLS['en-US'];
  const [aff, dic] = await Promise.all([
    readAsset(urls.aff),
    readAsset(urls.dic),
  ]);
  return { aff, dic, bytes: aff.length + dic.length };
}

/** A data: URI is decoded in place; anything else is a same-origin fetch. */
export async function readAsset(url) {
  if (typeof url === 'string' && url.startsWith('data:')) return decodeDataUri(url);
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`Dictionary asset request failed with status ${response.status}`);
    error.name = 'DictionaryFetchError';
    throw error;
  }
  return response.text();
}

/** Decode `data:[<mime>][;charset=…][;base64],<payload>` to a UTF-8 string. */
export function decodeDataUri(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) {
    const error = new Error('Malformed dictionary data URI');
    error.name = 'DictionaryDecodeError';
    throw error;
  }
  const header = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (!/;base64$/i.test(header)) return decodeURIComponent(payload);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
