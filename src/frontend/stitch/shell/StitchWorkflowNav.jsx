/**
 * StitchWorkflowNav.jsx — the reusable contextual sub-navigation column
 * (design2.md Part 6). It is the white column that appears when a workflow stage
 * has subpages, rendering them as a Stitch-styled vertical stepper with:
 *   - current / completed / available / attention status (icon + connector line),
 *   - live counts where relevant,
 *   - deep links (each row navigates to the real subpage route),
 *   - a progress summary + a manual collapse control.
 *
 * It is intentionally CONFIG-DRIVEN (a `steps` array), not hard-coded to Screening,
 * so the same component serves any workflow area with subpages. The page supplies
 * the steps (e.g. from navConfig.SCREENING_SUBNAV + live counts) and the active
 * key, so progress is read from the SAME backend source as the legacy stepper —
 * never recomputed here.
 */
import { S, salpha } from '../theme/stitchTokens.js';
import { Icon } from '../../components/icons.jsx';
import { StitchIconButton } from '../primitives/core.jsx';

const STATUS_META = {
  done:      { icon: 'circleCheck',   color: S.success, label: 'Complete' },
  active:    { icon: 'clock',         color: S.brand,   label: 'In progress' },
  attention: { icon: 'alertTriangle', color: S.warn,    label: 'Needs attention' },
  pending:   { icon: 'minus',         color: S.outlineVariant, label: 'Not started' },
};

function StepRow({ step, isLast, onNavigate }) {
  const meta = STATUS_META[step.status] || STATUS_META.pending;
  const active = step.active;
  const disabled = step.disabled;
  return (
    <button
      type="button"
      className="stitch-focusable"
      aria-current={active ? 'step' : undefined}
      aria-label={`${step.label}${step.disabled ? ' (unavailable)' : ''}${step.count != null ? `, ${step.count}` : ''}`}
      aria-disabled={disabled || undefined}
      title={disabled ? `${step.label} — not available yet` : undefined}
      onClick={() => !disabled && onNavigate?.(step)}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? S.brandSoft : 'transparent'; }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
        padding: '9px 10px', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left',
        borderRadius: 10, background: active ? S.brandSoft : 'transparent', opacity: disabled ? 0.5 : 1,
        transition: 'background 0.14s ease',
      }}
    >
      {/* status icon + connector */}
      <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ color: active ? S.brand : meta.color, display: 'inline-flex' }}>
          <Icon name={active ? (step.icon || 'arrowRight') : meta.icon} size={18} />
        </span>
        {!isLast ? <span aria-hidden="true" style={{ position: 'absolute', top: 22, width: 2, height: 'calc(100% - 4px)', background: salpha(S.outlineVariant, 0.5) }} /> : null}
      </span>
      <span style={{ minWidth: 0, flex: 1, paddingBottom: isLast ? 0 : 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: active ? 700 : 600, color: active ? S.brand : S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.label}</span>
          {step.count != null ? (
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 9999, padding: '1px 7px', flexShrink: 0,
              background: step.status === 'attention' ? S.warnSoft : S.surfaceContainer,
              color: step.status === 'attention' ? S.onWarnSoft : S.textSecondary }}>{step.count}</span>
          ) : null}
        </span>
        {step.hint ? <span style={{ display: 'block', fontSize: 11.5, color: S.textMuted, marginTop: 1 }}>{step.hint}</span> : null}
      </span>
    </button>
  );
}

export default function StitchWorkflowNav({
  title, subtitle, steps = [], onNavigate, onCollapse, footer,
}) {
  return (
    <aside aria-label={title ? `${title} navigation` : 'Workflow navigation'} className="stitch-scope" style={{
      width: 280, flexShrink: 0, background: S.card, borderRight: `1px solid ${salpha(S.outlineVariant, 0.5)}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.45)}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          {subtitle ? <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.textMuted, marginBottom: 3 }}>{subtitle}</div> : null}
          <h2 style={{ fontSize: 16, fontWeight: 700, color: S.textPrimary, margin: 0 }}>{title}</h2>
        </div>
        {onCollapse ? <StitchIconButton icon="arrowLeft" label="Collapse panel" size="sm" onClick={onCollapse} /> : null}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {steps.map((step, i) => (
          <StepRow key={step.key} step={step} isLast={i === steps.length - 1} onNavigate={onNavigate} />
        ))}
      </div>
      {footer ? <div style={{ padding: 14, borderTop: `1px solid ${salpha(S.outlineVariant, 0.45)}` }}>{footer}</div> : null}
    </aside>
  );
}
