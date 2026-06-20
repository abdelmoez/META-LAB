/**
 * routes/importExport.js
 * Import and export endpoints under /api/import and /api/export
 * All routes require authentication.
 */

import { Router } from 'express';
import { importReferences, exportProject, authorizeJournalSubmission } from '../controllers/importExportController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/import/references',  importReferences);
router.get('/export/project/:id',  exportProject);
router.post('/export/journal-submission/:id', authorizeJournalSubmission); // prompt42 Task 8

export default router;
