/**
 * features/logbook/logbookApi.js — 119.md §8. Thin fetch client for the
 * Owner/Leader-only Logbook API (server/routes/logbook.js).
 *
 *   GET /api/logbook/projects/:pid/events   cursor-paginated, filtered timeline
 *   GET /api/logbook/projects/:pid/facets   filter option lists
 *   GET /api/logbook/projects/:pid/export   ?format=csv|json (download)
 *
 * There are no write endpoints — the Logbook is append-only and is written only by
 * the server's engines. Every request is credentialed; a non-leader gets 403 (or
 * 404 for a project they cannot see) and the panel renders that message honestly
 * instead of an empty timeline.
 *
 * PERFORMANCE (§8 "must remain fast in large, long-running projects"): the page
 * size is fixed at PAGE_SIZE and every subsequent page is fetched with the OPAQUE
 * cursor the server returned. There is no "fetch everything" path in this client.
 */
const base = (pid) => `/api/logbook/projects/${encodeURIComponent(pid)}`;

/** 119.md §8 — cursor pages of 50. Never unbounded, never a client-side full scan. */
export const PAGE_SIZE = 50;

async function json(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json(); if (d && d.error) msg = d.error; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Serialise the UI filter state into the query params normalizeFilters() reads
 * (server/logbook/logbookQuery.js:93). Empty selections are omitted entirely — a
 * filter never widens the query, and an absent param means "no restriction".
 */
export function filtersToQuery(f = {}, extra = {}) {
  const qs = new URLSearchParams();
  const list = (k, v) => { if (Array.isArray(v) ? v.length : v) qs.set(k, Array.isArray(v) ? v.join(',') : String(v)); };
  if (f.q) qs.set('q', String(f.q).slice(0, 200));
  list('engine', f.engines);
  list('action', f.actions);
  list('member', f.members);
  list('role', f.roles);
  list('resource', f.resourceTypes);
  list('status', f.statuses);
  list('actorType', f.actorTypes);
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  if (f.sort === 'asc') qs.set('sort', 'asc');
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') qs.set(k, String(v));
  return qs;
}

/** One page of the merged Logbook. `cursor` is the opaque string from the last page. */
export async function fetchLogbookEvents(projectId, filters = {}, cursor = null) {
  const qs = filtersToQuery(filters, { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
  return json(await fetch(`${base(projectId)}/events?${qs.toString()}`, { credentials: 'include' }));
}

/** Filter option lists (members, roles, engines, actions, statuses) — one call per open. */
export async function fetchLogbookFacets(projectId) {
  return json(await fetch(`${base(projectId)}/facets`, { credentials: 'include' }));
}

/**
 * The href for a CSV/JSON export of the CURRENT filter selection. Rendered as a
 * plain download link so the browser sends the session cookie to the SAME
 * leader-gated endpoint (119.md §8 lists export authorization as its own layer —
 * there is no unauthenticated or client-assembled export path).
 */
export function logbookExportHref(projectId, filters = {}, format = 'csv') {
  const qs = filtersToQuery(filters, { format: format === 'json' ? 'json' : 'csv' });
  return `${base(projectId)}/export?${qs.toString()}`;
}

export default { fetchLogbookEvents, fetchLogbookFacets, logbookExportHref, filtersToQuery, PAGE_SIZE };
