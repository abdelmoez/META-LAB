/**
 * screeningMemberController.js — META·SIFT project members & roles.
 *
 * Leader powers (Part 4): add / remove / change role / change status /
 * change permissions. Only the project leader may mutate membership.
 * Access to any of these endpoints requires owner-or-member access to the
 * project (null access → 404 to avoid leaking project existence).
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, ensureLeaderMember, findUserByEmail, writeAudit } from '../screening/access.js';
import { PERMISSION_KEYS, GLOBAL_PERMISSION_KEYS, resolvePreset } from '../../src/research-engine/screening/permissionPresets.js';
import { createNotification, notifyProjectInvite } from '../services/notificationService.js';
import { emitToProjectMembers, emitToUsers } from '../realtime/bus.js';

// Optional `modules` values for addMember (prompt6 Task 6): which app(s) the
// new member participates in, mapped onto the canView* flags atop the preset.
const MODULES = ['metalab', 'metasift', 'both'];

// 'owner' is intentionally NOT assignable here — ownership is fixed to the
// project creator (changed only via an explicit transfer-ownership action).
const ROLES = ['leader', 'reviewer', 'viewer'];
const STATUSES = ['active', 'inactive', 'pending'];

function shapeMember(m, ownerId) {
  const isOwner = m.role === 'owner' || (!!ownerId && m.userId === ownerId);
  const out = {
    id: m.id, userId: m.userId, name: m.name, email: m.email,
    role: m.role, status: m.status,
    isOwner,                       // prompt5 Task 1/2 — flag the owner row distinctly
    isLeader: m.role === 'leader', // a leader is NOT the owner
    canScreen: m.canScreen, canChat: m.canChat, canResolveConflicts: m.canResolveConflicts,
    permissionPreset: m.permissionPreset,
    joinedAt: m.joinedAt, updatedAt: m.updatedAt,
  };
  for (const k of PERMISSION_KEYS) out[k] = !!m[k];
  return out;
}

export async function listMembers(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    // Self-heal: guarantee the owner shows up as leader.
    await ensureLeaderMember(access.project);
    const members = await prisma.screenProjectMember.findMany({
      where: { projectId: req.params.pid },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    const ownerId = access.project.ownerId;
    res.json({
      members: members.map(m => shapeMember(m, ownerId)),
      myRole: access.role,
      myUserId: req.user.id,
      ownerId,
      isLeader: access.isLeader,
      isOwner: access.isOwner,
      canManageMembers: access.canManageMembers,
    });
  } catch (err) {
    console.error('[screening] listMembers:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function addMember(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    // Owner, leader, or a member granted canManageMembers may add members (Task 6).
    if (!access.canManageMembers) return res.status(403).json({ error: 'You do not have permission to add members' });
    await ensureLeaderMember(access.project);

    const { email } = req.body || {};
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'email is required' });
    const normEmail = String(email).trim().toLowerCase();
    // Accept `preset` (prompt4 Task 9) or a legacy `role` (reviewer|viewer|leader,
    // which are also valid preset keys) for backward compatibility.
    const presetName = req.body.preset || req.body.role || 'reviewer';

    const existing = await prisma.screenProjectMember.findFirst({
      where: { projectId: req.params.pid, email: normEmail },
    });
    if (existing) return res.status(409).json({ error: 'That email is already a member of this project' });

    // Resolve the permission preset → role + module flags (prompt4 Task 9).
    const { role, perms } = resolvePreset(presetName);
    // Optional module scoping (prompt6 Task 6): 'metalab' | 'metasift' | 'both'
    // maps onto the canView* flags on top of the preset. Absent → preset as-is.
    const { modules } = req.body || {};
    if (modules !== undefined) {
      if (!MODULES.includes(modules)) {
        return res.status(400).json({ error: "invalid modules (use 'metalab', 'metasift' or 'both')" });
      }
      perms.canViewMetaLab  = modules === 'metalab'  || modules === 'both';
      perms.canViewMetaSift = modules === 'metasift' || modules === 'both';
      // canEditMetaLab implies META·LAB view access (metalabAccess.js) — clear
      // it when META·LAB participation is excluded.
      if (modules === 'metasift') perms.canEditMetaLab = false;
    }
    // Only the OWNER may grant the Leader role (Task 2: leader is an ownership-level
    // decision — a leader cannot mint other leaders).
    if (role === 'leader' && !access.isOwner) {
      return res.status(403).json({ error: 'Only the owner can add a Leader' });
    }
    // 'owner' is never assignable through this endpoint.
    if (role === 'owner') return res.status(400).json({ error: 'Ownership cannot be assigned here' });
    // Link to a registered user when one exists; otherwise create a pending invite.
    const user = await findUserByEmail(normEmail);
    const member = await prisma.screenProjectMember.create({
      data: {
        projectId: req.params.pid,
        userId: user ? user.id : null,
        name: user?.name || '',
        email: normEmail,
        role: ROLES.includes(role) ? role : 'reviewer',
        status: user ? 'active' : 'pending',
        permissionPreset: presetName,
        canScreen: !!perms.canScreen,
        canChat: !!perms.canChat,
        canResolveConflicts: !!perms.canResolveConflicts,
        ...Object.fromEntries(PERMISSION_KEYS.map(k => [k, !!perms[k]])),
      },
    });
    await writeAudit(req.params.pid, req.user, 'MEMBER_ADDED', {
      entityType: 'member', entityId: member.id, details: { email: normEmail, role, preset: presetName, pending: !user },
    });
    // Invite notification for already-registered users (prompt6 Task 1) — pending
    // email-only invites are notified by the claim-on-register hook instead.
    // Best-effort fire-and-forget: never fails or slows the add-member response.
    if (member.userId) {
      notifyProjectInvite({ member, project: access.project, actor: req.user, roleLabel: presetName }).catch(() => {});
    }
    // Realtime poke (Task 7) — emit-time resolution already includes the new member.
    emitToProjectMembers(req.params.pid, { type: 'members.changed' }, { exclude: req.user.id });
    res.status(201).json({ member: shapeMember(member, access.project.ownerId), pending: !user });
  } catch (err) {
    console.error('[screening] addMember:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateMember(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    // Owner, leader, or a member granted canManageMembers may change members (Task 6).
    if (!access.canManageMembers) return res.status(403).json({ error: 'You do not have permission to change members' });

    const member = await prisma.screenProjectMember.findFirst({
      where: { id: req.params.mid, projectId: req.params.pid },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const { role, status, preset, canScreen, canChat, canResolveConflicts } = req.body || {};
    const isOwnerRow  = (member.userId && member.userId === access.project.ownerId) || member.role === 'owner';
    const isLeaderRow = member.role === 'leader';
    // Self-target guard (Task 2): a member-manager manages OTHERS, not themselves —
    // a non-owner cannot widen their own role/permissions. (The owner edits their
    // own row only under the owner-row constraints below.)
    const isSelf = (access.member && member.id === access.member.id) || (member.userId && member.userId === req.user.id);
    if (isSelf && !access.isOwner) {
      return res.status(403).json({ error: 'You cannot change your own role or permissions' });
    }
    // Owner protection (Task 1/2): the owner row is LOCKED. Only the owner may touch
    // it, and never to demote/deactivate (use a transfer-ownership flow instead).
    if (isOwnerRow) {
      if (!access.isOwner) return res.status(403).json({ error: 'Owner permissions cannot be changed here' });
      if ((role && role !== 'owner') || (status && status !== 'active')) {
        return res.status(400).json({ error: 'The owner must remain an active owner (use transfer ownership instead)' });
      }
    }
    // Leader rows are LOCKED to everyone except the owner (Task 2): a normal leader
    // cannot change another leader's role, status, or permissions.
    if (isLeaderRow && !isOwnerRow && !access.isOwner) {
      return res.status(403).json({ error: 'Only the owner can change a leader’s role, status, or permissions' });
    }
    // Promoting a member TO leader is an ownership-level decision (owner only).
    const promotesToLeader = role === 'leader' || (preset !== undefined && resolvePreset(preset).role === 'leader');
    if (promotesToLeader && !access.isOwner) {
      return res.status(403).json({ error: 'Only the owner can promote a member to Leader' });
    }
    // Granting leader-level GLOBAL powers (manage members/settings) is owner-only,
    // whether via raw flags or a preset — otherwise a canManageMembers delegate could
    // mint other managers (privilege escalation).
    const presetGrantsGlobal = preset !== undefined && GLOBAL_PERMISSION_KEYS.some(k => resolvePreset(preset).perms[k]);
    const bodyGrantsGlobal = GLOBAL_PERMISSION_KEYS.some(k => req.body[k] === true);
    if ((presetGrantsGlobal || bodyGrantsGlobal) && !access.isOwner) {
      return res.status(403).json({ error: 'Only the owner can grant member- or settings-management powers' });
    }

    const data = {};
    // Preset applies a full module-permission template + role.
    if (preset !== undefined) {
      const r = resolvePreset(preset);
      data.permissionPreset = preset;
      if (ROLES.includes(r.role)) data.role = r.role;
      for (const k of PERMISSION_KEYS) {
        // Non-owners can never change the leader-level global flags (set or clear).
        if (GLOBAL_PERMISSION_KEYS.includes(k) && !access.isOwner) continue;
        data[k] = !!r.perms[k];
      }
      data.canScreen = !!r.perms.canScreen;
      data.canChat = !!r.perms.canChat;
      data.canResolveConflicts = !!r.perms.canResolveConflicts;
    }
    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' });
      data.role = role;
      if (role === 'viewer') data.canScreen = false;
      if (role === 'leader') data.canResolveConflicts = true;
    }
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
      data.status = status;
    }
    if (canScreen !== undefined) data.canScreen = !!canScreen;
    if (canChat !== undefined) data.canChat = !!canChat;
    if (canResolveConflicts !== undefined) data.canResolveConflicts = !!canResolveConflicts;
    // Individual module-permission overrides (advanced). Global management flags are
    // owner-only (guarded above) — never writable by a non-owner via raw flags.
    for (const k of PERMISSION_KEYS) {
      if (req.body[k] === undefined) continue;
      if (GLOBAL_PERMISSION_KEYS.includes(k) && !access.isOwner) continue;
      data[k] = !!req.body[k];
    }

    const updated = await prisma.screenProjectMember.update({ where: { id: member.id }, data });
    await writeAudit(req.params.pid, req.user, 'MEMBER_PERMISSIONS_CHANGED', {
      entityType: 'member', entityId: member.id,
      details: { email: member.email, before: { role: member.role, status: member.status }, changes: data },
    });
    // ROLE_CHANGED notification on a REAL role/preset change (prompt6 Task 1) —
    // best-effort fire-and-forget; skipped for unclaimed invites (no userId) and
    // for actors changing their own row.
    const roleChanged = updated.role !== member.role || updated.permissionPreset !== member.permissionPreset;
    if (roleChanged && updated.userId && updated.userId !== req.user.id) {
      const p = access.project;
      const newLabel = updated.permissionPreset || updated.role;
      createNotification({
        userId: updated.userId,
        type: 'ROLE_CHANGED',
        title: `Role updated in "${p.title || 'Untitled project'}"`,
        message: `${req.user.email || 'A project manager'} changed your role to ${newLabel}`,
        app: p.linkedMetaLabProjectId ? 'workspace' : 'metasift',
        relatedScreenProjectId: p.id,
        relatedMetaLabProjectId: p.linkedMetaLabProjectId || null,
        actorId: req.user.id,
        actorEmail: req.user.email || '',
        role: newLabel,
      }).catch(() => {});
    }
    // Realtime pokes (Task 7): roster change for everyone; a user-TARGETED
    // permissions.changed for the affected member so their open UI revalidates
    // immediately (refetch 403s → "access changed" + navigate away).
    emitToProjectMembers(req.params.pid, { type: 'members.changed' }, { exclude: req.user.id });
    if (updated.userId && updated.userId !== req.user.id && Object.keys(data).length) {
      emitToUsers([updated.userId], { type: 'permissions.changed', projectId: req.params.pid });
    }
    res.json({ member: shapeMember(updated, access.project.ownerId) });
  } catch (err) {
    console.error('[screening] updateMember:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function removeMember(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageMembers) return res.status(403).json({ error: 'You do not have permission to remove members' });

    const member = await prisma.screenProjectMember.findFirst({
      where: { id: req.params.mid, projectId: req.params.pid },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if ((member.userId && member.userId === access.project.ownerId) || member.role === 'owner') {
      return res.status(400).json({ error: 'The owner cannot be removed' });
    }
    // Removing a leader is owner-only (Task 2): leaders can't remove other leaders.
    if (member.role === 'leader' && !access.isOwner) {
      return res.status(403).json({ error: 'Only the owner can remove a leader' });
    }
    await prisma.screenProjectMember.delete({ where: { id: member.id } });
    await writeAudit(req.params.pid, req.user, 'MEMBER_REMOVED', {
      entityType: 'member', entityId: member.id, details: { email: member.email },
    });
    // Realtime pokes (Task 7): emit-time resolution already EXCLUDES the removed
    // member from members.changed; target them directly so their open UI
    // revalidates (the refetch will 404 → "access changed" + navigate away).
    emitToProjectMembers(req.params.pid, { type: 'members.changed' }, { exclude: req.user.id });
    if (member.userId && member.userId !== req.user.id) {
      emitToUsers([member.userId], { type: 'permissions.changed', projectId: req.params.pid });
    }
    res.status(204).send();
  } catch (err) {
    console.error('[screening] removeMember:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
