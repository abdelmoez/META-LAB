/**
 * eligibility.js — criteria-based eligibility screening (P10).
 *
 * Pure functions, no DB, no network, NO randomness, NO Date.now — the same record
 * + criteria + config ALWAYS produce the same assessment. This is a DETERMINISTIC,
 * zero-training engine: it does not learn, it does not call an LLM. It answers each
 * eligibility criterion by MATCHING the criterion's concepts (derived with the same
 * conceptKeywords extractor the rest of the screening engine uses) against the
 * record's own sentences, and reports honest, match-derived confidences.
 *
 * The output is an ASSISTIVE decision suggestion. It never finalises a screening
 * decision — a human always does. Its scalar (eligibilityScoreFromAssessment) is an
 * OPTIONAL hybrid signal: absent (no criteria configured) it renormalizes away, so
 * the deterministic baseline engine scores byte-identically without it.
 *
 * Confidence / decision mapping (documented, honest — NOT invented calibration):
 *   For each criterion we derive concept GROUPS from its question (one AND-group per
 *   clinical concept) plus an optional OR-group from explicit `terms`. `strength` =
 *   fraction of groups matched somewhere in the record's text (title/abstract/full
 *   text). With `unclearBand = [lo, hi]`:
 *     strength ≥ hi → the criterion's condition is PRESENT   (confidence rises lo→hi..1
 *                     mapped onto [minConfidence, maxConfidence]).
 *     strength ≤ lo → the condition is ABSENT                (absence-of-evidence, so the
 *                     confidence is capped at absenceConfidenceCap and further reduced by
 *                     titleOnlyFactor when only the title was available to read).
 *     lo < strength < hi → UNCLEAR                           (a deliberately low confidence,
 *                     below the include/exclude gates, so it never forces a decision).
 *   `polarity` flips the yes/no LABEL (a 'negative' criterion — "study is NOT in humans"
 *   — reports 'yes' when its concept is ABSENT); the detection confidence is unchanged.
 *   Roll-up: EXCLUDE criterion answering 'yes' with confidence ≥ excludeConfidence ⇒
 *   exclude; INCLUDE required criteria all answering 'yes' with confidence ≥
 *   includeConfidence (and no exclusion met) ⇒ include; otherwise ⇒ unclear.
 */
import { extractConcepts, expandSynonyms } from '../conceptKeywords.js';
import { confusionAt, metricsFromConfusion, rocAuc } from './validation.js';
import { DEFAULT_AI_CONFIG } from './config.js';

/** Engine version stamped on every assessment for provenance/reproducibility. */
export const ENGINE_VERSION = 'eligibility-v1';

/** Default eligibility tunables (single source lives in config.js). */
export const DEFAULT_ELIGIBILITY_CONFIG = DEFAULT_AI_CONFIG.eligibility;

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

/** Lowercase + pad a text so word-bounded phrase membership is a simple `.includes`. */
function padded(text) {
  return ` ${String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** Does a (multi-word ok) phrase occur word-bounded inside a padded, lowercased text? */
function phraseIn(paddedText, phrase) {
  const t = String(phrase == null ? '' : phrase).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 3) return false;   // ignore 1–2 char forms (spurious matches)
  return paddedText.includes(` ${t} `);
}

/**
 * splitSentences — deterministic sentence splitter. Splits on hard line breaks and
 * on sentence-terminal punctuation followed by whitespace. Each returned sentence is
 * a VERBATIM substring of the input (only surrounding whitespace is removed), so it
 * can be surfaced as an evidence quote.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const block of text.split(/\r?\n+/)) {
    for (const piece of block.split(/(?<=[.!?])\s+/)) {
      const s = piece.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/**
 * Concept groups for one criterion. Each concept from the question is its own
 * AND-group; explicit `terms` collapse into ONE OR-group (any term satisfies it).
 * Every group carries its matchable surface forms (the concept + curated synonyms).
 */
function criterionGroups(criterion) {
  const groups = [];
  const seen = new Set();
  const add = (label, forms) => {
    const key = norm(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const uniq = [...new Set(forms.filter(f => typeof f === 'string' && f.trim()))];
    if (uniq.length) groups.push({ label, forms: uniq });
  };

  for (const c of extractConcepts(criterion && criterion.question)) {
    add(c, [c, ...expandSynonyms(c)]);
  }

  const terms = Array.isArray(criterion && criterion.terms)
    ? criterion.terms.filter(t => typeof t === 'string' && t.trim())
    : [];
  if (terms.length) {
    const forms = [];
    for (const t of terms) { forms.push(t); for (const s of expandSynonyms(t)) forms.push(s); }
    add(terms.join(' / '), forms);
  }
  return groups;
}

const FIELDS = ['title', 'abstract', 'fullText'];

/** Scan a record for which concept groups match + the single best-supporting sentence. */
function scanRecord(record, groups) {
  const matched = new Set();          // indices of groups matched ANYWHERE
  const matchedLabels = [];
  let bestCount = 0;
  let bestSentence = null;
  let bestField = 'none';
  let hadBody = false;                // any abstract/full-text read (vs. title only)

  for (const field of FIELDS) {
    const text = record && record[field];
    if (!text || typeof text !== 'string' || !text.trim()) continue;
    if (field !== 'title') hadBody = true;
    for (const sentence of splitSentences(text)) {
      const p = padded(sentence);
      let count = 0;
      for (let gi = 0; gi < groups.length; gi++) {
        if (groups[gi].forms.some(f => phraseIn(p, f))) {
          if (!matched.has(gi)) { matched.add(gi); matchedLabels.push(groups[gi].label); }
          count++;
        }
      }
      if (count > bestCount) { bestCount = count; bestSentence = sentence; bestField = field; }
    }
  }

  return {
    matchedCount: matched.size,
    matchedLabels,
    evidenceQuote: bestCount > 0 ? bestSentence : null,
    sourceField: bestCount > 0 ? bestField : 'none',
    hadBody,
  };
}

/** strength ≥ hi → confidence rises from minConfidence (at hi) to maxConfidence (at 1). */
function presentConfidence(strength, hi, cfg) {
  const span = 1 - hi;
  const t = span > 0 ? (strength - hi) / span : 1;
  return clamp01(cfg.minConfidence + (cfg.maxConfidence - cfg.minConfidence) * clamp01(t));
}

/** strength ≤ lo → confidence rises from minConfidence (at lo) to absenceConfidenceCap (at 0). */
function absentConfidence(strength, lo, cfg) {
  const t = lo > 0 ? (lo - strength) / lo : 1;
  return clamp01(cfg.minConfidence + (cfg.absenceConfidenceCap - cfg.minConfidence) * clamp01(t));
}

/** Ambiguous band → a low confidence (peaks mid-band), always below the decision gates. */
function unclearConfidence(strength, lo, hi) {
  const half = (hi - lo) / 2 || 1;
  const centrality = clamp01(1 - Math.abs(strength - (lo + hi) / 2) / half);
  return clamp01(0.30 + 0.15 * centrality);
}

function critLabel(a) {
  if (a.key) return a.key;
  if (a.criterionId != null) return `#${a.criterionId}`;
  return a.category || 'criterion';
}

/**
 * assessCriterion — evaluate ONE criterion against a record.
 * @returns an answer object (see evaluateEligibility for the shape).
 */
function assessCriterion(record, criterion, cfg) {
  const kind = criterion && criterion.kind === 'exclude' ? 'exclude' : 'include';
  const polarity = criterion && criterion.polarity === 'negative' ? 'negative' : 'positive';
  const groups = criterionGroups(criterion);
  const scan = scanRecord(record, groups);
  const [lo, hi] = cfg.unclearBand;

  let condition;   // 'present' | 'absent' | 'unclear' — pure concept detection
  let confidence;
  let strength;

  if (!groups.length) {
    condition = 'unclear';
    strength = null;
    confidence = clamp01(cfg.minConfidence - 0.25);
  } else {
    strength = scan.matchedCount / groups.length;
    if (strength >= hi) {
      condition = 'present';
      confidence = presentConfidence(strength, hi, cfg);
    } else if (strength <= lo) {
      condition = 'absent';
      confidence = absentConfidence(strength, lo, cfg);
      if (!scan.hadBody) confidence = clamp01(confidence * cfg.titleOnlyFactor);
    } else {
      condition = 'unclear';
      confidence = unclearConfidence(strength, lo, hi);
    }
  }

  // Polarity maps concept detection → the criterion's yes/no LABEL. 'positive':
  // present ⇒ 'yes'. 'negative' ("... is NOT ...") inverts: present ⇒ 'no'.
  let answer;
  if (condition === 'unclear') answer = 'unclear';
  else if (polarity === 'negative') answer = condition === 'present' ? 'no' : 'yes';
  else answer = condition === 'present' ? 'yes' : 'no';

  let rationale;
  if (!groups.length) {
    rationale = 'No matchable concept could be derived from this criterion; automatic assessment not possible.';
  } else if (condition === 'present') {
    rationale = `Matched ${scan.matchedCount}/${groups.length} criterion concept(s) in the ${scan.sourceField}`
      + (scan.matchedLabels.length ? ` (${scan.matchedLabels.join(', ')}).` : '.');
  } else if (condition === 'absent') {
    rationale = `None of the ${groups.length} criterion concept(s) were found in the ${scan.hadBody ? 'title/abstract' : 'title'}.`;
  } else {
    rationale = `Only ${scan.matchedCount}/${groups.length} criterion concept(s) matched — insufficient to decide.`;
  }

  return {
    criterionId: criterion && criterion.id != null ? criterion.id : null,
    key: (criterion && criterion.key) || (criterion && criterion.id != null ? String(criterion.id) : null),
    category: (criterion && criterion.category) || null,
    kind,
    required: !!(criterion && criterion.required),
    polarity,
    answer,
    confidence,
    strength,
    rationale,
    evidenceQuote: scan.evidenceQuote,
    sourceField: scan.sourceField,
  };
}

/** Resolve either a full AI config, an eligibility-only object, or nothing → defaults. */
function resolveEligibilityCfg(config) {
  if (config && config.eligibility) return { ...DEFAULT_ELIGIBILITY_CONFIG, ...config.eligibility };
  if (config && (config.unclearBand || config.includeConfidence != null)) {
    return { ...DEFAULT_ELIGIBILITY_CONFIG, ...config };
  }
  return DEFAULT_ELIGIBILITY_CONFIG;
}

/**
 * evaluateEligibility — assess a record against a list of eligibility criteria.
 *
 * @param {object} params
 * @param {{title?:string, abstract?:string, fullText?:string}} params.record
 * @param {Array<{id?,key?,category?,question?,kind?:'include'|'exclude',
 *   required?:boolean, polarity?:'positive'|'negative', terms?:string[]}>} params.criteria
 * @param {object} [params.config] full AI config OR an eligibility-only block
 * @returns {{ answers:Array, suggestedDecision:'include'|'exclude'|'unclear',
 *   decisionConfidence:number, blockers:string[], engineVersion:string }}
 */
export function evaluateEligibility({ record = {}, criteria = [], config } = {}) {
  const cfg = resolveEligibilityCfg(config);
  const list = Array.isArray(criteria) ? criteria : [];
  const answers = list.map(c => assessCriterion(record, c, cfg));

  const minCriteria = cfg.minCriteria ?? 1;
  const includeGate = cfg.includeConfidence ?? 0.65;
  const excludeGate = cfg.excludeConfidence ?? 0.65;

  const isIncludeSat = a => a.kind === 'include' && a.answer === 'yes' && a.confidence >= includeGate;
  const includeAnswers = answers.filter(a => a.kind === 'include');
  const requiredIncludes = includeAnswers.filter(a => a.required);
  const excludeFired = answers.filter(a => a.kind === 'exclude' && a.answer === 'yes' && a.confidence >= excludeGate);
  const anyIncludeSat = includeAnswers.some(isIncludeSat);
  const allRequiredSat = requiredIncludes.every(isIncludeSat);
  const hasInclude = includeAnswers.length > 0;

  let suggestedDecision;
  let decisionConfidence;
  let blockers = [];

  if (answers.length < minCriteria) {
    suggestedDecision = 'unclear';
    decisionConfidence = clamp01((cfg.minConfidence ?? 0.5) - 0.25);
    blockers = ['Insufficient eligibility criteria configured to decide.'];
  } else if (excludeFired.length) {
    // A single confident exclusion is sufficient — trust the strongest one.
    suggestedDecision = 'exclude';
    decisionConfidence = clamp01(Math.max(...excludeFired.map(a => a.confidence)));
    blockers = excludeFired.map(a => `Exclusion met: ${critLabel(a)}`);
  } else if (allRequiredSat && (!hasInclude || anyIncludeSat)) {
    suggestedDecision = 'include';
    // Only as confident as the weakest required gate (or the satisfied includes).
    const gates = requiredIncludes.length ? requiredIncludes : includeAnswers.filter(isIncludeSat);
    decisionConfidence = gates.length
      ? clamp01(Math.min(...gates.map(a => a.confidence)))
      : clamp01(mean(answers.map(a => a.confidence)));   // pure-exclusion screen, none fired
    blockers = [];
  } else {
    suggestedDecision = 'unclear';
    const unmetRequired = requiredIncludes.filter(a => !isIncludeSat(a));
    const blocking = unmetRequired.length
      ? unmetRequired
      : includeAnswers.filter(a => !isIncludeSat(a));
    blockers = blocking.map(a => a.answer === 'no'
      ? `Include criterion not met: ${critLabel(a)}`
      : `Include criterion unclear: ${critLabel(a)}`);
    decisionConfidence = blocking.length
      ? clamp01(mean(blocking.map(a => a.confidence)))
      : clamp01((cfg.minConfidence ?? 0.5) - 0.15);
  }

  return { answers, suggestedDecision, decisionConfidence, blockers, engineVersion: ENGINE_VERSION };
}

/**
 * eligibilityScoreFromAssessment — collapse an assessment (or its answers array) into
 * a single include-support scalar in [0,1], usable as a hybrid signal. Each criterion
 * contributes 0.5 ± 0.5·confidence in the direction it favours (include criterion
 * 'yes' → up, 'no' → down; exclude criterion 'yes' → down, 'no' → mild up; 'unclear'
 * → neutral 0.5). Returns null when there are no criteria.
 *
 * @param {object|Array} assessmentOrAnswers
 * @returns {number|null}
 */
export function eligibilityScoreFromAssessment(assessmentOrAnswers) {
  const answers = Array.isArray(assessmentOrAnswers)
    ? assessmentOrAnswers
    : (assessmentOrAnswers && Array.isArray(assessmentOrAnswers.answers) ? assessmentOrAnswers.answers : null);
  if (!answers || !answers.length) return null;

  const contribs = [];
  for (const a of answers) {
    const conf = clamp01(Number(a && a.confidence) || 0);
    if (!a || a.answer === 'unclear' || (a.answer !== 'yes' && a.answer !== 'no')) {
      contribs.push(0.5);
      continue;
    }
    const yes = a.answer === 'yes';
    let signed;
    if (a.kind === 'exclude') signed = yes ? -conf : 0.5 * conf;   // exclusion met pulls down
    else signed = yes ? conf : -conf;                              // include met pulls up
    contribs.push(clamp01(0.5 + 0.5 * signed));
  }
  return clamp01(mean(contribs));
}

/** 'include' | 'exclude' | null from a human decision value (string / 0-1 / bool). */
function normalizeDecision(d) {
  if (d === 1 || d === true) return 'include';
  if (d === 0 || d === false) return 'exclude';
  const s = String(d == null ? '' : d).toLowerCase().trim();
  if (s === 'include' || s === 'included' || s === 'yes') return 'include';
  if (s === 'exclude' || s === 'excluded' || s === 'no') return 'exclude';
  return null;
}

/** Per-criterion agreement between the criterion's implied verdict and the human label. */
function perCriterionAgreement(assessments, labels, includeGate) {
  const byKey = new Map();
  assessments.forEach((asmt, i) => {
    const ans = asmt && Array.isArray(asmt.answers) ? asmt.answers : [];
    for (const a of ans) {
      const key = (a.key != null ? a.key : (a.criterionId != null ? String(a.criterionId) : a.category)) || 'unknown';
      let e = byKey.get(key);
      if (!e) { e = { key, category: a.category ?? null, kind: a.kind ?? 'include', n: 0, decisive: 0, agree: 0 }; byKey.set(key, e); }
      e.n++;
      const decisive = (a.answer === 'yes' || a.answer === 'no') && Number(a.confidence) >= includeGate;
      if (decisive) {
        e.decisive++;
        const predictInclude = a.kind === 'exclude' ? a.answer === 'no' : a.answer === 'yes';
        if (predictInclude === (labels[i] === 1)) e.agree++;
      }
    }
  });
  return [...byKey.values()]
    .map(e => ({ key: e.key, category: e.category, kind: e.kind, n: e.n, decisive: e.decisive, agreement: e.decisive ? e.agree / e.decisive : null }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/**
 * computeEligibilityValidation — validate eligibility suggestions against human final
 * decisions. Mirrors computeValidation's style. Leakage-free: it only reads the
 * assessments + labels it is given (no cross-record fitting). NaN-safe on empty /
 * degenerate input (returns nulls, never throws).
 *
 * @param {object} params
 * @param {Array} params.assessments — evaluateEligibility outputs, aligned with humanDecisions
 * @param {Array} params.humanDecisions — 'include'|'exclude' (or 1/0) ground truth
 * @param {object} [params.thresholds] { decision?:0.5, includeConfidence?, grid?:number[] }
 * @returns {object}
 */
export function computeEligibilityValidation({ assessments = [], humanDecisions = [], thresholds = {} } = {}) {
  const decisionThreshold = thresholds.decision ?? 0.5;
  const includeGate = thresholds.includeConfidence ?? DEFAULT_ELIGIBILITY_CONFIG.includeConfidence;

  const scores = [];
  const labels = [];
  const kept = [];
  const list = Array.isArray(assessments) ? assessments : [];
  for (let i = 0; i < list.length; i++) {
    const human = normalizeDecision((humanDecisions || [])[i]);
    if (human !== 'include' && human !== 'exclude') continue;
    const s = eligibilityScoreFromAssessment(list[i]);
    if (s == null) continue;
    scores.push(s);
    labels.push(human === 'include' ? 1 : 0);
    kept.push(list[i]);
  }

  const n = scores.length;
  if (n === 0) {
    return {
      recall: null, precision: null, specificity: null, accuracy: null,
      falseNegatives: 0, falsePositives: 0,
      confusionMatrix: { tp: 0, fp: 0, tn: 0, fn: 0 },
      thresholdSensitivity: [], perCriterion: [], n: 0, auc: null, threshold: decisionThreshold,
    };
  }

  const confusion = confusionAt(scores, labels, decisionThreshold);
  const m = metricsFromConfusion(confusion);
  const grid = Array.isArray(thresholds.grid) ? thresholds.grid : [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const thresholdSensitivity = grid.map(t => {
    const c = confusionAt(scores, labels, t);
    const mm = metricsFromConfusion(c);
    return { threshold: t, recall: mm.sensitivity, precision: mm.precision, specificity: mm.specificity, accuracy: mm.accuracy, confusion: c };
  });

  return {
    recall: m.sensitivity,
    precision: m.precision,
    specificity: m.specificity,
    accuracy: m.accuracy,
    falseNegatives: confusion.fn,
    falsePositives: confusion.fp,
    confusionMatrix: confusion,
    thresholdSensitivity,
    perCriterion: perCriterionAgreement(kept, labels, includeGate),
    auc: rocAuc(scores, labels),
    n,
    threshold: decisionThreshold,
  };
}
