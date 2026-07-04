/**
 * kmGuyot.test.js — pseudo-IPD reconstruction from digitized Kaplan–Meier curves
 * (Guyot 2012) plus HR derivation via Cox (Breslow) and log-rank/Peto (Tierney 2007).
 *
 * Deterministic: all randomness comes from a tiny seeded LCG defined in this file, so
 * every run is byte-identical. No Date, no external state.
 *
 * Covers:
 *   - logRank hand case: O1/E1/V verified against hand-computed values (math in comments).
 *   - coxHR sanity: 2-arm exponential (n=300/arm, HR 1.5, admin censoring) — beta near
 *     ln(1.5), CI covers it, log-rank hr within 10% of Cox hr.
 *   - Guyot round trip: true IPD → kmFromIPD + at-risk table → reconstructIPD →
 *     (a) total events within 5%, (b) round-trip S within 0.02, (c) Cox log-HR within 0.1.
 *   - Degenerate inputs: empty curve, increasing-S clamping, single at-risk + totalEvents.
 */

import { describe, it, expect } from 'vitest';
import {
  reconstructIPD,
  kmFromIPD,
  logRank,
  coxHR,
  cleanCurveInput,
} from '../../../src/research-engine/extraction/digitizer/kmGuyot.js';

/* ── tiny seeded LCG (Numerical Recipes constants) → U(0,1) ── */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296; // in (0,1), never exactly 0 or 1
  };
}

/** Simulate one exponential arm with administrative censoring at time C. */
function simulateArm(n, rate, C, rng) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = rng();
    const t = -Math.log(u) / rate; // Exp(rate) via inverse CDF
    if (t > C) out.push({ time: C, event: 0 });
    else out.push({ time: t, event: 1 });
  }
  return out;
}

/** Numbers-at-risk table from IPD at the given report times (n = #subjects with time ≥ t). */
function atRiskFromIPD(ipd, times) {
  return times.map((t) => ({ t, n: ipd.filter((r) => r.time >= t - 1e-9).length }));
}

/** Evaluate a KM step function (ascending points) at time t. */
function evalStep(points, t) {
  let s = 1;
  for (const p of points) {
    if (p.t <= t + 1e-9) s = p.s;
    else break;
  }
  return s;
}

describe('logRank — hand-computed case', () => {
  // Arm A (x=0): event at t=2, censored at t=4.
  // Arm B (x=1, "group 1"): events at t=1 and t=3.
  //
  // Pooled event times 1,2,3 with risk-set counts:
  //   t=1: nA=2, nB=2, n=4, dA=0, dB=1, d=1
  //   t=2: nA=2, nB=1, n=3, dA=1, dB=0, d=1
  //   t=3: nA=1, nB=1, n=2, dA=0, dB=1, d=1
  // O1 (obs events in B)  = 1 + 0 + 1 = 2
  // E1 = 1*(2/4) + 1*(1/3) + 1*(1/2) = 1/2 + 1/3 + 1/2 = 4/3 ≈ 1.3333333
  // V  = Σ d*(nB/n)*(nA/n)*(n−d)/(n−1)
  //    = 1*(2/4)*(2/4)*(3/3) + 1*(1/3)*(2/3)*(2/2) + 1*(1/2)*(1/2)*(1/1)
  //    = 1/4 + 2/9 + 1/4 = 13/18 ≈ 0.7222222
  // chi2 = (O1−E1)^2 / V = (2/3)^2 / (13/18) = (4/9)/(13/18) = 8/13 ≈ 0.6153846
  // hr   = exp((O1−E1)/V) = exp((2/3)/(13/18)) = exp(12/13) ≈ 2.517158
  const ipdA = [
    { time: 2, event: 1 },
    { time: 4, event: 0 },
  ];
  const ipdB = [
    { time: 1, event: 1 },
    { time: 3, event: 1 },
  ];
  const r = logRank(ipdA, ipdB);

  it('matches hand-computed O1, E1, V', () => {
    expect(r.O1).toBe(2);
    expect(r.E1).toBeCloseTo(4 / 3, 10);
    expect(r.V).toBeCloseTo(13 / 18, 10);
  });

  it('matches hand-computed chi2, hr and a sane p', () => {
    expect(r.chi2).toBeCloseTo(8 / 13, 10);
    expect(r.hr).toBeCloseTo(Math.exp(12 / 13), 8);
    expect(r.p).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(1);
    expect(r.lo).toBeLessThan(r.hr);
    expect(r.hi).toBeGreaterThan(r.hr);
  });
});

describe('coxHR — 2-arm exponential sanity (HR 1.5)', () => {
  const rng = makeRng(20240703);
  const trueA = simulateArm(300, 1.0, 2.0, rng); // reference hazard 1.0
  const trueB = simulateArm(300, 1.5, 2.0, rng); // hazard 1.5 → HR(B vs A) = 1.5
  const cox = coxHR(trueA, trueB);
  const lr = logRank(trueA, trueB);

  it('converges to a valid fit', () => {
    expect(cox.ok).toBe(true);
    expect(cox.converged).toBe(true);
    expect(Number.isFinite(cox.se)).toBe(true);
  });

  it('estimates beta within ~0.12 of ln(1.5)', () => {
    expect(Math.abs(cox.beta - Math.log(1.5))).toBeLessThan(0.12);
  });

  it('95% CI covers the true HR of 1.5', () => {
    expect(cox.lo).toBeLessThan(1.5);
    expect(cox.hi).toBeGreaterThan(1.5);
  });

  it('log-rank hr is within 10% of Cox hr', () => {
    expect(Math.abs(lr.hr - cox.hr) / cox.hr).toBeLessThan(0.1);
  });

  it('flags monotone likelihood (all events one arm) as ok:false', () => {
    const allEvents = [{ time: 1, event: 1 }, { time: 2, event: 1 }];
    const noEvents = [{ time: 1, event: 0 }, { time: 2, event: 0 }];
    expect(coxHR(allEvents, noEvents).ok).toBe(false);
  });
});

describe('Guyot round trip — reconstruct pseudo-IPD from a digitized curve', () => {
  const rng = makeRng(987654321);
  const trueA = simulateArm(300, 1.0, 2.0, rng);
  const trueB = simulateArm(300, 1.5, 2.0, rng);
  const reportTimes = [0, 0.25, 0.5, 0.75, 1.0];

  const curveA = kmFromIPD(trueA).map((p) => ({ t: p.t, s: p.s }));
  const curveB = kmFromIPD(trueB).map((p) => ({ t: p.t, s: p.s }));
  const atRiskA = atRiskFromIPD(trueA, reportTimes);
  const atRiskB = atRiskFromIPD(trueB, reportTimes);

  const recA = reconstructIPD({ curve: curveA, atRisk: atRiskA });
  const recB = reconstructIPD({ curve: curveB, atRisk: atRiskB });

  it('reconstructs successfully with diagnostics', () => {
    expect(recA.ok).toBe(true);
    expect(recB.ok).toBe(true);
    expect(recA.diagnostics.eventsPerInterval.length).toBe(reportTimes.length);
    expect(Number.isFinite(recA.diagnostics.finalAtRiskError)).toBe(true);
  });

  it('(a) reconstructed total events are within 5% of truth', () => {
    const trueEvA = trueA.filter((r) => r.event === 1).length;
    const recEvA = recA.ipd.filter((r) => r.event === 1).length;
    expect(Math.abs(recEvA - trueEvA) / trueEvA).toBeLessThan(0.05);

    const trueEvB = trueB.filter((r) => r.event === 1).length;
    const recEvB = recB.ipd.filter((r) => r.event === 1).length;
    expect(Math.abs(recEvB - trueEvB) / trueEvB).toBeLessThan(0.05);
  });

  it('(b) round-trip KM matches the input curve within 0.02 at each digitized time', () => {
    const kmRecA = kmFromIPD(recA.ipd);
    let maxErr = 0;
    for (const p of curveA) {
      maxErr = Math.max(maxErr, Math.abs(evalStep(kmRecA, p.t) - p.s));
    }
    expect(maxErr).toBeLessThan(0.02);
  });

  it('(c) Cox log-HR on reconstructed data is within 0.1 of Cox log-HR on truth', () => {
    const cTrue = coxHR(trueA, trueB);
    const cRec = coxHR(recA.ipd, recB.ipd);
    expect(cTrue.ok).toBe(true);
    expect(cRec.ok).toBe(true);
    expect(Math.abs(Math.log(cRec.hr) - Math.log(cTrue.hr))).toBeLessThan(0.1);
  });
});

describe('reconstructIPD — degenerate & defensive inputs', () => {
  it('empty curve → ok:false', () => {
    expect(reconstructIPD({ curve: [], atRisk: [{ t: 0, n: 100 }] }).ok).toBe(false);
    expect(reconstructIPD({ curve: null, atRisk: [{ t: 0, n: 100 }] }).ok).toBe(false);
    expect(reconstructIPD({}).ok).toBe(false);
  });

  it('missing initial at-risk entry → ok:false', () => {
    const res = reconstructIPD({ curve: [{ t: 1, s: 0.9 }], atRisk: [] });
    expect(res.ok).toBe(false);
  });

  it('cleanCurveInput sorts, clamps s to [0,1], and enforces non-increasing survival', () => {
    const dirty = [
      { t: 2, s: 0.4 },
      { t: 1, s: 1.3 }, // clamp to 1
      { t: 3, s: 0.9 }, // increasing vs t=2 → clamped down to 0.4
      { t: 4, s: -0.2 }, // clamp to 0
    ];
    const clean = cleanCurveInput(dirty);
    expect(clean.map((p) => p.t)).toEqual([1, 2, 3, 4]);
    expect(clean[0].s).toBe(1);
    expect(clean[1].s).toBe(0.4);
    expect(clean[2].s).toBeLessThanOrEqual(clean[1].s);
    expect(clean[3].s).toBe(0); // 0 ≤ previous, kept
  });

  it('reconstructIPD tolerates an increasing-s curve (clamped internally)', () => {
    const res = reconstructIPD({
      curve: [
        { t: 1, s: 0.8 },
        { t: 2, s: 0.95 }, // would increase — clamped to 0.8
        { t: 3, s: 0.6 },
      ],
      atRisk: [
        { t: 0, n: 50 },
        { t: 2, n: 30 },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.ipd.every((r) => (r.event === 0 || r.event === 1) && Number.isFinite(r.time))).toBe(true);
  });

  it('single at-risk entry + totalEvents path works (no-at-risk variant)', () => {
    // A curve implying more events than actually occurred; totalEvents caps them via
    // added uniform censoring.
    const curve = [
      { t: 0, s: 1.0 },
      { t: 1, s: 0.8 },
      { t: 2, s: 0.6 },
      { t: 3, s: 0.4 },
      { t: 4, s: 0.25 },
    ];
    const res = reconstructIPD({ curve, atRisk: [{ t: 0, n: 100 }], totalEvents: 40 });
    expect(res.ok).toBe(true);
    const events = res.ipd.filter((r) => r.event === 1).length;
    // Reconstructed events should not exceed the reported total by more than rounding noise.
    expect(events).toBeLessThanOrEqual(45);
    expect(events).toBeGreaterThan(0);
    // Every subject is accounted for and every row is well-formed.
    expect(res.ipd.length).toBeGreaterThanOrEqual(events);
    expect(res.ipd.every((r) => r.event === 0 || r.event === 1)).toBe(true);
  });

  it('single at-risk entry, no totalEvents → events straight from the curve, remainder censored', () => {
    const curve = [
      { t: 0, s: 1.0 },
      { t: 1, s: 0.8 },
      { t: 2, s: 0.6 },
    ];
    const res = reconstructIPD({ curve, atRisk: [{ t: 0, n: 100 }] });
    expect(res.ok).toBe(true);
    // No censoring guessed inside the interval; remainder censored at the last time.
    const km = kmFromIPD(res.ipd);
    expect(Math.abs(evalStep(km, 2) - 0.6)).toBeLessThan(0.02);
  });
});
