/**
 * shellParts.jsx — the persistent Stitch chrome pieces.
 *
 *   StitchPrimaryRail   — 72px deep-purple GLOBAL rail. design2.md Part 1: holds
 *                          ONLY global, application-level destinations (Dashboard,
 *                          Activity, Invitations, Help & Feedback) — never
 *                          standalone-engine launchers — plus the profile control
 *                          and a subtle real version label beneath it.
 *   StitchContextRail   — generic 280px contextual white column (collapsible).
 *   StitchAccountMenu   — avatar dropdown (profile, theme, Ops Console for staff,
 *                          sign out). design2.md Part 3.
 *   StitchTopHeader     — slim utility bar (notification bell, theme toggle,
 *                          account menu).
 *
 * Navigation is the SAME app routes the legacy UI uses — only the presentation
 * differs. The nav model itself is centralized in nav/navConfig.js (design2.md
 * Part 7) so legacy and Stitch can never silently drift.
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../theme/ThemeContext.jsx';
import { Icon } from '../../components/icons.jsx';
import NotificationsBell from '../../components/NotificationsBell.jsx';
import StitchChatLauncher from '../../components/chat/StitchChatLauncher.jsx';
import { S, salpha, STITCH_RAIL, STITCH_MONO } from '../theme/stitchTokens.js';
import { StitchAvatar, StitchBadge, StitchIconButton } from '../primitives/core.jsx';
import { StitchTooltip } from '../primitives/overlay.jsx';
import { GLOBAL_NAV, globalHref, activeGlobalKey } from '../nav/navConfig.js';
import { useAppVersion } from './useAppVersion.js';
import { useInvitations } from './useInvitations.js';

// Staff = can reach the Ops Console (AdminRoute allows admin + mod).
function isStaff(user) { return !!user && (user.role === 'admin' || user.role === 'mod'); }

/* ─── Shared rail button (icon + accessible name + tooltip while collapsed) ─── */
function RailButton({ icon, label, active, onClick, badge, tooltipPlacement = 'right', testId }) {
  return (
    <StitchTooltip label={label} placement={tooltipPlacement}>
      <button
        type="button"
        data-testid={testId}
        aria-label={badge ? `${label} (${badge} pending)` : label}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = salpha('#ffffff', 0.1); }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
        style={{
          position: 'relative', width: 48, height: 48, display: 'flex', alignItems: 'center',
          justifyContent: 'center', border: 'none', cursor: 'pointer', borderRadius: 12,
          background: active ? STITCH_RAIL.active : 'transparent',
          color: STITCH_RAIL.text, opacity: active ? 1 : STITCH_RAIL.idle,
          transition: 'background 0.15s ease, opacity 0.15s ease',
        }}
      >
        {active ? <span aria-hidden="true" style={{ position: 'absolute', left: -12, top: 12, bottom: 12, width: 3, borderRadius: 3, background: STITCH_RAIL.indicator }} /> : null}
        <Icon name={icon} size={22} />
        {badge ? (
          <span aria-hidden="true" style={{
            position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 9999, background: S.danger, color: '#fff', fontSize: 10, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            boxShadow: `0 0 0 2px ${STITCH_RAIL.bg}`,
          }}>{badge > 9 ? '9+' : badge}</span>
        ) : null}
      </button>
    </StitchTooltip>
  );
}

/* ─── The subtle, real version label (design2.md Part 1) ──────────────────────── */
function StitchRailVersion() {
  const version = useAppVersion();
  if (!version) return null;
  return (
    <StitchTooltip label={`PecanRev version ${version}`} placement="right">
      <span
        style={{
          fontFamily: STITCH_MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
          color: 'rgba(255,255,255,0.5)', userSelect: 'none', cursor: 'default',
        }}
      >
        v{version}
      </span>
    </StitchTooltip>
  );
}

/* ─── Primary GLOBAL rail ──────────────────────────────────────────────────── */
export function StitchPrimaryRail({ activeKey }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { pendingCount } = useInvitations();

  const activeGlobal = activeKey || activeGlobalKey(location.pathname, location.search);
  const profileActive = location.pathname.startsWith('/profile');

  return (
    <nav aria-label="Primary" data-testid="stitch-primary-rail" style={{
      width: 72, flexShrink: 0, background: STITCH_RAIL.bg, display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '20px 12px', gap: 6, height: '100%',
    }}>
      {/* PecanRev monogram (brand anchor) */}
      <button
        type="button" data-testid="stitch-home-button" onClick={() => navigate('/app')} aria-label="PecanRev home" title="PecanRev"
        style={{ width: 40, height: 40, borderRadius: 12, background: '#fff', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: STITCH_RAIL.bg, marginBottom: 14,
          flexShrink: 0, fontFamily: S.font, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}
      >
        PR
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        {GLOBAL_NAV.map((item) => (
          <RailButton
            key={item.key}
            testId={`stitch-global-nav-item-${item.key}`}
            icon={item.icon}
            label={item.label}
            active={activeGlobal === item.key}
            badge={item.badgeKey === 'invitations' ? pendingCount : 0}
            onClick={() => navigate(globalHref(item))}
          />
        ))}
      </div>

      {/* bottom: profile + subtle version */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <StitchTooltip label="Profile & settings" placement="right">
          <button
            type="button" data-testid="stitch-profile-button" aria-label="Profile & settings" aria-current={profileActive ? 'page' : undefined}
            onClick={() => navigate('/profile')}
            onMouseEnter={(e) => { if (!profileActive) e.currentTarget.style.background = salpha('#ffffff', 0.1); }}
            onMouseLeave={(e) => { if (!profileActive) e.currentTarget.style.background = 'transparent'; }}
            style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none',
              cursor: 'pointer', borderRadius: 9999, padding: 0,
              background: profileActive ? STITCH_RAIL.active : 'transparent',
              boxShadow: profileActive ? `0 0 0 2px ${STITCH_RAIL.indicator}` : 'none' }}
          >
            <StitchAvatar name={user?.name || user?.email || 'Account'} size={32} />
          </button>
        </StitchTooltip>
        <StitchRailVersion />
      </div>
    </nav>
  );
}

/* ─── Context rail (generic 280px white column; collapsible) ───────────────── */
export function StitchContextRail({ title, subtitle, action, children, footer, onCollapse }) {
  return (
    <aside aria-label={title || 'Context navigation'} data-testid="stitch-context-rail" className="stitch-scope" style={{
      width: 280, flexShrink: 0, background: S.card, borderRight: `1px solid ${salpha(S.outlineVariant, 0.5)}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {(title || action) ? (
        <div style={{ padding: '20px 18px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.45)}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              {title ? <h1 data-testid="stitch-context-rail-title" style={{ fontSize: 18, fontWeight: 700, color: S.textPrimary, margin: 0 }}>{title}</h1> : null}
              {subtitle ? <p style={{ fontSize: 12, color: S.textSecondary, margin: '3px 0 0' }}>{subtitle}</p> : null}
            </div>
            {onCollapse ? (
              <StitchIconButton icon="arrowLeft" label="Collapse panel" size="sm" onClick={onCollapse} />
            ) : null}
          </div>
          {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
        </div>
      ) : null}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>{children}</div>
      {footer ? <div style={{ padding: 12, borderTop: `1px solid ${salpha(S.outlineVariant, 0.45)}` }}>{footer}</div> : null}
    </aside>
  );
}

/* ─── Account menu (design2.md Part 3: + Ops Console for staff) ─────────────── */
export function StitchAccountMenu() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!user) return null;
  const name = user.name || user.email;
  const staff = isStaff(user);

  const Item = ({ icon, label, onClick, danger, testId }) => (
    <button type="button" role="menuitem" data-testid={testId} className="stitch-focusable" onClick={() => { setOpen(false); onClick?.(); }}
      onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', border: 'none',
        background: 'transparent', cursor: 'pointer', fontSize: 13.5, fontFamily: S.font, textAlign: 'left',
        color: danger ? S.danger : S.textPrimary, borderRadius: 8 }}>
      <Icon name={icon} size={16} />{label}
    </button>
  );
  const Divider = () => <div style={{ height: 1, background: salpha(S.outlineVariant, 0.4), margin: '6px 0' }} />;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" data-testid="stitch-account-button" className="stitch-focusable" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', cursor: 'pointer', padding: 3, borderRadius: 9999 }}>
        <StitchAvatar name={name} size={32} />
      </button>
      {open ? (
        <div role="menu" data-testid="stitch-account-menu" className="stitch-scale-in stitch-scope" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, minWidth: 244, background: S.card,
          border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderRadius: 12, boxShadow: S.shadow2, padding: 8, zIndex: 100, fontFamily: S.font,
        }}>
          <div style={{ padding: '8px 12px 10px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.4)}`, marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name || 'Account'}</div>
            <div style={{ fontSize: 12, color: S.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            {user.role === 'admin' ? <div style={{ marginTop: 6 }}><StitchBadge tone="brand" icon="shield">Administrator</StitchBadge></div>
              : user.role === 'mod' ? <div style={{ marginTop: 6 }}><StitchBadge tone="info" icon="shield">Moderator</StitchBadge></div> : null}
          </div>
          <Item testId="stitch-account-menu-item-profile" icon="user" label="Profile & settings" onClick={() => navigate('/profile')} />
          <Item testId="stitch-account-menu-item-theme" icon={theme === 'night' ? 'sun' : 'moon'} label={theme === 'night' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme} />
          {/* Administrative section — only for staff who can actually reach Ops. The
              route + server remain authoritative; hiding the item is presentation. */}
          {staff ? (
            <>
              <Divider />
              <div style={{ padding: '2px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.textMuted }}>
                Administration
              </div>
              <Item testId="stitch-account-menu-item-ops-console" icon="sliders" label="Ops Console" onClick={() => navigate('/ops')} />
            </>
          ) : null}
          <Divider />
          <Item testId="stitch-account-menu-item-signout" icon="logout" label="Sign out" danger onClick={async () => { await logout(); navigate('/login'); }} />
        </div>
      ) : null}
    </div>
  );
}

/* ─── Top utility header ──────────────────────────────────────────────────── */
// 55.md #14: project "Active now" presence lives HERE in the top bar, beside the
// notification bell — never in the side navigation or duplicated in page content.
// `topPresence` is the project-scoped PresenceIndicator (or null when there is no
// project / no online members); a thin divider separates it from the utilities.
// 75.md WS-F — the very thin project-progress underline that hugs the header's
// bottom edge. Rendered ONLY inside a project (pages pass `headerProgress`); the
// sticky header is the containing block, so an absolute bottom bar attaches cleanly.
// prefers-reduced-motion strips the width transition (the fill jumps, never slides).
const HEADER_PROGRESS_CSS =
  '@media (prefers-reduced-motion: reduce){ html[data-ui-design="stitch"] .stitch-hdr-progress-fill{ transition: none !important; } }';

function HeaderProgressBar({ headerProgress }) {
  if (headerProgress == null) return null;
  const raw = typeof headerProgress === 'number' ? { pct: headerProgress } : headerProgress;
  const n = Number(raw && raw.pct);
  if (!Number.isFinite(n)) return null;
  const pct = Math.max(0, Math.min(100, Math.round(n)));
  const label = (raw && raw.label) || `Project progress: ${pct}%`;
  return (
    <div
      data-testid="stitch-header-progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Project progress: ${pct}%`}
      aria-valuetext={`${pct}%`}
      title={label}
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 2,
        background: salpha(S.brand, 0.14), overflow: 'hidden',
      }}
    >
      <style>{HEADER_PROGRESS_CSS}</style>
      <div className="stitch-hdr-progress-fill" style={{
        width: `${pct}%`, height: '100%', background: S.brand,
        borderRadius: '0 2px 2px 0', transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      }} />
    </div>
  );
}

export function StitchTopHeader({ onOpenNav, breadcrumb, topPresence = null, chatContext = null, headerProgress = null }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <header data-testid="stitch-top-header" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', minHeight: 56,
      borderBottom: `1px solid ${salpha(S.outlineVariant, 0.4)}`, background: salpha(S.surface, 0.85),
      backdropFilter: 'blur(6px)', position: 'sticky', top: 0, zIndex: 30,
    }}>
      <button type="button" data-testid="stitch-drawer-toggle" aria-label="Open navigation" onClick={onOpenNav} className="stitch-focusable stitch-mobile-only"
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textSecondary, display: 'none', padding: 4 }}>
        <Icon name="menu" size={22} />
      </button>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: S.textSecondary, fontWeight: 600, overflow: 'hidden' }}>
        {breadcrumb}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {topPresence ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center' }}>{topPresence}</div>
            <span aria-hidden="true" style={{ width: 1, height: 24, background: salpha(S.outlineVariant, 0.6) }} />
          </>
        ) : null}
        {/* Project chat — shown ONLY within a project (never on dashboard/profile/ops/
            other global pages). 81.md read-only model: any linked member can open it;
            a member who cannot post (per-member mute or the project-wide "Restrict chat"
            lock) opens a READ-ONLY drawer. The icon greys + is unclickable ONLY when
            there is nothing to open (probing / probe error / no linked Screening workspace). */}
        {chatContext?.projectId ? (
          <StitchChatLauncher projectId={chatContext.projectId} projectName={chatContext.projectName || ''} />
        ) : null}
        <NotificationsBell />
        <StitchIconButton icon={theme === 'night' ? 'sun' : 'moon'} label={theme === 'night' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme} />
        <StitchAccountMenu />
      </div>
      {/* 75.md WS-F — thin canonical project-progress underline (project pages only). */}
      <HeaderProgressBar headerProgress={headerProgress} />
    </header>
  );
}
