/**
 * rob.js — META·LAB RoB router, mounted at /api/rob (rob.md §5).
 *
 * requireAuth is applied at the mount point in server/index.js. Every handler
 * additionally gates on the `rob_engine_v2` feature flag (default OFF → 404) and
 * authorizes the META·LAB project OWNER, OR a linked-workspace member granted the
 * `canAssessRiskOfBias` permission (no access → 404, existence hidden). Write
 * actions further require edit rights (read-only RoB members → 403). (prompt41 T5)
 */
import { Router } from 'express';
import {
  getRobInstrument,
  createAssessment,
  getAssessment,
  listProjectAssessments,
  upsertAnswers,
  overrideJudgment,
  finaliseAssessment,
  reopenAssessment,
  deleteAssessment,
  exportAssessment,
  listStudyUniverse,
  createManualStudy,
  deleteManualStudy,
} from '../controllers/robController.js';

const router = Router();

// Instrument definition (data-driven UI).
router.get('/instruments/rob2', getRobInstrument);

// Project-scoped list (for the summary plot). Declared before /assessments/:id.
router.get('/projects/:projectId/assessments', listProjectAssessments);

// prompt46 #4 — RoB study universe (screening-derived + manual) + manual-study CRUD.
router.get('/projects/:projectId/studies', listStudyUniverse);
router.post('/projects/:projectId/manual-studies', createManualStudy);
router.delete('/projects/:projectId/manual-studies/:studyId', deleteManualStudy);

// Assessment CRUD + workflow.
router.post('/assessments', createAssessment);
router.get('/assessments/:id', getAssessment);
router.get('/assessments/:id/export', exportAssessment);
router.put('/assessments/:id/answers', upsertAnswers);
router.post('/assessments/:id/override', overrideJudgment);
router.post('/assessments/:id/finalise', finaliseAssessment);
router.post('/assessments/:id/reopen', reopenAssessment);
router.delete('/assessments/:id', deleteAssessment);

export default router;
