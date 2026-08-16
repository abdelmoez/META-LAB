/**
 * nmaController.js — Network Meta-Analysis computation endpoints (P2).
 *
 * Mirrors the stateless `/api/meta` pattern: auth-gated, receives the network
 * dataset in the body, runs the deterministic NMA engine SERVER-SIDE, returns the
 * structured result. Feature-flag gated (`networkMetaAnalysis`, default OFF → 404).
 * The engine is the shared pure module under src/research-engine/statistics/nma —
 * no project data leaves the server and no arbitrary code is executed.
 */
import { validateNetwork, runNetworkMetaAnalysis, SUPPORTED_MEASURES } from '../../src/research-engine/statistics/nma/index.js';
import { featureAccess } from '../services/featureAccess.js';
// 67.md — product-tier enforcement (admins/mods bypass inside the service).
import { requireEntitlement, sendTierLimit } from '../services/entitlementService.js';
// 119.md §8 — project Logbook: the analysis engine's server-side run events.
import { recordLogEvent, logbookActor } from '../logbook/logbookService.js';
import { resolveLogbookAccess } from '../logbook/logbookAccess.js';

const MAX_STUDIES = 2000;     // resource-aware bound (not a methodological cap)
const MAX_TREATMENTS = 200;

// 75.md Phase 7 — central seam: admins keep NMA usable while it is globally OFF
// (reason 'adminOnly'); non-admins keep the existence-hiding 404. Pass `req.user`.
async function flagOn(user = null) {
  return (await featureAccess('networkMetaAnalysis', user)).allowed;
}

/**
 * 119.md §8 — write ONE analysis-run row, but only for a project the caller can
 * actually reach. resolveLogbookAccess returns ok only for owner/leader; a
 * reviewer running an analysis is still a legitimate project event, so a non-ok
 * result with a resolved SCOPE (i.e. a member) still logs — what must never
 * happen is a stranger's body id creating rows in someone else's Logbook, and
 * that case has no scope at all. Best-effort; never throws, never awaited.
 */
async function logNmaRun(req, projectId, draft) {
  if (!projectId) return;
  try {
    const gate = await resolveLogbookAccess(projectId, req.user);
    const scope = gate.ok ? gate.scope : gate.scope;
    if (!scope || (!scope.projectId && !scope.metaLabProjectId)) return;
    await recordLogEvent(draft, {
      ...logbookActor(req, { role: gate.role }, scope),
      actorRole: gate.role || '',
    });
  } catch { /* analysis logging must never affect the analysis */ }
}

/** Pull + structurally validate the dataset from the request body. */
function sanitizeDataset(body) {
  const d = body && typeof body === 'object' && body.dataset ? body.dataset : body;
  if (!d || typeof d !== 'object') return { error: 'A dataset object is required' };
  if (!SUPPORTED_MEASURES.includes(d.sm)) return { error: `Unsupported effect measure "${d.sm}"` };
  if (!Array.isArray(d.studies) || d.studies.length === 0) return { error: 'dataset.studies must be a non-empty array' };
  if (d.studies.length > MAX_STUDIES) return { error: `Too many studies (max ${MAX_STUDIES})` };
  // Light structural guard — the engine performs full numeric validation + readiness.
  const treatments = new Set();
  for (const s of d.studies) {
    if (!s || typeof s !== 'object') return { error: 'Each study must be an object' };
    const arms = Array.isArray(s.arms) ? s.arms : [];
    arms.forEach((a) => { if (a && a.treatment != null) treatments.add(String(a.treatment)); });
    (Array.isArray(s.contrasts) ? s.contrasts : []).forEach((c) => { if (c) { if (c.t1 != null) treatments.add(String(c.t1)); if (c.t2 != null) treatments.add(String(c.t2)); } });
  }
  if (treatments.size > MAX_TREATMENTS) return { error: `Too many treatments (max ${MAX_TREATMENTS})` };
  return { dataset: { sm: d.sm, smallerBetter: !!d.smallerBetter, studies: d.studies, cc: typeof d.cc === 'number' ? d.cc : undefined } };
}

/** POST /api/nma/validate — readiness only. */
export async function nmaValidate(req, res) {
  if (!(await flagOn(req.user))) return res.status(404).json({ error: 'Not found' });
  const s = sanitizeDataset(req.body || {});
  if (s.error) return res.status(400).json({ error: s.error });
  try {
    return res.json(validateNetwork(s.dataset));
  } catch (err) {
    console.error('[nma] validate error:', err.message);
    return res.status(500).json({ error: 'Validation failed' });
  }
}

/** POST /api/nma/run — full frequentist NMA. Body: { dataset, model?, reference? }. */
export async function nmaRun(req, res) {
  if (!(await flagOn(req.user))) return res.status(404).json({ error: 'Not found' });
  // 67.md — product-tier gate (admins/mods bypass inside the service).
  try { await requireEntitlement(req.user, 'metaAnalysis.nma'); }
  catch (e) { if (sendTierLimit(res, e)) return; throw e; }
  const s = sanitizeDataset(req.body || {});
  if (s.error) return res.status(400).json({ error: s.error });
  const model = req.body?.model === 'common' ? 'common' : 'random';
  const reference = typeof req.body?.reference === 'string' ? req.body.reference : undefined;
  /* 119.md §8 "Analysis run/rerun … Model or method changes … Failed runs".
   * NMA is the app's one SERVER-side analysis run, so it is the one that can be
   * logged from the backend. The project scope is OPTIONAL and taken from the
   * body: an unscoped call (today's client) simply writes nothing rather than
   * guessing a project. Access is re-checked before any row is written, so the
   * body cannot be used to append rows to a project the caller cannot reach. */
  const scopeId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
  try {
    const result = runNetworkMetaAnalysis(s.dataset, { model, reference });
    if (!result.ok) {
      void logNmaRun(req, scopeId, {
        action: 'ANALYSIS_RUN_FAILED', status: 'failure',
        summary: `Network meta-analysis could not run: ${String(result.error || 'the network is not analysable').slice(0, 200)}`,
        after: { model, reference: reference || null, treatments: s.dataset?.treatments?.length ?? null },
      });
      return res.status(422).json({ error: result.error || 'The network is not analysable', readiness: result.readiness });
    }
    void logNmaRun(req, scopeId, {
      action: 'ANALYSIS_RUN',
      summary: `Ran a ${model}-effects network meta-analysis`,
      after: { model, reference: reference || null, studies: s.dataset?.studies?.length ?? null },
    });
    return res.json(result);
  } catch (err) {
    console.error('[nma] run error:', err.message);
    void logNmaRun(req, scopeId, {
      action: 'ANALYSIS_RUN_FAILED', status: 'failure',
      summary: 'Network meta-analysis failed',
      metadata: { reason: String(err?.message || 'unknown').slice(0, 300) },
    });
    return res.status(500).json({ error: 'Network meta-analysis failed' });
  }
}
