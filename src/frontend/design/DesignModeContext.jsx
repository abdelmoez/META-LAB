/**
 * DesignModeContext.jsx — runtime wiring for the parallel design-mode system.
 *
 * Resolves the effective UI design (`legacy` | `stitch`) from the authenticated
 * user, a `?ui=` override, and the persisted preference, then publishes it to the
 * tree AND to <html data-ui-design> (so the scoped Stitch stylesheet activates).
 *
 * Persistence mirrors the theme system exactly (ThemeContext): the explicit
 * local choice (localStorage) wins for instant, no-flash rendering, and the
 * server value (user.uiDesignMode, returned by getMe) is the cross-device source.
 * Writes go to BOTH localStorage and `PUT /api/profile` (best-effort).
 *
 * SECURITY: every code path funnels through resolveDesignMode(), which forces
 * `legacy` for anyone who is not an admin — so a non-admin can never land on the
 * Stitch UI even by crafting localStorage or a `?ui=stitch` deep link. The server
 * additionally refuses to persist `stitch` for a non-admin.
 */
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  resolveDesignMode, readQueryOverride, getSavedDesignMode, saveDesignMode,
  clearSavedDesignMode, applyDesignAttr, isDesignAdmin, isValidMode, DEFAULT_MODE,
} from './designMode.js';

const DesignModeContext = createContext({
  mode: DEFAULT_MODE,
  isStitch: false,
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

  // prompt61 — Ops-governed rollout: { allowAllUsers, defaultMode } from
  // /api/settings/public. Until it loads we keep the legacy/admin-only behaviour.
  const [design, setDesign] = useState({ allowAllUsers: false, defaultMode: DEFAULT_MODE });
  useEffect(() => {
    let dead = false;
    fetch('/api/settings/public', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ds = (d && d.designSettings) || {};
        if (!dead) setDesign({
          allowAllUsers: !!ds.allowAllUsers,
          defaultMode: isValidMode(ds.defaultMode) ? ds.defaultMode : DEFAULT_MODE,
        });
      })
      .catch(() => { /* keep defaults */ });
    return () => { dead = true; };
  }, []);
  const allowAll = design.allowAllUsers;
  const canStitch = allowAll || admin; // who may render Stitch

  // Seed from the pre-paint value already on <html> (bootstrap) so the first
  // React render matches what the user is looking at — no flash.
  const [mode, setModeState] = useState(() => {
    if (typeof document !== 'undefined') {
      const seed = document.documentElement.dataset.uiDesign;
      if (isValidMode(seed)) return seed;
    }
    return getSavedDesignMode() || DEFAULT_MODE;
  });

  // Tracks the last override we auto-persisted so a deep link (?ui=stitch) sticks
  // exactly once instead of re-writing on every render.
  const persistedOverrideRef = useRef(null);

  // ── Resolve + apply whenever the inputs change ─────────────────────────────
  useEffect(() => {
    // Until auth settles, don't fight the bootstrap value: a signed-out first
    // paint is already legacy, and a returning admin's cached localStorage is
    // honored by the seed above. Once loading clears we resolve authoritatively.
    if (loading) return;

    const savedMode = getSavedDesignMode() ?? (user ? user.uiDesignMode : null);
    const resolved = resolveDesignMode({ user, savedMode, queryOverride: override, allowAll, defaultMode: design.defaultMode });

    // Fail-safe hygiene: when Stitch is NOT available to this viewer, never carry a
    // stitch preference around (mirrors the original admin-only guard).
    if (!canStitch && getSavedDesignMode()) clearSavedDesignMode();

    applyDesignAttr(resolved);
    setModeState(resolved);

    // A valid ?ui= override from an admin becomes the persisted preference (so it
    // survives dropping the param / refresh). Emergency `?ui=legacy` therefore
    // also "sticks" the user safely back on legacy.
    if (canStitch && isValidMode(override) && persistedOverrideRef.current !== override) {
      persistedOverrideRef.current = override;
      if (getSavedDesignMode() !== override) {
        saveDesignMode(override);
        persistToServer(override);
      }
    }
    if (!isValidMode(override)) persistedOverrideRef.current = null;
  }, [loading, user, admin, override, allowAll, canStitch, design.defaultMode]);

  // ── Imperative switch (used by AdminDesignSwitch + error-boundary escape) ───
  const setMode = useCallback((next) => {
    if (!canStitch) return; // server also enforces; this is the client guard
    if (!isValidMode(next)) next = DEFAULT_MODE;
    applyDesignAttr(next);
    setModeState(next);
    saveDesignMode(next);
    persistToServer(next);
  }, [canStitch]);

  const toggle = useCallback(() => {
    setMode(mode === 'stitch' ? 'legacy' : 'stitch');
  }, [mode, setMode]);

  // Viewers without Stitch access always report legacy regardless of any seeded state.
  const effectiveMode = canStitch ? mode : DEFAULT_MODE;

  return (
    <DesignModeContext.Provider value={{
      mode: effectiveMode,
      isStitch: effectiveMode === 'stitch',
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
