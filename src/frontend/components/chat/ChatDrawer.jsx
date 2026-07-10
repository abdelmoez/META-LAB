/**
 * ChatDrawer.jsx — the shared project-chat drawer (prompt7 Task 11).
 *
 * Extracted from screening/components/ChatLauncher.jsx so META·SIFT and
 * META·LAB can share one chat surface over different endpoint families.
 * The drawer is API-agnostic: callers pass an ADAPTER with the six chat
 * operations, plus a realtimeMatch predicate for SSE chat.message pokes.
 *
 * Adapter contract:
 *   api = {
 *     list(since)    → { messages, serverTime, canChat, chatRestricted, typing }
 *     post(body)     → { message }                  (body: { message })
 *     unreadCount()  → { unread }
 *     markRead()     → { unread: 0 }
 *     typing()       → 204 (throttled "I'm typing" ping)
 *     remove(id)     → 204 (soft delete; sender or leader only)
 *   }
 *
 * Props:
 *   open / onClose        — controlled visibility (launcher owns the button)
 *   onUnreadChange(n)     — drives the launcher's unread badge
 *                           (server-authoritative count + local increments)
 *   me                    — optional current user id (isMe fallback)
 *   canChat / isLeader    — initial permission hints (server responses override canChat)
 *   restricted            — initial chatRestricted hint (server responses override)
 *   title                 — drawer header label
 *   realtimeMatch(event)  — predicate for 'chat.message' SSE pokes
 *
 * UX (pinned): slide-in from the right; backdrop click + Escape close; the
 * composer KEEPS FOCUS after sending; typing indicator via polling only.
 *
 * Polling: 4s baseline; while the SSE stream is healthy AND the drawer is
 * closed it stretches to ~30s (pokes trigger immediate fetches). The drawer
 * keeps 4s while open so typing indicators stay live — they only travel via
 * polling, never over SSE (poke-only contract).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { C, FONT, MONO, alpha } from '../../theme/tokens.js';
import { useRealtime } from '../../hooks/useRealtime.js';
import Icon from '../icons.jsx';
import { canPostChatFlat, chatPostBlockReasonFlat, chatBlockMessage } from '../../../research-engine/screening/chatPolicy.js';

const POLL_MS = 4000;
const HEALTHY_POLL_MS = 30000;

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Spinner({ size = 16 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

function Avatar({ name, size = 18 }) {
  const initials = (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  let h = 0; for (const ch of (name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, fontFamily: FONT, color: '#fff',
      background: `hsl(${h},45%,38%)`,
    }}>{initials}</span>
  );
}

export default function ChatDrawer({
  api,
  open,
  onClose,
  onUnreadChange,
  me,
  canChat: canChatProp = false,
  isLeader = false,
  isOwner = false,
  restricted = false,
  title = 'Project Chat',
  realtimeMatch,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [unread, setUnread] = useState(0);

  const [canChat, setCanChat] = useState(canChatProp ?? false);
  const [chatRestricted, setChatRestricted] = useState(!!restricted);
  // 78.md #2 — the server's RESOLVED write verdict (canWriteChat). Null until the
  // first list() response; once set it is the single source of truth for the
  // composer's read-only state, so the client can never drift from the server gate.
  const [canPost, setCanPost] = useState(null);
  // 81.md — isLeader/isOwner must refresh from list() alongside canChat/chatRestricted/
  // canPost so the read-only REASON copy (muted vs restricted) stays correct after a
  // LIVE role change; the props only seed the mount-time value. isOwner matters because
  // "Restrict chat" is owner-only (v2) — a blocked leader vs the owner differ.
  const [isLeaderLive, setIsLeaderLive] = useState(!!isLeader);
  const [isOwnerLive, setIsOwnerLive] = useState(!!isOwner);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [typing, setTyping] = useState([]); // names of other members currently typing
  const lastTypingSent = useRef(0);

  const sinceRef   = useRef(null);
  const idsRef     = useRef(new Set());
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const openRef    = useRef(open);
  const sendingRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);

  // Latest callbacks via refs (stable identities inside polling closures).
  const onUnreadRef = useRef(onUnreadChange);
  onUnreadRef.current = onUnreadChange;
  const matchRef = useRef(realtimeMatch);
  matchRef.current = realtimeMatch;
  const apiRef = useRef(api);
  apiRef.current = api;

  // Mirror the internal unread count to the launcher badge.
  useEffect(() => { onUnreadRef.current?.(unread); }, [unread]);

  // countUnread=false for the initial history load — historical messages are
  // NOT unread just because we loaded them; the server's read marker decides.
  const merge = useCallback((incoming, serverTime, countUnread = true) => {
    if (serverTime) sinceRef.current = serverTime;
    if (!incoming || incoming.length === 0) return;
    const seen = idsRef.current;
    const fresh = [];
    for (const m of incoming) {
      if (m && m.id != null && !seen.has(m.id)) { seen.add(m.id); fresh.push(m); }
    }
    if (!fresh.length) return;
    setMessages(prev => [...prev, ...fresh]);
    // New messages from OTHER members arriving while the drawer is closed.
    if (countUnread && !openRef.current) {
      const others = fresh.filter(m => !m.isMe).length;
      if (others) setUnread(u => u + others);
    }
  }, []);

  // Authoritative unread count from the server (per-user lastReadAt).
  const fetchUnread = useCallback(() => {
    apiRef.current.unreadCount()
      .then(d => { if (!openRef.current) setUnread(d?.unread || 0); })
      .catch(() => {});
  }, []);

  // Initial load — populate history WITHOUT counting it as unread.
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const data = await apiRef.current.list();
      idsRef.current = new Set(); setMessages([]);
      merge(data?.messages || [], data?.serverTime, false);
      setCanChat(data?.canChat ?? canChatProp ?? false);
      setChatRestricted(!!(data?.chatRestricted ?? restricted));
      if (data?.canPost != null) setCanPost(!!data.canPost);
      if (data?.isLeader != null) setIsLeaderLive(!!data.isLeader);
      if (data?.isOwner != null) setIsOwnerLive(!!data.isOwner);
      setTyping(data?.typing || []);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load the project chat.');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merge]);

  useEffect(() => { setUnread(0); load(); fetchUnread(); }, [load, fetchUnread]);

  // Fetch new messages since the cursor — used by the interval poll AND by the
  // realtime chat.message poke (immediate fetch; content never rides the poke).
  const lastPollRef = useRef(0);
  const pollNow = useCallback(async () => {
    if (sinceRef.current == null) return;
    lastPollRef.current = Date.now();
    try {
      const data = await apiRef.current.list(sinceRef.current);
      merge(data?.messages || [], data?.serverTime);
      if (data?.canChat != null) setCanChat(data.canChat);
      if (data?.chatRestricted != null) setChatRestricted(!!data.chatRestricted);
      if (data?.canPost != null) setCanPost(!!data.canPost);
      if (data?.isLeader != null) setIsLeaderLive(!!data.isLeader);
      if (data?.isOwner != null) setIsOwnerLive(!!data.isOwner);
      setTyping(data?.typing || []);
    } catch { /* keep cursor, retry on next tick */ }
  }, [merge]);

  // Realtime — a chat.message poke matching this thread triggers an immediate
  // fetch through the authorized list endpoint (poke carries no content). A
  // permissions.changed poke (user-targeted; emitted when a leader/owner edits
  // THIS member's permissions, incl. canChat) likewise refetches so the composer
  // flips to read-only WITHOUT a reload (prompt50 WS6) — the fetched `canChat`
  // is server-authoritative and drives `blocked` below.
  const { healthy: rtHealthy } = useRealtime({
    'chat.message': ev => { if (matchRef.current && matchRef.current(ev)) pollNow(); },
    'permissions.changed': () => pollNow(),
  });
  const rtHealthyRef = useRef(rtHealthy);
  rtHealthyRef.current = rtHealthy;

  // Background poll — the 4s baseline IS the fallback; while SSE is healthy and
  // the drawer is closed, ticks are skipped down to the stretched cadence.
  useEffect(() => {
    if (loading || loadError) return undefined;
    const tick = () => {
      if (document.hidden) return;
      if (rtHealthyRef.current && !openRef.current &&
          Date.now() - lastPollRef.current < HEALTHY_POLL_MS) return;
      pollNow();
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [loading, loadError, pollNow]);

  // Open → mark read (persist server-side so the badge stays cleared across
  // logins), clear the local badge, and focus the composer.
  useEffect(() => {
    if (open) {
      setUnread(0);
      apiRef.current.markRead().catch(() => {});
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);
  useEffect(() => {
    if (open && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 78.md #2 / 81.md — read-only state comes from the SERVER's resolved verdict
  // (`canPost`) whenever it is available, so the composer and the server write-gate
  // can never disagree: a per-member mute (canChat=false) OR the project-wide "Restrict
  // chat" lock (leadership-only) both flip this to read-only without a reload. Before
  // the first list() response (canPost null) we fall back to the SHARED policy gate
  // (chatPolicy.canPostChatFlat — the exact rule the server enforces) so the composer
  // starts correct. This is a true disabled state, not a cosmetic hide.
  const blocked = canPost != null ? !canPost : !canPostChatFlat({ isOwner: isOwnerLive, isLeader: isLeaderLive, canChat, chatRestricted });
  // WHY posting is blocked → honest, specific copy ("restricted" vs "muted"). Derived
  // from the same signals the server sends (incl. isOwnerLive/isLeaderLive), refreshed on
  // every list() poll — so a live role change flips the copy too, matching server canPost.
  const blockReason = chatPostBlockReasonFlat({ isOwner: isOwnerLive, isLeader: isLeaderLive, canChat, chatRestricted });
  const readOnlyMessage = chatBlockMessage(blockReason)
    || 'Chat is read-only for your account in this project. You can read existing messages, but a project owner or leader has turned off your permission to post.';

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendingRef.current || blocked) return;
    sendingRef.current = true; setSending(true); setSendError(null);
    try {
      const res = await apiRef.current.post({ message: text });
      if (res?.message) merge([res.message]);
      setDraft('');
    } catch (e) {
      setSendError(e?.message || 'Could not send your message.');
    } finally {
      sendingRef.current = false; setSending(false);
      inputRef.current?.focus();   // keep focus in the field after sending
    }
  }, [draft, blocked, merge]);

  const onKeyDown = useCallback(e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  // Throttled "I'm typing" ping (server keeps a 6s in-memory window).
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2500) return;
    lastTypingSent.current = now;
    apiRef.current.typing().catch(() => {});
  }, []);

  // Soft-delete a message (sender or leader; server enforces).
  const removeMessage = useCallback(async (id) => {
    try {
      await apiRef.current.remove(id);
      setMessages(prev => prev.filter(m => m.id !== id));
    } catch (e) {
      setSendError(e?.message || 'Could not delete the message.');
    }
  }, []);

  const typingLabel = typing.length === 0 ? ''
    : typing.length === 1 ? `${typing[0]} is typing…`
    : typing.length === 2 ? `${typing[0]} and ${typing[1]} are typing…`
    : 'Several members are typing…';

  if (!open) return null;

  // The open overlay portals to document.body (prompt9 Task 5). In META·LAB
  // the launcher mounts inside the monolith's fixed z-9999 wrapper — a
  // stacking context that caps the drawer's z 10000 below the later-DOM
  // bell/UserMenu siblings (also 9999), leaving the X unclickable under the
  // avatar. The portal lifts the overlay into the ROOT stacking context so
  // z 10000 wins everywhere; the component itself stays mounted while closed
  // (returns null above) so the unread poll + SSE subscription keep running.
  // In META·SIFT the drawer already lived in the root context — rendering
  // from document.body is visually identical there.
  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: alpha(C.bg, 0.45), animation: 'chat-fade 0.15s ease' }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, height: '100%', width: 'min(420px, 92vw)',
        background: C.surf, borderLeft: `1px solid ${C.brd2}`, boxShadow: `-12px 0 40px ${C.shadow}`,
        display: 'flex', flexDirection: 'column', animation: 'chat-slide-in 0.2s ease',
        fontFamily: FONT, color: C.txt,
      }}>
        <style>{`
          @keyframes chat-slide-in { from { transform: translateX(24px); opacity: 0.4 } to { transform: translateX(0); opacity: 1 } }
          @keyframes chat-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
            <Icon name="chat" size={14} style={{ color: C.txt2 }} />
            <span title={title} style={{ fontSize: 13, fontWeight: 600, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>{messages.length}</span>
          </div>
          <button onClick={() => onClose?.()} title="Close" style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', lineHeight: 1, padding: '4px 6px', display: 'inline-flex', flexShrink: 0 }}>
            <Icon name="x" size={15} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}><Spinner size={16} /></div>
          ) : loadError ? (
            <div style={{ color: C.red, fontSize: 12.5, lineHeight: 1.5 }}>{loadError}</div>
          ) : messages.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12.5, textAlign: 'center', padding: '30px 12px', lineHeight: 1.5 }}>No messages yet — start the conversation.</div>
          ) : messages.map(m => (
            <MessageRow
              key={m.id}
              m={m}
              mine={!!(m.isMe || (me != null && m.senderId === me))}
              isLeader={isLeaderLive}
              onDelete={() => removeMessage(m.id)}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.brd}`, flexShrink: 0 }}>
          <div style={{ height: 14, marginBottom: 4, fontSize: 11, color: C.acc, fontStyle: 'italic', opacity: typingLabel ? 1 : 0, transition: 'opacity 0.2s' }}>
            {typingLabel || ' '}
          </div>
          {blocked ? (
            <div>
              <input type="text" value="" disabled readOnly
                placeholder={blockReason === 'restricted' ? 'Chat is restricted — read-only.' : 'Chat is read-only for your account.'}
                aria-label={readOnlyMessage}
                style={{ width: '100%', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '9px 12px', color: C.muted, fontSize: 13, fontFamily: FONT, outline: 'none', opacity: 0.6, cursor: 'not-allowed', boxSizing: 'border-box' }} />
              <div role="status" style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                {readOnlyMessage}
              </div>
            </div>
          ) : (
            <>
              {sendError && <div style={{ fontSize: 11.5, color: C.red, marginBottom: 6 }}>{sendError}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={e => { setDraft(e.target.value); notifyTyping(); }}
                  onKeyDown={onKeyDown}
                  placeholder="Write a message…"
                  style={{ flex: 1, minWidth: 0, background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '9px 12px', color: C.txt, fontSize: 13, fontFamily: FONT, outline: 'none' }}
                />
                <button type="button" onClick={send} disabled={sending || !draft.trim()} title="Send"
                  style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, fontFamily: FONT, background: C.acc2, border: 'none', color: C.accText, borderRadius: 8, padding: '9px 14px', minWidth: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: sending || !draft.trim() ? 0.5 : 1, cursor: sending || !draft.trim() ? 'not-allowed' : 'pointer' }}>
                  {sending ? <Spinner size={13} /> : <Icon name="send" size={14} />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// prompt29 Part 14 — own messages are deletable only within 2 minutes; the
// trash control hides when the window closes. Leaders keep moderation ability.
// The server re-checks against its own clock, so this is best-effort UX only.
const CHAT_DELETE_WINDOW_MS = 2 * 60 * 1000;

function MessageRow({ m, mine, isLeader, onDelete }) {
  const [hover, setHover] = useState(false);
  const createdMs = m.createdAt ? new Date(m.createdAt).getTime() : 0;
  const [withinWindow, setWithinWindow] = useState(
    () => !createdMs || (Date.now() - createdMs) <= CHAT_DELETE_WINDOW_MS,
  );
  useEffect(() => {
    if (isLeader || !mine || !createdMs) return undefined; // leaders: no expiry
    const remaining = CHAT_DELETE_WINDOW_MS - (Date.now() - createdMs);
    if (remaining <= 0) { setWithinWindow(false); return undefined; }
    const t = setTimeout(() => setWithinWindow(false), remaining + 50);
    return () => clearTimeout(t);
  }, [isLeader, mine, createdMs]);
  const canDelete = isLeader || (mine && withinWindow);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: mine ? 'row-reverse' : 'row' }}>
        <Avatar name={m.senderName} size={18} />
        <span style={{ fontSize: 11, fontWeight: 500, color: C.txt2, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.senderName}</span>
        <span style={{ fontSize: 9, fontFamily: MONO, color: C.muted }}>{fmtTime(m.createdAt)}</span>
        {canDelete && (
          <button
            onClick={onDelete}
            title="Delete message"
            style={{
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
              padding: 0, lineHeight: 1, display: 'inline-flex',
              opacity: hover ? 0.9 : 0, transition: 'opacity 0.15s',
            }}>
            <Icon name="trash" size={11} />
          </button>
        )}
      </div>
      <div style={{
        fontSize: 13, lineHeight: 1.5, color: C.txt, borderRadius: 9, padding: '8px 12px', maxWidth: '88%',
        minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
        background: mine ? alpha(C.acc2, '22') : C.card, border: `1px solid ${mine ? alpha(C.acc2, '55') : C.brd}`,
      }}>{m.message}</div>
    </div>
  );
}
