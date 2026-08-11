/**
 * rob-registry-115.test.js — 115.md W1-B (server generalisation), integration.
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost. Toggles rob_engine_v2 (and, for one test,
 * guidedRobAppraisal) via the seeded admin, then restores both.
 *
 * WHAT THIS PINS
 *  1. instrument availability is REGISTRY-driven — every id the registry resolves
 *     is creatable, an unknown id is a 400 that NAMES the id, and the catalogue
 *     endpoint reports exactly what is creatable;
 *  2. the ROBINS-I `guidedRobAppraisal` creation gate is GONE (the flag now gates
 *     only the guided-appraisal endpoints);
 *  3. instrumentVersion + variant are ALWAYS stamped server-side from the
 *     definition and can never be supplied by the client;
 *  4. an off-form response is NEVER stored (the 101.md nosPersistence rule,
 *     generalised to the definition's own vocabulary);
 *  5. the Assess feed carries design detection + recommendations + every existing
 *     assessment for a study ACROSS instruments (tool-change safety);
 *  6. the project-wide CSV export is sectioned per instrument and excludes
 *     soft-deleted rows.
 *
 * The nine new definitions (W1-A) may or may not be registered when this runs, so
 * every registry assertion is written against whatever `GET /api/rob/instruments`
 * reports: with only the historical four it proves the GENERALISATION (nothing is
 * hardcoded); once the nine land, the same loops cover them with no edit.
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
async function registerAndLogin(email, password, name) {
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
let projectId = '';
let savedFlags = null;
/** The instrument catalogue the SERVER reports (never a list hardcoded here). */
let catalogue = [];
/**
 * RoB-local manual studies, seeded once. They must exist BEFORE any assessment is
 * created: as soon as the study universe is non-empty, createAssessment validates
 * studyId against it (prompt46 #4), so ad-hoc ids would 404.
 */
const study = {};

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

  const owner = await registerAndLogin(`rob115-owner-${TS}@example.com`, 'Rob115Owner!', 'RoB 115 Owner');
  ownerCookie = owner.cookie;

  const proj = await api('/projects', { method: 'POST', cookie: ownerCookie, body: { name: `RoB 115 Project ${TS}` } });
  projectId = proj.data?.id || proj.data?.project?.id || '';

  if (adminCookie) {
    await setFlags({ rob_engine_v2: true, guidedRobAppraisal: false });
    const list = await api('/rob/instruments', { cookie: ownerCookie });
    catalogue = (list.status === 200 && Array.isArray(list.data?.instruments)) ? list.data.instruments : [];

    for (const key of ['registry', 'stamp', 'vocabRob2', 'vocabNos', 'recommend', 'toolChange', 'deleted', 'regress', 'regressNos', 'consensus', 'applicability', 'computedOverall', 'overallApplic', 'evalType', 'robvis', 'fullyJudged']) {
      const created = await api(`/rob/projects/${projectId}/manual-studies`, {
        method: 'POST', cookie: ownerCookie,
        body: { title: `115 ${key} study ${TS}`, authors: 'Seed', year: '2024' },
      });
      if (created.status === 201) study[key] = created.data.study.id;
    }
  }
}, 60000);

afterAll(async () => {
  if (up && adminCookie) {
    const restore = savedFlags
      ? { ...savedFlags, rob_engine_v2: savedFlags.rob_engine_v2 === true, guidedRobAppraisal: savedFlags.guidedRobAppraisal === true }
      : { rob_engine_v2: false, guidedRobAppraisal: false };
    await api('/admin/feature-flags', { method: 'PUT', cookie: adminCookie, body: restore }).catch(() => {});
  }
});

// ── 1. Registry-driven availability ───────────────────────────────────────────
describe('115 — the instrument registry is the single authority', () => {
  it('serves a catalogue containing at least the historical four', async () => {
    if (!up || !adminCookie) return;
    const res = await api('/rob/instruments', { cookie: ownerCookie });
    expect(res.status).toBe(200);
    const ids = res.data.instruments.map(i => i.id);
    for (const id of ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC']) expect(ids, id).toContain(id);
    // A catalogue placeholder with no definition is never advertised as usable.
    expect(ids).not.toContain('custom');
    for (const t of res.data.instruments) {
      expect(typeof t.label).toBe('string');
      expect(typeof t.instrumentVersion).toBe('string');
      expect(Array.isArray(t.designs)).toBe(true);
      expect(['stars', 'judgment']).toContain(t.scoring);
    }
  });

  it('EVERY catalogue instrument is creatable — no allowlist, no flag gate', async () => {
    if (!up || !adminCookie || !projectId || !catalogue.length) return;
    // guidedRobAppraisal is OFF for this block (set in beforeAll): under the old
    // model that alone made ROBINS-I uncreatable.
    for (const tool of catalogue) {
      const created = await api('/rob/assessments', {
        method: 'POST', cookie: ownerCookie,
        body: { projectId, studyId: study.registry, instrumentId: tool.id },
      });
      expect(created.status, `${tool.id}: ${JSON.stringify(created.data)}`).toBe(201);
      expect(created.data.assessment.instrumentId).toBe(tool.id);
    }
  });

  it('ROBINS-I is creatable with guidedRobAppraisal OFF (the gate is gone)', async () => {
    if (!up || !adminCookie || !projectId) return;
    expect(await setFlags({ rob_engine_v2: true, guidedRobAppraisal: false })).toBe(true);
    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.registry, instrumentId: 'ROBINS-I' },
    });
    expect(created.status).toBe(201);
    expect(created.data.assessment.instrumentId).toBe('ROBINS-I');
    // …while the guided-appraisal FEATURE stays hidden behind its own flag.
    const ap = await api(`/rob/assessments/${created.data.assessment.id}/appraise`, {
      method: 'POST', cookie: ownerCookie, body: { fullText: 'x' },
    });
    expect(ap.status).toBe(404);
  });

  it('an unknown instrumentId is a 400 that NAMES the id', async () => {
    if (!up || !adminCookie || !projectId) return;
    const res = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.registry, instrumentId: 'NOT-A-TOOL' },
    });
    expect(res.status).toBe(400);
    expect(String(res.data.error)).toContain('NOT-A-TOOL');
  });

  it('serves every registered instrument by its own slug', async () => {
    if (!up || !adminCookie || !catalogue.length) return;
    for (const tool of catalogue) {
      const res = await api(`/rob/instruments/${tool.slug}`, { cookie: ownerCookie });
      expect(res.status, tool.slug).toBe(200);
      expect(res.data.instrument.id).toBe(tool.id);
      expect(Array.isArray(res.data.applicabilityDomainIds)).toBe(true);
    }
    expect((await api('/rob/instruments/not-a-tool', { cookie: ownerCookie })).status).toBe(404);
  });
});

// ── 2. Server-stamped version + variant ───────────────────────────────────────
describe('115 — instrumentVersion / variant come from the DEFINITION only', () => {
  it('stamps the definition version and ignores client-supplied values', async () => {
    if (!up || !adminCookie || !projectId || !catalogue.length) return;
    for (const tool of catalogue) {
      const created = await api('/rob/assessments', {
        method: 'POST', cookie: ownerCookie,
        body: {
          projectId, studyId: study.stamp, instrumentId: tool.id,
          // A client MUST NOT be able to mislabel which edition a judgement used.
          instrumentVersion: '1999-forged', variant: 'forged-variant',
        },
      });
      // 115.md r2 — the INVARIANT is "a forged value is never stored", and there
      // are now two honest ways to enforce it. A tool that offers the reviewer no
      // variant choice DISCARDS the field (there is nothing to choose, so it is
      // noise, exactly like the forged instrumentVersion beside it). A tool that
      // declares `evaluationTypes` (PROBAST's Dev / Val / Dev+Val) treats the
      // variant as a real methodological claim and REJECTS an undeclared value by
      // name rather than quietly substituting its default.
      if ((tool.evaluationTypes || []).length) {
        expect(created.status, tool.id).toBe(400);
        expect(String(created.data.error), tool.id).toMatch(/Invalid variant: forged-variant/);
        continue;
      }
      expect(created.status, tool.id).toBe(201);
      const view = created.data.assessment;
      expect(view.instrumentVersion, tool.id).toBe(tool.instrumentVersion);
      expect(view.instrumentVersion).not.toBe('1999-forged');
      expect(view.variant).toBe(tool.variant);
      expect(view.variant).not.toBe('forged-variant');
    }
  });

  // …and the branch above is not a hole: on the one tool that DOES take a variant,
  // the version is still server-stamped and a forged one still discarded.
  it('stamps the definition version on a PROBAST row created with a legal variant', async () => {
    if (!up || !adminCookie || !projectId || !catalogue.length) return;
    const probast = catalogue.find(t => t.id === 'PROBAST');
    if (!probast) return;
    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: {
        projectId, studyId: study.stamp, instrumentId: 'PROBAST',
        instrumentVersion: '1999-forged', variant: 'validation',
      },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    expect(created.data.assessment.instrumentVersion).toBe(probast.instrumentVersion);
    expect(created.data.assessment.instrumentVersion).not.toBe('1999-forged');
    expect(created.data.assessment.variant).toBe('validation');
  });
});

// ── 3. Off-form values are never stored ───────────────────────────────────────
describe('115 — the definition owns the response vocabulary', () => {
  let rob2Id = '';
  let nosId = '';

  it('creates a RoB 2 + a NOS assessment', async () => {
    if (!up || !adminCookie || !projectId) return;
    const a = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId: study.vocabRob2 } });
    expect(a.status).toBe(201);
    rob2Id = a.data.assessment.id;
    const b = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId: study.vocabNos, instrumentId: 'NOS' } });
    expect(b.status).toBe(201);
    nosId = b.data.assessment.id;
  });

  it('accepts the shared vocabulary on RoB 2 and rejects anything else', async () => {
    if (!up || !adminCookie || !rob2Id) return;
    const ok = await api(`/rob/assessments/${rob2Id}/answers`, {
      method: 'PUT', cookie: ownerCookie, body: { answers: [{ questionId: '1.1', response: 'Y' }] },
    });
    expect(ok.status).toBe(200);
    // 'yes' is a real word on other instruments — it is still off-form HERE.
    for (const junk of ['yes', 'low', 'MAYBE', '']) {
      const bad = await api(`/rob/assessments/${rob2Id}/answers`, {
        method: 'PUT', cookie: ownerCookie, body: { answers: [{ questionId: '1.1', response: junk }] },
      });
      expect(bad.status, junk).toBe(400);
    }
    // …and the good answer survived every rejected batch.
    const view = await api(`/rob/assessments/${rob2Id}`, { cookie: ownerCookie });
    expect(view.data.assessment.answersByDomain.D1['1.1']).toBe('Y');
  });

  it('rejects an off-form NOS option (101.md rule intact)', async () => {
    if (!up || !adminCookie || !nosId) return;
    const bad = await api(`/rob/assessments/${nosId}/answers`, {
      method: 'PUT', cookie: ownerCookie, body: { answers: [{ questionId: 'S1', response: 'zzz' }] },
    });
    expect(bad.status).toBe(400);
  });

  it('records a per-domain APPLICABILITY judgement alongside risk of bias', async () => {
    if (!up || !adminCookie || !projectId) return;
    // Self-skips until an instrument with a second judgement axis is registered.
    const dual = catalogue.find(t => t.hasApplicability);
    if (!dual) return;

    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie, body: { projectId, studyId: study.applicability, instrumentId: dual.id },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const id = created.data.assessment.id;
    const axis = created.data.assessment.applicability;
    expect(Array.isArray(axis)).toBe(true);
    expect(axis.length).toBeGreaterThan(0);
    const first = axis[0];
    expect(first.judgment).toBeNull();          // nothing invented before a reviewer judges

    // An off-form concern is never stored.
    const junk = await api(`/rob/assessments/${id}/override`, {
      method: 'POST', cookie: ownerCookie,
      body: { target: 'applicability', domainId: first.domainId, finalJudgment: 'totally-fine' },
    });
    expect(junk.status).toBe(400);

    const ok = await api(`/rob/assessments/${id}/override`, {
      method: 'POST', cookie: ownerCookie,
      body: { target: 'applicability', domainId: first.domainId, finalJudgment: first.levels[0], justification: 'matches the review question' },
    });
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    const saved = ok.data.assessment.applicability.find(x => x.domainId === first.domainId);
    expect(saved.judgment).toBe(first.levels[0]);
    expect(saved.rationale).toBe('matches the review question');

    // The applicability row is a SECOND row — it never becomes a risk-of-bias
    // domain judgement and never reaches the overall algorithm.
    const rob = ok.data.assessment.domains.find(d => d.domainId === first.domainId);
    expect(rob.finalJudgment).toBeNull();
    expect(rob.overridden).toBe(false);

    // …and it survives a reopen (only auto-copied finals are cleared).
    const reopened = await api(`/rob/assessments/${id}/reopen`, { method: 'POST', cookie: ownerCookie });
    expect(reopened.status).toBe(200);
    expect(reopened.data.assessment.applicability.find(x => x.domainId === first.domainId).judgment).toBe(first.levels[0]);

    // A non-answerable applicability PROMPT can never be answered as an item.
    const inst = await api(`/rob/instruments/${dual.slug}`, { cookie: ownerCookie });
    const prompt = (inst.data.instrument.domains || [])
      .flatMap(d => d.questions || [])
      .find(q => q.answerable === false);
    if (prompt) {
      const bad = await api(`/rob/assessments/${id}/answers`, {
        method: 'PUT', cookie: ownerCookie, body: { answers: [{ questionId: prompt.id, response: 'Y' }] },
      });
      expect(bad.status).toBe(400);
    }
  });

  // The two COMPUTED overall judgements the tool set defines. Both used to be
  // computed live in the browser and then thrown away: `recomputeAndPersist` rolled
  // up a map of judgement STRINGS, which carries neither AMSTAR 2's flaw counts
  // (its single domain makes no judgement at all) nor PROBAST's applicability axis.
  it('PERSISTS a computed overall confidence rating (AMSTAR 2)', async () => {
    if (!up || !adminCookie || !projectId) return;
    const amstar = catalogue.find(t => t.id === 'AMSTAR-2');
    if (!amstar || !study.computedOverall) return;

    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie, body: { projectId, studyId: study.computedOverall, instrumentId: 'AMSTAR-2' },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const id = created.data.assessment.id;
    expect(created.data.assessment.overallLevels).toEqual(['high', 'moderate', 'low', 'critically-low']);

    // Box 2 counts weaknesses across the WHOLE checklist, so a partly-answered
    // form proposes NOTHING. This used to rate a three-item form 'critically-low',
    // and — worse — rated a BLANK one 'high', the tool's best rating, at creation.
    expect(created.data.assessment.overall.proposedOverall).toBe('');
    const partial = await api(`/rob/assessments/${id}/answers`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { answers: [{ questionId: '2', response: 'N' }, { questionId: '7', response: 'N' }, { questionId: '1', response: 'Y' }] },
    });
    expect(partial.status, JSON.stringify(partial.data)).toBe(200);
    expect(partial.data.assessment.overall.proposedOverall).toBe('');

    // Answer all sixteen — two CRITICAL flaws (items 2 and 7) → "critically low".
    const items = (created.data.assessment.domains || []).length
      ? Object.keys(created.data.assessment.completeness.perDomain)
      : [];
    expect(items).toContain('items');
    const all = Array.from({ length: 16 }, (_, i) => ({
      questionId: String(i + 1),
      response: (i + 1 === 2 || i + 1 === 7) ? 'N' : 'Y',
    }));
    const ans = await api(`/rob/assessments/${id}/answers`, {
      method: 'PUT', cookie: ownerCookie, body: { answers: all },
    });
    expect(ans.status, JSON.stringify(ans.data)).toBe(200);
    expect(ans.data.assessment.completeness.overall.complete).toBe(true);
    expect(ans.data.assessment.overall.proposedOverall).toBe('critically-low');

    // …and it is READ BACK from the row, not recomputed only for the response.
    const list = await api(`/rob/projects/${projectId}/assessments`, { cookie: ownerCookie });
    const row = list.data.assessments.find(a => a.id === id);
    expect(row.overall).toBe('critically-low');
  });

  it('PERSISTS the second overall judgement under the -APP convention (PROBAST)', async () => {
    if (!up || !adminCookie || !projectId) return;
    const probast = catalogue.find(t => t.id === 'PROBAST');
    if (!probast || !study.overallApplic) return;

    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie, body: { projectId, studyId: study.overallApplic, instrumentId: 'PROBAST' },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const id = created.data.assessment.id;
    const axes = created.data.assessment.applicability.map(a => a.domainId);
    expect(axes.length).toBeGreaterThan(0);

    // One "high" concern wins the Step 4 applicability roll-up.
    const want = { [axes[0]]: 'low', [axes[1]]: 'high', [axes[2]]: 'low' };
    let view = null;
    for (const domainId of axes) {
      const r = await api(`/rob/assessments/${id}/override`, {
        method: 'POST', cookie: ownerCookie,
        body: { target: 'applicability', domainId, finalJudgment: want[domainId], justification: `concern ${domainId}` },
      });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      view = r.data.assessment;
    }
    expect(view.overall.applicability.judgment).toBe('high');
    // The risk-of-bias overall is untouched — two axes, never merged.
    expect(view.overall.proposedOverall).toBe('');

    // The list endpoint deserialises the `overall-APP` row for free.
    const list = await api(`/rob/projects/${projectId}/assessments`, { cookie: ownerCookie });
    const row = list.data.assessments.find(a => a.id === id);
    expect(row.applicability.overall).toBe('high');
    expect(row.overall).toBe('');
  });

  it('refuses an applicability judgement on an instrument that has none', async () => {
    if (!up || !adminCookie || !rob2Id) return;
    const res = await api(`/rob/assessments/${rob2Id}/override`, {
      method: 'POST', cookie: ownerCookie,
      body: { target: 'applicability', domainId: 'D1', finalJudgment: 'low' },
    });
    expect(res.status).toBe(400);
    expect(String(res.data.error)).toMatch(/applicability/i);
  });

  it('rejects an off-vocabulary domain override', async () => {
    if (!up || !adminCookie || !rob2Id) return;
    const res = await api(`/rob/assessments/${rob2Id}/override`, {
      method: 'POST', cookie: ownerCookie,
      body: { target: 'domain', domainId: 'D1', finalJudgment: 'include', justification: 'x' },
    });
    expect(res.status).toBe(400);
  });
});

// ── 3b. The r2 adversarial-review fixes ───────────────────────────────────────
describe('115 r2 — the evaluation type is a real, restricted choice', () => {
  it('stamps a client-chosen PROBAST evaluation type and rejects anything else', async () => {
    if (!up || !adminCookie || !projectId) return;
    if (!catalogue.find(t => t.id === 'PROBAST') || !study.evalType) return;

    // The catalogue advertises the closed set, so a picker needs no hardcoded list.
    const probast = catalogue.find(t => t.id === 'PROBAST');
    expect((probast.evaluationTypes || []).map(t => t.value))
      .toEqual(['development', 'validation', 'development-and-validation']);
    for (const t of catalogue.filter(x => x.id !== 'PROBAST')) {
      expect(t.evaluationTypes, t.id).toEqual([]);
    }

    const dev = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.evalType, instrumentId: 'PROBAST', variant: 'development' },
    });
    expect(dev.status, JSON.stringify(dev.data)).toBe(201);
    expect(dev.data.assessment.variant).toBe('development');

    // An undeclared value is refused BY NAME — never silently coerced, because the
    // variant is a methodological claim about what was appraised.
    const bad = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.evalType, instrumentId: 'PROBAST', variant: 'made-up' },
    });
    expect(bad.status).toBe(400);
    expect(String(bad.data.error)).toMatch(/Invalid variant: made-up/);

    // A tool that offers no choice still DISCARDS a client variant (the
    // definition-owns-provenance rule pinned in §2 above), so a forged value can
    // never be stored on any instrument, whichever branch it takes.
    const rob2 = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.evalType, instrumentId: 'RoB2', variant: 'development' },
    });
    expect(rob2.status, JSON.stringify(rob2.data)).toBe(201);
    expect(rob2.data.assessment.variant).toBe('assignment');
  });
});

describe('115 r2 — robvis refuses the tools it cannot label', () => {
  it('refuses AMSTAR 2 rather than inverting its confidence rating into a risk', async () => {
    if (!up || !adminCookie || !projectId || !study.robvis) return;
    if (!catalogue.find(t => t.id === 'AMSTAR-2')) return;
    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.robvis, instrumentId: 'AMSTAR-2' },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const id = created.data.assessment.id;

    const rv = await api(`/rob/assessments/${id}/export?format=robvis`, { cookie: ownerCookie });
    expect(rv.status).toBe(400);
    expect(String(rv.data.error)).toMatch(/robvis/i);

    // The CSV export still works, and it NAMES THE RIGHT TOOL: this used to
    // download as `robins-i_<studyId>.csv`.
    const csv = await api(`/rob/assessments/${id}/export?format=csv`, { cookie: ownerCookie });
    if (csv.status === 200) {
      expect(csv.data.filename.startsWith('amstar-2_')).toBe(true);
      expect(csv.data.filename).not.toContain('robins-i');
    }
  });
});

describe('115 r2 — finalising requires the tool to be FULLY JUDGED', () => {
  it('refuses a QUADAS-2 assessment whose items are answered but nothing is judged', async () => {
    if (!up || !adminCookie || !projectId || !study.fullyJudged) return;
    if (!catalogue.find(t => t.id === 'QUADAS-2')) return;

    const created = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.fullyJudged, instrumentId: 'QUADAS-2' },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const id = created.data.assessment.id;

    // Answer every signalling question — 'N' so QUADAS-2 withholds its proposal and
    // leaves the judgement to the reviewer, which is the whole point.
    const inst = await api('/rob/instruments/quadas-2', { cookie: ownerCookie });
    const answers = (inst.data.instrument.domains || []).flatMap(d => (d.questions || [])
      .filter(q => q.answerable !== false)
      .map(q => ({ questionId: q.id, response: 'N' })));
    const put = await api(`/rob/assessments/${id}/answers`, { method: 'PUT', cookie: ownerCookie, body: { answers } });
    expect(put.status, JSON.stringify(put.data)).toBe(200);
    expect(put.data.assessment.completeness.overall.complete).toBe(true);

    // Complete items, ZERO judgements — and 'complete' is what the dual-reviewer
    // blind reads to decide the comparison may be revealed.
    const early = await api(`/rob/assessments/${id}/finalise`, { method: 'POST', cookie: ownerCookie });
    expect(early.status).toBe(400);
    expect(Array.isArray(early.data.missingJudgments)).toBe(true);
    expect(early.data.missingJudgments.length).toBe(7);   // 4 risk-of-bias + 3 applicability
    expect(String(early.data.error)).toMatch(/not fully judged/i);

    // Record every judgement the definition asks for…
    for (const d of inst.data.instrument.domains) {
      const r = await api(`/rob/assessments/${id}/override`, {
        method: 'POST', cookie: ownerCookie,
        body: { target: 'domain', domainId: d.id, finalJudgment: 'high', justification: 'signalling questions answered No' },
      });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
    }
    for (const domainId of (inst.data.applicabilityDomainIds || [])) {
      const r = await api(`/rob/assessments/${id}/override`, {
        method: 'POST', cookie: ownerCookie,
        body: { target: 'applicability', domainId, finalJudgment: 'low', justification: 'matches the review question' },
      });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
    }
    // …and only now does it finalise. QUADAS-2 prescribes NO overall, so none is
    // demanded — the predicate is the DEFINITION's, not a fixed checklist.
    const ok = await api(`/rob/assessments/${id}/finalise`, { method: 'POST', cookie: ownerCookie });
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    expect(ok.data.assessment.status).toBe('complete');
  });
});

// ── 4. Recommendations + tool-change safety ───────────────────────────────────
describe('115 — the Assess feed carries design recommendations + prior work', () => {
  it('returns a recommendation block and the full catalogue per study', async () => {
    if (!up || !adminCookie || !projectId) return;
    const created = await api(`/rob/projects/${projectId}/manual-studies`, {
      method: 'POST', cookie: ownerCookie, body: { title: `Recommendation study ${TS}`, authors: 'Nguyen', year: '2024' },
    });
    expect(created.status).toBe(201);
    const studyId = created.data.study.id;

    const res = await api(`/rob/projects/${projectId}/studies`, { cookie: ownerCookie });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.instruments)).toBe(true);
    const s = res.data.studies.find(x => x.id === studyId);
    expect(s).toBeTruthy();
    expect(s.recommendation).toBeTruthy();
    // No design recorded → no recommendation and NO warning (never a guess), but
    // every tool stays compatible.
    expect(s.recommendation.recommendedToolIds).toEqual([]);
    expect(s.recommendation.warning).toBe('');
    expect(s.recommendation.compatibleToolIds.length).toBe(res.data.instruments.length);
  });

  it('lists prior assessments for a study ACROSS instruments (tool-change safety)', async () => {
    if (!up || !adminCookie || !projectId) return;
    const studyId = study.toolChange;
    const first = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId, instrumentId: 'ROBINS-I' } });
    expect(first.status).toBe(201);
    const second = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId, instrumentId: 'NOS' } });
    expect(second.status).toBe(201);

    const universe = await api(`/rob/projects/${projectId}/studies`, { cookie: ownerCookie });
    if (universe.status === 200) {
      const s = (universe.data.studies || []).find(x => x.id === studyId);
      // Screening-derived studies only appear in the universe when the project blob
      // has them; when it does, the row must carry BOTH assessments.
      if (s) expect(s.existingInstrumentIds.sort()).toEqual(['NOS', 'ROBINS-I']);
    }

    const list = await api(`/rob/projects/${projectId}/assessments`, { cookie: ownerCookie });
    expect(list.status).toBe(200);
    const forStudy = list.data.assessments.filter(a => a.studyId === studyId);
    expect(forStudy.map(a => a.instrumentId).sort()).toEqual(['NOS', 'ROBINS-I']);
    // Starting a second tool NEVER deletes the first.
    expect(forStudy.every(a => a.status !== 'deleted')).toBe(true);

    // Decision 7 — mixed-tool projects group by instrument; no cross-tool matrix.
    expect(Array.isArray(list.data.groups)).toBe(true);
    const ids = list.data.groups.map(g => g.instrumentId);
    expect(ids).toContain('ROBINS-I');
    expect(ids).toContain('NOS');
    const nosGroup = list.data.groups.find(g => g.instrumentId === 'NOS');
    expect(nosGroup.scoring).toBe('stars');
    expect(nosGroup.matrix).toBeNull();     // a star profile is not a traffic light
    const robinsGroup = list.data.groups.find(g => g.instrumentId === 'ROBINS-I');
    expect(robinsGroup.matrix.domains).toHaveLength(7);
    // A traffic-light matrix is offered ONLY where the tool rates its domains: a
    // checklist tool (JBI) must never be handed one to plot.
    for (const g of list.data.groups) {
      if (!g.domainJudgmentLevels.length && g.scoring !== 'stars') expect(g.matrix, g.instrumentId).toBeNull();
    }
    // The legacy top-level matrix is unchanged (RoB2 fallback for mixed projects).
    expect(list.data.matrix.domains.map(d => d.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
  });
});

// ── 5. Project-wide, tool-sectioned CSV export ────────────────────────────────
describe('115 — project RoB CSV export', () => {
  it('emits one section per instrument and never a soft-deleted row', async () => {
    if (!up || !adminCookie || !projectId) return;
    // A row that will be soft-deleted before the export runs.
    const doomed = await api('/rob/assessments', {
      method: 'POST', cookie: ownerCookie,
      body: { projectId, studyId: study.deleted, instrumentId: 'RoB2', resultLabel: 'DOOMED-ROW' },
    });
    expect(doomed.status).toBe(201);
    expect((await api(`/rob/assessments/${doomed.data.assessment.id}`, { method: 'DELETE', cookie: ownerCookie })).status).toBe(200);

    const res = await api(`/rob/projects/${projectId}/assessments/export?format=csv`, { cookie: ownerCookie });
    if (res.status === 403) {
      // Tier-gated exactly like the per-assessment export (dossier §14) — a plan
      // without `projects.export` is a legitimate outcome, not a failure.
      expect(res.data).toBeTruthy();
      return;
    }
    expect(res.status).toBe(200);
    expect(res.data.format).toBe('csv');
    expect(res.data.mime).toBe('text/csv');
    expect(res.data.filename).toContain(projectId);
    const csv = res.data.content;
    expect(csv).toContain('"# pecanrev risk-of-bias export"');
    const sections = csv.split('\n').filter(l => l.startsWith('"# tool"'));
    expect(sections.length).toBeGreaterThanOrEqual(2);   // RoB2 + ROBINS-I + NOS…
    expect(csv).toContain('"item:1.1"');                 // RoB 2 items as columns
    expect(csv).toContain('"domain:D1"');
    expect(csv).not.toContain('DOOMED-ROW');             // soft-deleted, never exported
    // Both computed overall judgements reach the file. AMSTAR 2's confidence goes
    // in the ordinary `overall` column (its levels are the tool's own vocabulary);
    // PROBAST's second axis gets a column of its own, and ONLY that section does.
    if (catalogue.some(t => t.id === 'AMSTAR-2')) expect(csv).toContain('"critically-low"');
    if (catalogue.some(t => t.id === 'PROBAST')) {
      expect(csv).toContain('"applicability:overall"');
      const probastSection = csv.split('\n"# tool","PROBAST"')[1] || '';
      expect(probastSection.split('\n')[1]).toContain('"applicability:overall"');
      const rob2Section = csv.split('\n"# tool","RoB2"')[1] || '';
      if (rob2Section) expect(rob2Section.split('\n')[1]).not.toContain('"applicability:overall"');
    }
    // Per-tool summary counts, no cross-tool total.
    expect(Array.isArray(res.data.summary)).toBe(true);
    expect(res.data.summary.every(g => g.count > 0)).toBe(true);
  });

  it('rejects a non-CSV format for the project export', async () => {
    if (!up || !adminCookie || !projectId) return;
    const res = await api(`/rob/projects/${projectId}/assessments/export?format=json`, { cookie: ownerCookie });
    expect([400, 403]).toContain(res.status);
  });

  it('hides the export from a user with no access (404, existence hidden)', async () => {
    if (!up || !adminCookie || !projectId) return;
    const intruder = await registerAndLogin(`rob115-intruder-${TS}@example.com`, 'Rob115Intruder!', 'Intruder');
    const res = await api(`/rob/projects/${projectId}/assessments/export?format=csv`, { cookie: intruder.cookie });
    expect(res.status).toBe(404);
  });
});

// ── 6. Regression: the existing lifecycle still works untouched ───────────────
describe('115 — regression on the pre-existing instruments', () => {
  it('RoB 2 create → answer → override → finalise → reopen still works', async () => {
    if (!up || !adminCookie || !projectId) return;
    const created = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId: study.regress } });
    expect(created.status).toBe(201);
    const id = created.data.assessment.id;
    expect(created.data.assessment.instrumentVersion).toBe('2019-08-22');
    expect(created.data.assessment.variant).toBe('assignment');
    expect(created.data.assessment.applicability).toEqual([]);
    expect(created.data.assessment.overallLevels).toEqual(['low', 'some', 'high']);
    expect(created.data.assessment.scoringAllowed).toBe(false);

    const ans = await api(`/rob/assessments/${id}/answers`, {
      method: 'PUT', cookie: ownerCookie, body: { answers: [{ questionId: '1.1', response: 'Y' }, { questionId: '1.2', response: 'Y' }] },
    });
    expect(ans.status).toBe(200);

    const ovr = await api(`/rob/assessments/${id}/override`, {
      method: 'POST', cookie: ownerCookie,
      body: { target: 'domain', domainId: 'D1', finalJudgment: 'high', justification: 'reviewer judgement' },
    });
    expect(ovr.status).toBe(200);
    expect(ovr.data.assessment.domains[0].resolvedJudgment).toBe('high');

    const reopened = await api(`/rob/assessments/${id}/reopen`, { method: 'POST', cookie: ownerCookie });
    expect(reopened.status).toBe(200);
    // The override survives a reopen; only auto-copied finals are cleared.
    expect(reopened.data.assessment.domains[0].overridden).toBe(true);
  });

  it('NOS still scores stars and refuses the robvis export', async () => {
    if (!up || !adminCookie || !projectId) return;
    const created = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId: study.regressNos, instrumentId: 'NOS' } });
    expect(created.status).toBe(201);
    expect(created.data.assessment.scoring).toBe('stars');
    expect(created.data.assessment.scoringAllowed).toBe(true);
    expect(created.data.assessment.score.maxStars).toBe(9);
    const rv = await api(`/rob/assessments/${created.data.assessment.id}/export?format=robvis`, { cookie: ownerCookie });
    expect(rv.status).toBe(400);
  });

  it('the dual-reviewer + consensus contract is unchanged', async () => {
    if (!up || !adminCookie || !projectId) return;
    const studyId = study.consensus;
    const a = await api('/rob/assessments', { method: 'POST', cookie: ownerCookie, body: { projectId, studyId, instrumentId: 'RoB2' } });
    expect(a.status).toBe(201);
    // One reviewer only → a consensus record would be a fabricated claim (409).
    const early = await api(`/rob/projects/${projectId}/studies/${studyId}/consensus`, {
      method: 'POST', cookie: ownerCookie, body: { instrumentId: 'RoB2' },
    });
    expect(early.status).toBe(409);
    // …and an unknown instrument is still a 400 that names the id.
    const bad = await api(`/rob/projects/${projectId}/studies/${studyId}/consensus`, {
      method: 'POST', cookie: ownerCookie, body: { instrumentId: 'NOPE' },
    });
    expect(bad.status).toBe(400);
    expect(String(bad.data.error)).toContain('NOPE');
  });
});
