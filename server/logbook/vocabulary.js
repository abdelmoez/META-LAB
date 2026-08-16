/**
 * server/logbook/vocabulary.js — 119.md §8. The STABLE event vocabulary of the
 * project Logbook.
 *
 * Pure data + pure functions (no prisma, no express, no DOM) so both the writer
 * (logbookService.js), the reader/union (logbookQuery.js) and the tests resolve
 * the SAME taxonomy. Nothing here performs I/O.
 *
 * Three things live here:
 *  1. The closed enumerations (engines / categories / statuses / actor types / via).
 *  2. LOG_ACTIONS — every action the NEW writer may emit, with its engine,
 *     category, severity and default human-readable summary.
 *  3. The LEGACY BRIDGE maps — how the pre-119 audit stores' action strings
 *     project onto the same engine/category taxonomy, so a bridged row is
 *     filterable exactly like a native one (119.md §8 "engine filter" must work
 *     across the whole timeline, not only post-119 rows).
 *
 * Adding an action: add it to LOG_ACTIONS. An action missing from the registry
 * still writes (the Logbook must never lose an event because someone forgot to
 * register a string) but degrades to engine 'core' / category 'update' — the
 * unit tests assert every action the server emits IS registered.
 */

/** Engines/modules the Logbook groups activity by (119.md §8 "Engine filter"). */
export const LOG_ENGINES = Object.freeze([
  'core',        // project lifecycle, membership, settings
  'protocol',    // PICO / eligibility / registration
  'search',      // search building, execution, import, dedup
  'screening',   // title/abstract + full-text decisions
  'extraction',  // data extraction
  'rob',         // risk of bias
  'analysis',    // meta-analysis configuration + runs
  'manuscript',  // manuscript authoring + export
  'files',       // PDFs, figures, uploads/downloads
  'logbook',     // the Logbook's own access events
]);

/** Coarse action category (119.md §8 "Action category"). */
export const LOG_CATEGORIES = Object.freeze([
  'create', 'update', 'delete', 'run', 'import', 'export',
  'decision', 'access', 'view', 'security',
]);

/** Outcome of the logged operation (119.md §8 "Success, failure, reversal, or restoration"). */
export const LOG_STATUSES = Object.freeze(['success', 'failure', 'reversed', 'restored']);

/** Who/what acted (119.md §8 "User, system, or automation actor type"). */
export const LOG_ACTOR_TYPES = Object.freeze(['user', 'system', 'automation']);

/** How the action reached the server (undo/redo relationship, 119.md §8). */
export const LOG_VIA = Object.freeze(['user', 'undo', 'redo', 'system', 'job', 'api']);

/**
 * Severity 0..5. Used for retention tiering (drop noise first, keep the
 * scientific/security record forever) and for a future "importance" filter.
 * Deliberately NOT the same scale as ProjectEvent.significance (0..6), which
 * classifies SCIENTIFIC impact — this one classifies OPERATIONAL importance.
 */
export const LOG_SEVERITY = Object.freeze({
  NOISE: 0, ROUTINE: 1, NOTABLE: 2, IMPORTANT: 3, SENSITIVE: 4, CRITICAL: 5,
});

const A = (action, engine, category, severity, label) =>
  [action, Object.freeze({ action, engine, category, severity, label })];

/**
 * LOG_ACTIONS — the closed vocabulary of actions the 119.md §8 writer emits.
 * `label` is the default human-readable summary; writers may pass a richer
 * `summary` that wins.
 */
export const LOG_ACTIONS = Object.freeze(Object.fromEntries([
  // ── Project + membership (§8 "Project and membership") ────────────────────
  A('PROJECT_CREATED',             'core', 'create',  LOG_SEVERITY.IMPORTANT, 'Created the project'),
  A('PROJECT_SETTINGS_CHANGED',    'core', 'update',  LOG_SEVERITY.NOTABLE,   'Changed project settings'),
  A('PROJECT_ARCHIVED',            'core', 'update',  LOG_SEVERITY.IMPORTANT, 'Archived the project'),
  A('PROJECT_RESTORED',            'core', 'update',  LOG_SEVERITY.IMPORTANT, 'Restored the project'),
  A('PROJECT_DELETED',             'core', 'delete',  LOG_SEVERITY.CRITICAL,  'Deleted the project'),
  A('MEMBER_ADDED',                'core', 'create',  LOG_SEVERITY.SENSITIVE, 'Added a member'),
  A('MEMBER_REMOVED',              'core', 'delete',  LOG_SEVERITY.SENSITIVE, 'Removed a member'),
  A('MEMBER_LEFT',                 'core', 'delete',  LOG_SEVERITY.IMPORTANT, 'Left the project'),
  A('MEMBER_PERMISSIONS_CHANGED',  'core', 'update',  LOG_SEVERITY.SENSITIVE, 'Changed member permissions'),
  A('INVITE_REVOKED',              'core', 'delete',  LOG_SEVERITY.IMPORTANT, 'Revoked an invitation'),
  A('OWNERSHIP_TRANSFERRED',       'core', 'update',  LOG_SEVERITY.CRITICAL,  'Transferred project ownership'),

  // ── Search (§8 "Search and deduplication") ────────────────────────────────
  A('SEARCH_RUN_STARTED',          'search', 'run', LOG_SEVERITY.NOTABLE,   'Started a database search'),
  A('SEARCH_RUN_COMPLETED',        'search', 'run', LOG_SEVERITY.IMPORTANT, 'Completed a database search'),
  A('SEARCH_RUN_FAILED',           'search', 'run', LOG_SEVERITY.IMPORTANT, 'A database search failed'),
  A('SEARCH_RUN_CANCELLED',        'search', 'run', LOG_SEVERITY.NOTABLE,   'Cancelled a database search'),

  // ── Analysis (§8 "Risk of Bias and Analysis") ─────────────────────────────
  A('ANALYSIS_RUN',                'analysis', 'run', LOG_SEVERITY.NOTABLE,   'Ran an analysis'),
  A('ANALYSIS_RUN_FAILED',         'analysis', 'run', LOG_SEVERITY.IMPORTANT, 'An analysis run failed'),

  // ── Manuscript (§8 "Manuscript") ──────────────────────────────────────────
  // Typing is NOT streamed: an edit session is ONE coalesced row per author per
  // window, carrying the touched sections (§8 "grouped into useful autosave/
  // edit-session events with a readable diff or summary").
  A('MANUSCRIPT_EDIT_SESSION',     'manuscript', 'update', LOG_SEVERITY.ROUTINE, 'Edited the manuscript'),
  A('MANUSCRIPT_EXPORTED',         'manuscript', 'export', LOG_SEVERITY.NOTABLE, 'Exported the manuscript'),
  // 119.md §8 "Figure insertion, replacement, deletion, and editing" — the figure
  // BINARY lifecycle is a file event (it moves bytes), so it lands in the 'files'
  // engine beside PDF upload/download; where a figure SITS in the manuscript is a
  // prose edit and is already covered by MANUSCRIPT_EDIT_SESSION.
  A('FIGURE_UPLOADED',             'files', 'create', LOG_SEVERITY.NOTABLE,   'Uploaded a manuscript figure'),
  A('FIGURE_REPLACED',             'files', 'update', LOG_SEVERITY.NOTABLE,   'Replaced a manuscript figure'),
  A('FIGURE_UPDATED',              'files', 'update', LOG_SEVERITY.ROUTINE,   'Edited manuscript figure details'),
  A('FIGURE_DELETED',              'files', 'delete', LOG_SEVERITY.IMPORTANT, 'Deleted a manuscript figure'),

  // ── Files and exports (§8 "Files and exports") ────────────────────────────
  A('FILE_DOWNLOADED',             'files', 'access', LOG_SEVERITY.ROUTINE,   'Downloaded a file'),
  A('EXPORT_GENERATED',            'core',  'export', LOG_SEVERITY.NOTABLE,   'Generated an export'),
  A('EXPORT_FAILED',               'core',  'export', LOG_SEVERITY.IMPORTANT, 'An export failed'),

  // ── Logbook security (§8 "Logbook security") ──────────────────────────────
  A('LOGBOOK_VIEWED',              'logbook', 'view',     LOG_SEVERITY.ROUTINE,  'Viewed the Logbook'),
  A('LOGBOOK_EXPORTED',            'logbook', 'export',   LOG_SEVERITY.SENSITIVE, 'Exported the Logbook'),
  A('LOGBOOK_ACCESS_DENIED',       'logbook', 'security', LOG_SEVERITY.SENSITIVE, 'Was denied access to the Logbook'),
]));

export const LOG_ACTION_KEYS = Object.freeze(Object.keys(LOG_ACTIONS));

/** Registry lookup. Unknown actions degrade instead of throwing (never lose an event). */
export function actionSpec(action) {
  return LOG_ACTIONS[String(action || '')] || null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * LEGACY BRIDGE (119.md §8 "bridge existing stores")
 *
 * Pre-119 activity lives in ScreenAuditLog / ExtractionAuditLog / RobAuditLog /
 * ProjectEvent. Those rows are NOT copied — they are unioned at read time and
 * mapped through these tables so engine/category/severity filters behave the
 * same on a 2024 row as on a row written today.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The legacy stores the reader unions. Order fixes the merge tiebreak. */
export const LEGACY_SOURCES = Object.freeze(['screen_audit', 'project_event', 'extraction_audit', 'rob_audit']);

/**
 * ScreenAuditLog action → { engine, category, severity }. Every action string
 * emitted by server/screening/** (writeAudit + keywordAudit + finalReviewAudit)
 * is listed; prefix rules below catch families that grow (KEYWORD_*, AI_*, …).
 */
const SCREEN_AUDIT_EXACT = Object.freeze({
  MEMBER_ADDED:               { engine: 'core', category: 'create', severity: LOG_SEVERITY.SENSITIVE },
  MEMBER_REMOVED:             { engine: 'core', category: 'delete', severity: LOG_SEVERITY.SENSITIVE },
  MEMBER_LEFT:                { engine: 'core', category: 'delete', severity: LOG_SEVERITY.IMPORTANT },
  MEMBER_PERMISSIONS_CHANGED: { engine: 'core', category: 'update', severity: LOG_SEVERITY.SENSITIVE },
  INVITE_ACCEPTED:            { engine: 'core', category: 'access', severity: LOG_SEVERITY.IMPORTANT },
  INVITE_REVOKED:             { engine: 'core', category: 'delete', severity: LOG_SEVERITY.IMPORTANT },
  OWNERSHIP_TRANSFERRED:      { engine: 'core', category: 'update', severity: LOG_SEVERITY.CRITICAL },
  PROJECT_ARCHIVED:           { engine: 'core', category: 'update', severity: LOG_SEVERITY.IMPORTANT },
  PROJECT_UNARCHIVED:         { engine: 'core', category: 'update', severity: LOG_SEVERITY.IMPORTANT },
  PROJECT_DELETED:            { engine: 'core', category: 'delete', severity: LOG_SEVERITY.CRITICAL },
  PROJECT_STATUS_CHANGED:     { engine: 'core', category: 'update', severity: LOG_SEVERITY.NOTABLE },
  REQUIRED_REVIEWERS_CHANGED: { engine: 'core', category: 'update', severity: LOG_SEVERITY.NOTABLE },
  METALAB_LINKED:             { engine: 'core', category: 'update', severity: LOG_SEVERITY.IMPORTANT },
  METALAB_UNLINKED:           { engine: 'core', category: 'update', severity: LOG_SEVERITY.IMPORTANT },
  HANDOFF_RETRY:              { engine: 'core', category: 'run',    severity: LOG_SEVERITY.ROUTINE },
  SAVE:                       { engine: 'core', category: 'update', severity: LOG_SEVERITY.ROUTINE },
  LOCK:                       { engine: 'core', category: 'update', severity: LOG_SEVERITY.ROUTINE },
  UNLOCK:                     { engine: 'core', category: 'update', severity: LOG_SEVERITY.ROUTINE },

  IMPORT_BATCH_DELETED:       { engine: 'search', category: 'delete', severity: LOG_SEVERITY.IMPORTANT },
  IMPORT_BATCH_SEARCH_UPDATED:{ engine: 'search', category: 'update', severity: LOG_SEVERITY.NOTABLE },
  RESET_IMPORTED_RECORDS:     { engine: 'search', category: 'delete', severity: LOG_SEVERITY.CRITICAL },
  DUPLICATE_GROUP_RESOLVED:   { engine: 'search', category: 'decision', severity: LOG_SEVERITY.NOTABLE },
  DUPLICATE_GROUP_KEEP_ALL:   { engine: 'search', category: 'decision', severity: LOG_SEVERITY.NOTABLE },
  DUPLICATE_JOB_REQUEUE:      { engine: 'search', category: 'run',      severity: LOG_SEVERITY.ROUTINE },

  RECORD_PROMOTED:            { engine: 'screening', category: 'decision', severity: LOG_SEVERITY.IMPORTANT },
  RECORD_UPDATED:             { engine: 'screening', category: 'update',   severity: LOG_SEVERITY.ROUTINE },
  CONFLICT_RESOLVED:          { engine: 'screening', category: 'decision', severity: LOG_SEVERITY.IMPORTANT },
  SCREENING_EXPORTED:         { engine: 'screening', category: 'export',   severity: LOG_SEVERITY.NOTABLE },

  PDF_UPLOADED:               { engine: 'files', category: 'create', severity: LOG_SEVERITY.NOTABLE },
  PDF_REMOVED:                { engine: 'files', category: 'delete', severity: LOG_SEVERITY.IMPORTANT },
  PDF_OA_ATTACHED:            { engine: 'files', category: 'create', severity: LOG_SEVERITY.ROUTINE },
});

/** Prefix rules for growing families (checked in order, after the exact table). */
const SCREEN_AUDIT_PREFIXES = Object.freeze([
  ['KEYWORD_',      { engine: 'search',    category: 'update',   severity: LOG_SEVERITY.ROUTINE }],
  ['ELIGIBILITY_',  { engine: 'protocol',  category: 'update',   severity: LOG_SEVERITY.IMPORTANT }],
  ['FULLTEXT_',     { engine: 'screening', category: 'update',   severity: LOG_SEVERITY.NOTABLE }],
  ['FINAL_REVIEW_', { engine: 'screening', category: 'decision', severity: LOG_SEVERITY.IMPORTANT }],
  ['RECORD_',       { engine: 'screening', category: 'decision', severity: LOG_SEVERITY.IMPORTANT }],
  ['DUPLICATE_',    { engine: 'search',    category: 'decision', severity: LOG_SEVERITY.NOTABLE }],
  ['AI_',           { engine: 'screening', category: 'update',   severity: LOG_SEVERITY.NOTABLE }],
  ['PDF_',          { engine: 'files',     category: 'update',   severity: LOG_SEVERITY.NOTABLE }],
  ['MEMBER_',       { engine: 'core',      category: 'update',   severity: LOG_SEVERITY.SENSITIVE }],
  ['PROJECT_',      { engine: 'core',      category: 'update',   severity: LOG_SEVERITY.IMPORTANT }],
  ['ANNOTATION_',   { engine: 'files',     category: 'update',   severity: LOG_SEVERITY.ROUTINE }],
]);

const FALLBACK = Object.freeze({ engine: 'core', category: 'update', severity: LOG_SEVERITY.ROUTINE });

/** Classify a legacy ScreenAuditLog action string. Never throws, never returns null. */
export function classifyScreenAuditAction(action) {
  const a = String(action || '').toUpperCase();
  if (SCREEN_AUDIT_EXACT[a]) return SCREEN_AUDIT_EXACT[a];
  for (const [prefix, spec] of SCREEN_AUDIT_PREFIXES) if (a.startsWith(prefix)) return spec;
  return FALLBACK;
}

/**
 * Every ScreenAuditLog action the EXACT table names, and the subset belonging to a
 * requested engine set. 119.md §8 — the reader uses these to push the engine filter
 * into the legacy SQL (logbookQuery.readScreenAudit): an action this table names is
 * classified by it with certainty, so excluding the ones that belong to OTHER engines
 * can never drop a row the in-memory classifier would have kept. The PREFIX families
 * are deliberately absent — expressing them in SQL needs LIKE, and a LIKE pattern
 * cannot reproduce `classifyScreenAuditAction` exactly (see the reader's comment), so
 * those rows are read and decided in memory instead of being narrowed on a guess.
 */
export const SCREEN_AUDIT_EXACT_ACTIONS = Object.freeze(Object.keys(SCREEN_AUDIT_EXACT));

export function screenAuditExactActionsForEngines(engines = []) {
  const want = new Set(engines);
  return SCREEN_AUDIT_EXACT_ACTIONS.filter((a) => want.has(SCREEN_AUDIT_EXACT[a].engine));
}

/**
 * The ScreenAuditLog actions the 119.md §8 writer now ALSO emits natively.
 *
 * Going forward these rows exist in BOTH stores (writeAudit keeps its 41-action
 * contract for the existing screening audit UI; the Logbook gets a richer,
 * transactional row). The reader therefore cuts the legacy source over at the
 * project's first native row of the same family — see logbookQuery.cutoverAt —
 * so a membership change is shown ONCE, not twice.
 */
export const MIRRORED_SCREEN_AUDIT_ACTIONS = Object.freeze([
  'MEMBER_ADDED', 'MEMBER_REMOVED', 'MEMBER_LEFT', 'MEMBER_PERMISSIONS_CHANGED',
  'INVITE_REVOKED', 'OWNERSHIP_TRANSFERRED',
  'PROJECT_ARCHIVED', 'PROJECT_UNARCHIVED', 'PROJECT_DELETED',
]);

/** The `mirrors` marker native rows carry when they supersede a ScreenAuditLog row. */
export const MIRROR_SCREEN_AUDIT = 'screen_audit';

/** ProjectEvent.module → Logbook engine. */
const PROJECT_EVENT_MODULE = Object.freeze({
  search: 'search', screening: 'screening', extraction: 'extraction',
  rob: 'rob', analysis: 'analysis', manuscript: 'manuscript', core: 'core',
});

/** The `module` values the taxonomy names. Anything else degrades to 'core'. */
export const PROJECT_EVENT_MODULES = Object.freeze(Object.keys(PROJECT_EVENT_MODULE));

/**
 * projectEventModuleMatch(engines) — how ProjectEvent's `module` COLUMN maps onto a
 * requested engine set, so the bridge can push the §8 engine filter into SQL instead
 * of reading rows it will only throw away (logbookQuery.readProjectEvent).
 *
 * `modules`  the named modules whose engine was asked for.
 * `unmapped` true when a module the taxonomy does NOT name — or none at all — still
 *            qualifies, because classifyProjectEvent degrades those to 'core'.
 * `known`    every named module, so the caller can write "not one of these".
 */
export function projectEventModuleMatch(engines = []) {
  const want = new Set(engines);
  return {
    modules: PROJECT_EVENT_MODULES.filter((m) => want.has(PROJECT_EVENT_MODULE[m])),
    unmapped: want.has('core'),
    known: PROJECT_EVENT_MODULES,
  };
}

/** Classify a bridged ProjectEvent row (module + category + significance). */
export function classifyProjectEvent(row) {
  const engine = PROJECT_EVENT_MODULE[String(row?.module || '')] || 'core';
  const origin = String(row?.origin || 'user_action');
  return {
    engine,
    category: origin === 'migration' ? 'create' : 'update',
    severity: Math.max(0, Math.min(5, Number(row?.significance) || 1)),
    actorType: origin === 'user_action' ? 'user' : (origin === 'system' ? 'system' : 'automation'),
  };
}

/** ExtractionAuditLog / RobAuditLog actions are single-engine by construction. */
export function classifyExtractionAuditAction() {
  return { engine: 'extraction', category: 'update', severity: LOG_SEVERITY.NOTABLE };
}
export function classifyRobAuditAction(action) {
  const a = String(action || '').toUpperCase();
  const category = a === 'ROB_DELETE' ? 'delete' : (a === 'ROB_CREATE' ? 'create' : 'update');
  return { engine: 'rob', category, severity: LOG_SEVERITY.NOTABLE };
}

/**
 * humaniseAction('MEMBER_PERMISSIONS_CHANGED') → 'Member permissions changed'.
 * The last-resort summary for a bridged row with no registered label.
 */
export function humaniseAction(action) {
  const s = String(action || '').replace(/_/g, ' ').trim().toLowerCase();
  if (!s) return 'Activity';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default {
  LOG_ENGINES, LOG_CATEGORIES, LOG_STATUSES, LOG_ACTOR_TYPES, LOG_VIA, LOG_SEVERITY,
  LOG_ACTIONS, LOG_ACTION_KEYS, actionSpec,
  LEGACY_SOURCES, MIRRORED_SCREEN_AUDIT_ACTIONS, MIRROR_SCREEN_AUDIT,
  SCREEN_AUDIT_EXACT_ACTIONS, screenAuditExactActionsForEngines,
  PROJECT_EVENT_MODULES, projectEventModuleMatch,
  classifyScreenAuditAction, classifyProjectEvent, classifyExtractionAuditAction,
  classifyRobAuditAction, humaniseAction,
};
