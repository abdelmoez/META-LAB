/**
 * routes/waitlist.js — PUBLIC Beta Waitlist endpoints (prompt48). No auth.
 * Mounted at /api/waitlist behind a dedicated rate limiter (server/index.js).
 */

import { Router } from 'express';
import { submitWaitlist, resendWaitlist } from '../controllers/waitlistController.js';

const router = Router();

// POST /api/waitlist           — submit a completed application
router.post('/', submitWaitlist);
// POST /api/waitlist/resend     — re-send the confirmation email (rate-limited)
router.post('/resend', resendWaitlist);

export default router;
