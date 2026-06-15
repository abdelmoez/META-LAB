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
// reserve the same vertical space and keep the row's baseline even. Tall enough
// for the pip + "Step N" + the task-count line (prompt23 Task 3).
export const STEP_ROW_HEIGHT = 46;
const PIP = 16;            // status-pip diameter
const PIP_CENTER = 9;      // vertical centre of the pip from the cell top (padding-top 1 + PIP/2)

/**
 * StepIndicator — one read-only workflow step, shown beneath its submenu tab.
 *   step    — descriptor from buildScreeningSteps() (or null/undefined to render
 *             an equal-height spacer for tabs that aren't workflow steps)
 *   num     — the step's 1-based number in the pipeline
 *   current — whether this step's tab is the active route (drives aria-current)
 *   first / last — ends of the pipeline, so the connecting line doesn't overhang
 *
 * NOT interactive: no role, no tabindex, no pointer cursor — the submenu above is
 * the only navigation. A subtle connecting line runs behind the pips (Task 3).
 */
export function StepIndicator({ step, num, current, first = false, last = false }) {
  if (!step) return <span aria-hidden style={{ display: 'block', height: STEP_ROW_HEIGHT }} />;
  const st = STEP_STYLE[step.status] || STEP_STYLE.pending;
  const label = num ? `Step ${num}` : step.label;
  const count = step.count || null;
  const title = `${label} · ${step.label} (${step.status})${count ? ` — ${count}` : ''}`;
  // Connector segment colour: green once this step is done, else a faint rule.
  const lineColor = step.status === 'done' ? alpha(C.grn, 0.55) : C.brd2;
  return (
    <span
      aria-current={current ? 'step' : undefined}
      aria-label={`${label}: ${step.label} — ${step.status}${count ? ` (${count})` : ''}`}
      title={title}
      style={{
        position: 'relative', height: STEP_ROW_HEIGHT, cursor: 'default', userSelect: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
        gap: 1, padding: '1px 8px 3px',
      }}>
      {/* Connecting line behind the pips — left edge for non-first, right edge for
          non-last; extended a touch to bridge the inter-column gap. */}
      <span aria-hidden style={{
        position: 'absolute', top: PIP_CENTER, height: 2, zIndex: 0, background: lineColor,
        left: first ? '50%' : -2, right: last ? '50%' : -2,
      }} />
      {/* Status pip — check (done) / alert (attention) / step number otherwise */}
      <span style={{
        position: 'relative', zIndex: 1,
        width: PIP, height: PIP, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: step.status === 'pending' ? C.surf : st.bg, border: `1.5px solid ${st.ring}`, color: st.fg,
        fontSize: 9, fontWeight: 700, fontFamily: MONO, lineHeight: 1,
      }}>
        {st.glyph ? <Icon name={st.glyph} size={9} strokeWidth={2.4} /> : (num || '')}
      </span>
      <span style={{
        fontSize: 10, fontFamily: MONO, fontWeight: current ? 700 : 600, whiteSpace: 'nowrap',
        letterSpacing: '0.02em', color: step.status === 'pending' ? C.muted : st.fg, marginTop: 1,
      }}>{label}</span>
      {count && (
        <span style={{ fontSize: 9.5, whiteSpace: 'nowrap', color: C.muted, lineHeight: 1.2 }}>{count}</span>
      )}
    </span>
  );
}
