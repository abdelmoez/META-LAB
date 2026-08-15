/**
 * 117.md §13 / §J.10 / §K.6 — same-user, cross-WINDOW pokes.
 *
 * The SSE bus deliberately excludes the ACTING user from decision / finalize /
 * import events, so a researcher screening in one window with the manuscript open in
 * another saw nothing until the manuscript's 20s visibility throttle fired — and a
 * side-by-side window never hides, so it could wait indefinitely (§J.10).
 *
 * A BroadcastChannel is the missing edge: same origin, same browser profile, no
 * server. It carries the SAME thin poke the SSE bus carries — `{projectId, kind}`,
 * ids only — so the listener still refetches through the authorized endpoints.
 *
 * What this file pins: the pure matching rules, the "unsupported browser is a no-op"
 * degrade, and the two wiring seams (published after a screening write RESOLVES;
 * subscribed by the manuscript on the SAME debounced refetch as the SSE pokes).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PROJECT_BROADCAST_CHANNEL, PROJECT_BROADCAST_KINDS,
  projectBroadcastSupported, projectPoke, matchesProjectPoke,
  publishProjectPoke, subscribeProjectPokes,
} from '../../../src/frontend/hooks/projectBroadcast.js';
import { readSource } from '../../helpers/readSource.js';

/* A minimal same-tab BroadcastChannel: every instance receives every OTHER
   instance's messages, which is exactly the two-window shape under test. */
const live = new Set();
class FakeChannel {
  constructor(name) { this.name = name; this.onmessage = null; this.closed = false; live.add(this); }
  postMessage(data) {
    for (const ch of live) {
      if (ch === this || ch.closed || ch.name !== this.name) continue;
      if (typeof ch.onmessage === 'function') ch.onmessage({ data });
    }
  }
  close() { this.closed = true; live.delete(this); }
}

describe('117.md §K.6 — the poke shape is ids only', () => {
  it('names the channel and the four kinds it carries', () => {
    expect(PROJECT_BROADCAST_CHANNEL).toBe('metalab.project');
    expect(PROJECT_BROADCAST_KINDS).toEqual({
      DECISION: 'decision.saved',
      HANDOFF: 'handoff.updated',
      RECORD: 'record.updated',
      IMPORT: 'import.completed',
    });
  });

  it('a poke is a trimmed { projectId, kind } and nothing else', () => {
    expect(projectPoke(' sift-1 ', ' decision.saved ')).toEqual({ projectId: 'sift-1', kind: 'decision.saved' });
  });

  it('a poke nobody could match is not built at all', () => {
    expect(projectPoke('', 'decision.saved')).toBeNull();
    expect(projectPoke('sift-1', '')).toBeNull();
    expect(projectPoke(null, null)).toBeNull();
  });

  it('a listener reacts to ITS project only, and never throws on rubbish', () => {
    const poke = { projectId: 'sift-1', kind: 'decision.saved' };
    expect(matchesProjectPoke(poke, 'sift-1')).toBe(true);
    expect(matchesProjectPoke(poke, 'sift-2')).toBe(false);
    expect(matchesProjectPoke({ projectId: 'sift-1' }, 'sift-1')).toBe(false);   // no kind
    expect(matchesProjectPoke(null, 'sift-1')).toBe(false);
    expect(matchesProjectPoke('nonsense', 'sift-1')).toBe(false);
    expect(matchesProjectPoke(poke, '')).toBe(false);
  });
});

describe('117.md §K.6 — a browser without BroadcastChannel is a clean no-op', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'BroadcastChannel');
  const prev = globalThis.BroadcastChannel;
  beforeEach(() => { delete globalThis.BroadcastChannel; });
  afterEach(() => { if (had) globalThis.BroadcastChannel = prev; else delete globalThis.BroadcastChannel; });

  it('reports unsupported, publishes nothing and returns a working unsubscribe', () => {
    expect(projectBroadcastSupported()).toBe(false);
    expect(publishProjectPoke('sift-1', 'decision.saved')).toBe(false);
    const off = subscribeProjectPokes('sift-1', () => { throw new Error('must not fire'); });
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});

describe('117.md §K.6 — a poke reaches the OTHER window', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'BroadcastChannel');
  const prev = globalThis.BroadcastChannel;
  beforeEach(() => { live.clear(); globalThis.BroadcastChannel = FakeChannel; });
  afterEach(() => { live.clear(); if (had) globalThis.BroadcastChannel = prev; else delete globalThis.BroadcastChannel; });

  /** The OTHER window: its own channel object, exactly as a second tab would have. */
  const otherWindowPublishes = (projectId, kind) => {
    const ch = new FakeChannel(PROJECT_BROADCAST_CHANNEL);
    ch.postMessage({ projectId, kind });
    ch.close();
  };

  it('delivers a matching poke to a subscriber and nothing to a mismatched one', () => {
    const mine = [];
    const other = [];
    const offA = subscribeProjectPokes('sift-1', (p) => mine.push(p));
    const offB = subscribeProjectPokes('sift-2', (p) => other.push(p));
    otherWindowPublishes('sift-1', PROJECT_BROADCAST_KINDS.DECISION);
    expect(mine).toEqual([{ projectId: 'sift-1', kind: 'decision.saved' }]);
    expect(other).toEqual([]);
    offA(); offB();
  });

  it('publishing reports success once a channel exists', () => {
    expect(publishProjectPoke('sift-1', PROJECT_BROADCAST_KINDS.DECISION)).toBe(true);
    // …but a poke a listener could never match is still refused.
    expect(publishProjectPoke('', PROJECT_BROADCAST_KINDS.DECISION)).toBe(false);
  });

  it('a window never receives its OWN poke (that surface already reflects the write)', () => {
    const got = [];
    const off = subscribeProjectPokes('sift-1', (p) => got.push(p));
    publishProjectPoke('sift-1', PROJECT_BROADCAST_KINDS.DECISION);
    expect(got).toEqual([]);
    off();
  });

  it('unsubscribing stops delivery (and closing twice is harmless)', () => {
    const got = [];
    const off = subscribeProjectPokes('sift-1', (p) => got.push(p));
    off(); off();
    otherWindowPublishes('sift-1', PROJECT_BROADCAST_KINDS.HANDOFF);
    expect(got).toEqual([]);
  });

  it('one subscriber throwing does not silence the others', () => {
    const got = [];
    const offA = subscribeProjectPokes('sift-1', () => { throw new Error('subscriber bug'); });
    const offB = subscribeProjectPokes('sift-1', (p) => got.push(p.kind));
    expect(() => otherWindowPublishes('sift-1', PROJECT_BROADCAST_KINDS.IMPORT)).not.toThrow();
    expect(got).toEqual(['import.completed']);
    offA(); offB();
  });
});

/* ════════════ the wiring (source pins) ════════════ */

describe('117.md §K.6 — published on success, subscribed on the same debounce', () => {
  const api = readSource(new URL('../../../src/frontend/screening/api-client/screeningApi.js', import.meta.url));
  const hook = readSource(new URL('../../../src/features/manuscript/useManuscript.js', import.meta.url));

  it('pokes are attached AFTER the write resolves, never before it is issued', () => {
    expect(api).toContain('const poke = (pid, kind) => (result) => { publishProjectPoke(pid, kind); return result; };');
    expect(api).toContain(".then(poke(pid, PROJECT_BROADCAST_KINDS.DECISION))");
    expect(api).toContain(".then(poke(pid, PROJECT_BROADCAST_KINDS.HANDOFF))");
    expect(api).toContain(".then(poke(pid, PROJECT_BROADCAST_KINDS.IMPORT))");
  });

  it('covers decision, conflict resolution, finalize, revert and import', () => {
    for (const fn of ['saveDecision:', 'resolveConflict:', 'finalizeRecord:', 'revertFinalReview:', 'importRecords:']) {
      const at = api.indexOf(fn);
      expect(at, fn).toBeGreaterThan(-1);
      expect(api.slice(at, at + 400), fn).toContain('poke(pid, PROJECT_BROADCAST_KINDS');
    }
  });

  it('an ASYNC import pokes when the job reaches a terminal state, not when it starts', () => {
    expect(api).toContain("if (status === 'completed' || status === 'completed_with_warnings') {");
  });

  it('the manuscript subscribes with the screening project id and reuses the SSE handler', () => {
    expect(hook).toContain("import { subscribeProjectPokes } from '../../frontend/hooks/projectBroadcast.js';");
    expect(hook).toContain('return subscribeProjectPokes(screenPid, (poke) => onPrismaPoke(poke));');
  });
});
