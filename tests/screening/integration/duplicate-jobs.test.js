/**
 * duplicate-jobs.test.js — 92.md durable duplicate-detection job lifecycle.
 * Requires the META·LAB server on http://127.0.0.1:3001 (skipped silently otherwise).
 *
 * Covers: 202 enqueue + real progress fields, poll-to-completion, results landing
 * as duplicate groups, idempotent reruns (no duplicate duplicate-groups), the
 * single-active-job guard under concurrent starts, reconnect via detect/status,
 * manual keep-all decisions surviving re-detection, access rules (401/404), and
 * cancellation being safe (never a corrupt half-written group).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';
const SIFT = `${API}/screening/projects`;

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function loginOrRegister(email, password, name = 'Dup QA') {
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
  const opts = { method, headers: {} };
  if (cookie) opts.headers.Cookie = cookie;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

/** Poll a detection job until it is terminal (or the budget runs out). */
async function waitForJob(pid, jobId, cookie, { tries = 120, delayMs = 250 } = {}) {
  let job = null;
  for (let i = 0; i < tries; i++) {
    const r = await api('GET', `${SIFT}/${pid}/duplicates/jobs/${jobId}`, cookie);
    job = r.data?.job || null;
    if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return job;
}

async function addRecord(pid, cookie, body) {
  return api('POST', `${SIFT}/${pid}/records`, cookie, body);
}

let up = false;
let cookieA = null;   // owner/leader
let cookieB = null;   // outsider
const rnd = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  cookieA = await loginOrRegister(`dupjob-a-${rnd()}@t.local`, 'DupJobA1!pass');
  cookieB = await loginOrRegister(`dupjob-b-${rnd()}@t.local`, 'DupJobB1!pass');
});

async function makeProject(title) {
  const r = await api('POST', SIFT, cookieA, { title });
  expect(r.status).toBe(201);
  return r.data.id;
}

describe('duplicate detection — durable job lifecycle (92.md)', () => {
  it('enqueues (202), reports real progress fields, completes, and lands groups', async () => {
    if (!up) return;
    const pid = await makeProject(`DUPJOB core ${rnd()}`);
    const suffix = rnd();
    await addRecord(pid, cookieA, { title: 'Aspirin therapy in cardiovascular prevention a randomized trial ' + suffix, doi: `10.92/${suffix}`, year: '2024' });
    await addRecord(pid, cookieA, { title: 'ASPIRIN THERAPY in cardiovascular prevention: a randomized trial ' + suffix, doi: `10.92/${suffix}`, year: '2024' });
    await addRecord(pid, cookieA, { title: 'A completely unrelated study of sleep quality in adolescents ' + suffix, year: '2023' });

    const start = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {});
    expect(start.status).toBe(202);
    expect(start.data.job).toBeTruthy();
    expect(['queued', 'processing', 'completed']).toContain(start.data.job.status);

    const job = await waitForJob(pid, start.data.job.id, cookieA);
    expect(job).toBeTruthy();
    expect(job.status).toBe('completed');
    expect(job.totalRecords).toBe(3);
    expect(job.groupsFound).toBe(1);
    expect(job.groupsCreated).toBe(1);
    expect(job.recordsFlagged).toBe(1); // one non-primary copy flagged
    expect(job.error).toBe('');

    const dups = await api('GET', `${SIFT}/${pid}/duplicates`, cookieA);
    expect(dups.status).toBe(200);
    const unresolved = dups.data.groups.filter((g) => !g.resolved);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].records).toHaveLength(2);
    expect(unresolved[0].similarity).toBe(100); // exact DOI

    await api('DELETE', `${SIFT}/${pid}`, cookieA);
  }, 60_000);

  it('rerunning on unchanged data is a no-op (no duplicate duplicate-groups)', async () => {
    if (!up) return;
    const pid = await makeProject(`DUPJOB rerun ${rnd()}`);
    const suffix = rnd();
    await addRecord(pid, cookieA, { title: 'Metformin and weight change in adults with prediabetes cohort ' + suffix, doi: `10.93/${suffix}`, year: '2022' });
    await addRecord(pid, cookieA, { title: 'Metformin and weight change in adults with prediabetes cohort. ' + suffix, doi: `10.93/${suffix}`, year: '2022' });

    const first = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {});
    const job1 = await waitForJob(pid, first.data.job.id, cookieA);
    expect(job1.status).toBe('completed');
    expect(job1.groupsCreated).toBe(1);

    const second = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {});
    expect(second.status).toBe(202);
    const job2 = await waitForJob(pid, second.data.job.id, cookieA);
    expect(job2.status).toBe('completed');
    expect(job2.groupsFound).toBe(1);   // still detected…
    expect(job2.groupsCreated).toBe(0); // …but nothing re-created
    expect(job2.groupsUpdated).toBe(0);
    expect(job2.recordsFlagged).toBe(0);

    const dups = await api('GET', `${SIFT}/${pid}/duplicates`, cookieA);
    expect(dups.data.groups).toHaveLength(1);

    await api('DELETE', `${SIFT}/${pid}`, cookieA);
  }, 60_000);

  it('concurrent starts converge on one job / one consistent result', async () => {
    if (!up) return;
    const pid = await makeProject(`DUPJOB race ${rnd()}`);
    const suffix = rnd();
    await addRecord(pid, cookieA, { title: 'Statin therapy adherence and outcomes in older adults registry ' + suffix, doi: `10.94/${suffix}`, year: '2021' });
    await addRecord(pid, cookieA, { title: 'Statin therapy adherence and outcomes in older adults registry! ' + suffix, doi: `10.94/${suffix}`, year: '2021' });

    const [r1, r2] = await Promise.all([
      api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {}),
      api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {}),
    ]);
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    // If both landed while active they MUST be the same job.
    if (r1.data.job.id !== r2.data.job.id) {
      // One finished before the other started — both must then be clean runs.
      await waitForJob(pid, r1.data.job.id, cookieA);
      await waitForJob(pid, r2.data.job.id, cookieA);
    } else {
      expect(r1.data.alreadyRunning || r2.data.alreadyRunning).toBe(true);
      await waitForJob(pid, r1.data.job.id, cookieA);
    }
    // The invariant that matters: exactly ONE group exists, whatever the interleaving.
    const dups = await api('GET', `${SIFT}/${pid}/duplicates`, cookieA);
    expect(dups.data.groups).toHaveLength(1);

    await api('DELETE', `${SIFT}/${pid}`, cookieA);
  }, 60_000);

  it('detect/status reconnects to the latest job (refresh survival)', async () => {
    if (!up) return;
    const pid = await makeProject(`DUPJOB status ${rnd()}`);
    const suffix = rnd();
    await addRecord(pid, cookieA, { title: 'Vitamin D supplementation and fracture risk meta analysis ' + suffix, doi: `10.95/${suffix}`, year: '2020' });
    await addRecord(pid, cookieA, { title: 'Vitamin D supplementation and fracture risk meta-analysis ' + suffix, doi: `10.95/${suffix}`, year: '2020' });

    const empty = await api('GET', `${SIFT}/${pid}/duplicates/detect/status`, cookieA);
    expect(empty.status).toBe(200);
    expect(empty.data.job).toBeNull();

    const start = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {});
    await waitForJob(pid, start.data.job.id, cookieA);

    const st = await api('GET', `${SIFT}/${pid}/duplicates/detect/status`, cookieA);
    expect(st.status).toBe(200);
    expect(st.data.job.id).toBe(start.data.job.id);
    expect(st.data.job.status).toBe('completed');

    await api('DELETE', `${SIFT}/${pid}`, cookieA);
  }, 60_000);

  it('manual "not duplicates — keep all" decisions survive re-detection', async () => {
    if (!up) return;
    const pid = await makeProject(`DUPJOB manual ${rnd()}`);
    const suffix = rnd();
    await addRecord(pid, cookieA, { title: 'Cognitive behavioural therapy for insomnia in primary care trial ' + suffix, doi: `10.96/${suffix}`, year: '2023' });
    await addRecord(pid, cookieA, { title: 'Cognitive behavioural therapy for insomnia in primary care trial. ' + suffix, doi: `10.96/${suffix}`, year: '2023' });

    const start = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {});
    const job1 = await waitForJob(pid, start.data.job.id, cookieA);
    expect(job1.status).toBe('completed');

    const dups1 = await api('GET', `${SIFT}/${pid}/duplicates`, cookieA);
    const gid = dups1.data.groups[0].id;
    // Reviewer decides these are NOT duplicates.
    const keep = await api('POST', `${SIFT}/${pid}/duplicates/${gid}/resolve`, cookieA, { keepAll: true });
    expect(keep.status).toBe(200);

    const again = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {});
    const job2 = await waitForJob(pid, again.data.job.id, cookieA);
    expect(job2.status).toBe('completed');
    expect(job2.groupsCreated).toBe(0); // the reviewed pair is frozen — never regrouped

    const dups2 = await api('GET', `${SIFT}/${pid}/duplicates`, cookieA);
    expect(dups2.data.groups).toHaveLength(1);
    expect(dups2.data.groups[0].resolved).toBe(true);

    await api('DELETE', `${SIFT}/${pid}`, cookieA);
  }, 60_000);

  it('enforces access: 401 unauthenticated, 404 outsider (existence hidden)', async () => {
    if (!up) return;
    const pid = await makeProject(`DUPJOB access ${rnd()}`);

    const anon = await api('POST', `${SIFT}/${pid}/duplicates/detect`, null, {});
    expect(anon.status).toBe(401);

    const outsiderDetect = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieB, {});
    expect(outsiderDetect.status).toBe(404);
    const outsiderStatus = await api('GET', `${SIFT}/${pid}/duplicates/detect/status`, cookieB);
    expect(outsiderStatus.status).toBe(404);
    const outsiderCancel = await api('POST', `${SIFT}/${pid}/duplicates/jobs/nonexistent/cancel`, cookieB, {});
    expect(outsiderCancel.status).toBe(404);

    await api('DELETE', `${SIFT}/${pid}`, cookieA);
  }, 30_000);

  it('cancel is safe: terminal state is never "half-written"', async () => {
    if (!up) return;
    const pid = await makeProject(`DUPJOB cancel ${rnd()}`);
    const suffix = rnd();
    for (let i = 0; i < 30; i++) {
      await addRecord(pid, cookieA, {
        title: `Longitudinal outcomes of treatment protocol variant number ${i} in multicentre study ${suffix}`,
        doi: i % 2 === 0 ? `10.97/${suffix}-${Math.floor(i / 2)}` : '',
        year: '2022',
      });
    }
    const start = await api('POST', `${SIFT}/${pid}/duplicates/detect`, cookieA, {});
    expect(start.status).toBe(202);
    const cancel = await api('POST', `${SIFT}/${pid}/duplicates/jobs/${start.data.job.id}/cancel`, cookieA, {});
    expect(cancel.status).toBe(200);

    const job = await waitForJob(pid, start.data.job.id, cookieA);
    // Either the cancel landed in time or the job had already finished — both are
    // legitimate; corruption or failure is not.
    expect(['cancelled', 'completed']).toContain(job.status);
    const dups = await api('GET', `${SIFT}/${pid}/duplicates`, cookieA);
    expect(dups.status).toBe(200);
    for (const gGroup of dups.data.groups) {
      expect((gGroup.records || []).length).toBeGreaterThanOrEqual(2); // every saved group is whole
    }

    await api('DELETE', `${SIFT}/${pid}`, cookieA);
  }, 60_000);
});
