/**
 * routes/studies.js
 * Mounts study CRUD under /api/projects/:id/studies
 * Note: this router is mounted with mergeParams:true so :id is available.
 * All routes require authentication.
 */

import { Router } from 'express';
import {
  listStudies,
  createStudy,
  updateStudy,
  deleteStudy,
} from '../controllers/studiesController.js';
import {
  studyDocUploadMiddleware, uploadStudyDoc, getStudyDoc, downloadStudyDoc, deleteStudyDoc,
  listStudyDocs, uploadExtraStudyDoc, downloadExtraStudyDoc, deleteExtraStudyDoc,
} from '../controllers/studyDocController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.get('/',             listStudies);
router.post('/',            createStudy);
router.put('/:studyId',     updateStudy);
router.delete('/:studyId',  deleteStudy);

// 77.md §5 — persistent, cross-engine PDF for a (manual) study. Declared before the
// bare :studyId routes' semantics are unaffected (these are deeper sub-paths).
router.post('/:studyId/document', studyDocUploadMiddleware, uploadStudyDoc);
router.get('/:studyId/document', getStudyDoc);
router.get('/:studyId/document/download', downloadStudyDoc);
router.delete('/:studyId/document', deleteStudyDoc);

// 83.md-limitation fix — MULTIPLE publication files per study (supplement/protocol/
// secondary/…): additive study.documents[], same store + dedup + safe deletes.
router.get('/:studyId/documents', listStudyDocs);
router.post('/:studyId/documents', studyDocUploadMiddleware, uploadExtraStudyDoc);
router.get('/:studyId/documents/:docId/download', downloadExtraStudyDoc);
router.delete('/:studyId/documents/:docId', deleteExtraStudyDoc);

export default router;
