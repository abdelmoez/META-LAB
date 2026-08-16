/**
 * server/logbook/logbookService.js — 119.md §8. THE single writer for the
 * append-only ProjectLogEvent table (the project Logbook).
 *
 * Nothing else in the codebase may insert into ProjectLogEvent. Every engine
 * calls one of:
 *   recordLogEvent(draft, ctx)      best-effort (never throws) + outbox retry
 *   recordLogEventTx(db, draft, ctx) INSIDE a caller's transaction — THROWS, so
 *                                   a failed audit rolls the mutation back
 *   withLoggedTransaction(fn, draft) run a mutation + its audit atomically
 *   recordEditSession(...)          coalesced typing/autosave sessions
 *
 * 119.md §8 "Critical actions should be logged transactionally or through a
 * reliable outbox/event mechanism so a successful project mutation cannot
 * silently lose its audit record."  Two mechanisms, deliberately:
 *
 *   TRANSACTIONAL — for critical writes whose mutation is already in a Prisma
 *   interactive transaction (membership, ownership, project lifecycle). The log
 *   row is written with the SAME tx client, so mutation+audit commit or abort
 *   together. This is the strong guarantee and is preferred wherever the caller
 *   can afford a transaction.
 *
 *   OUTBOX — for everything else (and as the failure path of the best-effort
 *   writer). A row that fails to insert is parked in a bounded in-process queue
 *   and retried on the next write / on flushOutbox(). LIMITATION, stated
 *   honestly: this queue is in memory, so a process crash between the mutation
 *   and the retry loses that row. It is NOT used for the critical actions above
 *   — those take the transactional path.
 *
 * GRACEFUL DEGRADE: if the Prisma client predates the ProjectLogEvent model
 * (`prisma.projectLogEvent` undefined — i.e. before `prisma generate && db
 * push`), every function no-ops instead of throwing, so the feature ships dark
 * and lights up after the standard migration step (recordEvent.js precedent).
 */
import { prisma } from '../db/client.js';
import { sanitizeValue } from '../../src/research-engine/provenance/index.js';
import { actionSpec, humaniseAction, LOG_SEVERITY } from './vocabulary.js';

/** Per-JSON-field cap. Matches recordEvent.js (audit-survival, bounded rows). */
const MAX_JSON = 6000;
const MAX_SUMMARY = 500;
const MAX_SEARCH_TEXT = 700;

const jstr = (v, fallback = null) => {
  try { return JSON.stringify(v === undefined ? fallback : v).slice(0, MAX_JSON); }
  catch { return JSON.stringify(fallback); }
};
const clip = (v, n = 200) => (v == null || v === '' ? null : String(v).slice(0, n));
const str = (v, n = 200) => String(v == null ? '' : v).slice(0, n);

/** Is the Logbook table available in the current Prisma client? */
export function logbookAvailable(db = prisma) {
  return !!(db && db.projectLogEvent && typeof db.projectLogEvent.create === 'function');
}

/* ══════════════════ dual project identity resolution ══════════════════════ */

/**
 * ScreenProject.id ⟷ Project.id (META·LAB) are two id spaces (see the schema
 * comment on ProjectLogEvent). A writer usually knows only one. Resolving the
 * counterpart makes the row visible from BOTH Logbook entry points.
 *
 * Cached for RESOLVE_TTL_MS because the link changes rarely and a log write must
 * never add a round-trip to a hot path (e.g. every PDF range request).
 */
const RESOLVE_TTL_MS = 60_000;
const RESOLVE_CACHE_MAX = 500;
const linkCache = new Map(); // key -> { at, screenProjectId, metaLabProjectId }

/** Test seam — drop the memoised project-link lookups. */
export function _resetLinkCache() { linkCache.clear(); }

function cacheGet(key) {
  const hit = linkCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESOLVE_TTL_MS) { linkCache.delete(key); return null; }
  return hit;
}
function cacheSet(key, value) {
  if (linkCache.size >= RESOLVE_CACHE_MAX) linkCache.clear(); // bounded, cheapest eviction
  linkCache.set(key, { at: Date.now(), ...value });
}

/**
 * resolveScope({ projectId, metaLabProjectId }) → { projectId, metaLabProjectId }
 * with the missing side filled in when it can be resolved cheaply. Never throws;
 * an unresolvable counterpart stays '' (the row is still queryable by the id we
 * DO have — the reader ORs over both columns).
 */
export async function resolveScope(scope = {}) {
  let projectId = str(scope.projectId, 200);
  let metaLabProjectId = str(scope.metaLabProjectId, 200);
  if ((projectId && metaLabProjectId) || (!projectId && !metaLabProjectId)) {
    return { projectId, metaLabProjectId };
  }
  const key = projectId ? `sp:${projectId}` : `ml:${metaLabProjectId}`;
  const hit = cacheGet(key);
  if (hit) return { projectId: hit.screenProjectId || projectId, metaLabProjectId: hit.metaLabProjectId || metaLabProjectId };
  try {
    if (projectId) {
      const sp = await prisma.screenProject.findUnique({
        where: { id: projectId }, select: { linkedMetaLabProjectId: true },
      });
      metaLabProjectId = str(sp?.linkedMetaLabProjectId || '', 200);
    } else {
      const sp = await prisma.screenProject.findFirst({
        where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null }, select: { id: true },
      });
      projectId = str(sp?.id || '', 200);
    }
  } catch { /* resolution is an optimisation — never fail the write */ }
  cacheSet(key, { screenProjectId: projectId, metaLabProjectId });
  return { projectId, metaLabProjectId };
}

/**
 * logbookActor(req, access, scope) — build the writer ctx from an Express
 * request + a resolved getProjectAccess result. ONE place decides how an actor
 * is denormalised, so "actor display name AT THE TIME" and "role at the time"
 * (119.md §8) are captured consistently by every call site.
 *
 * @param {object} req    Express request (uses req.user + x-request-id only)
 * @param {object} access getProjectAccess()/mlAccess result, or null
 * @param {object} scope  { projectId?, metaLabProjectId? }
 */
export function logbookActor(req, access, scope = {}) {
  return {
    actorId: req?.user?.id || '',
    actorName: req?.user?.name || req?.user?.email || '',
    actorRole: access?.role || (access?.isOwner ? 'owner' : ''),
    actorType: 'user',
    opId: clip(req?.headers?.['x-request-id'], 120) || undefined,
    projectId: str(scope.projectId, 200),
    metaLabProjectId: str(scope.metaLabProjectId, 200),
  };
}

/**
 * resolveActorIdentity(userId) — ctx for a writer that only has a user id (the
 * autosave path). 119.md §8 wants the actor's DISPLAY NAME AT THE TIME, so the
 * name is denormalised into the row; the lookup is memoised for RESOLVE_TTL_MS
 * so an autosave never pays for it twice. Role stays '' — this seam genuinely
 * does not know it, and an invented role would be worse than an absent one.
 */
export async function resolveActorIdentity(userId) {
  const id = str(userId, 200);
  if (!id) return { actorId: '', actorName: '', actorRole: '', actorType: 'system' };
  const key = `user:${id}`;
  const hit = cacheGet(key);
  if (hit) return { actorId: id, actorName: hit.actorName || '', actorRole: '', actorType: 'user' };
  let actorName = '';
  try {
    const u = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
    actorName = str(u?.name || u?.email || '', 200);
  } catch { /* an unresolvable name is '' — never a guess */ }
  cacheSet(key, { actorName });
  return { actorId: id, actorName, actorRole: '', actorType: 'user' };
}

/** systemActor(scope, name) — ctx for a background job / automation writer. */
export function systemActor(scope = {}, name = 'System') {
  return {
    actorId: 'system', actorName: name, actorRole: 'system', actorType: 'system', via: 'system',
    projectId: str(scope.projectId, 200), metaLabProjectId: str(scope.metaLabProjectId, 200),
  };
}

/* ══════════════════════════ row construction ═════════════════════════════ */

/**
 * buildLogRow(draft, ctx) — pure-ish (string/JSON coercion only). Exported for
 * the transactional path and for tests.
 *
 * @param {object} draft {
 *   action (REQUIRED), summary, engine, actionCategory, severity,
 *   resourceType, resourceId, resourceLabel, before, after, status, via,
 *   opId, correlationId, sessionId, relatedEventId, metadata, mirrors,
 *   idempotencyKey, clientTs }
 * @param {object} ctx { projectId, metaLabProjectId, actorId, actorName,
 *   actorRole, actorType, via, opId, correlationId, sessionId }
 */
export function buildLogRow(draft, ctx = {}) {
  const action = str(draft?.action, 120);
  const spec = actionSpec(action);
  const engine = str(draft.engine || spec?.engine || 'core', 40);
  const category = str(draft.actionCategory || spec?.category || 'update', 40);
  const summary = str(draft.summary || spec?.label || humaniseAction(action), MAX_SUMMARY);
  const resourceLabel = clip(draft.resourceLabel, 300);
  const severity = Number.isFinite(Number(draft.severity))
    ? Math.max(0, Math.min(5, Number(draft.severity)))
    : (spec ? spec.severity : LOG_SEVERITY.ROUTINE);

  // 119.md §8 "Search" must behave identically on SQLite (LIKE is ASCII
  // case-insensitive) and Postgres (LIKE is case-SENSITIVE). Storing a folded
  // copy makes `contains` deterministic on both instead of engine-dependent.
  const searchText = `${summary} ${resourceLabel || ''} ${action} ${str(ctx.actorName || draft.actorName, 200)}`
    .toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_TEXT);

  return {
    projectId: str(ctx.projectId ?? draft.projectId, 200),
    metaLabProjectId: str(ctx.metaLabProjectId ?? draft.metaLabProjectId, 200),
    clientTs: ctx.clientTs || draft.clientTs ? new Date(ctx.clientTs || draft.clientTs) : null,
    actorId: str(ctx.actorId ?? draft.actorId, 200),
    actorName: str(ctx.actorName ?? draft.actorName, 200),
    actorRole: str(ctx.actorRole ?? draft.actorRole, 60),
    actorType: str(ctx.actorType || draft.actorType || 'user', 20),
    engine,
    action,
    actionCategory: category,
    summary,
    resourceType: clip(draft.resourceType, 60),
    resourceId: clip(draft.resourceId, 200),
    resourceLabel,
    // Sanitised: sanitizeValue redacts token/secret-shaped keys and truncates
    // oversized strings/arrays, so a Logbook row can never carry a credential
    // (119.md §8 "Do not store passwords, authentication tokens, secrets…").
    beforeSummary: jstr(sanitizeValue(draft.before ?? null)),
    afterSummary: jstr(sanitizeValue(draft.after ?? null)),
    status: str(draft.status || 'success', 20),
    via: str(draft.via || ctx.via || 'user', 20),
    opId: clip(draft.opId || ctx.opId, 120),
    correlationId: clip(draft.correlationId || ctx.correlationId, 120),
    sessionId: clip(draft.sessionId || ctx.sessionId, 120),
    relatedEventId: draft.relatedEventId != null ? Number(draft.relatedEventId) : null,
    severity,
    searchText,
    mirrors: str(draft.mirrors || '', 40),
    metadata: jstr(sanitizeValue(draft.metadata ?? {}), {}),
    schemaVersion: 1,
    idempotencyKey: clip(draft.idempotencyKey, 200),
  };
}

/* ═══════════════════════════════ outbox ══════════════════════════════════ */

const OUTBOX_MAX = 200;
const outbox = [];
let outboxDropped = 0;

/** Diagnostics / tests. */
export function outboxSize() { return outbox.length; }
export function outboxDroppedCount() { return outboxDropped; }
export function _resetOutbox() { outbox.length = 0; outboxDropped = 0; }

function enqueueOutbox(row) {
  if (outbox.length >= OUTBOX_MAX) { outbox.shift(); outboxDropped += 1; }
  outbox.push(row);
}

/**
 * flushOutbox() — retry parked rows, oldest first. Stops at the first failure so
 * a persistently-broken DB does not spin. Returns the number of rows written.
 */
export async function flushOutbox() {
  if (!outbox.length || !logbookAvailable()) return 0;
  let written = 0;
  while (outbox.length) {
    const row = outbox[0];
    try {
      await prisma.projectLogEvent.create({ data: row });
      outbox.shift();
      written += 1;
    } catch (e) {
      if (e && e.code === 'P2002') { outbox.shift(); continue; } // already landed — drop
      break; // still broken; keep the rest parked for the next attempt
    }
  }
  return written;
}

/* ═══════════════════════ leaders-only live poke ══════════════════════════ */

/**
 * 119.md §8 — "Real-time subscriptions" is one of the layers the Owner/Leader
 * rule must be enforced at. New Logbook activity pokes ONLY owner+leaders
 * (bus.emitToProjectLeaders resolves the recipient set from the DB at emit
 * time). Throttled per project so a bulk operation writing hundreds of rows
 * still produces at most one poke per POKE_THROTTLE_MS; the payload is
 * content-free, so the client refetches through the authorized endpoint.
 */
const POKE_THROTTLE_MS = 4000;
const lastPoke = new Map(); // screenProjectId -> epoch ms

export function _resetPokes() { lastPoke.clear(); }

function pokeLeaders(screenProjectId) {
  if (!screenProjectId) return;
  const now = Date.now();
  const prev = lastPoke.get(screenProjectId) || 0;
  if (now - prev < POKE_THROTTLE_MS) return;
  lastPoke.set(screenProjectId, now);
  if (lastPoke.size > 500) lastPoke.clear();
  import('../realtime/bus.js')
    .then((m) => m.emitToProjectLeaders(screenProjectId, { type: 'logbook.updated' }))
    .catch(() => { /* pokes are best-effort */ });
}

/* ══════════════════════════════ writers ══════════════════════════════════ */

/**
 * recordLogEvent(draft, ctx) — best-effort append. Returns the created row or
 * null. NEVER throws: an audit failure must not break the action it describes.
 * A failed insert is parked in the outbox and retried on the next call.
 */
export async function recordLogEvent(draft, ctx = {}) {
  if (!logbookAvailable()) return null;
  if (!draft || !draft.action) return null;
  const scope = await resolveScope({
    projectId: ctx.projectId ?? draft.projectId,
    metaLabProjectId: ctx.metaLabProjectId ?? draft.metaLabProjectId,
  });
  const row = buildLogRow(draft, { ...ctx, ...scope });
  if (!row.projectId && !row.metaLabProjectId) return null; // unscoped rows are unreadable — drop
  try {
    const created = await prisma.projectLogEvent.create({ data: row });
    if (outbox.length) void flushOutbox().catch(() => {});
    pokeLeaders(row.projectId);
    return created;
  } catch (e) {
    // A duplicate idempotencyKey is an expected no-op (retried submission).
    if (e && e.code === 'P2002') return null;
    console.error('[logbook] write failed, parked in outbox:', e?.message || e);
    enqueueOutbox(row);
    return null;
  }
}

/** recordLogEvents(drafts, ctx) — best-effort batch under one correlationId. */
export async function recordLogEvents(drafts, ctx = {}) {
  const list = (Array.isArray(drafts) ? drafts : []).filter((d) => d && d.action);
  if (!list.length) return 0;
  let n = 0;
  for (const d of list) { if (await recordLogEvent(d, ctx)) n += 1; }
  return n;
}

/**
 * recordLogEventTx(db, draft, ctx) — the TRANSACTIONAL path (119.md §8). `db` is
 * an interactive `$transaction` client, so the log row commits with the mutation
 * or not at all. THROWS on failure BY DESIGN: a critical mutation that cannot be
 * audited must not commit.
 *
 * The one exception is the pre-migration degrade (table absent) — there is
 * nothing to roll back to and the whole feature is dark, so it no-ops.
 */
export async function recordLogEventTx(db, draft, ctx = {}) {
  if (!logbookAvailable(db)) return null;
  if (!draft || !draft.action) return null;
  const row = buildLogRow(draft, ctx);
  if (!row.projectId && !row.metaLabProjectId) return null;
  try {
    return await db.projectLogEvent.create({ data: row });
  } catch (e) {
    if (e && e.code === 'P2002') return null; // idempotent replay — not a failure
    throw e;
  }
}

/**
 * withLoggedTransaction(mutate, draft, ctx) — run `mutate(tx)` and append its
 * Logbook row in ONE interactive transaction (mutateWithEvents.js precedent).
 * The draft may be a function (result) => draft so the summary can describe what
 * actually happened. Returns the mutation's result.
 */
export async function withLoggedTransaction(mutate, draft, ctx = {}) {
  const scope = await resolveScope({ projectId: ctx.projectId, metaLabProjectId: ctx.metaLabProjectId });
  return prisma.$transaction(async (tx) => {
    const result = await mutate(tx);
    const d = typeof draft === 'function' ? draft(result) : draft;
    if (d) await recordLogEventTx(tx, d, { ...ctx, ...scope });
    return result;
  });
}

/* ═════════════════ coalesced sessions (typing / range reads) ══════════════ */

/**
 * 119.md §8: "Manuscript typing can be grouped into useful autosave/edit-session
 * events with a readable diff or summary while still maintaining a complete
 * revision history." Also used for PDF range requests, where a single reader
 * opening one document emits dozens of HTTP requests.
 *
 * A session is keyed by (scope, actor, action, resource). Within
 * SESSION_WINDOW_MS the FIRST call writes one row; later calls UPDATE that row's
 * metadata counters instead of appending. That update is the ONE place the table
 * is written twice — it never rewrites what happened, only the "…and N more
 * within this session" counters, and it stops at the window boundary.
 */
const SESSION_WINDOW_MS = 5 * 60 * 1000;
const SESSION_MAX = 500;
const sessions = new Map(); // key -> { id, startedAt, lastAt, count, sections:Set }

export function _resetSessions() { sessions.clear(); }

function sessionKey(scope, actorId, action, resourceId) {
  return `${scope.projectId}|${scope.metaLabProjectId}|${actorId}|${action}|${resourceId || ''}`;
}

/**
 * recordSessionEvent(draft, ctx) — append-or-extend a coalesced session row.
 * Best-effort, never throws. `draft.sessionParts` (string[]) accumulates the
 * distinct things touched (e.g. manuscript section ids) into the summary.
 */
export async function recordSessionEvent(draft, ctx = {}) {
  if (!logbookAvailable()) return null;
  if (!draft || !draft.action) return null;
  const scope = await resolveScope({
    projectId: ctx.projectId ?? draft.projectId,
    metaLabProjectId: ctx.metaLabProjectId ?? draft.metaLabProjectId,
  });
  if (!scope.projectId && !scope.metaLabProjectId) return null;
  const actorId = str(ctx.actorId ?? draft.actorId, 200);
  const key = sessionKey(scope, actorId, draft.action, draft.resourceId);
  const now = Date.now();
  const open = sessions.get(key);
  const parts = Array.isArray(draft.sessionParts) ? draft.sessionParts.map((p) => str(p, 80)) : [];

  if (open && now - open.lastAt <= SESSION_WINDOW_MS) {
    open.lastAt = now;
    open.count += 1;
    for (const p of parts) open.parts.add(p);
    try {
      await prisma.projectLogEvent.update({
        where: { id: open.id },
        data: {
          summary: str(sessionSummary(draft, open), MAX_SUMMARY),
          // Key names deliberately avoid the sanitizer's redaction vocabulary
          // (/session|token|email|…/) — a counter must survive sanitisation.
          metadata: jstr(sanitizeValue({
            ...(draft.metadata || {}),
            eventCount: open.count,
            startedAt: new Date(open.startedAt).toISOString(),
            endedAt: new Date(open.lastAt).toISOString(),
            parts: [...open.parts].slice(0, 40),
          }), {}),
        },
      });
    } catch { /* the row still exists and is honest without the counter bump */ }
    return { id: open.id, coalesced: true };
  }

  const created = await recordLogEvent({
    ...draft,
    correlationId: draft.correlationId || `session:${key.slice(0, 100)}:${now}`,
    metadata: { ...(draft.metadata || {}), eventCount: 1, parts: parts.slice(0, 40) },
  }, ctx);
  if (!created) return null;
  if (sessions.size >= SESSION_MAX) sessions.clear();
  sessions.set(key, { id: created.id, startedAt: now, lastAt: now, count: 1, parts: new Set(parts) });
  return { id: created.id, coalesced: false };
}

function sessionSummary(draft, open) {
  const base = draft.summary || actionSpec(draft.action)?.label || humaniseAction(draft.action);
  const parts = [...open.parts];
  const detail = parts.length ? ` — ${parts.slice(0, 6).join(', ')}${parts.length > 6 ? `, +${parts.length - 6} more` : ''}` : '';
  return `${base}${detail} (${open.count} changes in this session)`;
}

export default {
  logbookAvailable, buildLogRow, resolveScope, logbookActor, systemActor, resolveActorIdentity,
  recordLogEvent, recordLogEvents, recordLogEventTx, withLoggedTransaction,
  recordSessionEvent, flushOutbox, outboxSize, outboxDroppedCount,
};
