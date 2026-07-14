/**
 * extraction/outcomeGroups.js — 82.md Part 1 (multi-outcome within one study).
 *
 * PURE, dependency-light. No DOM / IO / Date.now / Math.random (idFn injectable).
 *
 * KEY INSIGHT (from the architecture map): the analysis unit is already a mkStudy
 * ROW, and a single PAPER contributing multiple outcomes / time points is already
 * represented as MULTIPLE rows sharing CITATION metadata (the classic tab's
 * `cloneForOutcome` + records.js `confirmDraft(citationBaseId)` patterns). Analysis
 * groups rows by (outcome, timepoint) strings. So "one study, many outcomes" needs
 * NO schema migration — it is a DERIVED grouping of the existing studies[] array by
 * citation identity, plus pure helpers to add / rename / role / reorder / archive
 * the per-outcome rows. Outcome ROLE + ARCHIVED live in the additive
 * `study.extractionMeta` namespace (never in mkStudy's analysis contract); the
 * outcome NAME stays `study.outcome` (what analysis + exports already read).
 */

import { progressOf } from './engine/articleStatus.js';
import { conversionStatusOf, effectiveReportedFormat } from './harmonize.js';

/** Outcome roles (82.md Part 1). Stored in extractionMeta.outcomeRole. */
export const OUTCOME_ROLES = Object.freeze(['primary', 'secondary', 'exploratory', 'safety', 'other']);
export const OUTCOME_ROLE_LABELS = Object.freeze({
  primary: 'Primary', secondary: 'Secondary', exploratory: 'Exploratory', safety: 'Safety', other: 'Other',
});

// Citation-identity fields (mirror extractionTabs.cloneForOutcome META). Cloning an
// outcome inherits ONLY these; the new row starts with empty outcome/timepoint/values.
export const CITATION_FIELDS = Object.freeze([
  'author', 'year', 'country', 'design', 'title', 'authors', 'journal', 'doi', 'pmid',
  'abstract', 'dataSource', 'enrollPeriod', 'populationDef', 'interventionDef',
  'comparatorDef', 'funding', 'extractedBy',
]);

// 83.md §2 — the PDF/publication linkage is STUDY-level, not outcome-level. A new
// outcome row of the same paper must keep resolving the paper's PDF, so cloning also
// inherits the screening-attachment link and the blob study-document pointer (the
// same contract records.js `citationTemplate` already applies to confirmed drafts;
// `document` pointers are dedup-safe server-side — content-hash reuse + a
// referenced-elsewhere check before any file delete).
export const PUBLICATION_LINK_FIELDS = Object.freeze([
  'screeningProjectId', 'screeningRecordId', 'document',
]);

const s = (v) => (v == null ? '' : String(v).trim());
const norm = (v) => s(v).toLowerCase().replace(/\s+/g, ' ');

/**
 * citationKey(study) — a STABLE identity for the paper a study row belongs to.
 * Prefers a DOI, then a PubMed id, then author|year|title. Two rows with the same
 * key are the same paper (different outcomes / time points).
 */
export function citationKey(study = {}) {
  const doi = norm(study.doi);
  if (doi) return `doi:${doi}`;
  const pmid = norm(study.pmid);
  if (pmid) return `pmid:${pmid}`;
  const title = norm(study.title);
  const author = norm(study.author);
  const year = s(study.year);
  if (title) return `t:${author}|${year}|${title}`;
  if (author || year) return `a:${author}|${year}`;
  return `id:${study.id || ''}`; // singleton fallback — never groups unrelated rows
}

const meta = (study) => (study && study.extractionMeta) || {};
export function outcomeRoleOf(study = {}) {
  const r = meta(study).outcomeRole;
  return OUTCOME_ROLES.includes(r) ? r : '';
}
export function isArchivedOutcome(study = {}) {
  return meta(study).archived === true;
}

/** A concise, list-ready summary of ONE outcome row (82.md §Outcome Navigation). */
export function outcomeSummary(study = {}) {
  const prog = progressOf(study);
  return {
    id: study.id,
    name: s(study.outcome) || '(unnamed outcome)',
    role: outcomeRoleOf(study),
    esType: study.esType || '',
    reportedFormat: effectiveReportedFormat(study),
    timepoint: s(study.timepoint),
    archived: isArchivedOutcome(study),
    pct: prog.pct,
    complete: !!meta(study).completedAt,
    conversionStatus: conversionStatusOf(study),
  };
}

/**
 * groupStudiesByCitation(studies) — group the flat studies[] into PAPERS, each with
 * its ordered outcome rows. Order of papers follows first appearance; order of
 * outcomes within a paper follows array order. Pure.
 * @returns {Array<{ key, citation, studyIds:string[], outcomes:object[] }>}
 */
export function groupStudiesByCitation(studies = []) {
  const list = Array.isArray(studies) ? studies : [];
  const byKey = new Map();
  for (const st of list) {
    if (!st || typeof st !== 'object') continue;
    const key = citationKey(st);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        citation: {
          author: s(st.author), year: s(st.year), title: s(st.title),
          journal: s(st.journal), doi: s(st.doi), pmid: s(st.pmid),
        },
        studyIds: [],
        outcomes: [],
      });
    }
    const g = byKey.get(key);
    g.studyIds.push(st.id);
    g.outcomes.push(outcomeSummary(st));
  }
  return [...byKey.values()];
}

/** The citation group (paper) a given study id belongs to, or null. */
export function groupForStudy(studies = [], studyId) {
  const target = (studies || []).find((x) => x && x.id === studyId);
  if (!target) return null;
  const key = citationKey(target);
  return groupStudiesByCitation(studies).find((g) => g.key === key) || null;
}

/** Non-archived outcome rows for a paper (what the navigator shows by default). */
export function activeOutcomes(group) {
  return group ? group.outcomes.filter((o) => !o.archived) : [];
}

const DEFAULT_ID = () => Math.random().toString(36).slice(2, 10);

/**
 * addOutcome(studies, sourceStudyId, opts) — append a NEW outcome row that inherits
 * ONLY the source paper's citation metadata (fresh id, blank outcome/timepoint/values)
 * — the `cloneForOutcome` contract. Does NOT duplicate the study. Pure; returns a NEW
 * studies[] + the new row's id. `mkStudy` is injected so this stays dependency-free.
 * @param {object} opts { mkStudy, idFn?, name?, role?, timepoint? }
 * @returns {{ studies:object[], id:string } | { error:string }}
 */
export function addOutcome(studies = [], sourceStudyId, opts = {}) {
  const mkStudy = opts.mkStudy;
  if (typeof mkStudy !== 'function') return { error: 'mkStudy factory is required' };
  const src = (studies || []).find((x) => x && x.id === sourceStudyId);
  if (!src) return { error: 'source study not found' };
  const idFn = opts.idFn || DEFAULT_ID;

  const fresh = mkStudy();
  fresh.id = idFn();
  for (const f of CITATION_FIELDS) fresh[f] = src[f] !== undefined ? src[f] : fresh[f];
  for (const f of PUBLICATION_LINK_FIELDS) if (src[f] !== undefined && src[f] !== null && src[f] !== '') fresh[f] = src[f];
  fresh.outcome = s(opts.name);
  fresh.timepoint = s(opts.timepoint);
  fresh.notes = `Same cohort as ${s(src.author) || 'study'} ${s(src.year)} — additional outcome/time point.`;
  if (opts.role && OUTCOME_ROLES.includes(opts.role)) {
    fresh.extractionMeta = { ...(fresh.extractionMeta || {}), outcomeRole: opts.role };
  }
  return { studies: [...studies, fresh], id: fresh.id };
}

/**
 * duplicateOutcome(studies, studyId, opts) — deep-ish copy of an outcome row (ALL
 * fields incl. values), with a fresh id, appended right AFTER the source. Used for
 * "duplicate the structure of an existing outcome" (e.g. same outcome, new time
 * point). Pure; returns NEW studies[] + new id.
 */
export function duplicateOutcome(studies = [], studyId, opts = {}) {
  const idx = (studies || []).findIndex((x) => x && x.id === studyId);
  if (idx < 0) return { error: 'study not found' };
  const idFn = opts.idFn || DEFAULT_ID;
  const src = studies[idx];
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = idFn();
  if (opts.name !== undefined) copy.outcome = s(opts.name);
  else copy.outcome = s(src.outcome) ? `${s(src.outcome)} (copy)` : '';
  // A duplicate is a fresh capture — clear completion/lock so it re-enters the flow.
  if (copy.extractionMeta) { delete copy.extractionMeta.completedAt; delete copy.extractionMeta.locked; }
  const next = [...studies];
  next.splice(idx + 1, 0, copy);
  return { studies: next, id: copy.id };
}

/** Immutably patch one study row by id via a mutator, returning a NEW studies[]. */
function patchStudy(studies, studyId, mutate) {
  let found = false;
  const next = (studies || []).map((st) => {
    if (!st || st.id !== studyId) return st;
    found = true;
    const clone = { ...st };
    mutate(clone);
    return clone;
  });
  return { studies: next, found };
}

/** renameOutcome — set the outcome NAME (study.outcome; what analysis/exports read). */
export function renameOutcome(studies = [], studyId, name) {
  const { studies: next, found } = patchStudy(studies, studyId, (st) => { st.outcome = s(name); });
  return found ? { studies: next } : { error: 'study not found' };
}

/** setOutcomeRole — set the role in extractionMeta (primary/secondary/…). */
export function setOutcomeRole(studies = [], studyId, role) {
  if (role && !OUTCOME_ROLES.includes(role)) return { error: 'invalid role' };
  const { studies: next, found } = patchStudy(studies, studyId, (st) => {
    st.extractionMeta = { ...(st.extractionMeta || {}) };
    if (role) st.extractionMeta.outcomeRole = role; else delete st.extractionMeta.outcomeRole;
  });
  return found ? { studies: next } : { error: 'study not found' };
}

/** archiveOutcome / restoreOutcome — toggle extractionMeta.archived (record preserved). */
export function archiveOutcome(studies = [], studyId) {
  const { studies: next, found } = patchStudy(studies, studyId, (st) => {
    st.extractionMeta = { ...(st.extractionMeta || {}), archived: true };
  });
  return found ? { studies: next } : { error: 'study not found' };
}
export function restoreOutcome(studies = [], studyId) {
  const { studies: next, found } = patchStudy(studies, studyId, (st) => {
    st.extractionMeta = { ...(st.extractionMeta || {}) };
    delete st.extractionMeta.archived;
  });
  return found ? { studies: next } : { error: 'study not found' };
}

/**
 * publicationSourceFor(studies, studyId) — 83.md §2. The PDF a study row should show
 * is a PUBLICATION (paper) fact, not an outcome fact. Existing rows created before
 * PUBLICATION_LINK_FIELDS inheritance (or via other paths) may lack the linkage, so
 * resolution falls back to ANY sibling row of the same citation group — including
 * ARCHIVED outcomes (archiving an outcome must never make the paper's PDF vanish).
 *
 * Preference order (non-destructive; per-row files are respected when present):
 *   1. the row's own screening link / document,
 *   2. the first sibling with a screening link,
 *   3. the first sibling with a persisted study document.
 *
 * @returns {{ key:string, anchorId:string, screeningProjectId:string|null,
 *             screeningRecordId:string|null, docStudyId:string|null,
 *             docStoredName:string|null, lookupStudyIds:string[] } | null}
 *   `anchorId` is a STABLE identity for the paper: the first group member's row id in
 *   array order. Row ids are immutable, so it does not churn while the reviewer types
 *   in a citation field (citation-key strings do — keying a PDF resolve on them would
 *   reload the viewer per keystroke) and it is identical from every outcome of the
 *   paper. `docStudyId` is the row whose blob-anchored document should be streamed
 *   (the study-doc download route is keyed by study id). `lookupStudyIds` are
 *   candidate ids for the server's study→screening-record handoff resolution, target
 *   row first.
 */
/**
 * isStrongCitationKey(key) — true for identities precise enough to drive FILE
 * sharing (DOI / PMID / author|year|title). The `a:author|year` and `id:` fallbacks
 * can collide across genuinely different papers (two 2020 Smith trials with no
 * titles yet), and streaming one paper's PDF for another is worse than not sharing —
 * so weak keys resolve per-row only (adversarial-review finding). Display grouping
 * (groupStudiesByCitation) intentionally keeps the looser match.
 */
export function isStrongCitationKey(key) {
  return /^(doi:|pmid:|t:)/.test(String(key || ''));
}

export function publicationSourceFor(studies = [], studyId) {
  const list = Array.isArray(studies) ? studies : [];
  const target = list.find((x) => x && x.id === studyId);
  if (!target) return null;
  const key = citationKey(target);
  // Weak identity may still group on shared PHYSICAL linkage — two rows pointing at
  // the same screening record / stored file are provably the same publication (the
  // inheritance path copies exactly these), while text-only weak matches are not.
  const samePhysicalFile = (x) =>
    (!!target.screeningRecordId && x.screeningRecordId === target.screeningRecordId)
    || (!!(target.document && target.document.storedName) && !!(x.document && x.document.storedName === target.document.storedName));
  const members = isStrongCitationKey(key)
    ? list.filter((x) => x && citationKey(x) === key) // array order (stable anchor)
    : list.filter((x) => x && citationKey(x) === key && (x.id === target.id || samePhysicalFile(x)));
  const hasScreenLink = (st) => !!(st.screeningProjectId && st.screeningRecordId);
  const hasDoc = (st) => !!(st.document && st.document.storedName);
  // Own-row preference: a row that carries its own linkage keeps it (non-destructive
  // for legacy per-row uploads); only linkage-less rows fall back to a sibling carrier.
  const screenCarrier = (hasScreenLink(target) ? target : members.find(hasScreenLink)) || null;
  // For documents the download URL is keyed by the carrier ROW id, so when the row's
  // own pointer is the SAME file as the group's first carrier (the pointer-copy case),
  // resolve through the group-stable carrier — otherwise the URL (and the mounted
  // viewer) would flip between sibling outcomes streaming identical bytes. A row whose
  // own file genuinely DIFFERS (a deliberate per-row upload) keeps its own.
  const firstDoc = members.find(hasDoc) || null;
  const docCarrier = (hasDoc(target) && firstDoc && target.document.storedName !== firstDoc.document.storedName)
    ? target : firstDoc;
  return {
    key,
    anchorId: (members[0] && members[0].id) || target.id,
    screeningProjectId: screenCarrier ? screenCarrier.screeningProjectId : null,
    screeningRecordId: screenCarrier ? screenCarrier.screeningRecordId : null,
    docStudyId: docCarrier ? docCarrier.id : null,
    docStoredName: docCarrier ? docCarrier.document.storedName : null,
    lookupStudyIds: [target.id, ...members.filter((st) => st.id !== target.id).map((st) => st.id)].slice(0, 8),
  };
}

/**
 * spreadAvailabilityByCitation(studies, availability) — 83.md §2, server list view.
 * Given a per-row availability map (studyId → boolean), mark EVERY row of a citation
 * group available when ANY of its rows is — the paper's PDF is shared across its
 * outcomes. Pure; returns a NEW Map, input untouched.
 * @param {object[]} studies
 * @param {Map<string, boolean>} availability
 * @returns {Map<string, boolean>}
 */
export function spreadAvailabilityByCitation(studies = [], availability = new Map()) {
  const out = new Map(availability);
  const byKey = new Map(); // key → { ids:[], any:boolean }
  for (const st of (Array.isArray(studies) ? studies : [])) {
    if (!st || typeof st !== 'object' || !st.id) continue;
    const key = citationKey(st);
    if (!isStrongCitationKey(key)) continue; // weak identity → per-row availability only
    if (!byKey.has(key)) byKey.set(key, { ids: [], any: false });
    const g = byKey.get(key);
    g.ids.push(st.id);
    if (out.get(st.id)) g.any = true;
  }
  for (const { ids, any } of byKey.values()) {
    if (any) for (const id of ids) out.set(id, true);
  }
  return out;
}

/**
 * reorderOutcomes(studies, key, orderedIds) — reorder the outcome rows of ONE paper
 * (citation `key`) into `orderedIds`, leaving every other paper's rows untouched and
 * in their original array positions. Pure; returns NEW studies[]. Ids not in the
 * group are ignored; group members missing from orderedIds keep their relative order
 * at the end.
 */
export function reorderOutcomes(studies = [], key, orderedIds = []) {
  const list = Array.isArray(studies) ? studies : [];
  const slots = []; // indices in `list` that belong to this paper
  const members = new Map();
  list.forEach((st, i) => {
    if (st && citationKey(st) === key) { slots.push(i); members.set(st.id, st); }
  });
  if (slots.length <= 1) return { studies: list.slice() };
  const seen = new Set();
  const ordered = [];
  for (const id of orderedIds) { if (members.has(id) && !seen.has(id)) { ordered.push(members.get(id)); seen.add(id); } }
  // append any group members not named in orderedIds, preserving current order
  for (const i of slots) { const st = list[i]; if (!seen.has(st.id)) { ordered.push(st); seen.add(st.id); } }
  const next = list.slice();
  slots.forEach((slotIdx, k) => { next[slotIdx] = ordered[k]; });
  return { studies: next };
}
