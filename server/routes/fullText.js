/**
 * routes/fullText.js — automated OA full-text retrieval API (68.md P9).
 * Mounted at /api/full-text with requireAuth; every handler additionally gates on
 * the `fullTextRetrieval` flag (404 when off) + per-project screening access.
 * :pid is the ScreenProject id.
 */
import { Router } from 'express';
import * as F from '../controllers/fullTextController.js';

const r = Router();

r.get('/:pid/status', F.getStatus);
r.post('/:pid/retrieve', F.retrieve);
r.get('/:pid/jobs/:jobId', F.getJob);

// Per-record views (declare the static 'records' path before any :rid capture).
r.get('/:pid/records', F.getRecords);
r.get('/:pid/records/:rid/candidates', F.getCandidates);
r.post('/:pid/records/:rid/request', F.upsertRequest);

// Bulk PDF upload → match → auto-attach high-confidence (multer 'files' array).
r.post('/:pid/bulk-upload', F.bulkUploadMiddleware, F.bulkUpload_);

export default r;
