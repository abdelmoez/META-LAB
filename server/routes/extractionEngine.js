/**
 * routes/extractionEngine.js — 76.md (Pecan Extraction Engine) article-state API.
 * Mounted at /api/extraction-engine with requireAuth + a dedicated rate limiter; every
 * handler additionally gates on the `extractionEngine` flag (404 when off) + per-project
 * access. This layer owns article STATE (list / complete / reopen / lock / inclusion /
 * audit); extraction VALUES keep flowing through the project blob autosave.
 */
import { Router } from 'express';
import * as E from '../controllers/extractionEngineController.js';

const router = Router();

router.get('/projects/:pid/articles', E.getArticles);
router.post('/projects/:pid/articles/:sid/complete', E.postComplete);
router.post('/projects/:pid/articles/:sid/reopen', E.postReopen);
router.post('/projects/:pid/articles/:sid/lock', E.postLock);
router.post('/projects/:pid/articles/:sid/inclusion', E.postInclusion);
router.get('/projects/:pid/articles/:sid/audit', E.getAudit);

export default router;
