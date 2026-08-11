/**
 * robRegistry115.test.js — 115.md W1-B. Unit tests for the PURE server-side
 * registry / vocabulary / applicability / export helpers exported by
 * robController.js + robExportService.js. No Prisma, no HTTP.
 *
 * These prove the SERVER GENERALISATION independently of W1-A: every helper is
 * exercised both against the four real instruments (RoB 2 / ROBINS-I / NOS /
 * NOS-CC — the regression half) and against synthetic definitions shaped like the
 * nine new tools (applicability kinds, checklist responses, overall-decision
 * enums, "no overall at all"), so the behaviour is pinned before those
 * definitions land in the registry.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveInstrument,
  registeredInstrumentIds,
  isRegisteredInstrument,
  levelValues,
  allowedResponsesFor,
  domainJudgmentLevels,
  overallLevelsFor,
  applicabilityKey,
  parseDomainKey,
  isApplicabilityKey,
  applicabilityLevelsFor,
  applicabilityDomainIds,
  designsForTool,
  detectStudyDesign,
  recommendationFor,
  instrumentSlug,
  instrumentIdForSlug,
  questionsOf,
  APPLICABILITY_SUFFIX,
  OVERALL_APPLICABILITY_DOMAIN_ID,
  overallApplicabilityKey,
  overallApplicabilityLevels,
  overallReadsProposals,
  overallJudgmentToPersist,
} from '../../server/controllers/robController.js';
import {
  buildRobProjectCsv, columnsForInstrument, joinNotes, flatten,
} from '../../server/services/robExportService.js';
import {
  APPLICABILITY_SUFFIX as ENGINE_APPLICABILITY_SUFFIX,
  applicabilityDomainId as engineApplicabilityDomainId,
} from '../../src/research-engine/rob/index.js';

// ── Synthetic definitions shaped like the nine 115.md tools ───────────────────
// QUADAS-2-shaped: risk-of-bias signalling items + an applicability item, with a
// Yes/No/Unclear checklist vocabulary that is NOT the shared Y/PY/PN/N/NI set.
const QUADAS_LIKE = Object.freeze({
  id: 'QUADAS-2-fake',
  name: 'QUADAS-2 (fake)',
  instrumentVersion: '2011',
  variant: '',
  applicabilityLevels: ['low', 'high', 'unclear'],
  judgmentLevels: [{ value: 'low' }, { value: 'high' }, { value: 'unclear' }],
  domains: [
    {
      id: 'D1',
      name: 'Patient Selection',
      applicability: true,
      questions: [
        { id: '1.1', text: 'Consecutive or random sample?', kind: 'signaling', responses: ['yes', 'no', 'unclear'] },
        { id: '1.A', text: 'Applicability concern?', kind: 'applicability', responses: ['low', 'high', 'unclear'] },
      ],
    },
    {
      id: 'D4',
      name: 'Flow and Timing',
      questions: [{ id: '4.1', text: 'Appropriate interval?', kind: 'signaling', responses: ['yes', 'no', 'unclear'] }],
    },
  ],
});

// JBI-shaped: a flat checklist with an instrument-level vocabulary and an OVERALL
// APPRAISAL DECISION enum that is not a risk-of-bias level.
const JBI_LIKE = Object.freeze({
  id: 'JBI-CaseSeries-fake',
  name: 'JBI Case Series (fake)',
  version: '2020',
  itemResponses: ['yes', 'no', 'unclear', 'na'],
  judgmentLevels: [{ value: 'yes' }, { value: 'no' }, { value: 'unclear' }, { value: 'na' }],
  overallLevels: ['include', 'exclude', 'seek-further-info'],
  scoringAllowed: false,
  domains: [{ id: 'checklist', name: 'Checklist', items: [{ id: 'q1', text: 'Clear inclusion criteria?' }] }],
});

// QUIPS-shaped: domain ratings ONLY — the tool defines no overall judgement.
const QUIPS_LIKE = Object.freeze({
  id: 'QUIPS-fake',
  name: 'QUIPS (fake)',
  instrumentVersion: '2013',
  judgmentLevels: [{ value: 'low' }, { value: 'moderate' }, { value: 'high' }],
  overallLevels: null,
  domains: [{ id: 'participation', name: 'Study Participation', questions: [{ id: 'p1', text: 'Participation rate?' }] }],
});

describe('115 — registry-driven instrument resolution', () => {
  it('resolves every historical instrument', () => {
    for (const id of ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC']) {
      expect(resolveInstrument(id), id).toBeTruthy();
      expect(isRegisteredInstrument(id)).toBe(true);
    }
  });

  it('returns null (never throws) for an unknown id', () => {
    expect(resolveInstrument('NOT-A-TOOL')).toBeNull();
    expect(resolveInstrument('')).toBeNull();
    expect(resolveInstrument(null)).toBeNull();
    expect(isRegisteredInstrument('NOT-A-TOOL')).toBe(false);
  });

  it('never advertises a catalogue entry that has no definition', () => {
    const ids = registeredInstrumentIds();
    expect(ids).toContain('RoB2');
    expect(ids).toContain('NOS-CC');
    // `custom` is a catalogue placeholder with no definition — advertising a tool
    // is not the same as being able to assess with it.
    expect(ids).not.toContain('custom');
    for (const id of ids) expect(resolveInstrument(id), id).toBeTruthy();
    expect(new Set(ids).size).toBe(ids.length); // de-duplicated
  });

  it('resolves instruments by URL slug, legacy alias or own id', () => {
    expect(instrumentIdForSlug('rob2')).toBe('RoB2');
    expect(instrumentIdForSlug('robins-i')).toBe('ROBINS-I');
    expect(instrumentIdForSlug('nos-case-control')).toBe('NOS-CC');
    // Registry-driven fallback: the id's own slug always works, so a newly
    // registered tool needs no route-table edit.
    expect(instrumentIdForSlug('nos-cc')).toBe('NOS-CC');
    expect(instrumentIdForSlug('unknown-tool')).toBeNull();
    expect(instrumentSlug('QUADAS-2')).toBe('quadas-2');
    expect(instrumentSlug('JBI Case Series')).toBe('jbi-case-series');
  });
});

describe('115 — definition-driven response vocabularies', () => {
  it('falls back to the shared Y/PY/PN/N/NI/NA set for RoB 2 (unchanged path)', () => {
    const rob2 = resolveInstrument('RoB2');
    const d1 = rob2.domains[0];
    const allowed = allowedResponsesFor(rob2, d1, questionsOf(d1)[0]);
    for (const r of ['Y', 'PY', 'PN', 'N', 'NI', 'NA']) expect(allowed.has(r), r).toBe(true);
    expect(allowed.has('yes')).toBe(false);
  });

  it('NA stays storable on RoB 2 even though it is excluded from responseOptions', () => {
    const rob2 = resolveInstrument('RoB2');
    // rob2.responseOptions deliberately drops NA (it is a UI list, not a storage
    // vocabulary) — reading it here would start rejecting a legal answer.
    expect(rob2.responseOptions.some(o => o.value === 'NA')).toBe(false);
    expect(allowedResponsesFor(rob2, rob2.domains[0], questionsOf(rob2.domains[0])[0]).has('NA')).toBe(true);
  });

  it('uses an item-level vocabulary when the definition declares one', () => {
    const d1 = QUADAS_LIKE.domains[0];
    const allowed = allowedResponsesFor(QUADAS_LIKE, d1, questionsOf(d1)[0]);
    expect([...allowed].sort()).toEqual(['no', 'unclear', 'yes']);
    expect(allowed.has('PY')).toBe(false); // an off-form value is never storable
  });

  it('uses an instrument-level checklist vocabulary (JBI)', () => {
    const d = JBI_LIKE.domains[0];
    const allowed = allowedResponsesFor(JBI_LIKE, d, questionsOf(d)[0]);
    expect([...allowed].sort()).toEqual(['na', 'no', 'unclear', 'yes']);
  });

  it('levelValues accepts strings and {value} objects and de-duplicates', () => {
    expect(levelValues(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(levelValues([{ value: 'low' }, { value: 'high' }])).toEqual(['low', 'high']);
    expect(levelValues(null)).toEqual([]);
    expect(levelValues([{ label: 'no value' }, 3, ''])).toEqual([]);
  });
});

describe('115 — overall vocabularies (never invented)', () => {
  it('keeps the domain vocabulary for tools that declare no separate overall', () => {
    expect(overallLevelsFor(resolveInstrument('RoB2'))).toEqual(['low', 'some', 'high']);
    expect(overallLevelsFor(resolveInstrument('ROBINS-I'))).toEqual(['low', 'moderate', 'serious', 'critical', 'ni']);
  });

  it('serves the JBI overall APPRAISAL DECISION enum, not a bias level', () => {
    expect(overallLevelsFor(JBI_LIKE)).toEqual(['include', 'exclude', 'seek-further-info']);
  });

  it('returns null when the tool has no overall judgement at all (QUIPS)', () => {
    expect(overallLevelsFor(QUIPS_LIKE)).toBeNull();
  });

  it('domainJudgmentLevels prefers a domain-level override', () => {
    expect(domainJudgmentLevels(QUIPS_LIKE, null)).toEqual(['low', 'moderate', 'high']);
    expect(domainJudgmentLevels(QUADAS_LIKE, { judgmentLevels: ['x', 'y'] })).toEqual(['x', 'y']);
  });
});

describe('115 — applicability storage discriminator', () => {
  it('namespaces the key and round-trips it', () => {
    expect(applicabilityKey('D1')).toBe(`D1${APPLICABILITY_SUFFIX}`);
    expect(parseDomainKey('D1')).toEqual({ domainId: 'D1', kind: 'rob' });
    expect(parseDomainKey(applicabilityKey('D1'))).toEqual({ domainId: 'D1', kind: 'applicability' });
    expect(isApplicabilityKey('D1')).toBe(false);
    expect(isApplicabilityKey(applicabilityKey('D1'))).toBe(true);
  });

  it('cannot collide with any real domain id in ANY registered instrument', () => {
    for (const id of registeredInstrumentIds()) {
      for (const d of resolveInstrument(id).domains) {
        expect(isApplicabilityKey(d.id), `${id}.${d.id}`).toBe(false);
      }
    }
  });

  it('uses the PURE ENGINE\'s storage key — server and renderer never drift', () => {
    // The suffix is defined once, in instruments/shared.js.
    expect(applicabilityKey('D1')).toBe(engineApplicabilityDomainId('D1'));
    expect(APPLICABILITY_SUFFIX).toBe(ENGINE_APPLICABILITY_SUFFIX);
  });

  it('detects applicability domains only where the definition declares them', () => {
    expect(applicabilityDomainIds(QUADAS_LIKE)).toEqual(['D1']);
    expect(applicabilityLevelsFor(QUADAS_LIKE, QUADAS_LIKE.domains[0])).toEqual(['low', 'high', 'unclear']);
    expect(applicabilityLevelsFor(QUADAS_LIKE, QUADAS_LIKE.domains[1])).toBeNull();
    for (const id of ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC']) {
      expect(applicabilityDomainIds(resolveInstrument(id)), id).toEqual([]);
    }
  });

  it('infers applicability from a kind:"applicability" item alone', () => {
    const inferred = {
      id: 'X', judgmentLevels: [{ value: 'low' }, { value: 'high' }],
      domains: [{ id: 'D1', items: [{ id: 'a1', kind: 'applicability', responses: ['low', 'high'] }] }],
    };
    expect(applicabilityLevelsFor(inferred, inferred.domains[0])).toEqual(['low', 'high']);
  });
});

// ── The REAL definitions, once W1-A has registered them ──────────────────────
// Self-skipping: with only the historical four registered these assert nothing
// (the synthetic cases above already pin the behaviour); once the nine land they
// pin the server against the shipped definitions rather than a mock of them.
describe('115 — against the shipped definitions (self-skips before W1-A lands)', () => {
  const has = id => !!resolveInstrument(id);

  it('QUADAS-2: applicability on D1–D3, per-item Yes/No/Unclear, NO overall', () => {
    if (!has('QUADAS-2')) return;
    const q = resolveInstrument('QUADAS-2');
    expect(applicabilityDomainIds(q)).toEqual(['D1', 'D2', 'D3']);   // never D4
    expect(applicabilityLevelsFor(q, q.domains[0])).toEqual(['low', 'high', 'unclear']);
    const signalling = questionsOf(q.domains[0]).find(x => x.kind === 'signaling');
    expect([...allowedResponsesFor(q, q.domains[0], signalling)].sort()).toEqual(['N', 'U', 'Y']);
    // QUADAS-2 prescribes per-domain reporting and NO summary judgement.
    expect(overallLevelsFor(q)).toBeNull();
    expect(q.scoringAllowed).toBe(false);
  });

  it('PROBAST: applicability on D1–D3, signalling vocabulary, computed overall', () => {
    if (!has('PROBAST')) return;
    const p = resolveInstrument('PROBAST');
    expect(applicabilityDomainIds(p)).toEqual(['D1', 'D2', 'D3']);
    expect(overallLevelsFor(p)).toEqual(['low', 'high', 'unclear']);
    const q0 = questionsOf(p.domains[0])[0];
    expect(allowedResponsesFor(p, p.domains[0], q0).has('PY')).toBe(true);
    expect(allowedResponsesFor(p, p.domains[0], q0).has('yes')).toBe(false);
  });

  it('JBI: overall is an appraisal DECISION and domains carry no rating', () => {
    for (const id of ['JBI-CaseSeries', 'JBI-CaseReport', 'JBI-Prevalence', 'JBI-CrossSectional', 'JBI-Qualitative']) {
      if (!has(id)) continue;
      const inst = resolveInstrument(id);
      expect(overallLevelsFor(inst), id).toEqual(['include', 'exclude', 'seek-further-info']);
      expect(domainJudgmentLevels(inst, inst.domains[0]), id).toEqual([]);
      expect(applicabilityDomainIds(inst), id).toEqual([]);
      expect(inst.scoringAllowed, id).toBe(false);
    }
  });

  it('QUIPS + AMSTAR 2 keep their own vocabularies and never a score', () => {
    if (has('QUIPS')) {
      const quips = resolveInstrument('QUIPS');
      expect(domainJudgmentLevels(quips, quips.domains[0])).toEqual(['low', 'moderate', 'high']);
      expect(quips.scoringAllowed).toBe(false);
    }
    if (has('AMSTAR-2')) {
      const amstar = resolveInstrument('AMSTAR-2');
      expect(overallLevelsFor(amstar)).toEqual(['high', 'moderate', 'low', 'critically-low']);
      expect(amstar.scoringAllowed).toBe(false);
      // AMSTAR 2's vocabulary is PER ITEM: only the five items whose official form
      // offers "Partial Yes" accept it. The server reads each item's own list, so
      // it enforces that distinction instead of one instrument-wide set.
      const items = questionsOf(amstar.domains[0]);
      const byId = id => items.find(q => q.id === id);
      expect(allowedResponsesFor(amstar, amstar.domains[0], byId('2')).has('PARTIAL_YES')).toBe(true);
      expect(allowedResponsesFor(amstar, amstar.domains[0], byId('1')).has('PARTIAL_YES')).toBe(false);
      expect(allowedResponsesFor(amstar, amstar.domains[0], byId('1')).has('Y')).toBe(true);
    }
  });

  it('only the NOS is allowed to produce a number', () => {
    for (const id of registeredInstrumentIds()) {
      const inst = resolveInstrument(id);
      const allowed = inst.scoringAllowed != null ? !!inst.scoringAllowed : inst.scoring === 'stars';
      expect(allowed, id).toBe(id === 'NOS' || id === 'NOS-CC');
    }
  });

  it('every registered instrument carries a version to stamp', () => {
    for (const id of registeredInstrumentIds()) {
      const inst = resolveInstrument(id);
      expect(String(inst.instrumentVersion || inst.version || ''), id).not.toBe('');
    }
  });
});

describe('115 — design detection + recommendations', () => {
  const catalogue = [
    { id: 'RoB2', label: 'RoB 2', designs: ['parallel-group'] },
    { id: 'ROBINS-I', label: 'ROBINS-I', designs: ['non-randomised'] },
    { id: 'NOS', label: 'Newcastle–Ottawa (cohort)', designs: ['cohort'] },
    { id: 'NOS-CC', label: 'Newcastle–Ottawa (case-control)', designs: ['case-control'] },
    { id: 'QUIPS', label: 'QUIPS', designs: ['prognostic', 'cohort'] },
  ];

  it('reads whatever design field the source record happens to carry', () => {
    expect(detectStudyDesign({ design: 'RCT' })).toBe('RCT');
    expect(detectStudyDesign({ studyType: 'prospective cohort' })).toBe('prospective cohort');
    expect(detectStudyDesign({ study_design: ' cluster RCT ' })).toBe('cluster RCT');
    expect(detectStudyDesign({})).toBe('');
    expect(detectStudyDesign(null)).toBe('');
  });

  it('recommends by design, keeps every tool compatible, and warns on mismatch', () => {
    const r = recommendationFor('randomised controlled trial', catalogue);
    expect(r.recommendedToolIds).toEqual(['RoB2']);
    expect(r.compatibleToolIds).toHaveLength(catalogue.length); // nothing is hidden
    expect(r.mismatchToolIds).toContain('NOS');
    expect(r.mismatchToolIds).not.toContain('RoB2');
    expect(r.warning).toContain('RoB 2');
  });

  it('does not flag a tool that declares it covers the detected design', () => {
    const r = recommendationFor('prospective cohort study', catalogue);
    expect(r.recommendedToolIds).toEqual(['NOS']);
    // QUIPS declares 'cohort', so it is not a mismatch even though NOS is the pick.
    expect(r.mismatchToolIds).not.toContain('QUIPS');
    expect(r.mismatchToolIds).toContain('RoB2');
  });

  it('unknown / unroutable design → NO recommendation and NO warning', () => {
    for (const d of ['', null, 'a study of some kind']) {
      const r = recommendationFor(d, catalogue);
      expect(r.recommendedToolIds).toEqual([]);
      expect(r.mismatchToolIds).toEqual([]);
      expect(r.warning).toBe('');
      expect(r.compatibleToolIds).toHaveLength(catalogue.length);
    }
  });

  it('designsForTool merges catalogue + definition, singular + plural', () => {
    expect(designsForTool({ design: 'cohort' }, { designs: ['cohort', 'longitudinal'] }))
      .toEqual(['cohort', 'longitudinal']);
    expect(designsForTool(null, null)).toEqual([]);
  });
});

describe('115 — project CSV export (pure)', () => {
  it('derives item + domain + applicability columns from the definition alone', () => {
    const cols = columnsForInstrument(QUADAS_LIKE, { applicabilityDomainIds: ['D1'] });
    expect(cols.itemIds).toEqual(['1.1', '1.A', '4.1']);
    expect(cols.domainIds).toEqual(['D1', 'D4']);
    expect(cols.applicabilityIds).toEqual(['D1']);
  });

  it('never opens a column for a prompt that is never answered', () => {
    const q2 = resolveInstrument('QUADAS-2');
    if (!q2) return;
    const cols = columnsForInstrument(q2, { applicabilityDomainIds: applicabilityDomainIds(q2) });
    // The applicability PROMPT (answerable:false) is exported on the applicability
    // axis, so it must not also appear as a permanently-blank item column.
    expect(cols.itemIds).not.toContain('1.A');
    expect(cols.itemIds).toContain('1.1');
    expect(cols.applicabilityIds).toEqual(['D1', 'D2', 'D3']);
  });

  it('reads `items` as well as `questions`', () => {
    expect(columnsForInstrument(JBI_LIKE).itemIds).toEqual(['q1']);
  });

  it('emits one section per tool with its OWN columns and no cross-tool pooling', () => {
    const csv = buildRobProjectCsv({
      projectId: 'p1',
      generatedAt: '2026-08-11T00:00:00.000Z',
      groups: [
        {
          instrument: QUADAS_LIKE, instrumentId: 'QUADAS-2-fake', instrumentLabel: 'QUADAS-2',
          applicabilityDomainIds: ['D1'],
          rows: [{
            studyId: 's1', studyLabel: 'Smith 2020', instrumentVersion: '2011', variant: '',
            reviewerId: 'u1', reviewerName: 'Ann', status: 'draft', isConsensus: false,
            answers: { '1.1': 'yes', '1.A': 'low', '4.1': 'unclear' },
            itemNotes: { '1.1': 'consecutive\nenrolment' },
            domainJudgments: { D1: 'low', D4: 'unclear' },
            applicability: { D1: 'low' },
            domainNotes: { D1: 'clear' },
            overall: 'low', overallNote: '',
            createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
          }],
        },
        {
          instrument: JBI_LIKE, instrumentId: 'JBI-CaseSeries-fake', instrumentLabel: 'JBI Case Series',
          rows: [{
            studyId: 's2', studyLabel: 'Jones 2021', instrumentVersion: '2020', variant: '',
            reviewerId: 'u2', reviewerName: 'Bo', status: 'consensus', isConsensus: true,
            answers: { q1: 'yes' }, domainJudgments: { checklist: '' },
            overall: 'include', createdAt: '', updatedAt: '',
          }],
        },
      ],
    });
    const lines = csv.split('\n');
    const sections = lines.filter(l => l.startsWith('"# tool"'));
    expect(sections).toHaveLength(2);

    const quadasHeader = lines[lines.indexOf(sections[0]) + 1];
    expect(quadasHeader).toContain('"item:1.1"');
    expect(quadasHeader).toContain('"domain:D1"');
    expect(quadasHeader).toContain('"applicability:D1"');
    // The JBI section must NOT carry QUADAS columns — different tools, different
    // column sets (115.md decision 7: never aggregate across tools).
    const jbiHeader = lines[lines.indexOf(sections[1]) + 1];
    expect(jbiHeader).toContain('"item:q1"');
    expect(jbiHeader).not.toContain('"item:1.1"');
    expect(jbiHeader).not.toContain('"applicability:D1"');

    expect(csv).toContain('"Smith 2020"');
    expect(csv).toContain('"include"');   // JBI overall DECISION, not a bias level
    expect(csv).toContain('"yes"');       // the consensus marker column
    // A multi-line rationale never breaks the row.
    expect(csv).toContain('"1.1: consecutive enrolment"');
  });

  it('is deterministic — the same input yields byte-identical output', () => {
    const args = { projectId: 'p', generatedAt: 'T', groups: [{ instrument: JBI_LIKE, instrumentId: 'J', instrumentLabel: 'J', rows: [] }] };
    expect(buildRobProjectCsv(args)).toBe(buildRobProjectCsv(args));
  });

  it('joinNotes drops empties and flatten collapses whitespace', () => {
    expect(joinNotes({ a: 'one', b: '', c: '  two  ' }, ['a', 'b', 'c'])).toBe('a: one | c: two');
    expect(joinNotes(null)).toBe('');
    expect(flatten('a\n  b\tc')).toBe('a b c');
  });
});

// ── The two COMPUTED overall judgements the server persists ───────────────────
// AMSTAR 2's overall CONFIDENCE and PROBAST's overall APPLICABILITY are computed
// by the pure engine, but were never written to the database: `recomputeAndPersist`
// handed `proposeOverall` a map of judgement STRINGS, which drops AMSTAR's flaw
// counts (its domains make no judgement at all) and PROBAST's second axis. So the
// workspace showed a value that the RobOverall row and the CSV export did not have.
describe('115 — the computed overall judgements are persistable', () => {
  it('knows which instruments need the whole domain PROPOSAL, not just its level', () => {
    for (const id of ['AMSTAR-2', 'PROBAST']) {
      const inst = resolveInstrument(id);
      if (!inst) continue;
      expect(overallReadsProposals(inst), id).toBe(true);
    }
    for (const id of ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC', 'QUADAS-2', 'QUIPS', 'JBI-CaseSeries']) {
      const inst = resolveInstrument(id);
      if (!inst) continue;
      expect(overallReadsProposals(inst), id).toBe(false);
    }
  });

  it('validates a computed overall against the instrument’s OWN vocabulary', () => {
    const amstar = resolveInstrument('AMSTAR-2');
    if (amstar) {
      // AMSTAR 2's levels ARE the tool's own vocabulary, so they go in the same
      // RobOverall column RoB 2's overall does.
      expect(overallLevelsFor(amstar)).toEqual(['high', 'moderate', 'low', 'critically-low']);
      expect(overallJudgmentToPersist(amstar, 'critically-low')).toBe('critically-low');
      expect(overallJudgmentToPersist(amstar, 'some')).toBe('');   // RoB 2's level, not AMSTAR's
    }
    const rob2 = resolveInstrument('RoB2');
    expect(overallJudgmentToPersist(rob2, 'some')).toBe('some');
    expect(overallJudgmentToPersist(rob2, 'critically-low')).toBe('');
    expect(overallJudgmentToPersist(rob2, '')).toBe('');
    // QUADAS-2 prescribes NO overall — nothing may ever be stored for it.
    const q2 = resolveInstrument('QUADAS-2');
    if (q2) expect(overallJudgmentToPersist(q2, 'low')).toBe('');
    // A star instrument's "overall" is a star COUNT, validated numerically.
    const nos = resolveInstrument('NOS');
    expect(overallJudgmentToPersist(nos, '7', { star: true })).toBe('7');
  });

  it('stores PROBAST’s overall applicability under the established -APP convention', () => {
    expect(OVERALL_APPLICABILITY_DOMAIN_ID).toBe('overall');
    expect(overallApplicabilityKey()).toBe(`overall${APPLICABILITY_SUFFIX}`);
    // …and it round-trips through the SAME reader the per-domain rows use, which is
    // why the list endpoint surfaces it as `applicability.overall` for free.
    expect(parseDomainKey(overallApplicabilityKey())).toEqual({ domainId: 'overall', kind: 'applicability' });
    expect(isApplicabilityKey(overallApplicabilityKey())).toBe(true);

    const probast = resolveInstrument('PROBAST');
    if (probast) expect(overallApplicabilityLevels(probast)).toEqual(['low', 'high', 'unclear']);
    // No other instrument declares one, so no other row is ever written.
    for (const id of ['RoB2', 'ROBINS-I', 'NOS', 'QUADAS-2', 'AMSTAR-2', 'QUIPS']) {
      const inst = resolveInstrument(id);
      if (!inst) continue;
      expect(overallApplicabilityLevels(inst), id).toBe(null);
    }
    expect(overallApplicabilityLevels(null)).toBe(null);
  });

  it('exports BOTH overall judgements, and only for the tool that has two', () => {
    const probast = resolveInstrument('PROBAST');
    if (!probast) return;
    const cols = columnsForInstrument(probast, { applicabilityDomainIds: applicabilityDomainIds(probast) });
    expect(cols.hasOverallApplicability).toBe(true);
    expect(columnsForInstrument(resolveInstrument('RoB2')).hasOverallApplicability).toBe(false);

    const csv = buildRobProjectCsv({
      projectId: 'p1',
      generatedAt: '2026-08-11T00:00:00.000Z',
      groups: [{
        instrument: probast, instrumentId: 'PROBAST', instrumentLabel: 'PROBAST',
        applicabilityDomainIds: applicabilityDomainIds(probast),
        rows: [{
          studyId: 's1', studyLabel: 'Wolff 2019', instrumentVersion: '2019-05-15', variant: '',
          reviewerId: 'u1', reviewerName: 'Ann', status: 'complete', isConsensus: false,
          answers: {}, itemNotes: {},
          domainJudgments: { D1: 'low', D2: 'low', D3: 'low', D4: 'unclear' },
          // The `overall-APP` row arrives here keyed by its BASE id.
          applicability: { D1: 'low', D2: 'high', D3: 'low', overall: 'high' },
          domainNotes: { 'D2 (applicability)': 'narrower population', 'overall (applicability)': 'driven by D2' },
          overall: 'unclear', overallNote: '',
          createdAt: '', updatedAt: '',
        }],
      }],
    });
    const lines = csv.split('\n');
    const header = lines[lines.findIndex(l => l.startsWith('"# tool"')) + 1];
    expect(header).toContain('"applicability:D1"');
    expect(header).toContain('"applicability:overall"');
    // Ordered: the risk-of-bias overall, then the applicability one.
    expect(header.indexOf('"overall"')).toBeLessThan(header.indexOf('"applicability:overall"'));
    const row = lines[lines.findIndex(l => l.startsWith('"# tool"')) + 2];
    expect(row).toContain('"unclear"');
    expect(row).toContain('"high"');
    // A recorded applicability rationale reaches the file instead of being dropped
    // by the notes whitelist.
    expect(row).toContain('D2 (applicability): narrower population');
    expect(row).toContain('overall (applicability): driven by D2');
  });

  it('a tool with one overall grows no second column', () => {
    const rob2 = resolveInstrument('RoB2');
    const csv = buildRobProjectCsv({
      groups: [{ instrument: rob2, instrumentId: 'RoB2', instrumentLabel: 'RoB 2', rows: [] }],
    });
    expect(csv).not.toContain('"applicability:overall"');
  });
});
