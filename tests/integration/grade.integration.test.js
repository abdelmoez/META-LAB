/**
 * grade.integration.test.js — integration tests for the P12 /api/grade service
 * (per-outcome GRADE certainty + Summary of Findings).
 *
 * Live API at http://127.0.0.1:3001 (npm run server); SELF-SKIPS when down. Uses
 * 127.0.0.1 (never localhost — Windows ::1 flake). Toggles the `gradeCertainty`
 * feature flag via the seeded admin, drives the full workflow as a project owner,
 * verifies permission + lock invariants, then restores the flag to OFF.
 *
 * The pure GRADE engine (src/research-engine/grade) is built by a PARALLEL
 * workstream and may not be present at run time. When it is absent every
 * flag-ON endpoint answers 503 GRADE_ENGINE_UNAVAILABLE; the tests detect this and
 * assert the guard instead of the full flow, so the suite is meaningful either way.
 *
 * SERIAL / singleFork is enforced by the vitest integration config.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}
function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/metalab_session=[^;]+/);
  return m ? m[0] : '';
}
async function api(path, { method = 'GET', body, cookie, raw = false } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  if (raw) { data = await res.text().catch(() => ''); }
  else { try { data = await res.json(); } catch { data = null; } }
  return { status: res.status, data, cookie: cookieFrom(res), ctype: res.headers.get('content-type') || '' };
}
async function registerAndLogin(email, password, name = 'GRADE Test User') {
  const login = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (login.status === 200) return { user: login.data?.user, cookie: login.cookie };
  const reg = await api('/auth/register', { method: 'POST', body: { email, password, name } });
  return { user: reg.data?.user, cookie: reg.cookie };
}

const TS = Date.now();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@metalab.local';
const ADMIN_PASS = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';

let up = false;
let adminCookie = '';
let ownerCookie = '';
let intruderCookie = '';
let projectId = '';
let savedFlags = null;
let engineUp = true;      // flips false when the parallel engine is absent (503)
let flagEnabled = false;  // whether we could actually turn the flag ON
let outcomeKey = '';

async function setGradeFlag(value) {
  if (!adminCookie) return false;
  const cur = await api('/admin/feature-flags', { cookie: adminCookie });
  const flags = (cur.status === 200 && cur.data && typeof cur.data === 'object') ? cur.data : {};
  if (savedFlags === null) savedFlags = { ...flags };
  const put = await api('/admin/feature-flags', { method: 'PUT', cookie: adminCookie, body: { ...flags, gradeCertainty: value } });
  return put.status === 200;
}

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  const adm = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
  adminCookie = adm.status === 200 ? adm.cookie : '';

  const owner = await registerAndLogin(`grade-owner-${TS}@example.com`, 'GradeOwner123!', 'GRADE Owner');
  ownerCookie = owner.cookie;
  const intruder = await registerAndLogin(`grade-intruder-${TS}@example.com`, 'GradeIntruder123!', 'GRADE Intruder');
  intruderCookie = intruder.cookie;

  const proj = await api('/projects', { method: 'POST', cookie: ownerCookie, body: { name: `GRADE Project ${TS}` } });
  projectId = proj.data?.id || proj.data?.project?.id || '';

  // Seed 3 studies on one outcome (log OR + 95% CI) so the outcome pools.
  if (projectId) {
    const studies = [
      { author: 'Alpha', year: '2019', design: 'RCT', outcome: 'Mortality', timepoint: '6mo', esType: 'OR', es: '-0.3', lo: '-0.6', hi: '-0.02', n: '120', country: 'US' },
      { author: 'Bravo', year: '2020', design: 'RCT', outcome: 'Mortality', timepoint: '6mo', esType: 'OR', es: '-0.1', lo: '-0.4', hi: '0.2', n: '90', country: 'UK' },
      { author: 'Cir', year: '2021', design: 'RCT', outcome: 'Mortality', timepoint: '6mo', esType: 'OR', es: '-0.5', lo: '-0.9', hi: '-0.1', n: '150', country: 'DE' },
    ];
    for (const s of studies) await api(`/projects/${projectId}/studies`, { method: 'POST', cookie: ownerCookie, body: s });
  }
}, 45000);

afterAll(async () => {
  if (up && adminCookie) {
    const restore = savedFlags ? { ...savedFlags, gradeCertainty: savedFlags.gradeCertainty === true } : { gradeCertainty: false };
    await api('/admin/feature-flags', { method: 'PUT', cookie: adminCookie, body: restore }).catch(() => {});
  }
});

// ── 1. Auth + flag gating ──────────────────────────────────────────────────────
describe('/api/grade — auth + feature-flag gating', () => {
  it('401 when unauthenticated (requireAuth at mount, before the flag check)', async () => {
    if (!up) return;
    const res = await api(`/grade/projects/${projectId || 'x'}/outcomes`);
    expect(res.status).toBe(401);
  });
  it('404 for an authenticated caller while the gradeCertainty flag is OFF', async () => {
    if (!up || !adminCookie) return;
    await setGradeFlag(false);
    const res = await api(`/grade/projects/${projectId}/outcomes`, { cookie: ownerCookie });
    expect(res.status).toBe(404);
  });
});

// ── 2. Full workflow (flag ON) ──────────────────────────────────────────────────
describe('/api/grade — outcomes, save, lock, audit (flag ON)', () => {
  it('enables the flag and lists outcomes with a meta summary + suggestions', async () => {
    if (!up || !adminCookie || !projectId) return;
    flagEnabled = await setGradeFlag(true);
    expect(flagEnabled).toBe(true);
    const res = await api(`/grade/projects/${projectId}/outcomes`, { cookie: ownerCookie });
    if (res.status === 503) { engineUp = false; expect(res.data.code).toBe('GRADE_ENGINE_UNAVAILABLE'); return; }
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.outcomes)).toBe(true);
    expect(res.data.outcomes.length).toBeGreaterThan(0);
    const o = res.data.outcomes[0];
    outcomeKey = o.outcomeKey;
    expect(o.meta).toBeTruthy();
    expect(o.meta.k).toBe(3);          // 3 studies pooled
    expect(o.meta.pooled).toBe(true);
    expect(o).toHaveProperty('suggestions');
    expect(o).toHaveProperty('certainty');
    expect(o.confirmed).toBe(false);   // nothing saved yet → suggestion only
  });

  it('saving domains recomputes certainty + marks the outcome confirmed', async () => {
    if (!up || !flagEnabled || !engineUp || !outcomeKey) return;
    const res = await api(`/grade/projects/${projectId}/outcomes/${encodeURIComponent(outcomeKey)}`, {
      method: 'PUT', cookie: ownerCookie,
      body: { domains: { rob: 'serious', inconsistency: 'not_serious' }, notes: 'Two of three trials at some concern.' },
    });
    expect(res.status).toBe(200);
    const o = res.data.outcome;
    expect(o.confirmed).toBe(true);
    expect(o.assessment).toBeTruthy();
    expect(o.domains.rob.source).toBe('manual');   // human confirmation, not auto
    expect(o.certainty).toBeTruthy();
  });

  it('writes an audit row for the save', async () => {
    if (!up || !flagEnabled || !engineUp || !outcomeKey) return;
    const res = await api(`/grade/projects/${projectId}/audit`, { cookie: ownerCookie });
    expect(res.status).toBe(200);
    expect(res.data.entries.some((e) => e.action === 'SAVE' && e.outcomeKey === outcomeKey)).toBe(true);
  });

  it('lock blocks further writes (409); unlock re-enables them', async () => {
    if (!up || !flagEnabled || !engineUp || !outcomeKey) return;
    const lock = await api(`/grade/projects/${projectId}/outcomes/${encodeURIComponent(outcomeKey)}/lock`, { method: 'POST', cookie: ownerCookie });
    expect(lock.status).toBe(200);
    expect(lock.data.outcome.locked).toBe(true);

    const blocked = await api(`/grade/projects/${projectId}/outcomes/${encodeURIComponent(outcomeKey)}`, {
      method: 'PUT', cookie: ownerCookie, body: { domains: { imprecision: 'serious' } },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.data.code).toBe('GRADE_LOCKED');

    const unlock = await api(`/grade/projects/${projectId}/outcomes/${encodeURIComponent(outcomeKey)}/unlock`, { method: 'POST', cookie: ownerCookie });
    expect(unlock.status).toBe(200);
    expect(unlock.data.outcome.locked).toBe(false);

    const ok = await api(`/grade/projects/${projectId}/outcomes/${encodeURIComponent(outcomeKey)}`, {
      method: 'PUT', cookie: ownerCookie, body: { domains: { imprecision: 'serious' } },
    });
    expect(ok.status).toBe(200);
  });

  it('audit history records LOCK + UNLOCK', async () => {
    if (!up || !flagEnabled || !engineUp || !outcomeKey) return;
    const res = await api(`/grade/projects/${projectId}/audit`, { cookie: ownerCookie });
    const actions = new Set(res.data.entries.map((e) => e.action));
    expect(actions.has('LOCK')).toBe(true);
    expect(actions.has('UNLOCK')).toBe(true);
  });
});

// ── 3. Summary of Findings export ────────────────────────────────────────────────
describe('/api/grade — Summary of Findings (json/csv/html)', () => {
  it('returns a JSON SoF with a certainty column + footnotes', async () => {
    if (!up || !flagEnabled || !engineUp || !projectId) return;
    const res = await api(`/grade/projects/${projectId}/sof?format=json`, { cookie: ownerCookie });
    expect(res.status).toBe(200);
    expect(res.data.table).toBeTruthy();
    expect(res.data.table.columns.some((c) => c.key === 'certainty')).toBe(true);
    expect(Array.isArray(res.data.footnotes)).toBe(true);
  });
  it('returns a CSV SoF', async () => {
    if (!up || !flagEnabled || !engineUp || !projectId) return;
    const res = await api(`/grade/projects/${projectId}/sof?format=csv`, { cookie: ownerCookie, raw: true });
    expect(res.status).toBe(200);
    expect(res.ctype).toContain('text/csv');
    expect(res.data).toContain('Certainty');
  });
  it('returns an HTML SoF with a table + footnotes', async () => {
    if (!up || !flagEnabled || !engineUp || !projectId) return;
    const res = await api(`/grade/projects/${projectId}/sof?format=html`, { cookie: ownerCookie, raw: true });
    expect(res.status).toBe(200);
    expect(res.ctype).toContain('text/html');
    expect(res.data).toContain('<table>');
  });
});

// ── 4. Permission invariants ─────────────────────────────────────────────────────
describe('/api/grade — permission invariants', () => {
  it('a non-owner cannot list another user\'s outcomes (404, existence hidden)', async () => {
    if (!up || !flagEnabled || !projectId) return;
    const res = await api(`/grade/projects/${projectId}/outcomes`, { cookie: intruderCookie });
    expect(res.status).toBe(404);
  });
  it('a non-owner cannot save to another user\'s outcome (404)', async () => {
    if (!up || !flagEnabled || !projectId || !outcomeKey) return;
    const res = await api(`/grade/projects/${projectId}/outcomes/${encodeURIComponent(outcomeKey)}`, {
      method: 'PUT', cookie: intruderCookie, body: { domains: { rob: 'serious' } },
    });
    expect(res.status).toBe(404);
  });
  it('a non-owner cannot read the audit log (404)', async () => {
    if (!up || !flagEnabled || !projectId) return;
    const res = await api(`/grade/projects/${projectId}/audit`, { cookie: intruderCookie });
    expect(res.status).toBe(404);
  });
});
