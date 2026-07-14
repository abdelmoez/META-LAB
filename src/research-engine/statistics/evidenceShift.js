/**
 * evidenceShift.js
 * Detects clinically meaningful changes between two meta-analytic snapshots of the
 * SAME outcome/timepoint, so a living review can flag when accumulating evidence has
 * moved enough to warrant a human re-read.
 *
 * All effect sizes are on the ANALYSIS scale: log for ratio measures (OR/RR/HR),
 * raw otherwise. The caller guarantees this (runMeta already pools on the analysis
 * scale). "No effect" is therefore es = 0 on every analysis scale — a ratio's null
 * of 1 is ln(1) = 0. Significance is judged by whether the 95% CI [lo,hi] crosses 0.
 *
 * The language is deliberately cautious: these are triggers for review, never
 * conclusions. A shift means "look again", not "the evidence has changed".
 */

/**
 * Default thresholds.
 *   relEffectChange — relative change in |es| that counts as a magnitude shift.
 *   i2Change        — absolute I² percentage-point change that counts (heterogeneity).
 *   minK            — minimum k in BOTH snapshots for direction/significance calls
 *                     (avoids alarming on a single new study).
 */
export const DEFAULT_SHIFT_THRESHOLDS = {
  relEffectChange: 0.25,
  i2Change: 20,
  minK: 2,
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// 86.md P2.15/P3.30 — the "no effect" value is 0 on the analysis scale for ratio
// measures (ln 1 = 0), SMD/MD/RD/BETA and Fisher-z, BUT AUC is stored on its RAW
// 0–1 scale where the null is 0.5, not 0. Judging AUC significance against 0 made
// every AUC CI trivially "exclude the null" (AUC ≥ 0 always), so significance/
// direction shifts for AUC outcomes were meaningless. Make the null measure-aware.
function nullOf(esType) {
  return String(esType || '').trim().toUpperCase() === 'AUC' ? 0.5 : 0;
}

/** CI crosses (or touches) the measure's null → not significant. */
function crossesNull(lo, hi, nul = 0) {
  if (!isNum(lo) || !isNum(hi)) return null; // unknown
  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);
  return low <= nul && high >= nul;
}

/** Compact per-snapshot payload echoed into each shift for the UI/audit trail. */
function pick(s) {
  if (!s) return null;
  return {
    k: s.k,
    es: s.es,
    lo: s.lo,
    hi: s.hi,
    i2: s.i2,
    pval: s.pval,
    method: s.method,
  };
}

const SEVERITY_RANK = { info: 0, notable: 1, major: 2 };

/**
 * detectEvidenceShift(prev, curr, thresholds)
 * Compare two MA summaries for the same outcome+timepoint.
 *
 * Summary shape (both prev and curr):
 *   { outcome, timepoint, esType, k, es, lo, hi, pval, i2, method }
 * with es/lo/hi on the ANALYSIS scale. Either side may be null to signal that the
 * outcome was added (prev null) or removed (curr null).
 *
 * @param {object|null} prev
 * @param {object|null} curr
 * @param {object} [thresholds]  overrides for DEFAULT_SHIFT_THRESHOLDS
 * @returns {{shifts: Array, any: boolean, majors: number}}
 */
export function detectEvidenceShift(prev, curr, thresholds = {}) {
  const th = { ...DEFAULT_SHIFT_THRESHOLDS, ...thresholds };
  const shifts = [];

  // Identity carried on every shift (fall back across whichever side exists).
  const ref = curr || prev || {};
  const base = {
    outcome: ref.outcome,
    timepoint: ref.timepoint,
    esType: ref.esType,
  };

  const add = (type, severity, message, extra = {}) => {
    shifts.push({
      ...base,
      type,
      severity,
      prev: pick(prev),
      curr: pick(curr),
      message,
      ...extra,
    });
  };

  // ── Outcome appeared / disappeared between snapshots ──────────────────────
  if (!prev && curr) {
    add(
      'outcome_added',
      'info',
      `Potential evidence shift: outcome "${curr.outcome ?? 'unknown'}" is newly synthesised in this update. Review recommended.`,
    );
    return finalize(shifts);
  }
  if (prev && !curr) {
    add(
      'outcome_removed',
      'info',
      `Potential evidence shift: outcome "${prev.outcome ?? 'unknown'}" is no longer synthesised in this update. Review recommended.`,
    );
    return finalize(shifts);
  }
  if (!prev && !curr) {
    return finalize(shifts);
  }

  const kPrev = isNum(prev.k) ? prev.k : null;
  const kCurr = isNum(curr.k) ? curr.k : null;
  const bothMeetMinK = kPrev !== null && kCurr !== null && kPrev >= th.minK && kCurr >= th.minK;

  // Measure-aware null (0 on the analysis scale; 0.5 for raw-scale AUC).
  const nul = nullOf(base.esType);

  // ── Direction change: side of the pooled effect flipped relative to the null ─
  // Only meaningful when both snapshots are non-trivially estimated (k >= minK)
  // and both effects are clearly on one side of the null.
  let directionFired = false;
  if (bothMeetMinK && isNum(prev.es) && isNum(curr.es) && prev.es !== nul && curr.es !== nul) {
    if (Math.sign(prev.es - nul) !== Math.sign(curr.es - nul)) {
      directionFired = true;
      add(
        'direction_change',
        'major',
        `Potential evidence shift: the pooled direction of effect for "${base.outcome ?? 'this outcome'}" has reversed between updates. Review recommended before drawing conclusions.`,
      );
    }
  }

  // ── Significance change: CI crossed the null in exactly one snapshot ───────
  if (bothMeetMinK) {
    const prevCrosses = crossesNull(prev.lo, prev.hi, nul);
    const currCrosses = crossesNull(curr.lo, curr.hi, nul);
    if (prevCrosses !== null && currCrosses !== null && prevCrosses !== currCrosses) {
      const gained = prevCrosses && !currCrosses; // was non-sig, now sig
      const msg = gained
        ? `Potential evidence shift: the pooled effect for "${base.outcome ?? 'this outcome'}" now excludes the null value where it previously did not. Review recommended.`
        : `Potential evidence shift: the pooled effect for "${base.outcome ?? 'this outcome'}" now includes the null value where it previously did not. Review recommended.`;
      add('significance_change', 'major', msg, { significanceGained: gained });
    }
  }

  // ── Effect magnitude: relative change in |es| beyond threshold ────────────
  if (isNum(prev.es) && isNum(curr.es)) {
    const denom = Math.max(Math.abs(prev.es), 0.05);
    const relChange = Math.abs(curr.es - prev.es) / denom;
    if (relChange >= th.relEffectChange) {
      add(
        'effect_magnitude',
        'notable',
        `Potential evidence shift: the pooled effect magnitude for "${base.outcome ?? 'this outcome'}" changed by roughly ${Math.round(relChange * 100)}% between updates. Review recommended.`,
        { relChange },
      );
    }
  }

  // ── Heterogeneity: absolute I² change beyond threshold ────────────────────
  if (isNum(prev.i2) && isNum(curr.i2)) {
    const i2Diff = Math.abs(curr.i2 - prev.i2);
    if (i2Diff >= th.i2Change) {
      add(
        'heterogeneity_change',
        'info',
        `Potential evidence shift: heterogeneity (I²) for "${base.outcome ?? 'this outcome'}" changed by ${Math.round(i2Diff)} percentage points between updates. Review recommended.`,
        { i2Diff },
      );
    }
  }

  // ── Studies added: k increased ────────────────────────────────────────────
  // Standalone-noteworthy only if it grew by >=25%, OR any other shift also fired
  // (a small bump alongside a real shift is worth surfacing together).
  if (kPrev !== null && kCurr !== null && kCurr > kPrev) {
    const anyOtherFired = shifts.length > 0;
    const growthRatio = kPrev > 0 ? (kCurr - kPrev) / kPrev : Infinity;
    if (anyOtherFired || growthRatio >= 0.25) {
      add(
        'studies_added',
        'info',
        `Potential evidence shift: ${kCurr - kPrev} additional stud${kCurr - kPrev === 1 ? 'y' : 'ies'} contributed to "${base.outcome ?? 'this outcome'}" in this update (${kPrev} → ${kCurr}). Review recommended.`,
        { kDelta: kCurr - kPrev },
      );
    }
  }

  return finalize(shifts);
}

/** Sort by severity (major first), tally, and wrap. */
function finalize(shifts) {
  shifts.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  const majors = shifts.filter((s) => s.severity === 'major').length;
  return { shifts, any: shifts.length > 0, majors };
}
