/**
 * 117.md §J.19 — "edit, then reload immediately" must not lose the edit.
 *
 * What is covered here:
 *   - `anyPending` / `drainPending`: the pure ordering rule that makes the fix work
 *     at all (BUFFER drains into the shell BEFORE the SHELL sends the blob), plus
 *     the fail-safe reading of a throwing/absent `hasPending`.
 *   - the registry + its ONE set of window listeners: installed with the first
 *     participant, removed with the last, and the three triggers each doing the
 *     right thing (beforeunload additionally PROMPTS, and only when pending).
 *   - source pins for the three wirings (this repo has no jsdom, so which hook
 *     registers at which tier is asserted on the source — tests/helpers/readSource).
 *
 * The window/document stubs are installed per test and torn down after, because the
 * module only touches them inside `registerFlushParticipant` and the handlers.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readSource } from '../helpers/readSource.js';
import {
  FLUSH_TIER, anyPending, drainPending, registerFlushParticipant, currentFlushParticipants,
} from '../../src/frontend/storage/unloadFlush.js';

const P = (id, tier, pending, onFlush) => ({
  id, tier, hasPending: () => pending, flush: onFlush || (() => {}),
});

/* ── a minimal window/document pair that records its listeners ─────────────── */
function installStubEnv() {
  const win = new Map();
  const doc = new Map();
  const prevWin = globalThis.window;
  const prevDoc = globalThis.document;
  globalThis.window = {
    addEventListener: (t, f) => win.set(t, f),
    removeEventListener: (t) => win.delete(t),
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (t, f) => doc.set(t, f),
    removeEventListener: (t) => doc.delete(t),
  };
  return {
    win,
    doc,
    restore() { globalThis.window = prevWin; globalThis.document = prevDoc; },
  };
}

let env = null;
afterEach(() => { if (env) { env.restore(); env = null; } });

describe('117.md §J.19 — pure flush ordering', () => {
  it('drains the BUFFER tier before the SHELL tier, whatever order they registered in', () => {
    const seen = [];
    const list = [
      P('shell', FLUSH_TIER.SHELL, true, () => seen.push('shell')),
      P('buffer', FLUSH_TIER.BUFFER, true, () => seen.push('buffer')),
    ];
    expect(drainPending(list)).toEqual(['buffer', 'shell']);
    expect(seen).toEqual(['buffer', 'shell']);
  });

  it('re-reads hasPending as it walks — the SHELL sees the debounce the BUFFER just armed', () => {
    // This is the whole reason for the registry: a snapshot taken up front would
    // have skipped the shell, leaving the editor patch armed and lost on unload.
    let shellArmed = false;
    const seen = [];
    const list = [
      { id: 'shell', tier: FLUSH_TIER.SHELL, hasPending: () => shellArmed, flush: () => seen.push('shell') },
      { id: 'buffer', tier: FLUSH_TIER.BUFFER, hasPending: () => true, flush: () => { shellArmed = true; seen.push('buffer'); } },
    ];
    expect(drainPending(list)).toEqual(['buffer', 'shell']);
    expect(seen).toEqual(['buffer', 'shell']);
  });

  it('skips participants with nothing pending, and one throwing flush never stops the rest', () => {
    const seen = [];
    const list = [
      P('idle', FLUSH_TIER.BUFFER, false, () => seen.push('idle')),
      { id: 'boom', tier: FLUSH_TIER.BUFFER, hasPending: () => true, flush: () => { throw new Error('teardown'); } },
      P('shell', FLUSH_TIER.SHELL, true, () => seen.push('shell')),
    ];
    // The report lists what actually flushed, so 'boom' is absent — but the walk
    // continued past it, which is the property that matters on teardown.
    expect(drainPending(list)).toEqual(['shell']);
    expect(seen).toEqual(['shell']);
  });

  it('anyPending: true when any participant is pending, and fail-SAFE on absent/throwing probes', () => {
    expect(anyPending([P('a', 0, false), P('b', 1, false)])).toBe(false);
    expect(anyPending([P('a', 0, false), P('b', 1, true)])).toBe(true);
    // Over-warning is recoverable; under-warning loses data — so both degrade to true.
    expect(anyPending([{ id: 'x', tier: 0, flush: () => {} }])).toBe(true);
    expect(anyPending([{ id: 'x', tier: 0, hasPending: () => { throw new Error('nope'); }, flush: () => {} }])).toBe(true);
    expect(anyPending(null)).toBe(false);
    expect(anyPending([])).toBe(false);
  });
});

describe('117.md §J.19 — the registry and its window listeners', () => {
  it('installs the three listeners with the first participant and removes them with the last', () => {
    env = installStubEnv();
    expect(env.win.size + env.doc.size).toBe(0);

    const offA = registerFlushParticipant(P('a', FLUSH_TIER.SHELL, false));
    expect([...env.win.keys()].sort()).toEqual(['beforeunload', 'pagehide']);
    expect([...env.doc.keys()]).toEqual(['visibilitychange']);

    const offB = registerFlushParticipant(P('b', FLUSH_TIER.BUFFER, false));
    expect(currentFlushParticipants()).toHaveLength(2);

    offA();
    // Still one participant → listeners stay.
    expect(env.win.size + env.doc.size).toBe(3);
    offB();
    expect(env.win.size + env.doc.size).toBe(0);
    expect(currentFlushParticipants()).toHaveLength(0);
  });

  it('visibilitychange flushes ONLY on hidden (the tab-switch case, page still alive)', () => {
    env = installStubEnv();
    const seen = [];
    const off = registerFlushParticipant(P('doc', FLUSH_TIER.SHELL, true, () => seen.push('flush')));

    globalThis.document.visibilityState = 'visible';
    env.doc.get('visibilitychange')();
    expect(seen).toEqual([]);

    globalThis.document.visibilityState = 'hidden';
    env.doc.get('visibilitychange')();
    expect(seen).toEqual(['flush']);
    off();
  });

  it('pagehide flushes (bfcache / Safari, where beforeunload is unreliable)', () => {
    env = installStubEnv();
    const seen = [];
    const off = registerFlushParticipant(P('doc', FLUSH_TIER.SHELL, true, () => seen.push('flush')));
    env.win.get('pagehide')();
    expect(seen).toEqual(['flush']);
    off();
  });

  it('beforeunload: pending → flush AND prompt; idle → neither (no friction on a clean page)', () => {
    env = installStubEnv();
    const seen = [];
    let pending = false;
    const off = registerFlushParticipant({
      id: 'doc', tier: FLUSH_TIER.SHELL, hasPending: () => pending, flush: () => seen.push('flush'),
    });
    const handler = env.win.get('beforeunload');

    const clean = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
    handler(clean);
    expect(seen).toEqual([]);
    expect(clean.prevented).toBe(false);
    expect(clean.returnValue).toBeUndefined();

    pending = true;
    const dirty = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
    handler(dirty);
    // The write is fired FIRST, so it runs while the browser's prompt is up.
    expect(seen).toEqual(['flush']);
    expect(dirty.prevented).toBe(true);
    expect(dirty.returnValue).toBe(true); // legacy Chrome/Edge < 119 + older Firefox
    off();
  });

  it('a participant with no flush function is refused (its unregister is still safe to call)', () => {
    env = installStubEnv();
    const off = registerFlushParticipant({ id: 'bad', tier: 0 });
    expect(currentFlushParticipants()).toHaveLength(0);
    expect(env.win.size + env.doc.size).toBe(0);
    expect(() => off()).not.toThrow();
  });
});

describe('117.md §J.19 — the three wirings (source pins; this repo has no jsdom)', () => {
  it('useManuscript registers the field-patch queue at the BUFFER tier', () => {
    const src = readSource('src/features/manuscript/useManuscript.js');
    expect(src).toContain("import { useUnloadFlush, FLUSH_TIER } from '../../frontend/storage/unloadFlush.js';");
    expect(src).toContain("id: 'manuscript-edits', tier: FLUSH_TIER.BUFFER, hasPending: hasPendingEdits, flush: flushOnUnload,");
    expect(src).toContain('const hasPendingEdits = useCallback(() => pending.current != null, []);');
  });

  it('useStitchProjectDoc registers at the SHELL tier and counts in-flight PUTs as pending', () => {
    const src = readSource('src/frontend/stitch/shell/useStitchProjectDoc.js');
    expect(src).toContain("id: 'stitch-project-doc', tier: FLUSH_TIER.SHELL, hasPending: hasPendingWrite, flush,");
    expect(src).toContain('const hasPendingWrite = useCallback(() => timerRef.current != null || inFlightRef.current > 0, []);');
    // The counter is symmetric — a 409/error branch must not leak a permanent
    // "pending" that would prompt on every future navigation.
    expect(src).toContain('inFlightRef.current += 1;');
    expect(src).toContain('inFlightRef.current = Math.max(0, inFlightRef.current - 1);');
    expect(src).toContain('} finally {');
  });

  it('the legacy shell wires serverStorage’s existing pending/flush pair, unchanged', () => {
    const src = readSource('src/frontend/pages/AppWorkspace.jsx');
    expect(src).toContain("import { subscribeToSaveStatus, hasPendingSave, flushStorage } from '../storage/serverStorage.js';");
    expect(src).toContain("id: 'legacy-server-storage', tier: FLUSH_TIER.SHELL, hasPending: hasPendingSave, flush: flushStorage,");
  });

  it('no keepalive/sync-XHR transport was introduced for the blob (the 64 KB cap is a lie at scale)', () => {
    const src = readSource('src/frontend/storage/unloadFlush.js');
    expect(src).not.toContain('keepalive: true');
    expect(src).not.toContain('XMLHttpRequest');
    expect(src).not.toContain('sendBeacon');
    // …and the reason is written down where the next reader will look.
    expect(src).toContain('64 KB');
  });
});
