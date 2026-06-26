/**
 * StitchProjectOverview.jsx — the Stitch project command center
 * (route /app/project/:projectId).
 *
 * It reuses the SAME data + pure engine as the classic workspace (no forked logic):
 *   - api.projects.get(projectId)              — the canonical project blob
 *   - screeningApi.getOverview/listMembers     — linked screening metrics + roster
 *   - workspace/projectHelpers.js              — stepStatus, PHASES, readinessCheck,
 *                                                projectPerms, linkedSiftId, auditProject
 * It is presented in the Stitch project shell: a collapsible workflow rail
 * (StitchProjectRail) + a contextual Screening pipeline (StitchWorkflowNav). Every
 * workflow stage opens its REAL destination by its USER-FACING name — there are NO
 * "open classic / legacy view" links (design2.md Part 4). Deep tools that have no
 * Stitch-native page open in their existing engine, reached by workflow name.
 *
 * Parity additions over the previous overview (audit E): a "Next step" call-to-
 * action, a PICO + protocol summary, a methodology audit summary, the screening
 * funnel, owner identity, a read-only/shared banner, and realtime refetch.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api-client/apiClient.js';
import { screeningApi } from '../../screening/api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';
import {
  stepStatus, PHASES, phaseLabel, PHASE_ICON, readinessCheck, projectPerms, linkedSiftId,
  auditProject, TABS,
} from '../../workspace/projectHelpers.js';
import { statusOf, STATUS_META, relTime, ROLE_LABEL } from '../../pages/projectLanding.helpers.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import StitchProjectRail from '../shell/StitchProjectRail.jsx';
import StitchWorkflowNav from '../shell/StitchWorkflowNav.jsx';
import StitchProjectPresence from '../shell/StitchProjectPresence.jsx';
import { projectStageHref, SCREENING_SUBNAV, screeningSubHref } from '../nav/navConfig.js';
import {
  StitchPageHeader, StitchSectionHeader, StitchCard, StitchMetricCard,
  StitchProgressBar, StitchButton, StitchBadge, StitchAvatar, StitchEmptyState,
  StitchLoadingState, StitchErrorState, StitchIcon, S, salpha,
} from '../primitives';

const PHASE_STEPS = {
  Plan:    ['pico', 'prospero'],
  Search:  ['search', 'discovery'],
  Screen:  ['screening', 'prisma'],
  Extract: ['extraction', 'rob'],
  Analyze: ['analysis', 'forest', 'sensitivity', 'subgroup'],
  Report:  ['grade', 'report', 'manuscript'],
};
const PHASE_PRIMARY = { Plan: 'pico', Search: 'search', Screen: 'screening', Extract: 'extraction', Analyze: 'analysis', Report: 'grade' };
const PHASE_DESC = {
  Plan:    'Define the PICO question, eligibility criteria and the registered protocol.',
  Search:  'Build and run the multi-database search strategy.',
  Screen:  'Import citations, de-duplicate, and screen titles, abstracts and full text.',
  Extract: 'Extract study data and assess risk of bias for each included study.',
  Analyze: 'Pool effect sizes, plot the forest, and run sensitivity / subgroup analyses.',
  Report:  'Rate GRADE certainty, complete the PRISMA checklist and draft the manuscript.',
};
const STEP_TONE = { done: 'success', partial: 'warn', empty: 'neutral' };
const STEP_LABEL = { done: 'Complete', partial: 'In progress', empty: 'Not started' };
const STEP_LABELS_SHORT = {
  pico: 'PICO', prospero: 'Protocol', search: 'Search', discovery: 'Discovery', screening: 'Screening',
  prisma: 'PRISMA', extraction: 'Extraction', rob: 'RoB', analysis: 'Meta-analysis',
  forest: 'Forest', sensitivity: 'Sensitivity', subgroup: 'Subgroup',
  grade: 'GRADE', report: 'Checklist', manuscript: 'Manuscript',
};
// Ordered workflow ids + a label map (from the legacy TABS — single source).
const WORKFLOW_TABS = TABS.filter((t) => t.phase);
const STAGE_LABEL = TABS.reduce((m, t) => { m[t.id] = t.label; return m; }, {});

function rollupPhase(steps, statusMap) {
  const states = steps.map((k) => statusMap[k] || 'empty');
  const score = states.reduce((n, s) => n + (s === 'done' ? 1 : s === 'partial' ? 0.5 : 0), 0);
  const pct = states.length ? Math.round((score / states.length) * 100) : 0;
  const status = states.every((s) => s === 'done') ? 'done' : states.some((s) => s !== 'empty') ? 'partial' : 'empty';
  return { status, pct, states };
}
function stepTone(status) { return STEP_TONE[status] || 'neutral'; }

/* Build the contextual Screening pipeline steps (design2.md Part 6 canonical set),
   merging live counts/status from the screening overview where available. */
function buildScreeningNavSteps(dataSummary, linkedId, projectId) {
  const ds = dataSummary || {};
  const num = (v) => (typeof v === 'number' ? v : null);
  const map = {
    import: { count: num(ds.totalArticles), status: ds.totalArticles ? 'done' : 'active' },
    duplicates: (() => { const u = num(ds.unresolvedDuplicateGroups); return { count: u, status: u > 0 ? 'attention' : (ds.totalArticles ? 'done' : 'pending') }; })(),
    screening: (() => { const t = num(ds.titleAbstractPending); return { count: t, status: t === 0 ? 'done' : (t > 0 ? 'active' : 'pending') }; })(),
    conflicts: (() => { const c = num(ds.unresolvedConflicts != null ? ds.unresolvedConflicts : ds.conflicts); return { count: c, status: c > 0 ? 'attention' : (ds.totalArticles ? 'done' : 'pending') }; })(),
    'second-review': (() => { const e = num(ds.eligibleSecondReview); return { count: e, status: e === 0 ? 'done' : (e > 0 ? 'active' : 'pending') }; })(),
  };
  return SCREENING_SUBNAV.map((s) => {
    const live = dataSummary ? map[s.key] : null;
    return {
      key: s.key,
      label: s.label,
      icon: s.icon,
      status: live ? live.status : undefined,
      count: live && live.count != null ? live.count : null,
      href: screeningSubHref(s.key, { projectId, linkedSiftId: linkedId }),
      disabled: !linkedId,
    };
  });
}

export default function StitchProjectOverview() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const p = await api.projects.get(projectId);
      setProject(p);
      const linkedId = linkedSiftId(p);
      if (linkedId) {
        const [ov, mem] = await Promise.allSettled([
          screeningApi.getOverview(linkedId),
          screeningApi.listMembers(linkedId),
        ]);
        setOverview(ov.status === 'fulfilled' ? ov.value : null);
        const memVal = mem.status === 'fulfilled' ? mem.value : null;
        setMembers(memVal == null ? null : (Array.isArray(memVal) ? memVal : (memVal.members || [])));
      } else {
        setOverview(null); setMembers(null);
      }
    } catch (e) {
      if (!silent) setError(e?.message || 'Could not load this project.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadData(false); }, [loadData]);

  // Realtime: refetch screening numbers + roster when something changes elsewhere
  // (audit E gap #19) — silent so the page never flashes its loading state.
  useRealtime({
    'decision.saved': () => loadData(true),
    'handoff.updated': () => loadData(true), // accept/reject to extraction (server event)
    'members.changed': () => loadData(true),
    'project.updated': () => loadData(true),
  });

  const linkedId = project ? linkedSiftId(project) : null;
  const perms = project ? projectPerms(project) : null;
  const screeningComplete = !!(project && project._linkedMetaSift && project._linkedMetaSift.progressStatus === 'done');
  // The pure engine helpers (stepStatus/auditProject) dereference project.studies
  // without a guard. The server blob is not guaranteed to carry a studies array
  // (legacy/non-standard blobs), so normalize once — matching how every other
  // consumer (Workspace.jsx, overviewTabs.jsx) defends this field.
  const safeProject = useMemo(
    () => (project ? { ...project, studies: Array.isArray(project.studies) ? project.studies : [] } : null),
    [project],
  );
  const statusMap = useMemo(() => (safeProject ? stepStatus(safeProject, screeningComplete) : {}), [safeProject, screeningComplete]);

  const phases = useMemo(() => PHASES.map((name) => ({
    name, label: phaseLabel(name), icon: PHASE_ICON[name], desc: PHASE_DESC[name],
    ...rollupPhase(PHASE_STEPS[name], statusMap),
  })), [statusMap]);
  const overallPct = phases.length ? Math.round(phases.reduce((n, ph) => n + ph.pct, 0) / phases.length) : 0;
  const stepsDone = WORKFLOW_TABS.filter((t) => statusMap[t.id] === 'done').length;

  const dataSummary = overview?.dataSummary || null;
  const studyCount = project ? (project._studyCount != null ? project._studyCount : (Array.isArray(project.studies) ? project.studies.length : 0)) : 0;
  const recordCount = (project && project._linkedMetaSift && project._linkedMetaSift.recordCount)
    || (dataSummary && dataSummary.totalArticles) || 0;
  const includedCount = dataSummary ? dataSummary.acceptedToExtraction : null;
  const conflictsCount = dataSummary ? (dataSummary.unresolvedConflicts != null ? dataSummary.unresolvedConflicts : dataSummary.conflicts) : null;

  const readiness = project ? readinessCheck(project) : null;
  const auditItems = useMemo(() => (safeProject ? auditProject(safeProject) : []), [safeProject]);
  const auditCounts = useMemo(() => ({
    high: auditItems.filter((i) => i.sev === 'high').length,
    med: auditItems.filter((i) => i.sev === 'med').length,
    low: auditItems.filter((i) => i.sev === 'low').length,
  }), [auditItems]);

  // The single most-actionable element: the first workflow step that isn't done.
  const nextStepId = useMemo(() => {
    const hit = WORKFLOW_TABS.find((t) => (statusMap[t.id] || 'empty') !== 'done');
    return hit ? hit.id : null;
  }, [statusMap]);

  const pico = (project && project.pico) || {};
  const picoFilled = !!(pico.P || pico.I || pico.C || pico.O || pico.question);

  const goStage = useCallback(
    (id) => navigate(projectStageHref(id, { projectId, linkedSiftId: linkedId })),
    [navigate, projectId, linkedId],
  );
  const goPhase = useCallback((phaseName) => goStage(PHASE_PRIMARY[phaseName] || 'overview'), [goStage]);

  const onExport = useCallback(async () => {
    if (!perms?.canExport) return;
    setExporting(true);
    try {
      const data = await api.exportProject(projectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(project?.name || 'project').replace(/[^\w.-]+/g, '_')}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setError('Export failed. Please try again.'); } finally { setExporting(false); }
  }, [perms, projectId, project]);

  /* ── shell wiring: project rail + (when linked) the screening pipeline ── */
  const renderPrimaryRail = (variant) => (
    <StitchProjectRail
      projectId={projectId}
      linkedSiftId={linkedId}
      statusMap={statusMap}
      activeStage="overview"
      variant={variant === 'mobile' ? 'static' : 'overlay'}
    />
  );
  const screeningSteps = useMemo(() => buildScreeningNavSteps(dataSummary, linkedId, projectId), [dataSummary, linkedId, projectId]);
  const contextRail = linkedId ? (
    <StitchWorkflowNav
      title="Screening"
      subtitle="Pipeline"
      steps={screeningSteps}
      onNavigate={(step) => { if (step.href) navigate(step.href); }}
      footer={<div style={{ fontSize: 11.5, color: S.textMuted, textAlign: 'center' }}>{includedCount != null ? `${includedCount} included to extraction` : 'Live screening progress'}</div>}
    />
  ) : null;

  // On mobile the full-label project rail already covers navigation; omit the
  // secondary column from the drawer to avoid two stacked sidebars.
  const shellProps = { activeKey: 'dashboard', renderPrimaryRail, contextRail, contextRailMobile: null };

  /* ── loading / error ── */
  if (loading) {
    return <StitchAppShell {...shellProps} breadcrumb="Project"><StitchLoadingState label="Loading your project…" /></StitchAppShell>;
  }
  if (error || !project) {
    return (
      <StitchAppShell {...shellProps} breadcrumb="Project">
        <StitchErrorState title="Couldn't load this project"
          desc={error || 'The project may have been deleted, or you may not have access.'}
          onRetry={error ? () => loadData(false) : undefined} />
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <StitchButton variant="neutral" icon="arrowLeft" onClick={() => navigate('/app')}>Back to dashboard</StitchButton>
        </div>
      </StitchAppShell>
    );
  }

  const lifecycle = statusOf(project);
  const sm = STATUS_META[lifecycle] || {};
  const role = (perms && perms.role) || 'owner';
  const readOnly = !!(perms && perms.readOnly);
  const owner = project._owner || null;

  const breadcrumb = (
    <>
      <button type="button" className="stitch-link stitch-focusable" onClick={() => navigate('/app')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textSecondary, fontWeight: 600, fontFamily: S.font, fontSize: 13, padding: 0 }}>Dashboard</button>
      <span style={{ color: S.textMuted }}>/</span>
      <span style={{ color: S.textPrimary }}>{project.name || 'Project'}</span>
    </>
  );

  return (
    <StitchAppShell {...shellProps} breadcrumb={breadcrumb}>
      <StitchPageHeader
        eyebrow="Project Command Center"
        icon="folder"
        title={project.name || 'Untitled project'}
        subtitle={`Updated ${relTime(project.updatedAt || project.modified)} · ${overallPct}% through the systematic-review workflow`}
        actions={<>
          {perms?.canExport ? <StitchButton variant="neutral" icon="download" loading={exporting} onClick={onExport}>Export</StitchButton> : null}
          <StitchButton icon="sliders" variant="neutral" onClick={() => goStage('control')}>Project Control</StitchButton>
          {linkedId ? <StitchButton icon="filter" iconRight="arrowRight" onClick={() => goStage('screening')}>Open Screening</StitchButton> : null}
        </>}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <StitchBadge tone={lifecycle === 'done' ? 'success' : lifecycle === 'archived' ? 'neutral' : 'brand'} dot>{sm.label || lifecycle}</StitchBadge>
        <StitchBadge tone="neutral">{ROLE_LABEL[role] || 'Owner'}{readOnly ? ' · read-only' : ''}</StitchBadge>
        {pico.prosperoId ? <StitchBadge tone="info" icon="clipboard">PROSPERO {pico.prosperoId}</StitchBadge> : null}
        {pico.studyDesign ? <StitchBadge tone="neutral">{pico.studyDesign}</StitchBadge> : null}
        {linkedId ? <StitchBadge tone="info" icon="link">Linked to Screening</StitchBadge> : <StitchBadge tone="neutral" icon="alert">No linked Screening</StitchBadge>}
        {project._archived ? <StitchBadge tone="warn" icon="layers">Archived</StitchBadge> : null}
        {/* design4: live online project members on the overview too (deep-tool pages
            already show this) — real, project-scoped presence, never a fake list. */}
        {linkedId ? (
          <div style={{ marginLeft: 'auto' }}>
            <StitchProjectPresence spId={linkedId} location="Project overview" totalMembers={members ? members.length : undefined} />
          </div>
        ) : null}
      </div>

      {(readOnly || project._shared) ? (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, background: S.warnSoft, border: `1px solid ${salpha(S.warn, 0.3)}` }}>
          <span style={{ color: S.warn, flexShrink: 0 }}><StitchIcon name="lock" size={16} /></span>
          <span style={{ fontSize: 13, color: S.onWarnSoft }}>
            {readOnly ? 'You have read-only access to this shared project — you can view everything but not make changes.'
              : `This project is shared with you${owner ? ` by ${owner.name || owner.email}` : ''}.`}
          </span>
        </div>
      ) : null}

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Next step CTA — the most actionable element (audit E gap #14) */}
        {nextStepId ? (
          <StitchCard style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: salpha(S.brand, 0.06), borderColor: salpha(S.brand, 0.25) }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: S.brand, color: S.onBrand, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <StitchIcon name="target" size={22} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.brand }}>Recommended next step</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: S.textPrimary, marginTop: 2 }}>{STAGE_LABEL[nextStepId] || 'Continue the review'}</div>
              <div style={{ fontSize: 12.5, color: S.textSecondary, marginTop: 2 }}>{stepsDone} of {WORKFLOW_TABS.length} workflow steps complete</div>
            </div>
            <StitchButton iconRight="arrowRight" onClick={() => goStage(nextStepId)}>Continue</StitchButton>
          </StitchCard>
        ) : (
          <StitchCard style={{ display: 'flex', alignItems: 'center', gap: 16, background: salpha(S.success, 0.06), borderColor: salpha(S.success, 0.25) }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: S.success, color: S.onSuccess, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <StitchIcon name="circleCheck" size={22} />
            </span>
            <div><div style={{ fontSize: 16, fontWeight: 700, color: S.textPrimary }}>All workflow steps complete</div>
              <div style={{ fontSize: 12.5, color: S.textSecondary }}>Every stage of the review is marked done. Review the report and export your manuscript.</div></div>
          </StitchCard>
        )}

        {/* Metric row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <StitchMetricCard label="Studies extracted" value={studyCount} icon="table" tone="brand" onClick={() => goStage('extraction')} />
          <StitchMetricCard label={linkedId ? 'Citations / records' : 'Records'} value={recordCount} icon="fileText" onClick={linkedId ? () => goStage('screening') : undefined} />
          <StitchMetricCard label="Included (to extraction)" value={includedCount == null ? '—' : includedCount} icon="checkSquare" tone="success" />
          <StitchMetricCard label="Open conflicts" value={conflictsCount == null ? '—' : conflictsCount} icon="alertTriangle" tone={conflictsCount ? 'danger' : 'neutral'} />
        </div>

        {/* Workflow progress + Methodology audit */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.2fr)', gap: 24, alignItems: 'stretch' }} className="stitch-bento">
          <StitchCard style={{ display: 'flex', flexDirection: 'column' }}>
            <StitchSectionHeader title="Workflow progress" desc={`${stepsDone} of ${WORKFLOW_TABS.length} steps complete`} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
              {phases.map((ph) => (
                <button key={ph.name} type="button" className="stitch-focusable" onClick={() => goPhase(ph.name)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: S.textSecondary }}>
                      <StitchIcon name={ph.icon} size={14} /> {ph.label}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: S.textMuted }}>{ph.pct}%</span>
                  </div>
                  <StitchProgressBar value={ph.pct} tone={stepTone(ph.status)} height={6} />
                </button>
              ))}
            </div>
          </StitchCard>

          <StitchCard style={{ display: 'flex', flexDirection: 'column' }}>
            <StitchSectionHeader title="Methodology check"
              desc="Automated checks across the review (same engine as the classic audit)"
              action={<StitchBadge tone={auditCounts.high ? 'danger' : auditCounts.med ? 'warn' : 'success'} dot>{auditItems.length ? `${auditItems.length} to review` : 'All clear'}</StitchBadge>} />
            {auditItems.length ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {auditItems.slice(0, 5).map((it, i) => (
                  <li key={i}>
                    <button type="button" className="stitch-focusable" onClick={() => goStage(PHASE_PRIMARY[it.phase] || 'overview')}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: '2px 0' }}>
                      <span style={{ color: it.sev === 'high' ? S.danger : it.sev === 'med' ? S.warn : S.textMuted, flexShrink: 0, marginTop: 1 }}>
                        <StitchIcon name={it.sev === 'high' ? 'alertOctagon' : it.sev === 'med' ? 'alertTriangle' : 'info'} size={15} />
                      </span>
                      <span style={{ fontSize: 12.5, color: S.textSecondary, lineHeight: 1.5 }}>{it.msg}</span>
                    </button>
                  </li>
                ))}
                {auditItems.length > 5 ? <li style={{ fontSize: 12, color: S.textMuted, paddingTop: 2 }}>+{auditItems.length - 5} more across {auditCounts.high} high · {auditCounts.med} medium · {auditCounts.low} low priority</li> : null}
              </ul>
            ) : (
              <div style={{ flex: 1, display: 'flex' }}>
                <StitchEmptyState icon="circleCheck" title="No methodological gaps found" height={160}
                  desc="Every automated check (PICO, search coverage, extraction, RoB, GRADE, PRISMA) currently passes." />
              </div>
            )}
          </StitchCard>
        </div>

        {/* PICO + Readiness */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(280px, 1fr)', gap: 24, alignItems: 'start' }} className="stitch-bento">
          <StitchCard>
            <StitchSectionHeader title="Protocol (PICO)" desc="The review question and eligibility framework"
              action={<StitchButton size="sm" variant="ghost" iconRight="arrowRight" onClick={() => goStage('pico')}>{picoFilled ? 'Edit' : 'Start'}</StitchButton>} />
            {picoFilled ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pico.question ? <div style={{ fontSize: 14, fontWeight: 600, color: S.textPrimary, lineHeight: 1.5 }}>{pico.question}</div> : null}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  {[['Population', pico.P], ['Intervention', pico.I], ['Comparator', pico.C], ['Outcome', pico.O]].map(([k, v]) => (
                    <div key={k} style={{ padding: '10px 12px', borderRadius: 10, background: S.surfaceLow, border: `1px solid ${salpha(S.outlineVariant, 0.4)}` }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.brand }}>{k}</div>
                      <div style={{ fontSize: 12.5, color: v ? S.textPrimary : S.textMuted, marginTop: 3, lineHeight: 1.4 }}>{v || 'Not set'}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <StitchEmptyState icon="target" title="No PICO yet" height={180}
                desc="Define Population, Intervention, Comparator and Outcome to frame the review."
                action={<StitchButton size="sm" variant="soft" iconRight="arrowRight" onClick={() => goStage('pico')}>Define PICO</StitchButton>} />
            )}
          </StitchCard>

          <StitchCard style={{ display: 'flex', flexDirection: 'column' }}>
            <StitchSectionHeader title="Readiness check" desc="Pre-screening green-light"
              action={<StitchBadge tone={readiness?.ok ? 'success' : 'warn'} dot>{readiness?.ok ? 'Ready' : `${readiness?.missing.length || 0} to resolve`}</StitchBadge>} />
            {readiness?.ok ? (
              <div style={{ flex: 1, display: 'flex' }}>
                <StitchEmptyState icon="circleCheck" title="Screening-ready" height={160}
                  desc="PICO, time frame, ≥3 databases and a saved search strategy are all in place." />
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(readiness?.missing || []).map((m, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: S.textSecondary, lineHeight: 1.5 }}>
                    <span style={{ color: S.warn, flexShrink: 0, marginTop: 1 }}><StitchIcon name="alertTriangle" size={15} /></span>
                    <span>{m}</span>
                  </li>
                ))}
                <li style={{ marginTop: 6 }}><StitchButton size="sm" variant="soft" iconRight="arrowRight" onClick={() => goStage('pico')}>Complete the protocol</StitchButton></li>
              </ul>
            )}
          </StitchCard>
        </div>

        {/* Phase cards */}
        <div>
          <StitchSectionHeader title="Review phases" desc="Open a stage to continue. Each opens its dedicated workflow." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {phases.map((ph, i) => (
              <PhaseCard key={ph.name} index={i + 1} phase={ph} statusMap={statusMap}
                onOpen={() => goPhase(ph.name)}
                onOpenRob={ph.name === 'Extract' ? () => goStage('rob') : undefined}
                canRob={!!(perms && (perms.isOwner || perms.canAssessRiskOfBias))} />
            ))}
          </div>
        </div>

        {/* Team + details */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(280px, 1fr)', gap: 24, alignItems: 'start' }} className="stitch-bento">
          <StitchCard>
            <StitchSectionHeader title="Team"
              desc={linkedId ? 'Members of the linked Screening workspace' : 'Not linked to a Screening workspace'}
              action={linkedId ? <StitchButton size="sm" variant="ghost" iconRight="arrowRight" onClick={() => goStage('screening')}>Manage</StitchButton> : null} />
            {!linkedId ? (
              <StitchEmptyState icon="users" title="No team yet" height={180}
                desc="Link a Screening workspace to collaborate with reviewers on this review."
                action={<StitchButton size="sm" variant="soft" icon="sliders" onClick={() => goStage('control')}>Open Project Control</StitchButton>} />
            ) : members === null ? (
              <StitchEmptyState icon="users" title="Team unavailable" height={160}
                desc="You don't have permission to view the member roster, or it could not be loaded." />
            ) : members.length === 0 ? (
              <StitchEmptyState icon="users" title="No members yet" height={160}
                desc="Invite reviewers from the Screening workspace to start collaborating."
                action={<StitchButton size="sm" variant="soft" iconRight="arrowRight" onClick={() => goStage('screening')}>Open Screening</StitchButton>} />
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
              {owner ? <DetailRow label="Owner" value={owner.name || owner.email || '—'} /> : null}
              <DetailRow label="Your role" value={`${ROLE_LABEL[role] || 'Owner'}${readOnly ? ' (read-only)' : ''}`} />
              <DetailRow label="Last updated" value={relTime(project.updatedAt || project.modified)} />
              <DetailRow label="Created" value={relTime(project.created || project.createdAt)} />
              <DetailRow label="Studies extracted" value={String(studyCount)} />
              <DetailRow label={linkedId ? 'Screening records' : 'Records'} value={String(recordCount)} />
              <DetailRow label="Risk of Bias" value={STEP_LABEL[statusMap.rob || 'empty']} last />
            </dl>
          </StitchCard>
        </div>
      </div>

      <style>{'@media (max-width: 980px){ html[data-ui-design="stitch"] .stitch-bento{ grid-template-columns: 1fr !important; } }'}</style>
    </StitchAppShell>
  );
}

function PhaseCard({ index, phase, statusMap, onOpen, onOpenRob, canRob }) {
  const isExtract = phase.name === 'Extract';
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PHASE_STEPS[phase.name].map((k) => {
          const s = statusMap[k] || 'empty';
          return <StitchBadge key={k} tone={stepTone(s)}>{STEP_LABELS_SHORT[k] || k}</StitchBadge>;
        })}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <StitchButton size="sm" block iconRight="arrowRight" onClick={onOpen}>Continue</StitchButton>
        {isExtract ? (
          canRob
            ? <StitchButton size="sm" block variant="neutral" icon="scale" onClick={onOpenRob}>Risk of Bias workspace</StitchButton>
            : <div style={{ fontSize: 11, color: S.textMuted, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><StitchIcon name="lock" size={12} /> Risk of Bias is read-only for your role</div>
        ) : null}
      </div>
    </StitchCard>
  );
}

function DetailRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: last ? 'none' : `1px solid ${salpha(S.outlineVariant, 0.3)}` }}>
      <dt style={{ fontSize: 12.5, color: S.textSecondary, margin: 0 }}>{label}</dt>
      <dd style={{ fontSize: 13, fontWeight: 600, color: S.textPrimary, margin: 0, textAlign: 'right' }}>{value}</dd>
    </div>
  );
}
