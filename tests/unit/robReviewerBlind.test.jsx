/**
 * robReviewerBlind.test.jsx — the reviewer blind as a PAGE-LEVEL rule, and the
 * scale-aware overall chip in the article list (r2 adversarial review, findings
 * 1 and 4).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * ReviewerComparisonPanel enforces the blind properly: while two people are
 * assessing the same (study, instrument) and one has not finished, it refuses to
 * even REQUEST the comparison. That is a real guarantee — and it was the only
 * one. Every other surface on the same page was built straight from
 * `GET /projects/:id/assessments`, which returns every row regardless of status:
 *
 *   · RobSummaryOutputs' per-instrument tables printed the colleague's
 *     in-progress domain judgements and overall;
 *   · the distributions counted them;
 *   · the traffic-light plot drew them as coloured cells;
 *   · the article list's AssessmentRow put the colleague's overall judgement in
 *     a coloured chip two inches above the panel that said "Comparison hidden".
 *
 * So the blind was decorative. `blindVisibility` is the single pure rule that
 * closes it, and these tests are what stop it re-opening.
 *
 * The second half pins the OTHER inversion in the same row: the overall chip
 * resolved every tool on the risk-of-bias scale, so an AMSTAR 2 review rated
 * "High confidence" — its BEST possible result — was rendered in high-risk red,
 * and a JBI "Include" decision read as "Not assessed".
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  blindVisibility, isBlindedPair, blindNote, filterMatrixRows, groupRows, buildSummaryModel,
} from '../../src/frontend/rob/robOutputModel.js';
import { AssessmentRow, overallPresentation } from '../../src/frontend/rob/ProjectRobPanel.jsx';
import RobSummaryOutputs from '../../src/frontend/rob/RobSummaryOutputs.jsx';

/* ── fixtures ───────────────────────────────────────────────────────────────── */

const ME = 'user-ada';
const THEM = 'user-grace';

const row = (over = {}) => ({
  id: 'a1', studyId: 's1', instrumentId: 'RoB2', status: 'draft',
  reviewerId: ME, reviewerName: 'Ada Lovelace', label: 'Smith 2021',
  domainJudgments: {}, applicability: {}, overall: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** Ada has finished; Grace is mid-assessment. The blind is live. */
const MINE_DONE = row({
  id: 'mine', reviewerId: ME, reviewerName: 'Ada Lovelace', status: 'complete',
  domainJudgments: { D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'low' }, overall: 'low',
});
const THEIRS_DRAFT = row({
  id: 'theirs', reviewerId: THEM, reviewerName: 'Grace Hopper', status: 'draft',
  domainJudgments: { D1: 'high', D2: 'high' }, overall: 'high',
  createdAt: '2026-01-01T10:00:00.000Z',
});
const THEIRS_DONE = { ...THEIRS_DRAFT, status: 'complete' };
const CONSENSUS = row({
  id: 'cons', reviewerId: ME, status: 'consensus', reviewerName: 'Ada Lovelace',
  domainJudgments: { D1: 'some' }, overall: 'some', createdAt: '2026-01-02T00:00:00.000Z',
});

const ROB2_GROUP = {
  instrumentId: 'RoB2', instrumentLabel: 'RoB 2', instrumentVersion: '2019-08-22',
  scoring: 'judgment', applicabilityDomainIds: [],
  assessmentIds: ['mine', 'theirs'],
  matrix: {
    instrumentId: 'RoB2',
    domains: ['D1', 'D2', 'D3', 'D4', 'D5'].map(id => ({ id, shortLabel: id })),
    rows: [
      { id: 'mine', label: 'Smith 2021', cells: [{ domainId: 'D1', judgment: 'low' }], overall: 'low' },
      { id: 'theirs', label: 'Smith 2021', cells: [{ domainId: 'D1', judgment: 'high' }], overall: 'high' },
    ],
  },
  domainJudgmentLevels: ['low', 'some', 'high'],
  overallLevels: ['low', 'some', 'high'],
};

/* ── 1. the pure rule ───────────────────────────────────────────────────────── */

describe('blindVisibility — which rows this reviewer may see', () => {
  it('withholds the OTHER reviewer’s row while the pair is mid-blind', () => {
    const v = blindVisibility([MINE_DONE, THEIRS_DRAFT], { currentUserId: ME });
    expect(v.hiddenIds.has('theirs')).toBe(true);
    expect(v.hiddenIds.has('mine')).toBe(false);
    expect(v.visible.map(r => r.id)).toEqual(['mine']);
    expect(v.hiddenCount).toBe(1);
  });

  it('is symmetric — the unfinished reviewer cannot peek at the finished one', () => {
    const v = blindVisibility([MINE_DONE, THEIRS_DRAFT], { currentUserId: THEM });
    expect(v.hiddenIds.has('mine')).toBe(true);
    expect(v.visible.map(r => r.id)).toEqual(['theirs']);
  });

  it('hides NOTHING once every independent assessment is complete', () => {
    const v = blindVisibility([MINE_DONE, THEIRS_DONE], { currentUserId: ME });
    expect(v.hiddenCount).toBe(0);
    expect(v.visible).toHaveLength(2);
  });

  it('leaves an ordinary single-reviewer study completely alone', () => {
    // `reviewerBlindState` calls this "locked" too, but there is no second
    // reviewer to protect — masking here would blank every normal project.
    const v = blindVisibility([row({ id: 'solo', status: 'draft' })], { currentUserId: ME });
    expect(v.hiddenCount).toBe(0);
    expect(isBlindedPair([row({ id: 'solo', status: 'draft' })])).toBe(false);
    expect(isBlindedPair([MINE_DONE, THEIRS_DRAFT])).toBe(true);
  });

  it('never hides the consensus record — it postdates the blind', () => {
    const v = blindVisibility([MINE_DONE, THEIRS_DRAFT, CONSENSUS], { currentUserId: ME });
    expect(v.hiddenIds.has('cons')).toBe(false);
    expect(v.visible.map(r => r.id).sort()).toEqual(['cons', 'mine']);
  });

  it('scopes the blind to ONE (study, instrument) pair', () => {
    // The same two people on a DIFFERENT tool, both complete → nothing hidden
    // there, even though their RoB 2 pair is still blinded.
    const quadasA = row({ id: 'qa', instrumentId: 'QUADAS-2', reviewerId: ME, status: 'complete' });
    const quadasB = row({ id: 'qb', instrumentId: 'QUADAS-2', reviewerId: THEM, status: 'complete' });
    const otherStudy = row({ id: 'os', studyId: 's2', reviewerId: THEM, status: 'draft' });
    const v = blindVisibility([MINE_DONE, THEIRS_DRAFT, quadasA, quadasB, otherStudy], { currentUserId: ME });
    expect([...v.hiddenIds]).toEqual(['theirs']);
    expect(v.blindedPairs).toEqual([{ studyId: 's1', instrumentId: 'RoB2', hidden: 1, pending: 1 }]);
  });

  it('FAILS CLOSED when the viewer cannot be identified', () => {
    // Without an id we cannot tell whose work a row is. Guessing "show it" would
    // hand a colleague's draft to whoever the session belongs to.
    const v = blindVisibility([MINE_DONE, THEIRS_DRAFT], { currentUserId: null });
    expect(v.hiddenCount).toBe(2);
    expect(v.visible).toHaveLength(0);
  });

  it('says how many rows it withheld, and why', () => {
    expect(blindNote(1)).toBe('1 assessment hidden until both reviewers complete — independent review in progress.');
    expect(blindNote(3)).toContain('3 assessments hidden');
    expect(blindNote(0)).toBe('');
  });

  it('drops the withheld rows from the traffic-light matrix too', () => {
    const v = blindVisibility([MINE_DONE, THEIRS_DRAFT], { currentUserId: ME });
    const filtered = filterMatrixRows(ROB2_GROUP.matrix, v.hiddenIds);
    expect(filtered.rows.map(r => r.id)).toEqual(['mine']);
    // Same object back when there is nothing to hide (no needless re-render).
    expect(filterMatrixRows(ROB2_GROUP.matrix, new Set())).toBe(ROB2_GROUP.matrix);
  });
});

/* ── 2. the summary model ───────────────────────────────────────────────────── */

describe('buildSummaryModel — the blind reaches the outputs', () => {
  const model = (over = {}) => buildSummaryModel({
    groups: [ROB2_GROUP], assessments: [MINE_DONE, THEIRS_DRAFT], currentUserId: ME, ...over,
  });

  it('excludes the blinded row from the table, the count and the distributions', () => {
    const m = model();
    const s = m.sections[0];
    expect(s.rows.map(r => r.id)).toEqual(['mine']);
    expect(s.count).toBe(1);
    expect(s.hiddenByBlind).toBe(1);
    // The distribution must not count a judgement the table does not show.
    const d1 = s.distributions.find(d => d.domainId === 'D1');
    expect(d1.recorded).toBe(1);
    expect(d1.levels.find(l => l.level === 'high').count).toBe(0);
    expect(s.overallDistribution.levels.find(l => l.level === 'high').count).toBe(0);
  });

  it('states the omission instead of quietly reporting a smaller project', () => {
    expect(model().sections[0].blindNote).toContain('hidden until both reviewers complete');
    expect(model().hiddenByBlind).toBe(1);
  });

  it('reports everything once both reviewers finish', () => {
    const m = model({ assessments: [MINE_DONE, THEIRS_DONE] });
    expect(m.sections[0].rows.map(r => r.id).sort()).toEqual(['mine', 'theirs']);
    expect(m.sections[0].blindNote).toBe('');
    expect(m.hiddenByBlind).toBe(0);
  });

  it('lets groupRows be handed the raw list and still refuse the hidden ids', () => {
    const hiddenIds = new Set(['theirs']);
    expect(groupRows(ROB2_GROUP, [MINE_DONE, THEIRS_DRAFT], { hiddenIds }).map(r => r.id)).toEqual(['mine']);
    // …and is unchanged when no blind is supplied (every existing caller).
    expect(groupRows(ROB2_GROUP, [MINE_DONE, THEIRS_DRAFT])).toHaveLength(2);
  });
});

describe('RobSummaryOutputs — nothing about the blinded row reaches the DOM', () => {
  const html = renderToStaticMarkup(
    <RobSummaryOutputs groups={[ROB2_GROUP]} assessments={[MINE_DONE, THEIRS_DRAFT]} currentUserId={ME} />,
  );

  it('shows my own assessment', () => {
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('1 assessment across 1 study');
  });

  it('does not name the blinded reviewer or render their row', () => {
    expect(html).not.toContain('Grace Hopper');
  });

  it('says how many assessments are hidden and why', () => {
    expect(html).toContain('1 assessment hidden until both reviewers complete');
  });

  it('withdraws the traffic-light plot rather than plotting a masked matrix', () => {
    // The blind emptied the plot of everything but my own row; the toggle would
    // otherwise draw Grace's in-progress judgements as coloured cells.
    expect(html).toContain('traffic-light plot');
  });
});

/* ── 3. the article list row ────────────────────────────────────────────────── */

describe('AssessmentRow — the blinded row is listed, its judgement is not', () => {
  const mine = renderToStaticMarkup(<AssessmentRow a={{ ...MINE_DONE, resultLabel: 'Primary outcome' }} canEdit />);
  const theirs = renderToStaticMarkup(<AssessmentRow a={{ ...THEIRS_DRAFT, resultLabel: 'Primary outcome' }} canEdit masked />);

  it('shows MY overall judgement in full', () => {
    expect(mine).toContain('Overall risk: Low');
    expect(mine).toContain('>Low<');
    expect(mine).toContain('Open');
  });

  it('replaces the colleague’s judgement with an explicit "hidden"', () => {
    expect(theirs).toContain('Judgement hidden');
    expect(theirs).toContain('Blinded');
    expect(theirs).toContain('independent review in progress');
  });

  it('never prints the blinded judgement, in text or in a label', () => {
    expect(theirs).not.toContain('Overall risk: High');
    expect(theirs).not.toContain('>High<');
  });

  it('still names the reviewer and their progress — that is workflow, not judgement', () => {
    expect(theirs).toContain('Grace Hopper');
    expect(theirs).toContain('draft');
    expect(theirs).toContain('RoB 2');
  });

  it('offers no Open/Delete on a blinded row (opening it would defeat the blind)', () => {
    expect(theirs).not.toContain('>Open<');
    expect(theirs).not.toContain('title="Delete"');
  });
});

/* ── 4. the overall chip is resolved on the instrument's OWN scale ──────────── */

describe('overallPresentation — no more one-scale-fits-all inversion', () => {
  it('keeps a risk-of-bias overall on the risk scale', () => {
    const p = overallPresentation({ instrumentId: 'RoB2', overall: 'high' });
    expect(p.scale).toBe('rob');
    expect(p.style.label).toBe('High');
    expect(p.aria).toBe('Overall risk: High');
  });

  it('renders an AMSTAR 2 "high" as HIGH CONFIDENCE, not high risk', () => {
    const confident = overallPresentation({ instrumentId: 'AMSTAR-2', overall: 'high' });
    const risky = overallPresentation({ instrumentId: 'RoB2', overall: 'high' });
    expect(confident.scale).toBe('confidence');
    expect(confident.style.label).toBe('High confidence');
    expect(confident.aria).toBe('Overall confidence: High');
    // The whole point: same stored string, opposite polarity, different colour.
    expect(confident.style.hex).not.toBe(risky.style.hex);
    expect(confident.style.icon).toBe('circleCheck');
  });

  it('renders AMSTAR 2 "critically-low" as the worst rating', () => {
    const p = overallPresentation({ instrumentId: 'AMSTAR-2', overall: 'critically-low' });
    expect(p.style.label).toBe('Critically low confidence');
    expect(p.style.icon).toBe('alertOctagon');
    // …which is the colour AMSTAR's "high" used to get.
    expect(p.style.hex).toBe(overallPresentation({ instrumentId: 'RoB2', overall: 'high' }).style.hex);
  });

  it('renders a JBI overall as a DECISION, not as a severity', () => {
    const inc = overallPresentation({ instrumentId: 'JBI-CaseSeries', overall: 'include' });
    expect(inc.scale).toBe('decision');
    expect(inc.style.label).toBe('Include');
    expect(inc.aria).toBe('Appraisal decision: Include');
    const exc = overallPresentation({ instrumentId: 'JBI-CaseSeries', overall: 'exclude' });
    expect(exc.style.label).toBe('Exclude');
  });

  it('claims NO overall for an instrument that prescribes none (QUADAS-2)', () => {
    const p = overallPresentation({ instrumentId: 'QUADAS-2', overall: '' });
    expect(p.scale).toBeNull();
    expect(p.aria).toBe('This tool prescribes no overall judgement');
    const html = renderToStaticMarkup(
      <AssessmentRow a={{ id: 'q1', instrumentId: 'QUADAS-2', overall: '', status: 'draft' }} canEdit />,
    );
    expect(html).toContain('No overall judgement');
  });

  it('falls back to the risk scale for an instrument it cannot resolve', () => {
    const p = overallPresentation({ instrumentId: 'FUTURE-TOOL', overall: 'high' });
    expect(p.scale).toBe('rob');
    expect(p.aria).toBe('Overall risk: High');
  });

  it('renders the AMSTAR row without a single risk-of-bias word', () => {
    const html = renderToStaticMarkup(
      <AssessmentRow a={{ id: 'am1', instrumentId: 'AMSTAR-2', instrumentLabel: 'AMSTAR 2', overall: 'high', status: 'complete' }} canEdit />,
    );
    expect(html).toContain('High confidence');
    expect(html).toContain('Overall confidence: High');
    expect(html).not.toContain('Risk of bias:');
  });
});
