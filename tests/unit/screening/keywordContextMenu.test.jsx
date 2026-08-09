/**
 * keywordContextMenu.test.jsx — 108.md §§18-21, §25. The right-click keyword menu and
 * the chip surfaces that open it.
 *
 * Two layers, matching the house split (DOM adapter thin, rules pure):
 *   · `canOpenKeywordMenu` is the whole §19 policy as one pure predicate, so "which
 *     keywords are deletable this way" is a table, not a comment;
 *   · the markup is SSR static-rendered (no jsdom / RTL, per the project convention).
 *     Effects and clicks do not run, so behaviour is asserted through the roles,
 *     testids, ARIA wiring and hit-target sizes that survive static rendering. The
 *     interactive parts (Escape, outside-click, arrow roving, the delete round trip)
 *     are covered by e2e/screening/keywordContextMenu.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import KeywordContextMenu, {
  canOpenKeywordMenu, DELETABLE_ORIGINS,
} from '../../../src/frontend/screening/components/KeywordContextMenu.jsx';
import { KeywordEditor, KeywordGroup } from '../../../src/frontend/screening/tabs/ScreeningTab.jsx';
import { KEYWORD_ORIGIN } from '../../../src/research-engine/screening/keywordModel.js';

const noop = () => {};

/* ── §19: which keywords get the fast delete ───────────────────────────────────── */

describe('canOpenKeywordMenu (108.md §19)', () => {
  it('offers the menu for terms the user added or accepted', () => {
    expect(canOpenKeywordMenu({ origin: KEYWORD_ORIGIN.MANUAL, canEdit: true })).toBe(true);
    expect(canOpenKeywordMenu({ origin: KEYWORD_ORIGIN.ACCEPTED, canEdit: true })).toBe(true);
    expect(DELETABLE_ORIGINS).toEqual([KEYWORD_ORIGIN.MANUAL, KEYWORD_ORIGIN.ACCEPTED]);
  });

  it('never offers it for a shared DEFAULT term', () => {
    // Deleting one materialises the whole seed list and flips keywordMeta.seeded — a
    // structural change that keeps its deliberate route (the chip ×).
    expect(canOpenKeywordMenu({ origin: KEYWORD_ORIGIN.DEFAULT, canEdit: true })).toBe(false);
  });

  it('never offers it to someone who may not edit keyword lists', () => {
    expect(canOpenKeywordMenu({ origin: KEYWORD_ORIGIN.MANUAL, canEdit: false })).toBe(false);
    expect(canOpenKeywordMenu({ origin: KEYWORD_ORIGIN.ACCEPTED, canEdit: false })).toBe(false);
  });

  it('is closed by default for junk input', () => {
    expect(canOpenKeywordMenu()).toBe(false);
    expect(canOpenKeywordMenu({})).toBe(false);
    expect(canOpenKeywordMenu({ origin: 'criteria-suggestion', canEdit: true })).toBe(false);
  });
});

/* ── the menu markup ───────────────────────────────────────────────────────────── */

const menu = (over = {}) => r(h(KeywordContextMenu, {
  term: 'drug-resistant epilepsy', list: 'include', origin: KEYWORD_ORIGIN.MANUAL,
  x: 120, y: 240, onDelete: noop, onClose: noop, ...over,
}));

describe('KeywordContextMenu markup (§21/§25)', () => {
  it('is a real menu with a real menuitem', () => {
    const html = menu();
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('data-testid="screening-keyword-menu"');
    expect(html).toContain('data-testid="screening-keyword-menu-delete"');
    // Only menuitem children — no stray presentational rows inside role="menu".
    expect((html.match(/role="menuitem"/g) || []).length).toBe(1);
  });

  it('names the menu and the action for assistive tech', () => {
    const html = menu();
    expect(html).toContain('aria-label="Keyword actions for drug-resistant epilepsy"');
    expect(html).toContain('aria-label="Delete keyword drug-resistant epilepsy"');
  });

  it('shows which keyword and which list is about to be deleted', () => {
    const html = menu();
    expect(html).toContain('Delete keyword');
    expect(html).toContain('drug-resistant epilepsy · inclusion');
    expect(menu({ list: 'exclude' })).toContain('drug-resistant epilepsy · exclusion');
  });

  it('carries the term/list/origin as queryable attributes', () => {
    const html = menu({ origin: KEYWORD_ORIGIN.ACCEPTED });
    expect(html).toContain('data-term="drug-resistant epilepsy"');
    expect(html).toContain('data-list="include"');
    expect(html).toContain(`data-origin="${KEYWORD_ORIGIN.ACCEPTED}"`);
  });

  it('stamps the screening modal marker so Ctrl/Cmd+I·E stand down while it is open', () => {
    expect(menu()).toContain('data-screening-modal="true"');
  });

  it('positions itself at the pointer, fixed and above the snackbar layer', () => {
    const html = menu({ x: 120, y: 240 });
    expect(html).toContain('position:fixed');
    expect(html).toContain('left:120px');
    expect(html).toContain('top:240px');
    expect(html).toContain('z-index:4000');
  });

  it('gives the danger item a usable hit target', () => {
    expect(menu()).toContain('min-height:34px');
  });

  it('disables the item while a delete is in flight', () => {
    expect(menu({ busy: true })).toContain('disabled=""');
    expect(menu()).not.toContain('disabled=""');
  });
});

/* ── the chip surfaces that open it ────────────────────────────────────────────── */

const editorHtml = (over = {}) => r(h(KeywordEditor, {
  pid: 'p1', isLeader: true, canEditKeywords: true,
  inclusion: ['drug-resistant epilepsy', 'RCT'],
  exclusion: ['case report'],
  inclSource: { 'drug-resistant epilepsy': KEYWORD_ORIGIN.MANUAL, RCT: KEYWORD_ORIGIN.DEFAULT },
  exclSource: { 'case report': KEYWORD_ORIGIN.ACCEPTED },
  runKeywordOp: noop, onKeywordMenu: noop, ...over,
}));

describe('KeywordEditor chips (§21 testids + touch targets)', () => {
  it('stamps a stable testid and the term/origin/list on every chip', () => {
    const html = editorHtml();
    expect((html.match(/data-testid="screening-keyword-chip"/g) || []).length).toBe(3);
    expect(html).toContain('data-term="drug-resistant epilepsy"');
    expect(html).toContain(`data-origin="${KEYWORD_ORIGIN.MANUAL}"`);
    expect(html).toContain('data-list="include"');
    expect(html).toContain('data-list="exclude"');
  });

  it('makes a menu-owning chip keyboard reachable, and leaves a default chip alone', () => {
    const html = editorHtml();
    // manual + accepted chips are focusable and advertise the menu…
    expect((html.match(/aria-haspopup="menu"/g) || []).length).toBe(2);
    expect(html).toContain('aria-label="drug-resistant epilepsy — keyword actions"');
    expect(html).toContain('class="sift-kwchip"');
    // …the DEFAULT chip is not, so right-click there keeps the browser menu.
    expect(html).not.toContain('aria-label="RCT — keyword actions"');
  });

  it('enlarges the move/remove buttons to a real tap target', () => {
    const html = editorHtml();
    expect(html).toContain('data-testid="screening-keyword-chip-remove"');
    expect(html).toContain('data-testid="screening-keyword-chip-move"');
    expect(html).toContain('aria-label="Remove drug-resistant epilepsy"');
    expect(html).toContain('aria-label="Move drug-resistant epilepsy to exclusion"');
    // 6 buttons × (min-width + min-height) — the 107 chip had none of either.
    expect((html.match(/min-width:24px/g) || []).length).toBe(6);
    expect((html.match(/min-height:24px/g) || []).length).toBe(6);
  });

  it('renders no chip controls at all for a viewer who may not edit', () => {
    const html = editorHtml({ canEditKeywords: false });
    expect(html).toContain('data-testid="screening-keyword-chip"');
    expect(html).not.toContain('screening-keyword-chip-remove');
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

describe('KeywordGroup rows — the ALWAYS-VISIBLE keyword surface (§18)', () => {
  const groupHtml = (over = {}) => r(h(KeywordGroup, {
    title: 'Include keywords', accent: '#0a0', list: 'include',
    terms: ['drug-resistant epilepsy', 'RCT'],
    counts: { 'drug-resistant epilepsy': 4 },
    sourceByTerm: { 'drug-resistant epilepsy': KEYWORD_ORIGIN.MANUAL, RCT: KEYWORD_ORIGIN.DEFAULT },
    selected: [], setSelected: noop,
    canEditKeywords: true, onKeywordMenu: noop, ...over,
  }));

  it('carries the same term/origin/list attributes as the editor chips', () => {
    const html = groupHtml();
    expect((html.match(/data-testid="screening-keyword-row"/g) || []).length).toBe(2);
    expect(html).toContain('data-term="drug-resistant epilepsy"');
    expect(html).toContain(`data-origin="${KEYWORD_ORIGIN.MANUAL}"`);
    expect(html).toContain('data-list="include"');
  });

  it('marks only the menu-owning rows, so a default term keeps the browser menu', () => {
    const html = groupHtml();
    expect((html.match(/data-menu="true"/g) || []).length).toBe(1);
  });

  it('marks nothing when the viewer may not edit keyword lists', () => {
    expect(groupHtml({ canEditKeywords: false })).not.toContain('data-menu="true"');
  });

  it('still renders the filter checkboxes it has always rendered', () => {
    const html = groupHtml();
    expect((html.match(/type="checkbox"/g) || []).length).toBe(2);
    expect(html).toContain('INCLUDE KEYWORDS');
  });
});
