/**
 * StitchProjectSubnav.jsx — the persistent white secondary sidebar (55.md).
 *
 * When a purple-rail category has children, the workspace renders THIS into the
 * shell's existing `contextRail` slot (the 280px `StitchContextRail` white column).
 * It is a STABLE workspace navigator, not a hover flyout: it stays mounted while
 * the user works within the category and never collapses on pointer-leave.
 *
 *   - Children + order come from the centralized `submenuForCategory()` contract.
 *   - The active item is derived from the ROUTE (`activeSubmenuKey`) → refresh and
 *     deep links restore it; `aria-current="page"` marks it for AT.
 *   - Per-child completion status (non-screen categories) uses the shared status
 *     language (`statusMeta`) — a glyph + label, never color alone (WCAG 1.4.1).
 *   - The Screen category renders its children as an ordered, numbered sub-stepper
 *     (the screening workflow import → export, then PRISMA). Sub-pages with no
 *     linked screening workspace yet are shown DISABLED with an explanation rather
 *     than hidden.
 *   - Long labels are truncated with a native tooltip (`title`).
 */
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../theme/stitchTokens.js';
import { StitchContextRail } from './shellParts.jsx';
import { StitchTooltip } from '../primitives/overlay.jsx';
import { PROJECT_CATEGORIES, submenuForCategory } from '../nav/navConfig.js';
import { statusMeta } from '../nav/navStatus.js';

const CATEGORY_BY_ID = PROJECT_CATEGORIES.reduce((m, c) => { m[c.id] = c; return m; }, {});

const TONE_COLOR = { success: () => S.success, warn: () => S.warn, danger: () => S.danger, muted: () => S.textMuted };

/** Non-color status glyph: distinct SHAPE per state (check / clock / alert / ring). */
function StatusGlyph({ status }) {
  const meta = statusMeta(status);
  const color = (TONE_COLOR[meta.tone] || TONE_COLOR.muted)();
  return (
    <span title={meta.label} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      {meta.icon
        ? <Icon name={meta.icon} size={15} />
        : <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: '50%', border: `1.6px solid ${salpha(color, 0.7)}`, display: 'inline-block' }} />}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{meta.label}</span>
    </span>
  );
}

function SubnavRow({ item, index, active, status, showStatus, ordered, onClick }) {
  const disabled = !item.href;
  const meta = status ? statusMeta(status) : null;
  const color = meta ? (TONE_COLOR[meta.tone] || TONE_COLOR.muted)() : S.textMuted;
  const row = (
    <button
      type="button"
      className="stitch-focusable"
      aria-current={active ? 'page' : undefined}
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
        fontSize: ordered ? 12 : undefined, fontWeight: 700,
      }}>
        {ordered ? (index + 1) : <Icon name={item.icon} size={15} />}
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

export default function StitchProjectSubnav({ projectId, linkedSiftId, category, activeKey, statusMap = {} }) {
  const navigate = useNavigate();
  const cat = CATEGORY_BY_ID[category];
  const items = submenuForCategory(category, { projectId, linkedSiftId });
  if (!cat || !items) return null;

  const isScreen = cat.kind === 'screen';
  const subtitle = isScreen ? 'Screening workflow' : undefined;

  return (
    <StitchContextRail title={cat.label} subtitle={subtitle}>
      <nav aria-label={`${cat.label} pages`}>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0 }}>
          {items.map((item, i) => (
            <SubnavRow
              key={item.key}
              item={item}
              index={i}
              ordered={isScreen}
              active={activeKey === item.key}
              status={isScreen ? undefined : statusMap[item.completionKey]}
              showStatus={!isScreen}
              onClick={() => navigate(item.href)}
            />
          ))}
        </ul>
      </nav>
    </StitchContextRail>
  );
}
