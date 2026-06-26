/**
 * contribution.js — contribution matrix (transparency layer, P2.6).
 *
 * How much each DIRECT comparison contributes to each network estimate. Implemented
 * via the aggregate hat matrix H = B (Bᵀ W⁻¹ B)⁻¹ Bᵀ W⁻¹, where the network is first
 * aggregated to one common-effect contrast per direct comparison (edge). Row r of the
 * normalized |H| gives the proportion of the network estimate of comparison r
 * attributable to each direct comparison — so a row dominated by a single edge, or one
 * relying heavily on OTHER edges (indirect), is visible.
 *
 * Method note (documented): this is the aggregate "H-matrix" contribution. Multi-arm
 * within-study correlation is approximated away by the per-edge aggregation (the same
 * simplification netmeta's aggregate hat matrix makes); the more elaborate
 * flow/streams decomposition is deferred. Each contribution row sums to 1.
 */
import { choleskyInverse, matMul, transpose } from './linalg.js';
import { poolDirect, directComparisons } from './inconsistency.js';

export function contributionMatrix(network, opts = {}) {
  const T = network.treatments;
  const ref = opts.reference && T.includes(opts.reference) ? opts.reference : T[0];
  const nonRef = T.filter((x) => x !== ref);
  const idx = {}; nonRef.forEach((x, i) => { idx[x] = i; });
  const p = nonRef.length;

  const edges = directComparisons(network).map((dc) => {
    const pooled = poolDirect(dc.contrasts, 'common');
    return { t1: dc.t1, t2: dc.t2, y: pooled.est, v: pooled.se * pooled.se, k: pooled.k };
  });
  const E = edges.length;
  if (E === 0 || p === 0) return { ok: false, error: 'No direct comparisons to decompose' };

  const B = edges.map((e) => {
    const row = new Array(p).fill(0);
    if (e.t2 in idx) row[idx[e.t2]] += 1;
    if (e.t1 in idx) row[idx[e.t1]] -= 1;
    return row;
  });
  const Winv = edges.map((e) => (e.v > 0 ? 1 / e.v : 0));

  // M = Bᵀ W⁻¹ B
  const M = []; for (let i = 0; i < p; i++) M.push(new Array(p).fill(0));
  for (let r = 0; r < E; r++) for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) M[i][j] += B[r][i] * Winv[r] * B[r][j];
  let Minv;
  try { Minv = choleskyInverse(M); } catch { return { ok: false, error: 'Network design is singular — contribution not estimable' }; }

  // H = B Minv Bᵀ W⁻¹  (E×E):  H[r][c] = (B Minv Bᵀ)[r][c] · W⁻¹[c]
  const BMBt = matMul(matMul(B, Minv), transpose(B));
  const H = BMBt.map((row) => row.map((v, c) => v * Winv[c]));

  const labels = edges.map((e) => `${e.t2} vs ${e.t1}`);
  const matrix = H.map((row) => {
    const abs = row.map((x) => Math.abs(x));
    const s = abs.reduce((a, b) => a + b, 0) || 1;
    return abs.map((a) => a / s);
  });
  // Direct-evidence proportion = the diagonal contribution (own direct edge).
  const directProportion = matrix.map((row, r) => row[r]);

  return {
    ok: true,
    labels,
    edges: edges.map((e, i) => ({ t1: e.t1, t2: e.t2, k: e.k, directProportion: directProportion[i] })),
    matrix,
  };
}
