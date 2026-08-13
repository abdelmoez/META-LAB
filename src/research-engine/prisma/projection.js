/**
 * prisma/projection.js — 103.md §1/§10. Turns PecanRev's own tables into the flat
 * record projections derive.js consumes.
 *
 * This is the ONLY place that knows how PecanRev stores a record's state, which is
 * what keeps the flow engine pure and lets §20's scenarios be written as plain data
 * rather than as database fixtures.
 *
 * The mapping is deliberately conservative. Where the project genuinely does not
 * know something — whether a full text was ever sought, why a record was removed —
 * the projection leaves it null rather than guessing, and the flow reports it as
 * awaiting/unrecorded. 103.md §18 makes that explicit for migrated projects:
 * unreconstructable history is marked, never invented.
 *
 * Pure — no DOM/React/network/Prisma. The server fetches; this maps.
 */

import { dbLabel } from '../search/searchProvenance.js';

const clean = (s) => String(s == null ? '' : s).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * Screening stage/status vocabulary, quoted from the schema so the mapping is
 * checkable against it:
 *   ScreenRecord.currentStage  'title_abstract' | 'full_text'
 *   ScreenRecord.finalStatus   '' | 'accepted' | 'rejected'
 *   ScreenRecord.isDuplicate / isPrimary / duplicateGroupId
 *   ScreenRecord.promotedAt    set when it reached the second review
 *   ScreenRecord.acceptedAt    set when accepted in the second review
 */

/**
 * buildRecordProjections(input) → record projections for derivePrismaFlow.
 *
 * @param {object} input
 *   records        ScreenRecord rows (id, sourceDb, isDuplicate, isPrimary,
 *                  duplicateGroupId, currentStage, finalStatus, promotedAt,
 *                  acceptedAt, rejectedReason, handoffStudyId, importBatchId,
 *                  identificationSource, sourceDetail)
 *   sourcesByRecord  { [recordId]: { origin, runId, batchId, provider } } from
 *                  ScreenRecordSource — how the record ENTERED the project.
 *   dedupByRecord  { [recordId]: { stage, method } } — where a duplicate was caught.
 *   retrievalByRecord { [recordId]: { sought, retrieved, reason } } — from
 *                  FullTextCandidate / FullTextRequest / ScreenPdfAttachment.
 *   decisionsByRecord { [recordId]: { titleAbstract, fullText, exclusionReason } }
 *                  the RESOLVED decision per stage (quorum/consensus already applied).
 *   batchById      { [batchId]: { sourceDatabase } } — 116.md §14: the batch-level
 *                  researcher-declared database (104.md), threaded in so a record's
 *                  EFFECTIVE database is record.sourceDb || its batch's declaration.
 *   studyIdByRecord  { [recordId]: studyId } — §9 report→study link.
 *   quantStudyIds  Set|Array of study ids contributing to the meta-analysis.
 * @returns {Array} projections
 * Pure.
 */
export function buildRecordProjections(input = {}) {
  const records = arr(input.records);
  const src = input.sourcesByRecord || {};
  const dedup = input.dedupByRecord || {};
  const retrieval = input.retrievalByRecord || {};
  const decisions = input.decisionsByRecord || {};
  const batchById = input.batchById || {};
  const studyIds = input.studyIdByRecord || {};
  const quant = input.quantStudyIds instanceof Set
    ? input.quantStudyIds
    : new Set(arr(input.quantStudyIds));

  return records.map((r) => {
    const id = r.id;
    const s = src[id] || {};
    const d = decisions[id] || {};
    const ret = retrieval[id] || {};
    const dd = dedup[id] || {};

    // A record is "removed as a duplicate" only when it is a NON-primary member of
    // a duplicate group. The primary is the one kept, so it continues through the
    // flow — counting it as removed would delete a real record from the review.
    const isDuplicate = !!r.isDuplicate && r.isPrimary !== true;

    // Reaching the full-text stage IS "sought for retrieval": PecanRev promotes a
    // record to `full_text` exactly when title/abstract screening passed it.
    const sought = ret.sought != null
      ? !!ret.sought
      : (clean(r.currentStage) === 'full_text' || !!r.promotedAt);

    const titleAbstract = d.titleAbstract || null;
    // 116.md §15 — a leader finalize-reject writes ONLY ScreenRecord.finalStatus =
    // 'rejected' (+ rejectedReason); no full_text ScreenDecision row exists on that
    // path, so without this mapping the record stayed "awaiting full-text" forever
    // and the reports-excluded box under-counted. The final status is the project's
    // RESOLVED position, so it outranks individual reviewer decisions either way.
    const finalStatus = clean(r.finalStatus);
    const fullText = finalStatus === 'rejected' ? 'exclude' : (d.fullText || null);
    const included = finalStatus === 'accepted' || fullText === 'include';

    const studyId = clean(studyIds[id] || r.handoffStudyId || '');

    // 103.md §5 — a manually added record creates NO ScreenRecordSource row and no
    // import batch (screeningController.createRecord inserts the row directly). The
    // ABSENCE of both is therefore the signal that a human added it by hand, which
    // belongs in the other-methods arm. Defaulting it to 'file' would silently file
    // a hand-added study under database searching.
    const origin = clean(s.origin)
      || (r.importBatchId ? 'file' : 'manual');

    // 116.md §14 — the record's EFFECTIVE database: what the record itself says,
    // else what the researcher declared for its import batch (104.md
    // ScreenImportBatch.sourceDatabase, stored as a canonical key → display label).
    // Declared batch attribution keeps an Embase RIS export in the database arm
    // even though the file itself never named a database.
    const batch = batchById[clean(r.importBatchId || '') || clean(s.batchId || '')] || {};
    const sourceDb = clean(r.sourceDb)
      || (clean(batch.sourceDatabase) ? dbLabel(batch.sourceDatabase) : '');

    return {
      id,
      origin,
      sourceDb,
      // 116.md §13/§14 — the per-record correction override + preserved free-text
      // detail ("reference list of Smith 2020"). model.identificationSource() gives
      // the explicit override absolute precedence.
      identificationSource: clean(r.identificationSource),
      sourceDetail: clean(r.sourceDetail),
      importBatchId: clean(r.importBatchId || ''),
      runId: clean(s.runId),
      batchId: clean(s.batchId),

      isDuplicate,
      dedupStage: isDuplicate ? (clean(dd.stage) || 'unknown') : '',
      dedupMethod: isDuplicate ? (clean(dd.method) || 'unknown') : '',

      removedBeforeScreening: r.removedBeforeScreening || null,
      removedReason: clean(r.removedReason),

      screeningDecision: titleAbstract,
      soughtRetrieval: sought,
      // `null` means retrieval was never attempted — distinct from "attempted and
      // failed". Only an explicit false becomes a "report not retrieved".
      retrieved: ret.retrieved == null ? null : !!ret.retrieved,
      notRetrievedReason: clean(ret.reason),

      fullTextDecision: fullText,
      exclusionReason: clean(d.exclusionReason || r.rejectedReason),

      included,
      studyId,
      inQuantitative: !!(studyId && quant.has(studyId)),
    };
  });
}

/**
 * Resolve ScreenDecision rows into ONE decision per record per stage.
 *
 * Several reviewers decide the same record, so the flow needs the RESOLVED
 * position, not a vote. Precedence: an explicit consensus/conflict resolution
 * wins; otherwise unanimous agreement wins; a genuine disagreement with no
 * resolution stays NULL, so the record counts as still awaiting a decision rather
 * than being silently resolved in the flow diagram.
 *
 * @param {Array} rows  ScreenDecision-shaped { recordId, stage, verdict, resolved }
 * @returns {{ [recordId]: { titleAbstract, fullText, exclusionReason } }}
 * Pure.
 */
export function resolveDecisions(rows) {
  const out = {};
  const byKey = new Map();
  for (const d of arr(rows)) {
    if (!d || !d.recordId) continue;
    const stage = clean(d.stage) === 'full_text' ? 'fullText' : 'titleAbstract';
    const key = `${d.recordId}::${stage}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(d);
  }
  for (const [key, list] of byKey) {
    const [recordId, stage] = key.split('::');
    if (!out[recordId]) out[recordId] = { titleAbstract: null, fullText: null, exclusionReason: '' };

    const resolved = list.find((d) => d.resolved === true);
    let verdict = null;
    if (resolved) verdict = normVerdict(resolved.verdict);
    else {
      const verdicts = Array.from(new Set(list.map((d) => normVerdict(d.verdict)).filter(Boolean)));
      // Unanimous → that verdict. Split → unresolved conflict, so no verdict.
      if (verdicts.length === 1) [verdict] = verdicts;
    }
    out[recordId][stage] = verdict;

    if (verdict === 'exclude') {
      const withReason = (resolved && clean(resolved.reason)) || clean((list.find((d) => clean(d.reason)) || {}).reason);
      if (withReason) out[recordId].exclusionReason = withReason;
    }
  }
  return out;
}

function normVerdict(v) {
  const s = clean(v).toLowerCase();
  if (s === 'include' || s === 'accept' || s === 'accepted' || s === 'yes') return 'include';
  if (s === 'exclude' || s === 'reject' || s === 'rejected' || s === 'no') return 'exclude';
  return null;
}

/**
 * Retrieval state per record, from the full-text tables.
 *
 * "Not retrieved" is a POSITIVE finding, not an absence: it means retrieval was
 * attempted and no full text could be obtained. A record nobody has tried to
 * retrieve yet is `retrieved: null`, so it never inflates the not-retrieved box.
 *
 * @param {object} input
 *   candidates  FullTextCandidate rows { recordId, status }  (found|no_oa|not_found|failed)
 *   requests    FullTextRequest rows   { recordId, status }  (requested|received|none)
 *   attachments record ids that HAVE a stored PDF
 * @returns {{ [recordId]: { sought, retrieved, reason } }}
 * Pure.
 */
export function resolveRetrieval(input = {}) {
  const out = {};
  const have = new Set(arr(input.attachments));

  for (const c of arr(input.candidates)) {
    if (!c || !c.recordId) continue;
    const id = c.recordId;
    if (!out[id]) out[id] = { sought: true, retrieved: null, reason: '' };
    out[id].sought = true;
    const st = clean(c.status);
    // Any provider that found a copy settles it as retrieved.
    if (st === 'found') { out[id].retrieved = true; out[id].reason = ''; continue; }
    if (out[id].retrieved !== true) {
      out[id].retrieved = false;
      out[id].reason = st === 'no_oa' ? 'No open-access copy available'
        : st === 'not_found' ? 'Full text not found by any provider'
          : st === 'failed' ? 'Retrieval failed'
            : 'Full text not obtained';
    }
  }

  // An explicit request outcome overrides the automated lookup — a librarian
  // obtaining a copy is the strongest evidence of retrieval.
  for (const r of arr(input.requests)) {
    if (!r || !r.recordId) continue;
    const id = r.recordId;
    if (!out[id]) out[id] = { sought: true, retrieved: null, reason: '' };
    const st = clean(r.status);
    if (st === 'received') { out[id].retrieved = true; out[id].reason = ''; }
    else if (st === 'none') { out[id].retrieved = false; out[id].reason = 'Full text could not be obtained'; }
    // 'requested' leaves it pending — neither retrieved nor failed.
  }

  // A stored PDF is proof of retrieval whatever the lookup tables say.
  for (const id of have) {
    if (!out[id]) out[id] = { sought: true, retrieved: true, reason: '' };
    else { out[id].retrieved = true; out[id].reason = ''; }
  }

  return out;
}

export default { buildRecordProjections, resolveDecisions, resolveRetrieval };
