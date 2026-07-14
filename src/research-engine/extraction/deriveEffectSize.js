/**
 * deriveEffectSize.js
 * Derive a poolable effect size (es/lo/hi on the ANALYSIS scale) from a study's
 * RAW extracted cells, reusing the canonical calcES.
 *
 * 86.md P0.3 — the Pecan Extraction Engine replaced the classic tab's inline
 * "calculate effect size from raw data" calculator with only a reported-format
 * Converter, so a reviewer could extract a 2×2 (a/b/c/d) or continuous (mean/SD)
 * study to 100% and mark it Complete, yet it would silently never enter the
 * meta-analysis (runMeta pools only rows with es/lo/hi). This shared, PURE helper
 * maps the study's stored raw fields onto the names calcES expects and returns the
 * derived analysis-scale values + a conversions[] audit entry, so the engine can
 * backfill es/lo/hi at completion.
 *
 * Only derives when the study has NO usable es yet AND its measure is raw-derivable
 * with a COMPLETE input set — never overwrites a reviewer-entered effect size, and
 * returns null (caller leaves the study untouched) when inputs are missing/invalid.
 */
import { calcES } from '../statistics/monolithStats.js';

// Measures whose es/lo/hi come from raw cells (not an already-computed ratio+CI,
// which the click-assign path already handles). HR/GENERIC/AUC/BETA are entered as
// a value+CI directly, so they are out of scope here.
const RAW_DERIVABLE = new Set(['SMD', 'MD', 'OR', 'RR', 'RD', 'PETO', 'COR', 'PROP', 'DIAG', 'IRR']);

const nonEmpty = (v) => v !== '' && v !== null && v !== undefined;

/** Map a study's stored raw fields onto the parameter names calcES expects. */
function paramsFor(study) {
  return {
    // continuous arms
    m1: study.meanExp, sd1: study.sdExp, n1: study.nExp,
    m2: study.meanCtrl, sd2: study.sdCtrl, n2: study.nCtrl,
    // 2×2 counts
    a: study.a, b: study.b, c: study.c, d: study.d,
    // correlation
    r: study.r, n: study.n,
    // single-arm proportion
    events: study.events, total: study.total,
    // diagnostic 2×2
    tp: study.tp, fp: study.fp, fn: study.fn, tn: study.tn,
    // incidence-rate ratio
    e1: study.e1, t1: study.t1, e2: study.e2, t2: study.t2,
  };
}

/** The raw fields that must ALL be present for a given measure to be derivable. */
const REQUIRED = {
  SMD: ['meanExp', 'sdExp', 'nExp', 'meanCtrl', 'sdCtrl', 'nCtrl'],
  MD: ['meanExp', 'sdExp', 'nExp', 'meanCtrl', 'sdCtrl', 'nCtrl'],
  OR: ['a', 'b', 'c', 'd'],
  RR: ['a', 'b', 'c', 'd'],
  RD: ['a', 'b', 'c', 'd'],
  PETO: ['a', 'b', 'c', 'd'],
  COR: ['r', 'n'],
  PROP: ['events', 'total'],
  DIAG: ['tp', 'fp', 'fn', 'tn'],
  IRR: ['e1', 't1', 'e2', 't2'],
};

/** True when the study already has a usable analysis-scale effect size. */
export function hasEffectSize(study) {
  return study && nonEmpty(study.es) && !Number.isNaN(+study.es);
}

/** True when the study's raw input set for its measure is complete. */
export function rawInputsComplete(study) {
  const type = study && study.esType;
  const req = REQUIRED[type];
  if (!req) return false;
  return req.every((k) => nonEmpty(study[k]));
}

/**
 * deriveEffectSizeFromRaw(study)
 * @returns {null | { es:string, lo:string, hi:string, esType:string,
 *   conversion:{ id, type, method, reason, at, inputs, result } }}
 *   null when: es already set, measure not raw-derivable, inputs incomplete, or the
 *   computation is not estimable (e.g. double-zero 2×2 → use RD).
 */
export function deriveEffectSizeFromRaw(study, { at = '' } = {}) {
  if (!study || hasEffectSize(study)) return null;
  const type = study.esType;
  if (!RAW_DERIVABLE.has(type)) return null;
  if (!rawInputsComplete(study)) return null;

  const r = calcES(type, paramsFor(study));
  if (!r || Number.isNaN(+r.es) || Number.isNaN(+r.lo) || Number.isNaN(+r.hi)) return null;

  const fx = (n) => String(+Number(n).toFixed(6));
  const es = fx(r.es), lo = fx(r.lo), hi = fx(r.hi);
  const inputs = {};
  for (const k of REQUIRED[type]) inputs[k] = study[k];
  return {
    es, lo, hi, esType: type,
    conversion: {
      id: `d${type}${(inputs.a ?? inputs.meanExp ?? inputs.tp ?? inputs.events ?? inputs.r ?? '')}`.slice(0, 24),
      type: 'raw_to_es',
      method: `calcES(${type}) from raw cells`,
      reason: `Derived analysis-scale effect size from raw ${type} data`,
      at,
      inputs,
      result: { es, lo, hi },
      ...(r.continuityCorrectionApplied ? { continuityCorrection: r.correctionMethod || 'Haldane-Anscombe' } : {}),
    },
  };
}
