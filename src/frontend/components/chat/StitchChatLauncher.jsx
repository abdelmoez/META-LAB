/**
 * StitchChatLauncher.jsx — the Stitch-header project-chat launcher.
 *
 * Rendered inside StitchTopHeader (stitch/shell/shellParts.jsx) beside the
 * notification bell — but ONLY within a project. The header mounts it only when a
 * project context is present (chatContext.projectId), so the chat icon never shows
 * on global pages (dashboard / profile / activity / ops). Chat is project-scoped,
 * driven by the project context the page threads down (StitchAppShell `chatContext`
 * → StitchTopHeader → here):
 *
 *   • No project in context → the launcher is not mounted (defensive: if mounted
 *     with projectId=null it still renders the greyed "Open a project" state).
 *   • Project in context → probe the META·LAB chat door ONCE — metalabListChat
 *     with since=now: zero message payload, but the server returns the access
 *     signals (canChat / chatRestricted / isLeader) from the resolved scope:
 *       – 404             → no linked Screening workspace → GREYED
 *                           ("Link a Screening project to enable chat").
 *       – linked (member) → ACTIVE: opens the shared ChatDrawer (metalab adapter)
 *                           + shows the unread badge. Reading is never restricted,
 *                           so ANY resolved member opens chat.
 *       – linked, cannot post → still ACTIVE but READ-ONLY (tooltip "· read-only"):
 *                           a per-member mute or the project-wide "Restrict chat"
 *                           lock removes POSTING, enforced by the composer + server
 *                           (chatPolicy.canPostChatFlat === server canWriteChat),
 *                           NOT by hiding the icon (81.md).
 *
 * The ChatDrawer (shared with the legacy launchers) is mounted whenever the user is
 * a linked member; an unlinked / no-project / error state never polls. The drawer
 * self-refreshes canChat/chatRestricted/canPost from every list() response; we also
 * pass isLeader + chatRestricted so the composer's read-only state matches the server
 * gate immediately (before the first list()).
 *
 * Visual idiom matches NotificationsBell (its header neighbour): a 30px circular
 * brand-tinted button + red unread badge, styled with Stitch tokens.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { S, salpha } from '../../stitch/theme/stitchTokens.js';
import { Icon } from '../icons.jsx';
import { StitchTooltip } from '../../stitch/primitives/overlay.jsx';
import { screeningApi } from '../../screening/api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';
import ChatDrawer from './ChatDrawer.jsx';
import { canPostChatFlat, chatPostBlockReasonFlat } from '../../../research-engine/screening/chatPolicy.js';

/**
 * Pure derivation of the launcher's visual state from the resolved access probe —
 * the heart of the feature (enabled vs greyed, read-only vs writable, and WHY).
 * Exported so the decision can be unit-tested without a DOM or network.
 *
 *   status: 'idle' (no project) | 'probing' | 'linked' | 'unlinked' | 'error' (probe failed)
 *
 * 81.md — READING IS NEVER RESTRICTED (server contract): any resolved member of a
 * linked workspace may OPEN chat and read history. "Restrict chat" (and a per-member
 * mute) removes POSTING, which the composer + server enforce — NOT the launcher by
 * hiding the icon. So the icon is ENABLED for every linked member and greys ONLY when
 * there is nothing to open (no project / still probing / probe error / no linked
 * workspace). A member who cannot post opens a READ-ONLY drawer (the tooltip says so).
 *
 * `canPost` is the SHARED write gate (chatPolicy.canPostChatFlat) — the SAME rule the
 * server enforces: isLeader || (canChat && !chatRestricted). Before 81.md this file
 * re-derived a LOOSER `isLeader || canChat` that dropped the project-wide chatRestricted
 * lock (and gated `enabled` on it), so a restricted member's icon wrongly read as fully
 * active. Now there is one rule and the flag participates.
 *
 * Returns { canPost, readOnly, blockReason, enabled, disabledReason, tipLabel,
 *           mayParticipate }. `enabled` ⇒ the icon is clickable and the ChatDrawer
 * mounts; `readOnly` ⇒ enabled but the composer is read-only. `mayParticipate` is kept
 * as a back-compat alias of `canPost`.
 */
export function deriveChatLauncherState({ projectId, status, canChat, isLeader, chatRestricted = false, projectName = '' }) {
  const canPost = canPostChatFlat({ isLeader, canChat, chatRestricted });
  const blockReason = chatPostBlockReasonFlat({ isLeader, canChat, chatRestricted });
  const enabled = !!projectId && status === 'linked';
  const readOnly = enabled && !canPost;
  let disabledReason = null;
  if (!projectId) disabledReason = 'Open a project to use chat';
  else if (status === 'probing' || status === 'idle') disabledReason = 'Project chat';
  // A failed probe must NOT be blamed on a person — keep it neutral.
  else if (status === 'error') disabledReason = 'Chat is unavailable right now';
  else if (status === 'unlinked') disabledReason = 'Link a Screening project to enable chat';
  const nameLabel = projectName ? `Chat — ${projectName}` : 'Project chat';
  const tipLabel = enabled
    ? (readOnly ? `${nameLabel} · read-only` : nameLabel)
    : disabledReason;
  return { canPost, readOnly, blockReason, enabled, disabledReason, tipLabel, mayParticipate: canPost };
}

export default function StitchChatLauncher({ projectId = null, projectName = '' }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // 'idle' (no project) | 'probing' | 'linked' | 'unlinked' | 'error' (probe failed)
  const [status, setStatus] = useState('idle');
  const [canChat, setCanChat] = useState(false);
  const [chatRestricted, setChatRestricted] = useState(false);
  const [isLeader, setIsLeader] = useState(false);

  // Current project id + a monotonic probe-sequence guard so a re-probe (project
  // change OR a live permissions.changed poke) supersedes any in-flight response,
  // and we never setState after unmount.
  const idRef = useRef(projectId);
  idRef.current = projectId;
  const probeSeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Probe the metalab chat door: resolve link status + the chat write-gates WITHOUT
  // loading history (since=now → zero messages, but canChat/chatRestricted/isLeader
  // are returned unconditionally). 404 ⇒ no linked Screening workspace; any other
  // error ⇒ 'error' (greyed with a NEUTRAL reason — never blamed on a leader).
  const runProbe = useCallback((opts = {}) => {
    const pid = idRef.current;
    if (!pid) return;
    const seq = ++probeSeq.current;
    if (opts.initial) setStatus('probing');  // re-probes keep the current state until resolved (no flash)
    screeningApi.metalabListChat(pid, new Date().toISOString())
      .then((d) => {
        if (!mountedRef.current || seq !== probeSeq.current) return;
        setStatus('linked');
        setCanChat(!!d?.canChat);
        setChatRestricted(!!d?.chatRestricted);
        setIsLeader(!!d?.isLeader);
      })
      .catch((e) => {
        if (!mountedRef.current || seq !== probeSeq.current) return;
        setCanChat(false); setChatRestricted(false); setIsLeader(false);
        setStatus(e?.status === 404 ? 'unlinked' : 'error');
      });
  }, []);

  // (Re)probe when the project changes; reset to the no-project state otherwise.
  useEffect(() => {
    setOpen(false);
    if (!projectId) {
      probeSeq.current++; // cancel any in-flight probe
      setStatus('idle'); setCanChat(false); setChatRestricted(false); setIsLeader(false); setUnread(0);
      return;
    }
    runProbe({ initial: true });
  }, [projectId, runProbe]);

  // Live permission changes — a leader granting/restricting a member's chat, or
  // flipping the project-wide chatRestricted flag — emit a user-targeted
  // 'permissions.changed' poke. Re-probe so the icon's gate self-heals in BOTH
  // directions without a navigation/reload (the server is already authoritative).
  useRealtime({ 'permissions.changed': () => { if (idRef.current) runProbe(); } });

  // Metalab adapter — the six drawer operations over /metalab/:mlpid/chat*.
  const api = useMemo(() => ({
    list:        (since) => screeningApi.metalabListChat(projectId, since),
    post:        (body)  => screeningApi.metalabPostChat(projectId, body),
    unreadCount: ()      => screeningApi.metalabChatUnreadCount(projectId),
    markRead:    ()      => screeningApi.metalabMarkChatRead(projectId),
    typing:      ()      => screeningApi.metalabChatTyping(projectId),
    remove:      (id)    => screeningApi.metalabDeleteChat(projectId, id),
  }), [projectId]);

  // SSE poke match — chat.message pokes carry metaLabProjectId when linked (idRef
  // is defined above, alongside the probe guard).
  const realtimeMatch = useCallback(
    (ev) => ev?.type === 'chat.message' && ev?.metaLabProjectId === idRef.current,
    [],
  );

  const { enabled, tipLabel } = deriveChatLauncherState({ projectId, status, canChat, isLeader, chatRestricted, projectName });

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
