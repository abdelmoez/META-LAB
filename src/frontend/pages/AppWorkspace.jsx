/**
 * AppWorkspace.jsx
 *
 * Wraps the META·LAB monolith with:
 *  - A user menu fixed at top-right (fixes the sign-out button overlap with
 *    the sidebar Templates section that the old bottom-left overlay caused)
 *  - An autosave status indicator (bottom-right, non-interactive)
 *  - Navigation to /profile and back to / on sign-out
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { subscribeToSaveStatus } from '../storage/serverStorage.js';
import MetaLab from '../../../meta-lab-3-patched.jsx';

const C = {
  card:  '#141826',
  brd:   '#1f2640',
  brd2:  '#283050',
  acc:   '#818cf8',
  txt:   '#eaecf6',
  txt2:  '#9ba6c4',
  muted: '#536080',
  grn:   '#34d399',
  red:   '#f87171',
};

const SAVE_LABEL = { saving: 'Saving…', saved: 'Saved', failed: 'Save failed', idle: '' };
const SAVE_COLOR = { saving: C.muted, saved: C.grn, failed: C.red, idle: 'transparent' };

export default function AppWorkspace() {
  const { user, logout } = useAuth();
  const navigate          = useNavigate();
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [saveStatus,   setSaveStatus]   = useState('idle');

  // Subscribe to autosave events from serverStorage
  useEffect(() => subscribeToSaveStatus(setSaveStatus), []);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    navigate('/');
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? '?').toUpperCase();

  return (
    <>
      <MetaLab />

      {/* ── Backdrop — closes dropdown on outside click ─────────────── */}
      {menuOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9990 }}
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ── Autosave status (bottom-right, non-interactive) ─────────── */}
      <div
        style={{
          position:       'fixed',
          bottom:         14,
          right:          16,
          zIndex:         9999,
          fontSize:       11,
          color:          SAVE_COLOR[saveStatus],
          fontFamily:     "'IBM Plex Mono', monospace",
          letterSpacing:  '0.04em',
          pointerEvents:  'none',
          transition:     'color 0.3s, opacity 0.3s',
          opacity:        saveStatus === 'idle' ? 0 : 1,
        }}
      >
        {SAVE_LABEL[saveStatus]}
      </div>

      {/* ── User menu (top-right, above sidebar content) ─────────────── */}
      <div
        style={{
          position:   'fixed',
          top:        12,
          right:      16,
          zIndex:     9999,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
        {/* Avatar trigger button */}
        <button
          onClick={() => setMenuOpen(o => !o)}
          title={user?.email}
          style={{
            width:           30,
            height:          30,
            borderRadius:    '50%',
            background:      menuOpen ? `${C.acc}30` : `${C.acc}18`,
            border:          `1px solid ${menuOpen ? C.acc + '60' : C.acc + '30'}`,
            color:           C.acc,
            fontSize:        11,
            fontWeight:      700,
            cursor:          'pointer',
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            letterSpacing:   '0.05em',
            transition:      'background 0.15s, border-color 0.15s',
            userSelect:      'none',
          }}
        >
          {initials}
        </button>

        {/* Dropdown panel */}
        {menuOpen && (
          <div style={{
            position:   'absolute',
            top:        38,
            right:      0,
            background: C.card,
            border:     `1px solid ${C.brd2}`,
            borderRadius: 10,
            padding:    '4px 0',
            minWidth:   196,
            boxShadow:  '0 8px 32px rgba(0,0,0,0.5)',
            zIndex:     9999,
          }}>
            {/* User info */}
            <div style={{
              padding:       '10px 14px 9px',
              borderBottom:  `1px solid ${C.brd}`,
              marginBottom:  4,
            }}>
              {user?.name && (
                <div style={{ fontSize: 12, fontWeight: 600, color: C.txt, marginBottom: 2 }}>
                  {user.name}
                </div>
              )}
              <div style={{
                fontSize: 11, color: C.muted,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {user?.email}
              </div>
            </div>

            <MenuItem
              icon="⚙"
              label="Account & Profile"
              onClick={() => { setMenuOpen(false); navigate('/profile'); }}
            />
            <MenuItem
              icon="⎋"
              label="Sign out"
              muted
              onClick={handleLogout}
            />
          </div>
        )}
      </div>
    </>
  );
}

function MenuItem({ icon, label, muted, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width:       '100%',
        padding:     '7px 14px',
        background:  hover ? '#1a2033' : 'transparent',
        border:      'none',
        textAlign:   'left',
        color:       muted ? C.muted : C.txt2,
        fontSize:    12,
        cursor:      'pointer',
        fontFamily:  "'IBM Plex Sans', system-ui, sans-serif",
        display:     'flex',
        alignItems:  'center',
        gap:         8,
        transition:  'background 0.1s, color 0.1s',
      }}
    >
      <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </button>
  );
}
