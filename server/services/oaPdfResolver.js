/**
 * server/services/oaPdfResolver.js — Open-Access PDF resolution (roadmap 1.4).
 *
 * Resolves a *legitimately open-access* PDF URL for a DOI via, in priority:
 *   Unpaywall → OpenAlex → CrossRef
 *
 * SAFETY (non-negotiable):
 *   - Only returns a PDF URL the provider marks as open access. Unpaywall and
 *     OpenAlex gate on their `is_oa` flag; CrossRef is used ONLY when the work
 *     carries an explicit open (Creative-Commons-style) licence. This never
 *     bypasses paywalls and never scrapes restricted full text.
 *
 * ARCHITECTURE:
 *   - All network I/O goes through an INJECTED `fetch` (default global fetch),
 *     so unit tests pass a mock and CI makes zero live network calls.
 *   - Never throws: every failure maps to a status. The caller decides what to
 *     do; OA failure never blocks an import.
 *   - In-memory TTL cache (keyed by normalised DOI) + a token-bucket rate limiter
 *     (per minute) so we respect provider APIs and avoid refetching.
 *
 * This module performs RESOLUTION only (find the URL). Downloading the bytes and
 * creating the ScreenPdfAttachment happens in the screening controller, behind
 * the same feature flag.
 *
 * 93.md Phase 10 — every provider fetch carries an AbortSignal.timeout bound
 * (OA_METADATA_TIMEOUT_MS, default 15s): a hung provider socket previously
 * pinned the request forever. A timeout surfaces as a provider error, which the
 * resolve() loop already swallows (try the next provider) — error semantics are
 * unchanged: resolve() still never throws.
 */
import { normalizeDoi } from '../../src/research-engine/screening/pdfMatching.js';
import { METADATA_TIMEOUT_MS, timeoutSignal } from '../utils/fetchTimeout.js';

export const OA_STATUS = {
  FOUND: 'found',
  NOT_FOUND: 'not_found',
  FAILED: 'failed',
  RATE_LIMITED: 'rate_limited',
  SKIPPED_NO_DOI: 'skipped_no_doi',
  SKIPPED_FEATURE_DISABLED: 'skipped_feature_disabled',
};

export const OA_PROVIDERS = ['unpaywall', 'openalex', 'crossref'];

/** Build resolver config from env + admin settings (all optional, safe defaults). */
export function loadOaConfig(env = process.env, settings = {}) {
  const truthy = v => v === true || v === 'true' || v === '1';
  return {
    enabled: settings.autoPdfRetrieval != null
      ? !!settings.autoPdfRetrieval
      : truthy(env.OA_PDF_RETRIEVAL_ENABLED),     // default OFF
    unpaywallEmail: env.UNPAYWALL_EMAIL || '',
    openalexEmail: env.OPENALEX_EMAIL || env.UNPAYWALL_EMAIL || '',
    crossrefMailto: env.CROSSREF_MAILTO || env.UNPAYWALL_EMAIL || '',
    providerPriority: Array.isArray(settings.oaProviderPriority) && settings.oaProviderPriority.length
      ? settings.oaProviderPriority
      : OA_PROVIDERS,
    cacheTtlMs: (Number(env.OA_PDF_CACHE_TTL_HOURS) || 24) * 3600 * 1000,
    rateLimitPerMinute: Number(env.OA_PDF_RATE_LIMIT_PER_MINUTE) || 30,
    metadataTimeoutMs: Number(env.OA_METADATA_TIMEOUT_MS) || METADATA_TIMEOUT_MS, // 93.md
  };
}

/** 93.md — per-request timeout signal; falls back to the default when a caller
 *  passes a hand-built cfg (unit tests) without metadataTimeoutMs. */
const metaSignal = cfg => timeoutSignal(cfg.metadataTimeoutMs || METADATA_TIMEOUT_MS);

/* ── Token bucket (per-minute) ─────────────────────────────────────────────── */
function makeBucket(perMinute, now) {
  let tokens = perMinute, last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(perMinute, tokens + ((t - last) / 60000) * perMinute);
      last = t;
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    },
  };
}

/* ── Providers (each returns { provider, url, license } or null) ───────────── */
async function fromUnpaywall(doi, cfg, fetch) {
  if (!cfg.unpaywallEmail) return null; // Unpaywall requires an email
  const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(cfg.unpaywallEmail)}`, { signal: metaSignal(cfg) });
  if (!res || !res.ok) return null;
  const j = await res.json();
  if (!j || !j.is_oa) return null; // OA only
  const loc = j.best_oa_location || (Array.isArray(j.oa_locations) ? j.oa_locations.find(l => l && l.url_for_pdf) : null);
  if (!loc || !loc.url_for_pdf) return null;
  return { provider: 'unpaywall', url: loc.url_for_pdf, license: loc.license || null };
}

async function fromOpenAlex(doi, cfg, fetch) {
  const mailto = cfg.openalexEmail ? `?mailto=${encodeURIComponent(cfg.openalexEmail)}` : '';
  const res = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${mailto}`, { signal: metaSignal(cfg) });
  if (!res || !res.ok) return null;
  const j = await res.json();
  const oa = (j && j.open_access) || {};
  if (!oa.is_oa) return null; // OA only
  const loc = (j && (j.best_oa_location || j.primary_location)) || {};
  if (!loc.pdf_url) return null;
  return { provider: 'openalex', url: loc.pdf_url, license: loc.license || oa.oa_status || null };
}

async function fromCrossRef(doi, cfg, fetch) {
  const headers = cfg.crossrefMailto ? { 'User-Agent': `META-LAB/1.0 (mailto:${cfg.crossrefMailto})` } : {};
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers, signal: metaSignal(cfg) });
  if (!res || !res.ok) return null;
  const j = await res.json();
  const msg = (j && j.message) || {};
  // Only when the work declares an explicit OPEN licence (Creative Commons etc.).
  const openLicence = Array.isArray(msg.license) &&
    msg.license.some(l => l && /creativecommons\.org|\/licenses\/by/i.test(l.URL || ''));
  if (!openLicence) return null;
  const link = Array.isArray(msg.link) ? msg.link.find(l => l && l['content-type'] === 'application/pdf') : null;
  if (!link || !link.URL) return null;
  return { provider: 'crossref', url: link.URL, license: 'open' };
}

const PROVIDER_FNS = { unpaywall: fromUnpaywall, openalex: fromOpenAlex, crossref: fromCrossRef };

/**
 * Create a resolver bound to a config + injected deps.
 * @param {object} cfg     from loadOaConfig()
 * @param {object} [deps]  { fetch, now } — defaults to global fetch + Date.now
 * @returns {{ resolve(doi): Promise<object>, _cache: Map }}
 */
export function createOaResolver(cfg, deps = {}) {
  const fetch = deps.fetch || globalThis.fetch;
  const now = deps.now || Date.now;
  const cache = new Map();
  const bucket = makeBucket(cfg.rateLimitPerMinute, now);

  async function resolve(doiRaw, opts = {}) {
    const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
    if (!enabled) return { status: OA_STATUS.SKIPPED_FEATURE_DISABLED };
    const doi = normalizeDoi(doiRaw);
    if (!doi) return { status: OA_STATUS.SKIPPED_NO_DOI };

    // Per-call email (the requesting USER's account email) identifies us to the
    // provider's polite pool. Unpaywall requires an email; OpenAlex/CrossRef use
    // it as `mailto`. Falls back to the configured/env email when absent.
    const email = opts.email || cfg.unpaywallEmail;
    const callCfg = email
      ? { ...cfg, unpaywallEmail: email, openalexEmail: email, crossrefMailto: email }
      : cfg;

    const hit = cache.get(doi);
    if (hit && (now() - hit.at) < cfg.cacheTtlMs) return { ...hit.result, cached: true };

    if (!bucket.take()) return { status: OA_STATUS.RATE_LIMITED, doi };

    const order = cfg.providerPriority.filter(p => PROVIDER_FNS[p]);
    for (const provider of order) {
      try {
        const found = await PROVIDER_FNS[provider](doi, callCfg, fetch);
        if (found && found.url) {
          const result = { status: OA_STATUS.FOUND, doi, ...found };
          cache.set(doi, { at: now(), result });
          return result;
        }
      } catch {
        // provider error → try the next; record nothing fatal
      }
    }
    const result = { status: OA_STATUS.NOT_FOUND, doi };
    cache.set(doi, { at: now(), result });
    return result;
  }

  return { resolve, _cache: cache };
}
