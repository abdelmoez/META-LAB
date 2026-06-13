/**
 * routes/projects.js
 * Mounts project CRUD under /api/projects
 * All routes require authentication.
 */

import { Router } from 'express';
import {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  ownerDeleteProject,
  archiveProject,
  unarchiveProject,
  autosaveProject,
  duplicateProject,
} from '../controllers/projectsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/',               listProjects);
router.post('/',              createProject);
router.get('/:id',            getProject);
router.put('/:id',            updateProject);
router.delete('/:id',         deleteProject);
// prompt9 — typed-name confirmed soft delete (+ optional linked-SIFT cascade).
router.post('/:id/delete',    ownerDeleteProject);
// prompt11 — owner-only reversible archive (hide) + linked-workspace cascade.
router.post('/:id/archive',   archiveProject);
router.post('/:id/unarchive', unarchiveProject);
router.put('/:id/autosave',   autosaveProject);
router.post('/:id/duplicate', duplicateProject);

export default router;
