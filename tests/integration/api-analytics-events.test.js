/**
 * tests/integration/api-analytics-events.test.js — 93.md §5.3/§5.4.
 *
 * Two layers, matching the established integration conventions:
 *
 *  A. DIRECT-SERVICE tests against the real dev DB (same direct-prisma pattern
 *     as api-project-export.test.js — no HTTP server required):
 *     - recordEvent writes a UsageEvent row with redacted meta.
 *     - recordFirstEvent is once-only, ATOMICALLY (deterministic PK), even
 *       when double-fired concurrently.
 *     - PostHog pointed at a dead port: local rows still recorded, flush
 *       resolves without throwing (total failure isolation).
 *  B. HTTP funnel tests against a running server on :3001 (skip gracefully
 *     when it is down, like every api-*.test.js):
 *     - register → ACCOUNT_CREATED row exists for the new user.
 *     - first project create → PROJECT_CREATED + FIRST_PROJECT_CREATED rows.
 *
 * NOTE: env toggles in this file only affect THIS vitest process (direct-service
 * layer); the HTTP server keeps its own env, so layer B is unaffected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { recordEvent, recordFirstEvent, flushPosthog } from '../../server/services/analytics.js';
import { USAGE } from '../../server/utils/usage.js';

const API = 'http://127.0.0.1:3001/api';
const TAG = `anlx-${Date.now()}`; // unique per run → safe cleanup by prefix

async function serverUp() {
  try { return (await fetch(`${API}/health`)).ok; } catch { return false; }
}

/** Poll for a UsageEvent row (server-side writes are fire-and-forget). */
async function waitForEvent(where, { timeoutMs = 4000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.usageEvent.findFirst({ where });
    if (row || Date.now() > deadline) return row;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const ENV_KEYS = ['ANALYTICS_DISABLED', 'POSTHOG_API_KEY', 'POSTHOG_HOST'];
let savedEnv;
let up = false;
const createdUserEmails = [];

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  up = await serverUp();
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  // Cleanup: only rows this run created (tagged userIds / registered users).
  await prisma.usageEvent.deleteMany({ where: { userId: { startsWith: TAG } } }).catch(() => {});
  for (const email of createdUserEmails) {
    const u = await prisma.user.findUnique({ where: { email } }).catch(() => null);
    if (u) await prisma.usageEvent.deleteMany({ where: { userId: u.id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

/* ── A. Direct-service (real DB, no HTTP) ────────────────────────────────── */

describe('analytics service against the real DB', () => {
  it('recordEvent writes a UsageEvent row with redacted meta', async () => {
    const userId = `${TAG}-rec`;
    const ok = await recordEvent(USAGE.ACCOUNT_CREATED, {
      userId, meta: { source: 'register', title: 'MUST-NOT-PERSIST' },
    });
    expect(ok).toBe(true);
    const row = await prisma.usageEvent.findFirst({ where: { userId, type: 'ACCOUNT_CREATED' } });
    expect(row).toBeTruthy();
    expect(row.meta).toBe(JSON.stringify({ source: 'register' }));
    expect(row.meta).not.toContain('MUST-NOT-PERSIST');
  });

  it('recordFirstEvent writes exactly one row across sequential re-fires', async () => {
    const userId = `${TAG}-seq`;
    const first = await recordFirstEvent(USAGE.FIRST_LOGIN, userId);
    const second = await recordFirstEvent(USAGE.FIRST_LOGIN, userId);
    expect(first).toBe(true);
    expect(second).toBe(false);
    const count = await prisma.usageEvent.count({ where: { userId, type: 'FIRST_LOGIN' } });
    expect(count).toBe(1);
    // The once-only guarantee IS the deterministic primary key.
    const row = await prisma.usageEvent.findFirst({ where: { userId, type: 'FIRST_LOGIN' } });
    expect(row.id).toBe(`first:FIRST_LOGIN:${userId}`);
  });

  it('recordFirstEvent double-fired CONCURRENTLY still lands one row', async () => {
    const userId = `${TAG}-race`;
    const results = await Promise.all([
      recordFirstEvent(USAGE.FIRST_PROJECT_CREATED, userId),
      recordFirstEvent(USAGE.FIRST_PROJECT_CREATED, userId),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1); // exactly one winner
    const count = await prisma.usageEvent.count({ where: { userId, type: 'FIRST_PROJECT_CREATED' } });
    expect(count).toBe(1);
  });

  it('ANALYTICS_DISABLED=1 short-circuits: no row written', async () => {
    process.env.ANALYTICS_DISABLED = '1';
    try {
      const userId = `${TAG}-off`;
      const ok = await recordEvent(USAGE.FEEDBACK_SUBMITTED, { userId });
      expect(ok).toBe(false);
      const count = await prisma.usageEvent.count({ where: { userId } });
      expect(count).toBe(0);
    } finally {
      delete process.env.ANALYTICS_DISABLED;
    }
  });

  it('PostHog at a dead port: local rows still recorded, flush never throws', async () => {
    process.env.POSTHOG_API_KEY = 'phc_integration_test';
    process.env.POSTHOG_HOST = 'http://127.0.0.1:9'; // nothing listens here
    try {
      const userId = `${TAG}-ph`;
      const ok = await recordEvent(USAGE.PROJECT_CREATED, { userId, meta: { count: 1 } });
      expect(ok).toBe(true); // local write independent of forwarding health
      const row = await prisma.usageEvent.findFirst({ where: { userId, type: 'PROJECT_CREATED' } });
      expect(row).toBeTruthy();
      // Flush against the dead port must resolve (drop + count), never reject.
      await expect(flushPosthog()).resolves.toBeTruthy();
    } finally {
      delete process.env.POSTHOG_API_KEY;
      delete process.env.POSTHOG_HOST;
    }
  });
});

/* ── B. HTTP funnel (skips when the server is down) ──────────────────────── */

describe('signup/activation funnel over HTTP', () => {
  it('register → ACCOUNT_CREATED row exists', async () => {
    if (!up) return;
    const email = `${TAG}-reg@example.com`;
    createdUserEmails.push(email);
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'Analytics QA' }),
    });
    expect(res.status).toBe(201);
    const { user } = await res.json();
    const row = await waitForEvent({ userId: user.id, type: 'ACCOUNT_CREATED' });
    expect(row).toBeTruthy();
  });

  it('first project create → PROJECT_CREATED and FIRST_PROJECT_CREATED rows exist', async () => {
    if (!up) return;
    const email = `${TAG}-proj@example.com`;
    createdUserEmails.push(email);
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'Analytics QA' }),
    });
    expect(reg.status).toBe(201);
    const cookie = reg.headers.get('set-cookie');
    const { user } = await reg.json();

    const create = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `Analytics Funnel ${TAG}` }),
    });
    expect(create.status).toBe(201);

    const every = await waitForEvent({ userId: user.id, type: 'PROJECT_CREATED' });
    expect(every).toBeTruthy();
    const first = await waitForEvent({ userId: user.id, type: 'FIRST_PROJECT_CREATED' });
    expect(first).toBeTruthy();
    expect(first.id).toBe(`first:FIRST_PROJECT_CREATED:${user.id}`);
  });
});
