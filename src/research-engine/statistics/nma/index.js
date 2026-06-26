/**
 * index.js — Network Meta-Analysis engine orchestrator (P2).
 *
 * Pure, isomorphic (runs identically on the server and in the browser). Given a
 * network dataset it validates readiness, then runs the full frequentist analysis:
 * consistency model (common + random effects), league table, P-score ranking,
 * network geometry, direct-vs-indirect node-splitting, global inconsistency, and the
 * contribution matrix — plus a provenance fingerprint and CINeMA-style transparency
 * warnings. NO statistical fallback is silent: anything not estimable is reported.
 *
 * Bayesian NMA is a separate, durable-job pathway (see docs/manager/nma-p2.md) — it
 * is NOT emulated here from frequentist estimates.
 */
import { deriveNetwork, isLogScale } from './contrasts.js';
import { fitConsistency, leagueTable, pScores, pairEffect } from './frequentist.js';
import { networkGeometry } from './geometry.js';
import { directVsIndirect, globalInconsistency } from './inconsistency.js';
import { contributionMatrix } from './contribution.js';

export const NMA_ENGINE_VERSION = '1.0.0';
export const SUPPORTED_MEASURES = ['OR', 'RR', 'RD', 'MD', 'GENERIC'];

/** Tiny deterministic string hash (FNV-1a, 32-bit) — no crypto dependency. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Canonicalize the input dataset to a stable string for hashing (order-independent). */
function dataFingerprint(input) {
  const studies = (input.studies || []).map((s) => ({
    id: s.id,
    arms: (s.arms || []).slice().sort((a, b) => String(a.treatment).localeCompare(String(b.treatment)))
      .map((a) => ({ t: a.treatment, e: a.events, n: a.n, m: a.mean, sd: a.sd })),
    contrasts: (s.contrasts || []).map((c) => ({ t1: c.t1, t2: c.t2, te: c.te, se: c.seTE })),
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return fnv1a(JSON.stringify({ sm: input.sm, studies }));
}

/**
 * validateNetwork(input) → readiness report (never throws).
 * input: { sm, smallerBetter, studies:[...], reference? }
 */
export function validateNetwork(input) {
  const sm = input.sm;
  const errors = [];
  const warnings = [];
  if (!SUPPORTED_MEASURES.includes(sm)) {
    return { ok: false, errors: [{ level: 'fatal', msg: `Unsupported effect measure "${sm}"` }], warnings: [], treatments: [], geometry: null };
  }
  const net = deriveNetwork(input.studies, sm, { cc: input.cc });
  net.errors.forEach((e) => errors.push({ level: 'study', id: e.id, label: e.label, msg: e.error }));

  const geom = net.ok ? networkGeometry(net) : null;
  const tCount = net.treatments.length;
  if (tCount < 2) errors.push({ level: 'fatal', msg: 'A network needs at least two treatments with analysable data.' });
  else if (tCount === 2) warnings.push({ level: 'info', msg: 'Only two treatments — this is a pairwise comparison, not a network. Results equal the pairwise meta-analysis.' });
  else if (tCount < 3) warnings.push({ level: 'warn', msg: 'A true NMA needs at least three treatments.' });

  if (geom && !geom.connected) {
    warnings.push({ level: 'warn', msg: `The evidence network has ${geom.nComponents} disconnected components. Treatments in different components cannot be compared; only the largest connected component is analysed.` });
  }
  if (net.ccCount > 0) warnings.push({ level: 'info', msg: `${net.ccCount} study(ies) had a zero (or full) cell — a 0.5 continuity correction was applied inside the analysis (raw counts unchanged).` });
  if (net.multiArmCount > 0) warnings.push({ level: 'info', msg: `${net.multiArmCount} multi-arm study(ies) — handled with their correct within-study covariance.` });

  const analysable = net.ok && tCount >= 2 && (!geom || geom.components.some((c) => c.length >= 2));
  return { ok: analysable && errors.filter((e) => e.level === 'fatal').length === 0, errors, warnings, treatments: net.treatments, geometry: geom, sm, isLog: isLogScale(sm), ccCount: net.ccCount, multiArmCount: net.multiArmCount, studyCount: net.studies.length };
}

/** Restrict a derived network to its largest connected component (≥2 treatments). */
function largestComponentNetwork(net, geom) {
  const comp = geom.components.slice().sort((a, b) => b.length - a.length)[0] || [];
  const set = new Set(comp);
  const studies = net.studies.filter((s) => s.treatments.every((t) => set.has(t)));
  const tset = new Set(); studies.forEach((s) => s.treatments.forEach((t) => tset.add(t)));
  return { ok: studies.length > 0, studies, treatments: Array.from(tset).sort(), sm: net.sm, isLog: net.isLog, pairwise: net.pairwise.filter((c) => set.has(c.t1) && set.has(c.t2)), excluded: net.treatments.filter((t) => !set.has(t)) };
}

/**
 * runNetworkMetaAnalysis(input, opts) → full structured result, or { ok:false, error }.
 * opts: { model:'common'|'random' (default 'random'), reference }
 */
export function runNetworkMetaAnalysis(input, opts = {}) {
  const model = opts.model === 'common' ? 'common' : 'random';
  const sm = input.sm;
  const smallerBetter = !!input.smallerBetter;
  const readiness = validateNetwork(input);
  if (!readiness.ok) return { ok: false, error: 'Network is not analysable', readiness };

  let net = deriveNetwork(input.studies, sm, { cc: input.cc });
  const fullGeom = networkGeometry(net);
  let excluded = [];
  if (!fullGeom.connected) { const lc = largestComponentNetwork(net, fullGeom); excluded = lc.excluded; net = lc; }

  const reference = opts.reference && net.treatments.includes(opts.reference) ? opts.reference : net.treatments[0];
  const common = fitConsistency(net, { model: 'common', reference });
  const random = fitConsistency(net, { model: 'random', reference });
  const primary = model === 'common' ? common : random;
  if (!primary.ok) return { ok: false, error: primary.error, readiness };

  const league = leagueTable(primary);
  const ranking = pScores(primary, { smallerBetter });
  const geometry = networkGeometry(net);
  const splits = directVsIndirect(net, { model });
  const global = globalInconsistency(net);
  const contribution = contributionMatrix(net, { reference });

  // Treatment-vs-reference forest rows (the per-node forest), in the primary model.
  const forest = net.treatments.filter((t) => t !== reference).map((t) => pairEffect(primary, reference, t));

  // ── CINeMA-style transparency / certainty signals (P2.11 foundation only) ──
  const warnings = signalWarnings({ readiness, primary, splits, global, contribution, ranking, geometry });

  return {
    ok: true,
    engineVersion: NMA_ENGINE_VERSION,
    sm, isLog: net.isLog, smallerBetter, model, reference,
    treatments: net.treatments,
    excludedTreatments: excluded,
    counts: { studies: net.studies.length, treatments: net.treatments.length, directComparisons: geometry.edges.length, participants: geometry.nodes.reduce((a, n) => a + n.participants, 0), multiArm: readiness.multiArmCount, ccApplied: readiness.ccCount },
    heterogeneity: { tau2: random.tau2, tau: random.tau, Q: common.Q, df: common.df, Qpval: common.Qpval, I2: common.I2 },
    effects: { common: serializeFit(common), random: serializeFit(random) },
    league, ranking, geometry, forest,
    inconsistency: { local: splits, global },
    contribution,
    warnings,
    provenance: {
      engineVersion: NMA_ENGINE_VERSION, sm, model, reference,
      heterogeneityEstimator: 'DL', smallerBetter,
      dataHash: dataFingerprint(input),
      configHash: fnv1a(JSON.stringify({ sm, model, reference, smallerBetter })),
    },
    readiness,
  };
}

function serializeFit(fit) {
  if (!fit.ok) return null;
  return { reference: fit.reference, d: fit.d, tau2: fit.tau2, Q: fit.Q, df: fit.df, I2: fit.I2 };
}

/** Plain-language transparency warnings — never clinical recommendations. */
function signalWarnings({ readiness, primary, splits, global, contribution, ranking, geometry }) {
  const w = [];
  readiness.warnings.forEach((x) => w.push({ kind: x.level === 'warn' ? 'heterogeneity' : 'info', msg: x.msg }));
  // Incoherence (local + global).
  const incoherent = splits.filter((s) => s.estimable && s.pval != null && s.pval < 0.05);
  incoherent.forEach((s) => w.push({ kind: 'incoherence', msg: `Direct vs indirect evidence disagree for ${s.t2} vs ${s.t1} (p=${s.pval.toFixed(3)}).` }));
  if (global.ok && global.pInc != null && global.pInc < 0.05) w.push({ kind: 'incoherence', msg: `Global inconsistency test is significant (p=${global.pInc.toFixed(3)}).` });
  // Heterogeneity.
  if (primary.I2 >= 50) w.push({ kind: 'heterogeneity', msg: `Substantial network heterogeneity (I²=${primary.I2.toFixed(0)}%).` });
  // Thin/indirect-dominated estimates.
  if (contribution.ok) {
    contribution.edges.forEach((e, i) => {
      if (e.directProportion != null && e.directProportion < 0.25) {
        w.push({ kind: 'indirectness', msg: `The ${contribution.labels[i]} estimate is predominantly indirect (only ${(e.directProportion * 100).toFixed(0)}% direct evidence).` });
      }
    });
  }
  // Ranking instability cue: top treatment driven by few studies.
  const top = ranking[0];
  if (top) {
    const node = geometry.nodes.find((n) => n.id === top.treatment);
    if (node && node.studies <= 1) w.push({ kind: 'imprecision', msg: `The top-ranked treatment (${top.treatment}) is informed by only ${node.studies} study — its ranking is fragile.` });
  }
  return w;
}
