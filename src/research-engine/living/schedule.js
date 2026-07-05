/**
 * schedule.js
 * Cadence arithmetic for living / auto-updating reviews.
 *
 * Pure and deterministic: every function takes the "current time" as an explicit
 * ISO string argument — nothing here reads Date.now(), so the same inputs always
 * produce the same output (required for reproducible scheduling and for tests).
 *
 * A living search re-runs on a cadence. Given the moment a run finishes (or the
 * moment scheduling starts), computeNextRunAt returns the next wall-clock instant
 * (UTC) at which the search is due, pinned to a fixed hour of day (default 03:00
 * UTC — an off-peak window). 'manual' cadence never auto-runs and returns null.
 */

/** Supported cadences. 'manual' means "never auto-run". */
export const CADENCES = ['manual', 'daily', 'weekly', 'monthly'];

const DEFAULT_HOUR_UTC = 3;

/** Human-readable label per cadence (used by UI + audit text). */
const CADENCE_LABELS = {
  manual:  'Manual (no automatic updates)',
  daily:   'Daily',
  weekly:  'Weekly',
  monthly: 'Monthly',
};

/**
 * describeCadence(cadence)
 * @param {string} cadence
 * @returns {string} Human label; falls back to the raw value for unknowns.
 */
export function describeCadence(cadence) {
  return CADENCE_LABELS[cadence] || 'Unknown cadence';
}

/** UTC hour, accepted only when a valid 0-23 integer; anything else → the default. */
function normalizeHour(hourUtc) {
  // null/undefined → default. (Number(null) is 0, NOT NaN, so an explicit null must
  // be caught here or a legacy search with a null hour would shift from 03:00 to
  // 00:00 UTC — this must stay byte-identical to the pre-day/hour behaviour.)
  if (hourUtc == null) return DEFAULT_HOUR_UTC;
  const h = Math.trunc(Number(hourUtc));
  if (!Number.isFinite(h) || h < 0 || h > 23) return DEFAULT_HOUR_UTC;
  return h;
}

/**
 * UTC day-of-week (0=Sunday … 6=Saturday) for a weekly cadence, or null when not
 * supplied / invalid. null means "legacy behaviour": +7 calendar days from
 * fromIso (byte-identical to the pre-day-selection engine).
 */
function normalizeDayOfWeek(dayOfWeek) {
  if (dayOfWeek == null || dayOfWeek === '') return null;
  const d = Math.trunc(Number(dayOfWeek));
  if (!Number.isFinite(d) || d < 0 || d > 6) return null;
  return d;
}

/** Days in a given UTC month (monthIndex 0-11), accounting for leap years. */
function daysInMonth(year, monthIndex) {
  // Day 0 of the *next* month is the last day of this month.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * computeNextRunAt(cadence, fromIso, opts)
 * The next instant at which a search on this cadence becomes due, expressed as a
 * UTC ISO string, or null for 'manual'.
 *
 *   daily   → the next calendar day at hourUtc
 *   weekly  → the next occurrence of opts.dayOfWeek at hourUtc (1-7 days ahead);
 *             when opts.dayOfWeek is null/invalid, 7 calendar days later (legacy)
 *   monthly → the same day-of-month one month later at hourUtc, clamped down to the
 *             target month's length (e.g. Jan 31 → Feb 28, or Feb 29 in a leap year)
 *
 * The time-of-day is always pinned to hourUtc:00:00.000, regardless of the
 * time-of-day carried by fromIso. "Next day / +7 days / +1 month" is measured from
 * fromIso's calendar date in UTC.
 *
 * @param {string} cadence  one of CADENCES
 * @param {string} fromIso  ISO timestamp to schedule from (usually "now" or a completion time)
 * @param {object} [opts]
 * @param {number} [opts.hourUtc=3]  UTC hour-of-day to pin the run to (0-23)
 * @param {number} [opts.dayOfWeek]  weekly only: UTC weekday 0-6 (0=Sunday) to anchor
 *                                    the run to. null/omitted/invalid ⇒ legacy +7 days.
 * @returns {string|null} ISO string of the next run, or null for 'manual' / invalid input
 */
export function computeNextRunAt(cadence, fromIso, opts = {}) {
  if (cadence === 'manual') return null;
  if (!CADENCES.includes(cadence)) return null;

  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;

  const hour = normalizeHour(opts.hourUtc);
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const d = from.getUTCDate();

  let next;
  if (cadence === 'daily') {
    next = new Date(Date.UTC(y, m, d + 1, hour, 0, 0, 0));
  } else if (cadence === 'weekly') {
    const dow = normalizeDayOfWeek(opts.dayOfWeek);
    if (dow == null) {
      // Legacy: exactly +7 calendar days (byte-identical to pre-day-selection).
      next = new Date(Date.UTC(y, m, d + 7, hour, 0, 0, 0));
    } else {
      // Anchor to the chosen weekday: 1-7 days ahead. When fromIso already falls on
      // that weekday we advance a full week (never 0) so a run never re-fires today.
      const daysAhead = ((dow - from.getUTCDay() + 7) % 7) || 7;
      next = new Date(Date.UTC(y, m, d + daysAhead, hour, 0, 0, 0));
    }
  } else {
    // monthly: same day-of-month next month, clamped to that month's length.
    const targetMonth = m + 1;                       // Date normalizes overflow into the year
    const targetYear = y + Math.floor(targetMonth / 12);
    const monthInYear = ((targetMonth % 12) + 12) % 12;
    const clampedDay = Math.min(d, daysInMonth(targetYear, monthInYear));
    next = new Date(Date.UTC(targetYear, monthInYear, clampedDay, hour, 0, 0, 0));
  }

  return next.toISOString();
}

/**
 * nextRunAfterSuccess(cadence, completedAtIso, opts)
 * Convenience wrapper: the next run scheduled off the moment a run *completed*.
 * Identical semantics to computeNextRunAt — separate name so callers reading the
 * server code can see intent (reschedule after a successful update).
 *
 * @param {string} cadence
 * @param {string} completedAtIso
 * @param {object} [opts]
 * @returns {string|null}
 */
export function nextRunAfterSuccess(cadence, completedAtIso, opts = {}) {
  return computeNextRunAt(cadence, completedAtIso, opts);
}

/**
 * isDue(search, nowIso)
 * Whether a living search should run now.
 *
 * A search is due iff it is enabled, on an automatic cadence, has a scheduled
 * nextRunAt, and that instant is at or before now. Exactly-equal counts as due.
 *
 * @param {object} search  { enabled:boolean, cadence:string, nextRunAt:string|null }
 * @param {string} nowIso  current instant (ISO)
 * @returns {boolean}
 */
export function isDue(search, nowIso) {
  if (!search || search.enabled !== true) return false;
  if (!search.cadence || search.cadence === 'manual') return false;
  if (!CADENCES.includes(search.cadence)) return false;
  if (!search.nextRunAt) return false;

  const due = new Date(search.nextRunAt).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(due) || Number.isNaN(now)) return false;

  return due <= now;
}
