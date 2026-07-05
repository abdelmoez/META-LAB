/**
 * featureFlagState.js — 75.md Phase 7 (client side).
 *
 * The browser mirror of server/services/featureAccess.js. Resolves a feature flag
 * to one of three states so UI surfaces can render correctly for admins vs everyone
 * else WITHOUT leaking a globally-disabled feature to non-admins:
 *
 *   'on'        → feature (and all hard deps) enabled → render normally.
 *   'adminOnly' → globally OFF but the viewer is an ADMIN → render the surface plus
 *                 an "Enabled for admins only — hidden from other users" hint.
 *   'off'       → globally OFF for a non-admin → hide the surface (legacy fallback).
 *
 * The BACKEND is the real enforcement point (every gated route 404s a non-admin);
 * this helper only decides what to paint. It reads the public settings snapshot
 * (`/api/settings/public`, no auth) exactly like the existing per-feature
 * `*FlagEnabled` helpers, but adds the dependency graph + admin awareness in ONE
 * place. Admin = `user.role === 'admin'` (mirrors the server admin-only bypass; NOT
 * mods — kept in lockstep with server/services/featureAccess.isFlagAdmin).
 *
 * WAVE 2: broad UI hinting (rendering the 'adminOnly' badge across every gated
 * surface) is a follow-up. This file is the clean seam wave-2 should consume:
 *   const state = await featureFlagState('livingReview', user);
 *   if (state === 'off') return null;              // hidden for non-admins
 *   return <Surface adminHint={state === 'adminOnly'} />;
 * A ready-to-drop hint component ships alongside as AdminOnlyFeatureHint.jsx.
 */

/**
 * HARD existence-gate dependency graph — byte-mirror of FEATURE_DEPS in
 * server/services/featureAccess.js. A flag is only 'on' when it AND every
 * (transitive) dependency is on. Keep this in sync with the server table.
 */
export const FEATURE_DEPS = Object.freeze({
  pecanSearch: ['searchEngine'],
  searchStrategyStudio: ['searchEngine', 'pecanSearch'],
  guidedRobAppraisal: ['rob_engine_v2'],
  searchWorkspaceV2: ['searchEngine'],
});

/**
 * Advisory (NON-gate) co-dependencies — mirror of the server's FEATURE_RUNTIME_DEPS.
 * livingReview stays viewable with pecanSearch OFF; its pecan requirement is a
 * RUNTIME concern (auto-runs), surfaced only as a hint, never as an existence gate.
 */
export const FEATURE_RUNTIME_DEPS = Object.freeze({
  livingReview: ['pecanSearch'],
});

/** Admin-only predicate for FLAGS (narrower than tier/staff — excludes mods). */
export function isFlagAdmin(user) {
  return user?.role === 'admin';
}

/** Pure: is `key` on in a resolved flags object (flag AND all hard deps, recursively)? */
export function isFlagOn(flags, key, _seen) {
  if (!flags || flags[key] !== true) return false;
  const deps = FEATURE_DEPS[key];
  if (!deps || deps.length === 0) return true;
  const seen = _seen || new Set();
  if (seen.has(key)) return true;
  seen.add(key);
  return deps.every((d) => isFlagOn(flags, d, seen));
}

// ── Shared, briefly-cached public flag snapshot (generalizes robApi's pattern so
// every flag helper shares ONE in-flight/short-lived fetch instead of 14 copies). ──
let _cache = null;
let _cacheAt = 0;
const TTL_MS = 5000;

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/** Fetch (and briefly cache) the public feature-flag snapshot. Fail-closed → {}. */
export function publicFeatureFlags() {
  if (_cache && (now() - _cacheAt) < TTL_MS) return _cache;
  _cacheAt = now();
  _cache = fetch('/api/settings/public', { credentials: 'include' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data && data.featureFlags) || {})
    .catch(() => { _cache = null; return {}; });
  return _cache;
}

/** Test/HMR hook: drop the cached snapshot so the next read re-fetches. */
export function clearFeatureFlagCache() { _cache = null; _cacheAt = 0; }

/**
 * featureFlagState(key, user) → 'on' | 'adminOnly' | 'off'.
 * The client counterpart of server featureAccess(). `user` is the useAuth() user
 * ({ role, ... }) or null. Never throws; fail-closed to 'off' for non-admins.
 */
export async function featureFlagState(key, user = null) {
  const flags = await publicFeatureFlags();
  if (isFlagOn(flags, key)) return 'on';
  return isFlagAdmin(user) ? 'adminOnly' : 'off';
}

/**
 * Boolean shim so existing `*FlagEnabled()` helpers can delegate here WITHOUT
 * changing their signatures. Non-admins: true only when 'on'. Admins: true when the
 * feature is at least admin-usable (so an admin's UI keeps working while it is
 * globally OFF). Existing helpers that must stay strictly boolean-flag can pass
 * `user = null` (→ strict 'on').
 */
export async function featureFlagEnabled(key, user = null) {
  const state = await featureFlagState(key, user);
  return state === 'on' || (state === 'adminOnly' && isFlagAdmin(user));
}

export default featureFlagState;
