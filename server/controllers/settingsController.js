import { prisma } from '../db/client.js';
import { ROB_DEFAULTS } from './robAdminController.js';
import { defaultThemeSettings } from '../utils/themeValidate.js';
// 94.md — non-secret auth surface availability for the public settings payload.
import { googleOidc } from '../auth/googleOidc.js';
import { turnstilePublicSiteKey } from '../security/turnstile.js';
// P10 — global (admin) eligibility-screening policy. Handlers below mirror the AI
// screening admin GET/PUT (screeningAiAdminController.js) and reuse the service's
// defaults + coercion. The two routes are mounted in server/routes/admin.js.
import {
  ELIGIBILITY_SETTINGS_KEY, ELIGIBILITY_GLOBAL_DEFAULTS,
  getGlobalEligibilitySettings, saveGlobalEligibilitySettings,
} from '../services/screeningEligibilityService.js';
// 109.md §3 — the typed Ops settings catalogue. It owns the DEFAULTS for the new
// researchGovernanceSettings block, the whitelist coercion for its PUT and the
// per-setting audit diff, so none of those are hand-copied here.
import {
  RESEARCH_GOVERNANCE_KEY, defaultsForDomain, mergeDomainDefaults,
  coerceDomainPatch, diffDomainValues, resetDomainToDefaults,
} from '../../src/shared/opsSettingsCatalog.js';

/**
 * 113 §4 r2 — THE LANDING <h1>, and why it lives here.
 *
 * Landing.jsx renders `settings.heroHeadline || DEFAULTS.heroHeadline`, and
 * GET /api/settings/public ALWAYS supplies a heroHeadline (from the stored row, or
 * from the default below when the row predates the key). The client-side default is
 * therefore dead in production: THIS string, or a stored one, is the H1 every
 * visitor and every crawler actually sees. 113 changed the brand headline in
 * Landing.jsx alone, which is why the change never reached the live page.
 *
 * MUST stay byte-identical to DEFAULTS.heroHeadline in src/frontend/pages/Landing.jsx
 * (and to the copies in server/scripts/init-settings.js and Ops › Content's
 * DEFAULT_CONTENT). tests/unit/seo/landingHeroHeadline.test.js pins all four.
 * The `\n` is intentional: the h1 sets `white-space: pre-line`.
 */
export const LANDING_HERO_HEADLINE =
  'PecanRev: from screening to meta-analysis,\none clean workspace for systematic reviews.';

/**
 * Headlines this product once SHIPPED AS THE DEFAULT — never anything an admin
 * typed. `initDefaultSettings()` deliberately never overwrites an existing row, so
 * bumping LANDING_HERO_HEADLINE alone would leave every deployment that has ever
 * booted serving the old copy forever. getPublicSettings() remaps a stored value
 * that is BYTE-EQUAL to one of these to the current default; anything else — any
 * genuine customisation, including a one-character edit of these — is served
 * verbatim. Append here (never edit in place) whenever the default changes again.
 */
export const LEGACY_HERO_HEADLINES = [
  // Seeded by DEFAULTS below / server/scripts/init-settings.js before 113.
  'A serious workspace for systematic reviews and meta-analysis.',
  // Ops › Content's own DEFAULT_CONTENT before 113 — this reaches the DB whenever an
  // admin opened the content editor and saved without touching the headline.
  'A serious workspace for\nsystematic reviews.',
];

// Default settings keys and their initial JSON-serialised values
const DEFAULTS = {
  // prompt37 — global brand/theme. brandColor drives the whole UI accent; the
  // generated `palette` (day/night × acc/acc2/accText/accBg) is produced by the
  // admin client and stored verbatim (every value strictly validated as hex).
  // Default = the original indigo, palette null (frontend uses stylesheet base).
  themeSettings: JSON.stringify(defaultThemeSettings()),
  // 65.md — Ops-governed UI design. `defaultMode` is the interface EVERY non-admin
  // renders (admins keep a personal ?ui=/saved chain). `allowLegacyFallback` OFF
  // (default) means users can never reach legacy — ON re-enables ?ui=legacy links +
  // saved preferences as an emergency escape. `allowAllUsers` is retained for
  // storage back-compat only and no longer gates rendering. Controlled from
  // Ops › Appearance; changes take effect without a redeploy.
  designSettings: JSON.stringify({ allowAllUsers: true, defaultMode: 'stitch', allowLegacyFallback: false }),
  appSettings: JSON.stringify({
    appName: 'PecanRev',
    registrationOpen: true,
    maintenanceMode: false,
    contactEnabled: true,
    projectCreationEnabled: true,
    exportEnabled: true,
    maxProjectsPerUser: null,
    maxStudiesPerProject: null,
    // ── prompt9 ops controls ──────────────────────────────────────────
    notificationsEnabled: true,            // global notification kill-switch
    emailInvitesEnabled: true,             // outbound invite emails on/off
    // prompt26 — email verification. OFF by default (SMTP not configured yet).
    // When true: new users are created unverified, a hashed/expiring verify token
    // is emailed, and login is blocked until verified. Admin toggles it in Ops.
    requireEmailVerification: false,
    // ── 93.md §9.1 beta cohort controls ───────────────────────────────────
    // invitationsPaused — emergency brake: when true, the single/bulk/resend
    // waitlist-invitation admin endpoints refuse with 409 INVITATIONS_PAUSED
    // (revoke stays available). Toggled from Ops › Beta Waitlist; audited via
    // the standard UPDATE_SETTING admin action.
    invitationsPaused: false,
    // maxActiveInvitations — optional cap on concurrently ACTIVE (pending,
    // unexpired) account invitations. null = unlimited. Invites that would
    // exceed the cap are refused with a clear 409 (INVITE_CAP_REACHED).
    maxActiveInvitations: null,
    defaultTheme: 'night',                 // site-wide default theme for new visitors
    maintenanceMessage: 'PecanRev is temporarily down for maintenance. Please check back soon.',
    exportFormats: ['png', 'svg', 'csv', 'json', 'ris', 'xls'],
    projectDeletion: 'soft',               // deletion policy (read-mostly; hard delete disabled)
  }),
  landingContent: JSON.stringify({
    heroHeadline: LANDING_HERO_HEADLINE,
    heroSubtitle:
      'Organize evidence, extract data, run pooled analyses, and export research-ready reports — all in one secure platform.',
    ctaText: 'Start Your Review',
    aboutText:
      'PecanRev is built for researchers who take systematic evidence synthesis seriously.',
    footerText: 'Systematic review platform · Research use only',
    announcementBanner: null,
    maintenanceBanner: null,
  }),
  featureFlags: JSON.stringify({
    autosave: true,
    contactForm: true,
    projectDuplication: true,
    advancedMetaAnalysis: true,
    exportTools: true,
    // roadmap 0.2 — relational ReviewRecord/ReviewStudy backing for META·LAB
    // projects. Default OFF: dual-write/read-switch only activate at the
    // evaluation gate. With it off, the Project.data JSON blob is the sole
    // source of truth (current behaviour, unchanged).
    relationalProjectStore: false,
    // rob.md — META·LAB RoB (Risk of Bias) engine v1 (RoB 2). Default OFF: the
    // /api/rob endpoints 404 and the workspace UI is hidden until an admin
    // enables this from Ops › Feature Flags after the evaluation gate passes.
    rob_engine_v2: false,
    // P14 — Guided RoB appraisal (RoB 2 + ROBINS-I). Default OFF. When ON, the
    // /api/rob/assessments/:id/appraise and /api/rob/projects/:pid/rob-validation
    // endpoints activate: a DETERMINISTIC engine reads the study text (linked
    // screening title/abstract + client-supplied full text) and SUGGESTS each
    // signalling-question answer with an evidence quote + confidence — a machine
    // PROPOSAL only. Suggestions are stored on RobAnswer (aiSuggested) and drive
    // RobDomainJudgment.proposedJudgment; they NEVER overwrite a human decision
    // (finalJudgment / overridden). FUNCTIONALLY DEPENDS ON `rob_engine_v2`: both
    // must be ON, so this flag is inert while the RoB engine is off. Surfaces in
    // Ops › Flags automatically.
    guidedRobAppraisal: false,
    // prompt38 — server-backed per-module workflow state. Default OFF: the
    // /api/workspaces/:id/modules/:key/state endpoints 404 and the monolith keeps
    // using the whole-project blob autosave. When ON, migrated modules (protocol)
    // load/save per-module with revision-based conflict detection.
    serverBackedWorkflowState: false,
    // SearchEngine — the separated concept→multi-database Search Builder engine.
    // Default OFF: /api/search-builder/* endpoints 404 and the monolith keeps the
    // legacy SearchTab. When ON, the new SearchBuilderTab renders (NLM-backed MeSH
    // lookup + live PubMed counts) and persists per project (module 'search').
    searchEngine: false,
    // p1.md — Pecan Search Engine (P1). Default OFF: the /api/pecan-search/*
    // endpoints 404 and the Search & Discovery workspace tab is hidden. When ON,
    // a user can execute a Boolean strategy against open bibliographic providers
    // (PubMed, Europe PMC, ClinicalTrials.gov, Crossref, DOAJ, OpenAlex, Semantic
    // Scholar), auto-import + deduplicate the results into screening, and generate
    // a PRISMA-S search report. Per-provider enable + caps live in the separate
    // `searchProviderSettings` block (Ops › Search Providers). Manual file import
    // stays available regardless of this flag.
    pecanSearch: false,
    // screeningEngin.md — PecanRev Screening Intelligence Engine. Default OFF: the
    // /api/screening/projects/:pid/ai/* endpoints 404 and the screening workbench
    // shows no AI surfaces. When ON, the deterministic TF-IDF + active-learning
    // relevance engine scores/ranks/explains records (human decisions unchanged).
    aiScreening: false,
    // prompt48 — Beta Waitlist landing page. Default OFF: `/` shows the existing
    // PecanRev landing page. When ON, an UNAUTHENTICATED visitor to `/` sees the
    // Beta Waitlist page instead (authenticated users keep their normal landing /
    // workspace redirect). The waitlist APIs + Ops tab are independent of this
    // flag; the flag ONLY controls which public homepage unauthenticated visitors
    // see. Stored in the same featureFlags SiteSetting; takes effect without a
    // redeploy and surfaces in Ops › Flags automatically.
    betaWaitlist: false,
    // p2.md — Network Meta-Analysis (NMA) engine (P2). Default OFF: the /api/nma/*
    // endpoints 404 and the Network Meta-Analysis workspace tab is hidden. When ON,
    // a project can build a multi-arm treatment network and run the frequentist NMA
    // (league table, P-score ranking, network geometry, node-split + global
    // inconsistency, contribution matrix). The deterministic engine runs server-side
    // on user-supplied arm/contrast data (no project data leaves the server).
    networkMetaAnalysis: false,
    // 64.md (P3) — Manuscript Editor + one-click Word export + auto-PRISMA +
    // updatable tables. Default OFF: the project "Manuscript" tab keeps rendering
    // the legacy textarea drafter. When ON, the tab renders the full manuscript
    // workspace (structured IMRAD editor, data-linked tables, citation engine,
    // inline PRISMA 2020 diagram, .docx export, PRISMA/PRISMA-S checklists and a
    // reproducibility .zip). All artifacts are generated client-side from the
    // project's live data — no manuscript content leaves the browser and no heavy
    // export work runs on the server. Surfaces in Ops › Flags automatically.
    manuscriptEditor: false,
    // 66.md (P5) — structured data extraction: element forms, dual extraction with
    // adjudication, provenance-first values, AI extraction ASSIST (suggestions only —
    // human review is mandatory, nothing auto-commits). Default OFF: the Extraction
    // tab keeps its classic table until an admin enables this.
    extractionAssist: false,
    // 76.md — the Pecan Extraction Engine: a full-screen, article-centred extraction
    // workspace (article list with statuses/progress/filters → split PDF + form with
    // three methods, per-value provenance + jump-to-source, honest save status,
    // validation tiers, completion/reopen with audit, and analysis-sync status).
    // Default OFF: the Extraction tab keeps its current split-screen workspace until
    // an admin enables this. Independent of extractionAssist (reads the project blob).
    extractionEngine: false,
    // 88.md — Research Provenance: the append-only, project-wide event ledger
    // (search/screening/extraction/RoB/analysis/manuscript) with deterministic
    // scientific-significance + manuscript-relevance classification, a Project
    // History tab, and honest baselines for legacy projects. Default OFF: the API
    // (/api/provenance) 404s (existence-hidden) and the History tab is not surfaced
    // until an admin enables this. Server-side event capture runs best-effort even
    // when off is irrelevant — capture only activates via the flag-gated surfaces
    // and the atomic writer, so a dark flag means zero behavioural change. Requires
    // the ProjectEvent table (prisma db push) to have any effect.
    researchProvenance: false,
    // OPTIONAL server-proxied LLM extraction for the unified extraction
    // workspace. Default OFF: POST /api/ai-extract 404s (existence-hidden) and
    // GET /api/ai-extract/status reports available:false. When ON (and
    // ANTHROPIC_API_KEY is configured server-side), a user can send a PDF or
    // pasted article text to the server, which makes ONE model call and returns
    // a validated, whitelisted study patch (ratio measures log-transformed with
    // a conversions[] audit record; everything mapped is flagged needsReview —
    // human sign-off mandatory, nothing auto-commits). Deterministic features
    // are never labeled AI; this flag governs the app's one real model call.
    // Admin-toggleable exactly like extractionAssist.
    aiExtraction: false,
    // 66.md (P6) — living reviews: scheduled saved searches re-run through Pecan
    // Search, "new since last run" screening queue with AI pre-scoring, versioned
    // review snapshots and cautious evidence-shift alerts. Default OFF. Automated
    // re-runs additionally require pecanSearch (+ searchEngine); manual snapshots
    // and the dashboard work without them.
    livingReview: false,
    // 68.md (P8) — public shareable synthesis pages + embeddable dashboards.
    // Default OFF. Even when ON, every project is PRIVATE until its owner/leader
    // explicitly publishes; public pages serve only a sanitized snapshot DTO.
    publicSynthesis: false,
    // 68.md (P9) — automated open-access full-text retrieval (Unpaywall /
    // OpenAlex / Europe PMC / ClinicalTrials.gov) + bulk PDF upload matching.
    // Default OFF. Only legal OA PDFs are fetched; no paywall bypassing.
    fullTextRetrieval: false,
    // P10 — Criteria-based eligibility screening. Default OFF: the
    // /api/screening/projects/:pid/eligibility/* endpoints 404 (existence-hidden)
    // and the eligibility surfaces are hidden. When ON, a project defines versioned
    // inclusion/exclusion CRITERIA and a deterministic engine answers each per record
    // (yes/no/unclear + evidence) and proposes include/exclude — reviewable,
    // reversible, audited. Governed auto-apply additionally requires a per-project
    // opt-in AND the global killSwitch to be off; it never overwrites a human
    // decision. Surfaces in Ops › Flags automatically.
    eligibilityScreening: false,
    // P11 — Guided Boolean search-strategy Studio (generator↔critic loop with REAL
    // per-DB hit counts + seed-based recall estimation + PRISMA-S search
    // documentation). Default OFF: the /api/search-builder/projects/:pid/strategy/*,
    // /seed-studies, /recall-estimate and /strategy/prisma-s endpoints 404
    // (existence-hidden). This flag FUNCTIONALLY DEPENDS ON `searchEngine` (stored
    // concepts) + `pecanSearch` (the real connector hit counts): the studio gate
    // requires all three ON, so it is inert without its dependencies regardless of how
    // the flags are toggled. Surfaces in Ops › Flags automatically.
    searchStrategyStudio: false,
    // P12 — GRADE certainty of evidence + Summary of Findings. Default OFF: the
    // /api/grade/projects/:pid/* endpoints 404 (existence-hidden) and the new
    // per-outcome GRADE surfaces are hidden — the legacy blob-based (primary-outcome
    // only) GRADE tab is unaffected. When ON, each outcome gets its own audited,
    // lockable certainty assessment: the deterministic engine SUGGESTS domain ratings
    // (risk of bias, inconsistency, indirectness, imprecision, publication bias) from
    // the meta-analysis + RoB, but nothing is final until a reviewer saves it, and a
    // Summary-of-Findings table can be exported (json/csv/html). Surfaces in Ops ›
    // Flags automatically.
    gradeCertainty: false,
    // P13 — meta-regression + bubble plots. Default OFF: the /api/meta/metareg
    // endpoint 404s (existence-hidden) and the meta-regression analysis surface is
    // hidden. When ON, a random-effects (mixed-effects) meta-regression runs
    // server-side on the project's studies + a study-level covariate (method of
    // moments / DerSimonian–Laird residual or REML), returning coefficients, τ²
    // reduction, R², residual heterogeneity and bubble-plot geometry (points +
    // regression line + 95% CI band). Deterministic pure engine; no project data
    // leaves the server. Surfaces in Ops › Flags automatically.
    metaRegression: false,
    // P15 — Bibliomine citation mining. Default OFF: the /api/citation-mining/*
    // endpoints 404 (existence-hidden) and the citation-mining surfaces are hidden.
    // When ON, a project can upload prior reviews' reference lists (client-extracted
    // text), parse + resolve those references against public bibliographic providers,
    // chase backward (cited references) and forward (citing works) citations through
    // a bounded, cancellable durable worker, and import the deduplicated candidates
    // into screening with full provenance (a source:'citation-mining' import batch).
    // Only legal metadata / open-access sources are used (no paywall bypass). Live
    // external resolution is additionally gated by CITATION_MINING_LIVE_RESOLVE=1
    // (default off → deterministic offline resolution, no external calls). Surfaces
    // in Ops › Flags automatically.
    citationMining: false,
    // ── 109.md §5 — 107/108 research-workflow flags. ALL DEFAULT **true**. ──────
    // These gate behaviour that already SHIPPED (v4.12/v4.13); defaulting them OFF
    // would silently regress every existing install on upgrade, so each is an
    // operator kill switch rather than a rollout gate. Turning one off hides the
    // affordance and stops new writes — it NEVER deletes the keywords, decisions or
    // history it governs. Full label/description text lives once, in
    // src/shared/opsSettingsCatalog.js OPS_FLAGS (the Ops UI + the drift gate read
    // it there); keep this block and the catalogue in sync — the unit test
    // tests/unit/opsSettingsCatalog.test.js fails the build if they diverge.
    //
    // keywordSuggestions        — generated inclusion/exclusion keyword suggestions.
    // abstractKeywordShortcuts  — Ctrl/Cmd+I / Ctrl/Cmd+E on an abstract selection.
    //   The flag gates AVAILABILITY only; the contextual guard chain (valid
    //   selection, active abstract, screening owns the shortcut, not editing, action
    //   can complete) is NEVER bypassed — 109.md §17 / 108 invariant 3.
    // keywordContextMenu        — right-click actions on manually added keywords.
    // projectUndoRedo           — the page-scoped project history + undo/redo chords.
    keywordSuggestions: true,
    abstractKeywordShortcuts: true,
    keywordContextMenu: true,
    projectUndoRedo: true,
    // 96.md — DEPRECATED/IGNORED. 71.md introduced this flag to gate the staged
    // SearchWorkspace against the legacy 3-step SearchWizard; 96.md retired the
    // wizard, and the workspace now renders whenever `searchEngine` is ON — the
    // dispatcher and searchWorkspaceV2FlagEnabled() no longer read this key. It
    // stays in DEFAULTS only so stored SiteSetting rows keep parsing (never remove
    // a key from stored-settings compat).
    searchWorkspaceV2: false,
  }),
  // 66.md P5 — global (admin) AI-extraction policy. requireHumanValidation is a
  // hard product rule (suggestions can never auto-commit) surfaced here read-only.
  extractionAiSettings: JSON.stringify({
    enabled: true,                 // master switch WITHIN the extractionAssist flag
    provider: 'heuristic',         // heuristic (self-hosted, deterministic) | external (env-configured LLM)
    requireHumanValidation: true,  // LOCKED true — AI suggestions never auto-commit
    dualExtractionDefault: false,  // new studies default to single extraction
    tableParsingEnabled: true,
  }),
  // 66.md P6 — global (admin) living-review policy.
  livingReviewSettings: JSON.stringify({
    schedulerEnabled: true,        // master switch WITHIN the livingReview flag
    allowedCadences: ['manual', 'daily', 'weekly', 'monthly'],
    maxSavedSearchesPerProject: 5,
    snapshotRetention: 100,        // max snapshots kept per project (oldest pruned)
    evidenceShift: { relEffectChange: 0.25, i2Change: 20, minK: 2 },
  }),
  // screeningEngin.md — global (admin) AI screening policy. Surfaced in Ops ›
  // AI Screening. Additive SiteSetting; merged with AI_GLOBAL_DEFAULTS server-side.
  aiScreeningSettings: JSON.stringify({
    enabled: true,
    embeddingProvider: 'lexical',     // lexical | hashing | hosted
    maxRecordsPerRun: 5000,
    requireHumanFinalDecision: true,
    allowReviewersToRun: false,
    includeThreshold: 0.65,
    excludeThreshold: 0.35,
    defaultPolicy: 'assist',
    liveUpdateEnabled: true,          // se2.md §6 — rescore on new decisions
    retrainDebounceMs: 4000,
    killSwitch: false,                // se2.md §4 — emergency global disable
  }),
  // P10 — global (admin) eligibility-screening policy (Ops › Eligibility). Governs
  // whether governed auto-apply may run and the confidence gates it requires. The
  // engine never commits a human decision; auto-apply is additionally per-project
  // opt-in and can be killed globally here. Additive SiteSetting; merged with
  // ELIGIBILITY_GLOBAL_DEFAULTS server-side (see screeningEligibilityService.js).
  eligibilityScreeningSettings: JSON.stringify({
    enabled: true,                 // master switch WITHIN the eligibilityScreening flag
    defaultPolicy: 'assist',       // assist (suggest only) | auto (governed auto-apply)
    includeConfidence: 0.85,       // min decisionConfidence to auto-apply an INCLUDE
    excludeConfidence: 0.85,       // min decisionConfidence to auto-apply an EXCLUDE
    autoApplyRequiresNoHumanDecision: true, // never auto-apply over a human decision
    maxRecordsPerRun: 5000,
    inlineMaxRecords: 25,          // scopes at/under this size may evaluate inline (else queued)
    killSwitch: false,             // emergency global disable of governed auto-apply
  }),
  // p1.md — Pecan Search Engine non-secret policy block (Ops › Search Providers).
  // API keys NEVER live here — they stay in server env (redacted). Additive
  // SiteSetting; merged with ENGINE_DEFAULTS + PROVIDER_REGISTRY server-side.
  searchProviderSettings: JSON.stringify({
    defaultResultCap: 2000,
    maxResultCap: 10000,
    concurrency: 3,
    retryLimit: 4,
    requestTimeoutMs: 20000,
    previewThrottleMs: 1500,
    pageDelayMs: 0,
    institutionalMode: false,
    providers: {
      pubmed: { enabled: true },
      europepmc: { enabled: true },
      clinicaltrials: { enabled: true },
      crossref: { enabled: true },
      doaj: { enabled: true },
      openalex: { enabled: true },
      semanticscholar: { enabled: true },
    },
  }),
  // 109.md §3 — research-governance policy for the 107/108 systems (screening
  // navigation, keyword intelligence, keyboard/history, proportion display,
  // analysis-override policy). ADDITIVE SiteSetting; the shape is NOT hand-written
  // here — it is derived from the typed catalogue so the defaults, the coercion,
  // the audit diff and the Ops UI can never disagree. Merged under the stored row
  // by every reader (initDefaultSettings never overwrites), so a key added in a
  // later release lands on an existing install with its shipped default.
  [RESEARCH_GOVERNANCE_KEY]: JSON.stringify(defaultsForDomain(RESEARCH_GOVERNANCE_KEY)),
};

/**
 * The default featureFlags object (parsed). Exported so the admin + public
 * settings endpoints can MERGE these defaults under the stored row: flags added
 * to DEFAULTS *after* the featureFlags row was first created never reach the row
 * (initDefaultSettings never overwrites existing rows), so without this merge a
 * newly-added flag (e.g. `searchEngine`) is invisible in Ops and reads as absent.
 * Stored values always win; this only fills in keys the stored row is missing.
 */
export function defaultFeatureFlags() {
  try { return JSON.parse(DEFAULTS.featureFlags); } catch { return {}; }
}

/**
 * getEffectiveFeatureFlags() — the stored featureFlags row merged over the defaults
 * (stored values win), for SERVER-SIDE flag gating (e.g. `/api/nma`, `/api/pecan-search`).
 * Never throws; falls back to defaults on any error.
 */
export async function getEffectiveFeatureFlags() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    const stored = row ? JSON.parse(row.value) : {};
    return { ...defaultFeatureFlags(), ...stored };
  } catch { return defaultFeatureFlags(); }
}

/**
 * Initialize default SiteSettings on startup.
 * Only inserts rows that don't already exist (upsert with skipDuplicates-equivalent).
 * Non-blocking — call with .catch(console.error) from index.js.
 */
export async function initDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await prisma.siteSetting.upsert({
      where: { key },
      update: {}, // don't overwrite existing values
      create: { key, value },
    });
  }
  console.log('[settings] Default settings initialized.');
}

/**
 * GET /api/settings/public
 * Returns appSettings, landingContent, featureFlags — no auth required.
 */
export async function getPublicSettings(req, res) {
  try {
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: ['appSettings', 'landingContent', 'featureFlags', 'onboardingSettings', 'robSettings', 'themeSettings', 'designSettings', RESEARCH_GOVERNANCE_KEY] } },
    });

    const result = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }

    // Fill in defaults for any missing keys
    for (const key of ['appSettings', 'landingContent', 'featureFlags', 'designSettings']) {
      if (!result[key]) {
        try {
          result[key] = JSON.parse(DEFAULTS[key]);
        } catch {
          result[key] = {};
        }
      }
    }

    // 113 §4 r2 — LEGACY heroHeadline REMAP. See LEGACY_HERO_HEADLINES: a stored
    // value that is byte-equal to a headline we once shipped as the default was
    // never authored by a human, so serving the current default in its place is a
    // correction, not an override. A missing/blank headline is filled for the same
    // reason (Landing.jsx would otherwise fall back to the identical client copy).
    // Anything else is left exactly as the admin saved it.
    if (result.landingContent && typeof result.landingContent === 'object') {
      const storedHeadline = result.landingContent.heroHeadline;
      const isLegacyDefault = typeof storedHeadline !== 'string'
        || !storedHeadline.trim()
        || LEGACY_HERO_HEADLINES.includes(storedHeadline);
      if (isLegacyDefault) {
        result.landingContent = { ...result.landingContent, heroHeadline: LANDING_HERO_HEADLINE };
      }
    }

    // prompt32 — non-sensitive onboarding + RoB display config (the master kill
    // switches are still enforced server-side; this only drives UI defaults).
    result.onboardingSettings = { enabled: true, ...(result.onboardingSettings || {}) };
    result.robSettings = { ...ROB_DEFAULTS, ...(result.robSettings || {}) };

    // prompt37 — global brand theme for the public ThemeProvider (applies to the
    // logged-out landing page too). Defaults to the original indigo when unset.
    result.themeSettings = { ...defaultThemeSettings(), ...(result.themeSettings || {}) };

    // prompt9 — merge appSettings defaults so NEW keys (defaultTheme,
    // maintenanceMessage, …) are always present even when the stored row
    // predates them (initDefaultSettings never overwrites existing rows).
    let appDefaults = {};
    try { appDefaults = JSON.parse(DEFAULTS.appSettings); } catch { /* keep {} */ }
    if (result.appSettings && typeof result.appSettings === 'object') {
      result.appSettings = { ...appDefaults, ...result.appSettings };
    }

    // Merge per-flag defaults so flags ADDED after the stored row was first
    // created still surface (with their default value) to the frontend — same
    // reasoning as appSettings above. Stored flags win.
    result.featureFlags = { ...defaultFeatureFlags(), ...(result.featureFlags || {}) };

    // 65.md — merge designSettings defaults under the stored row so fields added
    // after the row was created (allowLegacyFallback) always reach the frontend
    // resolver with their shipped default. Stored values win.
    let designDefaults = {};
    try { designDefaults = JSON.parse(DEFAULTS.designSettings); } catch { /* keep {} */ }
    result.designSettings = { ...designDefaults, ...(result.designSettings || {}) };

    // 109.md §§3, 55 — the research-governance block rides the EXISTING public
    // settings payload rather than a new endpoint, so the client's shared
    // featureFlagState snapshot serves flags and these knobs from ONE fetch (the
    // repo already had ~14 independent /api/settings/public callers; adding a
    // fifteenth would be the wrong direction). Every value here is a non-sensitive
    // UI default — the enforcement for anything safety-related stays server-side.
    // Defaults merged UNDER the stored row so a newly-added key always surfaces.
    result[RESEARCH_GOVERNANCE_KEY] = mergeDomainDefaults(
      RESEARCH_GOVERNANCE_KEY, result[RESEARCH_GOVERNANCE_KEY],
    );

    // prompt9 — additive top-level conveniences for the frontend ThemeContext
    // and maintenance banner (existing consumers of the nested keys unaffected).
    return res.json({
      ...result,
      defaultTheme: result.appSettings?.defaultTheme || 'night',
      maintenanceMessage: result.appSettings?.maintenanceMessage || appDefaults.maintenanceMessage || '',
      // 94.md — env-derived, NON-SECRET auth surface config: the frontend shows
      // the Google button / Turnstile widget only when the backend can actually
      // serve them (no rebuild needed when keys are added — unlike VITE_* vars).
      googleAuthEnabled: googleOidc.enabled(),
      turnstileSiteKey: turnstilePublicSiteKey(),
    });
  } catch (err) {
    console.error('[settings] getPublicSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/settings/theme
 * Public, no auth — the global brand theme as a standalone record. The app's
 * ThemeProvider reads the brand via GET /api/settings/public (data.themeSettings)
 * and the index.html bootstrap applies the localStorage-cached palette pre-paint;
 * this dedicated endpoint exists for clarity/tooling and returns the same record.
 * Always returns a valid record (falls back to the default indigo).
 */
export async function getThemeSettings(req, res) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'themeSettings' } });
    let stored = {};
    if (row) {
      try { stored = JSON.parse(row.value); } catch { stored = {}; }
    }
    return res.json({ ...defaultThemeSettings(), ...stored });
  } catch (err) {
    console.error('[settings] getThemeSettings error:', err.message);
    // Never break theming — degrade to the default rather than 500.
    return res.json(defaultThemeSettings());
  }
}

/**
 * GET /api/admin/eligibility-screening/settings  (admin-only)
 * P10 — the global eligibility-screening policy. Mirrors getAiScreeningSettings.
 * Mount in server/routes/admin.js:
 *   router.get('/eligibility-screening/settings', requireAdmin, getEligibilityScreeningSettings);
 *   router.put('/eligibility-screening/settings', requireAdmin, updateEligibilityScreeningSettings);
 */
export async function getEligibilityScreeningSettings(req, res) {
  try {
    const settings = await getGlobalEligibilitySettings();
    return res.json({ settings, defaults: ELIGIBILITY_GLOBAL_DEFAULTS });
  } catch (err) {
    console.error('[settings] getEligibilityScreeningSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   109.md §§3, 42, 43 — the research-governance settings block.

   The house pattern (researchOpsAdminController) is: hand-write a coerce*()
   whitelister per domain, save, then audit `{next}`. This block keeps the same
   shape but drives coercion AND the audit diff from the typed catalogue, which
   is what closes the §42 gap — the previous settings writers logged only WHICH
   keys changed, never their values, so "restore the previous value" was
   impossible to reconstruct from the ledger.

   Routes (mount behind requireAdmin in server/routes/admin.js):
     GET    /api/admin/research-governance/settings
     PUT    /api/admin/research-governance/settings
     POST   /api/admin/research-governance/settings/reset
   ══════════════════════════════════════════════════════════════════════════ */

/** Read the stored governance blob merged under the catalogue defaults. */
export async function readResearchGovernance() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: RESEARCH_GOVERNANCE_KEY } });
    let stored = {};
    if (row) { try { stored = JSON.parse(row.value); } catch { stored = {}; } }
    return mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, stored);
  } catch {
    return defaultsForDomain(RESEARCH_GOVERNANCE_KEY);
  }
}

async function writeResearchGovernance(value, userId) {
  await prisma.siteSetting.upsert({
    where: { key: RESEARCH_GOVERNANCE_KEY },
    create: { key: RESEARCH_GOVERNANCE_KEY, value: JSON.stringify(value), updatedBy: userId || null },
    update: { value: JSON.stringify(value), updatedBy: userId || null },
  });
}

/**
 * Build the audit details for a settings write. `changes` is the rich
 * catalogue-labelled diff; `before`/`after` are the flat maps that
 * auditFormat.extractChanges() already renders in the Ops Security table without
 * needing a new renderer. Scope is recorded per 109.md §42.
 */
function settingsAuditDetails(domain, changes) {
  const before = {}; const after = {};
  for (const c of changes) { before[c.key] = c.from; after[c.key] = c.to; }
  return {
    domain, scope: 'global',
    updatedKeys: changes.map((c) => c.key),
    changes, before, after,
  };
}

/** A caller-supplied change reason (109.md §42). Trimmed; never required here. */
function auditReason(req) {
  const r = req?.body?.reason;
  return typeof r === 'string' && r.trim() ? r.trim().slice(0, 500) : undefined;
}

/** GET /api/admin/research-governance/settings  (admin-only) */
export async function getResearchGovernanceSettings(req, res) {
  try {
    const settings = await readResearchGovernance();
    // `defaults` alongside `settings` mirrors getEligibilityScreeningSettings and
    // is what the Ops UI needs to render "differs from default" + a reset preview.
    return res.json({ settings, defaults: defaultsForDomain(RESEARCH_GOVERNANCE_KEY) });
  } catch (err) {
    console.error('[settings] getResearchGovernanceSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/admin/research-governance/settings  (admin-only)
 * Body: a patch keyed by catalogue key OR stored path, plus an optional `reason`.
 * Read-merge-write: keys the caller omits keep their stored value, so two admins
 * editing different sections cannot clobber each other the way the whole-blob
 * settings PUT does.
 */
export async function updateResearchGovernanceSettings(req, res) {
  try {
    const body = { ...(req.body || {}) };
    delete body.reason; // the audit reason is metadata, not a setting
    const current = await readResearchGovernance();
    const { next, changed, rejected } = coerceDomainPatch(RESEARCH_GOVERNANCE_KEY, body, current);
    if (rejected.length && changed.length === 0) {
      return res.status(400).json({ error: 'No valid settings provided', rejected });
    }
    const changes = diffDomainValues(RESEARCH_GOVERNANCE_KEY, current, next);
    if (changes.length) {
      await writeResearchGovernance(next, req.user?.id);
      try {
        const { logAdminAction } = await import('../utils/audit.js');
        await logAdminAction(
          req, 'UPDATE_RESEARCH_GOVERNANCE', 'SiteSetting', RESEARCH_GOVERNANCE_KEY,
          settingsAuditDetails(RESEARCH_GOVERNANCE_KEY, changes), { reason: auditReason(req) },
        );
      } catch { /* audit is best-effort and must never fail the write */ }
    }
    return res.json({
      ok: true, settings: next, defaults: defaultsForDomain(RESEARCH_GOVERNANCE_KEY), changed, rejected,
    });
  } catch (err) {
    console.error('[settings] updateResearchGovernanceSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/admin/research-governance/settings/reset  (admin-only) — 109.md §43.
 * `{ preview: true }` returns the list of settings that WOULD change without
 * writing anything, so the confirmation modal can show them before the admin
 * commits. Resetting configuration never touches research data.
 */
export async function resetResearchGovernanceSettings(req, res) {
  try {
    const current = await readResearchGovernance();
    const { next, changes } = resetDomainToDefaults(RESEARCH_GOVERNANCE_KEY, current);
    if (req.body?.preview === true) {
      return res.json({ preview: true, changes, settings: current, defaults: next });
    }
    if (changes.length) {
      await writeResearchGovernance(next, req.user?.id);
      try {
        const { logAdminAction } = await import('../utils/audit.js');
        await logAdminAction(
          req, 'RESET_SETTINGS_GROUP', 'SiteSetting', RESEARCH_GOVERNANCE_KEY,
          settingsAuditDetails(RESEARCH_GOVERNANCE_KEY, changes), { reason: auditReason(req) },
        );
      } catch { /* best-effort */ }
    }
    return res.json({ ok: true, settings: next, defaults: next, changes });
  } catch (err) {
    console.error('[settings] resetResearchGovernanceSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/admin/eligibility-screening/settings  (admin-only) */
export async function updateEligibilityScreeningSettings(req, res) {
  try {
    const before = await getGlobalEligibilitySettings();
    const settings = await saveGlobalEligibilitySettings(req.body || {}, req.user?.id || null);
    try {
      const { logAdminAction } = await import('../utils/audit.js');
      const changed = Object.keys(settings).filter(k => before[k] !== settings[k]);
      await logAdminAction(req, 'UPDATE_ELIGIBILITY_SCREENING', 'SiteSetting', ELIGIBILITY_SETTINGS_KEY, { changed });
    } catch { /* audit best-effort */ }
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error('[settings] updateEligibilityScreeningSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
