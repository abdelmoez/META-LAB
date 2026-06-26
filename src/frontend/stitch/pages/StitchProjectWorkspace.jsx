/**
 * StitchProjectWorkspace.jsx — the ONE native Stitch project workspace router
 * (design3.md → design4.md). Mounted on the /app/project/:id stitch route; it reads
 * `?tab=` and renders the project overview OR any project workflow stage inside ONE
 * shared Stitch project shell. design4.md: EVERY engine — Project Control, PICO,
 * Protocol, Search Builder, Search Discovery, Screening, Risk of Bias, Data
 * Extraction, Meta-analysis (+ Forest / Sensitivity / Subgroup), PRISMA, GRADE,
 * Manuscript, Reports/Export and the Methods reference — now renders here, so no
 * stage ever escapes to a standalone engine shell (`/sift-beta`, `/rob`) or the
 * classic monolith (`?ui=legacy`). The user never feels they left PecanRev.
 *
 * Backend engines stay SEPARATE: each stage mounts its OWN proven engine component
 * (the exact same component the legacy Workspace.jsx orchestrator renders, with the
 * exact same props) talking to its own APIs/service. We only swap the surrounding
 * chrome — the collapsible workflow rail, a project page header (breadcrumb + stage
 * title + live online-member presence + next-step), shared loading/error/permission
 * states, and the one shared export dialog. State flows through the SAME backend
 * (the `Project.data` blob via `useStitchProjectDoc`, or each tool's own server
 * module) — ZERO data duplication; edits show identically in the legacy UI.
 *
 * The screening engine and an open RoB assessment are "full-bleed" (a study list +
 * detail / PDF + assessment split need the full height), so for those stages the
 * page header collapses to a slim bar and the engine fills the viewport with its own
 * internal scroll — exactly like the legacy workspace's `inScreening`/`robFullbleed`.
 *
 * Heavy editor bodies are lazy-imported (code-split). `?tab=` is parsed from
 * `useLocation().search` (not `useSearchParams`, which the SSR test mock omits).
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useProjectPresence } from '../../screening/hooks/usePresence.js';
import PresenceIndicator from '../../screening/components/PresenceIndicator.jsx';
import { linkedSiftId, projectPerms, stepStatus, TABS } from '../../workspace/projectHelpers.js';
import { registerExportDialog } from '../../workspace/exportDialogBridge.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import StitchProjectRail from '../shell/StitchProjectRail.jsx';
import StitchProjectOverview from './StitchProjectOverview.jsx';
import { useStitchProjectDoc } from '../shell/useStitchProjectDoc.js';
import { activeProjectStage, projectStageHref } from '../nav/navConfig.js';
import {
  StitchLoadingState, StitchErrorState, StitchButton, StitchBadge, S, salpha,
} from '../primitives';

/* ── Lazy editor bodies — the proven legacy/feature components, code-split. Each is
   the SAME component the legacy Workspace.jsx renders for that tab, so parity is
   guaranteed; they are harmonized to Stitch via the design2 `--t-*` token remap. ── */
const LazyControl     = lazy(() => import('../../workspace/tabs/overviewTabs.jsx').then((m) => ({ default: m.ControlTab })));
const LazyScreening   = lazy(() => import('../../workspace/tabs/overviewTabs.jsx').then((m) => ({ default: m.ScreeningWorkspaceFrame })));
const LazyPico        = lazy(() => import('../../workspace/tabs/protocolTabs.jsx').then((m) => ({ default: m.PICODispatcher })));
const LazyProtocol    = lazy(() => import('../../../features/planProtocol/index.js').then((m) => ({ default: m.PlanProtocolDispatcher })));
const LazySearch      = lazy(() => import('../../workspace/tabs/protocolTabs.jsx').then((m) => ({ default: m.SearchDispatcher })));
const LazyDiscovery   = lazy(() => import('../../workspace/tabs/protocolTabs.jsx').then((m) => ({ default: m.DiscoveryDispatcher })));
const LazyPrisma      = lazy(() => import('../../workspace/tabs/screeningTabs.jsx').then((m) => ({ default: m.PRISMATab })));
const LazyExtraction  = lazy(() => import('../../workspace/tabs/extractionTabs.jsx').then((m) => ({ default: m.ExtractionTab })));
const LazyRob         = lazy(() => import('../../workspace/tabs/robTabs.jsx').then((m) => ({ default: m.RoBTab })));
const LazyAnalysis    = lazy(() => import('../../workspace/tabs/analysisTabs.jsx').then((m) => ({ default: m.AnalysisTab })));
const LazyForest      = lazy(() => import('../../workspace/tabs/analysisTabs.jsx').then((m) => ({ default: m.ForestTab })));
const LazySensitivity = lazy(() => import('../../workspace/tabs/analysisTabs.jsx').then((m) => ({ default: m.SensitivityTab })));
const LazySubgroup    = lazy(() => import('../../workspace/tabs/analysisTabs.jsx').then((m) => ({ default: m.SubgroupTab })));
const LazyGrade       = lazy(() => import('../../workspace/tabs/reportTabs.jsx').then((m) => ({ default: m.GRADETab })));
const LazyManuscript  = lazy(() => import('../../workspace/tabs/reportTabs.jsx').then((m) => ({ default: m.ManuscriptTab })));
const LazyReport      = lazy(() => import('../../workspace/tabs/reportTabs.jsx').then((m) => ({ default: m.ReportTab })));
const LazyMethods     = lazy(() => import('../../workspace/tabs/reportTabs.jsx').then((m) => ({ default: m.MethodsTab })));
const LazyExportDialog = lazy(() => import('../../components/ExportDialog.jsx'));

// Every workflow stage that has a native page here. Anything not in this set falls
// through to the (already native) project overview, so deep links never break.
const SCOPE = new Set([
  'control', 'pico', 'prospero', 'search', 'discovery', 'screening', 'prisma',
  'extraction', 'rob', 'analysis', 'forest', 'sensitivity', 'subgroup', 'grade',
  'manuscript', 'report', 'methods',
]);
const STAGE_LABEL = TABS.reduce((m, t) => { m[t.id] = t.label; return m; }, {});
// Workflow order (the legacy stepper order) → used for the next-step action.
const WORKFLOW_IDS = TABS.filter((t) => t.phase).map((t) => t.id);

function nextStageId(stage) {
  if (stage === 'methods') return null; // reference page — not part of the workflow
  const i = WORKFLOW_IDS.indexOf(stage);
  if (i === -1) return 'pico'; // Project Control → start of the workflow
  return WORKFLOW_IDS[i + 1] || null;
}

export default function StitchProjectWorkspace() {
  const { search } = useLocation();
  const stage = activeProjectStage(search);
  if (!SCOPE.has(stage)) return <StitchProjectOverview />;
  return <DeepToolPage stage={stage} />;
}

function DeepToolPage({ stage }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const doc = useStitchProjectDoc(projectId);
  const project = doc.project;

  // The one shared ExportDialog (prompt9 plumbing): deep tools open it via the
  // module-level openExportDialog() trampoline. Register OUR opener so every export
  // button (Analysis / Report / PRISMA / journal ZIP …) works inside the Stitch
  // shell exactly as it does in the legacy workspace.
  const [expItem, setExpItem] = useState(null);
  useEffect(() => registerExportDialog(setExpItem), []);

  // True while a per-study RoB assessment is open (the split view needs full height).
  const [robInWorkspace, setRobInWorkspace] = useState(false);

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

  // Full-bleed stages: screening (study list + detail) always; RoB only while a
  // per-study assessment is open (PDF + assessment split). These fill the viewport.
  const fullbleed = stage === 'screening' || (stage === 'rob' && robInWorkspace);

  const renderPrimaryRail = (variant) => (
    <StitchProjectRail projectId={projectId} linkedSiftId={spId} statusMap={statusMap}
      activeStage={stage} variant={variant === 'mobile' ? 'static' : 'overlay'} />
  );
  const shellProps = {
    activeKey: 'dashboard', renderPrimaryRail, contextRail: null, contextRailMobile: null,
    maxWidth: fullbleed ? 100000 : 1560, contentPad: !fullbleed,
  };

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

  // ── the page header content (native Stitch chrome around the proven editor) ──
  const headerRow = (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: fullbleed ? 18 : 24, fontWeight: 700, letterSpacing: '-0.02em', color: S.textPrimary, margin: 0 }}>{STAGE_LABEL[stage]}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: fullbleed ? 4 : 8, flexWrap: 'wrap' }}>
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

  // Each stage mounts its proven engine component with the EXACT props the legacy
  // Workspace.jsx orchestrator passes — guaranteeing behavioural parity.
  let body = null;
  if (stage === 'control') {
    body = (<LazyControl project={project} onAnnotate={() => doc.reload()} setTab={goStage}
      presence={{ users, locks }} onDeleted={() => navigate('/app')} />);
  } else if (stage === 'screening') {
    body = (<LazyScreening project={project} setTab={goStage} />);
  } else if (stage === 'pico') {
    body = (<LazyPico project={project} activeId={projectId} updNested={doc.updNested} upd={doc.upd}
      lockCtx={{ pid: spId, myUserId: user?.id, locks }} />);
  } else if (stage === 'prospero') {
    body = (<LazyProtocol project={project} activeId={projectId} upd={doc.upd} />);
  } else if (stage === 'search') {
    body = (<LazySearch project={project} activeId={projectId} updNested={doc.updNested} upd={doc.upd} />);
  } else if (stage === 'discovery') {
    body = (<LazyDiscovery project={project} activeId={projectId} readOnly={readOnly} />);
  } else if (stage === 'prisma') {
    body = (<LazyPrisma project={project} updNested={doc.updNested} updateProject={doc.updateProject} activeId={projectId} setTab={goStage} />);
  } else if (stage === 'extraction') {
    body = (<LazyExtraction project={project} updateProject={doc.updateProject} activeId={projectId} />);
  } else if (stage === 'rob') {
    body = (<LazyRob project={project} updateProject={doc.updateProject} activeId={projectId} setTab={goStage} onWorkspaceChange={setRobInWorkspace} />);
  } else if (stage === 'analysis') {
    body = (<LazyAnalysis project={project}
      updateProject={(fn) => doc.updateProject(projectId, fn)}
      onApplyPrecisionToAll={(prec) => doc.updateProject(projectId, (x) => ({ ...x, analysisPrecision: prec }))} />);
  } else if (stage === 'forest') {
    body = (<LazyForest project={project} />);
  } else if (stage === 'sensitivity') {
    body = (<LazySensitivity project={project} />);
  } else if (stage === 'subgroup') {
    body = (<LazySubgroup project={project} />);
  } else if (stage === 'grade') {
    body = (<LazyGrade project={project} upd={doc.upd} />);
  } else if (stage === 'manuscript') {
    body = (<LazyManuscript project={project} upd={doc.upd} />);
  } else if (stage === 'report') {
    body = (<LazyReport project={project} upd={doc.upd} />);
  } else if (stage === 'methods') {
    body = (<LazyMethods />);
  }

  // The body wrapper keeps the SAME DOM position whether full-bleed or carded, so
  // toggling RoB's full-bleed state never remounts the engine (no state churn).
  const wrapperStyle = fullbleed
    ? { height: 'calc(100vh - 57px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
    : undefined;
  const headerWrapStyle = fullbleed
    ? { padding: '10px 20px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.45)}`, flexShrink: 0 }
    : { marginBottom: 20 };
  const bodyWrapStyle = fullbleed
    ? { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
    : { background: S.card, borderRadius: 16, border: `1px solid ${salpha(S.outlineVariant, 0.45)}`, padding: 20, minHeight: 400 };

  return (
    <StitchAppShell {...shellProps} breadcrumb={breadcrumb}>
      <div style={wrapperStyle}>
        <div style={headerWrapStyle}>{headerRow}</div>
        <div className={fullbleed ? undefined : 'stitch-tool-body'} style={bodyWrapStyle}>
          <Suspense fallback={fallback}>{body}</Suspense>
        </div>
      </div>
      {/* One shared export dialog, mounted for the whole workspace. */}
      <Suspense fallback={null}>
        <LazyExportDialog open={!!expItem} onClose={() => setExpItem(null)} item={expItem}
          precision={(project && project.analysisPrecision) || undefined} />
      </Suspense>
    </StitchAppShell>
  );
}
