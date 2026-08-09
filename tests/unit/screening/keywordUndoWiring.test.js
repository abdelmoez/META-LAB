/**
 * keywordUndoWiring.test.js — the CLIENT half of screening's undo wiring.
 *
 * 107 shipped an ad-hoc, per-note keyword undo: the snackbar carried a hand-written
 * inverse op literal (`{type:'remove', …, reject:false}`) and ScreeningTab fired it on
 * click. 108.md §20 replaces that with the shared history system, so the thing worth
 * pinning changed shape entirely:
 *
 *   BEFORE  "does ScreeningTab send the reject:false literal?"
 *   NOW     "does ScreeningTab refuse to write inverse literals at all, and instead ask
 *            keywordInverseOps (via screeningHistory.keywordEntry) to derive them from
 *            the pre-image — and does the recorded entry really round-trip?"
 *
 * ScreeningTab is a 2,900-line stateful component and the repo has no jsdom, so the
 * wiring is asserted from the source and the RULES are executed against the real
 * reducer. Both halves have to hold: a source pin alone would pass on a helper that
 * derives the wrong inverse, and a reducer test alone would pass on a component that
 * never calls it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyKeywordOp, applyKeywordOps, emptyKeywordMeta,
} from '../../../src/research-engine/screening/keywordModel.js';
import {
  keywordEntry, keywordStateBefore, keywordOpBody, SCREENING_KIND,
  keywordExpect, keywordExpectState, keywordPrecondition, KEYWORD_REFUSE,
} from '../../../src/frontend/screening/lib/screeningHistory.js';

const SRC = readFileSync(
  new URL('../../../src/frontend/screening/tabs/ScreeningTab.jsx', import.meta.url), 'utf8',
);

/* ── the wiring, as ScreeningTab writes it ─────────────────────────────────────── */

describe('ScreeningTab never hand-rolls a keyword inverse (source pin)', () => {
  it('derives every inverse through the shared history helper', () => {
    expect(SRC).toContain("from '../lib/screeningHistory.js'");
    expect(SRC).toMatch(/keywordStateBefore\(kwRawRef\.current,\s*\[op\]\)/);
    expect(SRC).toMatch(/keywordEntry\(before,\s*op,\s*keywordLabelFor\(op\)\)/);
  });

  it('has no hand-written `undo:` op literal left anywhere', () => {
    // The 107 mechanism. Any of these coming back means an inverse is being guessed
    // instead of derived, which silently loses index / origin-absence / seeded.
    expect(SRC).not.toMatch(/undo:\s*\{\s*type:\s*'(remove|move|add|accept|reject)'/);
    expect(SRC).not.toMatch(/\breject:\s*false\b/);
  });

  it('records only what the SERVER says changed, and only after it says so', () => {
    // 108.md §12 — a duplicate add or a no-op remove is not a user action to undo.
    expect(SRC).toMatch(/if\s*\(!r\s*\|\|\s*!r\.changed\)\s*return\s+r;/);
    const callAt = SRC.indexOf('const r = await runKeywordOp(op);');
    const recordAt = SRC.indexOf('const stamped = entry ? histRef.current.record(entry) : null;');
    const beforeAt = SRC.indexOf('const before = keywordStateBefore(kwRawRef.current, [op]);');
    expect(beforeAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(beforeAt);    // pre-image captured before the write
    expect(recordAt).toBeGreaterThan(callAt);    // entry recorded after it lands
  });

  it('registers a keyword executor that refuses an unchanged replay', () => {
    expect(SRC).toMatch(/registerExecutor\(SCREENING_KIND\.KEYWORD,\s*keywordExecutor\)/);
    expect(SRC).toMatch(/if\s*\(!r\.changed\)\s*return\s*\{\s*ok:\s*false,\s*reason:\s*'refused'\s*\}/);
  });

  it('checks the entry precondition BEFORE it replays the inverse (108 review)', () => {
    // The reducer's `changed` flag cannot tell "my inverse applied" from "my inverse
    // destroyed a collaborator's verdict", so the entry's own expect is the first gate.
    expect(SRC).toMatch(/keywordPrecondition\(keywordExpectState\(kwRawRef\.current,\s*op\.expect\),\s*op\.expect\)/);
    const preAt = SRC.indexOf('const refuse = keywordPrecondition(');
    const callAt = SRC.indexOf('const r = await runKeywordOp(body);');
    expect(preAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(preAt);
    expect(SRC).toMatch(/if\s*\(refuse\)\s*return\s*\{\s*ok:\s*false,\s*reason:\s*'refused',\s*detail:\s*refuse\s*\};/);
  });
});

describe('the abstract chords consult the permission gate INSIDE the guard chain', () => {
  it('passes canHandle to useAbstractSelectionShortcuts', () => {
    expect(SRC).toMatch(/canHandle:\s*\(\)\s*=>\s*kwCtxRef\.current\.canEditKeywords/);
  });

  it('drops the unreachable post-preventDefault leader warning', () => {
    // 108.md §1 cond. 5: the press is never claimed for a non-editor, so this note
    // could only ever have fired after the browser default had been suppressed.
    expect(SRC).not.toContain('Only project leaders can edit keyword lists');
  });
});

describe('keyword feedback goes through the shared queued surface (§17)', () => {
  it('uses useUndoFeedback instead of the single-slot kwNote state', () => {
    expect(SRC).toContain("from '../../history/useUndoFeedback.jsx'");
    expect(SRC).not.toMatch(/\bsetKwNote\b/);
    expect(SRC).not.toMatch(/<KeywordSnackbar/);
  });

  it('wires the snackbar Undo button to the ENTRY the note names (108 review)', () => {
    // A bare `histRef.current.undo()` was the regression: undo-carrying notes QUEUE for
    // 8 s, so the visible note is routinely older than the top of the stack and its
    // button reversed a different action than its text described.
    expect(SRC).toMatch(/undo:\s*\(\)\s*=>\s*\{\s*histRef\.current\.undoEntry\(entryId\);\s*\}/);
    expect(SRC).not.toMatch(/undo:\s*\(\)\s*=>\s*\{\s*histRef\.current\.undo\(\);\s*\}/);
    // The note carries the id too, so the surface can be asserted / dismissed by entry.
    expect(SRC).toMatch(/message,\s*tone,\s*entryId,/);
    // …and the id is the STAMPED one that record() handed back, not a locally minted one.
    expect(SRC).toMatch(/notifyUndoable\(opts\.note,\s*stamped\.id\)/);
  });
});

/* ── the recorded entries, executed against the real reducer ───────────────────── */

describe('the recorded entry really is an inverse (executed, not asserted)', () => {
  const base = () => ({ inclusion: ['RCT'], exclusion: ['animal study'], meta: emptyKeywordMeta() });
  /** Fold an entry's undoOp / redoOp through the real reducer, as the server would. */
  const runOps = (state, op) => applyKeywordOps(state, op.ops).state;

  it('undo of a Cmd+I add restores the exact prior state (no rejected residue)', () => {
    const before = base();
    const phrase = 'drug-resistant epilepsy';
    const op = { type: 'add', list: 'include', term: phrase };
    const entry = keywordEntry(before, op);
    expect(entry.kind).toBe(SCREENING_KIND.KEYWORD);

    const added = applyKeywordOp(before, op).state;
    expect(added.inclusion).toContain(phrase);

    const undone = runOps(added, entry.undoOp);
    expect(undone.inclusion).toEqual(before.inclusion);
    expect(undone.exclusion).toEqual(before.exclusion);
    expect(undone.meta).toEqual(before.meta);
    // The concept is pending again, not permanently rejected.
    expect(undone.meta.decisions.include).toEqual({});
    expect(undone.meta.origins.include).toEqual({});
    expect(undone.meta).not.toHaveProperty('seeded');

    // …and redo REPLAYS the forward op rather than inverting the inverse.
    expect(entry.redoOp.ops).toEqual([op]);
    expect(runOps(undone, entry.redoOp)).toEqual(added);
  });

  it('undo of a chip × / context-menu delete restores list, POSITION, text and origin', () => {
    // 108.md §20's literal requirement: same list, same logical position, same display
    // text, same metadata. Position is the one the 107 mechanism could not do.
    const before = {
      inclusion: ['RCT', 'drug-resistant epilepsy', 'cohort'],
      exclusion: [],
      meta: {
        version: 1,
        decisions: { include: {}, exclude: {} },
        origins: { include: { 'drug-resistant epilepsy': 'manual' }, exclude: {} },
      },
    };
    const op = { type: 'remove', list: 'include', term: 'drug-resistant epilepsy' };
    const entry = keywordEntry(before, op);
    expect(entry.label).toBe('Keyword deletion');

    const deleted = applyKeywordOp(before, op).state;
    expect(deleted.inclusion).toEqual(['RCT', 'cohort']);
    // The verdict remove marks the side edited — the inverse must unmark it.
    expect(deleted.meta.seeded).toEqual({ include: true });

    const restored = runOps(deleted, entry.undoOp);
    expect(restored.inclusion).toEqual(before.inclusion);          // position 1, not appended
    expect(restored.meta.origins.include).toEqual({ 'drug-resistant epilepsy': 'manual' });
    expect(restored.meta.decisions).toEqual({ include: {}, exclude: {} });
    expect(restored.meta).not.toHaveProperty('seeded');

    // Redo deletes it again, byte-identically to the first delete.
    expect(runOps(restored, entry.redoOp)).toEqual(deleted);
  });

  it('undo of a conflict-dialog move restores the source list, origin and decisions', () => {
    const before = { inclusion: ['RCT'], exclusion: ['epilepsy'], meta: emptyKeywordMeta() };
    const op = { type: 'move', list: 'exclude', term: 'epilepsy', toList: 'include' };
    const entry = keywordEntry(before, op);

    const moved = applyKeywordOp(before, op).state;
    expect(moved.inclusion).toContain('epilepsy');
    expect(moved.meta.decisions.exclude).toEqual({ epilepsy: 'rejected' });

    const undone = runOps(moved, entry.undoOp);
    expect(undone.inclusion).toEqual(before.inclusion);
    expect(undone.exclusion).toEqual(before.exclusion);
    expect(undone.meta.decisions).toEqual({ include: {}, exclude: {} });
    expect(undone.meta.origins).toEqual({ include: {}, exclude: {} });
    // 108.md §20 closed the 107 residue: the forward move's `seeded` marker is cleared
    // by the derived inverse, so the round trip is byte-identical.
    expect(undone.meta).not.toHaveProperty('seeded');
    expect(undone).toEqual(before);
  });

  it('undo of an accepted suggestion returns it to PENDING, not to rejected', () => {
    const before = { inclusion: [], exclusion: [], meta: emptyKeywordMeta() };
    const op = { type: 'accept', list: 'include', term: 'epilepsy' };
    const entry = keywordEntry(before, op);

    const accepted = applyKeywordOp(before, op).state;
    expect(accepted.inclusion).toEqual(['epilepsy']);
    expect(accepted.meta.decisions.include).toEqual({ epilepsy: 'accepted' });

    const undone = runOps(accepted, entry.undoOp);
    expect(undone.inclusion).toEqual([]);
    expect(undone.meta.decisions.include).toEqual({});   // pending again
    expect(runOps(undone, entry.redoOp)).toEqual(accepted);
  });

  it('a no-op forward op records NO entry', () => {
    const before = base();
    expect(keywordEntry(before, { type: 'add', list: 'include', term: 'RCT' })).toBeNull();
    expect(keywordEntry(before, { type: 'remove', list: 'include', term: 'not there' })).toBeNull();
  });

  it('the inverse is computed against the MATERIALIZED state the server saw', () => {
    // A side whose stored list is empty is displayed (and edited) as the shared
    // defaults; an inverse computed against the raw `[]` would carry a meaningless
    // index and would restore the term into an empty list.
    const raw = { inclusionKeywords: '[]', exclusionKeywords: '[]', keywordMeta: '{}' };
    const state = keywordStateBefore(raw, [{ type: 'remove', list: 'include', term: 'RCT' }]);
    expect(state.inclusion.length).toBeGreaterThan(1);
    expect(state.inclusion).toContain('RCT');
    // …and the untouched side is left alone, exactly as the endpoint does it.
    expect(state.exclusion).toEqual([]);

    const op = { type: 'remove', list: 'include', term: 'RCT' };
    const entry = keywordEntry(state, op);
    const idx = state.inclusion.indexOf('RCT');
    const deleted = applyKeywordOp(state, op).state;
    const restored = runOps(deleted, entry.undoOp);
    expect(restored.inclusion.indexOf('RCT')).toBe(idx);
    expect(restored).toEqual(state);
  });

  it('keywordOpBody keeps the single-op wire shape and batches only when it must', () => {
    const one = { type: 'add', list: 'include', term: 'x' };
    expect(keywordOpBody([one])).toEqual(one);
    expect(keywordOpBody([one, one])).toEqual({ ops: [one, one] });
    expect(keywordOpBody([])).toBeNull();
  });
});

/* ── response sequencing: a late response must not revert a newer state ────────── */

describe('runKeywordOp response sequencing (source pin)', () => {
  it('stamps a monotonic sequence and drops superseded responses', () => {
    expect(SRC).toMatch(/const\s+kwSeqRef\s*=\s*useRef\(0\)/);
    expect(SRC).toMatch(/const\s+seq\s*=\s*\(kwSeqRef\.current\s*\+=\s*1\)/);
    expect(SRC).toMatch(/if\s*\(seq\s*!==\s*kwSeqRef\.current\)\s*return\s+r;/);
    // The stale-response guard must sit BEFORE the state adoption, not after it.
    const guardAt = SRC.indexOf('if (seq !== kwSeqRef.current) return r;');
    const adoptAt = SRC.indexOf('setKwLocal(adopted);');
    expect(guardAt).toBeGreaterThan(-1);
    expect(adoptAt).toBeGreaterThan(guardAt);
  });
});

/* ── the send chain: overlapping ops must not share a pre-image ────────────────── */

describe('keyword ops are serialized per project (source pin, 108 review)', () => {
  it('runs every tracked op — and every executor replay — on ONE promise chain', () => {
    expect(SRC).toMatch(/const\s+kwChainRef\s*=\s*useRef\(null\)/);
    expect(SRC).toMatch(/const\s+run\s*=\s*kwChainRef\.current\.then\(task\);/);
    // The chain must survive a rejection or one failed op wedges every later one
    // (the decChainRef rule, applied to keywords).
    expect(SRC).toMatch(/kwChainRef\.current\s*=\s*run\.then\(\(\)\s*=>\s*\{\},\s*\(\)\s*=>\s*\{\}\);/);
    expect(SRC).toMatch(/const\s+runKeywordOpTracked\s*=\s*useCallback\(\(op,\s*opts\s*=\s*\{\}\)\s*=>\s*enqueueKeywordOp\(/);
    expect(SRC).toMatch(/const\s+keywordExecutor\s*=\s*useCallback\(\(op\)\s*=>\s*enqueueKeywordOp\(/);
  });

  it('adopts the response into kwRawRef SYNCHRONOUSLY, before React commits kwLocal', () => {
    // The next task on the chain is a microtask; without this the serialization would
    // still hand it the pre-first-op columns and the inverse index would be wrong.
    expect(SRC).toMatch(/kwRawRef\.current\s*=\s*adopted;\s*\n\s*setKwLocal\(adopted\);/);
  });
});

/* ── entry preconditions: an inverse must not eat a collaborator's verdict ─────── */

describe('keyword entries carry a precondition (108 review, [major])', () => {
  const raw = (state) => ({
    inclusionKeywords: JSON.stringify(state.inclusion),
    exclusionKeywords: JSON.stringify(state.exclusion),
    keywordMeta: JSON.stringify(state.meta),
  });

  it('snapshots the post-forward image for undo and the pre-forward image for redo', () => {
    const before = { inclusion: ['RCT'], exclusion: [], meta: emptyKeywordMeta() };
    const op = { type: 'add', list: 'include', term: 'sepsis' };
    const entry = keywordEntry(before, op);
    expect(entry.undoOp.expect).toEqual({
      key: 'sepsis', terms: { include: { present: true, decision: '' } },
    });
    expect(entry.redoOp.expect).toEqual({
      key: 'sepsis', terms: { include: { present: false, decision: '' } },
    });
  });

  it('only snapshots the lists the op TOUCHED (a move covers both)', () => {
    const before = { inclusion: [], exclusion: ['epilepsy'], meta: emptyKeywordMeta() };
    const entry = keywordEntry(before, { type: 'move', list: 'exclude', term: 'epilepsy', toList: 'include' });
    expect(Object.keys(entry.undoOp.expect.terms).sort()).toEqual(['exclude', 'include']);
    expect(entry.undoOp.expect.terms).toEqual({
      exclude: { present: false, decision: 'rejected' },
      include: { present: true, decision: '' },
    });
  });

  it('REFUSES the undo of an add once a collaborator has rejected the term', () => {
    // The reported defect, executed: leader A adds `sepsis`; leader B deletes it (a
    // verdict remove, writing decisions.include.sepsis = 'rejected'); A presses Ctrl+Z.
    // The inverse is `clear-decision {removeTerm:true}`, whose removeTerm degrades to
    // false while it still deletes B's verdict and reports changed:true.
    const before = { inclusion: ['cohort'], exclusion: [], meta: emptyKeywordMeta() };
    const add = { type: 'add', list: 'include', term: 'sepsis' };
    const entry = keywordEntry(before, add);

    const added = applyKeywordOp(before, add).state;
    const afterCollaborator = applyKeywordOp(added, { type: 'remove', list: 'include', term: 'sepsis' }).state;
    expect(afterCollaborator.meta.decisions.include).toEqual({ sepsis: 'rejected' });

    // The reducer alone would happily run the inverse and report success…
    const wouldApply = applyKeywordOp(afterCollaborator, entry.undoOp.ops[0]);
    expect(wouldApply.changed).toBe(true);
    expect(wouldApply.state.meta.decisions.include).toEqual({});   // B's verdict destroyed

    // …so the entry's precondition is what stops it.
    const live = keywordExpectState(raw(afterCollaborator), entry.undoOp.expect);
    expect(keywordPrecondition(live, entry.undoOp.expect)).toBe(KEYWORD_REFUSE.TERM);
  });

  it('ALLOWS the undo while nothing has moved, and the redo after it lands', () => {
    const before = { inclusion: ['cohort'], exclusion: [], meta: emptyKeywordMeta() };
    const add = { type: 'add', list: 'include', term: 'sepsis' };
    const entry = keywordEntry(before, add);

    const added = applyKeywordOp(before, add).state;
    const liveAfterAdd = keywordExpectState(raw(added), entry.undoOp.expect);
    expect(keywordPrecondition(liveAfterAdd, entry.undoOp.expect)).toBeNull();

    const undone = applyKeywordOp(added, entry.undoOp.ops[0]).state;
    const liveAfterUndo = keywordExpectState(raw(undone), entry.redoOp.expect);
    expect(keywordPrecondition(liveAfterUndo, entry.redoOp.expect)).toBeNull();
  });

  it('refuses a delete-undo once the term is back on the list (someone re-added it)', () => {
    const before = {
      inclusion: ['RCT', 'sepsis'], exclusion: [],
      meta: { version: 1, decisions: { include: {}, exclude: {} }, origins: { include: { sepsis: 'manual' }, exclude: {} } },
    };
    const op = { type: 'remove', list: 'include', term: 'sepsis' };
    const entry = keywordEntry(before, op);
    expect(entry.undoOp.expect.terms.include).toEqual({ present: false, decision: 'rejected' });

    const deleted = applyKeywordOp(before, op).state;
    const reAdded = applyKeywordOp(deleted, { type: 'add', list: 'include', term: 'sepsis' }).state;
    const live = keywordExpectState(raw(reAdded), entry.undoOp.expect);
    expect(keywordPrecondition(live, entry.undoOp.expect)).toBe(KEYWORD_REFUSE.TERM);
  });

  it('materialises the SAME lists the expect covers, so a default term is not a phantom', () => {
    // Stored inclusion is `[]` but the endpoint (and the workbench) show the shared
    // defaults; an expect measured against the raw `[]` would refuse every default-term
    // undo. keywordExpectState re-materialises exactly the touched list.
    const stored = { inclusionKeywords: '[]', exclusionKeywords: '[]', keywordMeta: '{}' };
    const state = keywordStateBefore(stored, [{ type: 'remove', list: 'include', term: 'RCT' }]);
    const entry = keywordEntry(state, { type: 'remove', list: 'include', term: 'RCT' });
    const live = keywordExpectState(stored, entry.redoOp.expect);
    // The untouched side stays raw — the expect never looked at it.
    expect(live.exclusion).toEqual([]);
    expect(keywordPrecondition(live, entry.redoOp.expect)).toBeNull();
  });

  it('is inert for an entry that carries no expect (pre-review entries)', () => {
    expect(keywordPrecondition({ inclusion: [], exclusion: [], meta: emptyKeywordMeta() }, undefined)).toBeNull();
    expect(keywordExpect({ inclusion: [], exclusion: [], meta: emptyKeywordMeta() }, [], 'x'))
      .toEqual({ key: 'x', terms: {} });
  });
});
