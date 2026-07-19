/**
 * routes/authGoogle.js — 94.md §2 — Google OAuth routes.
 *
 * Mounted at /api/auth/google in server/index.js with its OWN oauthLimiter and
 * BEFORE the general /api/auth mount, so an OAuth round-trip (~3 requests) never
 * burns the strict 20-req/15-min password-auth budget (a few failed Google
 * attempts would otherwise lock an IP out of password login too). Staying under
 * /api/* keeps the app-wide apiNoStore Cache-Control: no-store on every response
 * (§3.7: OAuth callbacks must never be cacheable).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { googleStart, googleCallback, googleLinkStart, googleUnlink } from '../controllers/googleAuthController.js';

const router = Router();

router.get('/start',        googleStart);
router.get('/callback',     googleCallback);
router.post('/link/start',  requireAuth, googleLinkStart);
router.post('/unlink',      requireAuth, googleUnlink);

export default router;
