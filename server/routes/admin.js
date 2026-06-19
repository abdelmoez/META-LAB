import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireAdminOrMod, requireTargetEditable } from '../middleware/requireRole.js';
import {
  getMetrics,
  getMetricsTimeseries,
  getUsers,
  getUserCountries,
  getUserActivitySummary,
  getUserActivity,
  getUserById,
  getUserProjects,
  updateUser,
  updateUserStatus,
  updateUserRole,
  resetUserPassword,
  sendPasswordReset,
  getProjects,
  archiveProject,
  restoreProject,
  getAdminSettings,
  updateAdminSettings,
  getAdminThemeSettings,
  updateThemeSettings,
  getLandingContent,
  updateLandingContent,
  getFeatureFlags,
  updateFeatureFlags,
  getAuditLog,
  getSecurityEvents,
  getUserAnalytics,
  getUserGrowth,
  getInstitutions,
  mergeInstitutions,
  renameInstitution,
  rejectInstitutionDuplicate,
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
  restoreScreeningProject,
  getScreeningProjectMembers,
  getHandoffLogs,
  getScreeningAuditLog,
  getWorkspaceHealth,
  repairWorkspaces,
} from '../controllers/screeningAdminController.js';

import {
  adminListQuestions,
  adminCreateQuestion,
  adminUpdateQuestion,
  adminReorderQuestions,
  adminResetQuestion,
  adminDeleteQuestion,
  adminGetSettings as getOnboardingSettings,
  adminUpdateSettings as updateOnboardingSettings,
  adminOnboardingAnalytics,
  adminOnboardingQuestionAnalytics,
  adminOnboardingUserStatus,
} from '../controllers/onboardingController.js';

import {
  getRobSettings,
  updateRobSettings,
  getRobMetrics,
} from '../controllers/robAdminController.js';

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
// Read is mod-allowed for ALL targets. Mutations (edit/status/reset-password)
// are mod-allowed ONLY against ordinary users — requireTargetEditable 403s a
// mod acting on an admin/mod target (admins are unrestricted).
router.get('/users', requireAdminOrMod, getUsers);
// prompt19 — aggregate users-by-country distribution for the Ops map (admin only).
// MUST be declared before '/users/:id' so "countries" is not parsed as an :id.
router.get('/users/countries', requireAdmin, getUserCountries);
// prompt25 Task 1 — live activity summary (admin only). Specific path BEFORE :id.
router.get('/users/activity-summary', requireAdmin, getUserActivitySummary);
router.get('/users/:id', requireAdminOrMod, getUserById);
router.get('/users/:id/projects', requireAdminOrMod, getUserProjects);
// prompt25 Task 1 — per-user live location/online (mod cannot target admin/mod).
router.get('/users/:id/activity', requireAdminOrMod, requireTargetEditable, getUserActivity);
router.patch('/users/:id', requireAdminOrMod, requireTargetEditable, updateUser);
router.patch('/users/:id/status', requireAdminOrMod, requireTargetEditable, updateUserStatus);
router.post('/users/:id/reset-password', requireAdminOrMod, requireTargetEditable, resetUserPassword);
// prompt14 — production-preferred token-based reset (emails a self-service link).
router.post('/users/:id/send-password-reset', requireAdminOrMod, requireTargetEditable, sendPasswordReset);
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
router.get('/metrics/timeseries', requireAdmin, getMetricsTimeseries);

router.get('/projects', requireAdmin, getProjects);
router.patch('/projects/:id/archive', requireAdmin, archiveProject);
router.patch('/projects/:id/restore', requireAdmin, restoreProject);

router.get('/settings', requireAdmin, getAdminSettings);
router.put('/settings', requireAdmin, updateAdminSettings);

// prompt37 — global brand theme (admin only). Specific path BEFORE any generic
// settings handling; PATCH validates strictly + audits APP_THEME_UPDATED.
router.get('/settings/theme', requireAdmin, getAdminThemeSettings);
router.patch('/settings/theme', requireAdmin, updateThemeSettings);

router.get('/landing-content', requireAdmin, getLandingContent);
router.put('/landing-content', requireAdmin, updateLandingContent);

router.get('/feature-flags', requireAdmin, getFeatureFlags);
router.put('/feature-flags', requireAdmin, updateFeatureFlags);

router.get('/audit-log', requireAdmin, getAuditLog);
router.get('/security-events', requireAdmin, getSecurityEvents);

// ── Ops Users analytics + institution management (admin only) ──────────────────
router.get('/user-analytics', requireAdmin, getUserAnalytics);
// prompt27 — new-user registration analytics over time (Overview + Users).
router.get('/user-growth', requireAdmin, getUserGrowth);
router.get('/institutions', requireAdmin, getInstitutions);
router.post('/institutions/merge', requireAdmin, mergeInstitutions);
router.post('/institutions/rename', requireAdmin, renameInstitution);
router.post('/institutions/reject', requireAdmin, rejectInstitutionDuplicate);

// Health (admin only — exposes runtime details)
router.get('/health', requireAdmin, getHealth);

// META·SIFT Beta admin controls (admin only)
router.get('/screening/settings',              requireAdmin, getScreeningSettings);
router.put('/screening/settings',              requireAdmin, updateScreeningSettings);
router.get('/screening/metrics',               requireAdmin, getScreeningMetrics);
// Internal screening-engine health + one-click repair (prompt18 unified workspace)
router.get('/screening/workspace-health',        requireAdmin, getWorkspaceHealth);
router.post('/screening/workspace-health/repair', requireAdmin, repairWorkspaces);
router.get('/screening/handoffs',              requireAdmin, getHandoffLogs);
router.get('/screening/audit',                 requireAdmin, getScreeningAuditLog);
router.get('/screening/projects',              requireAdmin, listScreeningProjects);
router.get('/screening/projects/:id',          requireAdmin, getScreeningProject);
router.get('/screening/projects/:id/members',  requireAdmin, getScreeningProjectMembers);
router.patch('/screening/projects/:id/status', requireAdmin, updateScreeningProjectStatus);
// prompt9 — revive an owner-deleted ScreenProject (clears deletedAt + deletedSource).
router.patch('/screening/projects/:id/restore', requireAdmin, restoreScreeningProject);

// ── Onboarding questions (prompt32 Task 7) — admin only ─────────────────────────
router.get('/onboarding-settings',              requireAdmin, getOnboardingSettings);
router.put('/onboarding-settings',              requireAdmin, updateOnboardingSettings);
// prompt36 Task 6 — onboarding analytics (overview + per-question + per-user
// drill-down). Specific analytics paths are declared BEFORE the generic :id
// mutation routes so they are never shadowed.
router.get('/onboarding-analytics',                 requireAdmin, adminOnboardingAnalytics);
router.get('/onboarding-questions/:id/analytics',   requireAdmin, adminOnboardingQuestionAnalytics);
router.get('/onboarding-users/:id/status',          requireAdmin, adminOnboardingUserStatus);
router.get('/onboarding-questions',             requireAdmin, adminListQuestions);
router.post('/onboarding-questions',            requireAdmin, adminCreateQuestion);
router.post('/onboarding-questions/reorder',    requireAdmin, adminReorderQuestions);
router.patch('/onboarding-questions/:id',       requireAdmin, adminUpdateQuestion);
router.post('/onboarding-questions/:id/reset',  requireAdmin, adminResetQuestion);
router.delete('/onboarding-questions/:id',      requireAdmin, adminDeleteQuestion);

// ── Risk of Bias engine (prompt32 Task 12) — admin only ─────────────────────────
router.get('/rob/settings',  requireAdmin, getRobSettings);
router.put('/rob/settings',  requireAdmin, updateRobSettings);
router.get('/rob/metrics',   requireAdmin, getRobMetrics);

export default router;
