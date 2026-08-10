/**
 * opsControlPlane109r2.test.js — regression pins for the 109 round-2 review fixes.
 *
 * Each block corresponds to one CONFIRMED review finding against the 109 Ops
 * control plane. They live together because they share one theme: a governance
 * surface that silently reported, wrote or dropped something other than what the
 * operator asked for. Pure exports only — no database, no express (house style).
 */
import { restoreShellEnv } from '../screening/helpers/prismaEnvGuard.js'; // FIRST import
import { describe, it, expect } from 'vitest';
import {
  sanitizeClientErrorReport, canRequeueDuplicateJob, parseDate, REQUEUE_PATCH,
} from '../../server/controllers/researchOpsJobsController.js';
import { buildScreeningAuditQuery } from '../../server/controllers/screeningAdminController.js';
import { keywordAuditRows } from '../../server/screening/keywordAudit.js';
import {
  suggestCriteriaKeywords, operatorStopList,
} from '../../src/research-engine/screening/suggestKeywords.js';
import { rejectedFor } from '../../src/frontend/pages/admin/research/useResearchGovernance.js';
import { draftIsDirty } from '../../src/frontend/pages/admin/research/primitives.jsx';
import { OPS_SETTINGS } from '../../src/shared/opsSettingsCatalog.js';

restoreShellEnv();

/* ─── [major] client-error fingerprint must not include the correlation id ── */

describe('client-error fingerprint (109 r2)', () => {
  const base = { name: 'TypeError', message: 'x is not a function', route: '/screening', engine: 'sift', release: 'v4.13.0' };

  it('collapses two reports that differ ONLY by correlationId', () => {
    const a = sanitizeClientErrorReport({ ...base, correlationId: 'aaaa-1111' });
    const b = sanitizeClientErrorReport({ ...base, correlationId: 'bbbb-2222' });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('still stores the correlation id in context as an exemplar', () => {
    const a = sanitizeClientErrorReport({ ...base, correlationId: 'aaaa-1111' });
    expect(a.context).toContain('cid=aaaa-1111');
    expect(a.context).toContain('route=/screening');
  });

  it('keeps distinguishing genuinely different failures', () => {
    const a = sanitizeClientErrorReport({ ...base, correlationId: 'z' });
    const other = sanitizeClientErrorReport({ ...base, message: 'y is not a function', correlationId: 'z' });
    const route = sanitizeClientErrorReport({ ...base, route: '/extraction', correlationId: 'z' });
    expect(a.fingerprint).not.toBe(other.fingerprint);
    expect(a.fingerprint).not.toBe(route.fingerprint);
  });

  it('a missing correlation id fingerprints the same as a present one', () => {
    const withId = sanitizeClientErrorReport({ ...base, correlationId: 'aaaa' });
    const without = sanitizeClientErrorReport({ ...base });
    expect(withId.fingerprint).toBe(without.fingerprint);
  });
});

/* ─── [major] `to` date filters are inclusive of the selected end day ─────── */

describe('to-date filters cover the whole selected day (109 r2)', () => {
  it('researchOps parseDate widens a date-only `to` to 23:59:59.999Z', () => {
    expect(parseDate('2026-08-09', { endOfDay: true }).toISOString()).toBe('2026-08-09T23:59:59.999Z');
  });

  it('leaves `from` at midnight', () => {
    expect(parseDate('2026-08-09').toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });

  it('does not widen an explicit timestamp', () => {
    expect(parseDate('2026-08-09T10:30:00.000Z', { endOfDay: true }).toISOString()).toBe('2026-08-09T10:30:00.000Z');
  });

  it('still ignores an invalid date', () => {
    expect(parseDate('not-a-date', { endOfDay: true })).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('screening audit From = To = one day is a non-empty window', () => {
    const { where } = buildScreeningAuditQuery({ from: '2026-08-09', to: '2026-08-09' });
    expect(where.createdAt.gte.toISOString()).toBe('2026-08-09T00:00:00.000Z');
    expect(where.createdAt.lte.toISOString()).toBe('2026-08-09T23:59:59.999Z');
    expect(where.createdAt.lte.getTime()).toBeGreaterThan(where.createdAt.gte.getTime());
  });

  it('a same-day 09:00 record falls inside that window', () => {
    const { where } = buildScreeningAuditQuery({ from: '2026-08-09', to: '2026-08-09' });
    const row = new Date('2026-08-09T09:00:00.000Z');
    expect(row >= where.createdAt.gte && row <= where.createdAt.lte).toBe(true);
  });

  it('screening audit still honours an explicit timestamp `to`', () => {
    const { where } = buildScreeningAuditQuery({ to: '2026-08-09T06:00:00.000Z' });
    expect(where.createdAt.lte.toISOString()).toBe('2026-08-09T06:00:00.000Z');
  });
});

/* ─── [major] requeue must not override a pending user cancellation ───────── */

describe('requeue refuses a cancelled job (109 r2)', () => {
  const failed = { id: 'j1', status: 'failed', attempts: 1, cancelRequested: false };

  it('a failed job with no cancellation is still requeueable', () => {
    expect(canRequeueDuplicateJob(failed)).toEqual({ ok: true });
  });

  it('refuses with 409 + JOB_CANCEL_REQUESTED when the user asked to cancel', () => {
    const v = canRequeueDuplicateJob({ ...failed, cancelRequested: true });
    expect(v.ok).toBe(false);
    expect(v.status).toBe(409);
    expect(v.code).toBe('JOB_CANCEL_REQUESTED');
    expect(v.error).toMatch(/start a new duplicate-detection run/i);
  });

  it('the cancellation check outranks the stale-processing path too', () => {
    const stale = { id: 'j2', status: 'processing', attempts: 0, cancelRequested: true, heartbeatAt: new Date(0) };
    expect(canRequeueDuplicateJob(stale).code).toBe('JOB_CANCEL_REQUESTED');
  });

  it('the requeue patch never writes cancelRequested', () => {
    expect(Object.keys(REQUEUE_PATCH)).not.toContain('cancelRequested');
  });
});

/* ─── [minor] client-claimed `via` is labelled as claimed ─────────────────── */

describe('keyword audit records `via` as client-claimed (109 r2)', () => {
  const ops = [{ type: 'remove', term: 'covid', list: 'include' }];

  it('adds claimedVia alongside the existing via', () => {
    const [row] = keywordAuditRows(ops, [{ changed: true }], { via: 'undo' });
    expect(row.details.claimedVia).toBe('undo');
    expect(row.details.via).toBe('undo');
    expect(row.action).toBe('KEYWORD_UNDO');
  });

  it('defaults to user when the client sends nothing', () => {
    const [row] = keywordAuditRows(ops, [{ changed: true }]);
    expect(row.details.claimedVia).toBe('user');
    expect(row.action).toBe('KEYWORD_REMOVED');
  });

  it('an unrecognised claim degrades to user rather than being echoed', () => {
    const [row] = keywordAuditRows(ops, [{ changed: true }], { via: 'system' });
    expect(row.details.claimedVia).toBe('user');
  });
});

/* ─── [minor×2] an admin stop-list addition always wins ───────────────────── */

describe('stopListAdditions outrank allowAmbiguousSingleWords (109 r2)', () => {
  const pico = { incl: 'Adults with covid' };

  it('a blocked single word stays blocked with the ambiguity knob ON', () => {
    const out = suggestCriteriaKeywords(pico, { stopListAdditions: ['covid'], allowAmbiguousSingleWords: true });
    expect(out.include.map((t) => t.toLowerCase())).not.toContain('covid');
  });

  it('the knob still relaxes SHIPPED generic single words', () => {
    const off = suggestCriteriaKeywords(pico, { stopListAdditions: ['covid'] });
    const on = suggestCriteriaKeywords(pico, { stopListAdditions: ['covid'], allowAmbiguousSingleWords: true });
    expect(on.include.length).toBeGreaterThan(off.include.length);
    expect(on.include.map((t) => t.toLowerCase())).toContain('adults');
  });

  it('a term the operator RE-ALLOWED via stopListRemovals is still emitted', () => {
    const out = suggestCriteriaKeywords(pico, { stopListRemovals: ['adults'] });
    expect(out.include.map((t) => t.toLowerCase())).toContain('adults');
  });

  it('operatorStopList carries only the additions, normalized', () => {
    expect([...operatorStopList({ stopListAdditions: ['  COVID ', ''] })]).toEqual(['covid']);
    expect(operatorStopList({}).size).toBe(0);
  });

  it('an addition beats a removal of the same term (matches effectiveStopList)', () => {
    expect(operatorStopList({ stopListAdditions: ['covid'], stopListRemovals: ['covid'] }).has('covid')).toBe(true);
  });
});

/* ─── [major] DraftInput commits only what the admin typed ────────────────── */

describe('DraftInput dirty tracking (109 r2)', () => {
  it('an untouched field never commits (tabbing through writes nothing)', () => {
    expect(draftIsDirty(false, '20', 100)).toBe(false);
  });

  it('a real edit commits', () => {
    expect(draftIsDirty(true, '250', 100)).toBe(true);
  });

  it('a draft typed back to the stored value is not a write', () => {
    expect(draftIsDirty(true, '100', 100)).toBe(false);
  });

  it('null/undefined stored values compare as the empty string', () => {
    expect(draftIsDirty(true, '', null)).toBe(false);
    expect(draftIsDirty(true, '', undefined)).toBe(false);
  });
});

/* ─── [minor] per-setting validation errors reach the UI ──────────────────── */

describe('rejectedFor surfaces the writer reason (109 r2)', () => {
  const entry = { key: 'keywords.conflictBehavior', path: 'conflictBehavior', label: 'Conflict behaviour' };

  it('matches on the catalogue key', () => {
    expect(rejectedFor([{ key: 'keywords.conflictBehavior', error: 'Expected one of: a, b' }], entry).error)
      .toBe('Expected one of: a, b');
  });

  it('matches on the stored path', () => {
    expect(rejectedFor([{ key: 'conflictBehavior', error: 'Expected a number' }], entry).error).toBe('Expected a number');
  });

  it('ignores another entry rejection and malformed rows', () => {
    expect(rejectedFor([{ key: 'keywords.maxSuggestionsPerList', error: 'nope' }], entry)).toBeNull();
    expect(rejectedFor([{ key: 'conflictBehavior' }], entry)).toBeNull();
    expect(rejectedFor(undefined, entry)).toBeNull();
    expect(rejectedFor([], null)).toBeNull();
  });
});

/* ─── [minor] the Ctrl+Y shortcut label tracks the catalogue ──────────────── */

describe('Ctrl+Y redo alias default (109 r2)', () => {
  it('the catalogue still declares it ON, which the shortcut map now derives', () => {
    const entry = OPS_SETTINGS.find((e) => e.key === 'interaction.ctrlYRedoAlias');
    expect(entry).toBeTruthy();
    expect(entry.default).toBe(true);
  });
});
