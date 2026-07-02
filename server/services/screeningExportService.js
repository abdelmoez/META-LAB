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
import { consensusState } from '../../src/research-engine/screening/conflicts.js';
import { csvRow } from '../utils/csv.js';

// 65.md SCR-2 — hard cap on the per-reviewer column families. Fixed so the CSV schema
// is stable regardless of how many reviewers a project has (extra reviewers beyond the
// cap are omitted; a systematic review very rarely has more than 6 screeners).
export const EXPORT_REVIEWER_CAP = 6;

// 65.md SCR-2 — appended per-reviewer / consensus / duplicate provenance columns.
// Reviewer ordinals are PROJECT-WIDE and deterministic (reviewerId ascending), so
// reviewer_1 means the same person on every row of one export.
export const EXPORT_REVIEW_COLUMNS = [
  'conflict_status', 'duplicate_group_id', 'is_primary', 'my_decided_at',
  ...Array.from({ length: EXPORT_REVIEWER_CAP }, (_, i) => [
    `reviewer_${i + 1}_name`, `reviewer_${i + 1}_decision`, `reviewer_${i + 1}_decided_at`,
  ]).flat(),
];

// Existing CSV columns + order are UNCHANGED for backwards compatibility; the AI
// validation columns and (65.md SCR-2) the review/consensus columns are APPENDED
// (existing consumers ignore trailing columns). NEVER reorder or remove entries.
export const EXPORT_COLUMNS = [
  'title', 'authors', 'year', 'journal', 'doi', 'pmid', 'decision', 'exclusionReason',
  'notes', 'rating', 'isDuplicate', 'abstract', ...AI_CV_COLUMNS, ...EXPORT_REVIEW_COLUMNS,
];

// Above this many records the synchronous GET /export route refuses (413 → use async).
// Keeps the request thread safe; the async job handles any size.
export const EXPORT_SYNC_MAX = Number(process.env.EXPORT_SYNC_MAX) || 5000;
// Above this many records the (uncapped, expensive) per-record cross-validation is
// SKIPPED — it is the dominant CPU cost and the #1 cause of export 504s (62.md RC-1).
// The CV columns then export blank with a clear status, so the CSV schema is unchanged.
export const EXPORT_CV_MAX = Number(process.env.EXPORT_CV_MAX) || 5000;
// 65.md SCR-8 — the ASYNC (worker) export path already runs CV off the event loop in a
// worker_thread, fold by fold, so it can afford a much higher ceiling: 10k-record
// validation projects get real held-out scores instead of blank columns. The sync path
// keeps EXPORT_CV_MAX; beyond THIS cap the honest 'too_large' status still applies.
export const EXPORT_CV_MAX_ASYNC = Number(process.env.EXPORT_CV_MAX_ASYNC) || 20000;

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
      // 65.md SCR-8 — align the engine's own perf guard with the caller's cap so an
      // env-raised async cap is not silently undercut by the engine default (20000).
      maxRecordsForCv: cap > 0 ? cap : undefined,
    });
    return { meta: cv.meta, byRecordId: cv.byRecordId, generatedAt };
  } catch (err) {
    console.error('[screening] export CV scoring failed:', err.message);
    return blank('cv_error', 'Could not compute cross-validated scores.');
  }
}

// Neutral context when a caller has no project context: reviewer columns stay blank
// and identity is NEVER shown (fail-closed), consensus uses the 2-reviewer default.
const NEUTRAL_EXPORT_CTX = Object.freeze({ canSeeIdentity: false, reviewers: [], requiredReviewers: 2 });

/**
 * buildExportContext — 65.md SCR-2: everything the per-reviewer export columns need,
 * resolved ONCE per export (not per row). Reviewer identity mirrors the listRecords
 * policy: names are visible unless the project is blind AND the requester is not a
 * leader/owner — otherwise reviewers export as anonymous ordinals. Fail-closed: any
 * lookup failure returns the neutral context (blank reviewer columns, no identity).
 */
export async function buildExportContext(projectId, userId) {
  try {
    const project = await prisma.screenProject.findUnique({
      where: { id: projectId },
      select: { ownerId: true, blindMode: true, requiredScreeningReviewers: true },
    });
    if (!project) return { ...NEUTRAL_EXPORT_CTX };
    const member = userId
      ? await prisma.screenProjectMember.findFirst({ where: { projectId, userId }, select: { role: true } })
      : null;
    // Mirrors server/screening/access.js isLeader semantics.
    const isLeader = project.ownerId === userId || member?.role === 'leader' || member?.role === 'owner';
    const canSeeIdentity = !project.blindMode || isLeader;
    // Deterministic project-wide reviewer ordering (reviewerId asc), capped.
    const rows = await prisma.screenDecision.findMany({
      where: { projectId },
      select: { reviewerId: true, reviewerName: true },
      distinct: ['reviewerId'],
      orderBy: { reviewerId: 'asc' },
      take: EXPORT_REVIEWER_CAP,
    });
    return {
      canSeeIdentity,
      reviewers: rows.map(r => ({ reviewerId: r.reviewerId, name: r.reviewerName || '' })),
      requiredReviewers: project.requiredScreeningReviewers ?? 2,
    };
  } catch (err) {
    console.error('[screening] buildExportContext failed:', err.message);
    return { ...NEUTRAL_EXPORT_CTX };
  }
}

const isoOrBlank = (d) => {
  if (!d) return '';
  try { return new Date(d).toISOString(); } catch { return ''; }
};

/** Build one export row object for a record (shared by the sync route and the worker). */
export function buildExportRow(r, userId, cv, ctx = NEUTRAL_EXPORT_CTX) {
  const myDec = (r.decisions || []).find(d => d.reviewerId === userId);
  // 65.md SCR-2 — per-reviewer columns use the title/abstract-stage decision (one row
  // per reviewer via @@unique([recordId, reviewerId, stage])); conflict_status derives
  // from the same stage via the authoritative consensus matrix.
  const taDecisions = (r.decisions || []).filter(d => d.stage === 'title_abstract');
  const reviewerCols = {};
  for (let i = 0; i < EXPORT_REVIEWER_CAP; i++) {
    const rev = (ctx.reviewers || [])[i];
    const d = rev ? taDecisions.find(x => x.reviewerId === rev.reviewerId) : null;
    // Identity only when permission-safe (blind mode → anonymous ordinal).
    reviewerCols[`reviewer_${i + 1}_name`] = rev ? (ctx.canSeeIdentity ? (rev.name || `Reviewer ${i + 1}`) : `Reviewer ${i + 1}`) : '';
    reviewerCols[`reviewer_${i + 1}_decision`] = d ? (d.decision || 'undecided') : '';
    reviewerCols[`reviewer_${i + 1}_decided_at`] = d ? isoOrBlank(d.updatedAt || d.createdAt) : '';
  }
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
    // Appended consensus / duplicate-provenance / per-reviewer columns (65.md SCR-2).
    conflict_status: consensusState(taDecisions, ctx.requiredReviewers ?? 2),
    duplicate_group_id: r.duplicateGroupId || '',
    is_primary: r.isPrimary,
    my_decided_at: myDec ? isoOrBlank(myDec.updatedAt || myDec.createdAt) : '',
    ...reviewerCols,
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
export async function streamExportToSink({ projectId, userId, format = 'csv', filter = 'all', cv, ctx, write, onProgress }) {
  const total = await prisma.screenRecord.count({ where: { projectId } });
  // 65.md SCR-2 — reviewer/consensus context resolved once for the whole export.
  const rowCtx = ctx || await buildExportContext(projectId, userId);
  const match = (row) => filter === 'all' || row.decision === filter;
  let processed = 0, emitted = 0;

  const tick = async () => {
    if (onProgress && processed % PAGE === 0) await onProgress({ processed, total, emitted });
  };

  if (format === 'json') {
    await write('[');
    let first = true;
    for await (const rec of pageRecords(projectId)) {
      const row = buildExportRow(rec, userId, cv, rowCtx);
      processed++;
      if (match(row)) { await write((first ? '' : ',') + JSON.stringify(row)); first = false; emitted++; }
      await tick();
    }
    await write(']');
  } else if (format === 'ris') {
    let first = true;
    for await (const rec of pageRecords(projectId)) {
      const row = buildExportRow(rec, userId, cv, rowCtx);
      processed++;
      if (match(row)) { await write((first ? '' : '\n\n') + renderRisBlock(row)); first = false; emitted++; }
      await tick();
    }
    if (emitted) await write('\n');
  } else { // csv — header then '\n'+row per record (≡ [header, ...rows].join('\n'))
    await write(EXPORT_COLUMNS.join(','));
    for await (const rec of pageRecords(projectId)) {
      const row = buildExportRow(rec, userId, cv, rowCtx);
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
