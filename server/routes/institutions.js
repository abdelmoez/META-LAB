/**
 * routes/institutions.js — institution autocomplete (prompt35).
 * requireAuth is applied inside the router (mirrors the onboarding router). The
 * mount in server/index.js adds a dedicated rate limiter.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { search } from '../controllers/institutionController.js';

const router = Router();

router.get('/search', requireAuth, search);

export default router;
