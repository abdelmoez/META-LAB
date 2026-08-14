/**
 * historyOps.test.js — 108.md §6/§14. The two undoable STRUCTURED manuscript
 * mutations, proved as exact round trips against the real engine writers.
 *
 * The point of these tests is that the inverse is byte-honest: absence must be
 * restored as absence (not as an explicit `false`/empty object), and the fact pin's
 * TWO halves — the override AND the factLog entry's revert flags — must come back
 * together, because `revertFact` writes both and `clearFactOverride` only undoes one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// 116.md validation — read source through the LF-normalising helper so these
// wiring pins compare content, not the checkout's line-ending policy.
import { readSource } from '../../helpers/readSource.js';
import {
  sectionLockOf, sectionLockMatches, captureFactPin, applyFactPin, factPinMatches,
} from '../../../src/research-engine/manuscript/historyOps.js';
import {
  overrideFact, clearFactOverride, markChangeReverted,
} from '../../../src/research-engine/manuscript/factProvenance.js';
import { setSectionLocked } from '../../../src/features/manuscript/manuscriptState.js';
import { makeManuscriptDraft } from '../../../src/research-engine/manuscript/model.js';

const draft = () => makeManuscriptDraft({ title: 'Test review' });

describe('section lock — the prior boolean IS the inverse', () => {
  it('reads an unset lock as false', () => {
    expect(sectionLockOf(draft(), 'methods')).toBe(false);
    expect(sectionLockOf(null, 'methods')).toBe(false);
    expect(sectionLockOf(draft(), 'not-a-section')).toBe(false);
  });

  it('round-trips lock → undo → redo through the real engine writer', () => {
    const d0 = draft();
    const d1 = setSectionLocked(d0, 'methods', true);
    expect(sectionLockOf(d1, 'methods')).toBe(true);
    const d2 = setSectionLocked(d1, 'methods', false);      // the undo op
    expect(sectionLockOf(d2, 'methods')).toBe(false);
    const d3 = setSectionLocked(d2, 'methods', true);       // the redo op
    expect(sectionLockOf(d3, 'methods')).toBe(true);
  });

  it('does not disturb its siblings', () => {
    const d = setSectionLocked(draft(), 'methods', true);
    expect(sectionLockOf(d, 'results')).toBe(false);
    expect(sectionLockOf(d, 'discussion')).toBe(false);
  });

  it('sectionLockMatches is the §14 precondition', () => {
    const d = setSectionLocked(draft(), 'methods', true);
    expect(sectionLockMatches(d, 'methods', true)).toBe(true);
    expect(sectionLockMatches(d, 'methods', false)).toBe(false);
    // A collaborator already unlocked it → the executor must refuse.
    expect(sectionLockMatches(setSectionLocked(d, 'methods', false), 'methods', true)).toBe(false);
  });
});

describe('fact pin — capture/apply restore BOTH halves', () => {
  const KEY = 'search.databaseCount';  // a real registry key — overrideFact ignores unknown ones

  const withLog = (d) => ({
    ...d,
    factLog: [{ id: 'c1', key: KEY, from: '11', to: '12', at: '2026-01-01T00:00:00.000Z', engine: 'screening' }],
  });

  it('captures "no pin, never reverted" as a pair of nulls', () => {
    const snap = captureFactPin(withLog(draft()), KEY, 'c1');
    expect(snap).toMatchObject({ key: KEY, changeId: 'c1', override: null });
    expect(snap.change).toEqual({ reverted: false, revertedAt: null, revertedBy: '' });
  });

  it('round-trips revertFact → undo → redo, flags and all', () => {
    const base = withLog(draft());
    const before = captureFactPin(base, KEY, 'c1');

    // FORWARD — exactly what useManuscript.revertFact does.
    const pinned = markChangeReverted(
      overrideFact(base, KEY, '11', {
        nowIso: '2026-02-02T00:00:00.000Z', by: 'Lee', reason: 'kept the reviewed wording',
        projectValue: '12',
      }).draft,
      'c1',
      { nowIso: '2026-02-02T00:00:00.000Z', by: 'Lee' },
    ).draft;
    const after = captureFactPin(pinned, KEY, 'c1');
    expect(after.override).toMatchObject({ value: '11', by: 'Lee', projectValue: '12' });
    expect(after.change).toMatchObject({ reverted: true, revertedBy: 'Lee' });

    // UNDO — the pin AND the struck-through flag both go away.
    const undone = applyFactPin(pinned, before);
    expect(undone.factOverrides).toBeUndefined();
    expect(undone.factLog[0].reverted).toBeUndefined();
    expect(undone.factLog[0].revertedAt).toBeUndefined();
    expect(undone.factLog[0].revertedBy).toBeUndefined();
    // …and the rest of the log entry survives untouched (§12: never a deletion).
    expect(undone.factLog[0]).toMatchObject({ id: 'c1', key: KEY, from: '11', to: '12' });

    // REDO — the ORIGINAL override comes back verbatim, timestamp and actor included.
    const redone = applyFactPin(undone, after);
    expect(redone.factOverrides[KEY]).toEqual(after.override);
    expect(redone.factOverrides[KEY].at).toBe('2026-02-02T00:00:00.000Z');
    expect(redone.factLog[0]).toMatchObject({ reverted: true, revertedBy: 'Lee' });
  });

  it('restores ABSENCE as absence — the container is dropped, not emptied', () => {
    const base = draft();
    const before = captureFactPin(base, KEY, null);
    const pinned = overrideFact(base, KEY, '9', { nowIso: 'x', by: '', reason: '', projectValue: '9' }).draft;
    expect(pinned.factOverrides).toBeTruthy();
    const undone = applyFactPin(pinned, before);
    expect('factOverrides' in undone).toBe(false);
  });

  it('keeps a SECOND pin alive when one is undone', () => {
    const base = draft();
    const a = overrideFact(base, KEY, '9', { nowIso: 'x', projectValue: '9' }).draft;
    const both = overrideFact(a, 'search.databases', '4', { nowIso: 'y', projectValue: '5' }).draft;
    const beforeSecond = captureFactPin(a, 'search.databases', null);
    const undone = applyFactPin(both, beforeSecond);
    expect(undone.factOverrides[KEY]).toBeTruthy();
    expect(undone.factOverrides['search.databases']).toBeUndefined();
  });

  it('round-trips keepCurrentFact (clearFactOverride) the other way', () => {
    const pinned = overrideFact(draft(), KEY, '9', { nowIso: 'x', projectValue: '10' }).draft;
    const before = captureFactPin(pinned, KEY, null);
    const cleared = clearFactOverride(pinned, KEY).draft;
    const after = captureFactPin(cleared, KEY, null);
    expect(after.override).toBeNull();

    expect(applyFactPin(cleared, before).factOverrides[KEY]).toEqual(before.override);
    expect('factOverrides' in applyFactPin(pinned, after)).toBe(false);
  });

  it('factPinMatches is the §14 precondition and ignores metadata churn', () => {
    const pinned = overrideFact(draft(), KEY, '9', { nowIso: 'x', by: 'A', projectValue: '10' }).draft;
    const snap = captureFactPin(pinned, KEY, null);
    expect(factPinMatches(pinned, snap)).toBe(true);
    // Same pinned VALUE, different actor/timestamp → still the state we expect.
    const rePinned = overrideFact(draft(), KEY, '9', { nowIso: 'zzz', by: 'B', projectValue: '10' }).draft;
    expect(factPinMatches(rePinned, snap)).toBe(true);
    // A different pinned value, or no pin at all → refuse.
    const moved = overrideFact(draft(), KEY, '77', { nowIso: 'x', projectValue: '10' }).draft;
    expect(factPinMatches(moved, snap)).toBe(false);
    expect(factPinMatches(draft(), snap)).toBe(false);
    expect(factPinMatches(pinned, captureFactPin(draft(), KEY, null))).toBe(false);
  });

  it('is inert for junk input rather than throwing', () => {
    const d = draft();
    expect(applyFactPin(d, null)).toBe(d);
    expect(applyFactPin(d, { key: '' })).toBe(d);
    expect(applyFactPin(null, { key: KEY })).toBeNull();
    expect(factPinMatches(d, null)).toBe(false);
    expect(captureFactPin(null, KEY, 'c1')).toMatchObject({ override: null, change: null });
  });
});

/**
 * The hook wiring itself is effect- and event-driven, so it cannot run under
 * static rendering. Pin it at the source instead — the same fallback
 * tests/unit/screening/keywordUndoWiring.test.js uses for logic that lives inside a
 * component too large to mount.
 */
describe('useManuscript wiring (source pins)', () => {
  const s = readSource(new URL('../../../src/features/manuscript/useManuscript.js', import.meta.url));

  it('registers an executor for each recordable kind', () => {
    expect(s).toContain("registerExecutor('manuscript.sectionLock'");
    expect(s).toContain("registerExecutor('manuscript.factPin'");
  });

  it('routes both executors through mutateActive — the SAME path as the forward write', () => {
    // 108.md §8: never a local-state rollback. mutateActive also flushes pending
    // typing first, so an undo can never resurrect uncommitted text.
    expect(s).toContain('MS.setSectionLocked(cur, op.sectionId, op.locked)');
    expect(s).toContain('applyFactPin(cur, op.snapshot)');
  });

  it('re-validates against the freshest draft and refuses when it moved (§14)', () => {
    expect(s).toContain('sectionLockMatches(d, op.sectionId, op.expect)');
    expect(s).toContain('factPinMatches(d, op.expect)');
    expect(s).toContain("{ ok: false, reason: 'refused' }");
  });

  it('records the section lock with the prior boolean as the inverse', () => {
    expect(s).toContain("kind: 'manuscript.sectionLock'");
    expect(s).toContain('undoOp: { draftId, sectionId: id, locked: prev, expect: !!locked }');
    expect(s).toContain('redoOp: { draftId, sectionId: id, locked: !!locked, expect: prev }');
    expect(s).toContain('if (!next || !draftId || prev === !!locked) return;');  // no-op → no entry
  });

  it('records BOTH fact actions through one snapshot-based entry', () => {
    expect(s).toContain("kind: 'manuscript.factPin'");
    expect(s).toContain('recordFactPin(draftId, key, changeId, before, nextDraft)');
    expect(s).toContain('recordFactPin(draftId, key, null, before, nextDraft)');
    expect(s).toContain('if (pinSame && flagSame) return;');
  });

  it('captures the pre-image BEFORE the mutation, not after', () => {
    const revertAt = s.indexOf('const revertFact');
    const body = s.slice(revertAt, revertAt + 900);
    expect(body.indexOf('captureFactPin(beforeDraft')).toBeLessThan(body.indexOf('mutateActive'));
  });
});
