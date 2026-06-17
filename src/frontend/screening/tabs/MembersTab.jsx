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
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import {
  Loading, ErrorBanner, Button, Badge, Avatar, Toggle, Modal, Card,
  Field, fieldLabel, fieldInput, EmptyState,
} from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSION_PRESETS, ASSIGNABLE_PRESETS } from '../../../research-engine/screening/permissionPresets.js';
import { groupMembers } from './memberOrder.js';

// Client-side email format gate (the server validates too) — prompt9 Task 2.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  { title: 'Screening', keys: [
    { key: 'canViewMetaSift',    label: 'View' },
    { key: 'canSecondReview',    label: 'Second review' },
    { key: 'canManageDuplicates',label: 'Duplicates' },
    { key: 'canImportRecords',   label: 'Import' },
    { key: 'canExportRecords',   label: 'Export' },
    { key: 'readOnlyMetaSift',   label: 'Read-only' },
  ]},
  { title: 'Project', keys: [
    { key: 'canViewMetaLab',     label: 'View' },
    { key: 'canEditMetaLab',     label: 'Edit' },
    { key: 'canManageExtraction',label: 'Extraction' },
    { key: 'canRunAnalysis',     label: 'Analysis' },
    { key: 'canExport',          label: 'Export' },
    { key: 'canAssessRiskOfBias',label: 'Risk of Bias', hint: 'Allows this member to complete and edit Risk of Bias assessments for this project.' },
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

// ── subtle roster section header (prompt22 Task 2) ──────────────────────────
// A quiet group divider — small mono uppercase label + count + a hairline rule.
// Visible enough to separate Owner / Leaders / Members / Viewers, light enough to
// not read as a second control bar.
function RosterSectionLabel({ label, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
      <span style={{
        fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: C.muted, flexShrink: 0,
      }}>
        {label}{typeof count === 'number' ? ` · ${count}` : ''}
      </span>
      <span style={{ flex: 1, height: 1, background: C.brd }} />
    </div>
  );
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

export default function MembersTab({ pid, project, access, refreshProject, presence, leaveRedirect = '/sift-beta' }) {
  const { user } = useAuth();
  // prompt23 Task 14 — live presence: who is active and where (+ what they're editing).
  const presenceByUser = {};
  (presence?.users || []).forEach(u => { presenceByUser[u.userId] = u; });
  const locksByUser = {};
  (presence?.locks || []).forEach(l => { (locksByUser[l.userId] ||= []).push(l); });
  const navigate = useNavigate();
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
  const [confirmLeave, setConfirmLeave] = useState(false);  // self-leave (prompt9)
  const [leaving, setLeaving] = useState(false);
  const [leaveErr, setLeaveErr] = useState('');

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

  // Self-service leave (prompt9) — POST /projects/:pid/leave, then back to the
  // dashboard. The owner never sees this affordance (server 400s anyway).
  async function handleLeave() {
    setLeaving(true);
    setLeaveErr('');
    try {
      await screeningApi.leaveProject(pid);
      navigate(leaveRedirect);
    } catch (e) {
      setLeaveErr(e.message || 'Could not leave the project.');
      setLeaving(false);
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groupMembers(members).map(section => (
            <div key={section.label}>
              <RosterSectionLabel label={section.label} count={section.members.length} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {section.members.map(m => {
                  // Own row of a NON-owner gets a self-service "Leave project"
                  // affordance (prompt9). The owner row never does.
                  const isSelf = !!(m.userId && user?.id && m.userId === user.id);
                  const isOwnerRow = !!m.isOwner || m.role === 'owner';
                  return (
                    <MemberRow
                      key={m.id}
                      member={m}
                      canManage={canManage}
                      amOwner={amOwner}
                      busy={!!busy[m.id]}
                      rowErr={rowErr[m.id]}
                      activity={m.userId ? { presence: presenceByUser[m.userId], lock: (locksByUser[m.userId] || [])[0] } : null}
                      onPatch={(body) => patchMember(m.id, body)}
                      onRemove={() => setConfirmRemove(m)}
                      onLeave={isSelf && !isOwnerRow ? () => { setLeaveErr(''); setConfirmLeave(true); } : undefined}
                    />
                  );
                })}
              </div>
            </div>
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

      {/* Remove / revoke-invite confirm modal (pending rows = unclaimed
          invites; removal of the row IS the revoke — prompt9 Task 2) */}
      {confirmRemove && (() => {
        const isInvite = confirmRemove.status === 'pending';
        return (
          <Modal onClose={() => setConfirmRemove(null)} width={420}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 10 }}>
              {isInvite ? 'Revoke invite' : 'Remove member'}
            </div>
            <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, marginBottom: 6 }}>
              {isInvite ? (
                <>
                  Revoke this invite?{' '}
                  <span style={{ color: C.txt, fontWeight: 600 }}>{confirmRemove.email || confirmRemove.name}</span>{' '}
                  will no longer be able to join this project, and their invite link stops working.
                </>
              ) : (
                <>
                  Remove{' '}
                  <span style={{ color: C.txt, fontWeight: 600 }}>
                    {confirmRemove.name || confirmRemove.email}
                  </span>{' '}
                  from this project? They will lose access and their screening assignments.
                </>
              )}
            </div>
            {rowErr[confirmRemove.id] && (
              <div style={{ fontSize: 12, color: C.red, marginBottom: 6 }}>{rowErr[confirmRemove.id]}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <Button variant="ghost" onClick={() => setConfirmRemove(null)} disabled={busy[confirmRemove.id]}>Cancel</Button>
              <Button variant="danger" onClick={() => handleRemove(confirmRemove)} disabled={busy[confirmRemove.id]}>
                {busy[confirmRemove.id]
                  ? (isInvite ? 'Revoking…' : 'Removing…')
                  : (isInvite ? 'Revoke invite' : 'Remove')}
              </Button>
            </div>
          </Modal>
        );
      })()}

      {/* Leave-project confirm modal (prompt9 — own row, non-owner) */}
      {confirmLeave && (
        <Modal onClose={() => !leaving && setConfirmLeave(false)} width={420}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 10 }}>Leave project</div>
          <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, marginBottom: 6 }}>
            You will lose access to this workspace — its records, your screening view,
            and the project chat. A project manager can add you back later.
          </div>
          {leaveErr && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 6 }}>{leaveErr}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Button variant="ghost" onClick={() => setConfirmLeave(false)} disabled={leaving}>Cancel</Button>
            <Button variant="danger" onClick={handleLeave} disabled={leaving}>
              {leaving ? 'Leaving…' : 'Leave project'}
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

function MemberRow({ member, canManage, amOwner, busy, rowErr, activity, onPatch, onRemove, onLeave }) {
  const m = member;
  // prompt23 Task 14 — live activity: green dot + current location (+ field being edited).
  const pres = activity?.presence || null;
  const lock = activity?.lock || null;
  const activityText = pres
    ? (lock ? `Active now · editing ${String(lock.field || '').split('.').pop()}` : `Active now${pres.location ? ` · ${pres.location}` : ''}`)
    : null;
  const [showAllPerms, setShowAllPerms] = useState(false);
  const display = m.name || m.email || 'Unknown';
  const isOwnerRow  = !!m.isOwner || m.role === 'owner';
  const isLeaderRow = !isOwnerRow && (m.isLeader || m.role === 'leader');
  const isPending   = m.status === 'pending';
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
            <span title={display} style={{ fontSize: 14, fontWeight: 600, color: C.txt, minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {display}
            </span>
            <Badge color={roleColor}>{ROLE_LABEL[m.role] || m.role}</Badge>
            <Badge color={status.color}>
              {m.status === 'pending' ? 'Pending Invite' : status.label}
            </Badge>
          </div>
          {activityText && (
            <div style={{ fontSize: 11, color: C.grn, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.grn, flexShrink: 0 }} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activityText}</span>
            </div>
          )}
          <div title={m.name ? m.email : undefined} style={{ fontSize: 12, color: C.txt2, marginTop: 3, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

            <Button
              variant="ghost"
              onClick={onRemove}
              disabled={busy}
              title={isPending ? 'Revoke this pending invite' : undefined}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              {isPending ? 'Revoke invite' : 'Remove'}
            </Button>
          </div>
        ) : canManage && locked ? (
          <LockNote>{lockMsg}</LockNote>
        ) : !onLeave ? (
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>
            joined {fmtDate(m.joinedAt)}
          </span>
        ) : null}

        {/* Own row, non-owner — self-service exit (prompt9) */}
        {onLeave && (
          <Button
            variant="ghost"
            onClick={onLeave}
            disabled={busy}
            title="Leave this project"
            style={{ padding: '6px 12px', fontSize: 12, color: C.red, borderColor: alpha(C.red, '50') }}
          >
            Leave project
          </Button>
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

/**
 * presetBlurb — derives a plain-English explanation for the inviter from the
 * selected preset + module selection.  Answers four questions:
 *   1. Can this member open META·SIFT?
 *   2. Can this member open META·LAB?
 *   3. Are they read-only in those modules?
 *   4. What can they actively do (screen / extract / analyze / manage members)?
 *
 * Derived from PERMISSION_PRESETS flags — no hard-coded strings per preset so
 * the text stays correct if the preset perms ever change.
 */
function presetBlurb(presetKey, modules) {
  const p = PERMISSION_PRESETS[presetKey];
  if (!p) return '';
  const { perms } = p;

  // ── module access (what the preset enables, before the "Participates in"
  //    narrowing — we explain the preset's own flags, not the intersection,
  //    to keep the blurb stable regardless of module dropdown choice) ──────
  const siftAccess = perms.canViewMetaSift;
  const labAccess  = perms.canViewMetaLab;
  const siftRO     = perms.readOnlyMetaSift;
  const labRO      = perms.readOnlyMetaLab;

  // ── capability phrases ───────────────────────────────────────────────────
  const caps = [];

  // META·SIFT capabilities
  if (siftAccess && !siftRO) {
    if (perms.canScreen)           caps.push('screen studies');
    if (perms.canSecondReview)     caps.push('second-review');
    if (perms.canResolveConflicts) caps.push('resolve conflicts');
    if (perms.canImportRecords)    caps.push('import records');
  }

  // META·LAB capabilities
  if (labAccess && !labRO) {
    if (perms.canEditMetaLab || perms.canManageExtraction) caps.push('edit extraction');
    if (perms.canRunAnalysis)  caps.push('run analysis');
    if (perms.canExport)       caps.push('export data');
  }

  // Management
  if (perms.canManageMembers || perms.canManageSettings) caps.push('manage members & settings');

  // Chat (mention only when it's not implied by full access)
  if (perms.canChat && !perms.canManageMembers) caps.push('chat');

  // ── module access summary ────────────────────────────────────────────────
  let accessSentence;
  if (siftAccess && labAccess) {
    if (siftRO && labRO) {
      accessSentence = 'This user can open both Screening and the rest of the project in read-only mode.';
    } else if (siftRO) {
      accessSentence = 'This user can open Screening (read-only) and the rest of the project.';
    } else if (labRO) {
      accessSentence = 'This user can open Screening and the rest of the project (read-only).';
    } else {
      accessSentence = 'This user can access both Screening and the rest of the project.';
    }
  } else if (siftAccess) {
    accessSentence = siftRO
      ? 'This user can open Screening in read-only mode. No access to the rest of the project.'
      : 'This user can access Screening. No access to the rest of the project.';
  } else if (labAccess) {
    accessSentence = labRO
      ? 'This user can open the rest of the project in read-only mode. No access to Screening.'
      : 'This user can access the rest of the project. No access to Screening.';
  } else {
    // owner/leader implicit full access
    accessSentence = 'This user has full access to the whole project, including Screening.';
  }

  // ── capability sentence ──────────────────────────────────────────────────
  let capSentence = '';
  if (caps.length === 0) {
    if (siftAccess || labAccess) capSentence = 'They cannot make changes.';
  } else {
    const joined = caps.length === 1
      ? caps[0]
      : caps.slice(0, -1).join(', ') + ' and ' + caps[caps.length - 1];
    capSentence = `They can ${joined}.`;
  }

  // ── module override note ─────────────────────────────────────────────────
  // Remind inviter that "Participates in" can further narrow access.
  let modulesNote = '';
  if (modules === 'metasift' && labAccess) {
    modulesNote = ' "Participates in Screening only" will hide the rest of the project for this user.';
  } else if (modules === 'metalab' && siftAccess) {
    modulesNote = ' "Participates in project only" will hide Screening for this user.';
  }

  return [accessSentence, capSentence, modulesNote].filter(Boolean).join(' ');
}

// Permission presets shown when adding a member (Task 9).
const ADD_PRESETS = [
  { value: 'reviewer',          label: 'Reviewer — screen + second review + chat' },
  { value: 'data_extractor',    label: 'Data Extractor — extraction + analysis' },
  { value: 'leader',            label: 'Leader — full control (except owner)' },
  { value: 'readonly_metasift', label: 'Read-only Screening' },
  { value: 'readonly_metalab',  label: 'Read-only project' },
  { value: 'readonly_both',     label: 'Read-only (both modules)' },
  { value: 'viewer',            label: 'Viewer — read-only both, can chat' },
];

// Which apps the new member participates in (prompt6 Task 6) — sent as
// modules:'metalab'|'metasift'|'both'; the server maps it onto the canView* flags.
const MODULE_OPTIONS = [
  { value: 'both',     label: 'Whole project (incl. Screening)' },
  { value: 'metalab',  label: 'Project only' },
  { value: 'metasift', label: 'Screening only' },
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
  // Invite payload from the 201 response (pending only, prompt9 Task 2):
  // { link, emailConfigured, emailSent, expiresAt } + the invited email.
  const [invite, setInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  const linkInputRef = useRef(null);

  async function submit(e) {
    e?.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) { setErr('Email is required.'); return; }
    if (!EMAIL_RE.test(trimmed)) { setErr('Enter a valid email address.'); return; }
    setSubmitting(true);
    setErr('');
    setPendingNote(false);
    setInvite(null);
    setCopied(false);
    try {
      const res = await screeningApi.addMember(pid, { email: trimmed, preset, modules });
      await onAdded();
      if (res?.pending) {
        // User not yet registered — show the invite panel, keep the modal open
        // so the leader can copy the link, and reset the field for another add.
        setPendingNote(true);
        if (res.invite) setInvite({ ...res.invite, email: trimmed });
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

  async function copyLink() {
    if (!invite?.link) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (http / permissions) — select() fallback.
      try {
        const el = linkInputRef.current;
        if (el) { el.focus(); el.select(); document.execCommand('copy'); setCopied(true); }
      } catch { /* leave the link selected for manual copy */ }
    }
    setTimeout(() => setCopied(false), 2000);
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
            Presets set permissions across the whole project, including Screening. Fine-tune per-member toggles after adding.
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
            Limits which app(s) the member can open; combined with the preset&apos;s permissions.
          </div>
        </div>

        {/* Plain-English summary — derived from both dropdowns so updates live */}
        {presetBlurb(preset, modules) && (
          <div style={{
            marginTop: 14,
            background: alpha(C.acc, '14'),
            border: `1px solid ${alpha(C.acc, '20')}`,
            borderRadius: 6,
            padding: '9px 12px',
            fontSize: 11.5,
            color: C.txt2,
            lineHeight: 1.65,
          }}>
            {presetBlurb(preset, modules)}
          </div>
        )}

        {pendingNote && (
          <div style={{
            marginTop: 14, background: alpha(C.ylw, '14'), border: `1px solid ${alpha(C.ylw, '40')}`,
            borderRadius: 6, padding: '10px 12px', fontSize: 12, lineHeight: 1.5,
          }}>
            <div style={{ color: C.ylw, fontWeight: 600, marginBottom: invite ? 6 : 0 }}>
              {invite
                ? (invite.emailSent
                    ? `Invite created — an email was sent to ${invite.email}.`
                    : invite.emailConfigured
                      ? `Invite created, but the email to ${invite.email} could not be sent.`
                      : 'Invite created — email is not configured on this server.')
                : 'Invite created — user not yet registered. They will join once they sign up with this email.'}
            </div>
            {invite && (
              <>
                <div style={{ color: C.txt2, marginBottom: 8 }}>
                  {invite.emailSent
                    ? 'You can also share this invite link directly:'
                    : 'Share this invite link with them instead:'}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={linkInputRef}
                    readOnly
                    value={invite.link || ''}
                    onFocus={e => e.target.select()}
                    style={{
                      flex: 1, minWidth: 0, background: C.card, border: `1px solid ${C.brd2}`,
                      borderRadius: 6, padding: '6px 9px', color: C.txt, fontSize: 11.5,
                      fontFamily: MONO, outline: 'none',
                    }}
                  />
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={copyLink}
                    style={{ padding: '6px 12px', fontSize: 12, color: copied ? C.grn : undefined }}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </Button>
                </div>
                {invite.expiresAt && (
                  <div style={{ color: C.muted, marginTop: 7, fontSize: 11.5 }}>
                    Link expires {fmtDate(invite.expiresAt)}.
                  </div>
                )}
              </>
            )}
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
