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
 * ROUTING CONTRACT (design2.md "Preserve deep links"): every destination is an
 * EXISTING route. Deep workflow tools that have no Stitch-native page open in their
 * real engine:
 *   - Screening  → the standalone screening engine  /sift-beta/projects/:linkedId
 *   - Risk of Bias → the standalone RoB workspace    /rob/:projectId
 *   - all other monolith stages → the classic workspace /app/project/:id?ui=legacy&tab=<id>
 * These are labelled by their USER-FACING workflow name — never "classic/legacy
 * view" — so the rail communicates one integrated research workflow while every
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

// How each stage id opens. Screening + RoB have dedicated self-contained engine
// routes (no design flip); every other monolith stage opens the classic workspace
// tab. Overview is the Stitch-native project page.
const STAGE_KIND = {
  overview: 'stitch',     // /app/project/:id  (this very Stitch page)
  screening: 'screening', // standalone screening engine
  rob: 'rob',             // standalone RoB workspace
};
function stageKind(id) { return STAGE_KIND[id] || 'monolith'; }

/** A single project stage descriptor used by the rail + contextual nav. */
function toStage(t) {
  return {
    id: t.id,
    label: t.label,
    icon: t.icon,
    phase: t.phase || null,
    num: t.num || null,
    group: t.group || (t.phase ? 'workflow' : null),
    kind: stageKind(t.id),
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
 * The canonical destination for a project stage.
 * ctx = { projectId, linkedSiftId }.
 * - stitch:    the Stitch overview route (no design flip)
 * - screening: the standalone screening engine (own chrome)
 * - rob:       the standalone RoB workspace
 * - monolith:  the classic workspace tab (?ui=legacy keeps every feature working)
 */
export function projectStageHref(stage, ctx = {}) {
  const pid = encodeURIComponent(ctx.projectId || '');
  const id = typeof stage === 'string' ? stage : stage.id;
  const kind = typeof stage === 'string' ? stageKind(stage) : stage.kind;
  switch (kind) {
    case 'stitch':
      return `/app/project/${pid}`;
    case 'screening':
      return ctx.linkedSiftId ? `/sift-beta/projects/${encodeURIComponent(ctx.linkedSiftId)}` : `/app/project/${pid}?ui=legacy&tab=screening`;
    case 'rob':
      return `/rob/${pid}`;
    default:
      return `/app/project/${pid}?ui=legacy&tab=${encodeURIComponent(id)}`;
  }
}

/* ─── 4. Screening contextual sub-navigation (the white column stepper) ────────
   design2.md Part 6: the canonical EMBEDDED screening subpages, in order. These
   map to the standalone screening engine routes so a contextual item opens the
   real screening page (no design flip). `countKey` ties each to a live number from
   screeningApi.getOverview(...).dataSummary (only the middle steps carry counts).
   `step` is the screeningSteps.js id used for status. */
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
 * Deep-link a screening subpage. Uses the standalone screening engine (own chrome,
 * no design flip). Import has its own route; everything else is a ?tab= value.
 * ctx = { linkedSiftId } (the ScreenProject id) — required for standalone links.
 */
export function screeningSubHref(key, ctx = {}) {
  const lid = ctx.linkedSiftId;
  if (!lid) return null; // no linked screening workspace yet
  const sid = encodeURIComponent(lid);
  if (key === 'import') return `/sift-beta/projects/${sid}/import`;
  return `/sift-beta/projects/${sid}?tab=${encodeURIComponent(key)}`;
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
