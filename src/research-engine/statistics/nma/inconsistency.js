/**
 * inconsistency.js — direct vs indirect evidence and inconsistency assessment.
 *
 *  - poolDirect:       pairwise pooling of the direct studies for one comparison.
 *  - directVsIndirect: node-splitting via network exclusion (Dias 2010 idea) —
 *                      the indirect estimate is the network estimate refit with the
 *                      studies that directly compare the pair removed; the split
 *                      test compares direct vs indirect.
 *  - globalInconsistency: design-by-treatment Q decomposition (Krahn 2013 /
 *                      netmeta `decomp.design`): Q_total = Q_within-design
 *                      (heterogeneity) + Q_between-design (inconsistency).
 *
 * Limitation (documented): node-split exclusion removes ENTIRE studies that compare
 * the pair. For 2-arm studies this is exact; for multi-arm studies it is conservative
 * (it also drops that study's other contrasts). A full edge-level split that keeps the
 * other contrasts of a multi-arm study is deferred. Node-splits are only computed when
 * the pair has BOTH direct evidence AND an estimable indirect path (else reported as
 * not-estimable, never fabricated).
 */
import { Z975, normalCDF, chiSquareCDF } from '../math-helpers.js';
import { fitConsistency, pairEffect } from './frequentist.js';
import { isConnected, networkGeometry } from './geometry.js';

/** Build a sub-network object from a subset of already-derived studies. */
function subNetwork(derivedStudies, sm, isLog) {
  const tset = new Set();
  derivedStudies.forEach((s) => s.treatments.forEach((t) => tset.add(t)));
  return { ok: derivedStudies.length > 0, studies: derivedStudies, treatments: Array.from(tset).sort(), sm, isLog };
}

/** Inverse-variance (common) / DerSimonian–Laird (random) pooling of {y,se} contrasts. */
export function poolDirect(contrasts, model = 'random') {
  const valid = contrasts.filter((c) => Number.isFinite(c.y) && c.se > 0);
  const k = valid.length;
  if (k === 0) return null;
  const w = valid.map((c) => 1 / (c.se * c.se));
  const W = w.reduce((a, b) => a + b, 0);
  const muF = valid.reduce((a, c, i) => a + w[i] * c.y, 0) / W;
  if (k === 1 || model === 'common') {
    const se = Math.sqrt(1 / W);
    return { est: muF, se, lo: muF - Z975 * se, hi: muF + Z975 * se, k, tau2: 0 };
  }
  const Q = valid.reduce((a, c, i) => a + w[i] * (c.y - muF) ** 2, 0);
  const W2 = w.reduce((a, x) => a + x * x, 0);
  const C = W - W2 / W;
  const tau2 = C > 0 ? Math.max(0, (Q - (k - 1)) / C) : 0;
  const wr = valid.map((c) => 1 / (c.se * c.se + tau2));
  const Wr = wr.reduce((a, b) => a + b, 0);
  const mu = valid.reduce((a, c, i) => a + wr[i] * c.y, 0) / Wr;
  const se = Math.sqrt(1 / Wr);
  return { est: mu, se, lo: mu - Z975 * se, hi: mu + Z975 * se, k, tau2 };
}

/** All observed direct comparisons (unordered treatment pairs with ≥1 direct study). */
export function directComparisons(network) {
  const map = {};
  network.pairwise.forEach((c) => {
    const [t1, t2] = [c.t1, c.t2].sort();
    const key = `${t1}|${t2}`;
    (map[key] = map[key] || { t1, t2, contrasts: [] }).contrasts.push({ y: c.t2 === t2 ? c.y : -c.y, se: c.se, studyId: c.studyId });
  });
  return Object.values(map);
}

/**
 * directVsIndirect(network, opts) → per-comparison split [{ t1,t2, direct, indirect,
 * network, diff, z, pval, estimable, nDirect }].  `opts.model` 'common'|'random'.
 */
export function directVsIndirect(network, opts = {}) {
  const model = opts.model === 'common' ? 'common' : 'random';
  const fullFit = fitConsistency(network, { model });
  const geom = networkGeometry(network);
  const out = [];
  for (const dc of directComparisons(network)) {
    const { t1, t2 } = dc;
    const direct = poolDirect(dc.contrasts, model);
    // Indirect: refit network with studies that directly compare (t1,t2) removed.
    const kept = network.studies.filter((s) => !(s.treatments.includes(t1) && s.treatments.includes(t2)));
    const sub = subNetwork(kept, network.sm, network.isLog);
    const subEdges = networkGeometry(sub).edges;
    const indirectEstimable = sub.treatments.includes(t1) && sub.treatments.includes(t2) && isConnected(t1, t2, sub.treatments, subEdges);
    let indirect = null;
    if (indirectEstimable) {
      const subFit = fitConsistency(sub, { model });
      if (subFit.ok) indirect = pairEffect(subFit, t1, t2);
    }
    const netEst = fullFit.ok ? pairEffect(fullFit, t1, t2) : null;
    let diff = null, z = null, pval = null;
    if (direct && indirect && direct.se > 0) {
      const d = direct.est - indirect.est;
      const se = Math.sqrt(direct.se ** 2 + indirect.se ** 2);
      diff = { est: d, se, lo: d - Z975 * se, hi: d + Z975 * se };
      z = se > 0 ? d / se : 0;
      pval = 2 * (1 - normalCDF(Math.abs(z)));
    }
    out.push({
      t1, t2,
      direct: direct ? { ...direct } : null,
      indirect: indirect ? { est: indirect.est, se: indirect.se, lo: indirect.lo, hi: indirect.hi } : null,
      network: netEst ? { est: netEst.est, se: netEst.se, lo: netEst.lo, hi: netEst.hi } : null,
      diff, z, pval,
      estimable: !!(direct && indirect),
      nDirect: direct ? direct.k : 0,
    });
  }
  return out;
}

/** Group studies into designs by their sorted treatment-set key. */
function designKey(study) { return study.treatments.slice().sort().join('|'); }

/**
 * globalInconsistency(network) → design-by-treatment Q decomposition.
 * Q_total (common-effect consistency Q) = Q_within (Σ design heterogeneity) +
 * Q_between (inconsistency). Returns { Qtotal, dfTotal, Qhet, dfHet, Qinc, dfInc,
 * pInc, designs }. The decomposition is defined at the common-effect fit (τ²=0).
 */
export function globalInconsistency(network) {
  const full = fitConsistency(network, { model: 'common' });
  if (!full.ok) return { ok: false, error: full.error };
  const Qtotal = full.Q, dfTotal = full.df;

  // Group by design; each design fits its own saturated mean (within-design Q).
  const byDesign = {};
  network.studies.forEach((s) => { const k = designKey(s); (byDesign[k] = byDesign[k] || []).push(s); });

  let Qhet = 0, dfHet = 0;
  const designs = [];
  for (const [key, studies] of Object.entries(byDesign)) {
    const sub = subNetwork(studies, network.sm, network.isLog);
    const fit = fitConsistency(sub, { model: 'common' });
    const N = studies.reduce((a, s) => a + s.contrasts.length, 0);
    const tD = sub.treatments.length;
    const dfD = N - (tD - 1);
    const Qd = fit.ok ? fit.Q : 0;
    Qhet += Qd; dfHet += Math.max(0, dfD);
    designs.push({ design: key, treatments: sub.treatments, nStudies: studies.length, Q: Qd, df: Math.max(0, dfD) });
  }

  const Qinc = Math.max(0, Qtotal - Qhet);
  const dfInc = Math.max(0, dfTotal - dfHet);
  const pInc = dfInc > 0 ? Math.max(0, 1 - chiSquareCDF(Qinc, dfInc)) : null;

  return {
    ok: true,
    Qtotal, dfTotal,
    Qhet, dfHet,
    Qinc, dfInc, pInc,
    designs,
    // Honest interpretation guard for sparse networks.
    note: dfInc === 0
      ? 'No inconsistency degrees of freedom — the network has no independent closed loops, so global inconsistency is not estimable.'
      : 'A non-significant test does NOT prove consistency; power is often low in sparse networks.',
  };
}
