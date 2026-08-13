/**
 * prisma/derive.js — 103.md §10/§12. The single source of truth for every PRISMA
 * number in PecanRev.
 *
 * ONE function turns a list of record projections into the whole flow. The
 * manuscript, the diagram, the export and the project statistics all call it, so
 * §15's "do not allow the PRISMA chart and manuscript to disagree" is guaranteed
 * by construction rather than by keeping several calculations in step.
 *
 * Every box carries the IDS of the records behind it, which is what makes §12's
 * "inspect where those 742 came from" possible without storing anything extra —
 * the set IS the explanation.
 *
 * ── THE RECORD PROJECTION ───────────────────────────────────────────────────
 * The engine stays pure by consuming a flat projection rather than Prisma rows.
 * The server builds these (prismaProjection.js); tests build them by hand.
 *
 *   id                     stable record id
 *   origin                 'search' | 'file' | 'api' | 'mining' | 'manual'
 *   sourceDb               free-text database/source name
 *   identificationSource   optional explicit override of the PRISMA bucket
 *   isDuplicate            removed as a duplicate of another record
 *   dedupStage             'search' | 'import' | 'screening'  (WHERE it was caught)
 *   dedupMethod            'exact' | 'fuzzy' | 'manual' | 'automation'
 *   removedBeforeScreening 'automation' | 'other' | null
 *   removedReason          free text, for the §12 breakdown
 *   screeningDecision      'include' | 'exclude' | null   (title/abstract)
 *   soughtRetrieval        boolean — reached full-text retrieval
 *   retrieved              true | false | null  (null = not yet attempted)
 *   notRetrievedReason     free text
 *   fullTextDecision       'include' | 'exclude' | null
 *   exclusionReason        free text — aggregated for the §8 breakdown
 *   included               boolean — final inclusion
 *   studyId                report → study link (§9). Absent ⇒ the record is its
 *                          own study, which is the correct default.
 *   inQuantitative         boolean — contributes to the meta-analysis
 *   batchId / runId        provenance for the §12 source breakdown
 *
 * Pure — no DOM/React/network/Date/Prisma.
 */

import {
  armOf, identificationSource, dispositionOf, isRemovedBeforeScreening,
  IDENTIFICATION_SOURCES,
} from './model.js';
import { groupKey as reasonGroupKey, preferredDisplay } from './reasonFormat.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const clean = (s) => String(s == null ? '' : s).trim();

/** A counted set: how many, and exactly which records. */
function bucket(records) {
  return { n: records.length, ids: records.map((r) => r.id) };
}

/**
 * Group a set of records by a key, returning sorted {key,label,n,ids} rows for
 * the §12 breakdown panels.
 */
function breakdown(records, keyFn, labelFn) {
  const by = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  return Array.from(by.entries())
    .map(([key, rows]) => ({
      key,
      label: labelFn ? labelFn(key, rows) : key,
      n: rows.length,
      ids: rows.map((r) => r.id),
    }))
    .sort((a, b) => (b.n - a.n) || (a.label < b.label ? -1 : 1));
}

/**
 * 116.md §16/§17 — a free-text reason rollup. Rows are GROUPED under the
 * casefolded/whitespace-collapsed key (so "Wrong population" and "wrong
 * population " are one row, not two) and LABELLED with the most frequent original
 * casing, conservatively sentence-cased for display. Records with no recorded
 * reason group under their own honest row. The stored strings are never touched —
 * this is aggregation-time formatting only.
 */
function reasonBreakdown(records, valueFn) {
  return breakdown(
    records,
    (r) => reasonGroupKey(valueFn(r)) || reasonGroupKey('Reason not recorded'),
    (key, rows) => {
      const raws = rows.map(valueFn).filter((v) => clean(v));
      return raws.length ? preferredDisplay(raws) : 'Reason not recorded';
    },
  );
}

/**
 * derivePrismaFlow(records, opts) — the whole flow, from records alone.
 *
 * @param {Array} records  record projections (see the header)
 * @param {object} [opts]
 *   previous  { studies, reports } — 103.md §7: an UPDATED review reports the
 *             studies already included by the previous version separately, so a
 *             rerun never re-counts them as newly screened.
 * @returns {{
 *   boxes: { [boxId]: { n, ids } },
 *   sources: { db: [...], other: [...] },      // per-source identification rows
 *   removedBreakdown: {...},                    // §12 duplicate/other breakdown
 *   exclusionReasons: [...],                    // §8 full-text reason aggregation
 *   notRetrievedReasons: [...],
 *   dispositions: { [disposition]: { n, ids } },
 *   counts: {...},                              // flat scalars for legacy consumers
 *   studies: { included, reports, quantitative },
 *   previous: {...} | null,
 *   total: number,
 * }}
 * Pure.
 */
export function derivePrismaFlow(records, opts = {}) {
  const rows = arr(records).filter((r) => r && r.id != null);

  // 103.md §2/§3 — duplicates that were never INSERTED as records.
  //
  // PecanRev's import pipeline drops an import-time duplicate before it becomes a
  // ScreenRecord (screeningImportService skips it and increments
  // ScreenImportBatch.duplicateCount). A purely record-level count would therefore
  // report neither the record nor its removal, and "records identified" would
  // silently exclude records that really were retrieved — §2 is explicit that the
  // duplicate count "must not disappear simply because deduplication happened
  // before the Screening Engine".
  //
  // So the batch's own accounting is added back as a COUNT ONLY. These duplicates
  // have no ids, so they can never be inspected record-by-record (§12) and are
  // reported separately in the breakdown as such — honest about what is known
  // rather than inventing placeholder records.
  const phantom = Math.max(0, Number(opts.unrecordedDuplicates) || 0);

  // Decorate once — arm and disposition are each computed a single time per
  // record, so a project with 100k records costs one pass, not one per box (§19).
  const decorated = rows.map((r) => ({
    ...r,
    _arm: armOf(r),
    _src: identificationSource(r),
    _disp: dispositionOf(r),
  }));

  const db = decorated.filter((r) => r._arm === 'db');
  const other = decorated.filter((r) => r._arm === 'other');

  /* ── identification ─────────────────────────────────────────────────────── */
  const identifiedDb = db;
  const identifiedOther = other;

  // Database arm: name the database. Other-methods arm: name the METHOD — a record
  // mined from a reference list is "Citation searching", and showing "PubMed" there
  // would answer the wrong question (PRISMA asks how it was found, not where it
  // ultimately lives).
  const sourceRows = (set, arm) => breakdown(
    set,
    (r) => (arm === 'other'
      ? ((IDENTIFICATION_SOURCES[r._src] || {}).label || 'Other methods')
      : (clean(r.sourceDb) || (IDENTIFICATION_SOURCES[r._src] || {}).label || 'Unspecified source')),
    (key) => key,
  );

  /* ── removed before screening (database arm only, per PRISMA 2020) ───────── */
  const removed = db.filter((r) => isRemovedBeforeScreening(r._disp));
  const removedDuplicate = removed.filter((r) => r._disp === 'removed_duplicate');
  const removedAutomation = removed.filter((r) => r._disp === 'removed_automation');
  const removedOther = removed.filter((r) => r._disp === 'removed_other');

  /* ── screening (database arm only) ───────────────────────────────────────── */
  const screened = db.filter((r) => !isRemovedBeforeScreening(r._disp));
  const excludedScreening = screened.filter((r) => r._disp === 'excluded_screening');
  // Awaiting a title/abstract decision, DATABASE ARM ONLY. Other-methods records
  // are never screened as a pool, so counting them here would make the screening
  // identity unbalanced (they have no "records screened" box to come out of).
  const awaitingScreeningDb = screened.filter((r) => r._disp === 'awaiting_screening');

  /* ── retrieval + eligibility (BOTH arms) ─────────────────────────────────── */
  const soughtOf = (set) => set.filter((r) => r.soughtRetrieval && !isRemovedBeforeScreening(r._disp));
  const notRetrievedOf = (set) => set.filter((r) => r._disp === 'not_retrieved');
  const assessedOf = (set) => soughtOf(set).filter((r) => r._disp !== 'not_retrieved');
  const excludedFtOf = (set) => set.filter((r) => r._disp === 'excluded_full_text');

  const soughtDb = soughtOf(db);
  const soughtOther = soughtOf(other);
  const notRetrievedDb = notRetrievedOf(db);
  const notRetrievedOther = notRetrievedOf(other);
  const assessedDb = assessedOf(db);
  const assessedOther = assessedOf(other);
  const excludedFtDb = excludedFtOf(db);
  const excludedFtOther = excludedFtOf(other);

  /* ── inclusion: records → reports → studies (§9) ─────────────────────────── */
  const includedReports = decorated.filter((r) => r._disp === 'included');
  // A record with no studyId is its own study — the correct default, and it keeps
  // every existing project working unchanged (§9 "without breaking the current
  // workflow"). Several reports sharing a studyId collapse to ONE study.
  const studyKeys = new Set(includedReports.map((r) => clean(r.studyId) || `record:${r.id}`));
  const quantitative = includedReports.filter((r) => r.inQuantitative === true);
  const quantKeys = new Set(quantitative.map((r) => clean(r.studyId) || `record:${r.id}`));

  const boxes = {
    // The phantom (never-inserted) import duplicates raise the COUNT of records
    // identified and of records removed, but contribute no ids — they are counted,
    // not inspectable, and both boxes move together so the flow still balances.
    identified_db: { n: identifiedDb.length + phantom, ids: identifiedDb.map((r) => r.id) },
    identified_other: bucket(identifiedOther),
    removed_before_screening: { n: removed.length + phantom, ids: removed.map((r) => r.id) },
    screened: bucket(screened),
    excluded_screening: bucket(excludedScreening),
    sought_db: bucket(soughtDb),
    not_retrieved_db: bucket(notRetrievedDb),
    sought_other: bucket(soughtOther),
    not_retrieved_other: bucket(notRetrievedOther),
    assessed_db: bucket(assessedDb),
    excluded_full_text_db: bucket(excludedFtDb),
    assessed_other: bucket(assessedOther),
    excluded_full_text_other: bucket(excludedFtOther),
    included_reports: bucket(includedReports),
    // The studies box counts DISTINCT studies, so it is a size, not a record set.
    included_studies: { n: studyKeys.size, ids: Array.from(studyKeys) },
  };

  const dispositions = {};
  for (const r of decorated) {
    if (!dispositions[r._disp]) dispositions[r._disp] = [];
    dispositions[r._disp].push(r);
  }
  const dispositionBuckets = {};
  for (const k of Object.keys(dispositions)) dispositionBuckets[k] = bucket(dispositions[k]);

  /* ── §12 breakdowns ──────────────────────────────────────────────────────── */
  const removedBreakdown = {
    duplicate: { n: removedDuplicate.length + phantom, ids: removedDuplicate.map((r) => r.id) },
    // Duplicates discarded at import, before any record existed. Counted, never
    // inspectable — there is nothing to inspect.
    unrecorded: phantom,
    automation: bucket(removedAutomation),
    other: bucket(removedOther),
    // WHERE each duplicate was caught — the "Automated Search 510 / Screening 180 /
    // Manual 52" breakdown §12 asks for. These are slices of ONE set, so they can
    // never sum to more than the duplicates actually removed.
    byStage: (phantom
      ? [{ key: 'import_discarded', label: 'Discarded at import (not stored as records)', n: phantom, ids: [] }]
      : []
    ).concat(breakdown(removedDuplicate, (r) => clean(r.dedupStage) || 'unknown', (k) => ({
      search: 'Removed during automated search',
      import: 'Removed during import',
      screening: 'Removed in the Screening Engine',
      unknown: 'Stage not recorded',
    }[k] || k))),
    byMethod: breakdown(removedDuplicate, (r) => clean(r.dedupMethod) || 'unknown'),
    // 116.md §17 — same grouping/display rules as the exclusion reasons.
    byReason: reasonBreakdown(removedOther, (r) => r.removedReason),
  };

  // 116.md §16/§17 — reasons are grouped case/whitespace-insensitively and
  // displayed with conservative sentence-case. This single rollup feeds the SVG
  // reason lines, the inspector and the manuscript adapter, so they cannot
  // disagree on either the grouping or the wording.
  const exclusionReasons = reasonBreakdown(
    [...excludedFtDb, ...excludedFtOther],
    (r) => r.exclusionReason,
  );
  // Per-arm too: the two columns are independent flows, so the other-methods
  // column must never display the database column's reasons (a wrong diagram, not
  // a cosmetic slip).
  const exclusionReasonsByArm = {
    db: reasonBreakdown(excludedFtDb, (r) => r.exclusionReason),
    other: reasonBreakdown(excludedFtOther, (r) => r.exclusionReason),
  };
  const notRetrievedReasons = reasonBreakdown(
    [...notRetrievedDb, ...notRetrievedOther],
    (r) => r.notRetrievedReason,
  );

  /* ── flat scalars, for consumers that only want numbers ──────────────────── */
  const counts = {
    identified: identifiedDb.length + identifiedOther.length + phantom,
    identifiedDb: identifiedDb.length + phantom,
    identifiedOther: identifiedOther.length,
    duplicatesRemoved: removedDuplicate.length + phantom,
    removedAutomation: removedAutomation.length,
    removedOther: removedOther.length,
    removedBeforeScreening: removed.length + phantom,
    unrecordedDuplicates: phantom,
    awaitingScreening: awaitingScreeningDb.length,
    screened: screened.length,
    excludedScreen: excludedScreening.length,
    sought: soughtDb.length + soughtOther.length,
    notRetrieved: notRetrievedDb.length + notRetrievedOther.length,
    reportsAssessed: assessedDb.length + assessedOther.length,
    reportsExcluded: excludedFtDb.length + excludedFtOther.length,
    includedReports: includedReports.length,
    included: studyKeys.size,
    includedQuant: quantKeys.size,
  };

  /* ── §7 updated / living reviews ─────────────────────────────────────────── */
  const prev = opts.previous || null;
  const previous = prev
    ? {
      studies: Number(prev.studies) || 0,
      reports: Number(prev.reports) || 0,
    }
    : null;
  if (previous) {
    counts.previousStudies = previous.studies;
    counts.previousReports = previous.reports;
    counts.totalStudies = studyKeys.size + previous.studies;
  }

  return {
    boxes,
    sources: { db: sourceRows(identifiedDb, 'db'), other: sourceRows(identifiedOther, 'other') },
    removedBreakdown,
    exclusionReasons,
    exclusionReasonsByArm,
    notRetrievedReasons,
    dispositions: dispositionBuckets,
    counts,
    studies: {
      included: studyKeys.size,
      reports: includedReports.length,
      quantitative: quantKeys.size,
      // True when at least one included study is reported by more than one record —
      // the §9 case that makes "studies" and "reports" genuinely differ.
      multiReport: includedReports.length > studyKeys.size,
    },
    previous,
    total: decorated.length,
  };
}

/**
 * The records behind ONE box, resolved back to full projections — what a §12
 * inspection panel renders when a researcher clicks a number.
 * Pure.
 */
export function recordsForBox(flow, boxId, records) {
  const box = flow && flow.boxes && flow.boxes[boxId];
  if (!box) return [];
  const want = new Set(box.ids);
  return arr(records).filter((r) => r && want.has(r.id));
}

export default { derivePrismaFlow, recordsForBox };
