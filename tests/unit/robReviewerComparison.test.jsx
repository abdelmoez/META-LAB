/**
 * robReviewerComparison.test.jsx — the dual-reviewer / consensus surface
 * (115.md decision 10; dossier §6).
 *
 * Two layers, both pinned here:
 *   1. robConsensusModel — the PURE blinding rule, conflict detection and the
 *      consensus preconditions. These are the methodological invariants: if the
 *      blind lifts early, reviewers stop being independent; if "one reviewer has
 *      not answered yet" counts as a disagreement, every review reports inflated
 *      conflict; if consensus could be created from one assessment, the record
 *      would claim a reconciliation that never happened.
 *   2. ReviewerComparisonPanel — rendered to static markup (this repo has no
 *      jsdom; see tests/unit/rob-workspace-ui.test.jsx), asserting that a locked
 *      comparison leaks NOTHING about the other reviewer even when a payload is
 *      handed to it, and that an unlocked one marks conflicts explicitly.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewerComparisonPanel from '../../src/frontend/rob/ReviewerComparisonPanel.jsx';
import {
  partitionReviewerRows, reviewerBlindState, reviewerLabel, rowsForStudy,
  domainDiff, overallDiff, itemDiffRows, agreementText, consensusEligibility,
  isConsensusRow, isCompleteRow,
} from '../../src/frontend/rob/robConsensusModel.js';

/* ── fixtures ───────────────────────────────────────────────────────────────── */

const row = (over = {}) => ({
  id: 'a1', studyId: 's1', instrumentId: 'RoB2', status: 'draft',
  reviewerId: 'u1', reviewerName: 'Ada Lovelace',
  domainJudgments: {}, applicability: {}, overall: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** Two reviewers who disagree on D2 and on the overall judgement. */
const CONFLICT_ROWS = [
  row({
    id: 'a1', reviewerId: 'u1', reviewerName: 'Ada Lovelace', status: 'complete',
    domainJudgments: { D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'low' },
    overall: 'low', createdAt: '2026-01-01T09:00:00.000Z',
  }),
  row({
    id: 'a2', reviewerId: 'u2', reviewerName: 'Grace Hopper', status: 'complete',
    domainJudgments: { D1: 'low', D2: 'high', D3: 'low', D4: 'low', D5: 'low' },
    overall: 'high', createdAt: '2026-01-01T10:00:00.000Z',
  }),
];

const CONSENSUS_ROW = row({
  id: 'a3', reviewerId: 'u1', reviewerName: 'Ada Lovelace', status: 'consensus',
  domainJudgments: { D1: 'low', D2: 'some', D3: 'low', D4: 'low', D5: 'low' },
  overall: 'some', createdAt: '2026-01-02T09:00:00.000Z',
});

const COMPARISON = {
  studyId: 's1', instrumentId: 'RoB2', instrumentLabel: 'RoB 2', scoring: 'judgment',
  reviewers: [
    { assessmentId: 'a1', reviewerId: 'u1', reviewerName: 'Ada Lovelace', status: 'complete', completeness: { complete: true } },
    { assessmentId: 'a2', reviewerId: 'u2', reviewerName: 'Grace Hopper', status: 'complete', completeness: { complete: true } },
  ],
  disagreements: [{
    domainId: 'D2', domainName: 'Deviations from intended interventions',
    questionId: '2.1', questionText: 'Were participants aware of their assigned intervention?',
    select: 'one', values: { u1: 'N', u2: 'Y' },
  }],
  consensus: null,
  agreement: { comparedQuestions: 10, agreedQuestions: 9, disagreedQuestions: 1, percentAgreement: 0.9 },
  instrumentIds: ['RoB2'],
};

const render = (over = {}) => renderToStaticMarkup(
  <ReviewerComparisonPanel
    projectId="p1"
    studyId="s1"
    studyLabel="Smith 2021"
    instrumentId="RoB2"
    instrumentLabel="RoB 2"
    rows={CONFLICT_ROWS}
    canEdit
    comparison={COMPARISON}
    {...over}
  />,
);

/* ── 1. the blind ───────────────────────────────────────────────────────────── */

describe('robConsensusModel — the blinding rule', () => {
  it('stays locked with a single assessment, however finished it is', () => {
    const state = reviewerBlindState([row({ status: 'complete' })]);
    expect(state.unlocked).toBe(false);
    expect(state.reason).toBe('awaiting-second-reviewer');
  });

  it('stays locked while ANY independent assessment is still a draft', () => {
    const state = reviewerBlindState([
      row({ id: 'a1', reviewerId: 'u1', status: 'complete' }),
      row({ id: 'a2', reviewerId: 'u2', status: 'draft' }),
    ]);
    expect(state.unlocked).toBe(false);
    expect(state.reason).toBe('awaiting-completion');
    expect(state.pending.map(p => p.id)).toEqual(['a2']);
  });

  it('stays locked when 2 of 3 are complete — the third must not peek', () => {
    const state = reviewerBlindState([
      row({ id: 'a1', reviewerId: 'u1', status: 'complete' }),
      row({ id: 'a2', reviewerId: 'u2', status: 'complete' }),
      row({ id: 'a3', reviewerId: 'u3', status: 'draft' }),
    ]);
    expect(state.unlocked).toBe(false);
    expect(state.completeCount).toBe(2);
    expect(state.independentCount).toBe(3);
  });

  it('unlocks only when every independent assessment is complete', () => {
    const state = reviewerBlindState(CONFLICT_ROWS);
    expect(state.unlocked).toBe(true);
    expect(state.reason).toBe('unlocked');
  });

  it('does not count the consensus row as an independent assessment', () => {
    const state = reviewerBlindState([row({ id: 'a1', status: 'complete' }), CONSENSUS_ROW]);
    expect(state.independentCount).toBe(1);
    expect(state.unlocked).toBe(false);
    expect(state.consensusExists).toBe(true);
  });

  it('reports no assessments as its own reason (not "waiting for a reviewer")', () => {
    expect(reviewerBlindState([]).reason).toBe('no-assessments');
  });
});

/* ── 2. partitioning + row selection ────────────────────────────────────────── */

describe('robConsensusModel — partitioning', () => {
  it('separates the consensus row and orders the independents by creation', () => {
    const p = partitionReviewerRows([CONSENSUS_ROW, CONFLICT_ROWS[1], CONFLICT_ROWS[0]]);
    expect(p.independent.map(r => r.id)).toEqual(['a1', 'a2']);
    expect(p.consensus.id).toBe('a3');
    expect(p.extraConsensus).toHaveLength(0);
  });

  it('surfaces a second consensus row instead of hiding it', () => {
    const p = partitionReviewerRows([CONSENSUS_ROW, { ...CONSENSUS_ROW, id: 'a4', createdAt: '2026-01-03T00:00:00.000Z' }]);
    expect(p.consensus.id).toBe('a3');
    expect(p.extraConsensus.map(r => r.id)).toEqual(['a4']);
  });

  it('scopes rows to one study AND one instrument', () => {
    const all = [
      row({ id: 'a1', studyId: 's1', instrumentId: 'RoB2' }),
      row({ id: 'a2', studyId: 's1', instrumentId: 'QUADAS-2' }),
      row({ id: 'a3', studyId: 's2', instrumentId: 'RoB2' }),
    ];
    expect(rowsForStudy(all, 's1', 'RoB2').map(r => r.id)).toEqual(['a1']);
    expect(rowsForStudy(all, 's1').map(r => r.id)).toEqual(['a1', 'a2']);
  });

  it('never renders a blank reviewer column header', () => {
    expect(reviewerLabel(row({ reviewerName: '' , reviewerId: 'abcdef123456' }))).toBe('Reviewer abcdef12');
    expect(reviewerLabel(row({ reviewerName: '', reviewerId: '' }))).toBe('Unattributed reviewer');
  });

  it('classifies statuses', () => {
    expect(isConsensusRow(CONSENSUS_ROW)).toBe(true);
    expect(isConsensusRow(CONFLICT_ROWS[0])).toBe(false);
    expect(isCompleteRow(CONFLICT_ROWS[0])).toBe(true);
    expect(isCompleteRow(row({ status: 'draft' }))).toBe(false);
  });
});

/* ── 3. conflicts — "missing is not disagreement" ───────────────────────────── */

describe('robConsensusModel — conflict detection', () => {
  const ids = ['D1', 'D2', 'D3', 'D4', 'D5'];

  it('flags only the domain the reviewers actually judged differently', () => {
    const diffs = domainDiff(CONFLICT_ROWS, ids);
    expect(diffs.filter(d => d.conflict).map(d => d.domainId)).toEqual(['D2']);
    expect(diffs.find(d => d.domainId === 'D1').agreed).toBe(true);
  });

  it('does NOT call an unjudged domain a disagreement', () => {
    const rows = [
      row({ id: 'a1', reviewerId: 'u1', status: 'complete', domainJudgments: { D1: 'low' } }),
      row({ id: 'a2', reviewerId: 'u2', status: 'complete', domainJudgments: {} }),
    ];
    const d1 = domainDiff(rows, ['D1'])[0];
    expect(d1.conflict).toBe(false);
    expect(d1.agreed).toBe(false);
    expect(d1.recordedCount).toBe(1);
  });

  it('compares the applicability axis separately from risk of bias', () => {
    const rows = [
      row({ id: 'a1', reviewerId: 'u1', status: 'complete', domainJudgments: { D1: 'low' }, applicability: { D1: 'high' } }),
      row({ id: 'a2', reviewerId: 'u2', status: 'complete', domainJudgments: { D1: 'low' }, applicability: { D1: 'low' } }),
    ];
    expect(domainDiff(rows, ['D1'])[0].conflict).toBe(false);
    expect(domainDiff(rows, ['D1'], { field: 'applicability' })[0].conflict).toBe(true);
  });

  it('flags the overall difference', () => {
    const o = overallDiff(CONFLICT_ROWS);
    expect(o.conflict).toBe(true);
    expect(o.values.a1).toBe('low');
    expect(o.values.a2).toBe('high');
  });

  it('maps the server item disagreements onto the reviewer columns', () => {
    const items = itemDiffRows(COMPARISON.disagreements, CONFLICT_ROWS);
    expect(items).toHaveLength(1);
    expect(items[0].values.a1).toBe('N');
    expect(items[0].values.a2).toBe('Y');
  });

  it('joins a multi-select answer rather than printing [object Object]', () => {
    const items = itemDiffRows(
      [{ domainId: 'comparability', questionId: 'C1', values: { u1: ['a', 'b'], u2: ['a'] } }],
      [row({ id: 'a1', reviewerId: 'u1' }), row({ id: 'a2', reviewerId: 'u2' })],
    );
    expect(items[0].values.a1).toBe('a + b');
    expect(items[0].values.a2).toBe('a');
  });

  it('renders agreement only when something was compared', () => {
    expect(agreementText(COMPARISON.agreement)).toBe('90% item agreement (9/10)');
    expect(agreementText({ comparedQuestions: 0, percentAgreement: null })).toBe('');
  });
});

/* ── 4. consensus preconditions (mirroring the server) ──────────────────────── */

describe('robConsensusModel — consensus eligibility', () => {
  it('allows creation once two complete, distinct reviewers exist', () => {
    const e = consensusEligibility({ rows: CONFLICT_ROWS, canEdit: true });
    expect(e.canCreate).toBe(true);
    expect(e.reviewerIds).toEqual(['u1', 'u2']);
  });

  it('refuses with one reviewer (the server 409s on the same condition)', () => {
    const e = consensusEligibility({ rows: [CONFLICT_ROWS[0]], canEdit: true });
    expect(e.canCreate).toBe(false);
    expect(e.reason).toBe('needs-two-reviewers');
  });

  it('refuses when the SAME reviewer holds both rows', () => {
    const e = consensusEligibility({
      rows: [CONFLICT_ROWS[0], { ...CONFLICT_ROWS[1], reviewerId: 'u1' }],
      canEdit: true,
    });
    expect(e.canCreate).toBe(false);
    expect(e.reason).toBe('needs-two-reviewers');
  });

  it('refuses for a read-only member', () => {
    expect(consensusEligibility({ rows: CONFLICT_ROWS, canEdit: false }).reason).toBe('read-only');
  });

  it('refuses when a consensus already exists', () => {
    const e = consensusEligibility({ rows: [...CONFLICT_ROWS, CONSENSUS_ROW], canEdit: true });
    expect(e.reason).toBe('exists');
  });

  it('refuses while the comparison is still blinded', () => {
    const rows = [CONFLICT_ROWS[0], { ...CONFLICT_ROWS[1], status: 'draft' }];
    expect(consensusEligibility({ rows, canEdit: true }).reason).toBe('blinded');
  });

  it('refuses for an instrument that declares no consensus support', () => {
    const e = consensusEligibility({ rows: CONFLICT_ROWS, canEdit: true, consensusSupported: false });
    expect(e.reason).toBe('unsupported');
  });
});

/* ── 5. the panel ───────────────────────────────────────────────────────────── */

describe('ReviewerComparisonPanel — locked state', () => {
  const lockedRows = [CONFLICT_ROWS[0], { ...CONFLICT_ROWS[1], status: 'draft' }];
  const html = render({ rows: lockedRows });

  it('says the comparison is hidden and why', () => {
    expect(html).toContain('Comparison hidden');
    expect(html).toContain('1 of 2 finished');
  });

  it('leaks NO judgement from either assessment, even with a payload in hand', () => {
    // The payload passed in carries the D2 disagreement; nothing about it may render.
    expect(html).not.toContain('Deviations from intended interventions');
    expect(html).not.toContain('Were participants aware');
    expect(html).not.toContain('conflict');
    expect(html).not.toContain('Domain judgements');
  });

  it('still names the reviewers and their progress (that is not a judgement)', () => {
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('In progress');
  });

  it('is honest that the blind is enforced here, not by the API', () => {
    expect(html).toContain('workflow rule enforced here');
  });

  it('offers no consensus button while blinded', () => {
    expect(html).not.toContain('Create consensus record');
  });
});

describe('ReviewerComparisonPanel — unlocked comparison', () => {
  const html = render();

  it('renders the domain, applicability-free, overall and item sections', () => {
    expect(html).toContain('Domain judgements');
    expect(html).toContain('Overall');
    expect(html).toContain('Item-level differences');
    // RoB 2 has no applicability axis — that table must not appear.
    expect(html).not.toContain('Applicability concerns');
  });

  it('marks the conflicting domain and the conflicting overall', () => {
    expect(html).toContain('conflict');
    // D2 (the disagreement) and the overall are both flagged: 2 domain/overall
    // conflicts + 1 item row.
    expect((html.match(/conflict/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('differences between the reviewers');
  });

  it('shows the item-level disagreement with both answers', () => {
    expect(html).toContain('Were participants aware of their assigned intervention?');
    expect(html).toContain('2.1');
  });

  it('reports the agreement summary from the server payload', () => {
    expect(html).toContain('90% item agreement (9/10)');
  });

  it('offers consensus creation with a seed choice that names both reviewers', () => {
    expect(html).toContain('Create consensus record');
    expect(html).toContain('a blank form');
    expect(html).toContain('Ada Lovelace’s answers');
    expect(html).toContain('Neither original is modified');
  });
});

describe('ReviewerComparisonPanel — agreement + consensus states', () => {
  it('says so plainly when the reviewers agree everywhere', () => {
    const agreed = [
      CONFLICT_ROWS[0],
      { ...CONFLICT_ROWS[1], domainJudgments: { ...CONFLICT_ROWS[0].domainJudgments }, overall: 'low' },
    ];
    const html = render({ rows: agreed, comparison: { ...COMPARISON, disagreements: [], agreement: { comparedQuestions: 10, agreedQuestions: 10, disagreedQuestions: 0, percentAgreement: 1 } } });
    expect(html).toContain('agree on every recorded judgement');
    expect(html).not.toContain('conflict</span>');
  });

  it('keeps BOTH originals visible next to the consensus column', () => {
    const html = render({ rows: [...CONFLICT_ROWS, CONSENSUS_ROW] });
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('CONSENSUS');
    expect(html).toContain('Both reviewer assessments above are unchanged.');
    expect(html).not.toContain('Create consensus record');
  });

  it('explains the read-only case instead of showing a dead button', () => {
    const html = render({ canEdit: false });
    expect(html).toContain('read-only access');
    expect(html).not.toContain('Create consensus record');
  });
});

describe('ReviewerComparisonPanel — a tool with an applicability axis', () => {
  const quadasRows = [
    row({
      id: 'q1', reviewerId: 'u1', reviewerName: 'Ada Lovelace', status: 'complete', instrumentId: 'QUADAS-2',
      domainJudgments: { D1: 'low', D2: 'low', D3: 'low', D4: 'unclear' },
      applicability: { D1: 'low', D2: 'high', D3: 'low' },
    }),
    row({
      id: 'q2', reviewerId: 'u2', reviewerName: 'Grace Hopper', status: 'complete', instrumentId: 'QUADAS-2',
      domainJudgments: { D1: 'low', D2: 'low', D3: 'low', D4: 'unclear' },
      applicability: { D1: 'low', D2: 'low', D3: 'low' },
    }),
  ];
  const html = render({
    rows: quadasRows, instrumentId: 'QUADAS-2', instrumentLabel: 'QUADAS-2',
    comparison: { ...COMPARISON, instrumentId: 'QUADAS-2', disagreements: [] },
  });

  it('compares the two axes in separate tables', () => {
    expect(html).toContain('Domain judgements');
    expect(html).toContain('Applicability concerns');
  });

  it('flags the applicability disagreement without flagging the risk axis', () => {
    expect(html).toContain('conflict');
    expect(html).toContain('1 difference between the reviewers');
  });
});
