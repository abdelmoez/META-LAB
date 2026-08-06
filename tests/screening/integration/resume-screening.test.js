/**
 * resume-screening.test.js — 100.md §§12-15. Integration coverage for
 * GET /api/screening/projects/:pid/resume against the live API.
 *
 * The unit tests (tests/unit/screening/resumeState.test.js) pin the pure decision
 * logic; these pin the SQL-shaped half of the contract that only a real database can
 * show: derivation from the caller's own decision rows, per-user isolation, the
 * canonical `(createdAt ASC, id ASC)` position, and the edge cases 100.md §15 lists.
 *
 * Skipped silently when the server is not running (the suite-wide convention).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api'; // 127.0.0.1 avoids the Node/undici ::1 hang on Windows
const SIFT = `${API}/screening/projects`;

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function loginOrRegister(email, password, name) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (login.ok) return login.headers.get('set-cookie');
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return reg.headers.get('set-cookie');
}

async function api(method, url, cookie, body) {
  const opts = { method, headers: { Cookie: cookie } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts);
}

const resume = async (cookie, stage = 'title_abstract') => {
  const r = await api('GET', `${SIFT}/${projectId}/resume?stage=${stage}&limit=50`, cookie);
  expect(r.status).toBe(200);
  return r.json();
};

let up = false;
let cookieA = null;   // owner / reviewer A
let cookieB = null;   // reviewer B
let emailB = null;
let projectId = null;
let ordered = [];     // record ids in canonical (createdAt ASC, id ASC) order

const RECORDS = 6;

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  cookieA = await loginOrRegister('resume-qa-a@example.com', 'ResumePassA1!', 'Resume QA A');
  emailB = 'resume-qa-b@example.com';
  cookieB = await loginOrRegister(emailB, 'ResumePassB1!', 'Resume QA B');

  const created = await (await api('POST', SIFT, cookieA, { title: `Resume QA ${Date.now()}` })).json();
  projectId = created.id || (created.project && created.project.id);

  // Records are created one at a time so their canonical order is deterministic.
  for (let i = 1; i <= RECORDS; i++) {
    await api('POST', `${SIFT}/${projectId}/records`, cookieA, {
      title: `Resume QA article ${i}`, authors: `Author ${i}`, year: `20${10 + i}`,
      doi: `10.9999/resume.${i}`, abstract: `Abstract ${i}`,
    });
  }
  const list = await (await api('GET', `${SIFT}/${projectId}/records?page=1&limit=50`, cookieA)).json();
  ordered = list.records.map((r) => r.id);

  // Reviewer B joins so the per-user isolation case is real.
  await api('POST', `${SIFT}/${projectId}/members`, cookieA, { email: emailB, preset: 'reviewer' });
});

afterAll(async () => {
  if (up && projectId && cookieA) await api('DELETE', `${SIFT}/${projectId}`, cookieA);
});

const decide = (cookie, recordId, decision = 'include') =>
  api('POST', `${SIFT}/${projectId}/records/${recordId}/decision`, cookie, { decision });

describe('GET /projects/:pid/resume — 100.md §§12-15', () => {
  it('starts at the first article when nothing has been screened (§15)', async () => {
    if (!up) return;
    const r = await resume(cookieA);
    expect(r).toMatchObject({
      stage: 'title_abstract', status: 'start', recordId: ordered[0],
      position: 1, page: 1, pending: RECORDS, decided: 0, stageTotal: RECORDS,
    });
    expect(r.message).toMatch(/Starting at the first article/);
  });

  it('reports the stage as EMPTY when it holds no articles (§15)', async () => {
    if (!up) return;
    const r = await resume(cookieA, 'full_text');
    expect(r).toMatchObject({ stage: 'full_text', status: 'empty', recordId: null, stageTotal: 0 });
    expect(r.message).toMatch(/no articles to screen in Final Review/);
  });

  it('resumes at the article AFTER the most recent decision (§13)', async () => {
    if (!up) return;
    await decide(cookieA, ordered[0]);
    await decide(cookieA, ordered[1]);
    const r = await resume(cookieA);
    expect(r).toMatchObject({
      status: 'resume', recordId: ordered[2], position: 3, decided: 2,
      pending: RECORDS - 2, wrapped: false,
    });
    expect(r.lastDecidedAt).toBeTruthy();
  });

  it('an EXCLUSION moves the anchor exactly like an inclusion (§15)', async () => {
    if (!up) return;
    await decide(cookieA, ordered[2], 'exclude');
    const r = await resume(cookieA);
    expect(r.recordId).toBe(ordered[3]);
    expect(r.decided).toBe(3);
  });

  it('is per USER — reviewer B has their own untouched position (§14)', async () => {
    if (!up) return;
    const b = await resume(cookieB);
    expect(b).toMatchObject({ status: 'start', recordId: ordered[0], decided: 0, pending: RECORDS });
    // …and A is unaffected by B looking.
    const a = await resume(cookieA);
    expect(a.recordId).toBe(ordered[3]);
    expect(a.decided).toBe(3);
  });

  it('is per STAGE — a Title/Abstract position never leaks into Final Review (§14)', async () => {
    if (!up) return;
    const ft = await resume(cookieA, 'full_text');
    expect(ft).toMatchObject({ status: 'empty', decided: 0 });
  });

  it('undoing the last decision makes that article the next one again', async () => {
    if (!up) return;
    await decide(cookieA, ordered[2], 'undecided');   // the UI "Undo"
    const r = await resume(cookieA);
    expect(r.decided).toBe(2);
    expect(r.recordId).toBe(ordered[2]);
    await decide(cookieA, ordered[2], 'exclude');     // put it back for the rest
  });

  it('wraps back to an article the reviewer skipped earlier', async () => {
    if (!up) return;
    // Decide the LAST record, leaving a gap in the middle: nothing follows the anchor.
    await decide(cookieA, ordered[RECORDS - 1]);
    const r = await resume(cookieA);
    expect(r).toMatchObject({ status: 'resume', recordId: ordered[3], wrapped: true });
    expect(r.message).toMatch(/earliest article you skipped/);
  });

  it('a deduplicated article stops being a candidate (§15)', async () => {
    if (!up) return;
    const before = await resume(cookieA);
    expect(before.recordId).toBe(ordered[3]);
    // Deleting the next candidate is the same class of event as a dedup resolution:
    // the pointer must not dangle, the next valid candidate is found instead.
    await api('DELETE', `${SIFT}/${projectId}/records/${ordered[3]}`, cookieA);
    const after = await resume(cookieA);
    expect(after.recordId).toBe(ordered[4]);
    expect(after.stageTotal).toBe(RECORDS - 1);
  });

  it('says the stage is COMPLETE once every article has this reviewer\'s decision (§15)', async () => {
    if (!up) return;
    const left = await resume(cookieA);
    let guard = 0;
    let cur = left.recordId;
    while (cur && guard++ < RECORDS + 2) {
      await decide(cookieA, cur);
      cur = (await resume(cookieA)).recordId;
    }
    const done = await resume(cookieA);
    expect(done).toMatchObject({ status: 'complete', recordId: null, pending: 0 });
    expect(done.message).toBe('You have completed screening for Title & Abstract.');
    // B is still at the start — completion is per reviewer.
    expect((await resume(cookieB)).status).toBe('start');
  });

  it('coerces an unknown stage to Title/Abstract and 404s an unknown project', async () => {
    if (!up) return;
    const r = await (await api('GET', `${SIFT}/${projectId}/resume?stage=nonsense`, cookieA)).json();
    expect(r.stage).toBe('title_abstract');
    const missing = await api('GET', `${SIFT}/00000000-0000-0000-0000-000000000000/resume`, cookieA);
    expect(missing.status).toBe(404);
  });
});
