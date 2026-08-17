/**
 * features/manuscript/richEditor/SymbolPicker.jsx — 121.md §1, the Symbols control on
 * the Manuscript Editor ribbon.
 *
 * WHICH RIBBON. The formatting bar (RichToolbar), not the workspace's ManuscriptToolbar:
 * this is a control that ACTS ON THE CARET, and the formatting bar is the only surface
 * with the selection-preserving discipline such a control needs (onMouseDown
 * preventDefault everywhere, and the 120.md §5 session bookmark). ManuscriptToolbar's
 * Level B is a navigation tablist that 118.md §6 forbids from reading as command
 * buttons. Every other Insert control (table, picture, cross-reference, citation)
 * already lives here, and putting Symbols beside them is what makes the group legible.
 *
 * WHAT IT COMPOSES. Two proven idioms, deliberately not a third invention:
 *   · CrossRefPicker/CiteRefPicker's popover shell — a preventDefault'd trigger, a
 *     preventDefault'd backdrop, aria-haspopup="dialog", and the session props that
 *     bookmark the caret BEFORE the popover renders (§1's "Save the active editor
 *     selection when the menu opens"), so the autoFocus'd search field cannot cost the
 *     researcher their insertion point.
 *   · TableGridPicker's keyboard grid — roving tabindex (exactly one cell is tabbable),
 *     arrow navigation, Enter/Space to insert, Escape through markOverlayEscape (117.md
 *     §44: an overlay that consumes an Escape owns the fullscreen exit the browser
 *     queues alongside it), no modified chord ever claimed (108.md §23), and an
 *     aria-live readout of the active cell so a screen-reader user hears what they are
 *     about to insert.
 *
 * V1 CLOSES ON INSERT, like both existing pickers. `restoreCaretBookmark` CONSUMES the
 * bookmark, so a stay-open multi-insert picker would have to re-arm the session after
 * every symbol or the second one would fall into the no-session path and could land in
 * whichever section is scrolled into view. That is a feature with its own contract, not
 * a free extra.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { C, btnS, inp } from '../../../frontend/workspace/ui/styles.js';
import { alpha } from '../../../frontend/theme/tokens.js';
import { markOverlayEscape } from '../../../frontend/focus/overlayEscapeLatch.js';
import { useOptionalAuth } from '../../../frontend/context/AuthContext.jsx';
import {
  SYMBOL_CATEGORIES, SYMBOL_FONT_STACK, searchSymbols, symbolByCp,
  symbolPrefsKey, normalizeSymbolPrefs, clampSymbolPrefs, pushRecent, toggleFavorite,
  EMPTY_SYMBOL_PREFS,
} from './symbolCatalog.js';

export const SYMBOL_PICKER_LABEL = 'Ω Symbols';
export const SYMBOL_PICKER_TITLE = 'Insert a symbol at the cursor';
export const SYMBOL_NO_MATCH_TEXT = 'No symbol matches that search.';
export const SYMBOL_HINT_TEXT = 'Arrow keys move · Enter inserts · F stars a favourite · Esc closes';

/** Cells per row. The grid is wider than the 288/320px list pickers, so the popover is
    clamped to the viewport below rather than trusting `left:0` to fit. */
export const SYMBOL_GRID_COLS = 10;
const CELL = 30;
const POPOVER_W = SYMBOL_GRID_COLS * (CELL + 3) + 24;

const ARROWS = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: SYMBOL_GRID_COLS, ArrowUp: -SYMBOL_GRID_COLS };

/* ── persistence (reading state — never the project blob) ───────────────────── */

function readPrefs(key) {
  if (!key || typeof localStorage === 'undefined') return EMPTY_SYMBOL_PREFS;
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalizeSymbolPrefs(JSON.parse(raw)) : EMPTY_SYMBOL_PREFS;
  } catch { return EMPTY_SYMBOL_PREFS; }
}

function writePrefs(key, prefs) {
  if (!key || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(clampSymbolPrefs(prefs))); } catch { /* full / denied */ }
}

/* ── the grid ───────────────────────────────────────────────────────────────── */

function SymbolCell({ sym, active, favorite, onInsert, onToggleFavorite, onActivate, testIdPrefix }) {
  const label = `${sym.name} ${sym.ch}`;
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" tabIndex={active ? 0 : -1}
        aria-label={label}
        title={`${sym.name}${sym.latex ? ` · ${sym.latex}` : ''} · ${sym.cp}`}
        data-testid={`${testIdPrefix}-cell-${sym.cp.replace(/[^A-Za-z0-9]/g, '')}`}
        data-symbol-active={active ? 'true' : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onFocus={() => onActivate && onActivate()}
        onMouseEnter={() => onActivate && onActivate()}
        onClick={() => onInsert && onInsert(sym)}
        style={{
          width: CELL, height: CELL, padding: 0, cursor: 'pointer', borderRadius: 5,
          fontFamily: SYMBOL_FONT_STACK, fontSize: 16, lineHeight: 1,
          border: `1px solid ${active ? C.acc : C.brd2}`,
          background: active ? alpha(C.acc, '14') : 'transparent', color: C.txt,
        }}>
        {sym.ch}
      </button>
      {/* The star is MOUSE affordance only (tabIndex -1): a second tab stop per cell
          would defeat the roving-tabindex grid. The keyboard equivalent is `F` on the
          active cell, which the hint line and the aria-live readout both name. */}
      <button type="button" tabIndex={-1}
        aria-label={favorite ? `Remove ${sym.name} from favourites` : `Add ${sym.name} to favourites`}
        data-testid={`${testIdPrefix}-star-${sym.cp.replace(/[^A-Za-z0-9]/g, '')}`}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite && onToggleFavorite(sym); }}
        style={{
          position: 'absolute', top: -4, right: -4, width: 13, height: 13, padding: 0,
          borderRadius: 99, border: 'none', cursor: 'pointer', lineHeight: 1, fontSize: 9,
          background: favorite ? C.acc : 'transparent',
          color: favorite ? '#fff' : C.muted,
          opacity: favorite || active ? 1 : 0,
        }}>★</button>
    </span>
  );
}

/**
 * The picker. `onInsert(ch)` receives the CHARACTER; everything about where it lands is
 * the workspace's insertion session and the editor's shared insertion utility.
 */
export function SymbolPicker({
  onInsert, disabled = false, block = false,
  testIdPrefix = 'stitch-manuscript-symbols',
  // 120.md §5 — the picker SESSION, wired exactly like the cite/cross-reference
  // pickers: start BEFORE the popover exists, end on every close that did not insert.
  onSessionStart = null, onSessionEnd = null,
  userId: userIdProp = null,
}) {
  const auth = useOptionalAuth();
  const userId = userIdProp || (auth && auth.user && auth.user.id) || null;
  const prefKey = symbolPrefsKey(userId);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [prefs, setPrefs] = useState(EMPTY_SYMBOL_PREFS);
  const btnRef = useRef(null);
  const gridRef = useRef(null);
  const popRef = useRef(null);
  const [shift, setShift] = useState(0);

  // The signed-in user arrives asynchronously, so hydrate when the key does.
  useEffect(() => { setPrefs(readPrefs(prefKey)); }, [prefKey]);

  /* §1 "Recently Used and Favorites", pinned above the categories: they are the two
     lists a researcher returns to, and a catalogue of several hundred entries is not
     worth scrolling for the symbol used three sentences ago. */
  const sections = useMemo(() => {
    const needle = q.trim();
    if (needle) return [{ id: 'results', label: 'Results', symbols: searchSymbols(needle) }];
    const favorites = prefs.favorites.map(symbolByCp).filter(Boolean);
    const recents = prefs.recents.map(symbolByCp).filter(Boolean);
    return [
      ...(favorites.length ? [{ id: 'favorites', label: 'Favourites', symbols: favorites }] : []),
      ...(recents.length ? [{ id: 'recents', label: 'Recently used', symbols: recents }] : []),
      ...SYMBOL_CATEGORIES,
    ];
  }, [q, prefs]);

  /* ONE flat list underlies the roving tabindex, so arrows cross section boundaries
     the way a reader expects instead of trapping focus in a category. */
  const flat = useMemo(() => sections.flatMap((sec) => sec.symbols.map((sym) => ({ sym, sec: sec.id }))), [sections]);
  const activeSym = flat[Math.min(active, Math.max(0, flat.length - 1))] || null;

  const cellId = (sym, secId) => `${secId}-${sym.cp.replace(/[^A-Za-z0-9]/g, '')}`;

  const focusCell = (i) => {
    const item = flat[i];
    if (!item || !gridRef.current) return;
    const el = gridRef.current.querySelector(`[data-symbol-cell="${cellId(item.sym, item.sec)}"] button`);
    if (el && el.focus) el.focus();
  };

  const close = (restoreFocus, cancelled) => {
    setOpen(false);
    setQ('');
    setActive(0);
    if (cancelled && onSessionEnd) onSessionEnd();
    if (restoreFocus && btnRef.current && btnRef.current.focus) btnRef.current.focus();
  };

  const toggleOpen = () => {
    if (open) { close(true, true); return; }
    // The bookmark is taken BEFORE the popover (and its autoFocus'd input) exists.
    if (onSessionStart) onSessionStart();
    setOpen(true);
  };

  const insert = (sym) => {
    if (!sym) return;
    setPrefs((cur) => { const next = pushRecent(cur, sym.cp); writePrefs(prefKey, next); return next; });
    close(false, false);
    if (onInsert) onInsert(sym.ch);
  };

  const star = (sym) => {
    if (!sym) return;
    setPrefs((cur) => { const next = toggleFavorite(cur, sym.cp); writePrefs(prefKey, next); return next; });
  };

  /* §1 "Make the picker accessible with appropriate focus handling": the popover is
     wider than the toolbar button's column, so it is CLAMPED to the viewport instead of
     spilling off the right edge on a narrow or split layout (the anchorUnder
     precedent). Measured after paint; SSR renders the unshifted popover. */
  useEffect(() => {
    if (!open || typeof window === 'undefined' || !popRef.current) { setShift(0); return; }
    const r = popRef.current.getBoundingClientRect();
    const over = r.right - (window.innerWidth - 8);
    setShift(over > 0 ? -Math.min(over, Math.max(0, r.left - 8)) : 0);
  }, [open]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      // 117.md §44 — mark BEFORE consuming, or dismissing this popover in Focus Mode
      // drops the whole fullscreen layout with it.
      markOverlayEscape();
      e.preventDefault();
      close(true, true);
      return;
    }
    // A MODIFIED chord is never claimed (108.md §23 — it belongs to the shortcut router).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const fromSearch = e.target && e.target.getAttribute
      && e.target.getAttribute('data-testid') === `${testIdPrefix}-search`;
    const d = ARROWS[e.key];
    if (d != null) {
      // In the search field only ArrowDown leaves the input — Left/Right still edit it.
      if (fromSearch && e.key !== 'ArrowDown') return;
      e.preventDefault();
      // ArrowDown out of the search field lands on the FIRST result rather than
      // scrolling a row past it.
      const next = fromSearch ? 0 : Math.max(0, Math.min(flat.length - 1, active + d));
      setActive(next);
      focusCell(next);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (fromSearch) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : flat.length - 1;
      setActive(next);
      focusCell(next);
      return;
    }
    if (!fromSearch && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      insert(activeSym && activeSym.sym);
      return;
    }
    if (!fromSearch && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      star(activeSym && activeSym.sym);
    }
  };

  let index = -1;
  return (
    <span style={{ position: 'relative', display: block ? 'block' : 'inline-flex' }}>
      <button type="button" ref={btnRef} aria-label="Insert symbol" title={SYMBOL_PICKER_TITLE}
        disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        data-testid={`${testIdPrefix}-open`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleOpen}
        style={{
          ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
          background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
          ...(block ? { width: '100%', justifyContent: 'center' } : {}),
        }}>
        {SYMBOL_PICKER_LABEL}
      </button>
      {open && !disabled && (
        <>
          <div onMouseDown={(e) => { e.preventDefault(); close(false, true); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
          <div role="dialog" aria-label="Insert symbol" ref={popRef}
            data-testid={`${testIdPrefix}-popover`}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={onKeyDown}
            style={{
              position: 'absolute', top: '100%', left: shift, marginTop: 4, zIndex: 41,
              width: POPOVER_W, maxWidth: '92vw',
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              padding: 10, boxShadow: '0 10px 26px rgba(15,23,42,0.18)',
            }}>
            <input
              value={q}
              autoFocus
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              placeholder="Search name, alias, LaTeX, U+00B0…"
              aria-label="Search symbols"
              data-testid={`${testIdPrefix}-search`}
              style={{ ...inp, fontSize: 11.5, marginBottom: 6 }} />
            <div ref={gridRef} style={{ maxHeight: 292, overflowY: 'auto' }}>
              {sections.map((sec) => (
                <div key={sec.id} style={{ marginBottom: 8 }}>
                  <div style={{
                    fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase',
                    color: C.muted, margin: '2px 0 4px',
                  }}>{sec.label}</div>
                  <div role="group" aria-label={sec.label}
                    data-testid={`${testIdPrefix}-group-${sec.id}`}
                    style={{ display: 'grid', gridTemplateColumns: `repeat(${SYMBOL_GRID_COLS}, ${CELL}px)`, gap: 3 }}>
                    {sec.symbols.map((sym) => {
                      index += 1;
                      const i = index;
                      return (
                        <span key={`${sec.id}-${sym.cp}`} data-symbol-cell={cellId(sym, sec.id)}>
                          <SymbolCell
                            sym={sym}
                            active={i === Math.min(active, Math.max(0, flat.length - 1))}
                            favorite={prefs.favorites.includes(sym.cp)}
                            onInsert={insert}
                            onToggleFavorite={star}
                            onActivate={() => setActive(i)}
                            testIdPrefix={testIdPrefix} />
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!flat.length && (
                <div data-testid={`${testIdPrefix}-empty`} style={{ fontSize: 11, color: C.muted, padding: '6px 4px' }}>
                  {SYMBOL_NO_MATCH_TEXT}
                </div>
              )}
            </div>
            {/* §1 "screen-reader descriptions": what the active cell IS, announced as it
                moves, and what the keys do. */}
            <div aria-live="polite" data-testid={`${testIdPrefix}-active`}
              style={{ marginTop: 6, fontSize: 10.5, color: C.txt2, textAlign: 'center' }}>
              {activeSym ? `${activeSym.sym.ch} — ${activeSym.sym.name}` : SYMBOL_NO_MATCH_TEXT}
            </div>
            <div style={{ marginTop: 2, fontSize: 9.5, color: C.muted, textAlign: 'center' }}>
              {SYMBOL_HINT_TEXT}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

export default SymbolPicker;
