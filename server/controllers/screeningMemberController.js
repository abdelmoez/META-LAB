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
import { PERMISSION_KEYS, resolvePreset } from '../../src/research-engine/screening/permissionPresets.js';

// 'owner' is intentionally NOT assignable here — ownership is fixed to the
// project creator (changed only via an explicit transfer-ownership action).
const ROLES = ['leader', 'reviewer', 'viewer'];
const STATUSES = ['active', 'inactive', 'pending'];

function shapeMember(m) {
  const out = {
    id: m.id, userId: m.userId, name: m.name, email: m.email,
    role: m.role, status: m.status,
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
    res.json({
      members: members.map(shapeMember),
      myRole: access.role,
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
    if (!access.isLeader) return res.status(403).json({ error: 'Only the project leader can add members' });
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
      entityType: 'member', entityId: member.id, details: { email: normEmail, role, pending: !user },
    });
    res.status(201).json({ member: shapeMember(member), pending: !user });
  } catch (err) {
    console.error('[screening] addMember:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateMember(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isLeader) return res.status(403).json({ error: 'Only the project leader can change members' });

    const member = await prisma.screenProjectMember.findFirst({
      where: { id: req.params.mid, projectId: req.params.pid },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const { role, status, preset, canScreen, canChat, canResolveConflicts } = req.body || {};
    const isOwnerRow = (member.userId && member.userId === access.project.ownerId) || member.role === 'owner';
    // Owner protection (prompt4 Task 8/12): the owner row cannot be modified by a
    // leader, and can never be demoted/deactivated. Only the owner may touch it,
    // and even then not to change role/status away from owner/active.
    if (isOwnerRow) {
      if (!access.isOwner) return res.status(403).json({ error: 'Only the owner can change the owner record' });
      if ((role && role !== 'owner') || (status && status !== 'active')) {
        return res.status(400).json({ error: 'The owner must remain an active owner (use transfer ownership instead)' });
      }
    }

    const data = {};
    // Preset applies a full module-permission template + role.
    if (preset !== undefined) {
      const r = resolvePreset(preset);
      data.permissionPreset = preset;
      if (ROLES.includes(r.role)) data.role = r.role;
      for (const k of PERMISSION_KEYS) data[k] = !!r.perms[k];
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
    // Individual module-permission overrides (advanced).
    for (const k of PERMISSION_KEYS) {
      if (req.body[k] !== undefined) data[k] = !!req.body[k];
    }

    const updated = await prisma.screenProjectMember.update({ where: { id: member.id }, data });
    await writeAudit(req.params.pid, req.user, 'MEMBER_UPDATED', {
      entityType: 'member', entityId: member.id, details: data,
    });
    res.json({ member: shapeMember(updated) });
  } catch (err) {
    console.error('[screening] updateMember:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function removeMember(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isLeader) return res.status(403).json({ error: 'Only the project leader can remove members' });

    const member = await prisma.screenProjectMember.findFirst({
      where: { id: req.params.mid, projectId: req.params.pid },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.userId && member.userId === access.project.ownerId) {
      return res.status(400).json({ error: 'Cannot remove the project owner' });
    }
    await prisma.screenProjectMember.delete({ where: { id: member.id } });
    await writeAudit(req.params.pid, req.user, 'MEMBER_REMOVED', {
      entityType: 'member', entityId: member.id, details: { email: member.email },
    });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] removeMember:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
