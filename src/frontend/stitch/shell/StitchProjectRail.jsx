/**
 * StitchProjectRail.jsx — the project workspace's primary workflow rail
 * (design2.md Part 5).
 *
 * Collapsed it is a 72px icon-only rail; it expands (as an overlay, so content
 * never reflows) to reveal the full label of every stage on:
 *   - pointer hover,
 *   - keyboard focus entering it (CSS :focus-within), and
 *   - an explicit toggle button (for touch / an unambiguous keyboard control).
 * All three are handled in scoped CSS (stitchTokens .stitch-prail*) so the open
 * state survives moving the pointer between an icon and its label and respects
 * prefers-reduced-motion.
 *
 * The stage list, order, labels and icons come straight from the centralized nav
 * config (which derives them from the legacy TABS) — so it mirrors the legacy
 * workflow exactly and uses USER-FACING workflow names, never internal engine
 * names. Every stage opens its REAL destination (screening / RoB engines or the
 * classic workspace tab); permissions, routes, progress and feature flags are all
 * preserved by the underlying pages.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/icons.jsx';
import { S, salpha, STITCH_RAIL, STITCH_MONO } from '../theme/stitchTokens.js';
import { StitchAvatar } from '../primitives/core.jsx';
import { buildProjectNav, projectStageHref } from '../nav/navConfig.js';
import { useAppVersion } from './useAppVersion.js';

const STATUS_COLOR = { done: STITCH_RAIL.indicator, partial: '#ecbb4e', empty: 'rgba(255,255,255,0.32)' };

function StatusDot({ status }) {
  if (!status) return null;
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[status] || STATUS_COLOR.empty, flexShrink: 0 }} />;
}

function RailRow({ stage, active, status, onClick }) {
  return (
    <button
      type="button"
      className="stitch-focusable"
      aria-label={stage.label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = salpha('#ffffff', 0.08); }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', width: '100%', minHeight: 44,
        border: 'none', background: active ? STITCH_RAIL.active : 'transparent', cursor: 'pointer',
        color: STITCH_RAIL.text, opacity: active ? 1 : STITCH_RAIL.idle, padding: 0,
        transition: 'background 0.15s ease, opacity 0.15s ease',
      }}
    >
      {active ? <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: STITCH_RAIL.indicator }} /> : null}
      <span style={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Icon name={stage.icon} size={20} />
      </span>
      <span className="stitch-prail-label" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, paddingRight: 14, textAlign: 'left' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stage.label}</span>
        <StatusDot status={status} />
      </span>
    </button>
  );
}

function GroupHeader({ label }) {
  return (
    <div className="stitch-prail-group" style={{ display: 'flex', alignItems: 'center', padding: '8px 0 2px 18px' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

export default function StitchProjectRail({ projectId, linkedSiftId, statusMap = {}, activeStage = 'overview', variant = 'overlay' }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const version = useAppVersion();
  const [expanded, setExpanded] = useState(false);
  const nav = buildProjectNav();
  const ctx = { projectId, linkedSiftId };
  const isStatic = variant === 'static'; // mobile drawer: always-expanded, in-flow

  const go = (stage) => navigate(projectStageHref(stage, ctx));

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

        {/* Scrollable stage list */}
        <div className="stitch-prail-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 8 }}>
          {/* Project group: Overview, Project Control */}
          {nav.project.map((stage) => (
            <RailRow key={stage.id} stage={stage} active={activeStage === stage.id} status={statusMap[stage.id]} onClick={() => go(stage)} />
          ))}

          {/* Workflow phases */}
          {nav.phases.map((ph) => (
            <div key={ph.phase}>
              <GroupHeader label={ph.label} />
              {ph.steps.map((stage) => (
                <RailRow key={stage.id} stage={stage} active={activeStage === stage.id} status={statusMap[stage.id]} onClick={() => go(stage)} />
              ))}
            </div>
          ))}

          {/* Reference group: Methods */}
          {nav.reference.length ? (
            <div>
              <GroupHeader label="Reference" />
              {nav.reference.map((stage) => (
                <RailRow key={stage.id} stage={stage} active={activeStage === stage.id} status={statusMap[stage.id]} onClick={() => go(stage)} />
              ))}
            </div>
          ) : null}
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
