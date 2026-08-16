/**
 * routes/manuscriptFigures.js — 119.md §5. Mounted at
 * /api/projects/:id/manuscript-figures with mergeParams so `:id` (the META·LAB
 * project) is visible to every handler. requireAuth at the router; each handler
 * additionally resolves resolveExtractionAccess and separates read (canView)
 * from write (canEdit) — permissions are enforced on the server, never by hiding
 * a control (§9).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  figureUploadMiddleware, listFigures, uploadFigure, replaceFigure, updateFigure,
  rawFigure, downloadFigure, deleteFigure, figureUsageRoute,
} from '../controllers/manuscriptFigureController.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.get('/', listFigures);
router.post('/', figureUploadMiddleware, uploadFigure);
router.post('/:figureId/replace', figureUploadMiddleware, replaceFigure);
router.patch('/:figureId', updateFigure);
router.get('/:figureId/raw', rawFigure);
router.get('/:figureId/download', downloadFigure);
router.get('/:figureId/usage', figureUsageRoute);
router.delete('/:figureId', deleteFigure);

export default router;
