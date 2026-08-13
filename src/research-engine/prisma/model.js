/**
 * prisma/model.js — 103.md. The PRISMA 2020 flow, expressed as a RECORD-LEVEL model.
 *
 * ── WHY THIS REPLACES A COUNTER MODEL ───────────────────────────────────────
 * The previous implementation (manuscript/prismaCounts.js) resolved each box
 * INDEPENDENTLY through a precedence chain: a user-typed override beat a manual
 * project field, which beat a live rollup, which beat arithmetic. Three
 * consequences made 103.md necessary:
 *
 *   1. A number the user typed could silently outrank real project data — the
 *      exact thing 103.md's core principle forbids.
 *   2. No count could answer "WHICH records created this number?" (§11/§12),
 *      because the numbers never came from records in the first place.
 *   3. Duplicates removed at two different stages (§3) could not be reconciled
 *      without double-counting, because "duplicates removed" was one scalar.
 *
 * So the unit here is the RECORD, not the number. Every box is a predicate over
 * record projections, and a count is the size of the matching set. Three
 * properties fall out of that, and they are the whole point:
 *
 *   §3  Double-counting is structurally impossible. A record has exactly ONE
 *       terminal disposition, so it can be removed as a duplicate once and only
 *       once, no matter how many stages ran deduplication.
 *   §12 Inspection is free. The set behind a count IS the answer to "which
 *       records created this number?" — nothing extra has to be stored.
 *   §13 Reconciliation is structural rather than arithmetic. The dispositions
 *       partition the records exhaustively and disjointly, so the totals cannot
 *       drift; reconcile.js asserts that invariant instead of re-adding numbers.
 *
 * Pure — no DOM/React/network/Date/Prisma.
 */

import { classifySource } from '../screening/sourceClassify.js';

/* ════════════ the two identification arms (PRISMA 2020) ════════════ */

/**
 * PRISMA 2020 splits identification into two arms, drawn as two columns:
 *   'db'    — "Identification of studies via databases and registers"
 *   'other' — "Identification of studies via other methods" (citation searching,
 *             websites, organisations, hand-searching…)
 *
 * The arms are NOT cosmetic. The other-methods arm has no "records screened" box,
 * because records found that way are not screened as a pool — they go straight to
 * retrieval and eligibility assessment. Getting this wrong is the single most
 * common flow-diagram error, so the arm is decided once, here, per record.
 */
export const ARMS = Object.freeze(['db', 'other']);

/**
 * How a record entered the project, mapped to its PRISMA identification bucket.
 * `origin` comes from ScreenRecordSource.origin (search|file|api|mining) and
 * `sourceDb` from the record's own free-text source, classified by the shared
 * classifySource() into database|register|other.
 */
export const IDENTIFICATION_SOURCES = Object.freeze({
  database: { arm: 'db', label: 'Databases' },
  register: { arm: 'db', label: 'Registers' },
  citation: { arm: 'other', label: 'Citation searching' },
  website: { arm: 'other', label: 'Websites' },
  organisation: { arm: 'other', label: 'Organisations' },
  // 116.md §13 — the detailed other-methods vocabulary a researcher can correct a
  // record into (per-record identificationSource override). PRISMA 2020 draws them
  // all in the other-methods arm; the detailed bucket stays inspectable.
  prior_review: { arm: 'other', label: 'Previous review' },
  reference_list: { arm: 'other', label: 'Reference lists' },
  author_contact: { arm: 'other', label: 'Author contact' },
  manual: { arm: 'other', label: 'Hand-searching / manually added' },
  other: { arm: 'other', label: 'Other methods' },
});

export const IDENTIFICATION_SOURCE_IDS = Object.keys(IDENTIFICATION_SOURCES);

/**
 * identificationSource(record) → one of IDENTIFICATION_SOURCE_IDS.
 *
 * Precedence is deliberate: an explicitly recorded `identificationSource` wins
 * (so a future UI can let a researcher correct a mis-classified import), then the
 * ENTRY ORIGIN, then the free-text database name. Origin outranks the name because
 * a record mined from a reference list is "citation searching" even when its
 * sourceDb happens to say "PubMed" — how it was found is what PRISMA asks about.
 * Pure.
 */
export function identificationSource(rec) {
  const r = rec || {};
  const explicit = String(r.identificationSource || '').trim();
  if (explicit && IDENTIFICATION_SOURCES[explicit]) return explicit;

  const origin = String(r.origin || '').trim().toLowerCase();
  if (origin === 'mining') return 'citation';
  if (origin === 'manual') return 'manual';

  // 'search' | 'file' | 'api' — a database/register search, so let the source name
  // decide which of the two it was.
  const kind = classifySource(r.sourceDb);
  if (kind === 'register') return 'register';
  if (kind === 'database') return 'database';

  // An EXECUTED search (a Pecan run or an API pull) genuinely queried a database,
  // so it stays in the database arm even when the provider name did not survive.
  if (origin === 'search' || origin === 'api') return 'database';
  // 116.md §13 — a FILE import with NO database attribution (record sourceDb blank
  // AND no batch-declared sourceDatabase — the projection threads the batch value
  // into `sourceDb` before this runs) is a manual upload, not an unnamed database
  // search. It enters the other-methods arm. This consciously SUPERSEDES the
  // 103.md §2 default ("stays in the database arm"): pretending a hand-uploaded
  // RIS file was a database search misreports the search methodology, and any file
  // that genuinely came from a database keeps the db arm the moment its record or
  // batch names one (§14).
  if (origin === 'file') return 'manual';
  return 'other';
}

/** Which column a record belongs to. Pure. */
export function armOf(rec) {
  const src = identificationSource(rec);
  return (IDENTIFICATION_SOURCES[src] || IDENTIFICATION_SOURCES.other).arm;
}

/* ════════════ record disposition ════════════ */

/**
 * The single terminal state of a record in the flow. EXHAUSTIVE and DISJOINT —
 * every projected record resolves to exactly one of these, which is what makes
 * §13's reconciliation structural rather than arithmetic.
 *
 * Ordered as the record travels, so a table of dispositions reads like the flow.
 */
export const DISPOSITIONS = Object.freeze([
  'removed_duplicate',      // removed before screening — duplicate record
  'removed_automation',     // removed before screening — marked ineligible by an automation tool
  'removed_other',          // removed before screening — any other documented reason
  'excluded_screening',     // excluded at title/abstract
  'awaiting_screening',     // in the pool, not yet decided
  'not_retrieved',          // sought for retrieval, full text could not be obtained
  'excluded_full_text',     // assessed for eligibility and excluded
  'awaiting_full_text',     // sought and retrieved, not yet assessed
  'included',               // included in the review
]);

export const DISPOSITION_LABELS = Object.freeze({
  removed_duplicate: 'Removed before screening — duplicate',
  removed_automation: 'Removed before screening — ineligible (automation tool)',
  removed_other: 'Removed before screening — other reason',
  excluded_screening: 'Excluded at title/abstract screening',
  awaiting_screening: 'Awaiting title/abstract screening',
  not_retrieved: 'Report not retrieved',
  excluded_full_text: 'Excluded at full-text assessment',
  awaiting_full_text: 'Awaiting full-text assessment',
  included: 'Included in the review',
});

/**
 * dispositionOf(record) → one DISPOSITIONS value.
 *
 * The order of these tests IS the record lifecycle, and it is what guarantees a
 * record is counted once. In particular a record removed as a duplicate is
 * resolved FIRST and can therefore never also appear as screened or excluded, no
 * matter which stage detected the duplication (§3).
 * Pure.
 */
export function dispositionOf(rec) {
  const r = rec || {};

  // ── removed before screening ───────────────────────────────────────────────
  // A duplicate is removed exactly once, whichever stage found it. `dedupStage`
  // records WHERE (search | import | screening) for the §12 breakdown, but it
  // never affects whether the record is counted.
  if (r.isDuplicate) return 'removed_duplicate';
  if (r.removedBeforeScreening === 'automation') return 'removed_automation';
  if (r.removedBeforeScreening === 'other' || r.removed === true) return 'removed_other';

  // ── included ───────────────────────────────────────────────────────────────
  if (r.included === true) return 'included';

  // ── full text ──────────────────────────────────────────────────────────────
  if (r.soughtRetrieval) {
    if (r.retrieved === false) return 'not_retrieved';
    if (r.fullTextDecision === 'exclude') return 'excluded_full_text';
    if (r.fullTextDecision === 'include') return 'included';
    return 'awaiting_full_text';
  }

  // ── title / abstract ───────────────────────────────────────────────────────
  if (r.screeningDecision === 'exclude') return 'excluded_screening';
  return 'awaiting_screening';
}

/** True when the disposition means the record never reached screening. Pure. */
export function isRemovedBeforeScreening(disposition) {
  return disposition === 'removed_duplicate'
    || disposition === 'removed_automation'
    || disposition === 'removed_other';
}

/**
 * Records in the DATABASE arm are screened as a pool; records found by other
 * methods are not (PRISMA 2020 gives the other-methods column no "records
 * screened" box). Both arms DO pass through retrieval and eligibility.
 * Pure.
 */
export function isScreenedArm(arm) {
  return arm === 'db';
}

/* ════════════ the boxes ════════════ */

/**
 * The PRISMA 2020 flow-diagram boxes, with the official labels.
 *
 * `arm`   — 'db' | 'other' | 'both' (drawn once, spanning)
 * `unit`  — what the box counts: records | reports | studies. PRISMA 2020 changes
 *           unit deliberately as the flow descends, and reporting the wrong unit
 *           is a documented common error, so it is declared rather than implied.
 * `side`  — true for the right-hand "removed/excluded" boxes.
 */
export const BOXES = Object.freeze([
  // Labels are VERBATIM from the four official prisma-statement.org .docx templates
  // (cross-checked against Figure 1 of Page MJ et al. BMJ 2021;372:n71). Note that
  // the database-arm identification box carries a footnote asterisk and the
  // other-methods one does NOT — that asymmetry is in the official templates.
  { id: 'identified_db', arm: 'db', unit: 'records', label: 'Records identified from*:', side: false },
  { id: 'removed_before_screening', arm: 'db', unit: 'records', label: 'Records removed before screening:', side: true },
  { id: 'identified_other', arm: 'other', unit: 'records', label: 'Records identified from:', side: false },

  { id: 'screened', arm: 'db', unit: 'records', label: 'Records screened', side: false },
  { id: 'excluded_screening', arm: 'db', unit: 'records', label: 'Records excluded**', side: true },

  { id: 'sought_db', arm: 'db', unit: 'reports', label: 'Reports sought for retrieval', side: false },
  { id: 'not_retrieved_db', arm: 'db', unit: 'reports', label: 'Reports not retrieved', side: true },
  { id: 'sought_other', arm: 'other', unit: 'reports', label: 'Reports sought for retrieval', side: false },
  { id: 'not_retrieved_other', arm: 'other', unit: 'reports', label: 'Reports not retrieved', side: true },

  { id: 'assessed_db', arm: 'db', unit: 'reports', label: 'Reports assessed for eligibility', side: false },
  { id: 'excluded_full_text_db', arm: 'db', unit: 'reports', label: 'Reports excluded:', side: true },
  { id: 'assessed_other', arm: 'other', unit: 'reports', label: 'Reports assessed for eligibility', side: false },
  { id: 'excluded_full_text_other', arm: 'other', unit: 'reports', label: 'Reports excluded:', side: true },

  // The official templates draw these two counts inside ONE terminal box, shared by
  // both columns — never duplicated per arm. They are modelled separately because
  // they count different units (§9), and rendered together.
  { id: 'included_studies', arm: 'both', unit: 'studies', label: 'Studies included in review', side: false },
  { id: 'included_reports', arm: 'both', unit: 'reports', label: 'Reports of included studies', side: false },
]);

export const BOX_IDS = BOXES.map((b) => b.id);

/**
 * 103.md §7 — the UPDATED-review template (prisma-statement.org templates 3 & 4).
 *
 * An updated review is not the new-review diagram with bigger numbers. The official
 * template makes three changes, all mandatory:
 *   1. a leftmost "Previous studies" column is added;
 *   2. the terminal box splits into NEW totals and OVERALL totals;
 *   3. the column headers gain the word "new".
 * Encoding them keeps a living review honest instead of overwriting its history.
 */
export const UPDATED_REVIEW_BOXES = Object.freeze([
  { id: 'previous_studies', arm: 'previous', unit: 'studies', label: 'Studies included in previous version of review', side: false },
  { id: 'previous_reports', arm: 'previous', unit: 'reports', label: 'Reports of studies included in previous version of review', side: false },
  { id: 'new_included_studies', arm: 'both', unit: 'studies', label: 'New studies included in review', side: false },
  { id: 'new_included_reports', arm: 'both', unit: 'reports', label: 'Reports of new included studies', side: false },
  { id: 'total_included_studies', arm: 'both', unit: 'studies', label: 'Total studies included in review', side: false },
  { id: 'total_included_reports', arm: 'both', unit: 'reports', label: 'Reports of total included studies', side: false },
]);

/** Column headers. An updated review inserts "new" — a string swap, not just extra columns. */
export const COLUMN_HEADERS = Object.freeze({
  db: 'Identification of studies via databases and registers',
  other: 'Identification of studies via other methods',
  dbUpdated: 'Identification of new studies via databases and registers',
  otherUpdated: 'Identification of new studies via other methods',
  previous: 'Previous studies',
});

/** The official footnotes, verbatim. Exported so the diagram and export share them. */
export const FOOTNOTES = Object.freeze([
  '*Consider, if feasible to do so, reporting the number of records identified from each database or register searched (rather than the total number across all databases/registers).',
  '**If automation tools were used, indicate how many records were excluded by a human and how many were excluded by automation tools.',
]);

export const SOURCE_CITATION = 'Page MJ, et al. BMJ 2021;372:n71. doi: 10.1136/bmj.n71.';

/** Left-edge stage bands, in order (all four official templates). */
export const STAGE_BANDS = Object.freeze(['Identification', 'Screening', 'Included']);

/** Box metadata by id. Pure. */
export function boxMeta(id) {
  return BOXES.find((b) => b.id === id) || null;
}

export default {
  ARMS,
  IDENTIFICATION_SOURCES,
  IDENTIFICATION_SOURCE_IDS,
  identificationSource,
  armOf,
  DISPOSITIONS,
  DISPOSITION_LABELS,
  dispositionOf,
  isRemovedBeforeScreening,
  isScreenedArm,
  BOXES,
  BOX_IDS,
  boxMeta,
  UPDATED_REVIEW_BOXES,
  COLUMN_HEADERS,
  FOOTNOTES,
  SOURCE_CITATION,
  STAGE_BANDS,
};
