/**
 * presence.test.js (prompt23 Tasks 5/13/14/15) — the in-memory presence + field
 * lock manager. Pure logic with an injected clock; this is the regression guard
 * for "locks don't trap a field" (TTL expiry) and "two users can't hold the same
 * field".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as P from '../../server/realtime/presence.js';

const A = { id: 'u-a', name: 'Abdulmoiz' };
const B = { id: 'u-b', name: 'Omar' };
const PID = 'proj-1';

beforeEach(() => P._reset());

describe('presence heartbeat + snapshot', () => {
  it('tracks active users and their location', () => {
    P.heartbeat(PID, A, 'Screening · Title & Abstract', 1000);
    P.heartbeat(PID, B, 'PICO', 1000);
    const snap = P.snapshot(PID, 1000);
    expect(snap.users).toHaveLength(2);
    const a = snap.users.find(u => u.userId === 'u-a');
    expect(a.location).toBe('Screening · Title & Abstract');
  });

  it('flags changed only on join / location change, not idle re-beats', () => {
    expect(P.heartbeat(PID, A, 'Overview', 1000).changed).toBe(true);   // join
    expect(P.heartbeat(PID, A, 'Overview', 2000).changed).toBe(false);  // idle
    expect(P.heartbeat(PID, A, 'Duplicates', 3000).changed).toBe(true); // moved
  });

  it('expires a user after the active window (no perpetual presence)', () => {
    P.heartbeat(PID, A, 'Overview', 1000);
    expect(P.snapshot(PID, 1000 + P.ACTIVE_MS - 1).users).toHaveLength(1);
    expect(P.snapshot(PID, 1000 + P.ACTIVE_MS + 1).users).toHaveLength(0);
  });

  it('leave() removes the user and releases their locks', () => {
    P.heartbeat(PID, A, 'Settings', 1000);
    P.acquireLock(PID, A, 'settings.requiredReviewers', 'Settings', 1000);
    P.leave(PID, 'u-a', 1100);
    const snap = P.snapshot(PID, 1100);
    expect(snap.users).toHaveLength(0);
    expect(snap.locks).toHaveLength(0);
  });
});

describe('field locking', () => {
  it('grants a free field and blocks a second user', () => {
    expect(P.acquireLock(PID, A, 'pico.C', 'PICO', 1000).ok).toBe(true);
    const second = P.acquireLock(PID, B, 'pico.C', 'PICO', 1000);
    expect(second.ok).toBe(false);
    expect(second.lock.userId).toBe('u-a');
    expect(second.lock.name).toBe('Abdulmoiz');
  });

  it('is idempotent for the same holder and lets only the holder release', () => {
    P.acquireLock(PID, A, 'pico.C', 'PICO', 1000);
    expect(P.acquireLock(PID, A, 'pico.C', 'PICO', 2000).ok).toBe(true); // re-acquire OK
    expect(P.releaseLock(PID, 'u-b', 'pico.C', 2100).changed).toBe(false); // not the holder
    expect(P.snapshot(PID, 2100).locks).toHaveLength(1);
    expect(P.releaseLock(PID, 'u-a', 'pico.C', 2200).changed).toBe(true);  // holder releases
    expect(P.snapshot(PID, 2200).locks).toHaveLength(0);
  });

  it('auto-expires a lock so a field is never permanently trapped', () => {
    P.acquireLock(PID, A, 'pico.C', 'PICO', 1000);
    // A vanishes (no heartbeat). After the TTL the field is free for B.
    const t = 1000 + P.LOCK_TTL_MS + 1;
    const snap = P.snapshot(PID, t);
    expect(snap.locks).toHaveLength(0);
    expect(P.acquireLock(PID, B, 'pico.C', 'PICO', t).ok).toBe(true);
  });

  it('a heartbeat keeps the holder’s lock alive', () => {
    P.acquireLock(PID, A, 'pico.C', 'PICO', 1000);
    P.heartbeat(PID, A, 'PICO', 1000 + P.LOCK_TTL_MS - 1000); // refreshes lock
    const later = 1000 + P.LOCK_TTL_MS + 500; // would have expired w/o the beat
    expect(P.snapshot(PID, later).locks).toHaveLength(1);
  });
});
