/**
 * StitchProjectWorkspace.jsx — the native Stitch project workspace router
 * (design3.md). Mounted on the existing /app/project/:id stitch route; it reads
 * `?tab=` and renders the project overview OR one of the five native deep-tool
 * pages (Project Control, PICO, Plan & Protocol, Search Builder, Search Discovery)
 * inside ONE shared Stitch project shell — so deep tools no longer escape to legacy
 * via `?ui=legacy`.
 *
 * Each deep tool reuses its proven, self-contained editor (the dispatchers /
 * ControlTab — which own all autosave, validation, flag-gating and permissions),
 * mounted inside native Stitch chrome: the collapsible workflow rail, a project
 * page header (breadcrumb + stage title + live online-member presence + next-step),
 * and loading/error/permission states. State flows through the SAME backend (the
 * `Project.data` blob via `useStitchProjectDoc`, or each tool's own server module)
 * — ZERO data duplication, and edits are reflected identically in the legacy UI.
 *
 * Heavy editor bodies are lazy-imported (code-split, and so this module stays light
 * for the overview path + SSR smoke tests). `?tab=` is parsed from
 * `useLocation().search` (not `useSearchParams`, which the SSR test mock omits).
 */
import { lazy, Suspense } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useProjectPresence } from '../../screening/hooks/usePresence.js';
import PresenceIndicator from '../../screening/components/PresenceIndicator.jsx';
import { linkedSiftId, projectPerms, stepStatus, TABS } from '../../workspace/projectHelpers.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import StitchProjectRail from '../shell/StitchProjectRail.jsx';
import StitchProjectOverview from './StitchProjectOverview.jsx';
import { useStitchProjectDoc } from '../shell/useStitchProjectDoc.js';
import { activeProjectStage, projectStageHref } from '../nav/navConfig.js';
import {
  StitchLoadingState, StitchErrorState, StitchButton, StitchBadge, StitchIcon, S, salpha,
} from '../primitives';

/* ── Lazy editor bodies (the proven legacy/feature components, code-split) ──── */
const LazyControl    = lazy(() => import('../../workspace/tabs/overviewTabs.jsx').then((m) => ({ default: m.ControlTab })));
const LazyPico       = lazy(() => import('../../workspace/tabs/protocolTabs.jsx').then((m) => ({ default: m.PICODispatcher })));
const LazyProtocol   = lazy(() => import('../../../features/planProtocol/index.js').then((m) => ({ default: m.PlanProtocolDispatcher })));
const LazySearch     = lazy(() => import('../../workspace/tabs/protocolTabs.jsx').then((m) => ({ default: m.SearchDispatcher })));
const LazyDiscovery  = lazy(() => import('../../workspace/tabs/protocolTabs.jsx').then((m) => ({ default: m.DiscoveryDispatcher })));

const SCOPE = new Set(['control', 'pico', 'prospero', 'search', 'discovery']);
const STAGE_LABEL = TABS.reduce((m, t) => { m[t.id] = t.label; return m; }, {});
// Workflow order (the legacy stepper order) → used for the next-step action.
const WORKFLOW_IDS = TABS.filter((t) => t.phase).map((t) => t.id);

function nextStageId(stage) {
  const i = WORKFLOW_IDS.indexOf(stage);
  if (i === -1) return 'pico'; // Project Control → start of the workflow
  return WORKFLOW_IDS[i + 1] || null;
}

export default function StitchProjectWorkspace() {
  const { search } = useLocation();
  const stage = activeProjectStage(search);
  // Overview + any not-yet-native stage render the (already native) overview, which
  // itself routes deep tools to their engines — so deep links never break.
  if (!SCOPE.has(stage)) return <StitchProjectOverview />;
  return <DeepToolPage stage={stage} />;
}

function DeepToolPage({ stage }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const doc = useStitchProjectDoc(projectId);
  const project = doc.project;

  const spId = project ? linkedSiftId(project) : null;
  const perms = project ? projectPerms(project) : null;
  const readOnly = !!(perms && perms.readOnly);
  const totalMembers = (project && project._linkedMetaSift && project._linkedMetaSift.memberCount) || undefined;

  // Live, project-scoped presence (this page IS the location → it heartbeats).
  const { users, locks } = useProjectPresence(spId, STAGE_LABEL[stage] || 'Project', { enabled: !!spId, heartbeat: true });

  const safeStudies = project && Array.isArray(project.studies) ? project.studies : [];
  const screeningComplete = !!(project && project._linkedMetaSift && project._linkedMetaSift.progressStatus === 'done');
  const statusMap = project ? stepStatus({ ...project, studies: safeStudies }, screeningComplete) : {};

  const ctx = { projectId, linkedSiftId: spId };
  const goStage = (id) => navigate(projectStageHref(id, ctx));
  const nextId = nextStageId(stage);

  const renderPrimaryRail = (variant) => (
    <StitchProjectRail projectId={projectId} linkedSiftId={spId} statusMap={statusMap}
      activeStage={stage} variant={variant === 'mobile' ? 'static' : 'overlay'} />
  );
  const shellProps = { activeKey: 'dashboard', renderPrimaryRail, contextRail: null, contextRailMobile: null, maxWidth: 1560 };

  const breadcrumb = (
    <>
      <button type="button" className="stitch-link stitch-focusable" onClick={() => navigate('/app')}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textSecondary, fontWeight: 600, fontFamily: S.font, fontSize: 13, padding: 0 }}>Dashboard</button>
      <span style={{ color: S.textMuted }}>/</span>
      <button type="button" className="stitch-link stitch-focusable" onClick={() => navigate(`/app/project/${encodeURIComponent(projectId)}`)}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textSecondary, fontWeight: 600, fontFamily: S.font, fontSize: 13, padding: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {project ? (project.name || 'Project') : 'Project'}
      </button>
      <span style={{ color: S.textMuted }}>/</span>
      <span style={{ color: S.textPrimary }}>{STAGE_LABEL[stage] || 'Stage'}</span>
    </>
  );

  if (doc.loading) {
    return <StitchAppShell {...shellProps} breadcrumb={breadcrumb}><StitchLoadingState label="Loading…" /></StitchAppShell>;
  }
  if (doc.error || !project) {
    return (
      <StitchAppShell {...shellProps} breadcrumb={breadcrumb}>
        <StitchErrorState title="Couldn't load this project"
          desc={doc.error || 'The project may have been deleted, or you may not have access.'}
          onRetry={doc.error ? doc.reload : undefined} />
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <StitchButton variant="neutral" icon="arrowLeft" onClick={() => navigate('/app')}>Back to dashboard</StitchButton>
        </div>
      </StitchAppShell>
    );
  }

  // ── the page header (native Stitch chrome around the proven editor) ──
  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: S.textPrimary, margin: 0 }}>{STAGE_LABEL[stage]}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <StitchBadge tone={readOnly ? 'warn' : 'brand'} dot icon={readOnly ? 'lock' : undefined}>
            {readOnly ? 'Read-only' : (perms && perms.role ? (perms.role[0].toUpperCase() + perms.role.slice(1)) : 'Owner')}
          </StitchBadge>
          {doc.saveStatus === 'saving' ? <StitchBadge tone="info" icon="refresh">Saving…</StitchBadge>
            : doc.saveStatus === 'saved' ? <StitchBadge tone="success" icon="circleCheck">Autosaved</StitchBadge>
              : doc.saveStatus === 'error' ? <StitchBadge tone="danger" icon="alertTriangle">Save failed</StitchBadge> : null}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <PresenceIndicator users={users} locks={locks} totalMembers={totalMembers} myUserId={user?.id} />
        {nextId ? (
          <StitchButton iconRight="arrowRight" onClick={() => goStage(nextId)}>
            {nextId === 'screening' ? 'Continue to Screening' : `Next: ${STAGE_LABEL[nextId] || 'Continue'}`}
          </StitchButton>
        ) : null}
      </div>
    </div>
  );

  const fallback = <StitchLoadingState label="Loading workspace…" />;
  let body = null;
  if (stage === 'control') {
    body = (
      <Suspense fallback={fallback}>
        <LazyControl project={project} onAnnotate={() => doc.reload()} setTab={(t) => goStage(t)}
          presence={{ users, locks }} onDeleted={() => navigate('/app')} />
      </Suspense>
    );
  } else if (stage === 'pico') {
    body = (
      <Suspense fallback={fallback}>
        <LazyPico project={project} activeId={projectId} updNested={doc.updNested} upd={doc.upd}
          lockCtx={{ pid: spId, myUserId: user?.id, locks }} />
      </Suspense>
    );
  } else if (stage === 'prospero') {
    body = (<Suspense fallback={fallback}><LazyProtocol project={project} activeId={projectId} upd={doc.upd} /></Suspense>);
  } else if (stage === 'search') {
    body = (<Suspense fallback={fallback}><LazySearch project={project} activeId={projectId} updNested={doc.updNested} upd={doc.upd} /></Suspense>);
  } else if (stage === 'discovery') {
    body = (<Suspense fallback={fallback}><LazyDiscovery project={project} activeId={projectId} readOnly={readOnly} /></Suspense>);
  }

  return (
    <StitchAppShell {...shellProps} breadcrumb={breadcrumb}>
      {header}
      {/* The proven editor, harmonized to Stitch via the --t-* token remap. */}
      <div className="stitch-tool-body" style={{ background: S.card, borderRadius: 16, border: `1px solid ${salpha(S.outlineVariant, 0.45)}`, padding: 20, minHeight: 400 }}>
        {body}
      </div>
    </StitchAppShell>
  );
}
