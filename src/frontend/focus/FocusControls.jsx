/**
 * focus/FocusControls.jsx — 104.md Part 1, the visible surface of Focus Mode.
 *
 * Two components:
 *   FocusToggle  — the small icon that enters/leaves Focus Mode. Lives in the top
 *                  header beside the theme toggle, i.e. the SAME place on every
 *                  page, which is what "a consistent location" asks for.
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
import { StitchIconButton } from '../stitch/primitives/core.jsx';
import { StitchTooltip } from '../stitch/primitives/overlay.jsx';
import { Icon } from '../components/icons.jsx';
import { S, salpha } from '../stitch/theme/stitchTokens.js';
import { useFocusMode, useFocusAvailable, focusShortcutLabel } from './FocusModeContext.jsx';
import { stepTitle } from '../stitch/nav/workflowSequence.js';

/* ════════════════════════ the toggle ════════════════════════ */

export function FocusToggle({ size = 'md', placement = 'bottom' }) {
  const { focus, toggleFocus } = useFocusMode();
  const available = useFocusAvailable();
  // No chrome to hide ⇒ no control. Better than a button that visibly does nothing.
  if (!available) return null;

  const label = focus ? 'Exit focus mode' : 'Focus mode';
  return (
    <StitchTooltip
      label={label}
      hint={`${focusShortcutLabel()}${focus ? ' or Esc' : ''}`}
      placement={placement}
    >
      <StitchIconButton
        icon={focus ? 'collapse' : 'expand'}
        label={focus ? 'Exit focus mode' : 'Enter focus mode — hide navigation and maximise the workspace'}
        title={null}
        aria-pressed={focus}
        active={focus}
        size={size}
        onClick={toggleFocus}
        data-testid="focus-toggle"
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
  const { exitFocus } = useFocusMode();
  return (
    <div
      data-testid="focus-nav-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        height: FOCUS_BAR_H, flexShrink: 0, padding: '0 14px',
        borderBottom: `1px solid ${salpha(S.outlineVariant, 0.4)}`,
        background: salpha(S.surface, 0.9), backdropFilter: 'blur(6px)',
        position: 'sticky', top: 0, zIndex: 30,
      }}
    >
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

      <StitchTooltip label="Exit focus mode" hint={`${focusShortcutLabel()} or Esc`} placement="bottom">
        <StitchIconButton
          icon="collapse"
          label="Exit focus mode and restore navigation"
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
