import { prisma } from '../db/client.js';
import { ROB_DEFAULTS } from './robAdminController.js';
import { defaultThemeSettings } from '../utils/themeValidate.js';

// Default settings keys and their initial JSON-serialised values
const DEFAULTS = {
  // prompt37 — global brand/theme. brandColor drives the whole UI accent; the
  // generated `palette` (day/night × acc/acc2/accText/accBg) is produced by the
  // admin client and stored verbatim (every value strictly validated as hex).
  // Default = the original indigo, palette null (frontend uses stylesheet base).
  themeSettings: JSON.stringify(defaultThemeSettings()),
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
    defaultTheme: 'night',                 // site-wide default theme for new visitors
    maintenanceMessage: 'PecanRev is temporarily down for maintenance. Please check back soon.',
    exportFormats: ['png', 'svg', 'csv', 'json', 'ris', 'xls'],
    projectDeletion: 'soft',               // deletion policy (read-mostly; hard delete disabled)
  }),
  landingContent: JSON.stringify({
    heroHeadline: 'A serious workspace for systematic reviews and meta-analysis.',
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
      where: { key: { in: ['appSettings', 'landingContent', 'featureFlags', 'onboardingSettings', 'robSettings', 'themeSettings'] } },
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
    for (const key of ['appSettings', 'landingContent', 'featureFlags']) {
      if (!result[key]) {
        try {
          result[key] = JSON.parse(DEFAULTS[key]);
        } catch {
          result[key] = {};
        }
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

    // prompt9 — additive top-level conveniences for the frontend ThemeContext
    // and maintenance banner (existing consumers of the nested keys unaffected).
    return res.json({
      ...result,
      defaultTheme: result.appSettings?.defaultTheme || 'night',
      maintenanceMessage: result.appSettings?.maintenanceMessage || appDefaults.maintenanceMessage || '',
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
