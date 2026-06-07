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
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.get('/',             listStudies);
router.post('/',            createStudy);
router.put('/:studyId',     updateStudy);
router.delete('/:studyId',  deleteStudy);

export default router;
