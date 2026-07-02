/**
 * extraction/conflicts.js — P5. Pure, dependency-free double-extraction
 * reconciliation. Given the SAME element extracted by two reviewers (or a
 * reviewer vs an AI suggestion), decide whether the two values agree and, if not,
 * classify the KIND of disagreement so the UI can guide reconciliation.
 *
 * DESIGN
 *   - Text/categorical are compared on their NORMALIZED form (trim, collapse inner
 *     whitespace, case-insensitive). This means "  Parallel   RCT " agrees with
 *     "parallel rct".
 *   - Numerics use a RELATIVE tolerance (default 0.5%) with an absolute-tolerance
 *     floor so near-zero values don't explode the relative check.
 *   - "missing vs present" is always a conflict — silence is never agreement.
 *   - UNIT differences are surfaced as their own kind (unit_mismatch); v1 performs
 *     NO unit conversion — it only flags the mismatch for a human.
 *   - OBJECT values (dichotomous/continuous) are compared per subfield; they agree
 *     only if the SAME subfields are present on both sides AND every present
 *     subfield agrees. Per-subfield results are returned in `fields`.
 *
 * KEY FORMAT for the summary map: `${elementId}::${armKey || ''}` (see model.js).
 */

import { OBJECT_VALUE_TYPES, TEXT_LIKE_TYPES, isMissing, normalizeValue, valueKey } from './model.js';

const DEFAULT_OPTS = { relTol: 0.005, absTol: 1e-9 };

/**
 * compareValues(element, a, b, opts?) — compare two raw values for one element.
 * @returns {{ agree:boolean, kind:string, detail:string, fields?:Array }}
 *   kind ∈ 'both_missing' | 'exact' | 'within_tolerance' | 'missing_vs_present'
 *        | 'numeric_mismatch' | 'categorical_mismatch' | 'text_mismatch'
 *        | 'unit_mismatch'
 */
export function compareValues(element, a, b, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const type = element && element.type;

  if (OBJECT_VALUE_TYPES.includes(type)) {
    return compareObjectValues(element, a, b, o);
  }

  const na = normalizeValue(element, a);
  const nb = normalizeValue(element, b);
  const va = na.value;
  const vb = nb.value;
  const aMissing = isScalarMissing(va);
  const bMissing = isScalarMissing(vb);

  if (aMissing && bMissing) {
    return { agree: true, kind: 'both_missing', detail: 'both reviewers left this empty' };
  }
  if (aMissing !== bMissing) {
    return {
      agree: false,
      kind: 'missing_vs_present',
      detail: `${aMissing ? 'A' : 'B'} is empty; ${aMissing ? 'B' : 'A'} has "${aMissing ? vb : va}"`,
    };
  }

  // Both present. Unit check first for scalar-with-unit types.
  const ua = (na.unit || '').trim().toLowerCase();
  const ub = (nb.unit || '').trim().toLowerCase();
  if (ua || ub) {
    if (ua !== ub) {
      return {
        agree: false,
        kind: 'unit_mismatch',
        detail: `units differ ("${na.unit}" vs "${nb.unit}") — no conversion applied in v1`,
      };
    }
  }

  if (typeof va === 'number' && typeof vb === 'number') {
    const num = compareNumbers(va, vb, o);
    return {
      agree: num.agree,
      kind: num.agree ? num.kind : 'numeric_mismatch',
      detail: num.detail,
    };
  }

  // Text / categorical / date / study_design / …
  const ta = normText(va);
  const tb = normText(vb);
  if (ta === tb) return { agree: true, kind: 'exact', detail: 'identical (normalized)' };
  const kind = type === 'categorical' ? 'categorical_mismatch' : 'text_mismatch';
  return { agree: false, kind, detail: `"${va}" vs "${vb}"` };
}

/** compareObjectValues — per-subfield comparison for dichotomous/continuous. */
function compareObjectValues(element, a, b, o) {
  const na = normalizeValue(element, a);
  const nb = normalizeValue(element, b);
  const keys = Object.keys(na); // canonical subfield set from normalizeValue
  const fields = [];
  let anyPresent = false;
  let anyConflict = false;

  for (const k of keys) {
    const va = na[k];
    const vb = nb[k];
    const aMissing = va === null || va === undefined;
    const bMissing = vb === null || vb === undefined;
    if (aMissing && bMissing) {
      fields.push({ field: k, agree: true, kind: 'both_missing', a: va, b: vb });
      continue;
    }
    anyPresent = true;
    if (aMissing !== bMissing) {
      anyConflict = true;
      fields.push({ field: k, agree: false, kind: 'missing_vs_present', a: va, b: vb });
      continue;
    }
    const num = compareNumbers(va, vb, o);
    if (!num.agree) anyConflict = true;
    fields.push({ field: k, agree: num.agree, kind: num.agree ? num.kind : 'numeric_mismatch', a: va, b: vb });
  }

  if (!anyPresent) {
    return { agree: true, kind: 'both_missing', detail: 'both reviewers left every subfield empty', fields };
  }
  if (anyConflict) {
    const bad = fields.filter((f) => !f.agree).map((f) => f.field);
    // A missing-vs-present subfield conflict is reported as missing_vs_present;
    // otherwise it is a numeric_mismatch at the aggregate level.
    const hasMissingConflict = fields.some((f) => !f.agree && f.kind === 'missing_vs_present');
    return {
      agree: false,
      kind: hasMissingConflict ? 'missing_vs_present' : 'numeric_mismatch',
      detail: `subfield(s) disagree: ${bad.join(', ')}`,
      fields,
    };
  }
  const anyTol = fields.some((f) => f.agree && f.kind === 'within_tolerance');
  return {
    agree: true,
    kind: anyTol ? 'within_tolerance' : 'exact',
    detail: 'all present subfields agree',
    fields,
  };
}

/** compareNumbers(a, b, opts) → { agree, kind, detail }. */
function compareNumbers(a, b, o) {
  if (a === b) return { agree: true, kind: 'exact', detail: `${a} == ${b}` };
  const diff = Math.abs(a - b);
  if (diff <= o.absTol) return { agree: true, kind: 'exact', detail: `|Δ|=${diff} ≤ absTol` };
  const denom = Math.max(Math.abs(a), Math.abs(b));
  const rel = denom === 0 ? Infinity : diff / denom;
  if (rel <= o.relTol) {
    return { agree: true, kind: 'within_tolerance', detail: `relΔ=${rel.toExponential(2)} ≤ ${o.relTol}` };
  }
  return { agree: false, kind: 'numeric_mismatch', detail: `${a} vs ${b} (relΔ=${rel.toExponential(2)})` };
}

function isScalarMissing(v) {
  return isMissing(v) || (typeof v === 'string' && v.trim() === '');
}

/** normText — trim, collapse internal whitespace, lowercase. */
function normText(v) {
  return String(v).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * summarizeConflicts(elements, valuesA, valuesB, opts?) — compare two full value
 * maps across a list of elements (expanding arm-scoped elements over whichever arm
 * keys appear in either map).
 *
 * valuesX is a map keyed `${elementId}::${armKey || ''}` → raw value.
 *
 * @returns {{
 *   total:number, agreements:number,
 *   conflicts: Array<{ elementId:string, armKey:string, result:object }>,
 *   agreementRate:number
 * }}
 * agreementRate is agreements / total (1 when total is 0 — nothing to disagree on).
 */
export function summarizeConflicts(elements, valuesA = {}, valuesB = {}, opts = {}) {
  const conflicts = [];
  let total = 0;
  let agreements = 0;

  for (const el of elements || []) {
    const armKeys = collectArmKeys(el, valuesA, valuesB);
    for (const armKey of armKeys) {
      const key = valueKey(el.id, armKey);
      const a = valuesA[key];
      const b = valuesB[key];
      const result = compareValues(el, a, b, opts);
      total += 1;
      if (result.agree) agreements += 1;
      else conflicts.push({ elementId: el.id, armKey, result });
    }
  }

  return {
    total,
    agreements,
    conflicts,
    agreementRate: total === 0 ? 1 : agreements / total,
  };
}

/**
 * collectArmKeys — for a study-scoped element return ['']; for an arm-scoped
 * element return the union of arm keys present in either value map (or [''] if the
 * element is arm-scoped but no arm-specific values exist yet).
 */
function collectArmKeys(el, valuesA, valuesB) {
  if (el.armScope !== 'arm') return [''];
  const prefix = `${el.id}::`;
  const set = new Set();
  for (const map of [valuesA, valuesB]) {
    for (const k of Object.keys(map || {})) {
      if (k.startsWith(prefix)) set.add(k.slice(prefix.length));
    }
  }
  if (set.size === 0) return [''];
  return [...set].sort();
}
