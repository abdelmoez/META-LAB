/**
 * decisionNavUi.test.jsx — 107.md §§6-7 UI contract for the screening workbench's
 * decision + navigation surfaces:
 *   §6 the Include / Exclude / Maybe controls sit BELOW the abstract, stay visible
 *      (sticky), state the current decision explicitly, and never leave an unscreened
 *      record looking half-selected;
 *   §7 the footer is honest about what lies past the last loaded study — loading,
 *      failed, or genuinely the end.
 *
 * SSR static markup (project convention; no jsdom, no React Testing Library).
 * Effects/clicks do not run under static rendering, so behaviour is asserted by
 * control presence + state attributes; the navigation decisions themselves are the
 * pure `moveIntent` / `nearestScrollTop` helpers covered by their own unit tests.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import { DecisionBar, RecordNavFooter, MiddleColumn, RecordRow } from '../../../src/frontend/screening/tabs/ScreeningTab.jsx';

const noop = () => {};

const bar = (over = {}) => r(h(DecisionBar, {
  decision: '', canScreen: true, onDecisionClick: noop, onUndo: noop,
  shortcutPrefs: undefined, saveMsg: '', decErr: '', ...over,
}));

const footer = (over = {}) => r(h(RecordNavFooter, {
  recordIndex: 0, recordCount: 50, totalCount: 50,
  hasMore: false, loadingMore: false, listError: null,
  onPrev: noop, onNext: noop, shortcutPrefs: undefined, ...over,
}));

/* ── §6 — always-visible decision controls ────────────────────────────────────── */

describe('DecisionBar (107.md §6)', () => {
  it('offers Include / Exclude / Maybe with their key hints, plus Undo', () => {
    const html = bar();
    expect(html).toContain('data-testid="screening-decision-bar"');
    expect(html).toContain('✓ Include');
    expect(html).toContain('✗ Exclude');
    expect(html).toContain('? Maybe');
    expect(html).toContain('↩ Undo');
    // Default bindings are surfaced on the buttons themselves (keyLabel uppercases).
    expect(html).toContain('>I</span>');
    expect(html).toContain('>E</span>');
    expect(html).toContain('>M</span>');
    expect(html).toContain('>U</span>');
  });

  it('is sticky to the bottom of the scroll container, opaque, and one compact row', () => {
    const html = bar();
    expect(html).toContain('position:sticky');
    expect(html).toContain('bottom:0');
    // Opaque surface + separation so the abstract cannot bleed through behind it.
    expect(html).toContain('background:var(--t-surf)');
    expect(html).toContain('border-top:1px solid');
    expect(html).toContain('flex-wrap:wrap');
  });

  it('states the current decision as a chip, in the past tense', () => {
    expect(bar({ decision: 'include' })).toContain('Included');
    expect(bar({ decision: 'exclude' })).toContain('Excluded');
    expect(bar({ decision: 'maybe' })).toContain('Maybe');
    expect(bar({ decision: '' })).toContain('Undecided');
    // …and machine-readably, for the e2e suite and for the row glyph to agree with.
    expect(bar({ decision: 'include' })).toContain('data-decision="include"');
    expect(bar({ decision: '' })).toContain('data-decision="undecided"');
  });

  it('marks exactly the active control as pressed — an unscreened record has none', () => {
    const undecided = bar({ decision: '' });
    expect(undecided).not.toContain('aria-pressed="true"');
    expect(undecided.match(/aria-pressed="false"/g)).toHaveLength(3);

    const included = bar({ decision: 'include' });
    expect(included.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(included.match(/aria-pressed="false"/g)).toHaveLength(2);
    // The active button carries the decision palette; nothing does when undecided.
    expect(included).toContain('background:var(--t-grn-bg)');
    expect(undecided).not.toContain('background:var(--t-grn-bg)');
  });

  it('changing a decision stays possible — Undo is live once something is set', () => {
    expect(bar({ decision: '' })).toMatch(/↩ Undo[\s\S]*?/);
    // Undo is the only disabled control on an undecided record…
    expect(bar({ decision: '' }).match(/disabled=""/g)).toHaveLength(1);
    // …and is enabled as soon as there is a decision to revert.
    expect(bar({ decision: 'exclude' })).not.toContain('disabled=""');
  });

  it('view-only access disables every control without hiding the current decision', () => {
    const html = bar({ canScreen: false, decision: 'include' });
    expect(html.match(/disabled=""/g)).toHaveLength(4); // 3 decisions + Undo
    expect(html).toContain('Included');
  });

  it('reports the save outcome politely, where the reviewer is looking', () => {
    expect(bar({ saveMsg: 'Saved' })).toContain('aria-live="polite"');
    expect(bar({ saveMsg: 'Saved · advanced to Final Review' })).toContain('Saved · advanced to Final Review');
    expect(bar({ decErr: 'Save failed' })).toContain('Save failed');
  });

  it('drops the key hints when the reviewer turned shortcuts off', () => {
    const html = bar({ shortcutPrefs: { enabled: false, keys: {} } });
    expect(html).toContain('✓ Include');
    expect(html).not.toContain('>I</span>');
    expect(html).not.toContain('>U</span>');
  });
});

describe('RecordRow decision indicator (107.md §6)', () => {
  const row = (decision, over = {}) => r(h(RecordRow, {
    record: {
      id: 'rec-1', title: 'A trial of something', authors: 'Doe J, Roe R', year: 2021,
      myOpened: true, reviewerDecisions: [],
      myDecision: decision ? { decision } : null, ...over,
    },
    selected: false, onClick: noop, blindMode: false, scoreInfo: null,
  }));

  it('carries one compact glyph per decision, addressable by record id', () => {
    expect(row('include')).toContain('✓');
    expect(row('exclude')).toContain('✗');
    expect(row('maybe')).toContain('?');
    expect(row(null)).toContain('·');          // undecided is a dot, not a blank
    expect(row('include')).toContain('data-record-id="rec-1"');
    expect(row('include')).toContain('data-selected="false"');
  });

  it('does not overcrowd an ordinary row — no status badges without a status', () => {
    const html = row('include');
    for (const badge of ['2nd review', 'Quorum', 'Sent', 'Disputed', 'Dup']) {
      expect(html).not.toContain(badge);
    }
  });
});

describe('MiddleColumn layout (107.md §6)', () => {
  const RECORD = {
    id: 'rec-1', title: 'A trial of something', abstract: 'BACKGROUND: A randomized controlled trial.',
    includeCount: 0, myDecision: null,
  };
  const mid = (over = {}) => r(h(MiddleColumn, {
    record: RECORD, loading: false, blindMode: false, canScreen: true, isLeader: false,
    inclusion: [], exclusion: [], showInclusion: true, showExclusion: true, pid: 'p1',
    decision: '', excReason: '', setExcReason: noop, notes: '', setNotes: noop,
    rating: 0, setRating: noop, reasons: [], setReasons: noop,
    labels: [], chosenLabels: [], toggleLabel: noop,
    onDecisionClick: noop, onUndo: noop, onSaveDetails: noop,
    saving: false, saveMsg: '', decErr: '',
    recordIndex: 0, recordCount: 8, totalCount: 8,
    hasMore: false, loadingMore: false, listError: null,
    onPrev: noop, onNext: noop, shortcutPrefs: undefined,
    ai: { enabled: false }, elig: { enabled: false }, ...over,
  }));

  it('places the decision bar BELOW the abstract, in normal flow', () => {
    const html = mid();
    const abstractAt = html.indexOf('data-testid="screening-abstract"');
    const barAt = html.indexOf('data-testid="screening-decision-bar"');
    expect(abstractAt).toBeGreaterThan(-1);
    expect(barAt).toBeGreaterThan(abstractAt);
    // The abstract is not wrapped by the bar (which would mean it could cover it).
    expect(html.indexOf('A randomized controlled trial.')).toBeLessThan(barAt);
  });

  it('keeps the detail fields (reason · labels · notes · rating) out of the sticky row', () => {
    const html = mid({ decision: 'exclude' });
    const barAt = html.indexOf('data-testid="screening-decision-bar"');
    expect(html.indexOf('Exclusion reason')).toBeLessThan(barAt);
    expect(html.indexOf('Optional screening notes…')).toBeLessThan(barAt);
    expect(html.indexOf('Quality rating')).toBeLessThan(barAt);
  });

  it('renders the decision bar and the record nav on every record', () => {
    const html = mid();
    expect(html).toContain('data-testid="screening-decision-bar"');
    expect(html).toContain('data-testid="screening-record-nav"');
  });
});

/* ── §7 — the end of the loaded window ────────────────────────────────────────── */

describe('RecordNavFooter (107.md §7)', () => {
  it('shows the position within the loaded window and the project total', () => {
    expect(footer({ recordIndex: 3, recordCount: 50, totalCount: 549 }))
      .toContain('4 / 50 (of 549)');
    expect(footer({ recordIndex: 3, recordCount: 8, totalCount: 8 })).toContain('4 / 8');
  });

  it('keeps Next live at the end of the loaded window when more records exist', () => {
    const html = footer({ recordIndex: 49, recordCount: 50, totalCount: 549, hasMore: true });
    expect(html).not.toContain('data-testid="screening-end-of-list"');
    // Only "← Previous" may be disabled here, and it is not (index 49).
    expect(html).not.toContain('disabled=""');
  });

  it('states the TRUE end of the list explicitly and stops offering Next', () => {
    const html = footer({ recordIndex: 49, recordCount: 50, totalCount: 50, hasMore: false });
    expect(html).toContain('data-testid="screening-end-of-list"');
    expect(html).toContain('End of list');
    expect(html.match(/disabled=""/g)).toHaveLength(1); // Next only — Previous is live
  });

  it('never claims the end while a page is still loading', () => {
    const html = footer({ recordIndex: 49, recordCount: 50, totalCount: 549, hasMore: true, loadingMore: true });
    expect(html).toContain('data-testid="screening-loading-more"');
    expect(html).toContain('Loading more…');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('End of list');
  });

  it('surfaces a failed batch without moving the reviewer', () => {
    const html = footer({ recordIndex: 49, recordCount: 50, totalCount: 549, hasMore: true, listError: 'Failed to load records' });
    expect(html).toContain('data-testid="screening-load-failed"');
    expect(html).toContain('Could not load more — retry from the list');
    expect(html).toContain('4');  // sanity: the counter still renders
    expect(html).not.toContain('End of list');
  });

  it('disables Previous on the first record and Next on a one-record list', () => {
    expect(footer({ recordIndex: 0, recordCount: 8, totalCount: 8 }).match(/disabled=""/g)).toHaveLength(1);
    expect(footer({ recordIndex: 0, recordCount: 1, totalCount: 1 }).match(/disabled=""/g)).toHaveLength(2);
  });
});
