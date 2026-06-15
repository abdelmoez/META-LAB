/**
 * Stepper.jsx — the Screening workflow progress stepper (prompt21 Tasks 6-9).
 *
 * A compact, horizontal, theme-aware stepper that shows the whole Screening
 * pipeline at a glance: which steps exist, which are done, which needs attention,
 * which is the user's current location, and what's still pending. Pure inline
 * styles + theme tokens (no Tailwind / shadcn / external deps) and the in-house
 * Icon, matching the rest of the screening design system. Step colours mirror the
 * established PROGRESS_BADGE convention: pending=muted, active=accent, done=green.
 *
 * Status values: 'done' | 'active' | 'attention' | 'pending'.
 * Steps with an `onClick` are keyboard-operable (Enter/Space) tab stops.
 */
import { Fragment } from 'react';
import { C, FONT, MONO, alpha } from './theme.js';
import { Icon } from '../../components/icons.jsx';
// Pure status logic lives in its own module so it stays unit-testable without React.
export { buildScreeningSteps } from './screeningSteps.js';

const STEP_STYLE = {
  done:      { ring: C.grn,  fg: C.grn,  bg: alpha(C.grn, 0.16),  glyph: 'check' },
  active:    { ring: C.acc,  fg: C.acc,  bg: alpha(C.acc, 0.16),  glyph: null },
  attention: { ring: C.gold, fg: C.gold, bg: alpha(C.gold, 0.16), glyph: 'alert' },
  pending:   { ring: C.brd2, fg: C.muted, bg: 'transparent',      glyph: null },
};

export function Stepper({ steps = [], currentId, onStepSelect }) {
  return (
    <nav aria-label="Screening workflow progress"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto',
        padding: '10px 14px', background: C.surf, borderBottom: `1px solid ${C.brd}`,
        fontFamily: FONT, scrollbarWidth: 'thin',
      }}>
      {steps.map((s, i) => {
        const st = STEP_STYLE[s.status] || STEP_STYLE.pending;
        const isCurrent  = s.id === currentId;
        const clickable  = !!s.screen;
        const nextDone   = steps[i + 1] && (s.status === 'done');
        const select = () => { if (clickable && onStepSelect) onStepSelect(s.screen); };
        return (
          <Fragment key={s.id}>
            <div
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`${s.label}${s.hint ? ', ' + s.hint : ''} — ${s.status}`}
              onClick={select}
              onKeyDown={e => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(); } }}
              title={clickable ? `Go to ${s.label}` : `${s.label} (status only)`}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
                padding: '5px 9px', borderRadius: 9, cursor: clickable ? 'pointer' : 'default',
                background: isCurrent ? alpha(st.ring, 0.10) : 'transparent',
                outline: isCurrent ? `1px solid ${alpha(st.ring, 0.45)}` : '1px solid transparent',
                transition: 'background 0.15s, outline-color 0.15s',
              }}
              onMouseEnter={e => { if (clickable && !isCurrent) e.currentTarget.style.background = alpha(C.acc, 0.06); }}
              onMouseLeave={e => { if (clickable && !isCurrent) e.currentTarget.style.background = 'transparent'; }}>
              {/* Status circle */}
              <span style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: st.bg, border: `2px solid ${st.ring}`, color: st.fg,
              }}>
                <Icon name={st.glyph || s.icon} size={13} strokeWidth={2.1} />
              </span>
              {/* Label + hint */}
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
                <span style={{
                  fontSize: 12.5, fontWeight: isCurrent ? 700 : 600, whiteSpace: 'nowrap',
                  color: s.status === 'pending' ? C.muted : (isCurrent ? C.txt : st.fg),
                }}>{s.label}</span>
                {s.hint && (
                  <span style={{ fontSize: 10, fontFamily: MONO, color: st.fg, whiteSpace: 'nowrap', marginTop: 1 }}>{s.hint}</span>
                )}
              </span>
            </div>
            {/* Connector */}
            {i < steps.length - 1 && (
              <span aria-hidden style={{
                flexShrink: 0, alignSelf: 'center', width: 18, height: 2, margin: '0 2px',
                background: nextDone ? alpha(C.grn, 0.6) : C.brd2, borderRadius: 2,
              }} />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
