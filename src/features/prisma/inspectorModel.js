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
  identified_other: 'Every record identified through other methods — citation searching, hand-searching, manual uploads without a database attribution, websites, organisations.',
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
  buildBoxRecordsQuery,
};
