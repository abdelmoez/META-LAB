/**
 * server/provenance/provenanceService.js — 88.md Part IV/IX. Read + light-write
 * operations over the ProjectEvent ledger: paginated/filtered listing, a milestone
 * summary, the honest legacy-project BASELINE event, controlled reason amendment,
 * and admin soft-invalidation. The ledger stays append-only: reasons may be FILLED
 * (empty→value) and events may be soft-invalidated, but before/after values and
 * event bodies are never rewritten or hard-deleted.
 */
import { prisma } from '../db/client.js';
import { recordEvent, ledgerAvailable } from './recordEvent.js';
import { deriveScientificState, SIGNIFICANCE } from '../../src/research-engine/provenance/index.js';

const parseJson = (s, fallback) => { try { return JSON.parse(s == null ? 'null' : s) ?? fallback; } catch { return fallback; } };

/** Map a Prisma row → the client event shape (JSON fields parsed back). */
export function toClientEvent(r) {
  return {
    id: r.id,
    projectRev: r.projectRev,
    eventType: r.eventType,
    category: r.category,
    subtype: r.subtype,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    actorRole: r.actorRole,
    origin: r.origin,
    at: r.serverTs,
    clientTs: r.clientTs,
    stage: r.projectStage,
    module: r.module,
    entityType: r.entityType,
    entityId: r.entityId,
    parentEntityId: r.parentEntityId,
    prevValue: parseJson(r.prevValue, null),
    newValue: parseJson(r.newValue, null),
    diff: parseJson(r.diff, {}),
    reason: r.reason,
    correlationId: r.correlationId,
    relatedOutcome: r.relatedOutcome,
    relatedStudy: r.relatedStudy,
    relatedAnalysis: r.relatedAnalysis,
    significance: r.significance,
    manuscriptSections: parseJson(r.manuscriptSections, []),
    resultImpact: r.resultImpact,
    requiresRecalc: r.requiresRecalc,
    requiresManuscriptRefresh: r.requiresManuscriptRefresh,
    requiresReview: r.requiresReview,
    supersedesEventId: r.supersedesEventId,
    reconstructed: r.reconstructed,
    invalidated: r.invalidated,
    metadata: parseJson(r.metadata, {}),
  };
}

const FILTER_PRESETS = {
  scientific: (w) => { w.significance = { gte: SIGNIFICANCE.DATA_CORRECTION }; },
  manuscript: (w) => { w.requiresManuscriptRefresh = true; },
  deviations: (w) => { w.significance = { gte: SIGNIFICANCE.CRITICAL }; },
  search: (w) => { w.module = 'search'; },
  screening: (w) => { w.module = 'screening'; },
  extraction: (w) => { w.module = 'extraction'; },
  rob: (w) => { w.module = 'rob'; },
  analysis: (w) => { w.module = 'analysis'; },
};

/**
 * listEvents(projectId, opts) — most-recent-first, paginated + filtered.
 * @param {object} opts { filter, category, module, eventType, actorUserId, minSignificance,
 *                        cursor(id), limit, includeInvalidated }
 */
export async function listEvents(projectId, opts = {}) {
  if (!ledgerAvailable()) return { events: [], nextCursor: null, available: false };
  const where = { projectId: String(projectId || '') };
  if (!opts.includeInvalidated) where.invalidated = false;
  const preset = FILTER_PRESETS[opts.filter];
  if (preset) preset(where);
  if (opts.category) where.category = String(opts.category);
  if (opts.module) where.module = String(opts.module);
  if (opts.eventType) where.eventType = String(opts.eventType);
  if (opts.actorUserId) where.actorUserId = String(opts.actorUserId);
  if (opts.minSignificance != null) where.significance = { gte: Number(opts.minSignificance) };
  if (opts.cursor) where.id = { lt: Number(opts.cursor) };

  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const rows = await prisma.projectEvent.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    events: page.map(toClientEvent),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    available: true,
  };
}

/** summary(projectId) — counts by category/significance + recent deviations + milestones. */
export async function summary(projectId, projectData) {
  if (!ledgerAvailable()) return { available: false };
  const pid = String(projectId || '');
  const [total, byCat, bySig, deviations, manuscriptImpacting, lastEvent] = await Promise.all([
    prisma.projectEvent.count({ where: { projectId: pid, invalidated: false } }),
    prisma.projectEvent.groupBy({ by: ['category'], where: { projectId: pid, invalidated: false }, _count: true }),
    prisma.projectEvent.groupBy({ by: ['significance'], where: { projectId: pid, invalidated: false }, _count: true }),
    prisma.projectEvent.findMany({ where: { projectId: pid, invalidated: false, significance: { gte: SIGNIFICANCE.CRITICAL } }, orderBy: { id: 'desc' }, take: 20 }),
    prisma.projectEvent.count({ where: { projectId: pid, invalidated: false, requiresManuscriptRefresh: true } }),
    prisma.projectEvent.findFirst({ where: { projectId: pid, invalidated: false }, orderBy: { id: 'desc' } }),
  ]);
  const recentEvents = deviations.map(toClientEvent);
  const state = projectData ? deriveScientificState(projectData, recentEvents) : null;
  return {
    available: true,
    total,
    byCategory: Object.fromEntries(byCat.map((r) => [r.category, r._count])),
    bySignificance: Object.fromEntries(bySig.map((r) => [r.significance, r._count])),
    manuscriptImpacting,
    potentialDeviations: recentEvents,
    lastEventAt: lastEvent ? lastEvent.serverTs : null,
    derivedState: state,
  };
}

/**
 * baselineProject(projectId, projectData, ctx) — 88.md Part IX. Write ONE honest
 * PROJECT_STATE_BASELINE event capturing the CURRENT derived state for a project
 * that predates the ledger. Marked reconstructed=true. Never fabricates history;
 * idempotent (skips if a baseline already exists).
 */
export async function baselineProject(projectId, projectData, ctx = {}) {
  if (!ledgerAvailable()) return { created: false, reason: 'ledger-unavailable' };
  const pid = String(projectId || '');
  const existing = await prisma.projectEvent.findFirst({ where: { projectId: pid, eventType: 'PROJECT_STATE_BASELINE' } });
  if (existing) return { created: false, reason: 'already-baselined', eventId: existing.id };

  const state = deriveScientificState(projectData || {}, []);
  const reconstructable = [];
  const notReconstructable = [];
  if (state.search.databases.length) reconstructable.push('search databases + methods'); else notReconstructable.push('search history');
  if (state.extraction.studyCount) reconstructable.push(`${state.extraction.studyCount} extracted studies (current values only)`);
  if (state.analysis.model) reconstructable.push('current analysis settings'); else notReconstructable.push('analysis history');
  notReconstructable.push('who/when of every pre-baseline change');

  const row = await recordEvent({
    eventType: 'PROJECT_STATE_BASELINE',
    entityType: 'project',
    entityId: pid,
    // Deterministic idempotency key so two concurrent first-loads cannot both write a
    // baseline — the second hits the unique constraint (P2002) and no-ops.
    idempotencyKey: `baseline:${pid}`,
    newValue: state,
    diff: { kind: 'baseline' },
    metadata: {
      reconstructable, notReconstructable,
      note: 'Project existed before comprehensive provenance tracking. This baseline records the CURRENT effective state only; earlier per-change history could not be reconstructed and was NOT fabricated.',
    },
  }, { ...ctx, projectId: pid, reconstructed: true, origin: 'migration', keepOperational: true });
  return { created: !!row, eventId: row ? row.id : null, reconstructable, notReconstructable };
}

/** Ensure a baseline exists (called lazily on first History load of a legacy project). */
export async function ensureBaseline(projectId, projectData, ctx = {}) {
  if (!ledgerAvailable()) return { created: false };
  const pid = String(projectId || '');
  const count = await prisma.projectEvent.count({ where: { projectId: pid } });
  if (count > 0) return { created: false, reason: 'has-events' };
  return baselineProject(pid, projectData, ctx);
}

/**
 * addReason(eventId, reason, ctx) — controlled amendment: fill a MISSING reason only
 * (never overwrite an existing one — append-only integrity). Permission: a project
 * LEADER may annotate any event; a non-leader may annotate only their OWN event
 * (ev.actorUserId === ctx.actorUserId). The final write is a conditional updateMany
 * (reason still empty) so two concurrent fills cannot clobber each other (TOCTOU-safe).
 * Records who/when in metadata.
 */
export async function addReason(eventId, reason, ctx = {}) {
  if (!ledgerAvailable()) return { updated: false };
  const id = Number(eventId);
  const ev = await prisma.projectEvent.findUnique({ where: { id } });
  if (!ev) return { updated: false, reason: 'not-found' };
  const isOwnActor = !!ev.actorUserId && ev.actorUserId === ctx.actorUserId;
  if (!ctx.isLeader && !isOwnActor) return { updated: false, reason: 'forbidden' };
  if (ev.reason && ev.reason.trim()) return { updated: false, reason: 'already-has-reason' };
  const meta = parseJson(ev.metadata, {});
  meta.reasonAddedBy = String(ctx.actorUserId || '');
  meta.reasonAddedByName = String(ctx.actorName || '');
  meta.reasonAddedAt = new Date().toISOString();
  // TOCTOU-safe: only fill while the reason is STILL empty. count 0 ⇒ someone won the race.
  const res = await prisma.projectEvent.updateMany({
    where: { id, OR: [{ reason: null }, { reason: '' }] },
    data: { reason: String(reason || '').slice(0, 2000), metadata: JSON.stringify(meta).slice(0, 6000) },
  });
  if (!res || res.count !== 1) return { updated: false, reason: 'already-has-reason' };
  return { updated: true };
}

/** invalidateEvent(eventId, ctx) — admin/leader soft-invalidate (never hard-delete). */
export async function invalidateEvent(eventId, ctx = {}) {
  if (!ledgerAvailable()) return { updated: false };
  const id = Number(eventId);
  const ev = await prisma.projectEvent.findUnique({ where: { id } });
  if (!ev) return { updated: false, reason: 'not-found' };
  const meta = parseJson(ev.metadata, {});
  meta.invalidatedBy = String(ctx.actorUserId || '');
  meta.invalidatedReason = String(ctx.reason || '').slice(0, 500);
  meta.invalidatedAt = new Date().toISOString();
  await prisma.projectEvent.update({ where: { id }, data: { invalidated: true, metadata: JSON.stringify(meta).slice(0, 6000) } });
  return { updated: true };
}

export default { listEvents, summary, baselineProject, ensureBaseline, addReason, invalidateEvent, toClientEvent };
