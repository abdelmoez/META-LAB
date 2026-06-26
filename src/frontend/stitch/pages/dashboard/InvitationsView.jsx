/**
 * InvitationsView.jsx — the dashboard "Invitations & Collaboration" surface
 * (design2.md Part 1 + menu, with a badge).
 *
 * Received project invitations are surfaced from the REAL notification stream
 * (Notification.type === 'PROJECT_INVITE') — there is no dedicated "my invitations"
 * endpoint (audit B), so we reuse the same per-user, cross-project data the bell
 * and rail badge use (via useInvitations). Opening an invitation marks it read
 * through the real endpoint and deep-links to the project. No fake/empty page.
 */
import { useNavigate } from 'react-router-dom';
import { notificationsApi } from '../../../api-client/notificationsApi.js';
import { relTime } from '../../../pages/projectLanding.helpers.js';
import { useInvitations } from '../../shell/useInvitations.js';
import {
  StitchCard, StitchSectionHeader, StitchBadge, StitchButton, StitchEmptyState,
  StitchLoadingState, StitchAvatar, S, salpha,
} from '../../primitives';

function targetUrl(n) {
  // design4: prefer the unified PecanRev workspace; a screening notification on a
  // LINKED project opens the embedded screening engine in-shell, while a standalone
  // screening project (no PecanRev parent) keeps the engine route.
  if (n.relatedMetaLabProjectId) {
    const base = `/app/project/${encodeURIComponent(n.relatedMetaLabProjectId)}`;
    return n.relatedScreenProjectId ? `${base}?tab=screening` : base;
  }
  if (n.relatedScreenProjectId) return `/sift-beta/projects/${encodeURIComponent(n.relatedScreenProjectId)}`;
  return null;
}

export default function InvitationsView() {
  const navigate = useNavigate();
  const { items, loading, reload } = useInvitations();

  if (loading) return <StitchLoadingState label="Loading your invitations…" />;

  const pending = items.filter((n) => !n.readAt && !n.dismissedAt);
  const seen = items.filter((n) => n.readAt || n.dismissedAt);

  const open = async (n) => {
    const url = targetUrl(n);
    try { if (!n.readAt) { await notificationsApi.opened(n.id); reload(true); } } catch { /* non-fatal */ }
    if (url) navigate(url);
  };

  const Row = ({ n, last }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', borderBottom: last ? 'none' : `1px solid ${salpha(S.outlineVariant, 0.3)}` }}>
      <StitchAvatar name={n.actorName || 'Invitation'} size={36} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, color: S.textPrimary, lineHeight: 1.45 }}>
          {n.title ? <strong>{n.title}</strong> : 'Project invitation'}{n.message ? ` — ${n.message}` : ''}
        </div>
        <div style={{ fontSize: 11.5, color: S.textMuted, marginTop: 2 }}>
          {n.actorName ? `From ${n.actorName} · ` : ''}{n.role ? `${n.role} · ` : ''}{relTime(n.createdAt)}
        </div>
      </div>
      <StitchButton size="sm" variant={n.readAt ? 'neutral' : 'primary'} iconRight="arrowRight" onClick={() => open(n)}>
        {n.readAt ? 'View' : 'Open'}
      </StitchButton>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <StitchCard>
        <StitchSectionHeader
          title="Pending invitations"
          desc="Projects you've been invited to collaborate on"
          action={pending.length ? <StitchBadge tone="brand" dot>{pending.length} pending</StitchBadge> : null}
        />
        {pending.length ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {pending.map((n, i) => <Row key={n.id || i} n={n} last={i === pending.length - 1} />)}
          </div>
        ) : (
          <StitchEmptyState icon="mail" title="No pending invitations" height={180}
            desc="When a colleague invites you to a project, it will appear here. You can also be added directly by a project owner." />
        )}
      </StitchCard>

      {seen.length ? (
        <StitchCard>
          <StitchSectionHeader title="Earlier invitations" desc="Invitations you've already opened" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {seen.slice(0, 10).map((n, i) => <Row key={n.id || i} n={n} last={i === Math.min(seen.length, 10) - 1} />)}
          </div>
        </StitchCard>
      ) : null}
    </div>
  );
}
