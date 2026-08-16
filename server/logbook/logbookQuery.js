/**
 * server/logbook/logbookQuery.js — 119.md §8. The READ side of the project
 * Logbook: cursor-paginated, filtered, sorted listing over ProjectLogEvent
 * UNIONED at read time with the pre-119 audit stores, plus the CSV/JSON export
 * serialisers.
 *
 * WHY A READ-TIME UNION (and not a backfill): the investigation
 * (reports119/logbook-audit.md) found SEVEN project-scoped audit stores holding
 * years of history in four different shapes. Copying them would (a) duplicate
 * rows that the source of truth still owns, (b) need a reconciliation story for
 * every future writer, and (c) risk fabricating fields (role-at-the-time,
 * status) those rows never had. The union keeps every legacy row honest —
 * bridged rows are labelled with their `source` and carry only what was
 * actually recorded — while ALL new events land in one append-only table.
 *
 * SCOPING: every query is scoped by the ids the ACCESS layer resolved
 * (logbookAccess.js), never by anything off the request. ScreenAuditLog is keyed
 * by ScreenProject id; ProjectEvent / ExtractionAuditLog / RobAuditLog by
 * META·LAB Project id; ProjectLogEvent by either (see the schema comment).
 *
 * ORDERING: rows from N sources are merged on (timestamp, sourceRank, id) — a
 * total order, so the opaque cursor can resume exactly where the last page
 * stopped without re-emitting or skipping a row.
 */
import { prisma } from '../db/client.js';
import {
  LEGACY_SOURCES, MIRRORED_SCREEN_AUDIT_ACTIONS, MIRROR_SCREEN_AUDIT,
  classifyScreenAuditAction, classifyProjectEvent, classifyExtractionAuditAction,
  classifyRobAuditAction, humaniseAction,
} from './vocabulary.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
/** Extra rows fetched per source so same-millisecond ties never under-fill a page. */
const TIE_SLACK = 20;
/** Hard ceiling on an export so one request can never stream an unbounded table. */
export const EXPORT_MAX_ROWS = 20_000;

/** Merge rank — fixes the tiebreak between sources at identical timestamps. */
const SOURCE_RANK = { logbook: 0, screen_audit: 1, project_event: 2, extraction_audit: 3, rob_audit: 4 };

const parseJson = (s, fallback) => {
  try { const v = JSON.parse(s == null ? 'null' : s); return v === null || v === undefined ? fallback : v; }
  catch { return fallback; }
};

/* ═══════════════════════════ cursor encoding ═════════════════════════════ */

/** Opaque cursor = base64url({ t: epochMs, r: sourceRank, i: rawId }). */
export function encodeCursor(row) {
  if (!row) return null;
  const payload = { t: new Date(row.at).getTime(), r: SOURCE_RANK[row.source] ?? 9, i: String(row.rawId ?? row.id) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const p = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!Number.isFinite(p.t)) return null;
    return { t: Number(p.t), r: Number(p.r) || 0, i: String(p.i ?? '') };
  } catch { return null; }
}

/** Total order used by the merge. Newest first when desc. */
function comparator(desc) {
  const dir = desc ? 1 : -1;
  return (a, b) => {
    if (a.ts !== b.ts) return dir * (b.ts - a.ts);
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.rawId === b.rawId) return 0;
    return dir * (a.rawId < b.rawId ? 1 : -1);
  };
}

/** Does `row` sort STRICTLY after `cursor` in the requested order? */
function afterCursor(row, cursor, desc) {
  if (!cursor) return true;
  const cmp = comparator(desc);
  return cmp({ ts: cursor.t, rank: cursor.r, rawId: cursor.i }, row) < 0;
}

/* ═════════════════════════ filter normalisation ══════════════════════════ */

const arr = (v) => (v == null || v === '' ? [] : (Array.isArray(v) ? v : String(v).split(',')))
  .map((s) => String(s).trim()).filter(Boolean);

/**
 * normalizeFilters(query) — coerce raw request query params into the closed
 * filter shape the readers use. Unknown values are simply dropped (a filter
 * never widens access).
 */
export function normalizeFilters(q = {}) {
  const dateOrNull = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  const limitRaw = Number.parseInt(String(q.limit ?? ''), 10);
  return {
    q: String(q.q || '').trim().toLowerCase().slice(0, 200),
    engines: arr(q.engine),
    actions: arr(q.action),
    actorIds: arr(q.member || q.actorId),
    roles: arr(q.role).map((r) => r.toLowerCase()),
    resourceTypes: arr(q.resource || q.resourceType),
    statuses: arr(q.status),
    actorTypes: arr(q.actorType),           // user | system | automation
    from: dateOrNull(q.from),
    to: dateOrNull(q.to),
    sort: String(q.sort || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
    limit: Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT,
    cursor: q.cursor ? String(q.cursor) : null,
    // Legacy history is included by default; `sources=logbook` narrows to native rows.
    sources: arr(q.sources),
  };
}

/** Is this legacy source enabled for the current request? */
function sourceEnabled(f, source) {
  if (!f.sources.length) return true;
  return f.sources.includes(source);
}

/** Post-filters that cannot be pushed into every source's SQL identically. */
function passesInMemory(row, f) {
  if (f.engines.length && !f.engines.includes(row.engine)) return false;
  if (f.statuses.length && !f.statuses.includes(row.status)) return false;
  if (f.actorTypes.length && !f.actorTypes.includes(row.actorType)) return false;
  if (f.roles.length && !f.roles.includes(String(row.actorRole || '').toLowerCase())) return false;
  if (f.resourceTypes.length && !f.resourceTypes.includes(String(row.resourceType || ''))) return false;
  if (f.actions.length && !f.actions.includes(row.action)) return false;
  if (f.actorIds.length && !f.actorIds.includes(String(row.actorId || ''))) return false;
  if (f.q) {
    const hay = `${row.summary} ${row.action} ${row.resourceLabel || ''} ${row.actorName || ''}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

/* ════════════════════════════ row mappers ════════════════════════════════ */

function nativeRow(r) {
  return {
    id: `logbook:${r.id}`,
    rawId: String(r.id).padStart(12, '0'),
    source: 'logbook',
    at: r.createdAt,
    ts: new Date(r.createdAt).getTime(),
    rank: SOURCE_RANK.logbook,
    clientAt: r.clientTs || null,
    actorId: r.actorId || '',
    actorName: r.actorName || '',
    actorRole: r.actorRole || '',
    actorType: r.actorType || 'user',
    engine: r.engine || 'core',
    action: r.action,
    actionCategory: r.actionCategory || '',
    summary: r.summary || humaniseAction(r.action),
    resourceType: r.resourceType || null,
    resourceId: r.resourceId || null,
    resourceLabel: r.resourceLabel || null,
    before: parseJson(r.beforeSummary, null),
    after: parseJson(r.afterSummary, null),
    status: r.status || 'success',
    via: r.via || 'user',
    opId: r.opId || null,
    correlationId: r.correlationId || null,
    sessionId: r.sessionId || null,
    relatedEventId: r.relatedEventId != null ? `logbook:${r.relatedEventId}` : null,
    severity: Number(r.severity) || 0,
    metadata: parseJson(r.metadata, {}),
  };
}

function screenAuditRow(r) {
  const c = classifyScreenAuditAction(r.action);
  const details = parseJson(r.details, {});
  const isSystem = !r.actorId || r.actorId === 'system';
  return {
    id: `screen_audit:${r.id}`,
    rawId: String(r.id),
    source: 'screen_audit',
    at: r.createdAt,
    ts: new Date(r.createdAt).getTime(),
    rank: SOURCE_RANK.screen_audit,
    clientAt: null,
    actorId: r.actorId || '',
    actorName: r.actorName || '',
    // Honest gap: the pre-119 stores never captured the actor's role at the
    // time, so a bridged row has none. It is '' rather than a guess.
    actorRole: '',
    actorType: isSystem ? 'system' : 'user',
    engine: c.engine,
    action: r.action,
    actionCategory: c.category,
    summary: humaniseAction(r.action),
    resourceType: r.entityType || null,
    resourceId: r.entityId || null,
    resourceLabel: details.email || details.title || details.name || null,
    before: details.before ?? null,
    after: details.after ?? details.changes ?? null,
    status: 'success',
    via: typeof details.via === 'string' ? details.via : 'user',
    opId: null,
    correlationId: null,
    sessionId: null,
    relatedEventId: null,
    severity: c.severity,
    metadata: details,
  };
}

function projectEventRow(r) {
  const c = classifyProjectEvent(r);
  return {
    id: `project_event:${r.id}`,
    rawId: String(r.id).padStart(12, '0'),
    source: 'project_event',
    at: r.serverTs || r.createdAt,
    ts: new Date(r.serverTs || r.createdAt).getTime(),
    rank: SOURCE_RANK.project_event,
    clientAt: r.clientTs || null,
    actorId: r.actorUserId || '',
    actorName: r.actorName || '',
    actorRole: r.actorRole || '',
    actorType: c.actorType,
    engine: c.engine,
    action: r.eventType,
    actionCategory: c.category,
    summary: humaniseAction(r.eventType),
    resourceType: r.entityType || null,
    resourceId: r.entityId || null,
    resourceLabel: null,
    before: parseJson(r.prevValue, null),
    after: parseJson(r.newValue, null),
    status: r.invalidated ? 'reversed' : 'success',
    via: 'user',
    opId: null,
    correlationId: r.correlationId || null,
    sessionId: r.sessionId || null,
    relatedEventId: r.supersedesEventId != null ? `project_event:${r.supersedesEventId}` : null,
    severity: c.severity,
    metadata: parseJson(r.metadata, {}),
  };
}

function simpleAuditRow(source, classify) {
  return (r) => {
    const c = classify(r.action);
    const details = parseJson(r.details, {});
    return {
      id: `${source}:${r.id}`,
      rawId: String(r.id),
      source,
      at: r.createdAt,
      ts: new Date(r.createdAt).getTime(),
      rank: SOURCE_RANK[source],
      clientAt: null,
      actorId: r.actorId || '',
      actorName: r.actorName || '',
      actorRole: '',
      actorType: !r.actorId || r.actorId === 'system' ? 'system' : 'user',
      engine: c.engine,
      action: r.action,
      actionCategory: c.category,
      summary: humaniseAction(r.action),
      resourceType: r.entityType || null,
      resourceId: r.entityId || r.studyId || r.assessmentId || null,
      resourceLabel: details.title || details.name || null,
      before: details.before ?? null,
      after: details.after ?? null,
      status: 'success',
      via: 'user',
      opId: null,
      correlationId: null,
      sessionId: null,
      relatedEventId: null,
      severity: c.severity,
      metadata: details,
    };
  };
}

/* ═══════════════════════════ per-source reads ════════════════════════════ */

function dateWindow(f, cursor, desc) {
  const cond = {};
  if (f.from) cond.gte = f.from;
  if (f.to) cond.lte = f.to;
  if (cursor) {
    const at = new Date(cursor.t);
    if (desc) cond.lte = cond.lte && cond.lte < at ? cond.lte : at;
    else cond.gte = cond.gte && cond.gte > at ? cond.gte : at;
  }
  return Object.keys(cond).length ? cond : null;
}

async function readNative(scope, f, cursor, take) {
  if (!prisma.projectLogEvent) return [];
  const and = [];
  const or = [];
  if (scope.projectId) or.push({ projectId: scope.projectId });
  if (scope.metaLabProjectId) or.push({ metaLabProjectId: scope.metaLabProjectId });
  if (!or.length) return [];
  and.push({ OR: or });
  const win = dateWindow(f, cursor, f.sort === 'desc');
  if (win) and.push({ createdAt: win });
  if (f.engines.length) and.push({ engine: { in: f.engines } });
  if (f.actions.length) and.push({ action: { in: f.actions } });
  if (f.actorIds.length) and.push({ actorId: { in: f.actorIds } });
  if (f.statuses.length) and.push({ status: { in: f.statuses } });
  if (f.actorTypes.length) and.push({ actorType: { in: f.actorTypes } });
  if (f.roles.length) and.push({ actorRole: { in: f.roles } });
  if (f.resourceTypes.length) and.push({ resourceType: { in: f.resourceTypes } });
  // Case-folded search over the stored lowercase projection — identical on
  // SQLite and Postgres (see logbookService.buildLogRow).
  if (f.q) and.push({ searchText: { contains: f.q } });
  const rows = await prisma.projectLogEvent.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: f.sort }, { id: f.sort }],
    take,
  });
  return rows.map(nativeRow);
}

/**
 * cutoverAt(scope) — the instant this project's membership/lifecycle events
 * started being written natively. ScreenAuditLog rows of a MIRRORED action at or
 * after that instant are the legacy TWIN of a native row and are dropped from
 * the union, so a membership change appears exactly once (119.md §8).
 */
export async function cutoverAt(scope) {
  if (!prisma.projectLogEvent || !scope.projectId) return null;
  try {
    const first = await prisma.projectLogEvent.findFirst({
      where: { projectId: scope.projectId, mirrors: MIRROR_SCREEN_AUDIT },
      orderBy: { id: 'asc' },
      select: { createdAt: true },
    });
    return first ? first.createdAt : null;
  } catch { return null; }
}

async function readScreenAudit(scope, f, cursor, take, cutover) {
  if (!scope.projectId || !prisma.screenAuditLog) return [];
  const and = [];
  const win = dateWindow(f, cursor, f.sort === 'desc');
  if (win) and.push({ createdAt: win });
  if (f.actions.length) and.push({ action: { in: f.actions } });
  if (f.actorIds.length) and.push({ actorId: { in: f.actorIds } });
  // A bridged row has no recorded status/role and is always a completed action.
  if (f.statuses.length && !f.statuses.includes('success')) return [];
  if (f.roles.length) return [];
  // A bridged row is 'system' when its actorId is 'system'/empty, else 'user' —
  // it can never be 'automation', so an automation-only filter excludes them.
  if (f.actorTypes.length) {
    const wantUser = f.actorTypes.includes('user');
    const wantSystem = f.actorTypes.includes('system');
    if (!wantUser && !wantSystem) return [];
    if (wantUser && !wantSystem) and.push({ actorId: { not: 'system' } });
    if (wantSystem && !wantUser) and.push({ actorId: 'system' });
  }
  if (cutover) {
    and.push({ OR: [{ action: { notIn: MIRRORED_SCREEN_AUDIT_ACTIONS } }, { createdAt: { lt: cutover } }] });
  }
  const rows = await prisma.screenAuditLog.findMany({
    where: { projectId: scope.projectId, ...(and.length ? { AND: and } : {}) },
    orderBy: [{ createdAt: f.sort }, { id: f.sort }],
    take,
  });
  return rows.map(screenAuditRow);
}

async function readProjectEvent(scope, f, cursor, take) {
  if (!scope.metaLabProjectId || !prisma.projectEvent) return [];
  const and = [{ projectId: scope.metaLabProjectId }];
  const win = dateWindow(f, cursor, f.sort === 'desc');
  if (win) and.push({ serverTs: win });
  if (f.actions.length) and.push({ eventType: { in: f.actions } });
  if (f.actorIds.length) and.push({ actorUserId: { in: f.actorIds } });
  if (f.roles.length) and.push({ actorRole: { in: f.roles } });
  const rows = await prisma.projectEvent.findMany({
    where: { AND: and },
    orderBy: [{ serverTs: f.sort }, { id: f.sort }],
    take,
  });
  return rows.map(projectEventRow);
}

async function readSimpleAudit(model, source, classify, scope, f, cursor, take) {
  if (!scope.metaLabProjectId || !model) return [];
  const and = [];
  const win = dateWindow(f, cursor, f.sort === 'desc');
  if (win) and.push({ createdAt: win });
  if (f.actions.length) and.push({ action: { in: f.actions } });
  if (f.actorIds.length) and.push({ actorId: { in: f.actorIds } });
  if (f.statuses.length && !f.statuses.includes('success')) return [];
  if (f.roles.length) return [];
  const rows = await model.findMany({
    where: { projectId: scope.metaLabProjectId, ...(and.length ? { AND: and } : {}) },
    orderBy: [{ createdAt: f.sort }, { id: f.sort }],
    take,
  });
  return rows.map(simpleAuditRow(source, classify));
}

/* ═══════════════════════════════ listing ═════════════════════════════════ */

/**
 * listLogbook(scope, filters) — ONE page of the merged Logbook.
 *
 * @param {{projectId?:string, metaLabProjectId?:string}} scope  resolved by the
 *        access layer — NEVER taken from the request.
 * @param {object} filters  normalizeFilters() output.
 * @returns {{ events, nextCursor, hasMore, sources, available }}
 */
export async function listLogbook(scope, filters) {
  const f = filters && filters.limit ? filters : normalizeFilters(filters || {});
  const desc = f.sort === 'desc';
  const cursor = decodeCursor(f.cursor);
  const take = f.limit + 1 + TIE_SLACK;
  const available = !!prisma.projectLogEvent;

  const wanted = (s) => sourceEnabled(f, s);
  const [native, sa, pe, ea, ra] = await Promise.all([
    wanted('logbook') ? readNative(scope, f, cursor, take) : [],
    wanted('screen_audit') ? cutoverAt(scope).then((c) => readScreenAudit(scope, f, cursor, take, c)) : [],
    wanted('project_event') ? readProjectEvent(scope, f, cursor, take) : [],
    wanted('extraction_audit')
      ? readSimpleAudit(prisma.extractionAuditLog, 'extraction_audit', classifyExtractionAuditAction, scope, f, cursor, take)
      : [],
    wanted('rob_audit')
      ? readSimpleAudit(prisma.robAuditLog, 'rob_audit', classifyRobAuditAction, scope, f, cursor, take)
      : [],
  ]);

  const merged = [...native, ...sa, ...pe, ...ea, ...ra]
    .filter((r) => afterCursor(r, cursor, desc))
    .filter((r) => passesInMemory(r, f))
    .sort(comparator(desc));

  const hasMore = merged.length > f.limit;
  const page = hasMore ? merged.slice(0, f.limit) : merged;
  const last = page[page.length - 1] || null;

  return {
    available,
    events: page.map(stripInternals),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    hasMore,
    sources: LEGACY_SOURCES.concat('logbook'),
  };
}

/** Drop merge bookkeeping from the wire shape. */
function stripInternals(r) {
  const { ts, rank, rawId, ...rest } = r;
  return rest;
}

/* ═══════════════════════════════ facets ══════════════════════════════════ */

/**
 * logbookFacets(scope) — the option lists the filter UI needs (119.md §8
 * member/role/engine/action/status filters), with counts where cheap.
 * Bounded: grouped aggregates over the two highest-volume stores only; a legacy
 * actor with no native rows still appears via the member roster.
 */
export async function logbookFacets(scope) {
  const out = { engines: [], actions: [], statuses: [], actors: [], roles: [] };
  const bump = (list, value, label, n) => {
    if (!value) return;
    const hit = list.find((x) => x.value === value);
    if (hit) hit.n += n; else list.push({ value, label: label || value, n });
  };

  if (prisma.projectLogEvent && (scope.projectId || scope.metaLabProjectId)) {
    const or = [];
    if (scope.projectId) or.push({ projectId: scope.projectId });
    if (scope.metaLabProjectId) or.push({ metaLabProjectId: scope.metaLabProjectId });
    const where = { OR: or };
    const [byEngine, byAction, byStatus, byActor] = await Promise.all([
      prisma.projectLogEvent.groupBy({ by: ['engine'], where, _count: true }).catch(() => []),
      prisma.projectLogEvent.groupBy({ by: ['action'], where, _count: true }).catch(() => []),
      prisma.projectLogEvent.groupBy({ by: ['status'], where, _count: true }).catch(() => []),
      prisma.projectLogEvent.groupBy({ by: ['actorId', 'actorName'], where, _count: true }).catch(() => []),
    ]);
    for (const r of byEngine) bump(out.engines, r.engine, r.engine, r._count || 0);
    for (const r of byAction) bump(out.actions, r.action, humaniseAction(r.action), r._count || 0);
    for (const r of byStatus) bump(out.statuses, r.status, r.status, r._count || 0);
    for (const r of byActor) bump(out.actors, r.actorId, r.actorName || r.actorId, r._count || 0);
  }

  if (scope.projectId && prisma.screenAuditLog) {
    const where = { projectId: scope.projectId };
    const [byAction, byActor] = await Promise.all([
      prisma.screenAuditLog.groupBy({ by: ['action'], where, _count: true }).catch(() => []),
      prisma.screenAuditLog.groupBy({ by: ['actorId', 'actorName'], where, _count: true }).catch(() => []),
    ]);
    for (const r of byAction) {
      bump(out.actions, r.action, humaniseAction(r.action), r._count || 0);
      bump(out.engines, classifyScreenAuditAction(r.action).engine, null, r._count || 0);
    }
    for (const r of byActor) bump(out.actors, r.actorId, r.actorName || r.actorId, r._count || 0);
  }

  // Roles are a closed set (the member roster), not a derived facet.
  if (scope.projectId && prisma.screenProjectMember) {
    const members = await prisma.screenProjectMember
      .findMany({ where: { projectId: scope.projectId }, select: { userId: true, name: true, email: true, role: true } })
      .catch(() => []);
    for (const m of members) {
      if (m.userId) bump(out.actors, m.userId, m.name || m.email || m.userId, 0);
      bump(out.roles, m.role, m.role, 1);
    }
  }

  const bySize = (a, b) => (b.n - a.n) || (a.label < b.label ? -1 : 1);
  out.engines.sort(bySize); out.actions.sort(bySize); out.actors.sort(bySize);
  out.statuses.sort(bySize); out.roles.sort(bySize);
  return out;
}

/* ═══════════════════════════════ export ══════════════════════════════════ */

/**
 * collectForExport(scope, filters) — walk the cursor until EXPORT_MAX_ROWS.
 * Returns { rows, truncated } so the caller can state honestly that a very large
 * Logbook was capped rather than silently shipping a partial file.
 */
export async function collectForExport(scope, filters) {
  const base = { ...(filters && filters.limit ? filters : normalizeFilters(filters || {})), limit: MAX_LIMIT };
  const rows = [];
  let cursor = base.cursor;
  let guard = 0;
  while (rows.length < EXPORT_MAX_ROWS && guard < 1 + Math.ceil(EXPORT_MAX_ROWS / MAX_LIMIT)) {
    guard += 1;
    const page = await listLogbook(scope, { ...base, cursor });
    rows.push(...page.events);
    if (!page.nextCursor) return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: false };
    cursor = page.nextCursor;
  }
  return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: true };
}

export const CSV_COLUMNS = Object.freeze([
  'timestampUtc', 'timestampIso', 'source', 'actorName', 'actorId', 'actorRole', 'actorType',
  'engine', 'action', 'category', 'status', 'via', 'resourceType', 'resourceId',
  'resourceLabel', 'summary', 'before', 'after', 'correlationId', 'eventId',
]);

/**
 * csvCell(value) — RFC-4180 quoting PLUS spreadsheet-formula neutralisation: a
 * cell starting with = + - @ (or a tab/CR) is prefixed with an apostrophe so a
 * Logbook export opened in Excel can never execute an attacker-supplied formula
 * that reached the log through a project/member name.
 */
export function csvCell(value) {
  let s = value === null || value === undefined ? ''
    : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** toCsv(rows) — header + one line per event. Timestamps are ISO-8601 UTC. */
export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows || []) {
    const iso = new Date(r.at).toISOString();
    lines.push([
      iso, iso, r.source, r.actorName, r.actorId, r.actorRole, r.actorType,
      r.engine, r.action, r.actionCategory, r.status, r.via, r.resourceType, r.resourceId,
      r.resourceLabel, r.summary, r.before, r.after, r.correlationId, r.id,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export default {
  listLogbook, logbookFacets, collectForExport, normalizeFilters,
  encodeCursor, decodeCursor, cutoverAt, toCsv, csvCell,
  DEFAULT_LIMIT, MAX_LIMIT, EXPORT_MAX_ROWS, CSV_COLUMNS,
};
