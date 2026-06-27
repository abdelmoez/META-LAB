/**
 * StitchProjectRail.jsx — the project workspace's primary purple CATEGORY rail,
 * rebuilt for 56.md (§3 main vertical stepper · §6 pin · §7 grouping/separators ·
 * §8 Back to Projects).
 *
 * It renders INSIDE the coordinated workspace-nav shell (`.stitch-wsnav-rail`,
 * StitchAppShell): the shell owns the rail WIDTH (collapsed 72px → expanded 248px
 * on hover / keyboard focus / pin) and keeps the white submenu attached beside it,
 * so this component is a plain full-height column — it never positions itself.
 *
 * Structure (top → bottom):
 *   · Brand monogram + an unobtrusive PIN control (aria-pressed, persisted).
 *   · "Back to Projects" — a labelled control above Overview that links DIRECTLY
 *     to the projects dashboard (never history.back()), available collapsed too.
 *   · Three grouped sections with separators between them (55/56.md §7):
 *       Project Management  (Overview, Project Control)        — plain rows
 *       Research Workflow   (Plan…Report)                      — a VERTICAL STEPPER
 *       Project Resources   (Reference)                        — plain row
 *     The workflow group is an ordered stepper: numbered pips + connectors + a
 *     NON-COLOR status glyph (check / number / alert) and an accessible label, so
 *     status is never communicated by color alone (WCAG 1.4.1, acceptance #19).
 *   · Profile + a subtle real version label.
 *
 * Every step's status is rolled up from the legacy `stepStatus()` truth (the same
 * source the classic sidebar and the Overview use) — no hardcoded completion. An
 * optional `attentionMap` raises a category to "Needs attention" (e.g. unresolved
 * screening conflicts) from real project data.
 */
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/icons.jsx';
import { S, salpha, STITCH_RAIL, STITCH_MONO } from '../theme/stitchTokens.js';
import { StitchAvatar } from '../primitives/core.jsx';
import {
  buildRailGroups, categoryForStage, categoryEntryHref, categoryStageStatuses, projectsHref,
} from '../nav/navConfig.js';
import { rollUpStatus, statusMeta } from '../nav/navStatus.js';
import { useAppVersion } from './useAppVersion.js';

/* Pip palette tuned to read on the deep-purple rail (non-color status is also
   carried by the glyph SHAPE + the accessible label, never color alone). */
const PIP = {
  done:      { ring: STITCH_RAIL.indicator,        fg: STITCH_RAIL.indicator,        bg: 'rgba(150,245,145,0.16)' },
  partial:   { ring: '#ecbb4e',                    fg: '#ecbb4e',                    bg: 'rgba(236,187,78,0.16)' },
  attention: { ring: '#ffb4ab',                    fg: '#ffb4ab',                    bg: 'rgba(255,180,171,0.18)' },
  empty:     { ring: 'rgba(255,255,255,0.32)',     fg: 'rgba(255,255,255,0.62)',     bg: 'transparent' },
};
const pipOf = (status) => PIP[status] || PIP.empty;

/** Status glyph for the plain (non-stepper) category rows. */
function RailStatusGlyph({ status }) {
  if (!status) return null;
  const meta = statusMeta(status);
  const tint = pipOf(status).fg;
  return (
    <span title={meta.label} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: tint }}>
      {meta.icon
        ? <Icon name={meta.icon} size={15} />
        : <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', border: `1.6px solid ${tint}`, display: 'inline-block' }} />}
    </span>
  );
}

/** A plain category row (Overview, Project Control, Reference). */
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

/**
 * A vertical-stepper row (the Research Workflow group). A connector line runs
 * behind the pips (green up to the last completed step); the pip shows a check
 * (done), an alert (needs attention) or the step number, plus the accessible
 * status label. `first`/`last` clip the connector at the ends.
 */
function StepRow({ cat, active, status, first, last, onClick }) {
  const meta = statusMeta(status);
  const p = pipOf(status);
  const connectorAbove = !first;
  const connectorBelow = !last;
  // The connector segment below this pip is green once this step is complete.
  const lineColor = status === 'done' ? salpha(STITCH_RAIL.indicator, 0.55) : 'rgba(255,255,255,0.16)';
  return (
    <button
      type="button"
      className="stitch-focusable"
      aria-current={active ? 'step' : undefined}
      aria-label={`${cat.stepNum ? `Step ${cat.stepNum}: ` : ''}${cat.label} — ${meta.label}`}
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
      {/* pip column (36px center of the 72px rail) with the connector behind it */}
      <span style={{ width: 72, flexShrink: 0, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch' }}>
        {connectorAbove ? <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, height: 'calc(50% - 11px)', width: 2, transform: 'translateX(-1px)', background: 'rgba(255,255,255,0.16)' }} /> : null}
        {connectorBelow ? <span aria-hidden="true" style={{ position: 'absolute', left: '50%', bottom: 0, height: 'calc(50% - 11px)', width: 2, transform: 'translateX(-1px)', background: lineColor }} /> : null}
        <span style={{
          position: 'relative', zIndex: 1, width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: p.bg, border: `${active ? 2 : 1.6}px solid ${p.ring}`, color: p.fg,
          fontSize: 11, fontWeight: 800, fontFamily: STITCH_MONO, lineHeight: 1,
        }}>
          {/* 57.md §6/§10 — ALWAYS the step number; status is a secondary corner
              badge (shape, visible even when collapsed) + the pip/number color. */}
          {cat.stepNum || ''}
          {status && status !== 'empty' && meta && meta.icon ? (
            <span aria-hidden="true" style={{
              position: 'absolute', right: -4, bottom: -4, width: 12, height: 12, borderRadius: '50%',
              background: STITCH_RAIL.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: p.fg,
            }}>
              <Icon name={meta.icon} size={8} strokeWidth={2.6} />
            </span>
          ) : null}
        </span>
      </span>
      <span className="stitch-prail-label" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, paddingRight: 14, textAlign: 'left' }}>
        <span style={{ fontSize: 13.5, fontWeight: active ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.label}</span>
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.66)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.label}</span>
      </span>
    </button>
  );
}

function GroupLabel({ children }) {
  return (
    <div className="stitch-prail-group" aria-hidden="true" style={{ display: 'flex' }}>
      <span className="stitch-prail-label" style={{ padding: '8px 18px 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>{children}</span>
    </div>
  );
}

function RailSeparator() {
  return <div role="separator" aria-hidden="true" style={{ height: 1, background: salpha('#ffffff', 0.14), margin: '8px 16px' }} />;
}

export default function StitchProjectRail({
  projectId, linkedSiftId, statusMap = {}, attentionMap = {}, activeStage = 'overview',
  variant = 'overlay', pinned = false, onTogglePin,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const version = useAppVersion();
  const ctx = { projectId, linkedSiftId };
  const isStatic = variant === 'static'; // mobile drawer: always-expanded, in-flow
  const activeCategory = categoryForStage(activeStage);
  const groups = buildRailGroups();

  const go = (cat) => navigate(categoryEntryHref(cat.id, ctx));
  const statusFor = (cat) => (attentionMap[cat.id] ? 'attention' : rollUpStatus(categoryStageStatuses(cat.id, statusMap)));

  return (
    <nav
      aria-label="Project workflow"
      className={`stitch-prail${isStatic ? ' stitch-prail-static' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: isStatic ? STITCH_RAIL.bg : 'transparent' }}
    >
      {/* Brand + pin control */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0 10px', flexShrink: 0 }}>
        <span style={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <button type="button" onClick={() => navigate('/app')} aria-label="PecanRev dashboard" title="PecanRev dashboard"
            style={{ width: 40, height: 40, borderRadius: 12, background: '#fff', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: STITCH_RAIL.bg, fontFamily: S.font, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}>
            PR
          </button>
        </span>
        {!isStatic && onTogglePin ? (
          <span className="stitch-prail-label" style={{ marginLeft: 'auto', marginRight: 12 }}>
            <button
              type="button"
              className="stitch-focusable"
              aria-label={pinned ? 'Unpin navigation (collapse when not in use)' : 'Pin navigation open'}
              aria-pressed={pinned}
              title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
              onClick={onTogglePin}
              style={{ border: 'none', background: pinned ? salpha('#ffffff', 0.22) : salpha('#ffffff', 0.1), color: STITCH_RAIL.text,
                width: 28, height: 28, borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="pin" size={15} />
            </button>
          </span>
        ) : null}
      </div>

      {/* Back to Projects — directly above Overview (collapsed + expanded) */}
      <button
        type="button" className="stitch-focusable"
        aria-label="Back to Projects"
        onClick={() => navigate(projectsHref())}
        onMouseEnter={(e) => { e.currentTarget.style.background = salpha('#ffffff', 0.08); }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        style={{ display: 'flex', alignItems: 'center', width: '100%', minHeight: 40, border: 'none', background: 'transparent',
          cursor: 'pointer', color: STITCH_RAIL.text, opacity: 0.82, padding: 0, flexShrink: 0 }}
      >
        <span style={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Icon name="arrowLeft" size={18} />
        </span>
        <span className="stitch-prail-label" style={{ flex: 1, minWidth: 0, paddingRight: 14, textAlign: 'left', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Back to Projects
        </span>
      </button>
      <RailSeparator />

      {/* Grouped categories (Management · Research Workflow stepper · Resources) */}
      <div className="stitch-prail-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 8 }}>
        {groups.map((group, gi) => (
          <div key={group.id}>
            {gi > 0 ? <RailSeparator /> : null}
            <GroupLabel>{group.label}</GroupLabel>
            {group.categories.map((cat, ci) => (
              group.stepper ? (
                <StepRow
                  key={cat.id}
                  cat={cat}
                  active={activeCategory === cat.id}
                  status={statusFor(cat)}
                  first={ci === 0}
                  last={ci === group.categories.length - 1}
                  onClick={() => go(cat)}
                />
              ) : (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  active={activeCategory === cat.id}
                  status={statusFor(cat)}
                  onClick={() => go(cat)}
                />
              )
            ))}
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
  );
}
