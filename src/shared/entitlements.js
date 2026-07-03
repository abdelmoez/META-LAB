/**
 * src/shared/entitlements.js — the PRODUCT-TIER entitlement model (67.md).
 *
 * Pure data + pure functions, shared by the server (enforcement) and the client
 * (locked-state UX). NO network, NO DB.
 *
 * THREE separate access systems exist in PecanRev — never mix them:
 *   1. App/system role  (User.role: user | mod | admin)  — admin/mod BYPASS tiers.
 *   2. Project role     (ScreenProjectMember: owner/leader/reviewer/viewer) —
 *      still enforced AFTER a tier check passes (both must allow an action).
 *   3. Product tier     (this file) — feature access + usage limits for NORMAL users.
 *
 * Conventions:
 *   - boolean keys gate features; numeric keys are limits; -1 (UNLIMITED) = no cap.
 *   - Tier entitlement JSONs are PARTIAL: resolution merges a tier's values over
 *     the free-tier baseline, so a missing key never silently unlocks a feature.
 *   - The matrices below are PLACEHOLDER defaults (the business model is not
 *     final): admins edit the live values per tier in Ops → Tiers, and new keys
 *     added here reach existing DB rows through the defaults-merge.
 *
 * Adding a new entitlement =
 *   1. add the key to ENTITLEMENT_KEYS (label/kind/group for the Ops editor),
 *   2. add a default value per tier below,
 *   3. call requireEntitlement/requireLimit in the endpoint (server) and/or
 *      useEntitlements().has/limit in the component (client).
 */

export const UNLIMITED = -1;

/** Registry of every entitlement key (drives the Ops editor + docs). */
export const ENTITLEMENT_KEYS = [
  // Projects
  { key: 'projects.create',               kind: 'boolean', group: 'Projects',       label: 'Create projects' },
  { key: 'projects.maxActiveProjects',    kind: 'limit',   group: 'Projects',       label: 'Max active projects' },
  { key: 'projects.maxMembersPerProject', kind: 'limit',   group: 'Projects',       label: 'Max members per project' },
  // Screening
  { key: 'screening.import',              kind: 'boolean', group: 'Screening',      label: 'Import records' },
  { key: 'screening.maxRecordsPerProject',kind: 'limit',   group: 'Screening',      label: 'Max records per project' },
  { key: 'screening.export',              kind: 'boolean', group: 'Screening',      label: 'Export records' },
  { key: 'screening.aiScoring',           kind: 'boolean', group: 'Screening',      label: 'Guided screening' },
  { key: 'screening.validationMetrics',   kind: 'boolean', group: 'Screening',      label: 'Validation metrics' },
  { key: 'screening.benchmarkTools',      kind: 'boolean', group: 'Screening',      label: 'Benchmark tools' },
  // Extraction
  { key: 'extraction.manual',             kind: 'boolean', group: 'Extraction',     label: 'Manual extraction' },
  { key: 'extraction.aiAssist',           kind: 'boolean', group: 'Extraction',     label: 'Extraction assist' },
  { key: 'extraction.dualExtraction',     kind: 'boolean', group: 'Extraction',     label: 'Dual extraction + adjudication' },
  { key: 'extraction.tableParsing',       kind: 'boolean', group: 'Extraction',     label: 'Table parsing' },
  // Meta-analysis
  { key: 'metaAnalysis.basic',            kind: 'boolean', group: 'Meta-analysis',  label: 'Meta-analysis' },
  { key: 'metaAnalysis.advanced',         kind: 'boolean', group: 'Meta-analysis',  label: 'Advanced methods (trim-fill, Egger, influence)' },
  { key: 'metaAnalysis.nma',              kind: 'boolean', group: 'Meta-analysis',  label: 'Network meta-analysis' },
  // Manuscript
  { key: 'manuscript.editor',             kind: 'boolean', group: 'Manuscript',     label: 'Manuscript editor' },
  { key: 'manuscript.wordExport',         kind: 'boolean', group: 'Manuscript',     label: 'Word (.docx) export' },
  // Living reviews
  { key: 'livingReview.enabled',          kind: 'boolean', group: 'Living reviews', label: 'Living reviews' },
  { key: 'livingReview.maxSavedSearches', kind: 'limit',   group: 'Living reviews', label: 'Max saved searches' },
  { key: 'livingReview.scheduler',        kind: 'boolean', group: 'Living reviews', label: 'Scheduled re-runs' },
  // 72.md — subscription-foundation placeholders. The DATA MODEL supports these
  // now (per-tier values + Ops editor); full enforcement is wired incrementally
  // (see entitlementService + uploadLimit for the first connected limit).
  { key: 'projects.maxCollaborators',     kind: 'limit',   group: 'Projects',       label: 'Max collaborators' },
  { key: 'exports.maxPerMonth',           kind: 'limit',   group: 'Exports',        label: 'Max exports per month' },
  { key: 'search.maxRunsPerMonth',        kind: 'limit',   group: 'Search',         label: 'Max search runs per month' },
  { key: 'screening.maxRunsPerMonth',     kind: 'limit',   group: 'Screening',      label: 'Max screening runs per month' },
  { key: 'screening.guided',              kind: 'boolean', group: 'Screening',      label: 'Guided screening' },
  { key: 'citation.mining',               kind: 'boolean', group: 'Screening',      label: 'Citation mining' },
  { key: 'storage.maxMb',                 kind: 'limit',   group: 'Storage',        label: 'Max storage (MB)' },
  { key: 'synthesis.advanced',            kind: 'boolean', group: 'Meta-analysis',  label: 'Advanced synthesis' },
  { key: 'dashboard.sharing',             kind: 'boolean', group: 'Dashboard',      label: 'Dashboard sharing' },
  { key: 'support.priorityQueue',         kind: 'boolean', group: 'Support',        label: 'Priority queue access' },
  { key: 'support.level',                 kind: 'limit',   group: 'Support',        label: 'Support level (0 community · 1 standard · 2 priority)' },
];

export const ENTITLEMENT_KEY_SET = new Set(ENTITLEMENT_KEYS.map((e) => e.key));
export const entitlementMeta = (key) => ENTITLEMENT_KEYS.find((e) => e.key === key) || null;

/**
 * DEFAULT_TIERS — the three placeholder plans. `entitlements` are the tier's
 * FULL baseline for free and PARTIAL overrides for higher tiers (resolution
 * merges over free). Order = sortOrder = upgrade path.
 */
export const DEFAULT_TIERS = [
  {
    id: 'free',
    name: 'free',
    displayName: 'Free',
    description: 'Get started: small reviews with the core screening + extraction workflow.',
    sortOrder: 0,
    entitlements: {
      'projects.create': true,
      'projects.maxActiveProjects': 2,
      'projects.maxMembersPerProject': 2,
      'screening.import': true,
      'screening.maxRecordsPerProject': 1000,
      'screening.export': true,
      'screening.aiScoring': false,
      'screening.validationMetrics': false,
      'screening.benchmarkTools': false,
      'extraction.manual': true,
      'extraction.aiAssist': false,
      'extraction.dualExtraction': false,
      'extraction.tableParsing': false,
      'metaAnalysis.basic': true,
      'metaAnalysis.advanced': false,
      'metaAnalysis.nma': false,
      'manuscript.editor': true,
      'manuscript.wordExport': false,
      'livingReview.enabled': false,
      'livingReview.maxSavedSearches': 0,
      'livingReview.scheduler': false,
      // 72.md placeholders — free baseline (every key MUST be defined here).
      'projects.maxCollaborators': 2,
      'exports.maxPerMonth': 5,
      'search.maxRunsPerMonth': 10,
      'screening.maxRunsPerMonth': 5,
      'screening.guided': false,
      'citation.mining': false,
      'storage.maxMb': 200,
      'synthesis.advanced': false,
      'dashboard.sharing': false,
      'support.priorityQueue': false,
      'support.level': 0,
    },
  },
  {
    id: 'plus',
    name: 'plus',
    displayName: 'Plus',
    description: 'For active researchers: guided screening, structured extraction and team collaboration.',
    sortOrder: 1,
    entitlements: {
      'projects.maxActiveProjects': 10,
      'projects.maxMembersPerProject': 8,
      'screening.maxRecordsPerProject': 25000,
      'screening.aiScoring': true,
      'screening.validationMetrics': true,
      'extraction.aiAssist': true,
      'extraction.dualExtraction': true,
      'extraction.tableParsing': true,
      'metaAnalysis.advanced': true,
      'manuscript.wordExport': true,
      'livingReview.enabled': true,
      'livingReview.maxSavedSearches': 3,
      // 72.md placeholders — Plus raises limits + unlocks guided/advanced/sharing.
      'projects.maxCollaborators': 8,
      'exports.maxPerMonth': 50,
      'search.maxRunsPerMonth': 100,
      'screening.maxRunsPerMonth': 50,
      'screening.guided': true,
      'citation.mining': true,
      'storage.maxMb': 5000,
      'synthesis.advanced': true,
      'dashboard.sharing': true,
      'support.level': 1,
    },
  },
  {
    id: 'pro',
    name: 'pro',
    displayName: 'Pro',
    description: 'Everything: living reviews on a schedule, NMA, benchmark tools, unlimited scale.',
    sortOrder: 2,
    entitlements: {
      'projects.maxActiveProjects': UNLIMITED,
      'projects.maxMembersPerProject': UNLIMITED,
      'screening.maxRecordsPerProject': 250000,
      'screening.aiScoring': true,
      'screening.validationMetrics': true,
      'screening.benchmarkTools': true,
      'extraction.aiAssist': true,
      'extraction.dualExtraction': true,
      'extraction.tableParsing': true,
      'metaAnalysis.advanced': true,
      'metaAnalysis.nma': true,
      'manuscript.wordExport': true,
      'livingReview.enabled': true,
      'livingReview.maxSavedSearches': UNLIMITED,
      'livingReview.scheduler': true,
      // 72.md placeholders — Pro is unlimited scale + full priority support.
      'projects.maxCollaborators': UNLIMITED,
      'exports.maxPerMonth': UNLIMITED,
      'search.maxRunsPerMonth': UNLIMITED,
      'screening.maxRunsPerMonth': UNLIMITED,
      'screening.guided': true,
      'citation.mining': true,
      'storage.maxMb': UNLIMITED,
      'synthesis.advanced': true,
      'dashboard.sharing': true,
      'support.priorityQueue': true,
      'support.level': 2,
    },
  },
];

export const DEFAULT_TIER_IDS = DEFAULT_TIERS.map((t) => t.id);
const FREE_BASELINE = DEFAULT_TIERS[0].entitlements;

/**
 * resolveEntitlements — a tier's PARTIAL entitlement map → a fully-populated one.
 * Merge order: free baseline ← code defaults for the tier ← stored overrides.
 * Guarantees every registry key has a value (missing key ≠ unlocked feature).
 */
export function resolveEntitlements(tierId, storedOverrides = null) {
  const tierDefaults = DEFAULT_TIERS.find((t) => t.id === tierId)?.entitlements || {};
  const out = { ...FREE_BASELINE, ...tierDefaults };
  if (storedOverrides && typeof storedOverrides === 'object') {
    for (const [k, v] of Object.entries(storedOverrides)) {
      if (!ENTITLEMENT_KEY_SET.has(k)) continue; // ignore junk keys
      if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    }
  }
  return out;
}

/** Boolean feature check against a RESOLVED entitlement map. */
export function hasEntitlement(entitlements, key) {
  return entitlements?.[key] === true;
}

/** Numeric limit for a key (UNLIMITED → Infinity; missing → 0, fail-closed). */
export function limitOf(entitlements, key) {
  const v = entitlements?.[key];
  if (v === UNLIMITED) return Infinity;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Whether `value` fits within the tier's limit for `key`. */
export function withinLimit(entitlements, key, value) {
  return Number(value) <= limitOf(entitlements, key);
}

/**
 * requiredTierFor — the LOWEST default tier that satisfies a requirement, for
 * honest upgrade messaging ("Available on Plus and higher"). Computed from the
 * code-default matrices (admin overrides may differ; message stays approximate).
 * @returns {string|null} tier id, or null when no default tier satisfies it
 */
export function requiredTierFor(key, value = true) {
  for (const t of DEFAULT_TIERS) {
    const ents = resolveEntitlements(t.id);
    if (typeof value === 'boolean' || value === true) {
      if (hasEntitlement(ents, key)) return t.id;
    } else if (withinLimit(ents, key, value)) {
      return t.id;
    }
  }
  return null;
}

/** Human display name for a tier id (falls back to the id). */
export function tierDisplayName(tierId) {
  return DEFAULT_TIERS.find((t) => t.id === tierId)?.displayName || String(tierId || '');
}

/**
 * buildTierLimitError — the structured error body every blocked action returns
 * (consistent shape per 67.md; HTTP status is set by the caller, usually 403).
 */
export function buildTierLimitError({ feature, currentTier, requiredTier, message }) {
  return {
    error: 'TIER_LIMIT_EXCEEDED',
    feature,
    currentTier: currentTier || null,
    requiredTier: requiredTier || null,
    message: message || 'Your current plan does not include this feature.',
  };
}
