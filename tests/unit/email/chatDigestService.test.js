/**
 * chatDigestService.test.js — 112.md §2. The chat→digest accumulation matrix:
 * a message becomes AT MOST one ChatDigestPending row per opted-in recipient,
 * never for the sender, never for pref-off/absent/malformed blobs. Sender
 * names dedupe and cap; the preview is plain-text and hard-capped.
 *
 * prisma + clock are injected, so this file is hermetic (no DB, no HTTP).
 */
import { restoreShellEnv } from '../../screening/helpers/prismaEnvGuard.js'; // FIRST import
import { describe, it, expect, beforeEach } from 'vitest';
import { recordChatMessage, safeChatPreview, MAX_DIGEST_SENDER_NAMES } from '../../../server/services/chatDigestService.js';

restoreShellEnv();

// ── in-memory ChatDigestPending stub ────────────────────────────────────────
let rows, seq;
const fakePrisma = {
  chatDigestPending: {
    findFirst: async ({ where }) => rows.find(r => r.userId === where.userId && r.projectId === where.projectId) || null,
    create: async ({ data }) => { const row = { id: `d${++seq}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }) => {
      const row = rows.find(r => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
  },
};
beforeEach(() => { rows = []; seq = 0; });

const T0 = new Date('2026-08-10T12:00:00Z');
const T1 = new Date('2026-08-10T12:01:00Z');
const ON = JSON.stringify({ projectChat: true });
const OFF = JSON.stringify({ projectChat: false });

function msg(over = {}) {
  return {
    projectId: 'p1', senderId: 'alice', senderName: 'Alice',
    members: [
      { userId: 'alice', emailNotifications: ON },   // sender — never digested
      { userId: 'bob',   emailNotifications: ON },
      { userId: 'carol', emailNotifications: OFF },
      { userId: 'dave',  emailNotifications: null }, // absent blob = opted out
    ],
    prisma: fakePrisma, now: T0, ...over,
  };
}

describe('recordChatMessage — recipient gating', () => {
  it('creates a row only for opted-in non-senders', async () => {
    const { recorded } = await recordChatMessage(msg());
    expect(recorded).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'bob', projectId: 'p1',
      firstMessageAt: T0, lastMessageAt: T0, messageCount: 1,
      senderNamesJson: JSON.stringify(['Alice']),
    });
  });

  it('never digests the sender, even when opted in', async () => {
    await recordChatMessage(msg({ members: [{ userId: 'alice', emailNotifications: ON }] }));
    expect(rows).toHaveLength(0);
  });

  it('treats a malformed blob as opted out (strict opt-in)', async () => {
    await recordChatMessage(msg({ members: [
      { userId: 'bob', emailNotifications: '{not json' },
      { userId: 'carol', emailNotifications: JSON.stringify({ projectChat: 'yes' }) }, // non-boolean
      { userId: 'dave', emailNotifications: JSON.stringify([true]) },
    ] }));
    expect(rows).toHaveLength(0);
  });

  it('skips null userIds (pending invites) and dedupes duplicate member rows', async () => {
    const { recorded } = await recordChatMessage(msg({ members: [
      { userId: null, emailNotifications: ON },
      { userId: 'bob', emailNotifications: ON },
      { userId: 'bob', emailNotifications: ON }, // owner also a member — one row
    ] }));
    expect(recorded).toBe(1);
    expect(rows).toHaveLength(1);
  });
});

describe('recordChatMessage — accumulation', () => {
  it('a second message increments the SAME row, keeping firstMessageAt', async () => {
    await recordChatMessage(msg());
    await recordChatMessage(msg({ now: T1, senderId: 'carol', senderName: 'Carol' }));
    // Bob's row accumulates; Alice (opted in, not the sender this time) gains her own.
    const bob = rows.filter(r => r.userId === 'bob');
    expect(bob).toHaveLength(1);
    expect(bob[0]).toMatchObject({
      firstMessageAt: T0, lastMessageAt: T1, messageCount: 2,
      senderNamesJson: JSON.stringify(['Alice', 'Carol']),
    });
    expect(rows.find(r => r.userId === 'alice')).toMatchObject({ messageCount: 1, senderNamesJson: JSON.stringify(['Carol']) });
  });

  it('sender names are unique and capped', async () => {
    for (let i = 0; i < MAX_DIGEST_SENDER_NAMES + 3; i++) {
      await recordChatMessage(msg({ senderId: `s${i}`, senderName: `Sender ${i}`, now: T1 }));
      await recordChatMessage(msg({ senderId: `s${i}`, senderName: `Sender ${i}`, now: T1 })); // repeat — no dupe
    }
    const names = JSON.parse(rows[0].senderNamesJson);
    expect(names).toHaveLength(MAX_DIGEST_SENDER_NAMES);
    expect(new Set(names).size).toBe(MAX_DIGEST_SENDER_NAMES);
    expect(rows[0].messageCount).toBe((MAX_DIGEST_SENDER_NAMES + 3) * 2);
  });

  it('rows are per (user, project) — two projects, two rows', async () => {
    await recordChatMessage(msg());
    await recordChatMessage(msg({ projectId: 'p2' }));
    expect(rows.map(r => r.projectId).sort()).toEqual(['p1', 'p2']);
  });

  it('tolerates junk input without throwing', async () => {
    expect(await recordChatMessage({ projectId: null, members: [], prisma: fakePrisma })).toEqual({ recorded: 0 });
    expect(await recordChatMessage({ projectId: 'p1', senderId: 'a', members: 'nope', prisma: fakePrisma })).toEqual({ recorded: 0 });
  });
});

describe('safeChatPreview', () => {
  it('trims and collapses whitespace to one line', () => {
    expect(safeChatPreview('  hello\n\n  world\t !  ')).toBe('hello world !');
  });
  it('caps at 140 chars with a single ellipsis', () => {
    const out = safeChatPreview('x'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith('…')).toBe(true);
  });
  it('leaves short text untouched and never returns null', () => {
    expect(safeChatPreview('ok')).toBe('ok');
    expect(safeChatPreview(null)).toBe('');
    expect(safeChatPreview(undefined)).toBe('');
  });
});
