/**
 * keywordUndoWiring.test.js — 107.md rec: the CLIENT half of the non-verdict Undo.
 *
 * `keywordModel.test.js` proves the reducer's `reject:false` variant is a true inverse
 * and `keywordOpsHandler.test.js` proves the endpoint accepts and threads it. Neither
 * can see whether ScreeningTab actually SENDS it — and it did not: the snackbar Undo of
 * an abstract-selection add dispatched a plain `{type:'remove'}`, which also records a
 * 'rejected' verdict, so undoing an accidental Cmd+I permanently deleted the matching
 * criteria suggestion from the review panel with no UI to bring it back. The
 * conflict-dialog Undo had the same residue plus a rewritten origin.
 *
 * ScreeningTab is a 2,600-line stateful component and the repo has no jsdom, so the op
 * literals are read out of the source and then executed against the REAL reducer: the
 * test fails both if the wiring regresses and if the ops stop being inverses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyKeywordOp, emptyKeywordMeta,
} from '../../../src/research-engine/screening/keywordModel.js';

const SRC = readFileSync(
  new URL('../../../src/frontend/screening/tabs/ScreeningTab.jsx', import.meta.url), 'utf8',
);

/* ── the literals, as ScreeningTab writes them ─────────────────────────────────── */

describe('ScreeningTab dispatches the NON-VERDICT inverse ops (source pin)', () => {
  it('the snackbar Undo of an abstract-selection add carries reject: false', () => {
    expect(SRC).toMatch(/undo:\s*\{\s*type:\s*'remove',\s*list,\s*term:\s*phrase,\s*reject:\s*false\s*\}/);
    // The verdict-recording form must not come back.
    expect(SRC).not.toMatch(/undo:\s*\{\s*type:\s*'remove',\s*list,\s*term:\s*phrase\s*\}/);
  });

  it('the conflict-dialog Undo of a move carries reject: false', () => {
    expect(SRC).toMatch(
      /undo:\s*\{\s*type:\s*'move',\s*list:\s*c\.to,\s*term:\s*c\.phrase,\s*toList:\s*c\.from,\s*reject:\s*false\s*\}/,
    );
    expect(SRC).not.toMatch(/undo:\s*\{\s*type:\s*'move',\s*list:\s*c\.to,\s*term:\s*c\.phrase,\s*toList:\s*c\.from\s*\}/);
  });

  it('sends reject:false ONLY on remove/move — anything else is a hard 400', () => {
    // The endpoint rejects the flag on add/accept/reject (keywordOpsHandler.test.js),
    // so a stray `reject: false` elsewhere in this file would be a runtime failure.
    const flagged = SRC.match(/\{[^{}]*\breject:\s*false\b[^{}]*\}/g) || [];
    expect(flagged.length).toBeGreaterThan(0);
    for (const lit of flagged) {
      expect(lit, lit).toMatch(/type:\s*'(remove|move)'/);
    }
  });
});

/* ── the same literals, executed against the real reducer ──────────────────────── */

describe('the dispatched Undo ops really are inverses', () => {
  const base = () => ({ inclusion: ['RCT'], exclusion: ['animal study'], meta: emptyKeywordMeta() });

  it('Undo of a Cmd+I add restores the exact prior state (no rejected residue)', () => {
    const before = base();
    const phrase = 'drug-resistant epilepsy';
    const added = applyKeywordOp(before, { type: 'add', list: 'include', term: phrase });
    expect(added.changed).toBe(true);
    expect(added.state.inclusion).toContain(phrase);

    // …the literal ScreeningTab stores on the snackbar note.
    const undone = applyKeywordOp(added.state, { type: 'remove', list: 'include', term: phrase, reject: false });
    expect(undone.changed).toBe(true);
    expect(undone.state.inclusion).toEqual(before.inclusion);
    expect(undone.state.exclusion).toEqual(before.exclusion);
    expect(undone.state.meta).toEqual(before.meta);
    // The concept is pending again, not permanently rejected.
    expect(undone.state.meta.decisions.include).toEqual({});
    expect(undone.state.meta.origins.include).toEqual({});
    expect(undone.state.meta).not.toHaveProperty('seeded');
  });

  it('the verdict-recording form is what it replaced — proving the flag matters', () => {
    const phrase = 'drug-resistant epilepsy';
    const added = applyKeywordOp(base(), { type: 'add', list: 'include', term: phrase });
    const oldWay = applyKeywordOp(added.state, { type: 'remove', list: 'include', term: phrase });
    expect(oldWay.state.meta.decisions.include[phrase]).toBe('rejected');
    expect(oldWay.state.meta.seeded).toEqual({ include: true });
  });

  it('Undo of a conflict-dialog move restores the source list, origin and decisions', () => {
    // A leader selects a term already on the exclusion list and confirms the move.
    const before = { inclusion: ['RCT'], exclusion: ['epilepsy'], meta: emptyKeywordMeta() };
    const moved = applyKeywordOp(before, { type: 'move', list: 'exclude', term: 'epilepsy', toList: 'include' });
    expect(moved.state.inclusion).toContain('epilepsy');
    expect(moved.state.exclusion).not.toContain('epilepsy');
    // The FORWARD move is a deliberate verdict: 'epilepsy' is rejected on exclude.
    expect(moved.state.meta.decisions.exclude).toEqual({ epilepsy: 'rejected' });

    // …the literal ScreeningTab stores as the inverse (from = 'exclude', to = 'include').
    const undone = applyKeywordOp(moved.state, {
      type: 'move', list: 'include', term: 'epilepsy', toList: 'exclude', reject: false,
    });
    expect(undone.state.inclusion).toEqual(before.inclusion);
    expect(undone.state.exclusion).toEqual(before.exclusion);
    // No verdict residue on either side, and the source origin is restored verbatim
    // (an absent origin stays absent, so the term is not re-badged 'manual').
    expect(undone.state.meta.decisions).toEqual({ include: {}, exclude: {} });
    expect(undone.state.meta.origins).toEqual({ include: {}, exclude: {} });
    // DOCUMENTED RESIDUE: the forward move's `seeded` marker survives the undo. It is
    // inert while the side holds terms (it only stops an EMPTY side falling back to the
    // shared defaults), and clearing it would need reducer state the op does not carry.
    expect(undone.state.meta.seeded).toEqual({ exclude: true });
  });

  it('the term keeps its explicit origin across a move and back', () => {
    const before = {
      inclusion: [], exclusion: ['sepsis'],
      meta: { version: 1, decisions: { include: {}, exclude: {} }, origins: { include: {}, exclude: { sepsis: 'manual' } } },
    };
    const moved = applyKeywordOp(before, { type: 'move', list: 'exclude', term: 'sepsis', toList: 'include' });
    expect(moved.state.meta.origins.include).toEqual({ sepsis: 'manual' });
    const undone = applyKeywordOp(moved.state, {
      type: 'move', list: 'include', term: 'sepsis', toList: 'exclude', reject: false,
    });
    expect(undone.state.exclusion).toEqual(['sepsis']);
    expect(undone.state.meta.origins).toEqual({ include: {}, exclude: { sepsis: 'manual' } });
    expect(undone.state.meta.decisions).toEqual({ include: {}, exclude: {} });
  });
});

/* ── 107.md rec — late responses must not revert a newer keyword state ─────────── */

describe('runKeywordOp response sequencing (source pin)', () => {
  it('stamps a monotonic sequence and drops superseded responses', () => {
    // Two ops can be in flight at once (nothing locks the abstract shortcut or the chip
    // buttons) and each response carries FULL keyword columns, so the slower one would
    // otherwise overwrite the newer state and silently drop a term.
    expect(SRC).toMatch(/const\s+kwSeqRef\s*=\s*useRef\(0\)/);
    expect(SRC).toMatch(/const\s+seq\s*=\s*\(kwSeqRef\.current\s*\+=\s*1\)/);
    expect(SRC).toMatch(/if\s*\(seq\s*!==\s*kwSeqRef\.current\)\s*return\s+r;/);
    // The stale-response guard must sit BEFORE the state adoption, not after it.
    const guardAt = SRC.indexOf('if (seq !== kwSeqRef.current) return r;');
    const adoptAt = SRC.indexOf('setKwLocal({');
    expect(guardAt).toBeGreaterThan(-1);
    expect(adoptAt).toBeGreaterThan(guardAt);
  });
});
