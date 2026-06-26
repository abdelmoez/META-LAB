/**
 * routes/nma.js — Network Meta-Analysis endpoints under /api/nma (P2).
 * All routes require authentication; the controller additionally gates on the
 * `networkMetaAnalysis` feature flag (404 when OFF).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { nmaValidate, nmaRun } from '../controllers/nmaController.js';

const router = Router();
router.use(requireAuth);
router.post('/validate', nmaValidate);
router.post('/run', nmaRun);

export default router;
