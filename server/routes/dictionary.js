/**
 * routes/dictionary.js — 120.md §6 "Dictionary scopes".
 *
 * The writing assistant's two persisted dictionaries. Mounted at `/api/dictionary`
 * with `requireAuth` applied at the router (the records/manuscriptFigures idiom), so
 * there is no anonymous path to any handler here.
 *
 * Every handler additionally resolves its own access: the personal routes are scoped
 * to `req.user.id`, and the project routes run resolveExtractionAccess and separate
 * read (canView) from write (canEdit) — permissions are enforced on the server, never
 * by hiding a control.
 *
 * NO MANUSCRIPT TEXT crosses this router in either direction: the checker runs
 * entirely in the browser. See dictionaryController's header for the §6 privacy
 * statement in full.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listPersonal, addPersonal, removePersonal,
  listProject, addProject, removeProject,
} from '../controllers/dictionaryController.js';

const router = Router();

router.use(requireAuth);

router.get('/personal', listPersonal);
router.post('/personal', addPersonal);
router.delete('/personal/:entryId', removePersonal);

router.get('/project/:projectId', listProject);
router.post('/project/:projectId', addProject);
router.delete('/project/:projectId/:entryId', removeProject);

export default router;
