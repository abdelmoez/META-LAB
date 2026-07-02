/**
 * DesignModeContext.jsx — runtime wiring for the design-mode system.
 *
 * Resolves the effective UI design (`stitch` | `legacy`) from the authenticated
 * user, a `?ui=` override, the persisted preference, and the Ops `designSettings`
 * record, then publishes it to the tree AND to <html data-ui-design> (so the
 * scoped Stitch stylesheet activates).
 *
 * GOVERNANCE (65.md): the theme is Ops-governed for users. Every code path
 * funnels through resolveDesignMode(): a non-admin ALWAYS renders
 * designSettings.defaultMode (shipped: stitch) — their ?ui= links and saved
 * preferences are ignored unless Ops enables `allowLegacyFallback`. Only ADMINS
 * keep a personal preference (setMode/toggle no-op for everyone else), persisted
 * to localStorage + `PUT /api/profile` (the server 403s non-admin writes).
 *
 * NO-FLASH RULE: the pre-fetch seed is the SHIPPED default (stitch) or the
 * localStorage-cached designSettings from the previous visit — never legacy — and
 * the saved preference is never cleared before /api/settings/public has resolved,
 * so a normal user never sees a legacy first paint.
 */
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  resolveDesignMode, readQueryOverride, getSavedDesignMode, saveDesignMode,
  clearSavedDesignMode, applyDesignAttr, isDesignAdmin, isValidMode, DEFAULT_MODE,
  getCachedDesignSettings, cacheDesignSettings,
} from './designMode.js';

// Shipped defaults — MUST mirror DEFAULTS.designSettings in
// server/controllers/settingsController.js so the pre-fetch seed and the server
// agree (Stitch for everyone, legacy fallback off).
const SHIPPED_DESIGN_SETTINGS = { allowAllUsers: true, defaultMode: DEFAULT_MODE, allowLegacyFallback: false };

const DesignModeContext = createContext({
  mode: DEFAULT_MODE,
  isStitch: true,
  isAdmin: false,
  ready: false,
  setMode: () => {},
  toggle: () => {},
});

/** Best-effort server persistence — never throws, never blocks the UI. */
function persistToServer(mode) {
  try {
    fetch('/api/profile', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uiDesignMode: mode }),
    }).catch(() => {});
  } catch {
    /* non-fatal */
  }
}

export function DesignModeProvider({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  const admin = isDesignAdmin(user);
  const override = readQueryOverride(location.search);

  // Ops-governed record from /api/settings/public. Seeded from the previous
  // visit's cache (or the shipped Stitch default) so the pre-fetch resolution
  // already matches what the server will say — no legacy flash while it loads.
  const [design, setDesign] = useState(() => getCachedDesignSettings() || SHIPPED_DESIGN_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  useEffect(() => {
    let dead = false;
    fetch('/api/settings/public', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ds = (d && d.designSettings) || {};
        const next = {
          allowAllUsers: !!ds.allowAllUsers,
          defaultMode: isValidMode(ds.defaultMode) ? ds.defaultMode : DEFAULT_MODE,
          allowLegacyFallback: ds.allowLegacyFallback === true,
        };
        cacheDesignSettings(next); // next pre-paint bootstrap reads this
        if (!dead) { setDesign(next); setSettingsReady(true); }
      })
      .catch(() => { /* keep the seed; never mark ready on failure */ });
    return () => { dead = true; };
  }, []);

  // Seed from the pre-paint value already on <html> (bootstrap) so the first
  // React render matches what the user is looking at — no flash.
  const [mode, setModeState] = useState(() => {
    if (typeof document !== 'undefined') {
      const seed = document.documentElement.dataset.uiDesign;
      if (isValidMode(seed)) return seed;
    }
    return getSavedDesignMode() || DEFAULT_MODE;
  });

  // Tracks the last override we auto-persisted so an admin deep link (?ui=legacy)
  // sticks exactly once instead of re-writing on every render.
  const persistedOverrideRef = useRef(null);

  // ── Resolve + apply whenever the inputs change ─────────────────────────────
  useEffect(() => {
    // Until auth settles, don't fight the bootstrap value: the pre-paint chain
    // (?ui= → saved → cached defaultMode → stitch) already painted the best
    // guess. Once loading clears we resolve authoritatively.
    if (loading) return;

    const savedMode = getSavedDesignMode() ?? (user ? user.uiDesignMode : null);
    const resolved = resolveDesignMode({ user, savedMode, queryOverride: override, settings: design });

    // Hygiene: a non-admin's saved mode is inert while fallback is off, but a
    // stale `legacy` would still mis-paint the pre-auth bootstrap frame on the
    // NEXT visit — drop it. ONLY after the authoritative settings fetch has
    // resolved (never on the seed, which could wrongly discard a valid pref).
    if (settingsReady && !admin && !design.allowLegacyFallback && getSavedDesignMode()) {
      clearSavedDesignMode();
    }

    applyDesignAttr(resolved);
    setModeState(resolved);

    // A valid ?ui= override becomes the persisted preference for ADMINS ONLY (so
    // it survives dropping the param / refresh). Non-admin overrides are never
    // persisted — the server would 403 the write anyway.
    if (admin && isValidMode(override) && persistedOverrideRef.current !== override) {
      persistedOverrideRef.current = override;
      if (getSavedDesignMode() !== override) {
        saveDesignMode(override);
        persistToServer(override);
      }
    }
    if (!isValidMode(override)) persistedOverrideRef.current = null;
  }, [loading, user, admin, override, design, settingsReady]);

  // ── Imperative switch (Ops-governed: personal preference is ADMIN-ONLY) ────
  const setMode = useCallback((next) => {
    if (!admin) return; // non-admin setMode is a no-op; server also enforces
    if (!isValidMode(next)) next = DEFAULT_MODE;
    applyDesignAttr(next);
    setModeState(next);
    saveDesignMode(next);
    persistToServer(next);
  }, [admin]);

  const toggle = useCallback(() => {
    setMode(mode === 'stitch' ? 'legacy' : 'stitch');
  }, [mode, setMode]);

  return (
    <DesignModeContext.Provider value={{
      mode,
      isStitch: mode === 'stitch',
      isAdmin: admin,
      ready: !loading,
      setMode,
      toggle,
    }}>
      {children}
    </DesignModeContext.Provider>
  );
}

export function useDesignMode() {
  return useContext(DesignModeContext);
}
