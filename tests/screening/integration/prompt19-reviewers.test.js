/**
 * prompt19-reviewers.test.js — Screening integration tests for prompt19 Task 9.
 *
 * Per-project required reviewers gate the title_abstract → full_text promotion.
 * Exercises the live API at http://127.0.0.1:3001 (start with `npm run server`).
 * Self-skips when the server is down (same convention as prompt2.test.js).
 *
 * Covers:
 *  - default requiredScreeningReviewers = 2, surfaced by getProject
 *  - one include → NOT advanced (stays title_abstract)
 *  - second include → advanced / eligible for full_text (promoted: true)
 *  - include + exclude → CONFLICT, not advanced
 *  - owner raises required to 3 → two includes no longer enough; third makes eligible
 *  - a viewer / non-leader member gets 403 changing requiredScreeningReviewers
 *  - backend rejects a forged attempt to advance with insufficient decisions
 *  - updateProject validates: non-integer → 400, out-of-range → clamped to [2,10]
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Use 127.0.0.1 (not "localhost"): Node 18+ undici resolves localhost to ::1
// first, which hangs against a dual-stack server on Windows. curl is unaffected.
const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);

let up = false;
let adminCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id }; }

// Convenience: create a project owned by `cookie`, return its id.
async function newProject(cookie, title) {
  const proj = await api('/screening/projects', { method: 'POST', cookie, body: { title } });
  return proj.data?.id;
}
// Convenience: add a registered member by email with a preset/role.
async function addMember(ownerCookie, pid, email, role) {
  return api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: ownerCookie, body: { email, role } });
}
// Convenience: create a record, return its id.
async function newRecord(cookie, pid, title) {
  const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie, body: { title, year: '2024' } });
  return rec.data?.id;
}
// Convenience: record a decision.
async function decide(cookie, pid, rid, decision) {
  return api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie, body: { decision } });
}
// Convenience: read the record's current stage via second-review eligibility.
async function isInSecondReview(cookie, pid, rid) {
  const sr = await api(`/screening/projects/${pid}/second-review`, { cookie });
  return Array.isArray(sr.data?.records) && sr.data.records.some(x => x.id === rid);
}

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    const pw = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';
    const r = await api('/auth/login', { method: 'POST', body: { email: 'ops@metalab.local', password: pw } });
    if (r.status === 200) adminCookie = r.cookie;
  }
}, 30000);

describe('Screening prompt19 — per-project required reviewers (integration)', () => {
  it('getProject exposes requiredScreeningReviewers defaulting to 2', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`rrA_${r}@t.local`);
    const pid = await newProject(a.cookie, `RR default ${r}`);
    const got = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(got.status).toBe(200);
    expect(got.data.requiredScreeningReviewers).toBe(2);
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('default required=2: one include does not advance; second include advances', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`rrInc_A_${r}@t.local`); // owner
    const b = await register(`rrInc_B_${r}@t.local`); // reviewer
    const pid = await newProject(a.cookie, `RR inc ${r}`);
    await addMember(a.cookie, pid, `rrInc_B_${r}@t.local`, 'reviewer');
    const rid = await newRecord(a.cookie, pid, 'Two includes promote');

    // First include → not yet enough distinct reviewers.
    const d1 = await decide(a.cookie, pid, rid, 'include');
    expect(d1.status).toBe(200);
    expect(d1.data.promoted).toBe(false);
    expect(await isInSecondReview(a.cookie, pid, rid)).toBe(false);

    // Second include from a distinct reviewer → advances to full_text.
    const d2 = await decide(b.cookie, pid, rid, 'include');
    expect(d2.status).toBe(200);
    expect(d2.data.promoted).toBe(true);
    expect(await isInSecondReview(a.cookie, pid, rid)).toBe(true);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('include + exclude is a CONFLICT and does not advance', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`rrCf_A_${r}@t.local`); // owner / resolver
    const b = await register(`rrCf_B_${r}@t.local`); // reviewer
    const pid = await newProject(a.cookie, `RR conflict ${r}`);
    await addMember(a.cookie, pid, `rrCf_B_${r}@t.local`, 'reviewer');
    const rid = await newRecord(a.cookie, pid, 'Disagreement');

    await decide(a.cookie, pid, rid, 'include');
    const d2 = await decide(b.cookie, pid, rid, 'exclude');
    expect(d2.data.promoted).toBe(false);
    // Not eligible for second review while disputed.
    expect(await isInSecondReview(a.cookie, pid, rid)).toBe(false);
    // The disagreement surfaces as a conflict for the leader/resolver.
    const conf = await api(`/screening/projects/${pid}/conflicts`, { cookie: a.cookie });
    expect(conf.status).toBe(200);
    expect(conf.data.conflicts.some(c => c.recordId === rid)).toBe(true);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('owner raises required to 3: two includes no longer enough; third makes eligible', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`rr3_A_${r}@t.local`); // owner
    const b = await register(`rr3_B_${r}@t.local`); // reviewer
    const c = await register(`rr3_C_${r}@t.local`); // reviewer
    const pid = await newProject(a.cookie, `RR three ${r}`);
    await addMember(a.cookie, pid, `rr3_B_${r}@t.local`, 'reviewer');
    await addMember(a.cookie, pid, `rr3_C_${r}@t.local`, 'reviewer');

    // Owner raises the per-project requirement to 3.
    const upd = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { requiredScreeningReviewers: 3 } });
    expect(upd.status).toBe(200);
    expect(upd.data.requiredScreeningReviewers).toBe(3);
    const got = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(got.data.requiredScreeningReviewers).toBe(3);

    const rid = await newRecord(a.cookie, pid, 'Needs three includes');

    // Two includes — meets the include threshold (2) but only 2 distinct < 3 required.
    await decide(a.cookie, pid, rid, 'include');
    const d2 = await decide(b.cookie, pid, rid, 'include');
    expect(d2.data.promoted).toBe(false);
    expect(await isInSecondReview(a.cookie, pid, rid)).toBe(false);

    // Third include → 3 distinct reviewers, include threshold met → advances.
    const d3 = await decide(c.cookie, pid, rid, 'include');
    expect(d3.data.promoted).toBe(true);
    expect(await isInSecondReview(a.cookie, pid, rid)).toBe(true);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('a non-leader member is blocked (403) from changing requiredScreeningReviewers', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`rrPerm_A_${r}@t.local`); // owner
    const b = await register(`rrPerm_B_${r}@t.local`); // reviewer (no canManageSettings)
    const v = await register(`rrPerm_V_${r}@t.local`); // viewer (read-only)
    const pid = await newProject(a.cookie, `RR perm ${r}`);
    await addMember(a.cookie, pid, `rrPerm_B_${r}@t.local`, 'reviewer');
    await addMember(a.cookie, pid, `rrPerm_V_${r}@t.local`, 'viewer');

    const asReviewer = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: b.cookie, body: { requiredScreeningReviewers: 4 } });
    expect(asReviewer.status).toBe(403);
    const asViewer = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: v.cookie, body: { requiredScreeningReviewers: 4 } });
    expect(asViewer.status).toBe(403);

    // The value is unchanged (still the default 2) after the blocked attempts.
    const got = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(got.data.requiredScreeningReviewers).toBe(2);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('backend will not advance a record with insufficient distinct decisions (no forge bypass)', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`rrForge_A_${r}@t.local`); // owner — the only reviewer
    const pid = await newProject(a.cookie, `RR forge ${r}`);
    const rid = await newRecord(a.cookie, pid, 'Single reviewer cannot self-promote');

    // A single reviewer recording include cannot meet effectiveRequired (2).
    // Even passing an explicit stage in the body must not let one reviewer advance it.
    const d1 = await api(`/screening/projects/${pid}/records/${rid}/decision`, {
      method: 'POST', cookie: a.cookie, body: { decision: 'include', stage: 'title_abstract' },
    });
    expect(d1.data.promoted).toBe(false);
    expect(await isInSecondReview(a.cookie, pid, rid)).toBe(false);

    // Repeating the same reviewer's include (upsert) is still ONE distinct reviewer.
    const d1b = await decide(a.cookie, pid, rid, 'include');
    expect(d1b.data.promoted).toBe(false);
    expect(await isInSecondReview(a.cookie, pid, rid)).toBe(false);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('updateProject validates requiredScreeningReviewers: non-integer → 400; out-of-range → clamped', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`rrVal_A_${r}@t.local`);
    const pid = await newProject(a.cookie, `RR validate ${r}`);

    // Non-integer → 400.
    const bad1 = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { requiredScreeningReviewers: 'three' } });
    expect(bad1.status).toBe(400);
    const bad2 = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { requiredScreeningReviewers: 2.5 } });
    expect(bad2.status).toBe(400);

    // Below floor → clamped up to 2.
    const low = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { requiredScreeningReviewers: 1 } });
    expect(low.status).toBe(200);
    expect(low.data.requiredScreeningReviewers).toBe(2);

    // Above ceiling → clamped down to 10.
    const high = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { requiredScreeningReviewers: 99 } });
    expect(high.status).toBe(200);
    expect(high.data.requiredScreeningReviewers).toBe(10);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });
});
