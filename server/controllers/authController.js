import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { notifyProjectInvite } from '../services/notificationService.js';

const COOKIE_NAME = 'metalab_session';

/**
 * Record a LoginEvent for ops unique-login metrics (prompt6 Task 9).
 * Fire-and-forget — never awaited in the response path, never throws.
 * Only called when a user row exists (userId is required; unknown-email
 * failures are already covered by the FAILED_LOGIN SecurityEvent).
 */
function recordLoginEvent(req, user, success) {
  prisma.loginEvent.create({
    data: {
      userId: user.id,
      email: user.email || '',
      ip: req.ip || '',
      userAgent: req.get('user-agent') || '',
      success,
    },
  }).catch(() => {});
}

/**
 * Claim pending META·SIFT invites at registration (prompt6 Task 1, plan §8
 * risk 12). Pending ScreenProjectMember rows (userId null) matching the new
 * user's normalized email are claimed (userId set, pending → active) and a
 * deferred PROJECT_INVITE notification is created for each active membership.
 * The inviter is unknown at claim time (member rows carry no inviter info),
 * so the notification falls back to a generic actor.
 * Best-effort — registration must never fail or slow because of this.
 */
async function claimPendingScreenInvites(user) {
  try {
    const pending = await prisma.screenProjectMember.findMany({
      where: { email: user.email, userId: null },
    });
    for (const m of pending) {
      try {
        const member = await prisma.screenProjectMember.update({
          where: { id: m.id },
          data: {
            userId: user.id,
            name: m.name || user.name || '',
            // Activate pending invites; leave any other status untouched.
            status: m.status === 'pending' ? 'active' : m.status,
          },
        });
        if (member.status !== 'active') continue;
        const project = await prisma.screenProject.findUnique({ where: { id: m.projectId } });
        if (project) {
          await notifyProjectInvite({ member, project, roleLabel: member.permissionPreset || member.role });
        }
      } catch { /* per-row best-effort — keep claiming the rest */ }
    }
  } catch { /* best-effort side-effect — swallow */ }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  };
}

/**
 * POST /api/auth/register
 * Body: { email, password, name? }
 */
export async function register(req, res) {
  try {
    const { email, password, name } = req.body || {};

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const hashed = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() || null,
        password: hashed,
        role: 'user',
      },
    });

    // Claim pending META·SIFT invites for this email + emit deferred invite
    // notifications — fire-and-forget, never blocks registration.
    claimPendingScreenInvites(user).catch(() => {});

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
    });
  } catch (err) {
    console.error('[auth] register error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'password is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Use constant-time comparison via bcrypt even if user not found (prevent timing attacks)
    const passwordMatches = user ? await verifyPassword(password, user.password) : false;

    if (!user || !passwordMatches) {
      // Log failed login attempt as a SecurityEvent
      await prisma.securityEvent.create({
        data: {
          type: 'FAILED_LOGIN',
          email: normalizedEmail,
          ip: req.ip || null,
          userAgent: req.get('user-agent') || null,
          details: JSON.stringify({ reason: 'invalid_credentials' }),
        },
      }).catch(() => {});

      // Known account, wrong password → failed LoginEvent for ops metrics
      // (unknown email skipped: LoginEvent requires a userId; the SecurityEvent
      // above already covers forensics). Fire-and-forget.
      if (user) recordLoginEvent(req, user, false);

      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is suspended
    if (user.suspended) {
      recordLoginEvent(req, user, false);
      return res.status(401).json({ error: 'Your account has been suspended. Please contact support.' });
    }

    // Login metrics + lastActive (prompt6 Tasks 9/10) — fire-and-forget, never
    // awaited: a metrics failure must never fail or slow the login response.
    recordLoginEvent(req, user, true);
    prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } }).catch(() => {});

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/logout
 * Requires auth (protected by requireAuth middleware).
 */
export async function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict' });
  return res.json({ ok: true });
}

/**
 * GET /api/auth/me
 * Requires auth (protected by requireAuth middleware).
 */
export async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true, suspended: true, createdAt: true },
    });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    console.error('[auth] getMe error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
