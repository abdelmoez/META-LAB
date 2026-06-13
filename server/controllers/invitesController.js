/**
 * server/controllers/invitesController.js — public invite endpoints (prompt9).
 *
 * Mounted at /api/invites OUTSIDE the screening router (which is requireAuth +
 * 503-flag gated) because GET /:token must work pre-auth for the invite
 * landing page. The mount carries its own rate limiter (server/index.js).
 *
 * Security model:
 *   - Tokens are 32-byte CSPRNG hex; only the SHA-256 hash is stored
 *     (ScreenProjectMember.inviteTokenHash, plain-indexed). Lookup = hash & match
 *     via findFirst (256-bit random tokens make collisions impossible; single-use
 *     nulling enforces at-most-one-active per token, so no DB unique constraint).
 *   - Single-use: accept nulls the hash and stamps inviteAcceptedAt.
 *   - Not-found, revoked (row deleted) and already-accepted are
 *     INDISTINGUISHABLE: same 404 body. Expired is 410 (the link holder
 *     already knows the invite existed — expiry is not an oracle).
 *   - Responses carry NO account-existence info and no ids beyond what the
 *     landing page needs; the invited email is masked.
 */
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { notifyProjectInvite } from '../services/notificationService.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { writeAudit } from '../screening/access.js';
import { recordUsage, USAGE } from '../utils/usage.js';

const INVALID_BODY = { error: 'This invite is invalid or no longer available' };
const EXPIRED_BODY = { error: 'This invite has expired' };

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/** Mask an email for the public landing page: jane@example.com → j***@e***.com */
function maskEmail(email) {
  const raw = String(email || '');
  const at = raw.indexOf('@');
  if (at <= 0) return '';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const domName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const mask = (s) => (s ? `${s[0]}***` : '***');
  return `${mask(local)}@${mask(domName)}${tld}`;
}

/** Inviter display name: user name, else email local part, else generic. */
function inviterDisplayName(user) {
  if (user?.name && user.name.trim()) return user.name.trim();
  const local = String(user?.email || '').split('@')[0];
  return local || 'A project manager';
}

/**
 * Resolve a token to its pending member row.
 * Returns { status: 'invalid' | 'expired' | 'ok', member? }.
 * invalid covers: no row (never existed / revoked / already accepted —
 * accept nulls the hash), or a row that is not claimable.
 */
async function resolveInvite(token) {
  if (!token || typeof token !== 'string' || token.length > 256) return { status: 'invalid' };
  const member = await prisma.screenProjectMember.findFirst({
    where: { inviteTokenHash: hashToken(token) },
  });
  if (!member) return { status: 'invalid' };
  // A row that still carries a hash but is already bound/accepted is not claimable.
  if (member.inviteAcceptedAt || member.status !== 'pending') return { status: 'invalid' };
  if (member.inviteExpiresAt && member.inviteExpiresAt.getTime() < Date.now()) {
    return { status: 'expired' };
  }
  return { status: 'ok', member };
}

/**
 * GET /api/invites/:token (PUBLIC — no auth).
 * Sanitized landing-page info only. 404 invalid/revoked/accepted, 410 expired.
 */
export async function getInvite(req, res) {
  try {
    const { status, member } = await resolveInvite(req.params.token);
    if (status === 'invalid') return res.status(404).json(INVALID_BODY);
    if (status === 'expired') return res.status(410).json(EXPIRED_BODY);

    const [project, inviter] = await Promise.all([
      prisma.screenProject.findUnique({ where: { id: member.projectId } }),
      member.invitedByUserId
        ? prisma.user.findUnique({ where: { id: member.invitedByUserId } })
        : Promise.resolve(null),
    ]);
    if (!project) return res.status(404).json(INVALID_BODY);

    res.json({
      projectName: project.title || 'Untitled project',
      inviterName: inviterDisplayName(inviter),
      roleLabel: member.permissionPreset || member.role || 'member',
      email: maskEmail(member.email),
      expiresAt: member.inviteExpiresAt,
    });
  } catch (err) {
    console.error('[invites] getInvite:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/invites/:token/accept (requireAuth).
 * Binds the pending row to the logged-in user (single-use: nulls the hash).
 * If the user already has a member row in the project (invited under a
 * different email), the invite is consumed and we still return success
 * pointing at the project. Returns { projectId, projectName }.
 */
export async function acceptInvite(req, res) {
  try {
    const { status, member } = await resolveInvite(req.params.token);
    if (status === 'invalid') return res.status(404).json(INVALID_BODY);
    if (status === 'expired') return res.status(410).json(EXPIRED_BODY);

    const project = await prisma.screenProject.findUnique({ where: { id: member.projectId } });
    if (!project) return res.status(404).json(INVALID_BODY);

    // Already a member under another email/row? Consume the invite (single-use)
    // without creating a second membership and point them at the project.
    const existing = await prisma.screenProjectMember.findFirst({
      where: { projectId: member.projectId, userId: req.user.id },
    });
    if (existing) {
      await prisma.screenProjectMember.update({
        where: { id: member.id },
        data: { inviteTokenHash: null, inviteAcceptedAt: new Date() },
      });
      recordUsage({
        type: USAGE.INVITE_ACCEPTED,
        userId: req.user.id,
        screenProjectId: member.projectId,
        meta: { via: 'accept', alreadyMember: true },
      });
      return res.json({ projectId: project.id, projectName: project.title || 'Untitled project' });
    }

    const accepter = await prisma.user.findUnique({ where: { id: req.user.id } });
    const updated = await prisma.screenProjectMember.update({
      where: { id: member.id },
      data: {
        userId: req.user.id,
        name: member.name || accepter?.name || '',
        status: 'active',
        inviteAcceptedAt: new Date(),
        inviteTokenHash: null, // single-use — the link dies here
      },
    });

    await writeAudit(member.projectId, req.user, 'INVITE_ACCEPTED', {
      entityType: 'member', entityId: updated.id, details: { email: member.email },
    });
    recordUsage({
      type: USAGE.INVITE_ACCEPTED,
      userId: req.user.id,
      screenProjectId: member.projectId,
      meta: { via: 'accept' },
    });
    // In-app welcome notification — now with a real inviter (invitedByUserId).
    // Best-effort fire-and-forget, mirrors addMember.
    (async () => {
      const inviter = member.invitedByUserId
        ? await prisma.user.findUnique({ where: { id: member.invitedByUserId } })
        : null;
      await notifyProjectInvite({
        member: updated,
        project,
        actor: inviter ? { id: inviter.id, name: inviter.name, email: inviter.email } : undefined,
        roleLabel: updated.permissionPreset || updated.role,
      });
    })().catch(() => {});
    // Realtime poke (mirror addMember) — roster changed for everyone else.
    emitToProjectMembers(member.projectId, { type: 'members.changed' }, { exclude: req.user.id });

    res.json({ projectId: project.id, projectName: project.title || 'Untitled project' });
  } catch (err) {
    console.error('[invites] acceptInvite:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
