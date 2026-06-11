/**
 * MetaLabChatLauncher.jsx — META·LAB-side project chat launcher (prompt7).
 *
 * Mounted by the workspace header as:
 *   <MetaLabChatLauncher metaLabProjectId={project.id} />
 *
 * The chat thread lives on the linked META·SIFT ScreenProject; the META·LAB
 * door (/api/screening/metalab/:mlpid/chat*) resolves the link server-side.
 * On mount we probe the unread-count endpoint:
 *   • HTTP 404  → no linked META·SIFT project (or no access) → render a
 *     DISABLED ghost button (tooltip explains how to enable) and never poll.
 *   • success   → linked → mount the shared ChatDrawer with the metalab
 *     adapter; SSE chat.message pokes are matched on event.metaLabProjectId.
 *
 * All drawer behavior (poll stretch while SSE healthy, server-authoritative
 * unread, mark-read on open, typing, backdrop/Escape close, composer focus
 * after send) lives in ChatDrawer.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { C, FONT, MONO } from '../../theme/tokens.js';
import { Icon } from '../icons.jsx';
import { screeningApi } from '../../screening/api-client/screeningApi.js';
import ChatDrawer from './ChatDrawer.jsx';

export default function MetaLabChatLauncher({ metaLabProjectId }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // 'probing' | 'linked' | 'unlinked'
  const [status, setStatus] = useState('probing');

  // Probe the metalab door once per project: 404 ⇒ not linked (disabled state).
  useEffect(() => {
    let cancelled = false;
    setStatus('probing'); setUnread(0); setOpen(false);
    screeningApi.metalabChatUnreadCount(metaLabProjectId)
      .then(d => { if (!cancelled) { setStatus('linked'); setUnread(d?.unread || 0); } })
      .catch(e => { if (!cancelled) setStatus(e?.status === 404 ? 'unlinked' : 'linked'); });
    return () => { cancelled = true; };
  }, [metaLabProjectId]);

  // Metalab adapter — six drawer operations over /metalab/:mlpid/chat*.
  const api = useMemo(() => ({
    list:        (since) => screeningApi.metalabListChat(metaLabProjectId, since),
    post:        (body)  => screeningApi.metalabPostChat(metaLabProjectId, body),
    unreadCount: ()      => screeningApi.metalabChatUnreadCount(metaLabProjectId),
    markRead:    ()      => screeningApi.metalabMarkChatRead(metaLabProjectId),
    typing:      ()      => screeningApi.metalabChatTyping(metaLabProjectId),
    remove:      (id)    => screeningApi.metalabDeleteChat(metaLabProjectId, id),
  }), [metaLabProjectId]);

  // SSE poke match — chat.message pokes carry metaLabProjectId when the
  // workspace is linked (poke carries no content; drawer refetches).
  const idRef = useRef(metaLabProjectId);
  idRef.current = metaLabProjectId;
  const realtimeMatch = useCallback(
    ev => ev?.type === 'chat.message' && ev?.metaLabProjectId === idRef.current,
    [],
  );

  const disabled = status !== 'linked';

  return (
    <>
      {/* Ghost icon-button */}
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(true); }}
        title={status === 'unlinked'
          ? 'Link a META·SIFT project to enable project chat'
          : 'Project chat'}
        aria-disabled={disabled}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2,
          fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: '6px 10px',
          borderRadius: 7,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}>
        <Icon name="chat" size={14} />
        <span>Chat</span>
        {!disabled && unread > 0 && (
          <span style={{
            position: 'absolute', top: -7, right: -7, minWidth: 16, height: 16, padding: '0 4px',
            background: C.acc2, color: C.accText, fontSize: 10, fontFamily: MONO, fontWeight: 700,
            borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${C.surf}`,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {/* Shared drawer — mounted ONLY when linked so the unlinked state never
          polls; renders null while closed (background unread poll stays alive). */}
      {status === 'linked' && (
        <ChatDrawer
          key={metaLabProjectId}
          api={api}
          open={open}
          onClose={() => setOpen(false)}
          onUnreadChange={setUnread}
          title="Project Chat"
          realtimeMatch={realtimeMatch}
        />
      )}
    </>
  );
}
