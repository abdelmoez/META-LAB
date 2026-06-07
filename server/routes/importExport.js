/**
 * routes/importExport.js
 * Import and export endpoints under /api/import and /api/export
 * All routes require authentication.
 */

import { Router } from 'express';
import { importReferences, exportProject } from '../controllers/importExportController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/import/references',  importReferences);
router.get('/export/project/:id',  exportProject);

export default router;
