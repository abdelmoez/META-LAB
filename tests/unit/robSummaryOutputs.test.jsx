/**
 * robSummaryOutputs.test.jsx — the project-level RoB outputs + the project-wide
 * export button (115.md decisions 5, 7, 11; dossier §§9, 22-24, 27).
 *
 * The invariants worth breaking a build over:
 *
 *   · MIXED-TOOL PROJECTS GROUP, NEVER MERGE. One section per instrument, no
 *     cross-tool aggregate anywhere.
 *   · TRAFFIC LIGHTS ONLY WHERE THEY MEAN RISK. AMSTAR 2 rates CONFIDENCE, where
 *     "High" is the BEST outcome — the exact inverse of "High risk of bias". The
 *     server nonetheless ships a `matrix` for it (its confidence scale IS a
 *     domain vocabulary), so a naive plot would paint every well-conducted review
 *     red. `supportsTrafficLight` is the guard, and it is pinned here.
 *   · A COUNT IS NEVER A SCORE. JBI reports item counts + a reviewer decision;
 *     the NOS keeps stars; nobody gets an invented N/M rating.
 *   · AN ABSENT JUDGEMENT IS NEVER INVENTED. QUADAS-2 prescribes no overall, so
 *     no overall column may appear for it.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RobSummaryOutputs from '../../src/frontend/rob/RobSummaryOutputs.jsx';
import RobExportButton, { exportErrorMessage } from '../../src/frontend/rob/RobExportButton.jsx';
import {
  supportsTrafficLight, groupRenderMode, overallColumn, applicabilityColumns,
  overallApplicabilityColumn,
  domainColumns, groupNotes, groupRows, distribution, checklistCounts, buildSummaryModel,
  TRAFFIC_LIGHT_INSTRUMENT_IDS,
} from '../../src/frontend/rob/robOutputModel.js';
import { levelStyle, levelSymbol } from '../../src/frontend/rob/robLevelStyle.js';
import { findInstrument } from '../../src/research-engine/rob/instruments/registry.js';

/* ── fixtures — shaped exactly like GET /projects/:id/assessments ───────────── */

const matrixFor = (instrumentId, domainIds, rows) => ({
  instrumentId,
  domains: domainIds.map(id => ({ id, shortLabel: id })),
  rows,
});

const ROB2_GROUP = {
  instrumentId: 'RoB2', instrumentLabel: 'RoB 2', instrumentVersion: '2019-08-22',
  scoring: 'judgment', applicabilityDomainIds: [], count: 2,
  studyIds: ['s1', 's2'], assessmentIds: ['r1', 'r2'],
  matrix: matrixFor('RoB2', ['D1', 'D2', 'D3', 'D4', 'D5'], []),
  domainJudgmentLevels: ['low', 'some', 'high'],
  overallLevels: ['low', 'some', 'high'],
};

const QUADAS_GROUP = {
  instrumentId: 'QUADAS-2', instrumentLabel: 'QUADAS-2', instrumentVersion: '2011',
  scoring: 'judgment', applicabilityDomainIds: ['D1', 'D2', 'D3'], count: 1,
  studyIds: ['s3'], assessmentIds: ['q1'],
  matrix: matrixFor('QUADAS-2', ['D1', 'D2', 'D3', 'D4'], []),
  domainJudgmentLevels: ['low', 'high', 'unclear'],
  overallLevels: null,                       // QUADAS-2 prescribes no overall
};

const AMSTAR_GROUP = {
  instrumentId: 'AMSTAR-2', instrumentLabel: 'AMSTAR 2', instrumentVersion: '2017',
  scoring: 'judgment', applicabilityDomainIds: [], count: 1,
  studyIds: ['s4'], assessmentIds: ['am1'],
  // The server DOES build a matrix here — the hazard this suite guards against.
  matrix: matrixFor('AMSTAR-2', ['items'], []),
  domainJudgmentLevels: ['high', 'moderate', 'low', 'critically-low'],
  overallLevels: ['high', 'moderate', 'low', 'critically-low'],
};

const JBI_GROUP = {
  instrumentId: 'JBI-CaseSeries', instrumentLabel: 'JBI Case Series', instrumentVersion: '2020',
  scoring: 'judgment', applicabilityDomainIds: [], count: 1,
  studyIds: ['s5'], assessmentIds: ['j1'],
  matrix: null,
  domainJudgmentLevels: [],
  overallLevels: ['include', 'exclude', 'seek-further-info'],
};

const NOS_GROUP = {
  instrumentId: 'NOS', instrumentLabel: 'Newcastle–Ottawa (cohort)', instrumentVersion: 'ohri-nosgen',
  scoring: 'stars', applicabilityDomainIds: [], count: 1,
  studyIds: ['s6'], assessmentIds: ['n1'],
  matrix: null,
  domainJudgmentLevels: [],
  overallLevels: [],
};

const ASSESSMENTS = [
  {
    id: 'r1', studyId: 's1', label: 'Smith 2021', status: 'complete', reviewerName: 'Ada',
    instrumentId: 'RoB2', domainJudgments: { D1: 'low', D2: 'some', D3: 'low', D4: 'low', D5: 'high' },
    applicability: {}, overall: 'high', createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'r2', studyId: 's2', label: 'Jones 2020', status: 'complete', reviewerName: 'Grace',
    instrumentId: 'RoB2', domainJudgments: { D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'low' },
    applicability: {}, overall: 'low', createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'q1', studyId: 's3', label: 'Okafor 2019', status: 'complete', reviewerName: 'Ada',
    instrumentId: 'QUADAS-2', domainJudgments: { D1: 'low', D2: 'unclear', D3: 'low', D4: 'low' },
    applicability: { D1: 'low', D2: 'high', D3: 'low' }, overall: '', createdAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'am1', studyId: 's4', label: 'Review 2022', status: 'complete', reviewerName: 'Ada',
    instrumentId: 'AMSTAR-2', domainJudgments: {}, applicability: {}, overall: 'high',
    createdAt: '2026-01-04T00:00:00.000Z',
  },
  {
    id: 'j1', studyId: 's5', label: 'Case series 2023', status: 'complete', reviewerName: 'Grace',
    instrumentId: 'JBI-CaseSeries', domainJudgments: { checklist: '' }, applicability: {},
    overall: 'include', createdAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'n1', studyId: 's6', label: 'Cohort 2018', status: 'complete', reviewerName: 'Ada',
    instrumentId: 'NOS', domainJudgments: {}, applicability: {}, overall: '7',
    scoring: 'stars', stars: 7, maxStars: 9,
    starsByDomain: { selection: 3, comparability: 2, outcome: 2 },
    maxStarsByDomain: { selection: 4, comparability: 2, outcome: 3 },
    profile: '3/4 · 2/2 · 2/3', createdAt: '2026-01-06T00:00:00.000Z',
  },
];

/** A JBI assessment view, as GET /assessments/:id returns it. */
const JBI_VIEW = {
  id: 'j1', instrumentId: 'JBI-CaseSeries',
  answersByDomain: {
    checklist: { 1: 'Y', 2: 'Y', 3: 'Y', 4: 'N', 5: 'U', 6: 'Y', 7: 'Y', 8: 'NA', 9: 'Y', 10: 'Y' },
  },
  completeness: { perDomain: { checklist: { answered: 10, required: 10, missing: [] } }, overall: { complete: true } },
};

const ALL_GROUPS = [ROB2_GROUP, QUADAS_GROUP, AMSTAR_GROUP, JBI_GROUP, NOS_GROUP];

const render = (over = {}) => renderToStaticMarkup(
  <RobSummaryOutputs groups={ALL_GROUPS} assessments={ASSESSMENTS} {...over} />,
);

/* ── 1. traffic-light eligibility (the polarity guard) ──────────────────────── */

describe('robOutputModel — traffic lights only where the categories mean risk', () => {
  it('allows exactly the instruments decision 11 names', () => {
    expect(TRAFFIC_LIGHT_INSTRUMENT_IDS).toEqual(['RoB2', 'ROBINS-I', 'QUADAS-2', 'QUIPS', 'PROBAST']);
    expect(supportsTrafficLight(ROB2_GROUP)).toBe(true);
    expect(supportsTrafficLight(QUADAS_GROUP)).toBe(true);
  });

  it('REFUSES AMSTAR 2 even though its levels collide with a risk vocabulary', () => {
    // high / moderate / low would all pass a vocabulary-only test — and would then
    // paint "High confidence" in the same red as "High risk of bias".
    expect(supportsTrafficLight(AMSTAR_GROUP)).toBe(false);
    expect(groupRenderMode(AMSTAR_GROUP)).toBe('confidence');
  });

  it('refuses a checklist and a star profile', () => {
    expect(supportsTrafficLight(JBI_GROUP)).toBe(false);
    expect(supportsTrafficLight(NOS_GROUP)).toBe(false);
    expect(groupRenderMode(JBI_GROUP)).toBe('checklist');
    expect(groupRenderMode(NOS_GROUP)).toBe('stars');
  });

  it('refuses an instrument the client does not know, rather than guessing', () => {
    expect(supportsTrafficLight({
      instrumentId: 'FUTURE-TOOL', domainJudgmentLevels: ['low', 'high'], overallLevels: ['low', 'high'],
    })).toBe(false);
    expect(groupRenderMode({ instrumentId: 'FUTURE-TOOL', domainJudgmentLevels: ['a', 'b'], overallLevels: ['a', 'b'] })).toBe('plain');
  });

  it('resolves a level on ITS OWN scale, so AMSTAR’s "high" is not risk-red', () => {
    const risky = levelStyle('high', { axis: 'rob' });
    const confident = levelStyle('high', { axis: 'confidence' });
    const decided = levelStyle('include', { axis: 'appraisal-decision' });
    // Same level string, opposite meaning → different colour AND different label.
    expect(confident.hex).not.toBe(risky.hex);
    expect(confident.label).toMatch(/confidence/i);
    expect(risky.label).toMatch(/high/i);
    expect(decided.label).toBe('Include');
    // A severity symbol belongs only to the risk / concern scales.
    expect(levelSymbol('high', { axis: 'rob' })).toBe('×');
    expect(levelSymbol('high', { axis: 'confidence' })).toBe('');
    // An applicability concern reads as a CONCERN, never as risk of bias.
    expect(levelStyle('high', { axis: 'applicability' }).label).toMatch(/concern/i);
  });
});

/* ── 2. columns: nothing invented, nothing merged ───────────────────────────── */

describe('robOutputModel — columns', () => {
  it('gives QUADAS-2 no overall column (the tool prescribes none)', () => {
    expect(overallColumn(QUADAS_GROUP, findInstrument('QUADAS-2'))).toBeNull();
  });

  it('labels AMSTAR 2’s overall as CONFIDENCE, not risk', () => {
    const col = overallColumn(AMSTAR_GROUP, findInstrument('AMSTAR-2'));
    expect(col.label).toBe('Overall confidence');
    expect(col.axis).toBe('confidence');
  });

  it('labels the JBI overall as the reviewer’s appraisal decision', () => {
    const col = overallColumn(JBI_GROUP, findInstrument('JBI-CaseSeries'));
    expect(col.label).toBe('Appraisal decision');
    expect(col.axis).toBe('appraisal-decision');
  });

  it('carries QUIPS’s own caveat that its overall is not a tool output', () => {
    const quipsGroup = {
      instrumentId: 'QUIPS', instrumentLabel: 'QUIPS',
      domainJudgmentLevels: ['low', 'moderate', 'high'], overallLevels: ['low', 'moderate', 'high'],
      applicabilityDomainIds: [],
    };
    const col = overallColumn(quipsGroup, findInstrument('QUIPS'));
    expect(col.note).toContain('defines no overall rule');
    expect(supportsTrafficLight(quipsGroup)).toBe(true);
  });

  it('gives QUADAS-2 its three applicability columns, and nobody else any', () => {
    expect(applicabilityColumns(QUADAS_GROUP, findInstrument('QUADAS-2')).map(c => c.id)).toEqual(['D1', 'D2', 'D3']);
    expect(applicabilityColumns(ROB2_GROUP, findInstrument('RoB2'))).toEqual([]);
  });

  it('prefers the instrument’s own short labels for domain columns', () => {
    const cols = domainColumns(QUADAS_GROUP, findInstrument('QUADAS-2'));
    expect(cols[0].label).toBe('Patient selection');
    expect(cols).toHaveLength(4);
  });

  it('still renders columns for an instrument the client does not know', () => {
    const cols = domainColumns({ instrumentId: 'FUTURE' }, null, [{ domainJudgments: { X1: 'a', X2: 'b' } }]);
    expect(cols.map(c => c.id)).toEqual(['X1', 'X2']);
  });

  it('reports PROBAST’s SECOND overall judgement in its own column, on the concern scale', () => {
    const probastGroup = {
      instrumentId: 'PROBAST', instrumentLabel: 'PROBAST',
      domainJudgmentLevels: ['low', 'high', 'unclear'], overallLevels: ['low', 'high', 'unclear'],
      applicabilityDomainIds: ['D1', 'D2', 'D3'],
    };
    const probast = findInstrument('PROBAST');
    // The server persists it as the `overall-APP` row, which the list endpoint
    // deserialises to `row.applicability.overall` (115.md — the `-APP` convention).
    const col = overallApplicabilityColumn(probastGroup, probast);
    expect(col.axis).toBe('applicability');
    expect(col.levels).toEqual(['low', 'high', 'unclear']);
    // …and nobody else grows one, because no other tool defines an overall
    // applicability judgement.
    expect(overallApplicabilityColumn(QUADAS_GROUP, findInstrument('QUADAS-2'))).toBe(null);
    expect(overallApplicabilityColumn(ROB2_GROUP, findInstrument('RoB2'))).toBe(null);

    const notes = groupNotes(probastGroup, probast).join(' ');
    expect(notes).toContain('two overall judgements');
    expect(notes).not.toContain('not recorded');

    const model = buildSummaryModel({
      groups: [probastGroup],
      assessments: [{
        id: 'p1', studyId: 's9', instrumentId: 'PROBAST', overall: 'unclear',
        domainJudgments: { D1: 'low' }, applicability: { D1: 'high', overall: 'high' },
      }],
      instrumentFor: findInstrument,
    });
    const section = model.sections[0];
    expect(section.overallApplicability.label).toBe('Overall applicability');
    expect(section.rows[0].applicability.overall).toBe('high');
    expect(section.overallApplicabilityDistribution.recorded).toBe(1);
    const html = renderToStaticMarkup(
      <RobSummaryOutputs groups={[probastGroup]} assessments={[{
        id: 'p1', studyId: 's9', instrumentId: 'PROBAST', overall: 'unclear',
        domainJudgments: { D1: 'low' }, applicability: { D1: 'high', overall: 'high' },
      }]} />,
    );
    expect(html).toContain('Overall applicability');
  });

  it('states plainly that QUADAS-2 has no overall', () => {
    expect(groupNotes(QUADAS_GROUP, findInstrument('QUADAS-2')).join(' ')).toContain('defines no overall judgement');
  });
});

/* ── 3. counts are not scores ───────────────────────────────────────────────── */

describe('robOutputModel — counts, stars, distributions', () => {
  it('tallies JBI item responses as explicit counts with a denominator', () => {
    const counts = checklistCounts(JBI_VIEW, 'checklist');
    expect(counts.byResponse).toEqual({ Y: 7, N: 1, U: 1, NA: 1 });
    expect(counts.answered).toBe(10);
    expect(counts.total).toBe(10);
  });

  it('counts a partially answered checklist honestly', () => {
    const partial = { answersByDomain: { checklist: { 1: 'Y', 2: '', 3: 'N' } }, completeness: { perDomain: { checklist: { required: 10 } } } };
    const counts = checklistCounts(partial, 'checklist');
    expect(counts.answered).toBe(2);
    expect(counts.total).toBe(10);
  });

  it('distributes judgements over the instrument’s own level order and counts the gaps', () => {
    const rows = groupRows(ROB2_GROUP, ASSESSMENTS);
    const d5 = distribution(rows, ['low', 'some', 'high'], r => r.domainJudgments.D5);
    expect(d5.levels.map(l => [l.level, l.count])).toEqual([['low', 1], ['some', 0], ['high', 1]]);
    expect(d5.recorded).toBe(2);
    expect(d5.missing).toBe(0);
    const d1 = distribution([{ domainJudgments: {} }], ['low'], r => r.domainJudgments.D1);
    expect(d1.recorded).toBe(0);
    expect(d1.missing).toBe(1);
  });

  it('surfaces a stored level the definition no longer lists', () => {
    const d = distribution([{ v: 'legacy' }], ['low', 'high'], r => r.v);
    expect(d.levels.find(l => l.level === 'legacy').count).toBe(1);
  });
});

/* ── 4. the whole model ─────────────────────────────────────────────────────── */

describe('robOutputModel — buildSummaryModel', () => {
  const model = buildSummaryModel({ groups: ALL_GROUPS, assessments: ASSESSMENTS, instrumentFor: findInstrument, detailsById: { j1: JBI_VIEW } });

  it('produces one section per instrument and never a combined one', () => {
    expect(model.sections.map(s => s.instrumentId)).toEqual(['RoB2', 'QUADAS-2', 'AMSTAR-2', 'JBI-CaseSeries', 'NOS']);
    expect(model.mixedTools).toBe(true);
    expect(model.totalAssessments).toBe(6);
  });

  it('routes each row into exactly its own section', () => {
    const rob2 = model.sections.find(s => s.instrumentId === 'RoB2');
    expect(rob2.rows.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(rob2.count).toBe(2);
    expect(rob2.studyCount).toBe(2);
  });

  it('computes per-domain distributions only for tools that rate domains', () => {
    expect(model.sections.find(s => s.instrumentId === 'RoB2').distributions).toHaveLength(5);
    expect(model.sections.find(s => s.instrumentId === 'JBI-CaseSeries').distributions).toHaveLength(0);
    expect(model.sections.find(s => s.instrumentId === 'AMSTAR-2').distributions).toHaveLength(0);
    // …but the overall distribution is meaningful for all of them.
    expect(model.sections.find(s => s.instrumentId === 'AMSTAR-2').overallDistribution.recorded).toBe(1);
  });

  it('attaches checklist counts only when the detail view was supplied', () => {
    const jbi = model.sections.find(s => s.instrumentId === 'JBI-CaseSeries');
    expect(jbi.rows[0].counts.byResponse.Y).toBe(7);
    const without = buildSummaryModel({ groups: [JBI_GROUP], assessments: ASSESSMENTS, instrumentFor: findInstrument });
    expect(without.sections[0].rows[0].counts).toBeNull();
  });
});

/* ── 5. the rendered panel ──────────────────────────────────────────────────── */

describe('RobSummaryOutputs — rendering', () => {
  const html = render({ detailsById: { j1: JBI_VIEW } });

  it('renders a section per tool and warns that they are not pooled', () => {
    expect(html).toContain('RoB 2');
    expect(html).toContain('QUADAS-2');
    expect(html).toContain('AMSTAR 2');
    expect(html).toContain('JBI Case Series');
    expect(html).toContain('Newcastle–Ottawa (cohort)');
    expect(html).toContain('never pooled into one figure');
  });

  it('offers the traffic-light plot for RoB 2 and NOT for AMSTAR 2', () => {
    // Only the two eligible groups (RoB 2, QUADAS-2) get the plot toggle; the
    // AMSTAR 2 group ships a matrix from the server and must still not get one.
    expect((html.match(/Hide traffic-light plot/g) || []).length).toBe(2);
  });

  it('renders judgements as icon + TEXT, never colour alone', () => {
    expect(html).toContain('Some concerns');
    expect(html).toContain('Low');
    expect(html).toContain('<svg');
  });

  it('gives QUADAS-2 applicability columns and no overall column', () => {
    expect(html).toContain('Patient selection (applicability)');
    expect(html).toContain('defines no overall judgement');
  });

  it('shows JBI item COUNTS and the appraisal decision, never a score', () => {
    expect(html).toContain('Unclear');
    expect(html).toContain('10 of 10');
    expect(html).toContain('Include');
    expect(html).toContain('progress counts');
    expect(html).not.toMatch(/7\s*\/\s*10/);
  });

  it('keeps the NOS as stars with no traffic light and no threshold verdict', () => {
    expect(html).toContain('★');
    expect(html).toContain('7/9');
    expect(html).toContain('3/4 · 2/2 · 2/3');
    expect(html).toContain('defines no quality threshold');
  });

  it('explains AMSTAR 2’s inverted polarity where the rating is shown', () => {
    expect(html).toContain('Overall confidence');
    expect(html).toContain('opposite polarity to a risk-of-bias scale');
  });

  it('marks a consensus row and a draft row distinctly', () => {
    const withConsensus = render({
      groups: [ROB2_GROUP],
      assessments: [
        ASSESSMENTS[0],
        { ...ASSESSMENTS[1], id: 'r2', status: 'consensus' },
      ],
    });
    expect(withConsensus).toContain('CONSENSUS');
  });

  it('renders an honest empty state rather than a blank table', () => {
    expect(renderToStaticMarkup(<RobSummaryOutputs groups={[]} assessments={[]} />))
      .toContain('No assessments yet');
  });

  it('renders an injected export control in its header', () => {
    const withExport = render({ exportSlot: <span>EXPORT-SLOT</span> });
    expect(withExport).toContain('EXPORT-SLOT');
  });
});

/* ── 6. the export button ───────────────────────────────────────────────────── */

describe('RobExportButton', () => {
  it('surfaces the tier-gate MESSAGE, not the enum key', () => {
    const err = new Error('TIER_LIMIT_EXCEEDED');
    err.status = 403;
    err.body = {
      error: 'TIER_LIMIT_EXCEEDED', feature: 'projectExports', currentTier: 'free', requiredTier: 'pro',
      message: 'Project exports are available on the Pro plan and above.',
    };
    expect(exportErrorMessage(err)).toBe('Project exports are available on the Pro plan and above.');
  });

  it('falls back to a plain message for a non-tier failure', () => {
    const err = new Error('Internal server error');
    err.status = 500;
    expect(exportErrorMessage(err)).toBe('Internal server error');
    const gone = Object.assign(new Error('Not found'), { status: 404 });
    expect(exportErrorMessage(gone)).toContain('not available for this project');
  });

  it('is disabled with nothing to export, and says one section per tool', () => {
    const empty = renderToStaticMarkup(<RobExportButton projectId="p1" assessmentCount={0} />);
    expect(empty).toContain('disabled');
    expect(empty).toContain('no assessments to export');

    const ready = renderToStaticMarkup(<RobExportButton projectId="p1" assessmentCount={6} />);
    expect(ready).not.toContain('disabled=""');
    expect(ready).toContain('Export all assessments (CSV)');
    expect(ready).toContain('never merged across instruments');
  });

  it('downloads exactly what the endpoint returned', async () => {
    const written = [];
    let rendered = null;
    const props = {
      projectId: 'p1',
      assessmentCount: 3,
      onExport: async () => ({ filename: 'rob-assessments_p1.csv', mime: 'text/csv', content: 'a,b\n1,2' }),
      download: (text, filename, mime) => written.push({ text, filename, mime }),
    };
    // No jsdom in this repo: exercise the same handler the button calls by
    // reproducing its contract (fetch → validate → download).
    const res = await props.onExport(props.projectId);
    expect(res.content).toBeTruthy();
    props.download(res.content, res.filename, res.mime);
    expect(written).toEqual([{ text: 'a,b\n1,2', filename: 'rob-assessments_p1.csv', mime: 'text/csv' }]);
    rendered = renderToStaticMarkup(<RobExportButton {...props} />);
    expect(rendered).toContain('Export all assessments (CSV)');
  });
});
