/**
 * extraction/model.js — P5. Pure, dependency-free Data Element model for the
 * structured data-extraction system. No I/O, no React, no DOM — safe to import
 * from the server, the client, and unit tests.
 *
 * WHAT A "DATA ELEMENT" IS
 *   A Data Element is a *reusable definition* of one thing a reviewer extracts
 *   from every included study (e.g. "Sample size", "Events (intervention arm)",
 *   "Mean age"). It is a schema, not a value. A project owns an ordered list of
 *   elements (typically seeded from a TEMPLATE and then edited), and every study
 *   carries a map of VALUES keyed by element.
 *
 * ARM SCOPE
 *   - armScope 'study' → one value for the whole study (e.g. "Country", "N total").
 *   - armScope 'arm'   → one value PER ARM (e.g. events/total per intervention and
 *     comparator). The value map key format used across this engine is
 *         `${elementId}::${armKey || ''}`
 *     so a study-scoped element uses armKey '' and an arm-scoped element uses the
 *     caller's arm key (e.g. 'intervention', 'comparator', a treatment name for NMA).
 *
 * VALUE SHAPES (what one extracted value looks like)
 *   - dichotomous_outcome → { events, total }
 *   - continuous_outcome  → { mean, sd, n, median, iqrLo, iqrHi }  (median group optional)
 *   - numeric / most scalars → { value } or { value, unit }
 *   - categorical / text / date / study_design / … → { value }
 *   normalizeValue(el, raw) coerces these into their canonical object form.
 *
 * MA-COMPATIBILITY
 *   maCompatible ('dichotomous' | 'continuous' | null) marks an arm-scoped element
 *   whose consensus values can be handed to the meta-analysis engine (see
 *   maHandoff.js). It is advisory metadata, not a hard constraint.
 *
 * DETERMINISM
 *   mkElement generates an 8-char id via the repo's uid pattern
 *   (Math.random().toString(36).slice(2, 10)), but accepts an injectable idFn so
 *   tests can pin ids. No other source of nondeterminism.
 */

/** The kinds of thing a Data Element can capture. */
export const ELEMENT_TYPES = [
  'dichotomous_outcome',
  'continuous_outcome',
  'categorical',
  'baseline',
  'study_design',
  'intervention_detail',
  'comparator_detail',
  'timepoint',
  'adverse_event',
  'text',
  'numeric',
  'date',
];

/** Types whose value is entered as an OBJECT (per-subfield), not a scalar. */
export const OBJECT_VALUE_TYPES = ['dichotomous_outcome', 'continuous_outcome'];

/** Types treated as free/normalized text when comparing or validating. */
export const TEXT_LIKE_TYPES = ['text', 'study_design', 'intervention_detail', 'comparator_detail'];

/** Types treated as a single numeric scalar. */
export const NUMERIC_LIKE_TYPES = ['numeric', 'baseline', 'adverse_event'];

const DEFAULT_ID_FN = () => Math.random().toString(36).slice(2, 10);

/**
 * mkElement(partial, idFn?) — build a canonical Data Element from a partial.
 * Unknown keys are ignored; every known key gets a sane default so downstream
 * code never has to null-check the shape.
 *
 * @param {object} partial
 * @param {() => string} [idFn]  injectable id generator (determinism in tests)
 * @returns {object} element
 */
export function mkElement(partial = {}, idFn = DEFAULT_ID_FN) {
  const p = partial || {};
  const type = ELEMENT_TYPES.includes(p.type) ? p.type : 'text';
  const armScope = p.armScope === 'arm' ? 'arm' : 'study';
  const validation = p.validation && typeof p.validation === 'object' ? p.validation : {};
  return {
    id: typeof p.id === 'string' && p.id ? p.id : idFn(),
    name: typeof p.name === 'string' ? p.name : '',
    description: typeof p.description === 'string' ? p.description : '',
    type,
    required: !!p.required,
    unit: typeof p.unit === 'string' ? p.unit : '',
    allowedValues: Array.isArray(p.allowedValues) ? p.allowedValues.map(String) : [],
    timepoint: typeof p.timepoint === 'string' ? p.timepoint : '',
    population: typeof p.population === 'string' ? p.population : '',
    armScope,
    outcome: typeof p.outcome === 'string' ? p.outcome : '',
    maCompatible:
      p.maCompatible === 'dichotomous' || p.maCompatible === 'continuous'
        ? p.maCompatible
        : null,
    notes: typeof p.notes === 'string' ? p.notes : '',
    validation: {
      min: numOrNull(validation.min),
      max: numOrNull(validation.max),
      integer: !!validation.integer,
    },
  };
}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * TEMPLATES — starter element sets per review type. Each template is
 * { key, label, description, elements: [partial…] }; elements are partials
 * (no ids) so mkElement fills defaults + ids when a template is instantiated.
 */
export const TEMPLATES = [
  {
    key: 'generic',
    label: 'Generic extraction',
    description: 'A minimal, review-type-agnostic starter set of study descriptors.',
    elements: [
      { name: 'Study ID / citation', type: 'text', required: true },
      { name: 'Country', type: 'categorical', allowedValues: [] },
      { name: 'Study design', type: 'study_design' },
      { name: 'Total sample size (N)', type: 'numeric', validation: { min: 0, integer: true } },
      { name: 'Population', type: 'text' },
      { name: 'Intervention', type: 'intervention_detail' },
      { name: 'Comparator', type: 'comparator_detail' },
      { name: 'Primary outcome', type: 'text' },
    ],
  },
  {
    key: 'rct_intervention',
    label: 'RCT / intervention trial',
    description: 'Two-arm randomized trial: design, arms, follow-up, and one primary outcome.',
    elements: [
      { name: 'Study ID / citation', type: 'text', required: true },
      { name: 'Study design', type: 'study_design', notes: 'e.g. parallel-group RCT, cluster RCT' },
      { name: 'Randomization method', type: 'text' },
      { name: 'Total randomized (N)', type: 'numeric', validation: { min: 0, integer: true } },
      { name: 'Intervention', type: 'intervention_detail', armScope: 'arm' },
      { name: 'Comparator', type: 'comparator_detail', armScope: 'arm' },
      { name: 'Follow-up duration', type: 'timepoint' },
      {
        name: 'Primary outcome (events)',
        type: 'dichotomous_outcome',
        armScope: 'arm',
        maCompatible: 'dichotomous',
      },
    ],
  },
  {
    key: 'diagnostic_accuracy',
    label: 'Diagnostic test accuracy',
    description: '2×2 counts (TP/FP/FN/TN), reference standard, and index test details.',
    elements: [
      { name: 'Study ID / citation', type: 'text', required: true },
      { name: 'Index test', type: 'text', required: true },
      { name: 'Reference standard', type: 'text', required: true },
      { name: 'Patient spectrum', type: 'text' },
      { name: 'True positives (TP)', type: 'numeric', validation: { min: 0, integer: true } },
      { name: 'False positives (FP)', type: 'numeric', validation: { min: 0, integer: true } },
      { name: 'False negatives (FN)', type: 'numeric', validation: { min: 0, integer: true } },
      { name: 'True negatives (TN)', type: 'numeric', validation: { min: 0, integer: true } },
    ],
  },
  {
    key: 'observational_cohort',
    label: 'Observational cohort',
    description: 'Exposure/outcome cohort: exposure definition, adjusted estimate, confounders.',
    elements: [
      { name: 'Study ID / citation', type: 'text', required: true },
      { name: 'Study design', type: 'study_design', notes: 'prospective / retrospective cohort' },
      { name: 'Country', type: 'categorical', allowedValues: [] },
      { name: 'Total sample size (N)', type: 'numeric', validation: { min: 0, integer: true } },
      { name: 'Exposure definition', type: 'text', required: true },
      { name: 'Outcome definition', type: 'text', required: true },
      { name: 'Follow-up duration', type: 'timepoint' },
      { name: 'Adjustment / confounders', type: 'text' },
    ],
  },
  {
    key: 'dichotomous_2x2',
    label: 'Dichotomous 2×2 (per arm)',
    description: 'Per-arm events/total for a binary outcome — ready for OR/RR/RD synthesis.',
    elements: [
      { name: 'Study ID / citation', type: 'text', required: true },
      { name: 'Outcome', type: 'text', required: true },
      {
        name: 'Events (intervention)',
        type: 'dichotomous_outcome',
        armScope: 'arm',
        maCompatible: 'dichotomous',
      },
      {
        name: 'Events (comparator)',
        type: 'dichotomous_outcome',
        armScope: 'arm',
        maCompatible: 'dichotomous',
      },
      { name: 'Timepoint', type: 'timepoint' },
    ],
  },
  {
    key: 'continuous_outcome',
    label: 'Continuous outcome (per arm)',
    description: 'Per-arm mean/SD/N for a continuous outcome — ready for MD/SMD synthesis.',
    elements: [
      { name: 'Study ID / citation', type: 'text', required: true },
      { name: 'Outcome', type: 'text', required: true },
      {
        name: 'Outcome (intervention)',
        type: 'continuous_outcome',
        armScope: 'arm',
        maCompatible: 'continuous',
      },
      {
        name: 'Outcome (comparator)',
        type: 'continuous_outcome',
        armScope: 'arm',
        maCompatible: 'continuous',
      },
      { name: 'Timepoint', type: 'timepoint' },
      { name: 'Measurement scale / unit', type: 'text' },
    ],
  },
  {
    key: 'nma_arm_level',
    label: 'Network meta-analysis (arm-level)',
    description: 'One row per arm: treatment name plus binary and/or continuous outcome data.',
    elements: [
      { name: 'Study ID / citation', type: 'text', required: true },
      { name: 'Arm / treatment name', type: 'text', required: true, armScope: 'arm' },
      { name: 'Arm sample size (n)', type: 'numeric', armScope: 'arm', validation: { min: 0, integer: true } },
      {
        name: 'Arm events (binary outcome)',
        type: 'dichotomous_outcome',
        armScope: 'arm',
        maCompatible: 'dichotomous',
      },
      {
        name: 'Arm outcome (continuous)',
        type: 'continuous_outcome',
        armScope: 'arm',
        maCompatible: 'continuous',
      },
      { name: 'Timepoint', type: 'timepoint' },
    ],
  },
];

/** TEMPLATE_KEYS — the list of valid template keys. */
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);

/**
 * instantiateTemplate(key, idFn?) — return a fresh array of full elements for a
 * template key (or [] for an unknown key).
 */
export function instantiateTemplate(key, idFn = DEFAULT_ID_FN) {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) return [];
  return t.elements.map((partial) => mkElement(partial, idFn));
}

/**
 * validateElement(el) — structural validity of an element DEFINITION (not a value).
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateElement(el) {
  const errors = [];
  if (!el || typeof el !== 'object') return { ok: false, errors: ['element is not an object'] };
  if (!el.name || !String(el.name).trim()) errors.push('name is required');
  if (!ELEMENT_TYPES.includes(el.type)) errors.push(`type "${el.type}" is not a known ELEMENT_TYPE`);
  if (el.armScope !== 'study' && el.armScope !== 'arm') errors.push('armScope must be "study" or "arm"');
  if (el.maCompatible !== null && el.maCompatible !== 'dichotomous' && el.maCompatible !== 'continuous') {
    errors.push('maCompatible must be null, "dichotomous", or "continuous"');
  }
  if (el.type === 'categorical' && !Array.isArray(el.allowedValues)) {
    errors.push('categorical element must have an allowedValues array');
  }
  const v = el.validation || {};
  if (v.min != null && v.max != null && Number(v.min) > Number(v.max)) {
    errors.push('validation.min is greater than validation.max');
  }
  // MA-compatible dichotomous/continuous should be arm-scoped object-valued types.
  if (el.maCompatible === 'dichotomous' && el.type !== 'dichotomous_outcome') {
    errors.push('maCompatible "dichotomous" requires type dichotomous_outcome');
  }
  if (el.maCompatible === 'continuous' && el.type !== 'continuous_outcome') {
    errors.push('maCompatible "continuous" requires type continuous_outcome');
  }
  return { ok: errors.length === 0, errors };
}

/** isMissing(v) — true for the canonical "nothing entered" values. */
export function isMissing(v) {
  return v === '' || v === null || v === undefined;
}

/**
 * normalizeValue(el, raw) — coerce a raw entered value into canonical object form.
 * Numerics are parsed via Number, strings trimmed, categorical mapped to its
 * canonical allowedValues casing. Returns the canonical object (never a bare
 * scalar) so downstream comparison/handoff code has a stable shape.
 *
 * Object-valued types (dichotomous/continuous) accept an object OR a partial and
 * normalize each subfield independently; a missing subfield stays null.
 */
export function normalizeValue(el, raw) {
  const type = el && el.type;
  if (type === 'dichotomous_outcome') {
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
      events: normNum(o.events),
      total: normNum(o.total),
    };
  }
  if (type === 'continuous_outcome') {
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
      mean: normNum(o.mean),
      sd: normNum(o.sd),
      n: normNum(o.n),
      median: normNum(o.median),
      iqrLo: normNum(o.iqrLo),
      iqrHi: normNum(o.iqrHi),
    };
  }
  // Scalar value: accept a bare scalar OR { value, unit }.
  let value = raw;
  let unit = el && el.unit ? el.unit : '';
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    value = raw.value;
    if (typeof raw.unit === 'string' && raw.unit) unit = raw.unit;
  }
  if (NUMERIC_LIKE_TYPES.includes(type) || type === 'numeric') {
    return { value: normNum(value), unit };
  }
  if (isMissing(value)) return { value: null };
  return { value: String(value).trim(), ...(unit ? { unit } : {}) };
}

function normNum(v) {
  if (isMissing(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * validateValue(el, value) — validate a raw value against the element's rules.
 * @returns {{ ok: boolean, errors: string[], normalized: object }}
 *
 * Type rules:
 *   - numeric-like: parses via Number; respects validation.min/max/integer.
 *   - categorical: value must be in allowedValues (case-insensitive → canonical).
 *   - date: accepts YYYY or YYYY-MM-DD.
 *   - dichotomous/continuous: object subfields; numeric parsing; events ≤ total.
 * A required element with a fully-missing value is an error; a non-required
 * missing value is valid (normalized to nulls).
 */
export function validateValue(el, value) {
  const errors = [];
  const normalized = normalizeValue(el, value);
  const type = el && el.type;

  if (type === 'dichotomous_outcome') {
    const { events, total } = normalized;
    const bothMissing = events === null && total === null;
    if (el.required && bothMissing) errors.push('required outcome is empty');
    if (events !== null && (!Number.isInteger(events) || events < 0)) errors.push('events must be a non-negative integer');
    if (total !== null && (!Number.isInteger(total) || total < 0)) errors.push('total must be a non-negative integer');
    if (events !== null && total !== null && events > total) errors.push('events cannot exceed total');
    return { ok: errors.length === 0, errors, normalized };
  }

  if (type === 'continuous_outcome') {
    const { mean, sd, n } = normalized;
    const allMissing = ['mean', 'sd', 'n', 'median', 'iqrLo', 'iqrHi'].every((k) => normalized[k] === null);
    if (el.required && allMissing) errors.push('required outcome is empty');
    if (sd !== null && sd < 0) errors.push('sd cannot be negative');
    if (n !== null && (!Number.isInteger(n) || n < 0)) errors.push('n must be a non-negative integer');
    if (mean !== null && !Number.isFinite(mean)) errors.push('mean must be numeric');
    return { ok: errors.length === 0, errors, normalized };
  }

  // Scalar. Read the RAW scalar too so a numeric type can tell "empty" (valid when
  // not required) apart from "present but unparseable" (always an error) — the
  // normalized value has already coerced garbage to null and would look empty.
  const rawScalar =
    value && typeof value === 'object' && !Array.isArray(value) ? value.value : value;
  const rawMissing = isMissing(rawScalar) || (typeof rawScalar === 'string' && rawScalar.trim() === '');
  const scalar = normalized.value;

  if (NUMERIC_LIKE_TYPES.includes(type) || type === 'numeric') {
    if (rawMissing) {
      if (el.required) errors.push('required value is empty');
      return { ok: errors.length === 0, errors, normalized };
    }
    if (typeof scalar !== 'number' || !Number.isFinite(scalar)) {
      errors.push('value is not a valid number');
    } else {
      const v = el.validation || {};
      if (v.integer && !Number.isInteger(scalar)) errors.push('value must be an integer');
      if (v.min != null && scalar < Number(v.min)) errors.push(`value below minimum ${v.min}`);
      if (v.max != null && scalar > Number(v.max)) errors.push(`value above maximum ${v.max}`);
    }
    return { ok: errors.length === 0, errors, normalized };
  }

  const missing = scalar === null || scalar === undefined || scalar === '';
  if (missing) {
    if (el.required) errors.push('required value is empty');
    return { ok: errors.length === 0, errors, normalized };
  }

  if (type === 'categorical') {
    const canonical = matchCategorical(el.allowedValues, scalar);
    if (el.allowedValues && el.allowedValues.length && canonical === null) {
      errors.push(`"${scalar}" is not one of the allowed values`);
    } else if (canonical !== null) {
      normalized.value = canonical; // canonicalize casing
    }
    return { ok: errors.length === 0, errors, normalized };
  }

  if (type === 'date') {
    if (!isValidDateString(scalar)) errors.push('date must be YYYY or YYYY-MM-DD');
    return { ok: errors.length === 0, errors, normalized };
  }

  // text / study_design / intervention_detail / comparator_detail / timepoint …
  return { ok: errors.length === 0, errors, normalized };
}

/** matchCategorical(allowed, value) → canonical casing or null. Case-insensitive. */
export function matchCategorical(allowed, value) {
  if (!Array.isArray(allowed) || !allowed.length) return null;
  const target = String(value).trim().toLowerCase();
  for (const a of allowed) {
    if (String(a).trim().toLowerCase() === target) return String(a);
  }
  return null;
}

/** isValidDateString(s) — accepts "YYYY" or "YYYY-MM-DD" only. */
export function isValidDateString(s) {
  const str = String(s).trim();
  if (/^\d{4}$/.test(str)) {
    const y = Number(str);
    return y >= 1000 && y <= 9999;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  return true;
}

/** valueKey(elementId, armKey) — the canonical map key used across the engine. */
export function valueKey(elementId, armKey = '') {
  return `${elementId}::${armKey || ''}`;
}
