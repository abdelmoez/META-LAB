/**
 * StitchDashboard.jsx — the Stitch dashboard hub (route /app).
 *
 * A single hub with several real, data-backed VIEWS selected by `?view=`
 * (design2.md Parts 1 + "Replacement dashboard menu"):
 *   - overview     → Workspace Overview (projects, metrics, recency)
 *   - mywork       → work that needs the user across projects
 *   - activity     → the per-user notification stream (merged "Recent Activity")
 *   - invitations  → project invitations & collaboration
 *   - archived     → archived projects
 *   - resources    → help, documentation & feedback
 *
 * The white column is a workspace MENU (no duplicated project list, no sidebar
 * New-Project button — project creation stays in the main content). Branding is
 * "PecanRev" with a prominent "Welcome, [first name]". All data shown is real;
 * empty/loading/error states are first-class.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../../api-client/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  STATUS_META, statusOf, roleOf, isOwnerOf, canEditOf, relTime, progressOf, ROLE_LABEL,
} from '../../pages/projectLanding.helpers.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import {
  StitchPageHeader, StitchCard, StitchMetricCard, StitchProgressRing, StitchButton, StitchBadge,
  StitchEmptyState, StitchLoadingState, StitchErrorState, StitchSectionHeader, StitchIcon,
  StitchField, StitchInput, StitchTextarea, StitchModal, StitchSearchInput, useStitchToast, S, salpha,
} from '../primitives';
import { STITCH_MONO } from '../theme/stitchTokens.js';
import { DASHBOARD_MENU, readView, dashboardHref, deleteConfirmMatches, welcomeGreeting } from '../nav/navConfig.js';
import { useInvitations } from '../shell/useInvitations.js';
import { useAppVersion } from '../shell/useAppVersion.js';
import MyWorkView from './dashboard/MyWorkView.jsx';
import ActivityView from './dashboard/ActivityView.jsx';
import InvitationsView from './dashboard/InvitationsView.jsx';
import ResourcesView from './dashboard/ResourcesView.jsx';

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'active', label: 'Active', test: (p) => statusOf(p) === 'active' },
  { key: 'inprogress', label: 'In progress', test: (p) => statusOf(p) === 'in_progress' },
  { key: 'done', label: 'Completed', test: (p) => statusOf(p) === 'done' },
  { key: 'owned', label: 'Owned by me', test: (p) => isOwnerOf(p) },
];

const VIEW_LABEL = {
  overview: 'Workspace Overview', mywork: 'My Work', activity: 'Activity',
  invitations: 'Invitations', archived: 'Archived Projects', resources: 'Resources',
};

function statusTone(status) {
  if (status === 'done') return 'success';
  if (status === 'in_progress') return 'info';
  if (status === 'archived') return 'neutral';
  return 'brand';
}

/* ─── Create-project modal (reuses api.projects.create) ───────────────────── */
function CreateProjectModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useStitchToast();

  const submit = async (e) => {
    e?.preventDefault?.();
    const trimmed = name.trim();
    if (!trimmed) { setErr('Please enter a project title.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.projects.create(trimmed, { description: description.trim() || undefined, createLinkedSift: true });
      toast.toast('Project created', { tone: 'success' });
      onCreated?.(res);
      setName(''); setDescription('');
    } catch (e2) {
      setErr(e2.message || 'Could not create the project.');
      setBusy(false);
    }
  };

  return (
    <StitchModal open={open} onClose={onClose} title="New project" width={460}
      footer={<>
        <StitchButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</StitchButton>
        <StitchButton onClick={submit} loading={busy}>Create project</StitchButton>
      </>}
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StitchField label="Project title" htmlFor="np-title" required error={err || undefined}>
          <StitchInput id="np-title" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Statins for primary prevention" />
        </StitchField>
        <StitchField label="Description" htmlFor="np-desc" help="Optional — a short summary of the review question.">
          <StitchTextarea id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="A short summary of the review question" />
        </StitchField>
      </form>
    </StitchModal>
  );
}

/* ─── Delete-project modal (design2.md "Project deletion experience") ────────
   The project name is IMMUTABLE plain text; a SEPARATE, initially-empty input
   requires the user to type the exact name; Delete stays disabled until it
   matches. Whitespace is trimmed (lenient), the match is case-sensitive, and
   Unicode/Arabic/long names are supported by plain string comparison. Loading,
   error and double-submit guards included; server permission checks remain
   authoritative (the field is not an authorization control). */
function DeleteProjectModal({ project, onClose, onDone }) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useStitchToast();
  useEffect(() => { setConfirmText(''); setErr(''); setBusy(false); }, [project]);
  if (!project) return null;

  const name = project.name || 'Untitled project';
  const matches = deleteConfirmMatches(confirmText, name);
  const linked = !!project._linkedMetaSift;

  const run = async () => {
    if (busy || !matches) return;
    setBusy(true); setErr('');
    try {
      await api.projects.confirmDelete(project.id, { confirmName: confirmText.trim(), cascadeLinked: true });
      toast.toast('Project deleted', { tone: 'success' });
      onDone?.();
    } catch (e) {
      setErr(e.message || 'Could not delete the project. Please try again.');
      setBusy(false);
    }
  };

  return (
    <StitchModal open onClose={busy ? () => {} : onClose} title="Delete project" width={480}
      footer={<>
        <StitchButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</StitchButton>
        <StitchButton variant="danger" icon="trash" onClick={run} loading={busy} disabled={!matches}>Delete project</StitchButton>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, background: S.dangerSoft, border: `1px solid ${salpha(S.danger, 0.3)}` }}>
          <span style={{ color: S.danger, flexShrink: 0, marginTop: 1 }}><StitchIcon name="alertTriangle" size={18} /></span>
          <div style={{ fontSize: 13, color: S.onDangerSoft, lineHeight: 1.55 }}>
            This permanently deletes <strong style={{ color: S.textPrimary }}>{name}</strong>
            {linked ? <> and its linked screening workspace (imported records, decisions and members)</> : null}. This action cannot be undone.
          </div>
        </div>
        <StitchField label={<>Type <strong style={{ color: S.textPrimary }}>{name}</strong> to confirm</>} htmlFor="del-confirm" error={err || undefined}>
          <StitchInput id="del-confirm" autoFocus value={confirmText} placeholder="Enter the project name exactly"
            onChange={(e) => { setConfirmText(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches && !busy) run(); }}
            aria-describedby="del-help" />
        </StitchField>
        <div id="del-help" style={{ fontSize: 12, color: S.textMuted }}>
          The project name is shown above. Delete stays disabled until what you type matches it exactly.
        </div>
      </div>
    </StitchModal>
  );
}

/* ─── Rename / archive / restore modal (the non-destructive actions) ───────── */
function ActionModal({ state, onClose, onDone }) {
  const [value, setValue] = useState(state?.project?.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useStitchToast();
  useEffect(() => { setValue(state?.project?.name || ''); setErr(''); setBusy(false); }, [state]);
  if (!state || state.type === 'delete') return null;
  const { type, project } = state;

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      if (type === 'rename') {
        const t = value.trim(); if (!t) { setErr('Title cannot be empty.'); setBusy(false); return; }
        await api.projects.update(project.id, { name: t }); toast.toast('Project renamed', { tone: 'success' });
      } else if (type === 'archive') {
        await api.projects.archive(project.id); toast.toast('Project archived', { tone: 'success' });
      } else if (type === 'unarchive') {
        // Restore via the dedicated endpoint — `_archived` is a derived annotation,
        // not a writable blob field, so a PUT would be a silent no-op. unarchive()
        // flips the real column and cascade-restores the linked screening workspace.
        await api.projects.unarchive(project.id); toast.toast('Project restored', { tone: 'success' });
      }
      onDone?.();
    } catch (e) { setErr(e.message || 'Action failed.'); setBusy(false); }
  };

  const titles = { rename: 'Rename project', archive: 'Archive project?', unarchive: 'Restore project?' };
  return (
    <StitchModal open onClose={onClose} title={titles[type]} width={460}
      footer={<>
        <StitchButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</StitchButton>
        <StitchButton onClick={run} loading={busy}>{type === 'rename' ? 'Save' : type === 'archive' ? 'Archive' : 'Restore'}</StitchButton>
      </>}
    >
      {type === 'rename' ? (
        <StitchField label="Project title" htmlFor="rn" error={err || undefined}>
          <StitchInput id="rn" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </StitchField>
      ) : (
        <p style={{ fontSize: 13.5, color: S.textSecondary, lineHeight: 1.6, margin: 0 }}>
          {type === 'archive'
            ? <>Archive <strong style={{ color: S.textPrimary }}>{project.name}</strong>? It will be hidden from the active list and become read-only. You can restore it later.</>
            : <>Restore <strong style={{ color: S.textPrimary }}>{project.name}</strong> to your active projects?</>}
          {err ? <span style={{ display: 'block', marginTop: 10, color: S.danger, fontWeight: 600 }}>{err}</span> : null}
        </p>
      )}
    </StitchModal>
  );
}

/* ─── Project row card ────────────────────────────────────────────────────── */
function ProjectRow({ p, onOpen, onAction }) {
  const status = statusOf(p);
  const sm = STATUS_META[status] || {};
  const pct = progressOf(p);
  const owner = isOwnerOf(p);
  const canEdit = canEditOf(p);
  return (
    <StitchCard interactive style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div title={p.name} style={{ fontSize: 15, fontWeight: 700, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
            {p.name || 'Untitled project'}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <StitchBadge tone={statusTone(status)} dot>{sm.label || status}</StitchBadge>
            <StitchBadge tone="neutral">{ROLE_LABEL[roleOf(p)] || 'Owner'}</StitchBadge>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 12, color: S.textMuted, fontWeight: 500 }}>
        <span>{p._studyCount || 0} studies</span>
        {p._linkedMetaSift ? <span>{p._linkedMetaSift.recordCount || 0} records</span> : null}
        {p._linkedMetaSift ? <span>{p._linkedMetaSift.memberCount || 0} members</span> : null}
        <span>updated {relTime(p.updatedAt)}</span>
      </div>
      {pct != null ? (
        <div style={{ height: 5, borderRadius: 99, background: S.surfaceHigh, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? S.success : S.brand, borderRadius: 99, transition: 'width 0.5s ease' }} />
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <StitchButton size="sm" block iconRight="arrowRight" onClick={() => onOpen(p)} style={{ flex: 1 }}>Open</StitchButton>
        {canEdit ? <StitchButton size="sm" variant="neutral" icon="pencil" onClick={() => onAction({ type: 'rename', project: p })} aria-label="Rename" /> : null}
        {owner ? <StitchButton size="sm" variant="neutral" icon={p._archived ? 'refresh' : 'layers'} onClick={() => onAction({ type: p._archived ? 'unarchive' : 'archive', project: p })} aria-label={p._archived ? 'Restore' : 'Archive'} /> : null}
        {owner ? <StitchButton size="sm" variant="ghost" icon="trash" onClick={() => onAction({ type: 'delete', project: p })} aria-label="Delete" style={{ color: S.danger }} /> : null}
      </div>
    </StitchCard>
  );
}

/* ─── Dashboard white-column MENU (no project list, no New-Project button) ──── */
function DashboardSideMenu({ view, onNavigate, invitationsCount }) {
  const { user } = useAuth();
  const version = useAppVersion();
  const greeting = welcomeGreeting(user?.name);

  const Item = ({ item }) => {
    const active = view === item.view;
    const badge = item.badgeKey === 'invitations' ? invitationsCount : 0;
    return (
      <button type="button" className="stitch-focusable" aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(item.view)}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = S.surfaceLow; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
        style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '10px 12px', border: 'none',
          background: active ? S.brandSoft : 'transparent', cursor: 'pointer', borderRadius: 10, textAlign: 'left',
          color: active ? S.onBrandSoft : S.textPrimary, fontFamily: S.font }}>
        <span style={{ color: active ? S.brand : S.textSecondary, display: 'inline-flex', flexShrink: 0 }}><StitchIcon name={item.icon} size={18} /></span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
        {badge ? <span style={{ fontSize: 11, fontWeight: 800, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9999, background: S.brand, color: S.onBrand, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{badge > 9 ? '9+' : badge}</span> : null}
      </button>
    );
  };

  const primary = DASHBOARD_MENU.filter((m) => m.section === 'primary');
  const resources = DASHBOARD_MENU.filter((m) => m.section === 'resources');

  return (
    <aside aria-label="Dashboard menu" className="stitch-scope" style={{
      width: 280, flexShrink: 0, background: S.card, borderRight: `1px solid ${salpha(S.outlineVariant, 0.5)}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      <div style={{ padding: '22px 18px 18px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.45)}` }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: S.brand }}>PecanRev</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', color: S.textPrimary, margin: '6px 0 0', lineHeight: 1.2 }}>{greeting}</h1>
      </div>
      <nav aria-label="Workspace" style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {primary.map((m) => <Item key={m.key} item={m} />)}
        {resources.length ? (
          <>
            <div style={{ height: 1, background: salpha(S.outlineVariant, 0.4), margin: '12px 8px 8px' }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.textMuted, padding: '0 12px 6px' }}>Support</div>
            {resources.map((m) => <Item key={m.key} item={m} />)}
          </>
        ) : null}
      </nav>
      {version ? (
        <div style={{ padding: '10px 18px', borderTop: `1px solid ${salpha(S.outlineVariant, 0.45)}` }}>
          <span title={`PecanRev version ${version}`} style={{ fontSize: 11, fontFamily: STITCH_MONO, color: S.textMuted }}>PecanRev v{version}</span>
        </div>
      ) : null}
    </aside>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function StitchDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { pendingCount } = useInvitations();
  const view = readView(location.search);

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState(null); // {type:'rename'|'archive'|'unarchive'|'delete', project}

  const reload = useCallback(async () => {
    setError('');
    try {
      const list = await api.projects.list({ includeArchived: true });
      setProjects(Array.isArray(list) ? list : (list?.projects || []));
    } catch {
      setError('Could not load your projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const goView = (v) => navigate(dashboardHref(v));

  const kpis = useMemo(() => {
    const live = projects.filter((p) => !p._archived);
    return {
      total: live.length,
      owned: projects.filter((p) => isOwnerOf(p) && !p._archived).length,
      active: projects.filter((p) => { const s = statusOf(p); return s === 'active' || s === 'in_progress'; }).length,
      done: projects.filter((p) => statusOf(p) === 'done').length,
      archived: projects.filter((p) => p._archived).length,
      studies: projects.reduce((n, p) => n + (p._studyCount || 0), 0),
      records: projects.reduce((n, p) => n + ((p._linkedMetaSift && p._linkedMetaSift.recordCount) || 0), 0),
    };
  }, [projects]);

  const completionPct = kpis.total + kpis.archived > 0
    ? Math.round((kpis.done / Math.max(1, kpis.total + kpis.archived)) * 100) : 0;

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => !p._archived)
      .filter(f.test)
      .filter((p) => !q || (p.name || '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }, [projects, filter, search]);

  const archivedProjects = useMemo(() => (
    projects.filter((p) => p._archived).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
  ), [projects]);

  const recentActivity = useMemo(() => (
    [...projects].filter((p) => p.updatedAt && !p._archived).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6)
  ), [projects]);

  const openProject = (p) => navigate(`/app/project/${encodeURIComponent(p.id)}`);

  const contextRail = (
    <DashboardSideMenu view={view} onNavigate={goView} invitationsCount={pendingCount} />
  );

  const header = (
    <StitchPageHeader
      eyebrow={view === 'overview' ? 'Command Center' : 'Dashboard'}
      title={view === 'overview' ? 'Your research at a glance' : (VIEW_LABEL[view] || 'Dashboard')}
      subtitle={view === 'overview' ? 'Projects, screening progress and recent activity across your workspace.' : undefined}
      actions={view === 'overview' ? <StitchButton icon="folders" onClick={() => setCreateOpen(true)}>New project</StitchButton> : undefined}
    />
  );

  /* ── per-view content ── */
  let content;
  if (view === 'mywork') content = <div style={{ marginTop: 24 }}><MyWorkView /></div>;
  else if (view === 'activity') content = <div style={{ marginTop: 24 }}><ActivityView /></div>;
  else if (view === 'invitations') content = <div style={{ marginTop: 24 }}><InvitationsView /></div>;
  else if (view === 'resources') content = <div style={{ marginTop: 24 }}><ResourcesView /></div>;
  else if (view === 'archived') {
    content = (
      <div style={{ marginTop: 24 }}>
        {loading ? <StitchLoadingState label="Loading archived projects…" />
          : error ? <StitchErrorState title="Couldn't load projects" desc={error} onRetry={reload} />
            : archivedProjects.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {archivedProjects.map((p) => <ProjectRow key={p.id} p={p} onOpen={openProject} onAction={setAction} />)}
              </div>
            ) : (
              <StitchCard><StitchEmptyState icon="layers" title="No archived projects"
                desc="Projects you archive from the dashboard will appear here. Archiving keeps a project's data but removes it from your active list." /></StitchCard>
            )}
      </div>
    );
  } else {
    // overview
    content = (error ? (
      <div style={{ marginTop: 24 }}><StitchErrorState title="Couldn't load projects" desc={error} onRetry={reload} /></div>
    ) : loading ? (
      <div style={{ marginTop: 24 }}><StitchLoadingState label="Loading your workspace…" /></div>
    ) : (
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <StitchMetricCard label="Active projects" value={kpis.total} icon="folder" tone="brand" />
          <StitchMetricCard label="Owned by you" value={kpis.owned} icon="user" />
          <StitchMetricCard label="Studies imported" value={kpis.studies} icon="fileText" />
          <StitchMetricCard label="Screening records" value={kpis.records} icon="checkSquare" tone="success" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 2fr)', gap: 24, alignItems: 'stretch' }} className="stitch-bento">
          <StitchCard style={{ display: 'flex', flexDirection: 'column' }}>
            <StitchSectionHeader title="Project completion" desc="Reviews marked complete" />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 8 }}>
              <StitchProgressRing value={completionPct} sublabel="Completed" tone="success" />
              <div style={{ display: 'flex', gap: 18 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: S.textSecondary }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: S.success }} /> Done ({kpis.done})
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: S.textSecondary }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: S.surfaceHighest }} /> In flight ({kpis.active})
                </span>
              </div>
            </div>
          </StitchCard>

          <StitchCard>
            <StitchSectionHeader title="Recently updated" desc="Your most recently updated projects"
              action={<StitchButton size="sm" variant="ghost" iconRight="arrowRight" onClick={() => goView('activity')}>View activity</StitchButton>} />
            {recentActivity.length ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {recentActivity.map((p, i) => (
                  <button key={p.id} type="button" className="stitch-focusable" onClick={() => openProject(p)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', borderRadius: 8, borderBottom: i < recentActivity.length - 1 ? `1px solid ${salpha(S.outlineVariant, 0.3)}` : 'none' }}>
                    <span style={{ width: 34, height: 34, borderRadius: '50%', background: S.brandSoft, color: S.onBrandSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <StitchIcon name="refresh" size={16} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13.5, color: S.textPrimary }}><strong>{p.name || 'Untitled'}</strong> was updated</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: S.textMuted }}>{relTime(p.updatedAt)} · {p._studyCount || 0} studies</span>
                    </span>
                    <StitchBadge tone={statusTone(statusOf(p))} dot>{(STATUS_META[statusOf(p)] || {}).label || statusOf(p)}</StitchBadge>
                  </button>
                ))}
              </div>
            ) : <StitchEmptyState icon="clock" title="No recent activity" desc="Create or open a project to see updates here." height={160} />}
          </StitchCard>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {FILTERS.map((f) => {
                const active = f.key === filter;
                const count = projects.filter((p) => !p._archived).filter(f.test).length;
                return (
                  <button key={f.key} type="button" className="stitch-focusable" onClick={() => setFilter(f.key)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 9999, fontSize: 12.5, fontWeight: 700, fontFamily: S.font, cursor: 'pointer',
                      background: active ? S.brand : S.card, color: active ? S.onBrand : S.textSecondary, border: `1px solid ${active ? S.brand : S.outlineVariant}` }}>
                    {f.label}<span style={{ fontSize: 11, opacity: 0.85 }}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ width: 240, maxWidth: '100%' }}>
              <StitchSearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" />
            </div>
          </div>

          {filtered.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {filtered.map((p) => <ProjectRow key={p.id} p={p} onOpen={openProject} onAction={setAction} />)}
            </div>
          ) : (
            <StitchCard>
              <StitchEmptyState
                icon="folder"
                title={search || filter !== 'all' ? 'No matching projects' : 'No projects yet'}
                desc={search || filter !== 'all' ? 'Try a different filter or search term.' : 'Start your first systematic review — create a project to begin importing and screening studies.'}
                action={<StitchButton icon="folders" onClick={() => setCreateOpen(true)}>New project</StitchButton>}
              />
            </StitchCard>
          )}
        </div>
      </div>
    ));
  }

  return (
    <StitchAppShell activeKey="dashboard" contextRail={contextRail} breadcrumb={`Dashboard · ${VIEW_LABEL[view] || 'Workspace'}`}>
      {header}
      {content}
      <style>{`@media (max-width: 900px){ html[data-ui-design="stitch"] .stitch-bento{ grid-template-columns: 1fr !important; } }`}</style>
      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); reload(); }} />
      <ActionModal state={action && action.type !== 'delete' ? action : null} onClose={() => setAction(null)} onDone={() => { setAction(null); reload(); }} />
      <DeleteProjectModal project={action && action.type === 'delete' ? action.project : null} onClose={() => setAction(null)} onDone={() => { setAction(null); reload(); }} />
    </StitchAppShell>
  );
}
