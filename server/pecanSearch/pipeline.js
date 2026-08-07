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
import {
  dedupeAndInsertRecords, DEFAULT_MAX_RECORDS_PER_PROJECT,
  // 96.md D9/D10 — shared safe-merge + idempotent provenance writers (query-first
  // on the ScreenRecordSource unique key; page-resume-safe).
  applyMetadataMerge, writeRecordSources, donorShape,
} from '../services/screeningImportService.js';
import { normalizeTitle } from '../../src/research-engine/screening/deduplication.js';
import { toScreeningRecord } from './normalize.js';
import { contentHashId } from './connectors/base.js';
import { DEDUP_RULE_VERSION } from './dedup.js';
import { PecanError, toPecanError, isRetryable } from './errors.js';
import { sanitizeErrorDetail } from './redact.js';
// 101.md §3/§29 — the search engine writes into the SAME unified ProjectEvent ledger
// every other engine uses; no second, search-only provenance architecture (§40).
import { recordEvents } from '../provenance/recordEvent.js';
import { deriveSearchProvenance, reportableDatabases } from '../../src/research-engine/search/searchProvenance.js';

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
    updatedCount: sourceRow.updatedCount || 0,
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
      const pagec = { raw: 0, normalized: 0, imported: 0, existingMatch: 0, updated: 0, exactDup: 0, fuzzyDup: 0, ambiguous: 0, failed: 0 };
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
        // 96.md D9 — providerRecordId rides along so the landing writes exact
        // article-level provenance rows (ScreenRecordSource) per provider record.
        const screeningRecords = toLand.map((n) => ({ ...toScreeningRecord(n, { sourceDb: provider }), providerRecordId: n.providerRecordId }));
        let result;
        try {
          result = await dedupeAndInsertRecords(screenProjectId, screeningRecords, {
            format: 'pecan-search', filename: `${provider} search`,
            source: 'pecan-search', // 58.md §7 — tag the batch source for PRISMA accounting
            fileHash: `pecan:${sourceRow.runId}:${provider}:${lastCompletedPage + 1}`,
            importedById: a.initiatedById || '', importedByName: a.initiatedByName || '',
            parser: provider, maxRecords: maxRecordsPerProject,
            // 96.md D9/D12 — run attribution on the batch + provenance rows.
            searchRunId: sourceRow.runId, provider, metaLabProjectId, origin: 'search',
          });
        } catch (err) {
          if (err && err.code === 'CAPACITY') {
            errorClass = 'RESULT_CAP_REACHED'; errorDetail = sanitizeErrorDetail(err, secrets);
            capReached = true; finalState = 'partial'; break;
          }
          if (err && err.code === 'RESET_IN_PROGRESS') {
            // 96.md Phase 6F — a screening reset holds the project's reset lock:
            // stop this source as a RETRYABLE failure (partial → retryRun works
            // once the reset finishes) instead of racing the delete transaction.
            errorClass = 'RESET_IN_PROGRESS'; errorDetail = sanitizeErrorDetail(err, secrets);
            finalState = 'partial'; break;
          }
          const pe = toPecanError(err, 'DB_WRITE_FAILED');
          errorClass = pe.code; errorDetail = sanitizeErrorDetail(pe, secrets);
          finalState = 'partial'; break;
        }
        pagec.imported += result.imported;
        pagec.updated += result.updated || 0; // records the landing fill-blank-merged
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

      // ── 96.md D9/D10 — safe metadata merge + article-level provenance for the
      //    outcomes that never reached dedupeAndInsertRecords (original verdict
      //    existing_match / exact_dup / fuzzy_dup; new/ambiguous — incl. those that
      //    collapsed to existing_match INSIDE the landing — were attributed there).
      //    exact/fuzzy duplicates are merge targets too: the fill-blank merge is
      //    idempotent/safe, so a same-run cross-database copy (e.g. Europe PMC
      //    carrying the abstract PubMed omitted) still improves the landed record.
      //    Both writers are idempotent (fill-blank re-run fills nothing; provenance
      //    is query-first on its unique key), so a page resume never double-writes;
      //    the `seen` set already prevents reprocessing committed records. ──
      try {
        const preClassified = records.filter((n) => n._screenId
          && (n._verdict.outcome === 'existing_match' || n._verdict.outcome === 'exact_dup' || n._verdict.outcome === 'fuzzy_dup'));
        const mergeTargets = preClassified;
        let changedFieldsByRecord = new Map();
        if (mergeTargets.length) {
          const res = await applyMetadataMerge(
            screenProjectId,
            mergeTargets.map((n) => ({ screenRecordId: n._screenId, donor: donorShape(n) })),
            { runId: sourceRow.runId, batchId: '' },
          );
          pagec.updated += res.updated;
          changedFieldsByRecord = res.changedFieldsByRecord;
        }
        if (preClassified.length) {
          await writeRecordSources(preClassified.map((n) => {
            const fields = changedFieldsByRecord.get(n._screenId);
            const isMatch = n._verdict.outcome === 'existing_match';
            return {
              projectId: screenProjectId, screenRecordId: n._screenId, metaLabProjectId,
              runId: sourceRow.runId, batchId: '', provider,
              providerRecordId: String(n.providerRecordId || '').slice(0, 200),
              // A dup whose merge filled fields carries the honest 'updated'
              // outcome (+ changedFields); an untouched dup stays 'merged_duplicate'.
              outcome: isMatch ? (fields ? 'updated' : 'already_present') : (fields ? 'updated' : 'merged_duplicate'),
              changedFields: fields ? JSON.stringify(fields).slice(0, 2000) : '',
              origin: 'search',
            };
          }));
        }
      } catch { /* provenance/merge is additive — never fail the page */ }

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
      counts.updatedCount += pagec.updated;
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

  // 101.md §3/§29/§30 — this source is now terminal; if it was the LAST one, the run
  // as a whole is a finished research action and belongs in the project ledger.
  await emitRunProvenanceEvents(sourceRow.runId);

  return { provider, state: finalState, ...counts, capReached, errorClass, errorDetail };
}

/* ════════════ run-level provenance (101.md §3, §29, §30) ════════════ */

/** Per-source states that mean "this source will not do any more work". */
const TERMINAL_SOURCE_STATES = new Set(['completed', 'partial', 'failed', 'cancelled', 'skipped']);

/**
 * emitRunProvenanceEvents(runId) — write the run's DOMAIN events into the unified
 * ProjectEvent ledger (101.md §29) once every source has reached a terminal state.
 *
 * Called from the tail of runSource rather than from a run-level finalizer because
 * sources fan out concurrently: whichever source finishes last observes an all-terminal
 * set and emits. Two sources finishing simultaneously would both observe it, so the
 * drafts carry a deterministic `idempotencyKey` — ProjectEvent.idempotencyKey is
 * UNIQUE, and recordEvent treats the resulting P2002 as a no-op. That also makes a
 * worker crash-resume or a `retryRun` re-execution emit exactly once, forever.
 *
 * What is emitted (101.md §2/§30 — materiality is about the RESEARCH RECORD, not about
 * whether code ran):
 *   SEARCH_EXECUTED          once per run, when at least one database genuinely
 *                            reached a reportable state (searched, or searched with
 *                            zero results). A run in which nothing succeeded — "a
 *                            failed test search that never becomes part of the
 *                            research workflow" (§2) — emits NOTHING.
 *   SEARCH_RESULTS_IMPORTED  additionally, only when the run actually landed records.
 * Both share ONE correlationId so the manuscript layer can group the consequences
 * into a single "Updated literature search" research event (§14).
 *
 * Significance / affected manuscript sections / recalc flags are NOT set here: §30
 * materiality is computed by the pure classifier from each event type's
 * dependencyKeys (src/research-engine/provenance/classify.js). This function only
 * supplies an honest event type, actor and payload.
 *
 * Best-effort throughout — an audit write must never fail a search.
 */
export async function emitRunProvenanceEvents(runId) {
  try {
    if (!runId) return 0;
    const sources = await prisma.pecanSearchSource.findMany({ where: { runId } });
    if (!sources.length) return 0;
    // Not the last source → the run is still executing; the real last one will emit.
    if (sources.some((s) => !TERMINAL_SOURCE_STATES.has(String(s.state || '')))) return 0;

    const run = await prisma.pecanSearchRun.findUnique({ where: { id: runId } });
    if (!run) return 0;
    // 101.md §1 — a run rolled back by a screening reset describes records that are no
    // longer in the review. It is not a search the manuscript may report.
    if (run.rolledBackAt) return 0;

    // Reuse the SAME derivation the manuscript reads (searchProvenance.js) so the
    // event names databases exactly as the Methods paragraph will — one vocabulary.
    const provenance = deriveSearchProvenance({
      runs: [{
        id: run.id, state: run.state, rolledBackAt: run.rolledBackAt,
        completedAt: run.completedAt, createdAt: run.createdAt,
        origin: run.origin, name: run.name, sources,
      }],
    });
    const databases = reportableDatabases(provenance).all;
    // §2 — nothing genuinely searched ⇒ not a methodological event. Stay silent.
    if (!databases.length) return 0;

    const imported = sources.reduce((n, s) => n + (s.importedCount || 0), 0);
    const rawRetrieved = sources.reduce((n, s) => n + (s.rawCount || 0), 0);
    const existingMatched = sources.reduce((n, s) => n + (s.existingMatchCount || 0), 0);
    const providers = sources
      .filter((s) => s.state === 'completed' || s.state === 'partial')
      .map((s) => s.provider);
    const runName = String(run.name || '').slice(0, 200);

    const drafts = [{
      eventType: 'SEARCH_EXECUTED',
      entityType: 'search_run',
      entityId: run.id,
      // §1 — 'living' runs are the living-review re-search; keep that distinction
      // visible on the event instead of flattening every run into one shape.
      subtype: String(run.origin || 'automated'),
      origin: 'automated_search',
      idempotencyKey: `search-run-executed:${run.id}`,
      newValue: {
        databases,
        searchedAt: provenance.latestValidSearchAt,
        imported,
        rawRetrieved,
      },
      metadata: {
        runName, providers, databases, imported, rawRetrieved, existingMatched,
        sourceStates: sources.map((s) => `${s.provider}:${s.state}`),
      },
    }];

    // §3 — records actually entering screening is the change that propagates
    // downstream (dedup → screening → PRISMA → …). No records landed ⇒ no import event.
    if (imported > 0) {
      drafts.push({
        eventType: 'SEARCH_RESULTS_IMPORTED',
        entityType: 'search_run',
        entityId: run.id,
        subtype: String(run.origin || 'automated'),
        // Not 'imported_file' (the taxonomy default): these records came from an
        // executed search, not from a file somebody uploaded.
        origin: 'automated_search',
        idempotencyKey: `search-run-imported:${run.id}`,
        newValue: { imported, rawRetrieved, existingMatched, databases },
        metadata: { runName, providers, databases, imported, rawRetrieved, existingMatched },
      });
    }

    // Project blob revision at write time — lets the History/hover card tie the event
    // to the manuscript state it was written against. Best-effort; 0 when unavailable.
    let projectRev = 0;
    try {
      const p = await prisma.project.findUnique({ where: { id: run.metaLabProjectId }, select: { autosaveRev: true } });
      projectRev = (p && p.autosaveRev) || 0;
    } catch { /* optional context only */ }

    return await recordEvents(drafts, {
      projectId: run.metaLabProjectId,
      projectRev,
      actorUserId: run.initiatedById || '',
      actorName: run.initiatedByName || '',
      // §14 — one correlationId per run groups every consequence of this one action.
      correlationId: `search-run:${run.id}`,
      jobId: run.jobId || '',
    });
  } catch (e) {
    // 101.md §29 — provenance is additive; an audit failure never fails the search.
    console.error('[pecan-search] provenance emit failed', (e && e.message) || e);
    return 0;
  }
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
