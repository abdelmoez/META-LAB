/**
 * server/controllers/logbookController.js — 119.md §8. The Owner/Leader-only
 * Logbook API.
 *
 * Every handler follows the SAME four steps, in this order:
 *   1. resolveLogbookAccess() — API authorization (404 hides existence,
 *      403 for a member/contributor/viewer). No body is ever sent on denial.
 *   2. Log the outcome — a denied attempt is itself a §8 "Logbook security"
 *      event, so an unauthorized probe leaves a trace for the leaders.
 *   3. Query with the SCOPE the access layer returned — never with req.params
 *      (database-query-level scoping).
 *   4. Log the successful view/export (coalesced for views so opening the panel
 *      repeatedly does not flood the very log it is showing).
 */
import { resolveLogbookAccess } from '../logbook/logbookAccess.js';
import {
  listLogbook, logbookFacets, collectForExport, normalizeFilters, toCsv, EXPORT_MAX_ROWS,
} from '../logbook/logbookQuery.js';
import { recordLogEvent, recordSessionEvent } from '../logbook/logbookService.js';

/** Actor context shared by every Logbook-security event this controller writes. */
function actorCtx(req, denial) {
  return {
    actorId: req.user?.id || '',
    actorName: req.user?.name || req.user?.email || '',
    actorRole: denial?.role || '',
    actorType: 'user',
    opId: String(req.headers?.['x-request-id'] || '').slice(0, 120) || undefined,
  };
}

/**
 * A denied attempt is recorded ONLY when the access layer could resolve a
 * project scope (i.e. the caller is a member without leadership). A bare 404
 * carries no scope by design — writing it anywhere would require guessing which
 * project a stranger was probing, and would let an outsider append rows to an
 * arbitrary project's Logbook. That trade-off is deliberate.
 */
export async function logDenied(req, denial, surface) {
  if (!denial?.scope) return;
  await recordLogEvent({
    action: 'LOGBOOK_ACCESS_DENIED',
    status: 'failure',
    summary: `Denied Logbook ${surface} — role "${denial.role || 'member'}" is not an owner or leader`,
    resourceType: 'logbook',
    resourceId: surface,
    metadata: { surface, role: denial.role || null, reason: 'not_leader' },
  }, { ...actorCtx(req, denial), ...denial.scope }).catch(() => {});
}

/** GET /api/logbook/projects/:pid/events — cursor-paginated, filtered timeline. */
export async function getLogbookEvents(req, res) {
  try {
    // The route guard already resolved this; reuse it rather than paying for a
    // second round-trip. Absent (direct unit call / a future unguarded mount) →
    // resolve here, so the handler is never dependent on the guard for safety.
    const gate = req.logbookGate || await resolveLogbookAccess(req.params.pid, req.user);
    if (!gate.ok) {
      await logDenied(req, gate, 'view');
      return res.status(gate.status).json({ error: gate.error });
    }

    const filters = normalizeFilters(req.query || {});
    const page = await listLogbook(gate.scope, filters);

    // 119.md §8 "Logbook security → Viewing the Logbook". Coalesced into one
    // session row per leader per 5 minutes so paging through the timeline does
    // not bury the timeline in its own view events.
    void recordSessionEvent({
      action: 'LOGBOOK_VIEWED',
      summary: 'Viewed the Logbook',
      resourceType: 'logbook',
      resourceId: 'events',
      metadata: { filters: describeFilters(filters) },
    }, { ...actorCtx(req, gate), ...gate.scope }).catch(() => {});

    return res.json({
      ...page,
      viewer: { role: gate.role, isOwner: !!gate.isOwner },
      limit: filters.limit,
      sort: filters.sort,
    });
  } catch (err) {
    console.error('[logbook] getLogbookEvents:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/logbook/projects/:pid/facets — filter option lists (one call per panel open). */
export async function getLogbookFacets(req, res) {
  try {
    // The route guard already resolved this; reuse it rather than paying for a
    // second round-trip. Absent (direct unit call / a future unguarded mount) →
    // resolve here, so the handler is never dependent on the guard for safety.
    const gate = req.logbookGate || await resolveLogbookAccess(req.params.pid, req.user);
    if (!gate.ok) {
      await logDenied(req, gate, 'facets');
      return res.status(gate.status).json({ error: gate.error });
    }
    const facets = await logbookFacets(gate.scope);
    return res.json({ facets, viewer: { role: gate.role, isOwner: !!gate.isOwner } });
  } catch (err) {
    console.error('[logbook] getLogbookFacets:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/logbook/projects/:pid/export?format=csv|json — durable structured
 * export of the CURRENT filter selection. Same leader gate (119.md §8 lists
 * "Export authorization" as its own enforcement layer) and its own audit row.
 */
export async function exportLogbook(req, res) {
  try {
    // The route guard already resolved this; reuse it rather than paying for a
    // second round-trip. Absent (direct unit call / a future unguarded mount) →
    // resolve here, so the handler is never dependent on the guard for safety.
    const gate = req.logbookGate || await resolveLogbookAccess(req.params.pid, req.user);
    if (!gate.ok) {
      await logDenied(req, gate, 'export');
      return res.status(gate.status).json({ error: gate.error });
    }

    const format = String(req.query.format || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
    const filters = normalizeFilters(req.query || {});
    const { rows, truncated } = await collectForExport(gate.scope, filters);

    // 119.md §8 "Logbook security → Exporting it". NOT coalesced: every export
    // of an audit trail is individually accountable.
    await recordLogEvent({
      action: 'LOGBOOK_EXPORTED',
      summary: `Exported ${rows.length} Logbook event${rows.length === 1 ? '' : 's'} as ${format.toUpperCase()}`,
      resourceType: 'logbook',
      resourceId: 'export',
      metadata: { format, rowCount: rows.length, truncated, maxRows: EXPORT_MAX_ROWS, filters: describeFilters(filters) },
    }, { ...actorCtx(req, gate), ...gate.scope }).catch(() => {});

    const stamp = new Date().toISOString().slice(0, 10);
    const base = `logbook_${(gate.projectName || 'project').replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'project'}_${stamp}`;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
      return res.send(JSON.stringify({
        project: { id: req.params.pid, name: gate.projectName || '' },
        exportedAt: new Date().toISOString(),
        timezone: 'UTC',
        filters: describeFilters(filters),
        truncated, maxRows: EXPORT_MAX_ROWS, count: rows.length,
        events: rows,
      }, null, 2));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(rows));
  } catch (err) {
    console.error('[logbook] exportLogbook:', err?.message || err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    return undefined;
  }
}

/** A compact, secret-free echo of the applied filters (for the audit row + export header). */
function describeFilters(f) {
  const out = {};
  if (f.q) out.q = f.q;
  if (f.engines.length) out.engine = f.engines;
  if (f.actions.length) out.action = f.actions;
  if (f.actorIds.length) out.member = f.actorIds;
  if (f.roles.length) out.role = f.roles;
  if (f.resourceTypes.length) out.resource = f.resourceTypes;
  if (f.statuses.length) out.status = f.statuses;
  if (f.actorTypes.length) out.actorType = f.actorTypes;
  if (f.from) out.from = f.from.toISOString();
  if (f.to) out.to = f.to.toISOString();
  if (f.sources.length) out.sources = f.sources;
  out.sort = f.sort;
  return out;
}

export default { getLogbookEvents, getLogbookFacets, exportLogbook };
