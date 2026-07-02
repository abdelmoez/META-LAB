/**
 * screeningImportService.js — prompt50 WS2.
 *
 * The scalable core of the screening reference import: parse → dedupe → bulk
 * insert, shared by BOTH the synchronous endpoint (small imports) and the
 * durable async job worker (large imports). No arbitrary small record cap; the
 * only ceiling is the admin-configured per-project maximum.
 *
 * Design notes:
 *  - Dedupe queries only the indexed identity columns of existing records (doi,
 *    pmid, title) and dedupes within the incoming batch too — O(n) memory in the
 *    project's record count, not the full row payload.
 *  - Inserts use Prisma createMany in batches (one round-trip per CHUNK) instead
 *    of one INSERT per record, and report progress via an onProgress callback so
 *    the job row stays observable.
 *  - Records with no usable identity (no title AND no doi AND no pmid) are
 *    counted as rejected and reported back rather than silently dropped.
 */
import { prisma } from '../db/client.js';
import { parseByFormat, normTitle } from '../../src/research-engine/import-export/parsers.js';

// Insert batch size. createMany on SQLite is bound by the 999-variable limit
// (~12 columns/row → ~80 rows max per statement); 400 keeps us safely under it
// while minimising round-trips. Postgres has no such limit but 400 is fine there.
export const INSERT_CHUNK = 400;

// Absolute safety ceiling for a SINGLE import, independent of the (configurable)
// per-project total. Generous — a real systematic review rarely exceeds this in
// one file — but bounds a pathological/malicious payload. NOT the "small limit"
// the prompt warns against (that was 5000); this is two orders of magnitude up.
export const MAX_RECORDS_PER_IMPORT = 200000;

/** Default per-project record ceiling when the admin setting is unset. */
export const DEFAULT_MAX_RECORDS_PER_PROJECT = 100000;

// 65.md SCR-3 — ScreenImportJob.errorReport holds at most this many per-row entries
// (JSON [{ index, title, reason }]); beyond the cap the counts stay authoritative.
export const ERROR_REPORT_CAP = 200;

const truthyId = (r) =>
  String(r.title || '').trim() || String(r.doi || '').trim() || String(r.pmid || '').trim();

/** True when a parsed record carries enough identity to import (title/DOI/PMID). */
export function hasUsableIdentity(r) {
  return !!truthyId(r || {});
}

/**
 * parseImportContent(content, { format, filename })
 * BOM-tolerant parse via the parser registry (explicit format or auto-detect).
 * @returns {{ records: object[], detectedFormat: string }}
 */
export function parseImportContent(content, { format = 'auto', filename = '' } = {}) {
  const { records, format: detectedFormat } = parseByFormat(String(content || ''), format, filename);
  return { records: Array.isArray(records) ? records : [], detectedFormat: detectedFormat || 'unknown' };
}

/** Normalised dedupe keys for a record. */
function keysOf(r) {
  return {
    doi: String(r.doi || '').trim().toLowerCase(),
    pmid: String(r.pmid || '').trim(),
    nt: normTitle(String(r.title || '')),
  };
}

/**
 * dedupeAndInsertRecords(projectId, records, opts)
 * Dedupe `records` against the project's existing records AND within the batch,
 * then bulk-insert the survivors. Throws a typed error { code: 'CAPACITY' } when
 * the project ceiling would be exceeded (caller maps to a clear message).
 *
 * @param {string} projectId
 * @param {object[]} records   parsed canonical records
 * @param {object} opts        { format, fileHash, fileSize, importedById, importedByName, parser, maxRecords, onProgress(progress) }
 * @returns {Promise<{ imported, skippedDuplicates, rejected, batchId, total, keptCount }>}
 */
export async function dedupeAndInsertRecords(projectId, records, opts = {}) {
  const {
    format = '', filename = '', fileHash = null, fileSize = 0,
    importedById = null, importedByName = '', parser = '', source = 'file',
    maxRecords = DEFAULT_MAX_RECORDS_PER_PROJECT, onProgress,
  } = opts;

  const incoming = Array.isArray(records) ? records : [];

  // Seed dedupe sets from the project's existing identity columns (indexed).
  const existing = await prisma.screenRecord.findMany({
    where: { projectId },
    select: { doi: true, pmid: true, title: true },
  });
  const seenDois = new Set(), seenPmids = new Set(), seenTitles = new Set();
  for (const r of existing) {
    const { doi, pmid, nt } = keysOf(r);
    if (doi) seenDois.add(doi);
    if (pmid) seenPmids.add(pmid);
    if (nt) seenTitles.add(nt);
  }

  const kept = [];
  let skippedDuplicates = 0;
  let rejected = 0;
  // 65.md SCR-3 — per-row reject/invalid-decision reasons (capped), persisted to
  // ScreenImportJob.errorReport by the worker and surfaced in the import UI.
  // `index` is the record's 1-based position in the parsed file.
  const errorReport = [];
  const reportRow = (idx, r, reason) => {
    if (errorReport.length >= ERROR_REPORT_CAP) return;
    errorReport.push({ index: idx + 1, title: String(r.title || '').slice(0, 200), reason });
  };
  for (let idx = 0; idx < incoming.length; idx++) {
    const r = incoming[idx];
    if (!truthyId(r)) { rejected += 1; reportRow(idx, r, 'No usable title, DOI, or PMID'); continue; }
    const { doi, pmid, nt } = keysOf(r);
    if ((doi && seenDois.has(doi)) || (pmid && seenPmids.has(pmid)) || (nt && seenTitles.has(nt))) {
      skippedDuplicates += 1;
      continue;
    }
    // Invalid-decision warning only for records that will actually be inserted
    // (a duplicate-skipped row's decision cell never applies anyway).
    if (r.decision === '') reportRow(idx, r, 'Unrecognised screening decision value — record imported unscreened');
    if (doi) seenDois.add(doi);
    if (pmid) seenPmids.add(pmid);
    if (nt) seenTitles.add(nt);
    kept.push(r);
  }

  const cap = Number.isFinite(maxRecords) && maxRecords > 0 ? maxRecords : DEFAULT_MAX_RECORDS_PER_PROJECT;
  if (existing.length + kept.length > cap) {
    const err = new Error(`Import would exceed the project limit of ${cap} records (currently ${existing.length}).`);
    err.code = 'CAPACITY';
    err.currentCount = existing.length;
    err.cap = cap;
    throw err;
  }

  const batch = await prisma.screenImportBatch.create({
    data: {
      projectId, filename, format,
      recordCount: kept.length,
      // 58.md §7 — persist the import-time dedup accounting so PRISMA shows
      // total-identified (preDedup) and duplicates-removed for file AND Pecan imports.
      preDedupCount: incoming.length,
      duplicateCount: skippedDuplicates,
      rejectedCount: rejected,
      source,
      fileHash, fileSize,
      importedById, importedByName, parser,
    },
  });

  let imported = 0;
  for (let i = 0; i < kept.length; i += INSERT_CHUNK) {
    const chunk = kept.slice(i, i + INSERT_CHUNK);
    await prisma.screenRecord.createMany({
      data: chunk.map(r => ({
        projectId,
        importBatchId: batch.id,
        title:    String(r.title || '').slice(0, 1000),
        authors:  Array.isArray(r.authors) ? r.authors.join('; ').slice(0, 500) : String(r.authors || '').slice(0, 500),
        year:     String(r.year || ''),
        journal:  String(r.journal || r.source || '').slice(0, 300),
        doi:      String(r.doi || '').slice(0, 200),
        pmid:     String(r.pmid || '').slice(0, 50),
        abstract: String(r.abstract || '').slice(0, 5000),
        keywords: Array.isArray(r.keywords) ? r.keywords.join('; ') : String(r.keywords || ''),
        sourceDb: String(r.sourceDb || r.source || format).slice(0, 100),
        rawData:  JSON.stringify(r).slice(0, 2000),
      })),
    });
    imported += chunk.length;
    if (typeof onProgress === 'function') {
      // Best-effort progress tick; a reporting failure must not abort the insert.
      try { await onProgress({ imported, total: kept.length }); } catch { /* ignore */ }
    }
  }

  if (imported !== batch.recordCount) {
    await prisma.screenImportBatch.update({ where: { id: batch.id }, data: { recordCount: imported } });
  }

  // 59.md Change 1 — apply imported screening decisions as REAL ScreenDecision rows
  // (by the importer) so a pre-labelled benchmark dataset comes in already screened:
  // counts, progress, reviewer status, the 50-screened AI threshold and training
  // eligibility all derive from ScreenDecision, so nothing is double-counted.
  //   include / exclude / maybe → applied;  undecided / empty → left unscreened.
  // An INVALID label normalised to "" (unrecognised) is counted as a warning, never
  // applied. Idempotent via @@unique([recordId, reviewerId, stage]).
  let decisionsApplied = 0;
  const invalidDecisions = kept.filter((r) => r.decision === '').length;
  const labeled = kept.filter((r) => r.decision === 'include' || r.decision === 'exclude' || r.decision === 'maybe');
  if (importedById && labeled.length) {
    const inserted = await prisma.screenRecord.findMany({
      where: { importBatchId: batch.id }, select: { id: true, doi: true, pmid: true, title: true },
    });
    const idByKey = new Map();
    for (const rec of inserted) {
      const { doi, pmid, nt } = keysOf(rec);
      if (doi && !idByKey.has('d:' + doi)) idByKey.set('d:' + doi, rec.id);
      if (pmid && !idByKey.has('p:' + pmid)) idByKey.set('p:' + pmid, rec.id);
      if (nt && !idByKey.has('t:' + nt)) idByKey.set('t:' + nt, rec.id);
    }
    const decRows = [];
    for (const r of labeled) {
      const { doi, pmid, nt } = keysOf(r);
      const id = (doi && idByKey.get('d:' + doi)) || (pmid && idByKey.get('p:' + pmid)) || (nt && idByKey.get('t:' + nt));
      if (id) decRows.push({ recordId: id, projectId, reviewerId: importedById, reviewerName: importedByName || '', stage: 'title_abstract', decision: r.decision });
    }
    for (let i = 0; i < decRows.length; i += INSERT_CHUNK) {
      const slice = decRows.slice(i, i + INSERT_CHUNK);
      try { const out = await prisma.screenDecision.createMany({ data: slice }); decisionsApplied += out?.count ?? slice.length; }
      catch { /* pre-existing decision (unique conflict) — leave it */ }
    }
  }

  return { imported, skippedDuplicates, rejected, batchId: batch.id, total: incoming.length, keptCount: kept.length, decisionsApplied, invalidDecisions, errorReport };
}
