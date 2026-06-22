/**
 * StitchProfile.jsx — the Stitch "Profile & settings" page (route /profile).
 *
 * Parallel presentation of the legacy src/frontend/pages/Profile.jsx. It reuses
 * the SAME data and logic — the api client (api.profile.get/update/
 * changePassword), useAuth() (refreshUser) and useTheme() — so there is no forked
 * business logic. Only the presentation (Stitch shell + cards) is new. Every
 * value shown is real (loaded from /api/profile + the live auth user); empty /
 * loading / error states are first-class; every control performs a real action.
 *
 * IMPORTANT — fidelity to the real backend (server/controllers/profileController):
 *   • PUT /api/profile accepts ONLY: name, themePreference, institution, country
 *     (+ menu/dashboard/shortcut prefs). It does NOT accept primaryRole /
 *     researchField / mainUseCase, so those are shown READ-ONLY here (set during
 *     onboarding / by an admin) — exactly as the legacy Profile page treats them.
 *     We never render a Save that the server would silently ignore.
 *   • A plain-text institution string is saved via api.profile.update({institution})
 *     (the service preserves the typed text), mirroring the accepted contract.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api-client/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../theme/ThemeContext.jsx';
import {
  PRIMARY_ROLE_OPTIONS, RESEARCH_FIELD_OPTIONS, MAIN_USE_CASE_OPTIONS,
} from '../../../shared/editableUserFields.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import {
  StitchPageHeader, StitchSectionHeader, StitchCard, StitchButton, StitchBadge,
  StitchAvatar, StitchField, StitchInput, StitchSelect, StitchSwitch, StitchIcon,
  StitchLoadingState, StitchErrorState, useStitchToast, S, salpha,
} from '../primitives';

/* ─── small date helpers (mirror legacy Profile.jsx fmtDate / fmtDateTime) ──── */
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
  } catch { return iso; }
}
function fmtDateTime(iso) {
  if (!iso) return 'Not available';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not available';
  try {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  } catch { return iso; }
}

const ROLE_LABEL = { admin: 'Administrator', mod: 'Moderator', user: 'Member' };
const ROLE_TONE = { admin: 'brand', mod: 'info', user: 'neutral' };

/* ─── a labelled read-only key/value row ───────────────────────────────────── */
function InfoRow({ label, value, mono = false, last = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      padding: '11px 0', borderBottom: last ? 'none' : `1px solid ${salpha(S.outlineVariant, 0.4)}`,
    }}>
      <span style={{ fontSize: 12.5, color: S.textSecondary }}>{label}</span>
      <span style={{ fontSize: 12.5, color: S.textPrimary, fontWeight: 600, fontFamily: mono ? 'ui-monospace, monospace' : S.font, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

export default function StitchProfile() {
  const navigate = useNavigate();
  const { user, logout, refreshUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const toast = useStitchToast();

  /* ── canonical profile (institution/country live here authoritatively) ── */
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');

  /* ── name editor ── */
  const [name, setName] = useState(user?.name || '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameErr, setNameErr] = useState('');

  /* ── research / org editor (institution + country are the editable ones) ── */
  const [institution, setInstitution] = useState('');
  const [country, setCountry] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgErr, setOrgErr] = useState('');

  /* ── change-password form (mirrors legacy validation) ── */
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwErr, setPwErr] = useState('');

  const loadProfile = useCallback(async () => {
    setProfileError('');
    try {
      const r = await api.profile.get();
      const u = r?.user || null;
      setProfile(u);
      setInstitution(u?.institutionOriginal || '');
      setCountry(u?.country || '');
    } catch {
      setProfileError('Could not load your profile.');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { if (user?.name) setName(user.name); }, [user?.name]);

  /* ── save display name → api.profile.update({name}) + refreshUser ── */
  const saveName = async (e) => {
    e?.preventDefault?.();
    const t = name.trim();
    if (!t) { setNameErr('Display name cannot be empty.'); return; }
    if (t.length > 120) { setNameErr('Name must be 120 characters or fewer.'); return; }
    if (nameSaving || t === (user?.name || '')) return;
    setNameSaving(true); setNameErr('');
    try {
      await api.profile.update({ name: t });
      await refreshUser();
      toast.toast('Name updated', { tone: 'success' });
    } catch (err) {
      setNameErr(err?.message || 'Failed to update name.');
    } finally {
      setNameSaving(false);
    }
  };

  /* ── save institution + country → api.profile.update({institution, country}) ── */
  const saveOrg = async (e) => {
    e?.preventDefault?.();
    if (orgSaving) return;
    setOrgSaving(true); setOrgErr('');
    try {
      const r = await api.profile.update({
        institution: institution.trim() || null,
        country: country.trim() || null,
      });
      const u = r?.user;
      if (u) {
        setProfile(u);
        setInstitution(u.institutionOriginal || '');
        setCountry(u.country || '');
      }
      toast.toast('Research profile updated', { tone: 'success' });
    } catch (err) {
      setOrgErr(err?.message || 'Failed to save your research profile.');
    } finally {
      setOrgSaving(false);
    }
  };

  /* ── change password → api.profile.changePassword (same rules as legacy) ── */
  const savePassword = async (e) => {
    e?.preventDefault?.();
    if (pwSaving) return;
    setPwErr('');
    if (!pw.current) { setPwErr('Enter your current password.'); return; }
    if (pw.next.length < 8) { setPwErr('New password must be at least 8 characters.'); return; }
    if (pw.next !== pw.confirm) { setPwErr('New password and confirmation do not match.'); return; }
    setPwSaving(true);
    try {
      await api.profile.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast.toast('Password changed', { tone: 'success' });
    } catch (err) {
      setPwErr(err?.message || 'Failed to change password.');
    } finally {
      setPwSaving(false);
    }
  };

  const handleLogout = async () => {
    try { await logout(); } finally { navigate('/'); }
  };

  const role = user?.role || 'user';
  const orgDirty = (institution.trim() || '') !== (profile?.institutionOriginal || '')
    || (country.trim() || '') !== (profile?.country || '');

  /* research-profile read-only values (set in onboarding / by an admin — the
     PUT /api/profile contract does not accept them, so we never fake an edit). */
  const rp = [
    { label: 'Primary role', value: profile?.primaryRole || user?.primaryRole, opts: PRIMARY_ROLE_OPTIONS },
    { label: 'Research field', value: profile?.researchField || user?.researchField, opts: RESEARCH_FIELD_OPTIONS },
    { label: 'Main use case', value: profile?.mainUseCase || user?.mainUseCase, opts: MAIN_USE_CASE_OPTIONS },
  ];

  return (
    <StitchAppShell activeKey="dashboard" breadcrumb="Profile & settings">
      <StitchPageHeader
        eyebrow="Account"
        title="Profile & settings"
        subtitle="Manage your account, appearance, research profile and security."
        actions={
          <StitchButton variant="neutral" icon="arrowLeft" onClick={() => navigate('/app')}>
            Back to workspace
          </StitchButton>
        }
      />

      {profileError ? (
        <div style={{ marginTop: 24 }}>
          <StitchErrorState title="Couldn't load your profile" desc={profileError} onRetry={() => { setProfileLoading(true); loadProfile(); }} />
        </div>
      ) : profileLoading ? (
        <div style={{ marginTop: 24 }}><StitchLoadingState label="Loading your profile…" /></div>
      ) : (
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(360px, 1.4fr)', gap: 24, alignItems: 'start' }} className="stitch-profile-grid">

          {/* ── Left column: identity + appearance + security ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Account */}
            <StitchCard>
              <StitchSectionHeader title="Account" desc="Your identity across PecanRev." />
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0 18px' }}>
                <StitchAvatar name={user?.name || user?.email} size={56} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: S.textPrimary, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.name || 'Your account'}
                  </div>
                  <div style={{ fontSize: 12, color: S.textMuted, wordBreak: 'break-all', marginTop: 2 }}>{user?.email}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <StitchBadge tone={ROLE_TONE[role] || 'neutral'} dot>{ROLE_LABEL[role] || role}</StitchBadge>
                    {user?.userNumber != null ? <StitchBadge tone="neutral">#{user.userNumber}</StitchBadge> : null}
                  </div>
                </div>
              </div>

              <form onSubmit={saveName} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <StitchField label="Display name" htmlFor="pf-name" required error={nameErr || undefined}
                  help="This is the name teammates see across projects and chat.">
                  <StitchInput id="pf-name" icon="user" value={name} maxLength={120}
                    onChange={(e) => { setName(e.target.value); setNameErr(''); }}
                    invalid={!!nameErr} placeholder="Your full name" />
                </StitchField>
                <StitchField label="Email address" htmlFor="pf-email" help="Your sign-in email can't be changed here. Contact an administrator to update it.">
                  <StitchInput id="pf-email" icon="mail" value={user?.email || ''} readOnly disabled
                    style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.8 }} />
                </StitchField>
                <div style={{ borderTop: `1px solid ${salpha(S.outlineVariant, 0.4)}`, paddingTop: 14 }}>
                  <InfoRow label="Member since" value={fmtDate(user?.createdAt)} />
                  <InfoRow label="Last active" value={fmtDateTime(user?.lastActive)} last />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <StitchButton type="submit" icon="checkSquare" loading={nameSaving}
                    disabled={!name.trim() || name.trim() === (user?.name || '')}>
                    Save name
                  </StitchButton>
                </div>
              </form>
            </StitchCard>

            {/* Appearance */}
            <StitchCard>
              <StitchSectionHeader title="Appearance" desc="Switch between a light and dark interface." />
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                padding: '12px 14px', borderRadius: S.radiusControl, background: S.surfaceLow,
                border: `1px solid ${salpha(S.outlineVariant, 0.4)}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 38, height: 38, borderRadius: 10, background: S.brandSoft, color: S.onBrandSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <StitchIcon name={theme === 'night' ? 'moon' : 'sun'} size={18} />
                  </span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: S.textPrimary }}>
                      {theme === 'night' ? 'Night (dark)' : 'Day (light)'}
                    </div>
                    <div style={{ fontSize: 12, color: S.textMuted }}>Your choice is saved to your account.</div>
                  </div>
                </div>
                <StitchSwitch checked={theme === 'night'} onChange={toggleTheme}
                  label={theme === 'night' ? 'Dark' : 'Light'} />
              </div>
            </StitchCard>

            {/* Security */}
            <StitchCard>
              <StitchSectionHeader title="Security" desc="Change your password." />
              <form onSubmit={savePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <StitchField label="Current password" htmlFor="pf-pw-cur" required>
                  <StitchInput id="pf-pw-cur" type="password" icon="lock" autoComplete="current-password"
                    value={pw.current} onChange={(e) => { setPw((p) => ({ ...p, current: e.target.value })); setPwErr(''); }}
                    placeholder="Enter current password" />
                </StitchField>
                <StitchField label="New password" htmlFor="pf-pw-new" required help="At least 8 characters.">
                  <StitchInput id="pf-pw-new" type="password" icon="lock" autoComplete="new-password"
                    value={pw.next} onChange={(e) => { setPw((p) => ({ ...p, next: e.target.value })); setPwErr(''); }}
                    placeholder="At least 8 characters" />
                </StitchField>
                <StitchField label="Confirm new password" htmlFor="pf-pw-conf" required error={pwErr || undefined}>
                  <StitchInput id="pf-pw-conf" type="password" icon="lock" autoComplete="new-password"
                    invalid={!!pwErr}
                    value={pw.confirm} onChange={(e) => { setPw((p) => ({ ...p, confirm: e.target.value })); setPwErr(''); }}
                    placeholder="Repeat new password" />
                </StitchField>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <StitchButton type="submit" icon="shieldCheck" loading={pwSaving}
                    disabled={!pw.current || !pw.next || !pw.confirm}>
                    Change password
                  </StitchButton>
                </div>
              </form>
            </StitchCard>
          </div>

          {/* ── Right column: research profile + sign out ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Research profile (institution + country editable; the rest read-only) */}
            <StitchCard>
              <StitchSectionHeader
                title="Research profile"
                desc="Your institution and region appear in team analytics. This is optional."
              />
              <form onSubmit={saveOrg} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <StitchField label="Institution / organization" htmlFor="pf-inst"
                  help="The university or organization you belong to.">
                  <StitchInput id="pf-inst" icon="globe" value={institution} maxLength={200}
                    onChange={(e) => { setInstitution(e.target.value); setOrgErr(''); }}
                    placeholder="e.g. University of Oxford" />
                </StitchField>
                <StitchField label="Country / region" htmlFor="pf-country" error={orgErr || undefined}
                  help="The country or region you stated when you joined.">
                  <StitchInput id="pf-country" icon="globe" value={country} maxLength={120}
                    invalid={!!orgErr}
                    onChange={(e) => { setCountry(e.target.value); setOrgErr(''); }}
                    placeholder="e.g. United Kingdom" />
                </StitchField>

                {profile?.institutionNeedsReview ? (
                  <div style={{ fontSize: 12, color: S.warn, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StitchIcon name="alertTriangle" size={14} />
                    Your institution looks similar to an existing one — an administrator will review it. Your typed name is kept.
                  </div>
                ) : null}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <StitchButton type="submit" icon="checkSquare" loading={orgSaving} disabled={!orgDirty}>
                    Save research profile
                  </StitchButton>
                </div>
              </form>

              {/* Onboarding-managed fields — read-only (PUT /api/profile ignores them) */}
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${salpha(S.outlineVariant, 0.4)}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.textMuted, marginBottom: 4 }}>
                  Profile details
                </div>
                <div style={{ fontSize: 12, color: S.textMuted, marginBottom: 10 }}>
                  Set when you joined. Contact an administrator to change these.
                </div>
                {rp.map((f, i) => (
                  <InfoRow key={f.label} label={f.label}
                    value={f.value || <span style={{ color: S.textMuted, fontWeight: 500 }}>Not set</span>}
                    last={i === rp.length - 1} />
                ))}
              </div>
            </StitchCard>

            {/* Sign out */}
            <StitchCard style={{ borderColor: salpha(S.danger, 0.4) }}>
              <StitchSectionHeader title="Session" desc="End your session on this device." />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: S.textPrimary }}>Sign out</div>
                  <div style={{ fontSize: 12, color: S.textMuted, marginTop: 2 }}>You'll need to sign in again to return.</div>
                </div>
                <StitchButton variant="danger" icon="logout" onClick={handleLogout}>Sign out</StitchButton>
              </div>
            </StitchCard>
          </div>
        </div>
      )}

      <style>{`@media (max-width: 900px){ html[data-ui-design="stitch"] .stitch-profile-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </StitchAppShell>
  );
}
