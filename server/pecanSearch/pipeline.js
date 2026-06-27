/**
 * pecanSearch/pipeline.js — the streaming, chunked, crash-resumable ingestion
 * pipeline for ONE source within a run (§15). Never buffers all records in memory:
 * it processes a page at a time and persists durable state after each page so a
 * worker restart resumes from the last completed page (cursor), not page 1.
 *
 * Per page:  fetch → validate → normalize → persist source records (idempotent)
 *            → dedup classify → land NEW/AMBIGUOUS via dedupeAndInsertRecords
 *            → link provenance → record dedup decisions → update counts + cursor
 *            → emit progress → next page.
 *
 * Idempotency: source records are keyed by (runId, provider, providerRecordId) and
 * filtered against a seen-set re-seeded from the DB at start, so a re-fetched page
 * persists nothing twice. Landing is idempotent because the dedup index is seeded
 * from the project's CURRENT records (which include anything a prior attempt
 * landed), so an already-processed page classifies as existing_match and lands 0.
 *
 * No DB transaction is ever held open across an external HTTP call.
 */
import { prisma } from '../db/client.js';
import { dedupeAndInsertRecords, DEFAULT_MAX_RECORDS_PER_PROJECT } from '../services/screeningImportService.js';
import { normalizeTitle } from '../../src/research-engine/screening/deduplication.js';
import { toScreeningRecord } from './normalize.js';
import { contentHashId } from './connectors/base.js';
import { DEDUP_RULE_VERSION } from './dedup.js';
import { PecanError, toPecanError, isRetryable } from './errors.js';
import { sanitizeErrorDetail } from './redact.js';

const nt = (s) => normalizeTitle(s || '');

/**
 * runSource — execute one provider source to completion (or partial/cancel/fail).
 *
 * @param {object} a
 *   sourceRow      PecanSearchSource row (has id, provider, finalQuery, cap, cursor…)
 *   connector      the provider connector instance
 *   translated     the TranslatedQuery (query string + diagnostics)
 *   index          dedup index (createDedupIndex result) — SHARED across sources in a run
 *   screenProjectId target ScreenProject id (landing)
 *   metaLabProjectId
 *   config         engine config
 *   secrets        string[] for error redaction
 *   signal         AbortSignal (cancellation)
 *   isCancelled()  durable cancel check (re-reads the run flag)
 *   onPageProgress(sourcePatch) callback after each page (updates job + SSE)
 *   maxRecordsPerProject
 * @returns {Promise<object>} the final per-source counts + state
 */
export async function runSource(a) {
  const {
    sourceRow, connector, translated, index, screenProjectId, metaLabProjectId,
    config, secrets = [], signal, isCancelled, onPageProgress, maxRecordsPerProject = DEFAULT_MAX_RECORDS_PER_PROJECT,
  } = a;

  const provider = sourceRow.provider;
  const cap = sourceRow.cap > 0 ? sourceRow.cap : config.engine.defaultResultCap;

  // Aggregate counters (seeded from the row so a resume continues, not restarts).
  const counts = {
    rawCount: sourceRow.rawCount || 0,
    normalizedCount: sourceRow.normalizedCount || 0,
    importedCount: sourceRow.importedCount || 0,
    existingMatchCount: sourceRow.existingMatchCount || 0,
    exactDupCount: sourceRow.exactDupCount || 0,
    fuzzyDupCount: sourceRow.fuzzyDupCount || 0,
    ambiguousDupCount: sourceRow.ambiguousDupCount || 0,
    failedRecordCount: sourceRow.failedRecordCount || 0,
  };
  let retryCount = sourceRow.retryCount || 0;
  let lastCompletedPage = sourceRow.lastCompletedPage || 0;
  let cursor = sourceRow.cursor || null;
  let capReached = !!sourceRow.capReached;

  // Seen provider-record ids for THIS run+provider (idempotent re-fetch).
  const seen = new Set();
  try {
    const prev = await prisma.pecanSourceRecord.findMany({
      where: { runId: sourceRow.runId, provider }, select: { providerRecordId: true },
    });
    for (const r of prev) if (r.providerRecordId) seen.add(r.providerRecordId);
  } catch { /* best-effort; unique constraint is the backstop */ }

  await setSource(sourceRow.id, { state: 'running', stage: 'fetching', startedAt: sourceRow.startedAt || new Date() });

  let finalState = 'completed';
  let errorClass = '';
  let errorDetail = '';

  try {
    for (;;) {
      if (await checkCancel(isCancelled)) { finalState = 'cancelled'; break; }
      if (capReached || counts.rawCount >= cap) { capReached = true; break; }

      // ── Fetch one page (the only external call; retries handled in the client). ──
      let page;
      try {
        await setSource(sourceRow.id, { stage: 'fetching' });
        page = await connector.search(translated, cursor, {
          pageSize: config.providers[provider]?.pageSize,
          capRemaining: cap - counts.rawCount,
          signal,
        });
      } catch (err) {
        const pe = toPecanError(err);
        if (pe.code === 'SEARCH_CANCELLED') { finalState = 'cancelled'; break; }
        // Transient → the run can RETRY this source later; mark partial+failed-soft.
        errorClass = pe.code; errorDetail = sanitizeErrorDetail(pe, secrets);
        finalState = isRetryable(pe) ? 'partial' : 'failed';
        break;
      }

      const raw = Array.isArray(page.records) ? page.records : [];
      if (!raw.length && !page.nextCursor) break; // genuinely empty / exhausted

      // ── Normalize. Per-record fault isolation; page-LOCAL counters that are folded
      //    into the durable totals ONLY after the page commits, so a re-fetch after a
      //    mid-page failure/retry never double-counts (§17.1). ──
      await setSource(sourceRow.id, { stage: 'normalizing' });
      const pagec = { raw: 0, normalized: 0, imported: 0, existingMatch: 0, exactDup: 0, fuzzyDup: 0, ambiguous: 0, failed: 0 };
      const normalized = [];
      for (const item of raw) {
        if (counts.rawCount + pagec.raw >= cap) { capReached = true; break; }
        pagec.raw += 1;
        try {
          const norm = connector.normalize(item);
          const providerRecordId = norm.providerRecordId || contentHashId(norm);
          if (seen.has(providerRecordId)) continue;       // idempotent: already persisted
          seen.add(providerRecordId);
          normalized.push({ ...norm, providerRecordId });
          pagec.normalized += 1;
        } catch (err) {
          pagec.failed += 1;
        }
      }

      // ── Dedup classify each normalized record. ──
      await setSource(sourceRow.id, { stage: 'deduplicating' });
      const toLand = [];           // new + ambiguous (distinct records to insert)
      const records = [];          // every normalized record (for source-record provenance)
      for (const norm of normalized) {
        let verdict;
        try { verdict = index.classify(norm); }
        catch { verdict = { outcome: 'new', matchedId: '', score: 0, components: {}, type: 'not_duplicate', reasons: [], conflicts: [], decisionSource: '' }; }
        norm._verdict = verdict;
        records.push(norm);
        if (verdict.outcome === 'new' || verdict.outcome === 'ambiguous') toLand.push(norm);
      }

      // ── Land NEW + AMBIGUOUS records (reuses the screening import landing). ──
      const landedMap = new Map();   // doi/pmid/normTitle -> screenRecordId
      const landedIds = new Set();   // ScreenRecord ids CREATED in this batch (genuinely new)
      if (toLand.length) {
        await setSource(sourceRow.id, { stage: 'importing' });
        const screeningRecords = toLand.map((n) => toScreeningRecord(n, { sourceDb: provider }));
        let result;
        try {
          result = await dedupeAndInsertRecords(screenProjectId, screeningRecords, {
            format: 'pecan-search', filename: `${provider} search`,
            source: 'pecan-search', // 58.md §7 — tag the batch source for PRISMA accounting
            fileHash: `pecan:${sourceRow.runId}:${provider}:${lastCompletedPage + 1}`,
            importedById: a.initiatedById || '', importedByName: a.initiatedByName || '',
            parser: provider, maxRecords: maxRecordsPerProject,
          });
        } catch (err) {
          if (err && err.code === 'CAPACITY') {
            errorClass = 'RESULT_CAP_REACHED'; errorDetail = sanitizeErrorDetail(err, secrets);
            capReached = true; finalState = 'partial'; break;
          }
          const pe = toPecanError(err, 'DB_WRITE_FAILED');
          errorClass = pe.code; errorDetail = sanitizeErrorDetail(pe, secrets);
          finalState = 'partial'; break;
        }
        pagec.imported += result.imported;
        const landed = await prisma.screenRecord.findMany({
          where: { importBatchId: result.batchId }, select: { id: true, doi: true, pmid: true, title: true },
        });
        for (const r of landed) {
          if (r.doi) landedMap.set('doi:' + String(r.doi).toLowerCase(), r.id);
          if (r.pmid) landedMap.set('pmid:' + String(r.pmid), r.id);
          const t = nt(r.title); if (t) landedMap.set('t:' + t, r.id);
          landedIds.add(r.id);
          index.addLanded(r); // future pages dedup against these
        }
      }

      // Resolve the canonical ScreenRecord id for a record. For new/ambiguous, prefer
      // this batch's landed id; else fall back to the SHARED dedup index — which
      // catches a record a CONCURRENT source landed between our classify and our
      // insert (which dedupeAndInsertRecords then skipped) so provenance is NEVER
      // lost (§3.1).
      const resolveScreenId = (norm) => {
        const v = norm._verdict;
        if (v && (v.outcome === 'existing_match' || v.outcome === 'exact_dup' || v.outcome === 'fuzzy_dup')) return v.matchedId || '';
        return landedMap.get('doi:' + norm.doi) || landedMap.get('pmid:' + norm.pmid) || landedMap.get('t:' + nt(norm.title))
          || (index.resolveId ? index.resolveId(norm) : '') || '';
      };

      // ── Reconcile final outcome + page counts (AFTER landing). A new/ambiguous
      //    record that did NOT create a fresh ScreenRecord (deduped away by the
      //    landing, or matched a concurrently-landed record) is a duplicate — counted
      //    as existing_match, NOT as a dangling "ambiguous" review item (§16). ──
      for (const norm of records) {
        const v = norm._verdict;
        const sid = resolveScreenId(norm);
        norm._screenId = sid;
        if (v.outcome === 'new' || v.outcome === 'ambiguous') {
          const landedNew = sid && landedIds.has(sid);
          if (landedNew) {
            norm._finalOutcome = v.outcome;
            if (v.outcome === 'ambiguous') pagec.ambiguous += 1;
          } else if (sid) {
            norm._finalOutcome = 'existing_match'; // collapsed into an existing/sibling record
            pagec.existingMatch += 1;
          } else {
            norm._finalOutcome = 'new'; // genuinely new but unlinkable (rare); count via imported
          }
        } else if (v.outcome === 'existing_match') { norm._finalOutcome = 'existing_match'; pagec.existingMatch += 1; }
        else if (v.outcome === 'exact_dup') { norm._finalOutcome = 'exact_dup'; pagec.exactDup += 1; }
        else if (v.outcome === 'fuzzy_dup') { norm._finalOutcome = 'fuzzy_dup'; pagec.fuzzyDup += 1; }
        else { norm._finalOutcome = 'new'; }
      }

      // ── Persist source records (provenance) + dedup decisions. ──
      const sourceRecordRows = records.map((norm) => ({
        runId: sourceRow.runId, sourceId: sourceRow.id, metaLabProjectId, provider,
        providerRecordId: norm.providerRecordId,
        screenRecordId: norm._screenId || '',
        doi: norm.doi || '', pmid: norm.pmid || '', pmcid: norm.pmcid || '', nctId: norm.nctId || '',
        title: (norm.title || '').slice(0, 1000), abstract: (norm.abstract || '').slice(0, 12000),
        authors: (norm.authors || '').slice(0, 2000), year: norm.year || '', journal: (norm.journal || '').slice(0, 400),
        volume: norm.volume || '', issue: norm.issue || '', pages: norm.pages || '', pubType: norm.pubType || '',
        language: norm.language || '', url: norm.url || '',
        keywords: JSON.stringify(norm.keywords || []).slice(0, 4000),
        meshTerms: JSON.stringify(norm.meshTerms || []).slice(0, 4000),
        retracted: !!norm.retracted,
        rawPayload: typeof norm.raw === 'string' ? norm.raw.slice(0, 20000) : JSON.stringify(norm.raw || {}).slice(0, 20000),
        normalized: JSON.stringify({ doi: norm.doi, pmid: norm.pmid, title: norm.title, year: norm.year, authors: norm.authors }).slice(0, 4000),
        normalizationVersion: norm.normalizationVersion || '',
        dedupOutcome: norm._finalOutcome || 'new',
      }));

      const decisionRows = [];
      for (const norm of records) {
        const v = norm._verdict;
        const outcome = norm._finalOutcome;
        if (outcome === 'ambiguous') {
          // A genuinely-distinct record awaiting human review — reference its landed
          // ScreenRecord id so review groups it via the screening duplicate model.
          decisionRows.push({
            runId: sourceRow.runId, metaLabProjectId,
            sourceRecordId: norm._screenId || norm.providerRecordId,
            matchedScreenRecordId: v.matchedId || '',
            score: Math.round(v.score || 0),
            scoreComponents: JSON.stringify(v.components || {}).slice(0, 2000),
            ruleVersion: DEDUP_RULE_VERSION, matchType: shortType(v.type),
            decision: 'pending', decisionSource: 'pending',
            reasons: JSON.stringify(v.reasons || []).slice(0, 2000),
            conflicts: JSON.stringify(v.conflicts || []).slice(0, 1000),
          });
        } else if (outcome === 'fuzzy_dup' || outcome === 'exact_dup') {
          // Auto-merged duplicate — an audit record of the automatic decision.
          decisionRows.push({
            runId: sourceRow.runId, metaLabProjectId,
            sourceRecordId: norm.providerRecordId,
            matchedScreenRecordId: v.matchedId || '',
            score: Math.round(v.score || 0),
            scoreComponents: JSON.stringify(v.components || {}).slice(0, 2000),
            ruleVersion: DEDUP_RULE_VERSION, matchType: shortType(v.type),
            decision: 'merged', decisionSource: outcome === 'fuzzy_dup' ? 'automatic' : 'identity',
            reasons: JSON.stringify(v.reasons || []).slice(0, 2000),
            conflicts: JSON.stringify(v.conflicts || []).slice(0, 1000),
            decidedAt: new Date(),
          });
        }
        // new + existing_match → no decision row.
      }

      // Idempotent inserts (records were filtered against `seen`, so all are new).
      if (sourceRecordRows.length) {
        try { await prisma.pecanSourceRecord.createMany({ data: sourceRecordRows }); }
        catch (err) { /* unique backstop hit on a race — fall back to per-row upsert */ await upsertSourceRecords(sourceRecordRows); }
      }
      if (decisionRows.length) {
        try { await prisma.pecanDedupDecision.createMany({ data: decisionRows }); } catch { /* advisory; non-fatal */ }
      }

      // ── Page committed: fold page-local counters into the durable totals NOW. ──
      counts.rawCount += pagec.raw;
      counts.normalizedCount += pagec.normalized;
      counts.importedCount += pagec.imported;
      counts.existingMatchCount += pagec.existingMatch;
      counts.exactDupCount += pagec.exactDup;
      counts.fuzzyDupCount += pagec.fuzzyDup;
      counts.ambiguousDupCount += pagec.ambiguous;
      counts.failedRecordCount += pagec.failed;

      // ── Advance durable state + emit progress. ──
      lastCompletedPage += 1;
      cursor = page.nextCursor || null;
      await setSource(sourceRow.id, {
        ...counts, retryCount, lastCompletedPage, cursor: cursor || '', capReached,
        previewCount: page.total != null ? page.total : sourceRow.previewCount,
      });
      if (typeof onPageProgress === 'function') {
        try { await onPageProgress({ provider, ...counts, lastCompletedPage, total: page.total, capReached }); } catch { /* best-effort */ }
      }

      if (config.engine.pageDelayMs) await new Promise((r) => setTimeout(r, config.engine.pageDelayMs));
      if (!cursor) break;     // exhausted
      if (counts.rawCount >= cap) { capReached = true; break; }
    }
  } catch (err) {
    const pe = toPecanError(err);
    errorClass = pe.code; errorDetail = sanitizeErrorDetail(pe, secrets);
    finalState = 'failed';
  }

  // Finalize per-source row.
  const stage = finalState === 'completed' ? 'completed'
    : finalState === 'partial' ? 'partial'
    : finalState === 'cancelled' ? 'cancelled' : 'failed';
  await setSource(sourceRow.id, {
    ...counts, state: finalState, stage, capReached,
    errorClass, errorDetail, retryCount,
    cursor: cursor || '', lastCompletedPage,
    completedAt: new Date(),
  });

  return { provider, state: finalState, ...counts, capReached, errorClass, errorDetail };
}

/** Map a DUP_TYPES value to the short matchType stored on the decision. */
function shortType(t) {
  const s = String(t || '');
  if (s.includes('exact')) return 'exact';
  if (s.includes('probable')) return 'probable';
  if (s.includes('possible')) return 'possible';
  if (s.includes('related')) return 'related';
  if (s.includes('family')) return 'family';
  return 'not';
}

async function setSource(id, data) {
  try { await prisma.pecanSearchSource.update({ where: { id }, data: { ...data, updatedAt: new Date() } }); }
  catch { /* best-effort; never crash the pipeline on a status write */ }
}

async function upsertSourceRecords(rows) {
  for (const row of rows) {
    try {
      await prisma.pecanSourceRecord.upsert({
        where: { runId_provider_providerRecordId: { runId: row.runId, provider: row.provider, providerRecordId: row.providerRecordId } },
        create: row, update: { screenRecordId: row.screenRecordId, dedupOutcome: row.dedupOutcome },
      });
    } catch { /* give up on this row rather than fail the page */ }
  }
}

async function checkCancel(isCancelled) {
  try { return typeof isCancelled === 'function' ? await isCancelled() : false; } catch { return false; }
}
