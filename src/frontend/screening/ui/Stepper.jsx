/**
 * Stepper.jsx — the Screening workflow progress indicator (prompt21; redesigned
 * prompt22 Task 4).
 *
 * The stepper is now rendered INSIDE the Screening submenu: each step sits
 * directly beneath its matching submenu tab (see SiftProject.jsx). This file
 * exports the single, READ-ONLY <StepIndicator> for one step. It is deliberately
 * NOT interactive — not a button, not focusable, no pointer cursor — because the
 * submenu above is the only navigation. The indicator conveys progress with the
 * established PROGRESS_BADGE palette (pending=muted, active=accent, attention=gold,
 * done=green) plus a check/alert glyph or the step number, and aria-current for
 * the user's current step.
 *
 * Pure status logic lives in screeningSteps.js so it stays unit-testable.
 */
import { C, MONO, alpha } from './theme.js';
import { Icon } from '../../components/icons.jsx';
export { buildScreeningSteps } from './screeningSteps.js';

const STEP_STYLE = {
  done:      { ring: C.grn,  fg: C.grn,   bg: alpha(C.grn, 0.16),  glyph: 'check' },
  active:    { ring: C.acc,  fg: C.acc,   bg: alpha(C.acc, 0.16),  glyph: null },
  attention: { ring: C.gold, fg: C.gold,  bg: alpha(C.gold, 0.16), glyph: 'alert' },
  pending:   { ring: C.brd2, fg: C.muted, bg: 'transparent',       glyph: null },
};

// Fixed height so submenu tabs WITHOUT a step (Overview/Settings/Export) can
// reserve the same vertical space and keep the row's baseline even.
export const STEP_ROW_HEIGHT = 26;

/**
 * StepIndicator — one read-only workflow step, shown beneath its submenu tab.
 *   step    — descriptor from buildScreeningSteps() (or null/undefined to render
 *             an equal-height spacer for tabs that aren't workflow steps)
 *   num     — the step's 1-based number in the pipeline
 *   current — whether this step's tab is the active route (drives aria-current)
 */
export function StepIndicator({ step, num, current }) {
  if (!step) return <span aria-hidden style={{ display: 'block', height: STEP_ROW_HEIGHT }} />;
  const st = STEP_STYLE[step.status] || STEP_STYLE.pending;
  const label = num ? `Step ${num}` : step.label;
  const title = step.hint ? `${label} · ${step.label} — ${step.hint}` : `${label} · ${step.label} (${step.status})`;
  return (
    <span
      aria-current={current ? 'step' : undefined}
      aria-label={`${label}: ${step.label} — ${step.status}`}
      title={title}
      style={{
        height: STEP_ROW_HEIGHT, cursor: 'default', userSelect: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        padding: '0 6px 3px',
      }}>
      {/* Status pip — check (done) / alert (attention) / step number otherwise */}
      <span style={{
        width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: st.bg, border: `1.5px solid ${st.ring}`, color: st.fg,
        fontSize: 8.5, fontWeight: 700, fontFamily: MONO, lineHeight: 1,
      }}>
        {st.glyph ? <Icon name={st.glyph} size={8.5} strokeWidth={2.4} /> : (num || '')}
      </span>
      <span style={{
        fontSize: 10, fontFamily: MONO, fontWeight: current ? 700 : 600, whiteSpace: 'nowrap',
        letterSpacing: '0.02em', color: step.status === 'pending' ? C.muted : st.fg,
      }}>{label}</span>
    </span>
  );
}
