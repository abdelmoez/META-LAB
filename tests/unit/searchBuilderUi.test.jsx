/**
 * searchBuilderUi.test.jsx — 85.md A2, reworked by 97.md and 98.md. SSR contract
 * tests (house pattern: renderToStaticMarkup, no jsdom, effects never run → no
 * network) for the extracted Search Builder leaves powering the redesigned
 * Select & Build Key Terms stage, plus the pure uiShared helpers and the pinned
 * renderTerm compiler seam.
 *
 * 98.md contract changes pinned here:
 *  - LAYOUT (§9): ConceptNavigator is DELETED (master-detail retired) — every
 *    concept renders an ActiveConceptPanel CARD on the horizontal board (compact
 *    inactive cards vs the active working card; drag handle + suggestion badge
 *    ride the card header; aria-label "Concept group: X");
 *  - TERMINOLOGY (§8): the ONE user-facing noun is Concept / concept group
 *    ("Concept N" ordinals, "+ Add concept", exact-duplicate copy names concepts);
 *  - SUGGESTIONS (§11): SuggestionsDisclosure is CONTROLLED (open/onToggleOpen)
 *    — children mount ONLY while open; the toggle reads "Show suggestions (N)";
 *  - BADGES (§10): controlled chips surface "no narrower terms" (noExplode) and
 *    "+N entry terms" micro-badges;
 *  - RENDER PREVIEW (§12): the legacy in-file renderer is DELETED — renderTerm
 *    routes a one-term strategy through compileStrategy, so expectations match
 *    the REAL compiler output (Embase free text is ':ti,ab'; an unmatched
 *    controlled term compiles per each database's own fallback rules);
 *  - the Regenerate confirmation dialog carries the §8 copy (PICO mention gone).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { termDisplay, termMicroBadges, conceptAccent, opExplainer } from '../../src/features/searchBuilder/components/uiShared.js';
import SaveStatusIndicator from '../../src/features/searchBuilder/components/SaveStatusIndicator.jsx';
import UndoSnackbar from '../../src/features/searchBuilder/components/UndoSnackbar.jsx';
import ActiveConceptPanel from '../../src/features/searchBuilder/components/ActiveConceptPanel.jsx';
import ConceptWorkspaceFrame from '../../src/features/searchBuilder/components/ConceptWorkspaceFrame.jsx';
import TermChipRow, { EXACT_DUP_TOOLTIP } from '../../src/features/searchBuilder/components/TermChipRow.jsx';
import TermEditorPopover from '../../src/features/searchBuilder/components/TermEditorPopover.jsx';
import AddTermBox from '../../src/features/searchBuilder/components/AddTermBox.jsx';
import SuggestionsDisclosure from '../../src/features/searchBuilder/components/SuggestionsDisclosure.jsx';
import SearchMeaningPanel from '../../src/features/searchBuilder/components/SearchMeaningPanel.jsx';
import MeshDetailsPopover from '../../src/features/searchBuilder/components/MeshDetailsPopover.jsx';
import { renderTerm, RegenerateDialog } from '../../src/features/searchBuilder/SearchBuilderTab.jsx';
import { CB_SERIES } from '../../src/frontend/theme/tokens.js';

const r = (el) => renderToStaticMarkup(el);

/* ── fixtures ─────────────────────────────────────────────────────────────── */
const VOCAB = { mesh: 'Diabetes Mellitus, Type 2', meshUI: 'D003924', tree: 'C18.452.394.750.149', scope: 'A subclass of diabetes mellitus.', synonyms: ['T2DM', 'NIDDM'], children: ['Diabetes Mellitus, Lipoatrophic'] };
const controlled = { id: 't1', text: 't2dm', type: 'controlled', field: 'tiab', source: 'user_added', vocab: VOCAB };
const freetext = { id: 't2', text: 'metformin', type: 'freetext', field: 'tiab', source: 'user_added' };
const unmatched = { id: 't3', text: 'xyzzy heading', type: 'controlled', field: 'tiab', source: 'user_added', vocab: null };
const disabledTerm = { id: 't4', text: 'insulin', type: 'freetext', field: 'tiab', source: 'user_added', disabled: true };
const P = { id: 'cP', label: 'Population', picoField: 'P', field: 'Population', op: 'AND', terms: [controlled, freetext] };
const I = { id: 'cI', label: 'Intervention / Exposure', picoField: 'I', field: 'Intervention / Exposure', op: 'AND', terms: [{ id: 't9', text: 'metformin', type: 'freetext', field: 'tiab' }] };

/* ── uiShared (pure) ──────────────────────────────────────────────────────── */
describe('uiShared — pure display helpers', () => {
  it('termDisplay: controlled+vocab shows the SEARCHED descriptor with the typed text secondary', () => {
    const d = termDisplay(controlled);
    expect(d.main).toBe('Diabetes Mellitus, Type 2');
    expect(d.kind).toBe('controlled');
    expect(d.secondary).toBe('t2dm');
    expect(d.unmatched).toBe(false);
  });
  it('termDisplay: controlled WITHOUT vocab is an explicit unmatched state', () => {
    const d = termDisplay(unmatched);
    expect(d.main).toBe('xyzzy heading');
    expect(d.unmatched).toBe(true);
  });
  it('termDisplay: freetext shows the term text; secondary hidden when texts match', () => {
    expect(termDisplay(freetext)).toEqual({ main: 'metformin', kind: 'freetext', secondary: null, unmatched: false });
    const same = termDisplay({ ...controlled, text: 'Diabetes Mellitus, Type 2' });
    expect(same.secondary).toBeNull();
  });
  it('termMicroBadges: field scope (ALWAYS for free text — 96.md D13.5) / truncation / phrase / provenance / disabled', () => {
    expect(termMicroBadges({ type: 'freetext', field: 'ti', text: 'x' }).map((b) => b.key)).toEqual(['field']);
    expect(termMicroBadges({ type: 'freetext', field: 'all', text: 'x' })[0].label).toBe('everywhere');
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x' })[0].label).toBe('title/abstract');
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x', truncate: true }).map((b) => b.key)).toEqual(['field', 'truncate']);
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'heart attack', phrase: true }).map((b) => b.key)).toEqual(['field', 'phrase']);
    expect(termMicroBadges(disabledTerm).map((b) => b.key)).toEqual(['field', 'source', 'off']);
  });
  it('termMicroBadges: provenance — suggested (synonym/legacy auto) vs manual (96.md spec C)', () => {
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x', source: 'synonym' }).map((b) => b.label)).toContain('suggested');
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x', source: 'pico_auto' }).map((b) => b.label)).toContain('suggested');
    expect(termMicroBadges(freetext).map((b) => b.label)).toContain('manual'); // user_added
    expect(termMicroBadges({ type: 'controlled', text: 'x', vocab: { mesh: 'X' } })).toEqual([]);
  });
  it('98.md §10 — controlled chips badge no-explode + the mapped entry-term count', () => {
    // Default (exploded, no synonyms) stays badge-less — only the EXCEPTION is marked.
    expect(termMicroBadges({ type: 'controlled', text: 'x', vocab: { mesh: 'X' } })).toEqual([]);
    // noExplode → the "no narrower terms" marker.
    expect(termMicroBadges({ type: 'controlled', text: 'x', vocab: { mesh: 'X' }, noExplode: true }))
      .toEqual([{ key: 'noexp', label: 'no narrower terms' }]);
    // mapped entry terms ride along with their count (full list lives in the popover).
    expect(termMicroBadges({ type: 'controlled', text: 't2dm', vocab: VOCAB }))
      .toEqual([{ key: 'entryCount', label: '+2 entry terms' }]);
    expect(termMicroBadges({ type: 'controlled', text: 'x', vocab: { mesh: 'X', synonyms: ['only one'] } }))
      .toEqual([{ key: 'entryCount', label: '+1 entry term' }]); // singular
    // both together, in order; blank synonym strings don't count
    expect(termMicroBadges({ type: 'controlled', text: 'x', vocab: { mesh: 'X', synonyms: ['a', ' ', 'b'] }, noExplode: true }).map((b) => b.key))
      .toEqual(['noexp', 'entryCount']);
    // an UNMATCHED controlled term gets neither (it is a warning chip instead)
    expect(termMicroBadges({ type: 'controlled', text: 'x', noExplode: true })).toEqual([]);
  });
  it('conceptAccent cycles the CVD-safe Okabe–Ito series', () => {
    expect(conceptAccent(0)).toBe(CB_SERIES[0]);
    expect(conceptAccent(CB_SERIES.length)).toBe(CB_SERIES[0]);
    expect(conceptAccent(-1)).toBe(CB_SERIES[0]); // junk-safe
  });
  it('opExplainer explains both joins in plain language', () => {
    expect(opExplainer('OR')).toContain('EITHER');
    expect(opExplainer('AND')).toContain('BOTH');
  });
});

/* ── renderTerm — the ONE compiler code path (98.md §12) ──────────────────── */
describe('renderTerm — routes through compileStrategy (the compiled panels\' exact output)', () => {
  it('freetext: PubMed [tiab]; Embase uses the REAL :ti,ab suffix (the legacy in-file :ab,ti is gone)', () => {
    expect(renderTerm(freetext, 'pubmed')).toBe('metformin[tiab]');
    expect(renderTerm(freetext, 'embase')).toBe('metformin:ti,ab');
  });
  it('a MATCHED controlled term renders real controlled syntax per database', () => {
    expect(renderTerm(controlled, 'pubmed')).toBe('"Diabetes Mellitus, Type 2"[Mesh]');
    expect(renderTerm(controlled, 'cochrane')).toBe('[mh "Diabetes Mellitus, Type 2"]');
  });
  it('unmatched controlled falls back per EACH compiler\'s own rules (preview === compile)', () => {
    // PubMed/Cochrane render the typed text as the heading (counted unmapped by the
    // compiler; the chip itself carries the explicit "no MeSH match" warning state).
    expect(renderTerm(unmatched, 'pubmed')).toBe('"xyzzy heading"[Mesh]');
    expect(renderTerm(unmatched, 'cochrane')).toBe('[mh "xyzzy heading"]');
    // Embase has an explicit no-Emtree fallback: lowercased quoted free text, never /exp.
    expect(renderTerm(unmatched, 'embase')).toBe("'xyzzy heading':ti,ab");
    expect(renderTerm(unmatched, 'embase')).not.toContain('/exp');
  });
  it('previews the term even while it is DISABLED (the editor shows what enabling gives)', () => {
    expect(renderTerm(disabledTerm, 'pubmed')).toBe('insulin[tiab]');
  });
  it('blank/junk terms preview as an empty string', () => {
    expect(renderTerm(null, 'pubmed')).toBe('');
    expect(renderTerm({ text: '   ' }, 'pubmed')).toBe('');
  });
});

/* ── SaveStatusIndicator ──────────────────────────────────────────────────── */
describe('SaveStatusIndicator — honest save state (audit C2)', () => {
  it('defaults to Saved (SSR-safe) with the pinned testid + polite live region', () => {
    const html = r(h(SaveStatusIndicator, {}));
    expect(html).toContain('data-testid="sb-save-status"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Saved');
  });
  it('saving → "Saving…"; error → "Save failed" + a Retry button', () => {
    expect(r(h(SaveStatusIndicator, { state: 'saving' }))).toContain('Saving…');
    const err = r(h(SaveStatusIndicator, { state: 'error', onRetry: () => {} }));
    expect(err).toContain('Save failed');
    expect(err).toContain('Retry');
  });
});

/* ── UndoSnackbar ─────────────────────────────────────────────────────────── */
describe('UndoSnackbar — feature-local undo affordance (audit C4)', () => {
  it('renders nothing without a message', () => {
    expect(r(h(UndoSnackbar, { message: null }))).toBe('');
  });
  it('message → polite status card with Undo + labelled dismiss', () => {
    const html = r(h(UndoSnackbar, { message: 'Removed "diabetes"', onUndo: () => {}, onDismiss: () => {} }));
    expect(html).toContain('data-testid="sb-undo"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Removed &quot;diabetes&quot;');
    expect(html).toContain('>Undo</button>');
    expect(html).toContain('aria-label="Dismiss"');
  });
  it('97.md Phase 4 — the regenerate toast composes to "Search strategy regenerated. Undo"', () => {
    const html = r(h(UndoSnackbar, { message: 'Search strategy regenerated.', onUndo: () => {}, onDismiss: () => {} }));
    expect(html).toContain('Search strategy regenerated.');
    expect(html).toContain('>Undo</button>');
  });
});

/* ── ActiveConceptPanel — the board CARD (98.md §9; ConceptNavigator deleted) ── */
describe('ActiveConceptPanel — board card modes (98.md §9)', () => {
  it('ACTIVE card: pinned testid, aria-current, "Concept N" ordinal + the concept-group aria-label', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', active: true }, h('div', { 'data-testid': 'child-slot' })));
    expect(html).toContain('data-testid="sb-active-concept"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="Concept group: Population"');
    expect(html).toContain('data-testid="sb-group-ordinal"');
    expect(html).toContain('Concept 1'); // 98.md §8 — the ordinal uses the ONE noun
    expect(html).toContain('aria-label="Concept name: Population"');
    expect(html).toContain('data-testid="sb-mesh-coverage"');
    expect(html).toContain('has MeSH term');
    expect(html).toContain('data-testid="child-slot"');
  });
  it('COMPACT (inactive) card: testId override, no coverage badge, no sourcePhrase row', () => {
    const withPhrase = { ...P, sourcePhrase: 'diabetes' };
    const html = r(h(ActiveConceptPanel, {
      concept: withPhrase, conceptIndex: 1, status: 'ready', compact: true, onActivate: () => {}, testId: 'sb-concept-card',
    }));
    expect(html).toContain('data-testid="sb-concept-card"');
    expect(html).not.toContain('sb-active-concept');
    expect(html).not.toContain('aria-current');
    expect(html).toContain('Concept 2');
    expect(html).not.toContain('sb-mesh-coverage');    // compact header stays chip-focused
    expect(html).not.toContain('sb-source-phrase');    // active-card-only row
  });
  it('the drag handle renders for editors only (98.md §9 — was the navigator pill)', () => {
    const withHandle = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', dragHandle: {} }));
    expect(withHandle).toContain('data-testid="sb-card-drag-handle"');
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', dragHandle: {}, readOnly: true })))
      .not.toContain('sb-card-drag-handle');
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready' })))
      .not.toContain('sb-card-drag-handle');
  });
  it('the suggestion-count badge rides the card header (never colour-only: count + title)', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', suggestionCount: 3 }));
    expect(html).toContain('data-testid="sb-nav-suggestion-dot"');
    expect(html).toContain('3 suggestions to review');
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', suggestionCount: 0 })))
      .not.toContain('sb-nav-suggestion-dot');
  });
  it('a hovered chip/group drop target draws the ring (prop-driven, SSR-visible)', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', isDropTarget: true }));
    expect(html).toMatch(/outline:3px solid/);
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready' }))).not.toMatch(/outline:3px solid/);
  });
  it('98.md §5 — the OR/AND explainer ¶ renders ONLY on the active card in Beginner Mode', () => {
    const beginnerActive = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', beginner: true }));
    expect(beginnerActive).toContain('any one of them counts as a match');   // within-group OR is explicit
    expect(beginnerActive).toContain('combined with <strong>AND</strong>');  // between-group AND is explicit
    // default (professional) mode and compact cards stay copy-free
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready' }))).not.toContain('counts as a match');
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', beginner: true, compact: true }))).not.toContain('counts as a match');
  });
  it('a concept with terms but no matched MeSH term reads "no MeSH term yet"', () => {
    const html = r(h(ActiveConceptPanel, { concept: I, conceptIndex: 1, status: 'needs-review' }));
    expect(html).toContain('no MeSH term yet');
  });
  it('97.md — the "Legacy group" badge is GONE; picoField groups render like any other', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready' }));
    expect(html).not.toContain('Legacy group');
    expect(html).not.toContain('Subject heading');
  });
  it('97.md Phase 13 — the mesh-suggested status pill reads "MeSH term suggested" (old wording killed)', () => {
    const html = r(h(ActiveConceptPanel, { concept: I, conceptIndex: 1, status: 'mesh-suggested' }));
    expect(html).toContain('MeSH term suggested');
    expect(html).not.toContain('Subject heading suggested');
  });
});

/* ── 99.md — dynamic expand/collapse contracts on the board card ─────────────
   The chevron is the card's DISCLOSURE control (real button; aria-expanded +
   aria-controls point at the stable body wrapper), the compact header names its
   size ("N terms"), and the hover/motion affordances ride CSS classes so
   prefers-reduced-motion can remove them wholesale in the tab stylesheet. */
describe('ActiveConceptPanel — 99.md expand/collapse disclosure contracts', () => {
  it('COMPACT card: chevron button with aria-expanded="false" + aria-controls → the body id', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', compact: true, onActivate: () => {}, testId: 'sb-concept-card' }));
    expect(html).toContain('data-testid="sb-card-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="sb-card-body-cP"');
    expect(html).toContain('id="sb-card-body-cP"');
    expect(html).toContain('aria-label="Expand Population for editing"');
    expect(html).toContain('data-open="false"');
  });
  it('the collapsed disclosure region is EMPTY — aria-expanded="false" never describes visible content', () => {
    // The chips preview stays visible while collapsed, so it must sit OUTSIDE the
    // region the chevron claims to control; the region itself renders empty.
    const html = r(h(ActiveConceptPanel, {
      concept: P, conceptIndex: 0, status: 'ready', compact: true, onActivate: () => {}, testId: 'sb-concept-card',
    }, h('div', { 'data-testid': 'chip-preview' })));
    expect(html).toContain('data-testid="chip-preview"');       // preview renders…
    expect(html).toMatch(/id="sb-card-body-cP"[^>]*><\/div>/);  // …but the region is empty
    // Expanded, the same children live INSIDE the region.
    const open = r(h(ActiveConceptPanel, {
      concept: P, conceptIndex: 0, status: 'ready', active: true, onCollapse: () => {},
    }, h('div', { 'data-testid': 'work-surfaces' })));
    expect(open).toMatch(/id="sb-card-body-cP"[\s\S]*data-testid="work-surfaces"/);
  });
  it('the focusable compact card carries a programmatic operability hint (it is not a button role)', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', compact: true, onActivate: () => {}, testId: 'sb-concept-card' }));
    expect(html).toContain('aria-describedby="sb-card-body-cP-hint"');
    expect(html).toContain('Press Enter to open this concept for editing.');
    expect(html).not.toContain('role="button"'); // nested interactive children forbid it
    // The active card is not a tab stop and carries no hint.
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', active: true, onCollapse: () => {} })))
      .not.toContain('aria-describedby');
  });
  it('the chevron meets the 24×24 pointer-target minimum (WCAG 2.2 SC 2.5.8)', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', active: true, onCollapse: () => {} }));
    expect(html).toMatch(/min-height:24px/);
    expect(html).toMatch(/min-width:24px/);
  });
  it('ACTIVE card: chevron flips to aria-expanded="true" with collapse labelling', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', active: true, onCollapse: () => {} }));
    expect(html).toContain('data-testid="sb-card-toggle"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Collapse Population"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('sb-card-body-enter'); // the soft body entrance class rides the active state
  });
  it('no toggle callbacks → no chevron (the legacy single-panel mount stays chevron-free)', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', active: true }));
    expect(html).not.toContain('sb-card-toggle');
  });
  it('COMPACT card header names its size — "N terms" with MeSH presence in the title', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', compact: true, onActivate: () => {}, testId: 'sb-concept-card' }));
    expect(html).toContain('data-testid="sb-term-count"');
    expect(html).toContain('2 terms');
    expect(html).toContain('includes a MeSH term'); // P holds a matched controlled term
    // the active card shows the chips themselves — no duplicate count badge
    expect(r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', active: true, onCollapse: () => {} }))).not.toContain('sb-term-count');
    // an EMPTY compact card keeps its "No terms yet" body instead of a "0 terms" badge
    expect(r(h(ActiveConceptPanel, { concept: { ...P, terms: [] }, conceptIndex: 0, status: 'empty', compact: true, onActivate: () => {}, testId: 'sb-concept-card' }))).not.toContain('sb-term-count');
  });
  it('the hover/motion affordances ride the sb-card-shell class + data-compact attribute', () => {
    const compact = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', compact: true, onActivate: () => {}, testId: 'sb-concept-card' }));
    expect(compact).toContain('sb-card-shell');
    expect(compact).toContain('data-compact="true"');
    const active = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', active: true, onCollapse: () => {} }));
    expect(active).toContain('data-compact="false"');
  });
  it('the chevron is a VIEW control: present for read-only viewers too', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready', compact: true, readOnly: true, onActivate: () => {}, testId: 'sb-concept-card' }));
    expect(html).toContain('data-testid="sb-card-toggle"');
  });
});

/* ── TermChipRow ──────────────────────────────────────────────────────────── */
describe('TermChipRow — chips show the SEARCHED term + explicit OR separators', () => {
  const concept = { ...P, terms: [controlled, freetext, unmatched, disabledTerm] };
  const html = r(h(TermChipRow, {
    concept, beginner: true,
    editingTermId: null, onOpenEditor: () => {}, onRemove: () => {}, renderEditor: () => null,
  }));
  it('controlled chip = the exact "Descriptor"[MeSH] form; typed text preserved as title', () => {
    expect(html).toContain('Diabetes Mellitus, Type 2');
    expect(html).toContain('[MeSH]');
    expect(html).toContain('title="You typed: t2dm"');
    expect(html).not.toContain('[tiab]'); // raw field syntax still never leaks onto chips
  });
  it('controlled chips expose a keyboard-reachable MeSH-details affordance', () => {
    expect(html).toContain('aria-label="MeSH details for Diabetes Mellitus, Type 2"');
  });
  it('unmatched controlled term is an explicit warning chip (MeSH wording)', () => {
    expect(html).toContain('no MeSH match — will not match');
    expect(html).not.toContain('subject heading');
  });
  it('every chip is an Edit button + a separate labelled Remove button (pinned aria contract)', () => {
    expect(html).toContain('aria-label="Edit t2dm"');
    expect(html).toContain('aria-label="Remove t2dm"');
    expect(html).toContain('aria-label="Remove metformin"');
  });
  it('disabled chips carry the "off" micro-badge (visible in beginner mode)', () => {
    expect(html).toContain('>off</span>');
  });
  it('97.md Phase 8 — visible OR separators between chips', () => {
    expect(html).toContain('>OR</span>');
  });
});

describe('TermChipRow — 97.md Phase 12 duplicate chip states (never colour alone)', () => {
  const eusA = { id: 'e1', text: 'EUS', type: 'freetext', field: 'tiab' };
  const concept = { id: 'g1', label: 'Concept 1', op: 'AND', terms: [eusA, freetext] };
  const base = { concept, beginner: true, editingTermId: null, onOpenEditor: () => {}, onRemove: () => {}, renderEditor: () => null };
  const sigFor = (sig) => (t) => (t.id === 'e1' ? sig : null);

  it('exact cross-group duplicate → dark-red chip with icon + Duplicate badge + tooltip + SR label', () => {
    const html = r(h(TermChipRow, { ...base, dupSignalFor: sigFor({ kind: 'exact-cross', key: 'eus', id: 'exactdup:eus', groupIds: ['g1', 'g2'], others: [{ conceptId: 'g2', conceptLabel: 'Concept 2', termId: 'e2', termText: 'eus' }], intentional: false, dismissed: false }) }));
    expect(html).toContain('data-testid="sb-dup-badge"');
    expect(html).toContain('⚠');                                   // icon
    expect(html).toContain('Duplicate');                            // visible text
    expect(html).toContain('Exact duplicate across AND concepts');  // tooltip + SR label (98.md §8 noun)
    expect(html).toContain('unnecessarily restrictive');            // spec tooltip copy
    expect(html).toContain('Concept 2');                            // names the other concept
    expect(html).toContain('role="img"');                           // SR label carrier
    expect(html).toContain('#b91c1c');                              // strong dark-red border (plus…)
    expect(EXACT_DUP_TOOLTIP('EUS')).toContain('“EUS” appears in more than one concept group');
  });
  it('a valid intentional override mutes the warning ("kept intentionally", no dark red)', () => {
    const html = r(h(TermChipRow, { ...base, dupSignalFor: sigFor({ kind: 'exact-cross', key: 'eus', id: 'exactdup:eus', groupIds: ['g1', 'g2'], others: [], intentional: true, dismissed: false }) }));
    expect(html).toContain('data-testid="sb-dup-intentional"');
    expect(html).toContain('kept intentionally');
    expect(html).not.toContain('data-testid="sb-dup-badge"');
  });
  it('family variants get the SOFT "Possible variant" hint, never the exact styling', () => {
    const html = r(h(TermChipRow, { ...base, dupSignalFor: sigFor({ kind: 'variant', key: 'fam:eus', id: 'multi:fam:eus', groupIds: ['g1', 'g2'], others: [{ conceptId: 'g2', conceptLabel: 'Concept 2', termId: 'x', termText: 'endoscopic ultrasound' }], intentional: false, dismissed: false }) }));
    expect(html).toContain('data-testid="sb-dup-variant"');
    expect(html).toContain('Possible variant');
    expect(html).not.toContain('data-testid="sb-dup-badge"');
    expect(html).not.toContain('#b91c1c');
  });
});

describe('TermChipRow — 97.md Phase 6 drag visuals are prop-driven and DISTINCT', () => {
  const a = { id: 'a', text: 'alpha', type: 'freetext', field: 'tiab' };
  const b = { id: 'b', text: 'beta', type: 'freetext', field: 'tiab' };
  const concept = { id: 'g1', label: 'Concept 1', op: 'AND', terms: [a, b] };
  const base = { concept, beginner: true, editingTermId: null, onOpenEditor: () => {}, onRemove: () => {}, renderEditor: () => null };

  it('idle → no insertion line, no merge target', () => {
    const html = r(h(TermChipRow, base));
    expect(html).not.toContain('sb-insert-line');
    expect(html).not.toContain('sb-merge-target');
  });
  it('an insert target renders the INSERTION LINE (reorder affordance)', () => {
    const html = r(h(TermChipRow, { ...base, dragState: { active: true, dragId: 'a', target: { kind: 'insert', groupId: 'g1', index: 1 }, armed: false } }));
    expect(html).toContain('data-testid="sb-insert-line"');
    expect(html).not.toContain('sb-merge-target');
  });
  it('a merge target renders the DISTINCT ring + hold-to-combine hint; armed flips the copy', () => {
    const holding = r(h(TermChipRow, { ...base, dragState: { active: true, dragId: 'a', target: { kind: 'merge', targetId: 'b', groupId: 'g1' }, armed: false } }));
    expect(holding).toContain('data-testid="sb-merge-target"');
    expect(holding).toContain('data-armed="false"');
    expect(holding).toContain('Hold to combine…');
    expect(holding).not.toContain('sb-insert-line');
    const armed = r(h(TermChipRow, { ...base, dragState: { active: true, dragId: 'a', target: { kind: 'merge', targetId: 'b', groupId: 'g1' }, armed: true } }));
    expect(armed).toContain('data-armed="true"');
    expect(armed).toContain('Release to combine into one phrase');
  });
});

/* ── TermEditorPopover ────────────────────────────────────────────────────── */
describe('TermEditorPopover — evolved editor (97.md MeSH wording + phrase/copy actions)', () => {
  const base = {
    term: freetext, beginner: false, moveTargets: [{ id: 'cI', label: 'Intervention / Exposure' }],
    preview: '"metformin"[tiab]', onChange: () => {}, onClose: () => {}, onLookup: () => {},
    onToggleDisabled: () => {}, onMove: () => {}, onRemove: () => {},
  };
  it('is a labelled dialog with text edit, disable, move, remove and Done', () => {
    const html = r(h(TermEditorPopover, base));
    expect(html).toContain('data-testid="sb-term-editor"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Edit term metformin"');
    expect(html).toContain('aria-label="Term text"');
    expect(html).toContain('>Disable</button>');
    expect(html).toContain('Move to concept…');
    expect(html).toContain('>Remove</button>');
    expect(html).toContain('>Done</button>');
  });
  it('97.md Phase 13 — the search-as toggle says "MeSH term", never "Subject heading"', () => {
    const html = r(h(TermEditorPopover, base));
    expect(html).toContain('MeSH term');
    expect(html).not.toContain('Subject heading');
  });
  it('a matched MeSH term shows "Matched MeSH term" + the explode section with the exact 97 label', () => {
    const html = r(h(TermEditorPopover, { ...base, term: controlled }));
    expect(html).toContain('✓ Matched MeSH term: Diabetes Mellitus, Type 2');
    expect(html).toContain('Include narrower indexed terms');
    expect(html).toContain('does not add any visible free-text terms');
  });
  it('expert mode shows the per-DB syntax preview; beginner hides it', () => {
    expect(r(h(TermEditorPopover, base))).toContain('data-testid="sb-term-syntax-preview"');
    expect(r(h(TermEditorPopover, { ...base, beginner: true }))).not.toContain('sb-term-syntax-preview');
  });
  it('a disabled term offers Enable instead', () => {
    expect(r(h(TermEditorPopover, { ...base, term: disabledTerm }))).toContain('>Enable</button>');
  });
  it('an edited-away MeSH term gets the honest conversion path ("no longer a MeSH term" → free text)', () => {
    const html = r(h(TermEditorPopover, { ...base, term: unmatched }));
    expect(html).toContain('This is no longer a MeSH term');
    expect(html).toContain('Convert to free text');
  });
  it('97.md Phase 12 — exact-duplicate actions: find other / move / remove / keep both / dismiss', () => {
    const html = r(h(TermEditorPopover, {
      ...base,
      dupInfo: {
        kind: 'exact-cross', otherLabel: 'Concept 2',
        onFindOther: () => {}, onMoveThere: () => {}, onRemoveCopy: () => {}, onKeepBoth: () => {}, onDismiss: () => {},
      },
    }));
    expect(html).toContain('data-testid="sb-dup-actions"');
    expect(html).toContain('Exact duplicate across AND concepts');
    expect(html).toContain('Find other duplicate');
    expect(html).toContain('Move to Concept 2');
    expect(html).toContain('Remove this copy');
    expect(html).toContain('Keep both intentionally');
    expect(html).toContain('Dismiss warning');
  });
  it('a family variant gets only the soft informational note (no dark-red action block)', () => {
    const html = r(h(TermEditorPopover, { ...base, dupInfo: { kind: 'variant', otherLabel: 'Concept 2' } }));
    expect(html).toContain('data-testid="sb-dup-variant-note"');
    expect(html).toContain('Possible variant');
    expect(html).not.toContain('sb-dup-actions');
  });
  it('97.md Phases 9/11 — explicit copy + move-to-NEW-group menu items (keyboard path for drag)', () => {
    const html = r(h(TermEditorPopover, { ...base, onCopyTo: () => {}, onMoveToNewGroup: () => {} }));
    expect(html).toContain('data-testid="sb-copy-btn"');
    expect(html).toContain('Copy to concept…');
    // menus open on click (client state) — the buttons exist and are labelled.
  });
  it('97.md Phase 6 — combine menu + component split + SAFE manual split for edited phrases', () => {
    const withCombine = r(h(TermEditorPopover, { ...base, combineTargets: [{ id: 'tX', text: 'biguanide' }], onCombineWith: () => {} }));
    expect(withCombine).toContain('data-testid="sb-combine-btn"');
    expect(withCombine).toContain('Combine into a phrase…');
    const phraseWithComponents = { id: 'p1', text: 'sodium-glucose cotransporter 2', type: 'freetext', field: 'tiab', phrase: true, components: [{ text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }] };
    const compSplit = r(h(TermEditorPopover, { ...base, term: phraseWithComponents, onSplitPhrase: () => {}, onManualSplit: () => {} }));
    expect(compSplit).toContain('data-testid="sb-split-phrase-btn"');
    expect(compSplit).toContain('Split phrase (3 parts)');
    const editedPhrase = { id: 'p2', text: 'renamed custom phrase', type: 'freetext', field: 'tiab', phrase: true };
    const manual = r(h(TermEditorPopover, { ...base, term: editedPhrase, onManualSplit: () => {} }));
    expect(manual).toContain('Split phrase…'); // opens the manual dialog — never guesses
  });
  it('97.md — reorder buttons stay as the keyboard alternative with edge disabling', () => {
    const html = r(h(TermEditorPopover, {
      term: freetext, beginner: true, moveTargets: [],
      onReorder: () => {}, canMoveEarlier: false, canMoveLater: true,
      onChange: () => {}, onClose: () => {}, onToggleDisabled: () => {}, onRemove: () => {},
    }));
    expect(html).toContain('data-testid="sb-term-move-earlier"');
    expect(html).toContain('data-testid="sb-term-move-later"');
    expect(html).toContain('aria-label="Move metformin earlier in the concept"');
    expect(html).toContain('Already first in the concept');
  });
  it('97.md Phase 13 — the bulk "+ add N synonyms" action is GONE', () => {
    const html = r(h(TermEditorPopover, { ...base, term: { ...freetext, vocab: VOCAB } }));
    expect(html).not.toContain('add 2 synonyms');
    expect(html).not.toContain('synonyms</button>');
  });
});

/* ── MeshDetailsPopover (97.md Phase 13) ──────────────────────────────────── */
describe('MeshDetailsPopover — informational hover/focus details, per-term add only', () => {
  // NIDDM already lives in the group (→ "✓ added"); T2DM does not (→ addable).
  const base = { term: controlled, addedTexts: ['NIDDM'], onAddEntryTerm: () => {}, onClose: () => {} };
  it('shows the exact "X"[MeSH] form, scope note, tree, ID, explode status and source', () => {
    const html = r(h(MeshDetailsPopover, base));
    expect(html).toContain('data-testid="sb-mesh-popover"');
    expect(html).toContain('Diabetes Mellitus, Type 2');
    expect(html).toContain('[MeSH]');
    expect(html).toContain('A subclass of diabetes mellitus.');
    expect(html).toContain('C18.452.394.750.149');
    expect(html).toContain('D003924');
    expect(html).toContain('Include narrower indexed terms');
    expect(html).toContain('does not add visible free-text terms');
    expect(html).toContain('National Library of Medicine');
  });
  it('entry terms are INFORMATIONAL rows with per-term "Add this term"; added ones marked', () => {
    const html = r(h(MeshDetailsPopover, base));
    expect((html.match(/data-testid="sb-mesh-entry-term"/g) || []).length).toBe(2);
    expect(html).toContain('not added automatically');
    expect(html).toContain('aria-label="Add this term: T2DM"');
    expect(html).toContain('✓ added'); // NIDDM already lives in the group
    // no bulk affordance of any kind
    expect(html).not.toContain('Accept all');
    expect(html).not.toContain('Add all');
  });
  it('noExplode flips the explode status copy', () => {
    const html = r(h(MeshDetailsPopover, { ...base, term: { ...controlled, noExplode: true } }));
    expect(html).toContain('only records indexed with this exact heading');
  });
  it('read-only hides the add actions', () => {
    const html = r(h(MeshDetailsPopover, { ...base, readOnly: true }));
    expect(html).not.toContain('Add this term');
  });
});

/* ── AddTermBox ───────────────────────────────────────────────────────────── */
describe('AddTermBox — explicit Add + typed-first + paste confirm', () => {
  const base = {
    api: null, conceptLabel: 'Population', value: '', onChange: () => {},
    onCommitTyped: () => {}, onPickSuggestion: () => {}, onClear: () => {},
  };
  it('renders the input (combobox), an explicit Add button and the polite outcome line', () => {
    const html = r(h(AddTermBox, base));
    expect(html).toContain('data-testid="sb-add-term-input"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Add a term to Population"');
    expect(html).toContain('data-testid="sb-add-term-btn"');
    expect(html).toContain('disabled'); // Add disabled with an empty draft
    expect(html).toContain('data-testid="sb-add-status"');
    expect(html).toContain('aria-live="polite"');
  });
  it('reports the add outcome text (silent dedupe is gone — audit H1)', () => {
    const html = r(h(AddTermBox, { ...base, statusText: '2 added · 1 already present' }));
    expect(html).toContain('2 added · 1 already present');
  });
  it('a pending multi-term paste renders the confirmable chip preview', () => {
    const html = r(h(AddTermBox, {
      ...base,
      pendingSplit: { terms: ['stroke', 'TIA', 'cerebrovascular accident'] },
      onConfirmSplit: () => {}, onCancelSplit: () => {},
    }));
    expect(html).toContain('data-testid="sb-split-confirm"');
    expect(html).toContain('Add 3 terms?');
    expect(html).toContain('cerebrovascular accident');
    expect(html).toContain('Add 3 terms</button>');
    expect(html).toContain('Cancel');
  });
});

/* ── SuggestionsDisclosure — 98.md §11 CONTROLLED visibility ──────────────── */
describe('SuggestionsDisclosure — controlled open/closed (98.md §11/§20)', () => {
  const suggs = [
    { key: 'rej:P:t2dm', text: 'Diabetes Mellitus, Type 2', kind: 'mesh', why: 'Standard MeSH term for "t2dm"', sourceText: 't2dm' },
    { key: 'rej:P:hf', text: 'Heart Failure', kind: 'mesh', why: 'Standard MeSH term for "heart failure"', sourceText: 'heart failure' },
  ];
  it('CLOSED (default): only the toggle renders — children are NOT mounted', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: suggs, onAccept: () => {}, onToggleOpen: () => {} }));
    expect(html).toContain('data-testid="sb-suggestions"');
    expect(html).toContain('data-testid="sb-suggestions-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Show suggestions (2)'); // compact count on the toggle
    expect(html).not.toContain('sb-suggestion-row'); // §20 — nothing mounts while closed
    expect(html).not.toContain('Heart Failure');
  });
  it('CLOSED with no pending suggestions: the toggle carries no count', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: [], onToggleOpen: () => {} }));
    expect(html).toContain('Show suggestions');
    expect(html).not.toContain('Show suggestions (');
  });
  it('OPEN: the toggle flips to "Hide suggestions" and the rows mount', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: suggs, open: true, onToggleOpen: () => {}, onAccept: () => {} }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Hide suggestions');
    expect((html.match(/data-testid="sb-suggestion-row"/g) || []).length).toBe(2);
    // no native <details>/defaultOpen — the parent owns the state
    expect(html).not.toContain('<details');
  });
});

describe('SuggestionsDisclosure — 97.md Phase 13 review surface (no bulk accepts; open)', () => {
  const suggs = [
    { key: 'rej:P:t2dm', text: 'Diabetes Mellitus, Type 2', kind: 'mesh', why: 'Standard MeSH term for "t2dm"', sourceText: 't2dm' },
    { key: 'rej:P:hf', text: 'Heart Failure', kind: 'mesh', why: 'Standard MeSH term for "heart failure"', sourceText: 'heart failure' },
    { key: 'rej:P:syn', text: 'metformin', kind: 'synonyms', why: 'Entry terms for "metformin"', synonyms: ['dimethylbiguanide', 'glucophage'] },
  ];
  const open = (props) => r(h(SuggestionsDisclosure, { open: true, onToggleOpen: () => {}, ...props }));
  it('MeSH rows: kind badge "MeSH", why line, "Add this term" + Dismiss', () => {
    const html = open({ suggestions: suggs, onAccept: () => {}, onDismiss: () => {} });
    expect(html).toContain('data-testid="sb-suggestions"');
    expect((html.match(/data-testid="sb-suggestion-row"/g) || []).length).toBe(3);
    expect(html).toContain('>MeSH</span>');
    expect(html).toContain('aria-label="Accept suggestion Heart Failure"');
    expect(html).toContain('aria-label="Dismiss suggestion Heart Failure"');
    expect(html).toContain('Add this term');
    expect(html).not.toContain('Subject heading');
  });
  it('the bulk "Accept all N subject headings" affordance is REMOVED', () => {
    const html = open({ suggestions: suggs, onAccept: () => {} });
    expect(html).not.toContain('sb-accept-all-headings');
    expect(html).not.toContain('Accept all');
  });
  it('entry-term suggestions render INDIVIDUAL per-term rows, never one bulk accept', () => {
    const html = open({ suggestions: suggs, onAcceptEntryTerm: () => {} });
    expect(html).toContain('Entry terms for “metformin”');
    expect((html.match(/data-testid="sb-entry-term-row"/g) || []).length).toBe(2);
    expect(html).toContain('aria-label="Add this term: dimethylbiguanide"');
    expect(html).toContain('aria-label="Add this term: glucophage"');
  });
  it('low-confidence MeSH suggestions are clearly marked (and never auto-added)', () => {
    const withConf = [{ ...suggs[0], confidence: 'review' }];
    const html = open({ suggestions: withConf, onAccept: () => {} });
    expect(html).toContain('data-testid="sb-sugg-low-confidence"');
    expect(html).toContain('low confidence — review');
    expect(html).toContain('never added automatically');
  });
  it('empty state is friendly, not blank', () => {
    const html = open({ suggestions: [] });
    expect(html).toContain('No suggestions right now — they appear as you add terms.');
  });
  it('dismissed rejections are listed with one-click restore ("Show dismissed")', () => {
    const closed = open({ suggestions: [], rejectedEntries: [{ key: 'rej:P:eus', label: 'eus' }], onToggleShowDismissed: () => {} });
    expect(closed).toContain('Show dismissed (1)');
    const shown = open({ suggestions: [], rejectedEntries: [{ key: 'rej:P:eus', label: 'eus' }], showDismissed: true, onUnreject: () => {} });
    expect(shown).toContain('aria-label="Restore suggestion eus"');
  });
  it('the hidden-terms restore panel lives INSIDE the disclosure', () => {
    const html = open({
      suggestions: [],
      ignoredGroups: [{ field: 'Population', label: 'Population', items: [{ text: 'adults', field: 'Population', label: 'Population' }] }],
      onRestoreTerm: () => {}, onRestoreField: () => {}, onRestoreAll: () => {},
    });
    expect(html).toContain('data-testid="sb-hidden-terms"');
    expect(html).toContain('aria-label="Restore adults"');
    expect(html).toContain('↺ Restore all (1)');
  });
  it('read-only: actions render disabled + aria-disabled with the access title', () => {
    const html = open({ suggestions: suggs, readOnly: true, onAccept: () => {}, onDismiss: () => {}, onAcceptEntryTerm: () => {} });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Read-only access');
  });
});

/* ── RegenerateDialog (97.md Phase 4; 98.md §8 copy) ──────────────────────── */
describe('RegenerateDialog — the explicit regeneration confirmation', () => {
  it('closed → renders nothing; open → modal dialog with the EXACT §8 copy', () => {
    expect(r(h(RegenerateDialog, { open: false }))).toBe('');
    const html = r(h(RegenerateDialog, { open: true, onCancel: () => {}, onConfirm: () => {} }));
    expect(html).toContain('data-testid="sb-regenerate-dialog"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Regenerate search strategy?');
    // 98.md §8 — concept groups; the PICO mention is removed.
    expect(html).toContain('This will rebuild the automatically generated keywords and concept groups from the current research question. Your current manual organization may change.');
    expect(html).not.toContain('PICO');
    expect(html).toContain('>Cancel</button>');
    expect(html).toContain('>Regenerate</button>');
    expect(html).toContain('snapshot'); // the snapshot-first promise is stated
  });
  it('busy disables the actions; an error renders as an alert', () => {
    const busy = r(h(RegenerateDialog, { open: true, busy: true, onCancel: () => {}, onConfirm: () => {} }));
    expect(busy).toContain('Regenerating…');
    expect(busy).toContain('disabled');
    const err = r(h(RegenerateDialog, { open: true, error: 'The backup snapshot could not be saved, so nothing was regenerated.', onCancel: () => {}, onConfirm: () => {} }));
    expect(err).toContain('role="alert"');
    expect(err).toContain('nothing was regenerated');
  });
});

/* ── SearchMeaningPanel (100.md §§6-11) ───────────────────────────────────────
   Replaces the retired StrategyPreviewPanel ("Your search so far"). Everything the
   old panel uniquely owned moved to a surface that already existed — the live PubMed
   count + retry to PubMedPulse, the between-concept AND/OR toggle to `sb-and-connector`
   ON the board, click-to-select and the "editing" state to the board cards themselves
   — so what is left to pin here is the plain-language reading and its READ-ONLY-ness. */
describe('SearchMeaningPanel — the plain-language reading of the live strategy', () => {
  const concepts = [{ ...P, op: 'OR' }, I, { id: 'cO', label: 'Outcomes', picoField: 'O', field: 'Outcomes', op: 'AND', terms: [] }];
  const base = { concepts, filters: {} };

  it('renders the pinned testid, a one-sentence summary, and one block per live concept', () => {
    const html = r(h(SearchMeaningPanel, base));
    expect(html).toContain('data-testid="sb-search-meaning"');
    expect(html).toContain('What this search is looking for');
    expect((html.match(/data-testid="sm-group"/g) || []).length).toBe(2);
    expect(html).toContain('data-testid="sm-summary"');
  });

  it('explains a subject heading without any database syntax (100.md §6)', () => {
    const html = r(h(SearchMeaningPanel, base));
    expect(html).toContain('filed under the topic');
    expect(html).toContain('Type 2 Diabetes Mellitus');
    // No Boolean/field/vocabulary syntax leaks into the beginner layer.
    for (const syntax of ['[Mesh]', '[tiab]', 'TITLE-ABS-KEY', '/exp', '(MH ']) {
      expect(html).not.toContain(syntax);
    }
  });

  it('names the between-concept operator in words, as a description (100.md §10)', () => {
    const html = r(h(SearchMeaningPanel, base));
    expect(html).toContain('data-testid="sm-join"');
    expect(html).toContain('data-op="OR"');
    expect(html).toContain('the article can INSTEAD be about:');
    expect(html).toContain('The article can match any one of these:');
  });

  it('is READ-ONLY — it renders no control that could edit the strategy (100.md §8)', () => {
    const html = r(h(SearchMeaningPanel, base));
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
  });

  it('names concepts that are not in the search yet', () => {
    const html = r(h(SearchMeaningPanel, base));
    expect(html).toContain('Not part of the search yet (no terms): Outcomes.');
  });

  it('explains the scope limits in words', () => {
    const html = r(h(SearchMeaningPanel, { ...base, filters: { dateFrom: '2010', dateTo: '2025', languages: ['en'], pubTypes: ['Randomized Controlled Trial'] } }));
    expect(html).toContain('Published between 2010 and 2025.');
    expect(html).toContain('Written in English.');
    expect(html).toContain('Only Randomized Controlled Trial articles.');
  });

  it('invites a first term instead of rendering an empty shell', () => {
    const html = r(h(SearchMeaningPanel, { concepts: [], filters: {} }));
    expect(html).toContain('data-testid="sm-empty"');
    expect(html).toContain('plain English');
  });

  it('keeps the exact database queries reachable behind a closed disclosure (100.md §11)', () => {
    const compiled = [{ dbId: 'pubmed', label: 'PubMed / MEDLINE', query: 'x[tiab]', vocab: { fallback: 0 } }];
    const html = r(h(SearchMeaningPanel, { ...base, compiled, technicalHint: 'Read-only here.' }));
    expect(html).toContain('<details');
    expect(html).toContain('Exact database queries (1)');
    expect(html).toContain('data-testid="sm-db-query-pubmed"');
    expect(html).toContain('x[tiab]');
    // Closed by default — the technical layer never clutters the building screen.
    expect(html).not.toContain('<details open');
  });
});

/* ══════════════ 96.md D13 — QuestionPhraseCard + QuestionDriftBanner ═══════════ */

import { QuestionPhraseCard, QuestionDriftBanner } from '../../src/features/searchBuilder/SearchBuilderTab.jsx';

describe('QuestionPhraseCard — phrase selection on the research question (96.md D13.1/2 + 98.md)', () => {
  const base = {
    question: 'Do SGLT2 inhibitors reduce hospital readmission in adults with heart failure?',
    accent: '#8859ff',
    isSelected: (text) => text.toLowerCase() === 'heart failure',
    onTogglePhrase: () => {}, onCombineSpan: () => {}, onAddManual: () => {}, onEditQuestion: () => {},
  };
  it('renders the pinned testid, the question tokens as aria-pressed buttons, and the Edit link', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('data-testid="sb-question-card"');
    expect(html).toContain('Research question');
    expect(html).toContain('Edit question');
    expect(html).toContain('data-testid="sb-edit-question"'); // 98.md §4 — opens the INLINE editor
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('✓ heart failure');
    expect(html).toContain('aria-pressed="false"');
  });
  it('98.md §8 — offers the manual add box with CONCEPT language (search-group noun gone)', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('aria-label="Add a concept group manually"');
    expect(html).toContain('+ Add concept');
    expect(html).not.toContain('Add search group');
  });
  it('empty question → the inline-editor invitation (98.md §3 — no stage to point at)', () => {
    const html = r(h(QuestionPhraseCard, { ...base, question: '' }));
    expect(html).toContain('No research question yet');
    expect(html).toContain('data-testid="sb-add-question"');
    expect(html).toContain('Write your research question');
  });
  it('read-only hides the manual add box and disables tokens', () => {
    const html = r(h(QuestionPhraseCard, { ...base, readOnly: true }));
    expect(html).not.toContain('+ Add concept');
    expect(html).toContain('disabled');
  });
});

describe('QuestionDriftBanner — "question changed" flagging (96.md D2, never auto-delete)', () => {
  const drifted = [
    { id: 'c1', label: 'Mortality', sourcePhrase: 'mortality' },
    { id: 'c2', label: 'Setting', sourcePhrase: 'Setting' },
  ];
  it('lists every drifted group with keep-all / per-group Edit + Remove', () => {
    const html = r(h(QuestionDriftBanner, { drifted, onKeepAll: () => {}, onEditConcept: () => {}, onRemoveConcept: () => {} }));
    expect(html).toContain('data-testid="sb-drift-banner"');
    expect(html).toContain('Your research question changed.');
    expect(html).toContain('Keep concepts — mark as up to date');
    expect(html).toContain('Mortality');
    expect(html).toContain('aria-label="Edit concept Mortality"');
    expect(html).toContain('aria-label="Remove concept Setting"');
    expect(html).toContain('nothing is deleted automatically');
  });
  it('renders nothing with an empty drift list; read-only drops the actions', () => {
    expect(r(h(QuestionDriftBanner, { drifted: [] }))).toBe('');
    const ro = r(h(QuestionDriftBanner, { drifted, readOnly: true }));
    expect(ro).not.toContain('Remove concept');
    expect(ro).not.toContain('Keep concepts');
  });
});

/* ══════════ 96.md QA fixes — M4/M5/M8 SSR contracts (kept post-98) ══════════ */

describe('QA M5 — QuestionPhraseCard token seam (pinned for e2e: sb-question-card + button semantics)', () => {
  const base = {
    question: 'Do SGLT2 inhibitors reduce hospital readmission in adults with heart failure?',
    accent: '#8859ff',
    isSelected: () => false,
    onTogglePhrase: () => {}, onAddManual: () => {},
  };
  it('every token — words, phrases AND filler/noise words — is a real <button> with aria-label = its exact text', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('data-testid="sb-question-card"');
    expect(html).toContain('aria-label="heart failure"');        // curated phrase token
    expect(html).toContain('aria-label="hospital readmission"'); // vocabulary phrase token
    expect(html).toContain('aria-label="reduce"');               // plain word token
  });
  it('filler/noise words ("adults", "in") render dimmed but CLICKABLE (buttons, not spans)', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('aria-label="adults"');
    expect(html).toContain('aria-label="in"');
    expect(html).not.toMatch(/<span[^>]*>adults <\/span>/);
  });
  it('the span/drag-combine instruction line exists and tokens reference it via aria-describedby', () => {
    // 98.md §5 — the hint stays in the DOM for aria-describedby even with Beginner
    // Mode off (visually hidden); no localStorage in SSR → beginner defaults OFF.
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('data-testid="sb-span-hint"');
    expect(html).toContain('Shift-click another word');
    expect(html).toContain('drag one word onto another'); // 97.md drag-combine is documented inline
    expect(html).toContain('aria-describedby=');
  });
  it('read-only disables every token and hides the manual add box', () => {
    const html = r(h(QuestionPhraseCard, { ...base, readOnly: true }));
    expect(html).not.toContain('+ Add concept');
    expect(html).toContain('disabled');
  });
});

describe('QA M4 — QuestionDriftBanner offers "Update phrase" per drifted row', () => {
  const drifted2 = [{ id: 'c1', label: 'Mortality', sourcePhrase: 'mortality' }];
  it('renders the Update phrase action alongside Edit/Remove when onUpdatePhrase is wired', () => {
    const html = r(h(QuestionDriftBanner, { drifted: drifted2, onKeepAll: () => {}, onEditConcept: () => {}, onUpdatePhrase: () => {}, onRemoveConcept: () => {} }));
    expect(html).toContain('aria-label="Update the phrase for Mortality"');
  });
  it('read-only hides Update phrase with the other actions', () => {
    const html = r(h(QuestionDriftBanner, { drifted: drifted2, readOnly: true, onUpdatePhrase: () => {} }));
    expect(html).not.toContain('Update phrase');
  });
});

describe('QA M4/M6/M8 — ActiveConceptPanel: source phrase, AND hint, read-only', () => {
  const withPhrase = { id: 'c1', label: 'Mortality', sourcePhrase: 'mortality', source: 'user_added', terms: [{ id: 'q1', text: 'mortality', type: 'freetext' }, { id: 'q2', text: 'death', type: 'freetext' }] };
  it('M4: shows the originating phrase with an inline Update phrase affordance (active card)', () => {
    const html = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', onUpdateSourcePhrase: () => {} }));
    expect(html).toContain('data-testid="sb-source-phrase"');
    expect(html).toContain('From the question phrase');
    expect(html).toContain('aria-label="Update the phrase for Mortality"');
  });
  it('M6: the fixed-OR guidance offers the supported AND path — split into separate concepts (beginner ¶)', () => {
    // 98.md §5 — the guidance ¶ (and its AND hint) is Beginner-Mode content.
    const html = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', beginner: true, onRequestSplit: () => {} }));
    expect(html).toContain('data-testid="sb-and-hint"');
    expect(html).toContain('Split them into separate concepts');
    const none = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', beginner: true }));
    expect(none).not.toContain('data-testid="sb-and-hint"');
    // professional mode carries no guidance ¶ at all
    const pro = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', onRequestSplit: () => {} }));
    expect(pro).not.toContain('data-testid="sb-and-hint"');
  });
  it('M8: read-only makes the rename input inert with an access explanation', () => {
    const html = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', readOnly: true }));
    expect(html).toContain('readonly');
    expect(html).toContain('Read-only access');
    expect(html).not.toContain('Update phrase');
  });
});

describe('QA M8 — TermChipRow read-only: inert edit, no remove', () => {
  it('disables the chip edit button with an explanation and drops the remove button', () => {
    const html = r(h(TermChipRow, { concept: { id: 'c', label: 'C', terms: [freetext] }, readOnly: true }));
    expect(html).toContain('disabled');
    expect(html).toContain('Read-only access');
    expect(html).not.toContain('aria-label="Remove metformin"');
  });
});

describe('100.md §8 — SearchMeaningPanel behaves identically for editors and viewers', () => {
  const concepts2 = [
    { id: 'a', label: 'HF', op: 'AND', terms: [{ id: 'p1', text: 'heart failure', type: 'freetext' }] },
    { id: 'b', label: 'Rx', op: 'AND', terms: [{ id: 'p2', text: 'metformin', type: 'freetext' }] },
  ];
  it('there is no readOnly branch to get wrong — the panel never mutates anything', () => {
    // The retired StrategyPreviewPanel needed a read-only mode because it hosted the
    // AND/OR toggle. This one is a description, so an editor and a viewer see exactly
    // the same markup; the only mutating control (the board's AND/OR connector) keeps
    // its own read-only handling.
    const html = r(h(SearchMeaningPanel, { concepts: concepts2, filters: {} }));
    expect(html).toContain('the article must ALSO be about:');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('onclick');
  });
});

/* ══════════ 97 QA M9 — PICO source sections (read-only Phase 5 display) ══════ */
import { PicoSourceSections, PICO_SOURCE_ROWS } from '../../src/features/searchBuilder/SearchBuilderTab.jsx';

describe('PicoSourceSections — labeled read-only source rows below the question', () => {
  const pico = { question: 'q', P: 'adults with type 2 diabetes', I: 'SGLT2 inhibitors', C: '', O: 'mortality' };

  it('renders one labeled row per NON-EMPTY field, with clickable tokens', () => {
    const html = r(h(PicoSourceSections, { pico, accent: '#123456', isSelected: () => false, onTogglePhrase: () => {} }));
    expect(html).toContain('data-testid="sb-pico-sources"');
    expect(html).toContain('Population');
    expect(html).toContain('Intervention');
    expect(html).toContain('Outcomes');
    expect(html).not.toContain('Comparator'); // blank C → no row
    expect(html).toMatch(/<button[^>]*aria-label="mortality"/); // tokens are buttons
    // Clearly reference-only — the sections never reorganize the workspace.
    expect(html).toContain('never reorganize your concepts');
  });
  it('renders NOTHING when every PICO field is blank (new projects)', () => {
    expect(r(h(PicoSourceSections, { pico: { question: 'q' }, isSelected: () => false }))).toBe('');
    expect(r(h(PicoSourceSections, { pico: null, isSelected: () => false }))).toBe('');
  });
  it('marks already-selected tokens pressed; readOnly disables the buttons', () => {
    const html = r(h(PicoSourceSections, { pico, isSelected: (t) => t === 'mortality', onTogglePhrase: () => {}, readOnly: true }));
    expect(html).toMatch(/<button[^>]*aria-label="mortality"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="mortality"|<button[^>]*aria-label="mortality"[^>]*disabled/);
  });
  it('the four canonical rows are pinned (P/I/C/O only — no workspace control)', () => {
    expect(PICO_SOURCE_ROWS.map(([k]) => k)).toEqual(['P', 'I', 'C', 'O']);
  });
});

/* ══════════ 97 QA M16 — visible undo-confirmation toast (plain snackbar) ═════ */
describe('UndoSnackbar — plain mode (undo feedback is VISIBLE, not SR-only)', () => {
  it('renders the description WITHOUT an Undo button when onUndo is absent', () => {
    const html = r(h(UndoSnackbar, { message: 'Restored "emphysema"', onUndo: null, onDismiss: () => {} }));
    expect(html).toContain('Restored');
    expect(html).toContain('data-testid="sb-undo"');
    expect(html).not.toContain('>Undo<');
  });
  it('keeps the Undo button for ordinary action toasts', () => {
    const html = r(h(UndoSnackbar, { message: 'Removed "x"', onUndo: () => {}, onDismiss: () => {} }));
    expect(html).toContain('>Undo<');
  });
});

/* ── 98.md §11 round 2 — carefully designed bulk selection ─────────────────── */
describe('SuggestionsDisclosure — §11 round-2 checkbox bulk selection', () => {
  const pending = [
    { key: 'k1', kind: 'mesh', text: 'Diabetes Mellitus, Type 2', why: 'x' },
    { key: 'k2', kind: 'mesh', text: 'Sketchy Match', why: 'x', confidence: 'review' },
    { key: 'k3', kind: 'synonyms', text: 'heart failure', why: 'x', synonyms: ['HF', 'cardiac failure'] },
  ];
  it('open editors get the bulk bar with select-all + a disabled Add button until something is checked', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: pending, open: true, onToggleOpen: () => {}, onAcceptMany: () => {} }));
    expect(html).toContain('sb-sugg-bulk-bar');
    expect(html).toContain('Select all');
    expect(html).toContain('(low-confidence MeSH excluded)');
    expect(html).toContain('sb-sugg-add-selected');
    expect(html).toContain('disabled'); // nothing preselected — the batch add starts inert
  });
  it('low-confidence MeSH rows carry NO selection checkbox (never bulk-addable)', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: pending, open: true, onToggleOpen: () => {}, onAcceptMany: () => {} }));
    expect(html).toContain('aria-label="Select suggestion Diabetes Mellitus, Type 2"');
    expect(html).not.toContain('aria-label="Select suggestion Sketchy Match"');
    expect(html).toContain('aria-label="Select entry term HF"');
  });
  it('read-only viewers and callers without onAcceptMany see no bulk affordances', () => {
    const ro = r(h(SuggestionsDisclosure, { suggestions: pending, open: true, onToggleOpen: () => {}, onAcceptMany: () => {}, readOnly: true }));
    expect(ro).not.toContain('sb-sugg-bulk-bar');
    const noCb = r(h(SuggestionsDisclosure, { suggestions: pending, open: true, onToggleOpen: () => {} }));
    expect(noCb).not.toContain('sb-sugg-bulk-bar');
  });
});

/* ── 110.md §2 — the Concepts BUILD CANVAS ───────────────────────────────────
   The Concepts area is the Search Engine's centrepiece and had to stop reading
   as one more informational card. The treatment is a recessed canvas plane
   (ConceptWorkspaceFrame) with the concept cards raised onto it, plus a
   canvas-scoped de-emphasis of the cards that are not open.

   Two contracts are pinned here:
    · the FRAME's structural markers (testid + `.sb-concept-canvas` class +
      `data-has-active`), because the whole visual treatment is a descendant
      selector keyed on them — losing the class or the attribute silently
      reverts the hierarchy with no test failing anywhere else;
    · the WIRING, source-pinned. The board lives inside SearchBuilderTab's
      2600-line component; the house test style is SSR-only (no jsdom, effects
      never run), so the frame's mount, the untouched board testid (the
      click-outside exemption selector) and the surviving expand/collapse
      handlers are asserted against the source text. */
describe('ConceptWorkspaceFrame — the build-canvas shell (110.md §2)', () => {
  it('renders the canvas markers the stylesheet keys off', () => {
    const html = r(h(ConceptWorkspaceFrame, { count: 3, hasActive: true }, h('div', { 'data-testid': 'sb-concept-board' })));
    expect(html).toContain('data-testid="sb-concept-workspace"');
    expect(html).toContain('class="sb-concept-canvas"');
    expect(html).toContain('data-has-active="true"');
    expect(html).toContain('data-empty="false"');
  });

  it('hasActive=false drops the de-emphasis hook (a collapsed board shows every card equally)', () => {
    const html = r(h(ConceptWorkspaceFrame, { count: 2, hasActive: false }));
    expect(html).toContain('data-has-active="false"');
  });

  it('names the surface: mono eyebrow + a real h3 (the workspace h2 is "Pecan Search Engine")', () => {
    const html = r(h(ConceptWorkspaceFrame, { count: 1 }));
    expect(html).toContain('class="sb-canvas-eyebrow"');
    expect(html).toContain('Workspace');
    expect(html).toContain('<h3 class="sb-canvas-title">Concepts</h3>');
  });

  it('the count chip pluralises and disappears on an empty board', () => {
    expect(r(h(ConceptWorkspaceFrame, { count: 1 }))).toContain('1 concept<');
    expect(r(h(ConceptWorkspaceFrame, { count: 4 }))).toContain('4 concepts<');
    const empty = r(h(ConceptWorkspaceFrame, { count: 0 }));
    expect(empty).not.toContain('sb-canvas-count');
    expect(empty).toContain('data-empty="true"');
  });

  it('is presentation only — children pass straight through, unwrapped', () => {
    const html = r(h(ConceptWorkspaceFrame, { count: 1, hasActive: true },
      h('div', { 'data-testid': 'sb-concept-board', role: 'group', 'aria-label': 'Concept groups' })));
    expect(html).toContain('data-testid="sb-concept-board"');
    expect(html).toContain('aria-label="Concept groups"');
  });
});

describe('SearchBuilderTab — the canvas is wired to the board (110.md §2, source-pinned)', () => {
  const tabSrc = readFileSync(new URL('../../src/features/searchBuilder/SearchBuilderTab.jsx', import.meta.url), 'utf8');

  it('the board is mounted INSIDE the frame, driven by the live concept/active state', () => {
    expect(tabSrc).toContain('import ConceptWorkspaceFrame from "./components/ConceptWorkspaceFrame.jsx"');
    expect(tabSrc).toContain('<ConceptWorkspaceFrame count={concepts.length} hasActive={!!activeConcept}>');
    expect(tabSrc).toContain('</ConceptWorkspaceFrame>');
  });

  it('the board element itself is UNTOUCHED — its testid is the click-outside exemption selector', () => {
    expect(tabSrc).toContain('<div data-testid="sb-concept-board" role="group" aria-label="Concept groups"');
    expect(tabSrc).toContain('[data-testid="sb-concept-board"],[role="dialog"],[data-testid="sb-undo"],[data-sb-collapse-exempt]');
  });

  it('expand / collapse / click-outside stay wired (110.md keeps the behaviour, only the transitions change)', () => {
    expect(tabSrc).toContain('selectConcept(c.id)');                       // click a compact card → expands it
    expect(tabSrc).toContain('onCollapse={active?()=>collapseBoard({refocus:true}):null}'); // chevron collapses
    expect(tabSrc).toMatch(/Escape[\s\S]{0,120}collapseBoard\(\{refocus:true\}\)/); // Escape from inside the board
    expect(tabSrc).toContain('collapseBoardRef.current({refocus:false})'); // click-outside restores…
    expect(tabSrc).toContain('document.addEventListener("pointerdown",onDown,true)'); // …on the capture-phase pair
  });

  it('the canvas stylesheet defines the plane, the raised open card and the de-emphasis + its hover return', () => {
    expect(tabSrc).toContain('.sb-concept-canvas{');
    expect(tabSrc).toContain('.sb-concept-canvas .sb-card-shell[data-compact="false"]{box-shadow:');
    expect(tabSrc).toContain('.sb-concept-canvas[data-has-active="true"] .sb-card-shell[data-compact="true"]{');
    expect(tabSrc).toMatch(/data-has-active="true"\] \.sb-card-shell\[data-compact="true"\]:hover/);
    expect(tabSrc).toContain('@media (max-width:640px){.sb-concept-canvas{'); // narrow viewports shed canvas padding
  });

  it('the plane and the de-emphasis ARE --t-bg, never --t-surf and never accent-tinted', () => {
    // Regression pin, two lessons:
    //  1. The Stitch legacyRemap sends BOTH --t-surf and --t-card to p.card, so a
    //     surf-derived canvas renders the SAME colour as the cards on it and the
    //     whole hierarchy silently flattens. --t-bg is the one ground that differs
    //     from the card plane in every theme × design-system combination.
    //  2. (110 review F1/F2) Mixing the ACCENT into that ground undoes lesson 1:
    //     --t-acc is a LIGHT colour in both dark palettes, so a 5% wash lifted the
    //     stitch-night plane to rgb(26,28,37) against a rgb(26,29,38) card — Δ2.
    //     The plane and the de-emphasised card are therefore the RAW --t-bg; the
    //     accent lives only in the head gradient, capped at alpha '08'.
    // (the stylesheet is a template literal — the pins match the SOURCE form)
    expect(tabSrc).toContain('background-color:${C.bg};');
    expect(tabSrc).toContain("linear-gradient(180deg,${alpha(C.acc,'08')} 0,transparent 150px)");
    expect(tabSrc).toContain("box-shadow:inset 0 1px 0 ${alpha(C.bg,'40')},0 1px 2px var(--t-shadow);");
    expect(tabSrc).toContain('.sb-card-shell[data-compact="true"]{background:${C.bg};box-shadow:inset 0 1px 3px var(--t-shadow);}');
    const canvasRules = tabSrc.slice(tabSrc.indexOf('.sb-concept-canvas{'), tabSrc.indexOf('@media (max-width:640px)'));
    expect(canvasRules).not.toContain('C.surf');
    // No accent may re-enter the plane's own colour or the de-emphasis surface.
    expect(canvasRules).not.toMatch(/background-color:color-mix/);
    expect(canvasRules).not.toMatch(/\.sb-card-shell\[data-compact="true"\]\{background:color-mix/);
  });

  it('the card surface + resting elevation moved to the stylesheet so the state swap can transition', () => {
    expect(tabSrc).toMatch(/\.sb-card-shell\{background:[^;]+;box-shadow:0 1px 2px var\(--t-shadow\);transition:[^}]*background-color[^}]*border-color/);
    const panelSrc = readFileSync(new URL('../../src/features/searchBuilder/components/ActiveConceptPanel.jsx', import.meta.url), 'utf8');
    expect(panelSrc).not.toContain('background: C.card,');
    expect(panelSrc).toContain("border: active ? `2px solid ${C.acc}`");
  });

  it('every canvas motion is still removed under prefers-reduced-motion', () => {
    const rm = tabSrc.slice(tabSrc.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('.sb-card-shell,.sb-card-chevron{transition:none!important;}');
  });
});
