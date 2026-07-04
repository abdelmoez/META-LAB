/**
 * extraction/autoExtract.js — RoadMap/1.md Method 1 ("Auto-generate").
 * Deterministic, protocol-scoped first pass. NO model call. Given the article's
 * text (abstract + per-page full text) and the review's pre-specified outcomes, it
 * produces DRAFT extraction records for the target outcomes and parks anything it
 * finds that is out of scope ("Also reported — not in this review").
 *
 * Precision over coverage: a draft is emitted ONLY when a protocol outcome is
 * mentioned in the SAME sentence as a usable statistic (a ratio+CI, or a
 * mean ± SD, or an events/total pair). Nothing is ever guessed; a value with no
 * matched excerpt is never produced. Every draft carries provenance (page +
 * sentence excerpt), a confidence, and needsReview:true.
 *
 * Pure: no DOM, no I/O, no Date — the caller supplies `at` (ISO timestamp) and,
 * optionally, an id generator.
 */

import { splitSentences } from './heuristicExtract.js';
import { extractStats } from './patternExtract.js';
import { matchOutcome } from './outcomeMatch.js';
import { mkExtractionRecord } from './records.js';

/** Ratio measures whose (est, lo, hi) map straight onto a log-scale effect size. */
const RATIO_MEASURES = new Set(['OR', 'RR', 'HR', 'IRR']);

/**
 * autoExtract({ pages, abstract, protocol, baseStudy, at, idFn }) ->
 *   { drafts: record[], alsoReported: record[], log: string[] }
 *
 * @param {object} opts
 * @param {Array<{page:number,text:string}>} [opts.pages]  per-page full text
 * @param {string} [opts.abstract]                          abstract text
 * @param {{outcomes:Array}} opts.protocol                  protocolOutcomes(project) result
 * @param {object} [opts.baseStudy]                         study whose citation to inherit
 * @param {string} [opts.at]                                ISO timestamp for provenance
 * @param {() => string} [opts.idFn]                        id generator (determinism)
 */
export function autoExtract({ pages = [], abstract = '', protocol = { outcomes: [] }, baseStudy = null, at = '', idFn } = {}) {
  const outcomes = (protocol && Array.isArray(protocol.outcomes)) ? protocol.outcomes : [];
  const log = [];
  const drafts = [];
  const alsoReported = [];
  const draftKeys = new Set();     // dedupe drafts by outcome+timepoint+measure+value
  const parkedKeys = new Set();

  // Build the ordered list of text units to scan (abstract first, then pages).
  const units = [];
  if (typeof abstract === 'string' && abstract.trim()) units.push({ field: 'abstract', page: null, text: abstract });
  for (const p of Array.isArray(pages) ? pages : []) {
    if (p && typeof p.text === 'string' && p.text.trim()) units.push({ field: 'fullText', page: p.page ?? null, text: p.text });
  }
  if (!units.length) { log.push('No text supplied — nothing to auto-extract.'); return { drafts, alsoReported, log }; }
  if (!outcomes.length) log.push('No protocol outcomes defined — every statistic found is parked as "also reported".');

  for (const unit of units) {
    const sentences = splitSentences(unit.text);
    const stats = extractStats(unit.text);
    if (!stats.length) continue;
    // Group statistics by the sentence that contains them (extractStats gives a
    // char index; find the enclosing sentence span).
    const bySentence = new Map();
    for (const s of stats) {
      const sent = sentenceContaining(sentences, s.index) || { text: s.excerpt || '', start: s.index, end: s.index };
      const key = `${sent.start}:${sent.end}`;
      if (!bySentence.has(key)) bySentence.set(key, { sent, stats: [] });
      bySentence.get(key).stats.push(s);
    }

    for (const { sent, stats: sStats } of bySentence.values()) {
      const excerpt = sent.text;
      // Which protocol outcome (if any) does this sentence name?
      const match = matchOutcomeInText(excerpt, outcomes);
      const timepoint = firstFollowup(sStats);
      // Preferred: a ratio measure with CI is the cleanest single-sentence effect.
      const ratio = sStats.find((s) => s.kind === 'ratioCI');
      const meanSds = sStats.filter((s) => s.kind === 'meanSd');
      const evTots = sStats.filter((s) => s.kind === 'eventsTotal');

      if (match) {
        const out = outcomes.find((o) => o.id === match.outcomeId);
        const scope = { level: out ? out.level : 'primary', outcomeId: match.outcomeId, canonical: out ? out.canonical : '' };
        if (ratio) {
          pushDraft(drafts, draftKeys, mkRatioDraft({ ratio, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }), log);
        } else if (evTots.length >= 2) {
          pushDraft(drafts, draftKeys, mkDichotomousDraft({ evTots, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }), log);
        } else if (meanSds.length >= 2) {
          pushDraft(drafts, draftKeys, mkContinuousDraft({ meanSds, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }), log);
        }
        // else: an outcome mention with no paired statistic — skip (do not guess).
      } else if (ratio) {
        // A clear effect estimate for an outcome NOT in the review → park it.
        pushParked(alsoReported, parkedKeys, mkRatioDraft({ ratio, out: null, scope: { level: 'other', outcomeId: '', canonical: '' }, match: null, unit, excerpt, timepoint, baseStudy, at, idFn }), log);
      }
    }
  }

  log.push(`Auto-extract: ${drafts.length} draft${drafts.length === 1 ? '' : 's'} for protocol outcomes, ${alsoReported.length} parked as also-reported.`);
  return { drafts, alsoReported, log };
}

/* ── Draft builders ───────────────────────────────────────────────────────── */

function mkRatioDraft({ ratio, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }) {
  const v = ratio.value;
  const esType = RATIO_MEASURES.has(v.measure) ? v.measure : '';
  return mkExtractionRecord({
    author: baseStudy?.author || '', year: baseStudy?.year || '',
    outcome: out ? out.name : '', timepoint, esType,
    scope,
    values: {
      // Log-scale effect + CI (ratio measures are pooled on ln). The UI shows the
      // readable ratio; the analysis scale is stored, mirroring calcES/ratio_log.
      es: String(Math.log(v.est)), lo: String(Math.log(v.lo)), hi: String(Math.log(v.hi)),
    },
    provenance: { method: 'auto', page: unit.page, region: null, excerpt, at },
    confidence: match ? confidenceOf(match) : 'low',
    conversions: [{
      id: idFnOrDefault(idFn)(), type: 'ratio_log', method: 'ln(estimate); SE from CI',
      reason: 'auto-extracted ratio + 95% CI', at,
      inputs: { est: v.est, lo: v.lo, hi: v.hi, measure: v.measure },
      result: { es: Math.log(v.est), lo: Math.log(v.lo), hi: Math.log(v.hi) },
    }],
    notes: `Auto-extracted ${v.adjusted ? 'adjusted ' : ''}${v.measure} ${v.est} [${v.lo}, ${v.hi}] — verify against the source.`,
  }, idFn);
}

function mkDichotomousDraft({ evTots, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }) {
  const [exp, ctrl] = evTots;
  return mkExtractionRecord({
    author: baseStudy?.author || '', year: baseStudy?.year || '',
    outcome: out ? out.name : '', timepoint, esType: '',
    scope,
    values: {
      a: String(exp.value.events), b: String(exp.value.total - exp.value.events),
      c: String(ctrl.value.events), d: String(ctrl.value.total - ctrl.value.events),
    },
    provenance: { method: 'auto', page: unit.page, region: null, excerpt, at },
    confidence: 'low',
    notes: `Auto-extracted 2×2: ${exp.value.events}/${exp.value.total} vs ${ctrl.value.events}/${ctrl.value.total}. Confirm arm assignment, then compute the effect size.`,
  }, idFn);
}

function mkContinuousDraft({ meanSds, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }) {
  const [exp, ctrl] = meanSds;
  return mkExtractionRecord({
    author: baseStudy?.author || '', year: baseStudy?.year || '',
    outcome: out ? out.name : '', timepoint, esType: '',
    scope,
    values: {
      meanExp: String(exp.value.mean), sdExp: String(exp.value.sd),
      meanCtrl: String(ctrl.value.mean), sdCtrl: String(ctrl.value.sd),
    },
    provenance: { method: 'auto', page: unit.page, region: null, excerpt, at },
    confidence: 'low',
    notes: `Auto-extracted mean ± SD: ${exp.value.mean}±${exp.value.sd} vs ${ctrl.value.mean}±${ctrl.value.sd}. Confirm arm assignment and enter group sizes.`,
  }, idFn);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function pushDraft(list, keys, rec, log) {
  const key = draftKey(rec);
  if (keys.has(key)) return;
  keys.add(key);
  list.push(rec);
}
function pushParked(list, keys, rec, log) {
  const key = draftKey(rec) + '|' + (rec.provenance.excerpt || '').slice(0, 40);
  if (keys.has(key)) return;
  keys.add(key);
  list.push(rec);
}
function draftKey(rec) {
  const v = rec.values;
  return [rec.scope.outcomeId, rec.timepoint, rec.esType, v.es, v.a, v.c, v.meanExp, v.meanCtrl].join('|');
}

/** matchOutcomeInText — try the whole sentence, then noun-ish chunks around 'in/of/for'. */
function matchOutcomeInText(text, outcomes) {
  return matchOutcome(text, outcomes);
}

function sentenceContaining(sentences, pos) {
  for (const s of sentences) if (pos >= s.start && pos < s.end) return s;
  return sentences.length ? sentences[sentences.length - 1] : null;
}

function firstFollowup(stats) {
  const f = stats.find((s) => s.kind === 'followup');
  return f ? f.value.text : '';
}

function confidenceOf(match) {
  if (!match) return 'low';
  if (match.confidence === 'high') return 'medium'; // auto never claims "high" outright
  return 'low';
}

function idFnOrDefault(idFn) {
  return typeof idFn === 'function' ? idFn : () => Math.random().toString(36).slice(2, 10);
}
