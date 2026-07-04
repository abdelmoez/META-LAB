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
      const ratios = sStats.filter((s) => s.kind === 'ratioCI');
      const meanSds = sStats.filter((s) => s.kind === 'meanSd');
      const evTots = sStats.filter((s) => s.kind === 'eventsTotal');

      if (match) {
        const out = outcomes.find((o) => o.id === match.outcomeId);
        const scope = { level: out ? out.level : 'primary', outcomeId: match.outcomeId, canonical: out ? out.canonical : '' };
        if (ratios.length) {
          // A sentence can carry several ratios (a covariate HR, the outcome's HR, a
          // second outcome's HR). Bind the ratio POSITIONALLY closest to the matched
          // outcome mention — not blindly the first — so we don't attribute a
          // covariate/other-outcome estimate (possibly sign-inverted) to this outcome.
          const omIdx = sent.start + outcomeMentionIndex(excerpt, out); // full-text coord
          const ratio = pickOutcomeRatio(ratios, omIdx);
          // >1 ratio in one sentence → the pairing is inherently uncertain: keep the
          // draft but drop confidence and attach an ambiguity note listing the others.
          const ambiguous = ratios.length > 1;
          const confidence = ambiguous ? 'low' : confidenceOf(match);
          const ambNote = ambiguous
            ? ` Multiple effect estimates in one sentence — verify this is the right one (others: ${ratios.filter((r) => r !== ratio).map((r) => `${r.value.measure} ${r.value.est}`).join('; ')}).`
            : '';
          pushDraft(drafts, draftKeys, mkRatioDraft({ ratio, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn, confidence, ambNote }), log);
        } else if (evTots.length === 2) {
          // EXACTLY two arm pairs. More than two (e.g. baseline + outcome counts) is too
          // ambiguous to assign arms → skip rather than guess wrong 2×2 cells.
          pushDraft(drafts, draftKeys, mkDichotomousDraft({ evTots, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }), log);
        } else if (meanSds.length === 2) {
          pushDraft(drafts, draftKeys, mkContinuousDraft({ meanSds, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn }), log);
        }
        // else: an outcome mention with no cleanly-pairable statistic — skip (never guess).
      } else if (ratios.length) {
        // A clear effect estimate for an outcome NOT in the review → park it.
        pushParked(alsoReported, parkedKeys, mkRatioDraft({ ratio: ratios[0], out: null, scope: { level: 'other', outcomeId: '', canonical: '' }, match: null, unit, excerpt, timepoint, baseStudy, at, idFn, confidence: 'low', ambNote: '' }), log);
      }
    }
  }

  log.push(`Auto-extract: ${drafts.length} draft${drafts.length === 1 ? '' : 's'} for protocol outcomes, ${alsoReported.length} parked as also-reported.`);
  return { drafts, alsoReported, log };
}

/* ── Draft builders ───────────────────────────────────────────────────────── */

function mkRatioDraft({ ratio, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn, confidence, ambNote }) {
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
    confidence: confidence || (match ? confidenceOf(match) : 'low'),
    conversions: [{
      id: idFnOrDefault(idFn)(), type: 'ratio_log', method: 'ln(estimate); SE from CI',
      reason: 'auto-extracted ratio + 95% CI', at,
      inputs: { est: v.est, lo: v.lo, hi: v.hi, measure: v.measure },
      result: { es: Math.log(v.est), lo: Math.log(v.lo), hi: Math.log(v.hi) },
    }],
    notes: `Auto-extracted ${v.adjusted ? 'adjusted ' : ''}${v.measure} ${v.est} [${v.lo}, ${v.hi}] — verify against the source.${ambNote || ''}`,
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
  // Include the FULL value payload (denominators, CI bounds, SDs) + a slice of the
  // provenance excerpt, so two genuinely-distinct estimates that merely share a point
  // value (e.g. adjusted vs unadjusted HR, or two arms with equal events) never
  // collapse into one and silently drop data.
  return [
    rec.scope.outcomeId, rec.timepoint, rec.esType,
    v.es, v.lo, v.hi, v.a, v.b, v.c, v.d, v.meanExp, v.sdExp, v.meanCtrl, v.sdCtrl, v.events, v.total,
    (rec.provenance && rec.provenance.excerpt ? rec.provenance.excerpt.slice(0, 60) : ''),
  ].join('|');
}

/** matchOutcomeInText — try the whole sentence, then noun-ish chunks around 'in/of/for'. */
function matchOutcomeInText(text, outcomes) {
  return matchOutcome(text, outcomes);
}

/** outcomeMentionIndex(excerpt, outcome) — char offset (within excerpt) of the outcome
 *  mention: the earliest occurrence of the outcome's name, an alias, or a significant
 *  (≥4-char) canonical token. Returns 0 if nothing is found (so nearestStat still runs). */
function outcomeMentionIndex(excerpt, outcome) {
  if (!outcome) return 0;
  const lc = String(excerpt).toLowerCase();
  const candidates = [];
  if (outcome.name) candidates.push(String(outcome.name).toLowerCase());
  if (Array.isArray(outcome.aliases)) for (const a of outcome.aliases) if (a) candidates.push(String(a).toLowerCase());
  if (outcome.canonical) for (const tok of String(outcome.canonical).split(/\s+/)) if (tok.length >= 4) candidates.push(tok);
  let best = -1;
  for (const c of candidates) {
    const i = lc.indexOf(c);
    if (i >= 0 && (best === -1 || i < best)) best = i;
  }
  return best === -1 ? 0 : best;
}

/** nearestStat(stats, targetIdx) — the stat whose full-text index is closest to targetIdx. */
function nearestStat(stats, targetIdx) {
  let best = stats[0], bestD = Infinity;
  for (const s of stats) {
    const d = Math.abs(s.index - targetIdx);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/** pickOutcomeRatio(ratios, omIdx) — clinical prose states the outcome THEN its effect
 *  ("mortality was lower (HR 0.80)"), while covariate/adjustment estimates sit in a
 *  preceding clause. Prefer the nearest ratio that appears AT/AFTER the outcome mention;
 *  fall back to the nearest overall when none follows. */
function pickOutcomeRatio(ratios, omIdx) {
  const after = ratios.filter((r) => r.index >= omIdx);
  return nearestStat(after.length ? after : ratios, omIdx);
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
