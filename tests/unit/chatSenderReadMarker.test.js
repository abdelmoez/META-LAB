/**
 * chatSenderReadMarker.test.js — r2. POSTING A MESSAGE MARKS THE SENDER READ.
 *
 * ScreenChatRead.lastReadAt had exactly one writer (markReadCore, called when the
 * chat drawer OPENS). A member who opened the chat once and then conversed for an
 * hour therefore kept the marker they had at open time: getUnreadCount counted
 * every teammate reply as unread, and the digest sweep — which suppresses on that
 * same marker — mailed them a summary of the conversation they were having.
 *
 * postMessageCore now upserts the sender's marker after the message is created.
 * Covered here with an injected prisma-shaped stub (no database, no Prisma):
 *   · the upsert targets the projectId_userId composite with the SENDER's id;
 *   · lastReadAt is the new message's own timestamp (never later — a message
 *     that lands between the write and "now" must stay unread);
 *   · it is best-effort: a rejecting upsert still returns 201.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const MSG_AT = new Date('2026-08-09T10:00:00.000Z');

const calls = { readUpsert: [], created: [] };
let upsertBehaviour = () => Promise.resolve({});

vi.mock('../../server/db/client.js', () => ({
  prisma: {
    screenChatMessage: {
      create: async ({ data }) => {
        const row = { id: 'm1', createdAt: MSG_AT, ...data };
        calls.created.push(row);
        return row;
      },
    },
    screenChatRead: {
      upsert: (args) => { calls.readUpsert.push(args); return upsertBehaviour(); },
    },
    screenProjectMember: { findMany: async () => [] },
    screenProject: { findUnique: async () => ({ owner: null }) },
  },
}));

const access = {
  active: true, isOwner: true, isLeader: true, canChat: true,
  member: { name: 'Ada' },
  project: { id: 'p1', chatRestricted: false, linkedMetaLabProjectId: null },
};

vi.mock('../../server/screening/access.js', () => ({ getProjectAccess: async () => access }));
vi.mock('../../server/screening/chatScope.js', () => ({ resolveMetaLabChatScope: async () => ({ access }) }));
vi.mock('../../server/screening/settings.js', () => ({ getMetaSiftSettings: async () => ({ allowChat: true }) }));
vi.mock('../../server/realtime/bus.js', () => ({ emitToProjectMembers: () => {} }));
vi.mock('../../server/services/chatDigestService.js', () => ({ recordChatMessage: async () => {} }));

const { postMessage } = await import('../../server/controllers/screeningChatController.js');

function post(userId = 'u1', message = 'hello') {
  const res = {
    code: 200, body: null,
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
  };
  return postMessage({ user: { id: userId }, params: { pid: 'p1' }, body: { message } }, res).then(() => res);
}

beforeEach(() => {
  calls.readUpsert.length = 0; calls.created.length = 0;
  upsertBehaviour = () => Promise.resolve({});
});

describe('postMessageCore — sender read-marker (r2)', () => {
  it('upserts the SENDER\'s ScreenChatRead on the projectId_userId composite', async () => {
    const res = await post('u1');
    expect(res.code).toBe(201);
    expect(calls.readUpsert).toHaveLength(1);
    const args = calls.readUpsert[0];
    expect(args.where).toEqual({ projectId_userId: { projectId: 'p1', userId: 'u1' } });
    expect(args.create).toEqual({ projectId: 'p1', userId: 'u1', lastReadAt: MSG_AT });
    expect(args.update).toEqual({ lastReadAt: MSG_AT });
  });

  it('stamps the marker with the message timestamp, not a later clock read', async () => {
    // Anything created AFTER this message must still count as unread, so the
    // marker may never run ahead of the message it was proved by.
    await post('u1');
    const at = calls.readUpsert[0].update.lastReadAt;
    expect(at).toBe(calls.created[0].createdAt);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('is best-effort — a failing read-marker still returns the 201 and the message', async () => {
    upsertBehaviour = () => Promise.reject(new Error('db down'));
    const res = await post('u1', 'still delivered');
    expect(res.code).toBe(201);
    expect(res.body.message.message).toBe('still delivered');
  });

  it('does not write a marker when the post is rejected', async () => {
    const res = await post('u1', '   ');   // sanitizes to empty → 400
    expect(res.code).toBe(400);
    expect(calls.readUpsert).toHaveLength(0);
  });
});
