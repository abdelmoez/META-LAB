/**
 * validationController.js
 * Handlers for study validation endpoints.
 */

import {
  validateStudy,
  checkPoolability,
  analysisTypeWarnings,
} from '../../src/research-engine/validation/study-validator.js';

/**
 * POST /api/validation/check
 * Body: { studies: Study[] }
 * Returns: {
 *   poolability: PoolabilityResult,
 *   studyIssues: Array<{ studyId, issues: ValidationItem[] }>,
 *   typeWarnings: WarningItem[]
 * }
 */
export function checkValidation(req, res) {
  const { studies } = req.body || {};

  if (!Array.isArray(studies)) {
    return res.status(400).json({ error: 'studies must be an array' });
  }

  const poolability = checkPoolability(studies);
  const studyIssues = studies.map(s => ({
    studyId: s.id,
    author: s.author,
    issues: validateStudy(s),
  }));
  const typeWarnings = analysisTypeWarnings(studies);

  res.json({ poolability, studyIssues, typeWarnings });
}
