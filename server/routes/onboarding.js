/**
 * routes/onboarding.js — prompt32 Task 6. User-facing onboarding question flow.
 * requireAuth is applied here; the gate computes pending questions per user so a
 * newly-added active question interrupts already-registered users on next login.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPending, submitResponses, skipQuestions } from '../controllers/onboardingController.js';

const router = Router();

router.get('/pending', requireAuth, getPending);
router.post('/responses', requireAuth, submitResponses);
router.post('/skip', requireAuth, skipQuestions);

export default router;
