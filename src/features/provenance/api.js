/**
 * features/provenance/api.js — 88.md. Thin fetch client for the /api/provenance
 * ledger endpoints. Returns parsed JSON; throws on non-2xx so the panel can show an
 * error state. All requests are credentialed (session cookie).
 */
const base = (pid) => `/api/provenance/projects/${encodeURIComponent(pid)}`;

async function json(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json(); if (d && d.error) msg = d.error; } catch { /* ignore */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.json();
}

export async function fetchEvents(projectId, opts = {}) {
  const qs = new URLSearchParams();
  if (opts.filter) qs.set('filter', opts.filter);
  if (opts.cursor != null) qs.set('cursor', String(opts.cursor));
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.includeInvalidated) qs.set('includeInvalidated', '1');
  const q = qs.toString();
  return json(await fetch(`${base(projectId)}/events${q ? `?${q}` : ''}`, { credentials: 'include' }));
}

export async function fetchSummary(projectId) {
  return json(await fetch(`${base(projectId)}/summary`, { credentials: 'include' }));
}

export async function addReason(projectId, eventId, reason) {
  return json(await fetch(`${base(projectId)}/events/${eventId}/reason`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  }));
}

export async function invalidateEvent(projectId, eventId, reason) {
  return json(await fetch(`${base(projectId)}/events/${eventId}/invalidate`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  }));
}

export default { fetchEvents, fetchSummary, addReason, invalidateEvent };
