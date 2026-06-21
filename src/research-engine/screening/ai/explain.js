/**
 * explain.js — honest, non-hallucinated explanations for an AI relevance score.
 *
 * Pure functions, no DB, no network. Every reason is grounded in something
 * concrete: a model weight on a term that actually appears in the record, a
 * matched eligibility-criteria phrase, a PICO concept hit, or a similar record.
 * When the engine is uncertain or running cold-start only, the explanation SAYS
 * SO rather than inventing confidence.
 */

/** Strip the internal `kw:` feature prefix and turn bigram `_` back into space. */
function prettyTerm(term) {
  return String(term).replace(/^kw:/, '').replace(/_/g, ' ');
}

/**
 * termContributions — per-term contribution to the supervised score for THIS
 * record: weight[idx] · tfidf[idx]. Positive pushes toward include, negative
 * toward exclude. Only terms present in the record contribute.
 *
 * @param {ReturnType<import('./logreg.js').trainLogReg>|null} model
 * @param {string[]} terms — vectorizer.terms
 * @param {Record<number,number>} vector — this record's sparse TF-IDF vector
 * @param {number} [k]
 * @returns {{positive:Array<{term,contribution}>, negative:Array<{term,contribution}>}}
 */
export function termContributions(model, terms, vector, k = 6) {
  if (!model || !vector) return { positive: [], negative: [] };
  const contribs = [];
  for (const idxStr of Object.keys(vector)) {
    const idx = Number(idxStr);
    const w = model.weights[idx];
    if (!w) continue;
    contribs.push({ term: prettyTerm(terms[idx]), contribution: w * vector[idx] });
  }
  contribs.sort((a, b) => b.contribution - a.contribution);
  const positive = contribs.filter(c => c.contribution > 0).slice(0, k);
  const negative = contribs.filter(c => c.contribution < 0).slice(-k).reverse();
  return { positive, negative };
}

/**
 * buildExplanation — assemble the full, honest explanation object for one record.
 *
 * @param {object} args
 * @param {object} args.coldStart — coldStartScore() result
 * @param {object} args.hybrid — hybridScore() result
 * @param {ReturnType<import('./logreg.js').trainLogReg>|null} [args.model]
 * @param {string[]} [args.terms]
 * @param {Record<number,number>} [args.vector]
 * @param {Array<{recordId,title,similarity}>} [args.neighbors]
 * @param {boolean} [args.missingAbstract]
 * @returns {object}
 */
export function buildExplanation(args = {}) {
  const { coldStart, hybrid, model = null, terms = [], vector = null, neighbors = [], missingAbstract = false } = args;
  const sig = (coldStart && coldStart.signals) || {};
  const supervised = hybrid && hybrid.mode === 'supervised';

  const { positive, negative } = termContributions(model, terms, vector);

  const reasonsInclude = [];
  const reasonsExclude = [];

  // Supervised model term drivers.
  for (const p of positive) reasonsInclude.push({ kind: 'model_term', text: `“${p.term}” is associated with included studies`, weight: p.contribution });
  for (const nterm of negative) reasonsExclude.push({ kind: 'model_term', text: `“${nterm.term}” is associated with excluded studies`, weight: nterm.contribution });

  // Eligibility-criteria & PICO matches (always available from cold-start).
  const inclMatched = (sig.inclusion && sig.inclusion.matched) || [];
  for (const m of inclMatched.slice(0, 6)) reasonsInclude.push({ kind: 'criteria', text: `Matches inclusion criterion: “${m}”` });
  const exclMatched = (sig.exclusion && sig.exclusion.matched) || [];
  for (const m of exclMatched.slice(0, 6)) reasonsExclude.push({ kind: 'criteria', text: `Matches exclusion criterion: “${m}”` });

  const pico = sig.pico || {};
  const picoBreakdown = ['population', 'intervention', 'comparator', 'outcome'].map(dim => ({
    dimension: dim,
    match: pico[dim] ? pico[dim].match : null,
    matched: pico[dim] ? (pico[dim].matched || []) : [],
  }));
  for (const d of picoBreakdown) {
    if (d.match != null && d.match > 0 && d.matched.length) {
      reasonsInclude.push({ kind: 'pico', text: `${d.dimension[0].toUpperCase() + d.dimension.slice(1)} concept present: ${d.matched.slice(0, 3).join(', ')}` });
    }
  }

  // Similar included records.
  const similar = (neighbors || []).filter(n => n && n.similarity > 0).slice(0, 5);

  // Honest uncertainty note.
  let uncertaintyNote = '';
  if (missingAbstract) {
    uncertaintyNote = 'No usable abstract — the AI is working from the title alone, so this score is low-confidence.';
  } else if (!supervised) {
    uncertaintyNote = coldStart && coldStart.lowConfidence
      ? 'No eligibility criteria or PICO configured yet, and too few human decisions to train a model — this is a neutral prior, not a prediction.'
      : 'Too few human decisions to train a model yet — this score reflects criteria/PICO matching only (cold-start), not a learned classifier.';
  } else if (hybrid && hybrid.score > 0.4 && hybrid.score < 0.6) {
    uncertaintyNote = 'The model is genuinely undecided about this record — a good candidate for a human label.';
  }

  return {
    mode: supervised ? 'supervised' : 'cold_start',
    score: hybrid ? hybrid.score : null,
    subScores: hybrid ? hybrid.subScores : null,
    weights: hybrid ? hybrid.weights : null,
    reasonsInclude,
    reasonsExclude,
    picoBreakdown,
    studyDesign: sig.studyDesign || null,
    studyDesignMatch: sig.studyDesignMatch ?? null,
    similar,
    uncertaintyNote,
  };
}
