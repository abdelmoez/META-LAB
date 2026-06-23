/**
 * routes/pecanSearch.js — Pecan Search Engine (P1) routes.
 *
 * Mounted at /api/pecan-search with requireAuth + a dedicated limiter at the
 * mount (server/index.js). Each handler additionally gates on the `pecanSearch`
 * feature flag (404 when OFF) and the caller's META·LAB project access.
 * :projectId is the META·LAB Project id (the search workspace).
 */
import { Router } from 'express';
import {
  getProviders, postValidate, postTranslate, postPreviewCount,
  postStartRun, getRuns, getRun, postCancelRun, postRetryRun,
  getRunDuplicates, postResolveDuplicate, getReport, getReportExport,
} from '../pecanSearch/pecanSearchController.js';

const router = Router();

// Provider catalogue (flag + auth only).
router.get('/providers', getProviders);

// Query helpers (project-scoped).
router.post('/projects/:projectId/validate', postValidate);
router.post('/projects/:projectId/translate', postTranslate);
router.post('/projects/:projectId/preview-count', postPreviewCount);

// Runs.
router.post('/projects/:projectId/runs', postStartRun);
router.get('/projects/:projectId/runs', getRuns);
router.get('/projects/:projectId/runs/:runId', getRun);
router.post('/projects/:projectId/runs/:runId/cancel', postCancelRun);
router.post('/projects/:projectId/runs/:runId/retry', postRetryRun);

// Duplicate review.
router.get('/projects/:projectId/runs/:runId/duplicates', getRunDuplicates);
router.post('/projects/:projectId/runs/:runId/duplicates/:decisionId/resolve', postResolveDuplicate);

// Report + export.
router.get('/projects/:projectId/runs/:runId/report', getReport);
router.get('/projects/:projectId/runs/:runId/report/export', getReportExport);

export default router;
