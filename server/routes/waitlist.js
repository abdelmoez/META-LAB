/**
 * routes/waitlist.js — PUBLIC Beta Waitlist endpoints (prompt48). No auth.
 * Mounted at /api/waitlist behind a dedicated rate limiter (server/index.js).
 */

import { Router } from 'express';
import { submitWaitlist, resendWaitlist } from '../controllers/waitlistController.js';
// 93.md §4.8 — shape guard only (types/lengths/proto-pollution). The shared
// validateApplication() whitelister keeps owning the per-field 422 messages,
// and .passthrough() keeps the `website` honeypot reaching the controller.
import { validateBody } from '../middleware/validateBody.js';
import { waitlistSubmitSchema } from '../schemas/publicSchemas.js';

const router = Router();

// POST /api/waitlist           — submit a completed application
router.post('/', validateBody(waitlistSubmitSchema), submitWaitlist);
// POST /api/waitlist/resend     — re-send the confirmation email (rate-limited)
router.post('/resend', resendWaitlist);

export default router;
