/**
 * screeningProgress.js — 110.md §1. The whole-project screening progress model.
 *
 * WHY: "Screening completion across all reviewers" used to be
 * `records screened at least once / records`, so ONE reviewer working through the
 * whole library read as 100% even though the project requires N independent
 * reviewers per record and every conflict was still open. That is the single
 * number a project leader trusts, and it was wrong in the optimistic direction.
 *
 * The model here is decision-denominated instead of record-denominated:
 *
 *   required decisions  = screenable records x effective required reviewers
 *   completed decisions = SUM over records of min(distinct human reviewers, required)
 *
 * plus conflict resolution as its own unit of work, so the project can never read
 * 100% while a disagreement is still open. `requiredReviewers` is always supplied
 * by the caller (server: max(project.requiredScreeningReviewers, global quorum)) —
 * nothing here hard-codes 2.
 *
 * PURE: no I/O, no Date, no randomness. The server hands it grouped counts; the
 * UI renders the returned model. Inputs are the compact shape a GROUP BY produces
 * (a histogram of per-record reviewer counts), never a list of decisions.
 */

/** Coerce to a finite, non-negative integer. */
function nn(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11 → "11th". */
export function ordinal(k) {
  const n = nn(k);
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Percentage that never LIES at the boundaries: it only reads 100 when the work
 * really is finished, and only reads 0 when nothing at all is done. Plain
 * Math.round would show "100%" for 1999/2000 decisions, which is exactly the
 * class of bug this module exists to remove.
 */
export function honestPct(done, total, { complete = null } = {}) {
  const d = Number(done) || 0;
  const t = Number(total) || 0;
  const finished = complete == null ? (t > 0 && d >= t) : !!complete;
  if (finished) return 100;
  if (t <= 0) return 0;
  const raw = (d / t) * 100;
  let pct = Math.round(raw);
  if (pct >= 100) pct = 99;
  if (pct <= 0 && d > 0) pct = 1;
  if (pct < 0) pct = 0;
  return pct;
}

/**
 * Normalise the caller's reviewer histogram into a plain array of
 * [reviewerCount, recordCount] pairs with reviewerCount >= 1.
 * Accepts `{ 1: 40, 2: 10 }`, a Map, or an array indexed by reviewer count.
 */
function histogramEntries(hist) {
  if (!hist) return [];
  const out = [];
  const push = (k, v) => {
    const key = nn(k);
    const val = nn(v);
    if (key >= 1 && val > 0) out.push([key, val]);
  };
  if (hist instanceof Map) { for (const [k, v] of hist) push(k, v); }
  else if (Array.isArray(hist)) { hist.forEach((v, i) => push(i, v)); }
  else if (typeof hist === 'object') { for (const k of Object.keys(hist)) push(k, hist[k]); }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

export const STAGE_KIND = {
  REVIEWER_PASS: 'reviewer_pass',
  CONFLICT_RESOLUTION: 'conflict_resolution',
  COMPLETE: 'complete',
};

/**
 * @param {object} input
 * @param {number} input.requiredReviewers  effective required reviewers per record (>= 1)
 * @param {number} input.poolSize           screenable records (duplicates already excluded)
 * @param {object|Map|Array} input.reviewerHistogram
 *        recordCount keyed by DISTINCT non-engine human reviewer count. Records with
 *        zero reviewers may be omitted — they are inferred from `poolSize`. A record
 *        whose title/abstract stage is already closed (promoted / finalised) should be
 *        reported by the caller at the required count: the workflow moved past T/A for
 *        it, so demanding further T/A decisions would deadlock the model at 99%.
 * @param {number} [input.unresolvedConflicts]
 * @param {number} [input.resolvedConflicts]
 * @returns {object} the progress model (see the fields assembled below)
 */
export function computeScreeningProgress(input = {}) {
  const requiredReviewers = Math.max(1, nn(input.requiredReviewers) || 1);
  const poolSize = nn(input.poolSize);
  const unresolvedConflicts = nn(input.unresolvedConflicts);
  const resolvedConflicts = nn(input.resolvedConflicts);
  const totalConflicts = unresolvedConflicts + resolvedConflicts;

  const entries = histogramEntries(input.reviewerHistogram);

  // Records having AT LEAST k distinct reviewers, for k = 1..requiredReviewers.
  // A record with MORE reviewers than required still only satisfies each pass once
  // and contributes at most `requiredReviewers` completed decisions — surplus
  // reviewers are real work but they are not work the project still owes.
  const atLeast = new Array(requiredReviewers + 1).fill(0);
  let recordsWithAnyReviewer = 0;
  let completedDecisions = 0;
  let surplusDecisions = 0;
  for (const [count, records] of entries) {
    recordsWithAnyReviewer += records;
    const capped = Math.min(count, requiredReviewers);
    completedDecisions += capped * records;
    surplusDecisions += Math.max(0, count - requiredReviewers) * records;
    for (let k = 1; k <= capped; k++) atLeast[k] += records;
  }

  // A histogram that claims more records than the pool is a caller bug; clamp so
  // the model degrades to "everything covered" rather than emitting >100%.
  const covered = Math.min(recordsWithAnyReviewer, poolSize);
  const recordsNotStarted = Math.max(0, poolSize - covered);
  const recordsFullyReviewed = Math.min(atLeast[requiredReviewers] || 0, poolSize);
  const recordsAwaitingReviewer = Math.max(0, covered - recordsFullyReviewed);

  const requiredDecisions = poolSize * requiredReviewers;
  const cappedCompleted = Math.min(completedDecisions, requiredDecisions);
  const decisionsRemaining = Math.max(0, requiredDecisions - cappedCompleted);
  const decisionCompletion = honestPct(cappedCompleted, requiredDecisions);

  // Conflict resolution is its own unit of work, so a project with every decision
  // in but an open disagreement reads 99%, not "done". Only UNRESOLVED conflicts
  // enter the denominator: syncConflicts also auto-resolves rows on unanimous
  // agreement and keeps them as history, and counting those on both sides of the
  // ratio would quietly inflate the headline. The denominator therefore GROWS as
  // disagreements surface — honest (newly discovered work), and the decision
  // figures stay available separately for a stable reviewer-pass read.
  const totalUnits = requiredDecisions + unresolvedConflicts;
  const completedUnits = cappedCompleted;
  const complete = poolSize > 0 && decisionsRemaining === 0 && unresolvedConflicts === 0;
  const completion = honestPct(completedUnits, totalUnits, { complete: poolSize > 0 ? complete : false });

  // ── Stage strip: pass 1 … pass N → conflict resolution → complete ──────────
  const stages = [];
  for (let k = 1; k <= requiredReviewers; k++) {
    const done = Math.min(atLeast[k] || 0, poolSize);
    stages.push({
      key: `pass-${k}`,
      kind: STAGE_KIND.REVIEWER_PASS,
      index: k,
      label: `Pass ${k}`,
      fullLabel: `${ordinal(k)} reviewer pass`,
      done,
      total: poolSize,
      pct: honestPct(done, poolSize),
      satisfied: poolSize > 0 && done >= poolSize,
    });
  }
  stages.push({
    key: 'conflicts',
    kind: STAGE_KIND.CONFLICT_RESOLUTION,
    index: requiredReviewers + 1,
    label: 'Conflicts',
    fullLabel: 'Conflict resolution',
    done: resolvedConflicts,
    total: totalConflicts,
    pct: honestPct(resolvedConflicts, totalConflicts, { complete: unresolvedConflicts === 0 }),
    satisfied: unresolvedConflicts === 0,
  });
  stages.push({
    key: 'complete',
    kind: STAGE_KIND.COMPLETE,
    index: requiredReviewers + 2,
    label: 'Complete',
    fullLabel: 'Screening complete',
    done: complete ? 1 : 0,
    total: 1,
    pct: complete ? 100 : 0,
    satisfied: complete,
  });

  // Status is assigned LEFT TO RIGHT so the strip always reads as a pipeline: a
  // later stage that happens to be satisfied (no conflicts yet) is not painted
  // "complete" while an earlier stage is still running.
  let currentStageIndex = stages.findIndex(s => !s.satisfied);
  if (currentStageIndex === -1) currentStageIndex = stages.length - 1;
  stages.forEach((s, i) => {
    s.status = i < currentStageIndex ? 'complete' : (i === currentStageIndex ? (complete ? 'complete' : 'active') : 'pending');
  });

  const summaryParts = buildSummaryParts({
    poolSize, complete, recordsNotStarted, recordsAwaitingReviewer,
    unresolvedConflicts, requiredReviewers,
  });
  const summary = formatSummaryParts(summaryParts);

  return {
    requiredReviewers,
    poolSize,
    requiredDecisions,
    completedDecisions: cappedCompleted,
    decisionsRemaining,
    surplusDecisions,
    decisionCompletion,
    recordsNotStarted,
    recordsAwaitingReviewer,
    recordsFullyReviewed,
    unresolvedConflicts,
    resolvedConflicts,
    totalConflicts,
    totalUnits,
    completedUnits,
    completion,
    complete,
    stages,
    currentStageIndex,
    currentStageLabel: stages[currentStageIndex]?.fullLabel || '',
    summaryParts,
    summary,
  };
}

/**
 * One short sentence naming what is actually left — never a wall of text.
 *
 * 110 review (F4) — returned as STRUCTURED parts, not a finished string. This
 * module is imported by the Express controller as well as the UI, so it must not
 * decide number formatting: `toLocaleString()` on the server picks up the SERVER's
 * locale (and would bake grouping separators into an API payload). Emitting
 * `{count, text}` lets `ScreeningProgressStrip` run every figure through the same
 * `fmt` it already applies to the headline and the stage counters, instead of the
 * card showing "1,000 of 2,000 reviewer decisions" directly above
 * "1000 awaiting another reviewer".
 *
 * @returns {Array<{count: number|null, text: string}>} `count: null` = a complete
 *   sentence that carries its own punctuation; otherwise a "<count> <text>" clause.
 */
function buildSummaryParts({ poolSize, complete, recordsNotStarted, recordsAwaitingReviewer, unresolvedConflicts, requiredReviewers }) {
  if (poolSize === 0) return [{ count: null, text: 'No records to screen yet.' }];
  if (complete) {
    return [{
      count: null,
      text: requiredReviewers === 1
        ? 'Every record has been screened and no conflicts remain.'
        // requiredReviewers is clamped to 2-10, so it never needs grouping.
        : `Every record has ${requiredReviewers} reviewer decisions and no conflicts remain.`,
    }];
  }
  const parts = [];
  if (recordsNotStarted > 0) parts.push({ count: recordsNotStarted, text: 'not screened yet' });
  if (recordsAwaitingReviewer > 0) parts.push({ count: recordsAwaitingReviewer, text: 'awaiting another reviewer' });
  if (unresolvedConflicts > 0) parts.push({ count: unresolvedConflicts, text: `conflict${unresolvedConflicts === 1 ? '' : 's'} to resolve` });
  if (parts.length === 0) return [{ count: null, text: 'Screening is finishing up.' }];
  return parts;
}

/**
 * Join summary parts into the one sentence the card shows. The ONLY place the
 * separator and the terminal full stop live, so the raw `summary` string and the
 * strip's locale-formatted render can never drift apart.
 *
 * @param {Array<{count: number|null, text: string}>} parts
 * @param {(n: number) => string} [fmt] number formatter (the UI passes
 *   `v => v.toLocaleString()`; the default keeps `summary` locale-independent).
 */
export function formatSummaryParts(parts, fmt = String) {
  if (!Array.isArray(parts) || parts.length === 0) return '';
  const clauses = parts.map(p => (
    p && typeof p.count === 'number' ? `${fmt(p.count)} ${p.text}` : String((p && p.text) || '')
  ));
  const sentenceOnly = parts.length === 1 && !(parts[0] && typeof parts[0].count === 'number');
  return sentenceOnly ? clauses[0] : `${clauses.join(' · ')}.`;
}
