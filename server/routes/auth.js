import { Router } from 'express';
import {
  register, login, logout, getMe, forgotPassword, resetPassword,
  verifyEmail, resendVerification, updateOnboarding,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
// 93.md §4.8 — permissive shape-guard validation (types + max lengths +
// prototype-pollution rejection) on the public POST bodies. Presence/format
// checks stay in the controllers, which own the user-facing messages.
import { validateBody } from '../middleware/validateBody.js';
import {
  authRegisterSchema, authLoginSchema,
  passwordResetRequestSchema, passwordResetCompleteSchema,
} from '../schemas/publicSchemas.js';

const router = Router();

router.post('/register', validateBody(authRegisterSchema), register);
router.post('/login',    validateBody(authLoginSchema), login);
router.post('/logout',   requireAuth, logout);
router.get('/me',        requireAuth, getMe);

// prompt14 — public token-based password reset. Both inherit the /api/auth
// authLimiter mounted in server/index.js (20 req / 15 min in production).
router.post('/forgot-password', validateBody(passwordResetRequestSchema), forgotPassword);
router.post('/reset-password',  validateBody(passwordResetCompleteSchema), resetPassword);

// prompt26 — email verification (public verify/resend) + optional onboarding (auth).
router.post('/verify-email',         verifyEmail);
router.post('/resend-verification',  resendVerification);
router.post('/onboarding',           requireAuth, updateOnboarding);

export default router;
