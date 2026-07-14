/**
 * server/provenance/recordEvent.js — 88.md Part I/VIII. The ONE writer for the
 * append-only ProjectEvent ledger. Classifies each draft with the pure engine
 * (significance / manuscript sections / impact flags are COMPUTED, never free-text),
 * sanitises + bounds values, denormalises the actor (audit-survival, no FK), and
 * inserts. Best-effort by default (an audit failure must never break the action);
 * callers that need atomicity use mutateWithEvents.js instead.
 *
 * GRACEFUL DEGRADE: if the Prisma client has not been regenerated with the
 * ProjectEvent model yet (`prisma.projectEvent` undefined — i.e. before the deploy
 * `prisma generate && db push`), every function no-ops instead of throwing, so the
 * feature can ship dark and light up after the standard migration step.
 */
import { prisma } from '../db/client.js';
import { classifyDraft, sanitizeValue } from '../../src/research-engine/provenance/index.js';

const MAX_JSON = 6000; // per-field JSON cap (audit-survival; bigger than the 4000 of legacy per-domain logs)

const jstr = (v, fallback) => {
  try { return JSON.stringify(v == null ? (fallback === undefined ? null : fallback) : v).slice(0, MAX_JSON); }
  catch { return JSON.stringify(fallback === undefined ? null : fallback); }
};
const clip = (v, n = 500) => (v == null ? null : String(v).slice(0, n));

/** Is the ledger table available in the current Prisma client? */
export function ledgerAvailable() {
  return !!(prisma && prisma.projectEvent && typeof prisma.projectEvent.create === 'function');
}

/**
 * Turn a classified draft + context into the flat Prisma `data` row. Pure-ish
 * (only string/JSON coercion). Exposed for the atomic path (mutateWithEvents) and tests.
 * @param {object} draft   an event draft (from emit.js or a hand-built one) — MUST have eventType
 * @param {object} ctx     { projectId, projectRev, actorUserId, actorName, actorRole, sessionId,
 *                           correlationId, clientTs, jobId, reconstructed, numericChange }
 */
export function buildEventRow(draft, ctx = {}) {
  const c = classifyDraft(draft, { numericChange: ctx.numericChange });
  return {
    projectId: String(ctx.projectId || draft.projectId || ''),
    projectRev: Number(ctx.projectRev != null ? ctx.projectRev : (draft.projectRev || 0)) || 0,
    eventType: String(draft.eventType || 'UNKNOWN'),
    category: String(c.category || 'project_config'),
    subtype: clip(draft.subtype, 120),
    actorUserId: String(ctx.actorUserId || draft.actorUserId || ''),
    actorName: String(ctx.actorName || draft.actorName || ''),
    actorRole: String(ctx.actorRole || draft.actorRole || ''),
    origin: String(draft.origin || ctx.origin || c.origin || 'user_action'),
    clientTs: ctx.clientTs ? new Date(ctx.clientTs) : null,
    projectStage: clip(c.stage, 40),
    module: clip(c.module, 40),
    entityType: clip(draft.entityType, 60),
    entityId: clip(draft.entityId, 200),
    parentEntityId: clip(draft.parentEntityId, 200),
    prevValue: jstr(sanitizeValue(draft.prevValue), null),
    newValue: jstr(sanitizeValue(draft.newValue), null),
    diff: jstr(draft.diff, {}),
    reason: clip(draft.reason || ctx.reason, 2000),
    correlationId: clip(draft.correlationId || ctx.correlationId, 120),
    sessionId: clip(ctx.sessionId || draft.sessionId, 120),
    jobId: clip(ctx.jobId || draft.jobId, 120),
    relatedOutcome: clip(draft.relatedOutcome, 200),
    relatedStudy: clip(draft.relatedStudy || (draft.entityType === 'study' ? draft.entityId : null), 200),
    relatedAnalysis: clip(draft.relatedAnalysis, 200),
    significance: Number(c.significance) || 0,
    manuscriptSections: jstr(c.manuscriptSections, []),
    resultImpact: String(c.resultImpact || 'none'),
    requiresRecalc: !!c.requiresRecalc,
    requiresManuscriptRefresh: !!c.requiresManuscriptRefresh,
    requiresReview: !!c.requiresReview,
    supersedesEventId: draft.supersedesEventId != null ? Number(draft.supersedesEventId) : null,
    reconstructed: !!ctx.reconstructed,
    invalidated: false,
    schemaVersion: 1,
    metadata: jstr(draft.metadata, {}),
    checksum: clip(draft.checksum, 64),
    idempotencyKey: clip(draft.idempotencyKey || ctx.idempotencyKey, 200),
  };
}

/**
 * recordEvent(draft, ctx) — classify + insert one event. Best-effort: returns the
 * created row or null (on no-table / duplicate idempotencyKey / error). Never throws.
 */
export async function recordEvent(draft, ctx = {}) {
  if (!ledgerAvailable()) return null;
  if (!draft || !draft.eventType) return null;
  try {
    const data = buildEventRow(draft, ctx);
    return await prisma.projectEvent.create({ data });
  } catch (e) {
    // Unique idempotencyKey collision (P2002) is an expected no-op (dedup); log others.
    if (e && e.code !== 'P2002') console.error('[provenance] recordEvent failed', e?.message || e);
    return null;
  }
}

/**
 * recordEvents(drafts, ctx) — classify + insert many events under one correlationId.
 * Best-effort; skips no-op/operational drafts unless ctx.keepOperational. Returns count written.
 */
export async function recordEvents(drafts, ctx = {}) {
  if (!ledgerAvailable()) return 0;
  const list = (Array.isArray(drafts) ? drafts : []).filter((d) => d && d.eventType);
  if (!list.length) return 0;
  const rows = list.map((d) => buildEventRow(d, ctx))
    .filter((r) => ctx.keepOperational || r.significance > 0);
  if (!rows.length) return 0;
  try {
    const res = await prisma.projectEvent.createMany({ data: rows });
    return (res && res.count) || 0;
  } catch (e) {
    // A single duplicate idempotencyKey (P2002) would abort the WHOLE createMany batch
    // and drop every event — and `skipDuplicates` is not portable to SQLite. Fall back
    // to per-row inserts so the non-duplicate events still land (best-effort, dedup-safe).
    let n = 0;
    for (const r of rows) {
      try { await prisma.projectEvent.create({ data: r }); n++; }
      catch (e2) { if (e2 && e2.code !== 'P2002') console.error('[provenance] recordEvents row failed', e2?.message || e2); }
    }
    return n;
  }
}

export default { recordEvent, recordEvents, buildEventRow, ledgerAvailable };
