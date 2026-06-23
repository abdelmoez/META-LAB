/**
 * pecanSearch/config.js — Pecan Search Engine configuration loader.
 *
 * Two configuration sources, kept strictly separated:
 *   1. ENVIRONMENT (server-side only) — secrets + base URLs + contact identity.
 *      Per-provider convention:  <PROVIDER>_API_BASE, <PROVIDER>_API_KEY,
 *      <PROVIDER>_TIMEOUT_MS, plus shared PECAN_SEARCH_CONTACT_EMAIL / _TOOL.
 *      API keys NEVER leave the server (never returned to the browser, never
 *      placed in a SiteSetting, never logged — see redact.js).
 *   2. ADMIN SiteSetting `searchProviderSettings` (NON-secret policy) — per-provider
 *      enable/disable, default + max result caps, concurrency, retry, timeouts,
 *      preview throttling, institutional restrictions. Editable from the Ops
 *      Console; validated server-side.
 *
 * loadPecanConfig(env, settings) merges PROVIDER_REGISTRY defaults < env < admin
 * policy and returns a fully-resolved, secret-bearing config used ONLY on the
 * server. publicProviderConfig(config) derives the SECRET-FREE shape safe to send
 * to the browser (capabilities + configured-state, never the key itself).
 */

/**
 * Static provider registry. `requiresCredentials` providers are unusable (and
 * reported as such) until a key is configured. `maxResults` is the provider's
 * documented hard ceiling for a single search (we never page past it).
 */
export const PROVIDER_REGISTRY = Object.freeze({
  pubmed: {
    id: 'pubmed',
    label: 'PubMed',
    platform: 'NCBI E-utilities',
    defaultBaseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    requiresCredentials: false,        // optional NCBI key raises the rate limit
    supportsCountPreview: true,
    maxResults: 10000,                 // PRISMA-style review cap; esearch retstart ceiling
    pageSize: 200,
    supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pmid', 'pmcid', 'pubType', 'meshTerms', 'language'],
    keyEnv: 'NCBI_API_KEY',
  },
  europepmc: {
    id: 'europepmc',
    label: 'Europe PMC',
    platform: 'EBI REST',
    defaultBaseUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest',
    requiresCredentials: false,
    supportsCountPreview: true,
    maxResults: 10000,
    pageSize: 100,
    supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pmid', 'pmcid', 'pubType'],
    keyEnv: '',
  },
  clinicaltrials: {
    id: 'clinicaltrials',
    label: 'ClinicalTrials.gov',
    platform: 'CTG API v2',
    defaultBaseUrl: 'https://clinicaltrials.gov/api/v2',
    requiresCredentials: false,
    supportsCountPreview: true,
    maxResults: 10000,
    pageSize: 100,
    supportedFields: ['title', 'abstract', 'authors', 'year', 'nctId', 'pubType'],
    keyEnv: '',
  },
  crossref: {
    id: 'crossref',
    label: 'Crossref',
    platform: 'Crossref REST',
    defaultBaseUrl: 'https://api.crossref.org',
    requiresCredentials: false,        // polite pool via contact email (recommended)
    supportsCountPreview: true,
    maxResults: 10000,
    pageSize: 100,
    supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pubType'],
    keyEnv: '',
  },
  doaj: {
    id: 'doaj',
    label: 'DOAJ',
    platform: 'DOAJ API v3',
    defaultBaseUrl: 'https://doaj.org/api/v3',
    requiresCredentials: false,
    supportsCountPreview: true,
    maxResults: 10000,
    pageSize: 100,
    supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi'],
    keyEnv: '',
  },
  openalex: {
    id: 'openalex',
    label: 'OpenAlex',
    platform: 'OpenAlex REST',
    defaultBaseUrl: 'https://api.openalex.org',
    requiresCredentials: false,        // polite pool via contact email (recommended)
    supportsCountPreview: true,
    maxResults: 10000,
    pageSize: 200,
    supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pmid', 'pubType', 'language'],
    keyEnv: '',
  },
  semanticscholar: {
    id: 'semanticscholar',
    label: 'Semantic Scholar',
    platform: 'S2 Graph API',
    defaultBaseUrl: 'https://api.semanticscholar.org/graph/v1',
    requiresCredentials: false,        // optional key raises the rate limit
    supportsCountPreview: true,
    maxResults: 10000,
    pageSize: 100,
    supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pmid'],
    keyEnv: 'S2_API_KEY',
  },
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDER_REGISTRY));

/** Engine-level defaults (overridable by the admin policy SiteSetting). */
export const ENGINE_DEFAULTS = Object.freeze({
  defaultResultCap: 2000,     // per-source default cap if the user doesn't set one
  maxResultCap: 10000,        // hard per-source ceiling (cannot be exceeded by a user)
  concurrency: 3,             // simultaneous provider fetches within one run
  retryLimit: 4,              // transient-error retries per provider request
  requestTimeoutMs: 20000,    // per external request (full run path)
  maxResponseBytes: 25 * 1024 * 1024, // 25 MB per response — guards against OOM
  previewThrottleMs: 1500,    // min spacing between count-preview calls per provider/IP
  // ── Count-preview budget (interactive, best-effort) ───────────────────────────
  // A preview must NEVER block the request long enough for a reverse proxy to
  // return 504. The endpoint fans out to every provider and waits at most
  // previewDeadlineMs total; any provider still in flight is reported as a
  // 'timeout' (the full search still runs that source). Each preview request also
  // fails fast: a short timeout + few retries (a run retries thoroughly; a preview
  // should be snappy). previewDeadlineMs must stay well under any proxy timeout.
  previewDeadlineMs: 12000,   // overall fan-out budget for one preview-count call
  previewTimeoutMs: 7000,     // per-provider count-preview request timeout (fast-fail)
  previewRetryLimit: 1,       // count previews retry at most once
  pageDelayMs: 0,             // optional extra spacing between page fetches
  institutionalMode: false,   // when true, only explicitly-enabled providers run
  maxActiveRunsPerProject: 3, // quota: queued+running runs per project (abuse guard)
});

const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : dflt; };
const bool = (v, dflt) => (v == null ? dflt : v === true || v === 'true' || v === '1' || v === 1);

/**
 * loadPecanConfig(env, settings) — resolve the full (secret-bearing) engine config.
 *
 * @param {object} [env]       process.env (default)
 * @param {object} [settings]  parsed `searchProviderSettings` SiteSetting block
 * @returns {{ engine, contact, providers }}
 */
export function loadPecanConfig(env = process.env, settings = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const sp = s.providers && typeof s.providers === 'object' ? s.providers : {};

  const engine = {
    defaultResultCap: num(s.defaultResultCap, ENGINE_DEFAULTS.defaultResultCap),
    maxResultCap:     Math.min(num(s.maxResultCap, ENGINE_DEFAULTS.maxResultCap), 50000),
    concurrency:      Math.max(1, Math.min(num(s.concurrency, ENGINE_DEFAULTS.concurrency), 8)),
    retryLimit:       Math.min(num(s.retryLimit, ENGINE_DEFAULTS.retryLimit), 10),
    requestTimeoutMs: Math.min(num(env.PECAN_SEARCH_TIMEOUT_MS || s.requestTimeoutMs, ENGINE_DEFAULTS.requestTimeoutMs), 120000),
    maxResponseBytes: num(s.maxResponseBytes, ENGINE_DEFAULTS.maxResponseBytes),
    previewThrottleMs: num(s.previewThrottleMs, ENGINE_DEFAULTS.previewThrottleMs),
    // Preview budget: clamp so it can never exceed a sane interactive ceiling. The
    // deadline stays < 30s (under typical proxy_read_timeout); the per-call timeout
    // stays < the deadline so a single provider cannot consume the whole budget.
    previewDeadlineMs: Math.max(2000, Math.min(num(env.PECAN_PREVIEW_DEADLINE_MS || s.previewDeadlineMs, ENGINE_DEFAULTS.previewDeadlineMs), 30000)),
    previewTimeoutMs:  Math.max(1000, Math.min(num(env.PECAN_PREVIEW_TIMEOUT_MS || s.previewTimeoutMs, ENGINE_DEFAULTS.previewTimeoutMs), 30000)),
    previewRetryLimit: Math.min(num(s.previewRetryLimit, ENGINE_DEFAULTS.previewRetryLimit), 4),
    pageDelayMs:      num(s.pageDelayMs, ENGINE_DEFAULTS.pageDelayMs),
    institutionalMode: bool(env.PECAN_SEARCH_INSTITUTIONAL_MODE ?? s.institutionalMode, ENGINE_DEFAULTS.institutionalMode),
    maxActiveRunsPerProject: Math.max(1, Math.min(num(s.maxActiveRunsPerProject, ENGINE_DEFAULTS.maxActiveRunsPerProject), 20)),
  };

  // Shared polite-pool identity (NLM/Crossref/OpenAlex all ask tools to identify).
  const contact = {
    tool: env.PECAN_SEARCH_TOOL || env.NCBI_TOOL || 'pecanrev',
    email: env.PECAN_SEARCH_CONTACT_EMAIL || env.NCBI_EMAIL || env.CROSSREF_MAILTO || '',
  };

  const providers = {};
  for (const id of PROVIDER_IDS) {
    const reg = PROVIDER_REGISTRY[id];
    const upper = id.toUpperCase();
    const policy = sp[id] && typeof sp[id] === 'object' ? sp[id] : {};
    const apiKey = reg.keyEnv ? String(env[reg.keyEnv] || '').trim() : '';
    // institutionalMode: a provider is OFF unless explicitly enabled in policy.
    const defaultEnabled = engine.institutionalMode ? false : true;
    const enabled = bool(policy.enabled, defaultEnabled);
    const configured = reg.requiresCredentials ? !!apiKey : true;
    providers[id] = {
      ...reg,
      enabled,
      configured,
      available: enabled && configured,
      baseUrl: String(env[`${upper}_API_BASE`] || policy.baseUrl || reg.defaultBaseUrl).replace(/\/+$/, ''),
      apiKey,                                  // SECRET — never serialize to the client
      hasKey: !!apiKey,
      timeoutMs: Math.min(num(env[`${upper}_TIMEOUT_MS`] || policy.timeoutMs, engine.requestTimeoutMs), 120000),
      defaultCap: Math.min(num(policy.defaultCap, engine.defaultResultCap), engine.maxResultCap),
      maxCap: Math.min(num(policy.maxCap, reg.maxResults), engine.maxResultCap, reg.maxResults),
    };
  }

  return { engine, contact, providers };
}

/**
 * publicProviderConfig — derive the SECRET-FREE provider config safe to return to
 * the browser. Drops apiKey entirely; exposes only capabilities + configured state.
 */
export function publicProviderConfig(config) {
  const out = [];
  for (const id of PROVIDER_IDS) {
    const p = config.providers[id];
    if (!p) continue;
    out.push({
      id: p.id,
      label: p.label,
      platform: p.platform,
      enabled: p.enabled,
      requiresCredentials: p.requiresCredentials,
      configured: p.configured,            // boolean only — NEVER the key value
      available: p.available,
      supportsCountPreview: p.supportsCountPreview,
      maxResults: p.maxResults,
      defaultCap: p.defaultCap,
      maxCap: p.maxCap,
      supportedFields: p.supportedFields,
    });
  }
  return out;
}

/** The secret values present in a config — for redaction in logs/errors. */
export function configSecrets(config) {
  const out = [];
  for (const id of PROVIDER_IDS) {
    const k = config.providers[id] && config.providers[id].apiKey;
    if (k) out.push(k);
  }
  return out;
}
