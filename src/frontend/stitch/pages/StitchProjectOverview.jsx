/**
 * StitchProjectOverview.jsx — the Stitch project command center
 * (route /app/project/:projectId).
 *
 * It reuses the SAME data + pure engine as the classic workspace (no forked logic):
 *   - api.projects.get(projectId)              — the canonical project blob
 *   - screeningApi.getOverview/listMembers     — linked screening metrics + roster
 *   - workspace/projectHelpers.js              — stepStatus, PHASES, readinessCheck,
 *                                                projectPerms, linkedSiftId, auditProject
 *
 * 56.md §1 redesign: a CALMER command center built for "understand the project in
 * seconds". It leads with a compact header, ONE context-aware Continue action, then
 * a quiet two-column body — a high-level Workflow summary, a prioritized "Attention
 * required" list and a role-aware "My work" list (both omitted when empty), with the
 * key metrics, protocol-at-a-glance and team in a secondary column. Deeper detail is
 * reached by opening the relevant stage (progressive disclosure) rather than packing
 * every metric onto the first screen. Presence lives in the top bar; the white
 * submenu is suppressed so the page reclaims the full width.
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
import StitchProjectPresence from '../shell/StitchProjectPresence.jsx';
import { useSidebarPin } from '../shell/useSidebarPin.js';
import { totalMembersOf } from '../shell/presence.js';
import { projectStageHref } from '../nav/navConfig.js';
import { buildMyWork, buildAttention } from './overviewModel.js';
import {
  StitchPageHeader, StitchSectionHeader, StitchCard, StitchMetricCard,
  StitchProgressBar, StitchButton, StitchBadge, StitchAvatar, StitchEmptyState,
  StitchLoadingState, StitchErrorState, StitchIcon, S, salpha,
} from '../primitives';

const PHASE_STEPS = {
  Plan:    ['pico', 'prospero'],
  Search:  ['search'],
  Screen:  ['screening', 'prisma'],
  Extract: ['extraction', 'rob'],
  Analyze: ['analysis', 'forest', 'sensitivity', 'subgroup'],
  Report:  ['grade', 'report', 'manuscript'],
};
const PHASE_PRIMARY = { Plan: 'pico', Search: 'search', Screen: 'screening', Extract: 'extraction', Analyze: 'analysis', Report: 'grade' };
const STEP_TONE = { done: 'success', partial: 'warn', empty: 'neutral' };
const STEP_LABEL = { done: 'Complete', partial: 'In progress', empty: 'Not started' };
// Ordered workflow ids + a label map (from the legacy TABS — single source).
const WORKFLOW_TABS = TABS.filter((t) => t.phase);
const STAGE_LABEL = TABS.reduce((m, t) => { m[t.id] = t.label; return m; }, {});
const SEV_COLOR = (sev) => (sev === 'high' ? S.danger : sev === 'med' ? S.warn : S.textMuted);
const SEV_ICON = (sev) => (sev === 'high' ? 'alertOctagon' : sev === 'med' ? 'alertTriangle' : 'info');

function rollupPhase(steps, statusMap) {
  const states = steps.map((k) => statusMap[k] || 'empty');
  const score = states.reduce((n, s) => n + (s === 'done' ? 1 : s === 'partial' ? 0.5 : 0), 0);
  const pct = states.length ? Math.round((score / states.length) * 100) : 0;
  const status = states.every((s) => s === 'done') ? 'done' : states.some((s) => s !== 'empty') ? 'partial' : 'empty';
  return { status, pct, states };
}
function stepTone(status) { return STEP_TONE[status] || 'neutral'; }

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
    name, label: phaseLabel(name), icon: PHASE_ICON[name],
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

  /* ── shell wiring: project rail (coordinated, pinnable) ── */
  const { pinned, togglePin } = useSidebarPin();
  const renderPrimaryRail = (variant) => (
    <StitchProjectRail
      projectId={projectId}
      linkedSiftId={linkedId}
      statusMap={statusMap}
      activeStage="overview"
      variant={variant === 'mobile' ? 'static' : 'overlay'}
      pinned={pinned}
      onTogglePin={togglePin}
    />
  );
  // 55.md #2 — the Overview shows NO white submenu; it reclaims the full width.
  // 55.md #14 / 56.md §5 — presence lives in the top bar from the ONE shared source.
  const topPresence = linkedId ? (
    <StitchProjectPresence spId={linkedId} location="Project overview" totalMembers={totalMembersOf(project, members)} />
  ) : null;
  const shellProps = { activeKey: 'dashboard', renderPrimaryRail, contextRail: null, coordinatedNav: true, pinned, topPresence };

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
  const canRob = !!(perms && (perms.isOwner || perms.canAssessRiskOfBias));

  // Role-aware "My work" + prioritized "Attention required" (omitted when empty).
  const myWork = buildMyWork({ statusMap, readiness, conflictsCount: conflictsCount || 0, perms: perms || {}, studyCount });
  const attention = buildAttention({ auditItems, conflictsCount: conflictsCount || 0, phasePrimary: PHASE_PRIMARY, limit: 6 });
  const attentionTotal = auditItems.length + (conflictsCount > 0 ? 1 : 0);

  const breadcrumb = (
    <>
      <button type="button" className="stitch-link stitch-focusable" onClick={() => navigate('/app')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textSecondary, fontWeight: 600, fontFamily: S.font, fontSize: 13, padding: 0 }}>Dashboard</button>
      <span style={{ color: S.textMuted }}>/</span>
      <span style={{ color: S.textPrimary }}>{project.name || 'Project'}</span>
    </>
  );

  return (
    <StitchAppShell {...shellProps} breadcrumb={breadcrumb}>
      {/* A. Compact header */}
      <StitchPageHeader
        eyebrow="Project"
        icon="folder"
        title={project.name || 'Untitled project'}
        subtitle={pico.question
          ? pico.question
          : `Updated ${relTime(project.updatedAt || project.modified)} · ${overallPct}% through the review`}
        actions={<>
          {perms?.canExport ? <StitchButton variant="ghost" size="sm" icon="download" loading={exporting} onClick={onExport}>Export</StitchButton> : null}
          <StitchButton icon="sliders" variant="neutral" size="sm" onClick={() => goStage('control')}>Project Control</StitchButton>
        </>}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <StitchBadge tone={lifecycle === 'done' ? 'success' : lifecycle === 'archived' ? 'neutral' : 'brand'} dot>{sm.label || lifecycle}</StitchBadge>
        <StitchBadge tone="neutral">{ROLE_LABEL[role] || 'Owner'}{readOnly ? ' · read-only' : ''}</StitchBadge>
        <StitchBadge tone="neutral" icon="clock">Updated {relTime(project.updatedAt || project.modified)}</StitchBadge>
        {pico.prosperoId ? <StitchBadge tone="info" icon="clipboard">PROSPERO {pico.prosperoId}</StitchBadge> : null}
        {linkedId ? <StitchBadge tone="info" icon="link">Linked to Screening</StitchBadge> : <StitchBadge tone="neutral" icon="alert">No linked Screening</StitchBadge>}
        {project._archived ? <StitchBadge tone="warn" icon="layers">Archived</StitchBadge> : null}
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

      {/* B. The ONE primary "Continue work" action */}
      <div style={{ marginTop: 20 }}>
        {nextStepId ? (
          <StitchCard style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: salpha(S.brand, 0.06), borderColor: salpha(S.brand, 0.25) }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: S.brand, color: S.onBrand, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <StitchIcon name="target" size={22} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.brand }}>Continue where you left off</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: S.textPrimary, marginTop: 2 }}>{STAGE_LABEL[nextStepId] || 'Continue the review'}</div>
              <div style={{ fontSize: 12.5, color: S.textSecondary, marginTop: 2 }}>{stepsDone} of {WORKFLOW_TABS.length} workflow steps complete · {overallPct}%</div>
            </div>
            <StitchButton iconRight="arrowRight" onClick={() => goStage(nextStepId)}>Continue</StitchButton>
          </StitchCard>
        ) : (
          <StitchCard style={{ display: 'flex', alignItems: 'center', gap: 16, background: salpha(S.success, 0.06), borderColor: salpha(S.success, 0.25) }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: S.success, color: S.onSuccess, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <StitchIcon name="circleCheck" size={22} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: S.textPrimary }}>All workflow steps complete</div>
              <div style={{ fontSize: 12.5, color: S.textSecondary }}>Every stage is marked done. Review the report and export your manuscript.</div>
            </div>
            <StitchButton variant="neutral" iconRight="arrowRight" onClick={() => goStage('report')}>Open report</StitchButton>
          </StitchCard>
        )}
      </div>

      {/* Calm two-column body */}
      <div className="stitch-ov-grid" style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* LEFT — workflow + what needs doing */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <StitchCard>
            <StitchSectionHeader title="Workflow" desc={`${stepsDone} of ${WORKFLOW_TABS.length} steps complete`}
              action={<StitchBadge tone={overallPct === 100 ? 'success' : 'brand'} dot>{overallPct}%</StitchBadge>} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {phases.map((ph, i) => (
                <WorkflowRow key={ph.name} index={i + 1} phase={ph} active={PHASE_PRIMARY[ph.name] === nextStepId} onOpen={() => goPhase(ph.name)} />
              ))}
            </div>
          </StitchCard>

          {attention.length ? (
            <StitchCard>
              <StitchSectionHeader title="Attention required"
                desc="Methodology and process items to resolve"
                action={<StitchBadge tone={attention.some((a) => a.sev === 'high') ? 'danger' : 'warn'} dot>{attentionTotal}</StitchBadge>} />
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {attention.map((it) => (
                  <li key={it.key}>
                    <button type="button" className="stitch-focusable" onClick={() => goStage(it.stage)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: '2px 0' }}>
                      <span style={{ color: SEV_COLOR(it.sev), flexShrink: 0, marginTop: 1 }}><StitchIcon name={SEV_ICON(it.sev)} size={15} /></span>
                      <span style={{ fontSize: 12.5, color: S.textSecondary, lineHeight: 1.5 }}>{it.msg}</span>
                    </button>
                  </li>
                ))}
                {attentionTotal > attention.length ? (
                  <li style={{ fontSize: 12, color: S.textMuted, paddingTop: 2 }}>+{attentionTotal - attention.length} more — open a stage to review.</li>
                ) : null}
              </ul>
            </StitchCard>
          ) : null}

          {myWork.length ? (
            <StitchCard>
              <StitchSectionHeader title="My work" desc="Actions you can take now" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {myWork.map((w) => (
                  <button key={w.key} type="button" className="stitch-focusable" onClick={() => goStage(w.stage)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: `1px solid ${salpha(S.outlineVariant, 0.4)}`, background: S.surfaceLow, cursor: 'pointer', textAlign: 'left', padding: '10px 12px', borderRadius: 10 }}>
                    <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: salpha(w.tone === 'danger' ? S.danger : w.tone === 'warn' ? S.warn : S.brand, 0.14), color: w.tone === 'danger' ? S.danger : w.tone === 'warn' ? S.warn : S.brand }}>
                      <StitchIcon name={w.icon} size={16} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: S.textPrimary }}>{w.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: S.textSecondary }}>{w.desc}</span>
                    </span>
                    <StitchIcon name="arrowRight" size={16} />
                  </button>
                ))}
              </div>
            </StitchCard>
          ) : null}
        </div>

        {/* RIGHT — metrics, protocol at a glance, team */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <StitchMetricCard label={linkedId ? 'Citations / records' : 'Records'} value={recordCount} icon="fileText" onClick={linkedId ? () => goStage('screening') : undefined} />
            <StitchMetricCard label="Included" value={includedCount == null ? '—' : includedCount} icon="checkSquare" tone="success" />
            <StitchMetricCard label="Studies extracted" value={studyCount} icon="table" tone="brand" onClick={() => goStage('extraction')} />
            <StitchMetricCard label="Open conflicts" value={conflictsCount == null ? '—' : conflictsCount} icon="alertTriangle" tone={conflictsCount ? 'danger' : 'neutral'} onClick={linkedId ? () => goStage('screening') : undefined} />
          </div>

          <StitchCard>
            <StitchSectionHeader title="Protocol" desc="The review question & framework"
              action={<StitchButton size="sm" variant="ghost" iconRight="arrowRight" onClick={() => goStage('pico')}>{picoFilled ? 'Edit' : 'Start'}</StitchButton>} />
            {picoFilled ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pico.question ? <div style={{ fontSize: 13.5, fontWeight: 600, color: S.textPrimary, lineHeight: 1.5 }}>{pico.question}</div> : null}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                  {[['Population', pico.P], ['Intervention', pico.I], ['Comparator', pico.C], ['Outcome', pico.O]].map(([k, v]) => (
                    <div key={k} style={{ padding: '8px 10px', borderRadius: 9, background: S.surfaceLow, border: `1px solid ${salpha(S.outlineVariant, 0.4)}` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.brand }}>{k}</div>
                      <div style={{ fontSize: 12, color: v ? S.textPrimary : S.textMuted, marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{v || 'Not set'}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <StitchEmptyState icon="target" title="No PICO yet" height={150}
                desc="Define Population, Intervention, Comparator and Outcome to frame the review."
                action={<StitchButton size="sm" variant="soft" iconRight="arrowRight" onClick={() => goStage('pico')}>Define PICO</StitchButton>} />
            )}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${salpha(S.outlineVariant, 0.35)}` }}>
              <dl style={{ margin: 0 }}>
                {owner ? <DetailRow label="Owner" value={owner.name || owner.email || '—'} /> : null}
                <DetailRow label="Your role" value={`${ROLE_LABEL[role] || 'Owner'}${readOnly ? ' (read-only)' : ''}`} />
                <DetailRow label="Created" value={relTime(project.created || project.createdAt)} />
                <DetailRow label="Risk of Bias" value={STEP_LABEL[statusMap.rob || 'empty']} last />
              </dl>
            </div>
          </StitchCard>

          <StitchCard>
            <StitchSectionHeader title="Team"
              desc={linkedId ? 'Linked Screening workspace' : 'Not linked to Screening'}
              action={linkedId ? <StitchButton size="sm" variant="ghost" iconRight="arrowRight" onClick={() => goStage('screening')}>Manage</StitchButton> : null} />
            {!linkedId ? (
              <StitchEmptyState icon="users" title="No team yet" height={140}
                desc="Link a Screening workspace to collaborate with reviewers."
                action={<StitchButton size="sm" variant="soft" icon="sliders" onClick={() => goStage('control')}>Project Control</StitchButton>} />
            ) : members === null ? (
              <StitchEmptyState icon="users" title="Team unavailable" height={130}
                desc="You don't have permission to view the roster, or it couldn't be loaded." />
            ) : members.length === 0 ? (
              <StitchEmptyState icon="users" title="No members yet" height={130}
                desc="Invite reviewers from the Screening workspace to collaborate." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {members.slice(0, 6).map((m, i, arr) => {
                  const name = m.name || m.email || 'Member';
                  return (
                    <div key={m.id || m.userId || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 2px', borderBottom: i < arr.length - 1 ? `1px solid ${salpha(S.outlineVariant, 0.3)}` : 'none' }}>
                      <StitchAvatar name={name} size={30} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: S.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      </div>
                      <StitchBadge tone={m.role === 'owner' || m.role === 'leader' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role] || m.role || 'Reviewer'}</StitchBadge>
                    </div>
                  );
                })}
                {members.length > 6 ? <div style={{ fontSize: 12, color: S.textMuted, paddingTop: 8 }}>+{members.length - 6} more</div> : null}
              </div>
            )}
          </StitchCard>
        </div>
      </div>

      <style>{'@media (max-width: 980px){ html[data-ui-design="stitch"] .stitch-ov-grid{ grid-template-columns: 1fr !important; } }'}</style>
    </StitchAppShell>
  );
}

/** One compact, clickable workflow-phase row (replaces the dense phase-card grid). */
function WorkflowRow({ index, phase, active, onOpen }) {
  const tone = stepTone(phase.status);
  const toneColor = tone === 'success' ? S.success : tone === 'warn' ? S.warn : S.textMuted;
  return (
    <button type="button" className="stitch-focusable" onClick={onOpen}
      onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? salpha(S.brand, 0.06) : 'transparent'; }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: 'none', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        padding: '10px 12px', background: active ? salpha(S.brand, 0.06) : 'transparent', transition: 'background 0.15s ease' }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: phase.status === 'done' ? salpha(S.success, 0.15) : active ? salpha(S.brand, 0.14) : S.surfaceContainer,
        color: phase.status === 'done' ? S.success : active ? S.brand : S.textSecondary }}>
        {phase.status === 'done' ? <StitchIcon name="check" size={15} strokeWidth={2.6} /> : <StitchIcon name={phase.icon} size={15} />}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: S.textPrimary }}>{phase.label}</span>
          {active ? <StitchBadge tone="brand">Current</StitchBadge> : null}
        </span>
        <span style={{ display: 'block', marginTop: 6 }}><StitchProgressBar value={phase.pct} tone={tone} height={5} /></span>
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: toneColor, flexShrink: 0, minWidth: 64, textAlign: 'right' }}>{STEP_LABEL[phase.status]}</span>
    </button>
  );
}

function DetailRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: last ? 'none' : `1px solid ${salpha(S.outlineVariant, 0.3)}` }}>
      <dt style={{ fontSize: 12, color: S.textSecondary, margin: 0 }}>{label}</dt>
      <dd style={{ fontSize: 12.5, fontWeight: 600, color: S.textPrimary, margin: 0, textAlign: 'right' }}>{value}</dd>
    </div>
  );
}
