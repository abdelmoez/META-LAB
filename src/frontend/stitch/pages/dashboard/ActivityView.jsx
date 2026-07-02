/**
 * ActivityView.jsx — the dashboard "Activity" surface (design2.md Part 1 + menu).
 *
 * The only per-user, cross-project event stream that exists is the Notification
 * model (audit B) — the same data that powers the existing bell. This is a FULLER
 * list view of that real data (not a competing bell, not a fake page). Each row
 * deep-links to the project it concerns and "Mark all read" reuses the real
 * endpoint. design2.md merges the global Activity destination with the menu's
 * "Recent Activity" — this is that single surface.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { notificationsApi } from '../../../api-client/notificationsApi.js';
import { isStaffUser } from '../../../components/notificationTarget.js';
import { relTime } from '../../../pages/projectLanding.helpers.js';
import {
  StitchCard, StitchSectionHeader, StitchButton, StitchEmptyState,
  StitchLoadingState, StitchErrorState, StitchIcon, S, salpha,
} from '../../primitives';

const TYPE_ICON = {
  PROJECT_INVITE: 'mail', ROLE_CHANGED: 'users', MEMBER_ADDED: 'users', MEMBER_REMOVED: 'users',
  DECISION: 'checkSquare', CONFLICT: 'alertTriangle', IMPORT: 'upload', HANDOFF: 'arrowRight',
};
function iconFor(type) { return TYPE_ICON[type] || 'clock'; }

function targetUrl(n, staff) {
  // design4: prefer the unified PecanRev workspace. A screening-related notification
  // on a LINKED project lands directly on the embedded screening engine in-shell.
  // 65.md NAV-1: the standalone engine route is STAFF-ONLY (404-cloaked AdminRoute)
  // — a non-staff row without a workspace parent renders without navigation.
  if (n.relatedMetaLabProjectId) {
    const base = `/app/project/${encodeURIComponent(n.relatedMetaLabProjectId)}`;
    return n.relatedScreenProjectId ? `${base}?tab=screening` : base;
  }
  if (n.relatedScreenProjectId && staff) return `/sift-beta/projects/${encodeURIComponent(n.relatedScreenProjectId)}`;
  return null;
}

export default function ActivityView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const staff = isStaffUser(user);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await notificationsApi.list({ all: true, limit: 50 });
      setItems(Array.isArray(r?.notifications) ? r.notifications : []);
    } catch {
      setError('Could not load your activity.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markAll = async () => {
    setMarking(true);
    try { await notificationsApi.markAllRead(); await load(); } catch { /* non-fatal */ } finally { setMarking(false); }
  };

  const open = async (n) => {
    const url = targetUrl(n, staff);
    try { if (!n.readAt) await notificationsApi.opened(n.id); } catch { /* non-fatal */ }
    if (url) navigate(url);
  };

  if (loading) return <StitchLoadingState label="Loading your activity…" />;
  if (error) return <StitchErrorState title="Couldn't load activity" desc={error} onRetry={() => { setLoading(true); load(); }} />;

  const unread = (items || []).filter((n) => !n.readAt && !n.dismissedAt).length;

  return (
    <StitchCard>
      <StitchSectionHeader
        title="Recent activity"
        desc="Project updates, imports, screening progress, invitations and collaboration changes"
        action={unread ? <StitchButton size="sm" variant="neutral" icon="checkSquare" loading={marking} onClick={markAll}>Mark all read</StitchButton> : null}
      />
      {items && items.length ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((n, i) => {
            const url = targetUrl(n, staff);
            const unreadRow = !n.readAt && !n.dismissedAt;
            return (
              <button
                key={n.id || i} type="button" className="stitch-focusable"
                onClick={() => open(n)} disabled={!url && false}
                onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 8px', border: 'none', background: 'transparent',
                  cursor: url ? 'pointer' : 'default', textAlign: 'left', borderRadius: 8,
                  borderBottom: i < items.length - 1 ? `1px solid ${salpha(S.outlineVariant, 0.3)}` : 'none' }}
              >
                <span style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: unreadRow ? S.brandSoft : S.surfaceContainer, color: unreadRow ? S.onBrandSoft : S.textSecondary }}>
                  <StitchIcon name={iconFor(n.type)} size={16} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, color: S.textPrimary, lineHeight: 1.45 }}>
                    {n.title ? <strong>{n.title}</strong> : null}{n.title && n.message ? ' — ' : ''}{n.message}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: S.textMuted, marginTop: 2 }}>
                    {n.actorName ? `${n.actorName} · ` : ''}{relTime(n.createdAt)}
                  </span>
                </span>
                {unreadRow ? <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: '50%', background: S.brand, flexShrink: 0, marginTop: 13 }} /> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <StitchEmptyState icon="clock" title="No activity yet"
          desc="Updates from your projects — imports, screening, invitations and collaboration — will show up here." />
      )}
    </StitchCard>
  );
}
