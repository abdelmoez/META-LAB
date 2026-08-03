/**
 * searchRegenerateFlow.test.js — 97 QA M4/M5/M28/M31. FUNCTIONAL coverage of the
 * snapshot-then-regenerate transition (performRegenerate — extracted from the
 * React component exactly so this ordering is testable):
 *   - the pending debounced save is FLUSHED AND AWAITED before the snapshot
 *     (the server-side snapshot freezes the SERVER state, so un-flushed edits
 *     would be missing from "Before regeneration");
 *   - a failed flush aborts with NO state change;
 *   - a failed snapshot aborts with NO state change (Phase 4: "Regeneration must
 *     not proceed if the snapshot cannot be saved reliably");
 *   - a NEVER-SAVED workspace (server revision 0) skips the snapshot instead of
 *     dead-ending on the server's `no_strategy` 400 — and a raced 400 is
 *     tolerated the same way.
 */
import { describe, it, expect } from 'vitest';
import {
  performRegenerate, isNoStrategyError,
  REGENERATE_FLUSH_ERROR, REGENERATE_SNAPSHOT_ERROR,
} from '../../src/features/searchBuilder/regenerateFlow.js';

const spy = () => {
  const calls = [];
  const fn = (name, impl) => async (...a) => { calls.push(name); return impl ? impl(...a) : undefined; };
  return { calls, fn };
};

describe('performRegenerate — ordering + abort guarantees', () => {
  it('QA M4/M28 — flushes the pending save BEFORE the snapshot, then applies', async () => {
    const { calls, fn } = spy();
    const res = await performRegenerate({
      flushPendingSave: fn('flush', () => true),
      hasSavedStrategy: () => true,
      saveSnapshot: fn('snapshot'),
      applyRegenerated: (o) => { calls.push(`apply:${o.snapshotted}`); },
    });
    expect(res).toEqual({ ok: true, snapshotted: true });
    expect(calls).toEqual(['flush', 'snapshot', 'apply:true']);
  });

  it('QA M28 — a FAILED flush aborts: no snapshot, no apply, no state change', async () => {
    const { calls, fn } = spy();
    const res = await performRegenerate({
      flushPendingSave: fn('flush', () => false),
      hasSavedStrategy: () => true,
      saveSnapshot: fn('snapshot'),
      applyRegenerated: () => calls.push('apply'),
    });
    expect(res).toEqual({ ok: false, error: REGENERATE_FLUSH_ERROR });
    expect(calls).toEqual(['flush']);
  });

  it('QA M31 — a FAILED snapshot aborts: apply NEVER runs', async () => {
    const { calls, fn } = spy();
    const res = await performRegenerate({
      flushPendingSave: fn('flush', () => true),
      hasSavedStrategy: () => true,
      saveSnapshot: fn('snapshot', () => { const e = new Error('HTTP 500'); e.status = 500; throw e; }),
      applyRegenerated: () => calls.push('apply'),
    });
    expect(res).toEqual({ ok: false, error: REGENERATE_SNAPSHOT_ERROR });
    expect(calls).toEqual(['flush', 'snapshot']);
  });

  it('QA M5 — a NEVER-SAVED workspace (revision 0) skips the snapshot and proceeds', async () => {
    const { calls, fn } = spy();
    const res = await performRegenerate({
      flushPendingSave: fn('flush', () => true),
      hasSavedStrategy: () => false, // server revision 0 after the flush
      saveSnapshot: fn('snapshot'),
      applyRegenerated: (o) => calls.push(`apply:${o.snapshotted}`),
    });
    expect(res).toEqual({ ok: true, snapshotted: false });
    expect(calls).toEqual(['flush', 'apply:false']); // no snapshot POST at all
  });

  it('QA M5 — a raced `no_strategy` 400 is tolerated as nothing-to-snapshot', async () => {
    const { calls, fn } = spy();
    const res = await performRegenerate({
      flushPendingSave: fn('flush', () => true),
      hasSavedStrategy: () => true,
      saveSnapshot: fn('snapshot', () => { const e = new Error('HTTP 400'); e.status = 400; throw e; }),
      applyRegenerated: (o) => calls.push(`apply:${o.snapshotted}`),
    });
    expect(res).toEqual({ ok: true, snapshotted: false });
    expect(calls).toEqual(['flush', 'snapshot', 'apply:false']);
  });

  it('a THROWING flush aborts like a failed one', async () => {
    const res = await performRegenerate({
      flushPendingSave: async () => { throw new Error('network'); },
      hasSavedStrategy: () => true,
      saveSnapshot: async () => {},
      applyRegenerated: () => { throw new Error('must not run'); },
    });
    expect(res).toEqual({ ok: false, error: REGENERATE_FLUSH_ERROR });
  });

  it('isNoStrategyError keys strictly on status 400', () => {
    expect(isNoStrategyError({ status: 400 })).toBe(true);
    expect(isNoStrategyError({ status: 500 })).toBe(false);
    expect(isNoStrategyError(null)).toBe(false);
  });
});
