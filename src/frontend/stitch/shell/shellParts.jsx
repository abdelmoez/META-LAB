/**
 * shellParts.jsx — the persistent Stitch chrome pieces.
 *
 *   StitchPrimaryRail   — 72px deep-purple rail of top-level app areas (theme-
 *                          independent brand anchor).
 *   StitchContextRail   — 280px contextual rail (project list / phases / etc.).
 *   StitchTopHeader      — slim utility bar hosting the admin design switch,
 *                          theme toggle, notifications and the account menu.
 *   StitchAccountMenu    — avatar dropdown (profile, theme, return-to-classic,
 *                          sign out).
 *
 * Navigation routes are the SAME app routes the legacy UI uses — only the
 * presentation differs (design.md §ROUTING: "The UI mode affects presentation,
 * not resource identity").
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../theme/ThemeContext.jsx';
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../theme/stitchTokens.js';
import { StitchAvatar, StitchIconButton, StitchBadge } from '../primitives/core.jsx';
import AdminDesignSwitch from '../../design/AdminDesignSwitch.jsx';

// Fixed deep-purple rail palette (brand anchor — does NOT flip with day/night).
const RAIL_BG = '#4f4391';
const RAIL_ACTIVE = '#7669b6';
const RAIL_INDICATOR = '#7edb7b';

export const PRIMARY_NAV = [
  { key: 'dashboard', label: 'Dashboard',    icon: 'grid',        to: '/app',       match: ['/app'] },
  { key: 'screening', label: 'Screening',    icon: 'checkSquare', to: '/sift-beta', match: ['/sift-beta'] },
  { key: 'rob',       label: 'Risk of Bias', icon: 'scale',       to: '/rob',       match: ['/rob'] },
];
const ADMIN_NAV = { key: 'ops', label: 'Ops Console', icon: 'shield', to: '/ops', match: ['/ops'] };

function isActive(pathname, item) {
  return (item.match || [item.to]).some((m) => pathname === m || pathname.startsWith(m + '/'));
}

/* ─── Primary rail ────────────────────────────────────────────────────────── */
export function StitchPrimaryRail({ activeKey }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const items = [...PRIMARY_NAV];
  if (user?.role === 'admin' || user?.role === 'mod') items.push(ADMIN_NAV);

  const RailLink = ({ item }) => {
    const active = activeKey ? activeKey === item.key : isActive(location.pathname, item);
    return (
      <button
        type="button"
        title={item.label}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        onClick={() => navigate(item.to)}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = salpha('#ffffff', 0.1); }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
        style={{
          position: 'relative', width: '100%', height: 48, display: 'flex', alignItems: 'center',
          justifyContent: 'center', border: 'none', cursor: 'pointer', borderRadius: 12,
          background: active ? salpha('#ffffff', 0.16) : 'transparent',
          color: '#fff', opacity: active ? 1 : 0.62, transition: 'background 0.15s ease, opacity 0.15s ease',
        }}
      >
        {active ? <span aria-hidden="true" style={{ position: 'absolute', left: -8, top: 12, bottom: 12, width: 3, borderRadius: 3, background: RAIL_INDICATOR }} /> : null}
        <Icon name={item.icon} size={22} />
      </button>
    );
  };

  return (
    <nav aria-label="Primary" style={{
      width: 72, flexShrink: 0, background: RAIL_BG, display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '20px 12px', gap: 6, height: '100%',
    }}>
      <button
        type="button" onClick={() => navigate('/app')} aria-label="PecanRev home"
        style={{ width: 40, height: 40, borderRadius: 12, background: '#fff', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: RAIL_BG, marginBottom: 14, flexShrink: 0 }}
      >
        <Icon name="hexagon" size={22} />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {items.map((item) => <RailLink key={item.key} item={item} />)}
      </div>
      <div style={{ marginTop: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" title="Profile" aria-label="Profile" onClick={() => navigate('/profile')}
          style={{ width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', borderRadius: 12, background: 'transparent', color: '#fff', opacity: 0.62 }}>
          <Icon name="user" size={20} />
        </button>
      </div>
    </nav>
  );
}

/* ─── Context rail ────────────────────────────────────────────────────────── */
export function StitchContextRail({ title, subtitle, action, children, footer }) {
  return (
    <aside aria-label={title || 'Context navigation'} className="stitch-scope" style={{
      width: 280, flexShrink: 0, background: S.card, borderRight: `1px solid ${salpha(S.outlineVariant, 0.5)}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {(title || action) ? (
        <div style={{ padding: '20px 18px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.45)}` }}>
          {title ? <h1 style={{ fontSize: 18, fontWeight: 700, color: S.textPrimary, margin: 0 }}>{title}</h1> : null}
          {subtitle ? <p style={{ fontSize: 12, color: S.textSecondary, margin: '3px 0 0' }}>{subtitle}</p> : null}
          {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
        </div>
      ) : null}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>{children}</div>
      {footer ? <div style={{ padding: 12, borderTop: `1px solid ${salpha(S.outlineVariant, 0.45)}` }}>{footer}</div> : null}
    </aside>
  );
}

/* ─── Account menu ────────────────────────────────────────────────────────── */
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

  const Item = ({ icon, label, onClick, danger }) => (
    <button type="button" role="menuitem" className="stitch-focusable" onClick={() => { setOpen(false); onClick?.(); }}
      onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', border: 'none',
        background: 'transparent', cursor: 'pointer', fontSize: 13.5, fontFamily: S.font, textAlign: 'left',
        color: danger ? S.danger : S.textPrimary, borderRadius: 8 }}>
      <Icon name={icon} size={16} />{label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="stitch-focusable" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', cursor: 'pointer', padding: 3, borderRadius: 9999 }}>
        <StitchAvatar name={name} size={32} />
      </button>
      {open ? (
        <div role="menu" className="stitch-scale-in" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, minWidth: 240, background: S.card,
          border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderRadius: 12, boxShadow: S.shadow2, padding: 8, zIndex: 100, fontFamily: S.font,
        }}>
          <div style={{ padding: '8px 12px 10px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.4)}`, marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name || 'Account'}</div>
            <div style={{ fontSize: 12, color: S.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            {user.role === 'admin' ? <div style={{ marginTop: 6 }}><StitchBadge tone="brand" icon="shield">Administrator</StitchBadge></div> : null}
          </div>
          <Item icon="user" label="Profile & settings" onClick={() => navigate('/profile')} />
          <Item icon={theme === 'night' ? 'sun' : 'moon'} label={theme === 'night' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme} />
          <div style={{ height: 1, background: salpha(S.outlineVariant, 0.4), margin: '6px 0' }} />
          <Item icon="logout" label="Sign out" danger onClick={async () => { await logout(); navigate('/login'); }} />
        </div>
      ) : null}
    </div>
  );
}

/* ─── Top utility header ──────────────────────────────────────────────────── */
export function StitchTopHeader({ onOpenNav, breadcrumb }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', minHeight: 56,
      borderBottom: `1px solid ${salpha(S.outlineVariant, 0.4)}`, background: salpha(S.surface, 0.85),
      backdropFilter: 'blur(6px)', position: 'sticky', top: 0, zIndex: 30,
    }}>
      <button type="button" aria-label="Open navigation" onClick={onOpenNav} className="stitch-focusable stitch-mobile-only"
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textSecondary, display: 'none', padding: 4 }}>
        <Icon name="menu" size={22} />
      </button>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: S.textSecondary, fontWeight: 600, overflow: 'hidden' }}>
        {breadcrumb}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <AdminDesignSwitch variant="inline" />
        <StitchIconButton icon={theme === 'night' ? 'sun' : 'moon'} label={theme === 'night' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme} />
        <StitchAccountMenu />
      </div>
    </header>
  );
}
