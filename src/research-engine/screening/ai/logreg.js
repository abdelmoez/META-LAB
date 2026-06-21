/**
 * logreg.js — class-weighted L2-regularized logistic regression over sparse
 * TF-IDF vectors, trained with deterministic full-batch gradient descent.
 *
 * Pure functions, no DB, no network. Full-batch GD (not stochastic) so the
 * result is independent of sample ordering and 100% reproducible — essential
 * for defensible validation metrics. Class weighting is cost-sensitive, which
 * is what lets a handful of "include" labels stand up against a large majority
 * of "exclude" labels (the defining hard case of systematic-review screening).
 *
 * This is the same model family Rayyan's published engine used (linear model
 * over text n-grams); logistic regression additionally yields calibrated-ish
 * probabilities, which we need for uncertainty sampling and thresholding.
 */

export function sigmoid(z) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * trainLogReg — fit a logistic-regression model.
 *
 * @param {Array<{x:Record<number,number>, y:0|1}>} samples
 * @param {number} dim — vocabulary size (length of the weight vector)
 * @param {object} [cfg] — config.classifier
 * @returns {{ weights:Float64Array, bias:number, dim:number, epochs:number,
 *            converged:boolean, classWeights:{pos:number,neg:number},
 *            nPos:number, nNeg:number }}
 */
export function trainLogReg(samples, dim, cfg = {}) {
  const l2 = cfg.l2 ?? 1e-4;
  const lr = cfg.learningRate ?? 0.5;
  const maxEpochs = cfg.epochs ?? 200;
  const tol = cfg.tolerance ?? 1e-5;
  const classWeightMode = cfg.classWeight ?? 'balanced';

  const weights = new Float64Array(dim);
  let bias = 0;

  const n = samples.length;
  let nPos = 0;
  for (const s of samples) if (s.y === 1) nPos++;
  const nNeg = n - nPos;

  // Cost-sensitive class weights (sklearn 'balanced' formula): n/(2*n_class).
  let wPos = 1, wNeg = 1;
  if (classWeightMode === 'balanced' && nPos > 0 && nNeg > 0) {
    wPos = n / (2 * nPos);
    wNeg = n / (2 * nNeg);
  }

  let converged = false;
  let epoch = 0;
  for (; epoch < maxEpochs; epoch++) {
    const grad = new Float64Array(dim);
    let gBias = 0;

    for (const s of samples) {
      // z = bias + w·x
      let z = bias;
      for (const k in s.x) z += weights[k] * s.x[k];
      const p = sigmoid(z);
      const cw = s.y === 1 ? wPos : wNeg;
      const err = cw * (p - s.y);
      for (const k in s.x) grad[k] += err * s.x[k];
      gBias += err;
    }

    // L2 on weights only (not bias), averaged over samples.
    let maxStep = 0;
    const inv = n > 0 ? 1 / n : 1;
    for (let j = 0; j < dim; j++) {
      const g = grad[j] * inv + l2 * weights[j];
      const step = lr * g;
      weights[j] -= step;
      const a = step < 0 ? -step : step;
      if (a > maxStep) maxStep = a;
    }
    const bStep = lr * gBias * inv;
    bias -= bStep;
    const aB = bStep < 0 ? -bStep : bStep;
    if (aB > maxStep) maxStep = aB;

    if (maxStep < tol) { converged = true; epoch++; break; }
  }

  return {
    weights, bias, dim, epochs: epoch, converged,
    classWeights: { pos: wPos, neg: wNeg }, nPos, nNeg,
  };
}

/**
 * predictProba — probability of the positive ("include") class for a sparse x.
 * @param {ReturnType<typeof trainLogReg>} model
 * @param {Record<number,number>} x
 * @returns {number} in [0,1]
 */
export function predictProba(model, x) {
  let z = model.bias;
  const w = model.weights;
  for (const k in x) z += w[k] * x[k];
  return sigmoid(z);
}

/**
 * topWeightedFeatures — the most positive and most negative model weights,
 * mapped back to their human-readable terms. Used by the explanation layer.
 *
 * @param {ReturnType<typeof trainLogReg>} model
 * @param {string[]} terms — vectorizer.terms (index → term)
 * @param {number} [k]
 * @returns {{positive:Array<{term:string,weight:number}>, negative:Array<{term:string,weight:number}>}}
 */
export function topWeightedFeatures(model, terms, k = 15) {
  const idx = [];
  for (let i = 0; i < model.dim; i++) {
    const w = model.weights[i];
    if (w !== 0) idx.push(i);
  }
  idx.sort((a, b) => model.weights[b] - model.weights[a]);
  const positive = [];
  for (let i = 0; i < idx.length && positive.length < k; i++) {
    if (model.weights[idx[i]] <= 0) break;
    positive.push({ term: terms[idx[i]], weight: model.weights[idx[i]] });
  }
  const negative = [];
  for (let i = idx.length - 1; i >= 0 && negative.length < k; i--) {
    if (model.weights[idx[i]] >= 0) break;
    negative.push({ term: terms[idx[i]], weight: model.weights[idx[i]] });
  }
  return { positive, negative };
}
