/**
 * MyWorkView.jsx — the dashboard "My Work" surface (design2.md Replacement menu).
 *
 * Real, per-user, permission-safe work across projects — NOT a fake page. It lists
 * the user's screening projects (screeningApi.listProjects — the user's owned +
 * member projects) and, for each, the COUNT of records this user still owes a
 * decision on plus unresolved conflicts (screeningApi.getStats — server-scoped to
 * reviewerId === the caller, audit B). Each row deep-links into the real screening
 * engine to act. No work is invented; an empty result shows an honest empty state.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { screeningApi } from '../../../screening/api-client/screeningApi.js';
import {
  StitchCard, StitchSectionHeader, StitchBadge, StitchButton, StitchEmptyState,
  StitchLoadingState, StitchErrorState, StitchIcon, S, salpha,
} from '../../primitives';

const ROLE_LABEL = { owner: 'Owner', leader: 'Leader', reviewer: 'Reviewer', viewer: 'Viewer' };
const MAX_FANOUT = 16; // cap the N+1 fan-out (audit B: no aggregate endpoint exists)

// Open a work row: linked screening → the unified workspace's screening tab;
// standalone screening (no PecanRev parent) → the engine route.
function workHref(row) {
  return row.linkedProjectId
    ? `/app/project/${encodeURIComponent(row.linkedProjectId)}?tab=screening`
    : `/sift-beta/projects/${encodeURIComponent(row.id)}`;
}

export default function MyWorkView() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await screeningApi.listProjects();
      const projects = (Array.isArray(list) ? list : (list?.projects || []))
        .filter((p) => !p.archived)
        .slice(0, MAX_FANOUT);
      const stats = await Promise.allSettled(projects.map((p) => screeningApi.getStats(p.id)));
      const merged = projects.map((p, i) => {
        const s = stats[i].status === 'fulfilled' ? stats[i].value : null;
        return {
          id: p.id,
          // The parent PecanRev project (when this screening project is linked) lets
          // us open the work inside the unified workspace instead of the standalone
          // engine. Standalone screening projects have none → keep the engine route.
          linkedProjectId: p.linkedMetaLabProjectId || null,
          title: p.title || 'Untitled project',
          // Use the server-supplied role; never guess a role that could over-state
          // the user's actual access (a neutral "Member" is shown if it's absent).
          role: p.currentUserRole || p.myRole || (p.isOwner ? 'owner' : ''),
          undecided: s ? (s.undecided ?? null) : null,
          conflicts: s ? (s.conflicts ?? null) : null,
          progress: s ? (s.progress ?? null) : null,
          total: s ? (s.total ?? null) : null,
        };
      });
      // Surface actionable projects first.
      merged.sort((a, b) => ((b.undecided || 0) + (b.conflicts || 0)) - ((a.undecided || 0) + (a.conflicts || 0)));
      setRows(merged);
    } catch {
      setError('Could not load your work. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <StitchLoadingState label="Gathering work that needs your attention…" />;
  if (error) return <StitchErrorState title="Couldn't load My Work" desc={error} onRetry={() => { setLoading(true); load(); }} />;

  const actionable = (rows || []).filter((r) => (r.undecided || 0) > 0 || (r.conflicts || 0) > 0);
  const totalQueue = (rows || []).reduce((n, r) => n + (r.undecided || 0), 0);
  const totalConflicts = (rows || []).reduce((n, r) => n + (r.conflicts || 0), 0);

  if (!rows || !rows.length) {
    return (
      <StitchCard>
        <StitchEmptyState icon="checkSquare" title="No projects yet"
          desc="When you join or create a project, the screening, conflicts and reviews that need you will appear here." />
      </StitchCard>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <StatTile icon="filter" label="Records you haven't screened" value={totalQueue} tone={totalQueue ? 'brand' : 'neutral'} />
        <StatTile icon="alertTriangle" label="Conflicts to resolve" value={totalConflicts} tone={totalConflicts ? 'danger' : 'neutral'} />
        <StatTile icon="folder" label="Active projects" value={rows.length} />
      </div>

      <StitchCard>
        <StitchSectionHeader title="Needs your attention" desc="Projects with screening or conflicts assigned to you" />
        {actionable.length ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {actionable.map((r, i) => (
              <WorkRow key={r.id} row={r} last={i === actionable.length - 1} onOpen={() => navigate(workHref(r))} />
            ))}
          </div>
        ) : (
          <StitchEmptyState icon="circleCheck" title="You're all caught up" height={180}
            desc="There's no screening or conflicts waiting on you right now across your projects." />
        )}
      </StitchCard>
    </div>
  );
}

function StatTile({ icon, label, value, tone = 'neutral' }) {
  const accent = tone === 'brand' ? S.brand : tone === 'danger' ? S.danger : S.textSecondary;
  return (
    <StitchCard style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: S.textSecondary }}>{label}</span>
        <span style={{ color: accent }}><StitchIcon name={icon} size={18} /></span>
      </div>
      <span style={{ fontSize: 28, fontWeight: 700, color: S.textPrimary, lineHeight: 1 }}>{value}</span>
    </StitchCard>
  );
}

function WorkRow({ row, last, onOpen }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 4px', borderBottom: last ? 'none' : `1px solid ${salpha(S.outlineVariant, 0.3)}` }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
          <StitchBadge tone="neutral">{ROLE_LABEL[row.role] || 'Member'}</StitchBadge>
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
          {row.undecided ? <span style={{ fontSize: 12.5, color: S.textSecondary, display: 'inline-flex', alignItems: 'center', gap: 6 }}><StitchIcon name="filter" size={13} />{row.undecided} to screen</span> : null}
          {row.conflicts ? <span style={{ fontSize: 12.5, color: S.danger, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><StitchIcon name="alertTriangle" size={13} />{row.conflicts} conflicts</span> : null}
          {row.progress != null ? <span style={{ fontSize: 12.5, color: S.textMuted }}>{row.progress}% screened</span> : null}
        </div>
      </div>
      <StitchButton size="sm" iconRight="arrowRight" onClick={onOpen}>Continue</StitchButton>
    </div>
  );
}
