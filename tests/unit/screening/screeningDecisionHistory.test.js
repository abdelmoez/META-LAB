/**
 * screeningDecisionHistory.test.js — 108.md §4. The screening DECISION half of the
 * undo system: what the previous decision was, what the entry looks like, and when an
 * undo must be refused.
 *
 * Three server-side traps make this worth its own suite (all three are live bugs the
 * inverse has to route around, not hypotheticals):
 *   1. `stage` defaults to `rec.currentStage`, which is 'full_text' after a promotion —
 *      a stage-less undo writes a phantom full-text decision;
 *   2. the upsert overwrites decision/exclusionReason/notes/rating/labels
 *      unconditionally, so a partial payload erases the reviewer's notes;
 *   3. `myDecision` is not stage-filtered, so a record with both a title/abstract and a
 *      full-text decision by the same reviewer yields an arbitrary one.
 *
 * The wiring that feeds these helpers is source-pinned at the bottom (the house pattern
 * for logic trapped inside the 2,900-line component).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SCREENING_KIND, SCREENING_LABEL, DECISION_REFUSE, UNDECIDED,
  decisionPayload, previousDecision, samePayload, decisionEntry, decisionPrecondition,
  decisionAlreadyApplied,
} from '../../../src/frontend/screening/lib/screeningHistory.js';

const TA = 'title_abstract';
const FT = 'full_text';

const rec = (over = {}) => ({ id: 'r1', currentStage: TA, myDecision: null, ...over });

describe('decisionPayload — always COMPLETE (trap 2)', () => {
  it('fills every column the upsert writes, so nothing is erased', () => {
    expect(decisionPayload({}, TA)).toEqual({
      decision: UNDECIDED, exclusionReason: '', notes: '', rating: null, labels: [], stage: TA,
    });
  });

  it('carries the stage EXPLICITLY (trap 1)', () => {
    expect(decisionPayload({ decision: 'include' }, TA).stage).toBe(TA);
    expect(decisionPayload({ decision: 'include' }, FT).stage).toBe(FT);
  });

  it('parses the labels JSON string the server ships', () => {
    expect(decisionPayload({ labels: '["a","b"]' }, TA).labels).toEqual(['a', 'b']);
    expect(decisionPayload({ labels: ['a'] }, TA).labels).toEqual(['a']);
    expect(decisionPayload({ labels: 'not json' }, TA).labels).toEqual([]);
  });

  it('normalises "no rating" to null whether it arrives as 0, null or absent', () => {
    expect(decisionPayload({ rating: 0 }, TA).rating).toBeNull();
    expect(decisionPayload({ rating: null }, TA).rating).toBeNull();
    expect(decisionPayload({}, TA).rating).toBeNull();
    expect(decisionPayload({ rating: 4 }, TA).rating).toBe(4);
  });
});

describe('previousDecision — stage-scoped (trap 3)', () => {
  it('snapshots the row when it belongs to the stage being written', () => {
    const r = rec({ myDecision: { decision: 'exclude', exclusionReason: 'wrong population', notes: 'n', rating: 3, labels: '["x"]', stage: TA } });
    expect(previousDecision(r, TA)).toEqual({
      decision: 'exclude', exclusionReason: 'wrong population', notes: 'n', rating: 3, labels: ['x'], stage: TA,
    });
  });

  it('DISCARDS a full-text row when the title/abstract stage is being written', () => {
    // The exact shape that made a stage-blind snapshot capture the wrong decision.
    const r = rec({ currentStage: FT, myDecision: { decision: 'include', notes: 'final review note', stage: FT } });
    expect(previousDecision(r, TA)).toEqual({
      decision: UNDECIDED, exclusionReason: '', notes: '', rating: null, labels: [], stage: TA,
    });
  });

  it('treats a stage-less row as this stage (legacy optimistic patches)', () => {
    const r = rec({ myDecision: { decision: 'maybe' } });
    expect(previousDecision(r, TA).decision).toBe('maybe');
  });

  it('reads a record with no decision at all as undecided + empty', () => {
    expect(previousDecision(rec(), TA).decision).toBe(UNDECIDED);
    expect(previousDecision(null, TA).decision).toBe(UNDECIDED);
  });
});

describe('samePayload — the §12 no-op gate', () => {
  it('treats null / "" / 0 as the same absence', () => {
    expect(samePayload(
      { decision: 'include', exclusionReason: '', notes: '', rating: null, labels: [] },
      { decision: 'include', exclusionReason: null, notes: undefined, rating: 0, labels: [] },
    )).toBe(true);
  });

  it('sees a real change in any single field', () => {
    const a = { decision: 'include', exclusionReason: '', notes: '', rating: null, labels: [] };
    expect(samePayload(a, { ...a, decision: 'exclude' })).toBe(false);
    expect(samePayload(a, { ...a, notes: 'hi' })).toBe(false);
    expect(samePayload(a, { ...a, rating: 2 })).toBe(false);
    expect(samePayload(a, { ...a, labels: ['x'] })).toBe(false);
  });
});

describe('decisionEntry', () => {
  const prev = decisionPayload({}, TA);
  const next = decisionPayload({ decision: 'include' }, TA);

  it('describes the change as a semantic op, never a page snapshot (§9/§10)', () => {
    const e = decisionEntry({ recordId: 'r1', stage: TA, prev, next, currentStage: TA, title: 'A study' });
    expect(e.kind).toBe(SCREENING_KIND.DECISION);
    expect(e.label).toBe(SCREENING_LABEL.DECISION);
    expect(e.entityKey).toBe(`decision:r1:${TA}`);
    expect(e.undoOp.payload).toEqual(prev);
    expect(e.redoOp.payload).toEqual(next);
    // Both directions carry the stage explicitly (trap 1).
    expect(e.undoOp.stage).toBe(TA);
    expect(e.undoOp.payload.stage).toBe(TA);
    expect(e.redoOp.payload.stage).toBe(TA);
  });

  it('expects the state each direction is supposed to be reversing', () => {
    const e = decisionEntry({ recordId: 'r1', stage: TA, prev, next, currentStage: TA });
    expect(e.undoOp.expect).toEqual({ decision: 'include', currentStage: TA });
    expect(e.redoOp.expect).toEqual({ decision: UNDECIDED, currentStage: TA });
  });

  it('records nothing when the write changed nothing (§12)', () => {
    expect(decisionEntry({ recordId: 'r1', stage: TA, prev, next: { ...prev }, currentStage: TA })).toBeNull();
    expect(decisionEntry({ recordId: '', stage: TA, prev, next, currentStage: TA })).toBeNull();
  });
});

describe('decisionPrecondition — §§14-15 collaboration safety', () => {
  const prev = decisionPayload({}, TA);
  const next = decisionPayload({ decision: 'include' }, TA);
  const entry = decisionEntry({ recordId: 'r1', stage: TA, prev, next, currentStage: TA });

  it('allows the undo while the record still carries the decision it wrote', () => {
    const live = rec({ myDecision: { decision: 'include', stage: TA } });
    expect(decisionPrecondition(live, entry.undoOp)).toBeNull();
  });

  it('refuses when a collaborator re-decided the record', () => {
    const live = rec({ myDecision: { decision: 'exclude', stage: TA } });
    expect(decisionPrecondition(live, entry.undoOp)).toBe(DECISION_REFUSE.DECISION);
  });

  it('refuses across a promotion — there is no demotion path to reverse it with', () => {
    const live = rec({ currentStage: FT, myDecision: { decision: 'include', stage: TA } });
    expect(decisionPrecondition(live, entry.undoOp)).toBe(DECISION_REFUSE.STAGE);
  });

  it('refuses when the record has left the loaded window entirely', () => {
    expect(decisionPrecondition(null, entry.undoOp)).toBe(DECISION_REFUSE.MISSING);
  });

  it('reports an already-satisfied op as applied, not as a conflict', () => {
    // The forward save is recorded optimistically (§26), so a FAILED save is rolled
    // back to exactly the state its undo wanted. "Changed by a collaborator" would be
    // a lie there.
    const rolledBack = rec({ myDecision: { decision: UNDECIDED, stage: TA } });
    expect(decisionAlreadyApplied(rolledBack, entry.undoOp)).toBe(true);
    const live = rec({ myDecision: { decision: 'include', stage: TA } });
    expect(decisionAlreadyApplied(live, entry.undoOp)).toBe(false);
    expect(decisionAlreadyApplied(live, entry.redoOp)).toBe(true);
    expect(decisionAlreadyApplied(null, entry.undoOp)).toBe(false);
  });

  it('allows the redo once the undo has landed', () => {
    const live = rec({ myDecision: { decision: UNDECIDED, stage: TA } });
    expect(decisionPrecondition(live, entry.redoOp)).toBeNull();
    // …and a full-text row does not satisfy it (trap 3 again).
    const foreign = rec({ myDecision: { decision: 'include', stage: FT } });
    expect(decisionPrecondition(foreign, entry.redoOp)).toBeNull();  // reads as undecided at TA
    expect(decisionPrecondition(foreign, entry.undoOp)).toBe(DECISION_REFUSE.DECISION);
  });
});

/* ── the wiring that feeds all of the above (source pin) ───────────────────────── */

const SRC = readFileSync(
  new URL('../../../src/frontend/screening/tabs/ScreeningTab.jsx', import.meta.url), 'utf8',
);

describe('ScreeningTab decision wiring (source pin)', () => {
  it('captures the prior state from the LIVE row before the write', () => {
    expect(SRC).toMatch(/const\s+recBefore\s*=\s*recordsRef\.current\.find\(r\s*=>\s*r\.id\s*===\s*rid\)\s*\|\|\s*null;/);
    expect(SRC).toMatch(/const\s+prev\s*=\s*previousDecision\(recBefore,\s*SCREENING_STAGE\);/);
    const prevAt = SRC.indexOf('const prev = previousDecision(recBefore, SCREENING_STAGE);');
    const postAt = SRC.indexOf('const inFlight = postDecision(rid, body);');
    expect(prevAt).toBeGreaterThan(-1);
    expect(postAt).toBeGreaterThan(prevAt);
  });

  it('sends an explicit stage on EVERY decision write (the stage trap)', () => {
    // The forward body…
    expect(SRC).toMatch(/labels:\s*extra\.labels[\s\S]{0,400}?stage:\s*SCREENING_STAGE,/);
    // …and the undo/redo write.
    expect(SRC).toMatch(/const\s+payload\s*=\s*\{\s*\.\.\.op\.payload,\s*stage\s*\};/);
    expect(SRC).toMatch(/const\s+stage\s*=\s*op\.stage\s*\|\|\s*SCREENING_STAGE;/);
    // Nothing may post a decision without going through the serialized postDecision.
    const direct = SRC.match(/screeningApi\.saveDecision\(/g) || [];
    expect(direct.length).toBe(1);
  });

  it('serialises writes per record AND drops superseded responses (§14)', () => {
    expect(SRC).toMatch(/const\s+decSeqRef\s*=\s*useRef\(null\)/);
    expect(SRC).toMatch(/const\s+decChainRef\s*=\s*useRef\(null\)/);
    expect(SRC).toMatch(/const\s+seq\s*=\s*\(decSeqRef\.current\.get\(rid\)\s*\|\|\s*0\)\s*\+\s*1;/);
    expect(SRC).toMatch(/const\s+run\s*=\s*prev\.then\(\(\)\s*=>\s*screeningApi\.saveDecision\(pid,\s*rid,\s*payload\)\);/);
    // The chain must survive a rejection or the record wedges forever.
    expect(SRC).toMatch(/decChainRef\.current\.set\(rid,\s*run\.then\(\(\)\s*=>\s*\{\},\s*\(\)\s*=>\s*\{\}\)\);/);
    // A superseded response does its post-resolve work for NOBODY.
    expect(SRC).toMatch(/if\s*\(!current\)\s*return\s+resp;/);
    const guardAt = SRC.indexOf('if (!current) return resp;');
    const refreshAt = SRC.indexOf('refreshRow(rid); // re-sync reviewer indicators');
    expect(guardAt).toBeGreaterThan(-1);
    expect(refreshAt).toBeGreaterThan(guardAt);
  });

  it('records the entry and patches the row at ISSUE time, before the round trip (§26)', () => {
    // "Include → Ctrl+Z before the first save returns" needs an entry to exist while
    // the POST is still in flight, and a row whose state the entry's precondition
    // recognises. Recording on resolve would make that Ctrl+Z a silent no-op.
    const patchAt = SRC.indexOf('applyDecisionRow(rid, body);');
    // The same record() literal also appears in the keyword path, so anchor on the
    // decision branch's own guard.
    const recordAt = SRC.indexOf('if (extra.record !== false) {');
    const postAt = SRC.indexOf('const inFlight = postDecision(rid, body);');
    expect(patchAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(patchAt);
    expect(postAt).toBeGreaterThan(recordAt);
  });

  it('rolls the optimistic patch back when the write fails, but only if it still owns the record', () => {
    expect(SRC).toMatch(/const\s+mySeq\s*=\s*decSeqRef\.current\.get\(rid\);/);
    expect(SRC).toMatch(/if\s*\(decSeqRef\.current\.get\(rid\)\s*===\s*mySeq\)\s*\{\s*\n\s*applyDecisionRow\(rid,\s*prev\);/);
  });

  it('makes a promotion-causing decision INERT rather than undoable (one-way ratchet)', () => {
    expect(SRC).toContain('Advanced to Final Review — this decision can no longer be undone');
    // Stamping the new stage is what disarms the entry: its precondition pins
    // currentStage, so a later Ctrl+Z refuses instead of writing into Final Review.
    expect(SRC).toMatch(/patchRecord\(rid,\s*\(\)\s*=>\s*\(\{\s*currentStage:\s*'full_text'\s*\}\)\);/);
    const stamps = SRC.match(/currentStage:\s*'full_text'/g) || [];
    expect(stamps.length).toBe(2);   // the forward save AND the redo path
  });

  it('writes recordsRef SYNCHRONOUSLY so a same-tick undo validates against the truth', () => {
    // recordsRef is otherwise refreshed by an effect, i.e. one commit late — and the
    // executor re-validates from recordsRef.current (§15).
    expect(SRC).toMatch(/const\s+patchRecord\s*=\s*useCallback\(\(rid,\s*patch\)\s*=>\s*\{/);
    expect(SRC).toMatch(/recordsRef\.current\s*=\s*next;\s*\n\s*setRecords\(next\);/);
  });

  it('reports an already-satisfied undo as success, not as a collaborator conflict', () => {
    expect(SRC).toMatch(/if\s*\(decisionAlreadyApplied\(rec,\s*op\)\)\s*return\s+true;/);
    const alreadyAt = SRC.indexOf('if (decisionAlreadyApplied(rec, op)) return true;');
    const refuseAt = SRC.indexOf('const refuse = decisionPrecondition(rec, op);');
    expect(alreadyAt).toBeGreaterThan(-1);
    expect(refuseAt).toBeGreaterThan(alreadyAt);
  });

  it('re-validates from recordsRef at execute time, not from the recording closure', () => {
    expect(SRC).toMatch(/const\s+rec\s*=\s*recordsRef\.current\.find\(r\s*=>\s*r\.id\s*===\s*rid\)\s*\|\|\s*null;/);
    expect(SRC).toMatch(/const\s+refuse\s*=\s*decisionPrecondition\(rec,\s*op\);/);
    expect(SRC).toMatch(/if\s*\(refuse\)\s*return\s*\{\s*ok:\s*false,\s*reason:\s*'refused',\s*detail:\s*refuse\s*\};/);
    expect(SRC).toMatch(/registerExecutor\(SCREENING_KIND\.DECISION,\s*decisionExecutor\)/);
  });

  it('stamps the stage onto the optimistic row so the next snapshot stays scoped', () => {
    expect(SRC).toMatch(/stage:\s*payload\.stage\s*\|\|\s*SCREENING_STAGE,/);
  });
});
