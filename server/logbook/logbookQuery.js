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
 *
 * COMPLETENESS (119.md §8 "cursor-based pagination", wave-2 defect fix): the
 * bridged stores have no engine/status/actorType column, so those filters can only
 * be applied AFTER their rows are read (passesInMemory). Reading a single fixed
 * chunk per source therefore used to let a selective filter answer with a SHORT
 * page and nextCursor:null — the interface then showed "Showing N events" with
 * nothing left to load while older MATCHING legacy rows still existed. Two rules
 * fix that, and both are load-bearing:
 *   1. every source is DRAINED (chunk after chunk) until it could fill the page by
 *      itself, runs out of rows, or hits an explicit per-request bound;
 *   2. a page never reaches past the SAFE FRONTIER — the shallowest point any
 *      unfinished source stopped reading at — so one source's deep row can never
 *      jump over rows another source has not looked at yet.
 * When the bound (and not the end of the history) is what stopped the scan, the
 * response says so: hasMore stays true, nextCursor points at the scan frontier and
 * `scanIncomplete` tells the interface to offer "keep looking" instead of implying
 * a completeness nobody verified.
 *
 * CURSORS ARE EXACT, AND ONLY EVER MOVE FORWARD (r2 fix): each source resumes from
 * a keyset predicate written in its OWN columns (cursorWhere), not from an inclusive
 * date window — otherwise a same-millisecond batch bigger than the scan budget makes
 * every request re-read the batch from its top, and the answer's nextCursor lands
 * at-or-BEFORE the request cursor, walking the pager backwards over rows it has
 * already emitted. listLogbook additionally refuses any nextCursor that does not
 * sort strictly after the request cursor.
 */
import { prisma } from '../db/client.js';
import {
  LEGACY_SOURCES, MIRRORED_SCREEN_AUDIT_ACTIONS, MIRROR_SCREEN_AUDIT,
  SCREEN_AUDIT_EXACT_ACTIONS, screenAuditExactActionsForEngines, projectEventModuleMatch,
  classifyScreenAuditAction, classifyProjectEvent, classifyExtractionAuditAction,
  classifyRobAuditAction, humaniseAction,
} from './vocabulary.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
/** Extra rows fetched per source so same-millisecond ties never under-fill a page. */
const TIE_SLACK = 20;
/**
 * How many chunks ONE source may read for a single page before the scan stops and
 * the answer admits it stopped (`scanIncomplete`). A selective filter over deep
 * legacy history can need to read far past the page size to find its matches; this
 * is what keeps one request bounded WITHOUT ever letting the reader claim it
 * reached the end of the history when it did not.
 */
export const MAX_SOURCE_CHUNKS = 10;
/** Hard ceiling on an export so one request can never stream an unbounded table. */
export const EXPORT_MAX_ROWS = 20_000;
/** Total chunk reads one export may spend before it reports itself partial. */
export const EXPORT_SCAN_CHUNKS = 2_000;

/** Merge rank — fixes the tiebreak between sources at identical timestamps. */
const SOURCE_RANK = { logbook: 0, screen_audit: 1, project_event: 2, extraction_audit: 3, rob_audit: 4 };
/**
 * How each source's PRIMARY KEY compares, so the cursor's row id can be pushed back
 * into that source's SQL as an exact keyset predicate (see cursorWhere). Int keys
 * are padded in `rawId` for the string comparator and un-padded on the way back.
 */
const SOURCE_ID_KIND = {
  logbook: 'int', screen_audit: 'string', project_event: 'int',
  extraction_audit: 'string', rob_audit: 'string',
};

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

function dateWindow(f) {
  const cond = {};
  if (f.from) cond.gte = f.from;
  if (f.to) cond.lte = f.to;
  return Object.keys(cond).length ? cond : null;
}

/**
 * cursorWhere(field, cursor, desc, source) — resume ONE source STRICTLY past the
 * merge cursor, expressed in that source's own columns (119.md §8, r2 fix).
 *
 * WHY THIS AND NOT A DATE WINDOW. The cursor names a position in the TOTAL merge
 * order (timestamp, sourceRank, rowId). An inclusive `createdAt <= cursor.t` window
 * re-reads every row that shares the cursor's millisecond, and `afterCursor` then
 * throws the already-emitted ones away — which is correct but not FREE: they still
 * consume the per-request scan budget. A bulk `createMany` stamps one identical
 * `now()` on a whole batch, so a same-millisecond tie group can be larger than the
 * budget (take × maxChunks). Once the cursor sat deeper inside such a group than the
 * budget reached, every request re-read the group from its top, emitted nothing, and
 * set nextCursor to a frontier sorting BEFORE the request cursor — the pager then
 * walked BACKWARDS and re-emitted rows earlier pages had already shown.
 *
 * Encoding the cursor exactly removes the re-read: the merge order says a row at the
 * cursor's instant belongs to the next page iff its source rank is greater, or the
 * rank is equal and its id sorts after. So each source starts where it truly left
 * off and every request makes real forward progress.
 */
function cursorWhere(field, cursor, desc, source) {
  if (!cursor) return null;
  const at = new Date(cursor.t);
  const tsAfter = desc ? 'lt' : 'gt';           // strictly past the cursor instant
  const tsAtOrAfter = desc ? 'lte' : 'gte';     // the instant itself is still ahead
  const rank = SOURCE_RANK[source] ?? 9;
  // Equal timestamps break on rank in the SAME direction for asc and desc (see
  // comparator), so this branch is direction-independent.
  if (rank < cursor.r) return { [field]: { [tsAfter]: at } };
  if (rank > cursor.r) return { [field]: { [tsAtOrAfter]: at } };
  const kind = SOURCE_ID_KIND[source] || 'string';
  const id = kind === 'int' ? Number.parseInt(cursor.i, 10) : String(cursor.i || '');
  if (kind === 'int' ? !Number.isFinite(id) : !id) {
    // A cursor without a usable row id (only reachable from a hand-made one): fall
    // back to the inclusive window. `afterCursor` still drops the already-emitted
    // ties, so this can cost work — never rows.
    return { [field]: { [tsAtOrAfter]: at } };
  }
  return {
    OR: [
      { [field]: { [tsAfter]: at } },
      { AND: [{ [field]: { equals: at } }, { id: { [desc ? 'lt' : 'gt']: id } }] },
    ],
  };
}

/**
 * seekWhere(field, seek, desc) — where the NEXT chunk of ONE source starts:
 * strictly past the last RAW row the previous chunk read, on the very (field, id)
 * order the query sorts by. Keyset, not offset, so a concurrent insert can never
 * shift a chunk or make it repeat a row.
 */
function seekWhere(field, seek, desc) {
  if (!seek) return null;
  const dir = desc ? 'lt' : 'gt';
  return {
    OR: [
      { [field]: { [dir]: seek.at } },
      { AND: [{ [field]: { equals: seek.at } }, { id: { [dir]: seek.id } }] },
    ],
  };
}

/**
 * One source chunk: the MAPPED rows, how many raw rows were actually read (fewer
 * than `take` ⇒ the source is exhausted) and the keyset position to resume from.
 */
function chunkOf(raw, map, field) {
  const lastRaw = raw[raw.length - 1];
  return {
    rows: raw.map(map),
    read: raw.length,
    seek: lastRaw ? { at: lastRaw[field], id: lastRaw.id } : null,
  };
}

/** A source that can contribute nothing to THIS request — proven, not assumed. */
const NOTHING = Object.freeze({ rows: [], read: 0, seek: null });

/**
 * actorTypeWhere(actorTypes) — the §8 human-vs-system filter pushed onto a
 * bridged store that has no actorType column. Those rows are 'system' exactly when
 * the actor id is 'system' OR EMPTY (see screenAuditRow/simpleAuditRow) and can
 * never be 'automation'. Returns false when nothing can match.
 */
function actorTypeWhere(actorTypes) {
  if (!actorTypes.length) return null;
  const wantUser = actorTypes.includes('user');
  const wantSystem = actorTypes.includes('system');
  if (!wantUser && !wantSystem) return false;
  if (wantUser && wantSystem) return null;
  // NOTE the empty-id branch: an audit row written without an actor is 'system' to
  // the mapper, so a bare `actorId: 'system'` would have silently dropped it.
  if (wantSystem) return { OR: [{ actorId: 'system' }, { actorId: '' }] };
  return { AND: [{ actorId: { not: 'system' } }, { actorId: { not: '' } }] };
}

async function readNative(scope, f, cursor, take, seek) {
  if (!prisma.projectLogEvent) return NOTHING;
  const and = [];
  const or = [];
  if (scope.projectId) or.push({ projectId: scope.projectId });
  if (scope.metaLabProjectId) or.push({ metaLabProjectId: scope.metaLabProjectId });
  if (!or.length) return NOTHING;
  and.push({ OR: or });
  const win = dateWindow(f);
  if (win) and.push({ createdAt: win });
  const cw = cursorWhere('createdAt', cursor, f.sort === 'desc', 'logbook');
  if (cw) and.push(cw);
  const sk = seekWhere('createdAt', seek, f.sort === 'desc');
  if (sk) and.push(sk);
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
  return chunkOf(rows, nativeRow, 'createdAt');
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

async function readScreenAudit(scope, f, cursor, take, cutover, seek) {
  if (!scope.projectId || !prisma.screenAuditLog) return NOTHING;
  const and = [];
  const win = dateWindow(f);
  if (win) and.push({ createdAt: win });
  const cw = cursorWhere('createdAt', cursor, f.sort === 'desc', 'screen_audit');
  if (cw) and.push(cw);
  const sk = seekWhere('createdAt', seek, f.sort === 'desc');
  if (sk) and.push(sk);
  if (f.actions.length) and.push({ action: { in: f.actions } });
  if (f.actorIds.length) and.push({ actorId: { in: f.actorIds } });
  // resourceType IS a column here (entityType); `arr()` never yields '', so the
  // NULL rows this drops are exactly the ones passesInMemory would have dropped.
  if (f.resourceTypes.length) and.push({ entityType: { in: f.resourceTypes } });
  // A bridged row has no recorded status/role and is always a completed action.
  if (f.statuses.length && !f.statuses.includes('success')) return NOTHING;
  if (f.roles.length) return NOTHING;
  // A bridged row is 'system' when its actorId is 'system'/empty, else 'user' —
  // it can never be 'automation', so an automation-only filter excludes them.
  const actorType = actorTypeWhere(f.actorTypes);
  if (actorType === false) return NOTHING;
  if (actorType) and.push(actorType);
  // ENGINE, pushed as far into SQL as it can go HONESTLY. A legacy action's engine
  // is derived from its STRING (classifyScreenAuditAction), and only the exact
  // table can become a predicate that cannot lie: the prefix families would need
  // LIKE, and Prisma 5 leaves `_` a LIKE wildcard (verified against this repo's
  // client: startsWith 'PROJEC_' matches PROJECT_* just as 'PROJECT_' does), so
  // `NOT startsWith('RECORD_')` would also exclude a future 'RECORDS_MERGED' — a
  // row that classifies as 'core'. SQL therefore drops ONLY rows it can name
  // exactly; everything else is read and decided by passesInMemory, which the
  // drain loop then pages through correctly.
  if (f.engines.length) {
    and.push({
      OR: [
        { action: { in: screenAuditExactActionsForEngines(f.engines) } },
        { action: { notIn: SCREEN_AUDIT_EXACT_ACTIONS } },
      ],
    });
  }
  if (cutover) {
    and.push({ OR: [{ action: { notIn: MIRRORED_SCREEN_AUDIT_ACTIONS } }, { createdAt: { lt: cutover } }] });
  }
  const rows = await prisma.screenAuditLog.findMany({
    where: { projectId: scope.projectId, ...(and.length ? { AND: and } : {}) },
    orderBy: [{ createdAt: f.sort }, { id: f.sort }],
    take,
  });
  return chunkOf(rows, screenAuditRow, 'createdAt');
}

async function readProjectEvent(scope, f, cursor, take, seek) {
  if (!scope.metaLabProjectId || !prisma.projectEvent) return NOTHING;
  const and = [{ projectId: scope.metaLabProjectId }];
  const win = dateWindow(f);
  if (win) and.push({ serverTs: win });
  const cw = cursorWhere('serverTs', cursor, f.sort === 'desc', 'project_event');
  if (cw) and.push(cw);
  const sk = seekWhere('serverTs', seek, f.sort === 'desc');
  if (sk) and.push(sk);
  if (f.actions.length) and.push({ eventType: { in: f.actions } });
  if (f.actorIds.length) and.push({ actorUserId: { in: f.actorIds } });
  if (f.roles.length) and.push({ actorRole: { in: f.roles } });
  if (f.resourceTypes.length) and.push({ entityType: { in: f.resourceTypes } });
  // ENGINE: derivable from the `module` COLUMN, so this one pushes exactly (the
  // taxonomy owns the mapping — vocabulary.projectEventModuleMatch — including
  // "a module nobody named, or none at all, reads as core").
  if (f.engines.length) {
    const m = projectEventModuleMatch(f.engines);
    const branches = [];
    if (m.modules.length) branches.push({ module: { in: m.modules } });
    if (m.unmapped) branches.push({ module: { notIn: m.known } }, { module: null });
    if (!branches.length) return NOTHING;
    and.push({ OR: branches });
  }
  // STATUS and ACTOR TYPE are derived from columns too (invalidated / origin).
  if (f.statuses.length) {
    const wantOk = f.statuses.includes('success');
    const wantReversed = f.statuses.includes('reversed');
    if (!wantOk && !wantReversed) return NOTHING;
    if (wantOk !== wantReversed) and.push({ invalidated: wantReversed });
  }
  if (f.actorTypes.length) {
    const branches = [];
    if (f.actorTypes.includes('user')) branches.push({ origin: 'user_action' });
    if (f.actorTypes.includes('system')) branches.push({ origin: 'system' });
    if (f.actorTypes.includes('automation')) branches.push({ origin: { notIn: ['user_action', 'system'] } });
    if (!branches.length) return NOTHING;
    and.push({ OR: branches });
  }
  const rows = await prisma.projectEvent.findMany({
    where: { AND: and },
    orderBy: [{ serverTs: f.sort }, { id: f.sort }],
    take,
  });
  return chunkOf(rows, projectEventRow, 'serverTs');
}

async function readSimpleAudit(model, source, classify, scope, f, cursor, take, seek) {
  if (!scope.metaLabProjectId || !model) return NOTHING;
  // Both simple stores are SINGLE-ENGINE by construction (vocabulary.js), so an
  // engine filter that excludes them is answered without reading a single row —
  // and one that includes them needs no predicate at all.
  if (f.engines.length && !f.engines.includes(classify('').engine)) return NOTHING;
  const and = [];
  const win = dateWindow(f);
  if (win) and.push({ createdAt: win });
  const cw = cursorWhere('createdAt', cursor, f.sort === 'desc', source);
  if (cw) and.push(cw);
  const sk = seekWhere('createdAt', seek, f.sort === 'desc');
  if (sk) and.push(sk);
  if (f.actions.length) and.push({ action: { in: f.actions } });
  if (f.actorIds.length) and.push({ actorId: { in: f.actorIds } });
  if (f.resourceTypes.length) and.push({ entityType: { in: f.resourceTypes } });
  if (f.statuses.length && !f.statuses.includes('success')) return NOTHING;
  if (f.roles.length) return NOTHING;
  const actorType = actorTypeWhere(f.actorTypes);
  if (actorType === false) return NOTHING;
  if (actorType) and.push(actorType);
  const rows = await model.findMany({
    where: { projectId: scope.metaLabProjectId, ...(and.length ? { AND: and } : {}) },
    orderBy: [{ createdAt: f.sort }, { id: f.sort }],
    take,
  });
  return chunkOf(rows, simpleAuditRow(source, classify), 'createdAt');
}

/* ═══════════════════════════════ listing ═════════════════════════════════ */

/**
 * drainSource(read, keep, …) — read ONE source until it could fill the page BY
 * ITSELF (`need` surviving rows), it runs out of rows, or it hits the per-request
 * chunk bound.
 *
 * This is the fix for the wave-2 API-contract defect: `keep` contains the filters
 * that CANNOT be pushed into a legacy store's SQL, so a single fixed `take` would
 * hand back a handful of survivors and let the caller conclude the history had
 * ended. Continuing the read per source is what makes a filtered page honest.
 *
 * @returns {{ rows, frontier, exhausted, chunks }} `frontier` is the last row this
 *          source actually LOOKED AT and is null once the source is exhausted.
 */
async function drainSource(read, keep, { need, take, maxChunks }) {
  const rows = [];
  let seek = null;
  let frontier = null;
  let chunks = 0;
  let exhausted = false;
  while (rows.length < need && chunks < maxChunks) {
    chunks += 1;
    const got = await read(seek, take);
    for (const r of got.rows) if (keep(r)) rows.push(r);
    if (got.rows.length) frontier = got.rows[got.rows.length - 1];
    // Fewer rows than asked for ⇒ this source has nothing left inside the window.
    if (got.read < take || !got.seek) { exhausted = true; break; }
    seek = got.seek;
  }
  return { rows, frontier: exhausted ? null : frontier, exhausted, chunks };
}

/**
 * listLogbook(scope, filters, opts) — ONE page of the merged Logbook.
 *
 * @param {{projectId?:string, metaLabProjectId?:string}} scope  resolved by the
 *        access layer — NEVER taken from the request.
 * @param {object} filters  normalizeFilters() output.
 * @param {{maxChunksPerSource?:number}} opts  scan bound (defaults MAX_SOURCE_CHUNKS).
 * @returns {{ events, nextCursor, hasMore, scanIncomplete, scanChunks, sources, available }}
 *   `hasMore`        there IS more to look at — either more matching rows in hand
 *                    or history this page's scan never reached.
 *   `scanIncomplete` this page came back short because the scan stopped, NOT
 *                    because the history ended: keep loading to keep looking.
 *   `scanChunks`     how many per-source reads this page cost (diagnostic; also
 *                    what bounds an export's total work).
 */
export async function listLogbook(scope, filters, opts = {}) {
  const f = filters && filters.limit ? filters : normalizeFilters(filters || {});
  const desc = f.sort === 'desc';
  const cursor = decodeCursor(f.cursor);
  const take = f.limit + 1 + TIE_SLACK;
  const need = f.limit + 1;
  const maxChunks = Math.max(1, Number(opts.maxChunksPerSource) || MAX_SOURCE_CHUNKS);
  const available = !!prisma.projectLogEvent;
  const keep = (r) => afterCursor(r, cursor, desc) && passesInMemory(r, f);

  const wanted = (s) => sourceEnabled(f, s);
  const cutover = wanted('screen_audit') ? await cutoverAt(scope) : null;

  const readers = [];
  if (wanted('logbook')) readers.push((seek, t) => readNative(scope, f, cursor, t, seek));
  if (wanted('screen_audit')) readers.push((seek, t) => readScreenAudit(scope, f, cursor, t, cutover, seek));
  if (wanted('project_event')) readers.push((seek, t) => readProjectEvent(scope, f, cursor, t, seek));
  if (wanted('extraction_audit')) {
    readers.push((seek, t) => readSimpleAudit(prisma.extractionAuditLog, 'extraction_audit', classifyExtractionAuditAction, scope, f, cursor, t, seek));
  }
  if (wanted('rob_audit')) {
    readers.push((seek, t) => readSimpleAudit(prisma.robAuditLog, 'rob_audit', classifyRobAuditAction, scope, f, cursor, t, seek));
  }

  const drained = await Promise.all(readers.map((read) => drainSource(read, keep, { need, take, maxChunks })));

  const cmp = comparator(desc);
  // THE SAFE FRONTIER — the shallowest point any still-unfinished source stopped
  // reading at. Everything before it has been read by EVERY source, so it is
  // exactly how far this page may reach: emitting a deeper row would jump over
  // rows another source has not looked at yet, and the cursor would then skip them
  // forever. Null once every source is exhausted, i.e. the history really ended.
  const frontiers = drained.map((d) => d.frontier).filter(Boolean).sort(cmp);
  const boundary = frontiers[0] || null;
  const reached = drained.flatMap((d) => d.rows).sort(cmp)
    .filter((r) => !boundary || cmp(r, boundary) <= 0);

  const overflow = reached.length > f.limit;
  const page = overflow ? reached.slice(0, f.limit) : reached;
  const last = page[page.length - 1] || null;
  // hasMore / nextCursor never claim a completeness nobody verified: an unfinished
  // source means there is more to look at even when this page came back short, and
  // the cursor then resumes at the scan frontier so the next page makes real
  // progress instead of re-reading the same rows.
  const hasMore = overflow || !!boundary;
  // MONOTONICITY GUARD (r2). Every source now resumes STRICTLY past the cursor
  // (cursorWhere), so both candidates below are strictly ahead of it by construction.
  // This keeps that an enforced invariant rather than a reasoned-about one: a cursor
  // that sorted at-or-before the request cursor would walk the pager BACKWARDS and
  // re-emit rows the caller has already seen. Standing still is bad; going backwards
  // and duplicating rows is worse, so a non-advancing candidate is refused.
  const candidate = overflow && last ? last : boundary;
  const advances = candidate && afterCursor(candidate, cursor, desc);
  const nextCursor = hasMore ? (advances ? encodeCursor(candidate) : f.cursor || null) : null;

  return {
    available,
    events: page.map(stripInternals),
    nextCursor,
    hasMore,
    scanIncomplete: hasMore && page.length < f.limit,
    scanChunks: drained.reduce((n, d) => n + d.chunks, 0),
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
 * Returns { rows, truncated, incomplete } so the caller can state honestly that a
 * very large Logbook was capped rather than silently shipping a partial file.
 *   `truncated`  the file stops before the end of the matching history.
 *   `incomplete` it stops because the SCAN BUDGET ran out (a selective filter over
 *                deep legacy history), not because the row cap was reached — the
 *                distinction matters: the row cap is a number the operator can
 *                reason about, the scan budget is "we stopped looking".
 */
export async function collectForExport(scope, filters) {
  const base = { ...(filters && filters.limit ? filters : normalizeFilters(filters || {})), limit: MAX_LIMIT };
  const rows = [];
  let cursor = base.cursor;
  let guard = 0;
  let chunks = 0;
  while (rows.length < EXPORT_MAX_ROWS && guard < 1 + Math.ceil(EXPORT_MAX_ROWS / MAX_LIMIT)) {
    guard += 1;
    const page = await listLogbook(scope, { ...base, cursor });
    rows.push(...page.events);
    chunks += page.scanChunks || 0;
    if (!page.nextCursor) return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: false, incomplete: false };
    cursor = page.nextCursor;
    if (chunks >= EXPORT_SCAN_CHUNKS) return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: true, incomplete: true };
  }
  return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: true, incomplete: false };
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
  DEFAULT_LIMIT, MAX_LIMIT, MAX_SOURCE_CHUNKS, EXPORT_MAX_ROWS, EXPORT_SCAN_CHUNKS, CSV_COLUMNS,
};
