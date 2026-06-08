import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  getMetrics,
  getUsers,
  getUserById,
  getUserProjects,
  updateUserStatus,
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
  updateContactMessage,
  deleteContactMessage,
  getHealth,
} from '../controllers/adminController.js';

import {
  getScreeningSettings,
  updateScreeningSettings,
  getScreeningMetrics,
  listScreeningProjects,
  getScreeningProject,
  updateScreeningProjectStatus,
} from '../controllers/screeningAdminController.js';

const router = Router();

// Admin-specific rate limiter: 60 req / 15 min per IP
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiter to all admin routes
router.use(adminLimiter);

// Apply requireAdmin to all routes in this router
// (requireAuth is applied at the mount point in index.js)
router.use(requireAdmin);

// Metrics
router.get('/metrics', getMetrics);

// Users
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.get('/users/:id/projects', getUserProjects);
router.patch('/users/:id/status', updateUserStatus);

// Projects
router.get('/projects', getProjects);
router.patch('/projects/:id/archive', archiveProject);
router.patch('/projects/:id/restore', restoreProject);

// Settings
router.get('/settings', getAdminSettings);
router.put('/settings', updateAdminSettings);

// Landing content
router.get('/landing-content', getLandingContent);
router.put('/landing-content', updateLandingContent);

// Feature flags
router.get('/feature-flags', getFeatureFlags);
router.put('/feature-flags', updateFeatureFlags);

// Audit log
router.get('/audit-log', getAuditLog);

// Security events
router.get('/security-events', getSecurityEvents);

// Contact messages
router.get('/contact-messages', getContactMessages);
router.patch('/contact-messages/:id', updateContactMessage);
router.delete('/contact-messages/:id', deleteContactMessage);

// Health
router.get('/health', getHealth);

// META·SIFT Beta admin controls
router.get('/screening/settings',              getScreeningSettings);
router.put('/screening/settings',              updateScreeningSettings);
router.get('/screening/metrics',               getScreeningMetrics);
router.get('/screening/projects',              listScreeningProjects);
router.get('/screening/projects/:id',          getScreeningProject);
router.patch('/screening/projects/:id/status', updateScreeningProjectStatus);

export default router;
