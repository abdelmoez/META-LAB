/**
 * prompt7-chat.test.js — shared project chat via the META·LAB door (prompt7 Task 11).
 *
 * The chat thread is keyed by ScreenProject.id; a linked pair (META·LAB Project
 * + ScreenProject via linkedMetaLabProjectId) shares ONE thread reachable
 * through two route families:
 *   /api/screening/projects/:pid/chat*    (META·SIFT door)
 *   /api/screening/metalab/:mlpid/chat*   (META·LAB door, prompt7)
 *
 * Covered:
 *   - shared thread both directions (post via one door, read via the other)
 *   - unread-count via the metalab door + POST /chat/read clears it
 *   - existence-hiding: non-member 404, standalone (unlinked) ML project 404
 *   - chatRestricted: member without canChat → 403 post via metalab door
 *   - DELETE own message via the metalab door → 204 + gone from both doors
 *   - SSE poke carries projectId AND metaLabProjectId (poke-only, no content)
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res), headers: res.headers };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id, email }; }
async function loginAs(email, password = 'Password123!') { const r = await api('/auth/login', { method: 'POST', body: { email, password } }); return r.status === 200 ? r.cookie : ''; }

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Poll an async predicate until truthy (fire-and-forget server writes need this). */
async function until(fn, timeoutMs = 5000, step = 200) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 >= timeoutMs) return false;
    await sleep(step);
  }
}

/** Open the SSE stream with a raw fetch reader; collect comment + data frames. */
async function openStream(cookie) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/events`, { headers: { Cookie: cookie }, signal: ac.signal });
  const comments = []; const events = [];
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  if (status === 200 && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            for (const line of frame.split('\n')) {
              if (line.startsWith(':')) comments.push(line);
              else if (line.startsWith('data: ')) { try { events.push(JSON.parse(line.slice(6))); } catch {} }
            }
          }
        }
      } catch { /* aborted */ }
    })();
  }
  return { ac, status, contentType, comments, events };
}

/** Owner + META·LAB project + linked ScreenProject (the "Review Workspace" pair). */
async function setupPair(prefix) {
  const r = rnd();
  const owner = await register(`${prefix}_o${r}@t.local`);
  const ml = await api('/projects', { method: 'POST', cookie: owner.cookie, body: { name: `Chat ${prefix} ${r}` } });
  const mlId = ml.data.id;
  const sp = await api('/screening/projects', { method: 'POST', cookie: owner.cookie, body: { title: `Chat ${prefix} ${r}`, linkedMetaLabProjectId: mlId } });
  const spid = sp.data.id;
  return { r, owner, mlId, spid };
}

async function cleanupPair(owner, spid, mlId) {
  await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: owner.cookie });
  await api(`/projects/${mlId}`, { method: 'DELETE', cookie: owner.cookie });
}

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    const r = await api('/auth/login', { method: 'POST', body: { email: 'admin@metalab.local', password: process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!' } });
    adminCookie = r.status === 200 ? r.cookie : '';
  }
}, 30000);

describe('prompt7 T11 — shared chat via the META·LAB door (/screening/metalab/:mlpid/chat*)', () => {

  it('shared thread: owner posts via /projects door → member reads via /metalab door; member posts via /metalab → owner reads via /projects', async () => {
    if (!up) return;
    const { r, owner, mlId, spid } = await setupPair('p7c_a');
    const m = await register(`p7c_a_m${r}@t.local`);
    const add = await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: m.email, preset: 'reviewer' } });
    expect(add.status).toBe(201);

    // Owner → SIFT door.
    const post1 = await api(`/screening/projects/${spid}/chat`, { method: 'POST', cookie: owner.cookie, body: { message: `from sift door ${r}` } });
    expect(post1.status).toBe(201);
    expect(post1.data.message.isMe).toBe(true);

    // Member ← META·LAB door (same thread, same response shape as the SIFT list).
    const list1 = await api(`/screening/metalab/${mlId}/chat`, { cookie: m.cookie });
    expect(list1.status).toBe(200);
    expect(typeof list1.data.canChat).toBe('boolean');
    expect(typeof list1.data.chatRestricted).toBe('boolean');
    expect(list1.data.serverTime).toBeTruthy();
    expect(Array.isArray(list1.data.typing)).toBe(true);
    const seen1 = list1.data.messages.find(x => x.message === `from sift door ${r}`);
    expect(seen1).toBeTruthy();
    expect(seen1.isMe).toBe(false);
    expect(seen1.senderId).toBe(owner.id);

    // Member → META·LAB door.
    const post2 = await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: m.cookie, body: { message: `from metalab door ${r}` } });
    expect(post2.status).toBe(201);
    expect(post2.data.message.isMe).toBe(true);
    expect(post2.data.message.status).toBe('sent');

    // Owner ← SIFT door: sees the member's message in the SAME thread.
    const list2 = await api(`/screening/projects/${spid}/chat`, { cookie: owner.cookie });
    expect(list2.status).toBe(200);
    const seen2 = list2.data.messages.find(x => x.message === `from metalab door ${r}`);
    expect(seen2).toBeTruthy();
    expect(seen2.isMe).toBe(false);
    expect(seen2.senderId).toBe(m.id);

    // ?since cursor works on the metalab door too: nothing newer than serverTime.
    const since = await api(`/screening/metalab/${mlId}/chat?since=${encodeURIComponent(list1.data.serverTime)}`, { cookie: m.cookie });
    expect(since.status).toBe(200);
    expect(since.data.messages.find(x => x.message === `from sift door ${r}`)).toBeFalsy();

    await cleanupPair(owner, spid, mlId);
  });

  it('unread-count via the metalab door increments for the member; POST /metalab/:mlpid/chat/read clears it; own messages never count', async () => {
    if (!up) return;
    const { r, owner, mlId, spid } = await setupPair('p7c_u');
    const m = await register(`p7c_u_m${r}@t.local`);
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: m.email, preset: 'reviewer' } });

    // Fresh thread → 0 unread.
    const u0 = await api(`/screening/metalab/${mlId}/chat/unread-count`, { cookie: m.cookie });
    expect(u0.status).toBe(200);
    expect(u0.data.unread).toBe(0);

    // Owner posts two via the SIFT door → member's metalab unread = 2.
    expect((await api(`/screening/projects/${spid}/chat`, { method: 'POST', cookie: owner.cookie, body: { message: `unread one ${r}` } })).status).toBe(201);
    expect((await api(`/screening/projects/${spid}/chat`, { method: 'POST', cookie: owner.cookie, body: { message: `unread two ${r}` } })).status).toBe(201);
    const u1 = await api(`/screening/metalab/${mlId}/chat/unread-count`, { cookie: m.cookie });
    expect(u1.data.unread).toBe(2);

    // Mark read via the metalab door → 0 (server-authoritative ScreenChatRead).
    const read = await api(`/screening/metalab/${mlId}/chat/read`, { method: 'POST', cookie: m.cookie });
    expect(read.status).toBe(200);
    expect(read.data.unread).toBe(0);
    expect((await api(`/screening/metalab/${mlId}/chat/unread-count`, { cookie: m.cookie })).data.unread).toBe(0);

    // Read state is shared with the SIFT door (one thread, one lastReadAt).
    expect((await api(`/screening/projects/${spid}/chat/unread-count`, { cookie: m.cookie })).data.unread).toBe(0);

    // Own messages never count as unread for the sender.
    expect((await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: m.cookie, body: { message: `mine ${r}` } })).status).toBe(201);
    expect((await api(`/screening/metalab/${mlId}/chat/unread-count`, { cookie: m.cookie })).data.unread).toBe(0);
    // ...but it DOES count for the owner.
    expect((await api(`/screening/metalab/${mlId}/chat/unread-count`, { cookie: owner.cookie })).data.unread).toBe(1);

    await cleanupPair(owner, spid, mlId);
  });

  it('existence-hiding: non-member → 404 on every metalab chat route; standalone META·LAB project (no linked workspace) → 404; nonexistent id → 404', async () => {
    if (!up) return;
    const { r, owner, mlId, spid } = await setupPair('p7c_x');
    // NOTE: must not collide with setupPair's owner email (`p7c_x_o${r}@…`).
    const out = await register(`p7c_x_outsider${r}@t.local`);

    // Non-member: all six metalab chat routes hide existence with 404.
    const g1 = await api(`/screening/metalab/${mlId}/chat`, { cookie: out.cookie });
    expect(g1.status).toBe(404);
    expect(g1.data.error).toBe('Project not found');
    expect((await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: out.cookie, body: { message: 'nope' } })).status).toBe(404);
    expect((await api(`/screening/metalab/${mlId}/chat/unread-count`, { cookie: out.cookie })).status).toBe(404);
    expect((await api(`/screening/metalab/${mlId}/chat/read`, { method: 'POST', cookie: out.cookie })).status).toBe(404);
    expect((await api(`/screening/metalab/${mlId}/chat/typing`, { method: 'POST', cookie: out.cookie })).status).toBe(404);
    expect((await api(`/screening/metalab/${mlId}/chat/someid`, { method: 'DELETE', cookie: out.cookie })).status).toBe(404);

    // Standalone META·LAB project: even its OWNER gets 404 (chat lives on the
    // linked workspace; no link → no thread → existence-hiding 404).
    const standalone = await api('/projects', { method: 'POST', cookie: owner.cookie, body: { name: `Standalone ${r}` } });
    const sId = standalone.data.id;
    const s1 = await api(`/screening/metalab/${sId}/chat`, { cookie: owner.cookie });
    expect(s1.status).toBe(404);
    expect(s1.data.error).toBe('Project not found');
    expect((await api(`/screening/metalab/${sId}/chat`, { method: 'POST', cookie: owner.cookie, body: { message: 'solo' } })).status).toBe(404);

    // Nonexistent META·LAB project id → 404.
    expect((await api('/screening/metalab/nonexistent000/chat', { cookie: owner.cookie })).status).toBe(404);

    await api(`/projects/${sId}`, { method: 'DELETE', cookie: owner.cookie });
    await cleanupPair(owner, spid, mlId);
  });

  it('canChat=false → read-only on EVERY write route regardless of chatRestricted; re-enabling restores posting [prompt50 WS6]', async () => {
    if (!up) return;
    const { r, owner, mlId, spid } = await setupPair('p7c_r');
    // 'readonly_both' is the viewer-ROLE preset WITHOUT canChat (permissionPresets.js).
    const v = await register(`p7c_r_v${r}@t.local`);
    const add = await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: v.email, preset: 'readonly_both' } });
    expect(add.status).toBe(201);
    const mid = add.data.member.id;
    expect(add.data.member.canChat).toBe(false);

    // prompt50 WS6 — the reported bug: a member denied chat must be read-only
    // IMMEDIATELY, even though the project-wide chatRestricted flag is still OFF.
    expect((await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: v.cookie, body: { message: `blocked early ${r}` } })).status).toBe(403);
    expect((await api(`/screening/projects/${spid}/chat`, { method: 'POST', cookie: v.cookie, body: { message: `blocked early sift ${r}` } })).status).toBe(403);
    // Typing + delete are chat writes too — also blocked for a read-only member.
    expect((await api(`/screening/projects/${spid}/chat/typing`, { method: 'POST', cookie: v.cookie })).status).toBe(403);

    // Turning the project-wide flag ON does not change the per-member outcome.
    const restrict = await api(`/screening/projects/${spid}`, { method: 'PUT', cookie: owner.cookie, body: { chatRestricted: true } });
    expect(restrict.status).toBe(200);
    const denied = await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: v.cookie, body: { message: `blocked ${r}` } });
    expect(denied.status).toBe(403);
    expect(String(denied.data.error)).toMatch(/permission/i);

    // Reading is never restricted; canChat travels in the response so the UI can
    // flip to read-only without a reload.
    const list = await api(`/screening/metalab/${mlId}/chat`, { cookie: v.cookie });
    expect(list.status).toBe(200);
    expect(list.data.canChat).toBe(false);
    expect(list.data.messages.find(x => String(x.message).startsWith('blocked'))).toBeFalsy();

    // Owner (leader) is never blocked.
    expect((await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: owner.cookie, body: { message: `leader ok ${r}` } })).status).toBe(201);

    // Scenario 7 step 7–8: re-enabling canChat restores the member's ability to post.
    const reEnable = await api(`/screening/projects/${spid}/members/${mid}`, { method: 'PATCH', cookie: owner.cookie, body: { canChat: true } });
    expect(reEnable.status).toBe(200);
    expect(reEnable.data.member.canChat).toBe(true);
    expect((await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: v.cookie, body: { message: `now allowed ${r}` } })).status).toBe(201);

    await cleanupPair(owner, spid, mlId);
  });

  it('DELETE own message via the metalab door → 204; message gone from BOTH doors (soft delete); non-sender member cannot delete (403)', async () => {
    if (!up) return;
    const { r, owner, mlId, spid } = await setupPair('p7c_d');
    const m = await register(`p7c_d_m${r}@t.local`);
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: m.email, preset: 'reviewer' } });

    const post = await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: m.cookie, body: { message: `delete me ${r}` } });
    expect(post.status).toBe(201);
    const mid = post.data.message.id;

    // A non-sender, non-leader member cannot delete someone else's message.
    const ownerMsg = await api(`/screening/projects/${spid}/chat`, { method: 'POST', cookie: owner.cookie, body: { message: `owner msg ${r}` } });
    expect((await api(`/screening/metalab/${mlId}/chat/${ownerMsg.data.message.id}`, { method: 'DELETE', cookie: m.cookie })).status).toBe(403);

    // Sender deletes their own message via the metalab door.
    const del = await api(`/screening/metalab/${mlId}/chat/${mid}`, { method: 'DELETE', cookie: m.cookie });
    expect(del.status).toBe(204);

    // Gone from both doors (soft delete filters deletedAt on every list).
    const viaMl = await api(`/screening/metalab/${mlId}/chat`, { cookie: m.cookie });
    expect(viaMl.data.messages.find(x => x.id === mid)).toBeFalsy();
    const viaSift = await api(`/screening/projects/${spid}/chat`, { cookie: owner.cookie });
    expect(viaSift.data.messages.find(x => x.id === mid)).toBeFalsy();
    expect(viaSift.data.messages.find(x => x.message === `owner msg ${r}`)).toBeTruthy(); // others untouched

    // Deleting an already-deleted message → 404 (it no longer "exists").
    expect((await api(`/screening/metalab/${mlId}/chat/${mid}`, { method: 'DELETE', cookie: m.cookie })).status).toBe(404);

    await cleanupPair(owner, spid, mlId);
  });

  it('SSE: chat.message poke carries projectId AND metaLabProjectId for a linked workspace (poke-only — no content keys)', async () => {
    if (!up) return;
    const { r, owner, mlId, spid } = await setupPair('p7c_s');
    const m = await register(`p7c_s_m${r}@t.local`);
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: m.email, preset: 'reviewer' } });

    let s = null;
    try {
      s = await openStream(m.cookie);
      expect(s.status).toBe(200);
      expect(await until(() => s.comments.some(x => x.includes('connected')), 4000, 100)).toBe(true);

      // Owner posts via the metalab door → the member's poke carries BOTH ids
      // (SIFT clients match on projectId, META·LAB clients on metaLabProjectId).
      const post = await api(`/screening/metalab/${mlId}/chat`, { method: 'POST', cookie: owner.cookie, body: { message: `sse secret ${r}` } });
      expect(post.status).toBe(201);
      expect(await until(() => s.events.some(e => e.type === 'chat.message' && e.projectId === spid && e.metaLabProjectId === mlId), 6000)).toBe(true);

      // Poke-only contract: no content/actor keys on any chat frame.
      const badKeys = ['message', 'title', 'actorName', 'actorEmail', 'email', 'name', 'senderId', 'senderName'];
      for (const e of s.events.filter(e => e.type === 'chat.message')) {
        for (const k of badKeys) expect(e).not.toHaveProperty(k);
      }
    } finally {
      if (s) s.ac.abort();
    }

    await cleanupPair(owner, spid, mlId);
  }, 20000);
});
