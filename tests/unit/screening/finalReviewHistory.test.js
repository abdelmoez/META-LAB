/**
 * finalReviewHistory.test.js — 117.md §52-§56. The Final Review half of the undo
 * system: the leader's include/exclude/return-to-review verdict, the reviewer's
 * full-text vote, the copy the §55 toast shows, and the wiring in SecondReviewTab
 * that feeds all three.
 *
 * Why this is its own suite rather than an extension of screeningDecisionHistory:
 *   1. FINALIZE IS NOT A DECISION ROW. The leader's verdict lives on the RECORD
 *      (`finalStatus` + `rejectedReason`), reaches the server through TWO different
 *      endpoints depending on the target state, and its inverse is therefore "put
 *      the record back into this state", not "write this payload".
 *   2. THE KIND MUST NOT COLLIDE. Both tabs share history scope 'screening', and
 *      ScreeningTab's `screening.decision` executor defaults a stage-less op to
 *      'title_abstract' — so a shared kind would let the title/abstract executor
 *      write a full-text entry, which is the 108 stage trap with extra steps.
 *   3. `rejectedReason` TRAVELS WITH `finalStatus`. An inverse that restored only
 *      the status leaves an exclusion reason on a record that is no longer excluded,
 *      and the export, the inspector and the PRISMA reason breakdown all read it.
 *
 * The component wiring is source-pinned at the bottom (the house pattern for logic
 * that lives inside a large stateful component — no jsdom in this repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SCREENING_KIND, SCREENING_LABEL, FULL_TEXT_STAGE, VIA, FINAL_STATUS,
  FINAL_REVIEW_NOTE, FINALIZE_REFUSE, DECISION_REFUSE, UNDECIDED,
  refusalText, finalizeNote,
  finalizeState, sameFinalizeState, finalizeEntry, finalizePrecondition,
  finalizeAlreadyApplied, finalizeRequest,
  decisionPayload, previousDecision, decisionEntry, decisionPrecondition,
} from '../../../src/frontend/screening/lib/screeningHistory.js';
// 108.md §7/§24 — the two predicates that decide whether Ctrl+Z is even offered
// while the exclude dialog is up. See the describe block at the bottom.
import { historyShortcutAllowed } from '../../../src/research-engine/interaction/undoChords.js';
import { isEditableTarget } from '../../../src/research-engine/interaction/editableTarget.js';
import { MODAL_SELECTOR, SCREENING_MODAL_ATTR, isAnyModalOpen }
  from '../../../src/research-engine/interaction/modalSignal.js';

const FT = FULL_TEXT_STAGE;
const rec = (over = {}) => ({ id: 'r1', currentStage: FT, finalStatus: '', rejectedReason: '', ...over });

const PENDING  = { finalStatus: '', rejectedReason: '' };
const ACCEPTED = { finalStatus: 'accepted', rejectedReason: '' };
const excluded = (reason) => ({ finalStatus: 'rejected', rejectedReason: reason });

describe('the Final Review entry kinds are distinct from title/abstract screening', () => {
  it('gives the reviewer vote and the leader verdict their own kinds', () => {
    expect(SCREENING_KIND.FINAL_DECISION).toBe('screening.finalDecision');
    expect(SCREENING_KIND.FINALIZE).toBe('screening.finalize');
    // The collision that would hand full-text entries to the title/abstract executor.
    expect(SCREENING_KIND.FINAL_DECISION).not.toBe(SCREENING_KIND.DECISION);
    expect(SCREENING_KIND.FINALIZE).not.toBe(SCREENING_KIND.DECISION);
  });

  it('labels read as noun phrases — the provider renders "${label} undone"', () => {
    expect(SCREENING_LABEL.FINAL_DECISION).toBe('Final-review decision');
    expect(SCREENING_LABEL.FINALIZE).toBe('Final decision');
    expect(`${SCREENING_LABEL.FINALIZE} undone`).toBe('Final decision undone');
  });
});

describe('finalizeState — the COMPLETE final-review state', () => {
  it('carries the reason alongside the status', () => {
    expect(finalizeState({ finalStatus: 'rejected', rejectedReason: 'wrong population' }))
      .toEqual({ finalStatus: 'rejected', rejectedReason: 'wrong population' });
  });

  it('reads a pending record as "" / "" — pending is a value, not an absence', () => {
    expect(finalizeState({})).toEqual(PENDING);
    expect(finalizeState(null)).toEqual(PENDING);
    expect(finalizeState({ finalStatus: null, rejectedReason: undefined })).toEqual(PENDING);
  });

  it('sameFinalizeState treats null/undefined/"" as the same absence', () => {
    expect(sameFinalizeState(PENDING, { finalStatus: null, rejectedReason: undefined })).toBe(true);
    expect(sameFinalizeState(ACCEPTED, excluded(''))).toBe(false);
    expect(sameFinalizeState(excluded('a'), excluded('b'))).toBe(false);
    expect(sameFinalizeState(null, PENDING)).toBe(false);
  });
});

describe('finalizeEntry — one semantic entry per leader verdict', () => {
  it('describes an EXCLUDE as a state transition, both directions', () => {
    const e = finalizeEntry({
      recordId: 'r1', prev: PENDING, next: excluded('wrong population'),
      currentStage: FT, title: 'A study',
    });
    expect(e.kind).toBe(SCREENING_KIND.FINALIZE);
    expect(e.label).toBe(SCREENING_LABEL.FINALIZE);
    expect(e.entityKey).toBe('finalize:r1');
    // Undo puts the record back to pending and expects it to be rejected right now…
    expect(e.undoOp.target).toEqual(PENDING);
    expect(e.undoOp.expect).toEqual({ finalStatus: 'rejected', currentStage: FT });
    // …redo re-applies the exclusion, reason included, and expects pending.
    expect(e.redoOp.target).toEqual(excluded('wrong population'));
    expect(e.redoOp.expect).toEqual({ finalStatus: '', currentStage: FT });
  });

  it('RESTORES on both directions — a redo never replays "start fresh"', () => {
    // 117.md §52/§54 (r2 fix) — RE-PINNED DELIBERATELY. This used to assert
    // `redoOp.restoreSnapshot === false`, i.e. that the redo replayed the operator's
    // original restore-vs-start-fresh choice. That choice is only safe to replay while
    // it is still true that there is nothing to lose, and by redo time it never is:
    //
    //   accept "start fresh"  → server drops the old snapshot, hands off a BLANK study
    //   (reviewer extracts data into it)
    //   Ctrl+Z                → revert snapshots THAT work onto the record
    //   Ctrl+Shift+Z          → replaying "start fresh" deletes the snapshot the undo
    //                           just took. The reviewer's extraction is destroyed, and
    //                           nothing in the system can bring it back.
    //
    // Undo/redo must be lossless, so both directions restore. The FORWARD write still
    // honours the operator's choice — see finalizeRequest below.
    const e = finalizeEntry({
      recordId: 'r1', prev: PENDING, next: ACCEPTED, currentStage: FT, restoreSnapshot: false,
    });
    expect(e.redoOp.restoreSnapshot).toBe(true);
    expect(e.undoOp.restoreSnapshot).toBe(true);
    // The choice is not forgotten, it is just not replayed: the entry records it so the
    // trail can still say what the operator asked for at the time.
    expect(e.meta.snapshotChoice).toBe('fresh');
    expect(finalizeEntry({ recordId: 'r1', prev: PENDING, next: ACCEPTED, currentStage: FT }).meta.snapshotChoice)
      .toBe('restore');
  });

  it('so the redo REQUEST asks the server to restore, whatever the original click chose', () => {
    const e = finalizeEntry({
      recordId: 'r1', prev: PENDING, next: ACCEPTED, currentStage: FT, restoreSnapshot: false,
    });
    expect(finalizeRequest(e.redoOp, VIA.REDO).body).toEqual({
      via: 'redo', expect: { finalStatus: '' }, decision: 'accept', restoreSnapshot: true,
    });
    // …while a plain forward accept still carries a deliberate "start fresh".
    expect(finalizeRequest({ target: ACCEPTED, restoreSnapshot: false }).body.restoreSnapshot).toBe(false);
  });

  it('records nothing when the verdict did not change (108.md §12)', () => {
    expect(finalizeEntry({ recordId: 'r1', prev: ACCEPTED, next: { ...ACCEPTED }, currentStage: FT })).toBeNull();
    expect(finalizeEntry({ recordId: '', prev: PENDING, next: ACCEPTED, currentStage: FT })).toBeNull();
    expect(finalizeEntry({ recordId: 'r1', prev: null, next: ACCEPTED })).toBeNull();
  });
});

describe('the exclude → undo inverse (§52/§53)', () => {
  const entry = finalizeEntry({
    recordId: 'r1', prev: PENDING, next: excluded('no full text'), currentStage: FT,
  });

  it('restores BOTH columns: finalStatus "" and a cleared reason', () => {
    expect(entry.undoOp.target.finalStatus).toBe(FINAL_STATUS.PENDING);
    expect(entry.undoOp.target.rejectedReason).toBe('');
  });

  it('reaches the server through the revert endpoint, with the CAS and the via marker', () => {
    const req = finalizeRequest(entry.undoOp, VIA.UNDO);
    expect(req.kind).toBe('revert');
    expect(req.body).toEqual({ via: 'undo', expect: { finalStatus: 'rejected' } });
  });

  it('redoes through finalize:reject, carrying the reason back verbatim', () => {
    const req = finalizeRequest(entry.redoOp, VIA.REDO);
    expect(req.kind).toBe('finalize');
    expect(req.body).toEqual({
      via: 'redo', expect: { finalStatus: '' }, decision: 'reject', reason: 'no full text',
    });
  });

  it('undoes a stale-reason accept without resurrecting the reason', () => {
    // The record was excluded, reopened, then accepted. `prev` is what the row
    // actually held; the accept clears the reason server-side, so the redo target
    // must not carry one either.
    const e = finalizeEntry({ recordId: 'r1', prev: PENDING, next: ACCEPTED, currentStage: FT });
    expect(finalizeRequest(e.redoOp, VIA.REDO).body).toEqual({
      via: 'redo', expect: { finalStatus: '' }, decision: 'accept', restoreSnapshot: true,
    });
  });
});

describe('finalizeRequest — which domain endpoint reaches a target state', () => {
  it("'accepted' → POST /finalize {decision:'accept'} with the snapshot choice", () => {
    expect(finalizeRequest({ target: ACCEPTED, restoreSnapshot: false }).body)
      .toEqual({ via: 'user', decision: 'accept', restoreSnapshot: false });
  });

  it("'' → POST /final-review/revert", () => {
    expect(finalizeRequest({ target: PENDING }).kind).toBe('revert');
    expect(finalizeRequest({}).kind).toBe('revert');
  });

  it('degrades an unknown via to "user" rather than forwarding it', () => {
    expect(finalizeRequest({ target: PENDING }, 'sneaky').body.via).toBe('user');
    expect(finalizeRequest({ target: PENDING }, VIA.UNDO).body.via).toBe('undo');
  });

  it('omits `expect` entirely when the entry has none (pre-117 shape)', () => {
    expect(finalizeRequest({ target: ACCEPTED }).body).not.toHaveProperty('expect');
  });
});

describe('finalizePrecondition — §14/§15 collaboration safety', () => {
  const entry = finalizeEntry({
    recordId: 'r1', prev: PENDING, next: excluded('r'), currentStage: FT,
  });

  it('allows the undo while the record still carries the verdict it wrote', () => {
    expect(finalizePrecondition(rec({ finalStatus: 'rejected', rejectedReason: 'r' }), entry.undoOp)).toBeNull();
  });

  it('refuses when a collaborator re-decided the record', () => {
    expect(finalizePrecondition(rec({ finalStatus: 'accepted' }), entry.undoOp)).toBe(FINALIZE_REFUSE.STATUS);
    expect(finalizePrecondition(rec({ finalStatus: '' }), entry.undoOp)).toBe(FINALIZE_REFUSE.STATUS);
  });

  it('refuses when the record left the loaded list', () => {
    expect(finalizePrecondition(null, entry.undoOp)).toBe(FINALIZE_REFUSE.MISSING);
  });

  it('refuses across a stage move', () => {
    const moved = rec({ finalStatus: 'rejected', rejectedReason: 'r', currentStage: 'title_abstract' });
    expect(finalizePrecondition(moved, entry.undoOp)).toBe(FINALIZE_REFUSE.STAGE);
  });

  it('reports an already-satisfied op as applied, not as a conflict', () => {
    // A failed forward write is rolled back to exactly the state its undo wanted.
    expect(finalizeAlreadyApplied(rec(), entry.undoOp)).toBe(true);
    expect(finalizeAlreadyApplied(rec({ finalStatus: 'rejected', rejectedReason: 'r' }), entry.redoOp)).toBe(true);
    expect(finalizeAlreadyApplied(rec({ finalStatus: 'accepted' }), entry.undoOp)).toBe(false);
    expect(finalizeAlreadyApplied(null, entry.undoOp)).toBe(false);
  });

  it('does NOT treat a reason-only difference as already applied', () => {
    // Undoing an exclude must actually clear the reason; a record still carrying it
    // is not in the target state.
    expect(finalizeAlreadyApplied(rec({ finalStatus: '', rejectedReason: 'stale' }), entry.undoOp)).toBe(false);
  });
});

describe('reviewer full-text decisions reuse the decision model at stage full_text', () => {
  it('builds a complete, stage-stamped payload under the Final Review kind', () => {
    const live = { id: 'r1', currentStage: FT, myDecision: { decision: 'maybe', notes: 'keep', stage: FT } };
    const prev = previousDecision(live, FT);
    const next = { ...prev, decision: 'exclude', stage: FT };
    const e = decisionEntry({
      recordId: 'r1', stage: FT, prev, next, currentStage: FT,
      kind: SCREENING_KIND.FINAL_DECISION, label: SCREENING_LABEL.FINAL_DECISION,
    });
    expect(e.kind).toBe(SCREENING_KIND.FINAL_DECISION);
    expect(e.label).toBe(SCREENING_LABEL.FINAL_DECISION);
    expect(e.entityKey).toBe('decision:r1:full_text');
    // Trap 2 — the reviewer's note survives the inverse.
    expect(e.undoOp.payload).toEqual({
      decision: 'maybe', exclusionReason: '', notes: 'keep', rating: null, labels: [], stage: FT,
    });
    // Trap 1 — the stage is explicit on both sides.
    expect(e.undoOp.stage).toBe(FT);
    expect(e.redoOp.payload.stage).toBe(FT);
  });

  it('keeps the default kind for ScreeningTab (no behaviour change there)', () => {
    const prev = decisionPayload({}, 'title_abstract');
    const next = decisionPayload({ decision: 'include' }, 'title_abstract');
    const e = decisionEntry({ recordId: 'r1', stage: 'title_abstract', prev, next, currentStage: 'title_abstract' });
    expect(e.kind).toBe(SCREENING_KIND.DECISION);
    expect(e.label).toBe(SCREENING_LABEL.DECISION);
  });

  it('undoing a full-text include writes "undecided" and is refused once re-decided', () => {
    const prev = decisionPayload({}, FT);
    const next = decisionPayload({ decision: 'include' }, FT);
    const e = decisionEntry({
      recordId: 'r1', stage: FT, prev, next, currentStage: FT,
      kind: SCREENING_KIND.FINAL_DECISION,
    });
    expect(e.undoOp.payload.decision).toBe(UNDECIDED);
    const live = { id: 'r1', currentStage: FT, myDecision: { decision: 'include', stage: FT } };
    expect(decisionPrecondition(live, e.undoOp)).toBeNull();
    const moved = { id: 'r1', currentStage: FT, myDecision: { decision: 'exclude', stage: FT } };
    expect(decisionPrecondition(moved, e.undoOp)).toBe(DECISION_REFUSE.DECISION);
  });
});

describe('§55 — the visible-undo copy (pinned)', () => {
  it('names the article-level outcome, and leaves "Undo" to the snackbar button', () => {
    expect(FINAL_REVIEW_NOTE.INCLUDED).toBe('Article included');
    expect(FINAL_REVIEW_NOTE.EXCLUDED).toBe('Article excluded');
    expect(FINAL_REVIEW_NOTE.REOPENED).toBe('Returned to Final Review');
    expect(FINAL_REVIEW_NOTE.DECISION).toBe('Final-review decision saved');
    // The word is the button's, not the message's — KeywordSnackbar renders one
    // whenever the note carries an `undo`, so spelling it into the text too would
    // render "Undo" twice.
    for (const text of Object.values(FINAL_REVIEW_NOTE)) expect(text).not.toMatch(/Undo/);
  });

  it('maps a resulting status to the note the forward action posts', () => {
    expect(finalizeNote(FINAL_STATUS.ACCEPTED)).toBe(FINAL_REVIEW_NOTE.INCLUDED);
    expect(finalizeNote(FINAL_STATUS.REJECTED)).toBe(FINAL_REVIEW_NOTE.EXCLUDED);
    expect(finalizeNote(FINAL_STATUS.PENDING)).toBe(FINAL_REVIEW_NOTE.REOPENED);
  });
});

describe('refusalText — a refusal DETAIL becomes the note verbatim (108.md §8)', () => {
  it('gives every Final Review refusal a sentence, not a machine code', () => {
    for (const code of Object.values(FINALIZE_REFUSE)) {
      const text = refusalText(code);
      expect(text, `no sentence for ${code}`).toBeTruthy();
      expect(text).not.toBe(code);
      expect(text.length).toBeGreaterThan(20);
    }
    for (const code of Object.values(DECISION_REFUSE)) {
      expect(refusalText(code), `no sentence for ${code}`).toBeTruthy();
    }
  });

  it('returns "" for an unknown code so the generic collaborator note wins', () => {
    expect(refusalText('nope')).toBe('');
    expect(refusalText(undefined)).toBe('');
  });
});

/* ── the wiring that feeds all of the above (source pins) ─────────────────────── */

const SRC = readFileSync(
  new URL('../../../src/frontend/screening/tabs/SecondReviewTab.jsx', import.meta.url), 'utf8',
);
const PRISMA_SRC = readFileSync(
  new URL('../../../src/features/prisma/PrismaInspector.jsx', import.meta.url), 'utf8',
);

describe('SecondReviewTab wiring (source pin)', () => {
  it('adopts the recordsRef-during-render idiom (§15 — a same-tick Ctrl+Z)', () => {
    expect(SRC).toMatch(/const\s+patchRecord\s*=\s*useCallback\(\(rid,\s*patch\)\s*=>\s*\{/);
    expect(SRC).toMatch(/recordsRef\.current\s*=\s*next;/);
    // `load` writes the ref synchronously too — never through an effect.
    expect(SRC).toMatch(/recordsRef\.current\s*=\s*Array\.isArray\(d\?\.records\)\s*\?\s*d\.records\s*:\s*\[\];/);
    expect(SRC).not.toMatch(/useEffect\(\(\)\s*=>\s*\{\s*recordsRef\.current\s*=/);
  });

  it('captures the COMPLETE prior state from the live row BEFORE each write', () => {
    const prevAt = SRC.indexOf('const prev = previousDecision(live, FULL_TEXT_STAGE);');
    const postAt = SRC.indexOf('const inFlight = postDecision(rid, { ...body, via: VIA.USER });');
    expect(prevAt).toBeGreaterThan(-1);
    expect(postAt).toBeGreaterThan(prevAt);
    const fPrevAt = SRC.indexOf('const prev = finalizeState(live);');
    const fWriteAt = SRC.indexOf('const inFlight = writeFinalState(rid, op, VIA.USER);');
    expect(fPrevAt).toBeGreaterThan(-1);
    expect(fWriteAt).toBeGreaterThan(fPrevAt);
  });

  it('records the entry and patches the row at ISSUE time, before the round trip (§26)', () => {
    const patchAt = SRC.indexOf('patchRecord(rid, () => ({ ...next }));');
    const recordAt = SRC.indexOf('const stamped = entry ? histRef.current.record(entry) : null;', patchAt);
    const writeAt = SRC.indexOf('const inFlight = writeFinalState(rid, op, VIA.USER);');
    expect(patchAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(patchAt);
    expect(writeAt).toBeGreaterThan(recordAt);
  });

  it('registers ONE executor per Final Review kind, and neither is the T&A kind', () => {
    expect(SRC).toMatch(/registerExecutor\(SCREENING_KIND\.FINAL_DECISION,\s*finalDecisionExecutor\)/);
    expect(SRC).toMatch(/registerExecutor\(SCREENING_KIND\.FINALIZE,\s*finalizeExecutor\)/);
    expect(SRC).not.toMatch(/registerExecutor\(SCREENING_KIND\.DECISION/);
  });

  it('re-validates against recordsRef AND the live access at RUN time', () => {
    expect(SRC).toMatch(/const\s+live\s*=\s*recordsRef\.current\.find\(r\s*=>\s*r\.id\s*===\s*rid\)\s*\|\|\s*null;/);
    expect(SRC).toMatch(/if\s*\(!accessRef\.current\.canScreen\)/);
    expect(SRC).toMatch(/if\s*\(!acc\.isLeader\s*&&\s*!acc\.canResolveConflicts\)/);
    expect(SRC).toMatch(/const\s+refuse\s*=\s*finalizePrecondition\(live,\s*op\);/);
    expect(SRC).toMatch(/const\s+refuse\s*=\s*decisionPrecondition\(live,\s*op\);/);
    // Already-applied is checked FIRST and reported as success, not as a conflict.
    const alreadyAt = SRC.indexOf('if (finalizeAlreadyApplied(live, op)) return true;');
    const refuseAt = SRC.indexOf('const refuse = finalizePrecondition(live, op);');
    expect(alreadyAt).toBeGreaterThan(-1);
    expect(refuseAt).toBeGreaterThan(alreadyAt);
  });

  it('sends a via marker on every write and turns a 409 into a refusal', () => {
    expect(SRC).toMatch(/const\s+via\s*=\s*ctx\s*&&\s*ctx\.direction\s*===\s*'redo'\s*\?\s*VIA\.REDO\s*:\s*VIA\.UNDO;/);
    expect(SRC).toMatch(/postDecision\(rid,\s*\{\s*\.\.\.payload,\s*via\s*\}\)/);
    expect(SRC).toMatch(/if\s*\(e\s*&&\s*e\.status\s*===\s*409\)/);
    expect(SRC).toMatch(/reason:\s*'refused'/);
  });

  it('writes through the SAME serialized endpoints the buttons use (§8)', () => {
    // One call site each — no private inverse route.
    expect((SRC.match(/screeningApi\.saveDecision\(/g) || []).length).toBe(1);
    expect((SRC.match(/screeningApi\.finalizeRecord\(/g) || []).length).toBe(1);
    expect((SRC.match(/screeningApi\.revertFinalReview\(/g) || []).length).toBe(1);
    // …and both directions go through finalizeRequest, never a hand-built body.
    expect(SRC).toMatch(/const\s*\{\s*kind,\s*body\s*\}\s*=\s*finalizeRequest\(op,\s*via\);/);
  });

  it('serialises writes per record and drops superseded responses (§14)', () => {
    expect(SRC).toMatch(/function\s+useRecordWrites\(\)/);
    expect(SRC).toMatch(/chainRef\.current\.set\(rid,\s*run\.then\(\(\)\s*=>\s*\{\},\s*\(\)\s*=>\s*\{\}\)\);/);
    expect(SRC).toMatch(/if\s*\(!current\)\s*return\s+true;/);
    expect(SRC).toMatch(/if\s*\(finalWrites\.currentSeq\(rid\)\s*===\s*mySeq\)/);
    expect(SRC).toMatch(/if\s*\(decisionWrites\.currentSeq\(rid\)\s*===\s*mySeq\)/);
  });

  it('posts the §55 undoable note through undoEntry, not a bare undo()', () => {
    expect(SRC).toMatch(/undo:\s*\(\)\s*=>\s*\{\s*histRef\.current\.undoEntry\(entryId\);\s*\}/);
    // ONE derivation of the leader-verdict copy, keyed on the state actually reached,
    // so the three call sites (accept / exclude / reopen) cannot drift apart.
    expect(SRC).toMatch(/const\s+message\s*=\s*finalizeNote\(next\.finalStatus\);/);
    expect(SRC).toMatch(/if\s*\(stamped\)\s*notifyUndoable\(message,\s*stamped\.id\);/);
    // Exactly two call sites: the leader verdict (all three states) and the reviewer
    // vote. Any third would be a copy path that escaped the single derivation.
    expect((SRC.match(/notifyUndoable\(/g) || []).length).toBe(2);
    expect(SRC).toMatch(/notifyUndoable\(FINAL_REVIEW_NOTE\.DECISION,\s*stamped\.id\)/);
    expect(SRC).not.toMatch(/histRef\.current\.undo\(\)/);
  });

  it('keeps the local Toast for the non-undoable handoff detail only', () => {
    // A clean "sent" is confirmed by the undoable note; the Toast survives for what
    // the note cannot say (a handoff that did not land, a restored extraction).
    expect(SRC).toMatch(/if\s*\(h\.handoffStatus\s*!==\s*'sent'\s*\|\|\s*h\.restored\)/);
    expect(SRC).toMatch(/setToast\(\{\s*kind,\s*text:\s*h\.message\s*\|\|\s*'Send retried\.'\s*\}\)/);
  });

  it('offers the excluded record a way back now that the server has one (§52)', () => {
    expect(SRC).toContain('↩ Reopen for Final Review');
    expect(SRC).toContain('This record is excluded at final review.');
    // …and the confirmation stops claiming Data Extraction is involved.
    expect(SRC).toContain('Reopen this final decision?');
    expect(SRC).toContain('clears the recorded');
  });
});

/**
 * 117.md §52 + 108.md §7/§24 — WHO OWNS THE KEYBOARD WHILE THE VERDICT IS IN FLIGHT.
 *
 * The exclude confirmation is a screening `Modal` with an autofocused reason
 * textarea, and `submitReject` keeps it mounted until `runFinalize` has finished —
 * the write, the silent list reload AND the project refresh. For that whole window
 * Ctrl+Z is refused twice over: the keystroke's target is editable (§7 — native
 * text undo wins while the user is in a field) and a dialog is open (§24 tier 1 — a
 * modal owns the keyboard). The chord falls through untouched: no preventDefault, no
 * history note, no request.
 *
 * That is correct, and it is exactly why nothing may press Ctrl+Z on the strength of
 * an API read. The server commits `finalStatus:'rejected'` when the POST lands, which
 * is BEFORE the client closes the dialog, so "the server says rejected" is not "the
 * page can undo". A reviewer never meets the gap — they are not told the article was
 * excluded until the dialog closes and the §55 snackbar appears — but a test polling
 * the API is, and e2e/screening/finalReviewUndo.spec.ts waits for the dialog to go
 * plus the snackbar to arrive because of it. These pins are what keep that wait
 * meaningful: if the dialog ever stopped stamping the attribute, or started closing
 * before the write settled, the e2e wait would silently become a different wait.
 */
describe('the exclude dialog owns the keyboard until the write settles (§24)', () => {
  it('renders the confirmation inside the stamped screening Modal', () => {
    const modalAt = SRC.indexOf('{rejectFor && (');
    const confirmAt = SRC.indexOf('testId="final-review-exclude-confirm"', modalAt);
    const closeAt = SRC.indexOf('</Modal>', modalAt);
    expect(modalAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(modalAt);
    // …and the confirm button is INSIDE it, not a sibling that outlives it.
    expect(closeAt).toBeGreaterThan(confirmAt);
    expect(SRC).toMatch(/Loading,\s*ErrorBanner,\s*Button,\s*Badge,\s*DecisionChip,\s*Card,\s*EmptyState,\s*Modal,/);
  });

  it('autofocuses the reason box, so the §7 editable-target half is real too', () => {
    const boxAt = SRC.indexOf('placeholder="e.g. Wrong population, no full text available, retracted…"');
    expect(boxAt).toBeGreaterThan(-1);
    expect(SRC.slice(boxAt, boxAt + 160)).toMatch(/autoFocus/);
  });

  it('closes the dialog only AFTER the whole write path resolves', () => {
    const runAt = SRC.indexOf('const out = await runFinalize(rec.id, {\n      finalStatus: FINAL_STATUS.REJECTED,');
    expect(runAt).toBeGreaterThan(-1);
    const clearAt = SRC.indexOf('setRejectFor(null);', runAt);
    expect(clearAt).toBeGreaterThan(runAt);
    // runFinalize itself does not return until the reload and the refresh have landed.
    expect(SRC).toMatch(/await load\(\{ silent: true \}\);\s*\n\s*if \(refreshProjectRef\.current\) await refreshProjectRef\.current\(\);/);
  });

  it('composes to a refused chord: a stamped dialog on screen ⇒ no history undo', () => {
    // The attribute the Modal stamps is the one the router's selector looks for…
    expect(MODAL_SELECTOR).toContain(`[${SCREENING_MODAL_ATTR}]`);
    const withDialog = { querySelector: (sel) => (sel === MODAL_SELECTOR ? {} : null) };
    const withoutDialog = { querySelector: () => null };
    // …so the two halves compose exactly as ProjectInteractionProvider composes them.
    expect(historyShortcutAllowed({
      editableTarget: isEditableTarget({ tagName: 'TEXTAREA' }),
      modalOpen: isAnyModalOpen(withDialog),
    })).toBe(false);
    // Either half alone is enough to refuse.
    expect(historyShortcutAllowed({ editableTarget: false, modalOpen: isAnyModalOpen(withDialog) })).toBe(false);
    // And once the dialog is gone and focus is back on the page body, it is allowed.
    expect(historyShortcutAllowed({
      editableTarget: isEditableTarget({ tagName: 'BODY' }),
      modalOpen: isAnyModalOpen(withoutDialog),
    })).toBe(true);
  });
});

describe('PrismaInspector shares the domain action, not just the endpoint (§65)', () => {
  it('records the SAME entry kind SecondReviewTab records', () => {
    expect(PRISMA_SRC).toMatch(/historyRef\.current\.record\(finalizeEntry\(\{/);
    expect(PRISMA_SRC).toMatch(/registerExecutor\(SCREENING_KIND\.FINALIZE,/);
  });

  it('builds its request through finalizeRequest — no second mutation path', () => {
    expect(PRISMA_SRC).toMatch(/const\s*\{\s*kind,\s*body\s*\}\s*=\s*finalizeRequest\(op,\s*via\);/);
    expect(PRISMA_SRC).toMatch(/const\s+path\s*=\s*kind\s*===\s*'revert'\s*\?\s*'\/final-review\/revert'\s*:\s*'\/finalize';/);
    // The old hand-rolled bodies are gone.
    expect(PRISMA_SRC).not.toMatch(/\{\s*decision,\s*reason:\s*reason\s*\|\|\s*''\s*\}/);
  });

  it('re-checks the capability and the row at executor RUN time', () => {
    expect(PRISMA_SRC).toMatch(/if\s*\(!pageRef\.current\.canFinalize\)/);
    expect(PRISMA_SRC).toMatch(/rowsRef\.current\s*\|\|\s*\[\]\)\.find\(\(r\)\s*=>\s*r\.id\s*===\s*rid\)/);
    expect(PRISMA_SRC).toMatch(/res\.conflict[\s\S]{0,80}reason:\s*'refused'/);
  });
});
