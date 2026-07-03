/**
 * routes/meta.js
 * Meta-analysis computation endpoints under /api/meta
 * All routes require authentication.
 */

import { Router } from 'express';
import {
  runMetaAnalysis,
  runSensitivity,
  runSubgroup,
  runEgger,
  runTrimFill,
  runMetaRegression,
} from '../controllers/metaController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/run',         runMetaAnalysis);
router.post('/sensitivity', runSensitivity);
router.post('/subgroup',    runSubgroup);
router.post('/egger',       runEgger);
router.post('/trimfill',    runTrimFill);
// P13 — meta-regression + bubble plots. The controller gates on the
// `metaRegression` feature flag (default OFF → 404).
router.post('/metareg',     runMetaRegression);

export default router;
