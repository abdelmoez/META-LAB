/**
 * nlmClient.js — NLM E-utilities proxy for the Search Engine (separated backend
 * module). The browser NEVER calls NLM directly; this is the only place the
 * server-side NCBI API key is used. Mirrors rorClient.js: graceful (any failure
 * returns null — the frontend degrades to "limited mode"), env-configurable,
 * cached, and rate-throttled so total NLM calls stay under the published limits
 * (3/sec without a key, 10/sec with one).
 *
 * Env:
 *   NCBI_API_KEY   optional — raises 3/sec → 10/sec; never sent to the browser.
 *   NCBI_TOOL      default "metalab" (NLM etiquette — tools identify themselves).
 *   NCBI_EMAIL     optional contact for the tool.
 *   NCBI_TIMEOUT_MS default 5000.
 */
import { createTtlCache } from './ttlCache.js';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const apiKey = () => process.env.NCBI_API_KEY || '';
const tool = () => process.env.NCBI_TOOL || 'metalab';
const email = () => process.env.NCBI_EMAIL || '';
const timeoutMs = () => { const n = Number(process.env.NCBI_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 5000; };
// Spacing between NLM call STARTS: ~9/sec with a key, ~2.8/sec without (safe margin).
const minIntervalMs = () => (apiKey() ? 110 : 350);

const meshCache = createTtlCache({ ttlMs: 30 * 24 * 60 * 60 * 1000, max: 5000 }); // 30 days
const countCache = createTtlCache({ ttlMs: 60 * 60 * 1000, max: 5000 });          // 1 hour

/* ── Rate throttle: serialize the SLOT (start spacing) only, not the fetch, so a
 *    slow response never head-of-line-blocks the next call's spacing. ─────────── */
let gate = Promise.resolve();
let lastAt = 0;
function nextSlot() {
  const p = gate.then(async () => {
    const wait = Math.max(0, minIntervalMs() - (Date.now() - lastAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  });
  gate = p.catch(() => {}); // keep the chain alive on error
  return p;
}

async function nlmFetch(url) {
  if (typeof fetch !== 'function') return null; // Node < 18 without global fetch
  await nextSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null; // network/timeout/abort/bad-JSON — never throw
  } finally {
    clearTimeout(timer);
  }
}

function commonParams() {
  const p = new URLSearchParams();
  p.set('retmode', 'json');
  if (apiKey()) p.set('api_key', apiKey());
  p.set('tool', tool());
  if (email()) p.set('email', email());
  return p;
}

/**
 * Map one MeSH esummary record → the Search Builder contract shape. PURE +
 * exported so it is unit-testable without network. Returns null when there is no
 * usable descriptor.
 */
export function mapMeshSummary(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const terms = Array.isArray(rec.ds_meshterms) ? rec.ds_meshterms.filter(Boolean) : [];
  const mesh = terms[0] || '';
  if (!mesh) return null;
  return {
    mesh,
    meshUI: rec.ds_meshui || rec.DS_MeSHUI || '',
    tree: '', // esummary mesh tree numbers are not reliably present (optional in contract)
    emtree: mesh.toLowerCase(), // NLM has no Emtree data — lowercased fallback (flagged to team)
    synonyms: terms.slice(0, 40), // entry terms (capped)
    scope: rec.ds_scopenote || '',
    children: [], // narrower terms optional (RDF API) — left empty; documented follow-up
    source: 'live',
  };
}

/**
 * Free-text term → official MeSH descriptor record (or null). Two NLM steps
 * (esearch → esummary), cached by normalized term. A cached `null` is a known
 * no-match (not re-queried).
 */
export async function meshLookup(term) {
  const q = String(term || '').trim();
  if (!q) return null;
  const key = q.toLowerCase();
  const cached = meshCache.get(key);
  if (cached !== undefined) return cached;

  const p1 = commonParams(); p1.set('db', 'mesh'); p1.set('term', q);
  const s = await nlmFetch(`${EUTILS}/esearch.fcgi?${p1.toString()}`);
  const uid = s && s.esearchresult && Array.isArray(s.esearchresult.idlist) ? s.esearchresult.idlist[0] : null;
  if (!uid) { meshCache.set(key, null); return null; }

  const p2 = commonParams(); p2.set('db', 'mesh'); p2.set('id', uid);
  const sum = await nlmFetch(`${EUTILS}/esummary.fcgi?${p2.toString()}`);
  const rec = sum && sum.result ? sum.result[uid] : null;
  const mapped = mapMeshSummary(rec);
  meshCache.set(key, mapped);
  return mapped;
}

/**
 * Exact PubMed record count for a fully-rendered query string (or null when
 * unavailable). Cached by query string.
 */
export async function pubmedCount(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const cached = countCache.get(q);
  if (cached !== undefined) return cached;

  const p = commonParams(); p.set('db', 'pubmed'); p.set('term', q); p.set('rettype', 'count');
  const r = await nlmFetch(`${EUTILS}/esearch.fcgi?${p.toString()}`);
  const c = r && r.esearchresult ? r.esearchresult.count : null;
  const n = c != null && /^\d+$/.test(String(c)) ? parseInt(c, 10) : null;
  countCache.set(q, n);
  return n;
}

/** For diagnostics/tests. */
export function _caches() { return { meshCache, countCache }; }
