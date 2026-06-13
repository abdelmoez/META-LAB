/**
 * routes/invites.js — public invite endpoints (prompt9).
 *
 * Mounted at /api/invites with a DEDICATED rate limiter (server/index.js).
 * Deliberately NOT under /api/screening: that router is requireAuth-gated and
 * 503-feature-flag-gated, but GET /:token must serve the pre-auth invite
 * landing page. Accept requires a logged-in user.
 */
import { Router } from 'express';
import { getInvite, acceptInvite } from '../controllers/invitesController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/:token', getInvite);                       // PUBLIC — sanitized landing info
router.post('/:token/accept', requireAuth, acceptInvite); // logged-in accept

export default router;
