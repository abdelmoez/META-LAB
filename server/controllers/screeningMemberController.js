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
import { touchProjectActivity } from '../store.js';
import { getProjectAccess, ensureLeaderMember, findUserByEmail, writeAudit } from '../screening/access.js';
import { PERMISSION_KEYS, GLOBAL_PERMISSION_KEYS, resolvePreset, fullPermissions } from '../../src/research-engine/screening/permissionPresets.js';
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

function shapeMember(m, ownerId, liveById) {
  const isOwner = m.role === 'owner' || (!!ownerId && m.userId === ownerId);
  // prompt25 Task 5 — prefer the LIVE User name/email over the denormalized member
  // row, so renaming yourself updates everywhere (owner + member display) at once.
  // Pending invites have no userId yet → keep the stored email.
  const live = (m.userId && liveById) ? liveById.get(m.userId) : null;
  const out = {
    id: m.id, userId: m.userId,
    name: (live && live.name) || m.name,
    email: (live && live.email) || m.email,
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
    // prompt25 Task 5 — resolve LIVE names for members that map to a real user.
    const userIds = [...new Set(members.map(m => m.userId).filter(Boolean))];
    const liveUsers = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const liveById = new Map(liveUsers.map(u => [u.id, u]));
    res.json({
      members: members.map(m => shapeMember(m, ownerId, liveById)),
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

/**
 * GET /projects/:pid/members/lookup?email=  (prompt33 Task 2)
 * Project-scoped lookup so Add Member can show whether the email belongs to a
 * registered user (and their name) BEFORE deciding add-vs-invite. Permission-gated
 * (canManageMembers) so it never becomes an open user-enumeration endpoint, and it
 * returns only minimal safe fields (id, name, email). Never leaks all users.
 * Responses: { found:false } | { found:true, alreadyMember:false, user } |
 *            { found:true, alreadyMember:true, currentRole, user }.
 */
export async function lookupUser(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageMembers) return res.status(403).json({ error: 'You do not have permission to look up users' });

    const email = String(req.query.email || '').trim();
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
    const normEmail = email.toLowerCase();

    const user = await findUserByEmail(normEmail);
    // Existing membership? Match by linked user id (registered) OR email (covers a
    // PENDING invite for an email that is not yet a registered account → userId null).
    const existing = await prisma.screenProjectMember.findFirst({
      where: { projectId: req.params.pid, OR: [...(user ? [{ userId: user.id }] : []), { email: normEmail }] },
      select: { role: true, status: true },
    });

    if (!user) {
      // Unregistered email. If it already has an outstanding invite/member row, say
      // so (so the modal disables "Send invite" instead of 409-ing on submit).
      if (existing) return res.json({ found: false, pendingInvite: true, currentRole: existing.role, status: existing.status });
      return res.json({ found: false });
    }

    const safeUser = { id: user.id, name: user.name || '', email: user.email };
    if (existing) {
      return res.json({ found: true, alreadyMember: true, currentRole: existing.role, status: existing.status, user: safeUser });
    }
    return res.json({ found: true, alreadyMember: false, user: safeUser });
  } catch (err) {
    console.error('[screening] lookupUser:', err.message);
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
    void touchProjectActivity(access.project.linkedMetaLabProjectId); // prompt50 WS5 — member change = activity
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
            subject: `You're invited to join "${access.project.title || 'a project'}" on PecanRev`,
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
    // prompt50 WS6 — make a chat-permission change explicit in the audit trail
    // (acting user, affected member, project, previous → new, timestamp).
    const chatChanged = data.canChat !== undefined && !!data.canChat !== !!member.canChat;
    await writeAudit(req.params.pid, req.user, 'MEMBER_PERMISSIONS_CHANGED', {
      entityType: 'member', entityId: member.id,
      details: {
        email: member.email,
        before: { role: member.role, status: member.status, canChat: !!member.canChat },
        changes: data,
        ...(chatChanged ? { chatPermission: { from: !!member.canChat, to: !!data.canChat } } : {}),
      },
    });
    // prompt50 WS5 — a member/permission change is meaningful activity on the
    // linked META·LAB project (cross-workstream timestamp). Best-effort.
    void touchProjectActivity(access.project.linkedMetaLabProjectId);
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
    // prompt33 review fix — resolve the LIVE user name/email (mirrors listMembers) so
    // the client's in-place reconcile never overwrites a fresh self-renamed name with
    // the denormalized member-row value.
    let liveById = null;
    if (updated.userId) {
      const lu = await prisma.user.findUnique({ where: { id: updated.userId }, select: { id: true, name: true, email: true } });
      if (lu) liveById = new Map([[lu.id, lu]]);
    }
    res.json({ member: shapeMember(updated, access.project.ownerId, liveById) });
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
    void touchProjectActivity(access.project.linkedMetaLabProjectId); // prompt50 WS5 — member change = activity
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

/**
 * POST /api/screening/projects/:pid/transfer-owner — owner-only (prompt11).
 *
 * Hands the workspace to another ACTIVE member. Preserves the
 * `ScreenProject.ownerId === linked Project.userId` invariant by moving the
 * linked META·LAB project's userId along with the workspace ownerId, but ONLY
 * when that META·LAB project is linked to exactly ONE live workspace (a project
 * shared by >1 workspace cannot have a single owner → 409).
 *
 * The old owner is demoted to an ACTIVE leader (full perms) so they keep access
 * and can subsequently leave; the new owner's member row is promoted to 'owner'
 * with full perms. Body: { toUserId }. Responds { ok:true, ownerId }.
 */
export async function transferOwner(req, res) {
  try {
    const pid = req.params.pid;
    const access = await getProjectAccess(pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isOwner) return res.status(403).json({ error: 'Only the owner can transfer ownership' });

    const { toUserId } = req.body || {};
    if (!toUserId || !String(toUserId).trim()) {
      return res.status(400).json({ error: 'toUserId is required' });
    }
    const oldOwnerId = access.project.ownerId;
    if (toUserId === oldOwnerId) {
      return res.status(400).json({ error: 'That user is already the owner' });
    }

    // The new owner must be an ACTIVE member of THIS workspace with a real userId
    // (no pending invites, no email-only rows).
    const targetMember = await prisma.screenProjectMember.findFirst({
      where: { projectId: pid, userId: toUserId, status: 'active' },
    });
    if (!targetMember) {
      return res.status(400).json({ error: 'New owner must be an active member of this workspace' });
    }
    const targetUser = await prisma.user.findUnique({ where: { id: toUserId } });
    if (!targetUser) {
      return res.status(400).json({ error: 'New owner must be an active member of this workspace' });
    }

    // Linked META·LAB project moves with the workspace — but only if it is NOT
    // shared by multiple live workspaces (the invariant ownerId === userId can't
    // hold for more than one owner).
    const linkedId = access.project.linkedMetaLabProjectId;
    if (linkedId) {
      const liveCount = await prisma.screenProject.count({
        where: { linkedMetaLabProjectId: linkedId, deletedAt: null },
      });
      if (liveCount > 1) {
        return res.status(409).json({
          error: "This project's analysis is shared by multiple workspaces; ownership transfer isn't supported in that configuration.",
        });
      }
    }

    const full = fullPermissions();
    const oldOwnerName  = req.user.name || '';
    const oldOwnerEmail = req.user.email || '';

    await prisma.$transaction(async (tx) => {
      // 1. Flip the workspace owner.
      await tx.screenProject.update({ where: { id: pid }, data: { ownerId: toUserId } });

      // 2. Move the linked META·LAB project's userId too (guarded by the old
      //    owner so a concurrent change can't clobber it) — keeps the invariant.
      if (linkedId) {
        await tx.project.updateMany({
          where: { id: linkedId, userId: oldOwnerId },
          data: { userId: toUserId },
        });
      }

      // 3. Promote the new owner's member row → owner, full perms.
      await tx.screenProjectMember.update({
        where: { id: targetMember.id },
        data: {
          role: 'owner', permissionPreset: 'owner', status: 'active',
          canScreen: true, canChat: true, canResolveConflicts: true, ...full,
        },
      });

      // 4. Demote the old owner → active leader (full perms) so they keep access
      //    and can later leave. Create the row if it never existed.
      const oldRow = await tx.screenProjectMember.findFirst({
        where: { projectId: pid, userId: oldOwnerId },
      });
      const leaderData = {
        role: 'leader', permissionPreset: 'leader', status: 'active',
        canScreen: true, canChat: true, canResolveConflicts: true, ...full,
      };
      if (oldRow) {
        await tx.screenProjectMember.update({ where: { id: oldRow.id }, data: leaderData });
      } else {
        await tx.screenProjectMember.create({
          data: {
            projectId: pid,
            userId: oldOwnerId,
            name: oldOwnerName,
            email: oldOwnerEmail,
            ...leaderData,
          },
        });
      }
    });

    await writeAudit(pid, req.user, 'OWNERSHIP_TRANSFERRED', {
      details: { from: oldOwnerId, to: toUserId, metaLabProjectId: linkedId || null },
    });
    recordUsage({
      type: USAGE.OWNERSHIP_TRANSFERRED,
      userId: req.user.id,
      screenProjectId: pid,
      metaLabProjectId: linkedId || null,
    });

    // Realtime pokes: roster changed for everyone; both the old and new owner get
    // a targeted permissions.changed so their open UIs revalidate immediately.
    emitToProjectMembers(pid, { type: 'members.changed' }, { exclude: req.user.id });
    emitToUsers([oldOwnerId, toUserId], { type: 'permissions.changed', projectId: pid });

    res.json({ ok: true, ownerId: toUserId });
  } catch (err) {
    console.error('[screening] transferOwner:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
