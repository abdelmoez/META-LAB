/**
 * ChatLauncher.jsx — project-level chat (prompt2 Task 6).
 *
 * A header chat button with a per-member unread badge that opens a slide-in
 * drawer from the right. The drawer overlays the page (fixed position, never
 * shifts layout), closes on backdrop click or the × button, and the composer
 * KEEPS FOCUS after sending. Chat is project-scoped and members-only (the
 * server enforces visibility + the leader's chatRestricted setting).
 *
 * One background poller runs while mounted: when the drawer is closed, messages
 * from other members increment the unread badge; opening the drawer clears it.
 *
 * Props: pid, access ({ isLeader, canChat })
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import { Avatar, Spinner } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';

const POLL_MS = 4000;
// While the SSE poke stream is healthy AND the drawer is closed, the 4s poll
// stretches to ~30s (chat.message pokes trigger immediate fetches). With the
// drawer OPEN the 4s cadence is kept so typing indicators stay live — they
// only travel via polling. On SSE failure everything snaps back to 4s.
const HEALTHY_POLL_MS = 30000;

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatLauncher({ pid, access = {} }) {
  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [unread, setUnread]   = useState(0);

  const [canChat, setCanChat] = useState(access.canChat ?? false);
  const [chatRestricted, setChatRestricted] = useState(false);

  const [draft, setDraft]     = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [typing, setTyping]   = useState([]); // names of other members currently typing
  const lastTypingSent = useRef(0);

  const sinceRef   = useRef(null);
  const idsRef     = useRef(new Set());
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const openRef    = useRef(open);
  const sendingRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);

  // countUnread=false for the initial history load (BUG 2: historical messages are
  // NOT unread just because we loaded them — the server's read marker decides).
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
    screeningApi.chatUnreadCount(pid)
      .then(d => { if (!openRef.current) setUnread(d?.unread || 0); })
      .catch(() => {});
  }, [pid]);

  // Initial load — populate history WITHOUT counting it as unread.
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const data = await screeningApi.listChat(pid);
      idsRef.current = new Set(); setMessages([]);
      merge(data?.messages || [], data?.serverTime, false);
      setCanChat(data?.canChat ?? access.canChat ?? false);
      setChatRestricted(!!data?.chatRestricted);
      setTyping(data?.typing || []);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load the project chat.');
    } finally { setLoading(false); }
  }, [pid, merge, access.canChat]);

  useEffect(() => { setUnread(0); load(); fetchUnread(); }, [load, fetchUnread]);

  // Fetch new messages since the cursor — used by the interval poll AND by the
  // realtime chat.message poke (immediate fetch, content never rides the poke).
  const lastPollRef = useRef(0);
  const pollNow = useCallback(async () => {
    if (sinceRef.current == null) return;
    lastPollRef.current = Date.now();
    try {
      const data = await screeningApi.listChat(pid, sinceRef.current);
      merge(data?.messages || [], data?.serverTime);
      if (data?.canChat != null) setCanChat(data.canChat);
      if (data?.chatRestricted != null) setChatRestricted(!!data.chatRestricted);
      setTyping(data?.typing || []);
    } catch { /* keep cursor, retry on next tick */ }
  }, [pid, merge]);

  // Realtime (prompt6 Task 7): a chat.message poke for THIS project triggers an
  // immediate fetch through the authorized listChat endpoint.
  const { healthy: rtHealthy } = useRealtime({
    'chat.message': ev => { if (ev?.projectId === pid) pollNow(); },
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
      screeningApi.markChatRead(pid).catch(() => {});
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, pid]);
  useEffect(() => {
    if (open && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const blocked = chatRestricted && !canChat && !access.isLeader;

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendingRef.current || blocked) return;
    sendingRef.current = true; setSending(true); setSendError(null);
    try {
      const res = await screeningApi.postChat(pid, { message: text });
      if (res?.message) merge([res.message]);
      setDraft('');
    } catch (e) {
      setSendError(e?.message || 'Could not send your message.');
    } finally {
      sendingRef.current = false; setSending(false);
      inputRef.current?.focus();   // keep focus in the field after sending
    }
  }, [draft, blocked, pid, merge]);

  const onKeyDown = useCallback(e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  // Throttled "I'm typing" ping (server keeps a 6s in-memory window).
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2500) return;
    lastTypingSent.current = now;
    screeningApi.chatTyping(pid).catch(() => {});
  }, [pid]);

  const typingLabel = typing.length === 0 ? ''
    : typing.length === 1 ? `${typing[0]} is typing…`
    : typing.length === 2 ? `${typing[0]} and ${typing[1]} are typing…`
    : 'Several members are typing…';

  return (
    <>
      {/* Header trigger */}
      <button
        onClick={() => setOpen(true)}
        title="Project chat"
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
          background: C.card, border: `1px solid ${C.brd2}`, color: C.txt,
          fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: '6px 12px',
          borderRadius: 7, cursor: 'pointer',
        }}>
        <span style={{ fontSize: 13 }}>💬</span>
        <span>Chat</span>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -7, right: -7, minWidth: 16, height: 16, padding: '0 4px',
            background: C.red, color: '#fff', fontSize: 10, fontFamily: MONO, fontWeight: 700,
            borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${C.surf}`,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {/* Drawer overlay */}
      {open && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(4,8,18,0.45)', animation: 'sift-fade 0.15s ease' }}>
          <div style={{
            position: 'absolute', top: 0, right: 0, height: '100%', width: 'min(420px, 92vw)',
            background: C.surf, borderLeft: `1px solid ${C.brd2}`, boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', animation: 'sift-slide-in 0.2s ease',
          }}>
            <style>{`@keyframes sift-slide-in { from { transform: translateX(24px); opacity: 0.4 } to { transform: translateX(0); opacity: 1 } }`}</style>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>💬</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Project Chat</span>
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 4, padding: '1px 6px' }}>{messages.length}</span>
              </div>
              <button onClick={() => setOpen(false)} title="Close" style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>×</button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}><Spinner size={16} /></div>
              ) : loadError ? (
                <div style={{ color: C.red, fontSize: 12.5, lineHeight: 1.5 }}>{loadError}</div>
              ) : messages.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 12.5, textAlign: 'center', padding: '30px 12px', lineHeight: 1.5 }}>No messages yet — start the conversation.</div>
              ) : messages.map(m => <MessageRow key={m.id} m={m} />)}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.brd}`, flexShrink: 0 }}>
              <div style={{ height: 14, marginBottom: 4, fontSize: 11, color: C.acc, fontStyle: 'italic', opacity: typingLabel ? 1 : 0, transition: 'opacity 0.2s' }}>
                {typingLabel || ' '}
              </div>
              {blocked ? (
                <div style={{ fontSize: 12, color: C.muted, background: C.card, border: `1px dashed ${C.brd2}`, borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>
                  The project leader has restricted chat — you have read-only access.
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
                      onFocus={e => { e.currentTarget.style.borderColor = C.acc2; }}
                      onBlur={e => { e.currentTarget.style.borderColor = C.brd2; }}
                    />
                    <button type="button" onClick={send} disabled={sending || !draft.trim()}
                      style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, fontFamily: FONT, background: C.acc2, border: 'none', color: '#fff', borderRadius: 8, padding: '9px 16px', minWidth: 60, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: sending || !draft.trim() ? 0.5 : 1, cursor: sending || !draft.trim() ? 'not-allowed' : 'pointer' }}>
                      {sending ? <Spinner size={13} /> : 'Send'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MessageRow({ m }) {
  const mine = !!m.isMe;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: mine ? 'row-reverse' : 'row' }}>
        <Avatar name={m.senderName} size={18} />
        <span style={{ fontSize: 11, fontWeight: 500, color: C.txt2, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.senderName}</span>
        <span style={{ fontSize: 9, fontFamily: MONO, color: C.muted }}>{fmtTime(m.createdAt)}</span>
      </div>
      <div style={{
        fontSize: 13, lineHeight: 1.5, color: C.txt, borderRadius: 9, padding: '8px 12px', maxWidth: '88%',
        wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        background: mine ? C.acc2 + '22' : C.card, border: `1px solid ${mine ? C.acc2 + '55' : C.brd}`,
      }}>{m.message}</div>
    </div>
  );
}
