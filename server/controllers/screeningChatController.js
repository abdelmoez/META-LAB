/**
 * screeningChatController.js — per-project member chat (Part 6).
 *
 * Visibility: only project members (owner + members) can read or post.
 * Permission: the leader can restrict posting (project.chatRestricted) so only
 * members with canChat (or the leader) may send. Messages are stored as plain
 * text; HTML tags are stripped server-side and React escapes on render, so no
 * unsafe HTML is ever produced. Realtime is via client polling (?since cursor).
 *
 * prompt7 Task 11 — ONE thread, two doors:
 *   /projects/:pid/chat*    META·SIFT door, :pid is a ScreenProject id
 *   /metalab/:mlpid/chat*   META·LAB door, :mlpid is a META·LAB Project id,
 *                           resolved to the linked workspace via chatScope.js
 * Both doors resolve to the same access context and share the core handlers
 * below, so every gate (allowChat kill-switch, inactive-member post block,
 * chatRestricted, sanitize, soft delete, read-state) is identical.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess } from '../screening/access.js';
import { resolveMetaLabChatScope } from '../screening/chatScope.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { emitToProjectMembers } from '../realtime/bus.js';

const MAX_LEN = 4000;

// ── Typing indicators (prompt4 Task 7) ──────────────────────────────────────
// In-memory, project-scoped, never persisted. Entries expire after TYPING_TTL.
// NOTE: this lives in process memory, so it is per-instance — fine for a single
// server; a multi-instance deployment would need a shared channel (Redis pub/sub
// or websockets). Documented in docs/manager/deployment-readiness.md.
const TYPING_TTL = 6000;
const typingByProject = new Map(); // projectId -> Map(userId -> { name, ts })

function setTyping(projectId, userId, name) {
  let m = typingByProject.get(projectId);
  if (!m) { m = new Map(); typingByProject.set(projectId, m); }
  m.set(userId, { name: name || 'Member', ts: Date.now() });
}

/** Names of members (excluding `exceptUserId`) typing within the TTL window. */
function activeTypers(projectId, exceptUserId) {
  const m = typingByProject.get(projectId);
  if (!m) return [];
  const now = Date.now();
  const names = [];
  for (const [uid, v] of m) {
    if (now - v.ts > TYPING_TTL) { m.delete(uid); continue; }
    if (uid !== exceptUserId) names.push(v.name);
  }
  return names;
}

/**
 * Per-member chat WRITE gate (prompt50 WS6).
 *
 * A member explicitly denied chat (canChat=false) is READ-ONLY: they keep read
 * access to existing chat content but cannot create new chat content — REGARDLESS
 * of the project-wide `chatRestricted` flag. The owner and leaders are never
 * blocked. Before this fix the gate only fired when `chatRestricted` was on, so
 * disabling a single member's canChat had no effect (the reported bug).
 *
 * The project-wide `chatRestricted` flag remains a valid additional lockdown; it
 * is fully subsumed by this per-member check (it only ever blocked members who
 * already lacked canChat). Enforced on EVERY chat WRITE route (send, delete,
 * typing) so a forged request body, a stale browser tab, a replayed WebSocket
 * event, or a direct API call cannot bypass it — the UI hint is never the
 * source of truth.
 */
function canWriteChat(access) {
  return !!(access && (access.isLeader || access.canChat));
}

/** Strip HTML tags + control chars; trim; cap length. */
function sanitize(text) {
  return String(text || '')
    .replace(/<\/?[a-z][^>]*>/gi, '')                // remove HTML element tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')     // strip control chars (keep tab/newline)
    .trim()
    .slice(0, MAX_LEN);
}

// ── Core handlers (shared by both doors) ─────────────────────────────────────
// Each core receives a resolved access context (getProjectAccess shape) and
// runs EXACTLY the original /projects/:pid/chat logic.

/** List messages (?since cursor, take 500 asc) + canChat/chatRestricted/typing/serverTime. */
async function listMessagesCore(access, req, res) {
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
    typing: activeTypers(access.project.id, req.user.id),
    serverTime: new Date().toISOString(),
  });
}

/** Post a message — gated by the admin kill-switch, active status and chatRestricted. */
async function postMessageCore(access, req, res) {
  const settings = await getMetaSiftSettings();
  if (settings.allowChat === false) return res.status(403).json({ error: 'Chat is currently disabled by the administrator' });
  if (!access.active) return res.status(403).json({ error: 'Inactive members cannot post' });
  // Per-member canChat is authoritative and always enforced (prompt50 WS6) —
  // independent of the project-wide chatRestricted flag.
  if (!canWriteChat(access)) {
    return res.status(403).json({ error: 'You do not have permission to post in this chat.' });
  }
  const message = sanitize(req.body?.message);
  if (!message) return res.status(400).json({ error: 'message is required' });

  const senderName = access.member?.name || req.user.email || 'Member';
  const created = await prisma.screenChatMessage.create({
    data: { projectId: access.project.id, senderId: req.user.id, senderName, message, status: 'sent' },
  });
  // Realtime poke (Task 7) — no message content travels on the stream;
  // recipients fetch via the authorized listChat(?since) endpoint.
  // prompt7 Task 11: when the workspace is linked, the poke also carries
  // metaLabProjectId so META·LAB clients can match it without knowing the
  // ScreenProject id (META·SIFT clients keep matching on projectId).
  // Recipients stay DB-resolved active members + owner.
  const event = { type: 'chat.message' };
  if (access.project.linkedMetaLabProjectId) event.metaLabProjectId = access.project.linkedMetaLabProjectId;
  emitToProjectMembers(access.project.id, event, { exclude: req.user.id });
  res.status(201).json({
    message: {
      id: created.id, senderId: created.senderId, senderName: created.senderName,
      message: created.message, status: created.status, createdAt: created.createdAt, isMe: true,
    },
  });
}

/**
 * Unread count — messages from OTHER members created after this user's
 * lastReadAt (BUG 2). Server-authoritative via ScreenChatRead.
 */
async function getUnreadCountCore(access, req, res) {
  const read = await prisma.screenChatRead.findUnique({
    where: { projectId_userId: { projectId: access.project.id, userId: req.user.id } },
  });
  const lastReadAt = read?.lastReadAt || new Date(0);
  const unread = await prisma.screenChatMessage.count({
    where: {
      projectId: access.project.id, deletedAt: null,
      senderId: { not: req.user.id },
      createdAt: { gt: lastReadAt },
    },
  });
  res.json({ unread });
}

/**
 * Mark all current messages read for this user (called when the chat drawer
 * opens). Persists lastReadAt so the badge does NOT reappear on the next
 * login unless a new message arrives.
 */
async function markReadCore(access, req, res) {
  const now = new Date();
  await prisma.screenChatRead.upsert({
    where: { projectId_userId: { projectId: access.project.id, userId: req.user.id } },
    update: { lastReadAt: now },
    create: { projectId: access.project.id, userId: req.user.id, lastReadAt: now },
  });
  res.json({ unread: 0 });
}

/** Mark the current member as typing (Task 7). */
async function setTypingStatusCore(access, req, res) {
  if (!access.active) return res.status(403).json({ error: 'Inactive members cannot post' });
  // Read-only members do not broadcast typing (a chat write signal) — prompt50 WS6.
  if (!canWriteChat(access)) return res.status(403).json({ error: 'You do not have permission to post in this chat.' });
  const name = access.member?.name || req.user.email || 'Member';
  setTyping(access.project.id, req.user.id, name);
  res.json({ ok: true });
}

// prompt29 Part 14 — a sender may delete their OWN message only within this
// window (enforced on SERVER time). Leaders keep their existing moderation
// ability for older messages, so the window does not apply to a leader.
const CHAT_DELETE_WINDOW_MS = 2 * 60 * 1000;

/** Sender (within 2 min) or leader (moderation) may soft-delete a message. */
async function deleteMessageCore(access, req, res) {
  // Deleting is a chat WRITE — a read-only member (canChat=false) cannot delete,
  // even their own message (prompt50 WS6). Leaders/owner keep moderation power.
  if (!canWriteChat(access)) {
    return res.status(403).json({ error: 'You do not have permission to modify this chat.' });
  }
  const messageId = req.params.cmid || req.params.messageId;
  const msg = await prisma.screenChatMessage.findFirst({
    where: { id: messageId, projectId: access.project.id, deletedAt: null },
  });
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const isSender = msg.senderId === req.user.id;
  if (!isSender && !access.isLeader) {
    return res.status(403).json({ error: 'You cannot delete this message' });
  }
  // A non-leader sender can only delete within 2 minutes of posting (server time).
  if (isSender && !access.isLeader) {
    const ageMs = Date.now() - new Date(msg.createdAt).getTime();
    if (ageMs > CHAT_DELETE_WINDOW_MS) {
      return res.status(403).json({ error: 'Messages can only be deleted within 2 minutes.' });
    }
  }
  await prisma.screenChatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date() } });
  res.status(204).send();
}

// ── Door wrappers ────────────────────────────────────────────────────────────
// Both translate "no access" to 404 (existence-hiding contract) and share the
// original error envelope. `name` keeps the per-handler log tags.

function viaScreenProject(name, core) {
  return async function (req, res) {
    try {
      const access = await getProjectAccess(req.params.pid, req.user);
      if (!access) return res.status(404).json({ error: 'Project not found' });
      await core(access, req, res);
    } catch (err) {
      console.error(`[screening] ${name}:`, err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

function viaMetaLabProject(name, core) {
  return async function (req, res) {
    try {
      const scope = await resolveMetaLabChatScope(req.params.mlpid, req.user);
      if (!scope) return res.status(404).json({ error: 'Project not found' });
      await core(scope.access, req, res);
    } catch (err) {
      console.error(`[screening] ${name}:`, err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// ── META·SIFT door (unchanged behavior) ──────────────────────────────────────

/** GET /projects/:pid/chat?since=<ISO> — members only. */
export const listMessages = viaScreenProject('listMessages', listMessagesCore);

/** POST /projects/:pid/chat — members only; gated by chatRestricted + canChat. */
export const postMessage = viaScreenProject('postMessage', postMessageCore);

/** GET /projects/:pid/chat/unread-count — members only. */
export const getUnreadCount = viaScreenProject('getUnreadCount', getUnreadCountCore);

/** POST /projects/:pid/chat/mark-read — members only. */
export const markRead = viaScreenProject('markRead', markReadCore);

/** POST /projects/:pid/chat/typing — mark the current member as typing (Task 7). */
export const setTypingStatus = viaScreenProject('setTypingStatus', setTypingStatusCore);

/** DELETE /projects/:pid/chat/:cmid — sender or leader may soft-delete. */
export const deleteMessage = viaScreenProject('deleteMessage', deleteMessageCore);

// ── META·LAB door (prompt7 Task 11) — same thread via the project link ──────

/** GET /metalab/:mlpid/chat?since=<ISO> — linked-workspace members only. */
export const listMetaLabMessages = viaMetaLabProject('listMetaLabMessages', listMessagesCore);

/** POST /metalab/:mlpid/chat — same gates as the SIFT-side postMessage. */
export const postMetaLabMessage = viaMetaLabProject('postMetaLabMessage', postMessageCore);

/** GET /metalab/:mlpid/chat/unread-count */
export const getMetaLabUnreadCount = viaMetaLabProject('getMetaLabUnreadCount', getUnreadCountCore);

/** POST /metalab/:mlpid/chat/read — mark read (META·LAB-door name for mark-read). */
export const markMetaLabRead = viaMetaLabProject('markMetaLabRead', markReadCore);

/** POST /metalab/:mlpid/chat/typing */
export const setMetaLabTypingStatus = viaMetaLabProject('setMetaLabTypingStatus', setTypingStatusCore);

/** DELETE /metalab/:mlpid/chat/:messageId — sender or leader may soft-delete. */
export const deleteMetaLabMessage = viaMetaLabProject('deleteMetaLabMessage', deleteMessageCore);
