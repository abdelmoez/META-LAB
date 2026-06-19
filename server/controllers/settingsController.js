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
    appName: 'META·LAB',
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
    maintenanceMessage: 'META·LAB is temporarily down for maintenance. Please check back soon.',
    exportFormats: ['png', 'svg', 'csv', 'json', 'ris', 'xls'],
    projectDeletion: 'soft',               // deletion policy (read-mostly; hard delete disabled)
  }),
  landingContent: JSON.stringify({
    heroHeadline: 'A serious workspace for systematic reviews and meta-analysis.',
    heroSubtitle:
      'Organize evidence, extract data, run pooled analyses, and export research-ready reports — all in one secure platform.',
    ctaText: 'Start Your Review',
    aboutText:
      'META·LAB is built for researchers who take systematic evidence synthesis seriously.',
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
  }),
};

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
