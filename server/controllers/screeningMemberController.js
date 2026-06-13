/**
 * screeningMemberController.js — META·SIFT project members & roles.
 *
 * Leader powers (Part 4): add / remove / change role / change status /
 * change permissions. Only the project leader may mutate membership.
 * Access to any of these endpoints requires owner-or-member access to the
 * project (null access → 404 to avoid leaking project existence).
 */
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { getProjectAccess, ensureLeaderMember, findUserByEmail, writeAudit } from '../screening/access.js';
import { PERMISSION_KEYS, GLOBAL_PERMISSION_KEYS, resolvePreset } from '../../src/research-engine/screening/permissionPresets.js';
import { createNotification, notifyProjectInvite } from '../services/notificationService.js';
import { emitToProjectMembers, emitToUsers } from '../realtime/bus.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { isEmailConfigured, sendEmail, renderInviteEmail } from '../services/emailService.js';
import { isValidEmail } from '../utils/validators.js';
import { recordUsage, USAGE } from '../utils/usage.js';

/** Read the admin appSettings blob — best-effort, defaults to {}. */
async function getAppSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
    return row ? JSON.parse(row.value || '{}') : {};
  } catch {
    return {};
  }
}

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
    // Format validation (prompt9) — BEFORE any lookup, so a malformed address
    // can never become a permanent pending row.
    if (!isValidEmail(String(email))) return res.status(400).json({ error: 'Invalid email address' });
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
    // Invite token ceremony (prompt9) — pending invites get a single-use,
    // expiring token. Only the SHA-256 hash is stored; the plaintext token
    // appears ONLY in this response to the authorized inviter (never logged).
    let inviteToken = null;
    let inviteExpiresAt = null;
    if (!user) {
      inviteToken = crypto.randomBytes(32).toString('hex');
      const siftSettings = await getMetaSiftSettings();
      const days = Number.isFinite(siftSettings.inviteExpiryDays) && siftSettings.inviteExpiryDays > 0
        ? siftSettings.inviteExpiryDays
        : 14;
      inviteExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
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
        ...(user ? {} : {
          invitedByUserId: req.user.id,
          inviteTokenHash: crypto.createHash('sha256').update(inviteToken).digest('hex'),
          inviteExpiresAt,
        }),
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
    // Pending invite (prompt9): best-effort invite email + copyable-link
    // fallback. Email failure NEVER fails the request — the response carries
    // {emailConfigured, emailSent} so the inviter UI can show the right notice
    // (contact-reply precedent). The plaintext token lives only in `link`.
    let invite;
    if (!user) {
      const base = (process.env.APP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
      const link = `${base}/invite/${inviteToken}`;
      const emailConfigured = isEmailConfigured();
      let emailSent = false;
      try {
        const appSettings = await getAppSettings();
        if (appSettings.emailInvitesEnabled !== false && emailConfigured) {
          const inviterName = req.user.name || (req.user.email || '').split('@')[0] || 'A project manager';
          const { html, text } = renderInviteEmail({
            projectName: access.project.title,
            inviterName,
            roleLabel: presetName,
            link,
            expiresAt: inviteExpiresAt,
          });
          // EMAIL_SENT / EMAIL_FAILED usage is recorded inside sendEmail
          // itself (prompt9, single chokepoint) — do NOT double-record here.
          const result = await sendEmail({
            to: normEmail,
            subject: `You're invited to join "${access.project.title || 'a project'}" on META·LAB`,
            html,
            text,
            context: 'invite',
          });
          emailSent = !!result.sent;
        }
      } catch { /* invite email is best-effort — never fail addMember */ }
      invite = { link, emailConfigured, emailSent, expiresAt: inviteExpiresAt };
      recordUsage({
        type: USAGE.INVITE_CREATED,
        userId: req.user.id,
        screenProjectId: req.params.pid,
        meta: { role, preset: presetName },
      });
    }
    // Realtime poke (Task 7) — emit-time resolution already includes the new member.
    emitToProjectMembers(req.params.pid, { type: 'members.changed' }, { exclude: req.user.id });
    res.status(201).json({
      member: shapeMember(member, access.project.ownerId),
      pending: !user,
      ...(invite ? { invite } : {}),   // additive — only present for pending invites
    });
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
    // Removing a pending row IS the invite-revoke path (prompt9) — the token
    // hash dies with the row, so the invite link instantly turns 404.
    if (member.status === 'pending') {
      await writeAudit(req.params.pid, req.user, 'INVITE_REVOKED', {
        entityType: 'member', entityId: member.id, details: { email: member.email },
      });
      recordUsage({
        type: USAGE.INVITE_REVOKED,
        userId: req.user.id,
        screenProjectId: req.params.pid,
        meta: { email: member.email },
      });
    }
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

/**
 * POST /api/screening/projects/:pid/leave — self-service exit (prompt9).
 * Any non-owner member may remove their OWN member row. The owner gets 400
 * (transfer ownership first). Non-members get the standard 404 existence
 * hiding via getProjectAccess.
 */
export async function leaveProject(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (access.isOwner) {
      return res.status(400).json({ error: 'The owner cannot leave the project (use transfer ownership instead)' });
    }
    const member = access.member;
    if (!member) return res.status(404).json({ error: 'Project not found' });

    await prisma.screenProjectMember.delete({ where: { id: member.id } });
    await writeAudit(req.params.pid, req.user, 'MEMBER_LEFT', {
      entityType: 'member', entityId: member.id, details: { email: member.email, role: member.role },
    });
    recordUsage({
      type: USAGE.MEMBER_LEFT,
      userId: req.user.id,
      screenProjectId: req.params.pid,
      meta: { role: member.role },
    });
    // Realtime pokes (mirror removeMember): roster change for the remaining
    // members; a user-TARGETED permissions.changed so the leaver's other open
    // tabs revalidate (their refetch will 404 → "access changed" + navigate).
    emitToProjectMembers(req.params.pid, { type: 'members.changed' }, { exclude: req.user.id });
    emitToUsers([req.user.id], { type: 'permissions.changed', projectId: req.params.pid });
    res.json({ left: true });
  } catch (err) {
    console.error('[screening] leaveProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
