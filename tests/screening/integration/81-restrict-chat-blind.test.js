/**
 * 81-restrict-chat-blind.test.js — 81.md server fixes.
 *
 *   A. blindMode must not LEAK author/journal over the wire to a non-leader.
 *      Before 81.md listRecords suppressed only `authors`, shipping `journal`
 *      in the JSON (client hid it visually only) — a non-leader could read the
 *      journal from a direct API call, defeating the blind. Fix: suppress journal
 *      too (server/controllers/screeningController.js). The second-review list
 *      leaked BOTH authors and journal; fixed in screeningReviewController.js.
 *
 *   B. Flipping the project-wide "Restrict chat" toggle must push a live
 *      permissions.changed poke to project members so an already-open chat drawer
 *      re-resolves its post-gate without a reload (server/controllers/
 *      screeningController.js updateProject).
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res), headers: res.headers };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id, email }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeoutMs = 6000, step = 200) {
  const t0 = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - t0 >= timeoutMs) return false; await sleep(step); }
}

/** Open the SSE stream; collect data frames. */
async function openStream(cookie) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/events`, { headers: { Cookie: cookie }, signal: ac.signal });
  const comments = []; const events = [];
  if (res.status === 200 && res.body) {
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
  return { ac, status: res.status, comments, events };
}

const RIS = (r) => `TY  - JOUR
AU  - Confidential, Author
TI  - Blinded Trial ${r}
PY  - 2024
JO  - Secret Journal of Blinding
DO  - 10.9999/blind.${r}
AB  - Abstract body for blind-mode leak test ${r}.
ER  -`;

beforeAll(async () => {
  try { const h = await fetch(BASE + '/health'); up = h.ok; } catch { up = false; }
}, 30000);

describe('81.md A — blindMode does not leak author/journal to a non-leader (listRecords)', () => {
  it('a non-leader member gets authors="" AND journal="" under blind mode; the leader still sees both', async () => {
    if (!up) return;
    const r = rnd();
    const owner = await register(`b81_o${r}@t.local`);
    const sp = await api('/screening/projects', { method: 'POST', cookie: owner.cookie, body: { title: `Blind ${r}` } });
    const spid = sp.data.id;

    // Import one record (has authors + journal) and add a non-leader reviewer.
    const imp = await api(`/screening/projects/${spid}/import`, { method: 'POST', cookie: owner.cookie, body: { format: 'ris', content: RIS(r), filename: 'blind.ris' } });
    expect(imp.status).toBeGreaterThanOrEqual(200);
    const m = await register(`b81_m${r}@t.local`);
    const add = await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: m.email, preset: 'reviewer' } });
    expect(add.status).toBe(201);

    // Turn blind mode ON.
    expect((await api(`/screening/projects/${spid}`, { method: 'PUT', cookie: owner.cookie, body: { blindMode: true } })).status).toBe(200);

    // Non-leader member: BOTH author and journal must be blanked over the wire.
    const asMember = await api(`/screening/projects/${spid}/records`, { cookie: m.cookie });
    expect(asMember.status).toBe(200);
    const recM = (asMember.data.records || asMember.data.data || []).find(x => String(x.title).includes(`Blinded Trial ${r}`));
    expect(recM).toBeTruthy();
    expect(recM.authors).toBe('');
    expect(recM.journal).toBe('');                 // 81.md fix — previously leaked

    // Leader (owner) still sees identity.
    const asOwner = await api(`/screening/projects/${spid}/records`, { cookie: owner.cookie });
    const recO = (asOwner.data.records || asOwner.data.data || []).find(x => String(x.title).includes(`Blinded Trial ${r}`));
    expect(recO).toBeTruthy();
    expect(recO.authors).toBe('Confidential, Author');
    expect(recO.journal).toBe('Secret Journal of Blinding');

    await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: owner.cookie });
  }, 30000);
});

describe('81.md B — flipping "Restrict chat" pushes a live permissions.changed poke to members', () => {
  it('a member with an open SSE stream receives permissions.changed when the owner restricts chat', async () => {
    if (!up) return;
    const r = rnd();
    const owner = await register(`c81_o${r}@t.local`);
    const ml = await api('/projects', { method: 'POST', cookie: owner.cookie, body: { name: `Chat81 ${r}` } });
    const mlId = ml.data.id;
    const sp = await api('/screening/projects', { method: 'POST', cookie: owner.cookie, body: { title: `Chat81 ${r}`, linkedMetaLabProjectId: mlId } });
    const spid = sp.data.id;
    const m = await register(`c81_m${r}@t.local`);
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: m.email, preset: 'reviewer' } });

    let s = null;
    try {
      s = await openStream(m.cookie);
      expect(s.status).toBe(200);
      expect(await until(() => s.comments.some(x => x.includes('connected')), 4000, 100)).toBe(true);

      // Owner flips Restrict chat ON → the member should get a live permissions.changed poke.
      expect((await api(`/screening/projects/${spid}`, { method: 'PUT', cookie: owner.cookie, body: { chatRestricted: true } })).status).toBe(200);
      expect(await until(() => s.events.some(e => e.type === 'permissions.changed' && e.projectId === spid), 6000)).toBe(true);

      // And the resolved verdict for the member is now read-only (server contract).
      const list = await api(`/screening/metalab/${mlId}/chat`, { cookie: m.cookie });
      expect(list.data.canPost).toBe(false);
      expect(list.data.chatRestricted).toBe(true);
    } finally {
      if (s) s.ac.abort();
    }

    await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: owner.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: owner.cookie });
  }, 30000);
});
