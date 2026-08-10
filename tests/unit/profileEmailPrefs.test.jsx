/**
 * profileEmailPrefs.test.jsx — 112.md §2. The profile half of the chat-digest
 * preference:
 *
 *   · PUT /api/profile `emailNotifications` follows the dashboardPreferences
 *     blob contract exactly (object or JSON string; 500-char cap; null clears;
 *     non-objects 400) and rides the same update alongside other fields;
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

  it('rejects a blob over the 500-char cap', async () => {
    const res = await call(updateProfile, { emailNotifications: { note: 'x'.repeat(500) } });
    expect(res.code).toBe(400);
    expect(res.body.error).toContain('too large');
  });

  it('omitting the field leaves the stored value untouched', async () => {
    db.user.emailNotifications = '{"projectChat":true}';
    const res = await call(updateProfile, { name: 'New Name' });
    expect(res.code).toBe(200);
    expect(db.user.emailNotifications).toBe('{"projectChat":true}');
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
