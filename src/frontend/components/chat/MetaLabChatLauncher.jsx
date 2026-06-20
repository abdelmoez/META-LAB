/**
 * MetaLabChatLauncher.jsx — META·LAB-side project chat launcher (prompt7).
 *
 * Mounted by the monolith's project view (prompt8) as a fixed top-right
 * utility beside NotificationsBell/UserMenu ([chat][bell][account]):
 *   <div style={{position:'fixed',top:12,right:96,zIndex:9999}}>
 *     <MetaLabChatLauncher metaLabProjectId={project.id} />
 *   </div>
 *
 * The chat thread lives on the linked META·SIFT ScreenProject; the META·LAB
 * door (/api/screening/metalab/:mlpid/chat*) resolves the link server-side.
 * On mount we probe the unread-count endpoint:
 *   • HTTP 404  → no linked META·SIFT project (or no access) → render the
 *     same circular button DISABLED (tooltip explains how to enable) and
 *     never poll.
 *   • success   → linked → mount the shared ChatDrawer with the metalab
 *     adapter; SSE chat.message pokes are matched on event.metaLabProjectId.
 *
 * All drawer behavior (poll stretch while SSE healthy, server-authoritative
 * unread, mark-read on open, typing, backdrop/Escape close, composer focus
 * after send) lives in ChatDrawer.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../../theme/tokens.js';
import { Icon } from '../icons.jsx';
import { screeningApi } from '../../screening/api-client/screeningApi.js';
import ChatDrawer from './ChatDrawer.jsx';

export default function MetaLabChatLauncher({ metaLabProjectId, projectName = '' }) {
  // prompt20 Task 3 — the drawer title is the current Review Project name so users
  // always know which project they are chatting in. The drawer header already
  // truncates with an ellipsis + full-name tooltip and flex-shrinks the close
  // button, so long names never overlap the controls. Falls back to a neutral
  // label while the project name is still loading.
  const chatTitle = (projectName && projectName.trim()) ? projectName.trim() : 'Project chat';
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
      {/* Circular utility icon-button — matches NotificationsBell's idiom so the
          fixed top-right cluster reads [chat][bell][account] (prompt8). */}
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(true); }}
        title={status === 'unlinked'
          ? 'Link a Screening project to enable project chat'
          : (projectName ? `Project chat — ${projectName}` : 'Project chat')}
        aria-label="Project chat"
        aria-disabled={disabled}
        onMouseEnter={e => { if (!disabled && !open) e.currentTarget.style.background = alpha(C.acc, '26'); }}
        onMouseLeave={e => { if (!disabled && !open) e.currentTarget.style.background = alpha(C.acc, '18'); }}
        style={{
          position: 'relative', width: 30, height: 30, borderRadius: '50%',
          background: open ? alpha(C.acc, '30') : alpha(C.acc, '18'),
          border: `1px solid ${open ? alpha(C.acc, '60') : alpha(C.acc, '30')}`,
          color: C.acc, fontFamily: FONT, padding: 0,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none',
        }}>
        <span aria-hidden="true" style={{ display: 'inline-flex' }}><Icon name="chat" size={15} /></span>
        {!disabled && unread > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16, padding: '0 4px',
            background: C.red, color: C.accText, fontSize: 9, fontFamily: MONO, fontWeight: 700,
            borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${C.card}`, lineHeight: 1,
          }}>{unread > 9 ? '9+' : unread}</span>
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
          title={chatTitle}
          realtimeMatch={realtimeMatch}
        />
      )}
    </>
  );
}
