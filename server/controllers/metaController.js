/**
 * metaController.js
 * Handlers for meta-analysis computation endpoints.
 * All endpoints are POST — they receive study arrays and return computed results.
 */

import {
  runMeta,
  eggersTest,
  leaveOneOut,
  trimFill,
  influenceDiagnostics,
  subgroupAnalysis,
} from '../../src/research-engine/statistics/meta-analysis.js';
// P13 — meta-regression + bubble plots. Pure deterministic engine; gated behind
// the `metaRegression` feature flag (default OFF → 404), mirroring the NMA route.
import { metaRegression } from '../../src/research-engine/statistics/metaRegression.js';
import { featureAccess } from '../services/featureAccess.js';

/**
 * POST /api/meta/run
 * Body: { studies: Study[], method?: "fixed"|"random" }
 * Returns: MetaResult | null
 */
export function runMetaAnalysis(req, res) {
  const { studies, method = 'random' } = req.body || {};

  if (!Array.isArray(studies) || studies.length === 0) {
    return res.status(400).json({ error: 'studies array is required and must not be empty' });
  }

  const result = runMeta(studies, method);
  if (result === null) {
    return res.status(422).json({ error: 'At least 2 valid studies are required to run a meta-analysis' });
  }

  res.json(result);
}

/**
 * POST /api/meta/sensitivity
 * Body: { studies: Study[], method?: "fixed"|"random" }
 * Returns: { leaveOneOut: LOOEntry[], influence: InfluenceEntry[] }
 */
export function runSensitivity(req, res) {
  const { studies, method = 'random' } = req.body || {};

  if (!Array.isArray(studies) || studies.length === 0) {
    return res.status(400).json({ error: 'studies array is required and must not be empty' });
  }

  const loo = leaveOneOut(studies, method);
  const influence = influenceDiagnostics(studies, method);

  res.json({ leaveOneOut: loo, influence });
}

/**
 * POST /api/meta/subgroup
 * Body: { studies: Study[], groupKey: string, method?: "fixed"|"random" }
 * Returns: SubgroupResult
 */
export function runSubgroup(req, res) {
  const { studies, groupKey, method = 'random' } = req.body || {};

  if (!Array.isArray(studies) || studies.length === 0) {
    return res.status(400).json({ error: 'studies array is required and must not be empty' });
  }
  if (!groupKey || typeof groupKey !== 'string') {
    return res.status(400).json({ error: 'groupKey is required' });
  }

  const result = subgroupAnalysis(studies, groupKey, method);
  res.json(result);
}

/**
 * POST /api/meta/egger
 * Body: { studies: Study[] }
 * Returns: EggerResult | null
 */
export function runEgger(req, res) {
  const { studies } = req.body || {};

  if (!Array.isArray(studies) || studies.length === 0) {
    return res.status(400).json({ error: 'studies array is required and must not be empty' });
  }

  const result = eggersTest(studies);
  if (result === null) {
    return res.status(422).json({ error: 'At least 3 studies are required for Egger\'s test' });
  }

  res.json(result);
}

/**
 * POST /api/meta/trimfill
 * Body: { studies: Study[], method?: "fixed"|"random" }
 * Returns: TrimFillResult | null
 */
export function runTrimFill(req, res) {
  const { studies, method = 'random' } = req.body || {};

  if (!Array.isArray(studies) || studies.length === 0) {
    return res.status(400).json({ error: 'studies array is required and must not be empty' });
  }

  const result = trimFill(studies, method);
  if (result === null) {
    return res.status(422).json({ error: 'Could not compute trim-and-fill (insufficient valid studies)' });
  }

  res.json(result);
}

/**
 * POST /api/meta/metareg  (P13 — meta-regression + bubble plots)
 * Feature-flag gated: `metaRegression` OFF (default) → 404 (existence-hidden),
 * matching the NMA route convention. Stateless like runMetaAnalysis — the
 * deterministic engine runs on the supplied studies; nothing is persisted.
 *
 * Body: {
 *   studies: Study[],                 // each carries es + (se|variance|lo/hi) + covariate value(s)
 *   covariate?: string,               // single covariate name (shorthand)
 *   covariates?: ({name,type}|string)[], // multivariable-ready alternative
 *   type?: 'continuous'|'binary'|'categorical'|'ordinal',
 *   method?: 'MM'|'REML',
 *   measure?: string,
 * }
 * Returns: MetaRegressionResult (ok:false with warnings for degenerate/under-powered input).
 */
export async function runMetaRegression(req, res) {
  // 75.md Phase 7 — central seam: admins keep meta-regression usable while it is
  // globally OFF (reason 'adminOnly'); non-admins keep the existence-hiding 404.
  if (!(await featureAccess('metaRegression', req.user)).allowed) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { studies, covariate, covariates, type, method = 'MM', measure } = req.body || {};

  if (!Array.isArray(studies) || studies.length === 0) {
    return res.status(400).json({ error: 'studies array is required and must not be empty' });
  }
  if (!covariate && !(Array.isArray(covariates) && covariates.length)) {
    return res.status(400).json({ error: 'a covariate (or covariates[]) is required' });
  }

  try {
    const result = metaRegression(studies, { covariate, covariates, type, method, measure });
    // The engine returns ok:false (with warnings) rather than throwing for
    // degenerate / under-powered inputs — surface it as 422 so the client can
    // show the guardrail messages, mirroring runMeta's "not analysable" case.
    if (!result.ok) {
      return res.status(422).json({ error: 'Meta-regression is not analysable for these inputs', ...result });
    }
    return res.json(result);
  } catch (err) {
    console.error('[meta] metareg error:', err.message);
    return res.status(500).json({ error: 'Meta-regression failed' });
  }
}
