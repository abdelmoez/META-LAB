/**
 * restrict-chat.spec.ts — end-to-end lifecycle of the "Restrict chat" project
 * control (81.md), driven through the real HTTP contract with TWO fresh users
 * (owner + a regular reviewer member) the way the SPA's launchers do.
 *
 * This is the request-level e2e (like api.spec.ts): a browser page cannot prove
 * a SECOND user is blocked server-side, and the composer's read-only state + the
 * server 403 are what actually enforce the restriction. The pure launcher/drawer
 * decision is unit-tested (stitchChatLauncher / chatPolicy specs); the server gate
 * across both doors is integration-tested (prompt7-chat). Here we prove the whole
 * loop: enable → member blocked (incl. direct API) → state persists on refetch →
 * leader still posts → disable → member restored.
 *
 * Maps to the 81.md e2e outline:
 *   owner opens control → enables Restrict chat → member cannot send (UI + direct
 *   backend 403) → refetch keeps the restricted state → owner disables → member
 *   can send again.
 */
import { test, expect } from '../fixtures/stitch-test';
import { request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { BASE_URL } from '../helpers/env';

const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** A fresh, cookie-isolated context logged in as a brand-new user. */
async function freshUser(prefix: string): Promise<{ ctx: APIRequestContext; email: string; id: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const email = `${prefix}_${uniq()}@e2e.local`;
  const res = await ctx.post('/api/auth/register', { data: { email, password: 'Password123!', name: prefix } });
  expect(res.ok(), `register ${prefix} (${res.status()})`).toBeTruthy();
  const body = await res.json();
  return { ctx, email, id: body?.user?.id };
}

test.describe('@smoke Restrict chat — full lifecycle (owner + reviewer)', () => {
  test('enable blocks the member (UI read-only + direct API 403), persists on refetch, leader still posts, disable restores', async () => {
    const owner = await freshUser('rc_owner');
    const member = await freshUser('rc_member');
    let mlId = ''; let spid = '';
    try {
      // Owner builds the linked pair (META·LAB project + linked Review Workspace).
      const ml = await owner.ctx.post('/api/projects', { data: { name: `RestrictChat ${uniq()}` } });
      expect(ml.ok()).toBeTruthy();
      mlId = (await ml.json()).id;
      const sp = await owner.ctx.post('/api/screening/projects', { data: { title: `RestrictChat`, linkedMetaLabProjectId: mlId } });
      expect(sp.ok()).toBeTruthy();
      spid = (await sp.json()).id;

      // Owner adds the member as a normal reviewer (canChat=true by default — the
      // exact case the old flag failed to restrict).
      const add = await owner.ctx.post(`/api/screening/projects/${spid}/members`, { data: { email: member.email, preset: 'reviewer' } });
      expect(add.status(), 'add reviewer').toBe(201);
      expect((await add.json()).member.canChat).toBe(true);

      // Baseline: OPEN chat — the member can post, server says canPost=true.
      const open1 = await member.ctx.post(`/api/screening/metalab/${mlId}/chat`, { data: { message: `hello ${uniq()}` } });
      expect(open1.status(), 'member can post when open').toBe(201);
      const base = await member.ctx.get(`/api/screening/metalab/${mlId}/chat`);
      expect((await base.json()).canPost).toBe(true);

      // Owner ENABLES Restrict chat (the Project Control toggle → PUT).
      const on = await owner.ctx.put(`/api/screening/projects/${spid}`, { data: { chatRestricted: true } });
      expect(on.status()).toBe(200);
      expect((await on.json()).chatRestricted).toBe(true);          // persisted + echoed

      // Member is now blocked SERVER-SIDE on a direct API send (cannot bypass the UI).
      const denied = await member.ctx.post(`/api/screening/metalab/${mlId}/chat`, { data: { message: `should fail ${uniq()}` } });
      expect(denied.status(), 'restricted member direct send rejected').toBe(403);
      // Typing is a chat write too → also blocked.
      expect((await member.ctx.post(`/api/screening/metalab/${mlId}/chat/typing`)).status()).toBe(403);

      // Refetch keeps the restricted state — the composer flips to read-only off this.
      const afterRestrict = await member.ctx.get(`/api/screening/metalab/${mlId}/chat`);
      const arBody = await afterRestrict.json();
      expect(arBody.chatRestricted).toBe(true);
      expect(arBody.canChat).toBe(true);        // per-member permission unchanged…
      expect(arBody.canPost).toBe(false);       // …but the project lock makes it read-only
      // The blocked message did NOT land.
      expect((arBody.messages || []).some((m: { message: string }) => String(m.message).startsWith('should fail'))).toBe(false);

      // The leader (owner) is never blocked by the project lock.
      expect((await owner.ctx.post(`/api/screening/metalab/${mlId}/chat`, { data: { message: `leader ok ${uniq()}` } })).status()).toBe(201);

      // Owner DISABLES Restrict chat → the member can post again (no per-member change).
      const off = await owner.ctx.put(`/api/screening/projects/${spid}`, { data: { chatRestricted: false } });
      expect(off.status()).toBe(200);
      expect((await off.json()).chatRestricted).toBe(false);
      const restored = await member.ctx.post(`/api/screening/metalab/${mlId}/chat`, { data: { message: `open again ${uniq()}` } });
      expect(restored.status(), 'member restored after disable').toBe(201);
    } finally {
      if (spid) await owner.ctx.delete(`/api/screening/projects/${spid}`).catch(() => {});
      if (mlId) await owner.ctx.delete(`/api/projects/${mlId}`).catch(() => {});
      await owner.ctx.dispose();
      await member.ctx.dispose();
    }
  });
});
