/**
 * KeywordContextMenu.jsx — 108.md §§18-21. Right-click a keyword the user controls and
 * get a small PecanRev-styled menu offering to delete it.
 *
 * LIFTED FROM `pages/admin/users/RowMenu.jsx`, which is the repo's only real
 * role="menu"/role="menuitem" widget: roving `tabIndex={-1}` items driven by
 * ArrowUp/Down/Home/End, Escape closes and refocuses the trigger, an outside
 * `mousedown` closes, and scroll/resize DISMISS rather than reposition. Two things are
 * different here and both are deliberate:
 *
 *   · POSITIONED AT THE POINTER, not under a trigger button, through the shared pure
 *     `interaction/menuPosition.placeMenu`. RowMenu clamps horizontally only, so a menu
 *     opened near the bottom of the viewport overflows; §21 requires it to stay inside
 *     on BOTH axes. The maths is pure and unit-tested; this file only measures.
 *   · IT STAMPS `SCREENING_MODAL_ATTR` while open, so `isScreeningModalOpen()` reports
 *     true and the abstract chords (Ctrl/Cmd+I / +E) stand down. That is intentional:
 *     an open menu owns the keyboard (108.md §24 tier 1), and the alternative — a
 *     keyword being added to a list while a delete menu floats over it — is worse.
 *
 * NO FOCUS TRAP. Both traps in the repo (`overlay.jsx useFocusTrap`,
 * `screening/ui/components.jsx Modal`) lock body scroll, which is wrong for a
 * transient menu. RowMenu's roving focus is the correct precedent and is what §25's
 * "accessible menu roles / visible focus states" asks for.
 *
 * NO `window.confirm`. For keywords specifically the established pattern is the inline
 * two-step (`confirmReset` in the keyword editor, `SearchImportProgressModal`'s
 * documented refusal to freeze the tab). Per §18 "keep it simple" the MENU IS the
 * confirmation — one danger item — and undo (§20) is the safety net.
 *
 * NOT A PORTAL. `position: fixed` + `zIndex` is enough (no transformed ancestor on this
 * page), it matches RowMenu, and it keeps the component renderable under
 * `renderToStaticMarkup`, which the repo's UI tests require.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { SCREENING_MODAL_ATTR } from '../ui/components.jsx';
import { KEYWORD_ORIGIN } from '../../../research-engine/screening/keywordModel.js';
import { placeMenu } from '../../../research-engine/interaction/menuPosition.js';

/** Menu geometry — the measured height replaces this estimate on the first layout. */
const MENU_WIDTH = 232;
const MENU_HEIGHT_ESTIMATE = 56;

/**
 * There is no layout to measure on the server, and useLayoutEffect warns loudly about
 * exactly that. The repo renders every UI component through renderToStaticMarkup in its
 * tests, so the effect degrades to useEffect off the browser rather than shouting.
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * 108.md §19 — WHICH KEYWORDS GET THE RIGHT-CLICK DELETE, and why.
 *
 *   'manual'   the reviewer typed it (chip adder or Ctrl/Cmd+I over an abstract).
 *              Unambiguously theirs — §18's target case.
 *   'accepted' a criteria suggestion a leader accepted. §19 asks explicitly whether
 *              these "become normal user-controlled filters after acceptance": they do.
 *              Accepting is an editorial act, the term then behaves exactly like a
 *              manual one (it highlights, filters and counts), and it is already
 *              deletable through the chip ×. Excluding it here would mean the fast path
 *              disagreed with the slow path for no reason.
 *   'default'  one of the ~80 shared seed terms. EXCLUDED. Deleting one is not a local
 *              edit: it materializes the whole shared list into the project and flips
 *              `keywordMeta.seeded`, changing what "empty" means for that side forever.
 *              That is a structural change and it keeps its deliberate, visible route
 *              (the chip ×) — §19 "do not accidentally allow deletion of something the
 *              system considers structurally required".
 *
 * A user who may not edit keyword lists gets NO menu at all, and — critically — the
 * caller must not `preventDefault()` in that case, so the browser's own context menu
 * (copy, search, inspect) still works. That is the §18/§21 equivalent of §1's rule that
 * PecanRev only suppresses a default it is actually replacing.
 */
export const DELETABLE_ORIGINS = Object.freeze([KEYWORD_ORIGIN.MANUAL, KEYWORD_ORIGIN.ACCEPTED]);

/**
 * canOpenKeywordMenu({ origin, canEdit }) → boolean
 * Pure; the single gate both chip surfaces and the menu itself read.
 */
export function canOpenKeywordMenu({ origin, canEdit } = {}) {
  if (!canEdit) return false;
  return DELETABLE_ORIGINS.indexOf(origin) >= 0;
}

/**
 * @param {object} props
 * @param {string} props.term                 the keyword under the pointer
 * @param {'include'|'exclude'} props.list
 * @param {string} props.origin
 * @param {number} props.x,props.y            pointer (or chip-anchor) viewport coords
 * @param {() => void} props.onDelete
 * @param {(refocus?:boolean) => void} props.onClose
 * @param {boolean} [props.busy]              a delete is in flight
 */
export default function KeywordContextMenu({
  term, list, origin, x, y, onDelete, onClose, busy,
}) {
  const menuRef = useRef(null);
  // First paint uses the ESTIMATED height so the menu never flashes at the wrong
  // corner; the layout effect below re-places it from the measured box. Off the
  // browser there is no viewport to clamp against, so the raw anchor stands.
  const [pos, setPos] = useState(() => (typeof window === 'undefined'
    ? { left: Number(x) || 0, top: Number(y) || 0, flippedX: false, flippedY: false }
    : placeMenu({
      x, y, menuWidth: MENU_WIDTH, menuHeight: MENU_HEIGHT_ESTIMATE,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
    })));

  // Measure-then-place, the Tooltip.jsx idiom: the estimate above avoids a flash, the
  // real height decides whether the menu flips above the pointer.
  useIsoLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || typeof window === 'undefined' || !el.getBoundingClientRect) return;
    try {
      const r = el.getBoundingClientRect();
      const next = placeMenu({
        x, y,
        menuWidth: r.width || MENU_WIDTH,
        menuHeight: r.height || MENU_HEIGHT_ESTIMATE,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      setPos(p => (p.left === next.left && p.top === next.top ? p : next));
    } catch { /* measurement is best-effort */ }
  }, [x, y]);

  // §21 — click elsewhere closes; scrolling or resizing dismisses (repositioning a
  // pointer-anchored menu against a moving page is worse than closing it).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onDown = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) onClose?.(); };
    const onGone = () => onClose?.();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onGone);
    window.addEventListener('scroll', onGone, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onGone);
      window.removeEventListener('scroll', onGone, true);
    };
  }, [onClose]);

  // Focus lands on the first item, so Escape (below) and the arrow keys work whether
  // the menu was opened by right-click or from the keyboard.
  useEffect(() => {
    const el = menuRef.current;
    if (!el || typeof el.querySelector !== 'function') return;
    try { el.querySelector('[role="menuitem"]:not([disabled])')?.focus(); } catch { /* detached */ }
  }, []);

  const onKeyDown = (e) => {
    const items = menuRef.current
      ? Array.from(menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled])'))
      : [];
    if (e.key === 'Escape') {
      // Consume it only because it really closed something (the 99.md layered-dismissal
      // convention) — otherwise Focus Mode's Escape exit would never fire from here.
      e.stopPropagation();
      e.preventDefault();
      onClose?.(true);
      return;
    }
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    const focusAt = (i) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') focusAt(at + 1);
    else if (e.key === 'ArrowUp') focusAt(at - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(items.length - 1);
    else if (e.key === 'Tab') { e.preventDefault(); onClose?.(true); }
  };

  const listLabel = list === 'include' ? 'inclusion' : 'exclusion';

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label={`Keyword actions for ${term}`}
      data-testid="screening-keyword-menu"
      data-term={term}
      data-list={list}
      data-origin={origin}
      {...{ [SCREENING_MODAL_ATTR]: 'true' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH, zIndex: 4000,
        background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 9,
        boxShadow: `0 14px 40px ${C.shadow}`, padding: 5,
        display: 'flex', flexDirection: 'column', fontFamily: FONT, outline: 'none',
      }}
    >
      <button
        role="menuitem"
        type="button"
        tabIndex={-1}
        disabled={!!busy}
        data-testid="screening-keyword-menu-delete"
        aria-label={`Delete keyword ${term}`}
        onClick={() => onDelete?.()}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
          width: '100%', textAlign: 'left', minHeight: 34, padding: '7px 10px',
          background: 'transparent', border: 'none', borderRadius: 6,
          color: busy ? C.dim : C.red, fontSize: 12.5, fontFamily: FONT, fontWeight: 600,
          cursor: busy ? 'progress' : 'pointer',
        }}
        onMouseEnter={e => { if (!busy) e.currentTarget.style.background = alpha(C.red, '12'); }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        onFocus={e => { if (!busy) e.currentTarget.style.background = alpha(C.red, '12'); }}
        onBlur={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span>Delete keyword</span>
        {/* Names the exact term so a mis-aimed right-click is visible before the
            click — §21 "does not accidentally select/delete neighboring keywords". */}
        <span style={{
          fontSize: 10, fontFamily: MONO, color: C.muted, fontWeight: 400,
          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{term} · {listLabel}</span>
      </button>
    </div>
  );
}
