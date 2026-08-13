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
 *  - 96.md D9/D10 — a duplicate match is no longer a silent skip: the existing
 *    record gets a SAFE fill-blank metadata merge (mergeFillBlanks — only blank
 *    bibliographic fields are filled, never overwritten; decisions/stage/status/
 *    notes/conflicts/PDFs are NEVER touched) and every inserted AND matched record
 *    gains a ScreenRecordSource provenance row (+ ScreenRecordMetadataChange rows
 *    per filled field). All provenance writes are best-effort and idempotent
 *    (query-first on the composite unique key; SQLite has no skipDuplicates).
 */
import { prisma } from '../db/client.js';
import { parseByFormat, normTitle } from '../../src/research-engine/import-export/parsers.js';
import { mergeFillBlanks, MERGE_FILL_FIELDS } from '../../src/research-engine/screening/deduplication.js';
import { isResetLocked } from '../screening/resetLock.js';

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

// 96.md D9 — provenance origin per batch source (ScreenRecordSource.origin enum).
const ORIGIN_BY_SOURCE = { 'pecan-search': 'search', file: 'file', api: 'api', 'citation-mining': 'mining' };

// ScreenRecordMetadataChange from/to values are bounded (audit rows stay small).
const CHANGE_VALUE_CAP = 500;

/**
 * donorShape — normalise an incoming parsed record into the string-field shape the
 * fill-blank merge compares against ScreenRecord columns (same caps as the insert
 * mapping). NOTE: no `journal || source` fallback here — the insert path's fallback
 * would leak a provider id (e.g. "pubmed") into an existing record's journal field.
 */
export function donorShape(r = {}) {
  return {
    id: String(r.providerRecordId || ''),
    doi: String(r.doi || '').slice(0, 200),
    pmid: String(r.pmid || '').slice(0, 50),
    abstract: String(r.abstract || '').slice(0, 5000),
    authors: Array.isArray(r.authors) ? r.authors.join('; ').slice(0, 500) : String(r.authors || '').slice(0, 500),
    year: String(r.year || ''),
    journal: String(r.journal || '').slice(0, 300),
    keywords: Array.isArray(r.keywords) ? r.keywords.join('; ') : String(r.keywords || ''),
  };
}

/**
 * applyMetadataMerge(projectId, matches, ctx) — 96.md D10: the SAFE metadata merge.
 * For each matched existing record, fill ONLY its blank bibliographic fields
 * (MERGE_FILL_FIELDS via mergeFillBlanks — never overwrites a non-empty value,
 * never touches decisions/stage/finalStatus/notes/conflicts/PDFs/assignments) and
 * log every filled field as a ScreenRecordMetadataChange row (values ≤500 chars).
 *
 * Idempotent by construction: a re-run finds the fields non-blank and writes
 * nothing (updated = 0), so page resumes / job retries never double-count.
 *
 * @param {string} projectId ScreenProject id
 * @param {Array<{screenRecordId:string, donor:object}>} matches
 * @param {object} ctx { runId, batchId }
 * @returns {Promise<{ updated:number, changedFieldsByRecord:Map<string,string[]> }>}
 *   updated — DISTINCT records that had ≥1 field filled.
 */
export async function applyMetadataMerge(projectId, matches, ctx = {}) {
  const runId = String(ctx.runId || '');
  const batchId = String(ctx.batchId || '');
  const changedFieldsByRecord = new Map();
  let updated = 0;

  // Group donors per target record (one record may be matched by several copies).
  const byTarget = new Map();
  for (const m of Array.isArray(matches) ? matches : []) {
    if (!m || !m.screenRecordId || !m.donor) continue;
    if (!byTarget.has(m.screenRecordId)) byTarget.set(m.screenRecordId, []);
    byTarget.get(m.screenRecordId).push(m.donor);
  }
  const ids = [...byTarget.keys()];
  if (!ids.length) return { updated, changedFieldsByRecord };

  const changeModel = prisma.screenRecordMetadataChange;
  const canLogChanges = !!(changeModel && typeof changeModel.createMany === 'function');

  // 96.md run-distinct `updated` accounting: within ONE run, a record already
  // fill-merged by an earlier page/source (its change rows for this run exist) is
  // not counted again, so `updated` stays "distinct records per run" rather than
  // "update events". File imports (runId '') are one call per batch, so their
  // per-call distinctness is already per-batch distinct.
  const alreadyCountedThisRun = new Set();
  if (runId && canLogChanges) {
    for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
      try {
        const prev = await changeModel.findMany({
          where: { runId, screenRecordId: { in: ids.slice(i, i + INSERT_CHUNK) } },
          select: { screenRecordId: true },
        });
        for (const p of prev) alreadyCountedThisRun.add(p.screenRecordId);
      } catch { /* accounting refinement only — never block the merge */ }
    }
  }

  for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
    const chunk = ids.slice(i, i + INSERT_CHUNK);
    let targets = [];
    try {
      targets = await prisma.screenRecord.findMany({
        where: { id: { in: chunk }, projectId },
        select: { id: true, doi: true, pmid: true, abstract: true, authors: true, year: true, journal: true, keywords: true },
      });
    } catch { targets = []; }
    for (const t of targets) {
      const { patch } = mergeFillBlanks(t, byTarget.get(t.id) || [], MERGE_FILL_FIELDS);
      const fields = Object.keys(patch);
      if (!fields.length) continue;
      // Patch contains ONLY blank bibliographic fields — reviewer work is sacred.
      try { await prisma.screenRecord.update({ where: { id: t.id }, data: patch }); }
      catch { continue; /* record vanished mid-merge — skip, never fail the import */ }
      if (!alreadyCountedThisRun.has(t.id)) updated += 1;
      alreadyCountedThisRun.add(t.id);
      changedFieldsByRecord.set(t.id, fields);
      // Change rows are written IMMEDIATELY per record (one retry) so a mid-merge
      // crash can lose the audit trail of at most the record being written, never
      // a whole batch of already-applied fills.
      if (canLogChanges) {
        const rows = fields.map((f) => ({
          projectId, screenRecordId: t.id, runId, batchId, field: f,
          fromValue: String(t[f] == null ? '' : t[f]).slice(0, CHANGE_VALUE_CAP),
          toValue: String(patch[f] == null ? '' : patch[f]).slice(0, CHANGE_VALUE_CAP),
        }));
        try { await changeModel.createMany({ data: rows }); }
        catch {
          try { await changeModel.createMany({ data: rows }); }
          catch { /* best-effort audit after one retry */ }
        }
      }
    }
  }

  return { updated, changedFieldsByRecord };
}

// Composite-key identities for a ScreenRecordSource row. Parts are joined with a
// \u0001 unit separator so field boundaries can never be confused across parts
// (e.g. runId 'x' + batchId '' vs runId '' + batchId 'x').
const KEY_SEP = '';

/** Full unique-key identity (mirrors the schema's composite unique key). */
export const sourceKeyOf = (r) =>
  [r.screenRecordId, r.runId || '', r.batchId || '', r.provider || '', r.providerRecordId || ''].join(KEY_SEP);

/**
 * Run-scoped LOGICAL identity for pecan rows (runId set): a page retried after a
 * mid-page crash lands in a NEW ScreenImportBatch, so batchId must not take part
 * in the idempotency identity — (screenRecordId, runId, provider,
 * providerRecordId) is the real key. Returns '' for rows without a runId
 * (file/api imports keep their batch-scoped identity — each distinct import
 * event is a distinct provenance row by design).
 */
export const runScopedSourceKeyOf = (r) =>
  r && r.runId ? [r.screenRecordId, r.runId, r.provider || '', r.providerRecordId || ''].join(KEY_SEP) : '';

/**
 * writeRecordSources(rows) — 96.md D9: idempotent, best-effort ScreenRecordSource
 * writer shared by file imports and the pecan pipeline. Query-first per chunk on
 * the composite unique key (screenRecordId, runId, batchId, provider,
 * providerRecordId) so page resumes / retries never duplicate provenance
 * (SQLite has no createMany skipDuplicates). For rows carrying a runId the
 * RUN-scoped identity (batchId ignored) is checked too, so a crash-retried page
 * that lands in a NEW batch never writes a second, contradictory row for the same
 * (record, run, provider, providerRecordId). Rows without a screenRecordId are
 * dropped (nothing to attribute). Never throws.
 *
 * @param {object[]} rows ScreenRecordSource data rows
 * @returns {Promise<number>} rows actually written
 */
export async function writeRecordSources(rows) {
  const model = prisma.screenRecordSource;
  if (!model || typeof model.createMany !== 'function') return 0;
  const clean = (Array.isArray(rows) ? rows : []).filter((r) => r && r.screenRecordId);
  let written = 0;
  for (let i = 0; i < clean.length; i += INSERT_CHUNK) {
    const chunk = clean.slice(i, i + INSERT_CHUNK);
    try {
      const existing = await model.findMany({
        where: { screenRecordId: { in: [...new Set(chunk.map((r) => r.screenRecordId))] } },
        select: { screenRecordId: true, runId: true, batchId: true, provider: true, providerRecordId: true },
      });
      const seen = new Set(existing.map(sourceKeyOf));
      const seenRunScoped = new Set(existing.map(runScopedSourceKeyOf).filter(Boolean));
      const fresh = [];
      for (const r of chunk) {
        const k = sourceKeyOf(r);
        const rk = runScopedSourceKeyOf(r);
        if (seen.has(k)) continue;
        if (rk && seenRunScoped.has(rk)) continue; // same run+provider+record, older batch
        seen.add(k); // dedupe within the chunk too
        if (rk) seenRunScoped.add(rk);
        fresh.push(r);
      }
      if (fresh.length) {
        const res = await model.createMany({ data: fresh });
        written += (res && res.count) || fresh.length;
      }
    } catch {
      // Unique-key race with a concurrent writer — fall back to per-row inserts.
      for (const r of chunk) {
        try {
          if (r.runId) {
            // Run-scoped identity check (the DB unique includes batchId, so it
            // cannot backstop the cross-batch retry case on its own).
            const dup = await model.findFirst({
              where: {
                screenRecordId: r.screenRecordId, runId: r.runId,
                provider: r.provider || '', providerRecordId: r.providerRecordId || '',
              },
              select: { id: true },
            });
            if (dup) continue;
          }
          await model.create({ data: r });
          written += 1;
        } catch { /* duplicate — already recorded */ }
      }
    }
  }
  return written;
}

/** Throw the coded conflict every landing path surfaces while a reset runs. */
function throwIfResetLocked(projectId) {
  if (!isResetLocked(projectId)) return;
  const err = new Error('Imported records are being reset for this project. Wait for the reset to finish, then try again.');
  err.code = 'RESET_IN_PROGRESS';
  throw err;
}

// 96.md — per-project landing serialization (in-process is authoritative: the
// server is a single Node process; workers and the pecan pipeline run in it).
// Concurrent sources/jobs landing into the SAME project run the dedupe+insert
// critical section sequentially, so two providers returning the same new article
// can never both pass the existence check before either inserts.
const landingQueues = new Map(); // projectId -> tail promise of the chain

/**
 * Resolves once every landing currently queued/running for the project has
 * finished (never rejects). The reset controller awaits this AFTER taking the
 * reset lock (no new landings can start) so an in-flight synchronous import —
 * which has no job row for the reset's job fence to see — can never race the
 * delete transaction.
 */
export function whenLandingIdle(projectId) {
  const tail = landingQueues.get(projectId);
  return tail ? tail.then(() => {}) : Promise.resolve();
}

/** Exported for unit tests (serialization + leak-free drain are pinned there). */
export function withProjectLandingLock(projectId, fn) {
  const prev = landingQueues.get(projectId) || Promise.resolve();
  // A failed earlier landing must not poison the chain for the next caller.
  const next = prev.catch(() => {}).then(fn); // caller sees fn's result/error via `next`
  // Leak-free: drop the map entry once the chain drains (identity-checked so a
  // newer tail enqueued meanwhile is never deleted).
  const tail = next.catch(() => {}).then(() => {
    if (landingQueues.get(projectId) === tail) landingQueues.delete(projectId);
  });
  landingQueues.set(projectId, tail);
  return next;
}

/**
 * dedupeAndInsertRecords(projectId, records, opts)
 * Dedupe `records` against the project's existing records AND within the batch,
 * then bulk-insert the survivors. Throws a typed error { code: 'CAPACITY' } when
 * the project ceiling would be exceeded (caller maps to a clear message), and
 * { code: 'RESET_IN_PROGRESS' } while a scoped reset holds the project's reset
 * lock (HTTP callers map it to 409; the pecan pipeline stops the source as a
 * retryable failure).
 *
 * Landings are serialized PER PROJECT (see withProjectLandingLock above), so the
 * seed-query → createMany window can never interleave with another landing into
 * the same project.
 *
 * @param {string} projectId
 * @param {object[]} records   parsed canonical records
 * @param {object} opts        { format, fileHash, fileSize, importedById, importedByName, parser,
 *                               maxRecords, onProgress(progress),
 *                               searchRunId, provider, metaLabProjectId, origin } (96.md provenance context)
 * @returns {Promise<{ imported, skippedDuplicates, rejected, updated, batchId, total, keptCount }>}
 */
export async function dedupeAndInsertRecords(projectId, records, opts = {}) {
  // Fail fast BEFORE queueing, and again inside the critical section: a landing
  // queued behind another one must not proceed if a reset started meanwhile.
  throwIfResetLocked(projectId);
  return withProjectLandingLock(projectId, () => dedupeAndInsertRecordsSerialized(projectId, records, opts));
}

async function dedupeAndInsertRecordsSerialized(projectId, records, opts = {}) {
  throwIfResetLocked(projectId);
  const {
    format = '', filename = '', fileHash = null, fileSize = 0,
    importedById = null, importedByName = '', parser = '', source = 'file',
    maxRecords = DEFAULT_MAX_RECORDS_PER_PROJECT, onProgress,
    // 96.md D9/D10 — provenance context (pecan pipeline passes run/provider; file
    // imports default to batch-only attribution).
    searchRunId = '', provider = '', metaLabProjectId = '', origin = '',
    // 104.md — the database this manual import came from, when the importer knows
    // it (the file itself rarely says). Recorded on the batch AND used as the
    // per-record attribution fallback, so a hand-run Embase search can be reported
    // by the manuscript instead of being silently unattributable.
    sourceDatabase = '', searchedAt = null,
  } = opts;
  const provenanceOrigin = origin || ORIGIN_BY_SOURCE[source] || 'file';

  const incoming = Array.isArray(records) ? records : [];

  // Seed dedupe sets from the project's existing identity columns (indexed).
  // `id` rides along so a duplicate match can attribute + merge into its target
  // (96.md) — still O(n) in identity columns, never full row payloads.
  const existing = await prisma.screenRecord.findMany({
    where: { projectId },
    select: { id: true, doi: true, pmid: true, title: true },
  });
  const seenDois = new Set(), seenPmids = new Set(), seenTitles = new Set();
  const idByDoi = new Map(), idByPmid = new Map(), idByTitle = new Map();
  for (const r of existing) {
    const { doi, pmid, nt } = keysOf(r);
    if (doi) { seenDois.add(doi); if (!idByDoi.has(doi)) idByDoi.set(doi, r.id); }
    if (pmid) { seenPmids.add(pmid); if (!idByPmid.has(pmid)) idByPmid.set(pmid, r.id); }
    if (nt) { seenTitles.add(nt); if (!idByTitle.has(nt)) idByTitle.set(nt, r.id); }
  }

  const kept = [];
  // 96.md — duplicate matches, kept for the fill-blank merge + provenance rows.
  // matchedId '' = in-batch duplicate (target not inserted yet; resolved after insert).
  const matches = [];
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
      const matchedId = (doi && idByDoi.get(doi)) || (pmid && idByPmid.get(pmid)) || (nt && idByTitle.get(nt)) || '';
      matches.push({ r, matchedId, keys: { doi, pmid, nt } });
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
      // 96.md D12 — first-class run attribution (replaces parsing the synthetic fileHash).
      searchRunId,
      // 116.md §14 — an importer-declared search is PERSISTED at import time (the
      // 104.md batch fields), not lost until an after-the-fact Import History
      // PATCH. Absent declaration keeps the schema defaults ('' / null).
      sourceDatabase: String(sourceDatabase || '').trim().slice(0, 100),
      searchedAt: searchedAt ? new Date(searchedAt) : null,
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
        // 116.md §14 — no `r.source` fallback: parsers used to stamp the FILE
        // FORMAT there ("RIS", "BibTeX"…), so a record with no journal field got
        // `journal: "RIS"`. donorShape (the merge path) already refused exactly
        // this; the insert path now matches it.
        journal:  String(r.journal || '').slice(0, 300),
        doi:      String(r.doi || '').slice(0, 200),
        pmid:     String(r.pmid || '').slice(0, 50),
        abstract: String(r.abstract || '').slice(0, 5000),
        keywords: Array.isArray(r.keywords) ? r.keywords.join('; ') : String(r.keywords || ''),
        // 104.md/116.md §14 — a record's database attribution is what the FILE
        // reliably said (parsers now emit `sourceDb` ONLY for a RECOGNIZED
        // database name — RIS `DB` tag, EndNote remote-database-name, nbib ⇒
        // PubMed), or what the importer explicitly declared. It is NEVER the file
        // format: the old `|| r.source` fallback re-poisoned sourceDb with format
        // tokens on every import because parsers always filled `source`, which is
        // how a manuscript could report that the team "searched Ris". An empty
        // sourceDb is honest and handled everywhere downstream: provenance drops
        // unattributed records rather than inventing a database, and PRISMA
        // labels them "Unspecified source".
        sourceDb: String(r.sourceDb || sourceDatabase || '').slice(0, 100),
        rawData:  JSON.stringify(r).slice(0, 2000),
      })),
    });
    imported += chunk.length;
    if (typeof onProgress === 'function') {
      // Best-effort progress tick; a reporting failure must not abort the insert.
      try { await onProgress({ imported, total: kept.length }); } catch { /* ignore */ }
    }
  }

  // Inserted rows (id + identity) — resolves in-batch duplicate targets, feeds the
  // provenance rows below AND the imported-decision mapping (single query, reused).
  let insertedRows = [];
  try {
    insertedRows = await prisma.screenRecord.findMany({
      where: { importBatchId: batch.id }, select: { id: true, doi: true, pmid: true, title: true },
    });
  } catch { insertedRows = []; }
  const idByKey = new Map();
  for (const rec of insertedRows) {
    const { doi, pmid, nt } = keysOf(rec);
    if (doi && !idByKey.has('d:' + doi)) idByKey.set('d:' + doi, rec.id);
    if (pmid && !idByKey.has('p:' + pmid)) idByKey.set('p:' + pmid, rec.id);
    if (nt && !idByKey.has('t:' + nt)) idByKey.set('t:' + nt, rec.id);
  }

  // ── 96.md D9/D10 — safe metadata merge + article-level provenance. Best-effort:
  //    a failure here must never abort an otherwise-successful import. ──
  let updated = 0;
  try {
    // Resolve in-batch duplicates ('' matchedId) to the sibling inserted above.
    const resolvedMatches = matches
      .map((m) => ({
        ...m,
        matchedId: m.matchedId
          || (m.keys.doi && idByKey.get('d:' + m.keys.doi))
          || (m.keys.pmid && idByKey.get('p:' + m.keys.pmid))
          || (m.keys.nt && idByKey.get('t:' + m.keys.nt))
          || '',
      }))
      .filter((m) => m.matchedId);

    const mergeRes = await applyMetadataMerge(
      projectId,
      resolvedMatches.map((m) => ({ screenRecordId: m.matchedId, donor: donorShape(m.r) })),
      { runId: searchRunId, batchId: batch.id },
    );
    updated = mergeRes.updated;

    const provRows = [];
    for (const r of kept) {
      const { doi, pmid, nt } = keysOf(r);
      const id = (doi && idByKey.get('d:' + doi)) || (pmid && idByKey.get('p:' + pmid)) || (nt && idByKey.get('t:' + nt)) || '';
      if (!id) continue;
      provRows.push({
        projectId, screenRecordId: id, metaLabProjectId,
        runId: searchRunId, batchId: batch.id, provider,
        providerRecordId: String(r.providerRecordId || '').slice(0, 200),
        outcome: 'new', changedFields: '', origin: provenanceOrigin,
      });
    }
    for (const m of resolvedMatches) {
      const fields = mergeRes.changedFieldsByRecord.get(m.matchedId);
      provRows.push({
        projectId, screenRecordId: m.matchedId, metaLabProjectId,
        runId: searchRunId, batchId: batch.id, provider,
        providerRecordId: String(m.r.providerRecordId || '').slice(0, 200),
        outcome: fields ? 'updated' : 'already_present',
        changedFields: fields ? JSON.stringify(fields).slice(0, 2000) : '',
        origin: provenanceOrigin,
      });
    }
    await writeRecordSources(provRows);
  } catch { /* provenance/merge is additive — never fail the import */ }

  const batchPatch = {};
  if (imported !== batch.recordCount) batchPatch.recordCount = imported;
  if (updated) batchPatch.updatedCount = updated;
  if (Object.keys(batchPatch).length) {
    try { await prisma.screenImportBatch.update({ where: { id: batch.id }, data: batchPatch }); }
    catch { /* count reconciliation is best-effort */ }
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
    // idByKey was built above from this batch's inserted rows (single shared query).
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

  // 96.md — `updated` is ADDITIVE (existing keys byte-compatible): distinct existing
  // records whose blank metadata this import filled. updated ⊆ skippedDuplicates, so
  // PRISMA accounting (duplicateCount) is unchanged (invariant 6 — an updated record
  // still counts as already-present).
  return { imported, skippedDuplicates, rejected, updated, batchId: batch.id, total: incoming.length, keptCount: kept.length, decisionsApplied, invalidDecisions, errorReport };
}
