/**
 * designMode.js — pure, dependency-free core of the design-mode system.
 *
 * PecanRev ships TWO presentation layers over ONE shared application (same APIs,
 * routes, data, permissions, business logic):
 *   - `stitch` — the product UI. ALWAYS the default for every user.
 *   - `legacy` — the classic interface, kept as an admin/Ops-governed fallback.
 *
 * HARD RULES encoded here (65.md — the governance contract):
 *   1. The theme is Ops-governed for users: a NON-ADMIN always renders
 *      `settings.defaultMode` (shipped: stitch). Their ?ui= override and any saved
 *      preference are IGNORED unless Ops flips `settings.allowLegacyFallback` on —
 *      the emergency escape that re-enables ?ui=legacy links + saved preferences.
 *   2. An ADMIN (user.role === 'admin') keeps the personal chain:
 *      ?ui= override → saved preference → settings.defaultMode.
 *   3. Any invalid / unknown value FAILS SAFE to `stitch` (the product UI).
 *
 * This module has NO imports, NO React, NO DOM beyond the tiny localStorage/dataset
 * helpers (each individually guarded) — so it is trivially unit-testable and safe to
 * import from anywhere (the pre-paint bootstrap mirrors this logic in index.html).
 */

export const DESIGN_MODES = ['legacy', 'stitch'];
export const DEFAULT_MODE = 'stitch';
export const STORAGE_KEY = 'metalab_ui_design';
/** localStorage cache of the public `designSettings` record — lets the index.html
 *  pre-paint bootstrap (and the provider's pre-fetch seed) know the Ops-governed
 *  defaultMode before /api/settings/public resolves, so there is never a
 *  wrong-theme first paint for returning visitors. */
export const SETTINGS_CACHE_KEY = 'metalab_design_settings';
/** dataset key on <html> (document.documentElement.dataset.uiDesign) → attr data-ui-design */
export const ROOT_DATASET_KEY = 'uiDesign';

/** True only for a concrete, supported mode string. */
export function isValidMode(mode) {
  return typeof mode === 'string' && DESIGN_MODES.includes(mode);
}

/** Coerce anything to a supported mode, failing safe to the product UI (stitch). */
export function normalizeMode(mode) {
  return isValidMode(mode) ? mode : DEFAULT_MODE;
}

/**
 * The single source of truth for "may this user hold a PERSONAL design preference".
 * Mirrors AdminRoute's staff check but is STRICTER: mods are staff for the Ops
 * console, but design governance is admin-only (design.md §5: "Do not allow
 * moderators to obtain admin-only design controls.").
 */
export function isDesignAdmin(user) {
  return !!user && user.role === 'admin';
}

/**
 * Parse a `?ui=` override from a query string (e.g. location.search).
 * Returns a valid mode or null. This is intentionally permissive about the
 * leading "?" and about extra params.
 */
export function readQueryOverride(search) {
  if (typeof search !== 'string' || !search) return null;
  let value = null;
  try {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    value = qs.get('ui');
  } catch {
    return null;
  }
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  return isValidMode(v) ? v : null;
}

/**
 * Resolve the effective design mode from all inputs. This is the function the
 * provider (and the unit tests) rely on; the ordering IS the contract:
 *
 *   admin                          → ?ui= override → saved preference → settings.defaultMode
 *   non-admin, fallback ENABLED    → same chain (Ops opted users into the escape hatch)
 *   non-admin, fallback OFF (norm) → ALWAYS settings.defaultMode — override + saved IGNORED
 *
 * `settings` = { defaultMode = 'stitch', allowLegacyFallback = false } — the Ops
 * `designSettings` SiteSetting. The pre-61 call shape (top-level `defaultMode`)
 * is still accepted so stale callers degrade gracefully instead of crashing.
 *
 * @param {object}  args
 * @param {object?} args.user           current user (or null)
 * @param {string?} args.savedMode      persisted preference (localStorage or server)
 * @param {string?} args.queryOverride  already-parsed ?ui= value (or null)
 * @param {object?} args.settings       Ops designSettings { defaultMode, allowLegacyFallback }
 */
export function resolveDesignMode({ user, savedMode, queryOverride, settings, defaultMode } = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const dflt = isValidMode(s.defaultMode) ? s.defaultMode
    : isValidMode(defaultMode) ? defaultMode // legacy call shape (prompt61)
    : DEFAULT_MODE;
  const personalChain = isDesignAdmin(user) || s.allowLegacyFallback === true;
  if (!personalChain) return dflt;
  if (isValidMode(queryOverride)) return queryOverride;
  if (isValidMode(savedMode)) return savedMode;
  return dflt;
}

/* ─── localStorage persistence (each call individually guarded) ───────────── */

export function getSavedDesignMode() {
  try {
    const m = localStorage.getItem(STORAGE_KEY);
    return isValidMode(m) ? m : null;
  } catch {
    return null;
  }
}

export function saveDesignMode(mode) {
  try {
    if (isValidMode(mode)) localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}

export function clearSavedDesignMode() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

/* ─── designSettings cache (pre-paint seed for the Ops-governed default) ────── */

/** Read the cached public designSettings, or null when absent/corrupt. */
export function getCachedDesignSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj || typeof obj !== 'object') return null;
    return {
      allowAllUsers: !!obj.allowAllUsers,
      defaultMode: isValidMode(obj.defaultMode) ? obj.defaultMode : DEFAULT_MODE,
      allowLegacyFallback: obj.allowLegacyFallback === true,
    };
  } catch {
    return null;
  }
}

/** Cache the fetched public designSettings for the next pre-paint bootstrap. */
export function cacheDesignSettings(settings) {
  try {
    if (!settings || typeof settings !== 'object') return;
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({
      allowAllUsers: !!settings.allowAllUsers,
      defaultMode: isValidMode(settings.defaultMode) ? settings.defaultMode : DEFAULT_MODE,
      allowLegacyFallback: settings.allowLegacyFallback === true,
    }));
  } catch {
    /* non-fatal */
  }
}

/* ─── DOM application (sets the CSS-isolation root attribute) ──────────────── */

/**
 * Set <html data-ui-design="..."> so the scoped Stitch stylesheet activates.
 * Always normalizes — a bad value paints the product UI, never an undefined attr.
 * No-ops outside the browser.
 */
export function applyDesignAttr(mode) {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset[ROOT_DATASET_KEY] = normalizeMode(mode);
  } catch {
    /* non-fatal */
  }
}
