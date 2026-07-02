/**
 * routes/publicSynthesis.js — AUTHENTICATED authoring API for public synthesis
 * pages (68.md P8). Mounted at /api/synthesis with requireAuth; every handler
 * additionally gates on the `publicSynthesis` flag (404 when off) + project access.
 * The public read side is routes/publicView.js (mounted at /api/public, no auth).
 */
import { Router } from 'express';
import * as P from '../controllers/publicSynthesisController.js';

const r = Router();

r.get('/:mlpid/status', P.getStatusHandler);
r.put('/:mlpid/settings', P.putSettingsHandler);
r.post('/:mlpid/publish', P.publishHandler);
r.post('/:mlpid/unpublish', P.unpublishHandler);
r.post('/:mlpid/regenerate-token', P.regenerateTokenHandler);
r.get('/:mlpid/preview', P.previewHandler);
r.get('/:mlpid/dashboard', P.getDashboardHandler);
r.put('/:mlpid/dashboard', P.putDashboardHandler);

export default r;
