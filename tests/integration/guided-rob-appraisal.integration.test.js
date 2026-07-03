/**
 * guided-rob-appraisal.integration.test.js — integration tests for P14
 * (Guided RoB appraisal: RoB 2 + ROBINS-I), the SERVER half.
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost. Toggles BOTH the rob_engine_v2 and the new
 * guidedRobAppraisal feature flags via the seeded admin (admin@example.com /
 * ADMIN_SEED_PASSWORD), exercises the guided appraisal + validation endpoints as
 * a normal project owner, verifies the SAFETY-CRITICAL invariant that machine
 * suggestions NEVER touch human judgements, checks RoB 2 is unchanged and
 * ROBINS-I (7 domains / 5-level) works, then restores both flags to OFF.
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
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function registerAndLogin(email, password, name = 'Appraisal Test User') {
  const login = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (login.status === 200) return { user: login.data?.user, cookie: login.cookie };
  const reg = await api('/auth/register', { method: 'POST', body: { email, password, name } });
  return { user: reg.data?.user, cookie: reg.cookie };
}

const TS = Date.now();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASS = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';

// Text bodies rich in the deterministic engine's cue phrases so appraisal yields
// evidence-backed suggestions (not just "No information").
const ROBINS_TEXT =
  'This was a retrospective cohort study using routinely collected electronic health record data. ' +
  'The analysis adjusted for confounders using a propensity score model. ' +
  'Outcome assessors were blinded to the intervention received. ' +
  'There were no missing data; complete data were available for all participants. ' +
  'The reported outcomes were pre-registered in a registered protocol.';
const ROB2_TEXT =
  'Participants were randomly assigned using a computer-generated random sequence, with central allocation concealment. ' +
  'The trial was double-blind and placebo-controlled. Analysis followed the intention-to-treat principle. ' +
  'There was complete follow-up with no loss to follow-up. Outcome assessors were blinded. ' +
  'The protocol was pre-registered on ClinicalTrials.gov.';

let up = false;
let adminCookie = '';
let ownerCookie = '';
let intruderCookie = '';
let projectId = '';
let savedFlags = null;

// GET current flags, merge `patch`, PUT the whole object (mirrors the Ops UI).
async function setFlags(patch) {
  if (!adminCookie) return false;
  const cur = await api('/admin/feature-flags', { cookie: adminCookie });
  const flags = (cur.status === 200 && cur.data && typeof cur.data === 'object') ? cur.data : {};
  if (savedFlags === null) savedFlags = { ...flags };
  const put = await api('/admin/feature-flags', { method: 'PUT', cookie: adminCookie, body: { ...flags, ...patch } });
  return put.status === 200;
}

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  const adm = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
  adminCookie = adm.status === 200 ? adm.cookie : '';

  const owner = await registerAndLogin(`appraise-owner-${TS}@example.com`, 'ApprOwner123!', 'Appraisal Owner');
  ownerCookie = owner.cookie;
  const intruder = await registerAndLogin(`appraise-intruder-${TS}@example.com`, 'ApprIntruder123!', 'Appraisal Intruder');
  intruderCookie = intruder.cookie;

  const proj = await api('/projects', { method: 'POST', cookie: ownerCookie, body: { name: `Appraisal Project ${TS}` } });
  projectId = proj.data?.id || proj.data?.project?.id || '';
}, 30000);

afterAll(async () => {
  // Restore both flags to their prior (default OFF) state.
  if (up && adminCookie) {
    const restore = savedFlags
      ? { ...savedFlags, rob_engine_v2: savedFlags.rob_engine_v2 === true, guidedRobAppraisal: savedFlags.guidedRobAppraisal === true }
      : { rob_engine_v2: false, guidedRobAppraisal: false };
    await api('/admin/feature-flags', { method: 'PUT', cookie: adminCookie, body: restore }).catch(() => {});
  }
});

// ── 1. Flag gating: rob_engine_v2 ON but guidedRobAppraisal OFF → 404 ──────────
describe('P14 — guided appraisal flag gating', () => {
  let assessmentId = '';

  it('with rob_engine_v2 ON but guidedRobAppraisal OFF, appraise + validation 404', async () => {
    if (!up || !adminCookie || !projectId) return;
    expect(await setFlags({ rob_engine_v2: true, guidedRobAppraisal: false })).toBe(true);

    // The RoB engine is on, so a ROBINS-I assessment can be created…
    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: `robins-gate-${TS}`, instrumentId: 'ROBINS-I' },
    });
    expect(created.status).toBe(201);
    assessmentId = created.data.assessment.id;

    // …but the appraise + validation endpoints are hidden until the P14 flag is on.
    const ap = await api(`/rob/assessments/${assessmentId}/appraise`, { method: 'POST', cookie: ownerCookie, body: { fullText: ROBINS_TEXT } });
    expect(ap.status).toBe(404);
    const val = await api(`/rob/projects/${projectId}/rob-validation`, { cookie: ownerCookie });
    expect(val.status).toBe(404);
  });
});

// ── 2. ROBINS-I: instrument-aware create + guided appraisal ────────────────────
describe('P14 — ROBINS-I guided appraisal (7 domains / 5-level)', () => {
  let robinsId = '';

  it('serves the ROBINS-I instrument (7 domains, 5 judgement levels)', async () => {
    if (!up || !adminCookie) return;
    expect(await setFlags({ rob_engine_v2: true, guidedRobAppraisal: true })).toBe(true);
    const inst = await api('/rob/instruments/robins-i', { cookie: ownerCookie });
    expect(inst.status).toBe(200);
    expect(inst.data.instrument.id).toBe('ROBINS-I');
    expect(inst.data.instrument.domains).toHaveLength(7);
    expect(inst.data.instrument.judgmentLevels).toHaveLength(5);
    // /instruments/rob2 still resolves (back-compat).
    const rob2 = await api('/rob/instruments/rob2', { cookie: ownerCookie });
    expect(rob2.status).toBe(200);
    expect(rob2.data.instrument.id).toBe('RoB2');
  });

  it('creates a ROBINS-I assessment with 7 domains', async () => {
    if (!up || !adminCookie || !projectId) return;
    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: `robins-appraise-${TS}`, instrumentId: 'ROBINS-I' },
    });
    expect(created.status).toBe(201);
    robinsId = created.data.assessment.id;
    expect(created.data.assessment.instrumentId).toBe('ROBINS-I');
    expect(created.data.assessment.domains).toHaveLength(7);
  });

  it('rejects an unsupported instrumentId (400)', async () => {
    if (!up || !adminCookie || !projectId) return;
    const bad = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId: 'x', instrumentId: 'QUADAS-2' } });
    expect(bad.status).toBe(400);
  });

  it('appraise populates proposed + evidence + aiConfidence WITHOUT touching final/overridden', async () => {
    if (!up || !adminCookie || !robinsId) return;
    const ap = await api(`/rob/assessments/${robinsId}/appraise`, { method: 'POST', cookie: ownerCookie, body: { fullText: ROBINS_TEXT } });
    expect(ap.status).toBe(200);
    expect(ap.data.appraisal.instrumentId).toBe('ROBINS-I');
    expect(ap.data.written).toBeGreaterThan(0);

    const view = ap.data.assessment;
    // Machine suggestions carry provenance + confidence; at least one has evidence.
    const suggested = view.answerMeta.filter(m => m.aiSuggested === true);
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.every(m => m.aiModel === 'pecan-rob-appraisal' && m.aiModelVersion)).toBe(true);
    const withEvidence = suggested.filter(m => m.evidenceQuote && typeof m.aiConfidence === 'number' && m.evidenceLocator);
    expect(withEvidence.length).toBeGreaterThan(0);

    // Proposed judgements are set and use the ROBINS-I 5-level vocabulary.
    const levels = new Set(['low', 'moderate', 'serious', 'critical', 'ni']);
    expect(view.domains).toHaveLength(7);
    expect(view.domains.every(d => levels.has(d.proposedJudgment))).toBe(true);

    // SAFETY-CRITICAL: no human field was written by the appraise path.
    expect(view.domains.every(d => d.finalJudgment === null && d.overridden === false)).toBe(true);
    expect(view.overall.finalOverall).toBeNull();
    expect(view.overall.overridden).toBe(false);
  });

  it('re-running appraise never overwrites an existing HUMAN answer (skip unless force)', async () => {
    if (!up || !adminCookie || !projectId) return;
    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: `robins-clobber-${TS}`, instrumentId: 'ROBINS-I' },
    });
    const id = created.data.assessment.id;
    // A human answers 1.4 = N (unadjusted) with their own evidence note.
    const humanNote = 'HUMAN: crude unadjusted analysis only';
    await api(`/rob/assessments/${id}/answers`, { method: 'PUT', cookie: ownerCookie, body: { answers: [{ questionId: '1.4', response: 'N', evidenceQuote: humanNote }] } });

    // The engine WOULD suggest 1.4 = Y (propensity score) — it must NOT clobber the human.
    const ap = await api(`/rob/assessments/${id}/appraise`, { method: 'POST', cookie: ownerCookie, body: { fullText: 'The analysis adjusted for confounders using a propensity score model.' } });
    expect(ap.status).toBe(200);
    expect(ap.data.skipped).toBeGreaterThan(0);

    const m14 = ap.data.assessment.answerMeta.find(m => m.questionId === '1.4');
    expect(m14.response).toBe('N');            // human value preserved
    expect(m14.aiSuggested).toBe(false);       // still a human answer
    expect(m14.evidenceQuote).toBe(humanNote); // human evidence untouched
  });
});

// ── 3. RoB 2 unchanged + appraisal in the 3-level vocabulary ──────────────────
describe('P14 — RoB 2 unchanged', () => {
  let rob2Id = '';

  it('creates a RoB 2 assessment (default instrument, 5 domains) and appraises it', async () => {
    if (!up || !adminCookie || !projectId) return;
    expect(await setFlags({ rob_engine_v2: true, guidedRobAppraisal: true })).toBe(true);
    const created = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId: `rob2-valid-${TS}` } });
    expect(created.status).toBe(201);
    rob2Id = created.data.assessment.id;
    expect(created.data.assessment.instrumentId).toBe('RoB2');
    expect(created.data.assessment.domains).toHaveLength(5);

    const ap = await api(`/rob/assessments/${rob2Id}/appraise`, { method: 'POST', cookie: ownerCookie, body: { fullText: ROB2_TEXT } });
    expect(ap.status).toBe(200);
    const vocab = new Set(['low', 'some', 'high']);
    expect(ap.data.assessment.domains).toHaveLength(5);
    expect(ap.data.assessment.domains.every(d => vocab.has(d.proposedJudgment))).toBe(true);
    // No human fields touched by appraise on RoB 2 either.
    expect(ap.data.assessment.domains.every(d => d.finalJudgment === null && d.overridden === false)).toBe(true);
  });

  it('validation reports machine-vs-human κ (+ CSV), scoped to one instrument', async () => {
    if (!up || !adminCookie || !projectId || !rob2Id) return;
    // Create HUMAN decisions by overriding two domains (finalJudgment set).
    await api(`/rob/assessments/${rob2Id}/override`, { method: 'POST', cookie: ownerCookie, body: { target: 'domain', domainId: 'D1', finalJudgment: 'high', justification: 'Reviewer judged the randomisation inadequate.' } });
    await api(`/rob/assessments/${rob2Id}/override`, { method: 'POST', cookie: ownerCookie, body: { target: 'domain', domainId: 'D2', finalJudgment: 'low', justification: 'Reviewer accepted the ITT analysis.' } });

    const val = await api(`/rob/projects/${projectId}/rob-validation?instrumentId=RoB2`, { cookie: ownerCookie });
    expect(val.status).toBe(200);
    expect(val.data.instrumentId).toBe('RoB2');
    expect(val.data.categories).toEqual(['low', 'some', 'high']);
    expect(val.data.n).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(val.data.byDomain)).toBe(true);
    expect(val.data.overall && typeof val.data.overall.kappa === 'number').toBe(true);

    const csv = await api(`/rob/projects/${projectId}/rob-validation?instrumentId=RoB2&format=csv`, { cookie: ownerCookie });
    expect(csv.status).toBe(200);
    expect(csv.data.format).toBe('csv');
    expect(csv.data.content).toContain('overall');
  });
});

// ── 4. Permission invariants ──────────────────────────────────────────────────
describe('P14 — permission invariants', () => {
  it('a non-owner cannot appraise, and cannot read validation (404, existence hidden)', async () => {
    if (!up || !adminCookie || !projectId) return;
    expect(await setFlags({ rob_engine_v2: true, guidedRobAppraisal: true })).toBe(true);
    const created = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId: `robins-perm-${TS}`, instrumentId: 'ROBINS-I' } });
    const id = created.data.assessment.id;
    const ap = await api(`/rob/assessments/${id}/appraise`, { method: 'POST', cookie: intruderCookie, body: { fullText: ROBINS_TEXT } });
    expect(ap.status).toBe(404);
    const val = await api(`/rob/projects/${projectId}/rob-validation`, { cookie: intruderCookie });
    expect(val.status).toBe(404);
  });
});
