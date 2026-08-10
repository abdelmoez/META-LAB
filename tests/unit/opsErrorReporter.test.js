/**
 * opsErrorReporter.test.js — 109.md §§6, 46, 47 (W2-B).
 *
 * The three properties that make client-error capture safe to ship:
 *   PRIVACY  — no user content ever leaves the browser (the redaction net).
 *   BOUNDED  — a wedged retry loop cannot spray the server.
 *   NEVER BLOCKING — every entry point swallows everything and returns a boolean.
 */
// FIRST import — the drift check below pulls in a server controller, which pulls in
// the shared Prisma client and injects server/.env into process.env as a side effect.
import { restoreShellEnv } from '../screening/helpers/prismaEnvGuard.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OPS_ERROR_KINDS, REPORT_LIMITS, SESSION_REPORT_CAP, DISTINCT_FINGERPRINT_CAP,
  DEDUPE_WINDOW_MS, redactQuoted, fingerprintReport, shouldSend,
  reportOpsError, reportHistoryPersistFailure, reportAutosaveConflict,
  reportStaleMutationRefusal, resetOpsErrorReporter, opsErrorReporterState,
} from '../../src/frontend/monitoring/opsErrorReporter.js';
import { CLIENT_ERROR_LIMITS } from '../../server/controllers/researchOpsJobsController.js';

restoreShellEnv();

/* ─────────────────────────── privacy ─────────────────────────── */

describe('109.md §47 — nothing user-authored can reach the beacon', () => {
  it('redacts curly-quoted spans (the app wraps every keyword term in them)', () => {
    expect(redactQuoted('Added “ketamine” to inclusion keywords.'))
      .toBe('Added “…” to inclusion keywords.');
    expect(redactQuoted('Moved “drug-resistant epilepsy” to exclusion keywords.'))
      .toBe('Moved “…” to exclusion keywords.');
  });

  it('redacts straight-quoted spans too', () => {
    expect(redactQuoted('field "notes" refused')).toBe('field "…" refused');
  });

  it('is idempotent and a no-op on unquoted text', () => {
    const plain = 'autosave rejected with a version conflict (409)';
    expect(redactQuoted(plain)).toBe(plain);
    expect(redactQuoted(redactQuoted('a “b” c'))).toBe(redactQuoted('a “b” c'));
  });

  it('handles null/undefined without throwing', () => {
    expect(redactQuoted(null)).toBe('');
    expect(redactQuoted(undefined)).toBe('');
  });

  it('mirrors the server-side bounds exactly (no client can out-write the row)', () => {
    expect(REPORT_LIMITS.kind).toBe(CLIENT_ERROR_LIMITS.kind);
    expect(REPORT_LIMITS.message).toBe(CLIENT_ERROR_LIMITS.message);
    expect(REPORT_LIMITS.context).toBe(CLIENT_ERROR_LIMITS.context);
  });
});

/* ─────────────────────────── bounds ─────────────────────────── */

describe('109.md §6 — the session bounds are pure and enforced', () => {
  const fresh = () => ({ sent: 0, seen: {} });

  it('the first report of a fingerprint is sent', () => {
    const r = shouldSend(fresh(), 'a', 1000);
    expect(r.send).toBe(true);
    expect(r.state.sent).toBe(1);
  });

  it('the same fingerprint inside the cooldown is suppressed, and costs nothing', () => {
    const first = shouldSend(fresh(), 'a', 1000);
    const again = shouldSend(first.state, 'a', 1000 + DEDUPE_WINDOW_MS - 1);
    expect(again.send).toBe(false);
    expect(again.state).toBe(first.state);          // same object → no churn
  });

  it('the same fingerprint AFTER the cooldown is sent again', () => {
    const first = shouldSend(fresh(), 'a', 1000);
    const later = shouldSend(first.state, 'a', 1000 + DEDUPE_WINDOW_MS);
    expect(later.send).toBe(true);
    expect(later.state.sent).toBe(2);
  });

  it('the session cap stops everything once reached', () => {
    let s = fresh();
    for (let i = 0; i < SESSION_REPORT_CAP; i += 1) s = shouldSend(s, `f${i}`, i).state;
    expect(s.sent).toBe(SESSION_REPORT_CAP);
    expect(shouldSend(s, 'brand-new', 999999).send).toBe(false);
  });

  it('the distinct-fingerprint cap stops a message that varies every time', () => {
    let s = fresh();
    // Below the session cap, so only the distinct cap can be doing the stopping.
    const n = Math.min(DISTINCT_FINGERPRINT_CAP, SESSION_REPORT_CAP);
    for (let i = 0; i < n; i += 1) s = shouldSend(s, `unique-${i}`, i).state;
    expect(shouldSend(s, 'unique-999', 1).send).toBe(false);
  });

  it('an empty fingerprint is never sent', () => {
    expect(shouldSend(fresh(), '', 1).send).toBe(false);
  });

  it('fingerprints separate kind, message and engine', () => {
    expect(fingerprintReport({ kind: 'a', message: 'm' }))
      .not.toBe(fingerprintReport({ kind: 'b', message: 'm' }));
    expect(fingerprintReport({ kind: 'a', message: 'm', engine: 'x' }))
      .not.toBe(fingerprintReport({ kind: 'a', message: 'm', engine: 'y' }));
  });
});

/* ────────────────────── the beacon itself ────────────────────── */

describe('109.md §46 — the three captured failures', () => {
  let sent;
  beforeEach(() => {
    resetOpsErrorReporter();
    sent = [];
    globalThis.navigator = { sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } };
    globalThis.Blob = class { constructor(parts) { this.text = String(parts[0]); } };
  });
  afterEach(() => {
    delete globalThis.navigator;
    delete globalThis.Blob;
    resetOpsErrorReporter();
    vi.restoreAllMocks();
  });

  const body = (i = 0) => JSON.parse(sent[i].blob.text);

  it('posts to the existing beacon route with the server-expected shape', () => {
    expect(reportOpsError({ kind: 'x-kind', message: 'x message' })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/client-errors');
    const b = body();
    expect(b.kind).toBe('x-kind');
    expect(b.name).toBe('x-kind');          // the server reads `name || kind`
    expect(b.message).toBe('x message');
    expect(typeof b.correlationId).toBe('string');
    expect(b).not.toHaveProperty('stack');
  });

  it('truncates an over-long message rather than trusting the server to', () => {
    reportOpsError({ kind: 'k', message: 'z'.repeat(5000) });
    expect(body().message.length).toBe(REPORT_LIMITS.message);
  });

  it('redacts on the way out, even if a caller forwards a user-facing note', () => {
    reportOpsError({ kind: 'k', message: 'Deleted “atrial fibrillation” from inclusion' });
    expect(body().message).toBe('Deleted “…” from inclusion');
  });

  it('an empty report is not sent', () => {
    expect(reportOpsError({})).toBe(false);
    expect(reportOpsError()).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('deduping applies to the real entry points too', () => {
    expect(reportAutosaveConflict({ scope: 'autosave' })).toBe(true);
    expect(reportAutosaveConflict({ scope: 'autosave' })).toBe(false);
    expect(sent).toHaveLength(1);
    expect(body().kind).toBe(OPS_ERROR_KINDS.AUTOSAVE_CONFLICT);
  });

  it('the three helpers use the three declared kinds', () => {
    reportHistoryPersistFailure({ scope: 'screening', kind: 'screening.keyword', reason: 'undo' });
    reportStaleMutationRefusal({ scope: 'screening', kind: 'screening.decision', detail: 'stage-moved' });
    reportAutosaveConflict({ scope: 'autosave' });
    expect(sent.map((_, i) => body(i).kind)).toEqual([
      OPS_ERROR_KINDS.HISTORY_PERSIST,
      OPS_ERROR_KINDS.STALE_MUTATION,
      OPS_ERROR_KINDS.AUTOSAVE_CONFLICT,
    ]);
  });

  it('NEVER throws — a broken transport is swallowed and reported as false', () => {
    globalThis.navigator = { sendBeacon: () => { throw new Error('boom'); } };
    expect(() => reportOpsError({ kind: 'k', message: 'm' })).not.toThrow();
    expect(reportOpsError({ kind: 'k2', message: 'm2' })).toBe(false);
  });

  it('no transport at all is a silent false, not a crash', () => {
    delete globalThis.navigator;
    const realFetch = globalThis.fetch;
    globalThis.fetch = undefined;
    expect(reportOpsError({ kind: 'k', message: 'm' })).toBe(false);
    globalThis.fetch = realFetch;
  });

  it('the session cap is enforced end-to-end', () => {
    for (let i = 0; i < SESSION_REPORT_CAP + 5; i += 1) {
      reportOpsError({ kind: 'k', message: `m${i}` });
    }
    expect(sent.length).toBeLessThanOrEqual(SESSION_REPORT_CAP);
    expect(opsErrorReporterState().sent).toBe(SESSION_REPORT_CAP);
  });
});
