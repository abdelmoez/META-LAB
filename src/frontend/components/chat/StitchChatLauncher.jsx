/**
 * StitchChatLauncher.jsx — the Stitch-header project-chat launcher.
 *
 * Rendered ONCE inside StitchTopHeader (stitch/shell/shellParts.jsx) beside the
 * notification bell, so the chat icon is present on EVERY Stitch page. Chat is
 * project-scoped, so the launcher is driven by an optional project context the
 * page threads down (StitchAppShell `chatContext` → StitchTopHeader → here):
 *
 *   • No project in context (global pages: dashboard, profile, …) → the icon is
 *     GREYED + unclickable ("Open a project to use chat").
 *   • Project in context → probe the META·LAB chat door ONCE — metalabListChat
 *     with since=now: zero message payload, but the server returns the access
 *     write-gates (canChat / chatRestricted / isLeader) from the resolved scope:
 *       – 404             → no linked Screening workspace → GREYED
 *                           ("Link a Screening project to enable chat").
 *       – restricted      → !isLeader && !canChat (a leader/owner turned a
 *                           member's chat off, or the project-wide chatRestricted
 *                           flag with no canChat) → GREYED + unclickable
 *                           ("Chat is restricted by a project owner or leader") —
 *                           exactly the server write-gate `canWriteChat`.
 *       – may participate → isLeader || canChat → ACTIVE: opens the shared
 *                           ChatDrawer (metalab adapter) + shows the unread badge.
 *
 * The ChatDrawer (shared with the legacy launchers) is mounted ONLY when the user
 * may participate, so a restricted / unlinked / no-project state never polls. The
 * drawer self-refreshes canChat/chatRestricted from every list() response; we also
 * pass isLeader so a leader is never read-only — matching canWriteChat server-side.
 *
 * Visual idiom matches NotificationsBell (its header neighbour): a 30px circular
 * brand-tinted button + red unread badge, styled with Stitch tokens.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { S, salpha } from '../../stitch/theme/stitchTokens.js';
import { Icon } from '../icons.jsx';
import { StitchTooltip } from '../../stitch/primitives/overlay.jsx';
import { screeningApi } from '../../screening/api-client/screeningApi.js';
import ChatDrawer from './ChatDrawer.jsx';

/**
 * Pure derivation of the launcher's visual state from the resolved access probe —
 * the heart of the feature (enabled vs greyed, and WHY). Exported so the decision
 * can be unit-tested without a DOM or network.
 *
 *   status: 'idle' (no project) | 'probing' | 'linked' | 'unlinked'
 *   mayParticipate === the server write-gate canWriteChat(access) = isLeader || canChat
 *
 * Returns { mayParticipate, enabled, disabledReason, tipLabel }. `enabled` ⇒ the
 * icon is clickable and the ChatDrawer mounts; otherwise it is greyed + unclickable
 * and `disabledReason` explains why (also the tooltip + accessible name).
 */
export function deriveChatLauncherState({ projectId, status, canChat, isLeader, projectName = '' }) {
  const mayParticipate = !!(isLeader || canChat);
  const enabled = !!projectId && status === 'linked' && mayParticipate;
  let disabledReason = null;
  if (!projectId) disabledReason = 'Open a project to use chat';
  else if (status === 'probing' || status === 'idle') disabledReason = 'Project chat';
  else if (status === 'unlinked') disabledReason = 'Link a Screening project to enable chat';
  else if (!mayParticipate) disabledReason = 'Chat is restricted by a project owner or leader';
  const tipLabel = enabled
    ? (projectName ? `Chat — ${projectName}` : 'Project chat')
    : disabledReason;
  return { mayParticipate, enabled, disabledReason, tipLabel };
}

export default function StitchChatLauncher({ projectId = null, projectName = '' }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // 'idle' (no project) | 'probing' | 'linked' | 'unlinked'
  const [status, setStatus] = useState('idle');
  const [canChat, setCanChat] = useState(false);
  const [chatRestricted, setChatRestricted] = useState(false);
  const [isLeader, setIsLeader] = useState(false);

  // Probe the metalab chat door once per project: resolve link status + the chat
  // write-gates WITHOUT loading history (since=now → zero messages, but the access
  // fields are returned unconditionally). 404 ⇒ no linked Screening workspace.
  useEffect(() => {
    if (!projectId) {
      setStatus('idle'); setCanChat(false); setChatRestricted(false); setIsLeader(false);
      setUnread(0); setOpen(false);
      return undefined;
    }
    let cancelled = false;
    setStatus('probing'); setOpen(false);
    screeningApi.metalabListChat(projectId, new Date().toISOString())
      .then((d) => {
        if (cancelled) return;
        setStatus('linked');
        setCanChat(!!d?.canChat);
        setChatRestricted(!!d?.chatRestricted);
        setIsLeader(!!d?.isLeader);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e?.status === 404) {
          setStatus('unlinked');
        } else {
          // Fail-safe: a non-404 error leaves the icon greyed (cannot prove access).
          setStatus('linked'); setCanChat(false); setChatRestricted(false); setIsLeader(false);
        }
      });
    return () => { cancelled = true; };
  }, [projectId]);

  // Metalab adapter — the six drawer operations over /metalab/:mlpid/chat*.
  const api = useMemo(() => ({
    list:        (since) => screeningApi.metalabListChat(projectId, since),
    post:        (body)  => screeningApi.metalabPostChat(projectId, body),
    unreadCount: ()      => screeningApi.metalabChatUnreadCount(projectId),
    markRead:    ()      => screeningApi.metalabMarkChatRead(projectId),
    typing:      ()      => screeningApi.metalabChatTyping(projectId),
    remove:      (id)    => screeningApi.metalabDeleteChat(projectId, id),
  }), [projectId]);

  // SSE poke match — chat.message pokes carry metaLabProjectId when linked.
  const idRef = useRef(projectId);
  idRef.current = projectId;
  const realtimeMatch = useCallback(
    (ev) => ev?.type === 'chat.message' && ev?.metaLabProjectId === idRef.current,
    [],
  );

  const { enabled, tipLabel } = deriveChatLauncherState({ projectId, status, canChat, isLeader, projectName });

  // Shared circular geometry (matches NotificationsBell — 30px brand-tinted disc).
  const baseStyle = {
    position: 'relative', width: 30, height: 30, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: S.font, padding: 0, userSelect: 'none', flexShrink: 0,
    transition: 'background 0.15s ease, border-color 0.15s ease',
  };

  const button = enabled ? (
    <button
      type="button"
      className="stitch-focusable"
      aria-label={tipLabel}
      data-testid="stitch-chat-button"
      onClick={() => setOpen(true)}
      onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = salpha(S.brand, 0.18); }}
      onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = salpha(S.brand, 0.1); }}
      style={{
        ...baseStyle,
        background: open ? salpha(S.brand, 0.24) : salpha(S.brand, 0.1),
        border: `1px solid ${open ? salpha(S.brand, 0.55) : salpha(S.brand, 0.3)}`,
        color: S.brand, cursor: 'pointer',
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}><Icon name="chat" size={16} /></span>
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px',
          background: S.danger, color: S.onDanger, fontSize: 9, fontFamily: S.mono, fontWeight: 700,
          borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${S.card}`, lineHeight: 1,
        }}>{unread > 9 ? '9+' : unread}</span>
      )}
    </button>
  ) : (
    // GREYED + unclickable. aria-disabled (NOT native `disabled`) keeps the control
    // focusable so the tooltip still reveals the reason chat is unavailable; the
    // click handler is a no-op so it can never open.
    <button
      type="button"
      className="stitch-focusable"
      aria-label={tipLabel}
      aria-disabled="true"
      data-testid="stitch-chat-button"
      onClick={(e) => e.preventDefault()}
      style={{
        ...baseStyle,
        background: S.surfaceContainer,
        border: `1px solid ${salpha(S.outlineVariant, 0.6)}`,
        color: S.textMuted, opacity: 0.6, cursor: 'not-allowed',
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}><Icon name="chat" size={16} /></span>
    </button>
  );

  return (
    <>
      <StitchTooltip label={tipLabel} placement="bottom">{button}</StitchTooltip>
      {/* Mounted ONLY when the user may participate — a restricted / unlinked /
          no-project state never polls. Renders null while closed (background
          unread poll stays alive so the badge stays fresh). */}
      {enabled && (
        <ChatDrawer
          key={projectId}
          api={api}
          open={open}
          onClose={() => setOpen(false)}
          onUnreadChange={setUnread}
          canChat={canChat}
          isLeader={isLeader}
          restricted={chatRestricted}
          title={(projectName && projectName.trim()) || 'Project chat'}
          realtimeMatch={realtimeMatch}
        />
      )}
    </>
  );
}
