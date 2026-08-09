/**
 * keywordSuggestionsUi.test.jsx — 107.md §2/§3 UI contract for the keyword review
 * surface: suggestions are visually separate from active keywords, every pending
 * term offers Accept AND Reject, conflicts are flagged for review with three
 * explicit resolutions, and the abstract-selection feedback offers a real Undo.
 *
 * SSR static markup (project convention; no jsdom, no React Testing Library).
 * Effects/clicks do not run under static rendering, so behaviour is asserted by
 * control presence — the click handlers themselves are pure reducer ops covered by
 * keywordModel.test.js.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import { SuggestedKeywords } from '../../../src/frontend/screening/tabs/ScreeningTab.jsx';
import KeywordSnackbar from '../../../src/frontend/screening/components/KeywordSnackbar.jsx';

const noop = () => {};
const base = {
  open: true, onToggle: noop, runKeywordOp: noop, error: '',
  pendingIncl: [], pendingExcl: [], conflicts: [],
  counts: { include: {}, exclude: {} },
};

describe('SuggestedKeywords', () => {
  it('is a visually distinct area, labelled and counted', () => {
    const html = r(h(SuggestedKeywords, { ...base, pendingIncl: ['drug-resistant epilepsy'], pendingExcl: ['case reports'] }));
    expect(html).toContain('data-testid="screening-keyword-suggestions"');
    expect(html).toContain('Suggested · 2');
    expect(html).toContain('FOR INCLUSION');
    expect(html).toContain('FOR EXCLUSION');
  });

  it('states that suggestions are not active until reviewed', () => {
    const html = r(h(SuggestedKeywords, { ...base, pendingIncl: ['epilepsy'] }));
    expect(html).toContain('do not highlight,');
    expect(html).toContain('until you accept them');
  });

  it('offers Accept and Reject per pending term, with its article count', () => {
    const html = r(h(SuggestedKeywords, {
      ...base, pendingIncl: ['drug-resistant epilepsy'],
      counts: { include: { 'drug-resistant epilepsy': 17 }, exclude: {} },
    }));
    expect(html).toContain('drug-resistant epilepsy');
    expect(html).toContain('>Accept</button>');
    expect(html).toContain('>Reject</button>');
    expect(html).toContain('>17</span>');
  });

  it('flags a conflicting concept for review with all three resolutions', () => {
    const html = r(h(SuggestedKeywords, {
      ...base,
      conflicts: [{ term: 'epilepsy', reason: 'Appears in both inclusion and exclusion criteria — the polarity is ambiguous.' }],
    }));
    expect(html).toContain('data-testid="screening-keyword-conflicts"');
    expect(html).toContain('Needs review — appears in both inclusion and exclusion contexts.');
    expect(html).toContain('>Add to inclusion</button>');
    expect(html).toContain('>Add to exclusion</button>');
    expect(html).toContain('>Dismiss</button>');
    expect(html).toContain('epilepsy');
  });

  it('collapsed shows only the summary, never the per-term controls', () => {
    const html = r(h(SuggestedKeywords, { ...base, open: false, pendingIncl: ['epilepsy'] }));
    expect(html).toContain('Suggested · 1');
    expect(html).not.toContain('>Accept</button>');
  });

  it('surfaces an op error inline', () => {
    const html = r(h(SuggestedKeywords, { ...base, pendingIncl: ['epilepsy'], error: 'Could not update keywords' }));
    expect(html).toContain('Could not update keywords');
  });
});

describe('KeywordSnackbar', () => {
  it('renders a polite confirmation with an Undo action', () => {
    const html = r(h(KeywordSnackbar, { message: 'Added “epilepsy” to inclusion keywords.', onUndo: noop, onDismiss: noop }));
    expect(html).toContain('data-testid="screening-keyword-snackbar"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="screening-keyword-undo"');
    expect(html).toContain('Added “epilepsy” to inclusion keywords.');
  });

  it('omits Undo when there is nothing to undo (e.g. the duplicate note)', () => {
    const html = r(h(KeywordSnackbar, { message: 'Already in inclusion keywords: “epilepsy”', onDismiss: noop }));
    expect(html).toContain('Already in inclusion keywords');
    expect(html).not.toContain('screening-keyword-undo');
  });

  it('renders nothing without a message', () => {
    expect(r(h(KeywordSnackbar, { message: '' }))).toBe('');
  });
});
