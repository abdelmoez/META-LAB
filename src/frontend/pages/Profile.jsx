/**
 * Profile.jsx — Account management page at /profile
 *
 * Layout: left sidebar (avatar, nav) + right content area.
 * Sections: account info, project stats, edit name, change password, danger zone.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api-client/apiClient.js';
import Icon from '../components/icons.jsx';
// Theme-aware tokens (prompt7) — C values are `var(--t-*)` strings; use
// alpha(C.x, '40') instead of hex+alpha concatenation.
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import BrandWordmark from '../components/BrandWordmark.jsx';
import { DEFAULT_SCREENING_SHORTCUTS, parseScreeningShortcuts, keyLabel } from '../screening/screeningShortcuts.js';
import InstitutionAutocomplete from '../components/InstitutionAutocomplete.jsx';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
  } catch { return iso; }
}

// Date + time, with an honest "Not available" fallback (prompt12 Task 3 — Last active).
function fmtDateTime(iso) {
  if (!iso) return 'Not available';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not available';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(d);
  } catch { return iso; }
}

function initials(user) {
  if (user?.name) return user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (user?.email?.[0] ?? '?').toUpperCase();
}

const inpStyle = {
  width:        '100%',
  background:   C.bg,
  border:       `1px solid ${C.brd2}`,
  borderRadius: 7,
  padding:      '9px 13px',
  color:        C.txt,
  fontFamily:   FONT,
  fontSize:     13,
  outline:      'none',
  boxSizing:    'border-box',
  transition:   'border-color 0.15s, box-shadow 0.15s',
};

function SectionCard({ title, children }) {
  return (
    <div style={{
      background:   C.card,
      border:       `1px solid ${C.brd}`,
      borderRadius: 10,
      overflow:     'hidden',
      marginBottom: 20,
    }}>
      <div style={{
        padding:       '12px 20px',
        borderBottom:  `1px solid ${C.brd}`,
        fontSize:      11,
        fontFamily:    MONO,
        fontWeight:    700,
        color:         C.muted,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        {title}
      </div>
      <div style={{ padding: '20px' }}>
        {children}
      </div>
    </div>
  );
}

function PrimaryBtn({ onClick, disabled, children, style = {} }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding:      '9px 20px',
        background:   `linear-gradient(135deg, ${C.acc}, ${C.acc2})`,
        border:       'none',
        borderRadius: 7,
        color:        C.accText,
        fontSize:     13,
        fontWeight:   600,
        cursor:       disabled ? 'not-allowed' : 'pointer',
        fontFamily:   FONT,
        opacity:      disabled ? 0.5 : 1,
        transition:   'filter 0.15s, opacity 0.15s',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

const NAV_ITEMS = [
  { id: 'account',     label: 'Account Info' },
  { id: 'name',        label: 'Edit Name' },
  { id: 'institution', label: 'Institution' },
  { id: 'shortcuts',   label: 'Screening Shortcuts' },
  { id: 'password',    label: 'Change Password' },
  { id: 'danger',      label: 'Danger Zone' },
];

// prompt35 — derive the InstitutionAutocomplete value from the saved profile.
function institutionValueFromUser(u) {
  if (!u) return null;
  if (u.institutionRorId || u.institutionCanonicalName) {
    return {
      name: u.institutionOriginal || u.institutionCanonicalName,
      canonicalName: u.institutionCanonicalName || u.institutionOriginal,
      rorId: u.institutionRorId || undefined,
      city: u.institutionCity || undefined,
      countryName: u.institutionCountryName || undefined,
      countryCode: u.institutionCountryCode || undefined,
      source: u.institutionSource || (u.institutionRorId ? 'ror' : 'local'),
    };
  }
  return u.institutionOriginal || null; // custom string (or null)
}

// prompt35 — self-service Institution editor (mirrors ScreeningShortcutsSection):
// loads the profile, edits institution (autocomplete, canonical ROR/local or
// custom) + the user-stated country, and saves via api.profile.update.
function InstitutionSection() {
  const [value, setValue]   = useState(null);
  const [country, setCountry] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // null | 'saved' | 'error'
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    api.profile.get()
      .then(r => {
        const u = r?.user;
        setValue(institutionValueFromUser(u));
        setCountry(u?.country || '');
        setNeedsReview(!!u?.institutionNeedsReview);
      })
      .catch(() => { /* keep empty */ })
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true); setStatus(null); setErrMsg('');
    try {
      const r = await api.profile.update({ institution: value ?? null, country: country.trim() || null });
      setNeedsReview(!!r?.user?.institutionNeedsReview);
      // Reflect any server-side canonical linkage back into the field.
      setValue(institutionValueFromUser(r?.user));
      setStatus('saved');
    } catch (err) {
      setStatus('error'); setErrMsg(err.message || 'Failed to save institution.');
    } finally { setSaving(false); }
  }

  return (
    <SectionCard title="Institution & organization">
      <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 16 }}>
        Add your institution or organization so it appears on your profile and in
        team analytics. Start typing to find a verified institution, or keep your
        own typed name. This is optional.
      </div>

      <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        Institution / organization
      </label>
      <InstitutionAutocomplete value={value} onChange={setValue} disabled={!loaded} />

      {needsReview && (
        <div style={{ fontSize: 11.5, color: C.gold || C.yel, marginTop: 8 }}>
          Your institution looks similar to an existing one — an administrator will review it. Your typed name is kept.
        </div>
      )}

      <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '18px 0 8px' }}>
        Country / region (optional)
      </label>
      <input
        type="text"
        value={country}
        onChange={e => { setCountry(e.target.value); setStatus(null); }}
        placeholder="e.g. United States"
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 9, color: C.txt, fontSize: 14, fontFamily: FONT, outline: 'none' }}
      />

      {status === 'saved' && <div style={{ fontSize: 12, color: C.grn, marginTop: 10 }}>Institution updated.</div>}
      {status === 'error' && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{errMsg}</div>}

      <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <PrimaryBtn onClick={save} disabled={saving || !loaded}>
          {saving ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save institution'}
        </PrimaryBtn>
      </div>
    </SectionCard>
  );
}

// prompt25 Task 7 — per-user Screening keyboard-shortcut editor. Loads from
// /api/profile, captures a key per action (with duplicate-key validation), and
// saves the { enabled, keys } blob back. Mirrors the dashboard-prefs pattern.
const SHORTCUT_ACTIONS = [
  { key: 'next',     label: 'Next article' },
  { key: 'previous', label: 'Previous article' },
  { key: 'include',  label: 'Include' },
  { key: 'exclude',  label: 'Exclude' },
  { key: 'maybe',    label: 'Maybe' },
  { key: 'undo',     label: 'Undo' },
];

// Normalise a captured KeyboardEvent.key: keep Arrow*/Enter etc. verbatim, lower
// single letters. Ignore pure modifiers.
function normalizeCaptured(e) {
  const k = e.key;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return null;
  if (k.length === 1) return k.toLowerCase();
  return k;
}

function ScreeningShortcutsSection() {
  const [prefs, setPrefs]       = useState(() => parseScreeningShortcuts(null));
  const [loaded, setLoaded]     = useState(false);
  const [capturing, setCapturing] = useState(null); // action key being rebound
  const [saving, setSaving]     = useState(false);
  const [status, setStatus]     = useState(null);   // null | 'saved' | 'error'
  const [errMsg, setErrMsg]     = useState('');

  useEffect(() => {
    api.profile.get()
      .then(r => setPrefs(parseScreeningShortcuts(r?.user?.screeningShortcuts ?? null)))
      .catch(() => { /* keep defaults */ })
      .finally(() => setLoaded(true));
  }, []);

  // Capture the next keypress for the action being rebound.
  useEffect(() => {
    if (!capturing) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { setCapturing(null); return; }
      const k = normalizeCaptured(e);
      if (!k) return;
      setPrefs(p => ({ ...p, keys: { ...p.keys, [capturing]: k } }));
      setStatus(null);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  // Duplicate-key detection (case-insensitive). Returns the set of action keys
  // that collide with another action.
  const dupActions = (() => {
    const byKey = {};
    for (const a of SHORTCUT_ACTIONS) {
      const v = String(prefs.keys[a.key] || '').toLowerCase();
      (byKey[v] ||= []).push(a.key);
    }
    const dups = new Set();
    for (const v of Object.keys(byKey)) if (byKey[v].length > 1) byKey[v].forEach(x => dups.add(x));
    return dups;
  })();
  const hasDup = dupActions.size > 0;

  async function save() {
    if (saving || hasDup) return;
    setSaving(true); setStatus(null); setErrMsg('');
    try {
      await api.profile.update({ screeningShortcuts: { enabled: prefs.enabled, keys: prefs.keys } });
      setStatus('saved');
    } catch (err) {
      setStatus('error'); setErrMsg(err.message || 'Failed to save shortcuts.');
    } finally { setSaving(false); }
  }
  function resetDefaults() {
    setPrefs({ enabled: DEFAULT_SCREENING_SHORTCUTS.enabled, keys: { ...DEFAULT_SCREENING_SHORTCUTS.keys } });
    setStatus(null);
  }

  return (
    <SectionCard title="Screening Shortcuts">
      <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 16 }}>
        Review articles faster with the keyboard. Shortcuts are per-account and never fire while
        you're typing in a note, search, or any text field.
      </div>

      {/* Enable toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={e => { setPrefs(p => ({ ...p, enabled: e.target.checked })); setStatus(null); }}
          style={{ width: 16, height: 16, accentColor: C.acc }}
        />
        <span style={{ fontSize: 13, color: C.txt }}>Enable Screening keyboard shortcuts</span>
      </label>

      {/* Key rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: prefs.enabled ? 1 : 0.5, pointerEvents: prefs.enabled ? 'auto' : 'none' }}>
        {SHORTCUT_ACTIONS.map(a => {
          const isDup = dupActions.has(a.key);
          const isCapturing = capturing === a.key;
          return (
            <div key={a.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '9px 12px', borderRadius: 7, background: C.surf,
              border: `1px solid ${isDup ? C.red : C.brd}`,
            }}>
              <span style={{ fontSize: 13, color: C.txt }}>{a.label}</span>
              <button
                onClick={() => setCapturing(isCapturing ? null : a.key)}
                style={{
                  minWidth: 92, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: MONO,
                  fontSize: 12, fontWeight: 700,
                  background: isCapturing ? alpha(C.acc, '20') : C.bg,
                  border: `1px solid ${isCapturing ? C.acc : (isDup ? C.red : C.brd2)}`,
                  color: isCapturing ? C.acc : (isDup ? C.red : C.txt),
                }}
              >
                {isCapturing ? 'Press a key…' : keyLabel(prefs.keys[a.key])}
              </button>
            </div>
          );
        })}
      </div>

      {hasDup && (
        <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>
          ⚠ The same key is assigned to more than one action. Give each action a unique key before saving.
        </div>
      )}
      {status === 'saved' && <div style={{ fontSize: 12, color: C.grn, marginTop: 12 }}>Shortcuts saved.</div>}
      {status === 'error' && <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>{errMsg}</div>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={resetDefaults}
          style={{ padding: '9px 16px', background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, fontFamily: FONT, cursor: 'pointer' }}
        >
          Reset to defaults
        </button>
        <PrimaryBtn onClick={save} disabled={saving || hasDup || !loaded}>
          {saving ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save shortcuts'}
        </PrimaryBtn>
      </div>
    </SectionCard>
  );
}

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [activeSection, setActiveSection] = useState('account');
  const [projects,      setProjects]      = useState([]);
  const [projLoading,   setProjLoading]   = useState(true);

  // Edit name state
  const [newName,    setNewName]    = useState(user?.name || '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameStatus, setNameStatus] = useState(null); // null | 'saved' | 'error'
  const [nameErr,    setNameErr]    = useState('');

  // Change password state
  const [pwForm,    setPwForm]    = useState({ current: '', next: '', confirm: '' });
  const [pwSaving,  setPwSaving]  = useState(false);
  const [pwStatus,  setPwStatus]  = useState(null); // null | 'saved' | 'error'
  const [pwErr,     setPwErr]     = useState('');

  useEffect(() => {
    api.projects.list()
      .then(list => { setProjects(list); setProjLoading(false); })
      .catch(() => setProjLoading(false));
  }, []);

  // Sync name field when user updates
  useEffect(() => {
    if (user?.name) setNewName(user.name);
  }, [user?.name]);

  async function handleSaveName(e) {
    e.preventDefault();
    if (!newName.trim() || nameSaving) return;
    setNameSaving(true);
    setNameStatus(null);
    setNameErr('');
    try {
      await api.profile.update({ name: newName.trim() });
      await refreshUser();
      setNameStatus('saved');
    } catch (err) {
      setNameStatus('error');
      setNameErr(err.message || 'Failed to update name.');
    } finally {
      setNameSaving(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwSaving) return;
    setPwStatus(null);
    setPwErr('');

    if (pwForm.next.length < 8) {
      setPwStatus('error');
      setPwErr('New password must be at least 8 characters.');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwStatus('error');
      setPwErr('New password and confirmation do not match.');
      return;
    }

    setPwSaving(true);
    try {
      await api.profile.changePassword({
        currentPassword: pwForm.current,
        newPassword:     pwForm.next,
      });
      setPwStatus('saved');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwStatus('error');
      setPwErr(err.message || 'Failed to change password.');
    } finally {
      setPwSaving(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  const avatarBg = alpha(C.acc, '20');

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @media (max-width: 768px) {
          .profile-layout { flex-direction: column !important; }
          .profile-sidebar { width: 100% !important; position: static !important; border-right: none !important; border-bottom: 1px solid ${C.brd} !important; flex-direction: row !important; align-items: center !important; padding: 16px 20px !important; gap: 16px !important; }
          .profile-sidebar-nav { flex-direction: row !important; flex-wrap: wrap !important; gap: 4px !important; }
          .profile-avatar-block { flex-direction: row !important; align-items: center !important; gap: 12px !important; text-align: left !important; }
          .profile-content { padding: 24px 20px !important; }
        }
        .profile-nav-item:hover { background: ${C.card} !important; color: ${C.txt} !important; }
        .profile-input:focus { border-color: ${C.acc} !important; box-shadow: 0 0 0 3px ${alpha(C.acc, '18')} !important; }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'space-between',
        padding:      '0 32px',
        height:       52,
        borderBottom: `1px solid ${C.brd}`,
        background:   alpha(C.bg, 'f0'),
        position:     'sticky',
        top:          0,
        zIndex:       50,
      }}>
        <button
          onClick={() => navigate('/app')}
          style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 13, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
        >
          ← Back to workspace
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}>
          <span style={{ display: 'inline-flex', color: C.acc }}><Icon name="hexagon" size={16} /></span>
          <BrandWordmark size={13} weight={700} letterSpacing="0.07em" />
        </div>
      </div>

      {/* ── Layout ───────────────────────────────────────────────────── */}
      <div className="profile-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 52px)' }}>

        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <aside className="profile-sidebar" style={{
          width:       260,
          background:  C.surf,
          borderRight: `1px solid ${C.brd}`,
          padding:     '32px 20px',
          display:     'flex',
          flexDirection: 'column',
          gap:         28,
          flexShrink:  0,
          position:    'sticky',
          top:         52,
          height:      'calc(100vh - 52px)',
          overflowY:   'auto',
        }}>
          {/* Avatar + name block */}
          <div className="profile-avatar-block" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{
              width:        60,
              height:       60,
              borderRadius: '50%',
              background:   avatarBg,
              border:       `2px solid ${alpha(C.acc, '40')}`,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     22,
              fontWeight:   700,
              color:        C.acc,
              letterSpacing: '0.05em',
              flexShrink:   0,
            }}>
              {initials(user)}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 3 }}>
                {user?.name || 'Your Account'}
              </div>
              <div style={{ fontSize: 11, color: C.muted, wordBreak: 'break-all' }}>
                {user?.email}
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="profile-sidebar-nav" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className="profile-nav-item"
                onClick={() => {
                  setActiveSection(item.id);
                  document.getElementById(`section-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                style={{
                  background:   activeSection === item.id ? C.card : 'transparent',
                  border:       'none',
                  borderRadius: 7,
                  padding:      '8px 12px',
                  textAlign:    'left',
                  fontSize:     13,
                  color:        activeSection === item.id ? C.txt : C.txt2,
                  cursor:       'pointer',
                  fontFamily:   FONT,
                  fontWeight:   activeSection === item.id ? 600 : 400,
                  transition:   'background 0.15s, color 0.15s',
                }}
              >
                {item.id === 'danger' ? (
                  <span style={{ color: activeSection === item.id ? C.red : C.muted }}>{item.label}</span>
                ) : item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Main content ────────────────────────────────────────────── */}
        <main className="profile-content" style={{ flex: 1, padding: '32px 40px', maxWidth: 680 }}>

          {/* ── Account Info ────────────────────────────────────────── */}
          <div id="section-account">
            <SectionCard title="Account Info">
              {/* Project stat */}
              <div style={{
                display:      'flex',
                gap:          16,
                marginBottom: 20,
              }}>
                <div style={{
                  flex:         1,
                  background:   C.surf,
                  border:       `1px solid ${C.brd}`,
                  borderRadius: 8,
                  padding:      '14px 18px',
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: C.acc, fontFamily: MONO, letterSpacing: '-1px' }}>
                    {projLoading ? '—' : projects.length}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                    {projects.length === 1 ? 'project' : 'projects'}
                  </div>
                </div>
                <div style={{
                  flex:         1,
                  background:   C.surf,
                  border:       `1px solid ${C.brd}`,
                  borderRadius: 8,
                  padding:      '14px 18px',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 3 }}>
                    Member since
                  </div>
                  <div style={{ fontSize: 12, color: C.txt2 }}>
                    {fmtDate(user?.createdAt)}
                  </div>
                </div>
              </div>

              {/* Info rows */}
              <div>
                {[
                  ['Display name', user?.name || '—'],
                  ['Email address', user?.email || '—'],
                  ['Last active', fmtDateTime(user?.lastActive)],
                ].map(([label, value]) => (
                  <div key={label} style={{
                    display:      'flex',
                    justifyContent: 'space-between',
                    alignItems:   'center',
                    padding:      '11px 0',
                    borderBottom: `1px solid ${C.brd}`,
                  }}>
                    <span style={{ fontSize: 12, color: C.txt2 }}>{label}</span>
                    <span style={{ fontSize: 12, color: C.txt, fontFamily: label === 'Email address' ? MONO : FONT }}>{value}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* ── Edit Name ──────────────────────────────────────────── */}
          <div id="section-name">
            <SectionCard title="Edit Name">
              <form onSubmit={handleSaveName}>
                <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Display name
                </label>
                <input
                  className="profile-input"
                  type="text"
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setNameStatus(null); }}
                  placeholder="Your full name"
                  style={inpStyle}
                />

                {nameStatus === 'saved' && (
                  <div style={{ fontSize: 12, color: C.grn, marginTop: 8 }}>Name updated successfully.</div>
                )}
                {nameStatus === 'error' && (
                  <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{nameErr}</div>
                )}

                <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <PrimaryBtn
                    disabled={!newName.trim() || nameSaving || newName.trim() === user?.name}
                  >
                    {nameSaving ? 'Saving…' : nameStatus === 'saved' ? 'Saved ✓' : 'Save name'}
                  </PrimaryBtn>
                </div>
              </form>
            </SectionCard>
          </div>

          {/* ── Institution & organization (prompt35) ────────────────── */}
          <div id="section-institution">
            <InstitutionSection />
          </div>

          {/* ── Screening Shortcuts (prompt25 Task 7) ────────────────── */}
          <div id="section-shortcuts">
            <ScreeningShortcutsSection />
          </div>

          {/* ── Change Password ──────────────────────────────────────── */}
          <div id="section-password">
            <SectionCard title="Change Password">
              <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { key: 'current', label: 'Current password', placeholder: 'Enter current password' },
                  { key: 'next',    label: 'New password',     placeholder: 'At least 8 characters' },
                  { key: 'confirm', label: 'Confirm new password', placeholder: 'Repeat new password' },
                ].map(field => (
                  <div key={field.key}>
                    <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                      {field.label}
                    </label>
                    <input
                      className="profile-input"
                      type="password"
                      required
                      value={pwForm[field.key]}
                      onChange={e => { setPwForm(f => ({ ...f, [field.key]: e.target.value })); setPwStatus(null); }}
                      placeholder={field.placeholder}
                      style={inpStyle}
                    />
                  </div>
                ))}

                {pwStatus === 'saved' && (
                  <div style={{ fontSize: 12, color: C.grn, padding: '8px 12px', background: C.grnBg, border: `1px solid ${alpha(C.grn, '30')}`, borderRadius: 6 }}>
                    Password changed successfully.
                  </div>
                )}
                {pwStatus === 'error' && (
                  <div style={{ fontSize: 12, color: C.red, padding: '8px 12px', background: C.redBg, border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 6 }}>
                    {pwErr}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <PrimaryBtn disabled={!pwForm.current || !pwForm.next || !pwForm.confirm || pwSaving}>
                    {pwSaving ? 'Changing…' : 'Change password'}
                  </PrimaryBtn>
                </div>
              </form>
            </SectionCard>
          </div>

          {/* ── Danger Zone ─────────────────────────────────────────── */}
          <div id="section-danger">
            <div style={{
              background:   C.card,
              border:       `1px solid ${alpha(C.red, '30')}`,
              borderRadius: 10,
              overflow:     'hidden',
              marginBottom: 20,
            }}>
              <div style={{
                padding:       '12px 20px',
                borderBottom:  `1px solid ${alpha(C.red, '20')}`,
                fontSize:      11,
                fontFamily:    MONO,
                fontWeight:    700,
                color:         alpha(C.red, '88'),
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                Danger Zone
              </div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 3 }}>Sign out</div>
                    <div style={{ fontSize: 11, color: C.muted }}>End your current session on this device.</div>
                  </div>
                  <button
                    onClick={handleLogout}
                    style={{
                      padding:      '8px 18px',
                      background:   'transparent',
                      border:       `1px solid ${alpha(C.red, '44')}`,
                      borderRadius: 7,
                      color:        C.red,
                      fontSize:     13,
                      cursor:       'pointer',
                      fontFamily:   FONT,
                      fontWeight:   500,
                      transition:   'background 0.15s, border-color 0.15s',
                      whiteSpace:   'nowrap',
                    }}
                    onMouseEnter={e => { e.target.style.background = alpha(C.red, '12'); e.target.style.borderColor = alpha(C.red, '80'); }}
                    onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = alpha(C.red, '44'); }}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
