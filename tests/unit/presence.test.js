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

describe('prompt25 — display-name fallback (Task 3)', () => {
  it('prefers the real name', () => {
    P.heartbeat(PID, { id: 'u-d', name: 'Abdulmoiz', email: 'a@b.com' }, 'Overview', 1000);
    expect(P.snapshot(PID, 1000).users.find(x => x.userId === 'u-d').name).toBe('Abdulmoiz');
  });
  it('falls back to the email local-part, NOT the full email', () => {
    P.heartbeat(PID, { id: 'u-c', email: 'abdelmoezhj@gmail.com' }, 'Overview', 1000);
    expect(P.snapshot(PID, 1000).users.find(x => x.userId === 'u-c').name).toBe('abdelmoezhj');
  });
  it('falls back to the full email when there is no @, then to a generic', () => {
    P.heartbeat(PID, { id: 'u-e', email: 'plainstring' }, 'Overview', 1000);
    expect(P.snapshot(PID, 1000).users.find(x => x.userId === 'u-e').name).toBe('plainstring');
    P.heartbeat(PID, { id: 'u-f' }, 'Overview', 1000);
    expect(P.snapshot(PID, 1000).users.find(x => x.userId === 'u-f').name).toBe('A teammate');
  });
});

describe('prompt25 — global online snapshot for Ops (Tasks 1/2)', () => {
  it('lists one entry per user across all project rooms', () => {
    P.heartbeat('p1', A, 'PICO', 1000);
    P.heartbeat('p2', B, 'Screening > Import', 1000);
    const snap = P.globalOnlineSnapshot(1000);
    expect(snap.size).toBe(2);
    expect(snap.get('u-a').projectId).toBe('p1');
    expect(snap.get('u-b').location).toBe('Screening > Import');
  });

  it('keeps the MOST RECENT location for a user present in two rooms', () => {
    P.heartbeat('p1', A, 'PICO', 1000);
    P.heartbeat('p2', A, 'Screening > Duplicates', 2000); // more recent
    const e = P.globalOnlineSnapshot(2000).get('u-a');
    expect(e.location).toBe('Screening > Duplicates');
    expect(e.projectId).toBe('p2');
    expect(e.projectIds.sort()).toEqual(['p1', 'p2']);
  });

  it('globalOnlineCount excludes users past the active window', () => {
    P.heartbeat('p1', A, 'PICO', 1000);
    expect(P.globalOnlineCount(1000 + P.ACTIVE_MS - 1)).toBe(1);
    expect(P.globalOnlineCount(1000 + P.ACTIVE_MS + 1)).toBe(0);
  });

  it('global room adds dashboard-only users; a project location still wins', () => {
    P.heartbeat('p1', A, 'PICO', 1000);                 // A inside a project
    P.heartbeat(P.GLOBAL_ROOM, A, 'Dashboard', 2000);   // A also pings global (more recent)
    P.heartbeat(P.GLOBAL_ROOM, B, 'Dashboard', 1000);   // B only on the dashboard
    const snap = P.globalOnlineSnapshot(2000);
    expect(snap.size).toBe(2);
    expect(snap.get('u-a').location).toBe('PICO');       // specific project location wins
    expect(snap.get('u-b').location).toBe('Dashboard');  // dashboard-only user IS online
    expect(snap.get('u-b').projectId).toBe(null);
  });
});
