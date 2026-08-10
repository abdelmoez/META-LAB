/**
 * opsErrorReporter.js — 109.md §§6, 46, 47. The client half of the bounded
 * client-error capture the Ops console renders.
 *
 * WHAT IT IS FOR. `components/errorReporting.js` already beacons render CRASHES.
 * The three failures 109.md §46 asks Ops to see are not crashes — they are silent
 * operational refusals the user experiences as "it didn't work":
 *
 *   · `history-persist-failed`   an undo/redo executor could not persist its inverse
 *   · `autosave-conflict`        a project autosave lost a compare-and-set (409)
 *   · `stale-mutation-refused`   a mutation refused because a collaborator moved first
 *
 * WHAT IT IS NOT. This is CAPTURE, not a metric. Nothing here counts successes,
 * measures undo usage, or claims coverage — 109.md §6 is explicit that the Ops undo
 * health card must say "no telemetry beyond error reports" rather than invent one.
 *
 * ── HARD RULES ───────────────────────────────────────────────────────────────
 *  1. NEVER blocking. Every entry point is fire-and-forget and swallows everything;
 *     a telemetry failure must never become a second user-visible failure.
 *  2. NEVER any PII or project content. Callers pass a FIXED message; `redactQuoted`
 *     is a second line of defence that strips “…” / "…" spans, because this app
 *     wraps user content (keyword terms, article titles) in curly quotes by
 *     convention. Values, ids, notes, abstracts and stacks are never sent.
 *  3. BOUNDED. Per-session caps on total beacons and on distinct fingerprints, plus
 *     a per-fingerprint cooldown, so a wedged retry loop cannot spray the server
 *     (which caps stored rows at 5,000 fingerprints of its own — §6).
 *
 * The decision half is PURE (`shouldSend`) so the bounds are unit-tested without a
 * DOM or a network.
 */
import { releaseId, browserTag, newCorrelationId } from '../components/errorReporting.js';

/** The three operational failures this round captures (109.md §46). */
export const OPS_ERROR_KINDS = Object.freeze({
  HISTORY_PERSIST: 'history-persist-failed',
  AUTOSAVE_CONFLICT: 'autosave-conflict',
  STALE_MUTATION: 'stale-mutation-refused',
});

/** Mirrors the server's CLIENT_ERROR_LIMITS — truncate here too, never rely on it. */
export const REPORT_LIMITS = Object.freeze({ kind: 80, message: 500, context: 500 });

/** Per-session bounds. Deliberately small: this is a signal, not a log stream. */
export const SESSION_REPORT_CAP = 20;
export const DISTINCT_FINGERPRINT_CAP = 25;
export const DEDUPE_WINDOW_MS = 60000;

const oneLine = (v, n) => (v == null ? '' : String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n));

/**
 * redactQuoted(text) — replace the CONTENT of curly-quoted and straight-quoted spans
 * with an ellipsis. The app's user-facing notes read `Added “ketamine” to inclusion
 * keywords.`, so a caller that forwards one of those verbatim still cannot leak the
 * term. Idempotent, and a no-op on a message with no quotes.
 */
export function redactQuoted(text) {
  return String(text == null ? '' : text)
    .replace(/[“][^”]*[”]/g, '“…”')
    .replace(/"[^"]*"/g, '"…"');
}

/** Stable, cheap fingerprint — no crypto in the browser bundle for a dedupe key. */
export function fingerprintReport({ kind, message, engine } = {}) {
  return `${oneLine(kind, REPORT_LIMITS.kind)}|${oneLine(message, REPORT_LIMITS.message)}|${oneLine(engine, 60)}`;
}

/**
 * shouldSend(state, fingerprint, at) → {send, state} — PURE.
 *
 * `state` is `{ sent: number, seen: {[fingerprint]: lastAtMs} }`. Returns a NEW state
 * only when something changed (the repo's byte-stability rule applied to a counter),
 * so a suppressed report is free.
 */
export function shouldSend(state, fingerprint, at) {
  const s = (state && typeof state === 'object') ? state : { sent: 0, seen: {} };
  const seen = (s.seen && typeof s.seen === 'object') ? s.seen : {};
  const now = Number.isFinite(at) ? at : 0;
  if (!fingerprint) return { send: false, state: s };
  if (s.sent >= SESSION_REPORT_CAP) return { send: false, state: s };
  const last = seen[fingerprint];
  if (Number.isFinite(last) && (now - last) < DEDUPE_WINDOW_MS) return { send: false, state: s };
  const known = Object.prototype.hasOwnProperty.call(seen, fingerprint);
  if (!known && Object.keys(seen).length >= DISTINCT_FINGERPRINT_CAP) return { send: false, state: s };
  return { send: true, state: { sent: s.sent + 1, seen: { ...seen, [fingerprint]: now } } };
}

let _state = { sent: 0, seen: {} };

/** Test/HMR hook — forget the session bounds. */
export function resetOpsErrorReporter() { _state = { sent: 0, seen: {} }; }

/** Read-only view of the session bounds (Ops has the server-side view; this is for tests). */
export function opsErrorReporterState() { return _state; }

function routePath() {
  try { return window.location.pathname; } catch { return ''; }
}

/**
 * reportOpsError({kind, message, engine}) → boolean (was a beacon actually sent).
 *
 * Fire-and-forget: `sendBeacon` when available (it survives an unload), otherwise a
 * `keepalive` fetch whose rejection is swallowed. Returns false — never throws —
 * when the report was deduped, capped, or the environment has no transport.
 */
export function reportOpsError({ kind, message, engine } = {}, { now } = {}) {
  try {
    const k = oneLine(kind, REPORT_LIMITS.kind);
    const m = oneLine(redactQuoted(message), REPORT_LIMITS.message);
    if (!k && !m) return false;
    const at = typeof now === 'function' ? now() : Date.now();
    const decision = shouldSend(_state, fingerprintReport({ kind: k, message: m, engine }), at);
    if (!decision.send) return false;
    _state = decision.state;
    const body = JSON.stringify({
      kind: k,
      name: k,
      message: m,
      engine: oneLine(engine, 60),
      route: routePath(),
      release: releaseId(),
      browser: browserTag(),
      correlationId: newCorrelationId(),
    });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/client-errors', new Blob([body], { type: 'application/json' }));
      return true;
    }
    if (typeof fetch === 'function') {
      // `.catch` on the promise, not `await`: the caller is on a UX path.
      fetch('/api/client-errors', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body,
      }).catch(() => {});
      return true;
    }
    return false;
  } catch {
    return false;   // rule 1 — telemetry never becomes a second failure
  }
}

/** An undo/redo executor could not persist its inverse (109.md §46). */
export function reportHistoryPersistFailure({ scope, kind, reason } = {}) {
  return reportOpsError({
    kind: OPS_ERROR_KINDS.HISTORY_PERSIST,
    message: `history ${oneLine(kind, 60) || 'entry'} could not be persisted (${oneLine(reason, 60) || 'failed'})`,
    engine: oneLine(scope, 60),
  });
}

/** A project autosave lost a compare-and-set (109.md §46). */
export function reportAutosaveConflict({ scope } = {}) {
  return reportOpsError({
    kind: OPS_ERROR_KINDS.AUTOSAVE_CONFLICT,
    message: 'autosave rejected with a version conflict (409)',
    engine: oneLine(scope, 60),
  });
}

/** A mutation refused because the underlying record moved first (109.md §46). */
export function reportStaleMutationRefusal({ scope, kind, detail } = {}) {
  return reportOpsError({
    kind: OPS_ERROR_KINDS.STALE_MUTATION,
    message: `${oneLine(kind, 60) || 'mutation'} refused as stale (${oneLine(detail, 60) || 'precondition'})`,
    engine: oneLine(scope, 60),
  });
}

export default reportOpsError;
