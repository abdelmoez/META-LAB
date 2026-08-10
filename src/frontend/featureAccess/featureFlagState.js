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

// 109.md §5 — the dependency graphs are now DERIVED from the shared typed
// catalogue, which the server imports too. They used to be hand-copied byte-for-
// byte between this file and server/services/featureAccess.js (plus a partial
// third copy in AdminConsole's FLAG_META), so the two could silently diverge.
// Importing the same frozen object makes divergence impossible by construction.
import {
  FEATURE_DEPS as CATALOG_FEATURE_DEPS,
  FEATURE_RUNTIME_DEPS as CATALOG_FEATURE_RUNTIME_DEPS,
  RESEARCH_GOVERNANCE_KEY, mergeDomainDefaults,
} from '../../shared/opsSettingsCatalog.js';

/**
 * HARD existence-gate dependency graph — the same frozen object the server's
 * featureAccess.js exports. A flag is only 'on' when it AND every (transitive)
 * dependency is on. Source of truth: OPS_FLAGS[].requires in the catalogue.
 */
export const FEATURE_DEPS = CATALOG_FEATURE_DEPS;

/**
 * Advisory (NON-gate) co-dependencies — mirror of the server's FEATURE_RUNTIME_DEPS.
 * livingReview stays viewable with pecanSearch OFF; its pecan requirement is a
 * RUNTIME concern (auto-runs), surfaced only as a hint, never as an existence gate.
 */
export const FEATURE_RUNTIME_DEPS = CATALOG_FEATURE_RUNTIME_DEPS;

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

/**
 * Fetch (and briefly cache) the WHOLE public settings payload.
 * 109.md §55 — the snapshot now backs both the flag reader and the Ops
 * research-governance knobs, so a screening page still issues ONE request rather
 * than adding a fifteenth independent /api/settings/public caller. Fail-closed.
 */
function publicSettingsSnapshot() {
  if (_cache && (now() - _cacheAt) < TTL_MS) return _cache;
  _cacheAt = now();
  _cache = fetch('/api/settings/public', { credentials: 'include' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => data || {})
    .catch(() => { _cache = null; return {}; });
  return _cache;
}

/** Fetch (and briefly cache) the public feature-flag snapshot. Fail-closed → {}. */
export function publicFeatureFlags() {
  return publicSettingsSnapshot().then((data) => (data && data.featureFlags) || {});
}

/**
 * 109.md §3 — the Ops research-governance knobs (screening navigation, keyword
 * suggestion policy, undo/redo history limits, proportion display precision,
 * analysis override policy), merged UNDER the catalogue defaults so a client
 * running against an older server, or one whose fetch failed, still gets the
 * shipped defaults rather than `undefined`. Consumers MUST also keep their own
 * hardcoded fallback for the synchronous path — these are UI defaults, not
 * enforcement; anything safety-related is enforced server-side.
 */
export function publicOpsSettings() {
  return publicSettingsSnapshot()
    .then((data) => mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, data && data[RESEARCH_GOVERNANCE_KEY]))
    .catch(() => mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, null));
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
