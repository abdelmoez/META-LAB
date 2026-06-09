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

const ROLES = ['leader', 'reviewer', 'viewer'];
const STATUSES = ['active', 'inactive', 'pending'];

function shapeMember(m, { blind = false, isLeaderViewer = false } = {}) {
  // In blind mode, non-leaders should not see who is who at the decision
  // level — but the roster itself (names/roles) stays visible so leaders can
  // manage and reviewers know the team. Decision anonymisation is enforced
  // separately at the decision/overview endpoints.
  return {
    id: m.id,
    userId: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    canScreen: m.canScreen,
    canChat: m.canChat,
    canResolveConflicts: m.canResolveConflicts,
    joinedAt: m.joinedAt,
    updatedAt: m.updatedAt,
  };
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
      members: members.map(m => shapeMember(m, { blind: access.project.blindMode })),
      myRole: access.role,
      isLeader: access.isLeader,
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

    const { email, role = 'reviewer', canScreen = true, canChat = true, canResolveConflicts = false } = req.body || {};
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'email is required' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' });
    const normEmail = String(email).trim().toLowerCase();

    const existing = await prisma.screenProjectMember.findFirst({
      where: { projectId: req.params.pid, email: normEmail },
    });
    if (existing) return res.status(409).json({ error: 'That email is already a member of this project' });

    // Link to a registered user when one exists; otherwise create a pending invite.
    const user = await findUserByEmail(normEmail);
    const member = await prisma.screenProjectMember.create({
      data: {
        projectId: req.params.pid,
        userId: user ? user.id : null,
        name: user?.name || '',
        email: normEmail,
        role,
        status: user ? 'active' : 'pending',
        canScreen: role === 'viewer' ? false : !!canScreen,
        canChat: !!canChat,
        canResolveConflicts: role === 'leader' ? true : !!canResolveConflicts,
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

    const { role, status, canScreen, canChat, canResolveConflicts } = req.body || {};
    const isOwnerRow = member.userId && member.userId === access.project.ownerId;
    // The project owner must remain an active leader.
    if (isOwnerRow && ((role && role !== 'leader') || (status && status !== 'active'))) {
      return res.status(400).json({ error: 'The project owner must remain an active leader' });
    }

    const data = {};
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
