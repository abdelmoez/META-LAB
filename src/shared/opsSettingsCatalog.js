/**
 * opsSettingsCatalog.js — 109.md §3 — the TYPED Ops settings catalogue.
 *
 * PecanRev never had per-setting metadata: every admin control is a key in an
 * untyped JSON blob inside the single `SiteSetting` table, validated by a
 * hand-written `coerce*Settings()` and rendered by hand-written JSX. That is why
 * three copies of the feature-flag dependency graph exist, why `FLAG_META` in
 * AdminConsole.jsx drifted away from the server defaults (relationalProjectStore /
 * researchProvenance / aiExtraction had no admin row at all), and why the audit
 * trail could only ever say "featureFlags changed".
 *
 * This module is the ONE declarative source those layers now read:
 *   - server coercion            → coerceDomainPatch() / coerceSettingValue()
 *   - per-setting audit diffs    → diffDomainValues()
 *   - the Ops UI (rendering,     → OPS_SETTINGS / OPS_FLAGS / catalogCategories()
 *     search, help text, badges)   / searchCatalog() / isWritable()
 *   - the flag dependency graph  → FEATURE_DEPS / FEATURE_RUNTIME_DEPS
 *   - the flag default map       → flagDefaults()
 *
 * PURE — no React, no IO, no Date/Math.random, no imports. Shared by the browser
 * bundle AND the Express server (imported as ../../src/shared/opsSettingsCatalog.js,
 * the same way server/controllers/adminController.js imports auditFormat.js).
 *
 * ── Storage model (deliberately unchanged, 109.md §54) ───────────────────────
 * Nothing here introduces a table. Every writable entry still lives at
 * `SiteSetting[domain].value → JSON → path`, and every reader still merges the
 * catalogue defaults UNDER the stored blob (initDefaultSettings() never
 * overwrites an existing row, so a key added in a later release must fall back to
 * its default on an old install). `defaultsForDomain()` produces that default
 * object from the catalogue instead of a hand-copied literal.
 *
 * ── danger levels (109.md §§2, 31, 45) ───────────────────────────────────────
 *   'safe'       — an ordinary admin toggle/number/enum. Writable.
 *   'guarded'    — writable, but consequential enough to require a confirmation
 *                  step + impact preview in the Ops UI (§40/§41).
 *   'scientific' — READ-ONLY in Ops. Ops must not make scientific decisions for
 *                  researchers (§2), so the proportion compatibility gate, the
 *                  stored enum registries, and the engine's matching constants are
 *                  displayed with their rationale and no control.
 *   'env'        — READ-ONLY, "Managed by environment" (§45). Rendered with the
 *                  variable NAME and its shipped default only — NEVER a value read
 *                  out of process.env, because several of these live next to
 *                  secrets and Ops must never echo one.
 */

/** Value types the catalogue can describe. */
export const SETTING_TYPES = Object.freeze({
  BOOLEAN: 'boolean',
  NUMBER: 'number',
  ENUM: 'enum',
  STRING: 'string',
  STRING_LIST: 'string[]',
  /** A read-only registry display (enum tables, heading dictionaries). */
  REGISTRY: 'registry',
});

/** Governance level — see the header. */
export const DANGER = Object.freeze({
  SAFE: 'safe', GUARDED: 'guarded', SCIENTIFIC: 'scientific', ENV: 'env',
});

/** Where the effective value comes from (109.md §45). */
export const SOURCE = Object.freeze({
  DATABASE: 'database', ENVIRONMENT: 'environment', HARDCODED: 'hardcoded',
});

/**
 * The SiteSetting row that stores the 109 research-governance block. NEW additive
 * key: absent rows read as the catalogue defaults, so an upgrade needs no
 * migration and no admin action.
 */
export const RESEARCH_GOVERNANCE_KEY = 'researchGovernanceSettings';

/** Ops categories, in sidebar/sub-tab order. Drives grouping + the §44 search. */
export const CATALOG_CATEGORIES = Object.freeze([
  { id: 'screening',   label: 'Screening & Navigation', blurb: 'Record navigation, automatic loading and decision-control presentation.' },
  { id: 'duplicates',  label: 'Duplicate Detection',    blurb: 'Deduplication availability, worker tuning and matching constants.' },
  { id: 'keywords',    label: 'Keyword Intelligence',   blurb: 'Generated inclusion/exclusion suggestions, safety behaviour and the generic stop list.' },
  { id: 'interaction', label: 'Keyboard & History',     blurb: 'Shortcut availability plus the project-wide Undo/Redo history limits.' },
  { id: 'extraction',  label: 'Extraction',             blurb: 'Proportion metadata registries and display precision.' },
  { id: 'analysis',    label: 'Analysis Safety',        blurb: 'Scientific-integrity protections around pooled proportion analyses.' },
]);

/* ══════════════════════════════════════════════════════════════════════════
   FEATURE FLAGS — the single registry the server defaults, the dependency
   graph and the Ops Flags UI all derive from (109.md §5).
   ══════════════════════════════════════════════════════════════════════════
   `requires` is a HARD existence dependency (mirrors server featureAccess
   FEATURE_DEPS: the flag is inert until every dependency is on).
   `runtimeRequires` is ADVISORY only — a hint, never an existence gate
   (livingReview stays viewable with pecanSearch off; its dependency surfaces as
   a runtime 409 in livingService).
   `deprecated` rows keep parsing stored blobs but are hidden from the Ops UI. */

export const OPS_FLAGS = Object.freeze([
  // ── Core platform ──────────────────────────────────────────────────────────
  { key: 'autosave', label: 'Autosave', default: true, group: 'core',
    description: 'Automatically save project changes as the user types.' },
  { key: 'contactForm', label: 'Contact Form', default: true, group: 'core',
    description: 'Show the public contact form on the landing page.' },
  { key: 'projectDuplication', label: 'Project Duplication', default: true, group: 'core',
    description: 'Allow users to clone existing projects.' },
  { key: 'advancedMetaAnalysis', label: 'Advanced Meta-Analysis', default: true, group: 'analysis',
    description: "Enable trim-and-fill, Egger's test, and influence diagnostics." },
  { key: 'exportTools', label: 'Export Tools', default: true, group: 'core',
    description: 'Allow project and data exports in various formats.' },
  { key: 'relationalProjectStore', label: 'Relational Project Store', default: false, group: 'core',
    description: 'Back META·LAB projects with the relational ReviewRecord/ReviewStudy tables (dual-write, then read-switch) instead of the Project.data JSON blob alone. Infrastructure only — no user-visible surface. Off by default.' },
  { key: 'serverBackedWorkflowState', label: 'Server-Backed Workflow State', default: false, group: 'core',
    description: 'Persist migrated workflow modules (Protocol, Search Builder) server-side with revision-based conflict detection. Off keeps the legacy whole-project autosave.' },

  // ── 107/108 research-workflow flags — ALL DEFAULT ON (109.md §5) ───────────
  // These gate behaviour that SHIPPED in v4.12/v4.13. A default of OFF would
  // silently regress every existing install on upgrade, so each one defaults ON
  // and exists purely as an operator kill switch. Turning one off hides the
  // affordance; it never deletes the keywords, decisions or history it governs
  // (§5 "a feature being disabled must never delete its saved data").
  { key: 'keywordSuggestions', label: 'Generated Keyword Suggestions', default: true, group: 'screening',
    description: 'Generate a small, conservative set of inclusion/exclusion keyword suggestions from the project\'s eligibility criteria. Suggestions are proposals only — a reviewer must accept one before it becomes a project keyword. Turning this off hides the suggestion surface; keywords already accepted stay exactly as they are.' },
  { key: 'abstractKeywordShortcuts', label: 'Abstract Keyword Shortcuts (Ctrl/Cmd + I / E)', default: true, group: 'screening',
    description: 'Allow Ctrl/Cmd + I and Ctrl/Cmd + E to add the selected abstract text as an inclusion or exclusion keyword. Interception stays CONTEXTUAL even when enabled: the shortcut only takes over the browser default when a valid selection inside the active abstract is owned by the screening context, the user is not typing in an editable element, and the action can actually complete. Off restores the browser defaults everywhere.' },
  { key: 'keywordContextMenu', label: 'Right-Click Keyword Actions', default: true, group: 'screening',
    description: 'Show the right-click context menu on manually added keywords (delete, and any other safely implemented action). Off hides the menu; every existing keyword is preserved and stays editable through the normal keyword controls.' },
  { key: 'projectUndoRedo', label: 'Project-Wide Undo / Redo', default: true, group: 'interaction',
    description: 'Enable the page-scoped project history: Ctrl/Cmd + Z to undo and Ctrl/Cmd + Shift + Z to redo screening, keyword, extraction, search and analysis edits. Off stops the provider recording new entries and releases the chords back to the browser — saved project data is untouched, and the immutable audit ledger is never affected either way (§50).' },

  // ── Risk of Bias ───────────────────────────────────────────────────────────
  { key: 'rob_engine_v2', label: 'Risk of Bias (RoB 2)', default: false, group: 'appraisal',
    description: 'Enable the PecanRev RoB 2 assessment workspace (beta). Off by default until validated.' },
  { key: 'guidedRobAppraisal', label: 'Guided RoB Appraisal (P14)', default: false, group: 'appraisal', requires: ['rob_engine_v2'],
    description: 'Guided risk-of-bias appraisal on top of the RoB workspace: adds ROBINS-I alongside RoB 2 and suggests per-domain signalling answers with a quoted supporting sentence and confidence — always a reviewer suggestion that never overwrites a human judgment. Requires Risk of Bias (RoB 2).' },

  // ── Search ─────────────────────────────────────────────────────────────────
  { key: 'searchEngine', label: 'Pecan Search Engine — Strategy Builder', default: false, group: 'search',
    description: 'The concept→multi-database strategy builder (MeSH lookup + live PubMed counts via the NLM proxy). One of the two layers of a single product — this builds the strategy, the Automated Run executes it.' },
  { key: 'pecanSearch', label: 'Pecan Search Engine — Automated Run', default: false, group: 'search', requires: ['searchEngine'],
    description: 'Executes the strategy across multiple databases (PubMed, Europe PMC, ClinicalTrials.gov, Crossref, DOAJ, OpenAlex, Semantic Scholar) with query translation, count previews, deduplicated runs and exportable reports. Requires the Strategy Builder. Configure providers, caps, concurrency and queue health in Search Providers.' },
  { key: 'searchStrategyStudio', label: 'Strategy Studio (P11)', default: false, group: 'search', requires: ['searchEngine', 'pecanSearch'],
    description: 'The guided Boolean Strategy Studio: a generate → critic → refine loop with real per-database hit counts, seed-based recall estimation and PRISMA-S documentation. Requires both Pecan Search layers.' },
  { key: 'citationMining', label: 'Citation Mining & Study Maps (P15)', default: false, group: 'search',
    description: 'Bibliomine citation mining: extract a seed review\'s reference list, resolve it against CrossRef/PubMed/OpenAlex, chase backward and forward citations through a bounded cancellable worker, and import the deduplicated candidates into screening with provenance. Only legal metadata / open-access sources are used.' },

  // ── Screening engines ──────────────────────────────────────────────────────
  { key: 'aiScreening', label: 'Screening Engine', default: false, group: 'screening',
    description: 'The PecanRev Screening Intelligence Engine: deterministic TF-IDF + active-learning relevance scoring, ranking, explanations and validation metrics inside the screening workbench. Assistive only — human decisions are never automated. Configure global policy in Screening → Engine policy.' },
  { key: 'eligibilityScreening', label: 'Criteria Screener (P10)', default: false, group: 'screening',
    description: 'The criteria-based Eligibility Screener: reviewers define structured yes/no inclusion/exclusion questions and the engine answers each per record (suggested answer + confidence + quoted evidence), with reviewer adjudication and an optional governed auto-apply that never overwrites a human decision.' },

  // ── Extraction ─────────────────────────────────────────────────────────────
  { key: 'extractionAssist', label: 'Structured Extraction + Guided Assist (P5)', default: false, group: 'extraction',
    description: 'The structured data-extraction workspace: data-element forms, dual independent extraction with adjudication, provenance-first values, table parsing and guided suggestions. Suggestions NEVER auto-commit — human review is mandatory. Configure the suggestion provider in Extraction Assist.' },
  { key: 'extractionEngine', label: 'Pecan Extraction Engine (76.md)', default: false, group: 'extraction',
    description: 'Replace the Data Extraction tab with the article-centred extraction workspace: article list with statuses and filters, split PDF + form view, three capture methods, per-value provenance with jump-to-source, three-tier validation, and per-article analysis-sync status.' },
  { key: 'aiExtraction', label: 'Server-Proxied LLM Extraction', default: false, group: 'extraction',
    description: 'OPTIONAL server-proxied model extraction for the unified extraction workspace. Off means POST /api/ai-extract does not exist. When on (and the server-side API key is configured) one model call returns a validated, whitelisted study patch — every mapped value is flagged needsReview, so nothing auto-commits. The endpoint credentials are managed by environment and are never shown in Ops.' },

  // ── Synthesis / reporting ──────────────────────────────────────────────────
  { key: 'networkMetaAnalysis', label: 'Network Meta-Analysis', default: false, group: 'analysis',
    description: 'The Network Meta-Analysis workspace: compare 3+ treatments via direct and indirect evidence (league table, P-score ranking, network geometry, node-split and global inconsistency, contribution matrix). Deterministic frequentist engine.' },
  { key: 'metaRegression', label: 'Meta-Regression (P13)', default: false, group: 'analysis',
    description: 'Random-effects meta-regression + bubble plots: explore whether a study-level covariate explains heterogeneity, with coefficients, tau² before/after, an R² analog and statistical guardrails.' },
  { key: 'gradeCertainty', label: 'GRADE Certainty Workspace (P12)', default: false, group: 'analysis',
    description: 'The per-outcome GRADE certainty-of-evidence workspace: domain suggestions prefilled from data the app already computes, a human-confirmed final rating, an audit trail, lockable judgments and a Summary-of-Findings table.' },
  // 117.md §K.2 — DEFAULT ON. The manuscript editor stopped being a rollout
  // experiment: 117.md §4-11 (table objects + one numbering sequence), §12-22
  // (the synchronized PRISMA view), §23-25 (forest presentation) and §26-41 (the
  // reference manager) all live behind this key, and it is now the platform's
  // center of gravity. Like every other default-ON flag it is an operator KILL
  // SWITCH, not a rollout gate: turning it off restores the legacy textarea
  // drafter (ManuscriptTab's fallback path) and never deletes a draft.
  { key: 'manuscriptEditor', label: 'Manuscript Editor (P3)', default: true, group: 'reporting',
    description: 'The full manuscript authoring workspace: structured IMRAD drafting, data-linked tables with one document-order numbering sequence, an integrated reference manager and citation engine, a PRISMA 2020 diagram synchronized with the record-derived flow, one-click .docx export and a reproducibility archive. All artifacts are generated in the browser from live project data. Turning this off restores the legacy plain-text drafter; drafts are preserved either way.' },
  /* 120.md §6 — DEFAULT ON, and it governs AVAILABILITY ONLY. The distinction
     matters: this flag decides whether the Writing Assistant control EXISTS in the
     manuscript toolbar, while the feature itself stays OFF for every user until
     that user turns it on (User.writingAssistant, §6 "The feature must be off until
     the user enables it… Do not force it on globally"). Default ON follows the
     109.md governance style for shipped behaviour — an operator kill switch, not a
     rollout gate. Turning it off hides the control and stops the worker from ever
     initialising; it never deletes a dictionary entry or a preference.

     Deliberately declares NO `requires: ['manuscriptEditor']`, even though it only
     decorates that surface: 117.md §K.2 pins manuscriptEditor as a flag that gates
     nothing else, and the containment is already STRUCTURAL — with the editor off,
     ManuscriptToolbar never renders, so there is nothing for this control to appear
     in. A declared gate would add a second, weaker statement of the same fact. */
  { key: 'writingAssistant', label: 'Writing Assistant (Spelling & Grammar)', default: true, group: 'reporting',
    description: 'The manuscript Writing Assistant: a LOCAL, in-browser spelling and grammar checker built for medical and scientific prose (scientific tokenizer, versioned medical lexicon, project-derived terminology, personal and project dictionaries). No manuscript text is ever transmitted — the checker runs in a Web Worker with a bundled dictionary. This flag controls AVAILABILITY only; every user starts with the assistant off and enables it for themselves. Turning it off hides the toolbar control and preserves every saved dictionary entry.' },
  { key: 'researchProvenance', label: 'Research Provenance Ledger', default: false, group: 'reporting',
    description: 'The append-only, project-wide event ledger (search, screening, extraction, RoB, analysis, manuscript) with deterministic significance classification and a Project History tab. Off means /api/provenance does not exist and no events are captured. This ledger is IMMUTABLE and entirely separate from the Undo/Redo history (§50).' },
  { key: 'publicSynthesis', label: 'Public Synthesis Pages (P8)', default: false, group: 'reporting',
    description: 'Shareable, embeddable, read-only public synthesis pages. Every project stays PRIVATE until its owner or leader explicitly publishes; unpublishing takes effect immediately.' },
  { key: 'livingReview', label: 'Living Reviews (P6)', default: false, group: 'reporting', runtimeRequires: ['pecanSearch'],
    description: 'The Living Review module: saved searches with exact query snapshots, a "new since last update" screening queue, versioned review snapshots and cautious evidence-shift alerts. Manual snapshots work on their own; AUTOMATED re-runs additionally need the Pecan Search Automated Run (a runtime requirement, not an existence gate — the dashboard stays visible either way).' },
  { key: 'fullTextRetrieval', label: 'Full-Text Retrieval (P9)', default: false, group: 'screening',
    description: 'Automated open-access full-text retrieval: resolve DOIs/PMIDs against Unpaywall, OpenAlex, Europe PMC and ClinicalTrials.gov and fetch legally available OA PDFs with provenance, plus bulk PDF upload with auto-matching. No paywall bypassing — ever.' },

  // ── Platform ───────────────────────────────────────────────────────────────
  { key: 'betaWaitlist', label: 'Beta Waitlist Landing Page', default: false, group: 'platform',
    description: 'When on, unauthenticated visitors to the homepage see the Beta Waitlist sign-up page instead of the standard landing page. Signed-in users and the login/register pages are unaffected.' },

  // ── Retired ────────────────────────────────────────────────────────────────
  { key: 'searchWorkspaceV2', label: 'Search Workspace v2 (retired)', default: false, group: 'platform', deprecated: true,
    description: '96.md retired this flag: the staged Search Workspace now renders whenever the Strategy Builder is on. The key survives only so stored SiteSetting rows keep parsing. Hidden from Ops — a toggle that silently does nothing is a dead button.' },
]);

/** Every flag key the server will accept in a feature-flag write. */
export const FLAG_KEYS = Object.freeze(OPS_FLAGS.map((f) => f.key));
const FLAG_KEY_SET_INNER = new Set(FLAG_KEYS);
/** Membership test (a Set, so prototype keys like 'constructor' can't slip through). */
export const FLAG_KEY_SET = FLAG_KEY_SET_INNER;

/** Flags rendered in the Ops Flags section — everything except retired keys. */
export const VISIBLE_FLAGS = Object.freeze(OPS_FLAGS.filter((f) => !f.deprecated));

/** The catalogue entry for a flag key, or null. */
export function flagEntry(key) {
  return OPS_FLAGS.find((f) => f.key === key) || null;
}

/**
 * The default feature-flag map, derived from the catalogue. A drift unit test
 * pins this against settingsController's DEFAULTS.featureFlags so the two can
 * never disagree again.
 */
export function flagDefaults() {
  const out = {};
  for (const f of OPS_FLAGS) out[f.key] = f.default === true;
  return out;
}

/**
 * HARD existence-gate dependency graph, derived from the catalogue. Consumed by
 * BOTH server/services/featureAccess.js and src/frontend/featureAccess/
 * featureFlagState.js so the two graphs are the same object shape by
 * construction (they were hand-copied byte-for-byte before 109).
 */
export const FEATURE_DEPS = Object.freeze(Object.fromEntries(
  OPS_FLAGS.filter((f) => Array.isArray(f.requires) && f.requires.length)
    .map((f) => [f.key, Object.freeze([...f.requires])]),
));

/**
 * Advisory (NON-gate) co-dependencies. These never affect the existence
 * decision — they exist so the UI can render an accurate "needs X too" hint.
 */
export const FEATURE_RUNTIME_DEPS = Object.freeze(Object.fromEntries(
  OPS_FLAGS.filter((f) => Array.isArray(f.runtimeRequires) && f.runtimeRequires.length)
    .map((f) => [f.key, Object.freeze([...f.runtimeRequires])]),
));

/**
 * Whitelist-coerce a feature-flag patch (109.md §5 + the setInvitationsPaused
 * pattern). Unknown keys are DROPPED, values are coerced to real booleans, and
 * keys the caller did not send keep their stored value — so the legacy
 * whole-blob PUT from the Ops Flags form stays backward compatible while a
 * single-key PATCH becomes safe under concurrent editing.
 *
 * Stored-but-unknown keys survive untouched: never drop a key a future/previous
 * release wrote, or a rollback loses its flag state.
 *
 * @param {object} patch    the request body ({flagKey: boolean, ...})
 * @param {object} current  the stored flags merged over defaults
 * @returns {{next: object, changed: string[], rejected: string[]}}
 */
export function coerceFlagPatch(patch, current) {
  const base = (current && typeof current === 'object' && !Array.isArray(current)) ? current : {};
  const next = { ...flagDefaults(), ...base };
  const p = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
  const changed = [];
  const rejected = [];
  for (const key of Object.keys(p)) {
    if (!FLAG_KEY_SET_INNER.has(key)) { rejected.push(key); continue; }
    const raw = p[key];
    if (typeof raw !== 'boolean') { rejected.push(key); continue; }
    if (next[key] !== raw) changed.push(key);
    next[key] = raw;
  }
  return { next, changed, rejected };
}

/* ══════════════════════════════════════════════════════════════════════════
   TYPED SETTINGS
   ══════════════════════════════════════════════════════════════════════════ */

const G = RESEARCH_GOVERNANCE_KEY;

/**
 * The catalogue. Writable entries carry {domain, path}; read-only ones
 * ('scientific' / 'env') carry neither and are display-only by construction —
 * coerceDomainPatch() can therefore never write one, which is the enforcement
 * for 109.md §2 (Ops must not make scientific decisions).
 */
export const OPS_SETTINGS = Object.freeze([
  // ── Screening & navigation (109.md §§7, 36) ────────────────────────────────
  { key: 'screening.keyboardNavigation', domain: G, path: 'keyboardNavigationEnabled',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'screening', label: 'Keyboard record navigation',
    description: 'Let reviewers move between citations with the arrow keys in the screening workbench. Off leaves mouse navigation unchanged.' },
  { key: 'screening.autoLoadMore', domain: G, path: 'autoLoadMoreEnabled',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'screening', label: 'Automatic Load More on forward navigation',
    description: 'Fetch the next page automatically when a reviewer navigates past the end of the loaded citations. Off requires an explicit Load More click; no records are hidden either way.' },
  { key: 'screening.autoLoadMoreBatchSize', domain: G, path: 'autoLoadMoreBatchSize',
    type: SETTING_TYPES.NUMBER, default: 50, min: 10, max: 200, step: 5,
    danger: DANGER.SAFE, source: SOURCE.DATABASE, category: 'screening',
    label: 'Records per automatic batch',
    description: 'How many citations each automatic page fetch adds. Clamped to 10–200 so no configuration can pull tens of thousands of records into one browser tab.' },
  { key: 'screening.blockNavigationWhileLoading', domain: G, path: 'blockNavigationWhileLoading',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'screening', label: 'Ignore repeated navigation while a page is loading',
    description: 'Swallow held-down arrow keys while a batch is in flight, so a reviewer cannot skip past unrendered citations. Turning this off is not recommended.' },
  { key: 'screening.decisionIndicators', domain: G, path: 'decisionIndicatorsEnabled',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'screening', label: 'Row-level decision indicators',
    description: 'Show each citation\'s include/exclude state in the list. Presentation only — hiding the indicator never changes or deletes a decision.' },
  { key: 'screening.selectedRowAutoScroll', domain: G, path: 'selectedRowAutoScroll',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'screening', label: 'Keep the selected citation in view',
    description: 'Scroll the selected row into view as the reviewer navigates.' },
  { key: 'screening.structuredAbstractHeadings', type: SETTING_TYPES.REGISTRY,
    default: ['Background', 'Objective', 'Objectives', 'Methods', 'Results', 'Conclusion', 'Conclusions'],
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'screening',
    label: 'Recognised structured-abstract headings',
    description: 'The heading dictionary the structured-abstract renderer matches (the full list also covers Introduction, Context, Importance, Rationale, Aim(s), Purpose, Materials/Patients/Subjects and Methods, Methodology, Findings, Discussion, Limitations and the "and Relevance" variants).',
    rationale: 'Read-only: the dictionary decides how a published abstract is segmented for reviewers. Editing it from Ops would silently change what a reviewer reads, which is a scientific presentation decision rather than an operational one.' },

  // ── Duplicate detection (109.md §§8, 10, 45) ───────────────────────────────
  { key: 'duplicates.allowDuplicateDetection', domain: 'metaSiftSettings', path: 'allowDuplicateDetection',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.GUARDED, source: SOURCE.DATABASE,
    category: 'duplicates', label: 'Duplicate detection available to users',
    managedBy: 'metaSiftSettings',
    description: 'Whether reviewers may run duplicate detection. Enforced server-side (the enqueue endpoint refuses with 403 when off). Turning it off never unlinks an already-detected duplicate group or discards a manual resolution.',
    note: 'Stored in the META·SIFT screening settings block and written by Ops › Screening › Settings — surfaced here as a relocated view so the Duplicate Detection section is complete.' },
  { key: 'duplicates.titleThreshold', type: SETTING_TYPES.NUMBER, default: 0.92,
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'duplicates',
    label: 'Fuzzy title-match threshold',
    description: 'Normalised title similarity at or above which two records are treated as the same article by the fuzzy pass (the scored pass uses 0.85).',
    rationale: 'Read-only: lowering it merges scientifically distinct articles, raising it splits real duplicates. Which records are the same study is a research judgement, so the constant is fixed in the engine and every group remains a reviewer-resolvable SUGGESTION.' },
  ...[
    ['SCREEN_DUP_STUCK_MS', 600000, 'Stuck-job timeout (ms)', 'A processing job whose last heartbeat is older than this is treated as crashed and becomes eligible for retry.'],
    ['SCREEN_DUP_READ_BATCH', 1000, 'Record read batch', 'Cursor page size for reading records into the detector — bounds memory per query.'],
    ['SCREEN_DUP_SAVE_BATCH', 25, 'Group save batch', 'Duplicate groups persisted per transaction.'],
    ['SCREEN_DUP_MAX_BLOCK', 400, 'Maximum blocking-bucket size', 'Cap on how many records share one blocking bucket before the bucket is truncated. Also a scientific bound: a truncated bucket can leave a real duplicate pair uncompared, which is why detection output is always a reviewable suggestion.'],
    ['SCREEN_DUP_MAX_COMPARISONS', 2000000, 'Maximum fuzzy comparisons', 'Global cap on candidate pair comparisons for one job. Also a scientific bound — see the blocking-bucket note above.'],
    ['SCREEN_DUP_YIELD_EVERY', 2000, 'Event-loop yield cadence', 'Candidate pairs processed between cooperative yields, so detection never blocks the API.'],
    ['SCREEN_DUP_PROGRESS_MS', 750, 'Progress/heartbeat throttle (ms)', 'Minimum interval between progress and heartbeat writes.'],
    ['SCREEN_DUP_MAX_ACTIVE_PER_USER', 3, 'Active jobs per user', 'How many queued or processing detection jobs one user may hold across all projects. Exceeding it returns 429 DUP_JOB_LIMIT.'],
    ['SCREEN_DUP_MAX_GROUP_SIZE', 1000, 'Maximum group size', 'A candidate group larger than this is junk-data chaining rather than real duplicates; it is skipped and counted in the job stats.'],
  ].map(([envVar, def, label, description]) => ({
    key: `duplicates.env.${envVar}`, type: typeof def === 'number' ? SETTING_TYPES.NUMBER : SETTING_TYPES.STRING,
    default: def, danger: DANGER.ENV, source: SOURCE.ENVIRONMENT, category: 'duplicates',
    envVar, label, description,
    rationale: 'Worker tuning has no database layer: the value is read from the environment at process start, so changing it requires a deploy. Ops shows the variable name and its shipped default and never reads or echoes the running value.',
    requiresReload: true,
  })),

  // ── Keyword intelligence (109.md §§11-13) ──────────────────────────────────
  // 109 r1 — default false: the v4.13.0 panel ships COLLAPSED; the catalogue default must
  // reproduce shipped behaviour (a default that changes behaviour on upgrade is a regression).
  { key: 'keywords.suggestionsDefaultOn', domain: G, path: 'keywordSuggestionsDefaultOn',
    type: SETTING_TYPES.BOOLEAN, default: false, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'keywords', label: 'Suggestions expanded by default',
    description: 'Whether the keyword suggestion panel starts open for a new project. The master availability switch is the "Generated Keyword Suggestions" feature flag.' },
  { key: 'keywords.maxSuggestionsPerList', domain: G, path: 'maxSuggestionsPerList',
    type: SETTING_TYPES.NUMBER, default: 12, min: 1, max: 24, step: 1,
    danger: DANGER.SAFE, source: SOURCE.DATABASE, category: 'keywords',
    label: 'Maximum suggestions per list',
    description: 'How many generated suggestions the inclusion and exclusion lists each offer. The engine ships with 12; a smaller number is more conservative.' },
  { key: 'keywords.preferPhrases', domain: G, path: 'preferPhrases',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'keywords', label: 'Prefer multi-word phrases',
    description: 'Rank phrases from the eligibility criterion above isolated words, which are far more likely to be ambiguous.' },
  { key: 'keywords.allowAmbiguousSingleWords', domain: G, path: 'allowAmbiguousSingleWords',
    type: SETTING_TYPES.BOOLEAN, default: false, danger: DANGER.GUARDED, source: SOURCE.DATABASE,
    category: 'keywords', label: 'Allow ambiguous single-word suggestions',
    description: 'Off (recommended) suppresses single words that are generic on their own. Turning this on produces noisier suggestions that a reviewer must filter — it never adds a keyword automatically.' },
  { key: 'keywords.conflictBehavior', domain: G, path: 'conflictBehavior',
    type: SETTING_TYPES.ENUM, default: 'flag_for_review',
    options: [
      { value: 'flag_for_review', label: 'Flag for review (recommended)', description: 'Surface the concept in both lists with a conflict warning and let the reviewer decide.' },
      { value: 'omit_ambiguous', label: 'Omit the ambiguous suggestion', description: 'Do not suggest a concept that already appears in the opposite list.' },
      { value: 'prevent_duplicate_activation', label: 'Prevent duplicate activation', description: 'Allow the suggestion but refuse to activate the same concept in both lists at once.' },
    ],
    danger: DANGER.GUARDED, source: SOURCE.DATABASE, category: 'keywords',
    label: 'When a concept appears in both lists',
    description: 'How the system reacts when a generated concept exists in both the inclusion and the exclusion list. There is deliberately NO option that silently activates an ambiguous term in both lists (109.md §12) — scientific safety is the default and the floor.' },
  { key: 'keywords.stopListAdditions', domain: G, path: 'stopListAdditions',
    type: SETTING_TYPES.STRING_LIST, default: [], maxItems: 200, maxLength: 64,
    danger: DANGER.SAFE, source: SOURCE.DATABASE, category: 'keywords',
    label: 'Additional generic terms to suppress',
    description: 'Extra terms excluded from generated suggestions, on top of the built-in generic stop list (patient, patients, study, studies, disease, treatment, …). Additive — the built-in defaults cannot be destroyed by an accidental edit.' },
  { key: 'keywords.stopListRemovals', domain: G, path: 'stopListRemovals',
    type: SETTING_TYPES.STRING_LIST, default: [], maxItems: 200, maxLength: 64,
    danger: DANGER.GUARDED, source: SOURCE.DATABASE, category: 'keywords',
    label: 'Built-in generic terms to re-allow',
    description: 'Built-in stop-list terms that should be suggestible again for this installation. Clearing this list restores the shipped defaults exactly — the built-in list itself is never edited in place, so "Restore system defaults" is always available (109.md §13).' },

  // ── Keyboard & history (109.md §§15-18) ────────────────────────────────────
  { key: 'interaction.historyCap', domain: G, path: 'historyCap',
    type: SETTING_TYPES.NUMBER, default: 20, min: 5, max: 100, step: 5,
    danger: DANGER.SAFE, source: SOURCE.DATABASE, category: 'interaction',
    label: 'Maximum undo entries per page history',
    description: 'How many actions each page-scoped history keeps before the oldest is dropped. History is in-memory and session-scoped by design; raising this raises browser memory use, it does not make history survive a refresh.' },
  { key: 'interaction.undoToastEnabled', domain: G, path: 'undoToastEnabled',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'interaction', label: 'Undo feedback toast',
    description: 'Show the confirmation snackbar after an undo or redo, with its inline reverse action.' },
  { key: 'interaction.undoToastMs', domain: G, path: 'undoToastMs',
    type: SETTING_TYPES.NUMBER, default: 8000, min: 2000, max: 30000, step: 500,
    danger: DANGER.SAFE, source: SOURCE.DATABASE, category: 'interaction',
    label: 'Undo toast auto-dismiss (ms)',
    description: 'How long the undo/redo snackbar stays on screen before dismissing itself.' },
  { key: 'interaction.redoEnabled', domain: G, path: 'redoEnabled',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'interaction', label: 'Redo (Ctrl/Cmd + Shift + Z)',
    description: 'Allow redo after an undo. Off keeps undo working and simply stops the redo stack being offered.' },
  // 109 r1 — default true: Ctrl+Y HAS been redo since v4.13.0 (undoChords accepted it
  // unconditionally); the catalogue default must reproduce shipped behaviour.
  { key: 'interaction.ctrlYRedoAlias', domain: G, path: 'ctrlYRedoAlias',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.SAFE, source: SOURCE.DATABASE,
    category: 'interaction', label: 'Ctrl + Y redo alias (Windows)', aliases: ['undo', 'shortcut', 'keyboard'],
    description: 'Additionally accept Ctrl + Y as redo on Windows and Linux (the shipped v4.13.0 behaviour). Ctrl/Cmd + Shift + Z always works.' },
  { key: 'interaction.refusalDropLimit', type: SETTING_TYPES.NUMBER, default: 2,
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'interaction',
    label: 'Consecutive undo refusals before an entry is abandoned',
    description: 'An entry whose precondition no longer holds (a collaborator changed the same value) is refused; after this many consecutive refusals it is dropped so it cannot bury every older valid entry.',
    rationale: 'Read-only: this is the concurrency-safety valve that stops one stale entry blocking a user\'s whole history. Making it configurable would let an operator trade correctness for convenience, which §52 forbids.' },
  { key: 'interaction.shortcutInterceptionContextual', type: SETTING_TYPES.BOOLEAN, default: true,
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'interaction',
    label: 'Browser shortcut interception stays contextual',
    description: 'Ctrl/Cmd + I and Ctrl/Cmd + E call preventDefault() ONLY when a valid selection inside the active abstract is owned by the screening context, the user is not editing an input, no modal owns the keyboard, and the action can complete.',
    rationale: 'Read-only guarantee (109.md §17): enabling the shortcut feature must never mean blanket-blocking a browser accelerator across the app. There is no setting that can turn the guard chain off.' },

  // ── Extraction (109.md §§25-29) ────────────────────────────────────────────
  { key: 'extraction.percentDisplayDecimals', domain: G, path: 'percentDisplayDecimals',
    type: SETTING_TYPES.NUMBER, default: 1, min: 0, max: 3, step: 1,
    danger: DANGER.SAFE, source: SOURCE.DATABASE, category: 'extraction',
    label: 'Displayed percentage precision',
    description: 'Decimal places used when a calculated proportion is DISPLAYED (39.0%). Purely presentational: Events, Total and every statistical computation are unaffected — the engine always computes at full precision (109.md §29).' },
  { key: 'extraction.denominatorPopulations', type: SETTING_TYPES.REGISTRY,
    default: [
      { value: 'plp_molecular_diagnoses', label: 'P/LP molecular diagnoses' },
      { value: 'all_patients_tested', label: 'All patients tested' },
      { value: 'patients_with_management_change', label: 'Patients with management change' },
      { value: 'patients_with_follow_up', label: 'Patients with follow-up' },
      { value: 'other', label: 'Other/custom' },
    ],
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'extraction',
    label: 'Denominator Population categories',
    description: 'The stable internal identifiers and their display labels for the denominator a proportion is measured against.',
    rationale: 'Read-only (109.md §26): the identifiers are stored on every extracted row and drive the compatibility guard, filters and grouping. Renaming a label from Ops would divorce the label from the stored meaning; the identifier and the label are separated here so a future terminology system can change one without touching the other.' },
  { key: 'extraction.actionStatuses', type: SETTING_TYPES.REGISTRY,
    default: [
      { value: 'implemented', label: 'Implemented' },
      { value: 'recommended_planned', label: 'Recommended/planned' },
      { value: 'potential_theoretical', label: 'Potential/theoretical' },
      { value: 'unclear', label: 'Unclear' },
    ],
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'extraction',
    label: 'Action Status categories',
    description: 'The stable internal identifiers and labels for what happened as a consequence of the estimate.',
    rationale: 'Read-only (109.md §27): no Ops toggle may redefine the scientific meaning of a stored enum. Note that "Unclear" means THE ARTICLE reports it as unclear — it is not the same as an unclassified legacy row, and the two must never be merged.' },
  { key: 'extraction.legacyUnclassifiedPreserved', type: SETTING_TYPES.BOOLEAN, default: true,
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'extraction',
    label: 'Legacy rows stay unclassified',
    description: 'A proportion row extracted before these classifications existed simply lacks the keys and reads as "Missing / Not classified". Nothing in the load path, and no Ops action, writes a value onto it.',
    rationale: 'Read-only (109.md §28): there is deliberately NO bulk action that sets missing classifications to Unclear, because that would destroy the distinction between "the article said unclear" and "nobody has looked yet". Ops reports the counts; a researcher does the review.' },

  // ── Analysis safety (109.md §§30-32) ───────────────────────────────────────
  { key: 'analysis.compatibilityGuard', type: SETTING_TYPES.BOOLEAN, default: true,
    danger: DANGER.SCIENTIFIC, source: SOURCE.HARDCODED, category: 'analysis',
    label: 'Proportion compatibility guard',
    description: 'Always enabled. Before pooling proportions the guard checks for mixed Denominator Populations, mixed Action Statuses, legacy/unclassified metadata and incompatible custom denominator definitions, and warns the researcher.',
    rationale: 'Read-only BY DESIGN and with no off switch. 109.md §31 permits a guarded disable, but the guard is a pure client-side check that produces a WARNING a researcher may already override explicitly and on the record (see the override policy below). An Ops kill switch would remove the warning silently and app-wide — a scientific decision Ops must not make (§2) — while adding nothing an authorised researcher cannot already do deliberately and auditably.' },
  { key: 'analysis.allowCompatibilityOverride', domain: G, path: 'allowCompatibilityOverride',
    type: SETTING_TYPES.BOOLEAN, default: true, danger: DANGER.GUARDED, source: SOURCE.DATABASE,
    category: 'analysis', label: 'Allow documented compatibility override',
    description: 'Whether researchers may explicitly pool proportions the guard flagged as incompatible. The override is always explicit, stored on the analysis configuration, and leaves the warning visible. Turning this OFF removes the override affordance for new analyses; analyses that already carry an override are never retroactively altered.' },
  { key: 'analysis.requireOverrideRationale', domain: G, path: 'requireOverrideRationale',
    type: SETTING_TYPES.BOOLEAN, default: false, danger: DANGER.GUARDED, source: SOURCE.DATABASE,
    category: 'analysis', label: 'Require a written rationale for an override',
    description: 'For scientifically rigorous environments: refuse a compatibility override unless the researcher records why. Only meaningful while overrides are allowed.' },
]);

const SETTINGS_BY_KEY = new Map(OPS_SETTINGS.map((e) => [e.key, e]));

/** Catalogue entry for a setting key, or null. */
export function catalogEntry(key) {
  return SETTINGS_BY_KEY.get(key) || null;
}

/** Can Ops write this entry? False for read-only ('scientific'/'env') and relocated entries. */
export function isWritable(entry) {
  if (!entry) return false;
  if (entry.danger === DANGER.SCIENTIFIC || entry.danger === DANGER.ENV) return false;
  if (entry.managedBy) return false;
  return !!(entry.domain && entry.path);
}

/** Every writable entry stored in `domain`. */
export function settingsForDomain(domain) {
  return OPS_SETTINGS.filter((e) => e.domain === domain && isWritable(e));
}

/** The default object for a SiteSetting domain, derived from the catalogue. */
export function defaultsForDomain(domain) {
  const out = {};
  for (const e of settingsForDomain(domain)) {
    out[e.path] = Array.isArray(e.default) ? [...e.default] : e.default;
  }
  return out;
}

/** Catalogue defaults merged UNDER a stored blob (stored wins) — the house pattern. */
export function mergeDomainDefaults(domain, stored) {
  const s = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
  return { ...defaultsForDomain(domain), ...s };
}

function clampNumber(entry, n) {
  let v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (Number.isFinite(entry.step) && Number.isInteger(entry.step)) v = Math.round(v);
  if (Number.isFinite(entry.min)) v = Math.max(entry.min, v);
  if (Number.isFinite(entry.max)) v = Math.min(entry.max, v);
  return v;
}

function coerceStringList(entry, value) {
  if (!Array.isArray(value)) return null;
  const maxLength = Number.isFinite(entry.maxLength) ? entry.maxLength : 64;
  const maxItems = Number.isFinite(entry.maxItems) ? entry.maxItems : 100;
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase().slice(0, maxLength);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Coerce one submitted value against its catalogue entry.
 * @returns {{ok: true, value: *} | {ok: false, error: string}}
 */
export function coerceSettingValue(entry, value) {
  if (!entry) return { ok: false, error: 'Unknown setting' };
  if (!isWritable(entry)) return { ok: false, error: 'This setting is read-only' };
  switch (entry.type) {
    case SETTING_TYPES.BOOLEAN:
      if (typeof value !== 'boolean') return { ok: false, error: 'Expected true or false' };
      return { ok: true, value };
    case SETTING_TYPES.NUMBER: {
      const v = clampNumber(entry, value);
      if (v === null) return { ok: false, error: 'Expected a number' };
      return { ok: true, value: v };
    }
    case SETTING_TYPES.ENUM: {
      const legal = (entry.options || []).map((o) => o.value);
      if (!legal.includes(value)) return { ok: false, error: `Expected one of: ${legal.join(', ')}` };
      return { ok: true, value };
    }
    case SETTING_TYPES.STRING: {
      if (typeof value !== 'string') return { ok: false, error: 'Expected a string' };
      const max = Number.isFinite(entry.maxLength) ? entry.maxLength : 500;
      return { ok: true, value: value.trim().slice(0, max) };
    }
    case SETTING_TYPES.STRING_LIST: {
      const v = coerceStringList(entry, value);
      if (v === null) return { ok: false, error: 'Expected a list of strings' };
      return { ok: true, value: v };
    }
    default:
      return { ok: false, error: 'This setting is read-only' };
  }
}

/**
 * Registry-driven whitelist coercion for a whole domain patch — the 109
 * generalisation of the hand-written coerce*Settings() functions.
 *
 * Accepts EITHER catalogue keys ('interaction.historyCap') or the stored blob
 * paths ('historyCap'), so the Ops UI and a raw API caller both work. Unknown
 * keys, read-only entries and values that fail validation are dropped and
 * reported in `rejected` — never written, never thrown.
 *
 * @returns {{next: object, changed: string[], rejected: Array<{key:string, error:string}>}}
 *   `changed` holds CATALOGUE keys, for the audit diff.
 */
export function coerceDomainPatch(domain, patch, current) {
  const base = mergeDomainDefaults(domain, current);
  const next = { ...base };
  const p = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
  const changed = [];
  const rejected = [];

  const byPath = new Map();
  for (const e of settingsForDomain(domain)) byPath.set(e.path, e);

  for (const rawKey of Object.keys(p)) {
    const entry = (SETTINGS_BY_KEY.get(rawKey)?.domain === domain ? SETTINGS_BY_KEY.get(rawKey) : null)
      || byPath.get(rawKey) || null;
    if (!entry || !isWritable(entry)) { rejected.push({ key: rawKey, error: 'Unknown or read-only setting' }); continue; }
    const res = coerceSettingValue(entry, p[rawKey]);
    if (!res.ok) { rejected.push({ key: entry.key, error: res.error }); continue; }
    if (!sameValue(base[entry.path], res.value)) changed.push(entry.key);
    next[entry.path] = res.value;
  }
  return { next, changed, rejected };
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Per-setting before/after diff for the audit trail (109.md §42). Returns one row
 * per CHANGED catalogue entry with its label + scope, so the audit log can say
 * exactly what moved instead of "featureFlags changed".
 * @returns {Array<{key, path, label, category, scope, from, to}>}
 */
export function diffDomainValues(domain, before, after) {
  const b = mergeDomainDefaults(domain, before);
  const a = mergeDomainDefaults(domain, after);
  const out = [];
  for (const e of settingsForDomain(domain)) {
    if (sameValue(b[e.path], a[e.path])) continue;
    out.push({
      key: e.key, path: e.path, label: e.label, category: e.category,
      scope: e.scope || 'global', from: b[e.path], to: a[e.path],
    });
  }
  return out;
}

/**
 * Reset a domain to its catalogue defaults, reporting which entries will change
 * (109.md §43 — "show which settings will change", never a silent wipe).
 * @returns {{next: object, changes: Array}}
 */
export function resetDomainToDefaults(domain, current) {
  const next = defaultsForDomain(domain);
  return { next, changes: diffDomainValues(domain, current, next) };
}

/**
 * Free-text search across the catalogue (109.md §44). Matches label, description,
 * rationale/notes, category label, the internal key, the env variable name and an
 * optional `aliases` list — the aliases exist so a search for a CONCEPT finds a
 * control whose own wording never says the word (searching "undo" must surface
 * the Ctrl+Y redo alias, which is only ever described in terms of redo).
 * Returns `{kind:'flag'|'setting', entry}` rows.
 */
export function searchCatalog(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const catLabel = (id) => (CATALOG_CATEGORIES.find((c) => c.id === id) || {}).label || '';
  const hit = (...parts) => parts.flat().filter(Boolean).join(' ').toLowerCase().includes(q);
  const rows = [];
  for (const f of VISIBLE_FLAGS) {
    if (hit(f.key, f.label, f.description, f.aliases || [], 'feature flag')) rows.push({ kind: 'flag', entry: f });
  }
  for (const e of OPS_SETTINGS) {
    if (hit(e.key, e.label, e.description, e.rationale, e.note, e.envVar, e.aliases || [], catLabel(e.category))) {
      rows.push({ kind: 'setting', entry: e });
    }
  }
  return rows;
}

/** Catalogue entries grouped by category, in CATALOG_CATEGORIES order. */
export function catalogByCategory() {
  return CATALOG_CATEGORIES.map((c) => ({
    ...c, entries: OPS_SETTINGS.filter((e) => e.category === c.id),
  }));
}

/** Every SiteSetting domain the catalogue can write. */
export const WRITABLE_DOMAINS = Object.freeze([...new Set(
  OPS_SETTINGS.filter(isWritable).map((e) => e.domain),
)]);

export default OPS_SETTINGS;
