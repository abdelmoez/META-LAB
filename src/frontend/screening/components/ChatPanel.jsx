/**
 * ChatPanel.jsx — META·SIFT per-project member chat (Part 6).
 *
 * A compact, polling-based realtime chat that fits a ~320px sidebar. Loads the
 * full thread once, then polls every 4s with a `since` cursor (the server's
 * `serverTime`) to fetch only new messages, deduping by id. Messages are plain
 * text — React escapes on render, so no dangerouslySetInnerHTML is ever used.
 *
 * Props:
 *   pid    — screening project id
 *   access — { isLeader, canChat, ... } from the shell (fallback for permission)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import { Avatar, Spinner } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

const POLL_MS = 4000;

/** Short, locale-aware HH:MM timestamp for a message. */
function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPanel({ pid, access = {} }) {
  const [messages, setMessages]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Permission flags resolved from the server response, falling back to props.
  const [canChat, setCanChat]               = useState(access.canChat ?? false);
  const [chatRestricted, setChatRestricted] = useState(false);

  const [draft, setDraft]         = useState('');
  const [sending, setSending]     = useState(false);
  const [sendError, setSendError] = useState(null);

  // Refs that must not retrigger effects.
  const sinceRef     = useRef(null);   // serverTime cursor for the next poll
  const idsRef       = useRef(new Set()); // seen message ids (dedupe)
  const scrollRef    = useRef(null);   // scrollable message area
  const bottomRef    = useRef(null);   // auto-scroll anchor
  const sendingRef   = useRef(false);  // avoid overlapping sends

  // ── Message merge (dedupe by id, advance cursor) ──────────────────────────
  const mergeMessages = useCallback((incoming, serverTime) => {
    if (serverTime) sinceRef.current = serverTime;
    if (!incoming || incoming.length === 0) return;
    const seen = idsRef.current;
    const fresh = [];
    for (const m of incoming) {
      if (m && m.id != null && !seen.has(m.id)) {
        seen.add(m.id);
        fresh.push(m);
      }
    }
    if (fresh.length === 0) return;
    setMessages(prev => [...prev, ...fresh]);
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await screeningApi.listChat(pid);
      idsRef.current = new Set();
      setMessages([]);
      mergeMessages(data?.messages || [], data?.serverTime);
      setCanChat(data?.canChat ?? access.canChat ?? false);
      setChatRestricted(!!data?.chatRestricted);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load the project chat.');
    } finally {
      setLoading(false);
    }
  }, [pid, mergeMessages, access.canChat]);

  useEffect(() => { load(); }, [load]);

  // ── Polling (every 4s; skip while the tab is hidden) ──────────────────────
  useEffect(() => {
    if (loading || loadError) return undefined;
    let cancelled = false;

    const poll = async () => {
      if (document.hidden) return;            // pause while backgrounded
      if (sinceRef.current == null) return;
      try {
        const data = await screeningApi.listChat(pid, sinceRef.current);
        if (cancelled) return;
        mergeMessages(data?.messages || [], data?.serverTime);
        if (data?.canChat != null) setCanChat(data.canChat);
        if (data?.chatRestricted != null) setChatRestricted(!!data.chatRestricted);
      } catch {
        /* transient poll failure — keep the cursor and retry next tick */
      }
    };

    const timer = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pid, loading, loadError, mergeMessages]);

  // ── Auto-scroll to bottom on new messages ─────────────────────────────────
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length]);

  // ── Permission gate ───────────────────────────────────────────────────────
  const blocked = chatRestricted && !canChat && !access.isLeader;

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendingRef.current || blocked) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const res = await screeningApi.postChat(pid, { message: text });
      const msg = res?.message;
      if (msg) mergeMessages([msg]);     // optimistic append (deduped by id)
      setDraft('');
    } catch (e) {
      setSendError(e?.message || 'Could not send your message.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [draft, blocked, pid, mergeMessages]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.title}>Project Chat</span>
        {!loading && !loadError && (
          <span style={S.count}>{messages.length}</span>
        )}
      </div>

      {/* Message area */}
      <div ref={scrollRef} style={S.scroll}>
        {loading ? (
          <div style={S.center}><Spinner size={16} /></div>
        ) : loadError ? (
          <div style={S.error}>{loadError}</div>
        ) : messages.length === 0 ? (
          <div style={S.empty}>No messages yet — start the conversation.</div>
        ) : (
          messages.map(m => <MessageRow key={m.id} m={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer / composer */}
      <div style={S.footer}>
        {blocked ? (
          <div style={S.blocked}>
            You don&apos;t have permission to send messages in this project.
          </div>
        ) : (
          <>
            {sendError && <div style={S.sendError}>{sendError}</div>}
            <div style={S.composer}>
              <input
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Write a message…"
                disabled={sending}
                style={S.input}
                onFocus={e => { e.currentTarget.style.borderColor = C.acc2; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.brd2; }}
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !draft.trim()}
                style={{
                  ...S.send,
                  opacity: sending || !draft.trim() ? 0.5 : 1,
                  cursor: sending || !draft.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {sending ? <Spinner size={13} /> : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── A single message bubble ──────────────────────────────────────────────────
function MessageRow({ m }) {
  const mine = !!m.isMe;
  return (
    <div style={{ ...S.row, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{ ...S.meta, flexDirection: mine ? 'row-reverse' : 'row' }}>
        <Avatar name={m.senderName} size={18} />
        <span style={S.sender}>{m.senderName}</span>
        <span style={S.time}>{fmtTime(m.createdAt)}</span>
      </div>
      <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : S.bubbleOther) }}>
        {m.message}
      </div>
    </div>
  );
}

// ── Styles (inline only) ─────────────────────────────────────────────────────
const S = {
  panel: {
    display: 'flex', flexDirection: 'column',
    background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 10,
    fontFamily: FONT, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0,
  },
  title: {
    fontSize: 12, fontWeight: 600, color: C.txt, letterSpacing: '0.02em',
  },
  count: {
    fontSize: 10, fontFamily: MONO, fontWeight: 600, color: C.muted,
    background: C.card, border: `1px solid ${C.brd}`, borderRadius: 4, padding: '1px 6px',
  },
  scroll: {
    maxHeight: 360, overflowY: 'auto', padding: '12px 12px 4px',
    display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 80,
  },
  center: { display: 'flex', justifyContent: 'center', padding: '24px 0' },
  error: { color: C.red, fontSize: 12, padding: '12px 4px', lineHeight: 1.5 },
  empty: {
    color: C.muted, fontSize: 12, textAlign: 'center', padding: '28px 12px', lineHeight: 1.5,
  },
  row: { display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '100%' },
  meta: { display: 'flex', alignItems: 'center', gap: 6 },
  sender: {
    fontSize: 11, fontWeight: 500, color: C.txt2,
    maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  time: { fontSize: 9, fontFamily: MONO, color: C.muted },
  bubble: {
    fontSize: 12.5, lineHeight: 1.5, color: C.txt, borderRadius: 9,
    padding: '7px 11px', maxWidth: '88%', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
  },
  bubbleMine: {
    background: C.acc2 + '22', border: `1px solid ${C.acc2}55`, alignSelf: 'flex-end',
  },
  bubbleOther: {
    background: C.card, border: `1px solid ${C.brd}`, alignSelf: 'flex-start',
  },
  footer: { padding: '10px 12px', borderTop: `1px solid ${C.brd}`, flexShrink: 0 },
  blocked: {
    fontSize: 11.5, color: C.muted, lineHeight: 1.5,
    background: C.card, border: `1px dashed ${C.brd2}`, borderRadius: 7, padding: '8px 10px',
  },
  sendError: { fontSize: 11, color: C.red, marginBottom: 6, lineHeight: 1.4 },
  composer: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, minWidth: 0, background: C.card, border: `1px solid ${C.brd2}`,
    borderRadius: 7, padding: '8px 11px', color: C.txt, fontSize: 12.5,
    fontFamily: FONT, outline: 'none', transition: 'border-color 0.15s',
  },
  send: {
    flexShrink: 0, fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
    background: C.acc2, border: 'none', color: '#fff', borderRadius: 7,
    padding: '8px 14px', minWidth: 56, display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.15s',
  },
};
