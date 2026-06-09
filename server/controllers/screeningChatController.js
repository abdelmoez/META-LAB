/**
 * screeningChatController.js — per-project member chat (Part 6).
 *
 * Visibility: only project members (owner + members) can read or post.
 * Permission: the leader can restrict posting (project.chatRestricted) so only
 * members with canChat (or the leader) may send. Messages are stored as plain
 * text; HTML tags are stripped server-side and React escapes on render, so no
 * unsafe HTML is ever produced. Realtime is via client polling (?since cursor).
 */
import { prisma } from '../db/client.js';
import { getProjectAccess } from '../screening/access.js';
import { getMetaSiftSettings } from '../screening/settings.js';

const MAX_LEN = 4000;

/** Strip HTML tags + control chars; trim; cap length. */
function sanitize(text) {
  return String(text || '')
    .replace(/<\/?[a-z][^>]*>/gi, '')                // remove HTML element tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')     // strip control chars (keep tab/newline)
    .trim()
    .slice(0, MAX_LEN);
}

/** GET /projects/:pid/chat?since=<ISO> — members only. */
export async function listMessages(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });

    const where = { projectId: access.project.id, deletedAt: null };
    if (req.query.since) {
      const since = new Date(req.query.since);
      if (!isNaN(since.getTime())) where.createdAt = { gt: since };
    }
    const messages = await prisma.screenChatMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    res.json({
      messages: messages.map(m => ({
        id: m.id, senderId: m.senderId, senderName: m.senderName,
        message: m.message, status: m.status, createdAt: m.createdAt,
        isMe: m.senderId === req.user.id,
      })),
      canChat: access.canChat,
      chatRestricted: access.project.chatRestricted,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[screening] listMessages:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /projects/:pid/chat — members only; gated by chatRestricted + canChat. */
export async function postMessage(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const settings = await getMetaSiftSettings();
    if (settings.allowChat === false) return res.status(403).json({ error: 'Chat is currently disabled by the administrator' });
    if (!access.active) return res.status(403).json({ error: 'Inactive members cannot post' });
    if (access.project.chatRestricted && !access.canChat && !access.isLeader) {
      return res.status(403).json({ error: 'You do not have permission to send messages in this project' });
    }
    const message = sanitize(req.body?.message);
    if (!message) return res.status(400).json({ error: 'message is required' });

    const senderName = access.member?.name || req.user.email || 'Member';
    const created = await prisma.screenChatMessage.create({
      data: { projectId: access.project.id, senderId: req.user.id, senderName, message, status: 'sent' },
    });
    res.status(201).json({
      message: {
        id: created.id, senderId: created.senderId, senderName: created.senderName,
        message: created.message, status: created.status, createdAt: created.createdAt, isMe: true,
      },
    });
  } catch (err) {
    console.error('[screening] postMessage:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /projects/:pid/chat/:cmid — sender or leader may soft-delete. */
export async function deleteMessage(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const msg = await prisma.screenChatMessage.findFirst({
      where: { id: req.params.cmid, projectId: access.project.id, deletedAt: null },
    });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.senderId !== req.user.id && !access.isLeader) {
      return res.status(403).json({ error: 'You cannot delete this message' });
    }
    await prisma.screenChatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteMessage:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
