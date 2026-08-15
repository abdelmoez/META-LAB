/**
 * SecondReviewTab.jsx — Final Review (the full-text decision stage; prompt21).
 *
 * User-facing name: "Final Review" (internal stage = `full_text`; the engine name
 * META·SIFT is kept out of the UI). Records that reach inclusion quorum (≥2
 * reviewers include them at title/abstract) surface here for the final inclusion
 * decision. The leader accepts a record to SEND it to Data Extraction, or excludes
 * it with a reason. The page is split into two sub-tabs:
 *   • Not Sent to Data Extraction — pending decisions, accepted-but-not-yet-sent, excluded
 *   • Sent to Data Extraction      — accepted records now in Data Extraction (revertible)
 *
 * Reverting a sent record is scientifically safe: the backend snapshots the study
 * (so extracted data survives), removes it from active extraction, and returns the
 * record to pending — which cleanly updates PRISMA, analysis readiness, and any
 * meta-analysis that used it. A later re-accept restores the snapshot.
 *
 * ── 117.md §52-§56 — UNDO/REDO ───────────────────────────────────────────────
 * Every decision made on this page is an undoable domain action on the project-wide
 * history stack (scope 'screening', shared with the title/abstract workbench — the
 * sub-tabs are navigation inside one engine, 108.md §16):
 *
 *   • a reviewer's full-text vote      → kind 'screening.finalDecision'
 *   • the leader's include / exclude / return-to-review → kind 'screening.finalize'
 *
 * Four rules the wiring exists to satisfy:
 *   1. ENTRIES ARE RECORDED AT ISSUE TIME with the COMPLETE prior state (108.md
 *      §8.2/§26), so Ctrl+Z pressed before the first save returns still has
 *      something to undo — and `recordsRef` is written synchronously with the
 *      optimistic patch so that undo validates against the truth, not against the
 *      pre-click row an effect has not refreshed yet.
 *   2. EXECUTORS RE-VALIDATE AT RUN TIME against `recordsRef` AND against the live
 *      `access` (leadership can be revoked between an action and its undo), then
 *      write through THE SAME serialized endpoints the buttons use. The server's
 *      `expect` compare-and-set is the authority on collaboration races: a 409 comes
 *      back as an honest refusal, never a clobber.
 *   3. UNDO NEVER FALSIFIES HISTORY (§56). Every write carries a `via` marker and
 *      the server appends FINAL_REVIEW_UNDO / FINAL_REVIEW_REDO rows beside the
 *      original decision instead of rewriting it.
 *   4. §53's "all dependent systems revert too" is derivation-driven, not a second
 *      copy of the truth: PRISMA, the counts and the manuscript flow are derived at
 *      read from `finalStatus`/`rejectedReason`/decisions, and the server pokes
 *      `handoff.updated` + `record.updated` so the open surfaces refetch.
 *
 * Props: pid, project, access ({ isLeader, canScreen, ..., blindMode }), refreshProject
 */
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import {
  Loading, ErrorBanner, Button, Badge, DecisionChip, Card, EmptyState, Modal,
} from '../ui/components.jsx';
import { renderAbstract } from '../ui/highlightRender.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
// 117.md §13/§67 (r2 fix) — Final Review is a COLLABORATIVE surface with a compare-and-set
// behind every button, and it had no live channel at all: it reloaded only after its own
// writes. A leader who left the tab open while a co-leader decided saw stale rows, and
// every action taken from them was a guaranteed 409. See the subscription below.
import { useRealtime } from '../../hooks/useRealtime.js';
import { SCOPE_SCREENING } from '../../../research-engine/interaction/projectScopes.js';
import { useProjectHistory } from '../../history/HistoryContext.jsx';
import { useUndoFeedback } from '../../history/useUndoFeedback.jsx';
import {
  SCREENING_KIND, SCREENING_LABEL, FULL_TEXT_STAGE, VIA, FINAL_STATUS,
  FINAL_REVIEW_NOTE, FINALIZE_REFUSE, UNDECIDED, refusalText, finalizeNote,
  previousDecision, decisionEntry, decisionPrecondition, decisionAlreadyApplied,
  finalizeState, finalizeEntry, finalizePrecondition, finalizeAlreadyApplied,
  finalizeRequest,
} from '../lib/screeningHistory.js';

// 68.md P9 — full-text retrieval panel, lazy so the flag-off case pulls no chunk.
const FullTextPanel = lazy(() => import('../../../features/fullText/FullTextPanel.jsx'));

// ── Helpers ─────────────────────────────────────────────────────────────────
const ABSTRACT_CLAMP = 420; // chars before "show more"

/** 117.md §13 (r2 fix) — realtime poke debounce. Same window as PrismaFlowDiagram, so a
 *  burst of collaborator writes costs ONE list refetch on every surface. */
const REALTIME_DEBOUNCE_MS = 1200;

/** The refusal shown when this reviewer's screening permission is gone (108.md §8). */
const DECISION_PERMISSION_REFUSAL =
  'You no longer have permission to record decisions in this project.';

function parseKeywords(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch {
    return [];
  }
}

const SECOND_REVIEW_OPTIONS = [
  { value: 'include', label: 'Include', color: C.grn },
  { value: 'exclude', label: 'Exclude', color: C.red },
  { value: 'maybe',   label: 'Maybe',   color: C.ylw },
];

// A record is "in Data Extraction" when accepted AND handed off (or already present).
const isSent = (r) => r.finalStatus === 'accepted' && (r.handoffStatus === 'sent' || r.handoffStatus === 'already_exists');

// finalStatus + handoff → badge styling.
function statusBadge(rec) {
  if (rec.finalStatus === 'accepted') {
    return isSent(rec)
      ? { color: C.grn,  label: 'IN DATA EXTRACTION' }
      : { color: C.gold, label: 'ACCEPTED · NOT YET SENT' };
  }
  if (rec.finalStatus === 'rejected') return { color: C.red, label: 'EXCLUDED' };
  return { color: C.teal, label: 'PENDING REVIEW' };
}

/**
 * useRecordWrites — 108.md §14. One in-flight write per record, in issue order.
 *
 * The forward click, the undo and the redo all target the same row through the same
 * endpoint, and the history layer only serializes ONE undo per scope — a click landing
 * during an in-flight undo is not covered by it. Chaining per record makes the server
 * see the writes in the order the user issued them, and the sequence number lets a
 * superseded response skip its post-resolve work (a reload/rollback belonging to an
 * intent the user has already replaced is worse than none).
 */
function useRecordWrites() {
  const seqRef = useRef(null);
  if (seqRef.current === null) seqRef.current = new Map();
  const chainRef = useRef(null);
  if (chainRef.current === null) chainRef.current = new Map();

  const enqueue = useCallback((rid, fn) => {
    const seq = (seqRef.current.get(rid) || 0) + 1;
    seqRef.current.set(rid, seq);
    const prev = chainRef.current.get(rid) || Promise.resolve();
    const run = prev.then(() => fn());
    // The chain must survive a rejection, or one failed write would wedge the record.
    chainRef.current.set(rid, run.then(() => {}, () => {}));
    return run.then((resp) => ({ resp, current: seqRef.current.get(rid) === seq }));
  }, []);

  const currentSeq = useCallback((rid) => seqRef.current.get(rid), []);
  // Stable identity: the executors this feeds are registered in an effect, and an
  // object rebuilt every render would unregister/re-register them on every render.
  return useMemo(() => ({ enqueue, currentSeq }), [enqueue, currentSeq]);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SecondReviewTab({ pid, project, access = {}, refreshProject, onGoToExtraction }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [subTab, setSubTab] = useState('pending'); // 'pending' (Not Sent) | 'sent'

  const [savingDecision, setSavingDecision] = useState({});
  const [finalizing, setFinalizing]         = useState({});
  const [rowError, setRowError]             = useState({});

  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [revertFor, setRevertFor] = useState(null); // record awaiting revert confirm
  const [restoreFor, setRestoreFor] = useState(null); // re-accept: restore vs start fresh

  const [toast, setToast] = useState(null); // { kind: 'ok'|'info'|'err', text }

  const inclusion = parseKeywords(project?.inclusionKeywords);
  const exclusion = parseKeywords(project?.exclusionKeywords);
  const blindMode = !!(data?.blindMode ?? project?.blindMode ?? access.blindMode);
  // prompt23 Task 11 — required-reviewer count follows the project setting, not a 2.
  const quorum = Number(data?.quorum) || Number(project?.requiredScreeningReviewers) || 2;

  // ── 117.md §52/§55 — project history + the shared undo-feedback queue ────────
  // Everything below reads through refs: the executors are registered once and must
  // never close over a render's value (108.md §15).
  const history = useProjectHistory();
  const histRef = useRef(history);
  histRef.current = history;
  const feedback = useUndoFeedback();
  const fbRef = useRef(feedback);
  fbRef.current = feedback;
  const registerExecutor = history.registerExecutor;

  const accessRef = useRef(access);
  accessRef.current = access;
  const finalizingRef = useRef(finalizing);
  finalizingRef.current = finalizing;
  // The shell hands this down freshly on some renders; behind a ref so the executors
  // (registered in an effect) keep a stable identity.
  const refreshProjectRef = useRef(refreshProject);
  refreshProjectRef.current = refreshProject;

  /** A plain note on the shared queue, stamped with the live history scope. */
  const notify = useCallback((note) => fbRef.current.notify({
    scope: histRef.current.scope || SCOPE_SCREENING, ...note,
  }), []);

  /**
   * 117.md §55 — "a subtle visible Undo action after a final-review decision".
   *
   * The button IS the history undo, so it and Ctrl+Z are one code path, and it is
   * ENTRY-TARGETED: an undo-carrying note stays on screen for 8 s while later actions
   * land on the same stack, so a bare `undo()` would routinely reverse something other
   * than the action the note names. `undoEntry(id)` runs that one entry while it is
   * still top-of-stack and otherwise reports 'superseded' without disturbing anything.
   */
  const notifyUndoable = useCallback((message, entryId, tone = 'info') => fbRef.current.notify({
    scope: histRef.current.scope || SCOPE_SCREENING,
    message, tone, entryId,
    undo: () => { histRef.current.undoEntry(entryId); },
  }), []);

  /**
   * The live record list behind a ref (108.md §15). `recordsRef` is written
   * SYNCHRONOUSLY by `patchRecord` and by `load`, never by an effect: an executor
   * re-validates against `recordsRef.current`, and a Ctrl+Z issued in the same tick as
   * the forward click would otherwise be checked against the pre-click row. Same idiom
   * as ScreeningTab.patchRecord, and for the same reason.
   */
  const recordsRef = useRef([]);

  const decisionWrites = useRecordWrites();
  const finalWrites = useRecordWrites();

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const d = await screeningApi.listSecondReview(pid);
      recordsRef.current = Array.isArray(d?.records) ? d.records : [];
      setData(d);
    } catch (e) {
      setError(e?.message || 'Failed to load final-review records.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  /* ── 117.md §13 (r2 fix) — the live channel this tab was missing ─────────────
   *
   * The three events that can change what this page shows, all of them emitted by
   * the very endpoints its own buttons call:
   *   handoff.updated — a co-leader finalized / reverted / retried a handoff
   *   decision.saved  — a reviewer's full-text vote changed the chips and the quorum
   *   record.updated  — a metadata edit, or the finalize/revert poke's second half
   *
   * DEBOUNCED at 1.2s, the same window PrismaFlowDiagram uses, so a burst (a leader
   * working down a list, a bulk import settling) collapses into ONE list refetch, and
   * `{silent:true}` so the page never flashes its loading state under the reader.
   * The poke carries ids only (global invariant 8) — this refetches through the
   * authorized endpoint rather than trusting anything on the wire.
   *
   * Why it matters beyond freshness: every write from this tab sends `expect`, and
   * the server now claims the row atomically. Acting on a stale list is therefore not
   * a silent clobber any more — it is a 409 the user has to read. Keeping the list
   * live is what stops those 409s from being the normal case.
   */
  const loadRef = useRef(load);
  loadRef.current = load;
  const pokeTimer = useRef(null);
  const onPoke = useCallback(() => {
    if (pokeTimer.current) clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => {
      pokeTimer.current = null;
      loadRef.current({ silent: true });
    }, REALTIME_DEBOUNCE_MS);
  }, []);
  useRealtime({
    'handoff.updated': onPoke,
    'decision.saved': onPoke,
    'record.updated': onPoke,
  });
  // A poke landing 1.2s before the tab closes must not refetch into an unmounted tree.
  useEffect(() => () => {
    if (pokeTimer.current) { clearTimeout(pokeTimer.current); pokeTimer.current = null; }
  }, []);

  /**
   * 117.md §54 (r2 fix) — a refusal is only half an answer. The server's 409 says "the
   * final decision on this record changed since — reload to see the current state";
   * leaving the reader to do that by hand means the note is followed by the same stale
   * row that caused it, and the obvious next click 409s again. Every refusal path
   * therefore reloads immediately, silently.
   */
  const reloadAfterConflict = useCallback(() => { loadRef.current({ silent: true }); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  /** Write one row through `recordsRef` AND state in the same call (see recordsRef). */
  const patchRecord = useCallback((rid, patch) => {
    const next = recordsRef.current.map(r => (r.id === rid ? { ...r, ...patch(r) } : r));
    recordsRef.current = next;
    setData(prev => (prev ? { ...prev, records: next } : prev));
  }, []);

  /** Optimistically reflect a written full-text decision in the row (stage-stamped). */
  const applyDecisionRow = useCallback((rid, payload) => {
    patchRecord(rid, r => ({
      myDecision: {
        ...(r.myDecision || {}),
        decision: payload.decision,
        exclusionReason: payload.exclusionReason,
        notes: payload.notes,
        rating: payload.rating,
        labels: JSON.stringify(payload.labels || []),
        // 108.md §4 — the server's `myDecision` is stage-agnostic on other endpoints,
        // so stamping the stage here keeps `previousDecision` scoped either way.
        stage: payload.stage || FULL_TEXT_STAGE,
      },
    }));
  }, [patchRecord]);

  // ── Reviewer decisions (kind 'screening.finalDecision') ─────────────────────
  const postDecision = useCallback((rid, payload) => decisionWrites.enqueue(
    rid, () => screeningApi.saveDecision(pid, rid, payload),
  ), [pid, decisionWrites]);

  const handleDecision = useCallback(async (rec, decision) => {
    const rid = rec.id;
    if (savingDecision[rid]) return;
    if (!access.canScreen) return;
    setSavingDecision(prev => ({ ...prev, [rid]: decision }));
    setRowError(prev => ({ ...prev, [rid]: '' }));

    // 108.md §4 — the COMPLETE prior payload, read from the LIVE row and scoped to
    // full_text, so the inverse cannot erase the reviewer's notes/rating/labels
    // (the upsert writes every column unconditionally) and cannot land at the wrong
    // stage (the server defaults `stage` to rec.currentStage).
    const live = recordsRef.current.find(r => r.id === rid) || rec;
    const prev = previousDecision(live, FULL_TEXT_STAGE);
    const body = { ...prev, decision, stage: FULL_TEXT_STAGE };

    // §8.2/§26 — patch the row and record the entry at ISSUE time.
    applyDecisionRow(rid, body);
    const entry = decisionEntry({
      recordId: rid,
      stage: FULL_TEXT_STAGE,
      prev,
      next: body,
      currentStage: live.currentStage || FULL_TEXT_STAGE,
      title: live.title,
      kind: SCREENING_KIND.FINAL_DECISION,
      label: SCREENING_LABEL.FINAL_DECISION,
    });
    const stamped = entry ? histRef.current.record(entry) : null;

    const inFlight = postDecision(rid, { ...body, via: VIA.USER });
    const mySeq = decisionWrites.currentSeq(rid);
    try {
      const { current } = await inFlight;
      if (!current) return;
      // Resync the reviewer chips / quorum from the server rather than guessing at
      // another reviewer's row — blind mode strips reviewerId from the wire on
      // purpose, so there is no honest client-side patch for that list.
      await load({ silent: true });
      if (stamped) notifyUndoable(FINAL_REVIEW_NOTE.DECISION, stamped.id);
    } catch (e) {
      // The write never landed, so the optimistic patch is a lie — unless a newer
      // intent already owns the record. The recorded entry stays: its own
      // `decisionAlreadyApplied` check reports success rather than accusing a
      // collaborator of a change this client made and rolled back itself.
      if (decisionWrites.currentSeq(rid) === mySeq) applyDecisionRow(rid, prev);
      setRowError(prevErr => ({ ...prevErr, [rid]: e?.message || 'Failed to save decision.' }));
    } finally {
      setSavingDecision(prevSaving => { const n = { ...prevSaving }; delete n[rid]; return n; });
    }
  }, [access.canScreen, savingDecision, postDecision, decisionWrites, applyDecisionRow, load, notifyUndoable]);

  /**
   * 108.md §8/§14/§15 — the full-text decision undo/redo executor.
   *
   * Registered under its OWN kind: ScreeningTab's `screening.decision` executor
   * defaults a stage-less op to 'title_abstract', and both tabs share scope
   * 'screening', so a shared kind would let whichever tab is mounted execute the
   * other's entries.
   */
  const finalDecisionExecutor = useCallback(async (op, ctx) => {
    const rid = op && op.recordId;
    if (!rid || !op.payload) return { ok: false, reason: 'no-executor' };
    // Re-checked at RUN time: screening permission can be revoked between the
    // decision and its undo, and the server would answer 403 to a request the UI
    // should never have sent.
    if (!accessRef.current.canScreen) {
      return { ok: false, reason: 'refused', detail: DECISION_PERMISSION_REFUSAL };
    }
    const live = recordsRef.current.find(r => r.id === rid) || null;
    if (decisionAlreadyApplied(live, op)) return true;
    const refuse = decisionPrecondition(live, op);
    if (refuse) return { ok: false, reason: 'refused', detail: refusalText(refuse) };

    const stage = op.stage || FULL_TEXT_STAGE;
    const payload = { ...op.payload, stage };
    const restore = previousDecision(live, stage);
    const via = ctx && ctx.direction === 'redo' ? VIA.REDO : VIA.UNDO;

    applyDecisionRow(rid, payload);
    const inFlight = postDecision(rid, { ...payload, via });
    const mySeq = decisionWrites.currentSeq(rid);
    try {
      const { current } = await inFlight;
      if (!current) return true;   // a newer intent already owns this record
    } catch (e) {
      // A throw reaches the history layer as a PERSISTENCE FAILURE and puts the entry
      // back on its stack, so the local row has to go back too.
      if (decisionWrites.currentSeq(rid) === mySeq) applyDecisionRow(rid, restore);
      throw e;
    }
    await load({ silent: true });
    return true;
  }, [postDecision, decisionWrites, applyDecisionRow, load]);

  useEffect(
    () => registerExecutor(SCREENING_KIND.FINAL_DECISION, finalDecisionExecutor),
    [registerExecutor, finalDecisionExecutor],
  );

  // ── Leader finalize / exclude / return-to-review (kind 'screening.finalize') ──
  /**
   * The ONE forward write path for every final-review state change on this tab —
   * and the one the executors reuse (108.md §8: an executor is the tail of the
   * forward path, never a private inverse route). `finalizeRequest` decides which
   * of the two domain endpoints reaches the requested state.
   */
  const writeFinalState = useCallback((rid, op, via) => {
    const { kind, body } = finalizeRequest(op, via);
    return finalWrites.enqueue(rid, () => (kind === 'revert'
      ? screeningApi.revertFinalReview(pid, rid, body)
      : screeningApi.finalizeRecord(pid, rid, body)));
  }, [pid, finalWrites]);

  /**
   * runFinalize(rid, next, opts) → { ok, resp?, entryId?, superseded?, detail? }
   *
   * Records the entry and patches the row at ISSUE time, writes through the
   * serialized path, reloads on success and rolls the row back on failure.
   */
  const runFinalize = useCallback(async (rid, next, opts = {}) => {
    const { restoreSnapshot = true } = opts;
    const live = recordsRef.current.find(r => r.id === rid) || null;
    if (!live) return { ok: false, detail: refusalText(FINALIZE_REFUSE.MISSING) };
    const prev = finalizeState(live);
    const op = {
      recordId: rid,
      target: next,
      // §54 — the compare-and-set travels with the request; the server is the only
      // place that can honestly answer "did a collaborator get here first?".
      expect: { finalStatus: prev.finalStatus },
      restoreSnapshot,
    };

    setFinalizing(p => ({ ...p, [rid]: true }));
    setRowError(p => ({ ...p, [rid]: '' }));
    patchRecord(rid, () => ({ ...next }));
    const entry = finalizeEntry({
      recordId: rid, prev, next,
      currentStage: live.currentStage || FULL_TEXT_STAGE,
      title: live.title,
      restoreSnapshot,
    });
    const stamped = entry ? histRef.current.record(entry) : null;

    const inFlight = writeFinalState(rid, op, VIA.USER);
    const mySeq = finalWrites.currentSeq(rid);
    try {
      const { resp, current } = await inFlight;
      if (!current) return { ok: true, superseded: true };
      await load({ silent: true });
      if (refreshProjectRef.current) await refreshProjectRef.current();
      // 117.md §55 — ONE place decides the visible confirmation, keyed on the state
      // that was actually reached, so the three call sites cannot drift apart.
      const message = finalizeNote(next.finalStatus);
      if (stamped) notifyUndoable(message, stamped.id);
      else notify({ message });
      return { ok: true, resp, entryId: stamped ? stamped.id : '' };
    } catch (e) {
      if (finalWrites.currentSeq(rid) === mySeq) patchRecord(rid, () => ({ ...prev }));
      // 117.md §54 (r2 fix) — the rollback above restores what this CLIENT believed
      // before the click, which is exactly the belief the failure calls into question.
      // A 409 says the stored row moved; a network failure leaves it unknown. Either
      // way the queued undo entry (recorded at issue time, 108.md §26) would now be
      // validated against a guess. Reload the truth immediately and silently, so the
      // error the user is about to read is followed by the real state rather than by
      // the same stale row that produced it.
      reloadAfterConflict();
      return { ok: false, status: e?.status, detail: e?.message || '' };
    } finally {
      setFinalizing(p => { const n = { ...p }; delete n[rid]; return n; });
    }
  }, [patchRecord, writeFinalState, finalWrites, load, notify, notifyUndoable, reloadAfterConflict]);

  const handleAccept = useCallback(async (rec, restoreSnapshot = true) => {
    if (finalizingRef.current[rec.id]) return;
    setRestoreFor(null);
    const out = await runFinalize(
      rec.id,
      { finalStatus: FINAL_STATUS.ACCEPTED, rejectedReason: '' },
      { restoreSnapshot },
    );
    if (!out.ok) {
      setRowError(prev => ({ ...prev, [rec.id]: out.detail || 'Failed to accept record.' }));
      return;
    }
    if (out.superseded) return;
    // runFinalize has already posted the undoable §55 note ("Article included"). The
    // local Toast is reserved for what that note cannot say and the user cannot undo:
    // a handoff that did not reach Data Extraction, or one that restored a previous
    // extraction.
    const h = out.resp?.handoff || {};
    if (h.handoffStatus !== 'sent' || h.restored) {
      const kind = h.handoffStatus === 'sent' ? 'ok' : h.handoffStatus === 'failed' ? 'err' : 'info';
      const restored = h.restored ? ' (previous extraction restored)' : '';
      setToast({ kind, text: (h.message || (h.handed ? 'Sent to Data Extraction.' : 'Record accepted.')) + restored });
    }
  }, [runFinalize]);

  // Re-accepting a record that was previously reverted: offer restore vs start fresh.
  const requestAccept = useCallback((rec) => {
    if (rec.hasRevertSnapshot) setRestoreFor(rec);
    else handleAccept(rec, true);
  }, [handleAccept]);

  // Retry the Data Extraction send for an accepted record (e.g. linked later).
  // NOT undoable and NOT a decision — it re-attempts a delivery that already has a
  // recorded decision behind it, so it keeps the plain Toast.
  const handleRetryHandoff = useCallback(async (rec) => {
    if (finalizingRef.current[rec.id]) return;
    setFinalizing(prev => ({ ...prev, [rec.id]: true }));
    setRowError(prev => ({ ...prev, [rec.id]: '' }));
    try {
      const resp = await screeningApi.retryHandoff(pid, rec.id);
      const h = resp?.handoff || {};
      const kind = h.handoffStatus === 'sent' ? 'ok' : h.handoffStatus === 'failed' ? 'err' : 'info';
      setToast({ kind, text: h.message || 'Send retried.' });
      await load({ silent: true });
      if (refreshProjectRef.current) await refreshProjectRef.current();
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to retry send.' }));
    } finally {
      setFinalizing(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, load]);

  const submitReject = useCallback(async () => {
    const rec = rejectFor;
    if (!rec) return;
    const out = await runFinalize(rec.id, {
      finalStatus: FINAL_STATUS.REJECTED,
      rejectedReason: rejectReason.trim(),
    });
    if (!out.ok) {
      setRowError(prev => ({ ...prev, [rec.id]: out.detail || 'Failed to exclude record.' }));
      return;
    }
    setRejectFor(null);
    setRejectReason('');
  }, [rejectFor, rejectReason, runFinalize]);

  // Return a finalized record to pending Final Review. For an ACCEPTED record this
  // also removes it from active Data Extraction (the server snapshots it so a
  // re-accept restores it); for an EXCLUDED one it simply drops the status and the
  // recorded reason (117.md §52).
  const submitRevert = useCallback(async () => {
    const rec = revertFor;
    if (!rec) return;
    const out = await runFinalize(rec.id, {
      finalStatus: FINAL_STATUS.PENDING, rejectedReason: '',
    });
    if (!out.ok) {
      setRowError(prev => ({ ...prev, [rec.id]: out.detail || 'Failed to revert record.' }));
      return;
    }
    setRevertFor(null);
    if (out.superseded) return;
    if (out.resp?.reverted?.removedFromExtraction) {
      setToast({ kind: 'info', text: 'Removed from Data Extraction — the extracted data is kept and restored if you send it again.' });
    }
  }, [revertFor, runFinalize]);

  /**
   * 117.md §52/§54 — the finalize undo/redo executor.
   *
   * Re-validates against the CURRENT row read from `recordsRef` AND against the live
   * `access` (leadership can be revoked between the action and its undo), then writes
   * through the same serialized `writeFinalState` every button uses. The server's 409
   * compare-and-set becomes a refusal with the server's own sentence.
   */
  const finalizeExecutor = useCallback(async (op, ctx) => {
    const rid = op && op.recordId;
    if (!rid || !op.target) return { ok: false, reason: 'no-executor' };
    const acc = accessRef.current || {};
    if (!acc.isLeader && !acc.canResolveConflicts) {
      return { ok: false, reason: 'refused', detail: refusalText(FINALIZE_REFUSE.PERMISSION) };
    }
    const live = recordsRef.current.find(r => r.id === rid) || null;
    // Already there (a failed forward write that was rolled back) — the goal is met.
    if (finalizeAlreadyApplied(live, op)) return true;
    const refuse = finalizePrecondition(live, op);
    if (refuse) return { ok: false, reason: 'refused', detail: refusalText(refuse) };

    const restore = finalizeState(live);
    const via = ctx && ctx.direction === 'redo' ? VIA.REDO : VIA.UNDO;
    setFinalizing(p => ({ ...p, [rid]: true }));
    patchRecord(rid, () => ({ ...op.target }));
    const inFlight = writeFinalState(rid, op, via);
    const mySeq = finalWrites.currentSeq(rid);
    try {
      const { current } = await inFlight;
      if (!current) return true;
    } catch (e) {
      if (finalWrites.currentSeq(rid) === mySeq) patchRecord(rid, () => ({ ...restore }));
      // 409 = the stored record no longer holds the status this op expected. That is
      // a REFUSAL (the entry goes back on its stack and the user is told why), not a
      // persistence failure — and the server's sentence is the accurate one.
      if (e && e.status === 409) {
        // 117.md §54 (r2 fix) — the refusal names a state this client does not have.
        // Reload it, so "the final decision on that record changed since — reload to
        // see the current state" is immediately TRUE on screen instead of an
        // instruction. The reload is silent and does not change the outcome below.
        reloadAfterConflict();
        return { ok: false, reason: 'refused', detail: e.message || refusalText(FINALIZE_REFUSE.STATUS) };
      }
      if (e && e.status === 403) {
        return { ok: false, reason: 'refused', detail: refusalText(FINALIZE_REFUSE.PERMISSION) };
      }
      throw e;
    } finally {
      setFinalizing(p => { const n = { ...p }; delete n[rid]; return n; });
    }
    await load({ silent: true });
    if (refreshProjectRef.current) await refreshProjectRef.current();
    return true;
  }, [patchRecord, writeFinalState, finalWrites, load, reloadAfterConflict]);

  useEffect(
    () => registerExecutor(SCREENING_KIND.FINALIZE, finalizeExecutor),
    [registerExecutor, finalizeExecutor],
  );

  // ── Loading / error ──
  if (loading && !data) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease' }}>
        <Loading label="Loading final-review records…" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease', paddingTop: 8 }}>
        <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      </div>
    );
  }

  const records = Array.isArray(data?.records) ? data.records : [];
  const sentRecords    = records.filter(isSent);
  const pendingRecords = records.filter(r => !isSent(r));
  const shown = subTab === 'sent' ? sentRecords : pendingRecords;

  // Continue-to-Data-Extraction CTA (prompt22 Task 5). Only shown when embedded in
  // the project workspace (onGoToExtraction is wired); jumps to THIS project's Data
  // Extraction stage — no separate-project handoff. Active once any study is sent.
  const sentCount    = sentRecords.length;
  const undecided    = records.filter(r => !r.finalStatus).length; // pending final decisions

  const SUBTABS = [
    { key: 'pending', label: 'Not Sent to Data Extraction', count: pendingRecords.length },
    { key: 'sent',    label: 'Sent to Data Extraction',     count: sentRecords.length },
  ];

  const revertWasAccepted = revertFor?.finalStatus === 'accepted';

  return (
    <div style={{ fontFamily: FONT, color: C.txt, animation: 'sift-fade 0.3s ease', maxWidth: 1400, position: 'relative' }}>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {error && data && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner onRetry={load}>{error}</ErrorBanner>
        </div>
      )}

      {/* Explainer banner — unified project wording (no separate-app language) */}
      <div style={{
        background: `linear-gradient(180deg, ${C.surf}, ${C.card})`,
        border: `1px solid ${C.brd}`, borderLeft: `3px solid ${C.teal}`,
        borderRadius: 10, padding: '14px 18px', marginBottom: 18,
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }} aria-hidden>📑</span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, marginBottom: 3 }}>
            Final Review
          </div>
          <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
            Records that reached inclusion quorum (≥{quorum} reviewer{quorum === 1 ? '' : 's'}) appear here for the final
            inclusion decision. {access.isLeader
              ? 'Accept studies to send them to Data Extraction, or exclude them with a documented reason.'
              : 'Cast your final-review decision; the project leader makes the final call.'}
            {' '}Any decision here can be undone with Ctrl+Z (⌘Z on macOS).
          </div>
        </div>
      </div>

      {/* 68.md P9 — full-text retrieval (flag off → renders null, no chunk cost) */}
      <Suspense fallback={null}>
        <FullTextPanel pid={pid} />
      </Suspense>

      {/* Sub-tabs (Not Sent / Sent) + the Continue-to-Data-Extraction CTA */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUBTABS.map(t => {
            const on = subTab === t.key;
            return (
              <button key={t.key} onClick={() => setSubTab(t.key)}
                style={{
                  fontFamily: FONT, fontSize: 12.5, fontWeight: on ? 700 : 500,
                  padding: '7px 15px', borderRadius: 9, cursor: 'pointer',
                  background: on ? alpha(C.acc, '16') : 'transparent',
                  color: on ? C.acc : C.txt2, border: `1px solid ${on ? alpha(C.acc, '45') : C.brd2}`,
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                }}>
                {t.label}
                <span style={{
                  fontFamily: MONO, fontSize: 11, fontWeight: 700,
                  background: on ? alpha(C.acc, '22') : C.card, color: on ? C.acc : C.muted,
                  borderRadius: 20, padding: '1px 8px', minWidth: 20, textAlign: 'center',
                }}>{t.count}</span>
              </button>
            );
          })}
        </div>

        {onGoToExtraction && (
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <Button
              variant="primary"
              disabled={sentCount === 0}
              onClick={onGoToExtraction}
              title={sentCount === 0
                ? 'Accept studies in Final Review before continuing to Data Extraction.'
                : 'Open Data Extraction for this project'}>
              Continue to Data Extraction →
            </Button>
            {sentCount === 0 ? (
              <span style={{ fontSize: 11, color: C.muted, maxWidth: 240, textAlign: 'right', lineHeight: 1.4 }}>
                Accept studies in Final Review to continue.
              </span>
            ) : undecided > 0 ? (
              <span style={{ fontSize: 11, color: C.muted, maxWidth: 260, textAlign: 'right', lineHeight: 1.4 }}>
                You can extract sent studies while {undecided} decision{undecided === 1 ? '' : 's'} remain.
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* List */}
      {shown.length === 0 ? (
        <EmptyState
          icon={subTab === 'sent' ? '📤' : '🔎'}
          title={subTab === 'sent' ? 'Nothing sent to Data Extraction yet' : 'No records awaiting final review'}
        >
          {subTab === 'sent'
            ? 'Accepted studies appear here once they are sent to Data Extraction.'
            : 'Records advance here automatically once two reviewers include them in title & abstract screening.'}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {shown.map(rec => (
            <RecordCard
              key={rec.id}
              pid={pid}
              rec={rec}
              access={access}
              blindMode={blindMode}
              inclusion={inclusion}
              exclusion={exclusion}
              savingDecision={savingDecision[rec.id]}
              finalizing={!!finalizing[rec.id]}
              rowError={rowError[rec.id]}
              onDecision={handleDecision}
              onAccept={requestAccept}
              onRetryHandoff={handleRetryHandoff}
              onRevert={() => setRevertFor(rec)}
              onRejectClick={() => { setRejectFor(rec); setRejectReason(rec.rejectedReason || ''); }}
            />
          ))}
        </div>
      )}

      {/* Exclude reason modal */}
      {rejectFor && (
        <Modal onClose={() => { if (!finalizing[rejectFor.id]) { setRejectFor(null); setRejectReason(''); } }} width={460}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
            Exclude record
          </div>
          <div style={{
            fontSize: 12.5, color: C.txt2, lineHeight: 1.5, marginBottom: 16,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {rejectFor.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
          </div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 600, color: C.txt2,
            marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            Reason for exclusion
          </label>
          <textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="e.g. Wrong population, no full text available, retracted…"
            rows={3}
            autoFocus
            style={{
              width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
              borderRadius: 7, padding: '9px 12px', color: C.txt, fontSize: 13,
              fontFamily: FONT, outline: 'none', resize: 'vertical', lineHeight: 1.5,
            }}
          />
          {rowError[rejectFor.id] && (
            <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{rowError[rejectFor.id]}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Button variant="ghost" disabled={!!finalizing[rejectFor.id]}
              onClick={() => { setRejectFor(null); setRejectReason(''); }}>Cancel</Button>
            <Button variant="danger" disabled={!!finalizing[rejectFor.id]} testId="final-review-exclude-confirm"
              onClick={submitReject}>{finalizing[rejectFor.id] ? 'Excluding…' : 'Exclude record'}</Button>
          </div>
        </Modal>
      )}

      {/* Return-to-Final-Review confirmation — explains downstream effects. The
          accepted case withdraws a study from Data Extraction; the excluded case
          only reopens the decision (117.md §52), so it must not claim otherwise. */}
      {revertFor && (
        <Modal onClose={() => { if (!finalizing[revertFor.id]) setRevertFor(null); }} width={480}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
            {revertWasAccepted ? 'Return to Final Review?' : 'Reopen this final decision?'}
          </div>
          <div style={{
            fontSize: 12.5, color: C.txt2, lineHeight: 1.5, marginBottom: 14,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {revertFor.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
          </div>
          <div style={{
            fontSize: 12.5, color: C.txt2, lineHeight: 1.65, background: C.surf,
            border: `1px solid ${alpha(C.gold, '40')}`, borderRadius: 8, padding: '11px 13px', marginBottom: 16,
          }}>
            {revertWasAccepted ? (
              <>
                This removes the study from active <strong style={{ color: C.txt }}>Data Extraction</strong> and returns
                the record to pending Final Review. Downstream updates automatically:
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  <li>PRISMA flow counts</li>
                  <li>Data Extraction &amp; analysis readiness</li>
                  <li>any meta-analysis that used this study may need to be re-run</li>
                </ul>
                <div style={{ marginTop: 8, color: C.grn }}>
                  Extracted data is kept and restored automatically if you send it again.
                </div>
              </>
            ) : (
              <>
                This returns the record to pending Final Review and clears the recorded
                exclusion reason. Downstream updates automatically:
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  <li>PRISMA flow counts and the exclusion-reason breakdown</li>
                  <li>the excluded-at-full-text totals in the manuscript</li>
                </ul>
                <div style={{ marginTop: 8, color: C.txt2 }}>
                  The original exclusion stays in the project audit trail — reopening it
                  is recorded as its own entry, not as a deletion.
                </div>
              </>
            )}
          </div>
          {rowError[revertFor.id] && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{rowError[revertFor.id]}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="ghost" disabled={!!finalizing[revertFor.id]}
              onClick={() => setRevertFor(null)}>Cancel</Button>
            <Button variant="primary" disabled={!!finalizing[revertFor.id]}
              style={{ background: C.gold, color: C.bg }}
              testId="final-review-reopen-confirm"
              onClick={submitRevert}>
              {finalizing[revertFor.id]
                ? 'Reverting…'
                : (revertWasAccepted ? 'Return to Final Review' : 'Reopen for Final Review')}
            </Button>
          </div>
        </Modal>
      )}

      {/* Re-accept choice — this record was previously reverted out of extraction */}
      {restoreFor && (
        <Modal onClose={() => { if (!finalizing[restoreFor.id]) setRestoreFor(null); }} width={460}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Send to Data Extraction</div>
          <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 16 }}>
            This study was previously in Data Extraction and then returned to Final Review.
            Its extracted data was kept. Restore that data, or start a fresh extraction entry?
          </div>
          {rowError[restoreFor.id] && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{rowError[restoreFor.id]}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="ghost" disabled={!!finalizing[restoreFor.id]}
              onClick={() => handleAccept(restoreFor, false)}>{finalizing[restoreFor.id] ? '…' : 'Start fresh'}</Button>
            <Button variant="primary" disabled={!!finalizing[restoreFor.id]} style={{ background: C.grn, color: C.bg }}
              onClick={() => handleAccept(restoreFor, true)}>{finalizing[restoreFor.id] ? 'Sending…' : 'Restore previous data'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Record card ───────────────────────────────────────────────────────────────
function RecordCard({
  pid, rec, access, blindMode, inclusion, exclusion,
  savingDecision, finalizing, rowError,
  onDecision, onAccept, onRetryHandoff, onRevert, onRejectClick,
}) {
  const [expanded, setExpanded] = useState(false);

  const sb = statusBadge(rec);
  const isPending = !rec.finalStatus;
  const sent = isSent(rec);
  const myDecision = rec.myDecision?.decision && rec.myDecision.decision !== UNDECIDED
    ? rec.myDecision.decision : null;

  const abstract = rec.abstract || '';
  const isLong = abstract.length > ABSTRACT_CLAMP;
  const shownAbstract = expanded || !isLong ? abstract : abstract.slice(0, ABSTRACT_CLAMP) + '…';

  const metaParts = [
    !blindMode && rec.authors ? firstAuthor(rec.authors) : null,
    !blindMode && rec.journal ? rec.journal : null,
    rec.year ? String(rec.year) : null,
  ].filter(Boolean);

  return (
    <Card style={{ padding: '18px 20px', borderColor: isPending ? C.brd : C.brd2 }}>
      {/* Header: title + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 8 }}>
        <h3 style={{
          fontSize: 15, fontWeight: 600, color: C.txt, margin: 0,
          lineHeight: 1.4, letterSpacing: '-0.01em', flex: 1, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere',
        }}>
          {rec.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
        </h3>
        <span style={{ flexShrink: 0 }}>
          <Badge color={sb.color} title={`Final status: ${rec.finalStatus || 'pending'}`}>{sb.label}</Badge>
        </span>
      </div>

      {/* Citation meta + links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: rec.finalStatus === 'rejected' && rec.rejectedReason ? 8 : 14 }}>
        {metaParts.length > 0 && (
          <span style={{ fontSize: 12, color: C.txt2, minWidth: 0, overflowWrap: 'anywhere' }}>{metaParts.join(' · ')}</span>
        )}
        {blindMode && (
          <Badge color={C.gold} title="Author / journal hidden during blind screening">Blind</Badge>
        )}
        {rec.doi && (
          <a href={`https://doi.org/${rec.doi}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-all' }}
            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
            DOI: {rec.doi}
          </a>
        )}
        {rec.pmid && (
          <a href={`https://pubmed.ncbi.nlm.nih.gov/${rec.pmid}/`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}
            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
            PMID: {rec.pmid}
          </a>
        )}
      </div>

      {/* Exclusion reason (if excluded) */}
      {rec.finalStatus === 'rejected' && rec.rejectedReason && (
        <div style={{
          fontSize: 12, color: C.red, background: C.redBg,
          border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 7, padding: '8px 12px', marginBottom: 14,
        }}>
          <span style={{ fontWeight: 600 }}>Reason: </span>{rec.rejectedReason}
        </div>
      )}

      {/* Abstract preview */}
      {abstract ? (
        <div style={{
          background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8,
          padding: '12px 14px', marginBottom: 14,
        }}>
          <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {/* 107.md §4 — segment the CLAMPED string so heading offsets match what
                is actually rendered (clamp first, then segment). */}
            {renderAbstract(shownAbstract, { inclusion, exclusion, showInclusion: true, showExclusion: true })}
          </div>
          {isLong && (
            <button onClick={() => setExpanded(v => !v)}
              style={{ marginTop: 8, background: 'none', border: 'none', color: C.acc, fontSize: 12, fontFamily: FONT, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              {expanded ? '▲ Show less' : '▼ Show more'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 14 }}>
          No abstract available for this record.
        </div>
      )}

      {/* Full-text PDF — upload + in-browser preview */}
      <div style={{ marginBottom: 14 }}>
        <PdfViewer pid={pid} recordId={rec.id} canManage={access.canScreen || access.isLeader} />
      </div>

      {/* Send status for accepted-but-not-yet-sent records */}
      {rec.finalStatus === 'accepted' && !sent && rec.handoffStatus && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          fontSize: 12, color: rec.handoffStatus === 'failed' ? C.red : C.gold,
          background: rec.handoffStatus === 'failed' ? C.redBg : C.goldBg,
          border: `1px solid ${alpha(rec.handoffStatus === 'failed' ? C.red : C.gold, '40')}`,
          borderRadius: 7, padding: '8px 12px', marginBottom: 14,
        }}>
          <span style={{ fontWeight: 600 }}>
            {rec.handoffStatus === 'pending' ? 'Accepted, not yet in Data Extraction.'
              : `Could not send to Data Extraction${rec.handoffError ? ' — ' + rec.handoffError : ''}.`}
          </span>
          {access.isLeader && (rec.handoffStatus === 'pending' || rec.handoffStatus === 'failed') && (
            <Button variant="ghost" disabled={finalizing} onClick={() => onRetryHandoff(rec)} style={{ fontSize: 11, padding: '4px 12px' }}>
              {finalizing ? 'Retrying…' : 'Retry send'}
            </Button>
          )}
        </div>
      )}

      {/* Reviewer decisions row */}
      <div style={{ marginBottom: isPending && (access.canScreen || access.isLeader) ? 16 : (sent && access.isLeader ? 16 : 0) }}>
        <div style={{
          fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: C.muted, marginBottom: 8,
        }}>
          Reviewer Decisions
        </div>
        {Array.isArray(rec.decisions) && rec.decisions.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {rec.decisions.map((d, i) => (
              <span key={d.reviewerId ?? i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <DecisionChip decision={d.decision} />
                <span style={{ fontSize: 11.5, color: C.txt2 }}>{d.reviewerName || `Reviewer ${i + 1}`}</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.muted }}>No final-review decisions yet.</div>
        )}
      </div>

      {/* Pending actions: reviewer decision + leader finalize */}
      {isPending && (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14, marginTop: 14 }}>
          {access.canScreen && (
            <div style={{ marginBottom: access.isLeader ? 14 : 0 }}>
              <div style={{
                fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: 8,
              }}>
                Your final-review decision
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SECOND_REVIEW_OPTIONS.map(opt => {
                  const active = myDecision === opt.value;
                  const busy = savingDecision === opt.value;
                  return (
                    // 117.md §79 (r2 fix) — the reviewer's VOTE and the leader's
                    // VERDICT both render as "Include"/"Exclude" on the same card for
                    // an owner (who is both), so a name-based locator matched two
                    // buttons and every Playwright click on it was a strict-mode
                    // violation. The two roles get distinct, stable testids.
                    <button key={opt.value} type="button" disabled={!!savingDecision}
                      data-testid={`final-review-vote-${opt.value}`}
                      onClick={() => onDecision(rec, opt.value)}
                      style={{
                        fontFamily: FONT, fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 7,
                        cursor: savingDecision ? 'wait' : 'pointer',
                        background: active ? alpha(opt.color, '20') : 'transparent',
                        border: `1px solid ${active ? alpha(opt.color, '80') : C.brd}`,
                        color: active ? opt.color : C.txt2,
                        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                        opacity: savingDecision && !busy ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (!active && !savingDecision) { e.currentTarget.style.borderColor = alpha(opt.color, '80'); e.currentTarget.style.color = opt.color; } }}
                      onMouseLeave={e => { if (!active && !savingDecision) { e.currentTarget.style.borderColor = C.brd; e.currentTarget.style.color = C.txt2; } }}>
                      {busy ? 'Saving…' : opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {access.isLeader && (
            <div>
              <div style={{
                fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: 8,
              }}>
                Final decision (leader)
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button variant="primary" disabled={finalizing} style={{ background: C.grn, color: C.bg }}
                  testId="final-review-accept"
                  onClick={() => onAccept(rec)} title="Accept and send to Data Extraction">
                  {finalizing ? 'Finalizing…' : 'Accept → Data Extraction'}
                </Button>
                <Button variant="danger" disabled={finalizing} onClick={onRejectClick}
                  testId="final-review-exclude"
                  title="Exclude this record at final review">
                  Exclude
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accepted records (sent OR pending send): leader can return to Final Review */}
      {rec.finalStatus === 'accepted' && access.isLeader && (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14, marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.txt2 }}>
            {sent ? 'This study is in Data Extraction.' : 'This study is accepted, not yet in Data Extraction.'}
          </span>
          <Button variant="ghost" disabled={finalizing} onClick={() => onRevert(rec)}
            testId="final-review-reopen"
            title="Return to pending Final Review (safe — extracted data is kept and restorable)">
            {finalizing ? 'Working…' : '↩ Return to Final Review'}
          </Button>
        </div>
      )}

      {/* 117.md §52 — an EXCLUDED record is reversible too. Ctrl+Z covers the decision
          the leader just made; this covers the one made last week, which is the same
          domain action and now has the same server-side inverse. */}
      {rec.finalStatus === 'rejected' && access.isLeader && (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14, marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.txt2 }}>
            This record is excluded at final review.
          </span>
          <Button variant="ghost" disabled={finalizing} onClick={() => onRevert(rec)}
            testId="final-review-reopen"
            title="Reopen this record for Final Review (the exclusion stays in the audit trail)">
            {finalizing ? 'Working…' : '↩ Reopen for Final Review'}
          </Button>
        </div>
      )}

      {rowError && (
        <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>{rowError}</div>
      )}
    </Card>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ toast, onClose }) {
  const tone = toast.kind === 'ok'
    ? { color: C.grn, bg: C.grnBg, brd: C.grn }
    : toast.kind === 'err'
      ? { color: C.red, bg: C.redBg, brd: C.red }
      : { color: C.teal, bg: C.tealBg, brd: C.teal };
  return (
    <div role="status"
      style={{
        position: 'sticky', top: 8, zIndex: 50, marginBottom: 16,
        background: C.surf, border: `1px solid ${alpha(tone.brd, '60')}`, borderLeft: `3px solid ${tone.brd}`,
        borderRadius: 9, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: `0 8px 30px ${C.shadow}`, animation: 'sift-fade 0.2s ease',
      }}>
      <span style={{ fontSize: 15 }} aria-hidden>
        {toast.kind === 'ok' ? '✓' : toast.kind === 'err' ? '✕' : 'ℹ'}
      </span>
      <span style={{ fontSize: 13, color: tone.color, fontWeight: 500, flex: 1 }}>{toast.text}</span>
      <button onClick={onClose} aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = C.txt2}
        onMouseLeave={e => e.currentTarget.style.color = C.muted}>×</button>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function firstAuthor(authors) {
  const s = String(authors || '').trim();
  if (!s) return '';
  const first = s.split(/[,;]/)[0].trim();
  return /[,;]/.test(s) ? `${first} et al.` : first;
}
