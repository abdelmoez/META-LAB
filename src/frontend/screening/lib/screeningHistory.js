/**
 * screeningHistory.js — 108.md §§4, 8-12, 14-15, 20. The PURE half of screening's
 * participation in the project-wide Undo/Redo system.
 *
 * ScreeningTab is a 2,700-line stateful component and the repo has no jsdom, so every
 * rule that can be decided from plain data lives here instead: what the previous
 * decision WAS, what a history entry for it looks like, whether an undo is still safe
 * to apply, and how a keyword entry's inverse is derived. The component keeps only the
 * wiring (refs, fetches, optimistic patches); these functions are what the tests
 * exercise.
 *
 * ── WHY DECISIONS NEED THEIR OWN SNAPSHOT (the three traps) ──────────────────────
 *   1. THE STAGE TRAP. `POST /records/:rid/decision` defaults `stage` to
 *      `rec.currentStage`, which after a quorum promotion is 'full_text'. A stage-less
 *      undo therefore writes a PHANTOM full-text decision and leaves the title/abstract
 *      include untouched. Every payload built here carries an EXPLICIT `stage`.
 *   2. THE UPSERT OVERWRITES EVERY COLUMN. decision/exclusionReason/notes/rating/labels
 *      are all written unconditionally and the body defaults are ''/null/'[]', so a
 *      partial inverse ERASES the reviewer's notes. `decisionPayload` is always complete.
 *   3. `myDecision` IS NOT STAGE-SCOPED. The server shapes it with
 *      `r.decisions.find(d => d.reviewerId === me)` over an unfiltered include, so a
 *      record carrying both a title/abstract and a full-text decision by the same
 *      reviewer yields an arbitrary one. `previousDecision` refuses a row whose `stage`
 *      is not the stage being written.
 *
 * ── WHY KEYWORD INVERSES ARE NEVER HAND-ROLLED ───────────────────────────────────
 * Three pieces of an exact keyword inverse exist ONLY in the pre-image: the term's
 * index, the ABSENCE of an explicit origin, and whether `meta.seeded[list]` was already
 * set before a verdict remove. `keywordInverseOps` (keywordModel.js) derives all three;
 * this module's job is to hand it the state the op ACTUALLY ran against — which is the
 * post-`materializeDefaults` state, because the server materializes the shared defaults
 * into an empty side before it runs the reducer.
 *
 * REDO REPLAYS THE FORWARD OP. It is not "invert the inverse": `add {clearSeeded:true}`
 * can only ever CLEAR the seeded marker, so inverting the inverse could not restore it,
 * whereas replaying the original verdict `remove` sets it again exactly as it did the
 * first time.
 */
import {
  applyKeywordOp, keywordInverseOps, materializeDefaults, normalizeKeywordMeta,
} from '../../../research-engine/screening/keywordModel.js';
import { normalizeKeywordKey } from '../../../research-engine/screening/keywordNormalize.js';
import {
  DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS,
} from '../../../research-engine/screening/defaultKeywords.js';

/** Entry `kind`s screening registers executors for (108.md §8). */
export const SCREENING_KIND = Object.freeze({
  DECISION: 'screening.decision',
  KEYWORD: 'screening.keyword',
  // 117.md §52 — Final Review. TWO kinds, deliberately: a reviewer's full-text vote
  // and the leader's include/exclude verdict are different domain actions with
  // different inverses, different permissions and different audit rows.
  //
  // FINAL_DECISION is NOT `screening.decision`. That kind's executor lives in
  // ScreeningTab and hard-codes SCREENING_STAGE ('title_abstract') as its stage
  // fallback; both tabs share scope 'screening', so reusing the kind would let
  // whichever tab happens to be mounted execute the other's entries — and the
  // title/abstract executor writing a full-text entry is precisely the phantom-stage
  // write the 108 stage trap is about.
  FINAL_DECISION: 'screening.finalDecision',
  FINALIZE: 'screening.finalize',
});

/**
 * Entry labels. The history provider renders feedback as `${label} undone` /
 * `${label} redone` (108.md §17 — "Screening decision undone"), so every label must be
 * a noun phrase, never a past-tense verb.
 */
export const SCREENING_LABEL = Object.freeze({
  DECISION: 'Screening decision',
  FINAL_DECISION: 'Final-review decision',
  FINALIZE: 'Final decision',
  KEYWORD_ADD: 'Keyword addition',
  KEYWORD_REMOVE: 'Keyword deletion',
  KEYWORD_MOVE: 'Keyword move',
  KEYWORD_REVIEW: 'Keyword suggestion review',
});

/** The stage Final Review writes at — never defaulted, never inferred (trap 1). */
export const FULL_TEXT_STAGE = 'full_text';

/** 117.md §56 — the claimed-provenance marker every Final Review write carries. */
export const VIA = Object.freeze({ USER: 'user', UNDO: 'undo', REDO: 'redo' });

/** ScreenRecord.finalStatus — '' is PENDING, and it is a real value, not an absence. */
export const FINAL_STATUS = Object.freeze({ PENDING: '', ACCEPTED: 'accepted', REJECTED: 'rejected' });

/** Why a decision undo/redo was refused. Surfaced as `detail` on the outcome. */
export const DECISION_REFUSE = Object.freeze({
  MISSING: 'record-missing',      // the row is not in the loaded window any more
  STAGE: 'stage-moved',           // promoted (or demoted) since the action
  DECISION: 'decision-changed',   // a collaborator (or another tab) rewrote it
});

/** Why a keyword undo/redo was refused. Surfaced as `detail` on the outcome. */
export const KEYWORD_REFUSE = Object.freeze({
  TERM: 'keyword-changed',        // the term's list membership / verdict moved on
});

export const UNDECIDED = 'undecided';

const KEYWORD_DEFAULTS = Object.freeze({
  include: DEFAULT_INCLUDE_KEYWORDS,
  exclude: DEFAULT_EXCLUDE_KEYWORDS,
});

/** Parse a JSON string of string[] (the shape every screening list column uses). */
export function parseJsonList(json) {
  if (Array.isArray(json)) return json.filter(x => typeof x === 'string');
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** `labels` arrives as a JSON string of label ids (or already as an array). */
export function parseDecisionLabels(labels) {
  if (Array.isArray(labels)) return labels;
  try {
    const v = JSON.parse(labels || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * decisionPayload — a COMPLETE decision body for one stage (trap 2 above).
 *
 * @param {object} src   a ScreenDecision row, a form snapshot, or {}
 * @param {'title_abstract'|'full_text'} stage
 */
export function decisionPayload(src, stage) {
  const s = src && typeof src === 'object' ? src : {};
  const rating = s.rating;
  return {
    decision: typeof s.decision === 'string' && s.decision ? s.decision : UNDECIDED,
    exclusionReason: typeof s.exclusionReason === 'string' ? s.exclusionReason : '',
    notes: typeof s.notes === 'string' ? s.notes : '',
    rating: (rating === null || rating === undefined || rating === 0 || rating === '') ? null : Number(rating),
    labels: parseDecisionLabels(s.labels),
    stage,
  };
}

/**
 * previousDecision — the decision the SERVER holds for this record at THIS stage,
 * as a complete payload. A `myDecision` belonging to another stage is discarded
 * (trap 3); a record with no decision for the stage reads as `undecided` + empty,
 * which is the faithful pre-action state (there was no row).
 */
export function previousDecision(record, stage) {
  const d = record && record.myDecision && typeof record.myDecision === 'object' ? record.myDecision : null;
  // `stage` is absent on legacy optimistic patches — treat that as "this stage",
  // which is what the workbench's own writes always were.
  const usable = d && (d.stage == null || d.stage === stage) ? d : null;
  return decisionPayload(usable || {}, stage);
}

/** Rating is stored as 0-or-null interchangeably; '' and null are the same note. */
function sameField(a, b) {
  const norm = v => (v === null || v === undefined ? '' : String(v));
  return norm(a) === norm(b);
}

/** Two decision payloads describe the same domain state (108.md §12 — no no-op entries). */
export function samePayload(a, b) {
  if (!a || !b) return false;
  if (!sameField(a.decision, b.decision)) return false;
  if (!sameField(a.exclusionReason, b.exclusionReason)) return false;
  if (!sameField(a.notes, b.notes)) return false;
  if ((a.rating || 0) !== (b.rating || 0)) return false;
  const la = Array.isArray(a.labels) ? a.labels : [];
  const lb = Array.isArray(b.labels) ? b.labels : [];
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i += 1) if (!sameField(la[i], lb[i])) return false;
  return true;
}

/**
 * decisionEntry — the history entry for one decision write, or null when the write
 * changed nothing (108.md §12: autosave/no-op churn must not reach the stack).
 *
 * `expect` is what the executor re-validates against the CURRENT record at execute
 * time (108.md §§14-15): an undo expects the record to still carry the decision this
 * action wrote; a redo expects it to carry the one it replaced. Both expect the
 * record's stage to be unchanged — a promotion cannot be reversed (there is no
 * demotion path in the server), so undoing across one is refused rather than faked.
 *
 * 117.md §52 — `kind`/`label` are parameters because Final Review records the SAME
 * op shape at stage 'full_text' but must own a SEPARATE executor: both tabs live in
 * scope 'screening', and ScreeningTab's executor falls back to 'title_abstract'
 * whenever an op arrives without a stage. Sharing the kind would hand full-text
 * entries to the title/abstract executor, which is the stage trap with extra steps.
 * `entityKey` already carried the stage, so coalescing/identity are unaffected.
 */
export function decisionEntry({ recordId, stage, prev, next, currentStage, title, kind, label }) {
  if (!recordId || !prev || !next) return null;
  if (samePayload(prev, next)) return null;
  const expectStage = currentStage || stage;
  return {
    kind: kind || SCREENING_KIND.DECISION,
    label: label || SCREENING_LABEL.DECISION,
    entityKey: `decision:${recordId}:${stage}`,
    undoOp: {
      recordId,
      stage,
      payload: { ...prev, stage },
      expect: { decision: next.decision || UNDECIDED, currentStage: expectStage },
    },
    redoOp: {
      recordId,
      stage,
      payload: { ...next, stage },
      expect: { decision: prev.decision || UNDECIDED, currentStage: expectStage },
    },
    meta: { recordId, stage, title: typeof title === 'string' ? title : '' },
  };
}

/**
 * decisionPrecondition — may this decision op still be applied?
 * Returns null when it may, else a DECISION_REFUSE reason. The record MUST be read
 * from the live list at execute time (a realtime `decision.saved` replaces the whole
 * page and the decision form is not resynced), never from the closure that recorded
 * the entry.
 */
export function decisionPrecondition(record, op) {
  if (!record) return DECISION_REFUSE.MISSING;
  const expect = (op && op.expect) || {};
  if (expect.currentStage && record.currentStage && record.currentStage !== expect.currentStage) {
    return DECISION_REFUSE.STAGE;
  }
  // 108 review [split-major] — THE RATCHET, CHECKED ABSOLUTELY.
  //
  // The rule above compares the live row against the stage the entry PINNED when it was
  // recorded, so it can only fire once the promotion is visible locally. The promotion is
  // normally caused by a TEAMMATE's decision (the server needs `distinctDecisions >=
  // effectiveRequired`), and until that reviewer's `decision.saved` reload lands their
  // cached row still reads 'title_abstract' — the pinned value — so the comparison passes.
  // This second rule does not depend on the pin at all: writing a decision at a stage the
  // record has already LEFT is never valid, and there is no demotion path to repair it
  // with. It is cheap; it is not a cure for a stale cache (see docs §11).
  if (op && op.stage && record.currentStage && record.currentStage !== op.stage) {
    return DECISION_REFUSE.STAGE;
  }
  const current = previousDecision(record, op && op.stage).decision;
  if ((expect.decision || UNDECIDED) !== current) return DECISION_REFUSE.DECISION;
  return null;
}

/**
 * decisionAlreadyApplied — the record already holds EXACTLY what this op would write.
 *
 * Checked before the precondition, and reported as success rather than refusal. The
 * case that makes it necessary: the forward save is recorded optimistically (so a
 * Ctrl+Z pressed while it is still in flight has something to undo — 108.md §26), and
 * if that save then FAILS the row is rolled back to the very state the undo wanted to
 * restore. "Changed by a collaborator" would be an outright lie there; the honest
 * answer is that the undo's goal is already met.
 */
export function decisionAlreadyApplied(record, op) {
  if (!record || !op || !op.payload) return false;
  return samePayload(previousDecision(record, op.stage), op.payload);
}

/* ── Final Review: the leader's include/exclude verdict (117.md §52-§56) ──────── */

/** Why a finalize undo/redo was refused. These strings are shown to the user. */
export const FINALIZE_REFUSE = Object.freeze({
  MISSING: 'record-missing',
  STAGE: 'stage-moved',
  STATUS: 'status-changed',
  PERMISSION: 'permission-lost',
});

/**
 * 117.md §52 + 108.md §8 — refusal DETAIL becomes the note verbatim (historyNote), so
 * every reason a Final Review executor can refuse for is written as a sentence for the
 * reviewer rather than as the machine code the executor reasons with.
 */
const REFUSAL_TEXT = Object.freeze({
  [FINALIZE_REFUSE.MISSING]: 'That record is no longer in this list — reload Final Review to see its current state.',
  [FINALIZE_REFUSE.STAGE]: 'That record has moved to another review stage — its final decision can no longer be undone here.',
  [FINALIZE_REFUSE.STATUS]: 'The final decision on that record changed since — reload to see the current state.',
  [FINALIZE_REFUSE.PERMISSION]: 'Only the project leader can change a final decision.',
  [DECISION_REFUSE.MISSING]: 'That record is no longer in this list — reload Final Review to see its current state.',
  [DECISION_REFUSE.STAGE]: 'That record has moved to another review stage — this decision can no longer be undone.',
  [DECISION_REFUSE.DECISION]: 'Your final-review decision on that record changed since — reload to see the current state.',
});

/** The user-facing sentence for a refusal code. Unknown codes degrade to the generic. */
export function refusalText(code) {
  return REFUSAL_TEXT[code] || '';
}

/**
 * 117.md §55 — the visible-undo copy. The prompt's example toast reads
 * "Article excluded — **Undo**"; the bold half is the snackbar's own Undo button
 * (KeywordSnackbar renders one whenever the note carries an `undo`), so the MESSAGE is
 * the sentence and the affordance is the button. Spelling "— Undo" into the message
 * too would render the word twice.
 */
export const FINAL_REVIEW_NOTE = Object.freeze({
  INCLUDED: 'Article included',
  EXCLUDED: 'Article excluded',
  REOPENED: 'Returned to Final Review',
  DECISION: 'Final-review decision saved',
});

/** The note a completed forward finalize posts, per resulting status. */
export function finalizeNote(finalStatus) {
  if (finalStatus === FINAL_STATUS.ACCEPTED) return FINAL_REVIEW_NOTE.INCLUDED;
  if (finalStatus === FINAL_STATUS.REJECTED) return FINAL_REVIEW_NOTE.EXCLUDED;
  return FINAL_REVIEW_NOTE.REOPENED;
}

/**
 * finalizeState — the COMPLETE final-review state of a record.
 *
 * Both columns travel together for the same reason a decision payload is complete
 * (trap 2): `rejectedReason` is not derivable from `finalStatus`, and an inverse that
 * restored only the status would leave "Reason: wrong population" on a record that is
 * no longer excluded — which the exclusion-reason breakdown, the export and the
 * inspector all read.
 */
export function finalizeState(record) {
  const r = record && typeof record === 'object' ? record : {};
  return {
    finalStatus: typeof r.finalStatus === 'string' ? r.finalStatus : '',
    rejectedReason: typeof r.rejectedReason === 'string' ? r.rejectedReason : '',
  };
}

/** Two final-review states describe the same domain state (108.md §12 — no no-ops). */
export function sameFinalizeState(a, b) {
  if (!a || !b) return false;
  return sameField(a.finalStatus, b.finalStatus) && sameField(a.rejectedReason, b.rejectedReason);
}

/**
 * finalizeEntry — the history entry for one leader finalize (accept / exclude /
 * return-to-review), or null when nothing changed.
 *
 * The op is "put this record into THIS final-review state", both directions, which is
 * what makes undo and redo the same executor and the same three endpoints the buttons
 * use. `expect.finalStatus` is re-validated locally AND sent to the server as a
 * compare-and-set, so a collaborator's verdict produces a refusal, never a clobber.
 *
 * `restoreSnapshot` rides on the ACCEPT side only, and BOTH directions always restore.
 *
 * 117.md §52/§54 (r2 fix) — RE-PINNED DELIBERATELY. The redo used to replay the
 * operator's original restore-vs-start-fresh choice (`restoreSnapshot !== false`), and
 * that is lossy in the one sequence undo/redo exists for:
 *
 *   accept "start fresh"  →  the server DROPS the old snapshot and hands off a blank
 *                            study; the reviewer extracts data into it
 *   Ctrl+Z                →  revert snapshots THAT work onto the record
 *   Ctrl+Shift+Z          →  replaying "start fresh" would delete the snapshot the
 *                            undo had just taken — the reviewer's extraction, gone,
 *                            with no inverse anywhere in the system
 *
 * The original choice was made when there was nothing to lose (the snapshot it
 * discarded belonged to an earlier, already-abandoned extraction). By redo time there
 * is: undo/redo must be lossless (108.md), so the redo restores, unconditionally. The
 * parameter is kept in the signature because the FORWARD write still honours it — it
 * is the entry's replay that must not.
 */
export function finalizeEntry({ recordId, prev, next, currentStage, title, restoreSnapshot }) {
  if (!recordId || !prev || !next) return null;
  if (sameFinalizeState(prev, next)) return null;
  const stage = currentStage || FULL_TEXT_STAGE;
  // Recorded, never replayed (see above): the trail can still say what the operator
  // chose at the time without the redo acting on it.
  const chose = restoreSnapshot === false ? 'fresh' : 'restore';
  return {
    kind: SCREENING_KIND.FINALIZE,
    label: SCREENING_LABEL.FINALIZE,
    entityKey: `finalize:${recordId}`,
    undoOp: {
      recordId,
      target: { ...prev },
      expect: { finalStatus: next.finalStatus || '', currentStage: stage },
      restoreSnapshot: true,
    },
    redoOp: {
      recordId,
      target: { ...next },
      expect: { finalStatus: prev.finalStatus || '', currentStage: stage },
      // 117.md §52/§54 (r2 fix) — ALWAYS true; see the header for why replaying a
      // historical "start fresh" is lossy. The `restoreSnapshot` PARAMETER still
      // governs the forward write (runFinalize → finalizeRequest); it is only this
      // replay that must not honour it.
      restoreSnapshot: true,
    },
    meta: {
      recordId, title: typeof title === 'string' ? title : '', status: next.finalStatus || '',
      snapshotChoice: chose,
    },
  };
}

/**
 * finalizePrecondition — may this finalize op still be applied? null when it may.
 *
 * Read the record from the LIVE list at execute time (108.md §15). This check is not
 * the whole defence — the server's `expect` is — but it is not vacuous either: the tab
 * reloads the list after every write and on every `handoff.updated` poke, so a
 * collaborator's verdict is usually visible here before the request is even sent.
 */
export function finalizePrecondition(record, op) {
  if (!record) return FINALIZE_REFUSE.MISSING;
  const expect = (op && op.expect) || {};
  if (expect.currentStage && record.currentStage && record.currentStage !== expect.currentStage) {
    return FINALIZE_REFUSE.STAGE;
  }
  if (finalizeState(record).finalStatus !== (expect.finalStatus || '')) return FINALIZE_REFUSE.STATUS;
  return null;
}

/**
 * finalizeAlreadyApplied — the record already holds exactly what this op would write.
 * Reported as SUCCESS, never as a conflict: the forward write is recorded optimistically
 * (§26) and a failed one is rolled back to the very state its undo wanted to restore.
 */
export function finalizeAlreadyApplied(record, op) {
  if (!record || !op || !op.target) return false;
  return sameFinalizeState(finalizeState(record), op.target);
}

/**
 * finalizeRequest(op, via) → { kind:'finalize'|'revert', body }.
 *
 * WHICH domain endpoint reaches `op.target`, and with what body — the same two
 * endpoints the leader's own buttons call (108.md §8: an executor is the tail of the
 * forward write path, never a private inverse route).
 *
 *   target 'accepted' → POST /finalize {decision:'accept'}
 *   target 'rejected' → POST /finalize {decision:'reject', reason}
 *   target ''         → POST /final-review/revert
 *
 * `via` is the §56 provenance marker; `expect` is the §54 compare-and-set. Pure.
 */
export function finalizeRequest(op, via = VIA.USER) {
  const target = (op && op.target) || {};
  const status = typeof target.finalStatus === 'string' ? target.finalStatus : '';
  const marker = (via === VIA.UNDO || via === VIA.REDO) ? via : VIA.USER;
  const body = { via: marker };
  if (op && op.expect && typeof op.expect.finalStatus === 'string') {
    body.expect = { finalStatus: op.expect.finalStatus };
  }
  if (status === FINAL_STATUS.ACCEPTED) {
    return { kind: 'finalize', body: { ...body, decision: 'accept', restoreSnapshot: op.restoreSnapshot !== false } };
  }
  if (status === FINAL_STATUS.REJECTED) {
    return { kind: 'finalize', body: { ...body, decision: 'reject', reason: target.rejectedReason || '' } };
  }
  return { kind: 'revert', body };
}

/* ── Keywords ─────────────────────────────────────────────────────────────────── */

/** Every list a batch touches — exactly what the server materializes before running. */
export function touchedLists(ops) {
  const out = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op) continue;
    if (op.list && !out.includes(op.list)) out.push(op.list);
    if (op.type === 'move') {
      const other = op.toList || (op.list === 'include' ? 'exclude' : 'include');
      if (!out.includes(other)) out.push(other);
    }
  }
  return out;
}

/**
 * keywordStateBefore — the state the op ACTUALLY runs against.
 *
 * The endpoint materializes the ~28/~50 shared defaults into an empty side before it
 * applies the reducer, so an inverse computed against the raw stored `[]` would carry a
 * meaningless index and would restore the wrong shape. Mirroring `materializeDefaults`
 * here is what makes the recorded inverse exact.
 *
 * @param {{inclusionKeywords?:string, exclusionKeywords?:string, keywordMeta?:string}} raw
 * @param {Array<object>} ops
 */
export function keywordStateBefore(raw, ops) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = {
    inclusion: parseJsonList(src.inclusionKeywords),
    exclusion: parseJsonList(src.exclusionKeywords),
    meta: normalizeKeywordMeta(src.keywordMeta),
  };
  return materializeDefaults(base, KEYWORD_DEFAULTS, touchedLists(ops));
}

/**
 * keywordTermState — presence + verdict for ONE normalized key on ONE list.
 *
 * This pair is the whole of what a keyword inverse depends on: `keywordInverseOps`
 * derives the term's index, its origin and the seeded marker from the pre-image, but the
 * op it produces is only meaningful while the term is still where the forward op left it,
 * carrying the verdict the forward op left on it.
 */
function keywordTermState(state, list, key) {
  const s = state && typeof state === 'object' ? state : {};
  const terms = list === 'include' ? s.inclusion : s.exclusion;
  const meta = normalizeKeywordMeta(s.meta);
  const d = meta.decisions[list] ? meta.decisions[list][key] : undefined;
  return {
    present: (Array.isArray(terms) ? terms : []).some(t => normalizeKeywordKey(t) === key),
    decision: typeof d === 'string' ? d : '',
  };
}

/**
 * keywordExpect — the precondition a keyword entry carries, per direction.
 *
 * 108 review, [major] "undo of a keyword add deletes a collaborator's rejected verdict":
 * the inverse of an `add` is `clear-decision {removeTerm:true}`, and the reducer degrades
 * `removeTerm` to false when the term is gone while STILL deleting whatever decision it
 * finds — so a teammate's deliberate `rejected` verdict is wiped and the executor is told
 * `changed:true`. The reducer cannot tell the difference (a dangling decision is a real
 * thing to clear); the HISTORY can, because it knows what its own forward op produced.
 *
 * Only the lists the op TOUCHED are snapshotted, and the check re-materialises exactly
 * those lists (`keywordExpectState`), so a side the server never materialised is never
 * compared against a phantom default list.
 */
export function keywordExpect(state, ops, term) {
  const key = normalizeKeywordKey(typeof term === 'string' ? term : '');
  const terms = {};
  for (const list of touchedLists(ops)) terms[list] = keywordTermState(state, list, key);
  return { key, terms };
}

/** The CURRENT state to check an `expect` against — materialised over the same lists. */
export function keywordExpectState(raw, expect) {
  const lists = expect && expect.terms && typeof expect.terms === 'object'
    ? Object.keys(expect.terms) : [];
  return keywordStateBefore(raw, lists.map(list => ({ list })));
}

/**
 * keywordPrecondition — may this keyword op still be applied?
 * Returns null when it may, else a KEYWORD_REFUSE reason. An entry recorded before this
 * shipped carries no `expect` and is allowed through (the pre-108-review behaviour).
 */
export function keywordPrecondition(state, expect) {
  const terms = expect && expect.terms && typeof expect.terms === 'object' ? expect.terms : null;
  if (!terms) return null;
  const key = typeof expect.key === 'string' ? expect.key : '';
  for (const list of Object.keys(terms)) {
    const want = terms[list] || {};
    const got = keywordTermState(state, list, key);
    if (!!want.present !== got.present) return KEYWORD_REFUSE.TERM;
    if ((want.decision || '') !== got.decision) return KEYWORD_REFUSE.TERM;
  }
  return null;
}

/** Which label a forward keyword op wears in the history feedback line. */
export function keywordLabelFor(op) {
  const type = op && op.type;
  if (type === 'add') return SCREENING_LABEL.KEYWORD_ADD;
  if (type === 'remove') return SCREENING_LABEL.KEYWORD_REMOVE;
  if (type === 'move') return SCREENING_LABEL.KEYWORD_MOVE;
  return SCREENING_LABEL.KEYWORD_REVIEW;
}

/**
 * keywordEntry — the history entry for one forward keyword op, or null when the op is
 * a no-op against `stateBefore` (a duplicate add, a remove of a term that is not
 * there): `keywordInverseOps` returns [] for those, and an entry with nothing to undo
 * is worse than no entry at all.
 *
 * The undo side is a BATCH (`{ ops }`) because a compound inverse must land as one
 * transaction and one CAS write; the redo side replays the single forward op.
 *
 * BOTH sides also carry an `expect` (see keywordExpect): undo expects the term to still
 * look the way the forward op left it, redo expects it to look the way the undo restored
 * it. Without them the reducer's own `changed` flag is the only gate, and it happily
 * reports success for an inverse that destroyed a collaborator's verdict instead.
 */
export function keywordEntry(stateBefore, forwardOp, label) {
  if (!forwardOp || typeof forwardOp !== 'object') return null;
  const inverse = keywordInverseOps(stateBefore, forwardOp);
  if (!inverse.length) return null;
  const key = normalizeKeywordKey(typeof forwardOp.term === 'string' ? forwardOp.term : '');
  const forward = [forwardOp];
  // The post-image the forward op produces. `keywordInverseOps` ran the same probe to
  // decide there was anything to invert, so this cannot be a no-op result here.
  const probe = applyKeywordOp(stateBefore, forwardOp);
  const after = (probe && probe.ok && probe.changed) ? probe.state : stateBefore;
  return {
    kind: SCREENING_KIND.KEYWORD,
    label: label || keywordLabelFor(forwardOp),
    entityKey: `keyword:${forwardOp.list}:${key}`,
    undoOp: { ops: inverse, expect: keywordExpect(after, forward, forwardOp.term) },
    redoOp: { ops: forward, expect: keywordExpect(stateBefore, forward, forwardOp.term) },
    meta: { term: forwardOp.term, list: forwardOp.list, type: forwardOp.type },
  };
}

/**
 * keywordOpBody — the wire body for a recorded op array. A single op keeps the exact
 * pre-108 single-op shape (the response contract every existing client parses);
 * anything longer uses the transactional `{ ops }` shape.
 */
export function keywordOpBody(ops) {
  const list = Array.isArray(ops) ? ops.filter(Boolean) : [];
  if (!list.length) return null;
  return list.length === 1 ? list[0] : { ops: list };
}
