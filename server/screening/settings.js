/**
 * server/screening/settings.js
 * Single source of truth for the admin-controlled META·SIFT module settings.
 * The screening handlers consult these to ENFORCE the admin toggles (import /
 * export / pdf upload / chat / duplicate detection / conflict resolution /
 * second review / new projects / quorum / blind default / max PDF size /
 * maxRecordsPerProject).
 *
 * IMPORTANT: this is the ONE place defaults live. screeningAdminController.js
 * imports META_SIFT_DEFAULTS from here — do not re-declare them elsewhere.
 */
import { prisma } from '../db/client.js';

export const SETTINGS_KEY = 'metaSiftSettings';

export const META_SIFT_DEFAULTS = {
  enabled: true,
  badgeText: 'BETA',
  // ── feature toggles ────────────────────────────────────────────────
  allowNewProjects: true,
  allowImport: true,
  allowExport: true,
  allowPdfUpload: true,
  allowDuplicateDetection: true,
  allowConflictResolution: true,
  allowChat: true,
  allowSecondReview: true,
  // ── screening policy ───────────────────────────────────────────────
  requireTwoReviewers: true,   // when true, a single include never promotes
  minIncludeQuorum: 2,         // distinct includes required to reach 2nd review
  defaultBlindMode: false,     // applied to newly created projects
  // ── open-access PDF retrieval (roadmap 1.4) ────────────────────────
  // Default OFF: no outbound provider calls happen until an admin enables it.
  // Only legitimately open-access PDFs are fetched (Unpaywall/OpenAlex is_oa,
  // CrossRef only with an explicit open licence). Emails/tuning come from env
  // (UNPAYWALL_EMAIL, OPENALEX_EMAIL, OA_PDF_CACHE_TTL_HOURS, …).
  autoPdfRetrieval: false,
  oaProviderPriority: ['unpaywall', 'openalex', 'crossref'],
  // ── limits ─────────────────────────────────────────────────────────
  maxPdfSizeMb: 25,
  maxRecordsPerProject: 10000,
  inviteExpiryDays: 14,        // prompt9 — pending-invite token validity window
  maintenanceMessage: 'META·SIFT Beta is currently undergoing maintenance. Please try again later.',
};

export async function getMetaSiftSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row) return { ...META_SIFT_DEFAULTS };
    return { ...META_SIFT_DEFAULTS, ...JSON.parse(row.value || '{}') };
  } catch {
    return { ...META_SIFT_DEFAULTS };
  }
}

/**
 * Effective include quorum: admin-configurable, but never below 2 when
 * requireTwoReviewers is on (the product's two-reviewer guarantee).
 */
export async function getEffectiveQuorum() {
  const s = await getMetaSiftSettings();
  const n = Number.isFinite(s.minIncludeQuorum) ? s.minIncludeQuorum : 2;
  return s.requireTwoReviewers ? Math.max(2, n) : Math.max(1, n);
}
