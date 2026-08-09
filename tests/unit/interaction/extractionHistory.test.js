/**
 * extractionHistory.test.js — 108.md §5, §8, §12-15. Extraction Undo/Redo.
 *
 * Two halves, both required:
 *
 *  1. THE PURE LAYER. Entry builders, the coalescing predicate, the precondition and
 *     the write appliers are exercised against REAL `studies[]` fixtures built with
 *     `mkStudy` + `attachProvenanceMany`, and the inverses are round-tripped through
 *     `applyExtractionWrite` — the very function `PecanExtractionEngine.writeStudy`
 *     calls. So "undo restores the provenance verbatim" is proved on the real data
 *     structures, not on a mock.
 *
 *  2. SOURCE PINS. `ArticleWorkspace.jsx` (1,000 lines) and `extractionTabs.jsx`
 *     (1,300 lines) are stateful components and the repo has no jsdom, so the wiring
 *     is asserted by reading the source — the pattern established by
 *     tests/unit/screening/keywordUndoWiring.test.js. These pins fail if the executor
 *     is ever re-routed through `setFields` (which would destroy click provenance —
 *     the 108.md §8 pitfall), if a select stops being discrete, or if the autosave
 *     stacks stop being replace-not-queue (the §14 race argument depends on it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup as ssr } from 'react-dom/server';
import {
  EXTRACTION_HISTORY_KIND, EXTRACTION_ENTRY_LABEL, EXTRACTION_COALESCE_WINDOW_MS,
  EXTRACTION_SURFACE, normalizeFieldValue, sameFieldValue, matchesExpected,
  isTypingContinuation, entityKeyFor, buildExtractionEntry, canMergeExtractionEdit,
  splitProvenanceEntries, removeProvenanceFields, applyExtractionWrite, applyRowPatch,
  findStudyRow,
} from '../../../src/research-engine/interaction/extractionHistory.js';
import {
  emptyHistory, coalesceOrRecord, recordAction, peekUndo,
} from '../../../src/research-engine/interaction/historyStacks.js';
import { HistoryProvider, stampEntry } from '../../../src/frontend/history/HistoryContext.jsx';
import ArticleWorkspace from '../../../src/features/extraction/engine/ArticleWorkspace.jsx';
import PecanExtractionEngine from '../../../src/features/extraction/engine/PecanExtractionEngine.jsx';
import { mkStudy } from '../../../src/research-engine/project-model/defaults.js';
import {
  attachProvenanceMany, readProvenance, hasSourceEvidence,
} from '../../../src/research-engine/extraction/engine/articleProvenance.js';
import { denominatorPopulationPatch } from '../../../src/research-engine/extraction/proportionMeta.js';
import { enableCaseSeries, addCase, casesForPublication } from '../../../src/research-engine/extraction/caseSeries.js';

const SRC = (rel) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), 'utf8');
const WORKSPACE = SRC('features/extraction/engine/ArticleWorkspace.jsx');
const ENGINE = SRC('features/extraction/engine/PecanExtractionEngine.jsx');
const CLASSIC = SRC('frontend/workspace/tabs/extractionTabs.jsx');

const AT = '2026-02-01T10:00:00.000Z';

/* ── fixtures ──────────────────────────────────────────────────────────────────── */

/** A PROP row whose Events value was PICKED off page 4 of the PDF (page + bbox + history). */
const CLICK_PROV = Object.freeze({
  method: 'click', page: 4, bbox: { x0: 10, y0: 20, x1: 130, y1: 44 },
  fileKey: 'doc:paper.pdf', excerpt: '23 of 59 patients',
  at: '2026-01-01T00:00:00.000Z',
  history: [{ value: '19', method: 'manual', at: '2025-12-31T00:00:00.000Z' }],
});

function pickedRow(over = {}) {
  const base = {
    ...mkStudy(), id: 's1', author: 'Smith', year: '2024', outcome: 'Diagnostic yield',
    esType: 'PROP', events: '23', total: '59', needsReview: false, ...over,
  };
  return attachProvenanceMany(base, { events: CLICK_PROV });
}

/**
 * The forward MANUAL write, mirroring ArticleWorkspace.setFields exactly (the
 * downgrade it performs is source-pinned below, so this helper cannot silently drift
 * from the real thing).
 * @returns {{patch:object, provEntry:(object|undefined)}}
 */
function manualSetFields(study, fields, now = AT) {
  let provEntry = null;
  for (const f of Object.keys(fields)) {
    const prior = readProvenance(study, f);
    const changed = String(study[f] || '') !== String(fields[f]);
    if (prior && (prior.page || prior.bbox || prior.method) && changed) {
      const history = Array.isArray(prior.history) ? prior.history.slice(-10) : [];
      if (study[f] !== '' && study[f] != null) history.push({ value: String(study[f]), method: prior.method || 'manual', at: now });
      provEntry = provEntry || {};
      provEntry[f] = { method: 'manual', page: null, bbox: null, history: history.length ? history : undefined };
    }
  }
  return { patch: { ...fields, needsReview: true }, provEntry: provEntry || undefined };
}

/** The engine write, exactly as PecanExtractionEngine.writeStudy performs it. */
const write = (studies, id, patch, prov, at = AT) => applyExtractionWrite(studies, id, patch, prov, { at });

let seq = 0;
const stamp = (entry, at) => stampEntry(entry, {
  idFn: () => `h${++seq}`, now: () => at, scope: 'extraction', projectId: 'p1',
});

/* ══════════════════ value comparison + precondition (§14/§15) ══════════════════ */

describe('normalizeFieldValue / sameFieldValue', () => {
  it('treats a MISSING key and "" as the same state (the 107.md §8C legacy contract)', () => {
    expect(normalizeFieldValue(undefined)).toBe('');
    expect(normalizeFieldValue(null)).toBe('');
    expect(sameFieldValue(undefined, '')).toBe(true);
    expect(sameFieldValue(null, '')).toBe(true);
  });

  it('coerces numbers and booleans, and structurally compares arrays/objects', () => {
    expect(sameFieldValue(12, '12')).toBe(true);
    expect(sameFieldValue(false, 'false')).toBe(true);
    expect(sameFieldValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameFieldValue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameFieldValue('23', '25')).toBe(false);
  });
});

describe('matchesExpected — the executor precondition (108.md §14/§15)', () => {
  const row = pickedRow();

  it('accepts a row that still holds every expected value', () => {
    expect(matchesExpected(row, { events: '23', total: '59' })).toBe(true);
  });

  it('REFUSES when a collaborator moved the value in the meantime', () => {
    expect(matchesExpected({ ...row, events: '31' }, { events: '23' })).toBe(false);
  });

  it('refuses when the row has vanished, and passes an empty/absent expectation', () => {
    expect(matchesExpected(null, { events: '23' })).toBe(false);
    expect(matchesExpected(row, {})).toBe(true);
    expect(matchesExpected(row, undefined)).toBe(true);
  });

  it('does not refuse merely because the forward write CREATED the key', () => {
    const legacy = { ...pickedRow() };
    delete legacy.denominatorPopulation;
    expect(matchesExpected(legacy, { denominatorPopulation: '' })).toBe(true);
  });
});

describe('findStudyRow', () => {
  it('finds by id and tolerates junk', () => {
    const rows = [null, { id: 'a' }, { id: 's1' }];
    expect(findStudyRow(rows, 's1')).toEqual({ id: 's1' });
    expect(findStudyRow(rows, 'nope')).toBe(null);
    expect(findStudyRow(null, 's1')).toBe(null);
  });
});

/* ══════════════════ entry builder ══════════════════ */

describe('buildExtractionEntry — one entry per user intent (108.md §12)', () => {
  const row = pickedRow();

  it('records nothing when the write changes no primary value', () => {
    expect(buildExtractionEntry({ study: row, patch: { events: '23', needsReview: true }, primaryFields: ['events'] })).toBe(null);
    // …and nothing for junk input
    expect(buildExtractionEntry({ study: null, patch: { events: '1' } })).toBe(null);
    expect(buildExtractionEntry({ study: row, patch: {} })).toBe(null);
    expect(buildExtractionEntry({ study: { events: '1' }, patch: { events: '2' } })).toBe(null);  // no id
  });

  it('carries the §17 label verbatim and the field label in meta', () => {
    const e = buildExtractionEntry({ study: row, patch: { events: '25' }, fieldLabel: 'Events' });
    expect(e.kind).toBe(EXTRACTION_HISTORY_KIND);
    expect(e.label).toBe(EXTRACTION_ENTRY_LABEL);
    expect(EXTRACTION_ENTRY_LABEL).toBe('Extraction change');   // "Extraction change undone"
    expect(e.meta).toMatchObject({ studyId: 's1', field: 'events', fieldLabel: 'Events', surface: 'engine', discrete: false });
    expect(e.entityKey).toBe(entityKeyFor('s1', ['events']));
  });

  it('snapshots prev/next for EVERY patch key and expects only the primary fields', () => {
    const { patch, provEntry } = manualSetFields(row, { events: '25' });
    const e = buildExtractionEntry({ study: row, patch, primaryFields: ['events'], provenanceNext: provEntry });
    // every key of the patch is restorable — including the bookkeeping needsReview
    expect(e.undoOp.fields).toEqual({ events: '23', needsReview: false });
    expect(e.redoOp.fields).toEqual({ events: '25', needsReview: true });
    // the precondition covers the VALUE the user changed, not the bookkeeping
    expect(e.undoOp.expect).toEqual({ events: '25' });
    expect(e.redoOp.expect).toEqual({ events: '23' });
  });

  it('snapshots the FULL prior provenance entry, history array included', () => {
    const { patch, provEntry } = manualSetFields(row, { events: '25' });
    const e = buildExtractionEntry({ study: row, patch, primaryFields: ['events'], provenanceNext: provEntry });
    const prev = e.undoOp.provenance.events;
    expect(prev).toMatchObject({
      field: 'events', method: 'click', page: 4,
      bbox: { x0: 10, y0: 20, x1: 130, y1: 44 },
      fileKey: 'doc:paper.pdf', excerpt: '23 of 59 patients',
    });
    expect(prev.history).toEqual([{ value: '19', method: 'manual', at: '2025-12-31T00:00:00.000Z' }]);
    expect(prev).toEqual(readProvenance(row, 'events'));
  });

  it('snapshots NULL for a field that had no provenance (undo must DELETE, not fabricate)', () => {
    const bare = { ...mkStudy(), id: 's1', esType: 'PROP' };
    const e = buildExtractionEntry({
      study: bare, patch: { events: '23', needsReview: true }, primaryFields: ['events'],
      provenanceNext: { events: { method: 'click', page: 2 } },
    });
    expect(e.undoOp.provenance).toEqual({ events: null });
    expect(e.redoOp.provenance).toEqual({ events: { method: 'click', page: 2 } });
  });

  it('the COMBINED denominator patch snapshots BOTH keys so one undo restores both', () => {
    // 107.md §8A: switching away from Other/custom also clears the free-text description.
    const other = pickedRow({ denominatorPopulation: 'other', denominatorCustom: 'Completed counselling' });
    const patch = denominatorPopulationPatch(other, 'all_patients_tested');
    expect(patch).toEqual({ denominatorPopulation: 'all_patients_tested', denominatorCustom: '' });
    const e = buildExtractionEntry({ study: other, patch: { ...patch, needsReview: true }, primaryFields: Object.keys(patch), discrete: true });
    expect(e.undoOp.fields).toEqual({
      denominatorPopulation: 'other', denominatorCustom: 'Completed counselling', needsReview: false,
    });
    expect(e.undoOp.expect).toEqual({ denominatorPopulation: 'all_patients_tested', denominatorCustom: '' });
    expect(e.meta.discrete).toBe(true);
    expect(e.entityKey).toBe(entityKeyFor('s1', ['denominatorCustom', 'denominatorPopulation']));
  });
});

/* ══════════════════ coalescing (108.md §13) ══════════════════ */

describe('typed edits coalesce into ONE entry (108.md §13 — not 42 Ctrl+Z presses)', () => {
  /** Type `text` one character at a time through the real record path. */
  function type(startRow, field, text, { start = 1000, step = 100, discrete = false } = {}) {
    let hist = emptyHistory();
    let row = startRow;
    let t = start;
    for (let i = 1; i <= text.length; i++) {
      const value = text.slice(0, i);
      const patch = { [field]: value, needsReview: true };
      const entry = buildExtractionEntry({ study: row, patch, primaryFields: [field], discrete });
      if (entry) {
        const stamped = stamp(entry, t);
        hist = discrete
          ? recordAction(hist, stamped)
          : coalesceOrRecord(hist, stamped, canMergeExtractionEdit);
      }
      row = { ...row, ...patch };
      t += step;
    }
    return { hist, row };
  }

  const PHRASE = 'Patients with confirmed molecular diagnosis';
  const base = pickedRow({ denominatorPopulation: 'other', denominatorCustom: '' });

  it('42 keystrokes become ONE entry keeping the FIRST prev and the LAST next', () => {
    expect(PHRASE.length).toBe(43);   // §13's "42 Ctrl+Z presses" example, counted exactly
    const { hist } = type(base, 'denominatorCustom', PHRASE);
    expect(hist.extraction.undo).toHaveLength(1);
    const top = peekUndo(hist, 'extraction');
    expect(top.undoOp.fields.denominatorCustom).toBe('');        // where Ctrl+Z lands
    expect(top.redoOp.fields.denominatorCustom).toBe(PHRASE);    // where Ctrl+Shift+Z lands
    expect(top.meta.coalesced).toBe(PHRASE.length);
    expect(top.id).toBe(peekUndo(hist, 'extraction').id);        // the merged entry keeps its id
  });

  it('backspacing stays in the same entry (it is still one edit)', () => {
    let hist = emptyHistory();
    let row = base;
    let t = 1000;
    for (const v of ['ab', 'abc', 'ab', 'a']) {
      const patch = { denominatorCustom: v, needsReview: true };
      const e = buildExtractionEntry({ study: row, patch, primaryFields: ['denominatorCustom'] });
      hist = coalesceOrRecord(hist, stamp(e, t), canMergeExtractionEdit);
      row = { ...row, ...patch };
      t += 50;
    }
    expect(hist.extraction.undo).toHaveLength(1);
    expect(peekUndo(hist, 'extraction').redoOp.fields.denominatorCustom).toBe('a');
  });

  it('a different FIELD breaks the chain (top of stack no longer matches)', () => {
    const a = stamp(buildExtractionEntry({ study: base, patch: { events: '2' }, primaryFields: ['events'] }), 1000);
    const rowA = { ...base, events: '2' };
    const b = stamp(buildExtractionEntry({ study: rowA, patch: { total: '5' }, primaryFields: ['total'] }), 1100);
    let hist = coalesceOrRecord(emptyHistory(), a, canMergeExtractionEdit);
    hist = coalesceOrRecord(hist, b, canMergeExtractionEdit);
    expect(hist.extraction.undo).toHaveLength(2);
  });

  it('a different STUDY breaks the chain', () => {
    const other = pickedRow({ id: 's2' });
    const a = stamp(buildExtractionEntry({ study: base, patch: { events: '2' }, primaryFields: ['events'] }), 1000);
    const b = stamp(buildExtractionEntry({ study: other, patch: { events: '2' }, primaryFields: ['events'] }), 1100);
    let hist = coalesceOrRecord(emptyHistory(), a, canMergeExtractionEdit);
    hist = coalesceOrRecord(hist, b, canMergeExtractionEdit);
    expect(hist.extraction.undo).toHaveLength(2);
  });

  it('a DISCRETE action never merges — selects and picks are their own entry', () => {
    const { hist } = type(base, 'denominatorCustom', 'abcd', { discrete: true });
    expect(hist.extraction.undo).toHaveLength(4);
    // …and a discrete entry does not absorb a following keystroke either
    const disc = stamp(buildExtractionEntry({ study: base, patch: { events: '2' }, primaryFields: ['events'], discrete: true }), 1000);
    const typed = stamp(buildExtractionEntry({ study: { ...base, events: '2' }, patch: { events: '23' }, primaryFields: ['events'] }), 1100);
    expect(canMergeExtractionEdit(disc, typed)).toBe(false);
  });

  it('a BROKEN chain does not merge (something else wrote the field in between)', () => {
    const a = stamp(buildExtractionEntry({ study: base, patch: { events: '2' }, primaryFields: ['events'] }), 1000);
    // a click-to-pick landed 99 in the field; the next keystroke starts from there
    const b = stamp(buildExtractionEntry({ study: { ...base, events: '99' }, patch: { events: '991' }, primaryFields: ['events'] }), 1100);
    expect(canMergeExtractionEdit(a, b)).toBe(false);
  });

  it('a pause longer than the idle window starts a new entry', () => {
    const a = stamp(buildExtractionEntry({ study: base, patch: { events: '2' }, primaryFields: ['events'] }), 1000);
    const b = stamp(buildExtractionEntry({ study: { ...base, events: '2' }, patch: { events: '23' }, primaryFields: ['events'] }), 1000 + EXTRACTION_COALESCE_WINDOW_MS + 1);
    expect(canMergeExtractionEdit(a, b)).toBe(false);
    const c = stamp(buildExtractionEntry({ study: { ...base, events: '2' }, patch: { events: '23' }, primaryFields: ['events'] }), 1000 + EXTRACTION_COALESCE_WINDOW_MS);
    expect(canMergeExtractionEdit(a, c)).toBe(true);
  });

  it('the window is ROLLING — a long steady typing run stays one entry', () => {
    const { hist } = type(base, 'denominatorCustom', PHRASE, { step: EXTRACTION_COALESCE_WINDOW_MS - 1 });
    expect(hist.extraction.undo).toHaveLength(1);
  });

  it('two select-shaped changes of one field do NOT merge (not a typing continuation)', () => {
    const a = stamp(buildExtractionEntry({ study: base, patch: { design: 'RCT' }, primaryFields: ['design'] }), 1000);
    const b = stamp(buildExtractionEntry({ study: { ...base, design: 'RCT' }, patch: { design: 'Cohort' }, primaryFields: ['design'] }), 1100);
    expect(canMergeExtractionEdit(a, b)).toBe(false);
  });

  it('a checkbox (boolean) never merges either', () => {
    const a = stamp(buildExtractionEntry({ study: base, patch: { needsReview: true }, primaryFields: ['needsReview'] }), 1000);
    const b = stamp(buildExtractionEntry({ study: { ...base, needsReview: true }, patch: { needsReview: false }, primaryFields: ['needsReview'] }), 1100);
    expect(canMergeExtractionEdit(a, b)).toBe(false);
  });

  it('a multi-field patch never merges (the combined denominator write)', () => {
    const other = pickedRow({ denominatorPopulation: 'other', denominatorCustom: 'x' });
    const p1 = denominatorPopulationPatch(other, 'all_patients_tested');
    const a = stamp(buildExtractionEntry({ study: other, patch: p1, primaryFields: Object.keys(p1) }), 1000);
    const rowA = { ...other, ...p1 };
    const p2 = denominatorPopulationPatch(rowA, 'patients_with_follow_up');
    const b = stamp(buildExtractionEntry({ study: rowA, patch: p2, primaryFields: Object.keys(p2) }), 1100);
    expect(canMergeExtractionEdit(a, b)).toBe(false);
  });

  it('entries from DIFFERENT surfaces never merge', () => {
    const a = stamp(buildExtractionEntry({ study: base, patch: { events: '2' }, primaryFields: ['events'], surface: EXTRACTION_SURFACE.ENGINE }), 1000);
    const b = stamp(buildExtractionEntry({ study: { ...base, events: '2' }, patch: { events: '23' }, primaryFields: ['events'], surface: EXTRACTION_SURFACE.CLASSIC }), 1100);
    expect(canMergeExtractionEdit(a, b)).toBe(false);
  });

  it('canMergeExtractionEdit is defensive about junk', () => {
    expect(canMergeExtractionEdit(null, null)).toBe(false);
    expect(canMergeExtractionEdit({ kind: 'other' }, { kind: EXTRACTION_HISTORY_KIND })).toBe(false);
  });
});

describe('isTypingContinuation', () => {
  it('accepts appends and truncations, rejects replacements and identity', () => {
    expect(isTypingContinuation('Pat', 'Pati')).toBe(true);
    expect(isTypingContinuation('Pati', 'Pat')).toBe(true);
    expect(isTypingContinuation('', 'P')).toBe(true);
    expect(isTypingContinuation('RCT', 'Cohort')).toBe(false);
    expect(isTypingContinuation('abc', 'abc')).toBe(false);
  });

  it('rejects non-text values outright (booleans, arrays, objects)', () => {
    expect(isTypingContinuation(true, false)).toBe(false);
    expect(isTypingContinuation(['a'], ['a', 'b'])).toBe(false);
    expect(isTypingContinuation({}, { a: 1 })).toBe(false);
  });
});

/* ══════════════════ inverse round trips on real rows (108.md §8) ══════════════════ */

describe('undo restores the PROVENANCE verbatim — the 108.md §8 pitfall', () => {
  it('click → manual edit → undo keeps jump-to-source working', () => {
    const row = pickedRow();
    expect(hasSourceEvidence(row, 'events')).toBe(true);

    const { patch, provEntry } = manualSetFields(row, { events: '25' });
    const entry = buildExtractionEntry({ study: row, patch, primaryFields: ['events'], provenanceNext: provEntry });

    // forward: the manual edit downgrades provenance and flags the row for review
    const after = write([row], 's1', patch, provEntry);
    expect(after[0].events).toBe('25');
    expect(after[0].needsReview).toBe(true);
    expect(readProvenance(after[0], 'events')).toMatchObject({ method: 'manual', page: null, bbox: null });
    expect(hasSourceEvidence(after[0], 'events')).toBe(false);      // the source link is gone

    // precondition holds, then undo through the SAME write path
    expect(matchesExpected(after[0], entry.undoOp.expect)).toBe(true);
    const undone = write(after, 's1', entry.undoOp.fields, entry.undoOp.provenance);
    expect(undone[0].events).toBe('23');
    expect(undone[0].needsReview).toBe(false);                      // restored verbatim, not left true
    expect(readProvenance(undone[0], 'events')).toEqual(readProvenance(row, 'events'));
    expect(hasSourceEvidence(undone[0], 'events')).toBe(true);
    expect(readProvenance(undone[0], 'events').bbox).toEqual({ x0: 10, y0: 20, x1: 130, y1: 44 });
    expect(readProvenance(undone[0], 'events').history).toEqual(CLICK_PROV.history);

    // redo re-applies the manual edit exactly
    expect(matchesExpected(undone[0], entry.redoOp.expect)).toBe(true);
    const redone = write(undone, 's1', entry.redoOp.fields, entry.redoOp.provenance);
    expect(redone[0].events).toBe('25');
    expect(redone[0].needsReview).toBe(true);
    expect(readProvenance(redone[0], 'events')).toEqual(readProvenance(after[0], 'events'));
  });

  it('undoing a FIRST click-to-pick REMOVES the provenance entry it created', () => {
    const bare = { ...mkStudy(), id: 's1', esType: 'PROP', total: '59', needsReview: false };
    const provFields = { events: { method: 'click', page: 4, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 }, fileKey: 'doc:paper.pdf', at: AT } };
    const patch = { events: '23', needsReview: true, source: 'text' };
    const entry = buildExtractionEntry({ study: bare, patch, primaryFields: ['events'], provenanceNext: provFields, discrete: true });

    const after = write([bare], 's1', patch, provFields);
    expect(hasSourceEvidence(after[0], 'events')).toBe(true);

    const undone = write(after, 's1', entry.undoOp.fields, entry.undoOp.provenance);
    expect(undone[0].events).toBe('');
    expect(undone[0].source).toBe(bare.source);
    expect(readProvenance(undone[0], 'events')).toBe(null);
    // …and the empty map is dropped rather than left as `provenance: {}`
    expect((undone[0].extractionMeta || {}).provenance).toBeUndefined();
  });

  it('the combined denominator patch round-trips BOTH keys in one write', () => {
    const other = pickedRow({ denominatorPopulation: 'other', denominatorCustom: 'Completed counselling' });
    const patch = { ...denominatorPopulationPatch(other, 'all_patients_tested'), needsReview: true };
    const entry = buildExtractionEntry({ study: other, patch, primaryFields: ['denominatorPopulation', 'denominatorCustom'], discrete: true });

    const after = write([other], 's1', patch);
    expect(after[0].denominatorPopulation).toBe('all_patients_tested');
    expect(after[0].denominatorCustom).toBe('');

    const undone = write(after, 's1', entry.undoOp.fields, entry.undoOp.provenance);
    expect(undone[0].denominatorPopulation).toBe('other');
    expect(undone[0].denominatorCustom).toBe('Completed counselling');
    expect(undone[0].needsReview).toBe(false);

    const redone = write(undone, 's1', entry.redoOp.fields, entry.redoOp.provenance);
    expect(redone[0].denominatorPopulation).toBe('all_patients_tested');
    expect(redone[0].denominatorCustom).toBe('');
  });

  it('a Smart multi-field capture (es + lo + hi) is ONE reversible entry', () => {
    const row = { ...mkStudy(), id: 's1', esType: 'OR', es: '', lo: '', hi: '', needsReview: false };
    const provFields = {};
    for (const f of ['es', 'lo', 'hi']) provFields[f] = { method: 'click', page: 2, at: AT };
    const patch = { es: '0.4', lo: '0.1', hi: '0.7', needsReview: true, source: 'text' };
    const entry = buildExtractionEntry({ study: row, patch, primaryFields: ['es', 'lo', 'hi'], provenanceNext: provFields, discrete: true });

    const after = write([row], 's1', patch, provFields);
    const undone = write(after, 's1', entry.undoOp.fields, entry.undoOp.provenance);
    expect([undone[0].es, undone[0].lo, undone[0].hi]).toEqual(['', '', '']);
    for (const f of ['es', 'lo', 'hi']) expect(readProvenance(undone[0], f)).toBe(null);
  });

  it('an undo NEVER touches another row (108.md §15 — collaboration safety)', () => {
    const row = pickedRow();
    const mate = { ...mkStudy(), id: 's2', author: 'Nguyen', events: '7' };
    const { patch, provEntry } = manualSetFields(row, { events: '25' });
    const entry = buildExtractionEntry({ study: row, patch, primaryFields: ['events'], provenanceNext: provEntry });
    const after = write([row, mate], 's1', patch, provEntry);
    const undone = write(after, 's1', entry.undoOp.fields, entry.undoOp.provenance);
    expect(undone[1]).toBe(after[1]);            // same reference — untouched
    expect(undone[1].events).toBe('7');
  });

  it('a CASE row still fans article-level keys out to its siblings on undo (106.md)', () => {
    let n = 0;
    const en = enableCaseSeries([pickedRow({ doi: '10.1/smith' })], 's1', { idFn: () => `g${++n}` });
    const studies = addCase(en.studies, en.publicationId, { mkStudy, idFn: () => 'c2' }).studies;
    const cases = casesForPublication(studies, en.publicationId);
    const target = cases[0];
    const patch = { journal: 'J Med', needsReview: true };
    const entry = buildExtractionEntry({ study: target, patch, primaryFields: ['journal'] });
    const after = write(studies, target.id, patch);
    expect(casesForPublication(after, en.publicationId).map((c) => c.journal)).toEqual(['J Med', 'J Med']);
    const undone = write(after, target.id, entry.undoOp.fields, entry.undoOp.provenance);
    // the inverse rides the SAME propagation, so the sibling is reverted too
    for (const c of casesForPublication(undone, en.publicationId)) expect(c.journal || '').toBe(target.journal || '');
  });
});

/* ══════════════════ the classic surface ══════════════════ */

describe('applyRowPatch — the classic tab write/inverse (no provenance, no fan-out)', () => {
  it('round-trips a field and stamps updatedAt', () => {
    const row = { ...mkStudy(), id: 's1', author: 'Smith', design: 'RCT' };
    const entry = buildExtractionEntry({ study: row, patch: { design: 'Cohort' }, surface: EXTRACTION_SURFACE.CLASSIC, discrete: true });
    expect(entry.undoOp.surface).toBe('classic');
    const after = applyRowPatch([row], 's1', { design: 'Cohort' }, { at: AT });
    expect(after[0].design).toBe('Cohort');
    expect(after[0].updatedAt).toBe(AT);
    const undone = applyRowPatch(after, 's1', entry.undoOp.fields, { at: AT });
    expect(undone[0].design).toBe('RCT');
    expect(matchesExpected(after[0], entry.undoOp.expect)).toBe(true);
    expect(matchesExpected(undone[0], entry.undoOp.expect)).toBe(false);
  });

  it('leaves other rows alone and tolerates junk input', () => {
    const rows = [{ id: 'a', x: 1 }, { id: 'b', x: 2 }];
    const out = applyRowPatch(rows, 'a', { x: 9 });
    expect(out[1]).toBe(rows[1]);
    expect(out[0].updatedAt).toBeUndefined();
    expect(applyRowPatch(null, 'a', { x: 1 })).toEqual([]);
  });
});

/* ══════════════════ provenance map helpers ══════════════════ */

describe('splitProvenanceEntries / removeProvenanceFields', () => {
  it('splits null (remove) from entries (attach) and skips undefined', () => {
    expect(splitProvenanceEntries({ a: { method: 'click' }, b: null, c: undefined }))
      .toEqual({ attach: { a: { method: 'click' } }, remove: ['b'] });
    expect(splitProvenanceEntries(null)).toEqual({ attach: {}, remove: [] });
  });

  it('removeProvenanceFields is byte-stable when nothing was recorded', () => {
    const row = { ...mkStudy(), id: 's1' };
    expect(removeProvenanceFields(row, ['events'])).toBe(row);
    const picked = pickedRow();
    expect(removeProvenanceFields(picked, ['total'])).toBe(picked);
    expect(removeProvenanceFields(picked, [])).toBe(picked);
  });

  it('keeps the sibling entries of the map it prunes', () => {
    const row = attachProvenanceMany(pickedRow(), { total: { method: 'click', page: 4 } });
    const out = removeProvenanceFields(row, ['events']);
    expect(readProvenance(out, 'events')).toBe(null);
    expect(readProvenance(out, 'total')).toMatchObject({ method: 'click', page: 4 });
  });
});

describe('applyExtractionWrite', () => {
  it('returns the propagation result untouched when there is no provenance to write', () => {
    const row = pickedRow();
    const out = applyExtractionWrite([row], 's1', { events: '30' }, undefined, { at: AT });
    expect(out[0].events).toBe('30');
    expect(readProvenance(out[0], 'events')).toEqual(readProvenance(row, 'events'));
    expect(applyExtractionWrite(null, 's1', {}, null)).toEqual([]);
  });
});

/* ══════════════════ SSR — mounting history changes no markup ══════════════════ */

describe('both extraction surfaces render identically with and without a HistoryProvider', () => {
  // House style: renderToStaticMarkup, no jsdom — effects, clicks and the executor
  // registration do NOT run here. What this proves is the part SSR CAN prove: the hooks
  // are unconditional (no hook-order hazard), useProjectHistory is inert outside a
  // provider (so the engine can record before a shell mounts one), and wiring the
  // history in does not perturb the extraction form by a single byte.
  const row = pickedRow();
  const project = { id: 'p1', name: 'R', studies: [row], pico: {}, extractionDrafts: [] };

  it('ArticleWorkspace', () => {
    const el = () => h(ArticleWorkspace, {
      projectId: 'p1', study: row, article: { id: 's1', status: 'in_progress' }, studies: [row],
    });
    const bare = ssr(el());
    const wrapped = ssr(h(HistoryProvider, { projectId: 'p1', scope: 'extraction' }, el()));
    expect(bare).toContain('data-testid="pex-workspace"');
    expect(bare).toContain('data-testid="pex-field-denominatorPopulation"');
    expect(wrapped).toBe(bare);
  });

  it('PecanExtractionEngine (article list)', () => {
    const el = () => h(PecanExtractionEngine, {
      project, updateProject: () => {}, activeId: 'p1', setTab: () => {}, saveStatus: '',
    });
    const bare = ssr(el());
    const wrapped = ssr(h(HistoryProvider, { projectId: 'p1', scope: 'extraction' }, el()));
    expect(bare).toContain('pex-article-list');
    expect(wrapped).toBe(bare);
  });
});

/* ══════════════════ SOURCE PINS — the wiring the components own ══════════════════ */

describe('ArticleWorkspace wiring (source pin)', () => {
  it('records at BOTH mutation call sites — setFields and writeValues', () => {
    expect(WORKSPACE).toContain('const recordFieldEdit = useCallback((spec) => {');
    // the manual path records the patch it is about to write, provenance included
    expect(WORKSPACE).toMatch(/recordFieldEdit\(\{ patch: p, primaryFields: keys, provenanceNext: provEntry, discrete: !!opts\.discrete \}\);/);
    // the click-to-pick / converter path records ONE discrete entry for the whole capture
    expect(WORKSPACE).toMatch(/recordFieldEdit\(\{ patch: p, primaryFields: written, provenanceNext: provFields, discrete: true \}\);/);
  });

  it('coalesces typed edits and never coalesces discrete ones', () => {
    expect(WORKSPACE).toContain('if (spec.discrete) recordHistory(entry);');
    expect(WORKSPACE).toContain('else coalesceHistory(entry, canMergeExtractionEdit);');
  });

  it('every select is DISCRETE — including the combined denominator patch', () => {
    expect(WORKSPACE).toContain("setFieldOnce('esType', e.target.value)");
    expect(WORKSPACE).toContain("setFieldOnce('reportedFormat', e.target.value)");
    expect(WORKSPACE).toContain("setFieldOnce('actionStatus', e.target.value)");
    expect(WORKSPACE).toContain('setFields(denominatorPopulationPatch(study, e.target.value), { discrete: true })');
    // …and setFieldOnce really is the discrete flavour of setFields
    expect(WORKSPACE).toMatch(/const setFieldOnce = useCallback\(\(f, v\) => setFields\(\{ \[f\]: v \}, \{ discrete: true \}\), \[setFields\]\);/);
  });

  it('the MANUAL path still downgrades provenance — which is why undo must bypass it', () => {
    // If this ever stops being true the executor could safely use setFields; while it is
    // true, routing an undo through setFields would strip page/bbox (108.md §8).
    expect(WORKSPACE).toContain("provEntry[f] = { method: 'manual', page: null, bbox: null, history: history.length ? history : undefined };");
    expect(WORKSPACE).toContain('const p = { ...fields, needsReview: true };');
  });

  it('reuses FIELD_LABELS (via labelFor) for the entry meta', () => {
    expect(WORKSPACE).toContain('fieldLabel: labelFor(');
  });
});

describe('PecanExtractionEngine executor (source pin)', () => {
  it('registers the extraction.field executor', () => {
    expect(ENGINE).toContain('registerExecutor(EXTRACTION_HISTORY_KIND, async (op)');
    expect(ENGINE).toContain("import { useProjectHistory } from '../../../frontend/history/HistoryContext.jsx';");
  });

  it('applies through writeStudy — NEVER through setFields (the §8 pitfall)', () => {
    expect(ENGINE).toContain('writeStudy(op.studyId, op.fields, op.provenance);');
    expect(ENGINE).not.toMatch(/setFields?\s*\(/);
    expect(ENGINE).toContain('studies: applyExtractionWrite(p.studies || [], id, patch, entriesByField, { at }),');
  });

  it('validates the precondition against the FRESHEST rows and refuses honestly', () => {
    expect(ENGINE).toContain('const row = findStudyRow(now.studies, op && op.studyId);');
    expect(ENGINE).toContain('if (!matchesExpected(row, op.expect)) return { ok: false, reason: \'refused\' };');
    // a blob CAS 409 is a persistence FAILURE (entry restored), never a silent success
    expect(ENGINE).toContain("if (now.saveStatus === 'conflict') return { ok: false, reason: 'failed' };");
    expect(ENGINE).toContain('if (now.readOnly || !now.canEdit) return { ok: false, reason: \'refused\' };');
  });

  it('seeds the write timestamp OUTSIDE the state updater (the repo purity rule)', () => {
    const body = ENGINE.slice(ENGINE.indexOf('const writeStudy = useCallback'), ENGINE.indexOf('/* ── 108.md §8'));
    expect(body).toContain('const at = new Date().toISOString();');
    expect(body.indexOf('const at =')).toBeLessThan(body.indexOf('updateProject(activeId'));
  });
});

describe('classic extractionTabs wiring (source pin)', () => {
  it('records on the single write choke point and registers an executor', () => {
    expect(CLASSIC).toContain('const entry=buildExtractionEntry({study:row,patch:fields,surface:EXTRACTION_SURFACE.CLASSIC,discrete});');
    expect(CLASSIC).toContain('if(entry){ if(discrete) recordHistory(entry); else coalesceHistory(entry,canMergeExtractionEdit); }');
    expect(CLASSIC).toContain('registerExecutor(EXTRACTION_HISTORY_KIND,async(op)=>{');
    expect(CLASSIC).toContain('if(!matchesExpected(row,op.expect)) return {ok:false,reason:"refused"};');
  });

  it('the object form of updStudy marks a write DISCRETE', () => {
    expect(CLASSIC).toContain('const discrete=!!(k&&typeof k==="object");');
    expect(CLASSIC).toContain('const chOnce=(k,v)=>updStudy(s.id,{[k]:v});');
  });

  it('every StudyCard select/checkbox goes through the discrete form', () => {
    for (const f of ['design', 'adjusted', 'dataNature', 'source', 'actionStatus', 'esType', 'needsReview']) {
      expect(CLASSIC, f).toContain(`chOnce("${f}"`);
    }
    expect(CLASSIC).toContain('chOnce("flags"');
    expect(CLASSIC).toContain('chOnce("conversions"');
    expect(CLASSIC).toContain('chOnce("extractedAt"');
  });

  it('"Calculate & Apply" and a conversion apply are ONE write, hence ONE entry', () => {
    expect(CLASSIC).toContain('applyFields({es:String(+Number(r.es).toFixed(6))');
    expect(CLASSIC).toContain('if(chFields) chFields(combined); else Object.keys(combined).forEach(k=>ch(k,combined[k]));');
  });

  it('the write itself goes through the shared pure applier', () => {
    expect(CLASSIC).toContain('studies:applyRowPatch(p.studies,id,fields,{at})');
    expect(CLASSIC).toContain('studies:applyRowPatch(p.studies,op.studyId,op.fields,{at})');
  });
});

/* ══════════════════ §14 — the pending-save assumption the design rests on ══════════════════ */

describe('both autosave stacks are REPLACE-not-queue (108.md §14, source pin)', () => {
  // The extraction executor deliberately does NOT flush or cancel a pending save. That
  // is only safe because a queued blob write is REPLACED (not appended) and sends are
  // serialized, so the undo's updateProject supersedes the pending post-change blob and
  // an older in-flight PUT cannot resurrect the undone value (it carries the whole blob).
  // If either stack ever starts queueing, this argument — and the executor — break.
  const STORAGE = SRC('frontend/storage/serverStorage.js');
  const STITCH = SRC('frontend/stitch/shell/useStitchProjectDoc.js');

  it('serverStorage.set overwrites the pending value and restarts the timer', () => {
    expect(STORAGE).toContain('pendingValue = value;');
    expect(STORAGE).toContain('if (debounceTimer !== null) clearTimeout(debounceTimer);');
    expect(STORAGE).toContain('let saveChain = Promise.resolve();');
  });

  it('useStitchProjectDoc.scheduleSave clears the previous timer and serializes sends', () => {
    expect(STITCH).toContain('if (timerRef.current) clearTimeout(timerRef.current);');
    expect(STITCH).toContain('const sendChainRef = useRef(Promise.resolve());');
    expect(STITCH).toContain("setSaveStatus('conflict');");
  });

  it('the executor does not try to flush or discard anything', () => {
    expect(ENGINE).not.toContain('flushStorage');
    expect(ENGINE).not.toContain('discardPendingSave');
  });
});
