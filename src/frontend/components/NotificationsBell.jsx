/**
 * NotificationsBell.jsx — shared notification bell for all four surfaces
 * (prompt6 Task 1): META·LAB workspace, SIFT dashboard, SIFT project, ops console.
 *
 * Self-contained like UserMenu (inline styles, outside-click + Escape close,
 * optional fixed positioning) with the ChatLauncher polling pattern: poll the
 * server-authoritative unread count every ~30s, pause while the tab is hidden.
 * Server contract lives in src/frontend/api-client/notificationsApi.js
 * (/api/notifications — its own router, never under rate-limited mounts).
 *
 * Opening a notification (prompt9 Task 1) calls POST /:id/opened — one
 * idempotent server call stamping readAt + dismissedAt + clickedAt — then
 * deep-links:
 *   relatedMetaLabProjectId      → /app?project=<id>
 *   else relatedScreenProjectId  → /sift-beta/projects/<id>
 * The clicked row leaves the active list optimistically and the badge
 * decrements immediately; dismissed rows survive in the "Show history" view
 * (?all=1), rendered dimmed with their readAt/dismissedAt stamps.
 * All four mounts live inside the app Router, so react-router navigation is
 * used — except when the target path equals the current one (e.g. /app → /app
 * with a new ?project=), where a full location.assign guarantees the monolith
 * re-reads the query param on mount. That reload aborts in-flight requests,
 * so opened() is awaited (bounded by a short timeout) BEFORE location.assign;
 * SPA navigations let it complete concurrently.
 *
 * Props:
 *   fixed  boolean — fixed top-right positioning (default false = inline)
 *   right  number  — right offset in fixed mode (default 16; AppWorkspace uses
 *                    a larger offset so the bell sits left of the UserMenu avatar)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { notificationsApi } from '../api-client/notificationsApi.js';
import { useRealtime } from '../hooks/useRealtime.js';
import Icon from './icons.jsx';
// Theme-aware tokens (prompt7): C values are `var(--t-*)` strings — hex+alpha
// concatenation does not work on vars, use `alpha(C.x, '40')` instead.
import { C, FONT, MONO, alpha } from '../theme/tokens.js';

const POLL_MS = 30000;
// While the SSE poke stream is healthy the 30s poll stretches to a slow
// safety net (pokes drive freshness); on SSE failure it snaps back to 30s.
const HEALTHY_POLL_MS = 120000;

// app field → chip presentation (META·LAB accent / META·SIFT teal / Workspace gold).
const APP_META = {
  metalab:   { label: 'META·LAB',  color: C.acc },
  metasift:  { label: 'META·SIFT', color: C.teal },
  workspace: { label: 'Workspace', color: C.gold },
};

function fmtAgo(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Deep-link target for a notification (META·LAB wins when both ids are set).
function targetUrl(n) {
  if (n.relatedMetaLabProjectId) return `/app?project=${n.relatedMetaLabProjectId}`;
  const sift = n.relatedScreenProjectId || n.relatedMetaSiftProjectId;
  if (sift) return `/sift-beta/projects/${sift}`;
  return null;
}

export default function NotificationsBell({ fixed = false, right = 16 }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const ref = useRef(null);

  const lastPollRef = useRef(0);
  // History mode mirrored into a ref so the stable loadList/realtime closures
  // always reload the view the user is currently looking at.
  const showHistoryRef = useRef(false);
  showHistoryRef.current = showHistory;

  // Server-authoritative unread count — best-effort, never surfaces errors.
  const refreshCount = useCallback(() => {
    lastPollRef.current = Date.now();
    notificationsApi.unreadCount()
      .then(d => setCount(d?.count || 0))
      .catch(() => {});
  }, []);

  // Load the panel list (newest first) whenever it opens (declared before the
  // realtime handler so the poke can refresh an open panel). History mode
  // (?all=1) includes dismissed rows for the "Show history" footer toggle.
  const loadList = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const d = await notificationsApi.list(
        showHistoryRef.current ? { limit: 50, all: true } : { limit: 20 },
      );
      setItems(d?.notifications || []);
      if (typeof d?.unreadCount === 'number') setCount(d.unreadCount);
    } catch (e) {
      setLoadError(e?.message || 'Could not load notifications.');
    } finally { setLoading(false); }
  }, []);

  // Realtime poke (prompt6 Task 7): refresh the badge (and the open panel)
  // immediately on notification.created. The poll below is the fallback.
  const { healthy: rtHealthy } = useRealtime({
    'notification.created': () => { refreshCount(); if (open) loadList(); },
  });
  const rtHealthyRef = useRef(rtHealthy);
  rtHealthyRef.current = rtHealthy;

  // Poll the badge while mounted; pause when the tab is hidden (ChatLauncher
  // pattern). While SSE is healthy, stretch the cadence (pokes do the work).
  useEffect(() => {
    if (!user) return undefined;
    refreshCount();
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (rtHealthyRef.current && Date.now() - lastPollRef.current < HEALTHY_POLL_MS) return;
      refreshCount();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [user, refreshCount]);

  // Opening always starts on the active (non-dismissed) list; toggling the
  // history view refetches in the new mode.
  useEffect(() => {
    if (open) loadList();
    else setShowHistory(false);
  }, [open, loadList]);
  useEffect(() => { if (open) loadList(); }, [showHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  // SPA navigation, except same-path query-only changes (the monolith reads
  // ?project= on mount, so /app → /app needs a real reload).
  const go = useCallback((url) => {
    const targetPath = url.split('?')[0];
    if (window.location.pathname === targetPath) window.location.assign(url);
    else navigate(url);
  }, [navigate]);

  // Click-through (prompt9 Task 1): POST /:id/opened stamps readAt +
  // dismissedAt + clickedAt server-side (idempotent). Optimistically the row
  // leaves the active list (dims in history view) and the badge decrements at
  // once; a server hiccup falls back to refreshCount on the next response.
  // Full-reload navigations (same-path /app?project=) abort in-flight fetches,
  // so opened() is awaited — bounded by a short timeout so a slow server
  // never blocks navigation. SPA navigations let it run concurrently.
  const openNotification = useCallback(async (n) => {
    const url = targetUrl(n);
    const alreadyDismissed = !!n.dismissedAt;
    const wasUnread = !n.readAt && !alreadyDismissed;

    if (!alreadyDismissed) {
      const now = new Date().toISOString();
      if (showHistoryRef.current) {
        setItems(prev => prev.map(it => (
          it.id === n.id ? { ...it, readAt: it.readAt || now, dismissedAt: now } : it
        )));
      } else {
        setItems(prev => prev.filter(it => it.id !== n.id));
      }
      if (wasUnread) setCount(c => Math.max(0, c - 1));
    }

    const opened = alreadyDismissed
      ? Promise.resolve()
      : Promise.race([
          notificationsApi.opened(n.id),
          new Promise(resolve => setTimeout(resolve, 1500)),
        ]).catch(() => { refreshCount(); });

    if (!url) { await opened; return; } // no target: row dismissed in place, panel stays open

    setOpen(false);
    const fullReload = window.location.pathname === url.split('?')[0];
    if (fullReload) await opened; // otherwise the unload aborts the request
    go(url);
  }, [go, refreshCount]);

  const markAllRead = useCallback(async () => {
    setClearing(true);
    try {
      await notificationsApi.markAllRead();
      const now = new Date().toISOString();
      setItems(prev => prev.map(it => (it.readAt ? it : { ...it, readAt: now })));
      setCount(0);
      refreshCount();
    } catch { /* badge re-syncs on next poll */ }
    finally { setClearing(false); }
  }, [refreshCount]);

  if (!user) return null;

  const wrapStyle = fixed
    ? { position: 'fixed', top: 12, right, zIndex: 9999, fontFamily: FONT }
    : { position: 'relative', fontFamily: FONT };

  return (
    <div ref={ref} style={wrapStyle}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          position: 'relative', width: 30, height: 30, borderRadius: '50%',
          background: open ? alpha(C.acc, '30') : alpha(C.acc, '18'),
          border: `1px solid ${open ? alpha(C.acc, '60') : alpha(C.acc, '30')}`,
          color: C.acc, fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none',
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}><Icon name="bell" size={16} /></span>
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16, padding: '0 4px',
            background: C.red, color: C.accText, fontSize: 9, fontFamily: MONO, fontWeight: 700,
            borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${C.card}`, lineHeight: 1,
          }}>{count > 99 ? '99+' : count}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 38, right: 0, background: C.card,
          border: `1px solid ${C.brd2}`, borderRadius: 10, padding: '4px 0',
          width: 340, maxWidth: '92vw', boxShadow: `0 8px 32px ${C.shadow}`, zIndex: 9999,
        }}>
          {/* Panel header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 14px 8px', borderBottom: `1px solid ${C.brd}`, marginBottom: 2,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>
              Notifications{count > 0 && <span style={{ color: C.muted, fontWeight: 400 }}> · {count} unread</span>}
            </span>
            {count > 0 && (
              <button onClick={markAllRead} disabled={clearing}
                style={{
                  background: 'none', border: 'none', cursor: clearing ? 'default' : 'pointer',
                  color: C.acc, fontSize: 11, fontFamily: FONT, padding: 0, opacity: clearing ? 0.6 : 1,
                }}>
                {clearing ? 'Clearing…' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '22px 14px', fontSize: 12, color: C.txt2, textAlign: 'center' }}>Loading…</div>
            ) : loadError ? (
              <div style={{ padding: '16px 14px', fontSize: 12, color: C.red }}>
                {loadError}
                <button onClick={loadList} style={{ marginLeft: 10, background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 11, padding: 0 }}>Retry</button>
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: '26px 14px', textAlign: 'center' }}>
                <div style={{ marginBottom: 6, opacity: 0.6, color: C.muted, display: 'flex', justifyContent: 'center' }}><Icon name="bell" size={16} /></div>
                <div style={{ fontSize: 12, color: C.txt2 }}>No notifications yet</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Project invites and updates will show up here.</div>
              </div>
            ) : (
              items.map(n => (
                <NotificationRow key={n.id} n={n} history={showHistory} onOpen={() => openNotification(n)} />
              ))
            )}
          </div>

          {/* Panel footer — history toggle (?all=1 includes dismissed rows) */}
          <div style={{
            borderTop: `1px solid ${C.brd}`, marginTop: 2,
            padding: '7px 14px 5px', display: 'flex', justifyContent: 'center',
          }}>
            <button onClick={() => setShowHistory(h => !h)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: showHistory ? C.acc : C.muted, fontSize: 11, fontFamily: FONT, padding: 0,
              }}>
              {showHistory ? '← Back to active' : 'Show history'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n, history = false, onOpen }) {
  const [hover, setHover] = useState(false);
  const dismissed = !!n.dismissedAt;
  const unread = !n.readAt && !dismissed;
  const app = APP_META[n.app];
  const actor = n.actorName || n.actorEmail || '';
  const hasTarget = !!targetUrl(n);
  // Whole-row click always does something on active rows (opened + dismiss,
  // even without a target); dismissed history rows only react with a target.
  const clickable = hasTarget || !dismissed;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        padding: '10px 14px 11px',
        borderBottom: `1px solid ${C.brd}`,
        background: hover && clickable ? C.card2 : unread ? alpha(C.acc, '0c') : 'transparent',
        borderLeft: `2px solid ${unread ? C.acc : 'transparent'}`,
        cursor: clickable ? 'pointer' : 'default',
        opacity: dismissed ? 0.55 : 1,
      }}
    >
      {/* Title + relative date */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span title={n.title} style={{
          fontSize: 12, fontWeight: unread ? 700 : 500, color: unread ? C.txt : C.txt2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>{n.title}</span>
        <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, flexShrink: 0 }}>{fmtAgo(n.createdAt)}</span>
      </div>

      {/* Message (inviter + role live here too, but show explicit meta below) */}
      {n.message && (
        <div style={{ fontSize: 11.5, color: C.txt2, marginTop: 3, lineHeight: 1.45, minWidth: 0, overflowWrap: 'anywhere' }}>{n.message}</div>
      )}

      {/* App chip · actor · role granted */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
        {app && (
          <span style={{
            fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: app.color, background: alpha(app.color, '18'),
            border: `1px solid ${alpha(app.color, '40')}`, borderRadius: 4, padding: '1px 6px',
          }}>{app.label}</span>
        )}
        {actor && (
          <span title={n.actorEmail || undefined} style={{ fontSize: 10.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
            {actor}
          </span>
        )}
        {n.role && (
          <span style={{
            fontSize: 8.5, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: C.txt2, background: C.brd,
            borderRadius: 4, padding: '1px 6px',
          }}>{n.role}</span>
        )}
        {hasTarget && (
          <button onClick={e => { e.stopPropagation(); onOpen(); }} style={{
            marginLeft: 'auto', background: 'none', border: `1px solid ${C.brd2}`,
            color: C.acc, fontSize: 10.5, fontFamily: FONT, fontWeight: 600,
            padding: '3px 9px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>Open project →</button>
        )}
      </div>

      {/* History view — read/dismissed stamps on soft-dismissed rows */}
      {history && dismissed && (
        <div style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, marginTop: 5 }}>
          {n.readAt ? `read ${fmtAgo(n.readAt)}` : ''}
          {n.readAt && n.dismissedAt ? ' · ' : ''}
          {n.dismissedAt ? `dismissed ${fmtAgo(n.dismissedAt)}` : ''}
        </div>
      )}
    </div>
  );
}
