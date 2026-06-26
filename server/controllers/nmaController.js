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
import { getEffectiveFeatureFlags } from './settingsController.js';

const MAX_STUDIES = 2000;     // resource-aware bound (not a methodological cap)
const MAX_TREATMENTS = 200;

async function flagOn() {
  const f = await getEffectiveFeatureFlags();
  return !!f.networkMetaAnalysis;
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
  if (!(await flagOn())) return res.status(404).json({ error: 'Not found' });
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
  if (!(await flagOn())) return res.status(404).json({ error: 'Not found' });
  const s = sanitizeDataset(req.body || {});
  if (s.error) return res.status(400).json({ error: s.error });
  const model = req.body?.model === 'common' ? 'common' : 'random';
  const reference = typeof req.body?.reference === 'string' ? req.body.reference : undefined;
  try {
    const result = runNetworkMetaAnalysis(s.dataset, { model, reference });
    if (!result.ok) {
      return res.status(422).json({ error: result.error || 'The network is not analysable', readiness: result.readiness });
    }
    return res.json(result);
  } catch (err) {
    console.error('[nma] run error:', err.message);
    return res.status(500).json({ error: 'Network meta-analysis failed' });
  }
}
