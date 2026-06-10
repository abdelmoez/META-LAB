/**
 * useRealtime.js — client side of the SSE poke channel (prompt6 Task 7;
 * server: GET /api/events — see docs/manager/realtime-architecture.md).
 *
 * ONE EventSource per browser tab, shared by every component via a module-level
 * connection manager (browsers cap ~6 concurrent HTTP/1.1 connections per
 * origin, so per-component/per-project streams are forbidden). The stream is
 * same-origin through the Vite proxy, so the httpOnly session cookie flows
 * automatically — no tokens, no extra auth path.
 *
 * Events are thin pokes: { type, projectId?, metaLabProjectId?, at }. Handlers
 * must REFETCH through the existing authorized REST endpoints — never trust an
 * event as data.
 *
 * Reconnect: EventSource retries CONNECTING states natively; when the browser
 * gives up (readyState CLOSED, e.g. after a 401 or server restart) we reopen
 * manually with capped exponential backoff (1s → 30s). `healthy` is false the
 * moment an error fires, so callers keep (or restore) their existing polling
 * cadence as the fallback; while healthy they may stretch poll intervals.
 *
 * Usage (handler TYPES are registered once on mount; the handler FUNCTIONS are
 * read through a ref each event, so fresh closures are always used):
 *
 *   const { healthy } = useRealtime({
 *     'chat.message': ev => { if (ev.projectId === pid) fetchNew(); },
 *   });
 */
import { useEffect, useRef, useState } from 'react';

const EVENTS_URL = '/api/events';
const MAX_BACKOFF_MS = 30000;

/* ── Module-level shared connection (one per tab) ───────────────────── */

const typeListeners = new Map();   // event type -> Set<fn>
const healthListeners = new Set(); // fn(healthy: boolean)

let es = null;             // the shared EventSource
let refCount = 0;          // mounted subscriber components
let healthy = false;       // true while the stream is open and error-free
let attempts = 0;          // consecutive failed (re)connects, for backoff
let reconnectTimer = null;

function setHealthy(next) {
  if (healthy === next) return;
  healthy = next;
  healthListeners.forEach(fn => { try { fn(next); } catch { /* subscriber bug — isolate */ } });
}

function dispatch(rawEvent) {
  let data;
  try { data = JSON.parse(rawEvent.data); } catch { return; }
  if (!data || !data.type) return;
  const set = typeListeners.get(data.type);
  if (!set) return;
  set.forEach(fn => { try { fn(data); } catch { /* subscriber bug — isolate */ } });
}

function scheduleReconnect() {
  if (reconnectTimer !== null || refCount === 0) return;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 5));
  attempts += 1;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, delay);
}

function open() {
  if (es || refCount === 0 || typeof EventSource === 'undefined') return;
  try { es = new EventSource(EVENTS_URL); } catch { scheduleReconnect(); return; }
  es.onopen = () => { attempts = 0; setHealthy(true); };
  es.onmessage = dispatch;
  es.onerror = () => {
    // Unhealthy immediately: callers fall back to their polling cadence.
    setHealthy(false);
    // CONNECTING → the browser is retrying on its own (retry: hint from the
    // server). CLOSED → it gave up (401, hard failure): reopen with backoff.
    if (es && es.readyState === EventSource.CLOSED) {
      try { es.close(); } catch { /* already closed */ }
      es = null;
      scheduleReconnect();
    }
  };
}

function close() {
  if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (es) { try { es.close(); } catch { /* best-effort */ } es = null; }
  attempts = 0;
  setHealthy(false);
}

/* ── Hook ───────────────────────────────────────────────────────────── */

/**
 * Subscribe to realtime poke events.
 * @param {Object<string, (event: object) => void>} [handlers]
 *        Map of event type → handler. The SET OF TYPES is fixed at mount;
 *        handler functions may close over fresh props/state (read via ref).
 * @returns {{ healthy: boolean }} connection health — false means "rely on
 *        your polling fallback"; true means pokes are flowing and polls may
 *        be stretched.
 */
export function useRealtime(handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [isHealthy, setIsHealthy] = useState(healthy);

  useEffect(() => {
    refCount += 1;
    open();

    const onHealth = h => setIsHealthy(h);
    healthListeners.add(onHealth);
    setIsHealthy(healthy); // sync in case it changed between render and effect

    // Register a stable proxy per type; proxies read the LATEST handler via ref.
    const proxies = new Map();
    for (const type of Object.keys(handlersRef.current || {})) {
      const proxy = ev => {
        const fn = handlersRef.current && handlersRef.current[type];
        if (fn) fn(ev);
      };
      proxies.set(type, proxy);
      let set = typeListeners.get(type);
      if (!set) { set = new Set(); typeListeners.set(type, set); }
      set.add(proxy);
    }

    return () => {
      healthListeners.delete(onHealth);
      for (const [type, proxy] of proxies) {
        const set = typeListeners.get(type);
        if (set) { set.delete(proxy); if (set.size === 0) typeListeners.delete(type); }
      }
      refCount -= 1;
      if (refCount === 0) close();
    };
    // Mount-once by design: the set of event TYPES must not change per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { healthy: isHealthy };
}
