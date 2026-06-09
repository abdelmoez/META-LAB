/**
 * MembersTab.jsx — META·SIFT project members & roles (Part 4).
 *
 * Roster of project members with leader-only management: add / remove members,
 * change role + status, and toggle per-member permissions (canScreen, canChat,
 * canResolveConflicts). Non-leaders see a read-only roster.
 *
 * Backend rules surfaced as inline errors (not pre-validated client-side):
 *   - 409 duplicate email on add
 *   - 400 "The project owner must remain an active leader" on role/status change
 *   - 400 "Cannot remove the project owner" on remove
 * The owner row cannot be reliably detected from the payload, so leader rows
 * are visually marked and rely on backend rejection.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import {
  Loading, ErrorBanner, Button, Badge, Avatar, Toggle, Modal, Card,
  Field, fieldLabel, fieldInput, EmptyState,
} from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

// ── role / status presentation ──────────────────────────────────────────────

const ROLE_COLOR = { leader: C.gold, reviewer: C.acc, viewer: C.muted };
const ROLE_LABEL = { leader: 'Leader', reviewer: 'Reviewer', viewer: 'Viewer' };

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
        boxShadow: on ? `0 0 0 2px ${C.grn}22` : 'none',
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
      setMyRole(data.myRole || null);
    } catch (e) {
      setError(e.message || 'Failed to load members.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  // Leader status: trust backend payload, fall back to access prop.
  const canManage = isLeader || !!access?.isLeader;

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

function MemberRow({ member, canManage, busy, rowErr, onPatch, onRemove }) {
  const m = member;
  const display = m.name || m.email || 'Unknown';
  const isLeaderRow = m.role === 'leader';
  const status = STATUS_META[m.status] || STATUS_META.inactive;
  const roleColor = ROLE_COLOR[m.role] || C.muted;

  return (
    <Card style={{
      padding: '14px 16px',
      borderColor: isLeaderRow ? C.gold + '40' : C.brd,
      opacity: m.status === 'inactive' ? 0.72 : 1,
    }}>
      {/* Top line: identity + badges + (leader) inline controls */}
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

        {/* Leader controls: role select + status toggle + remove */}
        {canManage ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select
              value={m.role}
              disabled={busy}
              onChange={e => onPatch({ role: e.target.value })}
              style={{ ...selectStyle, opacity: busy ? 0.6 : 1 }}
              title="Change role"
            >
              <option value="leader">Leader</option>
              <option value="reviewer">Reviewer</option>
              <option value="viewer">Viewer</option>
            </select>

            <Toggle
              checked={m.status === 'active'}
              disabled={busy || m.status === 'pending'}
              onChange={(next) => onPatch({ status: next ? 'active' : 'inactive' })}
              label={m.status === 'pending' ? undefined : (m.status === 'active' ? 'Active' : 'Inactive')}
            />

            {!isLeaderRow && (
              <Button variant="ghost" onClick={onRemove} disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }}>
                Remove
              </Button>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>
            joined {fmtDate(m.joinedAt)}
          </span>
        )}
      </div>

      {/* Permissions row */}
      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}`,
        display: 'flex', alignItems: 'center', gap: canManage ? 22 : 18, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: C.muted,
        }}>
          Permissions
        </span>

        {canManage
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

        {canManage && (
          <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: MONO, color: C.muted }}>
            joined {fmtDate(m.joinedAt)}
          </span>
        )}
      </div>

      {rowErr && (
        <div style={{
          marginTop: 12, background: '#450a0a', border: '1px solid #f8717150',
          borderRadius: 6, padding: '8px 12px', color: C.red, fontSize: 12,
        }}>
          {rowErr}
        </div>
      )}
    </Card>
  );
}

// ── AddMemberModal ──────────────────────────────────────────────────────────

function AddMemberModal({ pid, onClose, onAdded }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('reviewer');
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
      const res = await screeningApi.addMember(pid, { email: trimmed, role });
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
          <label style={fieldLabel}>Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            disabled={submitting}
            style={{ ...fieldInput, cursor: 'pointer' }}
          >
            <option value="reviewer">Reviewer — can screen records</option>
            <option value="viewer">Viewer — read-only access</option>
          </select>
        </div>

        {pendingNote && (
          <div style={{
            marginTop: 14, background: C.ylw + '14', border: `1px solid ${C.ylw}40`,
            borderRadius: 6, padding: '9px 12px', color: C.ylw, fontSize: 12, lineHeight: 1.5,
          }}>
            Invite created — user not yet registered. They will join once they sign up with this email.
          </div>
        )}

        {err && (
          <div style={{
            marginTop: 14, background: '#450a0a', border: '1px solid #f8717150',
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
