/**
 * extraction/armMatch.js — RoadMap/4.md §14.8. Deterministic PICO-assisted matching
 * of candidate table ARM labels (column or row headers naming study groups) to the
 * protocol's Intervention and Comparator strings. Pure, dependency-free, deterministic,
 * never throws. Returns EVIDENCE and requires confirmation when similarity is weak or
 * the arms are symmetric — an arm is NEVER assigned just because it appears first (the
 * exact behaviour §14.8 prohibits).
 *
 * The matcher normalizes both sides (lowercase, punctuation folded, common clinical
 * abbreviations expanded), scores each candidate against Intervention vs Comparator by
 * token overlap + known-role keywords (treatment/control/placebo/usual-care), and only
 * commits when the winning side is clearly stronger. Otherwise it returns
 * { confident:false } so the UI asks the reviewer to confirm.
 */

/** Role keyword sets — a candidate hitting one side's keywords leans that way. */
const INTERVENTION_HINTS = ['intervention', 'treatment', 'treated', 'experimental', 'active', 'study group', 'test'];
const COMPARATOR_HINTS = ['comparator', 'control', 'placebo', 'usual care', 'standard care', 'standard', 'sham', 'reference', 'conventional'];

/** Abbreviation / synonym expansions applied during normalization (bidirectional-ish). */
const ABBREV = [
  [/\bplacebo\b/g, 'placebo control'],
  [/\busual care\b/g, 'usual care control'],
  [/\bstandard of care\b/g, 'standard care'],
  [/\bsoc\b/g, 'standard care'],
];

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'for', 'with', 'and', 'or', 'group', 'arm', 'n', 'patients', 'participants']);

/** normalizeArm(s) — fold an arm label to a comparison string of significant tokens. */
export function normalizeArm(s) {
  if (s == null) return '';
  let str = String(s).toLowerCase();
  str = str.replace(/[‐-―−]/g, '-');
  str = str.replace(/[^a-z0-9%\-\s]/g, ' ');
  for (const [re, rep] of ABBREV) str = str.replace(re, rep);
  return str.replace(/\s+/g, ' ').trim();
}

function tokenSet(norm) {
  return new Set(norm.split(/[\s\-]+/).filter((t) => t && !STOP.has(t)));
}

/** overlapScore(a, b) — Jaccard-like token overlap in [0,1] between two normalized labels. */
function overlapScore(aNorm, bNorm) {
  const A = tokenSet(aNorm);
  const B = tokenSet(bNorm);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

/** hintScore(norm, hints) — fraction-weighted keyword presence in [0,~1]. */
function hintScore(norm, hints) {
  let score = 0;
  for (const h of hints) if (norm.includes(h)) score += 0.5;
  return score;
}

/**
 * scoreArm(candidate, pico) — how strongly a candidate label matches Intervention vs
 * Comparator. Returns { intervention, comparator } raw scores plus evidence strings.
 */
function scoreArm(candidate, pico) {
  const cn = normalizeArm(candidate);
  const iv = normalizeArm(pico && pico.intervention);
  const cp = normalizeArm(pico && pico.comparator);
  const intervention = overlapScore(cn, iv) + hintScore(cn, INTERVENTION_HINTS);
  const comparator = overlapScore(cn, cp) + hintScore(cn, COMPARATOR_HINTS);
  return { intervention, comparator, cn };
}

/**
 * matchArms(candidates, pico, opts?) — assign a list of candidate arm labels to
 * intervention / comparator roles using PICO text.
 *
 * @param {string[]} candidates  arm labels (e.g. column headers) in table order
 * @param {{intervention?:string, comparator?:string}} pico  protocol arm strings
 * @param {{minMargin?:number, minScore?:number}} [opts]
 * @returns {{
 *   confident: boolean,
 *   intervention: {index:number, label:string}|null,
 *   comparator:   {index:number, label:string}|null,
 *   evidence: string[],
 *   scores: Array<{index:number, label:string, intervention:number, comparator:number}>
 * }}
 *   confident is FALSE (→ ask the reviewer) when the best assignment is weak, tied, or
 *   symmetric — never a positional guess.
 */
export function matchArms(candidates, pico, opts = {}) {
  const minMargin = Number.isFinite(opts.minMargin) ? opts.minMargin : 0.2;
  const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 0.34;
  const list = Array.isArray(candidates) ? candidates.map((c) => (c == null ? '' : String(c))) : [];
  const evidence = [];

  if (list.length < 2 || !pico || (!pico.intervention && !pico.comparator)) {
    return { confident: false, intervention: null, comparator: null, evidence: ['insufficient PICO or arm labels — confirm manually'], scores: [] };
  }

  const scores = list.map((label, index) => {
    const s = scoreArm(label, pico);
    return { index, label, intervention: s.intervention, comparator: s.comparator };
  });

  // Best intervention candidate and best comparator candidate (distinct columns).
  const byIv = scores.slice().sort((a, b) => b.intervention - a.intervention);
  const byCp = scores.slice().sort((a, b) => b.comparator - a.comparator);
  const ivPick = byIv[0];
  let cpPick = byCp.find((s) => s.index !== ivPick.index) || null;

  const ivMargin = ivPick.intervention - (byIv[1] ? byIv[1].intervention : 0);
  const cpMargin = cpPick ? cpPick.comparator - (byCp.find((s) => s.index !== cpPick.index && s.index !== ivPick.index)?.comparator || 0) : 0;

  const strong =
    ivPick.intervention >= minScore &&
    cpPick && cpPick.comparator >= minScore &&
    ivPick.index !== cpPick.index &&
    (ivMargin >= minMargin || cpMargin >= minMargin);

  if (ivPick.intervention >= minScore) evidence.push(`"${ivPick.label}" ~ intervention (score ${ivPick.intervention.toFixed(2)})`);
  if (cpPick && cpPick.comparator >= minScore) evidence.push(`"${cpPick.label}" ~ comparator (score ${cpPick.comparator.toFixed(2)})`);
  if (!strong) evidence.push('arm match is weak or symmetric — confirm which column is intervention vs comparator');

  return {
    confident: strong,
    intervention: strong ? { index: ivPick.index, label: ivPick.label } : null,
    comparator: strong && cpPick ? { index: cpPick.index, label: cpPick.label } : null,
    evidence,
    scores,
  };
}
