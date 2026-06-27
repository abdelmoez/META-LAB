/**
 * screeningImportBatchController.js — 58.md §5: list + delete screening import
 * batches (datasets). Deleting a batch removes every study that came from it and
 * all dependent data; PRISMA / analytics recompute LIVE from the surviving records
 * (getSummary derives identified/duplicatesRemoved from the remaining records +
 * per-batch dedup counts), so there is no stored count to recalc.
 *
 * Safety:
 *  - owner OR admin only (type-to-confirm the dataset name, mirroring project delete);
 *  - records from THIS batch are deleted; ScreenDecision / ScreenConflict /
 *    ScreenPdfAttachment / ScreenRecordOpenState cascade via their recordId FK;
 *  - bare-scope AI rows (ScreenAiScore / ScreenAiFeedback — no FK) are cleaned by
 *    recordId; now-empty duplicate groups are removed;
 *  - records are NOT canonicalized across batches (import-time duplicates are skipped
 *    at insert, never shared), so deleting one batch cannot remove another's records;
 *  - an audit entry is written before returning.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';

/** GET /projects/:pid/import-batches — the Import History list. */
export async function listImportBatches(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });

    const batches = await prisma.screenImportBatch.findMany({
      where: { projectId: req.params.pid },
      orderBy: { createdAt: 'desc' },
    });
    // Live remaining-record count per batch (records may have been screened/handed off,
    // but only deletion removes them; this stays honest if a future merge changes it).
    const grouped = await prisma.screenRecord.groupBy({
      by: ['importBatchId'], where: { projectId: req.params.pid }, _count: { _all: true },
    });
    const remaining = {};
    for (const g of grouped) remaining[g.importBatchId] = g._count._all;

    const canDelete = !!(access.isOwner || req.user?.role === 'admin');
    res.json({
      canDelete,
      batches: batches.map((b) => ({
        id: b.id, filename: b.filename, format: b.format, source: b.source || 'file',
        recordCount: b.recordCount,
        preDedupCount: b.preDedupCount, duplicateCount: b.duplicateCount, rejectedCount: b.rejectedCount,
        remainingCount: remaining[b.id] || 0,
        importedByName: b.importedByName, createdAt: b.createdAt,
      })),
    });
  } catch (e) {
    console.error('listImportBatches', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /projects/:pid/import-batches/:batchId — owner/admin, type-to-confirm. */
export async function deleteImportBatch(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const isAdmin = req.user?.role === 'admin';
    if (!(access.isOwner || isAdmin)) {
      return res.status(403).json({ error: 'Only the project owner or an administrator can delete an import batch.' });
    }
    const batch = await prisma.screenImportBatch.findFirst({ where: { id: req.params.batchId, projectId: req.params.pid } });
    if (!batch) return res.status(404).json({ error: 'Import batch not found' });

    // Type-to-confirm (mirrors the destructive project-delete pattern).
    const confirm = String((req.body && req.body.confirm) || '').trim();
    if (confirm !== String(batch.filename || '').trim()) {
      return res.status(400).json({ error: 'Confirmation text does not match the dataset name.' });
    }

    const recs = await prisma.screenRecord.findMany({
      where: { projectId: req.params.pid, importBatchId: batch.id },
      select: { id: true, handoffStudyId: true },
    });
    const recordIds = recs.map((r) => r.id);
    const handedOff = recs.filter((r) => r.handoffStudyId).length;

    // Bare-scope AI rows (no FK cascade) — best-effort cleanup by recordId.
    if (recordIds.length) {
      for (const model of ['screenAiScore', 'screenAiFeedback']) {
        try { if (prisma[model]) await prisma[model].deleteMany({ where: { recordId: { in: recordIds } } }); }
        catch { /* model/table absent — ignore */ }
      }
    }

    // Delete the records; ScreenDecision/Conflict/PdfAttachment/OpenState cascade.
    const del = await prisma.screenRecord.deleteMany({ where: { projectId: req.params.pid, importBatchId: batch.id } });

    // Remove duplicate groups that are now empty (all members deleted).
    try {
      const groups = await prisma.screenDuplicateGroup.findMany({
        where: { projectId: req.params.pid },
        select: { id: true, _count: { select: { records: true } } },
      });
      const empty = groups.filter((g) => (g._count?.records || 0) === 0).map((g) => g.id);
      if (empty.length) await prisma.screenDuplicateGroup.deleteMany({ where: { id: { in: empty } } });
    } catch { /* dup-group shape differs — ignore */ }

    await prisma.screenImportBatch.delete({ where: { id: batch.id } });
    await writeAudit(req.params.pid, req.user, 'IMPORT_BATCH_DELETED', {
      entityType: 'ScreenImportBatch', entityId: batch.id,
      details: { filename: batch.filename, recordsRemoved: del.count, handedOff, source: isAdmin ? 'admin' : 'owner' },
    });

    res.json({ deleted: true, recordsRemoved: del.count, handedOff });
  } catch (e) {
    console.error('deleteImportBatch', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
