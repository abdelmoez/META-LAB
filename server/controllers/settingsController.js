import { prisma } from '../db/client.js';

// Default settings keys and their initial JSON-serialised values
const DEFAULTS = {
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
      where: { key: { in: ['appSettings', 'landingContent', 'featureFlags'] } },
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
