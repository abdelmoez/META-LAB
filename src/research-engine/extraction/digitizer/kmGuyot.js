/**
 * extraction/digitizer/kmGuyot.js — Pure, dependency-free reconstruction of
 * pseudo individual-patient data (IPD) from a DIGITIZED Kaplan–Meier curve, plus
 * derivation of a hazard ratio (HR) with 95% CI from two reconstructed arms.
 *
 * No I/O, no DOM, no React, no Node built-ins, no npm deps — safe to import from
 * the server, the client, and vitest. All timestamps are caller-supplied (this
 * module never calls Date.now()/new Date()). Malformed input is validated and
 * coerced (sort/clamp/dedupe) rather than thrown on: the reconstruction entry
 * point returns { ok:false, error } and the estimators return NaN-bearing / ok:false
 * results instead of raising, mirroring model.js / heuristicExtract.js habits.
 *
 * METHODS & CITATIONS
 *   Pseudo-IPD reconstruction follows the algorithm of
 *     Guyot P, Ades AE, Ouwens MJNM, Welton NJ. "Enhanced secondary analysis of
 *     survival data: reconstructing the data from published Kaplan-Meier survival
 *     curves." BMC Med Res Methodol 2012;12:9.
 *   Given digitized survival coordinates and the published numbers-at-risk, the
 *   algorithm walks each at-risk interval, iterating a guess of the number censored
 *   (distributed uniformly across the interval) and stepping through the digitized
 *   "clicks" — inverting the product-limit estimator to recover the number of events
 *   at each click — until the implied number-at-risk at the next reported time matches
 *   the published value. Where only the initial number-at-risk is known it falls back
 *   to Guyot's no-at-risk variant driven by the total event count; with neither it
 *   assumes no censoring.
 *
 *   The log-rank / Peto hazard-ratio derivation follows
 *     Tierney JF, Stewart LA, Ghersi D, Burdett S, Sydes MR. "Practical methods for
 *     incorporating summary time-to-event data into meta-analysis." Trials 2007;8:16.
 *   (Peto one-step HR = exp((O−E)/V), SE(lnHR) = 1/sqrt(V).)
 *
 *   The Cox HR uses a Newton–Raphson maximisation of the Breslow partial likelihood
 *   for a single binary covariate (arm B coded 1).
 *
 * ARM / DIRECTION CONVENTION
 *   Throughout, "arm A" is the reference (covariate x = 0) and "arm B" is the
 *   comparator (x = 1). Every reported hazard ratio is the hazard of arm B relative
 *   to arm A, so logRank().hr and coxHR().hr point the same way and are comparable.
 *
 * EXPORTS
 *   reconstructIPD({ curve, atRisk, totalEvents }) → { ok, ipd, diagnostics } | { ok:false, error }
 *   kmFromIPD(ipd)            → [{ t, s, nRisk }]   product-limit step points
 *   logRank(ipdA, ipdB)       → { O1, E1, V, chi2, p, hr, lo, hi }
 *   coxHR(ipdA, ipdB, opts)   → { ok, hr, lo, hi, se, beta, converged, iters } | { ok:false, ... }
 */

import { chiSquareCDF, Z975 } from '../../statistics/math-helpers.js';

/** Exact 97.5th-percentile normal deviate (== Z975 == 1.959963984540054). */
const Z = Z975;

/** Tolerance for treating two supplied times as identical. */
const T_EPS = 1e-9;

/** Safety cap on per-interval censor-fitting iterations (prevents ±1 oscillation hangs). */
const MAX_INTERVAL_ITER = 4000;

/* ───────────────────────────── input coercion ────────────────────────────── */

/**
 * cleanCurveInput(curve) — coerce a digitized survival curve into a clean,
 * ascending-in-time, non-increasing-in-survival list of { t, s } with s clamped to
 * [0,1]. Non-finite points are dropped; duplicate times collapse to their lowest s.
 * Never throws.
 * @param {Array<{t:number,s:number}>} curve
 * @returns {Array<{t:number,s:number}>}
 */
export function cleanCurveInput(curve) {
  if (!Array.isArray(curve)) return [];
  const pts = [];
  for (const p of curve) {
    if (!p) continue;
    const t = Number(p.t);
    const s = Number(p.s);
    if (!Number.isFinite(t) || !Number.isFinite(s)) continue;
    pts.push({ t, s: Math.min(1, Math.max(0, s)) });
  }
  pts.sort((a, b) => a.t - b.t);
  const dedup = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.t - p.t) < T_EPS) {
      last.s = Math.min(last.s, p.s);
    } else {
      dedup.push({ t: p.t, s: p.s });
    }
  }
  for (let i = 1; i < dedup.length; i++) {
    if (dedup[i].s > dedup[i - 1].s) dedup[i].s = dedup[i - 1].s;
  }
  return dedup;
}

/**
 * cleanAtRiskInput(atRisk) — coerce a numbers-at-risk table into ascending-in-time,
 * non-increasing-in-n integer entries. Non-finite entries dropped; duplicate times
 * keep the later entry. Never throws.
 * @param {Array<{t:number,n:number}>} atRisk
 * @returns {Array<{t:number,n:number}>}
 */
export function cleanAtRiskInput(atRisk) {
  if (!Array.isArray(atRisk)) return [];
  const pts = [];
  for (const a of atRisk) {
    if (!a) continue;
    const t = Number(a.t);
    const n = Number(a.n);
    if (!Number.isFinite(t) || !Number.isFinite(n)) continue;
    pts.push({ t, n: Math.max(0, Math.round(n)) });
  }
  pts.sort((a, b) => a.t - b.t);
  const dedup = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.t - p.t) < T_EPS) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  for (let i = 1; i < dedup.length; i++) {
    if (dedup[i].n > dedup[i - 1].n) dedup[i].n = dedup[i - 1].n;
  }
  return dedup;
}

/* ─────────────────────────── censoring distribution ───────────────────────── */

/**
 * distributeCensor — spread `nCensor` censoring times uniformly across an interval and
 * bin them onto the digitized clicks. Mutates cen[firstK..lastK] and returns the list
 * of censoring times (used later to place censored pseudo-subjects in the IPD).
 * Censor times are cen_j = tStart + j*(tEnd−tStart)/(nCensor+1), j = 1..nCensor
 * (Guyot 2012), each dropped into the click bin [tS[k], upperEdge) that contains it.
 */
function distributeCensor(firstK, lastK, tStart, tEnd, nCensor, tS, cen) {
  for (let k = firstK; k <= lastK; k++) cen[k] = 0;
  const times = [];
  if (nCensor <= 0) return times;
  if (!(tEnd > tStart)) {
    // Degenerate interval (no positive width): pile censoring at the first click.
    cen[firstK] += nCensor;
    for (let j = 0; j < nCensor; j++) times.push(tStart);
    return times;
  }
  for (let j = 1; j <= nCensor; j++) {
    const ct = tStart + (j * (tEnd - tStart)) / (nCensor + 1);
    let placed = false;
    for (let k = firstK; k <= lastK; k++) {
      const up = k < lastK ? tS[k + 1] : tEnd;
      if (ct >= tS[k] && ct < up) {
        cen[k]++;
        placed = true;
        break;
      }
    }
    if (!placed) cen[lastK]++;
    times.push(ct);
  }
  return times;
}

/**
 * stepEvents — walk clicks firstK..lastK inverting the product-limit estimator.
 * For each click k (after the origin) the number of events is
 *   d_k = round( n_k * (1 − S_k / KM_ref) )
 * and the running KM reference is updated only when d_k > 0. The number-at-risk steps
 * as n_{k+1} = n_k − d_k − cen_k. Returns the KM reference carried out of the interval.
 * Writes into d[] and nHat[]. Guards against zero/negative at-risk and ratio drift.
 */
function stepEvents(firstK, lastK, nStart, kmRefStart, isFirstInterval, tS, S, d, cen, nHat) {
  let km = kmRefStart;
  nHat[firstK] = nStart;
  for (let k = firstK; k <= lastK; k++) {
    let dk;
    if (isFirstInterval && k === firstK) {
      // The first digitized click is the origin (t=0, S=1): no events by convention.
      dk = 0;
    } else {
      let ratio = km > 0 ? S[k] / km : 1;
      if (ratio > 1) ratio = 1;
      if (ratio < 0) ratio = 0;
      dk = Math.round(nHat[k] * (1 - ratio));
      if (dk < 0) dk = 0;
      if (dk > nHat[k]) dk = nHat[k];
      if (dk > 0 && nHat[k] > 0) km = km * (1 - dk / nHat[k]);
    }
    d[k] = dk;
    let nn = nHat[k] - dk - cen[k];
    if (nn < 0) nn = 0;
    nHat[k + 1] = nn;
  }
  return km;
}

/**
 * fitClosedInterval — the core Guyot inner loop for an interval bounded by a KNOWN
 * next number-at-risk. Iterates the censor guess (distributed uniformly) until the
 * reconstructed n-at-risk at the next reported time matches the published value.
 * Mirrors the paper's `while (n.hat > n.risk || (n.hat < n.risk && n.censor > 0))` loop.
 */
function fitClosedInterval(o) {
  const { firstK, lastK, nextFirstK, nStart, nNext, tS, S, d, cen, nHat, kmRefStart, isFirstInterval } = o;
  const tStart = tS[firstK];
  const tEnd = tS[nextFirstK];

  // Guyot's first approximation of the number censored in the interval.
  const ratioStart = S[firstK] > 0 ? S[nextFirstK] / S[firstK] : 0;
  let nCensor = Math.round(nStart * ratioStart - nNext);
  if (!Number.isFinite(nCensor)) nCensor = 0;

  let nHatNext = nNext + 1; // sentinel forces at least one pass (paper seeds n.hat high)
  let km = kmRefStart;
  let iterations = 0;
  let acceptedTimes = [];

  while ((nHatNext > nNext || (nHatNext < nNext && nCensor > 0)) && iterations < MAX_INTERVAL_ITER) {
    if (nCensor < 0) nCensor = 0;
    acceptedTimes = distributeCensor(firstK, lastK, tStart, tEnd, nCensor, tS, cen);
    km = stepEvents(firstK, lastK, nStart, kmRefStart, isFirstInterval, tS, S, d, cen, nHat);
    nHatNext = nHat[nextFirstK];
    nCensor = nCensor + (nHatNext - nNext);
    iterations++;
  }

  let events = 0;
  let censored = 0;
  for (let k = firstK; k <= lastK; k++) {
    events += d[k];
    censored += cen[k];
  }
  for (const ct of acceptedTimes) o.censTimes.push(ct);
  return { kmRef: km, iterations, nHatNext, events, censored };
}

/**
 * fitOpenInterval — the terminal interval (or the whole curve in the no-at-risk
 * variant): there is no next number-at-risk to match. Events come straight from the
 * digitized curve; any subjects still at risk after the last click are censored at the
 * final time. If a total-event count is supplied, uniform censoring is added until the
 * reconstructed events no longer exceed the (remaining) target.
 */
function fitOpenInterval(o) {
  const { firstK, lastK, nStart, tS, S, d, cen, nHat, kmRefStart, isFirstInterval, totalEvents, eventsSoFar } = o;
  const tStart = tS[firstK];
  const tEnd = tS[lastK];
  let iterations = 0;

  const recompute = (nCensor) => {
    const times = distributeCensor(firstK, lastK, tStart, tEnd, nCensor, tS, cen);
    const km = stepEvents(firstK, lastK, nStart, kmRefStart, isFirstInterval, tS, S, d, cen, nHat);
    let ev = 0;
    for (let k = firstK; k <= lastK; k++) ev += d[k];
    return { km, events: ev, times };
  };

  let accepted = recompute(0);

  if (Number.isFinite(totalEvents)) {
    const target = totalEvents - eventsSoFar;
    let nCensor = 0;
    let curEvents = accepted.events;
    while (curEvents > target && iterations < MAX_INTERVAL_ITER) {
      const step = Math.max(1, Math.round(curEvents - target));
      nCensor += step;
      const r = recompute(nCensor);
      iterations++;
      accepted = r;
      if (r.events >= curEvents) break; // no further progress (curve-limited)
      curEvents = r.events;
    }
  }

  let events = 0;
  let censored = 0;
  for (let k = firstK; k <= lastK; k++) {
    events += d[k];
    censored += cen[k];
  }
  for (const ct of accepted.times) o.censTimes.push(ct);
  const finalRemainder = Math.max(0, nHat[lastK + 1]);
  return { kmRef: accepted.km, iterations, events, censored, finalRemainder };
}

/* ─────────────────────────────── public API ──────────────────────────────── */

/**
 * reconstructIPD({ curve, atRisk, totalEvents }) — reconstruct pseudo-IPD for ONE arm
 * from its digitized KM curve and numbers-at-risk (Guyot 2012).
 *
 * @param {object} args
 * @param {Array<{t:number,s:number}>} args.curve   digitized survival (t ascending,
 *        s∈[0,1] non-increasing; defensively sorted/clamped/deduped here).
 * @param {Array<{t:number,n:number}>} args.atRisk   numbers-at-risk; the first entry
 *        (t≈0 with the initial n) is required.
 * @param {number|null} [args.totalEvents]           optional total events (drives the
 *        no-at-risk variant and the terminal interval).
 * @returns {{ok:true, ipd:Array<{time:number,event:0|1}>, diagnostics:object} | {ok:false, error:string}}
 *   diagnostics = { eventsPerInterval, censoredPerInterval, finalAtRiskError, iterations }.
 */
export function reconstructIPD({ curve, atRisk, totalEvents = null } = {}) {
  const cleanCurve = cleanCurveInput(curve);
  if (cleanCurve.length < 1) return { ok: false, error: 'curve is empty or has no valid { t, s } points' };

  // Anchor the origin (t=0, S=1) so the first real click is treated as an event, not the start.
  if (cleanCurve[0].t > T_EPS) cleanCurve.unshift({ t: 0, s: 1 });

  const tS = cleanCurve.map((p) => p.t);
  const S = cleanCurve.map((p) => p.s);
  const nT = tS.length;
  if (nT < 2) return { ok: false, error: 'curve has no informative points beyond the origin' };

  const risk = cleanAtRiskInput(atRisk);
  if (risk.length < 1) return { ok: false, error: 'atRisk requires an initial (t=0, n) entry' };

  const totEv = Number.isFinite(totalEvents) ? totalEvents : null;
  const nInt = risk.length;

  // Map each at-risk time to the first click at/after it.
  const lower = risk.map((r) => {
    for (let k = 0; k < nT; k++) if (tS[k] >= r.t - T_EPS) return k;
    return nT - 1;
  });

  const d = new Array(nT).fill(0);
  const cen = new Array(nT).fill(0);
  const nHat = new Array(nT + 1).fill(0);
  const censTimes = [];

  let kmRef = 1;
  let totalIter = 0;
  let atRiskErrorSum = 0;
  const eventsPerInterval = [];
  const censoredPerInterval = [];

  for (let i = 0; i < nInt; i++) {
    const firstK = lower[i];
    const isLast = i === nInt - 1;
    const nextFirstK = isLast ? nT : lower[i + 1];
    const lastK = nextFirstK - 1;
    const nStart = risk[i].n;
    const isFirstInterval = i === 0;

    nHat[firstK] = nStart;

    if (lastK < firstK) {
      // Empty interval (at-risk times too close together for any click to fall between).
      if (!isLast) nHat[nextFirstK] = risk[i + 1].n;
      eventsPerInterval.push(0);
      censoredPerInterval.push(0);
      continue;
    }

    if (!isLast) {
      const nNext = risk[i + 1].n;
      const res = fitClosedInterval({
        firstK, lastK, nextFirstK, nStart, nNext,
        tS, S, d, cen, nHat, kmRefStart: kmRef, isFirstInterval, censTimes,
      });
      kmRef = res.kmRef;
      totalIter += res.iterations;
      atRiskErrorSum += Math.abs(res.nHatNext - nNext);
      nHat[nextFirstK] = nNext; // force the published value for the next interval
      eventsPerInterval.push(res.events);
      censoredPerInterval.push(res.censored);
    } else {
      let eventsSoFar = 0;
      for (const e of eventsPerInterval) eventsSoFar += e;
      const res = fitOpenInterval({
        firstK, lastK, nStart,
        tS, S, d, cen, nHat, kmRefStart: kmRef, isFirstInterval,
        totalEvents: totEv, eventsSoFar, censTimes,
      });
      kmRef = res.kmRef;
      totalIter += res.iterations;
      eventsPerInterval.push(res.events);
      censoredPerInterval.push(res.censored + res.finalRemainder);
      // Subjects surviving past the last click are censored at the final time.
      const lastT = tS[nT - 1];
      for (let e = 0; e < res.finalRemainder; e++) censTimes.push(lastT);
    }
  }

  // Assemble the pseudo-IPD: one event row per reconstructed event, one censored row
  // per reconstructed censoring time.
  const ipd = [];
  for (let k = 0; k < nT; k++) {
    const t = tS[k];
    for (let e = 0; e < d[k]; e++) ipd.push({ time: t, event: 1 });
  }
  for (const ct of censTimes) ipd.push({ time: ct, event: 0 });

  return {
    ok: true,
    ipd,
    diagnostics: {
      eventsPerInterval,
      censoredPerInterval,
      finalAtRiskError: atRiskErrorSum,
      iterations: totalIter,
    },
  };
}

/**
 * kmFromIPD(ipd) — product-limit (Kaplan–Meier) step points from pseudo-IPD, one
 * point per distinct EVENT time. Used to round-trip-validate a reconstruction against
 * the curve it came from. Censoring-only times affect the risk set but produce no step.
 * @param {Array<{time:number,event:number}>} ipd
 * @returns {Array<{t:number,s:number,nRisk:number}>}
 */
export function kmFromIPD(ipd) {
  const rows = (Array.isArray(ipd) ? ipd : [])
    .filter((r) => r && Number.isFinite(Number(r.time)))
    .map((r) => ({ time: Number(r.time), event: r.event ? 1 : 0 }));
  if (!rows.length) return [];

  const eventTimes = Array.from(new Set(rows.filter((r) => r.event === 1).map((r) => r.time))).sort(
    (a, b) => a - b,
  );

  const out = [];
  let s = 1;
  for (const t of eventTimes) {
    let nRisk = 0;
    let dj = 0;
    for (const r of rows) {
      if (r.time >= t - T_EPS) nRisk++;
      if (r.event === 1 && Math.abs(r.time - t) < T_EPS) dj++;
    }
    if (nRisk > 0) s = s * (1 - dj / nRisk);
    out.push({ t, s, nRisk });
  }
  return out;
}

/**
 * buildRiskTable — shared risk-set table over pooled distinct event times for two arms
 * (arm A → x=0, arm B → x=1). Returns per-event-time counts used by both logRank and
 * coxHR. Non-finite times are dropped. O(#eventTimes × #subjects).
 */
function buildRiskTable(ipdA, ipdB) {
  const subj = [];
  const add = (arr, x) => {
    for (const r of Array.isArray(arr) ? arr : []) {
      if (!r) continue;
      const t = Number(r.time);
      if (!Number.isFinite(t)) continue;
      subj.push({ t, e: r.event ? 1 : 0, x });
    }
  };
  add(ipdA, 0);
  add(ipdB, 1);

  const eventTimes = Array.from(new Set(subj.filter((s) => s.e === 1).map((s) => s.t))).sort(
    (a, b) => a - b,
  );

  let eventsA = 0;
  let eventsB = 0;
  for (const s of subj) {
    if (s.e === 1) {
      if (s.x === 0) eventsA++;
      else eventsB++;
    }
  }

  const table = eventTimes.map((t) => {
    let nA = 0;
    let nB = 0;
    let dA = 0;
    let dB = 0;
    for (const s of subj) {
      if (s.t >= t - T_EPS) {
        if (s.x === 0) nA++;
        else nB++;
      }
      if (s.e === 1 && Math.abs(s.t - t) < T_EPS) {
        if (s.x === 0) dA++;
        else dB++;
      }
    }
    return { t, nA, nB, dA, dB, d: dA + dB };
  });

  return { table, eventsA, eventsB, nSubj: subj.length };
}

/**
 * logRank(ipdA, ipdB) — unstratified log-rank test + Peto one-step hazard ratio over
 * the pooled distinct event times (Tierney 2007). "Group 1" is arm B, so
 * hr = exp((O1−E1)/V) is the hazard of B relative to A, matching coxHR's convention.
 *
 * @returns {{O1:number,E1:number,V:number,chi2:number,p:number,hr:number,lo:number,hi:number}}
 *   O1/E1 = observed/expected events in arm B; V = hypergeometric variance;
 *   SE(lnHR) = 1/sqrt(V); CI via z = 1.959963984540054.
 */
export function logRank(ipdA, ipdB) {
  const { table } = buildRiskTable(ipdA, ipdB);
  let O1 = 0;
  let E1 = 0;
  let V = 0;
  for (const r of table) {
    const n = r.nA + r.nB;
    if (n <= 0) continue;
    O1 += r.dB;
    E1 += (r.d * r.nB) / n;
    if (n > 1) V += (r.d * (r.nB / n) * (r.nA / n) * (n - r.d)) / (n - 1);
  }
  const chi2 = V > 0 ? ((O1 - E1) * (O1 - E1)) / V : 0;
  const p = 1 - chiSquareCDF(chi2, 1);
  let hr = NaN;
  let se = NaN;
  let lo = NaN;
  let hi = NaN;
  if (V > 0) {
    const logHr = (O1 - E1) / V;
    se = 1 / Math.sqrt(V);
    hr = Math.exp(logHr);
    lo = Math.exp(logHr - Z * se);
    hi = Math.exp(logHr + Z * se);
  }
  return { O1, E1, V, chi2, p, hr, lo, hi };
}

/**
 * coxHR(ipdA, ipdB, opts) — hazard ratio (B vs A) from a single-covariate Cox
 * proportional-hazards model fit by Newton–Raphson on the BRESLOW partial likelihood.
 * The covariate x is 1 for arm B and 0 for arm A. Breslow handles tied event times by
 * using the full risk set for every tie (documented choice; simpler than Efron and
 * adequate for pseudo-IPD).
 *
 * For a binary covariate x²=x, so at each event time with d events and risk-set counts
 * (nA arm-A, nB arm-B):  S0 = nA + nB·e^β,  S1 = S2 = nB·e^β,  r = S1/S0, and
 *   score      U(β) = Σ [ dB − d·r ]
 *   information I(β) = Σ [ d·r·(1−r) ]
 * Newton step β ← β + U/I, β clamped to [−30, 30]; never divides by a zero risk set.
 * Monotone likelihood (all events in one arm) → { ok:false }.
 *
 * @returns {{ok:true,hr:number,lo:number,hi:number,se:number,beta:number,converged:boolean,iters:number}
 *          | {ok:false,reason:string,beta?:number,iters?:number}}
 */
export function coxHR(ipdA, ipdB, { maxIter = 60, tol = 1e-9 } = {}) {
  const { table, eventsA, eventsB } = buildRiskTable(ipdA, ipdB);

  if (!table.length) return { ok: false, reason: 'no events in either arm' };
  if (eventsA === 0 || eventsB === 0) {
    return { ok: false, reason: 'monotone likelihood: all events in one arm' };
  }

  const scoreInfo = (beta) => {
    const eb = Math.exp(beta);
    let U = 0;
    let I = 0;
    for (const r of table) {
      const s0 = r.nA + r.nB * eb;
      if (s0 <= 0) continue; // never divide by a zero risk set
      const ratio = (r.nB * eb) / s0;
      U += r.dB - r.d * ratio;
      I += r.d * ratio * (1 - ratio);
    }
    return { U, I };
  };

  let beta = 0;
  let converged = false;
  let iters = 0;
  for (; iters < maxIter; iters++) {
    const { U, I } = scoreInfo(beta);
    if (!(I > 0)) break; // flat/degenerate information — stop
    const stepRaw = U / I;
    let next = beta + stepRaw;
    if (next > 30) next = 30;
    if (next < -30) next = -30;
    const step = next - beta;
    beta = next;
    if (Math.abs(step) < tol || Math.abs(U) < tol) {
      converged = true;
      iters++;
      break;
    }
  }

  const { I: infoFinal } = scoreInfo(beta);
  const se = infoFinal > 0 ? 1 / Math.sqrt(infoFinal) : NaN;
  const hr = Math.exp(beta);
  const lo = Number.isFinite(se) ? Math.exp(beta - Z * se) : NaN;
  const hi = Number.isFinite(se) ? Math.exp(beta + Z * se) : NaN;

  return { ok: true, hr, lo, hi, se, beta, converged, iters };
}
