/**
 * StitchProjectOverview.jsx — the Stitch "Project Command Center" (route
 * /app/project/:projectId).
 *
 * Parallel presentation of the legacy workspace Overview. It reuses the SAME data
 * and logic as the classic UI so there is no forked business logic:
 *   - api.projects.get(projectId)        — the full project blob (the monolith's
 *                                          canonical source; same call AppWorkspace
 *                                          drives the workspace from)
 *   - api.exportProject(projectId)       — owner/export download (real action)
 *   - screeningApi.getOverview(linkedId) — linked Screening summary (real metrics)
 *   - screeningApi.listMembers(linkedId) — linked team roster
 *   - workspace/projectHelpers.js        — the PURE phase engine: stepStatus,
 *                                          PHASES, phaseLabel, PHASE_ICON,
 *                                          readinessCheck, projectPerms, linkedSiftId
 *   - pages/projectLanding.helpers.js    — statusOf, STATUS_META, relTime, ROLE_LABEL
 *
 * Everything shown is REAL. Deep editing lives in the classic monolith workspace,
 * so each phase card shows real status + opens the correct destination:
 *   - Screening  → /sift-beta/projects/<linkedId>  (the live Screening engine)
 *   - Risk of Bias → /rob/<projectId>
 *   - all other phases → the classic workspace deep-link
 *     /app/project/<projectId>?tab=<tabId> (an informational note makes clear
 *     these open in the classic workspace — no fake controls).
 * Loading / empty / error states are first-class.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api-client/apiClient.js';
import { screeningApi } from '../../screening/api-client/screeningApi.js';
import {
  stepStatus, PHASES, phaseLabel, PHASE_ICON, readinessCheck, projectPerms, linkedSiftId,
} from '../../workspace/projectHelpers.js';
import { statusOf, STATUS_META, relTime, ROLE_LABEL } from '../../pages/projectLanding.helpers.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import { StitchContextRail } from '../shell/shellParts.jsx';
import {
  StitchPageHeader, StitchSectionHeader, StitchCard, StitchPanel, StitchMetricCard,
  StitchProgressBar, StitchButton, StitchBadge, StitchAvatar, StitchEmptyState,
  StitchLoadingState, StitchErrorState, StitchIcon, S, salpha,
} from '../primitives';

/* ─── Phase model ─────────────────────────────────────────────────────────────
   Map the SIX workflow phases (the canonical PHASES list) to the stepStatus tab
   keys that belong to each. stepStatus(project, screeningComplete) returns a
   per-tab status of 'done' | 'partial' | 'empty' computed from the SAME project
   blob the classic workspace uses — so the status here is the real status. */
const PHASE_STEPS = {
  Plan:    ['pico', 'prospero'],
  Search:  ['search'],
  Screen:  ['screening', 'prisma'],
  Extract: ['extraction', 'rob'],
  Analyze: ['analysis', 'forest', 'sensitivity', 'subgroup'],
  Report:  ['grade', 'report', 'manuscript'],
};

// The classic-workspace deep-link tab to open for each phase's primary step.
const PHASE_PRIMARY_TAB = {
  Plan: 'pico', Search: 'search', Screen: 'screening',
  Extract: 'extraction', Analyze: 'analysis', Report: 'grade',
};

const PHASE_DESC = {
  Plan:    'Define the PICO question, eligibility criteria and the registered protocol.',
  Search:  'Build and document the multi-database search strategy.',
  Screen:  'Import citations, de-duplicate, and screen titles, abstracts and full text.',
  Extract: 'Extract study data and assess risk of bias for each included study.',
  Analyze: 'Pool effect sizes, plot the forest, and run sensitivity / subgroup analyses.',
  Report:  'Rate GRADE certainty, complete the PRISMA checklist and draft the manuscript.',
};

const STEP_TONE = { done: 'success', partial: 'warn', empty: 'neutral' };
const STEP_LABEL = { done: 'Complete', partial: 'In progress', empty: 'Not started' };

/** Roll a set of per-step statuses up into one phase status + a 0–100 percent. */
function rollupPhase(steps, statusMap) {
  const states = steps.map((k) => statusMap[k] || 'empty');
  const score = states.reduce((n, s) => n + (s === 'done' ? 1 : s === 'partial' ? 0.5 : 0), 0);
  const pct = states.length ? Math.round((score / states.length) * 100) : 0;
  const status = states.every((s) => s === 'done') ? 'done'
    : states.some((s) => s !== 'empty') ? 'partial' : 'empty';
  return { status, pct, states };
}

function stepTone(status) { return STEP_TONE[status] || 'neutral'; }

export default function StitchProjectOverview() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [overview, setOverview] = useState(null);   // linked Screening getOverview()
  const [members, setMembers] = useState(null);      // linked Screening listMembers()
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = await api.projects.get(projectId);
      setProject(p);

      // The linked Screening workspace is the source of truth for screening metrics
      // + the team roster. Best-effort: a screening failure must never blank the page.
      const linkedId = linkedSiftId(p);
      if (linkedId) {
        const [ov, mem] = await Promise.allSettled([
          screeningApi.getOverview(linkedId),
          screeningApi.listMembers(linkedId),
        ]);
        setOverview(ov.status === 'fulfilled' ? ov.value : null);
        // listMembers may return an array or { members: [] } depending on access.
        const memVal = mem.status === 'fulfilled' ? mem.value : null;
        setMembers(memVal == null ? null : (Array.isArray(memVal) ? memVal : (memVal.members || [])));
      } else {
        setOverview(null);
        setMembers(null);
      }
    } catch (e) {
      setError(e?.message || 'Could not load this project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  const linkedId = project ? linkedSiftId(project) : null;
  const perms = project ? projectPerms(project) : null;

  // Real per-step status from the SAME pure engine the classic sidebar uses.
  // Screening counts as "done" only when the server roll-up says so; the closest
  // signal we have here is the linked workspace progressStatus === 'done'.
  const screeningComplete = !!(project && project._linkedMetaSift && project._linkedMetaSift.progressStatus === 'done');
  const statusMap = useMemo(
    () => (project ? stepStatus(project, screeningComplete) : {}),
    [project, screeningComplete],
  );

  const phases = useMemo(() => PHASES.map((name) => ({
    name,
    label: phaseLabel(name),
    icon: PHASE_ICON[name],
    desc: PHASE_DESC[name],
    ...rollupPhase(PHASE_STEPS[name], statusMap),
  })), [statusMap]);

  const overallPct = phases.length
    ? Math.round(phases.reduce((n, ph) => n + ph.pct, 0) / phases.length) : 0;

  const dataSummary = overview?.dataSummary || null;
  const projectProgress = overview?.projectProgress || null; // leader-only
  const studyCount = project
    ? (project._studyCount != null ? project._studyCount : (Array.isArray(project.studies) ? project.studies.length : 0))
    : 0;
  const recordCount = (project && project._linkedMetaSift && project._linkedMetaSift.recordCount)
    || (dataSummary && dataSummary.totalArticles)
    || (project && Array.isArray(project.records) ? project.records.length : 0)
    || 0;
  const includedCount = dataSummary ? dataSummary.acceptedToExtraction : null;
  const conflictsCount = dataSummary ? dataSummary.unresolvedConflicts : null;

  const readiness = project ? readinessCheck(project) : null;

  /* ── navigation helpers ──
     Deep editing of the monolith phases lives in the classic workspace. In Stitch
     mode the /app/project/:id route renders THIS overview, so to actually open the
     classic workspace we hand off with the design-mode escape (?ui=legacy). The
     admin lands in the full-featured classic workspace and returns to Stitch with
     the header switch — a real, working hand-off (never a dead link). */
  const openClassicTab = useCallback((tabId) => {
    navigate(`/app/project/${encodeURIComponent(projectId)}?ui=legacy&tab=${encodeURIComponent(tabId)}`);
  }, [navigate, projectId]);

  const openPhase = useCallback((phaseName) => {
    if (phaseName === 'Screen' && linkedId) { navigate(`/sift-beta/projects/${encodeURIComponent(linkedId)}`); return; }
    if (phaseName === 'Extract') {
      // The Extract phase pairs data extraction (classic) with Risk of Bias (its
      // own workspace). The phase card opens extraction; RoB has a dedicated action.
      openClassicTab(PHASE_PRIMARY_TAB.Extract);
      return;
    }
    openClassicTab(PHASE_PRIMARY_TAB[phaseName] || 'overview');
  }, [linkedId, navigate, openClassicTab]);

  const onExport = useCallback(async () => {
    if (!perms?.canExport) return;
    setExporting(true);
    try {
      const data = await api.exportProject(projectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project?.name || 'project').replace(/[^\w.-]+/g, '_')}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [perms, projectId, project]);

  /* ── context rail: the six phases + back to dashboard ── */
  const contextRail = (
    <StitchContextRail
      title="Workflow"
      subtitle={project?.name || 'Project'}
      action={<StitchButton block variant="neutral" icon="arrowLeft" onClick={() => navigate('/app')}>Back to dashboard</StitchButton>}
      footer={project ? (
        <div style={{ fontSize: 11, color: S.textMuted, textAlign: 'center' }}>
          {overallPct}% complete · {studyCount} studies
        </div>
      ) : null}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.textMuted, padding: '4px 8px 8px' }}>
        Phases
      </div>
      {loading ? (
        <div style={{ padding: 8 }}><StitchLoadingState label="Loading…" height={120} /></div>
      ) : phases.map((ph, i) => (
        <button
          key={ph.name} type="button" className="stitch-focusable"
          onClick={() => openPhase(ph.name)}
          onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8, textAlign: 'left' }}
        >
          <span style={{ width: 28, height: 28, borderRadius: 8, background: S.brandSoft, color: S.onBrandSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700 }}>
            {i + 1}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ph.label}</span>
            <span style={{ display: 'block', fontSize: 11, color: S.textMuted }}>{STEP_LABEL[ph.status]} · {ph.pct}%</span>
          </span>
          <StitchStatusGlyph status={ph.status} />
        </button>
      ))}
    </StitchContextRail>
  );

  /* ── render ── */
  if (loading) {
    return (
      <StitchAppShell activeKey="dashboard" contextRail={contextRail} breadcrumb="Dashboard · Project">
        <StitchLoadingState label="Loading your project…" />
      </StitchAppShell>
    );
  }
  if (error || !project) {
    return (
      <StitchAppShell activeKey="dashboard" contextRail={contextRail} breadcrumb="Dashboard · Project">
        <StitchErrorState
          title="Couldn't load this project"
          desc={error || 'The project may have been deleted, or you may not have access.'}
          onRetry={error ? reload : undefined}
        />
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <StitchButton variant="neutral" icon="arrowLeft" onClick={() => navigate('/app')}>Back to dashboard</StitchButton>
        </div>
      </StitchAppShell>
    );
  }

  const lifecycle = statusOf(project);
  const sm = STATUS_META[lifecycle] || {};
  const role = (perms && perms.role) || 'owner';

  return (
    <StitchAppShell activeKey="dashboard" contextRail={contextRail}
      breadcrumb={<><button type="button" className="stitch-link stitch-focusable" onClick={() => navigate('/app')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textSecondary, fontWeight: 600, fontFamily: S.font, fontSize: 13, padding: 0 }}>Dashboard</button><span style={{ color: S.textMuted }}>/</span><span style={{ color: S.textPrimary }}>{project.name || 'Project'}</span></>}
    >
      <StitchPageHeader
        eyebrow="Project Command Center"
        icon="folder"
        title={project.name || 'Untitled project'}
        subtitle={`Updated ${relTime(project.updatedAt || project.modified)} · ${overallPct}% through the systematic-review workflow`}
        actions={<>
          <StitchButton variant="neutral" icon="upload" onClick={() => openClassicTab('overview')}>Import</StitchButton>
          {perms?.canExport ? (
            <StitchButton variant="neutral" icon="download" loading={exporting} onClick={onExport}>Export</StitchButton>
          ) : null}
          <StitchButton icon="externalLink" onClick={() => navigate(`/app/project/${encodeURIComponent(projectId)}?ui=legacy`)}>Open classic workspace</StitchButton>
        </>}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <StitchBadge tone={lifecycle === 'done' ? 'success' : lifecycle === 'archived' ? 'neutral' : 'brand'} dot>{sm.label || lifecycle}</StitchBadge>
        <StitchBadge tone="neutral">{ROLE_LABEL[role] || 'Owner'}</StitchBadge>
        {linkedId ? <StitchBadge tone="info" icon="link">Linked to Screening</StitchBadge> : <StitchBadge tone="neutral" icon="alert">No linked Screening</StitchBadge>}
        {project._archived ? <StitchBadge tone="warn" icon="layers">Archived</StitchBadge> : null}
      </div>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ── Metric row (real data; nulls show a polished placeholder, never a fake 0) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <StitchMetricCard label="Studies extracted" value={studyCount} icon="table" tone="brand" onClick={() => openClassicTab('extraction')} />
          <StitchMetricCard label={linkedId ? 'Citations / records' : 'Records'} value={recordCount} icon="fileText" onClick={linkedId ? () => navigate(`/sift-beta/projects/${encodeURIComponent(linkedId)}`) : undefined} />
          <StitchMetricCard label="Included (to extraction)" value={includedCount == null ? '—' : includedCount} icon="checkSquare" tone="success" />
          <StitchMetricCard label="Open conflicts" value={conflictsCount == null ? '—' : conflictsCount} icon="alertTriangle" tone={conflictsCount ? 'danger' : 'neutral'} />
        </div>

        {/* ── Bento: overall completion + readiness ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.4fr)', gap: 24, alignItems: 'stretch' }} className="stitch-bento">
          <StitchCard style={{ display: 'flex', flexDirection: 'column' }}>
            <StitchSectionHeader title="Workflow progress" desc="Across the six review phases" />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
              {phases.map((ph) => (
                <div key={ph.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: S.textSecondary }}>
                      <StitchIcon name={ph.icon} size={14} /> {ph.label}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: S.textMuted }}>{ph.pct}%</span>
                  </div>
                  <StitchProgressBar value={ph.pct} tone={stepTone(ph.status)} height={6} />
                </div>
              ))}
            </div>
          </StitchCard>

          <StitchCard style={{ display: 'flex', flexDirection: 'column' }}>
            <StitchSectionHeader
              title="Readiness check"
              desc="Pre-screening green-light (same checks as the classic workspace)"
              action={<StitchBadge tone={readiness?.ok ? 'success' : 'warn'} dot>{readiness?.ok ? 'Ready' : `${readiness?.missing.length || 0} to resolve`}</StitchBadge>}
            />
            {readiness?.ok ? (
              <div style={{ flex: 1, display: 'flex' }}>
                <StitchEmptyState icon="circleCheck" title="Protocol is screening-ready"
                  desc="PICO, time frame, ≥3 databases and a saved search strategy are all in place. You can begin screening."
                  height={180} />
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(readiness?.missing || []).map((m, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: S.textSecondary, lineHeight: 1.5 }}>
                    <span style={{ color: S.warn, flexShrink: 0, marginTop: 1 }}><StitchIcon name="alertTriangle" size={15} /></span>
                    <span>{m}</span>
                  </li>
                ))}
                <li style={{ marginTop: 6 }}>
                  <StitchButton size="sm" variant="soft" iconRight="arrowRight" onClick={() => openClassicTab('pico')}>Complete the protocol</StitchButton>
                </li>
              </ul>
            )}
          </StitchCard>
        </div>

        {/* ── Phase cards ── */}
        <div>
          <StitchSectionHeader title="Review phases" desc="Open a phase to continue. Screening and Risk of Bias open their dedicated workspaces; the rest open in the classic workspace." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {phases.map((ph, i) => (
              <PhaseCard
                key={ph.name}
                index={i + 1}
                phase={ph}
                statusMap={statusMap}
                linkedId={linkedId}
                onOpen={() => openPhase(ph.name)}
                onOpenRob={() => navigate(`/rob/${encodeURIComponent(projectId)}`)}
                canRob={!!(perms && (perms.isOwner || perms.canAssessRiskOfBias))}
              />
            ))}
          </div>
        </div>

        {/* ── Team + activity ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(280px, 1fr)', gap: 24, alignItems: 'start' }} className="stitch-bento">
          <StitchCard>
            <StitchSectionHeader
              title="Team"
              desc={linkedId ? 'Members of the linked Screening workspace' : 'This project is not linked to a Screening workspace'}
              action={linkedId ? <StitchButton size="sm" variant="ghost" iconRight="arrowRight" onClick={() => navigate(`/sift-beta/projects/${encodeURIComponent(linkedId)}`)}>Manage</StitchButton> : null}
            />
            {!linkedId ? (
              <StitchEmptyState icon="users" title="No team yet"
                desc="Link a Screening workspace to collaborate with reviewers on this review."
                height={180}
                action={<StitchButton size="sm" variant="soft" icon="link" onClick={() => openClassicTab('control')}>Link in workspace</StitchButton>} />
            ) : members === null ? (
              <StitchEmptyState icon="users" title="Team unavailable"
                desc="You don't have permission to view the member roster for the linked workspace, or it could not be loaded."
                height={160} />
            ) : members.length === 0 ? (
              <StitchEmptyState icon="users" title="No members yet"
                desc="Invite reviewers from the Screening workspace to start collaborating."
                height={160}
                action={<StitchButton size="sm" variant="soft" iconRight="arrowRight" onClick={() => navigate(`/sift-beta/projects/${encodeURIComponent(linkedId)}`)}>Open Screening</StitchButton>} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {members.map((m, i) => {
                  const name = m.name || m.email || 'Member';
                  return (
                    <div key={m.id || m.userId || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px', borderBottom: i < members.length - 1 ? `1px solid ${salpha(S.outlineVariant, 0.3)}` : 'none' }}>
                      <StitchAvatar name={name} size={34} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        {m.email && m.name ? <div style={{ fontSize: 11.5, color: S.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div> : null}
                      </div>
                      <StitchBadge tone={m.role === 'owner' || m.role === 'leader' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role] || m.role || 'Reviewer'}</StitchBadge>
                    </div>
                  );
                })}
              </div>
            )}
          </StitchCard>

          <StitchCard>
            <StitchSectionHeader title="Project details" desc="At a glance" />
            <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
              <DetailRow label="Last updated" value={relTime(project.updatedAt || project.modified)} />
              <DetailRow label="Created" value={relTime(project.created || project.createdAt)} />
              <DetailRow label="Your role" value={ROLE_LABEL[role] || 'Owner'} />
              <DetailRow label="Studies extracted" value={String(studyCount)} />
              <DetailRow label={linkedId ? 'Screening records' : 'Records'} value={String(recordCount)} />
              {projectProgress ? (
                <DetailRow label="Screened (title/abstract)" value={`${projectProgress.screened} / ${projectProgress.totalArticles} (${projectProgress.completion}%)`} />
              ) : null}
              {dataSummary ? (
                <DetailRow label="Confirmed duplicates" value={String(dataSummary.confirmedDuplicates)} />
              ) : null}
              <DetailRow
                label="Risk of Bias"
                value={(() => { const s = statusMap.rob || 'empty'; return STEP_LABEL[s]; })()}
                last
              />
            </dl>
          </StitchCard>
        </div>
      </div>

      <style>{`@media (max-width: 980px){ html[data-ui-design="stitch"] .stitch-bento{ grid-template-columns: 1fr !important; } }`}</style>
    </StitchAppShell>
  );
}

/* ─── A small status glyph (success/warn/neutral) used in the rail ──────────── */
function StitchStatusGlyph({ status }) {
  const tone = status === 'done' ? S.success : status === 'partial' ? S.warn : S.outlineVariant;
  const icon = status === 'done' ? 'circleCheck' : status === 'partial' ? 'clock' : 'minus';
  return <span aria-hidden="true" style={{ color: tone, flexShrink: 0, display: 'inline-flex' }}><StitchIcon name={icon} size={16} /></span>;
}

/* ─── Phase card ──────────────────────────────────────────────────────────── */
function PhaseCard({ index, phase, statusMap, linkedId, onOpen, onOpenRob, canRob }) {
  const isScreen = phase.name === 'Screen';
  const isExtract = phase.name === 'Extract';
  const dedicated = isScreen && linkedId;

  return (
    <StitchCard interactive style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: S.brandSoft, color: S.onBrandSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <StitchIcon name={phase.icon} size={19} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: S.textMuted }}>PHASE {index}</span>
            <StitchBadge tone={stepTone(phase.status)} dot>{STEP_LABEL[phase.status]}</StitchBadge>
          </div>
          <h3 style={{ fontSize: 15.5, fontWeight: 700, color: S.textPrimary, margin: '3px 0 0', letterSpacing: '-0.01em' }}>{phase.label}</h3>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: S.textSecondary, margin: 0, lineHeight: 1.55 }}>{phase.desc}</p>

      <StitchProgressBar value={phase.pct} tone={stepTone(phase.status)} height={6} />

      {/* Per-step chips — the real status of each underlying workflow tab. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PHASE_STEPS[phase.name].map((k) => {
          const s = statusMap[k] || 'empty';
          return <StitchBadge key={k} tone={stepTone(s)}>{STEP_LABELS_SHORT[k] || k}</StitchBadge>;
        })}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <StitchButton size="sm" block iconRight={dedicated ? 'externalLink' : 'arrowRight'} onClick={onOpen}>
          {dedicated ? 'Open Screening' : isScreen ? 'Open in workspace' : 'Continue'}
        </StitchButton>
        {isExtract ? (
          canRob
            ? <StitchButton size="sm" block variant="neutral" icon="scale" onClick={onOpenRob}>Risk of Bias workspace</StitchButton>
            : <div style={{ fontSize: 11, color: S.textMuted, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><StitchIcon name="lock" size={12} /> Risk of Bias is read-only for your role</div>
        ) : null}
        {/* Informational note for phases that live in the classic workspace — no fake buttons. */}
        {!dedicated ? (
          <div style={{ fontSize: 11, color: S.textMuted, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <StitchIcon name="info" size={12} /> Opens in the classic workspace
          </div>
        ) : null}
      </div>
    </StitchCard>
  );
}

/* Short labels for the per-step chips (match the classic workflow tab names). */
const STEP_LABELS_SHORT = {
  pico: 'PICO', prospero: 'Protocol', search: 'Search', screening: 'Screening',
  prisma: 'PRISMA', extraction: 'Extraction', rob: 'RoB', analysis: 'Meta-analysis',
  forest: 'Forest', sensitivity: 'Sensitivity', subgroup: 'Subgroup',
  grade: 'GRADE', report: 'Checklist', manuscript: 'Manuscript',
};

/* ─── Detail row ──────────────────────────────────────────────────────────── */
function DetailRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: last ? 'none' : `1px solid ${salpha(S.outlineVariant, 0.3)}` }}>
      <dt style={{ fontSize: 12.5, color: S.textSecondary, margin: 0 }}>{label}</dt>
      <dd style={{ fontSize: 13, fontWeight: 600, color: S.textPrimary, margin: 0, textAlign: 'right' }}>{value}</dd>
    </div>
  );
}
