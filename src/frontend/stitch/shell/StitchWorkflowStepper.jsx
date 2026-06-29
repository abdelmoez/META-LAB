/**
 * StitchWorkflowStepper.jsx — the ONE reusable vertical workflow stepper for the
 * white submenu (57.md §5). Plan & Protocol, Search, Screen, Extract, Analyze and
 * Report all render through this component (one foundation, no four duplicate
 * implementations).
 *
 * Design contract (57.md §3/§4):
 *  - The step marker ALWAYS shows the step NUMBER — never replaced by a check /
 *    alert / colored dot. Status is a SECONDARY treatment: a right-side status icon
 *    + accessible label, the pip border/number color, and the connector color.
 *  - Connector lines are CONTINUOUS through the pip centers. Each numbered step
 *    pins its pip at a FIXED vertical offset, and the connector is two absolutely
 *    positioned segments (above: row-top → pip-center; below: pip-center →
 *    row-bottom). Because the pip center is fixed and the below-segment stretches to
 *    the row bottom, the line stays unbroken across variable-height rows (long
 *    labels, helper text, counts) and across any step state.
 *  - Utility rows (no `num` — e.g. the Screen category's Overview / Settings /
 *    Export / PRISMA) render as plain rows with no pip/connector.
 *  - Disabled steps show their reason in the aria-label (a disabled button cannot
 *    receive the hover tooltip), and via a right-side lock affordance.
 *  - Buttons + aria-current="step" + keyboard + reduced-motion + light/dark tokens.
 */
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../theme/stitchTokens.js';
import { StitchTooltip } from '../primitives/overlay.jsx';
import { statusMeta } from '../nav/navStatus.js';

const PIP_SIZE = 24;
const ROW_PAD_TOP = 9;
const PIP_CENTER_Y = ROW_PAD_TOP + PIP_SIZE / 2; // fixed → continuous connectors

const TONE_COLOR = { success: () => S.success, warn: () => S.warn, danger: () => S.danger, brand: () => S.brand, muted: () => S.textMuted };
const toneColor = (tone) => (TONE_COLOR[tone] || TONE_COLOR.muted)();

const DISABLED_HINT = 'Available once screening is set up for this project';

/** A numbered workflow step: pip (always the NUMBER) + continuous connector. */
function StepRow({ step, active, connAbove, connBelow, onNavigate, testId }) {
  const disabled = !step.href;
  const meta = step.status ? statusMeta(step.status) : null;
  const tone = meta ? toneColor(meta.tone) : S.textMuted;
  const isDone = step.status === 'done';
  const isAttention = step.status === 'attention';
  // Pip color treatment by status — the NUMBER is always shown; color is secondary.
  const pipBorder = active ? S.brand : (meta && step.status !== 'empty' ? salpha(tone, 0.85) : S.outlineVariant);
  const pipColor = active ? S.brand : (meta && step.status !== 'empty' ? tone : S.textSecondary);
  const pipBg = isDone || isAttention ? salpha(tone, 0.14) : (active ? salpha(S.brand, 0.14) : S.surfaceContainer);
  const belowColor = isDone ? salpha(S.success, 0.5) : salpha(S.outlineVariant, 0.7);
  const aboveColor = salpha(S.outlineVariant, 0.7);

  const row = (
    <button
      type="button"
      className="stitch-focusable"
      data-testid={testId}
      data-status={step.status || 'empty'}
      data-disabled={disabled ? 'true' : 'false'}
      aria-current={active ? 'step' : undefined}
      aria-label={`Step ${step.num}: ${step.label}${meta ? ` — ${meta.label}` : ''}${step.count ? ` (${step.count})` : ''}${disabled ? ` — ${DISABLED_HINT}` : ''}`}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : () => onNavigate(step)}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'stretch', gap: 10, width: '100%',
        padding: `${ROW_PAD_TOP}px 12px ${ROW_PAD_TOP}px 0`, border: 'none', borderRadius: 8, textAlign: 'left',
        background: active ? salpha(S.brand, 0.1) : 'transparent',
        color: disabled ? S.textMuted : (active ? S.brand : S.textPrimary),
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        fontFamily: S.font, transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {active ? <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 3, borderRadius: 3, background: S.brand }} /> : null}
      {/* pip column + continuous connector segments (pinned pip center) */}
      <span style={{ width: 36, flexShrink: 0, position: 'relative' }}>
        {connAbove ? <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, height: PIP_CENTER_Y, width: 2, transform: 'translateX(-1px)', background: aboveColor }} /> : null}
        {connBelow ? <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: PIP_CENTER_Y, bottom: 0, width: 2, transform: 'translateX(-1px)', background: belowColor }} /> : null}
        <span style={{
          position: 'absolute', left: '50%', top: ROW_PAD_TOP, transform: 'translateX(-50%)',
          width: PIP_SIZE, height: PIP_SIZE, borderRadius: '50%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: pipBg, border: `${active ? 2 : 1.6}px solid ${pipBorder}`, color: pipColor,
          fontSize: 11.5, fontWeight: 800, lineHeight: 1, zIndex: 1,
        }}>
          {step.num}
        </span>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.label}</span>
          {/* secondary status icon — decorative; the button's aria-label already
              announces the status, so this is aria-hidden to avoid double-reading. */}
          {meta && meta.icon ? (
            <span aria-hidden="true" style={{ color: tone, flexShrink: 0, display: 'inline-flex' }}>
              <Icon name={meta.icon} size={14} />
            </span>
          ) : null}
        </span>
        {(step.count || step.desc) ? (
          <span style={{ fontSize: 11, color: isAttention ? S.danger : S.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.count || step.desc}</span>
        ) : null}
      </span>
    </button>
  );
  return (
    <li style={{ listStyle: 'none' }}>
      {disabled
        ? <StitchTooltip label={DISABLED_HINT} placement="right">{row}</StitchTooltip>
        : row}
    </li>
  );
}

/** A non-step utility row (icon · label) — no pip, no connector. */
function UtilityRow({ step, active, onNavigate, testId }) {
  const disabled = !step.href;
  const row = (
    <button
      type="button"
      className="stitch-focusable"
      data-testid={testId}
      data-disabled={disabled ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
      aria-label={`${step.label}${disabled ? ` — ${DISABLED_HINT}` : ''}`}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : () => onNavigate(step)}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '9px 12px', border: 'none', borderRadius: 8, textAlign: 'left',
        background: active ? salpha(S.brand, 0.1) : 'transparent',
        color: disabled ? S.textMuted : (active ? S.brand : S.textPrimary),
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        fontFamily: S.font, fontSize: 13.5, fontWeight: active ? 700 : 600,
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {active ? <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 3, borderRadius: 3, background: S.brand }} /> : null}
      <span style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: active ? salpha(S.brand, 0.16) : S.surfaceContainer, color: active ? S.brand : S.textSecondary,
      }}>
        <Icon name={step.icon} size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.label}</span>
    </button>
  );
  return (
    <li style={{ listStyle: 'none' }}>
      {disabled
        ? <StitchTooltip label={DISABLED_HINT} placement="right">{row}</StitchTooltip>
        : row}
    </li>
  );
}

/**
 * The vertical workflow stepper. `steps` = submenuSteps() output; `activeKey` is the
 * route-derived active step. `onNavigate` defaults to react-router navigation to the
 * step's href.
 */
export default function StitchWorkflowStepper({ steps, activeKey, ariaLabel = 'Workflow', onNavigate }) {
  const navigate = useNavigate();
  const go = onNavigate || ((step) => { if (step.href) navigate(step.href); });
  if (!Array.isArray(steps) || !steps.length) return null;
  return (
    <nav aria-label={ariaLabel} data-testid="stitch-workflow-stepper">
      {/* gap:0 so the rows touch and the connector segments (row-bottom of one step
          → row-top of the next) join into ONE continuous line with no break. */}
      <ol style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: 0, padding: 0 }}>
        {steps.map((step, i) => {
          const active = activeKey === step.key;
          if (step.num == null) return <UtilityRow key={step.key} testId={`stitch-stepper-step-${step.key}`} step={step} active={active} onNavigate={go} />;
          const connAbove = i > 0 && steps[i - 1].num != null;
          const connBelow = i < steps.length - 1 && steps[i + 1].num != null;
          return <StepRow key={step.key} testId={`stitch-stepper-step-${step.key}`} step={step} active={active} connAbove={connAbove} connBelow={connBelow} onNavigate={go} />;
        })}
      </ol>
    </nav>
  );
}
