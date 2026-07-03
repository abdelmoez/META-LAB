/**
 * gradeCertaintyPanel.test.jsx — P12. The per-outcome GRADE certainty workspace
 * (GradeCertaintyPanel + its pure leaves). SSR-safe, mirroring the house pattern
 * (searchWizardPanels / fullTextPanel): the container loads data in effects that never
 * run under renderToStaticMarkup, so we render the pure leaves from props and drive the
 * certainty readout off the REAL engine (computeCertainty) so the UI can't drift from it.
 *
 * Guards the P12 product rules: the suggestion is clearly labelled "Suggested" (never the
 * saved value), a rating select is present, the locked state disables editing, the SoF
 * export links point at the real endpoint — and NO user-facing "AI" wording appears.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GradeCertaintyPanel,
  OutcomeSelector, DomainCard, CertaintyReadout, InformedPanel, AuditList, SofExportLinks,
  CERTAINTY_DOMAINS, RATING_OPTIONS, informedForDomain, certaintyColor,
} from '../../src/frontend/workspace/tabs/gradeCertainty/GradeCertaintyPanel.jsx';
import { computeCertainty } from '../../src/research-engine/grade/index.js';

/* A realistic per-outcome DTO in the shape the server (gradeService.assembleOutcome) returns. */
const OUTCOME = {
  outcomeKey: 'mortality::12w::OR',
  outcomeLabel: 'All-cause mortality (12 weeks)',
  outcome: 'All-cause mortality', timepoint: '12 weeks', esType: 'OR',
  meta: { pooled: true, k: 6, I2: 62, pES: -0.3, lo95: -0.6, hi95: -0.02, pval: 0.03, estimate: 0.74, ciLow: 0.55, ciHigh: 0.98, egger: { pval: 0.08, k: 6 }, nParticipants: 1840, nParticipantsPartial: false },
  robSummary: { assessed: 6, completed: 6, pending: 0, counts: { low: 2, some: 3, high: 1 }, suggestedRating: 'serious', reason: 'serious limitations', signature: 'v1' },
  startLevel: { numeric: 4, label: 'High' },
  suggestions: {
    rob: { suggest: 'serious', reason: '1 high-risk and 3 some-concern of 6 assessed suggest serious limitations.', source: 'auto' },
    inconsistency: { suggest: 'serious', reason: 'I² = 62% (substantial heterogeneity).', source: 'auto' },
    indirectness: { suggest: null, reason: 'Reflects how well the studies match your PICO.', source: 'auto' },
    imprecision: { suggest: 'not_serious', reason: 'The 95% CI excludes the null.', source: 'auto' },
    publicationBias: { suggest: 'serious', reason: 'With only 6 studies (<10), publication bias cannot be reliably assessed.', source: 'auto' },
  },
  domains: {
    rob: { rating: 'serious', source: 'auto', note: '' },
    inconsistency: { rating: 'serious', source: 'auto', note: '' },
    indirectness: { rating: '', source: 'auto', note: '' },
    imprecision: { rating: 'not_serious', source: 'auto', note: '' },
    publicationBias: { rating: 'serious', source: 'auto', note: '' },
  },
  ratings: { rob: 'serious', inconsistency: 'serious', imprecision: 'not_serious', publicationBias: 'serious' },
  certainty: { level: 'Low', levelKey: 'low', numeric: 2, modifiersApplied: [] },
  certaintyLabel: 'Low',
  confirmed: false, locked: false, assessment: null,
};

describe('engine-derived vocabulary', () => {
  it('exposes exactly the five downgrade domains + the down-rating options', () => {
    const keys = CERTAINTY_DOMAINS.map((d) => d.key);
    expect(keys).toEqual(['rob', 'inconsistency', 'indirectness', 'imprecision', 'publicationBias']);
    const vals = RATING_OPTIONS.map((o) => o.v);
    expect(vals).toContain('not_serious');
    expect(vals).toContain('serious');
    expect(vals).toContain('very_serious');
    expect(vals).toContain(''); // an explicit "Not rated"
  });
});

describe('OutcomeSelector', () => {
  it('lists each outcome with its certainty and a provisional badge', () => {
    const html = renderToStaticMarkup(h(OutcomeSelector, { outcomes: [OUTCOME], selectedKey: OUTCOME.outcomeKey, onSelect: () => {} }));
    expect(html).toContain('All-cause mortality (12 weeks)');
    expect(html).toContain('Low');            // current certainty
    expect(html).toContain('Provisional');    // confirmed === false
  });

  it('shows a calm empty hint when there are no gradeable outcomes', () => {
    const html = renderToStaticMarkup(h(OutcomeSelector, { outcomes: [], selectedKey: null, onSelect: () => {} }));
    expect(html).toContain('No outcomes');
  });
});

describe('DomainCard', () => {
  it('renders the domain, the Suggested rating + reason, and a rating select with a way to accept', () => {
    const html = renderToStaticMarkup(h(DomainCard, {
      domain: CERTAINTY_DOMAINS.find((d) => d.key === 'inconsistency'),
      rating: 'not_serious',                       // differs from the suggestion → accept button shows
      note: '',
      suggestion: OUTCOME.suggestions.inconsistency,
      informed: informedForDomain('inconsistency', OUTCOME.meta, OUTCOME.robSummary),
      locked: false,
      onRate: () => {}, onNote: () => {}, onAccept: () => {},
    }));
    expect(html).toContain('Inconsistency');
    expect(html).toContain('Suggested');            // suggestion clearly labelled
    expect(html).toContain('Serious');              // suggested rating label
    expect(html).toContain('I²');                   // the reason text
    expect(html).toContain('<select');              // a rating select is present
    expect(html).toContain('Use suggestion');       // human confirmation, never auto-applied
    expect(html).toContain('I² = 62%');             // informing data shown inline
  });

  it('disables editing and hides the accept action when the outcome is locked', () => {
    const html = renderToStaticMarkup(h(DomainCard, {
      domain: CERTAINTY_DOMAINS.find((d) => d.key === 'rob'),
      rating: 'serious', note: '',
      suggestion: OUTCOME.suggestions.rob,
      informed: informedForDomain('rob', OUTCOME.meta, OUTCOME.robSummary),
      locked: true,
      onRate: () => {}, onNote: () => {}, onAccept: () => {},
    }));
    expect(html).toContain('disabled');             // select + note input disabled
    expect(html).not.toContain('Use suggestion');   // no writes while locked
  });
});

describe('CertaintyReadout — driven by the real engine', () => {
  it('shows the level the engine computes from the working ratings', () => {
    const c = computeCertainty({ startLevel: 4, domains: { rob: 'serious', inconsistency: 'serious', imprecision: 'not_serious', publicationBias: 'serious' } });
    const html = renderToStaticMarkup(h(CertaintyReadout, { certainty: c, startLevel: OUTCOME.startLevel, provisional: true }));
    expect(html).toContain(c.level);                // e.g. "Very low" (4 − 3 → 1)
    expect(html).toContain('CERTAINTY OF EVIDENCE');
    expect(html).toContain('Provisional');
    // colour helper stays consistent with the engine level key.
    expect(typeof certaintyColor(c.levelKey)).toBe('string');
  });
});

describe('InformedPanel', () => {
  it('surfaces the pooled data that informs the whole outcome', () => {
    const html = renderToStaticMarkup(h(InformedPanel, { meta: OUTCOME.meta, robSummary: OUTCOME.robSummary }));
    expect(html).toContain('k = 6');
    expect(html).toContain('I²');
    expect(html).toContain('Egger');
    expect(html).toContain('Risk of bias');
  });
});

describe('AuditList', () => {
  it('renders actions, outcome and author; empty → a quiet note', () => {
    const entries = [
      { id: 'a1', outcomeKey: OUTCOME.outcomeKey, action: 'SAVE', changedBy: { name: 'Dr Lee' }, createdAt: '2026-06-01T10:00:00Z' },
      { id: 'a2', outcomeKey: OUTCOME.outcomeKey, action: 'LOCK', changedByName: 'Dr Lee', createdAt: '2026-06-02T10:00:00Z' },
    ];
    const html = renderToStaticMarkup(h(AuditList, { entries }));
    expect(html).toContain('SAVE');
    expect(html).toContain('LOCK');
    expect(html).toContain('Dr Lee');
    expect(renderToStaticMarkup(h(AuditList, { entries: [] }))).toContain('No changes recorded');
  });
});

describe('SofExportLinks', () => {
  it('links to the real Summary-of-Findings endpoint in every format', () => {
    const html = renderToStaticMarkup(h(SofExportLinks, { pid: 'p1' }));
    expect(html).toContain('/api/grade/projects/p1/sof?format=csv');
    expect(html).toContain('format=html');
    expect(html).toContain('format=json');
    expect(html).toContain('download=');
  });
});

describe('informedForDomain (pure)', () => {
  it('returns the right evidence per domain', () => {
    expect(informedForDomain('rob', OUTCOME.meta, OUTCOME.robSummary)).toContain('low');
    expect(informedForDomain('inconsistency', OUTCOME.meta, OUTCOME.robSummary)).toContain('I²');
    expect(informedForDomain('imprecision', OUTCOME.meta, OUTCOME.robSummary)).toContain('95% CI');
    expect(informedForDomain('publicationBias', OUTCOME.meta, OUTCOME.robSummary)).toContain('Egger');
    expect(informedForDomain('indirectness', OUTCOME.meta, OUTCOME.robSummary)).toContain('PICO');
  });
});

describe('no user-facing "AI" wording', () => {
  it('never renders the token "AI" across the panel leaves', () => {
    const parts = [
      renderToStaticMarkup(h(OutcomeSelector, { outcomes: [OUTCOME], selectedKey: OUTCOME.outcomeKey, onSelect: () => {} })),
      renderToStaticMarkup(h(DomainCard, { domain: CERTAINTY_DOMAINS[0], rating: '', note: '', suggestion: OUTCOME.suggestions.rob, informed: informedForDomain('rob', OUTCOME.meta, OUTCOME.robSummary), locked: false, onRate: () => {}, onNote: () => {}, onAccept: () => {} })),
      renderToStaticMarkup(h(CertaintyReadout, { certainty: OUTCOME.certainty, startLevel: OUTCOME.startLevel, provisional: true })),
      renderToStaticMarkup(h(InformedPanel, { meta: OUTCOME.meta, robSummary: OUTCOME.robSummary })),
      renderToStaticMarkup(h(SofExportLinks, { pid: 'p1' })),
    ].join('\n');
    expect(parts).not.toMatch(/\bAI\b/);
    expect(parts).not.toMatch(/artificial intelligence/i);
  });
});

describe('container SSR smoke', () => {
  it('renders its calm loading shell (effects do not run under SSR) without throwing', () => {
    const html = renderToStaticMarkup(h(GradeCertaintyPanel, { project: { id: 'p1', name: 'Demo' }, upd: () => {} }));
    expect(html).toContain('Loading GRADE');
    expect(html).not.toMatch(/\bAI\b/);
  });
});
