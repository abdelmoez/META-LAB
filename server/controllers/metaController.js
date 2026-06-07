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
