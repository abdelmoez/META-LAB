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
  getProjectDetail,
  getProjectsOverview,
  getProjectGrowth,
  getProjectAnalytics,
  archiveProject,
  restoreProject,
  getAdminSettings,
  updateAdminSettings,
  getAdminThemeSettings,
  updateThemeSettings,
  getDesignSettings,
  updateDesignSettings,
  getLandingContent,
  updateLandingContent,
  getFeatureFlags,
  updateFeatureFlags,
  getAuditLog,
  getSecurityEvents,
  getSecuritySummary,
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
  composeEmail,
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
  getAiScreeningSettings,
  updateAiScreeningSettings,
  getAiRunLogs,
} from '../controllers/screeningAiAdminController.js';

// 70.md P10 — global Criteria/Eligibility Screener policy (admin only).
import {
  getEligibilityScreeningSettings,
  updateEligibilityScreeningSettings,
} from '../controllers/settingsController.js';

import {
  getExtractionAiAdminSettings,
  updateExtractionAiAdminSettings,
  getLivingReviewAdminSettings,
  updateLivingReviewAdminSettings,
  getFullTextAdminSettings,
  updateFullTextAdminSettings,
} from '../controllers/researchOpsAdminController.js';

import {
  getTiersAdmin,
  updateTierAdmin,
  createTierAdmin,
  duplicateTierAdmin,
  archiveTierAdmin,
  getProjectExportUsageAdmin,
  updateTierSettingsAdmin,
  updateUserTierAdmin,
  getTierAnalytics,
  getUserTierHistory,
  getUsersInTier,
  exportUsersInTier,
  revertUserTier,
  getUserSubscription,
  updateUserSubscription,
} from '../controllers/tierAdminController.js';

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

import {
  adminWaitlistMetrics,
  adminListApplicants,
  adminGetApplicant,
  adminUpdateStatus,
  adminUpdateNotes,
  adminResendConfirmation,
  adminRemoveApplicant,
  adminExportApplicants,
} from '../controllers/waitlistAdminController.js';
import {
  adminInviteApplicant,
  adminResendInvitation,
  adminRevokeInvitation,
  adminInvitationHistory,
  adminBulkInvite,
} from '../controllers/invitationAdminController.js';
import {
  getSearchProviders,
  updateSearchProviders,
  requeueJob as requeueSearchJob,
} from '../pecanSearch/adminController.js';
import {
  adminListEngineVersions,
  adminEngineVersionHistory,
} from '../controllers/engineVersionController.js';

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
// 65.md PERM-06 — full-record + project-list reads are target-gated like the
// mutations: a mod may not inspect an admin/mod account (the Ops UI already
// renders staff rows locked for mods; this makes the API agree). The list
// summary (GET /users) stays mod-readable for support triage.
router.get('/users/:id', requireAdminOrMod, requireTargetEditable, getUserById);
router.get('/users/:id/projects', requireAdminOrMod, requireTargetEditable, getUserProjects);
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
// Compose & send a NEW email to any recipient (staff-initiated; admin + mod).
router.post('/emails', requireAdminOrMod, composeEmail);
// Deleting a message is ADMIN ONLY.
router.delete('/contact-messages/:id', requireAdmin, deleteContactMessage);

// ── Admin-only: metrics, projects lifecycle, settings, flags, content, security ─
router.get('/metrics', requireAdmin, getMetrics);
router.get('/metrics/timeseries', requireAdmin, getMetricsTimeseries);

// prompt50 WS1 — Ops Projects analytics. Static /projects/overview is declared
// BEFORE the /projects/:id/* routes so it can never be shadowed by :id.
router.get('/projects/overview', requireAdmin, getProjectsOverview);
router.get('/project-growth', requireAdmin, getProjectGrowth);
router.get('/project-analytics', requireAdmin, getProjectAnalytics);
router.get('/projects', requireAdmin, getProjects);
router.get('/projects/:id/detail', requireAdmin, getProjectDetail);
router.patch('/projects/:id/archive', requireAdmin, archiveProject);
router.patch('/projects/:id/restore', requireAdmin, restoreProject);

router.get('/settings', requireAdmin, getAdminSettings);
router.put('/settings', requireAdmin, updateAdminSettings);

// prompt37 — global brand theme (admin only). Specific path BEFORE any generic
// settings handling; PATCH validates strictly + audits APP_THEME_UPDATED.
router.get('/settings/theme', requireAdmin, getAdminThemeSettings);
router.patch('/settings/theme', requireAdmin, updateThemeSettings);

// prompt61 — Stitch UI rollout settings (admin only). Read default merge lives in
// the controller; PUT validates strictly + audits DESIGN_SETTINGS_UPDATED.
router.get('/design-settings', requireAdmin, getDesignSettings);
router.put('/design-settings', requireAdmin, updateDesignSettings);

router.get('/landing-content', requireAdmin, getLandingContent);
router.put('/landing-content', requireAdmin, updateLandingContent);

router.get('/feature-flags', requireAdmin, getFeatureFlags);
router.put('/feature-flags', requireAdmin, updateFeatureFlags);

// ── Pecan Search Engine (P1) provider management + queue/worker health ─────────
router.get('/search-providers', requireAdmin, getSearchProviders);
router.patch('/search-providers', requireAdmin, updateSearchProviders);
router.post('/search-providers/jobs/:jobId/requeue', requireAdmin, requeueSearchJob);

router.get('/audit-log', requireAdmin, getAuditLog);
router.get('/security-events', requireAdmin, getSecurityEvents);
router.get('/security-summary', requireAdmin, getSecuritySummary);

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

// screeningEngin.md — AI Screening Intelligence Engine ops controls (admin only)
router.get('/ai-screening/settings', requireAdmin, getAiScreeningSettings);
router.put('/ai-screening/settings', requireAdmin, updateAiScreeningSettings);
router.get('/ai-screening/runs',     requireAdmin, getAiRunLogs);

// 70.md P10 — global default policy for the criteria-based Eligibility Screener.
router.get('/eligibility-screening/settings', requireAdmin, getEligibilityScreeningSettings);
router.put('/eligibility-screening/settings', requireAdmin, updateEligibilityScreeningSettings);

// 66.md P5/P6 — extraction-AI + living-review global policy (admin only)
router.get('/extraction-ai/settings', requireAdmin, getExtractionAiAdminSettings);
router.put('/extraction-ai/settings', requireAdmin, updateExtractionAiAdminSettings);
router.get('/living-review/settings', requireAdmin, getLivingReviewAdminSettings);
router.put('/living-review/settings', requireAdmin, updateLivingReviewAdminSettings);

// 68.md P9 — automated OA full-text retrieval global policy (admin only)
router.get('/full-text/settings', requireAdmin, getFullTextAdminSettings);
router.put('/full-text/settings', requireAdmin, updateFullTextAdminSettings);

// 67.md — product tiers / entitlements (admin only; tiers are separate from roles)
// 72.md — tier MANAGEMENT: analytics, per-user history, users-in-tier (+CSV),
// revert, and the subscription placeholder. Specific paths (/tiers/analytics,
// /tiers/:id/users/export) are declared BEFORE the more generic ones so they are
// never shadowed.
router.get('/tiers/analytics',          requireAdmin, getTierAnalytics);
// 79.md §3 — project-export usage view (declared before the generic /tiers/:id).
router.get('/export-usage',             requireAdmin, getProjectExportUsageAdmin);
router.get('/tiers',                    requireAdmin, getTiersAdmin);
router.post('/tiers',                   requireAdmin, createTierAdmin);              // 79.md §2 — create tier
router.post('/tiers/:id/duplicate',     requireAdmin, duplicateTierAdmin);           // 79.md §2 — clone tier
router.post('/tiers/:id/archive',       requireAdmin, archiveTierAdmin);             // 79.md §2 — archive/restore tier
router.put('/tiers/:id',                requireAdmin, updateTierAdmin);
router.put('/tier-settings',            requireAdmin, updateTierSettingsAdmin);
router.get('/tiers/:id/users/export',   requireAdmin, exportUsersInTier);
router.get('/tiers/:id/users',          requireAdmin, getUsersInTier);
router.get('/users/:id/tier-history',   requireAdmin, getUserTierHistory);
router.post('/users/:id/tier/revert',   requireAdmin, revertUserTier);
router.patch('/users/:id/tier',         requireAdmin, updateUserTierAdmin);
router.get('/users/:id/subscription',   requireAdmin, getUserSubscription);
router.put('/users/:id/subscription',   requireAdmin, updateUserSubscription);

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

// ── Beta Waitlist (prompt48) — ADMIN ONLY (sensitive applicant PII). Reads the
// strictly-separate waitlist database through the dedicated data layer; applicant
// data is never copied into the main user database. Specific paths (metrics,
// export) are declared BEFORE the :id routes so they are never shadowed.
router.get('/beta-waitlist/metrics',                requireAdmin, adminWaitlistMetrics);
router.get('/beta-waitlist/export',                 requireAdmin, adminExportApplicants);
// 80.md — bulk account invitation. Static path declared BEFORE the :id routes.
router.post('/beta-waitlist/invitations/bulk',      requireAdmin, adminBulkInvite);
router.get('/beta-waitlist/applicants',             requireAdmin, adminListApplicants);
router.get('/beta-waitlist/applicants/:id',         requireAdmin, adminGetApplicant);
router.patch('/beta-waitlist/applicants/:id/status', requireAdmin, adminUpdateStatus);
router.patch('/beta-waitlist/applicants/:id/notes',  requireAdmin, adminUpdateNotes);
router.post('/beta-waitlist/applicants/:id/resend',  requireAdmin, adminResendConfirmation);
// 80.md — account invitation lifecycle (distinct from the confirmation-email
// resend above). Specific /invite/* paths declared before the generic :id delete.
router.post('/beta-waitlist/applicants/:id/invite',         requireAdmin, adminInviteApplicant);
router.post('/beta-waitlist/applicants/:id/invite/resend',  requireAdmin, adminResendInvitation);
router.post('/beta-waitlist/applicants/:id/invite/revoke',  requireAdmin, adminRevokeInvitation);
router.get('/beta-waitlist/applicants/:id/invitations',     requireAdmin, adminInvitationHistory);
router.delete('/beta-waitlist/applicants/:id',       requireAdmin, adminRemoveApplicant);

// ── Engine versions (54.md Part 6) — ADMIN ONLY, internal/operational only ──────
// Read-only: current per-engine version + change history. Bumps happen via the
// controlled CLI (scripts/engine-version.mjs), not the UI. These are NEVER mirrored
// on any public/user endpoint. Static path before the :id route.
router.get('/engine-versions',                       requireAdmin, adminListEngineVersions);
router.get('/engine-versions/:id/history',           requireAdmin, adminEngineVersionHistory);

export default router;
