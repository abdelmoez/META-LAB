/**
 * navConfig.js — the ONE centralized navigation model for the Stitch experience.
 *
 * design2.md Part 7 ("Navigation architecture and routing") asks for a single
 * typed-ish configuration rather than nav arrays hard-coded across components.
 * Everything the Stitch chrome renders — the global purple rail, the dashboard
 * white-column menu, the project workflow rail, and the contextual sub-navigation
 * — is derived from THIS file, so legacy and Stitch can never silently drift and
 * there is exactly one place that knows "what are the project's workflow stages".
 *
 * SOURCE OF TRUTH: the project workflow stages are derived from the legacy
 * `TABS`/`PHASES` (src/frontend/workspace/projectHelpers.js) — the same arrays the
 * classic sidebar renders — so the order, labels, icons, phases and per-step
 * status all match the legacy application exactly (design2.md Part 5/12: "rely on
 * the same underlying workflow truth"). We do NOT re-invent stage names here.
 *
 * ROUTING CONTRACT (design4.md "Unified application shell"): every project workflow
 * stage opens INSIDE the one shared Stitch project workspace at
 * `/app/project/:id?tab=<stage>` (overview is the bare project route). No stage
 * escapes to a standalone engine route (`/sift-beta`, `/rob`) or to the classic
 * monolith (`?ui=legacy`). The engines stay separate at the backend/service level
 * (each tab mounts its own engine component + APIs), but the rail communicates one
 * integrated research workflow — same shell, same header, same presence — and every
 * route, permission and piece of state is preserved.
 *
 * Pure module: no React, no DOM. Trivially unit-testable.
 */
import { TABS, PHASES, phaseLabel, PHASE_ICON } from '../../workspace/projectHelpers.js';

/* ─── 1. GLOBAL purple-rail destinations (app-level, shown on every Stitch page) ─
   design2.md Part 1: the purple rail holds ONLY global, application-level
   destinations — never standalone engine launchers. Dashboard is the primary
   destination; the rest are real cross-project surfaces backed by existing data
   (Activity = the notification stream, Invitations = PROJECT_INVITE events, Help =
   the existing contact pipeline). They live as views of the dashboard hub. */
export const GLOBAL_NAV = [
  { key: 'dashboard',   label: 'Dashboard',   icon: 'grid',  view: 'overview',    tip: 'Workspace dashboard' },
  { key: 'activity',    label: 'Activity',    icon: 'clock', view: 'activity',    tip: 'Recent activity across your projects' },
  { key: 'invitations', label: 'Invitations', icon: 'mail',  view: 'invitations', tip: 'Project invitations & collaboration', badgeKey: 'invitations' },
  { key: 'help',        label: 'Help & Feedback', icon: 'info', view: 'resources', tip: 'Help, documentation & feedback' },
];

/** Route a global destination resolves to (the dashboard hub + a view param). */
export function globalHref(item) {
  return item.view === 'overview' ? '/app' : `/app?view=${encodeURIComponent(item.view)}`;
}

/* ─── 2. Dashboard white-column menu (workspace-level views) ───────────────────
   design2.md "Replacement dashboard menu": a useful workspace menu — NOT a
   duplicated project list. Each item is a real, data-backed view of the dashboard
   (no empty placeholder pages). "Recent Activity" is intentionally MERGED into the
   global Activity destination above (design2.md gives this latitude) to avoid two
   doors to the same surface. Archived is real (projects carry an archived flag).
   Resources is the low-emphasis lower section (help/docs/feedback). */
export const DASHBOARD_MENU = [
  { key: 'overview',    label: 'Workspace Overview', icon: 'grid',        view: 'overview',    section: 'primary',
    desc: 'Projects, progress and workspace summary' },
  { key: 'mywork',      label: 'My Work',            icon: 'checkSquare', view: 'mywork',      section: 'primary',
    desc: 'Work that needs your attention across projects' },
  { key: 'invitations', label: 'Invitations',        icon: 'mail',        view: 'invitations', section: 'primary',
    desc: 'Pending invitations & collaboration', badgeKey: 'invitations' },
  { key: 'archived',    label: 'Archived Projects',  icon: 'layers',      view: 'archived',    section: 'primary',
    desc: 'Projects you have archived' },
  { key: 'resources',   label: 'Resources',          icon: 'bookOpen',    view: 'resources',   section: 'resources',
    desc: 'Help, documentation & feedback' },
];

/** The full set of valid dashboard view keys (URL `?view=`). */
export const DASHBOARD_VIEWS = ['overview', 'mywork', 'activity', 'invitations', 'archived', 'resources'];
export const DEFAULT_DASHBOARD_VIEW = 'overview';

export function normalizeDashboardView(v) {
  return DASHBOARD_VIEWS.includes(v) ? v : DEFAULT_DASHBOARD_VIEW;
}

export function dashboardHref(view) {
  const v = normalizeDashboardView(view);
  return v === DEFAULT_DASHBOARD_VIEW ? '/app' : `/app?view=${encodeURIComponent(v)}`;
}

/* ─── 3. PROJECT workflow navigation (purple project rail) ─────────────────────
   Derived 1:1 from the legacy TABS so order/labels/icons/phases match the classic
   application. `kind` decides how the stage opens (see ROUTING CONTRACT above). */

// design4.md "Unified application shell": EVERY project workflow stage now renders
// inside the ONE shared Stitch project workspace (StitchProjectWorkspace) via the
// `?tab=` route — there is no longer a stage that escapes to a standalone engine
// shell (`/sift-beta`, `/rob`) or to the classic monolith (`?ui=legacy`). The
// engines stay SEPARATE at the backend/service level (each tab mounts its own
// proven engine component + APIs), but from the user's perspective screening, RoB,
// extraction, meta-analysis, PRISMA and reporting are all native parts of the same
// PecanRev application: same rail, same header, same presence, no "back to the main
// app" trip. `kind` is therefore 'stitch' for everything (overview is the bare
// project route; all other stages carry ?tab=<id>).
function stageKind() { return 'stitch'; }

/** A single project stage descriptor used by the rail + contextual nav. */
function toStage(t) {
  return {
    id: t.id,
    label: t.label,
    icon: t.icon,
    phase: t.phase || null,
    num: t.num || null,
    group: t.group || (t.phase ? 'workflow' : null),
    kind: stageKind(),
  };
}

/** The project rail buckets, in the exact order the legacy sidebar shows them. */
export function buildProjectNav() {
  const project = TABS.filter((t) => t.group === 'project').map(toStage); // Overview, Project Control
  const reference = TABS.filter((t) => t.group === 'reference').map(toStage); // Methods & Equations
  const phases = PHASES.map((phase) => ({
    phase,
    label: phaseLabel(phase),
    icon: PHASE_ICON[phase],
    steps: TABS.filter((t) => t.phase === phase).map(toStage),
  }));
  // A single flat, ordered list (Overview, Control, …all workflow steps…, Methods)
  // for active-route matching + the collapsed rail.
  const flat = [...project, ...phases.flatMap((p) => p.steps), ...reference];
  return { project, phases, reference, flat };
}

/** Count of workflow steps (the progress denominator the legacy stepper uses). */
export function workflowStepCount() {
  return TABS.filter((t) => t.phase).length;
}

/**
 * The canonical destination for a project stage — ALWAYS the unified Stitch project
 * workspace (design4.md). Overview is the bare project route; every other stage
 * (including screening, RoB, extraction, meta-analysis, PRISMA, reporting) carries
 * `?tab=<id>` so StitchProjectWorkspace renders it natively inside the one shared
 * shell. No stage escapes to a standalone engine route or `?ui=legacy`.
 * ctx = { projectId }.
 */
export function projectStageHref(stage, ctx = {}) {
  const pid = encodeURIComponent(ctx.projectId || '');
  const id = typeof stage === 'string' ? stage : stage.id;
  return id === 'overview' ? `/app/project/${pid}` : `/app/project/${pid}?tab=${encodeURIComponent(id)}`;
}

/* ─── 4. Screening contextual sub-navigation (the white column stepper) ────────
   design2.md Part 6 / design4.md: the canonical screening subpages, in order. These
   now open the screening engine EMBEDDED in the unified Stitch workspace
   (`/app/project/:id?tab=screening&screen=<key>`) — the embedded SiftProject reads
   the `?screen=` param for its own sub-navigation, so a contextual item opens the
   real screening page without ever leaving the PecanRev shell. `count` ties each to
   a live number from screeningApi.getOverview(...).dataSummary (only the middle
   steps carry counts). `step` is the screeningSteps.js id used for status. */
export const SCREENING_SUBNAV = [
  { key: 'overview',      label: 'Overview',          icon: 'grid',        step: null,            count: null },
  { key: 'import',        label: 'Import',            icon: 'upload',      step: 'import',        count: 'totalArticles' },
  { key: 'duplicates',    label: 'Duplicates',        icon: 'copy',        step: 'duplicates',    count: 'unresolvedDuplicateGroups' },
  { key: 'screening',     label: 'Title & Abstract',  icon: 'filter',      step: 'screening',     count: 'titleAbstractPending' },
  { key: 'conflicts',     label: 'Conflicts',         icon: 'alert',       step: 'conflicts',     count: 'unresolvedConflicts' },
  { key: 'second-review', label: 'Final Review',      icon: 'checkSquare', step: 'second-review', count: 'eligibleSecondReview' },
  { key: 'control',       label: 'Settings',          icon: 'sliders',     step: null,            count: null },
  { key: 'export',        label: 'Export',            icon: 'download',    step: null,            count: null },
];

/**
 * Deep-link a screening subpage WITHIN the unified Stitch workspace (design4.md).
 * The host route is `?tab=screening`; the embedded screening engine reads `?screen=`
 * for its own sub-navigation (a collision-free param — the host owns `?tab=`).
 * ctx = { projectId, linkedSiftId }. `linkedSiftId` only gates availability (no
 * linked screening workspace yet → null so the stepper item is disabled).
 */
export function screeningSubHref(key, ctx = {}) {
  if (!ctx.linkedSiftId) return null; // no linked screening workspace yet
  const pid = encodeURIComponent(ctx.projectId || '');
  if (!pid) return null;
  return key === 'overview'
    ? `/app/project/${pid}?tab=screening`
    : `/app/project/${pid}?tab=screening&screen=${encodeURIComponent(key)}`;
}

/* ─── 5. Active-route matching (design2.md "Preserve deep links") ─────────────── */

/** Which global rail key is active for a given pathname + search. */
export function activeGlobalKey(pathname, search) {
  // Anything under a project is "dashboard" context for the global rail.
  if (pathname.startsWith('/app/project/')) return 'dashboard';
  if (pathname.startsWith('/app')) {
    const view = readView(search);
    const hit = GLOBAL_NAV.find((g) => g.view === view);
    return hit ? hit.key : 'dashboard'; // dashboard-only views keep Dashboard active
  }
  if (pathname.startsWith('/profile') || pathname.startsWith('/ops')) return null;
  return 'dashboard';
}

/** Parse `?view=` from a search string, normalized. */
export function readView(search) {
  if (typeof search !== 'string' || !search) return DEFAULT_DASHBOARD_VIEW;
  try {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return normalizeDashboardView(qs.get('view'));
  } catch {
    return DEFAULT_DASHBOARD_VIEW;
  }
}

/* ─── 6. Small pure helpers shared by the chrome (unit-testable) ──────────────── */

/**
 * design2.md "Project deletion experience": the destructive action stays disabled
 * until the typed text matches the project name. Whitespace is trimmed (lenient),
 * the comparison is case-SENSITIVE and Unicode-safe (plain string equality), and an
 * empty name never matches.
 */
export function deleteConfirmMatches(input, name) {
  const a = String(input == null ? '' : input).trim();
  const b = String(name == null ? '' : name).trim();
  return b.length > 0 && a === b;
}

/**
 * design2.md Part 1 welcome message: use the user's first name; never render
 * "Welcome, undefined", an email, or a placeholder — fall back to a graceful
 * "Welcome back" when no display name is available.
 */
export function welcomeGreeting(name) {
  const first = String(name || '').trim().split(/\s+/).filter(Boolean)[0];
  return first && !first.includes('@') ? `Welcome, ${first}` : 'Welcome back';
}

/** Which project stage id is active for the project route's `?tab=`/path. */
export function activeProjectStage(search) {
  if (typeof search !== 'string' || !search) return 'overview';
  try {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const tab = qs.get('tab');
    return tab || 'overview';
  } catch {
    return 'overview';
  }
}
