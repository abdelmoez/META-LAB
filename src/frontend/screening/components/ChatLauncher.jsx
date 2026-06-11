/**
 * ChatLauncher.jsx — META·SIFT project-chat launcher (prompt2 Task 6,
 * refactored in prompt7 Task 11 to a thin wrapper around the shared
 * components/chat/ChatDrawer.jsx).
 *
 * The launcher owns only the header button + unread badge; ALL chat behavior
 * (polling with SSE-healthy stretch, server-authoritative unread, mark-read
 * on open, typing indicator, backdrop/Escape close, composer keeps focus
 * after send) lives in ChatDrawer, driven by the /projects/:pid adapter.
 *
 * The drawer stays MOUNTED while the launcher is mounted (it renders null
 * when closed) so the background unread poll keeps running.
 *
 * Props: pid, access ({ isLeader, canChat })
 */
import { useMemo, useState, useRef, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Icon } from '../../components/icons.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import ChatDrawer from '../../components/chat/ChatDrawer.jsx';

export default function ChatLauncher({ pid, access = {} }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // /projects/:pid adapter — the six drawer operations over the SIFT door.
  const api = useMemo(() => ({
    list:        (since) => screeningApi.listChat(pid, since),
    post:        (body)  => screeningApi.postChat(pid, body),
    unreadCount: ()      => screeningApi.chatUnreadCount(pid),
    markRead:    ()      => screeningApi.markChatRead(pid),
    typing:      ()      => screeningApi.chatTyping(pid),
    remove:      (id)    => screeningApi.deleteChat(pid, id),
  }), [pid]);

  // SSE poke match — chat.message for THIS ScreenProject.
  const pidRef = useRef(pid);
  pidRef.current = pid;
  const realtimeMatch = useCallback(ev => ev?.projectId === pidRef.current, []);

  return (
    <>
      {/* Circular utility icon-button — matches NotificationsBell's idiom so the
          header utility cluster reads [chat][bell][account] (prompt8). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Project chat"
        aria-label="Project chat"
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = alpha(C.acc, '26'); }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = alpha(C.acc, '18'); }}
        style={{
          position: 'relative', width: 30, height: 30, borderRadius: '50%',
          background: open ? alpha(C.acc, '30') : alpha(C.acc, '18'),
          border: `1px solid ${open ? alpha(C.acc, '60') : alpha(C.acc, '30')}`,
          color: C.acc, fontFamily: FONT, padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none',
        }}>
        <span aria-hidden="true" style={{ display: 'inline-flex' }}><Icon name="chat" size={15} /></span>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16, padding: '0 4px',
            background: C.red, color: C.accText, fontSize: 9, fontFamily: MONO, fontWeight: 700,
            borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${C.card}`, lineHeight: 1,
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {/* Shared drawer — mounted permanently; renders null while closed so the
          background unread poll + SSE subscription stay alive. */}
      <ChatDrawer
        key={pid}
        api={api}
        open={open}
        onClose={() => setOpen(false)}
        onUnreadChange={setUnread}
        canChat={access.canChat}
        isLeader={!!access.isLeader}
        title="Project Chat"
        realtimeMatch={realtimeMatch}
      />
    </>
  );
}
