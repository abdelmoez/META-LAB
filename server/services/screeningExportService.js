/**
 * screeningExportService.js — shared, reusable screening-export logic (62.md).
 *
 * Before 62.md the whole export ran INSIDE the HTTP request: it computed UNCAPPED k-fold
 * cross-validation (training k models over every record), loaded all records + decisions
 * into memory, and built the entire CSV/JSON as one string before sending — three
 * compounding event-loop blockers that 504-ed large exports behind the proxy.
 *
 * This module centralises the row mapping + renderers so BOTH paths share one source of
 * truth and one CSV schema:
 *   - the synchronous GET /export route (small projects) renders in memory as before
 *     (byte-identical output) but now caps records and runs CV OFF the event loop;
 *   - the async export worker streams rows to a file page-by-page (bounded memory) with
 *     capped, worker_thread CV, so an arbitrarily large project never blocks or 504s.
 */
import { prisma } from '../db/client.js';
import { aiFlagEnabled, loadEngineInput, getGlobalAiSettings } from './screeningAiService.js';
import { runCrossValidatePerRecord } from './aiCompute.js';
import { cvRowFields, AI_CV_COLUMNS, CV_SCORE_TYPES } from '../../src/research-engine/screening/ai/index.js';
import { csvRow } from '../utils/csv.js';

// Existing CSV columns + order are UNCHANGED for backwards compatibility; the AI
// validation columns are APPENDED (existing consumers ignore trailing columns).
export const EXPORT_COLUMNS = [
  'title', 'authors', 'year', 'journal', 'doi', 'pmid', 'decision', 'exclusionReason',
  'notes', 'rating', 'isDuplicate', 'abstract', ...AI_CV_COLUMNS,
];

// Above this many records the synchronous GET /export route refuses (413 → use async).
// Keeps the request thread safe; the async job handles any size.
export const EXPORT_SYNC_MAX = Number(process.env.EXPORT_SYNC_MAX) || 5000;
// Above this many records the (uncapped, expensive) per-record cross-validation is
// SKIPPED — it is the dominant CPU cost and the #1 cause of export 504s (62.md RC-1).
// The CV columns then export blank with a clear status, so the CSV schema is unchanged.
export const EXPORT_CV_MAX = Number(process.env.EXPORT_CV_MAX) || 5000;

const PAGE = 1000; // records per DB page in the streaming path (bounded memory)

/**
 * computeExportCvScores — out-of-sample (cross-validated) AI relevance scores for the
 * export (59.md Change 2), now (62.md) CAPPED and run in a worker_thread so it never
 * blocks the event loop. Fully best-effort: AI disabled, below threshold, over the cap,
 * or any failure → empty map + a meta status, so the columns export blank with a clear
 * reason — never a leaky in-sample score.
 */
export async function computeExportCvScores(projectId, { cap = EXPORT_CV_MAX } = {}) {
  const generatedAt = new Date().toISOString();
  const blank = (status, reason) => ({
    meta: { scoreType: CV_SCORE_TYPES.NOT_AVAILABLE, status, reason, modelVersion: '' },
    byRecordId: new Map(),
    generatedAt,
  });
  try {
    const [flagOn, global] = await Promise.all([aiFlagEnabled(), getGlobalAiSettings()]);
    if (!flagOn || !global.enabled) {
      return blank('ai_unavailable', 'AI screening is not enabled for this site.');
    }
    const input = await loadEngineInput(projectId, 'title_abstract');
    if (!input) return blank('ai_unavailable', 'Project not found.');
    // 62.md RC-1 — cap the per-record CV. Above the cap the dominant CPU cost is skipped;
    // the columns export blank with a clear status instead of 504-ing the whole export.
    if (cap > 0 && input.records.length > cap) {
      return blank('too_large', `Cross-validated AI scores are skipped above ${cap} records to keep the export fast and reliable.`);
    }
    const cv = await runCrossValidatePerRecord({
      records: input.records,
      labelByRecordId: input.labelByRecordId,
      picoSnapshot: input.picoSnapshot,
      inclusionKeywords: input.inclusionKeywords,
      exclusionKeywords: input.exclusionKeywords,
      studyTypeFilter: input.studyTypeFilter,
      // 59.md Change 3 — centralised "≥ 50 screened" gate; imported include/exclude labels
      // count toward it (they are real settled screening decisions).
      minLabeledToScore: global.minScreenedDecisions ?? 50,
    });
    return { meta: cv.meta, byRecordId: cv.byRecordId, generatedAt };
  } catch (err) {
    console.error('[screening] export CV scoring failed:', err.message);
    return blank('cv_error', 'Could not compute cross-validated scores.');
  }
}

/** Build one export row object for a record (shared by the sync route and the worker). */
export function buildExportRow(r, userId, cv) {
  const myDec = (r.decisions || []).find(d => d.reviewerId === userId);
  return {
    id: r.id,
    title: r.title,
    authors: r.authors,
    year: r.year,
    journal: r.journal,
    doi: r.doi,
    pmid: r.pmid,
    abstract: r.abstract,
    decision: myDec?.decision || 'undecided',
    exclusionReason: myDec?.exclusionReason || '',
    notes: myDec?.notes || '',
    rating: myDec?.rating ?? '',
    labels: myDec?.labels || '[]',
    isDuplicate: r.isDuplicate,
    sourceDb: r.sourceDb,
    // Appended AI validation columns (blank + status when not out-of-sample).
    ...cvRowFields(cv.byRecordId.get(r.id), cv.meta, cv.generatedAt),
  };
}

/** Render one RIS (TY..ER) block for a row — shared by the sync route and the worker. */
export function renderRisBlock(r) {
  const oneLine = v => String(v ?? '').replace(/\r?\n/g, ' ').trim();
  const lines = ['TY  - JOUR'];
  const title = oneLine(r.title);
  if (title) lines.push(`TI  - ${title}`);
  const authorsRaw = oneLine(r.authors);
  if (authorsRaw) {
    const authors = authorsRaw.includes(';') ? authorsRaw.split(/;\s*/) : authorsRaw.split(/,\s*/);
    for (const a of authors.map(s => s.trim()).filter(Boolean)) lines.push(`AU  - ${a}`);
  }
  const journal = oneLine(r.journal);
  if (journal) lines.push(`JO  - ${journal}`);
  const year = oneLine(r.year);
  if (year) lines.push(`PY  - ${year}`);
  const doi = oneLine(r.doi);
  if (doi) lines.push(`DO  - ${doi}`);
  const pmid = oneLine(r.pmid);
  if (pmid) lines.push(`AN  - ${pmid}`);
  const abstract = oneLine(r.abstract);
  if (abstract) lines.push(`AB  - ${abstract}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

/** Render the CSV row for a built row object (column-ordered, RFC-4180 + injection-safe). */
export function renderCsvRow(row) {
  return csvRow(EXPORT_COLUMNS.map(c => row[c]));
}

/** Page records (+ their decisions) by id cursor — only PAGE rows in memory at a time. */
async function* pageRecords(projectId) {
  let cursor = null;
  for (;;) {
    const page = await prisma.screenRecord.findMany({
      where: { projectId },
      include: { decisions: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) return;
    for (const r of page) yield r;
    if (page.length < PAGE) return;
    cursor = page[page.length - 1].id;
  }
}

/**
 * streamExportToSink — render the whole export incrementally to an async `write(chunk)`
 * sink (a file stream, in the worker). Memory stays bounded to one page of records +
 * one rendered row regardless of project size. Output matches the sync route's CSV/RIS
 * byte-for-byte; JSON is compact (valid; large-file friendly). Returns counts + cvStatus.
 *
 * @param {object} o
 * @param {string} o.projectId
 * @param {string} o.userId           reviewer whose decisions populate the per-record columns
 * @param {'csv'|'json'|'ris'} o.format
 * @param {string} o.filter           all | include | exclude | maybe | undecided
 * @param {{meta:object, byRecordId:Map, generatedAt:string}} o.cv
 * @param {(chunk:string)=>Promise<void>|void} o.write
 * @param {(p:{processed:number,total:number,emitted:number})=>Promise<void>|void} [o.onProgress]
 */
export async function streamExportToSink({ projectId, userId, format = 'csv', filter = 'all', cv, write, onProgress }) {
  const total = await prisma.screenRecord.count({ where: { projectId } });
  const match = (row) => filter === 'all' || row.decision === filter;
  let processed = 0, emitted = 0;

  const tick = async () => {
    if (onProgress && processed % PAGE === 0) await onProgress({ processed, total, emitted });
  };

  if (format === 'json') {
    await write('[');
    let first = true;
    for await (const rec of pageRecords(projectId)) {
      const row = buildExportRow(rec, userId, cv);
      processed++;
      if (match(row)) { await write((first ? '' : ',') + JSON.stringify(row)); first = false; emitted++; }
      await tick();
    }
    await write(']');
  } else if (format === 'ris') {
    let first = true;
    for await (const rec of pageRecords(projectId)) {
      const row = buildExportRow(rec, userId, cv);
      processed++;
      if (match(row)) { await write((first ? '' : '\n\n') + renderRisBlock(row)); first = false; emitted++; }
      await tick();
    }
    if (emitted) await write('\n');
  } else { // csv — header then '\n'+row per record (≡ [header, ...rows].join('\n'))
    await write(EXPORT_COLUMNS.join(','));
    for await (const rec of pageRecords(projectId)) {
      const row = buildExportRow(rec, userId, cv);
      processed++;
      if (match(row)) { await write('\n' + renderCsvRow(row)); emitted++; }
      await tick();
    }
  }
  if (onProgress) await onProgress({ processed, total, emitted });
  return { total, processed, emitted, cvStatus: cv?.meta?.status || '' };
}

/** File extension + content-type for an export format. */
export function exportContentType(format) {
  if (format === 'json') return { ext: 'json', type: 'application/json' };
  if (format === 'ris') return { ext: 'ris', type: 'application/x-research-info-systems' };
  return { ext: 'csv', type: 'text/csv' };
}
