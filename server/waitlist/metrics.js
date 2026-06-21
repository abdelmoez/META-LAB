/**
 * waitlist/metrics.js — pure aggregation of Ops overview metrics from REAL
 * waitlist records (prompt48 §7). No fabricated values: every number is computed
 * from the array passed in. `now` is injectable for deterministic tests.
 *
 * Empty input yields a well-formed, all-zero result (no charts invented) so the
 * Ops UI can render a clean empty state.
 */

import {
  WAITLIST_STATUSES,
  applicantRoleLabel,
} from '../../src/shared/betaWaitlist.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function toTime(v) {
  if (v == null) return NaN;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? NaN : t;
}

function parseInterests(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  return [];
}

function topN(counter, n) {
  return [...counter.entries()]
    .filter(([label]) => label && String(label).trim() !== '')
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

/** YYYY-MM-DD in UTC for stable, timezone-independent trend buckets. */
function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @param {Array<object>} applicants — raw waitlist rows.
 * @param {{now?:number, trendDays?:number, topLimit?:number}} [opts]
 */
export function computeWaitlistMetrics(applicants, opts = {}) {
  const now = opts.now ?? Date.now();
  const trendDays = opts.trendDays ?? 30;
  const topLimit = opts.topLimit ?? 8;
  const list = Array.isArray(applicants) ? applicants : [];

  const byStatus = Object.fromEntries(WAITLIST_STATUSES.map((s) => [s, 0]));
  let today = 0;
  let last7 = 0;
  let last30 = 0;
  let emailSent = 0;
  let emailFailed = 0;
  let emailPending = 0;

  const roleCounter = new Map();
  const institutionCounter = new Map();
  const countryCounter = new Map();
  const interestCounter = new Map();

  // Trend buckets: last `trendDays` days, zero-filled, ascending, last = today (UTC).
  const trend = [];
  const trendIndex = new Map();
  for (let i = trendDays - 1; i >= 0; i--) {
    const key = dayKey(now - i * DAY_MS);
    trendIndex.set(key, trend.length);
    trend.push({ date: key, count: 0 });
  }
  const startOfTodayUtc = Date.parse(`${dayKey(now)}T00:00:00.000Z`);

  for (const a of list) {
    if (!a) continue;
    // Status (only count known statuses; unknown ignored rather than fabricated).
    if (Object.prototype.hasOwnProperty.call(byStatus, a.status)) byStatus[a.status] += 1;

    const t = toTime(a.createdAt);
    if (!Number.isNaN(t)) {
      if (t >= startOfTodayUtc) today += 1;
      if (now - t < 7 * DAY_MS) last7 += 1;
      if (now - t < 30 * DAY_MS) last30 += 1;
      const key = dayKey(t);
      if (trendIndex.has(key)) trend[trendIndex.get(key)].count += 1;
    }

    switch (a.confirmationEmailStatus) {
      case 'sent': emailSent += 1; break;
      case 'failed': emailFailed += 1; break;
      case 'pending':
      case 'queued': emailPending += 1; break;
      default: break;
    }

    const role = applicantRoleLabel(a);
    if (role) roleCounter.set(role, (roleCounter.get(role) || 0) + 1);

    const inst = (a.institutionName || '').trim();
    if (inst) institutionCounter.set(inst, (institutionCounter.get(inst) || 0) + 1);

    const country = (a.countryName || a.countryCode || '').trim();
    if (country) countryCounter.set(country, (countryCounter.get(country) || 0) + 1);

    for (const interest of parseInterests(a.areasOfInterest)) {
      if (interest) interestCounter.set(interest, (interestCounter.get(interest) || 0) + 1);
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    total: list.length,
    today,
    last7Days: last7,
    last30Days: last30,
    byStatus,
    email: { sent: emailSent, failed: emailFailed, pending: emailPending },
    topRoles: topN(roleCounter, topLimit),
    topInstitutions: topN(institutionCounter, topLimit),
    topCountries: topN(countryCounter, topLimit),
    topInterests: topN(interestCounter, topLimit),
    trend, // [{ date:'YYYY-MM-DD', count }] ascending, zero-filled
    trendDays,
  };
}
