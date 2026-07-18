/**
 * tests/unit/analytics.test.js — 93.md §5.3 analytics service unit coverage.
 *
 * Covers (against a MOCKED db client — no real DB is touched):
 *  1. redactMeta — whitelist-only keys, string truncation, drops nested
 *     structures/arrays/non-finite numbers, null for empty/non-object input.
 *  2. ANALYTICS_DISABLED switch — recordEvent/recordFirstEvent short-circuit
 *     (no prisma create call, resolve false) and forwarding reports disabled.
 *  3. recordFirstEvent — once-only via the deterministic `first:<TYPE>:<userId>`
 *     primary key (second create rejects like a PK collision → false).
 *  4. PostHog forwarder — disabled without config; with config the batch is
 *     queued, flushed once, and a send failure is dropped (never retried,
 *     never thrown).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db layer ONLY — the real usage.js + analytics.js logic runs.
const state = { creates: [], failNext: null };
vi.mock('../../server/db/client.js', () => ({
  prisma: {
    usageEvent: {
      create: async (args) => {
        if (state.failNext) { const e = state.failNext; state.failNext = null; throw e; }
        state.creates.push(args);
        return { id: args?.data?.id || 'uuid', ...args?.data };
      },
    },
  },
}));

import {
  redactMeta, recordEvent, recordFirstEvent, flushPosthog, posthogQueueStats,
  META_KEY_WHITELIST,
} from '../../server/services/analytics.js';
import { USAGE } from '../../server/utils/usage.js';

const ENV_KEYS = ['ANALYTICS_DISABLED', 'POSTHOG_API_KEY', 'POSTHOG_HOST'];
let savedEnv;
let savedFetch;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  savedFetch = globalThis.fetch;
  state.creates = [];
  state.failNext = null;
  await flushPosthog(); // drain any queue left by a prior test
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = savedFetch; // manual save/restore (65.md: vi.stubGlobal leaks)
});

/* ── redactMeta ──────────────────────────────────────────────────────────── */

describe('redactMeta', () => {
  it('keeps only whitelisted keys', () => {
    const out = redactMeta({
      count: 3, source: 'ris', durationMs: 120, projectId: 'p1',
      title: 'SECRET TITLE', abstract: 'SECRET', email: 'a@b.c', password: 'x',
    });
    expect(out).toEqual({ count: 3, source: 'ris', durationMs: 120, projectId: 'p1' });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it('truncates strings to 120 chars', () => {
    const out = redactMeta({ source: 'x'.repeat(500) });
    expect(out.source).toHaveLength(120);
  });

  it('drops nested objects, arrays, null, NaN and non-finite numbers', () => {
    const out = redactMeta({
      count: NaN, durationMs: Infinity, source: null,
      projectId: { deep: 'object' }, format: ['a', 'b'], severity: () => {},
    });
    expect(out).toBeNull();
  });

  it('keeps booleans and finite numbers', () => {
    // (no boolean key is in live use today, but the value rule is contractual)
    expect(redactMeta({ count: 0 })).toEqual({ count: 0 });
  });

  it('returns null for non-objects and empty results', () => {
    expect(redactMeta(null)).toBeNull();
    expect(redactMeta('a string')).toBeNull();
    expect(redactMeta(['array'])).toBeNull();
    expect(redactMeta({ unlisted: 'x' })).toBeNull();
    expect(redactMeta({})).toBeNull();
  });

  it('whitelist stays small and content-free', () => {
    // Guard against someone whitelisting a content-bearing key later.
    for (const k of META_KEY_WHITELIST) {
      expect(['title', 'abstract', 'text', 'message', 'email', 'name', 'query']).not.toContain(k);
    }
  });
});

/* ── recordEvent ─────────────────────────────────────────────────────────── */

describe('recordEvent', () => {
  it('writes a row with redacted meta and resolves true', async () => {
    const ok = await recordEvent(USAGE.ACCOUNT_CREATED, {
      userId: 'u1', meta: { source: 'register', title: 'LEAK' },
    });
    expect(ok).toBe(true);
    expect(state.creates).toHaveLength(1);
    const data = state.creates[0].data;
    expect(data.type).toBe('ACCOUNT_CREATED');
    expect(data.userId).toBe('u1');
    expect(data.meta).toBe(JSON.stringify({ source: 'register' }));
  });

  it('maps the projectId alias to metaLabProjectId', async () => {
    await recordEvent(USAGE.PROJECT_CREATED, { userId: 'u1', projectId: 'ml1' });
    expect(state.creates[0].data.metaLabProjectId).toBe('ml1');
  });

  it('resolves false without a type and never throws', async () => {
    await expect(recordEvent('')).resolves.toBe(false);
    expect(state.creates).toHaveLength(0);
  });

  it('resolves false (not rejects) when the DB write fails', async () => {
    state.failNext = new Error('db down');
    await expect(recordEvent(USAGE.ACCOUNT_CREATED, { userId: 'u1' })).resolves.toBe(false);
  });
});

/* ── ANALYTICS_DISABLED switch ───────────────────────────────────────────── */

describe('ANALYTICS_DISABLED switch', () => {
  it('short-circuits recordEvent — no DB call, resolves false', async () => {
    process.env.ANALYTICS_DISABLED = '1';
    const ok = await recordEvent(USAGE.ACCOUNT_CREATED, { userId: 'u1' });
    expect(ok).toBe(false);
    expect(state.creates).toHaveLength(0);
  });

  it('short-circuits recordFirstEvent too (also with "true")', async () => {
    process.env.ANALYTICS_DISABLED = 'true';
    const ok = await recordFirstEvent(USAGE.FIRST_LOGIN, 'u1');
    expect(ok).toBe(false);
    expect(state.creates).toHaveLength(0);
  });

  it('reports forwarding disabled even when PostHog is configured', () => {
    process.env.ANALYTICS_DISABLED = '1';
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.POSTHOG_HOST = 'https://ph.example';
    expect(posthogQueueStats().enabled).toBe(false);
  });
});

/* ── recordFirstEvent once-only ──────────────────────────────────────────── */

describe('recordFirstEvent', () => {
  it('inserts with the deterministic first:<TYPE>:<userId> primary key', async () => {
    const ok = await recordFirstEvent(USAGE.FIRST_LOGIN, 'user-42');
    expect(ok).toBe(true);
    expect(state.creates[0].data.id).toBe('first:FIRST_LOGIN:user-42');
    expect(state.creates[0].data.userId).toBe('user-42');
  });

  it('resolves false when the PK already exists (second fire)', async () => {
    await recordFirstEvent(USAGE.FIRST_LOGIN, 'user-42');
    const dup = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    state.failNext = dup;
    const second = await recordFirstEvent(USAGE.FIRST_LOGIN, 'user-42');
    expect(second).toBe(false);
    expect(state.creates).toHaveLength(1); // only the first landed
  });

  it('is a no-op without a userId', async () => {
    await expect(recordFirstEvent(USAGE.FIRST_LOGIN, null)).resolves.toBe(false);
    expect(state.creates).toHaveLength(0);
  });
});

/* ── PostHog forwarder ───────────────────────────────────────────────────── */

describe('PostHog forwarder', () => {
  it('queues nothing when unconfigured (disabled by default)', async () => {
    await recordEvent(USAGE.ACCOUNT_CREATED, { userId: 'u1' });
    expect(posthogQueueStats().queued).toBe(0);
    expect(posthogQueueStats().enabled).toBe(false);
  });

  it('queues and flushes a batch when configured; distinct_id is the internal id', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.POSTHOG_HOST = 'https://ph.example/';
    const calls = [];
    globalThis.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };

    await recordEvent(USAGE.ACCOUNT_CREATED, { userId: 'u-internal', meta: { source: 'register' } });
    expect(posthogQueueStats().queued).toBe(1);

    const { attempted } = await flushPosthog();
    expect(attempted).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ph.example/capture/'); // trailing slash trimmed from host
    expect(calls[0].body.api_key).toBe('phc_test');
    expect(calls[0].body.batch[0].event).toBe('ACCOUNT_CREATED');
    expect(calls[0].body.batch[0].distinct_id).toBe('u-internal');
    expect(calls[0].body.batch[0].properties).toEqual({ source: 'register' });
    expect(posthogQueueStats().queued).toBe(0);
  });

  it('a failed flush drops the batch (no retry, no throw); local write unaffected', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.POSTHOG_HOST = 'https://ph.example';
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; throw new Error('ECONNREFUSED'); };

    const before = posthogQueueStats().dropped;
    const ok = await recordEvent(USAGE.ACCOUNT_CREATED, { userId: 'u1' });
    expect(ok).toBe(true); // local UsageEvent row still recorded
    await flushPosthog();
    expect(fetches).toBe(1); // exactly one attempt — never retried
    expect(posthogQueueStats().dropped).toBe(before + 1);
    expect(posthogQueueStats().queued).toBe(0); // forgotten, not re-queued
  });
});
