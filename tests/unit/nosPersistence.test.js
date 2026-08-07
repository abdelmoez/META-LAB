/**
 * nosPersistence.test.js — 101.md §18/§21/§22/§25. The PERSISTENCE BOUNDARY for
 * the Newcastle–Ottawa Scale: everything that turns a reviewer's click into a row
 * in RobAnswer / RobDomainJudgment / RobOverall, and back again.
 *
 * The pure instrument + its scoring are covered by tests/unit/nos.test.js. What is
 * tested here is the part that can silently corrupt a project:
 *   · an option value that is not on the official form must NEVER be stored — a junk
 *     value would score 0 stars and be indistinguishable from a considered "no star";
 *   · a select:'one' item must reject a two-element array, because several official
 *     items DO carry two starred options and they are mutually exclusive alternatives
 *     capped at one star (accepting both would over-score the study);
 *   · the additive Comparability item must accept the SET ['a','b'] and round-trip it
 *     through the single String column;
 *   · the star Int columns must actually be written alongside the legacy numeral;
 *   · two reviewers must be compared without either one being overwritten, and the
 *     consensus row must be a THIRD row that leaves both originals byte-identical.
 *
 * Prisma is an in-memory stub, so this file is hermetic (no DB, no HTTP, no clock).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── in-memory prisma stub ─────────────────────────────────────────────────────
const db = {
  assessments: [],
  answers: [],
  domainJudgments: [],
  overalls: [],
  audits: [],
  projects: [],
  users: [{ id: 'u1', name: 'Reviewer One', email: 'r1@example.test' }],
};
let seq = 0;
const uid = (p) => `${p}${++seq}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v === null) return row[k] == null;
  if (v && typeof v === 'object' && !Array.isArray(v)) return true; // nested filters unused here
  return row[k] === v;
});
/** Mimic Prisma's `include` for the three RobAssessment relations the controller loads. */
const hydrate = (row, include) => {
  const out = clone(row);
  if (!include) return out;
  if (include.answers) out.answers = db.answers.filter(x => x.assessmentId === row.id).map(clone);
  if (include.domainJudgments) out.domainJudgments = db.domainJudgments.filter(x => x.assessmentId === row.id).map(clone);
  if (include.overall) out.overall = clone(db.overalls.find(x => x.assessmentId === row.id) || null);
  return out;
};

vi.mock('../../server/db/client.js', () => ({
  prisma: {
    project: {
      findFirst: async ({ where }) => db.projects.find(p => p.id === where.id) || null,
    },
    user: {
      findUnique: async ({ where }) => db.users.find(u => u.id === where.id) || null,
    },
    robAssessment: {
      findFirst: async ({ where, include }) => {
        const row = db.assessments.find(a => matches(a, where));
        return row ? hydrate(row, include) : null;
      },
      findMany: async ({ where = {}, include } = {}) => db.assessments.filter(a => matches(a, where)).map(a => hydrate(a, include)),
      create: async ({ data }) => {
        const row = { id: uid('a'), deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...data };
        db.assessments.push(row);
        return clone(row);
      },
      update: async ({ where, data }) => {
        const row = db.assessments.find(a => a.id === where.id);
        Object.assign(row, data);
        return clone(row);
      },
      count: async ({ where }) => db.assessments.filter(a => matches(a, where)).length,
    },
    robAnswer: {
      findMany: async ({ where = {} } = {}) => db.answers.filter(x => matches(x, where)).map(clone),
      create: async ({ data }) => {
        const row = { id: uid('ans'), ...data };
        db.answers.push(row);
        return clone(row);
      },
      upsert: async ({ where, update, create }) => {
        const k = where.assessmentId_questionId;
        const found = db.answers.find(x => x.assessmentId === k.assessmentId && x.questionId === k.questionId);
        if (found) {
          for (const [kk, vv] of Object.entries(update)) if (vv !== undefined) found[kk] = vv;
          return clone(found);
        }
        const row = { id: uid('ans'), ...create };
        db.answers.push(row);
        return clone(row);
      },
    },
    robDomainJudgment: {
      findMany: async ({ where = {} } = {}) => db.domainJudgments.filter(x => matches(x, where)).map(clone),
      upsert: async ({ where, update, create }) => {
        const k = where.assessmentId_domainId;
        const found = db.domainJudgments.find(x => x.assessmentId === k.assessmentId && x.domainId === k.domainId);
        if (found) { Object.assign(found, update); return clone(found); }
        const row = { overridden: false, finalJudgment: null, proposedStars: null, finalStars: null, overrideJustification: null, ...create };
        db.domainJudgments.push(row);
        return clone(row);
      },
      update: async ({ where, data }) => {
        const k = where.assessmentId_domainId;
        const found = db.domainJudgments.find(x => x.assessmentId === k.assessmentId && x.domainId === k.domainId);
        Object.assign(found, data);
        return clone(found);
      },
      updateMany: async ({ where, data }) => {
        const hit = db.domainJudgments.filter(x => matches(x, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
    robOverall: {
      upsert: async ({ where, update, create }) => {
        const found = db.overalls.find(x => x.assessmentId === where.assessmentId);
        if (found) { Object.assign(found, update); return clone(found); }
        const row = { overridden: false, finalOverall: null, proposedStars: null, finalStars: null, maxStars: null, multiSomeConcernsFlag: false, ...create };
        db.overalls.push(row);
        return clone(row);
      },
      update: async ({ where, data }) => {
        const found = db.overalls.find(x => x.assessmentId === where.assessmentId);
        Object.assign(found, data);
        return clone(found);
      },
      updateMany: async ({ where, data }) => {
        const hit = db.overalls.filter(x => matches(x, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
    robAuditLog: {
      create: async ({ data }) => { db.audits.push({ id: uid('log'), ...data }); return {}; },
    },
    robManualStudy: { findMany: async () => [], findFirst: async () => null },
  },
}));

vi.mock('../../server/store.js', () => ({
  getById: async (id) => db.projects.map(p => ({ id: p.id, ...JSON.parse(p.data || '{}') })).find(p => p.id === id) || undefined,
  touchProjectActivity: async () => {},
  mutateProjectBlob: async (projectId, mutate) => {
    const row = db.projects.find(p => p.id === projectId);
    if (!row) return null;
    const data = JSON.parse(row.data || '{}');
    const out = mutate(data) || {};
    if (out.commit === false) return { project: { id: projectId }, result: out.result, committed: false };
    row.data = JSON.stringify(data);
    return { project: { id: projectId }, result: out.result, committed: true };
  },
}));
vi.mock('../../server/screening/metalabAccess.js', () => ({ getRobMemberAccess: async () => null }));
vi.mock('../../server/services/featureAccess.js', () => ({ featureAccess: async () => ({ allowed: true }) }));
vi.mock('../../server/services/entitlementService.js', () => ({ sendTierLimit: () => false }));
vi.mock('../../server/services/projectExportGuard.js', () => ({
  requireProjectExport: async () => ({ reservationId: 'res1' }),
  settleProjectExport: () => {},
  EXPORT_TYPES: { ROB_ASSESSMENT: 'rob' },
}));

import {
  createAssessment, upsertAnswers, overrideJudgment, finaliseAssessment,
  getStudyReviewers, createConsensusAssessment, putNosThresholds, getNosThresholds,
  decodeAnswerResponse, encodeAnswerResponse, validateStarAnswer, coerceNosThresholds,
  reviewerComparison, CONSENSUS_STATUS,
} from '../../server/controllers/robController.js';
import { NOS_COHORT, NOS_CASE_CONTROL } from '../../src/research-engine/rob/instruments/nos.js';

// ── express doubles ───────────────────────────────────────────────────────────
const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const mkReq = (over = {}) => ({ params: {}, query: {}, body: {}, user: { id: 'u1' }, ...over });

// A COMPLETE, valid cohort-form answer set. Selection 4/4, Comparability 2/2,
// Outcome 3/3 → the full 9 stars.
const FULL_COHORT = [
  { questionId: 'S1', response: 'a' },
  { questionId: 'S2', response: 'a' },
  { questionId: 'S3', response: 'a' },
  { questionId: 'S4', response: 'a' },
  { questionId: 'C1', response: ['a', 'b'] },
  { questionId: 'O1', response: 'a' },
  { questionId: 'O2', response: 'a' },
  { questionId: 'O3', response: 'a' },
];

async function newAssessment({ userId = 'u1', instrumentId = 'NOS' } = {}) {
  const res = mkRes();
  await createAssessment(
    mkReq({ user: { id: userId }, body: { projectId: 'p1', studyId: 's1', instrumentId } }),
    res,
  );
  expect(res.statusCode).toBe(201);
  return res.body.assessment;
}

async function answer(assessmentId, answers, userId = 'u1') {
  const res = mkRes();
  await upsertAnswers(mkReq({ user: { id: userId }, params: { id: assessmentId }, body: { answers } }), res);
  return res;
}

beforeEach(() => {
  db.assessments.length = 0;
  db.answers.length = 0;
  db.domainJudgments.length = 0;
  db.overalls.length = 0;
  db.audits.length = 0;
  db.projects.length = 0;
  db.projects.push({ id: 'p1', userId: 'u1', data: JSON.stringify({ studies: [{ id: 's1', title: 'A cohort study' }] }), autosaveRev: 0 });
  db.users.length = 0;
  db.users.push({ id: 'u1', name: 'Reviewer One', email: 'r1@example.test' });
  db.users.push({ id: 'u2', name: 'Reviewer Two', email: 'r2@example.test' });
  seq = 0;
});

// ── the wire format ───────────────────────────────────────────────────────────
describe('NOS answer encoding (the single String column)', () => {
  it('round-trips a single option and an additive SET', () => {
    expect(decodeAnswerResponse('a')).toBe('a');
    expect(decodeAnswerResponse('["a","b"]')).toEqual(['a', 'b']);
    const c1 = NOS_COHORT.domains.find(d => d.id === 'comparability').questions[0];
    const s1 = NOS_COHORT.domains.find(d => d.id === 'selection').questions[0];
    expect(encodeAnswerResponse(c1, ['a', 'b'])).toBe('["a","b"]');
    expect(decodeAnswerResponse(encodeAnswerResponse(c1, ['a', 'b']))).toEqual(['a', 'b']);
    // select:'many' always stores an array, even for one value — the column shape
    // follows the instrument, not what the reviewer happened to tick.
    expect(encodeAnswerResponse(c1, ['a'])).toBe('["a"]');
    expect(encodeAnswerResponse(s1, ['a'])).toBe('a');
  });

  it('a literal value that merely looks like JSON is never lost', () => {
    expect(decodeAnswerResponse('[not json')).toBe('[not json');
    expect(decodeAnswerResponse('')).toBe('');
    expect(decodeAnswerResponse(undefined)).toBe('');
  });
});

// ── option validation ─────────────────────────────────────────────────────────
describe('validateStarAnswer (never store junk)', () => {
  it('rejects an option value that is not on the official form', () => {
    const v = validateStarAnswer(NOS_COHORT, 'S1', 'z');
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/Invalid option for S1: z/);
    expect(v.error).toMatch(/Allowed: a, b, c, d/);
  });

  it('rejects a two-element array on a select:one item', () => {
    // S3 (Ascertainment of exposure) genuinely has TWO starred options — they are
    // alternatives capped at one star, so ticking both must be refused.
    const v = validateStarAnswer(NOS_COHORT, 'S3', ['a', 'b']);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/accepts a single option/);
  });

  it('accepts the additive Comparability SET and canonicalises its order', () => {
    const v = validateStarAnswer(NOS_COHORT, 'C1', ['b', 'a']);
    expect(v.ok).toBe(true);
    expect(v.values).toEqual(['a', 'b']);       // instrument option order, not input order
    expect(v.encoded).toBe('["a","b"]');
    expect(v.domainId).toBe('comparability');
  });

  it('rejects an unknown question and an empty response', () => {
    expect(validateStarAnswer(NOS_COHORT, 'ZZ', 'a').ok).toBe(false);
    expect(validateStarAnswer(NOS_COHORT, 'S1', '').ok).toBe(false);
    expect(validateStarAnswer(NOS_COHORT, 'S1', []).ok).toBe(false);
  });

  it('validates the case-control form against ITS own option lists', () => {
    // E1 has five options (a..e) on the case-control form; 'e' is valid there and
    // absent from the cohort form's items.
    expect(validateStarAnswer(NOS_CASE_CONTROL, 'E1', 'e').ok).toBe(true);
    expect(validateStarAnswer(NOS_CASE_CONTROL, 'E1', ['a', 'b']).ok).toBe(false);
    expect(validateStarAnswer(NOS_CASE_CONTROL, 'O1', 'a').ok).toBe(false); // cohort-only item
  });
});

// ── controller persistence ────────────────────────────────────────────────────
describe('upsertAnswers → RobAnswer / star columns', () => {
  it('rejects an unknown option value with 400 and stores NOTHING', async () => {
    const a = await newAssessment();
    const res = await answer(a.id, [{ questionId: 'S1', response: 'z' }]);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid option for S1/);
    expect(db.answers.filter(x => x.assessmentId === a.id)).toHaveLength(0);
  });

  it('rejects a 2-element array on a single-select item, and does not half-write the batch', async () => {
    const a = await newAssessment();
    const res = await answer(a.id, [
      { questionId: 'S1', response: 'a' },   // valid
      { questionId: 'S3', response: ['a', 'b'] }, // invalid — whole batch must be refused
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/S3 accepts a single option/);
    expect(db.answers.filter(x => x.assessmentId === a.id)).toHaveLength(0);
  });

  it('stores the additive Comparability answer as a JSON array string and scores 2 stars', async () => {
    const a = await newAssessment();
    const res = await answer(a.id, [{ questionId: 'C1', response: ['a', 'b'] }]);
    expect(res.statusCode).toBe(200);
    const row = db.answers.find(x => x.assessmentId === a.id && x.questionId === 'C1');
    expect(row.response).toBe('["a","b"]');
    expect(row.domainId).toBe('comparability');
    const dj = db.domainJudgments.find(x => x.assessmentId === a.id && x.domainId === 'comparability');
    expect(dj.proposedStars).toBe(2);
    expect(dj.proposedJudgment).toBe('2'); // BOTH representations written
  });

  it('writes proposedStars on every domain and the total (+ maxStars) on the overall', async () => {
    const a = await newAssessment();
    const res = await answer(a.id, FULL_COHORT);
    expect(res.statusCode).toBe(200);

    const stars = Object.fromEntries(
      db.domainJudgments.filter(x => x.assessmentId === a.id).map(x => [x.domainId, x.proposedStars]),
    );
    expect(stars).toEqual({ selection: 4, comparability: 2, outcome: 3 });

    const ov = db.overalls.find(x => x.assessmentId === a.id);
    expect(ov.proposedStars).toBe(9);
    expect(ov.maxStars).toBe(9);
    expect(ov.proposedOverall).toBe('9');

    expect(res.body.assessment.scoring).toBe('stars');
    expect(res.body.assessment.score.profile).toBe('4/4 · 2/2 · 3/3');
    expect(res.body.assessment.completeness.overall.complete).toBe(true);
  });

  it('a partly-starred set scores honestly (one star for a select:one alternative)', async () => {
    const a = await newAssessment();
    await answer(a.id, [
      { questionId: 'S1', response: 'c' },       // no star
      { questionId: 'S2', response: 'a' },       // star
      { questionId: 'S3', response: 'b' },       // starred alternative → 1
      { questionId: 'S4', response: 'b' },       // no star
      { questionId: 'C1', response: ['a'] },     // 1 of 2 additive stars
      { questionId: 'O1', response: 'a' },
      { questionId: 'O2', response: 'b' },       // no star
      { questionId: 'O3', response: 'd' },       // no star
    ]);
    const stars = Object.fromEntries(
      db.domainJudgments.filter(x => x.assessmentId === a.id).map(x => [x.domainId, x.proposedStars]),
    );
    expect(stars).toEqual({ selection: 2, comparability: 1, outcome: 1 });
    expect(db.overalls.find(x => x.assessmentId === a.id).proposedStars).toBe(4);
  });

  it('reuses the existing evidence columns for rationale / quote / locator (§23/§24)', async () => {
    const a = await newAssessment();
    await answer(a.id, [{
      questionId: 'O3', response: 'b',
      rationale: 'Loss to follow-up described.',
      evidenceQuote: 'Median follow-up 5.2 years; 41 participants (3%) were lost.',
      evidenceLocator: JSON.stringify({ page: 8 }),
    }]);
    const row = db.answers.find(x => x.assessmentId === a.id && x.questionId === 'O3');
    expect(row.rationale).toBe('Loss to follow-up described.');
    expect(row.evidenceQuote).toMatch(/Median follow-up/);
    expect(JSON.parse(row.evidenceLocator).page).toBe(8);
    expect(row.aiSuggested).toBe(false);
  });
});

describe('override + finalise write BOTH star representations', () => {
  it('a domain override stores the numeral AND finalStars, and the total follows', async () => {
    const a = await newAssessment();
    await answer(a.id, FULL_COHORT);

    const res = mkRes();
    await overrideJudgment(mkReq({
      params: { id: a.id },
      body: { target: 'domain', domainId: 'selection', finalJudgment: 2, justification: 'Cohort was a selected occupational group.' },
    }), res);
    expect(res.statusCode).toBe(200);

    const dj = db.domainJudgments.find(x => x.assessmentId === a.id && x.domainId === 'selection');
    expect(dj.finalStars).toBe(2);
    expect(dj.finalJudgment).toBe('2');
    expect(dj.proposedStars).toBe(4); // the engine proposal is preserved alongside
    expect(db.overalls.find(x => x.assessmentId === a.id).proposedStars).toBe(7);
    expect(res.body.assessment.overall.resolvedStars).toBe(7);
  });

  it('rejects a star override outside the domain maximum', async () => {
    const a = await newAssessment();
    await answer(a.id, FULL_COHORT);
    const res = mkRes();
    await overrideJudgment(mkReq({
      params: { id: a.id },
      body: { target: 'domain', domainId: 'comparability', finalJudgment: 3, justification: 'x' },
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/between 0 and 2/);
  });

  it('finalise locks finalStars on every domain and the overall', async () => {
    const a = await newAssessment();
    await answer(a.id, FULL_COHORT);
    const res = mkRes();
    await finaliseAssessment(mkReq({ params: { id: a.id } }), res);
    expect(res.statusCode).toBe(200);
    for (const dj of db.domainJudgments.filter(x => x.assessmentId === a.id)) {
      expect(dj.finalStars).toBe(dj.proposedStars);
    }
    const ov = db.overalls.find(x => x.assessmentId === a.id);
    expect(ov.finalStars).toBe(9);
    expect(ov.maxStars).toBe(9);
    expect(db.assessments.find(x => x.id === a.id).status).toBe('complete');
  });
});

// ── §22 thresholds ────────────────────────────────────────────────────────────
describe('coerceNosThresholds (101.md §22)', () => {
  it('defaults to mode none — the NOS defines no threshold', () => {
    expect(coerceNosThresholds(undefined)).toEqual({ mode: 'none', bands: [], label: '' });
    expect(coerceNosThresholds({ mode: 'nonsense' }).mode).toBe('none');
    // Bands are meaningless outside 'custom' and are dropped.
    expect(coerceNosThresholds({ mode: 'ahrq', bands: [{ max: 3, level: 'poor' }] }).bands).toEqual([]);
  });

  it('keeps only sane custom bands, sorted ascending', () => {
    const out = coerceNosThresholds({
      mode: 'custom',
      label: 'Protocol v2',
      bands: [
        { max: 9, level: 'high', label: 'High' },
        { max: 3, level: 'poor', label: 'Poor' },
        { max: 99, level: 'nope' },   // out of range
        { max: 5, level: '' },        // no level
      ],
    });
    expect(out.mode).toBe('custom');
    expect(out.label).toBe('Protocol v2');
    expect(out.bands.map(b => b.max)).toEqual([3, 9]);
  });

  it('PUT stores the config on the project blob and the view then interprets against it', async () => {
    const put = mkRes();
    await putNosThresholds(mkReq({
      params: { projectId: 'p1' },
      body: { mode: 'ahrq' },
    }), put);
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(db.projects[0].data).robNosThresholds).toEqual({ mode: 'ahrq', bands: [], label: '' });

    const get = mkRes();
    await getNosThresholds(mkReq({ params: { projectId: 'p1' } }), get);
    expect(get.body.thresholds.mode).toBe('ahrq');
    expect(get.body.defaultMode).toBe('none');

    // A study with zero comparability stars is POOR under AHRQ even at 7/9 — and the
    // verdict is never presented as an official NOS rule.
    const a = await newAssessment();
    const res = await answer(a.id, [
      { questionId: 'S1', response: 'a' }, { questionId: 'S2', response: 'a' },
      { questionId: 'S3', response: 'a' }, { questionId: 'S4', response: 'a' },
      { questionId: 'C1', response: [] },
      { questionId: 'O1', response: 'a' }, { questionId: 'O2', response: 'a' },
      { questionId: 'O3', response: 'a' },
    ]);
    // An empty additive answer is still rejected — the item must be answered.
    expect(res.statusCode).toBe(400);

    await answer(a.id, FULL_COHORT.filter(x => x.questionId !== 'C1'));
    const view = mkRes();
    await overrideJudgment(mkReq({
      params: { id: a.id },
      body: { target: 'domain', domainId: 'comparability', finalJudgment: 0, justification: 'No adjustment reported.' },
    }), view);
    expect(view.body.assessment.interpretation.mode).toBe('ahrq');
    expect(view.body.assessment.interpretation.level).toBe('poor');
    expect(view.body.assessment.interpretation.official).toBe(false);
    expect(view.body.assessment.interpretation.attribution).toMatch(/AHRQ/);
  });

  it('rejects a custom mode with no usable bands', async () => {
    const res = mkRes();
    await putNosThresholds(mkReq({ params: { projectId: 'p1' }, body: { mode: 'custom', bands: [] } }), res);
    expect(res.statusCode).toBe(400);
  });
});

// ── §25 dual reviewer + consensus ─────────────────────────────────────────────
describe('reviewerComparison (pure)', () => {
  const rows = [
    {
      id: 'a1', reviewerId: 'u1', reviewerName: 'One', status: 'complete',
      answersByDomain: { selection: { S1: 'a', S3: 'a' }, comparability: { C1: ['a', 'b'] }, outcome: {} },
    },
    {
      id: 'a2', reviewerId: 'u2', reviewerName: 'Two', status: 'complete',
      answersByDomain: { selection: { S1: 'b', S3: 'a' }, comparability: { C1: ['b', 'a'] }, outcome: {} },
    },
  ];

  it('flags only the questions on which two reviewers actually differ', () => {
    const cmp = reviewerComparison(NOS_COHORT, rows);
    expect(cmp.disagreements.map(d => d.questionId)).toEqual(['S1']);
    expect(cmp.disagreements[0].values).toEqual({ u1: 'a', u2: 'b' });
    expect(cmp.agreement.comparedQuestions).toBe(3); // S1, S3, C1
    expect(cmp.agreement.disagreedQuestions).toBe(1);
    expect(cmp.reviewers.map(r => r.reviewerId)).toEqual(['u1', 'u2']);
    expect(cmp.consensus).toBeNull();
  });

  it('the additive Comparability set compares order-insensitively', () => {
    const cmp = reviewerComparison(NOS_COHORT, rows);
    expect(cmp.disagreements.some(d => d.questionId === 'C1')).toBe(false);
  });

  it('a question only one reviewer answered is incomplete, not a disagreement', () => {
    const cmp = reviewerComparison(NOS_COHORT, [
      rows[0],
      { ...rows[1], answersByDomain: { selection: { S1: 'b' }, comparability: {}, outcome: {} } },
    ]);
    expect(cmp.disagreements.map(d => d.questionId)).toEqual(['S1']);
    expect(cmp.agreement.comparedQuestions).toBe(1);
  });

  it('excludes the consensus row from the comparison and reports it separately', () => {
    const cmp = reviewerComparison(NOS_COHORT, [
      ...rows,
      { id: 'a3', reviewerId: 'u3', reviewerName: 'Lead', status: CONSENSUS_STATUS, answersByDomain: { selection: { S1: 'a' }, comparability: {}, outcome: {} } },
    ]);
    expect(cmp.reviewers.map(r => r.reviewerId)).toEqual(['u1', 'u2']);
    expect(cmp.consensus.assessmentId).toBe('a3');
    expect(cmp.disagreements.map(d => d.questionId)).toEqual(['S1']);
  });
});

describe('dual reviewer + consensus through the API', () => {
  async function twoReviewers() {
    const r1 = await newAssessment({ userId: 'u1' });
    await answer(r1.id, [{ questionId: 'S1', response: 'a' }, { questionId: 'C1', response: ['a', 'b'] }], 'u1');
    const r2 = await newAssessment({ userId: 'u2' });
    await answer(r2.id, [{ questionId: 'S1', response: 'c' }, { questionId: 'C1', response: ['b', 'a'] }], 'u2');
    return { r1, r2 };
  }

  it('detects the disagreement between two reviewers of the same study', async () => {
    const { r1, r2 } = await twoReviewers();
    const res = mkRes();
    await getStudyReviewers(mkReq({ params: { projectId: 'p1', studyId: 's1' }, query: { instrumentId: 'NOS' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reviewers.map(r => r.assessmentId).sort()).toEqual([r1.id, r2.id].sort());
    expect(res.body.disagreements.map(d => d.questionId)).toEqual(['S1']);
    expect(res.body.disagreements[0].values).toEqual({ u1: 'a', u2: 'c' });
    expect(res.body.scoring).toBe('stars');
    // Each reviewer keeps their OWN score — neither is folded into the other.
    const byId = Object.fromEntries(res.body.reviewers.map(r => [r.assessmentId, r.score.total]));
    expect(byId[r1.id]).toBe(3); // S1 star + C1 two stars
    expect(byId[r2.id]).toBe(2); // S1 'c' earns nothing
  });

  it('refuses a consensus row until two independent reviewers exist', async () => {
    await newAssessment({ userId: 'u1' });
    const res = mkRes();
    await createConsensusAssessment(mkReq({
      params: { projectId: 'p1', studyId: 's1' }, body: { instrumentId: 'NOS' },
    }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.reviewerCount).toBe(1);
  });

  it('creates a THIRD row and leaves BOTH reviewer rows byte-identical', async () => {
    const { r1, r2 } = await twoReviewers();
    const before = clone({
      assessments: db.assessments.filter(a => a.id === r1.id || a.id === r2.id),
      answers: db.answers.filter(x => x.assessmentId === r1.id || x.assessmentId === r2.id),
      judgments: db.domainJudgments.filter(x => x.assessmentId === r1.id || x.assessmentId === r2.id),
      overalls: db.overalls.filter(x => x.assessmentId === r1.id || x.assessmentId === r2.id),
    });

    const res = mkRes();
    await createConsensusAssessment(mkReq({
      params: { projectId: 'p1', studyId: 's1' },
      body: { instrumentId: 'NOS', seedFromAssessmentId: r1.id },
    }), res);
    expect(res.statusCode).toBe(201);

    const consensusId = res.body.assessment.id;
    expect(consensusId).not.toBe(r1.id);
    expect(consensusId).not.toBe(r2.id);
    expect(res.body.assessment.status).toBe(CONSENSUS_STATUS);
    expect(res.body.assessment.isConsensus).toBe(true);
    expect(res.body.seededFrom.assessmentId).toBe(r1.id);

    // Nothing belonging to either reviewer changed.
    const after = clone({
      assessments: db.assessments.filter(a => a.id === r1.id || a.id === r2.id),
      answers: db.answers.filter(x => x.assessmentId === r1.id || x.assessmentId === r2.id),
      judgments: db.domainJudgments.filter(x => x.assessmentId === r1.id || x.assessmentId === r2.id),
      overalls: db.overalls.filter(x => x.assessmentId === r1.id || x.assessmentId === r2.id),
    });
    expect(after).toEqual(before);

    // The seed COPIED reviewer 1's answers into the new row (not moved them).
    const seeded = db.answers.filter(x => x.assessmentId === consensusId);
    expect(seeded.map(x => x.questionId).sort()).toEqual(['C1', 'S1']);
    expect(seeded.find(x => x.questionId === 'C1').response).toBe('["a","b"]');
    expect(db.answers.filter(x => x.assessmentId === r1.id)).toHaveLength(2);

    // A second consensus is refused rather than silently replacing the first.
    const dup = mkRes();
    await createConsensusAssessment(mkReq({
      params: { projectId: 'p1', studyId: 's1' }, body: { instrumentId: 'NOS' },
    }), dup);
    expect(dup.statusCode).toBe(409);
    expect(dup.body.assessmentId).toBe(consensusId);

    // And the reviewers view now surfaces it as the consensus, not as a reviewer.
    const view = mkRes();
    await getStudyReviewers(mkReq({ params: { projectId: 'p1', studyId: 's1' }, query: { instrumentId: 'NOS' } }), view);
    expect(view.body.consensus.assessmentId).toBe(consensusId);
    expect(view.body.reviewers).toHaveLength(2);

    // Every mutation is audited (§12).
    expect(db.audits.some(x => x.action === 'ROB_CONSENSUS_CREATE')).toBe(true);
  });

  it('finalising a consensus row keeps its consensus identity', async () => {
    const { r1 } = await twoReviewers();
    const created = mkRes();
    await createConsensusAssessment(mkReq({
      params: { projectId: 'p1', studyId: 's1' },
      body: { instrumentId: 'NOS', seedFromAssessmentId: r1.id },
    }), created);
    const cid = created.body.assessment.id;
    await answer(cid, FULL_COHORT);
    const res = mkRes();
    await finaliseAssessment(mkReq({ params: { id: cid } }), res);
    expect(res.statusCode).toBe(200);
    expect(db.assessments.find(a => a.id === cid).status).toBe(CONSENSUS_STATUS);
    expect(res.body.assessment.overall.resolvedStars).toBe(9);
  });
});
