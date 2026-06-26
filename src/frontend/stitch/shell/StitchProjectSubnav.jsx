/**
 * StitchProjectSubnav.jsx — the persistent white secondary sidebar (55.md), with
 * the 56.md §4 detailed screening vertical stepper.
 *
 * When a purple-rail category has children, the workspace renders THIS into the
 * coordinated nav shell's submenu slot (`.stitch-wsnav-sub`). It is a STABLE
 * workspace navigator, not a hover flyout: it stays mounted while the user works
 * within the category and never collapses on pointer-leave, and it animates WITH
 * the purple rail (the shell keeps it attached at left:var(--prail-w)).
 *
 *   - Children + order come from the centralized `submenuForCategory()` contract.
 *   - The active item is derived from the ROUTE (`activeKey`) → refresh and deep
 *     links restore it; `aria-current="page"` (or `"step"`) marks it for AT.
 *   - Non-screen categories: per-child completion status from the shared status
 *     language (`statusMeta`) — a glyph + label, never color alone (WCAG 1.4.1).
 *   - The Screen category renders a DETAILED VERTICAL STEPPER driven by the SAME
 *     `buildScreeningSteps()` model the horizontal screening stepper uses (one
 *     workflow-state source — acceptance #25): numbered pips + connectors + live
 *     counts ("312 unresolved", "2,104 remaining"), non-color status glyphs, and an
 *     "attention" state for unresolved duplicates/conflicts. Overview / Settings /
 *     Export / PRISMA are utility rows around the stepper. Sub-pages with no linked
 *     screening workspace yet are DISABLED with an explanation rather than hidden.
 */
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../theme/stitchTokens.js';
import { StitchContextRail } from './shellParts.jsx';
import { StitchTooltip } from '../primitives/overlay.jsx';
import { PROJECT_CATEGORIES, submenuForCategory } from '../nav/navConfig.js';
import { statusMeta } from '../nav/navStatus.js';

const CATEGORY_BY_ID = PROJECT_CATEGORIES.reduce((m, c) => { m[c.id] = c; return m; }, {});

const TONE_COLOR = { success: () => S.success, warn: () => S.warn, danger: () => S.danger, brand: () => S.brand, muted: () => S.textMuted };
const toneColor = (tone) => (TONE_COLOR[tone] || TONE_COLOR.muted)();

// Map the screening stepper's status vocabulary onto the shared status language.
// The reason a screening sub-page is not navigable yet — surfaced in the
// aria-label too (a disabled button cannot receive focus, so the hover tooltip
// alone is pointer-only; 56.md review a11y fix).
const DISABLED_HINT = 'Available once screening is set up for this project';

const SCREEN_STATUS = {
  done:      { tone: 'success', glyph: 'check',         label: 'Complete' },
  active:    { tone: 'brand',   glyph: null,            label: 'In progress' },
  attention: { tone: 'danger',  glyph: 'alertTriangle', label: 'Needs attention' },
  pending:   { tone: 'muted',   glyph: null,            label: 'Not started' },
};
const screenStatus = (s) => SCREEN_STATUS[s] || SCREEN_STATUS.pending;

/** Non-color status glyph for the plain (non-screen) submenu rows. */
function StatusGlyph({ status }) {
  const meta = statusMeta(status);
  const color = toneColor(meta.tone);
  return (
    <span title={meta.label} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      {meta.icon
        ? <Icon name={meta.icon} size={15} />
        : <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: '50%', border: `1.6px solid ${salpha(color, 0.7)}`, display: 'inline-block' }} />}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{meta.label}</span>
    </span>
  );
}

/** A plain submenu row (icon · label · optional status glyph). */
function SubnavRow({ item, active, status, showStatus, onClick }) {
  const disabled = !item.href;
  const meta = status ? statusMeta(status) : null;
  const color = meta ? toneColor(meta.tone) : S.textMuted;
  const row = (
    <button
      type="button"
      className="stitch-focusable"
      aria-current={active ? 'page' : undefined}
      aria-label={disabled
        ? `${item.label}${meta ? ` — ${meta.label}` : ''} — ${DISABLED_HINT}`
        : (meta ? `${item.label} — ${meta.label}` : item.label)}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? salpha(S.brand, 0.1) : 'transparent'; }}
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
        <Icon name={item.icon} size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
      {showStatus && status ? <span style={{ color }}><StatusGlyph status={status} /></span> : null}
    </button>
  );
  return (
    <li style={{ listStyle: 'none' }}>
      {disabled
        ? <StitchTooltip label="Available once screening is set up for this project" placement="right">{row}</StitchTooltip>
        : row}
    </li>
  );
}

/**
 * A screening stepper row: numbered/checked pip + connector + label + live count.
 * `step` is the buildScreeningSteps() descriptor for this stage (or null for the
 * utility rows — Overview / Settings / Export / PRISMA — which render plainly).
 */
function ScreenStepRow({ item, stepNum, step, active, first, last, onClick }) {
  const disabled = !item.href;
  const st = step ? screenStatus(step.status) : null;
  const color = st ? toneColor(st.tone) : S.textSecondary;
  const lineColor = step && step.status === 'done' ? salpha(S.success, 0.5) : salpha(S.outlineVariant, 0.7);
  const meta = st ? st.label : null;
  const row = (
    <button
      type="button"
      className="stitch-focusable"
      aria-current={active ? 'step' : undefined}
      aria-label={`Step ${stepNum}: ${item.label}${meta ? ` — ${meta}` : ''}${step && step.count ? ` (${step.count})` : ''}${disabled ? ` — ${DISABLED_HINT}` : ''}`}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'stretch', gap: 10, width: '100%',
        padding: '8px 12px 8px 0', border: 'none', borderRadius: 8, textAlign: 'left',
        background: active ? salpha(S.brand, 0.1) : 'transparent',
        color: disabled ? S.textMuted : (active ? S.brand : S.textPrimary),
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        fontFamily: S.font, transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {active ? <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 3, borderRadius: 3, background: S.brand }} /> : null}
      {/* pip column + connector */}
      <span style={{ width: 36, flexShrink: 0, position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {!first ? <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, height: 'calc(50% - 11px)', width: 2, transform: 'translateX(-1px)', background: salpha(S.outlineVariant, 0.7) }} /> : null}
        {!last ? <span aria-hidden="true" style={{ position: 'absolute', left: '50%', bottom: 0, height: 'calc(50% - 11px)', width: 2, transform: 'translateX(-1px)', background: lineColor }} /> : null}
        <span style={{
          position: 'relative', zIndex: 1, marginTop: 2, width: 22, height: 22, borderRadius: '50%', flexShrink: 0, alignSelf: 'flex-start',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: st && (step.status === 'done' || step.status === 'attention') ? salpha(color, 0.16) : (active ? salpha(S.brand, 0.16) : S.surfaceContainer),
          border: `${active ? 2 : 1.6}px solid ${st ? salpha(color, 0.85) : S.outlineVariant}`,
          color: st ? color : S.textSecondary, fontSize: 11, fontWeight: 800, lineHeight: 1,
        }}>
          {st && st.glyph ? <Icon name={st.glyph} size={12} strokeWidth={2.4} /> : stepNum}
        </span>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: active ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
        {step && step.count ? (
          <span style={{ fontSize: 11, color: step.status === 'attention' ? S.danger : S.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.count}</span>
        ) : null}
      </span>
    </button>
  );
  return (
    <li style={{ listStyle: 'none' }}>
      {disabled
        ? <StitchTooltip label="Available once screening is set up for this project" placement="right">{row}</StitchTooltip>
        : row}
    </li>
  );
}

export default function StitchProjectSubnav({ projectId, linkedSiftId, category, activeKey, statusMap = {}, screeningSteps = null }) {
  const navigate = useNavigate();
  const cat = CATEGORY_BY_ID[category];
  const items = submenuForCategory(category, { projectId, linkedSiftId });
  if (!cat || !items) return null;

  const isScreen = cat.kind === 'screen';

  if (isScreen) {
    // Index the live screening steps by id so each stepper row gets its real
    // status + count from the ONE shared model (buildScreeningSteps).
    const stepById = {};
    for (const s of (screeningSteps || [])) stepById[s.id] = s;
    // Which submenu rows are workflow steps (have a matching screening step)?
    const stepKeys = items.filter((i) => i.completionKey && stepById[i.completionKey]);
    const firstStepKey = stepKeys.length ? stepKeys[0].key : null;
    const lastStepKey = stepKeys.length ? stepKeys[stepKeys.length - 1].key : null;
    let stepNum = 0;
    return (
      <StitchContextRail title={cat.label} subtitle="Screening workflow">
        <nav aria-label="Screening workflow">
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0 }}>
            {items.map((item) => {
              const step = item.completionKey ? stepById[item.completionKey] : null;
              if (step) {
                stepNum += 1;
                return (
                  <ScreenStepRow
                    key={item.key}
                    item={item}
                    stepNum={stepNum}
                    step={step}
                    active={activeKey === item.key}
                    first={item.key === firstStepKey}
                    last={item.key === lastStepKey}
                    onClick={() => navigate(item.href)}
                  />
                );
              }
              return (
                <SubnavRow
                  key={item.key}
                  item={item}
                  active={activeKey === item.key}
                  status={undefined}
                  showStatus={false}
                  onClick={() => navigate(item.href)}
                />
              );
            })}
          </ul>
        </nav>
      </StitchContextRail>
    );
  }

  return (
    <StitchContextRail title={cat.label}>
      <nav aria-label={`${cat.label} pages`}>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0 }}>
          {items.map((item) => (
            <SubnavRow
              key={item.key}
              item={item}
              active={activeKey === item.key}
              status={statusMap[item.completionKey]}
              showStatus
              onClick={() => navigate(item.href)}
            />
          ))}
        </ul>
      </nav>
    </StitchContextRail>
  );
}
