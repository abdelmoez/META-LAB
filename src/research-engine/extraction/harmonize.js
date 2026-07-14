/**
 * extraction/harmonize.js — 82.md Part 3/5/6/7/8.
 *
 * PURE, dependency-light bridge between "data as REPORTED in the paper" and the
 * "analysis" fields the meta-analysis engine reads (mkStudy meanExp/sdExp/… + es/lo/hi).
 * No DOM / IO / Date.now / Math.random — safe to import from server, client, tests.
 * (The caller stamps `at` timestamps; this module never reads the clock, so a stored
 * conversion's inputsHash is reproducible for stale detection.)
 *
 * WHY THIS EXISTS
 *   A study row (mkStudy) has ANALYSIS fields (meanExp/sdExp/meanCtrl/sdCtrl for
 *   continuous, a/b/c/d or events/total for dichotomous, es/lo/hi for precomputed).
 *   But papers report continuous outcomes in many FORMATS (median+IQR, median+range,
 *   mean+SE, mean+CI…). 82.md's core principle: the reviewer extracts what the paper
 *   REPORTS; the engine converts to the analysis format LATER, keeping the reported
 *   values permanently and labelling the derived values as converted.
 *
 * THE THREE CONCEPTS (kept separate — 82.md Part 5/6)
 *   - outcome family  : continuous | dichotomous | precomputed  (from esType)
 *   - reported format : how the paper stated it (mean_sd, median_iqr, …)
 *   - analytical measure (esType): MD/SMD/OR/RR/HR/…
 *
 * REPORTED FIELDS live in their OWN mkStudy fields (medianExp/q1Exp/q3Exp/seExp/…),
 * so a conversion writing meanExp/sdExp NEVER overwrites the reported numbers
 * (82.md "original values immutable"). The reported↔analysis mapping is declared
 * here and consumed by articleStatus.expectedFieldsFor so the UI shows only the
 * fields relevant to the chosen reported format.
 */

import { conversionById, softWarnings, CONVERSION_ENGINE_VERSION } from '../conversions/catalogue.js';

/** Outcome family implied by the analytical effect measure (esType). */
export function familyOf(esType = '') {
  const t = String(esType || '');
  if (t === 'MD' || t === 'SMD') return 'continuous';
  if (t === 'OR' || t === 'RR' || t === 'RD' || t === 'PROP') return 'dichotomous';
  return 'precomputed'; // HR, COR, IRR, BETA, AUC, GENERIC, DIAG, unset → effect+CI
}

/**
 * REPORTED_FORMATS — declarative registry keyed by outcome family. Each format:
 *   id            stable id (stored on the study as `reportedFormat`)
 *   label         human label (no unexplained abbreviations)
 *   family        continuous | dichotomous | precomputed
 *   arm           true → fields are per-arm (Exp/Ctrl); false → study-level
 *   fields        logical field bases shown for this format (arm suffix appended)
 *   conversionId  catalogue recipe used to DERIVE the analysis fields (null = the
 *                 reported fields ARE the analysis fields; no conversion needed)
 *   map           maps conversion input keys → the logical field bases it reads
 *   derives       analysis field bases the conversion produces (Exp/Ctrl appended)
 *   passThrough   reported field bases copied straight to analysis (e.g. mean)
 */
export const REPORTED_FORMATS = Object.freeze({
  continuous: [
    { id: 'mean_sd', label: 'Mean and SD', family: 'continuous', arm: true,
      fields: ['n', 'mean', 'sd'], conversionId: null, derives: ['mean', 'sd'], passThrough: ['mean', 'sd'], map: {} },
    { id: 'median_iqr', label: 'Median and IQR (Q1, Q3)', family: 'continuous', arm: true,
      fields: ['n', 'median', 'q1', 'q3'], conversionId: 'median_iqr',
      map: { q1: 'q1', med: 'median', q3: 'q3', n: 'n' }, derives: ['mean', 'sd'], passThrough: [] },
    { id: 'median_range', label: 'Median and range (min–max)', family: 'continuous', arm: true,
      fields: ['n', 'median', 'min', 'max'], conversionId: 'median_range',
      map: { min: 'min', med: 'median', max: 'max', n: 'n' }, derives: ['mean', 'sd'], passThrough: [] },
    { id: 'mean_se', label: 'Mean and standard error (SE)', family: 'continuous', arm: true,
      fields: ['n', 'mean', 'se'], conversionId: 'se_sd',
      map: { se: 'se', n: 'n' }, derives: ['sd'], passThrough: ['mean'] },
    { id: 'mean_ci', label: 'Mean and 95% CI', family: 'continuous', arm: true,
      fields: ['n', 'mean', 'ciLo', 'ciHi'], conversionId: 'ci_sd',
      map: { lo: 'ciLo', hi: 'ciHi', n: 'n' }, derives: ['sd'], passThrough: ['mean'] },
  ],
  dichotomous: [
    { id: 'events_total', label: 'Events and total (per arm)', family: 'dichotomous', arm: false,
      fields: [], conversionId: null, derives: [], passThrough: [], map: {} },
  ],
  precomputed: [
    { id: 'effect_ci', label: 'Effect estimate and 95% CI', family: 'precomputed', arm: false,
      fields: [], conversionId: null, derives: [], passThrough: [], map: {} },
  ],
});

/** All reported-format ids (for validation of a stored study.reportedFormat). */
export const REPORTED_FORMAT_IDS = Object.freeze(
  Object.values(REPORTED_FORMATS).flat().map((f) => f.id),
);

/** reportedFormatsFor(esType) — the formats offered for a study's effect measure. */
export function reportedFormatsFor(esType = '') {
  return REPORTED_FORMATS[familyOf(esType)] || [];
}

/** The default reported format for a family (backward-compatible: mean_sd/events_total/effect_ci). */
export function defaultReportedFormat(esType = '') {
  const list = reportedFormatsFor(esType);
  return list.length ? list[0].id : '';
}

/** Look up a reported-format spec by id (searches every family). */
export function reportedFormatSpec(id) {
  if (!id) return null;
  for (const list of Object.values(REPORTED_FORMATS)) {
    const f = list.find((x) => x.id === id);
    if (f) return f;
  }
  return null;
}

/**
 * effectiveReportedFormat(study) — the study's chosen reported format, defaulting
 * to the family default when unset (so legacy rows behave as mean_sd/events_total/
 * effect_ci exactly as before). Guards against a format that doesn't match the
 * current family (e.g. esType changed) by falling back to the default.
 */
export function effectiveReportedFormat(study = {}) {
  const fam = familyOf(study.esType);
  const chosen = study.reportedFormat;
  const spec = reportedFormatSpec(chosen);
  if (spec && spec.family === fam) return chosen;
  return defaultReportedFormat(study.esType);
}

const ARM_SUFFIX = { exp: 'Exp', ctrl: 'Ctrl' };

/** The mkStudy field name for a logical base + arm (e.g. ('median','exp') → 'medianExp'). */
export function reportedFieldName(base, arm) {
  return `${base}${ARM_SUFFIX[arm] || ''}`;
}

/**
 * reportedFieldsForStudy(study) — the flat mkStudy field names the UI should render
 * for this study's (esType, reportedFormat), in fill order. For continuous formats
 * this expands per-arm (Exp then Ctrl). Non-continuous families return [] (their
 * analysis fields are handled by the existing esType field sets).
 * @returns {string[]}
 */
export function reportedFieldsForStudy(study = {}) {
  const spec = reportedFormatSpec(effectiveReportedFormat(study));
  if (!spec || !spec.arm) return [];
  const out = [];
  for (const arm of ['exp', 'ctrl']) {
    for (const base of spec.fields) out.push(reportedFieldName(base, arm));
  }
  return out;
}

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// FNV-1a 32-bit hash over a canonical string — deterministic, no crypto dependency.
// Used ONLY as a change-detector for stale conversions (not security-sensitive).
function hashInputs(obj) {
  const canon = JSON.stringify(obj, Object.keys(obj).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * harmonizeArm(study, arm) — derive the analysis fields for ONE arm from the study's
 * reported fields + chosen reported format. PURE. Returns:
 *   { status, writes, conversion?, warnings, error? }
 * status ∈ 'not_required' (reported IS analysis) | 'ok' (derived) |
 *          'missing' (insufficient reported inputs) | 'unable' (conversion failed).
 * `writes` maps analysis field NAMES (e.g. sdExp) → derived numeric values.
 * `conversion` is a provenance record (never includes a timestamp — caller stamps it).
 */
export function harmonizeArm(study = {}, arm = 'exp') {
  const spec = reportedFormatSpec(effectiveReportedFormat(study));
  if (!spec || !spec.arm) return { status: 'not_required', writes: {}, warnings: [] };

  // Pass-through formats (mean_sd): the reported fields ARE the analysis fields.
  if (!spec.conversionId) {
    const writes = {};
    for (const base of spec.passThrough) {
      const v = study[reportedFieldName(base, arm)];
      if (v !== '' && v !== null && v !== undefined) writes[reportedFieldName(base, arm)] = num(v);
    }
    return { status: 'not_required', writes, warnings: [] };
  }

  // Gather the conversion inputs from the study's reported fields.
  const recipe = conversionById(spec.conversionId);
  if (!recipe) return { status: 'unable', writes: {}, warnings: [], error: 'Unknown conversion method.' };
  const params = {};
  const rawInputs = {};
  let anyMissing = false;
  for (const [inKey, base] of Object.entries(spec.map)) {
    const v = num(study[reportedFieldName(base, arm)]);
    if (v === null) anyMissing = true;
    params[inKey] = v;
    rawInputs[reportedFieldName(base, arm)] = v;
  }
  if (anyMissing) return { status: 'missing', writes: {}, warnings: [] };

  const res = recipe.run(params);
  if (!res || res.ok !== true) {
    return { status: 'unable', writes: {}, warnings: [], error: (res && res.error) || 'Conversion failed.' };
  }

  // Map the recipe outputs onto the arm's analysis fields (mean→meanExp, sd→sdExp).
  const writes = {};
  for (const base of spec.derives) {
    if (res.values && res.values[base] !== undefined) writes[reportedFieldName(base, arm)] = res.values[base];
  }
  // mean pass-through for spread-only conversions (se/ci → sd; mean copied verbatim).
  for (const base of spec.passThrough) {
    const v = num(study[reportedFieldName(base, arm)]);
    if (v !== null) writes[reportedFieldName(base, arm)] = v;
  }

  const warnings = softWarnings(spec.conversionId, params);
  const inputsHash = hashInputs({ f: spec.id, m: spec.conversionId, v: recipe.version || '', arm, ...rawInputs });
  return {
    status: 'ok',
    writes,
    warnings,
    conversion: {
      target: `${arm}`,
      formatId: spec.id,
      method: spec.conversionId,
      methodLabel: recipe.label,
      methodVersion: recipe.version || '',
      engineVersion: CONVERSION_ENGINE_VERSION,
      formula: res.formula || recipe.method,
      assumptions: recipe.assumptions || [],
      reference: recipe.reference || '',
      caution: recipe.caution || 'medium',
      inputs: rawInputs,
      outputs: { ...writes },
      warnings,
      inputsHash,
    },
  };
}

/**
 * harmonizeStudy(study) — harmonize BOTH arms. Returns an aggregate plan:
 *   { required, status, writes, conversions[], warnings[], errors[] }
 * `required` is false for pass-through / non-continuous formats. `writes` is the
 * merged analysis-field patch to apply (never touches reported fields). `status`:
 *   'not_required' | 'ok' | 'partial' (some arm missing) | 'unable' | 'missing'.
 * PURE — apply the writes + stamp conversions[] (with `at`) in the caller.
 */
export function harmonizeStudy(study = {}) {
  const spec = reportedFormatSpec(effectiveReportedFormat(study));
  if (!spec || !spec.arm || !spec.conversionId) {
    return { required: false, status: 'not_required', writes: {}, conversions: [], warnings: [], errors: [] };
  }
  const writes = {};
  const conversions = [];
  const warnings = [];
  const errors = [];
  const statuses = [];
  for (const arm of ['exp', 'ctrl']) {
    const r = harmonizeArm(study, arm);
    statuses.push(r.status);
    Object.assign(writes, r.writes);
    if (r.conversion) conversions.push(r.conversion);
    if (r.warnings && r.warnings.length) warnings.push(...r.warnings);
    if (r.error) errors.push(`${arm === 'exp' ? 'Intervention' : 'Comparator'} arm: ${r.error}`);
  }
  let status = 'ok';
  if (statuses.every((s) => s === 'missing')) status = 'missing';
  else if (statuses.some((s) => s === 'unable')) status = 'unable';
  else if (statuses.some((s) => s === 'missing')) status = 'partial';
  return { required: true, status, writes, conversions, warnings: [...new Set(warnings)], errors };
}

/**
 * conversionStatusOf(study) — the review/lifecycle status shown in the UI for a
 * study's harmonization (82.md Part 3 "Conversion Statuses"). Compares the stored
 * conversions[] (persisted on the study when applied) against a fresh recompute:
 *   'not_required' | 'eligible' | 'generated' | 'stale' | 'unable' | 'missing'.
 * `stale` = a conversion was applied but its inputs / engine version changed since,
 * so the analysis values are outdated and must be recomputed (82.md Part 3/scenario 6).
 * PURE + deterministic (no clock).
 */
export function conversionStatusOf(study = {}) {
  const plan = harmonizeStudy(study);
  if (!plan.required) return 'not_required';
  if (plan.status === 'missing') return 'missing';
  if (plan.status === 'unable') return 'unable';

  const applied = Array.isArray(study.conversions) ? study.conversions.filter((c) => c && c.formatId) : [];
  if (!applied.length) return 'eligible'; // eligible but not yet generated/applied

  // Stale if any freshly-computed arm hash differs from the applied one, or the
  // engine version moved, or the format changed.
  const freshByArm = new Map(plan.conversions.map((c) => [c.target, c]));
  const appliedByArm = new Map(applied.map((c) => [c.target, c]));
  for (const [arm, fresh] of freshByArm) {
    const prev = appliedByArm.get(arm);
    if (!prev) return 'stale';
    if (prev.inputsHash !== fresh.inputsHash) return 'stale';
    if (prev.engineVersion !== fresh.engineVersion) return 'stale';
    if (prev.formatId !== fresh.formatId) return 'stale';
  }
  return 'generated';
}

/** Human labels for conversion statuses (status not communicated by colour alone). */
export const CONVERSION_STATUS_LABELS = Object.freeze({
  not_required: 'No conversion needed',
  eligible: 'Conversion available',
  generated: 'Converted',
  stale: 'Conversion out of date',
  unable: 'Unable to convert',
  missing: 'Missing required data',
});

/**
 * validateReported(study) — format-specific validation of the REPORTED fields
 * (82.md Part 8). Returns { errors:[], warnings:[] } with SPECIFIC, actionable
 * messages. Runs BOTH arms. Pure. The backend must re-run this (never trust the FE).
 */
export function validateReported(study = {}) {
  const errors = [];
  const warnings = [];
  const spec = reportedFormatSpec(effectiveReportedFormat(study));
  if (!spec || !spec.arm) return { errors, warnings };

  for (const arm of ['exp', 'ctrl']) {
    const label = arm === 'exp' ? 'Intervention' : 'Comparator';
    const g = (base) => num(study[reportedFieldName(base, arm)]);
    const n = g('n');
    if (n !== null && (!Number.isInteger(n) || n < 1)) errors.push(`${label}: sample size must be a positive whole number.`);

    if (spec.id === 'median_iqr') {
      const q1 = g('q1'), med = g('median'), q3 = g('q3');
      if (q1 !== null && q3 !== null && q1 > q3) errors.push(`${label}: Q1 must be ≤ Q3.`);
      if (q1 !== null && med !== null && med < q1) errors.push(`${label}: Q1 must be ≤ the median (expect Q1 ≤ median ≤ Q3).`);
      if (q3 !== null && med !== null && med > q3) errors.push(`${label}: the median must be ≤ Q3 (expect Q1 ≤ median ≤ Q3).`);
    } else if (spec.id === 'median_range') {
      const mn = g('min'), med = g('median'), mx = g('max');
      if (mn !== null && mx !== null && mn > mx) errors.push(`${label}: minimum must be ≤ maximum.`);
      if (mn !== null && med !== null && med < mn) errors.push(`${label}: the median must be ≥ the minimum (expect min ≤ median ≤ max).`);
      if (mx !== null && med !== null && med > mx) errors.push(`${label}: the median must be ≤ the maximum (expect min ≤ median ≤ max).`);
    } else if (spec.id === 'mean_se') {
      const se = g('se');
      if (se !== null && se < 0) errors.push(`${label}: standard error (SE) cannot be negative.`);
    } else if (spec.id === 'mean_ci') {
      const lo = g('ciLo'), hi = g('ciHi');
      if (lo !== null && hi !== null && lo > hi) errors.push(`${label}: CI lower limit must be ≤ the upper limit.`);
    } else if (spec.id === 'mean_sd') {
      const sd = g('sd');
      if (sd !== null && sd < 0) errors.push(`${label}: SD cannot be negative.`);
    }
  }
  return { errors, warnings };
}
