#!/usr/bin/env node
/**
 * scripts/loadtest/beta-load.mjs — beta load-test driver (93.md Phase 10).
 *
 * Dependency-free virtual-user (VU) driver that simulates 20–50 concurrent beta
 * users against a LOCALLY RUNNING dev server. It exercises the real product
 * APIs end-to-end (auth → projects → screening → jobs) and reports per-scenario
 * latency percentiles, error rates and — when admin credentials are provided —
 * server-side event-loop delay / heap / job-queue depths from
 * GET /api/admin/metrics/runtime (the bare /api/admin/metrics path is the
 * legacy Admin Console dashboard payload — different shape).
 *
 * REQUIREMENTS (read docs/manager/load-testing.md for the full story):
 *   - The target server must NOT run NODE_ENV=production: the driver registers
 *     loadtest-user-<i>@example.test accounts through /api/auth/register and
 *     relies on the dev-mode auth rate limit (5000/15min). Production limits
 *     would throttle the seed phase immediately.
 *   - SMTP should be unconfigured (dev default) — registration then logs
 *     instead of emailing. The driver never triggers provider traffic:
 *     /api/pecan-search, /api/citation* and OA retrieval endpoints are
 *     deliberately NOT in the scenario mix because they call third-party APIs
 *     (NCBI, OpenAlex, Unpaywall…) — load-testing those would hammer external
 *     services and violate their terms.
 *
 * SCENARIOS (weighted mix, per 93.md): login, dashboard list, project open,
 * project create (low), small study import, screening decisions, duplicate-
 * detection job submit+poll, AI-score submit+poll (self-disables when the
 * aiScreening flag / tier gate rejects), extraction autosave, manuscript
 * autosave (both via the CAS-guarded project autosave), export start+poll
 * (self-disables on admin/tier gate), health + readiness.
 *
 * CONFIG (env): BASE_URL (http://127.0.0.1:3001), VUS (25), DURATION_S (120),
 * RAMP_S (10), THINK_MS (500), THRESH_P95_MS (2000), THRESH_ERR_RATE (0.02),
 * ADMIN_EMAIL + ADMIN_PASSWORD (enables /api/admin/metrics/runtime polling every 10s).
 *
 * OUTPUT: a human table on stdout + scripts/loadtest/last-run.json. Exit code
 * is non-zero when a measured scenario's p95 exceeds THRESH_P95_MS or the
 * overall error rate exceeds THRESH_ERR_RATE (initial thresholds — tune as the
 * app's real envelope becomes known).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── Config ────────────────────────────────────────────────────────────────── */
const int = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.trunc(Number(v)) : d);
const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);

const CFG = {
  baseUrl: (process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  vus: Math.max(1, int(process.env.VUS, 25)),
  durationS: Math.max(5, int(process.env.DURATION_S, 120)),
  rampS: Math.max(0, int(process.env.RAMP_S, 10)),
  thinkMs: Math.max(0, int(process.env.THINK_MS, 500)),
  threshP95Ms: int(process.env.THRESH_P95_MS, 2000),
  threshErrRate: num(process.env.THRESH_ERR_RATE, 0.02),
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
};
const API = `${CFG.baseUrl}/api`;
const PASSWORD = 'LoadTest123!pass';
const UA = 'metalab-loadtest/1.0 (93.md Phase 10)';
const OUT_JSON = join(dirname(fileURLToPath(import.meta.url)), 'last-run.json');

/* ── Metrics store ─────────────────────────────────────────────────────────── */
const stats = new Map(); // scenario -> { requests, errors, samples: number[], notes: Set }
function bucket(name) {
  if (!stats.has(name)) stats.set(name, { requests: 0, errors: 0, samples: [], notes: new Set() });
  return stats.get(name);
}
function record(name, ms, ok, note) {
  const b = bucket(name);
  b.requests += 1;
  if (ms >= 0) b.samples.push(ms);
  if (!ok) b.errors += 1;
  if (note) b.notes.add(String(note).slice(0, 160));
}
function pct(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]);
}

/* ── HTTP helper (cookie-jar-per-VU, per-request latency sampling) ─────────── */
const cookieFrom = (res) => {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/metalab_session=[^;,\s]+/);
  return m ? m[0] : '';
};

/**
 * One measured HTTP call. `accept` lists NON-2xx statuses that count as OK for
 * this scenario (e.g. an autosave 409 = the CAS guard working as designed).
 */
async function call(scenario, method, path, { cookie, body, timeoutMs = 30_000, accept = [] } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(API + path, {
      method,
      headers: {
        'User-Agent': UA,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const ms = performance.now() - t0;
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    const ok = res.status < 400 || accept.includes(res.status);
    record(scenario, ms, ok, ok ? null : `${method} ${path} -> ${res.status}${data && data.error ? ` (${data.error})` : ''}`);
    return { status: res.status, data, setCookie: cookieFrom(res) };
  } catch (e) {
    record(scenario, performance.now() - t0, false, `${method} ${path} -> ${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
    return { status: 0, data: null, setCookie: '' };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);
const pickFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ── Seed data helpers ─────────────────────────────────────────────────────── */
const risRecords = (n, tag) => Array.from({ length: n }, (_, i) =>
  `TY  - JOUR\nTI  - Load study ${tag} number ${i}\nAU  - Tester ${i}\nPY  - 2024\nDO  - 10.9999/${tag}.${i}\nER  - `).join('\n');

async function loginOrRegister(email, name) {
  const login = await call('seed', 'POST', '/auth/login', { body: { email, password: PASSWORD }, accept: [400, 401, 404] });
  if (login.status < 400 && login.setCookie) return login.setCookie;
  const reg = await call('seed', 'POST', '/auth/register', { body: { email, password: PASSWORD, name } });
  if (reg.status === 429) {
    throw new Error('auth rate-limited (429): the target server is likely running NODE_ENV=production — load testing requires the dev-mode limits.');
  }
  if (reg.setCookie) return reg.setCookie;
  // Registered on a previous run but the first login raced? One more login try.
  const again = await call('seed', 'POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (again.setCookie) return again.setCookie;
  throw new Error(`could not log in or register ${email} (register=${reg.status}, login=${again.status}). Is the betaWaitlist flag blocking open registration?`);
}

function extractRecords(data) {
  if (!data) return [];
  const arr = Array.isArray(data) ? data : (data.records || data.items || []);
  return arr.map((r) => r && r.id).filter(Boolean);
}
function extractProjects(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : (data.projects || []);
}

/** Idempotent: reuse the pair project by title, else create; seed a stable batch. */
async function ensurePairProject(vu, pairIdx) {
  const title = `Load Test Pair ${pairIdx}`;
  const list = await call('seed', 'GET', '/screening/projects', { cookie: vu.cookie });
  const existing = extractProjects(list.data).find((p) => p && p.title === title);
  let pid = existing ? existing.id : null;
  if (!pid) {
    const created = await call('seed', 'POST', '/screening/projects', { cookie: vu.cookie, body: { title } });
    pid = created.data && created.data.id;
  }
  if (!pid) return null;
  // Stable tag → record-level dedupe keeps re-runs at 0 new records; a rerun's
  // file-hash 409 (duplicate_import) IS the idempotency working — accept it.
  await call('seed', 'POST', `/screening/projects/${pid}/import`, {
    cookie: vu.cookie,
    body: { format: 'auto', content: risRecords(30, `seedpair${pairIdx}`), filename: `seed-pair-${pairIdx}.ris` },
    timeoutMs: 60_000,
    accept: [409],
  });
  return pid;
}

async function loadRecordIds(vu) {
  const r = await call('seed', 'GET', `/screening/projects/${vu.screenPid}/records`, { cookie: vu.cookie });
  vu.recordIds = extractRecords(r.data);
}

/* ── Flag-gated scenario switches (probe once, self-disable with a note) ───── */
const gates = {
  aiScoring: { enabled: true, note: null },
  export: { enabled: true, note: null },
};
function disableGate(name, note) {
  if (gates[name].enabled) {
    gates[name].enabled = false;
    gates[name].note = note;
    bucket(name === 'aiScoring' ? 'aiRun' : 'exportRun').notes.add(`self-disabled: ${note}`);
  }
}

/* ── Scenarios ─────────────────────────────────────────────────────────────── */
const DECISIONS = ['include', 'exclude', 'maybe'];

const SCENARIOS = [
  { name: 'health', weight: 10, async fn() {
    await call('health', 'GET', '/health', { timeoutMs: 10_000 });
    await call('health', 'GET', '/health/ready', { timeoutMs: 10_000 });
  } },

  { name: 'login', weight: 4, async fn(vu) {
    const r = await call('login', 'POST', '/auth/login', { body: { email: vu.email, password: PASSWORD } });
    if (r.setCookie) vu.cookie = r.setCookie;
  } },

  { name: 'dashboard', weight: 14, async fn(vu) {
    await call('dashboard', 'GET', '/projects', { cookie: vu.cookie });
  } },

  { name: 'projectOpen', weight: 14, async fn(vu) {
    if (!vu.screenPid) return;
    await call('projectOpen', 'GET', `/screening/projects/${vu.screenPid}`, { cookie: vu.cookie });
    const r = await call('projectOpen', 'GET', `/screening/projects/${vu.screenPid}/records`, { cookie: vu.cookie });
    const ids = extractRecords(r.data);
    if (ids.length) vu.recordIds = ids;
  } },

  { name: 'projectCreate', weight: 2, async fn(vu) {
    const r = await call('projectCreate', 'POST', '/screening/projects', { cookie: vu.cookie, body: { title: `LT tmp ${vu.id}-${rnd()}` } });
    const pid = r.data && r.data.id;
    if (pid) await call('projectCreate', 'DELETE', `/screening/projects/${pid}`, { cookie: vu.cookie });
  } },

  // Import/dedup/AI/export are OWNER actions: the reviewer preset a paired VU
  // joins with deliberately lacks those permissions (server returns 403 by
  // design), so only owner VUs exercise them — also the realistic beta mix.
  { name: 'importSmall', weight: 5, async fn(vu) {
    if (!vu.screenPid || !vu.isOwner) return;
    await call('importSmall', 'POST', `/screening/projects/${vu.screenPid}/import`, {
      cookie: vu.cookie,
      body: { format: 'auto', content: risRecords(15, `it${vu.id}${rnd()}`), filename: `iter-${rnd()}.ris` },
      timeoutMs: 60_000,
    });
  } },

  { name: 'decision', weight: 20, async fn(vu) {
    if (!vu.screenPid) return;
    if (!vu.recordIds.length) { await loadRecordIds(vu); if (!vu.recordIds.length) return; }
    const rid = pickFrom(vu.recordIds);
    await call('decision', 'POST', `/screening/projects/${vu.screenPid}/records/${rid}/decision`, {
      cookie: vu.cookie,
      body: { decision: pickFrom(DECISIONS), stage: 'title_abstract' },
    });
  } },

  { name: 'dedup', weight: 5, async fn(vu) {
    if (!vu.screenPid || !vu.isOwner) return;
    // 409/429 = the single-active-job / per-user cap guards doing their job.
    const start = await call('dedup', 'POST', `/screening/projects/${vu.screenPid}/duplicates/detect`, {
      cookie: vu.cookie, body: {}, accept: [409, 429],
    });
    const jobId = start.data && start.data.job && start.data.job.id;
    if (!jobId) return;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const j = await call('dedup', 'GET', `/screening/projects/${vu.screenPid}/duplicates/jobs/${jobId}`, { cookie: vu.cookie, timeoutMs: 10_000 });
      const st = j.data && j.data.job && j.data.job.status;
      if (['completed', 'failed', 'cancelled'].includes(st) || j.status >= 400) break;
      await sleep(400);
    }
  } },

  { name: 'aiRun', weight: 3, async fn(vu) {
    if (!gates.aiScoring.enabled || !vu.screenPid || !vu.isOwner) return;
    const r = await call('aiRun', 'POST', `/screening/projects/${vu.screenPid}/ai/run`, {
      cookie: vu.cookie, body: {}, accept: [402, 403, 409, 429],
    });
    if ([402, 403].includes(r.status)) {
      disableGate('aiScoring', (r.data && r.data.error) || `HTTP ${r.status} (flag/tier gate)`);
      return;
    }
    if (r.status !== 202 && r.status !== 200) return;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const j = await call('aiRun', 'GET', `/screening/projects/${vu.screenPid}/ai/job-status`, { cookie: vu.cookie, timeoutMs: 10_000 });
      const d = j.data || {};
      const state = d.status || d.state || '';
      if (j.status >= 400 || d.running === false || ['completed', 'failed', 'idle', 'error'].includes(state)) break;
      await sleep(400);
    }
  } },

  { name: 'extractionAutosave', weight: 9, async fn(vu) {
    if (!vu.mlId) return;
    const body = {
      name: vu.mlName,
      studies: [{
        id: `s-${vu.id}`, name: `Study ${vu.id}`,
        extraction: { values: { meanA: Math.random() * 10, meanB: Math.random() * 10, n: 40 + vu.id, updated: Date.now() } },
      }],
      _baseRev: vu.mlRev,
    };
    const r = await call('extractionAutosave', 'PUT', `/projects/${vu.mlId}/autosave`, { cookie: vu.cookie, body, accept: [409] });
    if (r.status === 409 && r.data && r.data.project) vu.mlRev = r.data.project.autosaveRev ?? vu.mlRev;
    else if (r.data && r.data.autosaveRev != null) vu.mlRev = r.data.autosaveRev;
  } },

  { name: 'manuscriptAutosave', weight: 9, async fn(vu) {
    if (!vu.mlId) return;
    const body = {
      name: vu.mlName,
      documents: [{ id: 'doc-main', title: 'Manuscript', content: `Load-test paragraph ${rnd()} `.repeat(30) }],
      _baseRev: vu.mlRev,
    };
    const r = await call('manuscriptAutosave', 'PUT', `/projects/${vu.mlId}/autosave`, { cookie: vu.cookie, body, accept: [409] });
    if (r.status === 409 && r.data && r.data.project) vu.mlRev = r.data.project.autosaveRev ?? vu.mlRev;
    else if (r.data && r.data.autosaveRev != null) vu.mlRev = r.data.autosaveRev;
  } },

  { name: 'exportRun', weight: 5, async fn(vu) {
    if (!gates.export.enabled || !vu.screenPid || !vu.isOwner) return;
    const start = await call('exportRun', 'POST', `/screening/projects/${vu.screenPid}/export/start`, {
      cookie: vu.cookie, body: { format: 'csv', filter: 'all' }, accept: [402, 403, 429],
    });
    if ([402, 403, 429].includes(start.status)) {
      disableGate('export', (start.data && start.data.error) || `HTTP ${start.status} (admin/tier gate)`);
      return;
    }
    const jobId = start.data && start.data.jobId;
    if (!jobId) return;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const j = await call('exportRun', 'GET', `/screening/projects/${vu.screenPid}/export/jobs/${jobId}`, { cookie: vu.cookie, timeoutMs: 10_000 });
      const st = (j.data && (j.data.status || (j.data.job && j.data.job.status))) || '';
      if (['completed', 'failed', 'cancelled'].includes(st) || j.status >= 400) break;
      await sleep(400);
    }
  } },
];

const totalWeight = SCENARIOS.reduce((s, x) => s + x.weight, 0);
function pickScenario() {
  let roll = Math.random() * totalWeight;
  for (const s of SCENARIOS) { roll -= s.weight; if (roll <= 0) return s; }
  return SCENARIOS[SCENARIOS.length - 1];
}

/* ── Seed phase (idempotent) ───────────────────────────────────────────────── */
async function seedVu(i) {
  const vu = {
    id: i,
    email: `loadtest-user-${i}@example.test`,
    cookie: '',
    screenPid: null,
    isOwner: false,
    recordIds: [],
    mlId: `loadtest-ml-${i}`,
    mlName: `Load Test ML ${i}`,
    mlRev: null,
  };
  vu.cookie = await loginOrRegister(vu.email, `Load Tester ${i}`);

  // META·LAB project (autosave IS the create path for client-id projects) —
  // this is the surface the extraction/manuscript autosave scenarios write to.
  const ml = await call('seed', 'PUT', `/projects/${vu.mlId}/autosave`, {
    cookie: vu.cookie, body: { name: vu.mlName, studies: [] },
  });
  if (ml.data && ml.data.autosaveRev != null) vu.mlRev = ml.data.autosaveRev;

  return vu;
}

async function seedPairs(vus) {
  // Even VU of each pair owns the shared screening project.
  for (const vu of vus) {
    if (vu.id % 2 !== 0) continue;
    vu.screenPid = await ensurePairProject(vu, vu.id / 2);
    vu.isOwner = !!vu.screenPid;
    if (vu.screenPid) await loadRecordIds(vu);
  }
  // Odd VUs join their pair's project (idempotent: 409 = already a member).
  for (const vu of vus) {
    if (vu.id % 2 === 0) continue;
    const owner = vus[vu.id - 1];
    if (owner && owner.screenPid) {
      await call('seed', 'POST', `/screening/projects/${owner.screenPid}/members`, {
        cookie: owner.cookie, body: { email: vu.email, preset: 'reviewer' }, accept: [409],
      });
      // Verify the membership actually grants access; fall back to a solo project.
      const check = await call('seed', 'GET', `/screening/projects/${owner.screenPid}`, { cookie: vu.cookie, accept: [403, 404] });
      if (check.status < 400) {
        vu.screenPid = owner.screenPid;
        vu.isOwner = false; // reviewer preset: screen + read only, by design
        await loadRecordIds(vu);
      }
    }
    if (!vu.screenPid) {
      vu.screenPid = await ensurePairProject(vu, `solo${vu.id}`);
      vu.isOwner = !!vu.screenPid;
      if (vu.screenPid) await loadRecordIds(vu);
    }
  }
}

/* ── Admin metrics poller (every 10s when credentials are provided) ────────── */
const adminSnapshots = [];
async function adminPoller(deadline) {
  if (!CFG.adminEmail || !CFG.adminPassword) {
    bucket('adminMetrics').notes.add('skipped: ADMIN_EMAIL/ADMIN_PASSWORD not provided');
    return;
  }
  const login = await call('adminMetrics', 'POST', '/auth/login', { body: { email: CFG.adminEmail, password: CFG.adminPassword } });
  if (!login.setCookie) {
    bucket('adminMetrics').notes.add('skipped: admin login failed');
    return;
  }
  const cookie = login.setCookie;
  while (Date.now() < deadline) {
    const r = await call('adminMetrics', 'GET', '/admin/metrics/runtime', { cookie, timeoutMs: 10_000 });
    if (r.status < 400 && r.data) adminSnapshots.push(r.data);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(10_000, remaining));
  }
}

/* ── VU loop ───────────────────────────────────────────────────────────────── */
async function vuLoop(vu, startAt, deadline) {
  const wait = startAt - Date.now();
  if (wait > 0) await sleep(wait);
  while (Date.now() < deadline) {
    const s = pickScenario();
    try {
      await s.fn(vu);
    } catch (e) {
      record(s.name, -1, false, `scenario threw: ${e.message}`);
    }
    if (Date.now() >= deadline) break;
    await sleep(CFG.thinkMs * (0.5 + Math.random()));
  }
}

/* ── Summary / thresholds / output ─────────────────────────────────────────── */
const MEASURED = SCENARIOS.map((s) => s.name); // seed + adminMetrics excluded from gating

function buildSummary(elapsedS) {
  const scenarios = {};
  let totalReq = 0, totalErr = 0;
  for (const [name, b] of stats) {
    scenarios[name] = {
      requests: b.requests,
      errors: b.errors,
      errRate: b.requests ? +(b.errors / b.requests).toFixed(4) : 0,
      p50: pct(b.samples, 50), p95: pct(b.samples, 95), p99: pct(b.samples, 99),
      notes: [...b.notes].slice(0, 8),
    };
    if (MEASURED.includes(name)) { totalReq += b.requests; totalErr += b.errors; }
  }
  const admin = adminSnapshots.length ? {
    samples: adminSnapshots.length,
    eventLoopDelayP95MaxMs: Math.max(...adminSnapshots.map((s) => s.eventLoopDelayMs?.p95 ?? 0)),
    eventLoopDelayMaxMs: Math.max(...adminSnapshots.map((s) => s.eventLoopDelayMs?.max ?? 0)),
    heapUsedMaxMb: Math.max(...adminSnapshots.map((s) => s.memory?.heapUsedMb ?? 0)),
    rssMaxMb: Math.max(...adminSnapshots.map((s) => s.memory?.rssMb ?? 0)),
    dbPingMaxMs: Math.max(...adminSnapshots.map((s) => s.dbPingMs ?? 0)),
    queueDepthMax: adminSnapshots.reduce((acc, s) => {
      for (const [q, d] of Object.entries(s.queues || {})) {
        acc[q] = Math.max(acc[q] || 0, (d.queued || 0) + (d.processing || 0));
      }
      return acc;
    }, {}),
    lastSnapshot: adminSnapshots[adminSnapshots.length - 1],
  } : null;

  const breaches = [];
  for (const name of MEASURED) {
    const s = scenarios[name];
    if (s && s.p95 != null && s.p95 > CFG.threshP95Ms) breaches.push(`${name} p95 ${s.p95}ms > ${CFG.threshP95Ms}ms`);
  }
  const overallErrRate = totalReq ? totalErr / totalReq : 0;
  if (overallErrRate > CFG.threshErrRate) breaches.push(`overall error rate ${(overallErrRate * 100).toFixed(2)}% > ${(CFG.threshErrRate * 100).toFixed(2)}%`);

  return {
    startedAt: new Date(START_TS).toISOString(),
    config: { ...CFG, adminPassword: CFG.adminPassword ? '***' : '' },
    elapsedS: +elapsedS.toFixed(1),
    scenarios,
    overall: {
      requests: totalReq, errors: totalErr,
      errRate: +overallErrRate.toFixed(4),
      rps: +(totalReq / Math.max(1, elapsedS)).toFixed(1),
    },
    adminMetrics: admin,
    thresholds: { p95Ms: CFG.threshP95Ms, errRate: CFG.threshErrRate },
    breaches,
    passed: breaches.length === 0,
  };
}

function printTable(summary) {
  const cols = ['scenario', 'req', 'err', 'err%', 'p50ms', 'p95ms', 'p99ms'];
  const rows = Object.entries(summary.scenarios).map(([name, s]) => [
    name, String(s.requests), String(s.errors), (s.errRate * 100).toFixed(1),
    s.p50 == null ? '-' : String(s.p50), s.p95 == null ? '-' : String(s.p95), s.p99 == null ? '-' : String(s.p99),
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => c.padEnd(widths[i] + 2)).join('');
  console.log('\n' + line(cols));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(r));
  console.log(`\noverall: ${summary.overall.requests} requests | ${summary.overall.errors} errors (${(summary.overall.errRate * 100).toFixed(2)}%) | ${summary.overall.rps} req/s over ${summary.elapsedS}s`);
  if (summary.adminMetrics) {
    const a = summary.adminMetrics;
    console.log(`server:  event-loop p95 max ${a.eventLoopDelayP95MaxMs}ms | heap max ${a.heapUsedMaxMb}MB | rss max ${a.rssMaxMb}MB | db ping max ${a.dbPingMaxMs}ms | queues ${JSON.stringify(a.queueDepthMax)}`);
  }
  for (const [name, s] of Object.entries(summary.scenarios)) {
    for (const n of s.notes) console.log(`note [${name}]: ${n}`);
  }
  if (summary.breaches.length) {
    console.log('\nTHRESHOLD BREACHES:');
    for (const b of summary.breaches) console.log(`  - ${b}`);
  }
  console.log(summary.passed ? '\nRESULT: PASS' : '\nRESULT: FAIL');
}

/* ── Main ──────────────────────────────────────────────────────────────────── */
const START_TS = Date.now();

async function main() {
  console.log(`beta-load: ${CFG.vus} VUs for ${CFG.durationS}s (ramp ${CFG.rampS}s) against ${CFG.baseUrl}`);

  // Preflight: refuse to run against a dead (or unreachable) server.
  try {
    const h = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': UA } });
    if (!h.ok) throw new Error(`/api/health returned ${h.status}`);
  } catch (e) {
    console.error(`beta-load: target server is not reachable at ${API}/health — ${e.message}`);
    console.error('Start it first, e.g.: PORT=3001 node server/index.js  (NODE_ENV must NOT be production)');
    process.exit(2);
  }

  // Seed (idempotent; excluded from measured stats via the "seed" bucket).
  console.log('seed: registering/logging in VUs and provisioning pair projects…');
  const vus = [];
  for (let i = 0; i < CFG.vus; i++) vus.push(await seedVu(i)); // sequential: gentle on the auth limiter
  await seedPairs(vus);
  const ready = vus.filter((v) => v.screenPid).length;
  console.log(`seed: done — ${vus.length} VUs, ${ready} with a screening project.`);

  // Load phase.
  const loadStart = Date.now();
  const deadline = loadStart + CFG.durationS * 1000;
  const loops = vus.map((vu, i) => vuLoop(vu, loadStart + (CFG.rampS * 1000 * i) / Math.max(1, CFG.vus), deadline));
  loops.push(adminPoller(deadline));
  await Promise.all(loops);
  const elapsedS = (Date.now() - loadStart) / 1000;

  // Report.
  const summary = buildSummary(elapsedS);
  try {
    mkdirSync(dirname(OUT_JSON), { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
    console.log(`\nJSON written to ${OUT_JSON}`);
  } catch (e) {
    console.error(`could not write ${OUT_JSON}: ${e.message}`);
  }
  printTable(summary);
  process.exit(summary.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(`beta-load: fatal — ${e.message}`);
  process.exit(2);
});
