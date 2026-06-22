/**
 * reviewerSignals.js — turn a record's reviewer DECISIONS (each with an optional
 * quality rating + free-text note) into FOUR explicitly-separate concepts
 * (prompt49 item 1):
 *
 *   1. Eligibility / relevance  — NOT computed here; it stays the existing
 *      classifier's `score`. This module never touches it (so quality can never
 *      overwhelm eligibility — they are different axes).
 *   2. Methodological quality   — from reviewer ratings, normalised, averaged.
 *   3. Reviewer confidence       — from inter-reviewer agreement + note uncertainty.
 *   4. Prioritisation            — relevance with a SMALL bounded nudge from
 *      quality, for ranking/surfacing only; it can never flip an include/exclude.
 *
 * Multi-reviewer integrity: each reviewer's rating + note is kept with provenance
 * (`byReviewer`); conflicting opinions are surfaced as a `conflict` flag, never
 * silently flattened. Notes are UNTRUSTED (handled via noteSignals.js, which is
 * injection-safe and emits fixed labels only).
 *
 * Blind-mode safety: when `reveal` is false (a record still under independent
 * blind review), this returns a suppressed stub — it computes and exposes NOTHING
 * derived from other reviewers' inputs, so one reviewer's hidden rating/note can
 * never leak to another before the project rules allow it.
 *
 * Pure, deterministic, dependency-free (except the sibling noteSignals).
 */
import { extractNoteSignals } from './noteSignals.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Normalise a 1–5 quality rating to [0,1]; null for missing/invalid. */
export function normalizeRating(r) {
  if (r == null || !Number.isFinite(Number(r))) return null;
  const c = Math.max(1, Math.min(5, Number(r)));
  return (c - 1) / 4;
}

function qualityLabel(q, n) {
  const band = q >= 0.75 ? 'high' : q >= 0.45 ? 'moderate' : 'low';
  return `Reviewers rated methodological quality ${band} (n=${n})`;
}

const SUPPRESSED = Object.freeze({
  hasSignals: false, suppressed: true,
  methodologicalQuality: null, qualityN: 0,
  reviewerConfidence: null, agreement: null, conflict: false,
  decisionCounts: { include: 0, exclude: 0, maybe: 0 },
  noteFlags: {}, byReviewer: undefined, factors: [],
});

/**
 * @param {Array<{reviewerId?,decision?,rating?,notes?}>} decisions
 * @param {{reveal?:boolean}} [opts]  reveal=false → suppressed stub (blind-safe)
 */
export function aggregateReviewerSignals(decisions = [], opts = {}) {
  const reveal = opts.reveal !== false;
  if (!reveal) return SUPPRESSED;
  const list = Array.isArray(decisions) ? decisions : [];

  // 2. Methodological quality (separate axis from relevance).
  const ratingVals = list.map((d) => normalizeRating(d.rating)).filter((v) => v != null);
  const methodologicalQuality = ratingVals.length ? mean(ratingVals) : null;
  const qualityN = ratingVals.length;

  // 3. Reviewer confidence = agreement among include/exclude, dampened by maybe
  // votes and by any expressed uncertainty in notes.
  const inc = list.filter((d) => d.decision === 'include').length;
  const exc = list.filter((d) => d.decision === 'exclude').length;
  const maybe = list.filter((d) => d.decision === 'maybe').length;
  const nDecided = inc + exc;
  const noteSigs = list.map((d) => extractNoteSignals(d.notes));
  const anyUncertain = noteSigs.some((s) => s.flags.uncertainty);
  let agreement = null;
  let reviewerConfidence = null;
  if (nDecided > 0) {
    agreement = Math.max(inc, exc) / nDecided;
    reviewerConfidence = agreement;
    if (maybe > 0) reviewerConfidence *= 0.7;
    if (anyUncertain) reviewerConfidence *= 0.8;
    reviewerConfidence = clamp01(reviewerConfidence);
  }
  const conflict = inc > 0 && exc > 0;

  // Merge note flags across reviewers (count = how many reviewers flagged it);
  // keep per-reviewer provenance (never flatten disagreement).
  const noteFlags = {};
  const byReviewer = [];
  noteSigs.forEach((s, i) => {
    const d = list[i];
    byReviewer.push({ reviewerId: d.reviewerId || null, decision: d.decision || null, rating: d.rating ?? null, flags: s.flags, hasNote: s.hasContent });
    for (const k of Object.keys(s.flags)) if (s.flags[k]) noteFlags[k] = (noteFlags[k] || 0) + 1;
  });

  // Aggregated, identity-free, fixed-label factors for the explanation.
  const factors = [];
  if (methodologicalQuality != null) factors.push({ kind: 'reviewer_quality', polarity: 'quality', text: qualityLabel(methodologicalQuality, qualityN) });
  const seen = new Set();
  for (const s of noteSigs) {
    for (const f of s.factors) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      factors.push({ kind: 'reviewer_note', polarity: f.polarity, text: f.label });
    }
  }
  if (conflict) factors.push({ kind: 'reviewer_note', polarity: 'concern', text: 'Reviewers disagree on this record' });

  const hasSignals = qualityN > 0 || Object.keys(noteFlags).length > 0 || nDecided > 0;

  return {
    hasSignals,
    suppressed: false,
    methodologicalQuality,
    qualityN,
    reviewerConfidence,
    agreement,
    conflict,
    decisionCounts: { include: inc, exclude: exc, maybe },
    noteFlags,
    byReviewer,
    factors,
  };
}

/**
 * Prioritisation = relevance (PRIMARY) + a small bounded nudge from methodological
 * quality. The nudge is hard-clamped to ±maxNudge (default 0.05) so it can shift
 * ranking among near-equal records but can NEVER overwhelm eligibility or flip an
 * include/exclude prediction (whose band thresholds are far wider than 0.05).
 * Returns the relevance unchanged when there is no quality signal.
 *
 * @param {number} relevance  the existing classifier score in [0,1]
 * @param {object|null} reviewer  aggregateReviewerSignals() result
 * @param {{maxNudge?:number}} [opts]
 */
export function prioritizationScore(relevance, reviewer, opts = {}) {
  const r = Number.isFinite(relevance) ? relevance : 0;
  if (!reviewer || reviewer.methodologicalQuality == null) return clamp01(r);
  const maxNudge = opts.maxNudge != null ? opts.maxNudge : 0.05;
  let nudge = (reviewer.methodologicalQuality - 0.5) * (maxNudge * 2);
  nudge = Math.max(-maxNudge, Math.min(maxNudge, nudge));
  return clamp01(r + nudge);
}
