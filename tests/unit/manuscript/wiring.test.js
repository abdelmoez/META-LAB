/**
 * 73.md Part 8 — manuscript DATA WIRING tests (features/manuscript/manuscriptData.js).
 * Covers: the pure endpoint→engine-opts mappers (screening summary/overview,
 * workflow, RoB v2 assessments, pecan per-source), the soft-fail fetch
 * orchestrator (dataStatus honesty; a dead network can never block generation),
 * and composeGenOpts (the exact genOpts contract the hook feeds the engine —
 * legacy byte-compat when no source is available).
 */
import { describe, it, expect } from 'vitest';
import {
  emptyManuscriptSources,
  linkedScreenProjectId,
  mapScreeningSummary,
  mapScreeningOverview,
  mapScreeningWorkflow,
  robJudgementLabel,
  mapRobAssessments,
  pickLatestCompletedRun,
  mapPecanPerSource,
  composeGenOpts,
  fetchManuscriptSources,
} from '../../../src/features/manuscript/manuscriptData.js';
import { generateDraft } from '../../../src/research-engine/manuscript/draft.js';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function project() {
  return {
    id: 'p1',
    name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?', P: 'Adults', I: 'Statins', C: 'Placebo', O: 'MACE' },
    search: { dbs: { pubmed: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: {},
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
    ],
  };
}

const okJson = (data) => ({ ok: true, json: async () => data });
const httpErr = (status) => ({ ok: false, status, json: async () => ({}) });

/** Route stub: first matching substring wins (order matters). */
function makeFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    for (const [pattern, resp] of routes) {
      if (String(url).includes(pattern)) return typeof resp === 'function' ? resp(url) : okJson(resp);
    }
    return httpErr(404);
  };
  f.calls = calls;
  return f;
}

const FLAGS_ALL_ON = { featureFlags: { searchEngine: true, rob_engine_v2: true, gradeCertainty: true, pecanSearch: true } };
const SUMMARY = {
  linked: true,
  prisma: { identified: 1250, duplicatesRemoved: 250, screened: 1000, excludedTitleAbstract: 800, fullTextAssessed: 200, fullTextExcluded: 150, included: 50 },
};
const OVERVIEW = {
  project: { requiredScreeningReviewers: 3, quorum: 2, blindMode: true },
  dataSummary: { totalArticles: 1000, screeningPool: 950, titleAbstractPending: 10, acceptedToExtraction: 42 },
};
const ROB_LIST = {
  assessments: [
    { studyId: 's1', overall: 'low', domainJudgments: { D1: 'low', D2: 'some' }, instrumentId: 'RoB2' },
    { studyId: 's1', overall: 'high', domainJudgments: { D1: 'high' }, instrumentId: 'RoB2' },
    { studyId: 's2', overall: 'some', domainJudgments: {} },
  ],
};
const RUNS = {
  runs: [
    { id: 'r1', state: 'completed', completedAt: '2026-06-01T10:00:00Z' },
    { id: 'r2', state: 'failed' },
    { id: 'r3', state: 'completed', completedAt: '2026-07-01T10:00:00Z' },
  ],
};
const RUN_DETAIL = {
  run: {
    id: 'r3', state: 'completed', completedAt: '2026-07-01T10:00:00Z',
    counts: { perSource: { pubmed: { raw: 100 }, doaj: { raw: 7 } } },
    sources: [{ provider: 'pubmed', state: 'completed', rawCount: 120, finalQuery: '(statin*) AND (cardio*)', completedAt: '2026-07-01T09:00:00Z' }],
  },
};

/* ── pure mappers ─────────────────────────────────────────────────────────── */

describe('linkedScreenProjectId', () => {
  it('reads _linkedMetaSift.id, then _screenProjectId, else null', () => {
    expect(linkedScreenProjectId({ _linkedMetaSift: { id: 'sp9' } })).toBe('sp9');
    expect(linkedScreenProjectId({ _screenProjectId: 'sp2' })).toBe('sp2');
    expect(linkedScreenProjectId({})).toBe(null);
    expect(linkedScreenProjectId(null)).toBe(null);
  });
});

describe('mapScreeningSummary — metalab summary → engine screening opts', () => {
  it('maps identified/afterDedup/screened/excluded/included', () => {
    expect(mapScreeningSummary(SUMMARY)).toEqual({
      identified: 1250, afterDedup: 1000, screened: 1000, excluded: 800, included: 50,
    });
  });
  it('null on unlinked / malformed / empty', () => {
    expect(mapScreeningSummary({ linked: false })).toBe(null);
    expect(mapScreeningSummary(null)).toBe(null);
    expect(mapScreeningSummary({ linked: true, prisma: {} })).toBe(null);
  });
  it('tolerates partial rollups (any subset)', () => {
    expect(mapScreeningSummary({ linked: true, prisma: { identified: 10 } })).toEqual({ identified: 10 });
  });
});

describe('mapScreeningOverview — honest fallback subset', () => {
  it('maps totals/pool/accepted and OMITS excluded (not derivable)', () => {
    const m = mapScreeningOverview(OVERVIEW);
    expect(m).toEqual({ identified: 1000, afterDedup: 950, screened: 950, included: 42 });
    expect(m.excluded).toBeUndefined();
  });
  it('null without a dataSummary', () => {
    expect(mapScreeningOverview({})).toBe(null);
  });
});

describe('mapScreeningWorkflow', () => {
  it('prefers requiredScreeningReviewers, carries blindMode', () => {
    expect(mapScreeningWorkflow(OVERVIEW)).toEqual({ reviewers: 3, blind: true });
  });
  it('falls back to quorum', () => {
    expect(mapScreeningWorkflow({ project: { quorum: 2 } })).toEqual({ reviewers: 2 });
  });
});

describe('mapRobAssessments — worst-overall per study, display labels', () => {
  it('keeps the WORST overall per study and labels judgements', () => {
    const m = mapRobAssessments(ROB_LIST.assessments);
    expect(m.assessments.s1.overall).toBe('High');
    expect(m.assessments.s1.domains).toEqual({ D1: 'High' });
    expect(m.assessments.s1.tool).toBe('RoB2');
    expect(m.assessments.s2.overall).toBe('Some concerns');
    expect(m.robByStudyId).toEqual({ s1: 'High', s2: 'Some concerns' });
    // A single-tool review is unchanged: one group, no mixed-tool flag.
    expect(m.mixedTools).toBe(false);
    expect(m.instrumentIds).toEqual(['RoB2']);
    expect(m.primaryInstrumentId).toBe('RoB2');
    expect(m.byInstrument).toHaveLength(1);
    expect(m.byInstrument[0].studyCount).toBe(2);
  });
  it('null on empty input', () => {
    expect(mapRobAssessments([])).toBe(null);
    expect(mapRobAssessments(undefined)).toBe(null);
  });

  // 115.md decision 7 — outputs GROUP BY instrument; there is no cross-tool
  // aggregate anywhere, and the collision that made one mandatory is real: AMSTAR
  // 2's BEST rating is the string 'high', which the risk-of-bias rank scores as the
  // worst possible judgement.
  it('NEVER compares judgements across tools — AMSTAR 2 "High confidence" cannot outrank RoB 2 "Low"', () => {
    const m = mapRobAssessments([
      { studyId: 's1', overall: 'low', domainJudgments: { D1: 'low' }, instrumentId: 'RoB2' },
      { studyId: 's1', overall: 'high', domainJudgments: {}, instrumentId: 'AMSTAR-2' },
    ]);
    expect(m.mixedTools).toBe(true);
    expect(m.instrumentIds).toEqual(['AMSTAR-2', 'RoB2']);
    // Each tool keeps its own answer, on its own scale.
    const amstar = m.byInstrument.find(g => g.instrumentId === 'AMSTAR-2');
    const rob2 = m.byInstrument.find(g => g.instrumentId === 'RoB2');
    expect(amstar.assessments.s1.overall).toBe('High');
    expect(rob2.assessments.s1.overall).toBe('Low');
    // …and the flat map serves the study from ONE tool, never a blend of the two.
    expect(m.assessments.s1.tool).toBe(m.primaryInstrumentId);
    expect(['Low', 'High']).toContain(m.robByStudyId.s1);
  });

  it('ranks within a tool, keeps every study, and reports per-tool counts', () => {
    const m = mapRobAssessments([
      { studyId: 's1', overall: 'low', domainJudgments: { D1: 'low' }, instrumentId: 'RoB2' },
      { studyId: 's1', overall: 'high', domainJudgments: { D1: 'high' }, instrumentId: 'RoB2' },
      { studyId: 's2', overall: 'some', domainJudgments: {}, instrumentId: 'RoB2' },
      { studyId: 's3', overall: 'critically-low', domainJudgments: {}, instrumentId: 'AMSTAR-2' },
    ]);
    // RoB 2 covers two studies → primary; the worst-within-tool rule still applies.
    expect(m.primaryInstrumentId).toBe('RoB2');
    expect(m.assessments.s1.overall).toBe('High');
    // A study only the secondary tool assessed is still reported (never dropped).
    expect(m.assessments.s3.overall).toBe('Critically-low');
    expect(m.assessments.s3.tool).toBe('AMSTAR-2');
    expect(m.byInstrument.map(g => [g.instrumentId, g.studyCount]))
      .toEqual([['AMSTAR-2', 1], ['RoB2', 2]]);
  });

  // The severity ladder was missing its UNCERTAIN rung. QUADAS-2 and PROBAST rate
  // Low / High / **Unclear** and ROBINS-I answers **No information**; neither was in
  // ROB_RANK, so `ROB_RANK[...] || 0` scored them BELOW 'low' and a study the
  // reviewer could not judge was reported in the manuscript as Low risk of bias.
  it('ranks Unclear / No information as WORSE than low and better than high', () => {
    const worst = (rows) => mapRobAssessments(rows).assessments.s1.overall;
    // Order-independent in both directions — the bug only showed one way round.
    expect(worst([
      { studyId: 's1', overall: 'unclear', domainJudgments: {}, instrumentId: 'PROBAST' },
      { studyId: 's1', overall: 'low', domainJudgments: {}, instrumentId: 'PROBAST' },
    ])).toBe('Unclear');
    expect(worst([
      { studyId: 's1', overall: 'low', domainJudgments: {}, instrumentId: 'PROBAST' },
      { studyId: 's1', overall: 'unclear', domainJudgments: {}, instrumentId: 'PROBAST' },
    ])).toBe('Unclear');
    // …but High still beats Unclear.
    expect(worst([
      { studyId: 's1', overall: 'unclear', domainJudgments: {}, instrumentId: 'QUADAS-2' },
      { studyId: 's1', overall: 'high', domainJudgments: {}, instrumentId: 'QUADAS-2' },
    ])).toBe('High');
    // ROBINS-I's `ni`, same rung — and it renders as words, not "Ni".
    expect(worst([
      { studyId: 's1', overall: 'ni', domainJudgments: {}, instrumentId: 'ROBINS-I' },
      { studyId: 's1', overall: 'low', domainJudgments: {}, instrumentId: 'ROBINS-I' },
    ])).toBe('No information');
    expect(worst([
      { studyId: 's1', overall: 'ni', domainJudgments: {}, instrumentId: 'ROBINS-I' },
      { studyId: 's1', overall: 'serious', domainJudgments: {}, instrumentId: 'ROBINS-I' },
    ])).toBe('Serious');
  });

  it('a tool with no severity order is never ranked — the first row stands', () => {
    const m = mapRobAssessments([
      { studyId: 's1', overall: 'include', domainJudgments: {}, instrumentId: 'JBI-CaseSeries' },
      { studyId: 's1', overall: 'exclude', domainJudgments: {}, instrumentId: 'JBI-CaseSeries' },
    ]);
    expect(m.assessments.s1.overall).toBe('Include');
  });
  it('robJudgementLabel covers RoB2 + ROBINS-I vocabularies', () => {
    expect(robJudgementLabel('low')).toBe('Low');
    expect(robJudgementLabel('some')).toBe('Some concerns');
    expect(robJudgementLabel('serious')).toBe('Serious');
    expect(robJudgementLabel('no_information')).toBe('No information');
    expect(robJudgementLabel('')).toBe('');
  });
});

describe('pecan run → perSource', () => {
  it('picks the NEWEST completed run', () => {
    expect(pickLatestCompletedRun(RUNS.runs).id).toBe('r3');
    expect(pickLatestCompletedRun([{ id: 'x', state: 'failed' }])).toBe(null);
  });
  it('maps provider rows to {records, searchedAt, query} and covers counts-only providers', () => {
    const ps = mapPecanPerSource(RUN_DETAIL.run);
    expect(ps.pubmed).toEqual({ records: 120, searchedAt: '2026-07-01', query: '(statin*) AND (cardio*)' });
    expect(ps.doaj).toEqual({ records: 7, searchedAt: '2026-07-01', query: '' });
  });
});

/* ── composeGenOpts (the hook→engine contract) ────────────────────────────── */

describe('composeGenOpts', () => {
  it('legacy shape when no sources: runMeta/prec/analysis only, NO tau2Method without analysisSettings', () => {
    const o = composeGenOpts({ project: project(), runMeta, gradeByOutcome: null, sources: emptyManuscriptSources() });
    expect(o.runMeta).toBe(runMeta);
    expect(o.analysis).toEqual({ model: 'random' });
    expect('tau2Method' in o.analysis).toBe(false);
    for (const k of ['screening', 'searchMethodsText', 'robAssessments', 'reviewers', 'blind', 'gradeByOutcome']) {
      expect(k in o).toBe(false);
    }
  });
  it('threads the persisted tau2Method (analysisSettings) into analysis', () => {
    const p = { ...project(), analysisSettings: { tau2Method: 'REML' } };
    const o = composeGenOpts({ project: p, runMeta, sources: emptyManuscriptSources() });
    expect(o.analysis).toEqual({ model: 'random', tau2Method: 'REML' });
  });
  it('threads screening/searchMethodsText/robAssessments/reviewers/blind when available', () => {
    const sources = {
      ...emptyManuscriptSources(),
      screening: { identified: 10, included: 3 },
      screeningWorkflow: { reviewers: 2, blind: true },
      searchMethodsText: 'We searched…',
      robAssessments: { s1: { domains: {}, overall: 'Low' } },
    };
    const o = composeGenOpts({ project: project(), runMeta, gradeByOutcome: { 'MACE|||': 'Moderate' }, sources });
    expect(o.screening).toEqual({ identified: 10, included: 3 });
    expect(o.searchMethodsText).toBe('We searched…');
    expect(o.robAssessments.s1.overall).toBe('Low');
    expect(o.reviewers).toBe(2);
    expect(o.blind).toBe(true);
    expect(o.gradeByOutcome).toEqual({ 'MACE|||': 'Moderate' });
  });
  it('BYTE-COMPAT: generation with composed-empty opts equals the legacy call', () => {
    const p = project();
    const legacy = generateDraft(p, { runMeta });
    const wired = generateDraft(p, composeGenOpts({ project: p, runMeta, sources: emptyManuscriptSources() }));
    expect(wired.methods).toBe(legacy.methods);
    expect(wired.results).toBe(legacy.results);
    expect(wired.abstract).toBe(legacy.abstract);
  });
});

/* ── fetch orchestrator (soft-fail, dataStatus honesty) ───────────────────── */

describe('fetchManuscriptSources', () => {
  it('happy path: every source wired, dataStatus all ok', async () => {
    const f = makeFetch([
      ['/api/settings/public', FLAGS_ALL_ON],
      ['/api/screening/metalab/p1/summary', SUMMARY],
      ['/api/screening/projects/sp1/overview', OVERVIEW],
      ['/api/search-builder/p1/methods-text', { text: 'We searched PubMed on 15 Jan 2026 using…' }],
      ['/api/rob/projects/p1/assessments', ROB_LIST],
      ['/runs/r3', RUN_DETAIL],
      ['/runs?', RUNS],
    ]);
    const r = await fetchManuscriptSources({ projectId: 'p1', screenProjectId: 'sp1', fetchImpl: f });
    expect(r.dataStatus).toEqual({ screening: 'ok', search: 'ok', rob: 'ok', grade: 'ok', pecan: 'ok' });
    expect(r.screening).toEqual({ identified: 1250, afterDedup: 1000, screened: 1000, excluded: 800, included: 50 });
    expect(r.screeningWorkflow).toEqual({ reviewers: 3, blind: true });
    expect(r.searchMethodsText).toMatch(/We searched PubMed/);
    expect(r.robAssessments.s1.overall).toBe('High');
    expect(r.robByStudyId.s2).toBe('Some concerns');
    expect(r.perSource.pubmed.records).toBe(120);
  });

  it('summary counts WIN over the overview fallback; overview still supplies workflow', async () => {
    const f = makeFetch([
      ['/api/settings/public', { featureFlags: {} }],
      ['/api/screening/metalab/p1/summary', SUMMARY],
      ['/api/screening/projects/sp1/overview', OVERVIEW],
    ]);
    const r = await fetchManuscriptSources({ projectId: 'p1', screenProjectId: 'sp1', fetchImpl: f });
    expect(r.screening.identified).toBe(1250); // summary, not the overview's 1000
    expect(r.screeningWorkflow).toEqual({ reviewers: 3, blind: true });
  });

  it('overview counts fill in when the summary endpoint fails', async () => {
    const f = makeFetch([
      ['/api/settings/public', { featureFlags: {} }],
      ['/api/screening/metalab/p1/summary', () => httpErr(500)],
      ['/api/screening/projects/sp1/overview', OVERVIEW],
    ]);
    const r = await fetchManuscriptSources({ projectId: 'p1', screenProjectId: 'sp1', fetchImpl: f });
    expect(r.screening).toEqual({ identified: 1000, afterDedup: 950, screened: 950, included: 42 });
    expect(r.dataStatus.screening).toBe('ok');
  });

  it('unlinked screening reports "unlinked" and null counts', async () => {
    const f = makeFetch([
      ['/api/settings/public', { featureFlags: {} }],
      ['/api/screening/metalab/p1/summary', { linked: false }],
    ]);
    const r = await fetchManuscriptSources({ projectId: 'p1', fetchImpl: f });
    expect(r.dataStatus.screening).toBe('unlinked');
    expect(r.screening).toBe(null);
  });

  it('flags OFF → search/rob/pecan/grade all "off" and never fetched', async () => {
    const f = makeFetch([
      ['/api/settings/public', { featureFlags: {} }],
      ['/api/screening/metalab/p1/summary', { linked: false }],
    ]);
    const r = await fetchManuscriptSources({ projectId: 'p1', fetchImpl: f });
    expect(r.dataStatus).toEqual({ screening: 'unlinked', search: 'off', rob: 'off', grade: 'off', pecan: 'off' });
    expect(f.calls.some((u) => u.includes('/api/rob/'))).toBe(false);
    expect(f.calls.some((u) => u.includes('/api/search-builder/'))).toBe(false);
    expect(f.calls.some((u) => u.includes('/api/pecan-search/'))).toBe(false);
  });

  it('flag ON but endpoint 404s → "off" (server-side gate wins)', async () => {
    const f = makeFetch([
      ['/api/settings/public', FLAGS_ALL_ON],
      ['/api/screening/metalab/p1/summary', { linked: false }],
      ['/api/search-builder/p1/methods-text', () => httpErr(404)],
      ['/api/rob/projects/p1/assessments', () => httpErr(404)],
      ['/api/pecan-search/', () => httpErr(404)],
    ]);
    const r = await fetchManuscriptSources({ projectId: 'p1', fetchImpl: f });
    expect(r.dataStatus.search).toBe('off');
    expect(r.dataStatus.rob).toBe('off');
    expect(r.dataStatus.pecan).toBe('off');
  });

  it('pecan on but no completed run → "ok" with perSource null', async () => {
    const f = makeFetch([
      ['/api/settings/public', FLAGS_ALL_ON],
      ['/api/screening/metalab/p1/summary', { linked: false }],
      ['/api/search-builder/p1/methods-text', { text: '' }],
      ['/api/rob/projects/p1/assessments', { assessments: [] }],
      ['/runs?', { runs: [{ id: 'r2', state: 'failed' }] }],
    ]);
    const r = await fetchManuscriptSources({ projectId: 'p1', fetchImpl: f });
    expect(r.dataStatus.pecan).toBe('ok');
    expect(r.perSource).toBe(null);
    expect(r.robAssessments).toBe(null); // empty list → null, but rob is reachable
    expect(r.dataStatus.rob).toBe('ok');
  });

  it('SOFT-FAIL: total network failure never throws; generation still runs on legacy opts', async () => {
    const f = async () => { throw new Error('ECONNREFUSED'); };
    const r = await fetchManuscriptSources({ projectId: 'p1', screenProjectId: 'sp1', fetchImpl: f });
    expect(r.dataStatus).toEqual({ screening: 'error', search: 'off', rob: 'off', grade: 'off', pecan: 'off' });
    expect(r.screening).toBe(null);
    expect(r.searchMethodsText).toBe('');
    // …and the engine still generates the legacy draft from these sources.
    const p = project();
    const legacy = generateDraft(p, { runMeta });
    const after = generateDraft(p, composeGenOpts({ project: p, runMeta, sources: r }));
    expect(after.methods).toBe(legacy.methods);
    expect(after.results).toBe(legacy.results);
  });

  it('no projectId → inert empty result, zero fetches', async () => {
    const f = makeFetch([]);
    const r = await fetchManuscriptSources({ fetchImpl: f });
    expect(r).toEqual(emptyManuscriptSources());
    expect(f.calls.length).toBe(0);
  });
});
