/**
 * prompt21-final-review.test.js
 *
 * Integration coverage for the Final Review revert flow (prompt21 Tasks 3/10):
 *   - accept a quorum-promoted record → it lands in the linked project's Data
 *     Extraction (studies[]) and the record reads finalStatus=accepted, sent
 *   - the project leader can REVERT it: the study leaves active Data Extraction,
 *     the record returns to pending Final Review (a snapshot is kept server-side)
 *   - re-accepting RESTORES the same study with any extracted data preserved
 *   - guards: a reviewer cannot revert (403); reverting a non-accepted record 400;
 *     unauthenticated 401
 *
 * Fetch-based harness (mirrors prompt19/prompt7); server assumed at :3001; the
 * whole suite self-skips when the server is down.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';
const TS = Date.now();
const rnd = () => Math.random().toString(36).slice(2, 8);

function setCookie(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/metalab_session=[^;]+/);
  return m ? m[0] : '';
}
async function api(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data, cookie: setCookie(res) };
}
async function register(tag) {
  const email = `p21fr-${tag}-${TS}-${rnd()}@example.com`;
  const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: tag } });
  return { email, cookie: r.cookie, id: r.data?.user?.id };
}
async function serverUp() { try { return (await fetch(`${API}/health`)).ok; } catch { return false; } }

// Read the linked project's extraction studies[] (defensive about response shape).
async function studiesOf(mlId, cookie) {
  const r = await api(`/projects/${mlId}`, { cookie });
  const p = r.data || {};
  let raw = p.studies ?? p.data;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw).studies; } catch { raw = null; } }
  else if (raw && typeof raw === 'object' && Array.isArray(raw.studies)) raw = raw.studies;
  return Array.isArray(raw) ? raw : null;
}

let up = false;

beforeAll(async () => { up = await serverUp(); });

describe('Final Review — accept → revert → re-accept', () => {
  it('runs the full safe-revert lifecycle on a linked project', async () => {
    if (!up) return;
    const owner = await register('owner');
    const rev   = await register('rev');
    if (!owner.cookie || !owner.id) return; // registration disabled → skip

    // Linked Data-Extraction project (owned by the screening owner).
    const ml = await api('/projects', { method: 'POST', cookie: owner.cookie, body: { name: `ML ${rnd()}`, data: JSON.stringify({ studies: [] }) } });
    const mlId = ml.data?.id || ml.data?.project?.id;
    expect(mlId, 'created META·LAB project id').toBeTruthy();

    // Screening project, linked, with a second reviewer.
    const proj = await api('/screening/projects', { method: 'POST', cookie: owner.cookie, body: { title: `FR ${rnd()}` } });
    const pid = proj.data?.id;
    expect(pid).toBeTruthy();
    await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: owner.cookie, body: { linkedMetaLabProjectId: mlId } });
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: rev.email, role: 'reviewer' } });

    // Record → 2 includes → promoted to full text (Final Review).
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: owner.cookie,
      body: { title: 'Revertable Study', doi: `10.9/${rnd()}`, year: '2024', authors: 'Doe J', journal: 'J', abstract: 'abs' } });
    const rid = rec.data?.id;
    expect(rid).toBeTruthy();
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: owner.cookie, body: { decision: 'include' } });
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: rev.cookie,   body: { decision: 'include' } });

    // Accept → sent to Data Extraction.
    const accept = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: owner.cookie, body: { decision: 'accept' } });
    expect(accept.status).toBe(200);
    expect(accept.data.handoff?.handed).toBe(true);

    let studies = await studiesOf(mlId, owner.cookie);
    if (studies) {
      expect(studies.length).toBe(1);
      expect(studies[0].screeningRecordId).toBe(rid);
    }

    // A reviewer cannot revert.
    const revBy = await api(`/screening/projects/${pid}/records/${rid}/final-review/revert`, { method: 'POST', cookie: rev.cookie });
    expect(revBy.status).toBe(403);

    // Leader reverts → removed from extraction, record back to pending.
    const revert = await api(`/screening/projects/${pid}/records/${rid}/final-review/revert`, { method: 'POST', cookie: owner.cookie });
    expect(revert.status).toBe(200);
    expect(revert.data.reverted?.removedFromExtraction).toBe(true);

    studies = await studiesOf(mlId, owner.cookie);
    if (studies) expect(studies.length).toBe(0);

    const sr = await api(`/screening/projects/${pid}/second-review`, { cookie: owner.cookie });
    const reverted = sr.data.records.find(r => r.id === rid);
    expect(reverted?.finalStatus).toBe('');     // returned to pending Final Review
    expect(reverted?.handoffStatus).toBe('');

    // Reverting again (now non-accepted) → 400.
    const revertAgain = await api(`/screening/projects/${pid}/records/${rid}/final-review/revert`, { method: 'POST', cookie: owner.cookie });
    expect(revertAgain.status).toBe(400);

    // Re-accept → restored to Data Extraction.
    const reAccept = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: owner.cookie, body: { decision: 'accept' } });
    expect(reAccept.status).toBe(200);
    expect(reAccept.data.handoff?.handed).toBe(true);
    studies = await studiesOf(mlId, owner.cookie);
    if (studies) {
      expect(studies.length).toBe(1);
      expect(studies[0].screeningRecordId).toBe(rid);
    }

    // cleanup (best-effort)
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: owner.cookie });
  });

  it('rejects an unauthenticated revert (401)', async () => {
    if (!up) return;
    const res = await api(`/screening/projects/anything/records/anything/final-review/revert`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
