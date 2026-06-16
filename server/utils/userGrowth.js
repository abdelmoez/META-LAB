/**
 * userGrowth.js — pure, dependency-free time-window + grouping helpers for the
 * new-user registration analytics in the Ops console (prompt27).
 *
 * Extracted from adminController so the bucketing/window math is unit-testable
 * without a DB — same pattern as countryStats.js. NO database access here:
 * callers pass an array of plain user records. Each helper accepts items shaped
 * as { createdAt } (extra profile fields are ignored by the date helpers).
 *
 * TIMEZONE: every window/bucket uses SERVER-LOCAL calendar time, consistent with
 * adminController.startOf() and getMetricsTimeseries' localDayKey(). The week
 * starts on SUNDAY — the same convention the existing weekly metrics already use
 * (startOf('week') walks back to getDay()===0). Callers should surface this to
 * the operator (the endpoint returns timezone:'server-local', weekStart:'sunday').
 *
 * Definitions (mirror the prompt's data definitions):
 *   today   → [start-of-local-day, now]
 *   week    → [most-recent-Sunday 00:00, now]
 *   month   → [first-of-month 00:00, now]
 *   quarter → [first day of the calendar quarter 00:00, now]
 *   year    → [Jan 1 00:00, now]
 *   all     → no lower bound (every account)
 */

export const WINDOW_UNITS = ['today', 'week', 'month', 'quarter', 'year', 'all'];

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Local-time YYYY-MM-DD key (NOT toISOString — that buckets by UTC). */
export function localDayKey(value) {
  const d = new Date(value);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local-time YYYY-MM key. */
export function localMonthKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Start boundary (Date) of a calendar window relative to `now`.
 * Returns null for 'all' (no lower bound) and for any unknown unit.
 */
export function startOfWindow(unit, now = new Date()) {
  const d = new Date(now);
  switch (unit) {
    case 'today':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    case 'week': {
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      s.setDate(s.getDate() - s.getDay()); // walk back to Sunday (getDay()===0)
      return s;
    }
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3); // 0..3
      return new Date(d.getFullYear(), q * 3, 1);
    }
    case 'year':
      return new Date(d.getFullYear(), 0, 1);
    case 'all':
    default:
      return null;
  }
}

/**
 * The immediately-preceding FULL calendar window { start, end } (end-exclusive),
 * for period-over-period comparison. e.g. for 'month' on Jun 16 → all of May.
 * Returns null for 'all' / unknown units (no previous period).
 */
export function previousWindowRange(unit, now = new Date()) {
  const curStart = startOfWindow(unit, now);
  if (!curStart) return null;
  const d = curStart;
  switch (unit) {
    case 'today':
      return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1), end: d };
    case 'week':
      return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7), end: d };
    case 'month':
      return { start: new Date(d.getFullYear(), d.getMonth() - 1, 1), end: d };
    case 'quarter':
      return { start: new Date(d.getFullYear(), d.getMonth() - 3, 1), end: d };
    case 'year':
      return { start: new Date(d.getFullYear() - 1, 0, 1), end: d };
    default:
      return null;
  }
}

function tsOf(item) {
  return new Date(item && item.createdAt != null ? item.createdAt : item).getTime();
}

/** True when item.createdAt ∈ [start, end). null bound ⇒ unbounded on that side. */
function inRange(item, start, end) {
  const ms = tsOf(item);
  if (Number.isNaN(ms)) return false;
  if (start && ms < start.getTime()) return false;
  if (end && ms >= end.getTime()) return false;
  return true;
}

export function countInRange(items, start, end) {
  let n = 0;
  for (const it of items) if (inRange(it, start, end)) n += 1;
  return n;
}

export function filterInRange(items, start, end) {
  return items.filter(it => inRange(it, start, end));
}

/** Signed % change cur-vs-prev, 1 dp. null when prev is 0/absent (undefined denominator). */
export function pctChange(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/**
 * Headline registration counts for each named window plus an all-time total.
 * Each window carries { count, prev, deltaPct } where prev is the immediately
 * preceding FULL calendar period and deltaPct is the signed % change (null when
 * the previous period had none). `total` carries only { count }.
 *
 * NOTE: count = this-period-TO-DATE (start..now); prev = the previous FULL
 * period. This is the conventional dashboard comparison; it is intentionally
 * "to-date vs full" and documented as such in the endpoint payload.
 */
export function windowSummary(items, now = new Date()) {
  const out = {};
  for (const unit of ['today', 'week', 'month', 'quarter', 'year']) {
    const count = countInRange(items, startOfWindow(unit, now), null);
    const prevR = previousWindowRange(unit, now);
    const prev = prevR ? countInRange(items, prevR.start, prevR.end) : 0;
    out[unit] = { count, prev, deltaPct: pctChange(count, prev) };
  }
  out.total = { count: items.length };
  return out;
}

/**
 * Registrations grouped by calendar year, ascending, with year gaps zero-filled
 * (so year-over-year growth stays continuous). Each entry:
 *   { year, count, growthPct }  — growthPct null for the first year / 0-denominator.
 */
export function groupByYear(items) {
  const counts = new Map();
  for (const it of items) {
    const y = new Date(tsOf(it)).getFullYear();
    if (!Number.isFinite(y)) continue;
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  if (counts.size === 0) return [];
  const years = [...counts.keys()];
  const min = Math.min(...years);
  const max = Math.max(...years);
  const out = [];
  let prev = null;
  for (let year = min; year <= max; year += 1) {
    const count = counts.get(year) || 0;
    out.push({ year, count, growthPct: prev == null ? null : pctChange(count, prev) });
    prev = count;
  }
  return out;
}

/** 12 zero-filled month buckets for a single year: [{ month:1..12, label, count }]. */
export function groupByMonth(items, year) {
  const buckets = MONTH_LABELS.map((label, i) => ({ month: i + 1, label, count: 0 }));
  for (const it of items) {
    const d = new Date(tsOf(it));
    if (d.getFullYear() !== year) continue;
    buckets[d.getMonth()].count += 1;
  }
  return buckets;
}

/**
 * Quarter buckets for the given years (4 per year, zero-filled), ascending:
 *   [{ year, quarter:1..4, label:'2026 Q1', count }]
 */
export function groupByQuarter(items, years) {
  const wanted = new Set(years);
  const map = new Map(); // "year-q" -> count
  for (const it of items) {
    const d = new Date(tsOf(it));
    const y = d.getFullYear();
    if (!wanted.has(y)) continue;
    const q = Math.floor(d.getMonth() / 3) + 1;
    const k = `${y}-${q}`;
    map.set(k, (map.get(k) || 0) + 1);
  }
  const out = [];
  for (const y of [...wanted].sort((a, b) => a - b)) {
    for (let q = 1; q <= 4; q += 1) {
      out.push({ year: y, quarter: q, label: `${y} Q${q}`, count: map.get(`${y}-${q}`) || 0 });
    }
  }
  return out;
}

/**
 * Zero-filled daily buckets for the last `days` days, ascending, last = today
 * (server local): [{ date:'YYYY-MM-DD', count }].
 */
export function groupByDay(items, days, now = new Date()) {
  const n = Math.max(1, Math.floor(days) || 0);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const order = [];
  const buckets = new Map();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - i);
    const key = localDayKey(d);
    order.push(key);
    buckets.set(key, { date: key, count: 0 });
  }
  for (const it of items) {
    const b = buckets.get(localDayKey(tsOf(it)));
    if (b) b.count += 1;
  }
  return order.map(k => buckets.get(k));
}

/**
 * Zero-filled trailing-month buckets, ascending, last = current month:
 *   [{ key:'YYYY-MM', label:'Jun 26', year, month:1..12, count }]
 */
export function groupByTrailingMonths(items, count, now = new Date()) {
  const n = Math.max(1, Math.floor(count) || 0);
  const order = [];
  const buckets = new Map();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = localMonthKey(d);
    order.push(key);
    buckets.set(key, {
      key,
      label: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      count: 0,
    });
  }
  for (const it of items) {
    const b = buckets.get(localMonthKey(tsOf(it)));
    if (b) b.count += 1;
  }
  return order.map(k => buckets.get(k));
}

/**
 * Tally non-empty trimmed string values → [{ label, count }] desc by count then
 * label. Shared by the analytics breakdowns. (Identical contract to the helper
 * adminController previously inlined.)
 */
export function tally(values) {
  const counts = new Map();
  for (const raw of values) {
    const label = String(raw == null ? '' : raw).trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Top single { label, count } from a tally, or null when nothing qualifies. */
export function topOf(values) {
  return tally(values)[0] || null;
}
