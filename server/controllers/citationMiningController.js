/**
 * controllers/citationMiningController.js — HTTP layer for P15 citation mining.
 *
 * Every handler gates on (1) the `citationMining` feature flag (default OFF → 404
 * existence-hiding) and (2) the caller's META·LAB project access (resolveProjectAccess;
 * null → 404; mutations require canEdit → 403). Engine-dependent handlers answer
 * 503 CITATION_ENGINE_UNAVAILABLE when the parallel pure engine is absent, so the
 * routes are honest whether or not the engine has shipped.
 *
 * :pid is the META·LAB Project id (the review workspace). Sub-resource handlers
 * verify the seed/candidate/job belongs to the path project (no cross-project
 * enumeration).
 */
import { resolveProjectAccess } from '../services/workflowState.js';
import { sendTierLimit } from '../services/entitlementService.js';
import {
  citationMiningEnabled,
  ingestSeed, listSeedReviews, getSeedReview, loadOwnedSeed, loadSeed, listReferences,
  resolveSeed, dedupePreview, importCandidates, listCandidates,
  startChase, getChaseJob, loadOwnedChaseJob, cancelChase, shapeChaseJob,
} from '../citationMining/citationMiningService.js';

/** The raw SeedReview row (any project) — used to derive its owning project id. */
async function getSeedOwningProject(id) { return loadSeed(id); }

/** Flag + project-access gate. Returns access, or null (after writing a response). */
async function gate(req, res, { mutate = false, pid = req.params.pid } = {}) {
  if (!(await citationMiningEnabled(req.user))) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveProjectAccess(pid, req.user.id);
  if (!access || !access.canView) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (mutate && !access.canEdit) { res.status(403).json({ error: 'Read-only access' }); return null; }
  return access;
}

/**
 * Seed-scoped gate for the BARE /seed-reviews/:id routes (no :pid in the path):
 * flag first (existence-hiding), then resolve the seed's OWNING project and check
 * the caller's access to THAT project. Returns { access, seed } or null.
 */
async function gateSeed(req, res, { mutate = false } = {}) {
  if (!(await citationMiningEnabled(req.user))) { res.status(404).json({ error: 'Not found' }); return null; }
  const pid = req.params.pid; // present on the project-scoped alias, absent on the bare route
  const seed = pid ? await loadOwnedSeed(req.params.id, pid) : await getSeedOwningProject(req.params.id);
  if (!seed) { res.status(404).json({ error: 'Seed review not found' }); return null; }
  const access = await resolveProjectAccess(seed.metaLabProjectId, req.user.id);
  if (!access || !access.canView) { res.status(404).json({ error: 'Seed review not found' }); return null; }
  if (mutate && !access.canEdit) { res.status(403).json({ error: 'Read-only access' }); return null; }
  return { access, seed };
}

function handleError(res, err, where) {
  // Product-tier limit/entitlement (67.md) → 402/403 via the shared responder.
  if (sendTierLimit(res, err)) return;
  if (err && err.code === 'CITATION_ENGINE_UNAVAILABLE') {
    return res.status(503).json({ error: 'The citation-mining engine is not available.', code: 'CITATION_ENGINE_UNAVAILABLE' });
  }
  if (err && err.code === 'AUTHORIZATION_FAILED') return res.status(403).json({ error: 'Forbidden', code: 'AUTHORIZATION_FAILED' });
  if (err && err.code === 'IMPORT_DISABLED') return res.status(403).json({ error: err.message, code: 'IMPORT_DISABLED' });
  if (err && err.code === 'CAPACITY') return res.status(409).json({ error: err.message, code: 'CAPACITY' });
  console.error(`[citation-mining] ${where}:`, err?.message);
  return res.status(500).json({ error: 'Internal server error' });
}

// ── Seed reviews ────────────────────────────────────────────────────────────────

/** POST /projects/:pid/seed-reviews  { title, filename, text } */
export async function postSeedReview(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const body = req.body || {};
    const text = String(body.text || '');
    if (!text.trim()) return res.status(400).json({ error: 'No reference text was provided.', code: 'EMPTY_TEXT' });
    const out = await ingestSeed(req.params.pid, {
      title: String(body.title || '').slice(0, 300),
      filename: String(body.filename || '').slice(0, 300),
      text: text.slice(0, 2_000_000), // hard body cap (guards a pathological paste)
      user: req.user,
    });
    return res.status(201).json(out);
  } catch (err) { return handleError(res, err, 'postSeedReview'); }
}

/** GET /projects/:pid/seed-reviews */
export async function getSeedReviews(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    return res.json({ seedReviews: await listSeedReviews(req.params.pid) });
  } catch (err) { return handleError(res, err, 'getSeedReviews'); }
}

/** GET /seed-reviews/:id  (also project-scoped alias) */
export async function getSeedReviewDetail(req, res) {
  try {
    const gated = await gateSeed(req, res); if (!gated) return;
    return res.json({ seedReview: await getSeedReview(gated.seed.id) });
  } catch (err) { return handleError(res, err, 'getSeedReviewDetail'); }
}

/** GET /seed-reviews/:id/references  (also project-scoped alias) */
export async function getSeedReferences(req, res) {
  try {
    const gated = await gateSeed(req, res); if (!gated) return;
    return res.json({ references: await listReferences(gated.seed.id) });
  } catch (err) { return handleError(res, err, 'getSeedReferences'); }
}

/** POST /seed-reviews/:id/resolve  (also project-scoped alias) */
export async function postResolveSeed(req, res) {
  try {
    const gated = await gateSeed(req, res, { mutate: true }); if (!gated) return;
    const onlyPending = (req.body && req.body.onlyPending) !== false;
    const summary = await resolveSeed(gated.seed.id, { onlyPending });
    return res.json({ summary });
  } catch (err) { return handleError(res, err, 'postResolveSeed'); }
}

// ── Candidates ────────────────────────────────────────────────────────────────

/** POST /projects/:pid/citation-candidates/dedupe-preview  { candidateIds?, refs? } */
export async function postDedupePreview(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const body = req.body || {};
    const out = await dedupePreview(req.params.pid, {
      candidateIds: Array.isArray(body.candidateIds) ? body.candidateIds.slice(0, 2000) : [],
      refs: Array.isArray(body.refs) ? body.refs.slice(0, 2000) : [],
      persist: body.persist !== false,
    });
    return res.json(out);
  } catch (err) { return handleError(res, err, 'postDedupePreview'); }
}

/** POST /projects/:pid/citation-candidates/import  { ids } */
export async function postImportCandidates(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.slice(0, 5000) : [];
    if (!ids.length) return res.status(400).json({ error: 'No candidate ids were provided.', code: 'NO_IDS' });
    const out = await importCandidates(req.params.pid, ids, req.user);
    return res.json(out);
  } catch (err) { return handleError(res, err, 'postImportCandidates'); }
}

/** GET /projects/:pid/citation-candidates */
export async function getCandidates(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const q = req.query || {};
    const out = await listCandidates(req.params.pid, {
      chaseJobId: q.chaseJobId ? String(q.chaseJobId) : undefined,
      seedReviewId: q.seedReviewId ? String(q.seedReviewId) : undefined,
      imported: q.imported === 'true' ? true : q.imported === 'false' ? false : undefined,
      skip: q.skip, take: q.take,
    });
    return res.json(out);
  } catch (err) { return handleError(res, err, 'getCandidates'); }
}

// ── Citation chase (durable job) ────────────────────────────────────────────────

/** POST /projects/:pid/citation-chase  { seedIds, direction, depth, maxCandidates } */
export async function postStartChase(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const body = req.body || {};
    const job = await startChase(req.params.pid, {
      seedIds: Array.isArray(body.seedIds) ? body.seedIds : [],
      direction: body.direction,
      depth: body.depth,
      maxCandidates: body.maxCandidates,
      user: req.user,
    });
    return res.status(202).json({ job: shapeChaseJob(job) });
  } catch (err) { return handleError(res, err, 'postStartChase'); }
}

/** GET /projects/:pid/citation-chase/:jobId */
export async function getChaseStatus(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const owned = await loadOwnedChaseJob(req.params.jobId, req.params.pid);
    if (!owned) return res.status(404).json({ error: 'Chase job not found' });
    return res.json({ job: await getChaseJob(owned.id) });
  } catch (err) { return handleError(res, err, 'getChaseStatus'); }
}

/** POST /projects/:pid/citation-chase/:jobId/cancel */
export async function postCancelChase(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const owned = await loadOwnedChaseJob(req.params.jobId, req.params.pid);
    if (!owned) return res.status(404).json({ error: 'Chase job not found' });
    const job = await cancelChase(owned.id);
    return res.json({ ok: true, job });
  } catch (err) { return handleError(res, err, 'postCancelChase'); }
}
