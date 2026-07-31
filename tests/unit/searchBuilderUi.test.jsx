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
  it('termMicroBadges: field scope (ALWAYS for free text — 96.md D13.5) / truncation / phrase / provenance / disabled', () => {
    expect(termMicroBadges({ type: 'freetext', field: 'ti', text: 'x' }).map((b) => b.key)).toEqual(['field']);
    expect(termMicroBadges({ type: 'freetext', field: 'all', text: 'x' })[0].label).toBe('everywhere');
    // the DEFAULT scope is named too — every free-text chip says where it searches
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x' })[0].label).toBe('title/abstract');
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x', truncate: true }).map((b) => b.key)).toEqual(['field', 'truncate']);
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'heart attack', phrase: true }).map((b) => b.key)).toEqual(['field', 'phrase']);
    expect(termMicroBadges(disabledTerm).map((b) => b.key)).toEqual(['field', 'source', 'off']);
  });
  it('termMicroBadges: provenance — suggested (synonym/legacy auto) vs manual (96.md spec C)', () => {
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x', source: 'synonym' }).map((b) => b.label)).toContain('suggested');
    expect(termMicroBadges({ type: 'freetext', field: 'tiab', text: 'x', source: 'pico_auto' }).map((b) => b.label)).toContain('suggested');
    expect(termMicroBadges(freetext).map((b) => b.label)).toContain('manual'); // user_added
    // controlled terms carry no field/source noise (the MeSH badge is theirs)
    expect(termMicroBadges({ type: 'controlled', text: 'x', vocab: { mesh: 'X' } })).toEqual([]);
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
    expect(html).toContain('any one of them counts as a match'); // + the explicit within-group OR label (96.md D13.4)
    expect(html).toContain('combined with');
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
  it('96.md D13.4 — the op chip is a toggle BUTTON in the main flow (not expert-gated)', () => {
    for (const beginner of [true, false]) {
      const html = r(h(StrategyPreviewPanel, { ...base, beginner }));
      expect(html).toContain('data-testid="sb-preview-op"');
      expect(html).toContain('aria-label="Joined with OR — click to switch to AND"');
    }
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

/* ══════════════ 96.md D13 — QuestionPhraseCard + QuestionDriftBanner ═══════════ */

import { QuestionPhraseCard, QuestionDriftBanner } from '../../src/features/searchBuilder/SearchBuilderTab.jsx';

describe('QuestionPhraseCard — phrase selection on the research question (96.md D13.1/2)', () => {
  const base = {
    question: 'Do SGLT2 inhibitors reduce hospital readmission in adults with heart failure?',
    accent: '#8859ff',
    isSelected: (text) => text.toLowerCase() === 'heart failure',
    onTogglePhrase: () => {}, onAddManual: () => {}, onEditQuestion: () => {},
  };
  it('renders the pinned testid, the question tokens as aria-pressed buttons, and the Edit link', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('data-testid="sb-question-card"');
    expect(html).toContain('Research question');
    expect(html).toContain('Edit question');
    // Selected phrase reads pressed with the ✓ prefix (never colour-only)…
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('✓ heart failure');
    // …and unselected suggestions stay pressable.
    expect(html).toContain('aria-pressed="false"');
  });
  it('offers the manual add-concept box with an accessible label', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('aria-label="Add a concept group manually"');
    expect(html).toContain('+ Add concept');
  });
  it('empty question → the guidance to the Research Question stage, no dead surface', () => {
    const html = r(h(QuestionPhraseCard, { ...base, question: '' }));
    expect(html).toContain('No research question yet');
    expect(html).toContain('Research Question');
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

/* ══════════ 96.md QA fixes — M3/M4/M5/M6/M8/L5 SSR contracts ══════════ */

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
    // the e2e page object locates tokens by role=button + accessible name:
    expect(html).toContain('aria-label="heart failure"');        // curated phrase token
    expect(html).toContain('aria-label="hospital readmission"'); // vocabulary phrase token
    expect(html).toContain('aria-label="reduce"');               // plain word token
  });
  it('filler/noise words ("adults", "in") render dimmed but CLICKABLE (buttons, not spans)', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('aria-label="adults"'); // NOISE word — clickable-on-intent (QA M5)
    expect(html).toContain('aria-label="in"');     // connector — clickable-on-intent
    // no token renders as a plain non-interactive span any more
    expect(html).not.toMatch(/<span[^>]*>adults <\/span>/);
  });
  it('the span-selection instruction line exists and tokens reference it via aria-describedby', () => {
    const html = r(h(QuestionPhraseCard, base));
    expect(html).toContain('data-testid="sb-span-hint"');
    expect(html).toContain('Shift-click another word');
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
  it('M4: shows the originating phrase with an inline Update phrase affordance', () => {
    const html = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', onUpdateSourcePhrase: () => {} }));
    expect(html).toContain('data-testid="sb-source-phrase"');
    expect(html).toContain('From the question phrase');
    expect(html).toContain('aria-label="Update the phrase for Mortality"');
  });
  it('M6: the fixed-OR guidance offers the supported AND path — split into separate groups', () => {
    const html = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', onRequestSplit: () => {} }));
    expect(html).toContain('data-testid="sb-and-hint"');
    expect(html).toContain('Split them into separate groups');
    // without the seam (read-only / too few terms) the hint disappears
    const none = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready' }));
    expect(none).not.toContain('data-testid="sb-and-hint"');
  });
  it('M8: read-only makes the rename input inert with an access explanation', () => {
    const html = r(h(ActiveConceptPanel, { concept: withPhrase, conceptIndex: 0, status: 'ready', readOnly: true }));
    expect(html).toContain('readonly');
    expect(html).toContain('Read-only access');
    expect(html).not.toContain('Update phrase');
  });
});

describe('QA M3 — TermEditorPopover within-group reorder buttons', () => {
  it('renders labelled Move earlier / Move later with edge disabling', () => {
    const html = r(h(TermEditorPopover, {
      term: freetext, beginner: true, moveTargets: [],
      onReorder: () => {}, canMoveEarlier: false, canMoveLater: true,
      onChange: () => {}, onClose: () => {}, onToggleDisabled: () => {}, onRemove: () => {},
    }));
    expect(html).toContain('data-testid="sb-term-move-earlier"');
    expect(html).toContain('data-testid="sb-term-move-later"');
    expect(html).toContain('aria-label="Move metformin earlier in the group"');
    expect(html).toContain('Already first in the group');
  });
  it('without the onReorder seam the section is absent (leaf stays reusable)', () => {
    const html = r(h(TermEditorPopover, {
      term: freetext, beginner: true, moveTargets: [],
      onChange: () => {}, onClose: () => {}, onToggleDisabled: () => {}, onRemove: () => {},
    }));
    expect(html).not.toContain('sb-term-move-earlier');
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

describe('QA M8 — SuggestionsDisclosure read-only: disabled actions with explanation', () => {
  const sugg = [{ key: 'k1', kind: 'mesh', text: 'Diabetes Mellitus, Type 2', why: 'why', vocab: VOCAB }];
  it('Accept/Dismiss render disabled + aria-disabled with the access title', () => {
    const html = r(h(SuggestionsDisclosure, { suggestions: sugg, readOnly: true, onAccept: () => {}, onDismiss: () => {} }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Read-only access');
  });
});

describe('QA L5/M8 — StrategyPreviewPanel: rows are real buttons; read-only op chip', () => {
  const concepts2 = [
    { id: 'a', label: 'HF', op: 'AND', terms: [{ id: 'p1', text: 'heart failure', type: 'freetext' }] },
    { id: 'b', label: 'Rx', op: 'AND', terms: [{ id: 'p2', text: 'metformin', type: 'freetext' }] },
  ];
  it('L5: each concept row is a <button> (keyboard reachable), not a div onClick', () => {
    const html = r(h(StrategyPreviewPanel, { concepts: concepts2, activeId: 'a', beginner: true, onSelectConcept: () => {}, onToggleOp: () => {} }));
    expect(html).toMatch(/<button[^>]*data-testid="sb-preview-row"/);
  });
  it('M8: read-only disables the AND/OR toggle with an access explanation', () => {
    const html = r(h(StrategyPreviewPanel, { concepts: concepts2, activeId: 'a', beginner: true, readOnly: true, onSelectConcept: () => {}, onToggleOp: () => {} }));
    expect(html).toMatch(/<button[^>]*data-testid="sb-preview-op"[^>]*disabled/);
    expect(html).toContain('Read-only access');
  });
});
