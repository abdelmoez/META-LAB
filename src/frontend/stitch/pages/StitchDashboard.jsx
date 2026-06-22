/**
 * StitchDashboard.jsx — the Stitch "Command Center" (route /app).
 *
 * Parallel presentation of the legacy ProjectLanding. It reuses the SAME data and
 * logic — the api client and projectLanding.helpers — so there is no forked
 * business logic. Only the presentation (Stitch shell + bento grid) is new. All
 * data shown is real (projects, counts, recency); empty/loading/error states are
 * first-class; every control performs a real action.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api-client/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  STATUS_META, statusOf, roleOf, isOwnerOf, canEditOf, relTime, progressOf, ROLE_LABEL,
} from '../../pages/projectLanding.helpers.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import { StitchContextRail } from '../shell/shellParts.jsx';
import {
  StitchPageHeader, StitchCard, StitchMetricCard, StitchProgressRing, StitchButton, StitchBadge,
  StitchEmptyState, StitchLoadingState, StitchErrorState, StitchSectionHeader, StitchIcon,
  StitchField, StitchInput, StitchTextarea, StitchModal, StitchSearchInput, useStitchToast, S, salpha,
} from '../primitives';

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'active', label: 'Active', test: (p) => statusOf(p) === 'active' },
  { key: 'inprogress', label: 'In progress', test: (p) => statusOf(p) === 'in_progress' },
  { key: 'done', label: 'Completed', test: (p) => statusOf(p) === 'done' },
  { key: 'owned', label: 'Owned by me', test: (p) => isOwnerOf(p) },
  { key: 'archived', label: 'Archived', test: (p) => !!p._archived },
];

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

/* ─── Confirm modal (rename / archive / delete reuse the SAME api) ────────── */
function ConfirmModal({ state, onClose, onDone }) {
  const [value, setValue] = useState(state?.project?.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useStitchToast();
  useEffect(() => { setValue(state?.project?.name || ''); setErr(''); }, [state]);
  if (!state) return null;
  const { type, project } = state;

  const run = async () => {
    setBusy(true); setErr('');
    try {
      if (type === 'rename') {
        const t = value.trim(); if (!t) { setErr('Title cannot be empty.'); setBusy(false); return; }
        await api.projects.update(project.id, { name: t }); toast.toast('Project renamed', { tone: 'success' });
      } else if (type === 'archive') {
        await api.projects.archive(project.id); toast.toast('Project archived', { tone: 'success' });
      } else if (type === 'unarchive') {
        await api.projects.update(project.id, { _archived: false }); toast.toast('Project restored', { tone: 'success' });
      } else if (type === 'delete') {
        if (value.trim() !== (project.name || '').trim()) { setErr('Type the project name to confirm.'); setBusy(false); return; }
        await api.projects.confirmDelete(project.id, { confirmName: value.trim(), cascadeLinked: true }); toast.toast('Project deleted', { tone: 'success' });
      }
      onDone?.();
    } catch (e) { setErr(e.message || 'Action failed.'); setBusy(false); }
  };

  const titles = { rename: 'Rename project', archive: 'Archive project?', unarchive: 'Restore project?', delete: 'Delete project' };
  return (
    <StitchModal open onClose={onClose} title={titles[type]} width={460}
      footer={<>
        <StitchButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</StitchButton>
        <StitchButton variant={type === 'delete' ? 'danger' : 'primary'} onClick={run} loading={busy}>
          {type === 'rename' ? 'Save' : type === 'delete' ? 'Delete' : type === 'archive' ? 'Archive' : 'Restore'}
        </StitchButton>
      </>}
    >
      {type === 'rename' ? (
        <StitchField label="Project title" htmlFor="rn" error={err || undefined}>
          <StitchInput id="rn" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </StitchField>
      ) : type === 'delete' ? (
        <StitchField label={`Type "${project.name}" to confirm`} htmlFor="del" error={err || undefined}
          help="This is a guarded, ops-reversible soft delete affecting all members.">
          <StitchInput id="del" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={project.name} />
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

export default function StitchDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);

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
      .filter((p) => (filter === 'archived' ? true : !p._archived))
      .filter(f.test)
      .filter((p) => !q || (p.name || '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }, [projects, filter, search]);

  const recentActivity = useMemo(() => (
    [...projects].filter((p) => p.updatedAt).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6)
  ), [projects]);

  const openProject = (p) => navigate(`/app/project/${encodeURIComponent(p.id)}`);

  /* ── context rail: quick project list + new ── */
  const contextRail = (
    <StitchContextRail
      title="Research OS"
      subtitle={user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'Workspace'}
      action={<StitchButton block icon="folders" onClick={() => setCreateOpen(true)}>New project</StitchButton>}
      footer={<div style={{ fontSize: 11, color: S.textMuted, textAlign: 'center' }}>{kpis.total} active · {kpis.archived} archived</div>}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.textMuted, padding: '4px 8px 8px' }}>
        Your projects
      </div>
      {loading ? <div style={{ padding: 8 }}><StitchLoadingState label="Loading…" height={120} /></div>
        : projects.filter((p) => !p._archived).slice(0, 12).map((p) => (
          <button key={p.id} type="button" className="stitch-focusable" onClick={() => openProject(p)}
            onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 8px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8, textAlign: 'left' }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: S.brandSoft, color: S.onBrandSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <StitchIcon name="folder" size={15} />
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || 'Untitled'}</span>
              <span style={{ display: 'block', fontSize: 11, color: S.textMuted }}>{p._studyCount || 0} studies · {relTime(p.updatedAt)}</span>
            </span>
          </button>
        ))}
      {!loading && !projects.filter((p) => !p._archived).length ? (
        <div style={{ padding: '16px 8px', fontSize: 12.5, color: S.textMuted, textAlign: 'center' }}>No projects yet.</div>
      ) : null}
    </StitchContextRail>
  );

  return (
    <StitchAppShell activeKey="dashboard" contextRail={contextRail} breadcrumb="Dashboard · Command Center">
      <StitchPageHeader
        eyebrow="Command Center"
        title="Your research at a glance"
        subtitle="Projects, screening progress and recent activity across your workspace."
        actions={<>
          <StitchButton variant="neutral" icon="folders" onClick={() => navigate('/app')}>All projects</StitchButton>
          <StitchButton icon="folders" onClick={() => setCreateOpen(true)}>New project</StitchButton>
        </>}
      />

      {error ? (
        <div style={{ marginTop: 24 }}><StitchErrorState title="Couldn't load projects" desc={error} onRetry={reload} /></div>
      ) : loading ? (
        <div style={{ marginTop: 24 }}><StitchLoadingState label="Loading your workspace…" /></div>
      ) : (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Metric row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <StitchMetricCard label="Active projects" value={kpis.total} icon="folder" tone="brand" onClick={() => setFilter('all')} />
            <StitchMetricCard label="Owned by you" value={kpis.owned} icon="user" />
            <StitchMetricCard label="Studies imported" value={kpis.studies} icon="fileText" />
            <StitchMetricCard label="Screening records" value={kpis.records} icon="checkSquare" tone="success" />
          </div>

          {/* Bento: completion ring + recent activity */}
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
              <StitchSectionHeader title="Recent activity" desc="Most recently updated projects" />
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

          {/* Projects */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {FILTERS.map((f) => {
                  const active = f.key === filter;
                  const count = projects.filter((p) => (f.key === 'archived' ? true : !p._archived)).filter(f.test).length;
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
                {filtered.map((p) => <ProjectRow key={p.id} p={p} onOpen={openProject} onAction={setConfirm} />)}
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
      )}

      <style>{`@media (max-width: 900px){ html[data-ui-design="stitch"] .stitch-bento{ grid-template-columns: 1fr !important; } }`}</style>
      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); reload(); }} />
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} onDone={() => { setConfirm(null); reload(); }} />
    </StitchAppShell>
  );
}
