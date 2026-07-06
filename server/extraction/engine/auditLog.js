/**
 * server/extraction/engine/auditLog.js — 76.md §15/§22/§24.
 *
 * Best-effort append-only audit for the Pecan Extraction Engine, mirroring the RoB
 * audit helper (robController.audit). Denormalized actor + bare projectId/studyId (no
 * FK) so the trail survives the study/project it describes. NEVER throws — an audit
 * failure must not break the action that triggered it.
 */
import { prisma } from '../../db/client.js';

export const EXTRACTION_ACTIONS = Object.freeze({
  COMPLETE: 'EXTRACTION_COMPLETE',
  REOPEN: 'EXTRACTION_REOPEN',
  LOCK: 'EXTRACTION_LOCK',
  UNLOCK: 'EXTRACTION_UNLOCK',
  SYNC: 'EXTRACTION_SYNC',
  INCLUDE: 'EXTRACTION_INCLUDE',
});

/**
 * writeExtractionAudit(entry) — append one audit row. Details are JSON-stringified
 * and hard-capped at 4000 chars (audit-survival convention). Best-effort.
 * @param {{ projectId:string, studyId?:string, actorId:string, actorName?:string,
 *           action:string, entityType?:string, entityId?:string, details?:object }} entry
 */
export async function writeExtractionAudit(entry) {
  try {
    const details = JSON.stringify(entry.details || {}).slice(0, 4000);
    await prisma.extractionAuditLog.create({
      data: {
        projectId: String(entry.projectId || ''),
        studyId: String(entry.studyId || ''),
        actorId: String(entry.actorId || ''),
        actorName: String(entry.actorName || ''),
        action: String(entry.action || ''),
        entityType: entry.entityType || null,
        entityId: entry.entityId || null,
        details,
      },
    });
  } catch (e) {
    // Never let an audit failure surface — log and move on.
    console.error('[extraction-engine] audit write failed', e?.message || e);
  }
}

/**
 * readExtractionAudit(projectId, opts) — most-recent-first audit rows for a project,
 * optionally narrowed to one study. Parses details JSON back for the client.
 * @param {string} projectId
 * @param {{ studyId?:string, limit?:number }} opts
 * @returns {Promise<Array>}
 */
export async function readExtractionAudit(projectId, opts = {}) {
  const where = { projectId: String(projectId || '') };
  if (opts.studyId) where.studyId = String(opts.studyId);
  const rows = await prisma.extractionAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(500, Math.max(1, opts.limit || 200)),
  });
  return rows.map((r) => {
    let details = {};
    try { details = JSON.parse(r.details || '{}'); } catch { details = {}; }
    return {
      id: r.id, studyId: r.studyId, actorId: r.actorId, actorName: r.actorName,
      action: r.action, entityType: r.entityType, entityId: r.entityId,
      details, at: r.createdAt,
    };
  });
}
