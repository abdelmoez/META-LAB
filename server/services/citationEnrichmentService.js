/**
 * citationEnrichmentService.js — citation-graph metadata for the screening AI
 * (66.md P4.3). Fetches PUBLIC bibliographic metadata (citation counts +
 * reference lists) from OpenAlex for a project's records, caches it globally by
 * identifier in CitationMetadata, and exposes it to the pure engine as a plain
 * per-record map.
 *
 * Design rules (66.md non-negotiables):
 *  - Citation metadata is NEVER required for screening — every failure path
 *    degrades to "no citation signal" and scoring proceeds unchanged.
 *  - Only public identifiers (DOI / PMID) leave the server; no titles/abstracts
 *    or project data are sent to the provider.
 *  - Calls are batched + rate-limited and respect OpenAlex's polite-pool rules
 *    (mailto from env). Results are cached; re-runs cost no API calls.
 */
import { prisma } from '../db/client.js';

const OPENALEX_BASE = () => process.env.OPENALEX_API_BASE || 'https://api.openalex.org';
const MAILTO = () => process.env.PECAN_SEARCH_CONTACT_EMAIL || process.env.NCBI_EMAIL || '';
const BATCH = 50;                    // OpenAlex OR-filter cap per request
const BATCH_DELAY_MS = 200;          // stay well under the 10 req/s polite limit
const REQUEST_TIMEOUT_MS = 15000;
const MAX_REFS_STORED = 300;         // cap stored reference list per work
const MAX_KEYS_PER_RUN = Number(process.env.AI_CITATION_MAX_PER_RUN) || 5000;
// not_found / error rows older than this are retried on the next enrichment run.
const RETRY_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** Normalize a DOI to its bare lowercase form (no https://doi.org/ prefix). */
export function normalizeDoi(doi) {
  const s = String(doi || '').trim().toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
  return /^10\.\S+$/.test(s) ? s : '';
}

/** Cache key for a record: 'doi:…' preferred, else 'pmid:…', else null. */
export function keyForRecord(record) {
  const doi = normalizeDoi(record?.doi);
  if (doi) return `doi:${doi}`;
  const pmid = String(record?.pmid || '').replace(/\D/g, '');
  if (pmid) return `pmid:${pmid}`;
  return null;
}

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}

/** Map an OpenAlex work object → the compact payload we cache. */
export function workToPayload(work) {
  const refs = Array.isArray(work?.referenced_works)
    ? work.referenced_works.slice(0, MAX_REFS_STORED).map(u => String(u).replace(/^https?:\/\/openalex\.org\//, ''))
    : [];
  const concepts = Array.isArray(work?.concepts)
    ? work.concepts.filter(c => c && c.display_name && c.score > 0.3).slice(0, 5).map(c => c.display_name)
    : [];
  return {
    citedByCount: Number.isFinite(work?.cited_by_count) ? work.cited_by_count : null,
    referenceCount: refs.length,
    year: Number.isFinite(work?.publication_year) ? work.publication_year : null,
    refs,
    concepts,
  };
}

/** Extract both possible cache keys from an OpenAlex work (doi + pmid). */
function keysFromWork(work) {
  const keys = [];
  const doi = normalizeDoi(work?.doi);
  if (doi) keys.push(`doi:${doi}`);
  const pmidUrl = work?.ids?.pmid;
  const pmid = String(pmidUrl || '').replace(/\D/g, '');
  if (pmid) keys.push(`pmid:${pmid}`);
  return keys;
}

async function fetchWithTimeout(url, fetchFn) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error(`Citation request timed out after ${REQUEST_TIMEOUT_MS}ms`)); }, REQUEST_TIMEOUT_MS);
    });
    const res = await Promise.race([
      fetchFn(url, { headers: { Accept: 'application/json' }, ...(ctrl ? { signal: ctrl.signal } : {}) }),
      timeout,
    ]);
    if (!res.ok) throw new Error(`OpenAlex returned ${res.status}`);
    return await res.json();
  } finally { if (timer) clearTimeout(timer); }
}

/** One batched OpenAlex works lookup for a homogeneous key list ('doi' or 'pmid'). */
async function fetchBatch(kind, values, fetchFn) {
  const select = 'id,doi,ids,cited_by_count,referenced_works,publication_year,concepts';
  const filter = kind === 'doi'
    ? `doi:${values.join('|')}`
    : `ids.pmid:${values.join('|')}`;
  const mailto = MAILTO() ? `&mailto=${encodeURIComponent(MAILTO())}` : '';
  const url = `${OPENALEX_BASE()}/works?filter=${encodeURIComponent(filter)}&per-page=${BATCH}&select=${select}${mailto}`;
  const data = await fetchWithTimeout(url, fetchFn);
  return Array.isArray(data?.results) ? data.results : [];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * enrichProjectCitations — fetch + cache citation metadata for every record of a
 * screening project that has a DOI/PMID and no fresh cache row. Batched, rate-
 * limited, resumable (cache = progress). Returns an honest summary.
 *
 * @param {string} projectId — ScreenProject id
 * @param {{onProgress?:Function, fetchFn?:Function, force?:boolean}} [opts]
 */
export async function enrichProjectCitations(projectId, opts = {}) {
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const report = (d) => { try { opts.onProgress && opts.onProgress(d); } catch { /* ignore */ } };
  const records = await prisma.screenRecord.findMany({
    where: { projectId },
    select: { id: true, doi: true, pmid: true },
  });

  const keyByRecord = new Map();
  const keys = new Set();
  for (const r of records) {
    const k = keyForRecord(r);
    if (k) { keyByRecord.set(r.id, k); keys.add(k); }
  }
  const allKeys = [...keys];
  const summary = {
    totalRecords: records.length,
    withIdentifier: keyByRecord.size,
    uniqueKeys: allKeys.length,
    cached: 0, fetched: 0, notFound: 0, failed: 0, skipped: 0,
  };
  if (!allKeys.length || typeof fetchFn !== 'function') return summary;

  // Which keys already have a usable cache row?
  const existing = await prisma.citationMetadata.findMany({
    where: { key: { in: allKeys } },
    select: { key: true, status: true, fetchedAt: true },
  });
  const now = Date.now();
  const fresh = new Set();
  for (const row of existing) {
    const stale = row.status !== 'ok' && (now - new Date(row.fetchedAt).getTime()) > RETRY_STALE_MS;
    if (!opts.force && !stale) fresh.add(row.key);
  }
  summary.cached = fresh.size;

  let missing = allKeys.filter(k => !fresh.has(k));
  if (missing.length > MAX_KEYS_PER_RUN) {
    summary.skipped = missing.length - MAX_KEYS_PER_RUN;
    missing = missing.slice(0, MAX_KEYS_PER_RUN);
  }
  const dois = missing.filter(k => k.startsWith('doi:')).map(k => k.slice(4));
  const pmids = missing.filter(k => k.startsWith('pmid:')).map(k => k.slice(5));

  const found = new Map(); // key → {workId, payload}
  const total = dois.length + pmids.length;
  let done = 0;
  for (const [kind, values] of [['doi', dois], ['pmid', pmids]]) {
    for (let i = 0; i < values.length; i += BATCH) {
      const slice = values.slice(i, i + BATCH);
      try {
        const works = await fetchBatch(kind, slice, fetchFn);
        for (const w of works) {
          const workId = String(w?.id || '').replace(/^https?:\/\/openalex\.org\//, '');
          const payload = workToPayload(w);
          for (const k of keysFromWork(w)) {
            if (keys.has(k)) found.set(k, { workId, payload });
          }
        }
      } catch (e) {
        summary.failed += slice.length;
        summary.lastError = String(e?.message || e).slice(0, 300);
      }
      done += slice.length;
      report({ phase: 'citation_enrichment', processed: done, total });
      if (i + BATCH < values.length) await sleep(BATCH_DELAY_MS);
    }
  }

  // Upsert cache rows: found → ok; requested-but-missing → not_found (cached so we
  // don't hammer the API for records OpenAlex doesn't know).
  const missingSet = new Set(missing);
  const rows = [];
  for (const k of missing) {
    const hit = found.get(k);
    rows.push(hit
      ? { key: k, workId: hit.workId, status: 'ok', payload: JSON.stringify(hit.payload), error: null }
      : { key: k, workId: null, status: 'not_found', payload: '{}', error: null });
  }
  // Keys resolved via the OTHER identifier of the same work (doi row answering a pmid
  // key) may not be in `missing`; persist those too.
  for (const [k, hit] of found) {
    if (!missingSet.has(k) && !fresh.has(k)) {
      rows.push({ key: k, workId: hit.workId, status: 'ok', payload: JSON.stringify(hit.payload), error: null });
    }
  }
  for (const row of rows) {
    if (row.status === 'ok') summary.fetched++;
    else summary.notFound++;
    await prisma.citationMetadata.upsert({
      where: { key: row.key },
      create: row,
      update: { ...row, fetchedAt: new Date() },
    }).catch(() => { summary.failed++; });
  }
  // Rows counted as fetched/notFound above; failures during a batch were already
  // tallied. Adjust notFound not to double-count batch failures.
  return summary;
}

/**
 * loadCitationByRecordId — cache → pure-engine map. Only 'ok' rows contribute;
 * shape matches citationSignals.js. Never throws (returns {} on any failure).
 *
 * @param {Array<{id,doi,pmid}>} records
 * @returns {Promise<Record<string, object>>}
 */
export async function loadCitationByRecordId(records) {
  try {
    const keyByRecord = new Map();
    const keys = new Set();
    for (const r of records) {
      const k = keyForRecord(r);
      if (k) { keyByRecord.set(r.id, k); keys.add(k); }
    }
    if (!keys.size) return {};
    const rows = await prisma.citationMetadata.findMany({
      where: { key: { in: [...keys] }, status: 'ok' },
      select: { key: true, workId: true, payload: true },
    });
    const byKey = new Map(rows.map(r => [r.key, r]));
    const out = {};
    for (const [rid, k] of keyByRecord) {
      const row = byKey.get(k);
      if (!row) continue;
      const p = safeParse(row.payload, {});
      out[rid] = {
        workId: row.workId || null,
        citedByCount: p.citedByCount ?? null,
        referenceCount: p.referenceCount ?? null,
        refs: Array.isArray(p.refs) ? p.refs : [],
        year: p.year ?? null,
        concepts: Array.isArray(p.concepts) ? p.concepts : [],
      };
    }
    return out;
  } catch { return {}; }
}

/**
 * getCitationStatus — honest enrichment coverage for a project (UI status card).
 */
export async function getCitationStatus(projectId) {
  const records = await prisma.screenRecord.findMany({
    where: { projectId },
    select: { id: true, doi: true, pmid: true },
  });
  const keys = new Set();
  for (const r of records) {
    const k = keyForRecord(r);
    if (k) keys.add(k);
  }
  let enriched = 0, notFound = 0, lastFetchedAt = null;
  if (keys.size) {
    const rows = await prisma.citationMetadata.findMany({
      where: { key: { in: [...keys] } },
      select: { status: true, fetchedAt: true },
    });
    for (const row of rows) {
      if (row.status === 'ok') enriched++;
      else notFound++;
      if (!lastFetchedAt || row.fetchedAt > lastFetchedAt) lastFetchedAt = row.fetchedAt;
    }
  }
  return {
    totalRecords: records.length,
    withIdentifier: keys.size,
    enriched,
    notFound,
    pending: Math.max(0, keys.size - enriched - notFound),
    coverage: records.length ? enriched / records.length : 0,
    lastFetchedAt,
    provider: 'openalex',
    mailtoConfigured: !!MAILTO(),
  };
}
