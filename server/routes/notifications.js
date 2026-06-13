/**
 * routes/notifications.js
 * Per-user notification bell endpoints (prompt6 Task 1).
 * All routes require authentication.
 *
 * Mounted at /api/notifications as its OWN router — deliberately NOT under the
 * rate-limited /api/auth or /api/admin mounts: the bell polls /unread-count and
 * would self-DoS against those limiters.
 */

import { Router } from 'express';
import {
  listNotifications,
  getUnreadCount,
  markRead,
  dismissNotification,
  markOpened,
  markAllRead,
} from '../controllers/notificationsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/',               listNotifications);
router.get('/unread-count',   getUnreadCount);
router.post('/:id/read',      markRead);
router.post('/:id/dismiss',   dismissNotification);
router.post('/:id/opened',    markOpened);   // click contract: read+dismiss+clicked in one call (prompt9)
router.post('/mark-all-read', markAllRead);

export default router;
