/**
 * users/UserDrawer.jsx — 95.md Phase 5/6 — the user detail experience, as a
 * right-side drawer (WaitlistDrawer focus-trap pattern) because the five new
 * sections outgrow the old 300px side panel. Every capability of the previous
 * UserDetailPanel is preserved — full-record refetch, schema-driven profile
 * edit, role change + confirm, suspend/reactivate + confirm (error now surfaced,
 * not swallowed), token password-reset with copy-link fallback, projects, live
 * activity snapshot, mod lockout — reorganised into Overview / Authentication &
 * security / Access / Activity / Notes, with tier change, resend verification,
 * revoke sessions, an activity timeline, and internal notes added.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import { editableFieldsForRole } from '../../../../shared/editableUserFields.js';
import { countryNameForCode } from '../../../../shared/countries.js';
import { deriveAuthMethods, authMethodLabel } from '../../../../shared/adminUsers.js';
import { Avatar, Spinner, CopyText, ConfirmDialog, useFocusTrap, inputStyle, selectStyle, ghostBtn } from './primitives.jsx';
import { StatusBadge, RoleBadge, TierBadge, AuthBadge, regMethodLabel } from './badges.jsx';
import { LivePulseDot } from './misc.jsx';
import { fmtDate, fmtDateTime, fmtAgo } from './fmt.js';

/* ── layout helpers ─────────────────────────────────────────────────────── */
function Section({ title, children, action }) {
  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}
function KV({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: `1px solid ${C.brd}`, alignItems: 'center' }}>
      <div style={{ width: 130, flexShrink: 0, fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.txt, textAlign: 'right', wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}
const YesNo = ({ yes }) => <span style={{ color: yes ? C.grn : C.muted, fontWeight: 600 }}>{yes ? 'Yes' : 'No'}</span>;

const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: C.acc2, border: 'none', borderRadius: 7, color: C.accText, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const softBtn = (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px', background: alpha(color, '12'), border: `1px solid ${alpha(color, '35')}`, borderRadius: 7, color, fontSize: 12, cursor: 'pointer', fontFamily: FONT, fontWeight: 600 });

/* Copy-link fallback box (email unconfigured / send failed). */
function LinkBox({ label, link }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* noop */ } };
  return (
    <div style={{ marginTop: 8 }}>
      {label && <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, fontFamily: MONO, fontSize: 11.5, color: C.txt, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7, padding: '8px 10px', wordBreak: 'break-all' }}>{link}</code>
        <button type="button" onClick={copy} style={{ ...primaryBtn, flexShrink: 0, padding: '8px 12px' }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>Dev/fallback only — share over a trusted channel. Single-use; the user sets their own password.</div>
    </div>
  );
}

export default function UserDrawer({ userId, initialUser, isAdmin, viewer, tiers = [], tierNameOf, onClose, onChanged }) {
  const panelRef = useRef(null);
  // While a nested confirm dialog is open, Escape should dismiss only that dialog
  // (which has its own focus trap) — not the whole drawer underneath it.
  const modalOpenRef = useRef(false);
  const closeDrawer = useCallback(() => { if (!modalOpenRef.current) onClose(); }, [onClose]);
  useFocusTrap(panelRef, closeDrawer);

  const [u, setU] = useState(initialUser || null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState(null);
  const [activity, setActivity] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [tlLimit, setTlLimit] = useState(15);
  const [notes, setNotes] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // action state
  const [confirm, setConfirm] = useState(null);   // 'suspend' | 'reactivate' | 'revoke'
  const [roleConfirm, setRoleConfirm] = useState(null);
  modalOpenRef.current = !!confirm || !!roleConfirm; // gate the drawer's Escape
  const [actionErr, setActionErr] = useState('');  // inline error (fixes the old silent swallow)
  const [busy, setBusy] = useState(false);
  const [tierBusy, setTierBusy] = useState(false);
  const [reset, setReset] = useState(null);        // password reset response
  const [verify, setVerify] = useState(null);      // resend-verification response

  // profile edit (schema-driven, same source of truth as the server)
  const viewerRole = isAdmin ? 'admin' : 'mod';
  const formFields = editableFieldsForRole(viewerRole).filter((f) => !f.dedicatedControl);
  const seedForm = (rec) => { const f = {}; for (const fld of formFields) { const v = rec ? rec[fld.key] : undefined; f[fld.key] = v == null ? '' : v; } return f; };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => seedForm(initialUser));
  const [editErr, setEditErr] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const lockedForMod = !isAdmin && (u?.role === 'admin' || u?.role === 'mod');

  const reloadDetail = useCallback(() => {
    adminApi.users.get(userId)
      .then((full) => { if (full && full.id) { setU(full); setForm(seedForm(full)); } })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => { setLoading(true); reloadDetail(); }, [reloadDetail]);
  useEffect(() => { adminApi.users.getProjects(userId).then((d) => setProjects(d.projects || [])).catch(() => setProjects([])); }, [userId]);
  useEffect(() => { adminApi.users.timeline(userId).then((d) => setTimeline(d.events || [])).catch(() => setTimeline([])); }, [userId]);
  useEffect(() => { adminApi.users.notes.list(userId).then((d) => setNotes(d.notes || [])).catch(() => setNotes([])); }, [userId]);
  useEffect(() => { if (!isAdmin) return; adminApi.users.activity(userId).then(setActivity).catch(() => setActivity(null)); }, [userId, isAdmin]);

  const flash = (m) => { setMsg(m); setErr(''); };

  /* ── actions ──────────────────────────────────────────────────────────── */
  async function doStatus() {
    setBusy(true); setActionErr('');
    try {
      await adminApi.users.updateStatus(userId, { suspended: confirm === 'suspend' });
      setConfirm(null); flash(confirm === 'suspend' ? 'Account suspended — sessions revoked.' : 'Account reactivated.');
      reloadDetail(); onChanged?.();
    } catch (e) {
      setActionErr(e.message || 'Could not update status.'); // was silently swallowed before
    } finally { setBusy(false); }
  }
  async function doRole() {
    setBusy(true); setActionErr('');
    try {
      const { user: updated } = await adminApi.users.updateRole(userId, roleConfirm);
      setU((c) => ({ ...c, role: updated.role })); setRoleConfirm(null); flash('Role updated.'); onChanged?.();
    } catch (e) { setActionErr(e.message || 'Could not change role.'); } finally { setBusy(false); }
  }
  async function doRevoke() {
    setBusy(true); setActionErr('');
    try { await adminApi.users.revokeSessions(userId); setConfirm(null); flash('All sessions revoked — the user is signed out everywhere.'); reloadDetail(); }
    catch (e) { setActionErr(e.message || 'Could not revoke sessions.'); } finally { setBusy(false); }
  }
  async function doReset() {
    setReset(null); setErr('');
    try { setReset(await adminApi.users.sendPasswordReset(userId)); flash('Password reset processed.'); }
    catch (e) { setErr(e.message || 'Could not send reset.'); }
  }
  async function doResendVerification() {
    setVerify(null); setErr('');
    try { const r = await adminApi.users.resendVerification(userId); setVerify(r); flash(r.sent ? 'Verification email sent.' : 'Verification link generated.'); }
    catch (e) { if (e.code === 'ALREADY_VERIFIED') { flash('This email is already verified.'); reloadDetail(); } else setErr(e.message || 'Could not resend verification.'); }
  }
  async function changeTier(value) {
    setTierBusy(true); setErr('');
    try { await adminApi.tiers.assignUser(userId, { tierId: value || null }); setU((c) => ({ ...c, tierId: value || null })); flash('Tier updated.'); onChanged?.(); }
    catch (e) { setErr(e.message || 'Could not change tier.'); } finally { setTierBusy(false); }
  }
  async function saveEdit() {
    setEditErr('');
    const body = {};
    for (const fld of formFields) {
      const res = fld.validate(form[fld.key]);
      if (!res.ok) { setEditErr(`${fld.label}: ${res.error}`); return; }
      const cur = u[fld.key] == null ? null : u[fld.key];
      const next = res.value == null ? null : res.value;
      if (next !== cur) body[fld.key] = res.value;
    }
    if (Object.keys(body).length === 0) { setEditing(false); return; }
    setEditBusy(true);
    try { const { user: updated } = await adminApi.users.update(userId, body); setU((c) => ({ ...c, ...updated })); setForm(seedForm(updated)); setEditing(false); flash('Profile updated.'); onChanged?.(); }
    catch (e) { setEditErr(e.message || 'Could not save.'); } finally { setEditBusy(false); }
  }

  /* ── notes ────────────────────────────────────────────────────────────── */
  const [noteBody, setNoteBody] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [editNoteId, setEditNoteId] = useState(null);
  const [editNoteBody, setEditNoteBody] = useState('');
  const canEditNote = (n) => isAdmin || (viewer && n.authorId === viewer.id);
  async function addNote() {
    const body = noteBody.trim(); if (!body) return;
    setNoteBusy(true); setErr('');
    try { const { note } = await adminApi.users.notes.create(userId, { body }); setNotes((ns) => [note, ...(ns || [])]); setNoteBody(''); }
    catch (e) { setErr(e.message || 'Could not add note.'); } finally { setNoteBusy(false); }
  }
  async function saveNote(id) {
    const body = editNoteBody.trim(); if (!body) return;
    try { const { note } = await adminApi.users.notes.update(userId, id, { body }); setNotes((ns) => ns.map((n) => (n.id === id ? note : n))); setEditNoteId(null); }
    catch (e) { setErr(e.message || 'Could not save note.'); }
  }
  async function removeNote(id) {
    try { await adminApi.users.notes.remove(userId, id); setNotes((ns) => ns.filter((n) => n.id !== id)); }
    catch (e) { setErr(e.message || 'Could not delete note.'); }
  }

  const methods = u ? deriveAuthMethods({ hasPassword: u.hasPassword, providers: u.authProviders }) : [];
  const googleProvider = (u?.authProviders || []).find((p) => p.provider === 'google');
  const verified = !!u?.emailVerifiedAt;

  return (
    <div role="dialog" aria-modal="true" aria-label="User detail" style={{ position: 'fixed', inset: 0, zIndex: 500 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      <div ref={panelRef} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(600px, 100%)', background: C.surf, borderLeft: `1px solid ${C.brd}`, boxShadow: '-12px 0 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
          <Avatar name={u?.name || initialUser?.name} email={u?.email || initialUser?.email} size={38} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u?.name || initialUser?.name || 'Unnamed user'}</div>
            <div style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u?.email || initialUser?.email}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, display: 'inline-flex' }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {msg && <div role="status" style={{ marginBottom: 12, padding: '8px 11px', background: alpha(C.grn, '12'), border: `1px solid ${alpha(C.grn, '40')}`, borderRadius: 8, color: C.grn, fontSize: 12.5 }}>{msg}</div>}
          {err && <div role="alert" style={{ marginBottom: 12, padding: '8px 11px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 8, color: C.red, fontSize: 12.5 }}>{err}</div>}

          {/* status / role / tier chips + live presence */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge status={u?.status || (initialUser?.suspended ? 'suspended' : 'active')} />
            <RoleBadge role={u?.role || initialUser?.role} />
            <TierBadge tierId={u?.tierId} tierName={tierNameOf?.(u?.tierId)} />
            {isAdmin && activity && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: MONO, color: activity.onlineNow ? C.grn : C.muted, marginLeft: 4 }}>
                <LivePulseDot live={activity.onlineNow} />{activity.onlineNow ? 'Online now' : `Offline${activity.lastActive ? ` · ${fmtAgo(activity.lastActive)}` : ''}`}
              </span>
            )}
          </div>

          {loading && !u ? (
            <div style={{ padding: 36, textAlign: 'center' }}><Spinner /></div>
          ) : u && (
            <>
              {/* ── Overview ── */}
              <Section title="Overview" action={!lockedForMod && !editing && (
                <button type="button" onClick={() => { setForm(seedForm(u)); setEditErr(''); setEditing(true); }} style={ghostBtn}><Icon name="pencil" size={12} />Edit</button>
              )}>
                {editing ? (
                  <div>
                    {editErr && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{editErr}</div>}
                    {formFields.map((fld) => (
                      <div key={fld.key} style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>{fld.label}</label>
                        {fld.type === 'select' ? (
                          <select value={form[fld.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [fld.key]: e.target.value }))} style={{ ...selectStyle, fontSize: 12 }}>
                            {fld.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input type={fld.type === 'email' ? 'email' : 'text'} value={form[fld.key] ?? ''} maxLength={fld.maxLength} placeholder={fld.placeholder || ''}
                            onChange={(e) => setForm((f) => ({ ...f, [fld.key]: fld.uppercase ? e.target.value.toUpperCase() : e.target.value }))} style={{ ...inputStyle, fontSize: 12 }} />
                        )}
                        {fld.help && <div style={{ fontSize: 10, color: C.muted, marginTop: 3, lineHeight: 1.4 }}>{fld.help}</div>}
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button type="button" onClick={saveEdit} disabled={editBusy} style={{ ...primaryBtn, opacity: editBusy ? 0.7 : 1 }}>{editBusy && <Spinner size={12} color={C.accText} />}Save</button>
                      <button type="button" onClick={() => { setEditing(false); setForm(seedForm(u)); setEditErr(''); }} style={ghostBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <KV label="User ID"><CopyText value={u.id} mono label="user ID" /></KV>
                    {u.userNumber != null && <KV label="User #"><span style={{ fontFamily: MONO }}>{u.userNumber}</span></KV>}
                    <KV label="Institution">{u.institution || <span style={{ color: C.muted }}>—</span>}</KV>
                    <KV label="Country">{u.registrationCountryCode ? `${countryNameForCode(u.registrationCountryCode) || u.registrationCountryName || ''} (${u.registrationCountryCode})`.trim() : (u.registrationCountryName || <span style={{ color: C.muted }}>—</span>)}</KV>
                    <KV label="Joined">{fmtDate(u.createdAt)}</KV>
                    <KV label="Last active">{u.lastActive ? fmtAgo(u.lastActive) : <span style={{ color: C.muted }}>Never</span>}</KV>
                    <KV label="Email verified"><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><YesNo yes={verified} />{verified && <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{fmtDate(u.emailVerifiedAt)}</span>}</span></KV>
                    <KV label="Tier">
                      {isAdmin ? (
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <select aria-label="Change tier" value={u.tierId || ''} onChange={(e) => changeTier(e.target.value)} disabled={tierBusy} style={{ ...selectStyle, width: 'auto', fontSize: 12, padding: '5px 8px' }}>
                            <option value="">Default (site tier)</option>
                            {tiers.map((t) => <option key={t.id} value={t.id}>{t.displayName || t.id}</option>)}
                          </select>
                          {tierBusy && <Spinner size={12} />}
                        </span>
                      ) : <TierBadge tierId={u.tierId} tierName={tierNameOf?.(u.tierId)} />}
                    </KV>
                  </>
                )}
              </Section>

              {/* ── Authentication & security ── */}
              <Section title="Authentication & security">
                <KV label="Registration">{regMethodLabel(u.registrationMethod)}{u.invitedViaInvitation ? ' · via invitation' : ''}</KV>
                <KV label="Sign-in methods"><AuthBadge hasPassword={u.hasPassword} authProviders={u.authProviders} invited={false} /></KV>
                <KV label="Google connected"><YesNo yes={methods.includes('google')} /></KV>
                <KV label="Password login"><YesNo yes={!!u.hasPassword} /></KV>
                <KV label="Email verified"><YesNo yes={verified} /></KV>
                <KV label="Password changed">{u.passwordChangedAt ? fmtDate(u.passwordChangedAt) : <span style={{ color: C.muted }}>—</span>}</KV>
                <KV label="Last Google sign-in">{googleProvider?.lastLoginAt ? fmtDateTime(googleProvider.lastLoginAt) : <span style={{ color: C.muted }}>—</span>}</KV>
                {u.failedLogins30d > 0 && <KV label="Failed logins · 30d"><span style={{ color: C.red, fontFamily: MONO, fontWeight: 700 }}>{u.failedLogins30d}</span></KV>}

                {actionErr && <div role="alert" style={{ fontSize: 12, color: C.red, margin: '10px 0 0' }}>{actionErr}</div>}
                {!lockedForMod && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={doReset} style={softBtn(C.acc)}><Icon name="send" size={12} />Send password reset email</button>
                    {reset?.sent && <div style={{ fontSize: 11.5, color: C.grn }}>Reset link emailed — single-use, expiring.</div>}
                    {reset && !reset.sent && reset.link && <LinkBox label={reset.emailConfigured ? 'Reset link (email send failed)' : 'Reset link (email not configured)'} link={reset.link} />}

                    {!verified && <button type="button" onClick={doResendVerification} style={softBtn(C.teal)}><Icon name="mail" size={12} />Resend verification email</button>}
                    {verify?.sent && <div style={{ fontSize: 11.5, color: C.grn }}>Verification email sent.</div>}
                    {verify && !verify.sent && verify.link && <LinkBox label="Verification link (email not configured)" link={verify.link} />}

                    <button type="button" onClick={() => { setActionErr(''); setConfirm('revoke'); }} style={softBtn(C.gold)}><Icon name="logout" size={12} />Revoke all sessions</button>
                  </div>
                )}
                {lockedForMod && <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 12, marginTop: 10 }}><Icon name="lock" size={12} />Managed by administrators</div>}
              </Section>

              {/* ── Access & permissions ── */}
              <Section title="Access & permissions">
                {isAdmin && u.role !== 'admin' ? (
                  <KV label="Role">
                    <select aria-label="Change role" value={u.role || 'user'} onChange={(e) => { if (e.target.value !== u.role) { setActionErr(''); setRoleConfirm(e.target.value); } }} style={{ ...selectStyle, width: 'auto', fontSize: 12, padding: '5px 8px' }}>
                      <option value="user">user</option>
                      <option value="mod">mod</option>
                      <option value="admin">admin</option>
                    </select>
                  </KV>
                ) : (
                  <KV label="Role"><RoleBadge role={u.role} /></KV>
                )}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Projects ({projects?.length ?? '…'})</div>
                  {projects == null ? <div style={{ padding: 12, textAlign: 'center' }}><Spinner /></div>
                    : projects.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No projects.</div>
                    : projects.map((p) => (
                      <div key={p.id} style={{ padding: '8px 10px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</span>
                          {p.status === 'archived' && <span style={{ fontSize: 10, color: C.yel, fontFamily: MONO }}>archived</span>}
                        </div>
                        <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, marginTop: 3 }}>Updated {fmtAgo(p.updatedAt)}</div>
                      </div>
                    ))}
                </div>
              </Section>

              {/* ── Activity ── */}
              <Section title="Activity">
                {timeline == null ? <div style={{ padding: 12, textAlign: 'center' }}><Spinner /></div>
                  : timeline.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No recorded activity.</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {timeline.slice(0, tlLimit).map((ev, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.brd}`, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 12.5, color: C.txt, flex: 1, minWidth: 0 }}>
                            {ev.label}
                            {ev.actor && <span style={{ color: C.muted, fontSize: 11 }}> · by {ev.actor}</span>}
                            {ev.detail && <span style={{ color: C.muted, fontSize: 11 }}> · {ev.detail}</span>}
                          </span>
                          <span title={fmtDateTime(ev.ts)} style={{ fontSize: 11, color: C.muted, fontFamily: MONO, flexShrink: 0 }}>{fmtAgo(ev.ts)}</span>
                        </div>
                      ))}
                      {timeline.length > tlLimit && (
                        <button type="button" onClick={() => setTlLimit((n) => Math.min(50, n + 20))} style={{ ...ghostBtn, alignSelf: 'flex-start', marginTop: 8 }}>Show more</button>
                      )}
                    </div>
                  )}
              </Section>

              {/* ── Internal notes ── */}
              <Section title="Internal notes">
                <div style={{ marginBottom: 12 }}>
                  <textarea value={noteBody} maxLength={4000} onChange={(e) => setNoteBody(e.target.value)} rows={2} placeholder="Add an internal note (Ops-only, never shown to the user)…"
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT, minHeight: 52 }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>{noteBody.length}/4000</span>
                    <button type="button" onClick={addNote} disabled={noteBusy || !noteBody.trim()} style={{ ...primaryBtn, opacity: noteBusy || !noteBody.trim() ? 0.6 : 1 }}><Icon name="plus" size={12} />Add note</button>
                  </div>
                </div>
                {notes == null ? <div style={{ padding: 12, textAlign: 'center' }}><Spinner /></div>
                  : notes.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No notes yet.</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {notes.map((n) => (
                        <div key={n.id} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 11px' }}>
                          {editNoteId === n.id ? (
                            <>
                              <textarea value={editNoteBody} maxLength={4000} onChange={(e) => setEditNoteBody(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
                              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                                <button type="button" onClick={() => saveNote(n.id)} style={{ ...primaryBtn, padding: '6px 12px' }}>Save</button>
                                <button type="button" onClick={() => setEditNoteId(null)} style={ghostBtn}>Cancel</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.body}</div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
                                <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{n.authorName || 'Ops'} · {fmtAgo(n.createdAt)}{n.editedAt ? ' · edited' : ''}</span>
                                {canEditNote(n) && (
                                  <span style={{ display: 'inline-flex', gap: 6 }}>
                                    <button type="button" onClick={() => { setEditNoteId(n.id); setEditNoteBody(n.body); }} aria-label="Edit note" style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', display: 'inline-flex' }}><Icon name="pencil" size={13} /></button>
                                    <button type="button" onClick={() => removeNote(n.id)} aria-label="Delete note" style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', display: 'inline-flex' }}><Icon name="trash" size={13} /></button>
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
              </Section>

              {/* ── Suspend / reactivate (admins never suspended; mods can't touch admin/mod) ── */}
              {!lockedForMod && u.role !== 'admin' && (
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.brd}` }}>
                  {u.status === 'suspended' || u.suspended ? (
                    <button type="button" onClick={() => { setActionErr(''); setConfirm('reactivate'); }} style={{ ...softBtn(C.grn), width: '100%', justifyContent: 'center', padding: 10 }}>Reactivate account</button>
                  ) : (
                    <button type="button" onClick={() => { setActionErr(''); setConfirm('suspend'); }} style={{ ...softBtn(C.red), width: '100%', justifyContent: 'center', padding: 10 }}>Suspend account</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirms */}
      <ConfirmDialog open={confirm === 'suspend' || confirm === 'reactivate'}
        title={confirm === 'suspend' ? 'Suspend user' : 'Reactivate user'}
        message={confirm === 'suspend' ? `Suspend ${u?.email}? This signs them out everywhere and blocks sign-in until reactivated.` : `Reactivate ${u?.email}? They regain full access.`}
        confirmLabel={confirm === 'suspend' ? 'Suspend' : 'Reactivate'} danger={confirm === 'suspend'} busy={busy}
        onConfirm={doStatus} onCancel={() => !busy && setConfirm(null)} />
      <ConfirmDialog open={confirm === 'revoke'}
        title="Revoke all sessions" message={`Sign ${u?.email} out of every device. They can sign back in with their existing credentials.`}
        confirmLabel="Revoke sessions" danger busy={busy} onConfirm={doRevoke} onCancel={() => !busy && setConfirm(null)} />
      <ConfirmDialog open={!!roleConfirm}
        title="Change role" message={`Change ${u?.email} from "${u?.role}" to "${roleConfirm}"? ${roleConfirm === 'admin' ? 'This grants full Ops access.' : 'This changes their access immediately.'}`}
        confirmLabel="Change role" danger={roleConfirm === 'admin'} busy={busy} onConfirm={doRole} onCancel={() => !busy && setRoleConfirm(null)} />
    </div>
  );
}
