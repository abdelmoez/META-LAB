/**
 * pecanSearch/duplicates.js — the ambiguous-duplicate review read + resolve layer.
 *
 * Ambiguous candidates (POSSIBLE / RELATED / FAMILY) are LANDED as distinct
 * ScreenRecords and recorded as PENDING PecanDedupDecision rows. Review presents
 * them side-by-side with the explainable score breakdown; resolving a "merge"
 * reuses the EXISTING screening duplicate model (ScreenDuplicateGroup +
 * ScreenRecord.isDuplicate/isPrimary/duplicateGroupId) so PRISMA "duplicates
 * removed" and the existing Duplicates UI stay consistent — duplicate uncertainty
 * never leaks into screening conflicts (§6.7).
 */
import { prisma } from '../db/client.js';
import { v4 as uuid } from 'uuid';

/** List pending ambiguous duplicate decisions for a run, with both records. */
export async function listRunDuplicates(runId, { skip = 0, take = 50 } = {}) {
  const [rows, total] = await Promise.all([
    prisma.pecanDedupDecision.findMany({ where: { runId, decision: 'pending' }, orderBy: { score: 'desc' }, skip, take }),
    prisma.pecanDedupDecision.count({ where: { runId, decision: 'pending' } }),
  ]);
  const ids = new Set();
  for (const d of rows) { if (d.sourceRecordId) ids.add(d.sourceRecordId); if (d.matchedScreenRecordId) ids.add(d.matchedScreenRecordId); }
  const records = ids.size ? await prisma.screenRecord.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, title: true, authors: true, year: true, journal: true, doi: true, pmid: true, abstract: true, sourceDb: true, isDuplicate: true },
  }) : [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const candidates = rows.map((d) => ({
    id: d.id,
    score: d.score,
    matchType: d.matchType,
    reasons: safe(d.reasons, []),
    conflicts: safe(d.conflicts, []),
    components: safe(d.scoreComponents, {}),
    ruleVersion: d.ruleVersion,
    incoming: byId.get(d.sourceRecordId) || null,
    existing: byId.get(d.matchedScreenRecordId) || null,
  }));
  return { candidates, total, skip, take };
}

/**
 * resolveRunDuplicate(decisionId, action, user)
 * action: 'merge' | 'keep_separate' | 'defer'
 */
export async function resolveRunDuplicate(decisionId, action, user) {
  const d = await prisma.pecanDedupDecision.findUnique({ where: { id: decisionId } });
  if (!d) return { ok: false, code: 'NOT_FOUND' };
  if (d.decision !== 'pending') return { ok: false, code: 'ALREADY_RESOLVED' };

  if (action === 'keep_separate') {
    await update(decisionId, 'kept_separate', 'manual', user);
    return { ok: true, decision: 'kept_separate' };
  }
  if (action === 'defer') {
    await update(decisionId, 'deferred', 'manual', user);
    return { ok: true, decision: 'deferred' };
  }
  if (action === 'merge') {
    const incomingId = d.sourceRecordId;             // the landed ambiguous record
    const matchedId = d.matchedScreenRecordId;       // the canonical record kept
    if (incomingId && matchedId && incomingId !== matchedId) {
      await mergeRecords(matchedId, incomingId);
    }
    await update(decisionId, 'merged', 'manual', user);
    return { ok: true, decision: 'merged' };
  }
  return { ok: false, code: 'BAD_ACTION' };
}

/** Group incoming into matched via the screening duplicate model (matched = primary). */
async function mergeRecords(primaryId, duplicateId) {
  const [primary, dup] = await Promise.all([
    prisma.screenRecord.findUnique({ where: { id: primaryId }, select: { id: true, projectId: true, duplicateGroupId: true } }),
    prisma.screenRecord.findUnique({ where: { id: duplicateId }, select: { id: true, projectId: true } }),
  ]);
  if (!primary || !dup || primary.projectId !== dup.projectId) return;
  let groupId = primary.duplicateGroupId;
  if (!groupId) {
    const group = await prisma.screenDuplicateGroup.create({ data: { id: uuid(), projectId: primary.projectId, primaryId, resolvedAt: new Date() } });
    groupId = group.id;
    await prisma.screenRecord.update({ where: { id: primaryId }, data: { duplicateGroupId: groupId, isPrimary: true, isDuplicate: false } });
  }
  await prisma.screenRecord.update({ where: { id: duplicateId }, data: { duplicateGroupId: groupId, isPrimary: false, isDuplicate: true } });
}

async function update(id, decision, source, user) {
  await prisma.pecanDedupDecision.update({
    where: { id },
    data: { decision, decisionSource: source, decidedById: user?.id || '', decidedByName: user?.name || user?.email || '', decidedAt: new Date() },
  });
}

function safe(s, dflt) { try { return JSON.parse(s || ''); } catch { return dflt; } }
