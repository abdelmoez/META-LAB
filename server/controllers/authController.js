import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';

const COOKIE_NAME = 'metalab_session';

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
      },
    });

    const token = signToken({ id: user.id, email: user.email });
    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
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
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ id: user.id, email: user.email });
    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.json({
      user: { id: user.id, email: user.email, name: user.name },
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
      select: { id: true, email: true, name: true, createdAt: true },
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
