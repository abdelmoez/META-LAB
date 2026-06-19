/**
 * ThemeContext.jsx — night/day theme state + the global brand color (prompt37).
 *
 * TWO orthogonal axes:
 *   1. Mode (night | day) — light/dark, a per-user choice on <html data-theme>.
 *   2. Brand color — a site-wide accent set by an admin in Ops › Appearance.
 *
 * The brand color re-skins the whole app by overriding four CSS tokens
 * (--t-acc / --t-acc2 / --t-acc-text / --t-acc-bg) that every surface already
 * consumes. We apply them as INLINE custom properties on <html> keyed to the
 * active mode, because:
 *   - inline props win over stylesheets with no specificity/order games,
 *   - they can be repainted pre-React by the index.html bootstrap (no flash),
 *   - and they're theme-specific (we re-apply the matching side on mode flip).
 *
 * Persistence: mode → localStorage + best-effort PUT /api/profile. Brand →
 * cached in localStorage (for instant + pre-paint apply) and loaded from
 * /api/settings/public (so it follows the server, logged-out landing included).
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { applyTheme, getSavedTheme, buildThemeCss } from './tokens.js';
import {
  generateThemeFromHex, paletteToCssVars, BRAND_TOKEN_VARS, DEFAULT_BRAND,
} from './themeEngine.js';

const BRAND_CACHE_KEY = 'metalab_brand';
const DEFAULT_BRAND_RECORD = { brandColor: DEFAULT_BRAND, preset: 'default', palette: null };

const ThemeContext = createContext({
  theme: 'day', setTheme: () => {}, toggleTheme: () => {},
  brand: DEFAULT_BRAND_RECORD, previewBrand: () => {}, clearBrandPreview: () => {},
  commitBrand: () => {}, resetBrand: () => {},
});

/* ─── Brand application (pure DOM, mirrors index.html bootstrap) ─────────── */

/** Resolve a record to a concrete palette: explicit palette, else generated
 *  from a non-default brandColor, else null (use the stylesheet base = default). */
function resolvePalette(record) {
  if (!record) return null;
  if (record.palette) return record.palette;
  if (record.brandColor && record.brandColor !== DEFAULT_BRAND) {
    try { return generateThemeFromHex(record.brandColor); } catch { return null; }
  }
  return null;
}

/** Set/clear the four inline brand vars on <html> for the active mode. */
function applyBrandVars(palette, theme) {
  const root = document.documentElement;
  const vars = paletteToCssVars(palette, theme); // {} when palette is null
  for (const cssVar of Object.values(BRAND_TOKEN_VARS)) {
    if (vars[cssVar]) root.style.setProperty(cssVar, vars[cssVar]);
    else root.style.removeProperty(cssVar);
  }
}

function readCachedBrand() {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && typeof rec === 'object' && rec.brandColor ? rec : null;
  } catch { return null; }
}

function cacheBrand(record) {
  try {
    // Always cache a CONCRETE palette so the pre-paint bootstrap has colors.
    const palette = resolvePalette(record);
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify({
      brandColor: record.brandColor, preset: record.preset, palette,
    }));
  } catch { /* private mode */ }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => getSavedTheme() || document.documentElement.dataset.theme || 'day');
  // Saved brand (server/localStorage) and a transient preview (Ops live preview).
  const [brand, setBrand] = useState(() => readCachedBrand() || DEFAULT_BRAND_RECORD);
  const [preview, setPreview] = useState(null); // palette | null
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Keep <html data-theme> consistent on mount (index.html bootstraps pre-paint).
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply the EFFECTIVE brand (preview wins) whenever brand/preview/mode change.
  useEffect(() => {
    const palette = preview || resolvePalette(brand);
    applyBrandVars(palette, theme);
    // Notify imperative consumers that read --t-acc via getComputedStyle (e.g.
    // the landing HeroCanvas) so they repaint on a live brand change too.
    window.dispatchEvent(new CustomEvent('metalab:brand-change'));
  }, [brand, preview, theme]);

  // Follow out-of-band mode changes (adoptServerTheme after login).
  useEffect(() => {
    const onChange = (e) => setThemeState(e.detail);
    window.addEventListener('metalab:theme-change', onChange);
    return () => window.removeEventListener('metalab:theme-change', onChange);
  }, []);

  // Site-wide defaults from public settings (mode + brand). Non-blocking; the
  // cached brand already rendered, this only swaps when the server differs.
  useEffect(() => {
    let alive = true;
    fetch('/api/settings/public', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        // ── Mode (first-visit default; explicit local choice always wins) ──
        const dt = data.appSettings?.defaultTheme;
        if ((dt === 'night' || dt === 'day') && !getSavedTheme()) {
          document.documentElement.dataset.theme = dt;
          setThemeState(dt);
          window.dispatchEvent(new CustomEvent('metalab:theme-change', { detail: dt }));
        }
        // ── Brand (applies to everyone, logged out included) ──
        const ts = data.themeSettings;
        if (ts && ts.brandColor) {
          const rec = { brandColor: ts.brandColor, preset: ts.preset || 'custom', palette: ts.palette || null };
          setBrand(rec);
          cacheBrand(rec);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  function setTheme(next) {
    const t = applyTheme(next); // sets attribute + localStorage + fires event
    setThemeState(t);
    fetch('/api/profile', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themePreference: t }),
    }).catch(() => {});
  }

  const toggleTheme = () => setTheme(theme === 'night' ? 'day' : 'night');

  // ── Brand controls (consumed by the Ops Appearance tab) ──
  const previewBrand = (palette) => setPreview(palette || null);
  const clearBrandPreview = () => setPreview(null);
  const commitBrand = (record) => {
    const rec = record && record.brandColor ? record : DEFAULT_BRAND_RECORD;
    setPreview(null);
    setBrand(rec);
    cacheBrand(rec);
  };
  const resetBrand = () => commitBrand(DEFAULT_BRAND_RECORD);

  return (
    <ThemeContext.Provider value={{
      theme, setTheme, toggleTheme,
      brand, previewBrand, clearBrandPreview, commitBrand, resetBrand,
    }}>
      <style>{buildThemeCss()}</style>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
