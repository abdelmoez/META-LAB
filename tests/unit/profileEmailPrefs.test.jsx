/**
 * profileEmailPrefs.test.jsx — 112.md §2 + r2. The profile half of the chat-digest
 * preference:
 *
 *   · PUT /api/profile `emailNotifications` follows the dashboardPreferences
 *     blob contract (object or JSON string; 500-char cap; null clears; non-objects
 *     400) and rides the same update alongside other fields;
 *   · r2 — the write MERGES the submitted keys into the stored blob instead of
 *     replacing it, because the one-click unsubscribe endpoint writes TEMPLATE
 *     KEYS ('chat.digest') into the same column. A wholesale replace let any
 *     profile save resurrect mail the user had unsubscribed from;
 *   · GET returns the stored blob (PROFILE_SELECT includes the column);
 *   · SSR pin: the Profile "Email notifications" card renders the project-chat
 *     toggle label, default-unchecked (opt-in for a new email class).
 *
 * Prisma is an in-memory stub; side-effecting services are mocked out.
 */
import { restoreShellEnv } from '../screening/helpers/prismaEnvGuard.js'; // FIRST import
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const db = { user: { id: 'u1', email: 'u@example.test', name: 'U', emailNotifications: null } };

vi.mock('../../server/db/client.js', () => ({
  prisma: {
    user: {
      findUnique: async () => ({ ...db.user }),
      update: async ({ data }) => { Object.assign(db.user, data); return { ...db.user }; },
    },
  },
}));
vi.mock('../../server/services/institutionService.js', () => ({
  resolveInstitutionInput: async () => ({}),
  invalidateInstitutionCandidates: () => {},
}));
vi.mock('../../server/services/emailService.js', () => ({ sendPasswordChangedNotice: async () => {} }));
vi.mock('../../server/controllers/presenceController.js', () => ({ invalidateUserName: () => {} }));
vi.mock('../../server/middleware/auth.js', () => ({ invalidateAuthState: () => {} }));

const { updateProfile, getProfile } = await import('../../server/controllers/profileController.js');

restoreShellEnv();

function call(handler, body) {
  const res = {
    code: 200, body: null,
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
  };
  return handler({ user: { id: 'u1' }, body }, res).then(() => res);
}

beforeEach(() => { db.user.emailNotifications = null; });

describe('PUT /api/profile — emailNotifications blob contract', () => {
  it('accepts an object and stores it as a JSON string', async () => {
    const res = await call(updateProfile, { emailNotifications: { projectChat: true } });
    expect(res.code).toBe(200);
    expect(db.user.emailNotifications).toBe(JSON.stringify({ projectChat: true }));
  });

  it('accepts a pre-encoded JSON string', async () => {
    const res = await call(updateProfile, { emailNotifications: '{"projectChat":false}' });
    expect(res.code).toBe(200);
    expect(db.user.emailNotifications).toBe(JSON.stringify({ projectChat: false }));
  });

  it('null clears the column', async () => {
    db.user.emailNotifications = '{"projectChat":true}';
    const res = await call(updateProfile, { emailNotifications: null });
    expect(res.code).toBe(200);
    expect(db.user.emailNotifications).toBeNull();
  });

  it('rejects invalid JSON strings, arrays and scalars with a 400', async () => {
    for (const bad of ['{oops', ['a'], 42, true, 'plain text']) {
      const res = await call(updateProfile, { emailNotifications: bad });
      expect(res.code, JSON.stringify(bad)).toBe(400);
    }
    expect(db.user.emailNotifications).toBeNull(); // nothing written
  });

  it('rejects a blob whose MERGED result exceeds the 500-char cap', async () => {
    // The cap guards what is actually STORED, so it is applied after the merge.
    const many = {};
    for (let i = 0; i < 40; i++) many[`category.number.${i}.long.enough.key`] = true;
    const res = await call(updateProfile, { emailNotifications: many });
    expect(res.code).toBe(400);
    expect(res.body.error).toContain('too large');
    expect(db.user.emailNotifications).toBeNull(); // nothing written
  });

  it('counts the EXISTING blob toward the cap — a small patch onto a full blob is rejected', async () => {
    const existing = {};
    for (let i = 0; i < 40; i++) existing[`category.number.${i}.long.enough.key`] = true;
    db.user.emailNotifications = JSON.stringify(existing);
    const res = await call(updateProfile, { emailNotifications: { projectChat: true } });
    expect(res.code).toBe(400);
    expect(db.user.emailNotifications).toBe(JSON.stringify(existing)); // untouched
  });

  it('omitting the field leaves the stored value untouched', async () => {
    db.user.emailNotifications = '{"projectChat":true}';
    const res = await call(updateProfile, { name: 'New Name' });
    expect(res.code).toBe(200);
    expect(db.user.emailNotifications).toBe('{"projectChat":true}');
  });
});

describe('PUT /api/profile — emailNotifications MERGE semantics (r2)', () => {
  it('a projectChat-only save PRESERVES a one-click unsubscribe flag', async () => {
    // What emailUnsubscribe.applyEmailPreference writes from a mail-client click.
    db.user.emailNotifications = JSON.stringify({ projectChat: true, 'chat.digest': false });
    const res = await call(updateProfile, { emailNotifications: { projectChat: true } });
    expect(res.code).toBe(200);
    const stored = JSON.parse(db.user.emailNotifications);
    expect(stored['chat.digest']).toBe(false); // survived — NOT erased by the save
    expect(stored.projectChat).toBe(true);
  });

  it('unrelated category flags survive a save that does not mention them', async () => {
    db.user.emailNotifications = JSON.stringify({ welcome: false, 'chat.digest': false });
    const res = await call(updateProfile, { emailNotifications: { projectChat: false } });
    expect(res.code).toBe(200);
    expect(JSON.parse(db.user.emailNotifications)).toEqual({
      welcome: false, 'chat.digest': false, projectChat: false,
    });
  });

  it('submitted keys OVERWRITE — re-enabling from the profile clears a prior opt-out', async () => {
    db.user.emailNotifications = JSON.stringify({ projectChat: true, 'chat.digest': false });
    // Exactly the body Profile.jsx sends when the switch is turned back ON.
    const res = await call(updateProfile, { emailNotifications: { projectChat: true, 'chat.digest': true } });
    expect(res.code).toBe(200);
    expect(JSON.parse(db.user.emailNotifications)).toEqual({ projectChat: true, 'chat.digest': true });
  });

  it('merges onto an unparseable/garbage blob instead of failing', async () => {
    db.user.emailNotifications = 'not json at all';
    const res = await call(updateProfile, { emailNotifications: { projectChat: true } });
    expect(res.code).toBe(200);
    expect(JSON.parse(db.user.emailNotifications)).toEqual({ projectChat: true });
  });

  it('drops non-boolean values — this column is a map of flags', async () => {
    db.user.emailNotifications = JSON.stringify({ 'chat.digest': false });
    const res = await call(updateProfile, { emailNotifications: { projectChat: 'yes', extra: { nested: 1 } } });
    expect(res.code).toBe(200);
    expect(JSON.parse(db.user.emailNotifications)).toEqual({ 'chat.digest': false });
  });

  it('null still clears EVERYTHING, including one-click unsubscribe flags', async () => {
    db.user.emailNotifications = JSON.stringify({ projectChat: true, 'chat.digest': false });
    const res = await call(updateProfile, { emailNotifications: null });
    expect(res.code).toBe(200);
    expect(db.user.emailNotifications).toBeNull();
  });
});

describe('GET /api/profile', () => {
  it('returns the stored emailNotifications blob', async () => {
    db.user.emailNotifications = '{"projectChat":true}';
    const res = await call(getProfile, {});
    expect(res.code).toBe(200);
    expect(res.body.user.emailNotifications).toBe('{"projectChat":true}');
  });
});

describe('Profile — Email Notifications card (SSR pin)', () => {
  it('renders the project-chat toggle, default OFF, with the always-delivered note', async () => {
    const { EmailNotificationsSection } = await import('../../src/frontend/pages/Profile.jsx');
    const html = renderToStaticMarkup(React.createElement(EmailNotificationsSection));
    expect(html).toContain('Email Notifications');
    expect(html).toContain('Email notifications for project chat');
    expect(html).not.toContain('checked'); // opt-in: unchecked before the profile loads
    expect(html).toContain('always delivered');
  });
});

describe('Profile toggle state = EFFECTIVE digest consent (r2)', () => {
  it('mirrors the server rule exactly, including the one-click opt-out key', async () => {
    const { digestConsentFromBlob } = await import('../../src/frontend/pages/Profile.jsx');
    const { chatDigestPrefEnabled } = await import('../../server/services/chatDigestPolicy.js');
    const blobs = [
      null,
      '',
      'garbage',
      '[]',
      JSON.stringify({}),
      JSON.stringify({ projectChat: true }),
      JSON.stringify({ projectChat: false }),
      JSON.stringify({ projectChat: true, 'chat.digest': false }),  // unsubscribed → OFF
      JSON.stringify({ projectChat: true, 'chat.digest': true }),
      JSON.stringify({ projectChat: false, 'chat.digest': true }),
      JSON.stringify({ 'chat.digest': false }),
      { projectChat: true, 'chat.digest': false },                   // pre-parsed object
    ];
    for (const raw of blobs) {
      expect(digestConsentFromBlob(raw), JSON.stringify(raw)).toBe(chatDigestPrefEnabled(raw));
    }
    // The specific regression: an unsubscribed user must NOT see the switch ON.
    expect(digestConsentFromBlob('{"projectChat":true,"chat.digest":false}')).toBe(false);
  });
});
