/**
 * extraction/maHandoff.js — P5. Pure bridge from RECONCILED extraction values to the
 * study-blob shape the meta-analysis engine consumes. This is the join between the
 * extraction system (Data Elements + per-arm values) and the existing analysis
 * pipeline (mkStudy rows with string-typed numerics + es/lo/hi).
 *
 * CONTRACT WITH mkStudy (project-model/defaults.js):
 *   - ALL numeric fields in a study blob are STRINGS ("" means empty). This function
 *     therefore emits String(...) for every count/stat, and NEVER emits "" — a
 *     value that isn't available is simply OMITTED from the patch.
 *   - Dichotomous 2×2 uses a/b/c/d where a=event/exp, b=no-event/exp, c=event/ctrl,
 *     d=no-event/ctrl.
 *   - Continuous uses nExp/meanExp/sdExp and nCtrl/meanCtrl/sdCtrl.
 *   - es/lo/hi are on the ANALYSIS scale (log for OR/RR, absolute for RD/MD/SMD) and
 *     are produced ONLY by calcES — never hand-rolled here. They are written ONLY
 *     when the caller passes opts.esType and calcES returns a non-null result.
 *
 * INPUT
 *   elements: the Data Element definitions (used for outcome/timepoint/maCompatible).
 *   consensusValues: reconciled value map keyed `${elementId}::${armKey || ''}`.
 *   opts:
 *     arms:  [interventionArmKey, comparatorArmKey]  (default ['intervention','comparator'])
 *     esType: optional 'OR'|'RR'|'RD' (dichotomous) or 'MD'|'SMD' (continuous).
 *
 * OUTPUT
 *   { patch, esInputs, warnings }
 *     patch     — partial study blob (strings only; keys omitted when unavailable)
 *     esInputs  — the exact params handed to calcES (for transparency/debugging)
 *     warnings  — human-readable notes (missing denominators/SD, zero cells, unresolved refs)
 */

import { calcES } from '../effect-sizes/calculators.js';
import { valueKey } from './model.js';

const DEFAULT_ARMS = ['intervention', 'comparator'];
const DICHOTOMOUS_ES = new Set(['OR', 'RR', 'RD']);
const CONTINUOUS_ES = new Set(['MD', 'SMD']);

/**
 * consensusToStudyPatch(elements, consensusValues, opts?) — build a study patch.
 * @returns {{ patch:object, esInputs:(object|null), warnings:string[] }}
 */
export function consensusToStudyPatch(elements = [], consensusValues = {}, opts = {}) {
  const arms = Array.isArray(opts.arms) && opts.arms.length === 2 ? opts.arms : DEFAULT_ARMS;
  const [expArm, ctrlArm] = arms;
  const warnings = [];
  const patch = {};

  // Find the MA-compatible element pair (dichotomous or continuous).
  const dichEls = elements.filter((e) => e.maCompatible === 'dichotomous');
  const contEls = elements.filter((e) => e.maCompatible === 'continuous');

  let esInputs = null;

  if (dichEls.length) {
    esInputs = buildDichotomous(dichEls, consensusValues, expArm, ctrlArm, patch, warnings);
    applyOutcomeMeta(dichEls, patch);
    maybeCalcES(opts.esType, DICHOTOMOUS_ES, esInputs, patch, warnings, 'dichotomous');
  } else if (contEls.length) {
    esInputs = buildContinuous(contEls, consensusValues, expArm, ctrlArm, patch, warnings);
    applyOutcomeMeta(contEls, patch);
    maybeCalcES(opts.esType, CONTINUOUS_ES, esInputs, patch, warnings, 'continuous');
  } else {
    warnings.push('no MA-compatible (dichotomous/continuous) element found — nothing to hand off');
  }

  return { patch, esInputs, warnings };
}

/* ── Dichotomous ──────────────────────────────────────────────────────────── */

function buildDichotomous(els, values, expArm, ctrlArm, patch, warnings) {
  // Prefer a single per-arm element (events entered per arm); otherwise take the
  // first two elements as intervention/comparator (the dichotomous_2x2 template).
  const exp = resolveArmDichotomous(els, values, expArm);
  const ctrl = resolveArmDichotomous(els, values, ctrlArm);

  if (!exp) warnings.push(`missing consensus dichotomous value for arm "${expArm}"`);
  if (!ctrl) warnings.push(`missing consensus dichotomous value for arm "${ctrlArm}"`);
  if (!exp || !ctrl) {
    listUnresolved(els, values, [expArm, ctrlArm], warnings);
    return null;
  }

  const { events: aEv, total: aTot } = exp;
  const { events: cEv, total: cTot } = ctrl;

  if (aTot == null) warnings.push(`missing denominator (total) for arm "${expArm}"`);
  if (cTot == null) warnings.push(`missing denominator (total) for arm "${ctrlArm}"`);
  if (aEv == null || aTot == null || cEv == null || cTot == null) {
    return null;
  }

  const a = aEv;
  const b = aTot - aEv;
  const c = cEv;
  const d = cTot - cEv;

  if (b < 0 || d < 0) {
    warnings.push('events exceed total in a reconciled arm — check the data');
    return null;
  }
  if (a === 0 || b === 0 || c === 0 || d === 0) {
    warnings.push('zero cell present — calcES applies a Haldane–Anscombe continuity correction for OR/RR');
  }

  patch.a = String(a);
  patch.b = String(b);
  patch.c = String(c);
  patch.d = String(d);
  patch.dataNature = 'primary';

  return { a, b, c, d };
}

/** resolveArmDichotomous — get {events,total} for one arm from the value map. */
function resolveArmDichotomous(els, values, armKey) {
  // Direct: a single arm-scoped element carrying this arm's value.
  for (const el of els) {
    const v = values[valueKey(el.id, armKey)];
    const parsed = parseDichotomousValue(v);
    if (parsed) return parsed;
  }
  // Template shape: two distinct elements (one per arm), value under armKey ''.
  // Match element by name hint (intervention/comparator/exp/ctrl).
  const hint = armHint(armKey);
  for (const el of els) {
    const name = String(el.name || '').toLowerCase();
    if (hint.some((h) => name.includes(h))) {
      const v = values[valueKey(el.id, '')];
      const parsed = parseDichotomousValue(v);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseDichotomousValue(v) {
  if (!v || typeof v !== 'object') return null;
  const events = numOr(v.events);
  const total = numOr(v.total);
  if (events === null && total === null) return null;
  return { events, total };
}

/* ── Continuous ───────────────────────────────────────────────────────────── */

function buildContinuous(els, values, expArm, ctrlArm, patch, warnings) {
  const exp = resolveArmContinuous(els, values, expArm);
  const ctrl = resolveArmContinuous(els, values, ctrlArm);

  if (!exp) warnings.push(`missing consensus continuous value for arm "${expArm}"`);
  if (!ctrl) warnings.push(`missing consensus continuous value for arm "${ctrlArm}"`);
  if (!exp || !ctrl) {
    listUnresolved(els, values, [expArm, ctrlArm], warnings);
    return null;
  }

  if (exp.sd == null) warnings.push(`missing SD for arm "${expArm}"`);
  if (ctrl.sd == null) warnings.push(`missing SD for arm "${ctrlArm}"`);
  if (exp.n == null) warnings.push(`missing N for arm "${expArm}"`);
  if (ctrl.n == null) warnings.push(`missing N for arm "${ctrlArm}"`);

  // Emit whatever is present (strings only; omit missing keys).
  if (exp.n != null) patch.nExp = String(exp.n);
  if (exp.mean != null) patch.meanExp = String(exp.mean);
  if (exp.sd != null) patch.sdExp = String(exp.sd);
  if (ctrl.n != null) patch.nCtrl = String(ctrl.n);
  if (ctrl.mean != null) patch.meanCtrl = String(ctrl.mean);
  if (ctrl.sd != null) patch.sdCtrl = String(ctrl.sd);
  patch.dataNature = 'primary';

  if (exp.mean == null || ctrl.mean == null || exp.sd == null || ctrl.sd == null || exp.n == null || ctrl.n == null) {
    return null; // incomplete → no es computation possible
  }
  return {
    m1: exp.mean, sd1: exp.sd, n1: exp.n,
    m2: ctrl.mean, sd2: ctrl.sd, n2: ctrl.n,
  };
}

function resolveArmContinuous(els, values, armKey) {
  for (const el of els) {
    const v = values[valueKey(el.id, armKey)];
    const parsed = parseContinuousValue(v);
    if (parsed) return parsed;
  }
  const hint = armHint(armKey);
  for (const el of els) {
    const name = String(el.name || '').toLowerCase();
    if (hint.some((h) => name.includes(h))) {
      const v = values[valueKey(el.id, '')];
      const parsed = parseContinuousValue(v);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseContinuousValue(v) {
  if (!v || typeof v !== 'object') return null;
  const mean = numOr(v.mean);
  const sd = numOr(v.sd);
  const n = numOr(v.n);
  if (mean === null && sd === null && n === null) return null;
  return { mean, sd, n };
}

/* ── Shared ───────────────────────────────────────────────────────────────── */

/**
 * maybeCalcES — write es/lo/hi ONLY when the caller requested a compatible esType
 * AND calcES returns a valid result. Never fabricates es/lo/hi.
 */
function maybeCalcES(esType, allowed, esInputs, patch, warnings, family) {
  if (!esType) return;
  if (!allowed.has(esType)) {
    warnings.push(`esType "${esType}" is not valid for ${family} data — es/lo/hi not computed`);
    return;
  }
  if (!esInputs) {
    warnings.push(`insufficient reconciled data to compute ${esType} — es/lo/hi not computed`);
    return;
  }
  const res = calcES(esType, esInputs);
  if (!res) {
    warnings.push(`calcES(${esType}) returned null (not estimable) — es/lo/hi not computed`);
    return;
  }
  patch.es = String(res.es);
  patch.lo = String(res.lo);
  patch.hi = String(res.hi);
  patch.esType = esType;
  patch.source = 'calculated';
  if (res.continuityCorrectionApplied) {
    warnings.push(res.note || 'continuity correction applied by calcES');
  }
}

/** applyOutcomeMeta — copy outcome/timepoint from element defs into the patch. */
function applyOutcomeMeta(els, patch) {
  for (const el of els) {
    if (el.outcome && !patch.outcome) patch.outcome = el.outcome;
    if (el.timepoint && !patch.timepoint) patch.timepoint = el.timepoint;
  }
}

/** listUnresolved — add a warning naming the elementIds with no consensus value. */
function listUnresolved(els, values, armKeys, warnings) {
  const unresolved = [];
  for (const el of els) {
    const anyPresent = [''].concat(armKeys).some((ak) => {
      const v = values[valueKey(el.id, ak)];
      return v && typeof v === 'object' && Object.values(v).some((x) => x !== null && x !== undefined && x !== '');
    });
    if (!anyPresent) unresolved.push(el.id);
  }
  if (unresolved.length) {
    warnings.push(`unresolved/missing consensus values for element(s): ${unresolved.join(', ')}`);
  }
}

function armHint(armKey) {
  const k = String(armKey).toLowerCase();
  const hints = [k];
  if (/interv|exp|treat|active|drug/.test(k)) hints.push('intervention', 'exp', 'treatment', 'active');
  if (/comp|ctrl|control|placebo|ref/.test(k)) hints.push('comparator', 'control', 'ctrl', 'placebo', 'reference');
  return hints;
}

function numOr(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
