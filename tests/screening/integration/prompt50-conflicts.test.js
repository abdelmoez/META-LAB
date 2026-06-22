/**
 * prompt50-conflicts.test.js — WS3: correct conflict detection + lifecycle.
 *
 * Regression coverage for the reported bugs:
 *   - a study INCLUDED BY BOTH reviewers must NOT appear in Conflicts (incl. after
 *     it is promoted to full text and re-decided there — the cross-stage bug);
 *   - when a disagreement is resolved by a decision change, the record leaves the
 *     Conflicts tab and the unresolved counter drops WITHOUT a reload.
 *
 * Requires the API on :3001 (skips gracefully when it is down).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);

let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id }; }

beforeAll(async () => { try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; } });

async function setup(prefix) {
  const r = rnd();
  const owner = await register(`${prefix}A_${r}@t.local`); // leader/owner
  const b = await register(`${prefix}B_${r}@t.local`);     // reviewer
  const proj = await api('/screening/projects', { method: 'POST', cookie: owner.cookie, body: { title: `${prefix} ${r}` } });
  const pid = proj.data.id;
  await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: `${prefix}B_${r}@t.local`, role: 'reviewer' } });
  return { r, owner, b, pid };
}
const newRecord = (pid, owner, title) => api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: owner.cookie, body: { title, year: '2024' } });
const decide = (pid, rid, who, decision, stage) => api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: who.cookie, body: { decision, ...(stage ? { stage } : {}) } });
const unresolved = async (pid, owner) => {
  const list = await api(`/screening/projects/${pid}/conflicts`, { cookie: owner.cookie });
  return (list.data.conflicts || []).filter(c => !c.resolvedAt);
};

describe('prompt50 WS3 — conflict detection + real-time lifecycle', () => {
  it('Scenario 3: include + include is agreement, never a conflict', async () => {
    if (!up) return;
    const { owner, b, pid } = await setup('p50c_a');
    const rec = await newRecord(pid, owner, 'Both include');
    const rid = rec.data.id;
    expect((await decide(pid, rid, owner, 'include')).status).toBe(200);
    expect((await decide(pid, rid, b, 'include')).status).toBe(200);

    const open = await unresolved(pid, owner);
    expect(open.find(c => c.recordId === rid)).toBeFalsy();
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner.cookie });
  });

  it('Scenario 4: include + exclude → conflict; changing to include resolves it immediately', async () => {
    if (!up) return;
    const { owner, b, pid } = await setup('p50c_b');
    const rec = await newRecord(pid, owner, 'Disagree then agree');
    const rid = rec.data.id;

    await decide(pid, rid, owner, 'include');
    await decide(pid, rid, b, 'exclude');
    let open = await unresolved(pid, owner);
    expect(open.find(c => c.recordId === rid)).toBeTruthy(); // appears in Conflicts

    // Reviewer B changes to include → agreement → leaves Conflicts (auto-resolved).
    await decide(pid, rid, b, 'include');
    open = await unresolved(pid, owner);
    expect(open.find(c => c.recordId === rid)).toBeFalsy();

    // The row is retained as an AUTO resolution (history), not a live conflict.
    const all = await api(`/screening/projects/${pid}/conflicts`, { cookie: owner.cookie });
    const row = (all.data.conflicts || []).find(c => c.recordId === rid);
    expect(row).toBeTruthy();
    expect(row.resolvedAt).toBeTruthy();
    expect(row.resolvedBy).toBe('auto');
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner.cookie });
  });

  it('retracting a decision below two reviewers clears the conflict', async () => {
    if (!up) return;
    const { owner, b, pid } = await setup('p50c_c');
    const rec = await newRecord(pid, owner, 'Retract');
    const rid = rec.data.id;
    await decide(pid, rid, owner, 'include');
    await decide(pid, rid, b, 'exclude');
    expect((await unresolved(pid, owner)).find(c => c.recordId === rid)).toBeTruthy();

    // B retracts to undecided → only one active decision → not a conflict.
    await decide(pid, rid, b, 'undecided');
    const all = await api(`/screening/projects/${pid}/conflicts`, { cookie: owner.cookie });
    expect((all.data.conflicts || []).find(c => c.recordId === rid)).toBeFalsy();
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner.cookie });
  });

  it('cross-stage: a both-included (promoted) record re-decided at full text is NOT a title/abstract conflict', async () => {
    if (!up) return;
    const { owner, b, pid } = await setup('p50c_d');
    const rec = await newRecord(pid, owner, 'Promoted then full-text exclude');
    const rid = rec.data.id;
    // Two includes at title/abstract → quorum → promoted to full_text.
    await decide(pid, rid, owner, 'include');
    const promote = await decide(pid, rid, b, 'include');
    expect(promote.data.promoted).toBe(true);

    // A reviewer now records a DIFFERENT decision at the full_text stage. The
    // title/abstract decisions still unanimously agree, so this must not create
    // a conflict (the reported bug).
    await decide(pid, rid, owner, 'exclude', 'full_text');
    const open = await unresolved(pid, owner);
    expect(open.find(c => c.recordId === rid)).toBeFalsy();
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner.cookie });
  });
});
