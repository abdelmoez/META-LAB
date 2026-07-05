/**
 * featureAccess.js — 75.md Phase 7. ONE centralized seam for site-wide feature
 * flag enforcement WITH an admin override.
 *
 * Core rule (Phase 7): a globally-disabled feature stays fully usable by ADMINS
 * (see / open / use / test) but is blocked for everyone else, enforced on the
 * BACKEND. The non-admin OFF response stays the repo's existing existence-hiding
 * 404 (existence-hidden); admins pass through (200).
 *
 * This is DISTINCT from two other access axes — do NOT fold them in here:
 *   - product TIERS  → per-user 403 TIER_LIMIT_EXCEEDED (entitlementService.js),
 *   - project MEMBERSHIP → 404 "Project not found" from the access resolvers.
 * A flag gate answers only "does this feature exist for this caller?".
 *
 * Reader: getEffectiveFeatureFlags() (settingsController.js) — the canonical merged
 * reader (stored featureFlags row over DEFAULTS, stored wins). Consulting it here
 * also retires the ~12 hand-rolled `prisma.siteSetting.findUnique({key:'featureFlags'})`
 * copies that each re-implemented the same fail-closed read.
 *
 * Admin predicate: flags use an ADMIN-ONLY bypass (`user.role === 'admin'`),
 * matching server `requireAdmin`. This is deliberately NARROWER than the tier
 * bypass (`isSystemBypassUser` = admin OR mod, entitlementService.js:110): mods do
 * NOT get a flag override. requireAdmin (admin-only) is the safest match for
 * "keep a disabled feature usable by admins" and avoids silently exposing dark
 * features to moderators. See DECISIONS in the 75.md Workstream-C report.
 */
import { getEffectiveFeatureFlags } from '../controllers/settingsController.js';

/**
 * HARD existence-gate dependency graph. A flag is only "on" when it AND every
 * (transitive) dependency flag is on — mirrors the checks previously duplicated in
 * runService.pecanSearchEnabled (pecan→searchEngine), strategyStudioService.studioEnabled
 * (studio→searchEngine+pecan), robController.guidedAppraisalEnabled (guided→rob_engine_v2)
 * and the client searchWorkspaceFlag (workspaceV2→searchEngine).
 *
 * NOTE — livingReview is intentionally ABSENT: its co-dependency on `pecanSearch`
 * is a RUNTIME concern (auto-runs / runSavedSearch → 409 PECAN_DISABLED in
 * livingService), NOT an existence gate. The Living Review dashboard/queue/snapshots
 * stay viewable with pecanSearch OFF, exactly as today; encoding it as a hard dep
 * here would 404 that surface and change existing gate semantics. The advisory
 * co-dependency is documented in FEATURE_RUNTIME_DEPS for the client hint + wave 2.
 */
export const FEATURE_DEPS = Object.freeze({
  pecanSearch: ['searchEngine'],
  searchStrategyStudio: ['searchEngine', 'pecanSearch'],
  guidedRobAppraisal: ['rob_engine_v2'],
  searchWorkspaceV2: ['searchEngine'],
});

/**
 * Advisory (NON-gate) co-dependencies. These do NOT affect the existence decision
 * in featureAccess(); they exist so the client can render an accurate "needs X too"
 * hint and wave-2 UI can surface it. livingReview's pecan requirement is enforced
 * at RUNTIME (the 409 in livingService), not at the existence gate.
 */
export const FEATURE_RUNTIME_DEPS = Object.freeze({
  livingReview: ['pecanSearch'],
});

/** Admin-only bypass predicate for FLAGS (narrower than the tier bypass). */
export function isFlagAdmin(user) {
  return user?.role === 'admin';
}

/**
 * Is `key` effectively ON in a resolved flags object — i.e. the flag itself is true
 * AND every hard dependency (recursively) is true. Pure; no I/O.
 */
export function isFlagOn(flags, key, _seen) {
  if (!flags || flags[key] !== true) return false;
  const deps = FEATURE_DEPS[key];
  if (!deps || deps.length === 0) return true;
  // Guard against an accidental dependency cycle (there is none today).
  const seen = _seen || new Set();
  if (seen.has(key)) return true;
  seen.add(key);
  return deps.every((d) => isFlagOn(flags, d, seen));
}

/**
 * featureAccess — the central decision.
 * @param {string} flagKey  the feature flag key (e.g. 'pecanSearch').
 * @param {object|null} user  the request user ({ role, ... }) or null for no-user
 *   contexts (schedulers, workers, unauthenticated probes) — those get PLAIN flag
 *   state with NO admin path.
 * @param {object|null} [flagsSnapshot]  pre-fetched flags to avoid a second read
 *   (e.g. when a handler already loaded getEffectiveFeatureFlags()).
 * @returns {Promise<{allowed:boolean, reason:'on'|'adminOnly'|'off'}>}
 *   - flag (and all deps) ON                     → { allowed:true,  reason:'on' }
 *   - flag (or a dep) OFF but user is an admin    → { allowed:true,  reason:'adminOnly' }
 *   - flag (or a dep) OFF and user is not admin   → { allowed:false, reason:'off' }
 * Never throws; fails closed (treats a read failure as flags-off).
 */
export async function featureAccess(flagKey, user = null, flagsSnapshot = null) {
  let flags = flagsSnapshot;
  if (!flags) {
    try { flags = await getEffectiveFeatureFlags(); }
    catch { flags = {}; } // fail-closed
  }
  if (isFlagOn(flags, flagKey)) return { allowed: true, reason: 'on' };
  if (isFlagAdmin(user)) return { allowed: true, reason: 'adminOnly' };
  return { allowed: false, reason: 'off' };
}

/**
 * gateFeature — express-friendly gate matching the repo's local `gate(req, res)`
 * idiom. Returns the boolean directly and, on a non-admin OFF, sends the standard
 * existence-hiding 404 itself (so the caller just `if (!(await gateFeature(...))) return;`).
 *
 * Migration note: existing `if (!(await xEnabled())) { res.status(404)...; return null }`
 * gates become `if (!(await gateFeature(req, res, 'x'))) return null;` — but most
 * controllers migrate even more cheaply by threading `req.user` into their existing
 * `xEnabled(user)` helper (which now delegates here).
 */
export async function gateFeature(req, res, flagKey) {
  const { allowed } = await featureAccess(flagKey, req.user || null);
  if (!allowed) { res.status(404).json({ error: 'Not found' }); return false; }
  return true;
}

/**
 * requireFeature — express middleware form. 404 for non-admin when OFF; admins and
 * the enabled state call next(). Handy for router-level mounting.
 */
export function requireFeature(flagKey) {
  return async (req, res, next) => {
    const { allowed } = await featureAccess(flagKey, req.user || null);
    if (!allowed) return res.status(404).json({ error: 'Not found' });
    return next();
  };
}
