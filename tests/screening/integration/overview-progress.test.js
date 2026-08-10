/**
 * overview-progress.test.js — 110.md §1 (integration).
 *
 * `dataSummary.screeningProgress` — the whole-project screening progress model
 * served by GET /screening/projects/:pid/overview. Pins the defect end to end:
 * one reviewer through every record must NOT read 100% while the second required
 * reviewer has not screened, and an open conflict must hold the project below 100%.
 *
 * Exercises the live API at http://127.0.0.1:3001 (start with `npm run server`).
 * Self-skips when the server is down (same convention as prompt19-reviewers.test.js).
 */
import { describe, it, expect, beforeAll } from 'vitest';

// 127.0.0.1, not "localhost": undici prefers ::1 and hangs on dual-stack Windows.
const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);

let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) {
  const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } });
  return { cookie: r.cookie, id: r.data?.user?.id };
}
async function newProject(cookie, title) {
  const p = await api('/screening/projects', { method: 'POST', cookie, body: { title } });
  return p.data?.id;
}
async function newRecord(cookie, pid, title) {
  const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie, body: { title, year: '2024' } });
  return rec.data?.id;
}
const decide = (cookie, pid, rid, decision) =>
  api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie, body: { decision } });
async function progress(cookie, pid) {
  const ov = await api(`/screening/projects/${pid}/overview`, { cookie });
  return ov.data?.dataSummary?.screeningProgress;
}

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
}, 30000);

describe('Screening overview — multi-reviewer progress (110.md §1)', () => {
  it('an empty project reports 0% and is not complete', async () => {
    if (!up) return;
    const a = await register(`op0_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `Progress empty ${rnd()}`);
    const sp = await progress(a.cookie, pid);
    expect(sp).toBeTruthy();
    expect(sp.poolSize).toBe(0);
    expect(sp.completion).toBe(0);
    expect(sp.complete).toBe(false);
    expect(sp.summary).toBe('No records to screen yet.');
    // Stage strip = one segment per required reviewer + conflicts + complete.
    expect(sp.stages).toHaveLength(sp.requiredReviewers + 2);
    expect(sp.stages[sp.stages.length - 1].key).toBe('complete');
  }, 30000);

  it('one reviewer through every record is ~50%, not 100%, at 2 required reviewers', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`opA_${r}@t.local`);
    const b = await register(`opB_${r}@t.local`);
    const pid = await newProject(a.cookie, `Progress half ${r}`);
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `opB_${r}@t.local`, role: 'reviewer' } });
    const r1 = await newRecord(a.cookie, pid, `Rec one ${r}`);
    const r2 = await newRecord(a.cookie, pid, `Rec two ${r}`);

    await decide(a.cookie, pid, r1, 'include');
    await decide(a.cookie, pid, r2, 'include');

    const sp = await progress(a.cookie, pid);
    expect(sp.requiredReviewers).toBeGreaterThanOrEqual(2);
    expect(sp.poolSize).toBe(2);
    expect(sp.requiredDecisions).toBe(2 * sp.requiredReviewers);
    expect(sp.completedDecisions).toBe(2);
    expect(sp.recordsAwaitingReviewer).toBe(2);
    expect(sp.recordsFullyReviewed).toBe(0);
    expect(sp.complete).toBe(false);
    // The legacy record-denominated field still reads "everything touched once" —
    // that divergence is the whole point of the new model.
    const ov = await api(`/screening/projects/${pid}/overview`, { cookie: a.cookie });
    expect(ov.data.projectProgress.completion).toBe(100);
    expect(sp.completion).toBeLessThan(100);
    if (sp.requiredReviewers === 2) expect(sp.completion).toBe(50);

    // …and the second reviewer finishing takes it to 100%.
    await decide(b.cookie, pid, r1, 'include');
    await decide(b.cookie, pid, r2, 'include');
    const done = await progress(a.cookie, pid);
    if (done.requiredReviewers === 2) {
      expect(done.completedDecisions).toBe(4);
      expect(done.recordsFullyReviewed).toBe(2);
      expect(done.unresolvedConflicts).toBe(0);
      expect(done.complete).toBe(true);
      expect(done.completion).toBe(100);
      expect(done.stages[done.stages.length - 1].status).toBe('complete');
    }
  }, 60000);

  it('an unresolved conflict holds the project below 100% even with every decision in', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`opC_${r}@t.local`);
    await register(`opD_${r}@t.local`);
    const b = await api('/auth/login', { method: 'POST', body: { email: `opD_${r}@t.local`, password: 'Password123!' } });
    const pid = await newProject(a.cookie, `Progress conflict ${r}`);
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `opD_${r}@t.local`, role: 'reviewer' } });
    const rid = await newRecord(a.cookie, pid, `Disputed ${r}`);

    await decide(a.cookie, pid, rid, 'include');
    await decide(b.cookie, pid, rid, 'exclude');

    const sp = await progress(a.cookie, pid);
    if (sp.requiredReviewers !== 2) return; // admin raised the global quorum — skip the exact numbers
    expect(sp.completedDecisions).toBe(2);
    expect(sp.decisionsRemaining).toBe(0);
    expect(sp.decisionCompletion).toBe(100);
    expect(sp.unresolvedConflicts).toBe(1);
    expect(sp.complete).toBe(false);
    expect(sp.completion).toBeLessThan(100);
    const conflictStage = sp.stages.find(s => s.key === 'conflicts');
    expect(conflictStage.status).toBe('active');
    expect(sp.currentStageLabel).toBe('Conflict resolution');
  }, 60000);

  it('raising requiredScreeningReviewers immediately lowers completion', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`opE_${r}@t.local`);
    const pid = await newProject(a.cookie, `Progress reqs ${r}`);
    const rid = await newRecord(a.cookie, pid, `Solo ${r}`);
    await decide(a.cookie, pid, rid, 'include');

    const before = await progress(a.cookie, pid);
    // The screening project update endpoint is PUT (routes/screening.js:56), not PATCH.
    await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { requiredScreeningReviewers: 4 } });
    const after = await progress(a.cookie, pid);

    expect(after.requiredReviewers).toBe(4);
    expect(after.requiredDecisions).toBe(4);
    expect(after.completedDecisions).toBe(1);
    expect(after.completion).toBe(25);
    expect(after.completion).toBeLessThan(before.completion);
    expect(after.stages.filter(s => s.kind === 'reviewer_pass')).toHaveLength(4);
  }, 60000);

  it('duplicates are outside the denominator (same convention as screeningPool)', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`opF_${r}@t.local`);
    const pid = await newProject(a.cookie, `Progress dup ${r}`);
    await newRecord(a.cookie, pid, `Dup base ${r}`);
    await newRecord(a.cookie, pid, `Dup base ${r}`);
    const ov = await api(`/screening/projects/${pid}/overview`, { cookie: a.cookie });
    const sp = ov.data?.dataSummary?.screeningProgress;
    // poolSize mirrors dataSummary.screeningPool exactly — whatever the duplicate
    // sweep has (or has not) flagged, the two never disagree.
    expect(sp.poolSize).toBe(ov.data.dataSummary.screeningPool);
  }, 30000);
});
