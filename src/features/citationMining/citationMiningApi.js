/**
 * citationMiningApi.js — thin authenticated client for the P15 Bibliomine
 * citation-mining backend (server/routes/citationMining.js, mounted at
 * /api/citation-mining). Every call carries the session cookie
 * (credentials:'include'); HTTP/network failures THROW (err.status set) so panels
 * can surface an honest error/limited state. The base is 404 when the
 * `citationMining` feature flag is OFF — `citationMiningEnabled()` uses the public
 * settings endpoint to self-detect BEFORE any of these are called.
 *
 * :pid is the META·LAB Project id (the review workspace). Shapes mirror the real
 * server exactly (see citationMiningService.js shapeSeedReview/Reference/Candidate/
 * ChaseJob) — responses are wrapped ({ seedReviews }, { references }, { job }, …).
 * No user-facing "AI" wording lives here or in the panels — this is "citation
 * mining": Suggested / Resolve / Map, never "AI".
 */
const BASE = '/api/citation-mining';
const enc = (s) => encodeURIComponent(String(s == null ? '' : s));

async function http(url, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    let payload = null;
    try { payload = await r.json(); } catch { /* non-JSON error body */ }
    const err = new Error((payload && (payload.error || payload.code)) || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = payload && payload.code;
    throw err;
  }
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const citationMiningApi = {
  // ── Seed reviews (uploaded reference lists) ─────────────────────────────────
  /** POST a client-extracted seed-review PDF → { seed, referenceCount, meta }. */
  uploadSeedReview(pid, { title, filename, text }) {
    return http(`${BASE}/projects/${enc(pid)}/seed-reviews`, {
      method: 'POST', body: { title: title || '', filename: filename || '', text: text || '' },
    });
  },
  /** → { seedReviews:[…] } (newest first). */
  listSeedReviews(pid) {
    return http(`${BASE}/projects/${enc(pid)}/seed-reviews`);
  },
  /** → { seedReview } */
  getSeedReview(id) {
    return http(`${BASE}/seed-reviews/${enc(id)}`);
  },
  /** → { references:[…] } (parsed fields + parseConfidence + resolutionStatus). */
  listReferences(id) {
    return http(`${BASE}/seed-reviews/${enc(id)}/references`);
  },
  /** Resolve each reference to a canonical record → { summary:{total,resolved,notFound,error} }. */
  resolveSeed(id, { onlyPending = true } = {}) {
    return http(`${BASE}/seed-reviews/${enc(id)}/resolve`, { method: 'POST', body: { onlyPending } });
  },

  // ── Candidates ──────────────────────────────────────────────────────────────
  /** Classify candidates/refs vs the project's records → { existingCount, results:[…] }. */
  dedupePreview(pid, { candidateIds, refs, persist = true } = {}) {
    const body = { persist };
    if (Array.isArray(candidateIds) && candidateIds.length) body.candidateIds = candidateIds;
    if (Array.isArray(refs) && refs.length) body.refs = refs;
    return http(`${BASE}/projects/${enc(pid)}/citation-candidates/dedupe-preview`, { method: 'POST', body });
  },
  /** Land selected candidates into screening → { imported, skippedDuplicates, rejected, batchId, requested }. */
  importCandidates(pid, ids) {
    return http(`${BASE}/projects/${enc(pid)}/citation-candidates/import`, { method: 'POST', body: { ids } });
  },
  /** → { candidates:[…], total }. Filters: chaseJobId, seedReviewId, imported, skip, take. */
  listCandidates(pid, { chaseJobId, seedReviewId, imported, skip, take } = {}) {
    const qs = new URLSearchParams();
    if (chaseJobId) qs.set('chaseJobId', chaseJobId);
    if (seedReviewId) qs.set('seedReviewId', seedReviewId);
    if (imported === true || imported === false) qs.set('imported', String(imported));
    if (skip != null) qs.set('skip', String(skip));
    if (take != null) qs.set('take', String(take));
    const q = qs.toString();
    return http(`${BASE}/projects/${enc(pid)}/citation-candidates${q ? `?${q}` : ''}`);
  },

  // ── Citation chase (durable, bounded, cancellable) ──────────────────────────
  /** Enqueue a backward/forward chase → 202 { job }. depth ≤ 3, maxCandidates ≤ 2000. */
  startChase(pid, { seedIds, direction, depth, maxCandidates }) {
    return http(`${BASE}/projects/${enc(pid)}/citation-chase`, {
      method: 'POST',
      body: {
        seedIds: Array.isArray(seedIds) ? seedIds : [],
        direction: direction === 'forward' ? 'forward' : 'backward',
        depth, maxCandidates,
      },
    });
  },
  /** → { job:{ status, progress, total, nFound, cancelRequested, … } }. */
  getChase(pid, jobId) {
    return http(`${BASE}/projects/${enc(pid)}/citation-chase/${enc(jobId)}`);
  },
  /** → { ok, job }. */
  cancelChase(pid, jobId) {
    return http(`${BASE}/projects/${enc(pid)}/citation-chase/${enc(jobId)}/cancel`, { method: 'POST' });
  },
};

/**
 * citationMiningEnabled — read the `citationMining` feature flag from the public
 * settings endpoint (mirrors fullTextRetrievalFlagEnabled / the NMA/Living pattern).
 * Fail-closed on any error. Fetched per call so an admin toggle is picked up on the
 * next mount; the nav hook + panels each self-detect once per mount.
 */
export async function citationMiningEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.citationMining === true);
  } catch {
    return false;
  }
}

export default citationMiningApi;
