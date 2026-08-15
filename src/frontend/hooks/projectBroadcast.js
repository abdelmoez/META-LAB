/**
 * projectBroadcast.js — 117.md §13 / §J.10 / §K.6. Same-user, cross-WINDOW pokes.
 *
 * THE GAP THIS CLOSES. The SSE bus (`useRealtime`) deliberately excludes the ACTING
 * user from decision / finalize / import events: their own UI already reflects the
 * change, in the surface that made it. That is right for one window and wrong for
 * two — screening in one tab with the manuscript open in another is an ordinary way
 * to work, and until now those numbers only caught up on the manuscript's 20s
 * visibility throttle (117.md §J.10).
 *
 * A BroadcastChannel is exactly the missing edge: same origin, same browser profile,
 * every other tab of the SAME user, no server involved. It carries the same THIN
 * POKE the SSE bus carries — `{ projectId, kind }`, ids only — so a listener still
 * refetches through the authorized REST endpoints and nothing here is ever trusted
 * as data (global invariant 8).
 *
 * WHERE IT IS POSTED. On the CLIENT, right after the write returns 2xx (see
 * `screeningApi`), because that is the one place that knows the call actually
 * succeeded. A poke for a write that failed would be a lie the listener cannot
 * check cheaply.
 *
 * DEGRADE. `BroadcastChannel` is absent in some embedded/older browsers and in SSR
 * and jsdom-less unit tests, so every function here is a no-op when it is missing:
 * subscribing returns an unsubscribe that does nothing, publishing returns false.
 * The visibility throttle remains the fallback, exactly as before.
 *
 * The channel is opened LAZILY on first use and shared per tab (one channel, many
 * subscribers), mirroring the single-EventSource rule in `useRealtime`.
 */

export const PROJECT_BROADCAST_CHANNEL = 'metalab.project';

/** The poke kinds this channel carries. Mirrors the SSE types they shadow. */
export const PROJECT_BROADCAST_KINDS = Object.freeze({
  DECISION: 'decision.saved',
  HANDOFF: 'handoff.updated',
  RECORD: 'record.updated',
  IMPORT: 'import.completed',
});

const clean = (s) => String(s == null ? '' : s).trim();

/** True when this runtime can broadcast at all. Pure. */
export function projectBroadcastSupported() {
  return typeof globalThis !== 'undefined' && typeof globalThis.BroadcastChannel === 'function';
}

/**
 * Normalize an outgoing poke, or null when it carries nothing worth sending.
 * A poke with no projectId cannot be matched by any listener, so it is not sent.
 * Pure.
 */
export function projectPoke(projectId, kind) {
  const pid = clean(projectId);
  const k = clean(kind);
  if (!pid || !k) return null;
  return { projectId: pid, kind: k };
}

/**
 * Should a listener watching `projectId` react to this message? Ids only — an
 * unrelated project's poke is ignored, and a malformed message never throws. Pure.
 */
export function matchesProjectPoke(message, projectId) {
  const pid = clean(projectId);
  if (!pid || !message || typeof message !== 'object') return false;
  if (!clean(message.kind)) return false;
  return clean(message.projectId) === pid;
}

/* ── the shared channel ─────────────────────────────────────────────────────── */

let channel = null;
let refCount = 0;
const listeners = new Set();

function onMessage(ev) {
  const data = ev && ev.data;
  // A subscriber bug must not silence the others (the useRealtime dispatch rule).
  listeners.forEach((fn) => { try { fn(data); } catch { /* isolate */ } });
}

function openChannel() {
  if (channel || !projectBroadcastSupported()) return channel;
  try {
    channel = new globalThis.BroadcastChannel(PROJECT_BROADCAST_CHANNEL);
    channel.onmessage = onMessage;
  } catch { channel = null; }
  return channel;
}

function closeChannel() {
  if (!channel) return;
  try { channel.close(); } catch { /* already closed */ }
  channel = null;
}

/**
 * Post a poke to every OTHER window of this user. Best-effort and synchronous-safe:
 * it never throws and never blocks the caller's write path.
 * @returns {boolean} true when the poke was actually posted.
 */
export function publishProjectPoke(projectId, kind) {
  const poke = projectPoke(projectId, kind);
  if (!poke) return false;
  // The SHARED channel, opened lazily — deliberately not a create-post-close pair:
  // closing a channel in the same turn it posted is the one shape whose delivery
  // guarantee varies between engines, and a single idle channel object costs nothing
  // (it is not a connection). This mirrors useRealtime's one-EventSource-per-tab rule.
  const ch = openChannel();
  if (!ch) return false;
  try { ch.postMessage(poke); return true; } catch { return false; }
}

/**
 * Subscribe to pokes for ONE project.
 * @param {string} projectId    the project to watch (ignored when empty)
 * @param {(poke:{projectId:string,kind:string}) => void} handler
 * @returns {() => void} unsubscribe (a no-op when unsupported)
 */
export function subscribeProjectPokes(projectId, handler) {
  const pid = clean(projectId);
  if (!pid || typeof handler !== 'function' || !projectBroadcastSupported()) return () => {};
  const fn = (data) => { if (matchesProjectPoke(data, pid)) handler(data); };
  listeners.add(fn);
  refCount += 1;
  openChannel();
  return () => {
    if (!listeners.delete(fn)) return;
    refCount -= 1;
    if (refCount <= 0) { refCount = 0; closeChannel(); }
  };
}

export default {
  PROJECT_BROADCAST_CHANNEL,
  PROJECT_BROADCAST_KINDS,
  projectBroadcastSupported,
  projectPoke,
  matchesProjectPoke,
  publishProjectPoke,
  subscribeProjectPokes,
};
