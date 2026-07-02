/**
 * livingApi.js — authenticated client for the Living Review backend (66.md P6,
 * server/routes/livingReview.js mounted at /api/living). Every call carries the
 * session cookie (credentials:'include'); HTTP/network failures THROW with the
 * server's { error, code } surfaced so the dashboard can show an honest state.
 *
 * The backend gates every route on the `livingReview` flag (404 when off) + per
 * project access, so a 404 here means "feature off or no access", not "broken".
 */
const BASE = '/api/living';

async function http(url, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    let payload = null;
    try { payload = await r.json(); } catch { /* non-JSON error body */ }
    const err = new Error((payload && (payload.error || payload.code)) || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = payload && payload.code;
    throw err;
  }
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const pid = (v) => encodeURIComponent(v);
const sid = (v) => encodeURIComponent(v);

export const livingApi = {
  // → { searches, snapshots, alerts, queue, settings, pecanSearchEnabled, canManage }
  overview(projectId) {
    return http(`${BASE}/${pid(projectId)}/overview`);
  },
  // → { summary } — live (unsaved) snapshot summary for the PRISMA panel
  preview(projectId) {
    return http(`${BASE}/${pid(projectId)}/preview`);
  },
  // → { records, runs, totalPending }
  queue(projectId, { limit } = {}) {
    const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return http(`${BASE}/${pid(projectId)}/queue${qs}`);
  },

  // ── Saved searches ────────────────────────────────────────────────────────
  // body: { name, providerIds, canonicalQuery, canonicalText, cadence, notes } → { ok, search }
  createSearch(projectId, body) {
    return http(`${BASE}/${pid(projectId)}/searches`, { method: 'POST', body });
  },
  // body: { name?, enabled?, cadence?, notes?, providerIds?, canonicalQuery?, canonicalText? } → { ok, search }
  updateSearch(projectId, searchId, body) {
    return http(`${BASE}/${pid(projectId)}/searches/${sid(searchId)}`, { method: 'PUT', body });
  },
  deleteSearch(projectId, searchId) {
    return http(`${BASE}/${pid(projectId)}/searches/${sid(searchId)}`, { method: 'DELETE' });
  },
  // → 202 { ok, runId, state }
  runSearch(projectId, searchId) {
    return http(`${BASE}/${pid(projectId)}/searches/${sid(searchId)}/run`, { method: 'POST', body: {} });
  },

  // ── Snapshots ─────────────────────────────────────────────────────────────
  // → { snapshots }
  listSnapshots(projectId) {
    return http(`${BASE}/${pid(projectId)}/snapshots`);
  },
  // → { id, kind, label, ..., summary }
  getSnapshot(projectId, snapshotId) {
    return http(`${BASE}/${pid(projectId)}/snapshots/${sid(snapshotId)}`);
  },
  // body: { label? } → { ok, snapshot, alert }
  createSnapshot(projectId, body = {}) {
    return http(`${BASE}/${pid(projectId)}/snapshots`, { method: 'POST', body });
  },
  // a = older, b = newer → { a, b, diff }
  compareSnapshots(projectId, a, b) {
    const qs = new URLSearchParams({ a: String(a || ''), b: String(b || '') }).toString();
    return http(`${BASE}/${pid(projectId)}/snapshots/compare?${qs}`);
  },

  // ── Alerts ────────────────────────────────────────────────────────────────
  ackAlert(projectId, alertId) {
    return http(`${BASE}/${pid(projectId)}/alerts/${sid(alertId)}/ack`, { method: 'POST', body: {} });
  },
};

export default livingApi;
