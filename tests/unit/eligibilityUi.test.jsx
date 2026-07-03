/**
 * eligibilityUi.test.jsx — P10 Criteria Screener (Eligibility) UI layer.
 *
 * SSR-safe contract tests (house style: renderToStaticMarkup, no jsdom). These
 * assert the presentational contract — copy, chips, controls — of the criteria
 * builder, the per-record adjudication view, and the validation view. Effects/clicks
 * do not run under static rendering, so interaction is asserted by control presence.
 *
 * Guard rail: NO user-facing "AI" string may appear in any rendered markup.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CriteriaBuilder from '../../src/frontend/screening/eligibility/CriteriaBuilder.jsx';
import { EligibilityAssessmentView } from '../../src/frontend/screening/eligibility/EligibilityCard.jsx';
import { ValidationMetricsView } from '../../src/frontend/screening/eligibility/EligibilityValidationPanel.jsx';

const noop = () => {};

describe('CriteriaBuilder', () => {
  it('shows the empty state (and an Add control for editors) with no criteria', () => {
    const html = renderToStaticMarkup(h(CriteriaBuilder, { criteria: [], canEdit: true, onSave: noop }));
    expect(html).toContain('No eligibility criteria yet');
    expect(html).toContain('Add criterion');
    // No user-facing "AI" wording — guard against the standalone word/heading.
    expect(html).not.toMatch(/\bAI\b/);
  });

  it('renders a row per criterion with its question text and include/exclude counts', () => {
    const criteria = [
      { id: 1, key: 'pop', category: 'population', question: 'Are adults the study population', kind: 'include', required: true },
      { id: 2, key: 'animal', category: 'study design', question: 'Is this an animal study', kind: 'exclude', required: false },
    ];
    const html = renderToStaticMarkup(h(CriteriaBuilder, { criteria, version: 3, canEdit: true, onSave: noop }));
    expect(html).toContain('Are adults the study population');
    expect(html).toContain('Is this an animal study');
    expect(html).toContain('1 INCLUDE');
    expect(html).toContain('1 EXCLUDE');
    expect(html).toContain('Save criteria');
  });

  it('hides editing controls when canEdit is false', () => {
    const criteria = [{ id: 1, key: 'pop', category: 'population', question: 'Adults?', kind: 'include', required: true }];
    const html = renderToStaticMarkup(h(CriteriaBuilder, { criteria, canEdit: false, onSave: noop }));
    expect(html).not.toContain('Save criteria');
    expect(html).not.toContain('Add criterion');
  });

  it('renders the Run action when onRun is supplied', () => {
    const html = renderToStaticMarkup(h(CriteriaBuilder, {
      criteria: [{ id: 1, key: 'pop', category: 'population', question: 'Adults?', kind: 'include' }],
      canEdit: true, canRun: true, onSave: noop, onRun: noop,
    }));
    expect(html).toContain('Run Criteria Screener');
  });
});

describe('EligibilityAssessmentView', () => {
  const assessment = {
    suggestedDecision: 'include',
    decisionConfidence: 0.82,
    answers: [
      { key: 'pop', category: 'population', kind: 'include', required: true, answer: 'yes', confidence: 0.9, rationale: 'Matched adults', evidenceQuote: 'Adults aged 18-65 were enrolled.', sourceField: 'abstract' },
      { key: 'animal', category: 'study design', kind: 'exclude', required: false, answer: 'no', confidence: 0.7, rationale: 'No animal terms', evidenceQuote: null, sourceField: 'none' },
    ],
    blockers: [],
    autoApplied: false,
  };

  it('renders the suggested decision, confidence, and criterion answers', () => {
    const html = renderToStaticMarkup(h(EligibilityAssessmentView, { assessment, canScreen: true, onAdjudicate: noop }));
    expect(html).toContain('Likely include');
    expect(html).toContain('confidence 82%');
    expect(html).toContain('pop');       // criterion name
    expect(html).toContain('Yes');       // answer chip
    expect(html).not.toMatch(/\bAI\b/);
  });

  it('exposes reviewer Accept + Override controls when the user can screen', () => {
    const html = renderToStaticMarkup(h(EligibilityAssessmentView, { assessment, canScreen: true, onAdjudicate: noop }));
    expect(html).toContain('Accept suggestion');
    expect(html).toContain('Include');
    expect(html).toContain('Exclude');
  });

  it('hides adjudication controls for view-only users', () => {
    const html = renderToStaticMarkup(h(EligibilityAssessmentView, { assessment, canScreen: false, onAdjudicate: noop }));
    expect(html).not.toContain('Accept suggestion');
  });

  it('surfaces blockers plainly and an Undo for auto-applied assessments', () => {
    const a = { ...assessment, suggestedDecision: 'exclude', autoApplied: true, blockers: ['Exclusion met: animal'] };
    const html = renderToStaticMarkup(h(EligibilityAssessmentView, { assessment: a, canScreen: true, onAdjudicate: noop, onUndo: noop }));
    expect(html).toContain('Exclusion met: animal');
    expect(html).toContain('Auto-applied');
    expect(html).toContain('Undo auto-apply');
  });

  it('shows an empty state when no criteria are configured', () => {
    const html = renderToStaticMarkup(h(EligibilityAssessmentView, { assessment: null, canScreen: true, criteriaConfigured: false, onAdjudicate: noop }));
    expect(html).toContain('No eligibility criteria yet');
  });
});

describe('ValidationMetricsView', () => {
  it('renders metrics, confusion matrix, per-criterion agreement and an Export CSV link', () => {
    const metrics = {
      n: 40, recall: 0.9, precision: 0.8, specificity: 0.75, accuracy: 0.82, auc: 0.88, threshold: 0.5,
      confusionMatrix: { tp: 18, fp: 4, tn: 15, fn: 3 },
      perCriterion: [{ key: 'pop', category: 'population', kind: 'include', n: 40, decisive: 30, agreement: 0.9 }],
    };
    const html = renderToStaticMarkup(h(ValidationMetricsView, { metrics, csvUrl: '/api/screening/projects/x/eligibility/validation?format=csv' }));
    expect(html).toContain('Recall');
    expect(html).toContain('90%');
    expect(html).toContain('Export CSV');
    expect(html).toContain('True include (TP)');
    expect(html).toContain('pop');
    expect(html).toContain('format=csv');
  });

  it('explains when there are not enough decisions yet', () => {
    const html = renderToStaticMarkup(h(ValidationMetricsView, { metrics: { n: 0 } }));
    expect(html).toContain('Not enough reviewer decisions');
  });
});
