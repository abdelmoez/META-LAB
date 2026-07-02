/**
 * profileController.js
 * Handlers for the authenticated user's own profile.
 * All handlers require req.user (set by requireAuth middleware).
 */

import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { invalidateAuthState } from '../middleware/auth.js';
import { invalidateUserName } from './presenceController.js';
import { resolveInstitutionInput, invalidateInstitutionCandidates } from '../services/institutionService.js';
import { sessionCookieName, sessionCookieOptions } from '../config/cookies.js';

const SESSION_COOKIE = sessionCookieName();

// prompt35 — institution + onboarding-profile fields exposed/editable on the
// self-service profile (in addition to the legacy onboarding write path).
const PROFILE_SELECT = {
  id: true, email: true, name: true, createdAt: true, lastActive: true,
  themePreference: true, workflowMenuMode: true, projectSidebarPinned: true, uiDesignMode: true, dashboardPreferences: true, screeningShortcuts: true,
  primaryRole: true, researchField: true, mainUseCase: true, country: true,
  institutionOriginal: true, institutionCanonicalName: true, institutionRorId: true,
  institutionCity: true, institutionCountryName: true, institutionCountryCode: true,
  institutionSource: true, institutionNeedsReview: true, institutionId: true,
};

/**
 * GET /api/profile
 * Returns the current user's profile (id, email, name, createdAt, lastActive).
 * Password hash is never returned.
 */
export async function getProfile(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: PROFILE_SELECT,
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    console.error('[profile] getProfile error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/profile
 * Body: { name: string }
 * Updates the user's display name and records lastActive timestamp.
 */
export async function updateProfile(req, res) {
  try {
    const { name, themePreference, workflowMenuMode, projectSidebarPinned, uiDesignMode, dashboardPreferences, screeningShortcuts, institution, country } = req.body || {};
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    if (themePreference !== undefined && !['night', 'day'].includes(themePreference)) {
      return res.status(400).json({ error: 'themePreference must be "night" or "day"' });
    }
    // prompt39 Task 5 — workflow-menu mode: "pinned" | "auto", or null to clear.
    if (workflowMenuMode !== undefined && workflowMenuMode !== null && !['pinned', 'auto'].includes(workflowMenuMode)) {
      return res.status(400).json({ error: 'workflowMenuMode must be "pinned" or "auto"' });
    }
    // 56.md §6 — pin the project workspace purple sidebar open: boolean, or null
    // to clear (collapsed-by-default). Accept real booleans only (no truthy coercion).
    if (projectSidebarPinned !== undefined && projectSidebarPinned !== null && typeof projectSidebarPinned !== 'boolean') {
      return res.status(400).json({ error: 'projectSidebarPinned must be a boolean or null' });
    }
    // 65.md — UI design mode: "legacy" | "stitch" (null clears). A PERSONAL design
    // preference is ADMIN-ONLY for BOTH values, protected HERE at the authorization
    // layer (not merely hidden in the UI): non-admins always render the Ops-governed
    // designSettings.defaultMode, so persisting any per-user mode for them would be
    // dead state at best and a legacy-strand at worst. The role is DB-verified.
    let uiDesignPatch = {};
    if (uiDesignMode !== undefined) {
      if (uiDesignMode !== null && !['legacy', 'stitch'].includes(uiDesignMode)) {
        return res.status(400).json({ error: 'uiDesignMode must be "legacy", "stitch", or null' });
      }
      const actor = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, suspended: true } });
      if (!actor || actor.suspended || actor.role !== 'admin') {
        return res.status(403).json({
          error: 'The interface design is managed by your administrators (Ops › Appearance)',
          code: 'UI_DESIGN_ADMIN_ONLY',
        });
      }
      uiDesignPatch = { uiDesignMode: uiDesignMode || null };
    }
    // prompt23 Task 2 (follow-up) — dashboard view prefs, stored as a small JSON
    // string. Accepts an object or a JSON string; null clears it. Capped to keep
    // the column small; the frontend re-validates each field on read.
    let dashPatch = {};
    if (dashboardPreferences !== undefined) {
      let obj = dashboardPreferences;
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return res.status(400).json({ error: 'dashboardPreferences must be valid JSON' }); } }
      if (obj === null) {
        dashPatch = { dashboardPreferences: null };
      } else if (typeof obj === 'object' && !Array.isArray(obj)) {
        const json = JSON.stringify(obj);
        if (json.length > 500) return res.status(400).json({ error: 'dashboardPreferences is too large' });
        dashPatch = { dashboardPreferences: json };
      } else {
        return res.status(400).json({ error: 'dashboardPreferences must be an object' });
      }
    }
    // prompt25 Task 7 — per-user Screening keyboard-shortcut prefs, same JSON-blob
    // pattern as dashboardPreferences (object or JSON string; null clears).
    let shortcutPatch = {};
    if (screeningShortcuts !== undefined) {
      let obj = screeningShortcuts;
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return res.status(400).json({ error: 'screeningShortcuts must be valid JSON' }); } }
      if (obj === null) {
        shortcutPatch = { screeningShortcuts: null };
      } else if (typeof obj === 'object' && !Array.isArray(obj)) {
        const json = JSON.stringify(obj);
        if (json.length > 500) return res.status(400).json({ error: 'screeningShortcuts is too large' });
        shortcutPatch = { screeningShortcuts: json };
      } else {
        return res.status(400).json({ error: 'screeningShortcuts must be an object' });
      }
    }
    // prompt35 — institution: accepts a canonical selection object (ROR/local) or a
    // custom string; the service preserves the typed text and links/flags as needed.
    // `country` is the free-text onboarding-stated country (≠ IP-derived registration).
    let instPatch = {};
    if (institution !== undefined) {
      try { instPatch = await resolveInstitutionInput(institution, prisma); }
      catch (e) { console.error('[profile] institution resolve error:', e.message); instPatch = {}; }
    }
    let countryPatch = {};
    if (country !== undefined) {
      if (country !== null && typeof country !== 'string') return res.status(400).json({ error: 'country must be a string' });
      countryPatch = { country: country ? String(country).trim().slice(0, 120) || null : null };
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name !== undefined ? { name: name.trim() || null } : {}),
        ...(themePreference !== undefined ? { themePreference } : {}),
        ...(workflowMenuMode !== undefined ? { workflowMenuMode } : {}),
        ...(projectSidebarPinned !== undefined ? { projectSidebarPinned } : {}),
        ...uiDesignPatch,
        ...dashPatch,
        ...shortcutPatch,
        ...instPatch,
        ...countryPatch,
        lastActive: new Date(),
      },
      select: PROFILE_SELECT,
    });
    // prompt25 follow-up — a rename must show in presence immediately, not after
    // the ≤60s name-cache TTL.
    if (name !== undefined) invalidateUserName(req.user.id);
    if (institution !== undefined) invalidateInstitutionCandidates(); // suggest a newly-saved institution immediately
    res.json({ user });
  } catch (err) {
    console.error('[profile] updateProfile error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/profile/password
 * Body: { currentPassword: string, newPassword: string }
 * Verifies currentPassword with bcrypt before updating to the hashed newPassword.
 */
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: 'currentPassword is required' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
    }

    // Fetch the full user record (including password hash) for verification
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const matches = await verifyPassword(currentPassword, user.password);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await hashPassword(newPassword);
    // prompt49 — changing your password REVOKES every other session (bump
    // sessionEpoch so all already-issued tokens fail their next request) while
    // keeping THIS device signed in by re-issuing its cookie with the new epoch.
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashed, lastActive: new Date(), sessionEpoch: { increment: 1 }, passwordChangedAt: new Date() },
      select: { id: true, email: true, role: true, sessionEpoch: true },
    });
    invalidateAuthState(req.user.id);
    const token = signToken({ id: updated.id, email: updated.email, role: updated.role, se: updated.sessionEpoch });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());

    res.json({ ok: true });
  } catch (err) {
    console.error('[profile] changePassword error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
