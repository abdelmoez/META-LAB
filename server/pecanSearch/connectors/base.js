/**
 * pecanSearch/connectors/base.js — the connector CONTRACT + shared helpers.
 *
 * A connector hides a provider's API shape from the rest of the engine. The
 * pipeline only ever sees the contract below; a provider's response structure
 * never leaks past its connector (§8). Every connector is a factory:
 *
 *   createXConnector(providerConfig, deps) => Connector
 *     deps: { http, now, logger }   (http = createHttpClient(...); DI for tests)
 *
 * Connector interface (all methods pure-ish + cancellable via deps/signal):
 *
 *   provider: string
 *   capabilities(): {
 *     id, label, platform, requiresCredentials, configured, available,
 *     supportsCountPreview, maxResults, supportedFields
 *   }
 *   translateQuery(canonical, { override }): TranslatedQuery   // see ast.makeTranslated
 *   validateQuery(canonical): { ok, errors[], warnings[] }
 *   previewCount(translated, { signal }): { count|null, kind, at }
 *   search(translated, cursor|null, { signal, pageSize, capRemaining }):
 *       { records: RawItem[], nextCursor: string|null, total: number|null, rateLimit }
 *   normalize(rawItem): NormalizedRecord                       // see normalize.js
 *
 * Connectors NEVER throw raw provider errors to the pipeline — they throw typed
 * PecanErrors (errors.js) so retry/partial-success semantics are uniform.
 */
import { buildUrl as _buildUrl } from './urlUtil.js';
import crypto from 'crypto';

export { buildUrl } from './urlUtil.js';

/**
 * contentHashId — a deterministic fallback providerRecordId for records that lack
 * a stable provider identifier, so the PecanSourceRecord idempotency key
 * (runId, provider, providerRecordId) is always populated and stable across
 * retries. Built from the strongest available identity fields.
 */
export function contentHashId(rec = {}) {
  const basis = [
    (rec.doi || '').toLowerCase(),
    rec.pmid || '',
    rec.nctId || '',
    (rec.title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200),
    rec.year || '',
  ].join('|');
  return 'h:' + crypto.createHash('sha1').update(basis, 'utf8').digest('hex').slice(0, 24);
}

/** Clamp a requested page size into a sane bound for a provider. */
export function clampPageSize(requested, providerMax = 100) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return Math.min(100, providerMax);
  return Math.max(1, Math.min(Math.floor(n), providerMax));
}

/** Re-export so connectors import url building from one place. */
export const __urlUtil = _buildUrl;
