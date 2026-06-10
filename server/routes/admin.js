import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireAdminOrMod } from '../middleware/requireRole.js';
import {
  getMetrics,
  getUsers,
  getUserById,
  getUserProjects,
  updateUser,
  updateUserStatus,
  updateUserRole,
  resetUserPassword,
  getProjects,
  archiveProject,
  restoreProject,
  getAdminSettings,
  updateAdminSettings,
  getLandingContent,
  updateLandingContent,
  getFeatureFlags,
  updateFeatureFlags,
  getAuditLog,
  getSecurityEvents,
  getContactMessages,
  getUnreadMessageCount,
  markMessageRead,
  updateContactMessage,
  deleteContactMessage,
  replyToMessage,
  getMessageReplies,
  getConsole,
  getHealth,
} from '../controllers/adminController.js';

import {
  getScreeningSettings,
  updateScreeningSettings,
  getScreeningMetrics,
  listScreeningProjects,
  getScreeningProject,
  updateScreeningProjectStatus,
  getScreeningProjectMembers,
  getHandoffLogs,
  getScreeningAuditLog,
} from '../controllers/screeningAdminController.js';

const router = Router();

// Admin-specific rate limiter (prompt6 Task 14): the two cheap, high-frequency
// console polling GETs (capability descriptor + per-staff unread badge) are
// exempt so a mod polling its own badge can never 429 itself out of the
// console. Everything else shares one budget — 300/15min in production
// (HealthSection polls every 30s = 30 req/window on its own), with extra
// headroom outside production for the integration suites.
const POLL_EXEMPT_GETS = new Set(['/console', '/contact-messages/unread-count']);
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 300 : 1000,
  // req.path here is relative to the /api/admin mount (router-level middleware).
  skip: req => req.method === 'GET' && POLL_EXEMPT_GETS.has(req.path),
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiter to all admin routes
router.use(adminLimiter);

// NOTE: requireAuth is applied at the mount point in index.js.
// Authorization is enforced PER ROUTE below:
//   - requireAdminOrMod  → admin OR mod (DB-verified, not suspended)
//   - requireAdmin       → admin only
// Server-side middleware is the source of truth; the console UI hides sections
// only for UX (see GET /console).

// ── Console capability descriptor (admin + mod) ───────────────────────────────
router.get('/console', requireAdminOrMod, getConsole);

// ── Users ─────────────────────────────────────────────────────────────────────
// Read + edit + status + reset-password are mod-allowed.
router.get('/users', requireAdminOrMod, getUsers);
router.get('/users/:id', requireAdminOrMod, getUserById);
router.get('/users/:id/projects', requireAdminOrMod, getUserProjects);
router.patch('/users/:id', requireAdminOrMod, updateUser);
router.patch('/users/:id/status', requireAdminOrMod, updateUserStatus);
router.post('/users/:id/reset-password', requireAdminOrMod, resetUserPassword);
// Role assignment + delete are ADMIN ONLY.
router.patch('/users/:id/role', requireAdmin, updateUserRole);

// ── Contact messages (admin + mod) ─────────────────────────────────────────────
router.get('/contact-messages', requireAdminOrMod, getContactMessages);
// Per-staff unread badge + mark-read (prompt5 Task 9). Specific routes BEFORE :id.
router.get('/contact-messages/unread-count', requireAdminOrMod, getUnreadMessageCount);
router.post('/contact-messages/:id/mark-read', requireAdminOrMod, markMessageRead);
router.patch('/contact-messages/:id', requireAdminOrMod, updateContactMessage);
router.get('/contact-messages/:id/replies', requireAdminOrMod, getMessageReplies);
router.post('/contact-messages/:id/reply', requireAdminOrMod, replyToMessage);
// Deleting a message is ADMIN ONLY.
router.delete('/contact-messages/:id', requireAdmin, deleteContactMessage);

// ── Admin-only: metrics, projects lifecycle, settings, flags, content, security ─
router.get('/metrics', requireAdmin, getMetrics);

router.get('/projects', requireAdmin, getProjects);
router.patch('/projects/:id/archive', requireAdmin, archiveProject);
router.patch('/projects/:id/restore', requireAdmin, restoreProject);

router.get('/settings', requireAdmin, getAdminSettings);
router.put('/settings', requireAdmin, updateAdminSettings);

router.get('/landing-content', requireAdmin, getLandingContent);
router.put('/landing-content', requireAdmin, updateLandingContent);

router.get('/feature-flags', requireAdmin, getFeatureFlags);
router.put('/feature-flags', requireAdmin, updateFeatureFlags);

router.get('/audit-log', requireAdmin, getAuditLog);
router.get('/security-events', requireAdmin, getSecurityEvents);

// Health (admin only — exposes runtime details)
router.get('/health', requireAdmin, getHealth);

// META·SIFT Beta admin controls (admin only)
router.get('/screening/settings',              requireAdmin, getScreeningSettings);
router.put('/screening/settings',              requireAdmin, updateScreeningSettings);
router.get('/screening/metrics',               requireAdmin, getScreeningMetrics);
router.get('/screening/handoffs',              requireAdmin, getHandoffLogs);
router.get('/screening/audit',                 requireAdmin, getScreeningAuditLog);
router.get('/screening/projects',              requireAdmin, listScreeningProjects);
router.get('/screening/projects/:id',          requireAdmin, getScreeningProject);
router.get('/screening/projects/:id/members',  requireAdmin, getScreeningProjectMembers);
router.patch('/screening/projects/:id/status', requireAdmin, updateScreeningProjectStatus);

export default router;
