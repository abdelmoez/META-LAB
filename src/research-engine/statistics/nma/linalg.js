/**
 * linalg.js — small, self-contained dense linear algebra for the Network
 * Meta-Analysis engine (P2). No external dependencies (matches the PecanRev
 * "self-contained, reproducible numerics" philosophy of the pairwise engine).
 *
 * Matrices are plain row-major arrays of arrays (number[][]); vectors are number[].
 * Everything is deterministic. The routines used by the frequentist NMA core are:
 *   - choleskyInverse / solveSPD  — for the symmetric positive-definite systems
 *     (study contrast-covariance blocks V_s, and M = Xᵀ V⁻¹ X).
 *   - symmetricPseudoInverse (Jacobi eigen) — Moore–Penrose inverse of a symmetric
 *     PSD matrix, used as a robust fallback and for the Laplacian-style contribution
 *     route.
 *   - matMul / matVec / transpose — assembling the GLS estimator.
 *
 * All inverses throw on a non-finite / non-PD result so the caller can surface a
 * structured "singular / non-estimable" error rather than silently returning NaNs.
 */

export function zeros(r, c) {
  const m = new Array(r);
  for (let i = 0; i < r; i++) m[i] = new Array(c).fill(0);
  return m;
}

export function identity(n) {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}

export function clone(a) { return a.map((row) => row.slice()); }

export function transpose(a) {
  const r = a.length, c = a[0].length;
  const t = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) t[j][i] = a[i][j];
  return t;
}

export function matMul(a, b) {
  const r = a.length, k = b.length, c = b[0].length;
  if (a[0].length !== k) throw new Error('matMul: dimension mismatch');
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) {
    const ai = a[i], oi = out[i];
    for (let p = 0; p < k; p++) {
      const aip = ai[p];
      if (aip === 0) continue;
      const bp = b[p];
      for (let j = 0; j < c; j++) oi[j] += aip * bp[j];
    }
  }
  return out;
}

export function matVec(a, v) {
  const r = a.length, c = a[0].length;
  if (v.length !== c) throw new Error('matVec: dimension mismatch');
  const out = new Array(r).fill(0);
  for (let i = 0; i < r; i++) {
    let s = 0; const ai = a[i];
    for (let j = 0; j < c; j++) s += ai[j] * v[j];
    out[i] = s;
  }
  return out;
}

export function vecSub(a, b) { return a.map((x, i) => x - b[i]); }
export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/**
 * choleskyDecompose(A) → lower-triangular L with L Lᵀ = A, for symmetric
 * positive-definite A. Throws if A is not (numerically) PD.
 */
export function choleskyDecompose(A) {
  const n = A.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 0) || !isFinite(sum)) throw new Error('choleskyDecompose: matrix is not positive-definite');
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Solve L Lᵀ x = b for one vector b, given the Cholesky factor L. */
export function choleskySolveVec(L, b) {
  const n = L.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}

/** Inverse of a symmetric positive-definite matrix via Cholesky. Throws if not PD. */
export function choleskyInverse(A) {
  const n = A.length;
  const L = choleskyDecompose(A);
  const inv = zeros(n, n);
  for (let col = 0; col < n; col++) {
    const e = new Array(n).fill(0); e[col] = 1;
    const x = choleskySolveVec(L, e);
    for (let row = 0; row < n; row++) inv[row][col] = x[row];
  }
  // Symmetrize to kill round-off asymmetry.
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = (inv[i][j] + inv[j][i]) / 2; inv[i][j] = a; inv[j][i] = a;
  }
  return inv;
}

/** Solve the SPD system A x = b (multiple right-hand sides allowed as columns). */
export function solveSPD(A, B) {
  const L = choleskyDecompose(A);
  const cols = B[0].length;
  const n = A.length;
  const X = zeros(n, cols);
  for (let c = 0; c < cols; c++) {
    const b = new Array(n); for (let i = 0; i < n; i++) b[i] = B[i][c];
    const x = choleskySolveVec(L, b);
    for (let i = 0; i < n; i++) X[i][c] = x[i];
  }
  return X;
}

/**
 * symmetricEigen(A) → { values: number[], vectors: number[][] } for a symmetric
 * matrix A, via the cyclic Jacobi rotation algorithm. `vectors` columns are the
 * orthonormal eigenvectors. Deterministic and robust for the small symmetric
 * matrices the NMA engine forms.
 */
export function symmetricEigen(A0, maxSweeps = 100, tol = 1e-14) {
  const n = A0.length;
  const A = clone(A0);
  const V = identity(n);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Sum of off-diagonal magnitudes.
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += Math.abs(A[p][q]);
    if (off < tol) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < tol) continue;
        const app = A[p][p], aqq = A[q][q], apq = A[p][q];
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi), s = Math.sin(phi);
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = new Array(n); for (let i = 0; i < n; i++) values[i] = A[i][i];
  return { values, vectors: V };
}

/**
 * symmetricPseudoInverse(A, rtol) → Moore–Penrose inverse of a symmetric matrix
 * via eigendecomposition, dropping eigenvalues below rtol·max|λ| (treated as the
 * null space). Used for Laplacian-style network operators and as a robust fallback.
 */
export function symmetricPseudoInverse(A, rtol = 1e-9) {
  const n = A.length;
  const { values, vectors } = symmetricEigen(A);
  const maxAbs = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const cut = maxAbs * rtol;
  const inv = zeros(n, n);
  for (let k = 0; k < n; k++) {
    const lam = values[k];
    if (Math.abs(lam) <= cut) continue;
    const invLam = 1 / lam;
    for (let i = 0; i < n; i++) {
      const vik = vectors[i][k];
      if (vik === 0) continue;
      for (let j = 0; j < n; j++) inv[i][j] += invLam * vik * vectors[j][k];
    }
  }
  return inv;
}

/** Build a block-diagonal matrix from a list of square blocks. */
export function blockDiagonal(blocks) {
  let n = 0; for (const b of blocks) n += b.length;
  const out = zeros(n, n);
  let o = 0;
  for (const b of blocks) {
    const m = b.length;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) out[o + i][o + j] = b[i][j];
    o += m;
  }
  return out;
}
