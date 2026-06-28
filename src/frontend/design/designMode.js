/**
 * designMode.js — pure, dependency-free core of the parallel design-mode system.
 *
 * PecanRev ships TWO presentation layers over ONE shared application (same APIs,
 * routes, data, permissions, business logic):
 *   - `legacy` — the existing, production interface. ALWAYS the default.
 *   - `stitch` — the new "Vivid Enterprise" research-OS design (admin preview).
 *
 * HARD RULES encoded here (the security/safety contract):
 *   1. Only an ADMIN (user.role === 'admin') may ever resolve to `stitch`.
 *      Non-admins, signed-out visitors, and mods ALWAYS get `legacy`. This is the
 *      authoritative client gate; the server independently refuses to PERSIST
 *      `stitch` for a non-admin (profileController), so neither layer can be
 *      tricked into showing the preview to a normal user.
 *   2. Any invalid / unknown saved value FAILS SAFE to `legacy`.
 *   3. A `?ui=legacy` query override is the emergency escape hatch and always wins.
 *
 * This module has NO imports, NO React, NO DOM beyond the tiny localStorage/dataset
 * helpers (each individually guarded) — so it is trivially unit-testable and safe to
 * import from anywhere (the pre-paint bootstrap mirrors this logic in index.html).
 */

export const DESIGN_MODES = ['legacy', 'stitch'];
export const DEFAULT_MODE = 'legacy';
export const STORAGE_KEY = 'metalab_ui_design';
/** dataset key on <html> (document.documentElement.dataset.uiDesign) → attr data-ui-design */
export const ROOT_DATASET_KEY = 'uiDesign';

/** True only for a concrete, supported mode string. */
export function isValidMode(mode) {
  return typeof mode === 'string' && DESIGN_MODES.includes(mode);
}

/** Coerce anything to a supported mode, failing safe to legacy. */
export function normalizeMode(mode) {
  return isValidMode(mode) ? mode : DEFAULT_MODE;
}

/**
 * The single source of truth for "is this user allowed to use the Stitch UI".
 * Mirrors AdminRoute's staff check but is STRICTER: mods are staff for the Ops
 * console, but the design switch is admin-only (design.md §5: "Do not allow
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
 *   non-admin / signed-out      → ALWAYS legacy (rule 1)
 *   ?ui=<valid> override        → wins (rule 3 — emergency hatch + deep-link preview)
 *   saved preference (validated)→ used
 *   anything else / invalid     → legacy (rule 2)
 *
 * @param {object}  args
 * @param {object?} args.user           current user (or null)
 * @param {string?} args.savedMode      persisted preference (localStorage or server)
 * @param {string?} args.queryOverride  already-parsed ?ui= value (or null)
 */
export function resolveDesignMode({ user, savedMode, queryOverride, allowAll, defaultMode } = {}) {
  // prompt61 — availability + default are governed by the Ops `designSettings`
  // SiteSetting (allowAllUsers + defaultMode), not hardcoded. When `allowAll` is on,
  // ANY visitor may use Stitch; otherwise it stays admin-only (the original rule).
  // `defaultMode` (default 'legacy') is used when there is no saved preference.
  const dflt = isValidMode(defaultMode) ? defaultMode : DEFAULT_MODE;
  const canStitch = !!allowAll || isDesignAdmin(user);
  if (!canStitch) return DEFAULT_MODE;
  if (isValidMode(queryOverride)) return queryOverride;
  return normalizeMode(savedMode || dflt);
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

/* ─── DOM application (sets the CSS-isolation root attribute) ──────────────── */

/**
 * Set <html data-ui-design="..."> so the scoped Stitch stylesheet activates.
 * Always normalizes — a bad value paints legacy, never an undefined attr.
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
