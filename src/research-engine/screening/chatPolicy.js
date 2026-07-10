/**
 * chatPolicy.js — the ONE source of truth for project-chat access (81.md).
 *
 * Before 81.md the chat write-rule was RE-DERIVED independently in three places:
 *   • server/controllers/screeningChatController.js  canWriteChat  (the real gate)
 *   • src/frontend/components/chat/ChatDrawer.jsx     `blocked` fallback
 *   • src/frontend/components/chat/StitchChatLauncher.jsx `mayParticipate`
 * and the launcher copy DROPPED the project-wide `chatRestricted` term, so its
 * derived rule (isLeader || canChat) was LOOSER than the server gate
 * (isLeader || (canChat && !chatRestricted)). That drift is exactly how a
 * "Restrict chat" fix can look done while a surface still disagrees. This module
 * makes every consumer import ONE rule so client and server can never diverge.
 *
 * Two orthogonal capabilities, both derived from a resolved access context:
 *
 *   canPostProjectChat  — may WRITE (send / typing / delete). "Restrict chat" is
 *                         an OWNER-ONLY lock (81.md v2): when ON, ONLY the project
 *                         OWNER can post — leaders AND members are read-only. When
 *                         OFF, the normal rule applies: owner + leaders always post,
 *                         and a muted member (canChat=false) is read-only. This is
 *                         the EXACT gate the server enforces on every chat-write
 *                         route and echoes to the client as `canPost`.
 *
 *   canAccessProjectChat — may OPEN chat and READ history. Reading is NEVER
 *                         restricted (server contract; a resolved member always
 *                         reads). "Restrict chat" removes POSTING, not reading —
 *                         restricted members stay read-only, matching the
 *                         Project Control copy ("everyone else is read-only").
 *
 * Dependency-free plain JS so Node (ESM) and Vite both import it verbatim.
 *
 * `access` shape (getProjectAccess / resolveMetaLabChatScope):
 *   { isLeader, canChat, active, project: { chatRestricted } }
 * Client launchers hold the same three signals FLAT from the list()/probe
 * response ({ isLeader, canChat, chatRestricted }); the *Flat helpers below
 * adapt that shape onto the SAME rule so there is still only one rule.
 */

/**
 * The write gate.
 * @param {{isOwner?:boolean, isLeader?:boolean, canChat?:boolean, project?:{chatRestricted?:boolean}}} access
 * @returns {boolean}
 */
export function canPostProjectChat(access) {
  if (!access) return false;
  // 81.md v2 — "Restrict chat" is an OWNER-ONLY lock: when ON, ONLY the project
  // owner may post; leaders AND members are read-only.
  if (access.project && access.project.chatRestricted) return !!access.isOwner;
  // Not restricted → the normal rule: owner + leaders always post…
  if (access.isLeader) return true;
  // …and a muted member (canChat=false) is read-only.
  if (!access.canChat) return false;
  return true;
}

/**
 * The read gate. A resolved access context means the caller is the owner or an
 * active member of the linked workspace (getProjectAccess / resolveMetaLabChatScope
 * already 404 non-members, pending invites, and inactive members), so any resolved
 * context may read. Reading is never restricted by the chat flags.
 * @returns {boolean}
 */
export function canAccessProjectChat(access) {
  return !!access && access.active !== false;
}

/**
 * WHY a context cannot post — drives consistent, honest UI copy.
 * @returns {'ok'|'muted'|'restricted'|'no-access'}
 *   ok         — may post
 *   restricted — the project-wide "Restrict chat" lock is on and the caller is not
 *                the owner (applies to blocked LEADERS and members alike)
 *   muted      — chat is open but this member's Chat permission is off (canChat=false)
 *   no-access  — no resolved membership at all
 */
export function chatPostBlockReason(access) {
  if (!access) return 'no-access';
  if (canPostProjectChat(access)) return 'ok';
  if (access.project && access.project.chatRestricted) return 'restricted';
  if (!access.canChat) return 'muted';
  return 'no-access';
}

/** Adapt the client-flat probe shape onto the nested access shape. Null-safe so the
 *  flat helpers mirror their nested twins on nullish input (e.g. an error/empty probe). */
function toAccess(flat) {
  const { isOwner = false, isLeader = false, canChat = false, chatRestricted = false } = flat || {};
  return { isOwner: !!isOwner, isLeader: !!isLeader, canChat: !!canChat, project: { chatRestricted: !!chatRestricted } };
}

/** Flat-shape write gate for the client probe ({isOwner,isLeader,canChat,chatRestricted}). */
export function canPostChatFlat(flat) {
  if (!flat) return false;                       // mirror canPostProjectChat(null) → false
  return canPostProjectChat(toAccess(flat));
}

/** Flat-shape block-reason for the client launcher/composer. */
export function chatPostBlockReasonFlat(flat) {
  if (!flat) return 'no-access';                 // mirror chatPostBlockReason(null) → 'no-access'
  return chatPostBlockReason(toAccess(flat));
}

/** Human-readable one-liner for a block reason (shared launcher tooltip + composer copy). */
export function chatBlockMessage(reason) {
  switch (reason) {
    case 'restricted':
      return 'Chat is restricted — only the project owner can post right now. You can still read messages.';
    case 'muted':
      return 'Your permission to post in this chat has been turned off. You can read existing messages.';
    case 'no-access':
      return 'Chat is unavailable for your account in this project.';
    default:
      return '';
  }
}
