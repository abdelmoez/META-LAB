/**
 * routes/records.js
 * Mounts record CRUD under /api/projects/:id/records
 * Note: this router uses mergeParams:true so :id is available from the parent.
 * All routes require authentication.
 */

import { Router } from 'express';
import {
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
} from '../controllers/recordsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.get('/',              listRecords);
router.post('/',             createRecord);
router.put('/:recordId',     updateRecord);
router.delete('/:recordId',  deleteRecord);

export default router;
