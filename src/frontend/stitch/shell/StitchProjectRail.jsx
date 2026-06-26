/**
 * StitchProjectRail.jsx — the project workspace's primary CATEGORY rail (55.md).
 *
 * 55.md restructures this rail to show ONLY the 9 top-level workflow CATEGORIES
 * (Overview, Project Control, Plan & Protocol, Search, Screen, Extract, Analyze,
 * Report, Reference) — the single, understandable research workflow from planning
 * to reporting — instead of all 19 flat stages. Selecting a category with children
 * navigates to its entry page and the workspace reveals the persistent white
 * submenu beside this rail (StitchProjectSubnav); Overview / Project Control /
 * Reference are single destinations and show no submenu.
 *
 * Collapsed it is a 72px icon-only rail; it expands (as an overlay, so content
 * never reflows) on hover, keyboard focus-within, or the explicit toggle — handled
 * in scoped CSS (.stitch-prail*), respecting prefers-reduced-motion.
 *
 * Per-category completion is rolled up from the legacy `stepStatus()` truth and
 * shown with a NON-COLOR glyph + accessible label (check / clock / hollow ring),
 * not a color-only dot (55.md #11/#12 — WCAG 1.4.1). Categories, order, labels and
 * icons come from the centralized nav contract.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/icons.jsx';
import { S, salpha, STITCH_RAIL, STITCH_MONO } from '../theme/stitchTokens.js';
import { StitchAvatar } from '../primitives/core.jsx';
import {
  PROJECT_CATEGORIES, categoryForStage, categoryEntryHref, categoryStageStatuses,
} from '../nav/navConfig.js';
import { rollUpStatus, statusMeta } from '../nav/navStatus.js';
import { useAppVersion } from './useAppVersion.js';

const STATUS_TINT = { done: STITCH_RAIL.indicator, partial: '#ecbb4e', empty: 'rgba(255,255,255,0.4)' };

/** Non-color category status: distinct SHAPE per state (check / clock / hollow ring). */
function RailStatusGlyph({ status }) {
  if (!status) return null;
  const meta = statusMeta(status);
  const tint = STATUS_TINT[status] || STATUS_TINT.empty;
  return (
    <span title={meta.label} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: tint }}>
      {meta.icon
        ? <Icon name={meta.icon} size={15} />
        : <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', border: `1.6px solid ${tint}`, display: 'inline-block' }} />}
    </span>
  );
}

function CategoryRow({ cat, active, status, onClick }) {
  const meta = status ? statusMeta(status) : null;
  return (
    <button
      type="button"
      className="stitch-focusable"
      aria-label={meta ? `${cat.label} — ${meta.label}` : cat.label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = salpha('#ffffff', 0.08); }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', width: '100%', minHeight: 46,
        border: 'none', background: active ? STITCH_RAIL.active : 'transparent', cursor: 'pointer',
        color: STITCH_RAIL.text, opacity: active ? 1 : STITCH_RAIL.idle, padding: 0,
        transition: 'background 0.15s ease, opacity 0.15s ease',
      }}
    >
      {active ? <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: STITCH_RAIL.indicator }} /> : null}
      <span style={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Icon name={cat.icon} size={20} />
      </span>
      <span className="stitch-prail-label" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, paddingRight: 14, textAlign: 'left' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.label}</span>
        <RailStatusGlyph status={status} />
      </span>
    </button>
  );
}

function RailDivider() {
  return <div className="stitch-prail-label" aria-hidden="true" style={{ height: 1, background: salpha('#ffffff', 0.12), margin: '8px 18px' }} />;
}

export default function StitchProjectRail({ projectId, linkedSiftId, statusMap = {}, activeStage = 'overview', variant = 'overlay' }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const version = useAppVersion();
  const [expanded, setExpanded] = useState(false);
  const ctx = { projectId, linkedSiftId };
  const isStatic = variant === 'static'; // mobile drawer: always-expanded, in-flow
  const activeCategory = categoryForStage(activeStage);

  const go = (cat) => navigate(categoryEntryHref(cat.id, ctx));
  const statusFor = (cat) => rollUpStatus(categoryStageStatuses(cat.id, statusMap));

  return (
    <div
      className="stitch-prail"
      data-expanded={(expanded || isStatic) ? 'true' : undefined}
      style={isStatic ? { width: '100%' } : undefined}
    >
      <nav aria-label="Project workflow" className="stitch-prail-overlay"
        style={isStatic ? { position: 'relative', width: '100%', boxShadow: 'none' } : undefined}>
        {/* Brand + explicit expand/collapse toggle */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0 12px', flexShrink: 0 }}>
          <span style={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
            <button type="button" onClick={() => navigate('/app')} aria-label="PecanRev dashboard" title="PecanRev dashboard"
              style={{ width: 40, height: 40, borderRadius: 12, background: '#fff', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: STITCH_RAIL.bg, fontFamily: S.font, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}>
              PR
            </button>
          </span>
          {!isStatic ? (
            <button
              type="button"
              className="stitch-prail-label stitch-focusable"
              aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              style={{ marginLeft: 'auto', marginRight: 12, border: 'none', background: salpha('#ffffff', 0.1), color: STITCH_RAIL.text,
                width: 28, height: 28, borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name={expanded ? 'arrowLeft' : 'arrowRight'} size={16} />
            </button>
          ) : null}
        </div>

        {/* The 9 workflow categories (one understandable research workflow) */}
        <div className="stitch-prail-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 8 }}>
          {PROJECT_CATEGORIES.map((cat, i) => (
            <div key={cat.id}>
              {/* a subtle divider sets Reference apart from the core workflow */}
              {cat.id === 'reference' ? <RailDivider /> : null}
              <CategoryRow
                cat={cat}
                active={activeCategory === cat.id}
                status={statusFor(cat)}
                onClick={() => go(cat)}
              />
            </div>
          ))}
        </div>

        {/* Bottom: profile + subtle version */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${salpha('#ffffff', 0.12)}`, padding: '10px 0' }}>
          <button
            type="button" className="stitch-focusable" aria-label="Profile & settings"
            onClick={() => navigate('/profile')}
            onMouseEnter={(e) => { e.currentTarget.style.background = salpha('#ffffff', 0.08); }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{ display: 'flex', alignItems: 'center', width: '100%', minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', color: STITCH_RAIL.text, padding: 0 }}
          >
            <span style={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
              <StitchAvatar name={user?.name || user?.email || 'Account'} size={32} />
            </span>
            <span className="stitch-prail-label" style={{ flex: 1, minWidth: 0, textAlign: 'left', paddingRight: 14 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || 'Account'}</span>
              {version ? <span style={{ display: 'block', fontSize: 10.5, fontFamily: STITCH_MONO, color: 'rgba(255,255,255,0.5)' }} title={`PecanRev version ${version}`}>v{version}</span> : null}
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
