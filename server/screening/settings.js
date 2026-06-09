/**
 * server/screening/settings.js
 * Single source of truth for the admin-controlled META·SIFT module settings.
 * The screening handlers consult these to ENFORCE the admin toggles that were
 * previously stored-but-ignored (allowImport / allowExport / allowDuplicateDetection
 * / allowConflictResolution / allowNewProjects / maxRecordsPerProject).
 */
import { prisma } from '../db/client.js';

export const SETTINGS_KEY = 'metaSiftSettings';

export const META_SIFT_DEFAULTS = {
  enabled: true,
  badgeText: 'BETA',
  allowNewProjects: true,
  allowImport: true,
  allowExport: true,
  allowDuplicateDetection: true,
  allowConflictResolution: true,
  maxRecordsPerProject: 10000,
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
