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
// 75.md — the Search workflow's numbered stages now live in the WHITE side-menu too.
// The stage list is derived from the SAME pure, React-free source of truth the in-body
// SearchWorkspace uses (mode-scoped: automated drops Database Strategies), so the two
// surfaces can never drift. Pure data + a pure function → safe to import into this
// React-free nav module.
import { stagesFor as searchStagesFor } from '../../../features/searchWorkspace/searchStages.js';

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

/**
 * 75.md — deep-link a Search WORKFLOW STAGE within the unified Stitch workspace. The
 * host route is `?tab=search`; the staged SearchWorkspace reads `?stage=<id>` back off
 * the URL for its active stage (a collision-free param — the host owns `?tab=`), so the
 * white side-menu, deep links and browser back/forward all resolve to the same stage.
 * Mirrors `screeningSubHref` (the proven param-carrying-submenu-href precedent).
 * ctx = { projectId }.
 */
export function searchStageHref(stageId, ctx = {}) {
  const pid = encodeURIComponent(ctx.projectId || '');
  const id = encodeURIComponent(stageId || 'question');
  return `/app/project/${pid}?tab=search&stage=${id}`;
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

/** Which project stage id is active for the project route's `?tab=`/path.
 *  prompt60 — the former `discovery` stage was folded into `search`; old deep links
 *  (?tab=discovery) normalize to `search` here so they resolve to the unified Search
 *  wizard instead of falling through to the overview (or 404). */
export function activeProjectStage(search) {
  if (typeof search !== 'string' || !search) return 'overview';
  try {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const tab = qs.get('tab');
    if (tab === 'discovery') return 'search';
    return tab || 'overview';
  } catch {
    return 'overview';
  }
}

/** Parse the screening sub-page (`?screen=`) — only meaningful while tab=screening. */
export function readScreenParam(search) {
  if (typeof search !== 'string' || !search) return 'overview';
  try {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return qs.get('screen') || 'overview';
  } catch {
    return 'overview';
  }
}

/** 75.md — parse the Search workflow stage (`?stage=`) — only meaningful while
 *  tab=search. Bare `?tab=search` (no stage) defaults to the first stage ('question'). */
export function readSearchStageParam(search) {
  if (typeof search !== 'string' || !search) return 'question';
  try {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return qs.get('stage') || 'question';
  } catch {
    return 'question';
  }
}

/* ─── 7. PROJECT CATEGORY MODEL (55.md) ────────────────────────────────────────
   55.md restructures the purple rail to show ONLY 9 top-level CATEGORIES; a
   category with children reveals a persistent white submenu beside the rail.
   Categories are derived from the SAME legacy TABS/PHASES truth (no new routes):
   - overview / control / reference are single destinations (no submenu);
   - the six workflow PHASES (Plan…Report) become categories whose children are
     their TABS;
   - 'screen' is special — its submenu is the screening sub-workflow
     (SCREENING_SUBNAV) plus the PRISMA Flow page.
   Pure + unit-testable; every existing export stays back-compatible. */

/** Phase → category id (the 6 workflow phases map 1:1 to a category). */
const PHASE_TO_CATEGORY = { Plan: 'plan', Search: 'search', Screen: 'screen', Extract: 'extract', Analyze: 'analyze', Report: 'report' };

/** The 9 categories shown in the purple rail, in workflow order. */
export const PROJECT_CATEGORIES = [
  { id: 'overview',  label: 'Overview',         icon: 'home',     kind: 'overview',  stage: 'overview' },
  { id: 'control',   label: 'Project Control',  icon: 'sliders',  kind: 'control',   stage: 'control' },
  { id: 'plan',      label: 'Plan & Protocol',  icon: 'target',   kind: 'phase',     phase: 'Plan' },
  { id: 'search',    label: 'Search',           icon: 'search',   kind: 'phase',     phase: 'Search' },
  { id: 'screen',    label: 'Screen',           icon: 'filter',   kind: 'screen',    phase: 'Screen' },
  { id: 'extract',   label: 'Extract',          icon: 'table',    kind: 'phase',     phase: 'Extract' },
  { id: 'analyze',   label: 'Analyze',          icon: 'sigma',    kind: 'phase',     phase: 'Analyze' },
  { id: 'report',    label: 'Report',           icon: 'fileText', kind: 'phase',     phase: 'Report' },
  { id: 'reference', label: 'Reference',        icon: 'bookOpen', kind: 'reference', stage: 'methods' },
];

export const PROJECT_CATEGORY_IDS = PROJECT_CATEGORIES.map((c) => c.id);
const CATEGORY_BY_ID = PROJECT_CATEGORIES.reduce((m, c) => { m[c.id] = c; return m; }, {});

/** Which category a workflow stage id belongs to (route → active category). */
export function categoryForStage(stageId) {
  if (stageId === 'discovery') stageId = 'search'; // prompt60 — folded into Search
  if (!stageId || stageId === 'overview') return 'overview';
  if (stageId === 'control') return 'control';
  if (stageId === 'methods') return 'reference';
  if (stageId === 'living') return 'search'; // 66.md P6 — Living Review lives in Search
  if (stageId === 'citation') return 'search'; // P15 — Citation Mining lives in Search
  if (stageId === 'screening' || stageId === 'prisma') return 'screen';
  const t = TABS.find((x) => x.id === stageId);
  if (t && t.phase && PHASE_TO_CATEGORY[t.phase]) return PHASE_TO_CATEGORY[t.phase];
  return 'overview'; // unknown stage → overview (deep links never break)
}

/* 75.md — icons for the Search workflow's numbered stages. (Numbered StepRows show the
   pip NUMBER, not the icon, so these are cosmetic/shape-only; the un-numbered optional
   tools below use their real TABS icons.) */
const SEARCH_STAGE_ICONS = {
  question: 'target', concepts: 'layers', terms: 'bookOpen', mode: 'settings',
  strategy: 'database', refine: 'barChart', results: 'globe', documentation: 'fileText', screening: 'arrowRight',
};

/**
 * 75.md — the Search category's white submenu: the Search WORKFLOW (stages 1..N, from
 * the SAME mode-scoped `stagesFor` the in-body workspace uses — so automated drops
 * Database Strategies) as numbered children deep-linking `?tab=search&stage=<id>`,
 * followed by a VISUALLY-SEPARATE "Optional tools" group (Living Review + Citation
 * Mining). The optional tools carry `utility: true` so the stepper renders them as
 * UN-numbered rows that NEVER join the 1..N numbering or any progress denominator; the
 * first one carries `groupLabel` so the stepper draws a labelled separator before it.
 * Citation Mining is appended ONLY when `ctx.citationMiningEnabled` (flag OFF ⇒ no new
 * tab). `ctx.searchMode` ('manual'|'automated'|null) is threaded by the subnav; when it
 * is absent we default to the full manual list (robust — existing projects keep working).
 */
function searchSubmenu(ctx = {}) {
  const stageItems = searchStagesFor(ctx.searchMode).map((s) => ({
    key: s.id,
    label: s.label,
    icon: SEARCH_STAGE_ICONS[s.id] || 'search',
    href: searchStageHref(s.id, ctx),
    completionKey: null, // no per-stage completion truth in the pure nav layer
    countKey: null,
    screening: false,
    desc: s.desc || null,
    stage: s.id,
  }));

  // Optional tools — un-numbered utility rows, visually separated from the workflow.
  const tools = [];
  const living = TABS.find((t) => t.id === 'living');
  if (living) {
    tools.push({
      key: 'living', label: living.label, icon: living.icon,
      href: projectStageHref('living', ctx), completionKey: 'living', countKey: null, screening: false, utility: true,
    });
  }
  // P15 — Citation Mining joins ONLY when the flag is ON (absent/false ⇒ unchanged).
  const citation = ctx.citationMiningEnabled ? TABS.find((t) => t.id === 'citation') : null;
  if (citation) {
    tools.push({
      key: 'citation', label: citation.label, icon: citation.icon,
      href: projectStageHref('citation', ctx), completionKey: 'citation', countKey: null, screening: false, utility: true,
    });
  }
  if (tools.length) tools[0].groupLabel = 'Optional tools'; // section header before the first tool

  return [...stageItems, ...tools];
}

/**
 * Ordered child descriptors for a category's white submenu, or null when the
 * category has no submenu (overview / control / single-destination reference).
 * Each child: { key, label, icon, href|null, completionKey, countKey, screening?,
 * utility?, groupLabel?, desc?, stage? }. `href` is null when the destination is
 * unavailable (e.g. screening sub-pages with no linked workspace) → the submenu renders
 * it disabled. `utility:true` marks an UN-numbered row (Search's optional tools);
 * `groupLabel` marks the start of a visually-separate group.
 * ctx = { projectId, linkedSiftId, searchMode?, citationMiningEnabled? }.
 */
export function submenuForCategory(categoryId, ctx = {}) {
  const cat = CATEGORY_BY_ID[categoryId];
  if (!cat) return null;
  if (cat.kind === 'overview' || cat.kind === 'control') return null;
  if (cat.kind === 'reference') return null; // single destination → no submenu

  // 75.md — Search's submenu IS the mode-scoped Search workflow + optional tools.
  if (cat.id === 'search') return searchSubmenu(ctx);

  if (cat.kind === 'screen') {
    // The screening sub-workflow (import → export, from SCREENING_SUBNAV) followed
    // by the PRISMA Flow page (a screening output that lives at ?tab=prisma).
    const screeningItems = SCREENING_SUBNAV.map((s) => ({
      key: s.key,
      label: s.label,
      icon: s.icon,
      href: screeningSubHref(s.key, ctx),
      completionKey: s.step,
      countKey: s.count,
      screening: true,
    }));
    const prismaTab = TABS.find((t) => t.id === 'prisma');
    screeningItems.push({
      key: 'prisma',
      label: prismaTab ? prismaTab.label : 'PRISMA Flow',
      icon: prismaTab ? prismaTab.icon : 'flow',
      href: projectStageHref('prisma', ctx),
      completionKey: 'prisma',
      countKey: null,
      screening: false,
    });
    return screeningItems;
  }

  // A workflow phase → its TABS, in order. (Search is handled above via searchSubmenu.)
  return TABS.filter((t) => t.phase === cat.phase).map((t) => ({
    key: t.id,
    label: t.label,
    icon: t.icon,
    href: projectStageHref(t.id, ctx),
    completionKey: t.id,
    countKey: null,
    screening: false,
  }));
}

/** True when a category opens a persistent white submenu (has >1 navigable child). */
export function categoryShowsSubmenu(categoryId) {
  const items = submenuForCategory(categoryId, { projectId: 'x', linkedSiftId: 'y' });
  return Array.isArray(items) && items.length > 1;
}

/**
 * The active submenu child key for the current route within its category.
 * For 'screen', the active child is the `?screen=` sub-page (or 'prisma' when
 * tab=prisma); for 'search', it is the `?stage=` workflow stage (bare ?tab=search →
 * 'question'); Living Review / Citation Mining open their own tabs so match their key
 * directly; for every other category it is the active stage id.
 */
export function activeSubmenuKey(search) {
  const stage = activeProjectStage(search);
  if (stage === 'prisma') return 'prisma';
  if (stage === 'screening') return readScreenParam(search);
  if (stage === 'search') return readSearchStageParam(search); // 75.md — the Search workflow sub-stage
  return stage;
}

/**
 * The destination a category's rail button navigates to (its "entry" page).
 * Single-destination categories go straight to their page; multi-child categories
 * go to their first/host stage (the workspace then reveals the white submenu).
 * For 'screen' this is the screening host tab (?tab=screening) which always works —
 * the embedded engine handles its own sub-nav + the "no linked workspace" state.
 */
const CATEGORY_ENTRY_STAGE = {
  overview: 'overview', control: 'control', plan: 'pico', search: 'search',
  screen: 'screening', extract: 'extraction', analyze: 'analysis', report: 'grade', reference: 'methods',
};

export function categoryEntryHref(categoryId, ctx = {}) {
  const stage = CATEGORY_ENTRY_STAGE[categoryId] || 'overview';
  return projectStageHref(stage, ctx);
}

/**
 * The raw per-stage statuses (from `stepStatus()`) for the workflow stages a
 * category owns — used to roll a category up to one status glyph in the rail.
 * Empty for non-workflow categories (overview/control/reference).
 */
export function categoryStageStatuses(categoryId, statusMap = {}) {
  const cat = CATEGORY_BY_ID[categoryId];
  if (!cat || !cat.phase) return [];
  return TABS.filter((t) => t.phase === cat.phase).map((t) => statusMap[t.id]).filter(Boolean);
}

/** Build the full category nav (the 9 rail buttons + resolved active category). */
export function buildCategoryNav(search) {
  const stage = activeProjectStage(search);
  const activeCategory = categoryForStage(stage);
  return { categories: PROJECT_CATEGORIES, activeCategory, activeStage: stage };
}

/* ─── 8. NAV GROUPING + back-to-projects (56.md §7/§8) ─────────────────────────
   56.md asks the rail to communicate grouping with separators between
   conceptual sections, and to render the core research workflow as an ordered
   vertical stepper. The grouping is pure data so the rail, the (future)
   breadcrumb, and the tests all agree on ONE structure:
     · Project Management — Overview, Project Control      (orientation/admin)
     · Research Workflow  — Plan…Report                    (the ordered stepper)
     · Project Resources  — Reference                      (supporting material)
   A separator is drawn BETWEEN groups (so one appears between Project Control
   and Plan & Protocol, and another between Report and Reference — matching the
   conceptual break 55.md already drew before Reference). */
export const PROJECT_NAV_GROUPS = [
  { id: 'manage',    label: 'Project Management', categoryIds: ['overview', 'control'], stepper: false },
  { id: 'workflow',  label: 'Research Workflow',  categoryIds: ['plan', 'search', 'screen', 'extract', 'analyze', 'report'], stepper: true },
  { id: 'resources', label: 'Project Resources',  categoryIds: ['reference'], stepper: false },
];

/**
 * The rail's category groups, each resolved to its category objects. Categories
 * in the `stepper` group carry a 1-based `stepNum` (the ordered Plan→Report
 * workflow position); non-stepper categories carry stepNum=null. This is the
 * single source the rail renders — separators sit between groups, and the
 * workflow group draws stepper connectors between consecutive steps.
 */
export function buildRailGroups() {
  return PROJECT_NAV_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    stepper: g.stepper,
    categories: g.categoryIds
      .map((id) => CATEGORY_BY_ID[id])
      .filter(Boolean)
      .map((cat, i) => ({ ...cat, stepNum: g.stepper ? i + 1 : null })),
  }));
}

/** Total number of ordered workflow steps in the main rail stepper (Plan→Report). */
export function railWorkflowStepCount() {
  const g = PROJECT_NAV_GROUPS.find((x) => x.stepper);
  return g ? g.categoryIds.length : 0;
}

/**
 * 56.md §8 "Back to Projects" — the destination is the dashboard projects
 * surface, linked DIRECTLY (never history.back(), never an unrelated project).
 * The dashboard's default view IS the workspace/projects overview.
 */
export function projectsHref() { return '/app'; }
