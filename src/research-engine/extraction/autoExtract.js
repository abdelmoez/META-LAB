/**
 * extraction/autoExtract.js — RoadMap/1.md Method 1 ("Auto-generate").
 * Deterministic, protocol-scoped first pass. NO model call. Given the article's
 * text (abstract + per-page full text) and the review's pre-specified outcomes, it
 * produces DRAFT extraction records for the target outcomes and parks anything it
 * finds that is out of scope ("Also reported — not in this review").
 *
 * Precision over coverage: a draft is emitted ONLY when a protocol outcome is
 * mentioned NEAR a usable statistic (a ratio+CI, or a mean ± SD, or an
 * events/total pair) in the SAME sentence. The outcome is matched against
 * clause-local noun phrases around each statistic — NOT the whole sentence — so a
 * covariate or a second outcome named elsewhere in the sentence cannot be
 * mis-attributed. When more than one protocol outcome is named in one sentence,
 * confidence is dropped and needsReview stays true. Nothing is ever guessed; a
 * value with no matched excerpt is never produced.
 *
 * Never silently drops: every cleanly-pairable statistic that does NOT match a
 * protocol outcome (a ratio+CI, a 2×2, or a mean ± SD pair) is PARKED as
 * "also reported" rather than discarded. Auto-computed effect sizes are attached
 * to 2×2 and (when group sizes are present) continuous drafts via calcES, with a
 * conversions[] provenance entry.
 *
 * detectedOutcomes: for every stat-bearing sentence a best-effort outcome
 * descriptor is collected (always, even with an empty protocol) so the UI can offer
 * an outcome chooser when nothing matched.
 *
 * Pure: no DOM, no I/O, no Date, no pdf.js — the caller supplies `at` (ISO
 * timestamp) and, optionally, an id generator.
 */

import { splitSentences } from './heuristicExtract.js';
import { extractStats } from './patternExtract.js';
import { matchOutcome } from './outcomeMatch.js';
import { mkExtractionRecord } from './records.js';
import { calcES } from '../effect-sizes/calculators.js';

/** Ratio measures whose (est, lo, hi) map straight onto a log-scale effect size. */
const RATIO_MEASURES = new Set(['OR', 'RR', 'HR', 'IRR']);

/** Statistic kinds a draft can be built from (arm pairs / an effect estimate). */
const DRAFTABLE_KINDS = new Set(['ratioCI', 'eventsTotal', 'meanSd']);

/** Statistic kinds that flag a sentence as "outcome-bearing" for detectedOutcomes. */
const DETECT_KINDS = ['ratioCI', 'eventsTotal', 'meanSd', 'percent', 'ci'];

/** How far (chars) an outcome mention may sit from a statistic to still bind. */
const NEAR_LIMIT = 220;

/**
 * autoExtract({ pages, abstract, protocol, baseStudy, at, idFn }) ->
 *   { drafts: record[], alsoReported: record[], detectedOutcomes: object[], log: string[] }
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
  const detectedOutcomes = [];
  const draftKeys = new Set();     // dedupe drafts by outcome+timepoint+measure+value
  const parkedKeys = new Set();
  const detectedKeys = new Set();

  // Build the ordered list of text units to scan (abstract first, then pages).
  const units = [];
  if (typeof abstract === 'string' && abstract.trim()) units.push({ field: 'abstract', page: null, text: abstract });
  for (const p of Array.isArray(pages) ? pages : []) {
    if (p && typeof p.text === 'string' && p.text.trim()) units.push({ field: 'fullText', page: p.page ?? null, text: p.text });
  }
  if (!units.length) { log.push('No text supplied — nothing to auto-extract.'); return { drafts, alsoReported, detectedOutcomes, log }; }
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
      const timepoint = firstFollowup(sStats);
      const ratios = sStats.filter((s) => s.kind === 'ratioCI');
      const meanSds = sStats.filter((s) => s.kind === 'meanSd');
      const evTots = sStats.filter((s) => s.kind === 'eventsTotal');

      // detectedOutcomes — always collect a descriptor for a stat-bearing sentence.
      const detStat = pickDetectStat(sStats);
      if (detStat) {
        const relIdx = clampRel(detStat.index - sent.start, excerpt.length);
        addDetected(detectedOutcomes, detectedKeys, {
          label: outcomeLabelNear(excerpt, relIdx),
          kind: detStat.kind,
          page: unit.page,
          excerpt,
          statPreview: statPreviewOf(detStat),
        });
      }

      // Which protocol outcome (if any) does a statistic in this sentence belong to?
      const m = matchSentenceOutcome(excerpt, sent, sStats, outcomes);
      const match = m ? m.match : null;
      const multiOutcome = m ? m.distinct > 1 : false;

      if (match) {
        const out = outcomes.find((o) => o.id === match.outcomeId);
        const canonicalName = out ? out.canonical : '';
        const scope = { level: out ? out.level : 'primary', outcomeId: match.outcomeId, canonical: canonicalName, canonicalName };
        if (ratios.length) {
          // A sentence can carry several ratios (a covariate HR, the outcome's HR, a
          // second outcome's HR). Bind the ratio POSITIONALLY closest to the matched
          // outcome mention — not blindly the first — so we don't attribute a
          // covariate/other-outcome estimate (possibly sign-inverted) to this outcome.
          const omIdx = sent.start + outcomeMentionIndex(excerpt, out); // full-text coord
          const ratio = pickOutcomeRatio(ratios, omIdx);
          // >1 ratio OR >1 outcome in one sentence → the pairing is inherently
          // uncertain: keep the draft but drop confidence and flag for review.
          const ratiosAmb = ratios.length > 1;
          const ambiguous = ratiosAmb || multiOutcome;
          const confidence = ambiguous ? 'low' : confidenceOf(match);
          let ambNote = '';
          if (ratiosAmb) {
            ambNote += ` Multiple effect estimates in one sentence — verify this is the right one (others: ${ratios.filter((r) => r !== ratio).map((r) => `${r.value.measure} ${r.value.est}`).join('; ')}).`;
          }
          if (multiOutcome) ambNote += ' Multiple outcomes named in one sentence — verify attribution.';
          pushDraft(drafts, draftKeys, mkRatioDraft({ ratio, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn, confidence, ambNote }), log);
        } else if (evTots.length === 2) {
          // EXACTLY two arm pairs. More than two (e.g. baseline + outcome counts) is too
          // ambiguous to assign arms → skip rather than guess wrong 2×2 cells.
          pushDraft(drafts, draftKeys, mkDichotomousDraft({ evTots, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn, multiOutcome }), log);
        } else if (meanSds.length === 2) {
          pushDraft(drafts, draftKeys, mkContinuousDraft({ meanSds, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn, multiOutcome }), log);
        }
        // else: an outcome mention with no cleanly-pairable statistic — skip (never guess).
      } else {
        // No protocol outcome matched this sentence. Never silently drop a
        // cleanly-pairable statistic → PARK it as "also reported".
        const otherScope = { level: 'other', outcomeId: '', canonical: '', canonicalName: '' };
        if (ratios.length) {
          pushParked(alsoReported, parkedKeys, mkRatioDraft({ ratio: ratios[0], out: null, scope: otherScope, match: null, unit, excerpt, timepoint, baseStudy, at, idFn, confidence: 'low', ambNote: '' }), log);
        } else if (evTots.length === 2) {
          pushParked(alsoReported, parkedKeys, mkDichotomousDraft({ evTots, out: null, scope: otherScope, match: null, unit, excerpt, timepoint, baseStudy, at, idFn, multiOutcome: false }), log);
        } else if (meanSds.length === 2) {
          pushParked(alsoReported, parkedKeys, mkContinuousDraft({ meanSds, out: null, scope: otherScope, match: null, unit, excerpt, timepoint, baseStudy, at, idFn, multiOutcome: false }), log);
        }
      }
    }
  }

  log.push(`Auto-extract: ${drafts.length} draft${drafts.length === 1 ? '' : 's'} for protocol outcomes, ${alsoReported.length} parked as also-reported, ${detectedOutcomes.length} outcome candidate${detectedOutcomes.length === 1 ? '' : 's'} detected.`);
  return { drafts, alsoReported, detectedOutcomes, log };
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

function mkDichotomousDraft({ evTots, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn, multiOutcome }) {
  const [exp, ctrl] = evTots;
  const a = exp.value.events, b = exp.value.total - exp.value.events;
  const c = ctrl.value.events, d = ctrl.value.total - ctrl.value.events;
  const values = { a: String(a), b: String(b), c: String(c), d: String(d) };

  // Auto-compute the log odds ratio from the 2×2 so the draft is analysis-ready.
  // calcES returns null on an inestimable table (double-zero events) → leave es empty.
  const conversions = [];
  let esType = '';
  const es = calcES('OR', { a, b, c, d });
  if (es) {
    values.es = String(es.es); values.lo = String(es.lo); values.hi = String(es.hi);
    esType = 'OR';
    conversions.push({
      id: idFnOrDefault(idFn)(), type: 'es_from_2x2',
      method: 'log OR from 2×2 (Haldane–Anscombe correction if any zero cell)',
      reason: 'auto-extracted 2×2 counts', at,
      inputs: { a, b, c, d, measure: 'OR' },
      result: { es: es.es, se: es.se, lo: es.lo, hi: es.hi },
    });
  }

  return mkExtractionRecord({
    author: baseStudy?.author || '', year: baseStudy?.year || '',
    outcome: out ? out.name : '', timepoint, esType,
    scope,
    values,
    provenance: { method: 'auto', page: unit.page, region: null, excerpt, at },
    confidence: 'low',
    conversions,
    notes: `Auto-extracted 2×2: ${exp.value.events}/${exp.value.total} vs ${ctrl.value.events}/${ctrl.value.total}.${es ? ` Computed log OR = ${es.es.toFixed(4)} — confirm arm assignment.` : ' Confirm arm assignment, then compute the effect size.'}${multiOutcome ? ' Multiple outcomes named in one sentence — verify attribution.' : ''}`,
  }, idFn);
}

function mkContinuousDraft({ meanSds, out, scope, match, unit, excerpt, timepoint, baseStudy, at, idFn, multiOutcome }) {
  const [exp, ctrl] = meanSds;
  const values = {
    meanExp: String(exp.value.mean), sdExp: String(exp.value.sd),
    meanCtrl: String(ctrl.value.mean), sdCtrl: String(ctrl.value.sd),
  };

  // Compute a mean difference ONLY when group sizes are present. Prose mean ± SD
  // pairs carry no n, so calcES returns null and es/lo/hi stay empty (as today);
  // the builder is ready for callers (e.g. table extraction) that supply n's.
  const conversions = [];
  let esType = '';
  const n1 = numOr(exp.value.n), n2 = numOr(ctrl.value.n);
  const es = (n1 != null && n2 != null)
    ? calcES('MD', { n1, n2, sd1: exp.value.sd, sd2: ctrl.value.sd, m1: exp.value.mean, m2: ctrl.value.mean })
    : null;
  if (es) {
    values.nExp = String(n1); values.nCtrl = String(n2);
    values.es = String(es.es); values.lo = String(es.lo); values.hi = String(es.hi);
    esType = 'MD';
    conversions.push({
      id: idFnOrDefault(idFn)(), type: 'es_from_meansd',
      method: 'mean difference from group means/SDs/Ns',
      reason: 'auto-extracted mean ± SD with group sizes', at,
      inputs: { n1, n2, sd1: exp.value.sd, sd2: ctrl.value.sd, m1: exp.value.mean, m2: ctrl.value.mean, measure: 'MD' },
      result: { es: es.es, se: es.se, lo: es.lo, hi: es.hi },
    });
  }

  return mkExtractionRecord({
    author: baseStudy?.author || '', year: baseStudy?.year || '',
    outcome: out ? out.name : '', timepoint, esType,
    scope,
    values,
    provenance: { method: 'auto', page: unit.page, region: null, excerpt, at },
    confidence: 'low',
    conversions,
    notes: `Auto-extracted mean ± SD: ${exp.value.mean}±${exp.value.sd} vs ${ctrl.value.mean}±${ctrl.value.sd}.${es ? '' : ' Confirm arm assignment and enter group sizes.'}${multiOutcome ? ' Multiple outcomes named in one sentence — verify attribution.' : ''}`,
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

/**
 * matchSentenceOutcome(excerpt, sent, sStats, outcomes) — match a protocol outcome
 * to a statistic in THIS sentence with precision. Instead of matching the whole
 * sentence (which would attribute any outcome named anywhere in it), it extracts
 * clause-local noun phrases around each draftable statistic and matches THOSE. A
 * broad (sentence-start→statistic) phrase is used only as a fallback, and only when
 * the resulting outcome mention sits reasonably near a statistic.
 *
 * @returns {{ match, distinct:number, fromClause:boolean } | null}
 *   distinct — how many DISTINCT protocol outcomes are named in the sentence
 *   (>1 → attribution is ambiguous; the caller lowers confidence).
 */
function matchSentenceOutcome(excerpt, sent, sStats, outcomes) {
  if (!Array.isArray(outcomes) || !outcomes.length) return null;
  const draftable = sStats.filter((s) => DRAFTABLE_KINDS.has(s.kind));
  const anchors = draftable.length ? draftable : sStats;

  const clauseMatches = collectMatches(candidatePhrases(excerpt, sent, anchors, 'clause'), outcomes);
  const fromClause = clauseMatches.length > 0;
  const pool = fromClause ? clauseMatches : collectMatches(candidatePhrases(excerpt, sent, anchors, 'broad'), outcomes);
  if (!pool.length) return null;

  // Choose the strongest-confidence match; tie → the earliest clause (positional).
  const rank = { high: 0, medium: 1, low: 2 };
  pool.sort((x, y) => (rank[x.mo.confidence] - rank[y.mo.confidence]) || (x.start - y.start));
  const chosen = pool[0];

  // Nearness guard (broad matches only — clause-local ones are near by construction):
  // the chosen outcome mention must sit within NEAR_LIMIT chars of a statistic.
  if (!fromClause) {
    const out = outcomes.find((o) => o.id === chosen.mo.outcomeId);
    const om = outcomeMentionIndex(excerpt, out);
    let near = Infinity;
    for (const s of anchors) near = Math.min(near, Math.abs((s.index - sent.start) - om));
    if (near > NEAR_LIMIT) return null;
  }

  // Count DISTINCT protocol outcomes named anywhere in the sentence.
  let distinct = 0;
  for (const o of outcomes) if (matchOutcome(excerpt, [o])) distinct++;

  return { match: chosen.mo, distinct, fromClause };
}

/** collectMatches(phrases, outcomes) — matchOutcome each phrase → [{ mo, start }]. */
function collectMatches(phrases, outcomes) {
  const out = [];
  for (const ph of phrases) {
    if (!ph.text) continue;
    const mo = matchOutcome(ph.text, outcomes);
    if (mo) out.push({ mo, start: ph.start });
  }
  return out;
}

/**
 * candidatePhrases(excerpt, sent, anchors, mode) — for each anchor statistic, the
 * text PRECEDING it (where the outcome noun phrase lives). mode 'clause' starts at
 * the nearest clause boundary (comma / semicolon / connective) before the stat;
 * mode 'broad' starts at the sentence beginning. De-duplicated by text.
 */
function candidatePhrases(excerpt, sent, anchors, mode) {
  const seen = new Set();
  const out = [];
  for (const s of anchors) {
    const relIdx = clampRel(s.index - sent.start, excerpt.length);
    const start = mode === 'clause' ? clauseStartBefore(excerpt, relIdx) : 0;
    const text = excerpt.slice(start, relIdx).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, start });
  }
  return out;
}

const CONNECTIVE_SRC = '\\b(?:whereas|while|however|although|though|but|meanwhile|yet)\\b';

/** clauseStartBefore(text, relIdx) — index where the clause containing position
 *  relIdx begins: just after the nearest comma/semicolon, then after any connective
 *  word that follows it. ':' and '(' are NOT treated as boundaries (the outcome
 *  often precedes a colon or a parenthetical statistic). */
function clauseStartBefore(text, relIdx) {
  const pre = text.slice(0, relIdx);
  let start = 0;
  for (let i = pre.length - 1; i >= 0; i--) {
    const ch = pre[i];
    if (ch === ',' || ch === ';') { start = i + 1; break; }
  }
  const re = new RegExp(CONNECTIVE_SRC, 'gi');
  re.lastIndex = start;
  let m, connEnd = -1;
  while ((m = re.exec(pre)) !== null) {
    connEnd = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (connEnd > start) start = connEnd;
  return start;
}

/** State/change verbs that separate an outcome noun phrase from its statistic. */
const STATE_VERBS = 'was|were|is|are|rose|fell|occurred|improved|worsened|increased|decreased|reduced|declined|remained|had|showed|reached|averaged';
const LABEL_VERB_RE = new RegExp('([A-Za-z][A-Za-z0-9%/\\- ]*?)\\s+(?:' + STATE_VERBS + '|=)\\b', 'gi');
const LABEL_PREP_RE = /\b(?:of|in|for|on)\s+([A-Za-z][A-Za-z0-9%/\- ]{2,})$/i;

/** Lead-in / filler words stripped from the FRONT of a detected label. */
const LEAD_STOP = new Set([
  'in', 'on', 'at', 'for', 'of', 'the', 'a', 'an', 'and', 'to', 'with', 'by', 'among',
  'overall', 'this', 'that', 'these', 'those', 'trial', 'study', 'both', 'all', 'we',
  'there', 'patients', 'participants', 'subjects', 'group', 'groups', 'arm', 'arms',
  'mean', 'median', 'their',
]);

/**
 * outcomeLabelNear(excerpt, relIdx) — best-effort outcome noun phrase near the
 * statistic at relIdx: the phrase before a state verb / '=', else after 'of/in/for/on',
 * else the last few words of the clause. Leading filler words are stripped. Pure &
 * deterministic; returns '' when nothing usable is found.
 */
function outcomeLabelNear(excerpt, relIdx) {
  let pre = excerpt.slice(clauseStartBefore(excerpt, relIdx), relIdx);
  if (stripLeadStop(pre).length < 3) pre = excerpt.slice(0, relIdx); // fall back to wider context
  pre = pre.replace(/\s+/g, ' ').trim();
  if (!pre) return '';

  let label = '';
  LABEL_VERB_RE.lastIndex = 0;
  let m, last = null;
  while ((m = LABEL_VERB_RE.exec(pre)) !== null) {
    last = m[1];
    if (m.index === LABEL_VERB_RE.lastIndex) LABEL_VERB_RE.lastIndex++;
  }
  if (last) label = last;
  if (!label) {
    const prep = pre.match(LABEL_PREP_RE);
    if (prep) label = prep[1];
  }
  if (!label) label = pre.split(' ').filter(Boolean).slice(-6).join(' ');

  return stripLeadStop(label).replace(/\s+/g, ' ').trim();
}

function stripLeadStop(s) {
  const w = String(s).split(/\s+/).filter(Boolean);
  while (w.length && LEAD_STOP.has(w[0].toLowerCase())) w.shift();
  return w.join(' ');
}

/** pickDetectStat(sStats) — the most outcome-informative statistic in a sentence. */
function pickDetectStat(sStats) {
  for (const kind of DETECT_KINDS) {
    const f = sStats.filter((s) => s.kind === kind);
    if (f.length) return f.slice().sort((a, b) => a.index - b.index)[0];
  }
  return null;
}

/** statPreviewOf(stat) — a short readable preview of a statistic. */
function statPreviewOf(s) {
  const v = s.value || {};
  if (s.kind === 'ratioCI') return `${v.measure} ${v.est} [${v.lo}, ${v.hi}]`;
  if (s.kind === 'eventsTotal') return `${v.events}/${v.total}`;
  if (s.kind === 'meanSd') return `${v.mean}±${v.sd}`;
  if (s.kind === 'percent') return `${v.pct}%`;
  if (s.kind === 'ci') return `${v.level}% CI ${v.lo}–${v.hi}`;
  return String(s.excerpt || '').slice(0, 40);
}

function addDetected(list, keys, d) {
  const key = `${d.page == null ? '' : d.page}|${d.label}|${d.kind}|${d.statPreview}`;
  if (keys.has(key)) return;
  keys.add(key);
  list.push(d);
}

/** clampRel(x, len) — clamp a relative char offset into [0, len]. */
function clampRel(x, len) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(x, len));
}

/** numOr(v) — finite Number or null (used for optional group sizes on continuous). */
function numOr(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
