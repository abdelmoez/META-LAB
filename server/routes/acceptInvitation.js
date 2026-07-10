/**
 * routes/acceptInvitation.js — PUBLIC waitlist-invitation acceptance (80.md).
 *
 * Mounted at /api/accept-invitation with a DEDICATED rate limiter (server/index.js),
 * BEFORE the auth-gated bare '/api' router so both endpoints work pre-auth (the
 * invitee has no account until they accept). Unlike /api/invites (project-member
 * accept requires a session), the accept POST here is fully anonymous — it CREATES
 * the account — so it carries NO requireAuth. The URL token is the only credential.
 */
import { Router } from 'express';
import { validateInvitation, acceptInvitation } from '../controllers/acceptInvitationController.js';

const router = Router();

router.get('/:token', validateInvitation);          // PUBLIC — sanitized landing info
router.post('/:token/accept', acceptInvitation);    // PUBLIC — sets password, creates account

export default router;
