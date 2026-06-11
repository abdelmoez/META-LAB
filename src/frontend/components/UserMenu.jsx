/**
 * UserMenu.jsx — shared account dropdown for META·LAB and META·SIFT (prompt4 Task 1).
 *
 * One component, used in both apps so auth/menu logic isn't duplicated:
 *   - META·LAB (AppWorkspace): fixed top-right avatar.
 *   - META·SIFT (SiftProject / SiftDashboard headers): inline avatar.
 *
 * Items: user name/email · Account & Profile · cross-app link · theme toggle
 * (night/day, prompt7 Task 5) · Ops Console (admin OR mod) · app version
 * (from GET /api/version) · Sign out.
 *
 * Props:
 *   context  'metalab' | 'metasift'  — which cross-app link to show (default 'metalab')
 *   fixed    boolean                 — fixed top-right positioning (default false = inline)
 *   onBeforeLogout  async () => {}    — optional hook (e.g. flush autosave) before sign-out
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { Icon } from './icons.jsx';

let _versionCache = null; // module-level cache so the menu doesn't refetch per mount

export default function UserMenu({ context = 'metalab', fixed = false, onBeforeLogout }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(_versionCache);
  const ref = useRef(null);

  useEffect(() => {
    if (_versionCache) return;
    fetch('/api/version', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(v => { if (v) { _versionCache = v; setVersion(v); } })
      .catch(() => {});
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!user) return null;

  const isStaff = user.role === 'admin' || user.role === 'mod';
  const initials = user.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : (user.email?.[0] ?? '?').toUpperCase();

  async function handleLogout() {
    setOpen(false);
    try { if (onBeforeLogout) await onBeforeLogout(); } catch { /* best-effort */ }
    await logout();
    navigate('/');
  }

  const versionStr = version
    ? `v${version.version}${version.commit && version.commit !== 'dev' ? ' · ' + version.commit : ''}`
    : null;

  const wrapStyle = fixed
    ? { position: 'fixed', top: 12, right: 16, zIndex: 9999, fontFamily: FONT }
    : { position: 'relative', fontFamily: FONT };

  return (
    <div ref={ref} style={wrapStyle}>
      <button
        onClick={() => setOpen(o => !o)}
        title={user.email}
        style={{
          width: 30, height: 30, borderRadius: '50%',
          background: alpha(C.acc, open ? 0.19 : 0.09),
          border: `1px solid ${alpha(C.acc, open ? 0.38 : 0.19)}`,
          color: C.acc, fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          letterSpacing: '0.05em', userSelect: 'none',
        }}
      >{initials}</button>

      {open && (
        <div style={{
          position: 'absolute', top: 38, right: 0, background: C.card,
          border: `1px solid ${C.brd2}`, borderRadius: 10, padding: '4px 0',
          minWidth: 218, maxWidth: 300, boxShadow: `0 8px 32px ${C.shadow}`, zIndex: 9999,
        }}>
          <div style={{ padding: '10px 14px 9px', borderBottom: `1px solid ${C.brd}`, marginBottom: 4 }}>
            {user.name && <div title={user.name} style={{ fontSize: 12, fontWeight: 600, color: C.txt, marginBottom: 2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>}
            <div title={user.email} style={{ fontSize: 11, color: C.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            {user.role && user.role !== 'user' && (
              <div style={{ fontSize: 9, fontFamily: MONO, color: C.acc, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{user.role}</div>
            )}
          </div>

          <Item icon="user" label="Account & Profile" onClick={() => { setOpen(false); navigate('/profile'); }} />

          {context === 'metasift'
            ? <Item icon="flask" label="Open META·LAB" onClick={() => { setOpen(false); navigate('/app'); }} />
            : <Item icon="hexagon" label="Open META·SIFT" onClick={() => { setOpen(false); navigate('/sift-beta'); }} />}

          <Item
            icon={theme === 'night' ? 'sun' : 'moon'}
            label={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
            onClick={toggleTheme}
          />

          {isStaff && (
            <a href="/ops" style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 14px', fontSize: 11, color: C.acc, textDecoration: 'none',
              fontFamily: MONO, letterSpacing: '0.05em',
              borderTop: `1px solid ${C.brd}`, marginTop: 4,
            }}><Icon name="shield" size={13} style={{ color: C.muted }} /> {user.role === 'mod' ? 'Mod Console' : 'Ops Console'}</a>
          )}

          <Item icon="logout" label="Sign out" muted onClick={handleLogout} />

          {versionStr && (
            <div style={{ padding: '7px 14px 6px', borderTop: `1px solid ${C.brd}`, marginTop: 4, fontSize: 9.5, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em' }}>
              {versionStr}{version.buildDate ? ` · ${String(version.buildDate).slice(0, 10)}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Item({ icon, label, onClick, muted }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left',
        background: hover ? C.card2 : 'transparent', border: 'none', cursor: 'pointer',
        padding: '8px 14px', fontSize: 12, color: muted ? C.txt2 : C.txt,
        fontFamily: FONT,
      }}
    >
      <Icon name={icon} size={14} style={{ color: C.muted }} />
      {label}
    </button>
  );
}
