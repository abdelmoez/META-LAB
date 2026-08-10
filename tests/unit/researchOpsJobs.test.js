/**
 * 109.md W1-B — pure-function contracts for the Research Governance server half:
 *
 *   - keyword audit row shapes (§22/§23/§50) — the ledger rows keywordOps appends,
 *   - the duplicate-job Ops projection (§8) — proving cpuMs/heapUsedMb never leak,
 *   - the requeue precondition matrix (§9/§56),
 *   - the client-error sanitizer bounds (§6/§47),
 *   - pagination maths for both new/reworked list endpoints (§24).
 *
 * Everything asserted here is a pure export — no database, no express, no server
 * boot — which is why the shapes are pinned here rather than in an integration
 * file that self-skips when :3001 is down.
 */
import { restoreShellEnv } from '../screening/helpers/prismaEnvGuard.js'; // FIRST import
import { describe, it, expect } from 'vitest';
import {
  keywordAuditRows, normalizeKeywordVia, KEYWORD_AUDIT_ACTIONS, KEYWORD_AUDIT_VIA,
} from '../../server/screening/keywordAudit.js';
import {
  opsDuplicateJob, canRequeueDuplicateJob, isStaleJob, median, jobDurationMs,
  parseJobPage, sanitizeClientErrorReport, REQUEUE_PATCH,
  CLIENT_ERROR_LIMITS, CLIENT_ERROR_MAX_ROWS,
} from '../../server/controllers/researchOpsJobsController.js';
import { buildScreeningAuditQuery } from '../../server/controllers/screeningAdminController.js';
import { MOD_GRANTED_PERMISSIONS } from '../../server/middleware/requireAdmin.js';
import { DEFAULT_MAX_JOB_ATTEMPTS } from '../../server/utils/jobRetry.js';

restoreShellEnv();

const changed = (n) => Array.from({ length: n }, () => ({ changed: true }));

/* ── §22/§23 keyword audit rows ─────────────────────────────────────────── */

describe('109 §22 — keyword mutations produce ledger rows', () => {
  it('maps every physical op type to a distinct action string', () => {
    const ops = [
      { type: 'add', list: 'include', term: 'sepsis' },
      { type: 'remove', list: 'exclude', term: 'mouse' },
      { type: 'move', list: 'include', term: 'pediatric', toList: 'exclude' },
      { type: 'accept', list: 'include', term: 'cohort' },
      { type: 'reject', list: 'exclude', term: 'review' },
      { type: 'clear-decision', list: 'include', term: 'rct' },
    ];
    const rows = keywordAuditRows(ops, changed(6));
    expect(rows.map((r) => r.action)).toEqual([
      'KEYWORD_ADDED', 'KEYWORD_REMOVED', 'KEYWORD_MOVED',
      'KEYWORD_SUGGESTION_ACCEPTED', 'KEYWORD_SUGGESTION_REJECTED', 'KEYWORD_DECISION_CLEARED',
    ]);
    expect(new Set(Object.values(KEYWORD_AUDIT_ACTIONS)).size).toBe(6);
  });

  it('records the term, list and entity id for a deletion (§22 fields)', () => {
    const [row] = keywordAuditRows([{ type: 'remove', list: 'exclude', term: 'mouse' }], changed(1));
    expect(row.entityType).toBe('keyword');
    expect(row.entityId).toBe('exclude:mouse');
    expect(row.details).toMatchObject({ op: 'KEYWORD_REMOVED', term: 'mouse', list: 'exclude', via: 'user' });
  });

  it('infers the destination list for a move when toList is omitted', () => {
    const [row] = keywordAuditRows([{ type: 'move', list: 'include', term: 'x' }], changed(1));
    expect(row.details.toList).toBe('exclude');
  });

  it('audits ONLY the ops that actually changed state (no-ops are not events)', () => {
    const ops = [
      { type: 'add', list: 'include', term: 'a' },
      { type: 'add', list: 'include', term: 'b' },
      { type: 'remove', list: 'include', term: 'c' },
    ];
    const rows = keywordAuditRows(ops, [{ changed: true }, { changed: false, reason: 'noop' }, { changed: true }]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.details.term)).toEqual(['a', 'c']);
  });

  it('§50 — an undo APPENDS a distinct action, it never rewrites the original', () => {
    const del = keywordAuditRows([{ type: 'remove', list: 'include', term: 'sepsis' }], changed(1));
    const undo = keywordAuditRows([{ type: 'add', list: 'include', term: 'sepsis' }], changed(1), { via: 'undo' });
    const redo = keywordAuditRows([{ type: 'remove', list: 'include', term: 'sepsis' }], changed(1), { via: 'redo' });
    expect(del[0].action).toBe('KEYWORD_REMOVED');
    expect(undo[0].action).toBe('KEYWORD_UNDO');
    expect(redo[0].action).toBe('KEYWORD_REDO');
    // The physical op is still recoverable from details, so the trail stays honest.
    expect(undo[0].details.op).toBe('KEYWORD_ADDED');
    expect(redo[0].details.op).toBe('KEYWORD_REMOVED');
  });

  it('truncates terms and degrades an unknown `via` to "user"', () => {
    const long = 'z'.repeat(400);
    const [row] = keywordAuditRows([{ type: 'add', list: 'include', term: long }], changed(1), { via: 'hax' });
    expect(row.details.term).toHaveLength(200);
    expect(row.details.via).toBe('user');
    expect(normalizeKeywordVia(undefined)).toBe('user');
    expect(KEYWORD_AUDIT_VIA).toEqual(['user', 'undo', 'redo']);
  });

  it('is defensive about malformed input', () => {
    expect(keywordAuditRows(null, null)).toEqual([]);
    expect(keywordAuditRows([{ type: 'bogus', list: 'include', term: 'x' }], changed(1))).toEqual([]);
    expect(keywordAuditRows([{ type: 'add', list: 'include', term: 'x' }], [])).toEqual([]);
  });
});

/* ── §8 duplicate-job projection + leakage guard ────────────────────────── */

const jobRow = (over = {}) => ({
  id: 'job-1', projectId: 'p-1', status: 'completed', stage: 'done',
  cancelRequested: false, totalRecords: 10, processedRecords: 10,
  comparisonsTotal: 5, comparisonsDone: 5, groupsFound: 2, groupsCreated: 1,
  groupsUpdated: 1, recordsFlagged: 3, exactMatches: 1, fuzzyMatches: 1,
  attempts: 1, error: '', createdById: 'u-1', createdByName: 'Ada',
  heartbeatAt: null, startedAt: null, completedAt: null, createdAt: null, updatedAt: null,
  statsJson: JSON.stringify({
    projectRecordCount: 10, truncated: false,
    durationsMs: { total: 1200, fuzzy: 800 },
    cpuMs: { user: 900, system: 40 }, heapUsedMb: 512,
    secretish: 'must-not-appear',
  }),
  ...over,
});

describe('109 §8 — Ops duplicate-job projection', () => {
  it('NEVER exposes cpuMs, heapUsedMb, or unknown stats keys', () => {
    const out = opsDuplicateJob(jobRow());
    const blob = JSON.stringify(out);
    expect(blob).not.toContain('cpuMs');
    expect(blob).not.toContain('heapUsedMb');
    expect(blob).not.toContain('must-not-appear');
    expect(out.stats.secretish).toBeUndefined();
  });

  it('keeps the non-sensitive engine stats and per-stage wall-clock', () => {
    const out = opsDuplicateJob(jobRow(), { projectTitle: 'Review A' });
    expect(out.stats.projectRecordCount).toBe(10);
    expect(out.stats.durationsMs).toEqual({ total: 1200, fuzzy: 800 });
    expect(out.durationMs).toBe(1200);
    expect(out.projectTitle).toBe('Review A');
  });

  it('surfaces the retry budget from the shared jobRetry policy', () => {
    const out = opsDuplicateJob(jobRow({ attempts: 2 }));
    expect(out.maxAttempts).toBe(DEFAULT_MAX_JOB_ATTEMPTS);
    expect(out.retriesRemaining).toBe(DEFAULT_MAX_JOB_ATTEMPTS - 2);
  });

  it('survives unparseable statsJson and a null row', () => {
    expect(opsDuplicateJob(jobRow({ statsJson: '{oops' })).stats).toEqual({});
    expect(opsDuplicateJob(jobRow({ statsJson: '{oops' })).durationMs).toBeNull();
    expect(opsDuplicateJob(null)).toBeNull();
    expect(jobDurationMs(null)).toBeNull();
  });

  it('median/stale helpers behave', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3); // rounded mean of the middle pair
    const now = 1_000_000_000;
    expect(isStaleJob({ status: 'processing', heartbeatAt: new Date(now - 1000) }, now, 60_000)).toBe(false);
    expect(isStaleJob({ status: 'processing', heartbeatAt: new Date(now - 120_000) }, now, 60_000)).toBe(true);
    expect(isStaleJob({ status: 'processing', heartbeatAt: null, startedAt: null }, now, 60_000)).toBe(true);
    expect(isStaleJob({ status: 'queued' }, now, 60_000)).toBe(false);
  });
});

/* ── §9 requeue preconditions ───────────────────────────────────────────── */

describe('109 §9 — requeue preconditions (backend-enforced, §56)', () => {
  const NOW = 2_000_000_000;
  const stale = { status: 'processing', attempts: 1, heartbeatAt: new Date(NOW - 3_600_000) };

  it('allows a failed job under the retry cap', () => {
    expect(canRequeueDuplicateJob({ status: 'failed', attempts: 1 }, { now: NOW })).toEqual({ ok: true });
  });

  it('allows a STALE processing job (matches the worker recovery tick)', () => {
    expect(canRequeueDuplicateJob(stale, { now: NOW })).toEqual({ ok: true });
  });

  it('refuses a live processing job — two workers on one project is the hazard', () => {
    const live = { status: 'processing', attempts: 1, heartbeatAt: new Date(NOW - 1000) };
    expect(canRequeueDuplicateJob(live, { now: NOW })).toMatchObject({ ok: false, status: 409 });
  });

  it('refuses terminal jobs rather than rewriting finished history', () => {
    for (const status of ['completed', 'cancelled', 'queued']) {
      expect(canRequeueDuplicateJob({ status, attempts: 0 }, { now: NOW })).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('refuses once the shared retry budget is spent (poison-pill guard)', () => {
    const spent = { status: 'failed', attempts: DEFAULT_MAX_JOB_ATTEMPTS };
    expect(canRequeueDuplicateJob(spent, { now: NOW })).toMatchObject({ ok: false, status: 409 });
  });

  it('refuses while the allowDuplicateDetection kill switch is off', () => {
    expect(canRequeueDuplicateJob({ status: 'failed', attempts: 0 }, { now: NOW, enabled: false }))
      .toMatchObject({ ok: false, status: 409 });
  });

  it('404s a missing job', () => {
    expect(canRequeueDuplicateJob(null)).toMatchObject({ ok: false, status: 404 });
  });

  it('reuses the worker recovery patch verbatim — attempts are NOT reset', () => {
    expect(REQUEUE_PATCH).toEqual({ status: 'queued', stage: 'queued', startedAt: null, heartbeatAt: null });
    expect(Object.keys(REQUEUE_PATCH)).not.toContain('attempts');
  });
});

/* ── §6/§47 client-error sanitizer ──────────────────────────────────────── */

describe('109 §6 — client-error report sanitizer', () => {
  it('bounds every field and packs a non-sensitive context string', () => {
    const row = sanitizeClientErrorReport({
      name: 'n'.repeat(300),
      message: 'm'.repeat(2000),
      route: '/screening/abc',
      engine: 'screening',
      release: '4.13.0',
      browser: 'Chrome 140',
      correlationId: 'cid-1',
    });
    expect(row.kind).toHaveLength(CLIENT_ERROR_LIMITS.kind);
    expect(row.message).toHaveLength(CLIENT_ERROR_LIMITS.message);
    expect(row.context.length).toBeLessThanOrEqual(CLIENT_ERROR_LIMITS.context);
    expect(row.context).toContain('route=/screening/abc');
    expect(row.context).toContain('engine=screening');
  });

  it('never reads a stack or any unknown field off the beacon body', () => {
    const row = sanitizeClientErrorReport({
      name: 'TypeError', message: 'boom',
      stack: 'at secret.js:1', token: 'sk-live-123', payload: { patientId: 42 },
    });
    const blob = JSON.stringify(row);
    expect(blob).not.toContain('secret.js');
    expect(blob).not.toContain('sk-live-123');
    expect(blob).not.toContain('patientId');
  });

  it('strips newlines/tabs so one report can never forge extra log lines', () => {
    const row = sanitizeClientErrorReport({ name: 'E', message: 'a\nb\tc\r\nd' });
    expect(row.message).toBe('a b c d');
  });

  it('is deterministic (same input → same fingerprint) and discriminating', () => {
    const a = sanitizeClientErrorReport({ name: 'E', message: 'x', route: '/a' });
    const b = sanitizeClientErrorReport({ name: 'E', message: 'x', route: '/a' });
    const c = sanitizeClientErrorReport({ name: 'E', message: 'x', route: '/b' });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('drops an unidentifiable beacon rather than storing an empty row', () => {
    expect(sanitizeClientErrorReport({})).toBeNull();
    expect(sanitizeClientErrorReport(null)).toBeNull();
    expect(sanitizeClientErrorReport([])).toBeNull();
    expect(sanitizeClientErrorReport({ route: '/only-a-route' })).toBeNull();
    expect(CLIENT_ERROR_MAX_ROWS).toBeGreaterThan(0);
  });
});

/* ── §24 pagination maths ───────────────────────────────────────────────── */

describe('109 §24 — pagination + filters (no whole-history loads)', () => {
  it('parseJobPage defaults, clamps and computes skip', () => {
    expect(parseJobPage({})).toEqual({ page: 1, limit: 25, skip: 0 });
    expect(parseJobPage({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, skip: 20 });
    expect(parseJobPage({ limit: '9999' }).limit).toBe(100);
    expect(parseJobPage({ page: '-4', limit: '0' })).toEqual({ page: 1, limit: 25, skip: 0 });
  });

  it('the screening audit query always paginates (the old handler was take:200)', () => {
    const q = buildScreeningAuditQuery({});
    expect(q).toMatchObject({ page: 1, limit: 50, skip: 0 });
    expect(buildScreeningAuditQuery({ page: '4', limit: '25' }).skip).toBe(75);
    expect(buildScreeningAuditQuery({ limit: '5000' }).limit).toBe(100);
  });

  it('builds the documented filter set', () => {
    const { where } = buildScreeningAuditQuery({
      projectId: 'p1', action: 'KEYWORD_REMOVED', entityType: 'keyword', actorId: 'u1',
      from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z',
    });
    expect(where.projectId).toBe('p1');
    expect(where.action).toBe('KEYWORD_REMOVED');
    expect(where.entityType).toBe('keyword');
    expect(where.actorId).toBe('u1');
    expect(where.createdAt.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(where.createdAt.lte.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('ignores blank and unparseable filters instead of 400-ing the Ops filter bar', () => {
    expect(buildScreeningAuditQuery({ projectId: '  ', action: '', from: 'not-a-date' }).where).toEqual({});
  });
});

/* ── §39 capability seam ────────────────────────────────────────────────── */

describe('109 §39 — capability seam', () => {
  it('mods get read-only research diagnostics and NOTHING that mutates state', () => {
    expect(MOD_GRANTED_PERMISSIONS).toContain('view_research_diagnostics');
    expect(MOD_GRANTED_PERMISSIONS).not.toContain('manage_research_jobs');
  });
});
