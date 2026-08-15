/**
 * features/prisma/inspectorModel.js — 116.md §9/§10/§12. The PURE model behind the
 * PRISMA box inspector: what each box's count MEANS, which search facets apply to
 * which box, which columns a record row shows, and the client-side validation the
 * metadata editor shares with the server.
 *
 * Kept out of the component so the inspector's logic is Node-testable
 * (renderToStaticMarkup house style — no jsdom, no interaction unit tests).
 * Pure — no DOM/React/network.
 */

import { IDENTIFICATION_SOURCES, IDENTIFICATION_SOURCE_IDS } from '../../research-engine/prisma/model.js';

/**
 * §9.3 — "explain what the count represents", per box. Phrased as what the SET is,
 * because every count here is the size of a record set (103.md).
 */
export const BOX_EXPLANATIONS = Object.freeze({
  identified_db: 'Every record retrieved from a bibliographic database or trial register, before deduplication. Import-time duplicates are counted but were discarded before becoming records.',
  identified_other: 'Every record identified through other methods — citation searching, hand-searching, manual uploads without a database attribution, websites, organisations. PRISMA 2020 gives this column no removal or screening box, so any duplicates removed and title/abstract decisions on these records are listed in the breakdown below and counted in the project totals rather than drawn in the figure.',
  removed_before_screening: 'Records taken out of the pool before title/abstract screening: duplicates, automation-tool removals, and documented manual removals.',
  screened: 'Records that entered title/abstract screening (identified minus removed-before-screening).',
  excluded_screening: 'Records excluded at title/abstract screening by the project’s resolved decisions (consensus or unanimity — an unresolved disagreement stays “awaiting”).',
  sought_db: 'Reports whose full text the team set out to obtain (database/register arm).',
  not_retrieved_db: 'Reports whose full text could not be obtained despite an attempt — a positive finding, never a default.',
  sought_other: 'Reports whose full text the team set out to obtain (other-methods arm).',
  not_retrieved_other: 'Reports whose full text could not be obtained despite an attempt (other-methods arm).',
  assessed_db: 'Reports read in full and assessed against the eligibility criteria (database/register arm).',
  excluded_full_text_db: 'Reports excluded at full-text assessment, with the recorded exclusion reason (database/register arm).',
  assessed_other: 'Reports read in full and assessed against the eligibility criteria (other-methods arm).',
  excluded_full_text_other: 'Reports excluded at full-text assessment, with the recorded exclusion reason (other-methods arm).',
  included_studies: 'Distinct studies included in the review. Several reports can describe one study; the rows below are the included reports, grouped by study.',
  included_reports: 'The individual reports (records) of the included studies.',
});

/** The §12 facet set, per box — "useful search/filter behaviour where appropriate,
 *  keep this clean". Every box gets free-text search (title/DOI/PMID). */
const FACETS = Object.freeze({
  identified_db: ['source', 'status'],
  identified_other: ['source', 'status'],
  removed_before_screening: ['status', 'source'],
  screened: ['status', 'source'],
  excluded_screening: ['source'],
  sought_db: ['retrieval', 'source'],
  sought_other: ['retrieval', 'source'],
  not_retrieved_db: ['reason', 'source'],
  not_retrieved_other: ['reason', 'source'],
  assessed_db: ['status', 'source'],
  assessed_other: ['status', 'source'],
  excluded_full_text_db: ['reason', 'source'],
  excluded_full_text_other: ['reason', 'source'],
  included_studies: ['source'],
  included_reports: ['source'],
});

export function facetsForBox(boxId) {
  return FACETS[boxId] || ['source'];
}

export const FACET_LABELS = Object.freeze({
  source: 'Source',
  status: 'Screening status',
  reason: 'Exclusion reason',
  retrieval: 'Retrieval status',
});

/** §9 — which metadata line a record row leads with, per box family. */
export function showsDuplicateGroup(boxId) {
  return boxId === 'removed_before_screening';
}

/** The identification-source options for the per-record correction dropdown
 *  (116.md §13/§14). '' = "derived automatically" (no override). */
export function identificationSourceOptions() {
  return [{ value: '', label: 'Automatic (derived from provenance)' }].concat(
    IDENTIFICATION_SOURCE_IDS.map((id) => ({ value: id, label: IDENTIFICATION_SOURCES[id].label })),
  );
}

/** The editable metadata fields (§10) — dangerous state changes are NOT here. */
export const EDITABLE_FIELDS = Object.freeze([
  'title', 'authors', 'year', 'journal', 'doi', 'pmid', 'sourceDb',
  'identificationSource', 'sourceDetail', 'rejectedReason',
]);

const FIELD_CAPS = Object.freeze({
  title: 1000, authors: 500, journal: 300, doi: 200, pmid: 50,
  sourceDb: 100, sourceDetail: 300, rejectedReason: 500,
});

/**
 * validateRecordPatch(patch) → { ok, errors: {field: message}, clean: {field: value} }
 *
 * The client-side mirror of the server's validation (screeningController
 * updateRecordMetadata) — shared rules, one contract:
 *   year: '' or a 4-digit year; pmid: '' or digits; identificationSource: '' or a
 *   known bucket id; everything else: bounded strings. Unknown fields refused.
 * Pure.
 */
export function validateRecordPatch(patch) {
  const errors = {};
  const clean = {};
  for (const [k, raw] of Object.entries(patch || {})) {
    if (!EDITABLE_FIELDS.includes(k)) { errors[k] = 'Not an editable field'; continue; }
    const v = String(raw == null ? '' : raw).trim();
    if (k === 'year') {
      if (v && !/^\d{4}$/.test(v)) { errors[k] = 'Year must be a 4-digit year'; continue; }
      clean[k] = v;
    } else if (k === 'pmid') {
      if (v && !/^\d+$/.test(v)) { errors[k] = 'PMID must be digits only'; continue; }
      clean[k] = v.slice(0, FIELD_CAPS.pmid);
    } else if (k === 'doi') {
      clean[k] = v.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').slice(0, FIELD_CAPS.doi);
    } else if (k === 'identificationSource') {
      if (v && !IDENTIFICATION_SOURCE_IDS.includes(v)) { errors[k] = 'Unknown identification source'; continue; }
      clean[k] = v;
    } else {
      clean[k] = v.slice(0, FIELD_CAPS[k] || 1000);
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

/**
 * 116.md §11 (r2) — may this in-flight response be painted?
 *
 * The record list is fetched by three paths (box change, facet/search change, "Load
 * more") through one unguarded function, so whichever request resolved LAST won.
 * Clicking a 40k-record box and then a 12-record one painted the big box's rows,
 * cursor, facets and permissions under the small box's header — the header is
 * rendered from props and stays correct, so the two halves of the panel disagreed
 * and every row action then targeted records the reviewer was not looking at.
 *
 * A response is accepted only when it is the newest request AND its payload names
 * the box currently open (the server echoes `boxId`).
 * Pure.
 */
export function acceptBoxResponse({ seq, currentSeq, payloadBoxId, boxId }) {
  if (seq !== currentSeq) return false;
  if (payloadBoxId && payloadBoxId !== boxId) return false;
  return true;
}

/**
 * 116.md §10 (r2) — the fields whose value decides which BOX a record is in.
 *
 * `identificationSource` and `sourceDb` are the inputs to model.armOf(), so editing
 * either can move a record between the database and other-methods columns — i.e. out
 * of the box currently being listed. The page cursor is a plain offset into a list
 * the server re-derives per request, so a departure ahead of the cursor shifts every
 * later record down one index and "Load more" silently skips one. Purely
 * bibliographic edits (title/authors/year/journal/doi/pmid/sourceDetail/
 * rejectedReason) cannot change membership and keep the cheap in-place update.
 */
const MEMBERSHIP_FIELDS = Object.freeze(['identificationSource', 'sourceDb']);

/** Does this accepted patch require re-loading the box rather than patching in place? Pure. */
export function affectsBoxMembership(patch) {
  if (!patch || typeof patch !== 'object') return false;
  return MEMBERSHIP_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(patch, f));
}

/**
 * 116.md §10 (r2) — should this `record.updated` poke refresh THIS panel?
 *
 * The SSE stream is per-user across every project, and the server excludes the actor,
 * so an arriving poke means a COLLABORATOR changed records in some project. Pokes
 * carry ids only (global invariant 8), so the client refetches through the
 * authorized endpoint rather than trusting the event.
 * Pure.
 */
export function shouldReloadForRecordPoke(ev, screenProjectId) {
  if (!ev || !screenProjectId) return false;
  if (ev.projectId && ev.projectId !== screenProjectId) return false;
  return true;
}

/**
 * 116.md §10 (r2) / 117.md §52 — may this row's final decision be reverted?
 *
 * The rule is still "no button that is guaranteed to 400": the endpoint accepts only
 * a FINALIZED record, and an unfinalized one has nothing to revert. What changed is
 * the endpoint. Before 117.md §52 it took accepted records ONLY, so offering the
 * button on an excluded report was a guaranteed failure; §52 made the exclusion
 * reversible too (that is the whole point of "users must be able to undo an
 * exclude"), so refusing to render it here would now be the surface hiding a
 * capability the domain has. SecondReviewTab gates on exactly this.
 * Pure.
 */
export function canRevertFinal(row, canFinalize) {
  if (!canFinalize || !row) return false;
  return row.finalStatus === 'accepted' || row.finalStatus === 'rejected';
}

/**
 * buildBoxRecordsQuery({ q, source, status, reason, retrieval, cursor, limit })
 * → the query string for GET /prisma/box/:boxId/records. Empty params omitted.
 * Pure.
 */
export function buildBoxRecordsQuery(params = {}) {
  const usp = new URLSearchParams();
  for (const k of ['q', 'source', 'status', 'reason', 'retrieval', 'cursor']) {
    const v = params[k];
    if (v != null && String(v) !== '') usp.set(k, String(v));
  }
  if (params.limit) usp.set('limit', String(params.limit));
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export default {
  BOX_EXPLANATIONS, facetsForBox, FACET_LABELS, showsDuplicateGroup,
  identificationSourceOptions, EDITABLE_FIELDS, validateRecordPatch,
  buildBoxRecordsQuery, acceptBoxResponse, affectsBoxMembership,
  shouldReloadForRecordPoke, canRevertFinal,
};
