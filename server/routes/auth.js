import { Router } from 'express';
import {
  register, login, logout, getMe, forgotPassword, resetPassword,
  verifyEmail, resendVerification, updateOnboarding,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login',    login);
router.post('/logout',   requireAuth, logout);
router.get('/me',        requireAuth, getMe);

// prompt14 — public token-based password reset. Both inherit the /api/auth
// authLimiter mounted in server/index.js (20 req / 15 min in production).
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

// prompt26 — email verification (public verify/resend) + optional onboarding (auth).
router.post('/verify-email',         verifyEmail);
router.post('/resend-verification',  resendVerification);
router.post('/onboarding',           requireAuth, updateOnboarding);

export default router;
