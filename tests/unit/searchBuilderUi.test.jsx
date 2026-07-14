/**
 * searchBuilderUi.test.jsx — 85.md A2. SSR contract tests (house pattern:
 * renderToStaticMarkup, no jsdom, effects never run → no network) for the
 * extracted Search Builder leaves powering the redesigned Concepts and
 * Terms & Vocabulary stages, plus the pure uiShared helpers and the pinned
 * renderTerm unmatched-heading fallback.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { termDisplay, termMicroBadges, conceptAccent, opExplainer } from '../../src/features/searchBuilder/components/uiShared.js';
import SaveStatusIndicator from '../../src/features/searchBuilder/components/SaveStatusIndicator.jsx';
import UndoSnackbar from '../../src/features/searchBuilder/components/UndoSnackbar.jsx';
import ConceptCards from '../../src/features/searchBuilder/components/ConceptCards.jsx';
import ConceptNavigator from '../../src/features/searchBuilder/components/ConceptNavigator.jsx';
import ActiveConceptPanel from '../../src/features/searchBuilder/components/ActiveConceptPanel.jsx';
import TermChipRow from '../../src/features/searchBuilder/components/TermChipRow.jsx';
import TermEditorPopover from '../../src/features/searchBuilder/components/TermEditorPopover.jsx';
import AddTermBox from '../../src/features/searchBuilder/components/AddTermBox.jsx';
import SuggestionsDisclosure from '../../src/features/searchBuilder/components/SuggestionsDisclosure.jsx';
import StrategyPreviewPanel from '../../src/features/searchBuilder/components/StrategyPreviewPanel.jsx';
import { renderTerm } from '../../src/features/searchBuilder/SearchBuilderTab.jsx';
import { CB_SERIES } from '../../src/frontend/theme/tokens.js';

const r = (el) => renderToStaticMarkup(el);

/* ── fixtures ─────────────────────────────────────────────────────────────── */
const VOCAB = { mesh: 'Diabetes Mellitus, Type 2', meshUI: 'D003924', synonyms: ['T2DM', 'NIDDM'], children: [] };
const controlled = { id: 't1', text: 't2dm', type: 'controlled', field: 'tiab', source: 'user_added', vocab: VOCAB };
const freetext = { id: 't2', text: 'metformin', type: 'freetext', field: 'tiab', source: 'user_added' };
const unmatched = { id: 't3', text: 'xyzzy heading', type: 'controlled', field: 'tiab', source: 'user_added', vocab: null };
const disabledTerm = { id: 't4', text: 'insulin', type: 'freetext', field: 'tiab', source: 'user_added', disabled: true };
const P = { id: 'cP', label: 'Population', picoField: 'P', field: 'Population', op: 'AND', terms: [controlled, freetext] };
const I = { id: 'cI', label: 'Intervention / Exposure', picoField: 'I', field: 'Intervention / Exposure', op: 'AND', terms: [{ id: 't9', text: 'metformin', type: 'freetext', field: 'tiab' }] };
const MANUAL = { id: 'cM', label: 'Setting', op: 'OR', source: 'user_added', terms: [{ id: 't8', text: 'hospital', type: 'freetext', field: 'tiab' }] };

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
  it('termMicroBadges: non-default field / truncation / phrase / disabled — never hidden signals', () => {
    expect(termMicroBadges({ type: 'freetext', field: 'ti', text: 'x' }).map((b) => b.key)).toEqual(['field']);
    expect(termMicroBadges({ type: 'freetext', field: 'all', text: 'x' })[0].label).toBe('everywhere');
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x', truncate: true }).map((b) => b.key)).toEqual(['truncate']);
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'heart attack', phrase: true }).map((b) => b.key)).toEqual(['phrase']);
    expect(termMicroBadges(disabledTerm).map((b) => b.key)).toEqual(['off']);
    expect(termMicroBadges(freetext)).toEqual([]); // defaults carry no badge noise
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

/* ── renderTerm — the unmatched-heading compile fallback (pinned) ─────────── */
describe('renderTerm — controlled term with NO vocab falls back to plain words', () => {
  it('pubmed: never emits a nonexistent "…"[Mesh]; searches tiab instead', () => {
    expect(renderTerm(unmatched, 'pubmed')).toBe('"xyzzy heading"[tiab]');
    expect(renderTerm(unmatched, 'pubmed')).not.toContain('[Mesh');
  });
  it('cochrane/embase: unmatched heading also degrades to a free-text token', () => {
    expect(renderTerm(unmatched, 'cochrane')).not.toContain('[mh');
    expect(renderTerm(unmatched, 'embase')).not.toContain('/exp');
  });
  it('a MATCHED controlled term still renders real controlled syntax', () => {
    expect(renderTerm(controlled, 'pubmed')).toBe('"Diabetes Mellitus, Type 2"[Mesh]');
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
});

/* ── ConceptCards ─────────────────────────────────────────────────────────── */
describe('ConceptCards — the Concepts stage cards', () => {
  const props = {
    concepts: [P, I, MANUAL],
    statusFor: () => 'ready',
    suggestionCounts: { cP: 2, cI: 0, cM: 0 },
    onRename: () => {}, onToggleOp: () => {}, onAddConcept: () => {}, onRemoveConcept: () => {}, onEditTerms: () => {},
  };
  it('keeps the pinned container testid + renders one card per concept', () => {
    const html = r(h(ConceptCards, { ...props, beginner: true }));
    expect(html).toContain('data-testid="sb-concepts-summary"');
    expect((html.match(/data-testid="sb-concept-card"/g) || []).length).toBe(3);
  });
  it('cards carry accessible name inputs, role badge, live count, status and the ONE primary action', () => {
    const html = r(h(ConceptCards, { ...props, beginner: true }));
    expect(html).toContain('aria-label="Concept name: Population"');
    expect(html).toContain('>Population</span>'); // PICO role badge text
    expect(html).toContain('2 terms');
    expect(html).toContain('Ready');
    expect(html).toContain('Edit terms →');
  });
  it('shows a suggestion-count badge only when > 0', () => {
    const html = r(h(ConceptCards, { ...props, beginner: true }));
    expect(html).toContain('2 suggestions');
    expect((html.match(/data-testid="sb-suggestion-badge"/g) || []).length).toBe(1);
  });
  it('beginner mode hides AND/OR editing; an OR join stays visible read-only (critique #5)', () => {
    const html = r(h(ConceptCards, { ...props, beginner: true }));
    // No op toggle buttons in beginner mode…
    expect(html).not.toContain('click to switch');
    // …but I→MANUAL is not last; MANUAL has op OR but is LAST so no indicator; I has op AND → hidden.
    const orProps = { ...props, concepts: [{ ...P, op: 'OR' }, I, MANUAL] };
    const withOr = r(h(ConceptCards, { ...orProps, beginner: true }));
    expect(withOr).toContain('>OR</span>'); // read-only OR pill, not a button
  });
  it('expert mode exposes the AND/OR toggle buttons', () => {
    const html = r(h(ConceptCards, { ...props, beginner: false }));
    expect(html).toContain('click to switch');
  });
  it('only MANUAL concepts get a delete affordance; PICO groups never do', () => {
    const html = r(h(ConceptCards, { ...props, beginner: true }));
    expect(html).toContain('aria-label="Delete concept Setting"');
    expect(html).not.toContain('aria-label="Delete concept Population"');
  });
});

/* ── ConceptNavigator ─────────────────────────────────────────────────────── */
describe('ConceptNavigator — master-detail pill row', () => {
  const props = {
    concepts: [P, I, MANUAL], activeId: 'cI', onSelect: () => {},
    statusFor: () => 'needs-review', suggestionCounts: { cP: 1, cI: 0, cM: 0 },
  };
  it('renders the pinned testid, one tab per concept, active pill aria-current + roving tabindex', () => {
    const html = r(h(ConceptNavigator, props));
    expect(html).toContain('data-testid="sb-concept-navigator"');
    expect((html.match(/role="tab"/g) || []).length).toBe(3);
    expect(html).toContain('aria-current="true"');
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);  // ONE tab stop
    expect((html.match(/tabindex="-1"/g) || []).length).toBe(2);
  });
  it('pills carry live-term counts + a suggestion dot (never colour-only: glyph + count text)', () => {
    const html = r(h(ConceptNavigator, props));
    expect(html).toContain('data-testid="sb-nav-suggestion-dot"');
    expect(html).toContain('1 suggestion to review'); // aria-label carries the meaning
  });
});

/* ── ActiveConceptPanel ───────────────────────────────────────────────────── */
describe('ActiveConceptPanel — detail shell', () => {
  it('renders the pinned testid, accessible name input, role badge, coverage badge + guidance', () => {
    const html = r(h(ActiveConceptPanel, { concept: P, conceptIndex: 0, status: 'ready' }, h('div', { 'data-testid': 'child-slot' })));
    expect(html).toContain('data-testid="sb-active-concept"');
    expect(html).toContain('aria-label="Concept name: Population"');
    expect(html).toContain('data-testid="sb-mesh-coverage"');
    expect(html).toContain('has heading');
    expect(html).toContain('Any one of them counts as a match');
    expect(html).toContain('data-testid="child-slot"');
  });
  it('a concept with terms but no matched heading reads "no heading yet"', () => {
    const html = r(h(ActiveConceptPanel, { concept: I, conceptIndex: 1, status: 'needs-review' }));
    expect(html).toContain('no heading yet');
  });
});

/* ── TermChipRow ──────────────────────────────────────────────────────────── */
describe('TermChipRow — chips show the SEARCHED term (audit C1)', () => {
  const concept = { ...P, terms: [controlled, freetext, unmatched, disabledTerm] };
  const html = r(h(TermChipRow, {
    concept, beginner: true,
    dupInfoFor: (t) => (t.id === 't2' ? { otherLabel: 'Intervention / Exposure', otherConceptId: 'cI' } : null),
    editingTermId: null, onOpenEditor: () => {}, onRemove: () => {}, renderEditor: () => null,
  }));
  it('controlled chip = descriptor + MeSH badge; typed text preserved as title', () => {
    expect(html).toContain('Diabetes Mellitus, Type 2');
    expect(html).toContain('>MeSH</span>');
    expect(html).toContain('title="You typed: t2dm"');
    expect(html).not.toContain('[tiab]'); // never raw syntax on a chip
    expect(html).not.toContain('[Mesh');
  });
  it('unmatched controlled term is an explicit warning chip', () => {
    expect(html).toContain('heading not found — will not match');
  });
  it('every chip is an Edit button + a separate labelled Remove button (pinned aria contract)', () => {
    expect(html).toContain('aria-label="Edit t2dm"');
    expect(html).toContain('aria-label="Remove t2dm"');
    expect(html).toContain('aria-label="Remove metformin"');
  });
  it('disabled chips carry the "off" micro-badge (visible in beginner mode)', () => {
    expect(html).toContain('>off</span>');
  });
  it('dup badge NAMES the other concept', () => {
    expect(html).toContain('also in Intervention / Exposure');
  });
});

/* ── TermEditorPopover ────────────────────────────────────────────────────── */
describe('TermEditorPopover — evolved editor', () => {
  const base = {
    term: freetext, beginner: false, moveTargets: [{ id: 'cI', label: 'Intervention / Exposure' }],
    preview: '"metformin"[tiab]', onChange: () => {}, onClose: () => {}, onLookup: () => {},
    onToggleDisabled: () => {}, onMove: () => {}, onRemove: () => {},
  };
  it('is a labelled dialog with text edit, disable, first-class move, remove and Done', () => {
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
  it('expert mode shows the per-DB syntax preview; beginner hides it', () => {
    expect(r(h(TermEditorPopover, base))).toContain('data-testid="sb-term-syntax-preview"');
    expect(r(h(TermEditorPopover, { ...base, beginner: true }))).not.toContain('sb-term-syntax-preview');
  });
  it('a disabled term offers Enable instead', () => {
    expect(r(h(TermEditorPopover, { ...base, term: disabledTerm }))).toContain('>Enable</button>');
  });
  it('an unmatched heading gets the honest warning + one-click convert', () => {
    const html = r(h(TermEditorPopover, { ...base, term: unmatched }));
    expect(html).toContain('Heading not found');
    expect(html).toContain('Convert to keyword');
  });
  it('duplicate resolution actions name the other concept', () => {
    const html = r(h(TermEditorPopover, {
      ...base,
      dupInfo: { otherLabel: 'Population', onKeepHere: () => {}, onMoveThere: () => {} },
    }));
    expect(html).toContain('Also in Population');
    expect(html).toContain('Keep here, remove from Population');
    expect(html).toContain('Keep in Population, remove here');
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

/* ── SuggestionsDisclosure ────────────────────────────────────────────────── */
describe('SuggestionsDisclosure — review surface', () => {
  const suggs = [
    { key: 'rej:P:t2dm', text: 'Diabetes Mellitus, Type 2', kind: 'mesh', why: 'Standard subject heading for "t2dm"', sourceText: 't2dm' },
    { key: 'rej:P:hf', text: 'Heart Failure', kind: 'mesh', why: 'Standard subject heading for "heart failure"', sourceText: 'heart failure' },
    { key: 'rej:P:syn', text: 'metformin', kind: 'synonyms', why: 'Entry terms for "metformin"', synonyms: ['dimethylbiguanide'] },
  ];
  it('renders rows with kind badge, why line, Accept + Dismiss', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: suggs, onAccept: () => {}, onDismiss: () => {} }));
    expect(html).toContain('data-testid="sb-suggestions"');
    expect((html.match(/data-testid="sb-suggestion-row"/g) || []).length).toBe(3);
    expect(html).toContain('Subject heading');
    expect(html).toContain('aria-label="Accept suggestion Heart Failure"');
    expect(html).toContain('aria-label="Dismiss suggestion Heart Failure"');
    expect(html).toContain('Standard subject heading for');
  });
  it('bulk "Accept all subject headings" appears with ≥2 heading suggestions', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: suggs, onAcceptAllHeadings: () => {} }));
    expect(html).toContain('data-testid="sb-accept-all-headings"');
    expect(html).toContain('Accept all 2 subject headings');
  });
  it('empty state is friendly, not blank', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: [] }));
    expect(html).toContain('No suggestions right now — they appear as you add terms.');
  });
  it('dismissed rejections are listed with one-click restore ("Show dismissed")', () => {
    const closed = r(h(SuggestionsDisclosure, { suggestions: [], rejectedEntries: [{ key: 'rej:P:eus', label: 'eus' }], onToggleShowDismissed: () => {} }));
    expect(closed).toContain('Show dismissed (1)');
    const open = r(h(SuggestionsDisclosure, { suggestions: [], rejectedEntries: [{ key: 'rej:P:eus', label: 'eus' }], showDismissed: true, onUnreject: () => {} }));
    expect(open).toContain('aria-label="Restore suggestion eus"');
  });
  it('the hidden-terms restore panel lives INSIDE the disclosure', () => {
    const html = r(h(SuggestionsDisclosure, {
      suggestions: [],
      ignoredGroups: [{ field: 'Population', label: 'Population', items: [{ text: 'adults', field: 'Population', label: 'Population' }] }],
      onRestoreTerm: () => {}, onRestoreField: () => {}, onRestoreAll: () => {},
    }));
    expect(html).toContain('data-testid="sb-hidden-terms"');
    expect(html).toContain('aria-label="Restore adults"');
    expect(html).toContain('↺ Restore all (1)');
  });
});

/* ── StrategyPreviewPanel ─────────────────────────────────────────────────── */
describe('StrategyPreviewPanel — the honest human-readable preview', () => {
  const concepts = [{ ...P, op: 'OR' }, I, { id: 'cO', label: 'Outcomes', picoField: 'O', field: 'Outcomes', op: 'AND', terms: [] }];
  const base = { concepts, activeId: 'cP', hitState: null, onToggleOp: () => {}, pubmedQuery: 'x[tiab] AND y[tiab]' };
  it('renders one row per non-empty concept with the searched terms OR-ed + the pinned testid', () => {
    const html = r(h(StrategyPreviewPanel, { ...base, beginner: true }));
    expect(html).toContain('data-testid="sb-strategy-preview"');
    expect((html.match(/data-testid="sb-preview-row"/g) || []).length).toBe(2);
    // chips show the SEARCHED term (descriptor for controlled)
    expect(html).toContain('Diabetes Mellitus, Type 2 OR metformin');
  });
  it('uses the ACTUAL op from state — an OR join renders OR, read-only in beginner mode', () => {
    const html = r(h(StrategyPreviewPanel, { ...base, beginner: true }));
    expect(html).toContain('data-testid="sb-preview-op"');
    expect(html).toContain('>OR</span>');           // read-only span, not a button
    expect(html).not.toContain('click to switch');
  });
  it('expert mode makes the op chip a toggle button (both operands visible here)', () => {
    const html = r(h(StrategyPreviewPanel, { ...base, beginner: false }));
    expect(html).toContain('aria-label="Joined with OR — click to switch to AND"');
  });
  it('highlights the ACTIVE concept row with an editing tag', () => {
    const html = r(h(StrategyPreviewPanel, { ...base, beginner: true }));
    expect(html).toContain('data-testid="sb-preview-editing"');
  });
  it('raw PubMed syntax hides behind a native-details disclosure', () => {
    const html = r(h(StrategyPreviewPanel, { ...base, beginner: true }));
    expect(html).toContain('Show database syntax');
    expect(html).toContain('data-testid="sb-preview-syntax"');
    expect(html).toContain('<details');
  });
  it('empty concepts are named as not-in-the-search (never silently dropped)', () => {
    const html = r(h(StrategyPreviewPanel, { ...base, beginner: true }));
    expect(html).toContain('Not in the search yet (no terms): Outcomes');
  });
  it('a failed live count gets an inline Retry; an updated one shows the count as live', () => {
    const failed = r(h(StrategyPreviewPanel, { ...base, beginner: true, hitState: { status: 'failed' }, onRetryHits: () => {} }));
    expect(failed).toContain('estimate unavailable');
    expect(failed).toContain('Retry');
    const ok = r(h(StrategyPreviewPanel, { ...base, beginner: true, hitState: { status: 'updated', hitCount: 1234 } }));
    expect(ok).toContain('≈ 1,234 PubMed records');
  });
});
