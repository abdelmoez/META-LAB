/**
 * routes/provenance.js — 88.md. Project History / Research Provenance ledger API.
 * Mounted at /api/provenance with requireAuth; every handler additionally gates on
 * the `researchProvenance` flag (404 when off) + per-project access. Read endpoints
 * are membership-scoped; reason/invalidate are leadership-scoped. Append-only.
 */
import { Router } from 'express';
import * as P from '../controllers/provenanceController.js';

const router = Router();

router.get('/projects/:pid/events', P.getEvents);
router.get('/projects/:pid/summary', P.getSummary);
router.post('/projects/:pid/baseline', P.postBaseline);
router.post('/projects/:pid/events/:eid/reason', P.postReason);
router.post('/projects/:pid/events/:eid/invalidate', P.postInvalidate);

export default router;
