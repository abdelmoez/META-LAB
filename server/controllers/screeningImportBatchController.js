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
import { aggregateCounts } from '../pecanSearch/runService.js';

/**
 * 96.md D12 — effective run attribution for a batch: the first-class searchRunId
 * column, else (legacy pecan batches) the runId parsed from the synthetic
 * fileHash 'pecan:<runId>:<provider>:<page>' at read time. '' = file/api import.
 */
export function batchSearchRunId(b) {
  if (b && b.searchRunId) return b.searchRunId;
  const fh = String((b && b.fileHash) || '');
  if (fh.startsWith('pecan:')) {
    const parts = fh.split(':');
    if (parts.length >= 2 && parts[1]) return parts[1];
  }
  return '';
}

/** The additive per-batch wire shape shared by both history endpoints. */
function shapeBatch(b, remaining) {
  return {
    id: b.id, filename: b.filename, format: b.format, source: b.source || 'file',
    // 96.md — additive fields (existing keys byte-compatible).
    searchRunId: batchSearchRunId(b),
    updatedCount: b.updatedCount || 0,
    recordCount: b.recordCount,
    preDedupCount: b.preDedupCount, duplicateCount: b.duplicateCount, rejectedCount: b.rejectedCount,
    remainingCount: remaining[b.id] || 0,
    importedByName: b.importedByName, createdAt: b.createdAt,
  };
}

/** Live remaining-record counts per batch id (records may be screened/handed off,
 *  but only deletion removes them). */
async function remainingByBatch(pid) {
  const grouped = await prisma.screenRecord.groupBy({
    by: ['importBatchId'], where: { projectId: pid }, _count: { _all: true },
  });
  const remaining = {};
  for (const g of grouped) remaining[g.importBatchId] = g._count._all;
  return remaining;
}

/** GET /projects/:pid/import-batches — the Import History list. */
export async function listImportBatches(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });

    const batches = await prisma.screenImportBatch.findMany({
      where: { projectId: req.params.pid },
      orderBy: { createdAt: 'desc' },
    });
    const remaining = await remainingByBatch(req.params.pid);

    const canDelete = !!(access.isOwner || req.user?.role === 'admin');
    res.json({
      canDelete,
      batches: batches.map((b) => shapeBatch(b, remaining)),
    });
  } catch (e) {
    console.error('listImportBatches', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// M21 — import-history pagination bounds. Living-review projects accumulate one
// batch per landed page per provider, so the endpoint pages instead of shipping
// the whole timeline; list entries also truncate canonicalText (the full text is
// available from the run detail endpoint).
const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 200;
const HISTORY_CANONICAL_TEXT_CAP = 500;

/**
 * GET /projects/:pid/import-history — 96.md D12: the run-grouped chronological
 * import timeline for the Screening overview. Entries (newest first):
 *   { kind:'search-run', runId, name, state, origin, rolledBackAt, initiatedByName,
 *     createdAt, completedAt, canonicalText, canonicalTextTruncated, errorSummary,
 *     counts:{ found, imported, existingMatched, updated, duplicatesSkipped, ambiguous, failed },
 *     perSource:[{ provider, state, raw, imported, existingMatched, updated,
 *                  duplicatesSkipped, failed, capReached, errorClass, errorDetail }],
 *     batches:[batchShape] }
 *   { kind:'batch', ...batchShape }   — file/api batches (and orphaned run batches)
 * plus `canReset` (owner || site admin — drives the reset action visibility) and
 * `canDelete` (same rule; per-batch delete). Counts for non-finalized runs are
 * aggregated LIVE from the per-source rows (run.counts is '{}' while running).
 *
 * Pagination (additive): ?limit= (default 50, max 200) & ?offset= over the SORTED
 * entry list; the response adds { total, hasMore, limit, offset }. Per-source
 * rows are fetched only for the runs on the returned page.
 */
export async function getImportHistory(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const pid = req.params.pid;

    const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
    const offsetRaw = Number.parseInt(String(req.query.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), HISTORY_MAX_LIMIT) : HISTORY_DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const batches = await prisma.screenImportBatch.findMany({
      where: { projectId: pid }, orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, format: true, source: true, searchRunId: true,
        fileHash: true, updatedCount: true, recordCount: true, preDedupCount: true,
        duplicateCount: true, rejectedCount: true, importedByName: true, createdAt: true,
        // 104.md — the manual-search provenance the history UI edits.
        sourceDatabase: true, searchedAt: true, contributesToReview: true, exclusionNote: true,
      },
    });
    const remaining = await remainingByBatch(pid);

    // Search runs that landed in THIS screening project (fail-soft: engine tables
    // may be absent in stripped deployments — history then lists batches only).
    let runs = [];
    try {
      runs = await prisma.pecanSearchRun.findMany({
        where: { screenProjectId: pid }, orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, state: true, origin: true, rolledBackAt: true,
          initiatedByName: true, createdAt: true, completedAt: true,
          canonicalText: true, errorSummary: true,
        },
      });
    } catch { runs = []; }
    const runById = new Map(runs.map((r) => [r.id, r]));

    // Group batches under their run; everything else is a standalone entry.
    const batchesByRun = new Map();
    const standalone = [];
    for (const b of batches) {
      const rid = batchSearchRunId(b);
      if (rid && runById.has(rid)) {
        if (!batchesByRun.has(rid)) batchesByRun.set(rid, []);
        batchesByRun.get(rid).push(shapeBatch(b, remaining));
      } else {
        standalone.push(shapeBatch(b, remaining));
      }
    }

    const entries = [];
    for (const run of runs) {
      const fullText = run.canonicalText || '';
      entries.push({
        kind: 'search-run',
        runId: run.id,
        name: run.name || '',
        state: run.state,
        origin: run.origin || 'automated',
        rolledBackAt: run.rolledBackAt || null,
        initiatedByName: run.initiatedByName || '',
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        canonicalText: fullText.slice(0, HISTORY_CANONICAL_TEXT_CAP),
        canonicalTextTruncated: fullText.length > HISTORY_CANONICAL_TEXT_CAP,
        errorSummary: run.errorSummary || '',
        // counts + perSource are filled below, for the returned page only.
        counts: null,
        perSource: [],
        batches: batchesByRun.get(run.id) || [],
      });
    }
    for (const b of standalone) entries.push({ kind: 'batch', ...b });
    entries.sort((a, b2) => new Date(b2.createdAt) - new Date(a.createdAt));

    const total = entries.length;
    const page = entries.slice(offset, offset + limit);

    // Per-source rows for the RUNS on this page only (bounded work per request).
    const pageRunIds = page.filter((e) => e.kind === 'search-run').map((e) => e.runId);
    const sourcesByRun = new Map();
    if (pageRunIds.length) {
      try {
        const srcs = await prisma.pecanSearchSource.findMany({
          where: { runId: { in: pageRunIds } }, orderBy: { createdAt: 'asc' },
        });
        for (const s of srcs) {
          if (!sourcesByRun.has(s.runId)) sourcesByRun.set(s.runId, []);
          sourcesByRun.get(s.runId).push(s);
        }
      } catch { /* per-source breakdown degrades to empty */ }
    }
    for (const e of page) {
      if (e.kind !== 'search-run') continue;
      const sources = sourcesByRun.get(e.runId) || [];
      const agg = aggregateCounts(sources);
      e.counts = {
        found: agg.rawRetrieved,
        imported: agg.imported,
        existingMatched: agg.existingMatched,
        updated: agg.updated,
        duplicatesSkipped: agg.exactDup + agg.fuzzyDup,
        ambiguous: agg.ambiguousDup,
        failed: agg.failedRecords,
      };
      e.perSource = sources.map((s) => ({
        provider: s.provider,
        state: s.state,
        raw: s.rawCount || 0,
        imported: s.importedCount || 0,
        existingMatched: s.existingMatchCount || 0,
        updated: s.updatedCount || 0,
        duplicatesSkipped: (s.exactDupCount || 0) + (s.fuzzyDupCount || 0),
        failed: s.failedRecordCount || 0,
        capReached: !!s.capReached,
        errorClass: s.errorClass || '',
        errorDetail: s.errorDetail || '',
      }));
    }

    const canReset = !!(access.isOwner || req.user?.role === 'admin');
    res.json({
      canReset,
      canDelete: canReset,
      entries: page,
      total,
      hasMore: offset + page.length < total,
      limit,
      offset,
    });
  } catch (e) {
    console.error('getImportHistory', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /projects/:pid/records/:rid/provenance — 96.md 5D (M10): the article-level
 * provenance view. Member-readable (same audience as the records list); outsiders
 * and unknown records get an existence-hiding 404.
 *
 * Response (exact contract — the record drawer builds against it):
 *   { sources: [{ runId, runName, origin, provider, providerRecordId, outcome,
 *                 importedAt, batchId, filename, rolledBackAt }],
 *     changes: [{ field, fromValue, toValue, runId, provider, createdAt }] }
 *
 * `sources` is sorted importedAt ASC — the FIRST element is the import that first
 * introduced the article. runName/rolledBackAt resolve from PecanSearchRun
 * ('' / null when the row is file/api or the run is gone); filename resolves from
 * the batch (''). `changes[].provider` is best-effort: the unique provider of the
 * record's source rows sharing the change's (runId, batchId) context, else ''.
 */
export async function getRecordProvenance(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const pid = req.params.pid;
    const record = await prisma.screenRecord.findFirst({
      where: { id: req.params.rid, projectId: pid }, select: { id: true },
    });
    if (!record) return res.status(404).json({ error: 'Record not found' });

    // Fail-soft: the provenance tables are additive — absent tables mean empty
    // provenance, never an error.
    let srcRows = [];
    try {
      srcRows = await prisma.screenRecordSource.findMany({
        where: { projectId: pid, screenRecordId: record.id }, orderBy: { importedAt: 'asc' },
      });
    } catch { srcRows = []; }
    let changeRows = [];
    try {
      changeRows = await prisma.screenRecordMetadataChange.findMany({
        where: { projectId: pid, screenRecordId: record.id }, orderBy: { createdAt: 'asc' },
      });
    } catch { changeRows = []; }

    const runIds = [...new Set([...srcRows, ...changeRows].map((r) => r.runId).filter(Boolean))];
    const runById = new Map();
    if (runIds.length) {
      try {
        const runRows = await prisma.pecanSearchRun.findMany({
          where: { id: { in: runIds } }, select: { id: true, name: true, rolledBackAt: true },
        });
        for (const r of runRows) runById.set(r.id, r);
      } catch { /* run rows gone/absent — names degrade to '' */ }
    }
    const batchIds = [...new Set(srcRows.map((r) => r.batchId).filter(Boolean))];
    const batchById = new Map();
    if (batchIds.length) {
      try {
        const batchRows = await prisma.screenImportBatch.findMany({
          where: { id: { in: batchIds } }, select: { id: true, filename: true },
        });
        for (const b of batchRows) batchById.set(b.id, b);
      } catch { /* batch deleted — filename degrades to '' */ }
    }

    // Best-effort provider for change rows: unique provider of the source rows
    // sharing the same (runId, batchId) context; '' when ambiguous or unknown.
    const providerByCtx = new Map();
    for (const r of srcRows) {
      const k = `${r.runId || ''}${r.batchId || ''}`;
      if (!providerByCtx.has(k)) providerByCtx.set(k, r.provider || '');
      else if (providerByCtx.get(k) !== (r.provider || '')) providerByCtx.set(k, '');
    }

    res.json({
      sources: srcRows.map((r) => ({
        runId: r.runId || '',
        runName: runById.get(r.runId)?.name || '',
        origin: r.origin || '',
        provider: r.provider || '',
        providerRecordId: r.providerRecordId || '',
        outcome: r.outcome || '',
        importedAt: r.importedAt,
        batchId: r.batchId || '',
        filename: batchById.get(r.batchId)?.filename || '',
        rolledBackAt: runById.get(r.runId)?.rolledBackAt || null,
      })),
      changes: changeRows.map((c) => ({
        field: c.field || '',
        fromValue: c.fromValue || '',
        toValue: c.toValue || '',
        runId: c.runId || '',
        provider: providerByCtx.get(`${c.runId || ''}${c.batchId || ''}`) || '',
        createdAt: c.createdAt,
      })),
    });
  } catch (e) {
    console.error('getRecordProvenance', e);
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
      // 96.md provenance rows (bare screenRecordId scope key, no FK) — cleaned
      // here too so the schema contract ("nothing dangles by design") holds for
      // per-batch deletes exactly as it does for the reset path. Chunked ≤400 ids
      // (SQLite's 999-bind limit; a silent in-list failure would re-orphan rows).
      for (const model of ['screenRecordSource', 'screenRecordMetadataChange']) {
        if (!prisma[model]) continue;
        for (let i = 0; i < recordIds.length; i += 400) {
          try { await prisma[model].deleteMany({ where: { screenRecordId: { in: recordIds.slice(i, i + 400) } } }); }
          catch { /* model/table absent — ignore */ }
        }
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

/**
 * 104.md Part 2 — record (or correct) a manual search's provenance.
 *
 * PATCH /api/screening/projects/:pid/import-batches/:batchId/search
 * body: { sourceDatabase?, searchedAt?, contributesToReview?, exclusionNote? }
 *
 * An automated run knows which database it hit and exactly when. A manual import
 * knew neither — provenance had to guess the database from parser-stamped record
 * text and treat the UPLOAD time as the search date. This endpoint lets a
 * researcher state the two facts the file cannot: which database this was, and
 * when the search was actually run.
 *
 * It also carries the "is this part of the review's final search methodology?"
 * decision. Setting `contributesToReview: false` on an accidental or test import
 * stops it contributing a database or a date to anything the manuscript states,
 * while the batch, its records and its audit trail all stay exactly where they
 * are — "preserve audit logs, but generate the manuscript from the correct
 * active/final research state".
 */
export async function updateImportBatchSearch(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    // Changing what the manuscript reports about the search methodology is an
    // editorial act, so it needs write access — the same bar as importing.
    if (access.readOnly) {
      return res.status(403).json({ error: 'You do not have permission to change this project’s search record.' });
    }

    const batch = await prisma.screenImportBatch.findFirst({
      where: { id: req.params.batchId, projectId: req.params.pid },
    });
    if (!batch) return res.status(404).json({ error: 'Import batch not found' });

    const body = req.body || {};
    const data = {};

    if (body.sourceDatabase !== undefined) {
      data.sourceDatabase = String(body.sourceDatabase || '').trim().slice(0, 100);
    }
    if (body.searchedAt !== undefined) {
      if (body.searchedAt === null || body.searchedAt === '') {
        data.searchedAt = null; // clears back to "use the upload date"
      } else {
        const d = new Date(body.searchedAt);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ error: 'searchedAt is not a valid date.' });
        }
        // A search cannot have been run after the records were uploaded, and a
        // future date would silently become the manuscript's "last searched" date.
        if (d.getTime() > Date.now()) {
          return res.status(400).json({ error: 'A search date cannot be in the future.' });
        }
        data.searchedAt = d;
      }
    }
    if (body.contributesToReview !== undefined) {
      data.contributesToReview = !!body.contributesToReview;
    }
    if (body.exclusionNote !== undefined) {
      data.exclusionNote = String(body.exclusionNote || '').trim().slice(0, 500);
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update.' });

    const updated = await prisma.screenImportBatch.update({ where: { id: batch.id }, data });

    await writeAudit(req.params.pid, req.user, 'IMPORT_BATCH_SEARCH_UPDATED', {
      entityType: 'ScreenImportBatch', entityId: batch.id,
      details: {
        filename: batch.filename,
        before: {
          sourceDatabase: batch.sourceDatabase || '',
          searchedAt: batch.searchedAt || null,
          contributesToReview: batch.contributesToReview !== false,
        },
        after: {
          sourceDatabase: updated.sourceDatabase || '',
          searchedAt: updated.searchedAt || null,
          contributesToReview: updated.contributesToReview !== false,
        },
      },
    });

    res.json({
      batch: {
        id: updated.id,
        sourceDatabase: updated.sourceDatabase || '',
        searchedAt: updated.searchedAt || null,
        contributesToReview: updated.contributesToReview !== false,
        exclusionNote: updated.exclusionNote || '',
      },
    });
  } catch (e) {
    console.error('updateImportBatchSearch', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
