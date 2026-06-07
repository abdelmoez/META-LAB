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

    return res.json(result);
  } catch (err) {
    console.error('[settings] getPublicSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
