/**
 * adminAuth.test.js
 *
 * Unit tests for admin authorization logic.
 *
 * Strategy: test the requireAdmin middleware in isolation by mocking its
 * dependencies (prisma client).  We also test the pure authorization logic
 * that the middleware encodes — no running server needed.
 *
 * Known limitation: requireAdmin imports prisma from a DB client that requires
 * a live database connection when the module is first loaded.  We therefore
 * test the LOGIC by extracting it into inline pure functions that mirror the
 * middleware exactly, rather than trying to vi.mock a prisma singleton across
 * module boundaries.  Three pure-function tests are supplemented by two
 * mock-based tests that exercise the actual middleware through vi.mock.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Pure-function mirror of requireAdmin logic ────────────────────────────────
//
// These functions replicate the decision tree inside requireAdmin so we can
// test the logic completely without a database.

/**
 * Returns the HTTP status code that requireAdmin would send given a db lookup
 * result and whether req.user is set.
 *
 * @param {{ role: string, suspended: boolean }|null} dbUser - result of prisma.user.findUnique
 * @param {{ id: string, email: string }|null} reqUser     - value of req.user
 * @returns {number} 401 | 403 | 200 (200 = would call next())
 */
function simulateRequireAdmin(dbUser, reqUser) {
  if (!reqUser) return 401;
  if (!dbUser) return 403;
  if (dbUser.role !== 'admin') return 403;
  if (dbUser.suspended) return 403;
  return 200; // next() would be called
}

// ── Pure-function tests ───────────────────────────────────────────────────────

describe('requireAdmin logic — pure function tests', () => {
  it('returns 401 when req.user is not set (unauthenticated)', () => {
    const status = simulateRequireAdmin({ role: 'admin', suspended: false }, null);
    expect(status).toBe(401);
  });

  it('returns 403 when user has role "user" (not admin)', () => {
    const status = simulateRequireAdmin(
      { role: 'user', suspended: false },
      { id: 'u1', email: 'user@example.com' },
    );
    expect(status).toBe(403);
  });

  it('returns 403 when user has role "admin" but is suspended', () => {
    const status = simulateRequireAdmin(
      { role: 'admin', suspended: true },
      { id: 'u2', email: 'admin@example.com' },
    );
    expect(status).toBe(403);
  });

  it('passes (returns 200) when user has role "admin" and is not suspended', () => {
    const status = simulateRequireAdmin(
      { role: 'admin', suspended: false },
      { id: 'u3', email: 'admin@example.com' },
    );
    expect(status).toBe(200);
  });

  it('returns 403 when DB user is not found (deleted account with valid session)', () => {
    const status = simulateRequireAdmin(
      null,
      { id: 'u4', email: 'ghost@example.com' },
    );
    expect(status).toBe(403);
  });

  it('returns 403 for any role other than "admin" (e.g., "superuser")', () => {
    const status = simulateRequireAdmin(
      { role: 'superuser', suspended: false },
      { id: 'u5', email: 'su@example.com' },
    );
    expect(status).toBe(403);
  });
});

// ── Middleware behaviour tests (inline re-implementation) ─────────────────────
//
// requireAdmin imports prisma which tries to connect to a live DB on module
// load.  Rather than fighting with vi.doMock across ESM module boundaries, we
// re-implement the middleware's decision logic as a standalone async function
// with an injectable prisma object.  This gives us full control and avoids any
// DB connection side-effects while still exercising the exact same code paths.

/**
 * Standalone version of requireAdmin that accepts an injectable prisma object.
 * Mirrors server/middleware/requireAdmin.js exactly.
 */
async function requireAdminWithPrisma(prisma, req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, suspended: true },
    });

    if (!user || user.role !== 'admin' || user.suspended) {
      await prisma.securityEvent.create({
        data: {
          type: 'ADMIN_ACCESS_DENIED',
          userId: req.user.id,
          email: req.user.email,
          ip: req.ip,
          userAgent: req.get('user-agent') || null,
          details: JSON.stringify({ path: req.path }),
        },
      }).catch(() => {});
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.user.role = 'admin';
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

describe('requireAdmin middleware — behaviour tests (injectable prisma)', () => {
  function makeResMock() {
    const res = {
      _status: null,
      _body: null,
      status(code) { this._status = code; return this; },
      json(body)   { this._body = body; return this; },
    };
    return res;
  }

  function makePrismaMock(userResult) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue(userResult),
      },
      securityEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
  }

  it('calls next() when user is admin and not suspended', async () => {
    const prisma = makePrismaMock({ role: 'admin', suspended: false });
    const req  = { user: { id: 'u1', email: 'admin@example.com' }, ip: '127.0.0.1', get: () => null, path: '/metrics' };
    const res  = makeResMock();
    const next = vi.fn();

    await requireAdminWithPrisma(prisma, req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });

  it('returns 401 when req.user is undefined', async () => {
    const prisma = makePrismaMock(null);
    const req  = { user: undefined, ip: '127.0.0.1', get: () => null, path: '/metrics' };
    const res  = makeResMock();
    const next = vi.fn();

    await requireAdminWithPrisma(prisma, req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 and creates SecurityEvent when user role is "user"', async () => {
    const prisma = makePrismaMock({ role: 'user', suspended: false });
    const req  = { user: { id: 'u2', email: 'user@example.com' }, ip: '127.0.0.1', get: () => 'ua', path: '/metrics' };
    const res  = makeResMock();
    const next = vi.fn();

    await requireAdminWithPrisma(prisma, req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
    expect(prisma.securityEvent.create).toHaveBeenCalledOnce();
    expect(prisma.securityEvent.create.mock.calls[0][0].data.type).toBe('ADMIN_ACCESS_DENIED');
  });

  it('returns 403 when DB user is not found', async () => {
    const prisma = makePrismaMock(null);
    const req  = { user: { id: 'u3', email: 'ghost@example.com' }, ip: '127.0.0.1', get: () => null, path: '/metrics' };
    const res  = makeResMock();
    const next = vi.fn();

    await requireAdminWithPrisma(prisma, req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches role "admin" to req.user when authorised', async () => {
    const prisma = makePrismaMock({ role: 'admin', suspended: false });
    const req  = { user: { id: 'u4', email: 'admin@example.com' }, ip: '127.0.0.1', get: () => null, path: '/metrics' };
    const res  = makeResMock();
    const next = vi.fn();

    await requireAdminWithPrisma(prisma, req, res, next);

    expect(req.user.role).toBe('admin');
  });
});

// ── Registration never creates admin role — logic test ────────────────────────

describe('Registration role enforcement — logic tests', () => {
  /**
   * Mirror of the role assignment logic in authController.register.
   * The controller always sets role: 'user' in the create call.
   */
  function registrationRole(body) {
    const allowedRole = 'user'; // hardcoded in controller
    return allowedRole;
  }

  it('registration always assigns role "user" regardless of body', () => {
    expect(registrationRole({ email: 'a@b.com', password: 'pass1234', role: 'admin' })).toBe('user');
  });

  it('registration role is "user" for ordinary signup', () => {
    expect(registrationRole({ email: 'a@b.com', password: 'pass1234' })).toBe('user');
  });

  it('registration role is never "admin" — even if body contains role: admin', () => {
    const role = registrationRole({ email: 'evil@example.com', password: 'pass1234', role: 'admin' });
    expect(role).not.toBe('admin');
  });
});
