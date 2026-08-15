/**
 * focus/FocusControls.jsx — 104.md Part 1, the visible surface of Focus Mode.
 *
 * Three components:
 *   FocusToggle  — the small icon that enters/leaves Focus Mode. Lives in the top
 *                  header beside the theme toggle, i.e. the SAME place on every
 *                  page, which is what "a consistent location" asks for.
 *   FocusNavMenuButton — 117.md §43, the hamburger. Exported rather than inlined
 *                  because BOTH focus bars need it and there is exactly one
 *                  drawer: the workspace's FocusNavBar below and the shell's
 *                  DefaultFocusBar (StitchAppShell) must not grow two.
 *   FocusNavBar  — the slim bar that replaces all page chrome while focused: exit,
 *                  where-you-are, and Previous/Next drawn from the shared workflow
 *                  sequence (never a second nav model).
 *
 * Accessibility is not an afterthought here because the control is an icon: every
 * button carries a real `aria-label` (the icon is never the only semantics), the
 * tooltip is supplementary rather than load-bearing, both reveal on keyboard focus
 * as well as hover, and `aria-pressed` reports the toggle's state to a screen
 * reader. The native `title` attribute is suppressed deliberately — 104.md asks for
 * a designed tooltip, and leaving `title` on would stack a browser one underneath.
 */
import { useEffect, useRef } from 'react';
import { StitchIconButton } from '../stitch/primitives/core.jsx';
import { StitchTooltip } from '../stitch/primitives/overlay.jsx';
import { Icon } from '../components/icons.jsx';
import { S, salpha } from '../stitch/theme/stitchTokens.js';
import {
  useFocusMode, useFocusAvailable, useFocusNav, focusShortcutLabel,
} from './FocusModeContext.jsx';
import { stepTitle } from '../stitch/nav/workflowSequence.js';

/* ════════════════════════ the toggle ════════════════════════ */

/**
 * The words the toggle uses, as a pure function of the two states it reports.
 *
 * Exported and pure because 114-r2 §5 is a CLAIM-HONESTY requirement, and the
 * only way to pin both branches is to test them without a browser: the enter
 * copy may promise a full screen (it describes an intent the app really acts
 * on), but the EXIT copy describes where the user already is. Focus Mode
 * routinely outlives fullscreen — a refused request, a reload, F11, an Escape
 * the browser consumed to close an overlay — and in every one of those states
 * "leave full screen" is a button lying about a screen that is plainly not full.
 */
export function focusToggleCopy(focus, isFullscreen) {
  if (!focus) {
    return {
      icon: 'expand',
      tip: 'Focus mode — full screen',
      aria: 'Enter focus mode — hide navigation and use the full screen',
      hint: focusShortcutLabel(),
    };
  }
  return {
    icon: 'collapse',
    tip: 'Exit focus mode',
    aria: isFullscreen
      ? 'Exit focus mode — restore navigation and leave full screen'
      : 'Exit focus mode — restore navigation',
    hint: `${focusShortcutLabel()} or Esc`,
  };
}

/** How long after a toggle a freshly-mounted control may claim keyboard focus. */
const RETENTION_MS = 1500;

export function FocusToggle({ size = 'md', placement = 'bottom' }) {
  const { focus, isFullscreen, toggleFocus, focusChangedAt } = useFocusMode();
  const available = useFocusAvailable();
  const hostRef = useRef(null);

  /**
   * 114.md §7 — "focus is not lost". Entering or leaving Focus Mode swaps which
   * chrome is mounted, so the very button the user just pressed is unmounted and
   * `document.activeElement` falls back to <body>: a keyboard user's next Tab
   * restarts from the top of the document. The replacement instance takes the
   * focus back.
   *
   * Three guards keep this surgical rather than a focus thief:
   *   - `focusChangedAt` must be recent. A first paint (including a
   *     sessionStorage restore, which sets it to 0) is not a transition, so a
   *     page must never load with this control focused.
   *   - activeElement must have been LOST. If anything real still holds focus —
   *     someone typing, a dialog, a control the page moved focus to — we leave
   *     it exactly where it is.
   *   - it runs per (focus, focusChangedAt) pair, so a re-render for any other
   *     reason cannot re-trigger it.
   */
  useEffect(() => {
    if (!available || typeof document === 'undefined') return;
    if (!focusChangedAt || Date.now() - focusChangedAt > RETENTION_MS) return;
    const btn = hostRef.current && hostRef.current.querySelector('button');
    if (!btn) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    btn.focus();
  }, [focus, focusChangedAt, available]);

  // No chrome to hide ⇒ no control. Better than a button that visibly does nothing.
  if (!available) return null;

  const copy = focusToggleCopy(focus, isFullscreen);
  return (
    // `display: contents` so reaching the button for focus restoration costs the
    // layout nothing — the wrapper generates no box of its own.
    <span ref={hostRef} style={{ display: 'contents' }}>
      <StitchTooltip label={copy.tip} hint={copy.hint} placement={placement}>
        <StitchIconButton
          icon={copy.icon}
          label={copy.aria}
          title={null}
          aria-pressed={focus}
          active={focus}
          size={size}
          onClick={toggleFocus}
          data-testid="focus-toggle"
        />
      </StitchTooltip>
    </span>
  );
}

/* ════════════════════════ the hamburger (117.md §43) ════════════════════════ */

/** The drawer's DOM id. One constant, referenced by the button's aria-controls
 *  and by the panel itself, so the two can never drift apart. */
export const FOCUS_NAV_DRAWER_ID = 'focus-nav-drawer';

/**
 * The hamburger's words, as a pure function of the one state it reports.
 *
 * Same reasoning as focusToggleCopy: the aria label is STABLE (it names the
 * control, "Navigation", which is what a screen-reader user needs on every
 * press), while the designed tooltip describes what the press will DO. Exported
 * so both branches are pinned without hovering anything.
 */
export function focusNavMenuCopy(navOpen) {
  return { aria: 'Navigation', tip: navOpen ? 'Hide menu' : 'Show menu' };
}

/**
 * The three-line menu icon. Toggles the focus nav drawer the shell renders.
 *
 * The id it controls is the drawer's, which the shell mounts (empty) for the
 * whole focused session precisely so this reference is never dangling — see
 * StitchAppShell's FocusNavOverlay.
 *
 * `aria-expanded`, not `aria-pressed`: this is a disclosure control for a region
 * that exists in the DOM, which is what expanded/collapsed means. StitchIconButton
 * derives aria-pressed from `active`, so that one is suppressed explicitly here —
 * `active` is carried for the visual state alone. Announcing both would tell a
 * screen-reader user the button is "pressed" AND "expanded" for one fact.
 */
export function FocusNavMenuButton({ size = 'sm', placement = 'bottom' }) {
  const { navOpen, navPinned, toggleNav } = useFocusNav();
  const copy = focusNavMenuCopy(navOpen);
  return (
    <StitchTooltip label={copy.tip} placement={placement}>
      <StitchIconButton
        icon="menu"
        label={copy.aria}
        title={null}
        size={size}
        active={navOpen}
        aria-pressed={undefined}
        aria-expanded={navOpen}
        aria-controls={FOCUS_NAV_DRAWER_ID}
        onClick={toggleNav}
        // Read by the drawer's outside-click dismissal, so the click that closes
        // the drawer is not immediately followed by this button reopening it.
        data-focus-nav-toggle="true"
        data-nav-state={navPinned ? 'pinned' : navOpen ? 'open' : 'hidden'}
        data-testid="focus-nav-menu"
      />
    </StitchTooltip>
  );
}

/* ════════════════════════ the focus bar ════════════════════════ */

/** Height of the focus bar, in px. Exported so layouts can do their height maths
 *  against one number instead of each guessing. */
export const FOCUS_BAR_H = 40;

function NavButton({ item, dir, onGo }) {
  const disabled = !item;
  const arrow = dir === 'next' ? 'arrowRight' : 'arrowLeft';
  const word = dir === 'next' ? 'Next' : 'Previous';
  const title = item ? stepTitle(item) : null;

  const btn = (
    <button
      type="button"
      className="stitch-focusable"
      disabled={disabled}
      onClick={() => item && onGo(item)}
      data-testid={`focus-nav-${dir}`}
      aria-label={item ? `${word}: ${title}` : `No ${word.toLowerCase()} step`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: `1px solid ${salpha(S.outlineVariant, disabled ? 0.3 : 0.55)}`,
        background: 'transparent',
        color: disabled ? S.textMuted : S.textSecondary,
        borderRadius: S.radiusControl, padding: '4px 10px', height: 28,
        fontFamily: S.font, fontSize: 12.5, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
        maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = salpha(S.brand, 0.09); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {dir === 'prev' ? <Icon name={arrow} size={15} /> : null}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{word}</span>
      {dir === 'next' ? <Icon name={arrow} size={15} /> : null}
    </button>
  );

  // "clearly indicate what page is next/previous when useful" — the label stays
  // short so the bar stays slim; the destination lives in the tooltip.
  if (!item) return btn;
  return <StitchTooltip label={`${word}: ${title}`} placement="bottom">{btn}</StitchTooltip>;
}

/**
 * The only chrome Focus Mode keeps.
 *
 * @param {object} current  the active sequence item (for the "you are here" label)
 * @param {object} prev/next the navigable neighbours (null ⇒ that arrow is disabled)
 * @param {function} onGo   (item) => void — navigates using the item's own href
 * @param {string} projectName shown small, so a user in a chrome-less app still
 *                  knows WHICH project they are editing (the one orientation fact
 *                  worth keeping — losing it is how people edit the wrong review).
 */
export function FocusNavBar({ current, prev, next, onGo, projectName = '', stageLabel = '' }) {
  const { exitFocus, enterFullscreen, isFullscreen, fullscreenPhase } = useFocusMode();
  const exitCopy = focusToggleCopy(true, isFullscreen);
  return (
    <div
      data-testid="focus-nav-bar"
      // 117.md §45 — the phase, where a test (and a bug report) can read it.
      // Absent at rest, so a transition that never finished is visible.
      data-fullscreen-phase={fullscreenPhase !== 'normal' ? fullscreenPhase : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        height: FOCUS_BAR_H, flexShrink: 0, padding: '0 14px',
        borderBottom: `1px solid ${salpha(S.outlineVariant, 0.4)}`,
        background: salpha(S.surface, 0.9), backdropFilter: 'blur(6px)',
        position: 'sticky', top: 0, zIndex: 30,
      }}
    >
      {/* 117.md §43 — the way back to the navigation, first in the bar because
          that is where the navigation itself lives. */}
      <FocusNavMenuButton size="sm" />
      <FocusToggle size="sm" />

      <div style={{
        minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 8,
        fontFamily: S.font, overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {stageLabel || (current ? stepTitle(current) : '')}
        </span>
        {projectName ? (
          <span style={{ fontSize: 11.5, color: S.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {projectName}
          </span>
        ) : null}
      </div>

      <nav aria-label="Workflow navigation" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <NavButton item={prev} dir="prev" onGo={onGo} />
        <NavButton item={next} dir="next" onGo={onGo} />
      </nav>

      <span aria-hidden="true" style={{ width: 1, height: 20, background: salpha(S.outlineVariant, 0.55) }} />

      {/* Focused but windowed — after a reload, a refused request, or a
          fullscreen the browser ended on its own. The toggle cannot serve here
          (it exits Focus Mode), and only a fresh user gesture can get fullscreen
          back, so this offers one. It is absent whenever fullscreen is actually
          held, which is the normal case. */}
      {isFullscreen ? null : (
        <StitchTooltip label="Enter full screen" placement="bottom">
          <StitchIconButton
            icon="expand"
            label="Enter full screen — hide the browser chrome too"
            title={null}
            size="sm"
            onClick={enterFullscreen}
            data-testid="focus-fullscreen"
          />
        </StitchTooltip>
      )}

      <StitchTooltip label={exitCopy.tip} hint={exitCopy.hint} placement="bottom">
        <StitchIconButton
          icon="collapse"
          label={exitCopy.aria}
          title={null}
          size="sm"
          onClick={exitFocus}
          data-testid="focus-exit"
        />
      </StitchTooltip>
    </div>
  );
}

export default FocusToggle;
