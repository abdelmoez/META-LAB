/**
 * duplicateJobProgress.js — honest progress for a duplicate-detection job (92.md).
 * Pure functions, no database, no side effects. Mirrors search/runProgress.js:
 * the percentage is derived ONLY from real persisted job state (stage + counters),
 * never from a timer, and never reaches 100 until the job is terminally completed.
 */

/** Terminal job statuses. */
export const DUP_JOB_TERMINAL = Object.freeze(new Set(['completed', 'failed', 'cancelled']));

/** Ordered stages with their [start, end] slice of the overall percentage. */
export const DUP_JOB_STAGE_SPANS = Object.freeze([
  { stage: 'queued', from: 0, to: 2 },
  { stage: 'preparing', from: 2, to: 6 },
  { stage: 'normalizing', from: 6, to: 18 },
  { stage: 'exact', from: 18, to: 26 },
  { stage: 'fuzzy', from: 26, to: 78 },
  { stage: 'grouping', from: 78, to: 82 },
  { stage: 'saving', from: 82, to: 96 },
  { stage: 'finalizing', from: 96, to: 99 },
]);

export const DUP_JOB_STAGE_LABELS = Object.freeze({
  queued: 'Waiting in queue',
  preparing: 'Preparing records',
  normalizing: 'Normalizing identifiers and titles',
  exact: 'Matching exact identifiers (DOI / PMID)',
  fuzzy: 'Evaluating probable duplicate candidates',
  grouping: 'Creating duplicate groups',
  saving: 'Saving results',
  finalizing: 'Final validation',
  done: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
});

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const frac = (done, total) => (Number(total) > 0 ? clamp01(Number(done) / Number(total)) : null);

/** Within-stage completion fraction from the job's real counters (null → unknown). */
function stageFraction(job) {
  switch (job.stage) {
    case 'normalizing': return frac(job.processedRecords, job.totalRecords);
    case 'fuzzy': {
      const f = frac(job.comparisonsDone, job.comparisonsTotal);
      // No planned comparisons means there was nothing to fuzzy-match — stage done.
      return f == null ? (Number(job.comparisonsTotal) === 0 ? 1 : null) : f;
    }
    case 'saving': {
      const f = frac(job.savedGroups, job.groupsFound);
      return f == null ? (Number(job.groupsFound) === 0 ? 1 : null) : f;
    }
    default: return null;
  }
}

/**
 * computeDuplicateJobProgress — derive the full display state from a job row.
 *
 * @param {object} job — (public) ScreenDuplicateJob row
 * @param {number} [nowMs] — clock for elapsed/ETA (injectable for tests)
 * @returns {{
 *   state: 'queued'|'retrying'|'running'|'cancelling'|'completed'|'failed'|'cancelled',
 *   percent: number,           // 0–100 int; 100 ONLY when completed
 *   stageLabel: string,
 *   elapsedMs: number|null,    // since startedAt (createdAt while queued); frozen at completedAt
 *   etaMs: number|null,        // linear extrapolation; null until it is meaningful
 *   terminal: boolean,
 * }}
 */
export function computeDuplicateJobProgress(job, nowMs = Date.now()) {
  if (!job) return { state: 'queued', percent: 0, stageLabel: '', elapsedMs: null, etaMs: null, terminal: false };

  const status = job.status || 'queued';
  const terminal = DUP_JOB_TERMINAL.has(status);
  let state;
  if (status === 'completed') state = 'completed';
  else if (status === 'failed') state = 'failed';
  else if (status === 'cancelled') state = 'cancelled';
  else if (status === 'processing') state = job.cancelRequested ? 'cancelling' : 'running';
  else state = Number(job.attempts) > 0 ? 'retrying' : 'queued'; // queued again after an interrupted attempt

  // Percent from the stage span + within-stage fraction.
  let percent = 0;
  const span = DUP_JOB_STAGE_SPANS.find((s) => s.stage === job.stage);
  if (status === 'completed') percent = 100;
  else if (span) {
    const f = stageFraction(job);
    percent = Math.round(span.from + (span.to - span.from) * (f == null ? 0 : f));
  } else if (job.stage === 'done') percent = 99; // defensive: non-completed status with done stage
  if (!terminal && percent > 99) percent = 99;
  if (percent < 0) percent = 0;

  // Elapsed: prefer the actual processing window.
  const startRef = job.startedAt || job.createdAt;
  const endRef = terminal ? (job.completedAt || null) : null;
  let elapsedMs = null;
  if (startRef) {
    const t0 = new Date(startRef).getTime();
    const t1 = endRef ? new Date(endRef).getTime() : nowMs;
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) elapsedMs = t1 - t0;
  }

  // ETA: only while genuinely running, only once there is signal to extrapolate from.
  let etaMs = null;
  if (state === 'running' && elapsedMs != null && elapsedMs >= 3000 && percent >= 8 && percent < 100) {
    etaMs = Math.round(elapsedMs * (100 - percent) / percent);
  }

  const stageLabel = DUP_JOB_STAGE_LABELS[job.stage] || DUP_JOB_STAGE_LABELS[status] || '';
  return { state, percent, stageLabel, elapsedMs, etaMs, terminal };
}

/** Compact mm:ss / h:mm:ss formatter for elapsed/ETA display. */
export function formatDurationMs(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
