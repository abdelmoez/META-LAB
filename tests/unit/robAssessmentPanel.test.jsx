/**
 * robAssessmentPanel.test.jsx — the DEFINITION-DRIVEN assessment renderer
 * (115.md build items 2 + 3; §9, §14-§16, §21, §30-§31).
 *
 * SSR-only, like every UI test in this repo (no jsdom). The assertions that
 * matter are METHODOLOGICAL, not cosmetic:
 *
 *   · QUADAS-2's two axes are rendered as SEPARATE sub-sections — a renderer that
 *     collapsed "Low risk of bias" and "High applicability concern" into one cell
 *     would silently misreport every diagnostic-accuracy review;
 *   · a JBI checklist offers Yes/No/Unclear/Not applicable and the reviewer's
 *     appraisal DECISION, and never a score;
 *   · AMSTAR 2 marks its seven critical domains and shows the confidence rating
 *     WITH the rule that produced it, never a number out of sixteen;
 *   · QUADAS-2's `overall: null` is rendered as the fact it is;
 *   · which renderer an instrument gets is decided from the DEFINITION.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InstrumentAssessmentPanel, {
  JudgmentAxis, OverallSection, responsesForQuestion, responseLabel,
} from '../../src/frontend/rob/InstrumentAssessmentPanel.jsx';
import { assessmentProgress, robRenderMode, overallContract, incompleteReason } from '../../src/frontend/rob/robProgress.js';
import {
  QUADAS2, AMSTAR2, QUIPS, PROBAST, JBI_CASE_SERIES, ROB2, ROBINSI, NOS_COHORT,
  proposeDomain,
} from '../../src/research-engine/rob/index.js';

const emptyView = { domains: [], applicability: [], overall: {} };

const proposalsFor = (instrument, answers) => {
  const out = {};
  for (const d of instrument.domains) out[d.id] = proposeDomain(instrument, d.id, answers[d.id] || {});
  return out;
};

const renderPanel = (instrument, { answers = {}, view = emptyView, ...over } = {}) => {
  const liveProposals = proposalsFor(instrument, answers);
  return renderToStaticMarkup(
    <InstrumentAssessmentPanel
      instrument={instrument}
      view={view}
      answers={answers}
      meta={{}}
      editable
      progress={assessmentProgress(instrument, { answers, view, liveProposals })}
      liveProposals={liveProposals}
      liveOverall={null}
      initialOpen="all"
      {...over}
    />,
  );
};

/* ── which renderer an instrument gets, from the DEFINITION ─────────────────── */

describe('robRenderMode — decided by the definition, never by an id list', () => {
  it('keeps RoB 2 / ROBINS-I on the domain walk and the NOS forms on stars', () => {
    expect(robRenderMode(ROB2)).toBe('domain-walk');
    expect(robRenderMode(ROBINSI)).toBe('domain-walk');
    expect(robRenderMode(NOS_COHORT)).toBe('stars');
  });

  it('routes every instrument that declares a judgement axis to the definition renderer', () => {
    for (const inst of [QUADAS2, PROBAST, QUIPS, AMSTAR2, JBI_CASE_SERIES]) {
      expect(robRenderMode(inst)).toBe('definition');
    }
  });
});

/* ── §14 — QUADAS-2's two axes are structurally separate ───────────────────── */

describe('QUADAS-2 — risk of bias and applicability are separate sub-sections', () => {
  const html = renderPanel(QUADAS2);

  it('renders BOTH axis headings for the three dual-axis domains', () => {
    // The heading is the visible `…</svg> <label></span>` text; the pill's
    // aria-label repeats it, so count the heading close-tag specifically.
    expect(html.match(/Risk of bias<\/span>/g)).toHaveLength(4);
    expect(html.match(/Applicability concerns<\/span>/g)).toHaveLength(3);
  });

  it('renders no applicability section for Flow and Timing (the tool has none)', () => {
    const d4 = QUADAS2.domains.find(d => d.id === 'D4');
    expect(d4.applicability).toBeUndefined();
    const only4 = renderToStaticMarkup(
      <InstrumentAssessmentPanel
        instrument={{ ...QUADAS2, domains: [d4] }} view={emptyView} answers={{}} meta={{}} editable
        progress={assessmentProgress({ ...QUADAS2, domains: [d4] }, { answers: {}, view: emptyView })}
        liveProposals={{}} initialOpen="all" />,
    );
    expect(only4).not.toContain('Applicability concerns');
  });

  it('renders the applicability PROMPT as context, never as an answerable item', () => {
    // 1.A is `answerable: false` — the concern is recorded on the applicability
    // axis, so no Yes/No/Unclear control may be offered for it.
    expect(html).toContain('Is there concern that the included patients do not match the review question?');
    const q1a = QUADAS2.domains[0].questions.find(q => q.id === '1.A');
    expect(q1a.answerable).toBe(false);
    expect(responsesForQuestion(QUADAS2, QUADAS2.domains[0], q1a)).toEqual([]);
  });

  it('offers exactly Yes / No / Unclear on a signalling question', () => {
    const q = QUADAS2.domains[0].questions.find(x => x.id === '1.1');
    expect(responsesForQuestion(QUADAS2, QUADAS2.domains[0], q)).toEqual(['Y', 'N', 'U']);
    expect(html).toContain('Unclear');
    expect(html).not.toContain('Probably yes');
  });

  it('states that QUADAS-2 defines NO overall judgement (§10 — never invent one)', () => {
    expect(overallContract(QUADAS2).defined).toBe(false);
    expect(html).toContain('No overall judgement');
    expect(html).toContain('defines no overall judgement');
  });

  it('says "your judgement" instead of a proposal once a signalling question is "No"', () => {
    const answers = { D1: { '1.1': 'N', '1.2': 'Y', '1.3': 'Y' } };
    const flagged = renderPanel(QUADAS2, { answers });
    expect(flagged).toContain('This instrument proposes no judgement here');
  });
});

/* ── §9 — the JBI checklists ───────────────────────────────────────────────── */

describe('JBI Case Series — checklist responses + a reviewer decision, no score', () => {
  const html = renderPanel(JBI_CASE_SERIES);

  it('offers Yes / No / Unclear / Not applicable on every item', () => {
    const d = JBI_CASE_SERIES.domains[0];
    expect(responsesForQuestion(JBI_CASE_SERIES, d, d.questions[0])).toEqual(['Y', 'N', 'U', 'NA']);
    expect(html).toContain('Not applicable');
    expect(responseLabel('NA')).toBe('Not applicable');
  });

  it('ends in the reviewer\'s appraisal decision, not a computed rating', () => {
    const c = overallContract(JBI_CASE_SERIES);
    expect(c.defined).toBe(true);
    expect(c.computed).toBe(false);
    expect(c.scale).toBe('decision');
    expect(c.levels).toEqual(['include', 'exclude', 'seek-further-info']);
    expect(html).toContain('Overall appraisal decision');
    expect(html).toContain('This instrument proposes no judgement here');
  });

  it('never renders an answered-item count as a rating (115.md decision 5)', () => {
    const answers = { checklist: Object.fromEntries(JBI_CASE_SERIES.domains[0].questions.map(q => [q.id, 'Y'])) };
    const full = renderPanel(JBI_CASE_SERIES, { answers });
    expect(full).toContain('10/10 answered');
    expect(full).not.toMatch(/score/i);
  });
});

/* ── §15 — AMSTAR 2 ────────────────────────────────────────────────────────── */

describe('AMSTAR 2 — critical domains and a confidence rating, never a score', () => {
  const html = renderPanel(AMSTAR2);

  it('renders all sixteen items and badges exactly the seven critical domains', () => {
    expect(AMSTAR2.domains[0].questions).toHaveLength(16);
    expect(AMSTAR2.domains[0].questions.filter(q => q.critical)).toHaveLength(7);
    expect(html.match(/Critical domain<\/span>/g)).toHaveLength(7);
    expect(html).toContain('Protocol registered before commencement of the review');
  });

  it('offers Partial Yes only on the items that define it', () => {
    const d = AMSTAR2.domains[0];
    const withPartial = d.questions.filter(q => (q.responses || []).includes('PARTIAL_YES')).map(q => q.id);
    expect(withPartial).toEqual(['2', '4', '7', '8', '9']);
    expect(responsesForQuestion(AMSTAR2, d, d.questions[0])).toEqual(['Y', 'N']);
    expect(html).toContain('Partial Yes');
  });

  it('shows the overall CONFIDENCE rating with the official rule behind it', () => {
    const c = overallContract(AMSTAR2);
    expect(c.scale).toBe('confidence');
    expect(c.computed).toBe(true);
    expect(c.levels).toEqual(['high', 'moderate', 'low', 'critically-low']);
    expect(html).toContain('Overall confidence in the results of the review');
    expect(html).toContain('How this is decided');
  });

  it('labels the weakness counts as counts, explicitly not a score', () => {
    const withCounts = renderToStaticMarkup(
      <OverallSection instrument={AMSTAR2} overall={overallContract(AMSTAR2)} view={emptyView}
        liveOverall={{ judgment: 'low', reasons: [], criticalFlaws: 1, nonCriticalWeaknesses: 2 }}
        editable onOverall={() => {}} />,
    );
    expect(withCounts).toContain('1 critical flaw');
    expect(withCounts).toContain('2 non-critical weaknesses');
    expect(withCounts).toContain('not a score');
    // High CONFIDENCE must never be painted on the risk-of-bias scale.
    const high = renderToStaticMarkup(
      <OverallSection instrument={AMSTAR2} overall={overallContract(AMSTAR2)} view={emptyView}
        liveOverall={{ judgment: 'high', reasons: [] }} editable onOverall={() => {}} />,
    );
    expect(high).toContain('High confidence');
  });
});

/* ── §16 — QUIPS + PROBAST ─────────────────────────────────────────────────── */

describe('QUIPS — six domains rated by the assessor', () => {
  const html = renderPanel(QUIPS);

  it('renders all six domains, each with its own Low / Moderate / High axis', () => {
    expect(QUIPS.domains).toHaveLength(6);
    expect(html.match(/Risk of bias<\/span>/g)).toHaveLength(6);
    const p = assessmentProgress(QUIPS, { answers: {}, view: emptyView });
    expect(p.judgments.required).toBe(6);
    expect(p.judgments.recorded).toBe(0);
  });

  it('treats its summary rating as OPTIONAL and says it is not a QUIPS output', () => {
    const c = overallContract(QUIPS);
    expect(c.defined).toBe(true);
    expect(c.official).toBe(false);
    expect(c.required).toBe(false);
    expect(html).toContain('not a QUIPS output');
  });
});

describe('PROBAST — dual axis with two computed overalls', () => {
  const html = renderPanel(PROBAST);

  it('renders twenty signalling questions across four domains', () => {
    expect(PROBAST.domains).toHaveLength(4);
    expect(PROBAST.domains.reduce((n, d) => n + d.questions.length, 0)).toBe(20);
    expect(html).toContain('Were appropriate data sources used');
  });

  it('renders applicability for the first three domains only', () => {
    expect(html.match(/Applicability concerns<\/span>/g)).toHaveLength(3);
    expect(PROBAST.domains[3].applicability).toBeUndefined();
  });

  it('reports overall applicability alongside overall risk of bias', () => {
    const both = renderToStaticMarkup(
      <OverallSection instrument={PROBAST} overall={overallContract(PROBAST)} view={emptyView}
        liveOverall={{ judgment: 'high', reasons: ['At least one domain is high.'], applicability: { judgment: 'low', reasons: ['All low.'] } }}
        editable onOverall={() => {}} />,
    );
    expect(both).toContain('Overall risk of bias');
    expect(both).toContain('Overall applicability');
    expect(both).toContain('Low concern');
  });
});

/* ── §21 — progress honesty ────────────────────────────────────────────────── */

describe('assessmentProgress — complete means the DEFINITION says so', () => {
  it('is not complete on open', () => {
    for (const inst of [QUADAS2, AMSTAR2, QUIPS, PROBAST, JBI_CASE_SERIES]) {
      expect(assessmentProgress(inst, { answers: {}, view: emptyView }).complete).toBe(false);
    }
  });

  it('QUADAS-2: every item answered is NOT enough — the applicability axes count too', () => {
    const answers = {};
    for (const d of QUADAS2.domains) {
      answers[d.id] = Object.fromEntries(d.questions.filter(q => q.answerable !== false).map(q => [q.id, 'Y']));
    }
    const liveProposals = proposalsFor(QUADAS2, answers);
    const noConcerns = assessmentProgress(QUADAS2, { answers, view: emptyView, liveProposals });
    expect(noConcerns.answeredAll).toBe(true);
    expect(noConcerns.applicability).toEqual({ recorded: 0, required: 3 });
    expect(noConcerns.complete).toBe(false);
    expect(incompleteReason(noConcerns)).toContain('3 applicability concerns');

    const view = {
      domains: [], overall: {},
      applicability: QUADAS2.domains.filter(d => d.applicability).map(d => ({ domainId: d.id, judgment: 'low' })),
    };
    const done = assessmentProgress(QUADAS2, { answers, view, liveProposals });
    expect(done.applicability).toEqual({ recorded: 3, required: 3 });
    expect(done.complete).toBe(true);
    expect(incompleteReason(done)).toBe('');
  });

  it('JBI: every item answered is NOT enough — the appraisal decision is required', () => {
    const answers = { checklist: Object.fromEntries(JBI_CASE_SERIES.domains[0].questions.map(q => [q.id, 'Y'])) };
    const open = assessmentProgress(JBI_CASE_SERIES, { answers, view: emptyView });
    expect(open.answeredAll).toBe(true);
    expect(open.complete).toBe(false);
    expect(incompleteReason(open)).toContain('overall appraisal decision');

    const decided = assessmentProgress(JBI_CASE_SERIES, {
      answers,
      view: { domains: [], applicability: [], overall: { overridden: true, finalOverall: 'include' } },
    });
    expect(decided.complete).toBe(true);
  });

  it('QUIPS: the six domain ratings are required; the summary rating is not', () => {
    const answers = {};
    for (const d of QUIPS.domains) answers[d.id] = Object.fromEntries(d.questions.map(q => [q.id, 'Y']));
    const rated = {
      domains: QUIPS.domains.map(d => ({ domainId: d.id, overridden: true, finalJudgment: 'low', resolvedJudgment: 'low' })),
      applicability: [], overall: {},
    };
    const p = assessmentProgress(QUIPS, { answers, view: rated });
    expect(p.judgments).toEqual({ recorded: 6, required: 6 });
    expect(p.overall.required).toBe(false);
    expect(p.complete).toBe(true);
  });

  it('labels per-domain progress as "<domain> · a/b answered" (§30 sticky progress)', () => {
    const p = assessmentProgress(QUADAS2, { answers: { D1: { 1.1: 'Y' } }, view: emptyView });
    expect(p.perDomain.D1.label).toBe('Patient selection · 1/3 answered');
    expect(p.label).toBe('1/11 answered');
  });

  it('leaves RoB 2 exactly as it was: items answered IS the completion predicate', () => {
    const answers = {};
    for (const d of ROB2.domains) answers[d.id] = Object.fromEntries(d.questions.map(q => [q.id, 'Y']));
    const liveProposals = proposalsFor(ROB2, answers);
    const p = assessmentProgress(ROB2, { answers, view: emptyView, liveProposals });
    expect(p.answeredAll).toBe(true);
    expect(p.applicability.required).toBe(0);
    expect(p.complete).toBe(true);
  });
});

/* ── §31 — guidance comes from the definition ──────────────────────────────── */

describe('JudgmentAxis — guidance and reasons come from the definition text', () => {
  it('exposes the rule behind a computed judgement as expandable guidance', () => {
    const html = renderToStaticMarkup(
      <JudgmentAxis title="Overall risk of bias" icon="sigma" levels={['low', 'high', 'unclear']} scale="rob"
        value="" proposed="low" reasons={['All domains were rated low risk of bias.']} computed editable
        guidance={PROBAST.overall.guidance} onSave={() => {}} />,
    );
    expect(html).toContain('All domains were rated low risk of bias.');
    expect(html).toContain('How this is decided');
  });

  it('marks a reviewer-judged axis as the reviewer\'s, with no fabricated proposal', () => {
    const html = renderToStaticMarkup(
      <JudgmentAxis title="Risk of bias" icon="scale" levels={['low', 'moderate', 'high']} scale="rob"
        value="" proposed="" reasons={[]} computed={false} editable onSave={() => {}} />,
    );
    expect(html).toContain('This instrument proposes no judgement here');
    expect(html).toContain('Not assessed');
  });
});
