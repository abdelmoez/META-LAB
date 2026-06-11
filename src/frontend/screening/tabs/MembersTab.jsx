/**
 * MembersTab.jsx — META·SIFT project members & roles (Part 4).
 *
 * Roster of project members with leader-only management: add / remove members,
 * apply role/permission presets, change status, and toggle per-member
 * permissions (quick: canScreen/canChat/canResolveConflicts; the full module
 * flag matrix lives behind "All permissions" — prompt6 Task 6). Adding a member
 * also picks which apps they participate in (modules: metalab|metasift|both).
 * Non-leaders see a read-only roster.
 *
 * Backend rules surfaced as inline errors (not pre-validated client-side):
 *   - 409 duplicate email on add
 *   - 400 "The project owner must remain an active leader" on role/status change
 *   - 400 "Cannot remove the project owner" on remove
 * The owner row cannot be reliably detected from the payload, so leader rows
 * are visually marked and rely on backend rejection.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import {
  Loading, ErrorBanner, Button, Badge, Avatar, Toggle, Modal, Card,
  Field, fieldLabel, fieldInput, EmptyState,
} from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { PERMISSION_PRESETS, ASSIGNABLE_PRESETS } from '../../../research-engine/screening/permissionPresets.js';

// ── role / status presentation ──────────────────────────────────────────────

// Owner is distinct from Leader everywhere (prompt5 Task 1).
const ROLE_COLOR = { owner: C.gold, leader: C.teal, reviewer: C.acc, viewer: C.muted };
const ROLE_LABEL = { owner: 'Owner', leader: 'Leader', reviewer: 'Reviewer', viewer: 'Viewer' };

const STATUS_META = {
  active:   { color: C.grn,   label: 'Active' },
  inactive: { color: C.muted, label: 'Inactive' },
  pending:  { color: C.ylw,   label: 'Pending Invite' },
};

const PERMS = [
  { key: 'canScreen',          label: 'Screen',          hint: 'Make screening decisions' },
  { key: 'canChat',            label: 'Chat',            hint: 'Post in project discussion' },
  { key: 'canResolveConflicts',label: 'Resolve',         hint: 'Resolve reviewer conflicts' },
];

// Full per-flag matrix (prompt6 Task 6) — the quick PERMS row above stays as-is;
// the rest of the module flags live in an expandable "All permissions" editor.
// Global management flags are OWNER-only to grant/revoke (server-enforced; the
// server silently ignores them from non-owners, so we hide them too).
const PERM_GROUPS = [
  { title: 'META·SIFT', keys: [
    { key: 'canViewMetaSift',    label: 'View' },
    { key: 'canSecondReview',    label: 'Second review' },
    { key: 'canManageDuplicates',label: 'Duplicates' },
    { key: 'canImportRecords',   label: 'Import' },
    { key: 'canExportRecords',   label: 'Export' },
    { key: 'readOnlyMetaSift',   label: 'Read-only' },
  ]},
  { title: 'META·LAB', keys: [
    { key: 'canViewMetaLab',     label: 'View' },
    { key: 'canEditMetaLab',     label: 'Edit' },
    { key: 'canManageExtraction',label: 'Extraction' },
    { key: 'canRunAnalysis',     label: 'Analysis' },
    { key: 'canExport',          label: 'Export' },
    { key: 'readOnlyMetaLab',    label: 'Read-only' },
  ]},
  { title: 'Global', ownerOnly: true, keys: [
    { key: 'canManageMembers',   label: 'Manage members' },
    { key: 'canManageSettings',  label: 'Manage settings' },
  ]},
];

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── small read-only permission dot (non-leader view) ────────────────────────

function PermDot({ on, label }) {
  return (
    <span
      title={`${label}: ${on ? 'enabled' : 'disabled'}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: on ? C.txt2 : C.muted }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: on ? C.grn : C.brd2,
        boxShadow: on ? `0 0 0 2px ${alpha(C.grn, '22')}` : 'none',
      }} />
      {label}
    </span>
  );
}

// ── selects share one style ─────────────────────────────────────────────────

const selectStyle = {
  background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6,
  padding: '5px 8px', color: C.txt, fontSize: 12, fontFamily: FONT, outline: 'none', cursor: 'pointer',
};

// ── MembersTab ──────────────────────────────────────────────────────────────

export default function MembersTab({ pid, project, access, refreshProject }) {
  const [members, setMembers] = useState([]);
  const [isLeader, setIsLeader] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [myRole, setMyRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // per-member transient state
  const [busy, setBusy] = useState({});     // { [mid]: bool }
  const [rowErr, setRowErr] = useState({}); // { [mid]: string }

  // modals
  const [showAdd, setShowAdd] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // member object

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.listMembers(pid);
      setMembers(data.members || []);
      setIsLeader(!!data.isLeader);
      setIsOwner(!!data.isOwner);
      setCanManageMembers(!!data.canManageMembers);
      setMyRole(data.myRole || null);
    } catch (e) {
      setError(e.message || 'Failed to load members.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  // Who can manage members: owner, leader, or a member granted canManageMembers.
  const canManage = canManageMembers || isLeader || !!access?.isLeader;
  // Whether the current user is the OWNER (only the owner may touch leader rows).
  const amOwner = isOwner || access?.myRole === 'owner';

  // Generic per-member patch helper.
  const patchMember = useCallback(async (mid, body) => {
    setBusy(b => ({ ...b, [mid]: true }));
    setRowErr(e => ({ ...e, [mid]: '' }));
    try {
      await screeningApi.updateMember(pid, mid, body);
      await load();
    } catch (e) {
      setRowErr(prev => ({ ...prev, [mid]: e.message || 'Update failed.' }));
    } finally {
      setBusy(b => ({ ...b, [mid]: false }));
    }
  }, [pid, load]);

  async function handleRemove(member) {
    setBusy(b => ({ ...b, [member.id]: true }));
    setRowErr(e => ({ ...e, [member.id]: '' }));
    try {
      await screeningApi.removeMember(pid, member.id);
      setConfirmRemove(null);
      await load();
      refreshProject?.();
    } catch (e) {
      setRowErr(prev => ({ ...prev, [member.id]: e.message || 'Remove failed.' }));
      setBusy(b => ({ ...b, [member.id]: false }));
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return <Loading label="Loading members…" />;

  const leaderCount = members.filter(m => m.role === 'leader').length;

  return (
    <div style={{ animation: 'sift-fade 0.3s ease' }}>
      {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.txt }}>Members</div>
          <div style={{ fontSize: 12, color: C.txt2, marginTop: 3 }}>
            {members.length} {members.length === 1 ? 'member' : 'members'}
            {leaderCount > 0 && <span style={{ color: C.muted }}> · {leaderCount} leader{leaderCount === 1 ? '' : 's'}</span>}
          </div>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setShowAdd(true)}>+ Add member</Button>
        )}
      </div>

      {!canManage && (
        <div style={{
          background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8,
          padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.txt2,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          Only the project leader can manage members.
        </div>
      )}

      {/* Roster */}
      {members.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No members yet"
          action={canManage ? <Button variant="primary" onClick={() => setShowAdd(true)}>+ Add member</Button> : null}
        >
          {canManage
            ? 'Add reviewers and viewers to collaborate on this screening project.'
            : 'This project has no members yet.'}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {members.map(m => (
            <MemberRow
              key={m.id}
              member={m}
              canManage={canManage}
              amOwner={amOwner}
              busy={!!busy[m.id]}
              rowErr={rowErr[m.id]}
              onPatch={(body) => patchMember(m.id, body)}
              onRemove={() => setConfirmRemove(m)}
            />
          ))}
        </div>
      )}

      {/* Add member modal */}
      {showAdd && (
        <AddMemberModal
          pid={pid}
          amOwner={amOwner}
          onClose={() => setShowAdd(false)}
          onAdded={async () => { await load(); refreshProject?.(); }}
        />
      )}

      {/* Remove confirm modal */}
      {confirmRemove && (
        <Modal onClose={() => setConfirmRemove(null)} width={420}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 10 }}>Remove member</div>
          <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, marginBottom: 6 }}>
            Remove{' '}
            <span style={{ color: C.txt, fontWeight: 600 }}>
              {confirmRemove.name || confirmRemove.email}
            </span>{' '}
            from this project? They will lose access and their screening assignments.
          </div>
          {rowErr[confirmRemove.id] && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 6 }}>{rowErr[confirmRemove.id]}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)} disabled={busy[confirmRemove.id]}>Cancel</Button>
            <Button variant="danger" onClick={() => handleRemove(confirmRemove)} disabled={busy[confirmRemove.id]}>
              {busy[confirmRemove.id] ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── MemberRow ───────────────────────────────────────────────────────────────

function LockNote({ children }) {
  return (
    <span title={children} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
      <span style={{ fontSize: 13 }}>🔒</span>{children}
    </span>
  );
}

function MemberRow({ member, canManage, amOwner, busy, rowErr, onPatch, onRemove }) {
  const m = member;
  const [showAllPerms, setShowAllPerms] = useState(false);
  const display = m.name || m.email || 'Unknown';
  const isOwnerRow  = !!m.isOwner || m.role === 'owner';
  const isLeaderRow = !isOwnerRow && (m.isLeader || m.role === 'leader');
  const status = STATUS_META[m.status] || STATUS_META.inactive;
  const roleColor = ROLE_COLOR[m.role] || C.muted;

  // Row lock rules (Task 2):
  //   • Owner row is locked for everyone (use a transfer-ownership flow instead).
  //   • Leader row is locked unless the CURRENT user is the owner.
  //   • Members/viewers are editable by anyone who can manage members.
  const locked = isOwnerRow || (isLeaderRow && !amOwner);
  const lockMsg = isOwnerRow
    ? 'Owner permissions cannot be changed here.'
    : 'Only the owner can change leader permissions.';
  const editable = canManage && !locked;
  // Every preset the caller's authority allows (prompt6 Task 6) — owner: all
  // assignable presets (a second owner is never assignable); leader/manager:
  // all except Leader (minting leaders is owner-only, server-enforced).
  const presetOptions = amOwner ? ASSIGNABLE_PRESETS : ASSIGNABLE_PRESETS.filter(p => p !== 'leader');
  // Current value: the stored preset when it's still assignable here; otherwise
  // a "Custom" placeholder (e.g. per-flag tweaks since the last preset).
  const currentPreset = m.permissionPreset && presetOptions.includes(m.permissionPreset) ? m.permissionPreset : '';

  return (
    <Card style={{
      padding: '14px 16px',
      borderColor: isOwnerRow ? alpha(C.gold, '55') : isLeaderRow ? alpha(C.teal, '40') : C.brd,
      opacity: m.status === 'inactive' ? 0.72 : 1,
    }}>
      {/* Top line: identity + badges + inline controls (when editable) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Avatar name={m.name || m.email} size={34} />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {display}
            </span>
            <Badge color={roleColor}>{ROLE_LABEL[m.role] || m.role}</Badge>
            <Badge color={status.color}>
              {m.status === 'pending' ? 'Pending Invite' : status.label}
            </Badge>
          </div>
          <div style={{ fontSize: 12, color: C.txt2, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m.name ? m.email : <span style={{ color: C.muted }}>no email</span>}
          </div>
        </div>

        {/* Management controls: role select + status toggle + remove (only when editable) */}
        {editable ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select
              value={currentPreset}
              disabled={busy}
              onChange={e => { if (e.target.value) onPatch({ preset: e.target.value }); }}
              style={{ ...selectStyle, opacity: busy ? 0.6 : 1 }}
              title="Apply a role/permission preset (resets per-member toggles to the preset)"
            >
              {!currentPreset && <option value="">Custom · {ROLE_LABEL[m.role] || m.role}</option>}
              {presetOptions.map(p => (
                <option key={p} value={p}>{PERMISSION_PRESETS[p]?.label || p}</option>
              ))}
            </select>

            <Toggle
              checked={m.status === 'active'}
              disabled={busy || m.status === 'pending'}
              onChange={(next) => onPatch({ status: next ? 'active' : 'inactive' })}
              label={m.status === 'pending' ? undefined : (m.status === 'active' ? 'Active' : 'Inactive')}
            />

            <Button variant="ghost" onClick={onRemove} disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }}>
              Remove
            </Button>
          </div>
        ) : canManage && locked ? (
          <LockNote>{lockMsg}</LockNote>
        ) : (
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>
            joined {fmtDate(m.joinedAt)}
          </span>
        )}
      </div>

      {/* Permissions row — toggles only when this row is editable; otherwise read-only dots */}
      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}`,
        display: 'flex', alignItems: 'center', gap: editable ? 22 : 18, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: C.muted,
        }}>
          Permissions
        </span>

        {editable
          ? PERMS.map(p => (
              <Toggle
                key={p.key}
                checked={!!m[p.key]}
                disabled={busy}
                onChange={(next) => onPatch({ [p.key]: next })}
                label={p.label}
              />
            ))
          : PERMS.map(p => <PermDot key={p.key} on={!!m[p.key]} label={p.label} />)
        }

        {editable && (
          <button
            onClick={() => setShowAllPerms(s => !s)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 11, fontFamily: FONT, color: C.acc,
            }}
          >
            {showAllPerms ? '▾ Fewer permissions' : '▸ All permissions'}
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: MONO, color: C.muted }}>
          joined {fmtDate(m.joinedAt)}
        </span>
      </div>

      {/* Full per-flag matrix (prompt6 Task 6) — module flags grouped by app;
          global management flags shown to the owner only (server-enforced). */}
      {editable && showAllPerms && (
        <div style={{
          marginTop: 12, background: C.surf, border: `1px solid ${C.brd}`,
          borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {PERM_GROUPS.filter(g => !g.ownerOnly || amOwner).map(g => (
            <div key={g.title}>
              <div style={{
                fontSize: 9.5, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: 8,
              }}>
                {g.title}{g.ownerOnly ? ' · owner-only' : ''}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                {g.keys.map(p => (
                  <Toggle
                    key={p.key}
                    checked={!!m[p.key]}
                    disabled={busy}
                    onChange={(next) => onPatch({ [p.key]: next })}
                    label={p.label}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {rowErr && (
        <div style={{
          marginTop: 12, background: C.redBg, border: `1px solid ${alpha(C.red, '50')}`,
          borderRadius: 6, padding: '8px 12px', color: C.red, fontSize: 12,
        }}>
          {rowErr}
        </div>
      )}
    </Card>
  );
}

// ── AddMemberModal ──────────────────────────────────────────────────────────

// Permission presets shown when adding a member (Task 9).
const ADD_PRESETS = [
  { value: 'reviewer',          label: 'Reviewer — screen + second review + chat' },
  { value: 'data_extractor',    label: 'Data Extractor — META·LAB extraction + analysis' },
  { value: 'leader',            label: 'Leader — full control (except owner)' },
  { value: 'readonly_metasift', label: 'Read-only META·SIFT' },
  { value: 'readonly_metalab',  label: 'Read-only META·LAB' },
  { value: 'readonly_both',     label: 'Read-only (both modules)' },
  { value: 'viewer',            label: 'Viewer — read-only both, can chat' },
];

// Which apps the new member participates in (prompt6 Task 6) — sent as
// modules:'metalab'|'metasift'|'both'; the server maps it onto the canView* flags.
const MODULE_OPTIONS = [
  { value: 'both',     label: 'Both META·LAB & META·SIFT' },
  { value: 'metalab',  label: 'META·LAB only' },
  { value: 'metasift', label: 'META·SIFT only' },
];

function AddMemberModal({ pid, amOwner, onClose, onAdded }) {
  // Only the owner can add a Leader (Task 2) — hide that preset for non-owners.
  const presets = amOwner ? ADD_PRESETS : ADD_PRESETS.filter(p => p.value !== 'leader');
  const [email, setEmail] = useState('');
  const [preset, setPreset] = useState('reviewer');
  const [modules, setModules] = useState('both');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [pendingNote, setPendingNote] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) { setErr('Email is required.'); return; }
    setSubmitting(true);
    setErr('');
    setPendingNote(false);
    try {
      const res = await screeningApi.addMember(pid, { email: trimmed, preset, modules });
      await onAdded();
      if (res?.pending) {
        // User not yet registered — show note, keep modal open briefly so the
        // leader sees confirmation, then reset for another add.
        setPendingNote(true);
        setEmail('');
      } else {
        onClose();
      }
    } catch (e2) {
      setErr(e2.message || 'Could not add member.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} width={440}>
      <form onSubmit={submit}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 4 }}>Add member</div>
        <div style={{ fontSize: 12, color: C.txt2, marginBottom: 4 }}>
          Invite a collaborator by email. Unregistered users get a pending invite.
        </div>

        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setErr(''); }}
            placeholder="colleague@example.com"
            autoFocus
            disabled={submitting}
            style={fieldInput}
          />
        </Field>

        <div>
          <label style={fieldLabel}>Permission preset</label>
          <select
            value={preset}
            onChange={e => setPreset(e.target.value)}
            disabled={submitting}
            style={{ ...fieldInput, cursor: 'pointer' }}
          >
            {presets.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
            Presets set META·LAB + META·SIFT permissions across the linked workspace. Fine-tune per-member toggles after adding.
          </div>
        </div>

        <div>
          <label style={fieldLabel}>Participates in</label>
          <select
            value={modules}
            onChange={e => setModules(e.target.value)}
            disabled={submitting}
            style={{ ...fieldInput, cursor: 'pointer' }}
          >
            {MODULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
            Limits which app(s) the member can open; combined with the preset&rsquo;s permissions.
          </div>
        </div>

        {pendingNote && (
          <div style={{
            marginTop: 14, background: alpha(C.ylw, '14'), border: `1px solid ${alpha(C.ylw, '40')}`,
            borderRadius: 6, padding: '9px 12px', color: C.ylw, fontSize: 12, lineHeight: 1.5,
          }}>
            Invite created — user not yet registered. They will join once they sign up with this email.
          </div>
        )}

        {err && (
          <div style={{
            marginTop: 14, background: C.redBg, border: `1px solid ${alpha(C.red, '50')}`,
            borderRadius: 6, padding: '9px 12px', color: C.red, fontSize: 12,
          }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            {pendingNote ? 'Done' : 'Cancel'}
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add member'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
