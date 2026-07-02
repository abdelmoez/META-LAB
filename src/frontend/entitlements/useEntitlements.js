/**
 * useEntitlements.js — the signed-in user's product-tier context for the UI (67.md).
 *
 * Fetches GET /api/entitlements ONCE for the whole mount tree (a module-level
 * promise cache means fifty gated components share a single request), then hands
 * each caller a small, synchronous API: { has, limit, tierId, bypass, … }.
 *
 * FAIL-OPEN by design. The server is the authoritative gate — every protected
 * endpoint enforces the tier and returns a structured 403. The UI's only job is
 * to hide dead buttons and explain locked features, so a slow or failed fetch
 * must NEVER lock a user out of something they are entitled to. Therefore `has`
 * returns TRUE while loading, TRUE on a fetch error, and TRUE whenever the user
 * bypasses tiers (admins/mods). It returns the real value only once we have a
 * concrete, successful entitlement map that omits the key.
 */
import { useState, useEffect } from 'react';
import { hasEntitlement, limitOf } from '../../shared/entitlements.js';

// Module-level single-flight cache so many components trigger at most one fetch.
let _cache = null;      // the resolved context (or an error sentinel), once settled
let _promise = null;    // the in-flight fetch promise, if any
const _subscribers = new Set();

/** Shape returned to consumers when we have no concrete data (loading/error). */
const OPEN_CONTEXT = {
  loading: true, bypass: false, tierId: null, tierDisplayName: '',
  entitlements: null, enforcementEnabled: true, _errored: false,
};

async function fetchEntitlements() {
  const res = await fetch('/api/entitlements', { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return {
    loading: false,
    bypass: !!body.bypass,
    bypassReason: body.bypassReason || null,
    tierId: body.tierId ?? null,
    tierDisplayName: body.tierDisplayName || '',
    entitlements: body.entitlements && typeof body.entitlements === 'object' ? body.entitlements : {},
    enforcementEnabled: body.enforcementEnabled !== false,
    _errored: false,
  };
}

/** Kick off (or reuse) the shared fetch and notify subscribers when it settles. */
function ensureLoad() {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = fetchEntitlements()
    .then((ctx) => { _cache = ctx; return ctx; })
    .catch(() => {
      // Fail-OPEN: remember that we errored but keep `has` permissive.
      _cache = { ...OPEN_CONTEXT, loading: false, _errored: true };
      return _cache;
    })
    .finally(() => {
      _promise = null;
      for (const cb of _subscribers) { try { cb(); } catch { /* ignore */ } }
    });
  return _promise;
}

/**
 * Reset the module cache. Test-only — lets each test start from a clean fetch.
 * (Named with a leading underscore so it reads as internal.)
 */
export function _reset() {
  _cache = null;
  _promise = null;
  _subscribers.clear();
}

/**
 * Trigger (and await) the shared load, then return the caller-facing API built
 * from whatever settled — concrete on success, fail-open on error. Test-only seam
 * so a spec can assert the post-fetch state without React effects.
 */
export async function _loadForTest() {
  const ctx = await ensureLoad();
  return toApi(ctx);
}

/** Build the caller-facing API from a context object (concrete or open). */
function toApi(ctx) {
  const concrete = !!ctx && ctx.loading === false && !ctx._errored && ctx.entitlements;
  const bypass = !!ctx?.bypass;
  return {
    loading: !!ctx?.loading,
    bypass,
    tierId: ctx?.tierId ?? null,
    tierDisplayName: ctx?.tierDisplayName || '',
    entitlements: ctx?.entitlements || null,
    enforcementEnabled: ctx?.enforcementEnabled !== false,
    /**
     * Boolean feature check — FAIL-OPEN. True while loading, on error, or when the
     * user bypasses tiers; the real value only once we have a concrete map.
     */
    has(key) {
      if (bypass || !concrete) return true;
      return hasEntitlement(ctx.entitlements, key);
    },
    /**
     * Numeric limit for a key. Infinity while loading/error/bypass (no cap); the
     * real limit once concrete. -1 (UNLIMITED) resolves to Infinity via limitOf.
     */
    limit(key) {
      if (bypass || !concrete) return Infinity;
      return limitOf(ctx.entitlements, key);
    },
  };
}

/**
 * useEntitlements — subscribe to the shared entitlement context. Every consumer
 * across the mount tree shares one fetch; the returned object is fail-open.
 */
export function useEntitlements() {
  const [ctx, setCtx] = useState(() => _cache || OPEN_CONTEXT);

  useEffect(() => {
    let live = true;
    const sync = () => { if (live) setCtx(_cache || OPEN_CONTEXT); };
    _subscribers.add(sync);
    if (_cache) sync();
    else ensureLoad().then(sync);
    return () => { live = false; _subscribers.delete(sync); };
  }, []);

  return toApi(ctx);
}

export default useEntitlements;
