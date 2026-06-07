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
} from '../controllers/metaController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/run',         runMetaAnalysis);
router.post('/sensitivity', runSensitivity);
router.post('/subgroup',    runSubgroup);
router.post('/egger',       runEgger);
router.post('/trimfill',    runTrimFill);

export default router;
