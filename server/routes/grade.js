/**
 * routes/grade.js — P12 GRADE certainty of evidence + Summary of Findings.
 * Mounted at /api/grade (requireAuth applied at the mount in server/index.js).
 * Each handler additionally gates on the `gradeCertainty` feature flag (404 when
 * OFF) and enforces project permission (reads=canView, writes/lock=canEdit; lock/
 * unlock require owner/leader).
 */
import { Router } from 'express';
import {
  getOutcomes, getOutcome, putOutcome, lockOutcome, unlockOutcome, getAudit, getSof,
} from '../controllers/gradeController.js';

const router = Router();

router.get('/projects/:pid/outcomes', getOutcomes);
router.get('/projects/:pid/outcomes/:key', getOutcome);
router.put('/projects/:pid/outcomes/:key', putOutcome);
router.post('/projects/:pid/outcomes/:key/lock', lockOutcome);
router.post('/projects/:pid/outcomes/:key/unlock', unlockOutcome);
router.get('/projects/:pid/audit', getAudit);
router.get('/projects/:pid/sof', getSof);

export default router;
