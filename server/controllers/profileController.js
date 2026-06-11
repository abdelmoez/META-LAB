/**
 * profileController.js
 * Handlers for the authenticated user's own profile.
 * All handlers require req.user (set by requireAuth middleware).
 */

import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

/**
 * GET /api/profile
 * Returns the current user's profile (id, email, name, createdAt, lastActive).
 * Password hash is never returned.
 */
export async function getProfile(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, createdAt: true, lastActive: true, themePreference: true },
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
    const { name, themePreference } = req.body || {};
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    if (themePreference !== undefined && !['night', 'day'].includes(themePreference)) {
      return res.status(400).json({ error: 'themePreference must be "night" or "day"' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name !== undefined ? { name: name.trim() || null } : {}),
        ...(themePreference !== undefined ? { themePreference } : {}),
        lastActive: new Date(),
      },
      select: { id: true, email: true, name: true, createdAt: true, lastActive: true, themePreference: true },
    });
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
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashed, lastActive: new Date() },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[profile] changePassword error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
