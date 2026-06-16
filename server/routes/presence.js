/**
 * routes/presence.js — app-wide (non-project) presence ping (prompt25 follow-up).
 * One authenticated endpoint that records the caller in the global presence room
 * so users who are online but NOT inside a project (dashboard, profile, ops) still
 * count as "online now" in the Ops console. Project-scoped presence + field locks
 * stay under /api/screening/projects/:pid/presence.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { globalPing } from '../controllers/presenceController.js';

const router = Router();
router.use(requireAuth);
router.post('/ping', globalPing);

export default router;
