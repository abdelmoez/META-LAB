/**
 * extraction/caseSeries.js — 106.md (Case Series Extraction Mode).
 *
 * PURE, dependency-light. No DOM / IO / Date.now / Math.random (idFn + `at` injectable).
 *
 * WHY THIS SHAPE
 *   106.md asks for `Study/Publication → Case → Extracted Variables`. The repo already
 *   models "one paper, many rows" for OUTCOMES (82.md outcomeGroups.js): the analysis
 *   unit is an `mkStudy` row in the blob `studies[]`, and a paper contributing several
 *   rows is a DERIVED grouping by citation identity. Cases reuse that spine exactly —
 *   a case IS an mkStudy row — so per-value provenance (articleProvenance.js), the
 *   shared publication PDF (outcomeGroups.publicationSourceFor), autosave, the audit
 *   log, completion and every existing export keep working with ZERO migration. The
 *   blob is the store (Project.data), so there is no DB schema change either.
 *
 *   The ONE thing citation grouping cannot do is be DURABLE: citationKey() is derived
 *   from mutable text (doi/pmid/author/year/title), so correcting a DOI would silently
 *   split a case series in half, and the weak `a:author|year` fallback can merge two
 *   genuinely different papers. 106.md is explicit that the case→parent-article link
 *   must never be lost, so a case series stamps an IMMUTABLE `publicationId` into the
 *   additive `extractionMeta.caseSeries` namespace. That id — not the citation text —
 *   is the parent link, and it is also what makes publication counting provable (§8).
 *
 * THE NAMESPACE (additive; a row without it is an ordinary study, unchanged)
 *   study.extractionMeta.caseSeries = {
 *     publicationId : 'pub_xxxxxxxx'  immutable parent-article id, shared by every case
 *     caseId        : 'case_xxxxxxxx' immutable per-case id (survives renumbering)
 *     caseNumber    : 1               1-based ordinal within the publication
 *     label         : ''              optional custom name; '' → `Case ${caseNumber}`
 *   }
 *
 * ARTICLE-LEVEL vs CASE-LEVEL (106.md §Shared article-level information)
 *   ARTICLE_LEVEL_FIELDS is the union of outcomeGroups' CITATION_FIELDS and
 *   PUBLICATION_LINK_FIELDS — authors, year, journal, DOI, country, design, funding,
 *   population/intervention/comparator definitions, the screening link and the stored
 *   document. Editing one of those on ANY case propagates to every sibling case
 *   (propagateArticleFields), so the reviewer never retypes shared metadata. Everything
 *   else — the effect-size cells, the outcome, and the patient-level CASE VARIABLES —
 *   is case-scoped and independent.
 *
 * CASE VARIABLES (106.md §Case-level data: age, sex, presentation, … + custom)
 *   Definitions live in the project blob (`project.caseVariables`, mkCaseVariable
 *   shape); VALUES live on the case row under the flat key `cv_<id>` (caseVarKey).
 *   Flat-on-the-row is deliberate: `extractionMeta.provenance` is keyed by field name,
 *   so a case variable gets click-to-pick source linking (page + bbox + fileKey) for
 *   free — which is exactly 106.md's "Case 3 → Age = 54 points at the table cell".
 *
 * COUNTING (106.md §Prevent double counting)
 *   countPublications / countCases / countCaseSeriesArticles are the contract. A count
 *   of publications collapses rows on PROVABLE identity only (an explicit
 *   publicationId, else a STRONG citation key); ambiguous rows never merge. Generating
 *   47 cases from 12 publications therefore leaves the publication count at 12.
 */

import { citationKey, isStrongCitationKey, CITATION_FIELDS, PUBLICATION_LINK_FIELDS } from './outcomeGroups.js';
import { progressOf, articleStatusOf } from './engine/articleStatus.js';
import { mkValueProvenance } from './engine/articleProvenance.js';

const DEFAULT_ID = () => Math.random().toString(36).slice(2, 10);
const s = (v) => (v == null ? '' : String(v).trim());
const nonEmpty = (v) => v !== '' && v !== null && v !== undefined;

/**
 * Fields that describe the PUBLICATION, not the patient (106.md §Shared article-level
 * information). Editing one on any case propagates to every sibling case.
 */
export const ARTICLE_LEVEL_FIELDS = Object.freeze([
  ...CITATION_FIELDS,
  ...PUBLICATION_LINK_FIELDS,
]);

const ARTICLE_LEVEL_SET = new Set(ARTICLE_LEVEL_FIELDS);

/** True when `field` is an article-level (publication-wide) field. */
export function isArticleLevelField(field) {
  return ARTICLE_LEVEL_SET.has(String(field || ''));
}

/* ════════════════════════ the case namespace ════════════════════════ */

const metaOf = (study) => (study && study.extractionMeta) || {};

/**
 * caseInfoOf(study) — the normalized `caseSeries` namespace for a row, or null when
 * the row is an ordinary (non case-series) study. Pure; never throws on legacy rows.
 * @returns {{ publicationId:string, caseId:string, caseNumber:number, label:string } | null}
 */
export function caseInfoOf(study = {}) {
  const cs = metaOf(study).caseSeries;
  if (!cs || typeof cs !== 'object') return null;
  const publicationId = s(cs.publicationId);
  const caseId = s(cs.caseId);
  if (!publicationId || !caseId) return null;      // half-written namespace → not a case
  const n = Number(cs.caseNumber);
  return {
    publicationId,
    caseId,
    caseNumber: Number.isFinite(n) && n > 0 ? Math.floor(n) : 1,
    label: s(cs.label),
  };
}

/** True when this row is one case of a case-series publication. */
export function isCaseRow(study = {}) {
  return caseInfoOf(study) != null;
}

/** The immutable parent-article id for a case row, or '' for an ordinary study. */
export function publicationIdOf(study = {}) {
  const info = caseInfoOf(study);
  return info ? info.publicationId : '';
}

/**
 * caseDisplayName(study) — the human-readable case name: the custom label when the
 * reviewer set one, else `Case ${caseNumber}`. Pure.
 */
export function caseDisplayName(study = {}) {
  const info = caseInfoOf(study);
  if (!info) return '';
  return info.label || `Case ${info.caseNumber}`;
}

/**
 * caseCitationLabel(study) — "Smith 2024 — Case 3", the label 106.md shows in the
 * extraction list and the case-level export. Falls back gracefully when the citation
 * is still blank.
 */
export function caseCitationLabel(study = {}) {
  const name = caseDisplayName(study);
  if (!name) return s(study.author) || s(study.title) || '';
  const cite = [s(study.author), s(study.year)].filter(Boolean).join(' ');
  return cite ? `${cite} — ${name}` : name;
}

/**
 * publicationKeyOf(study) — the identity used for COUNTING publications and for
 * grouping rows into an article. Precedence:
 *   1. an explicit `caseSeries.publicationId` (immutable, survives citation edits),
 *   2. a STRONG citation key (doi / pmid / author|year|title),
 *   3. the row's own id — a weak citation identity (`a:author|year`, `id:`) must never
 *      merge two rows that might be different papers (the same guard outcomeGroups
 *      applies before sharing a PDF file).
 * Pure.
 */
export function publicationKeyOf(study = {}) {
  const pid = publicationIdOf(study);
  if (pid) return `pub:${pid}`;
  const key = citationKey(study);
  if (isStrongCitationKey(key)) return key;
  return `row:${s(study.id)}`;
}

/** Rows are archived via the shared extractionMeta.archived flag (82.md). */
const isArchived = (study) => metaOf(study).archived === true;

/* ════════════════════════ grouping ════════════════════════ */

/**
 * casesForPublication(studies, publicationId) — every case row of one article, ordered
 * by caseNumber then array order. Archived cases are included; callers filter.
 * Pure.
 * @returns {object[]} study rows
 */
export function casesForPublication(studies = [], publicationId) {
  const pid = s(publicationId);
  if (!pid) return [];
  const rows = (Array.isArray(studies) ? studies : [])
    .filter((st) => st && publicationIdOf(st) === pid);
  return rows
    .map((st, i) => ({ st, i, n: (caseInfoOf(st) || {}).caseNumber || 0 }))
    .sort((a, b) => (a.n - b.n) || (a.i - b.i))
    .map((x) => x.st);
}

/** Non-archived cases of one article — what the case navigator shows. */
export function activeCasesForPublication(studies = [], publicationId) {
  return casesForPublication(studies, publicationId).filter((st) => !isArchived(st));
}

/**
 * caseGroupForStudy(studies, studyId) — the case-series group the given row belongs
 * to, or null when the row is not part of one.
 * @returns {{ publicationId:string, citation:object, cases:object[] } | null}
 */
export function caseGroupForStudy(studies = [], studyId) {
  const list = Array.isArray(studies) ? studies : [];
  const target = list.find((x) => x && x.id === studyId);
  if (!target) return null;
  const pid = publicationIdOf(target);
  if (!pid) return null;
  const cases = casesForPublication(list, pid);
  const head = cases[0] || target;
  return {
    publicationId: pid,
    citation: {
      author: s(head.author), year: s(head.year), title: s(head.title),
      journal: s(head.journal), doi: s(head.doi), pmid: s(head.pmid),
    },
    cases,
  };
}

/**
 * caseSummary(study, caseVariables) — the list-ready model for ONE case (the chips in
 * the navigator: "Case 2 — 80%"). `caseVariables` extends the progress denominator
 * with the review's patient-level fields so a case that has an effect size but no age
 * does not read as 100%. Pure.
 * @returns {{ id, caseId, caseNumber, name, pct, filled, total, complete, archived, status }}
 */
export function caseSummary(study = {}, caseVariables = []) {
  const info = caseInfoOf(study) || { caseId: '', caseNumber: 0, label: '' };
  const prog = caseProgressOf(study, caseVariables);
  return {
    id: study.id,
    caseId: info.caseId,
    caseNumber: info.caseNumber,
    name: caseDisplayName(study) || '(unnamed case)',
    pct: prog.pct,
    filled: prog.filledFields,
    total: prog.totalFields,
    complete: !!metaOf(study).completedAt,
    archived: isArchived(study),
    status: articleStatusOf(study),
  };
}

/**
 * caseProgressOf(study, caseVariables) — extraction completion for one case: the
 * measure's expected fields (articleStatus.progressOf) PLUS every defined case
 * variable. When the review has defined no case variables this is identical to
 * progressOf, so a case behaves exactly like a normal article row. Pure.
 * @returns {{ filledFields:number, totalFields:number, pct:number, fields:string[] }}
 */
export function caseProgressOf(study = {}, caseVariables = []) {
  const base = progressOf(study);
  const vars = normalizeCaseVariables(caseVariables);
  if (!vars.length) return base;
  const varFields = vars.map((v) => caseVarKey(v.id));
  const filledVars = varFields.filter((k) => nonEmpty(study[k])).length;
  const totalFields = base.totalFields + varFields.length;
  const filledFields = base.filledFields + filledVars;
  return {
    filledFields,
    totalFields,
    pct: totalFields ? Math.round((filledFields / totalFields) * 100) : 0,
    fields: [...base.fields, ...varFields],
  };
}

/* ════════════════════════ case variables ════════════════════════ */

/** The value types a patient-level case variable can capture. */
export const CASE_VARIABLE_TYPES = Object.freeze(['text', 'number', 'select', 'date', 'boolean']);

/** The 106.md §Case-level data groups, used purely to order the form. */
export const CASE_VARIABLE_GROUPS = Object.freeze([
  'Demographics', 'Presentation', 'Investigations', 'Management', 'Outcome', 'Other',
]);

/**
 * mkCaseVariable(partial, idFn) — canonical patient-level variable DEFINITION.
 * A definition is a schema, not a value; values live on the case row at caseVarKey(id).
 * Pure (idFn injectable).
 * @returns {{ id, label, type, options:string[], unit, group, required:boolean, description }}
 */
export function mkCaseVariable(partial = {}, idFn = DEFAULT_ID) {
  const p = partial || {};
  const type = CASE_VARIABLE_TYPES.includes(p.type) ? p.type : 'text';
  return {
    id: s(p.id) || idFn(),
    label: s(p.label),
    type,
    options: Array.isArray(p.options) ? p.options.map((o) => s(o)).filter(Boolean) : [],
    unit: s(p.unit),
    group: CASE_VARIABLE_GROUPS.includes(p.group) ? p.group : 'Other',
    required: !!p.required,
    description: s(p.description),
  };
}

/**
 * caseVarKey(id) — the flat study-row key a case variable's value is stored under.
 * Flat (not nested) so `extractionMeta.provenance[key]` — which is keyed by field name
 * — gives every case variable click-to-pick source linking with no engine changes.
 */
export function caseVarKey(id) {
  return `cv_${s(id)}`;
}

/** True for a study-row key produced by caseVarKey. */
export function isCaseVarKey(key) {
  return /^cv_.+/.test(String(key || ''));
}

/** The variable id encoded in a case-variable key, or ''. */
export function caseVarIdFromKey(key) {
  const m = /^cv_(.+)$/.exec(String(key || ''));
  return m ? m[1] : '';
}

/**
 * normalizeCaseVariables(list) — coerce a project's stored definitions into canonical
 * shape, dropping unusable entries (no id). Pure; safe on undefined/legacy projects.
 * @returns {object[]}
 */
export function normalizeCaseVariables(list = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = s(raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(mkCaseVariable({ ...raw, id }));
  }
  return out;
}

/**
 * DEFAULT_CASE_VARIABLES — the patient-level fields 106.md names, so a reviewer who
 * turns Case Series Mode on gets a usable form instead of an empty one. Ids are STABLE
 * strings (not generated) so the same variable means the same thing across projects
 * and an export column header is reproducible. Fully editable afterwards.
 */
export const DEFAULT_CASE_VARIABLE_SEEDS = Object.freeze([
  { id: 'age', label: 'Age', type: 'number', unit: 'years', group: 'Demographics' },
  { id: 'sex', label: 'Sex', type: 'select', options: ['Male', 'Female', 'Other', 'Not reported'], group: 'Demographics' },
  { id: 'presentation', label: 'Presentation', type: 'text', group: 'Presentation' },
  { id: 'symptoms', label: 'Symptoms', type: 'text', group: 'Presentation' },
  { id: 'comorbidities', label: 'Comorbidities', type: 'text', group: 'Presentation' },
  { id: 'labs', label: 'Laboratory findings', type: 'text', group: 'Investigations' },
  { id: 'imaging', label: 'Imaging', type: 'text', group: 'Investigations' },
  { id: 'treatment', label: 'Treatment', type: 'text', group: 'Management' },
  { id: 'intervention', label: 'Intervention', type: 'text', group: 'Management' },
  { id: 'complications', label: 'Complications', type: 'text', group: 'Outcome' },
  { id: 'followUp', label: 'Follow-up duration', type: 'text', group: 'Outcome' },
  { id: 'caseOutcome', label: 'Outcome', type: 'select', options: ['Recovered', 'Improved', 'Unchanged', 'Deteriorated', 'Died', 'Not reported'], group: 'Outcome' },
  { id: 'survival', label: 'Survival / status at last follow-up', type: 'text', group: 'Outcome' },
  { id: 'timeToEvent', label: 'Time to event', type: 'text', group: 'Outcome' },
]);

/** The seeded default definitions, canonicalized. Pure. */
export function defaultCaseVariables() {
  return DEFAULT_CASE_VARIABLE_SEEDS.map((v) => mkCaseVariable(v));
}

/* ════════════════════════ mutations (pure) ════════════════════════ */

/** Immutably patch one row by id via a mutator, returning a NEW studies[]. */
function patchRow(studies, studyId, mutate) {
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

/**
 * downgradeProvenance(map) — strip the PDF COORDINATES from every entry while keeping
 * the entry itself (method 'manual', excerpt and history preserved). Used when a value
 * crosses a patient boundary: the value is still auditable, but it no longer claims to
 * have been read at a location that belongs to a different case. Pure; returns a new
 * map (or undefined when there was nothing to downgrade, so the key stays absent).
 */
function downgradeProvenance(map) {
  if (!map || typeof map !== 'object') return undefined;
  const keys = Object.keys(map);
  if (!keys.length) return undefined;
  const out = {};
  for (const field of keys) {
    const prior = map[field] || {};
    const entry = { field, method: 'manual', page: null, bbox: null };
    if (prior.excerpt != null) entry.excerpt = prior.excerpt;
    if (Array.isArray(prior.history) && prior.history.length) entry.history = prior.history.slice(-10);
    out[field] = entry;
  }
  return out;
}

/** Write the caseSeries namespace onto a (cloned) row. */
function stampCase(row, patch) {
  const meta = { ...(row.extractionMeta || {}) };
  meta.caseSeries = { ...(meta.caseSeries || {}), ...patch };
  row.extractionMeta = meta;
}

/**
 * enableCaseSeries(studies, studyId, opts) — 106.md §Core requirement. Turn Case
 * Series Mode ON for the publication the given row belongs to.
 *
 * The row the reviewer is looking at BECOMES Case 1 — nothing is copied, nothing is
 * lost, and any values already extracted stay exactly where they are.
 *
 * Every sibling row of the same CITATION group (e.g. outcome rows added under 82.md)
 * joins the same publication and becomes its own case, in array order. That is
 * deliberate: all rows of one paper MUST share the publication id, or the article
 * would split in two for counting and the cases would stop sharing its PDF. When it
 * converts more than one row the caller is told (`converted`) so the reviewer can be
 * shown what happened — a paper whose extra rows were OUTCOMES rather than patients is
 * one rename or delete away from correct, and turning the mode off restores it exactly.
 *
 * Idempotent: re-enabling an already-enabled publication is a no-op.
 *
 * @param {object[]} studies
 * @param {string} studyId
 * @param {{ idFn?:function, at?:string }} [opts]
 * @returns {{ studies:object[], publicationId:string, converted:number } | { error:string }}
 */
export function enableCaseSeries(studies = [], studyId, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const target = list.find((x) => x && x.id === studyId);
  if (!target) return { error: 'study not found' };
  const existing = publicationIdOf(target);
  if (existing) return { studies: list.slice(), publicationId: existing, converted: 0 };

  const idFn = opts.idFn || DEFAULT_ID;
  const publicationId = `pub_${idFn()}`;
  const at = s(opts.at);

  // Siblings = the same PAPER. Use the strong-citation-key rule so a weak identity
  // (author|year with no title) never sweeps an unrelated study into the series.
  const key = citationKey(target);
  const strong = isStrongCitationKey(key);
  // An ARCHIVED sibling is a row the reviewer already retired (82.md); resurrecting it
  // as "Case 2" would invent a patient that was never reported.
  const isSibling = (x) => x && !publicationIdOf(x)
    && (x.id === target.id || (strong && citationKey(x) === key && !isArchived(x)));

  let n = 0;
  const next = list.map((st) => {
    if (!isSibling(st)) return st;
    n += 1;
    const clone = { ...st };
    stampCase(clone, { publicationId, caseId: `case_${idFn()}`, caseNumber: n, label: '' });
    if (at) clone.updatedAt = at;
    return clone;
  });
  return { studies: next, publicationId, converted: n };
}

/**
 * disableCaseSeries(studies, publicationId, opts) — turn Case Series Mode OFF.
 *
 * NON-DESTRUCTIVE by design (106.md §Architecture: existing projects must not break):
 * the namespace is stripped from every case so the rows become ordinary studies again,
 * but no row and no extracted value is deleted. Case VARIABLE values stay on the rows
 * too — flipping the toggle twice must never lose data. Callers that want the extra
 * cases gone delete them explicitly first.
 *
 * @returns {{ studies:object[], cleared:number } | { error:string }}
 */
export function disableCaseSeries(studies = [], publicationId, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const pid = s(publicationId);
  if (!pid) return { error: 'publicationId is required' };
  const at = s(opts.at);
  let cleared = 0;
  const next = list.map((st) => {
    if (!st || publicationIdOf(st) !== pid) return st;
    cleared += 1;
    const meta = { ...(st.extractionMeta || {}) };
    delete meta.caseSeries;
    const clone = { ...st, extractionMeta: meta };
    if (at) clone.updatedAt = at;
    return clone;
  });
  if (!cleared) return { error: 'publication not found' };
  return { studies: next, cleared };
}

/**
 * addCase(studies, publicationId, opts) — append a fresh case to an article.
 *
 * The new row inherits ONLY the ARTICLE-level fields (authors, year, journal, DOI,
 * design, country, the screening/PDF linkage) — every patient-level value starts
 * blank, because a new case is a new patient. `mkStudy` is injected so this module
 * stays dependency-free.
 *
 * @param {object[]} studies
 * @param {string} publicationId
 * @param {{ mkStudy:function, idFn?:function, label?:string, at?:string }} opts
 * @returns {{ studies:object[], id:string, caseId:string, caseNumber:number } | { error:string }}
 */
export function addCase(studies = [], publicationId, opts = {}) {
  const mkStudy = opts.mkStudy;
  if (typeof mkStudy !== 'function') return { error: 'mkStudy factory is required' };
  const list = Array.isArray(studies) ? studies : [];
  const pid = s(publicationId);
  const siblings = casesForPublication(list, pid);
  if (!siblings.length) return { error: 'publication not found' };

  const idFn = opts.idFn || DEFAULT_ID;
  const src = siblings[0];
  const fresh = mkStudy();
  fresh.id = idFn();
  for (const f of ARTICLE_LEVEL_FIELDS) {
    if (src[f] !== undefined && src[f] !== null && src[f] !== '') fresh[f] = src[f];
  }
  // A case is a patient, not another outcome — keep the paper's outcome/measure scope
  // so the form opens on the same measure the reviewer is already using.
  fresh.outcome = s(src.outcome);
  fresh.esType = s(src.esType);
  const nextNumber = siblings.reduce((m, st) => Math.max(m, (caseInfoOf(st) || {}).caseNumber || 0), 0) + 1;
  stampCase(fresh, { publicationId: pid, caseId: `case_${idFn()}`, caseNumber: nextNumber, label: s(opts.label) });
  if (opts.at) { fresh.addedAt = s(opts.at); fresh.updatedAt = s(opts.at); }

  // Insert directly after the LAST row of this publication so the blob order matches
  // the reader's mental order (all of Smith 2024's cases together).
  const lastIdx = list.reduce((idx, st, i) => (publicationIdOf(st) === pid ? i : idx), -1);
  const next = list.slice();
  next.splice(lastIdx + 1, 0, fresh);
  return { studies: next, id: fresh.id, caseId: (caseInfoOf(fresh) || {}).caseId || '', caseNumber: nextNumber };
}

/**
 * duplicateCase(studies, studyId, opts) — copy an existing case INCLUDING its extracted
 * values (106.md §Extraction interface "Duplicate a case structure when useful"), with
 * a fresh row id + case id + the next case number, inserted right after the source.
 *
 * The copy re-enters the workflow: completion, lock, and the ANALYSIS-SYNC stamps are
 * cleared, so a brand-new case can never inherit "In analysis" from the patient it was
 * copied from (its syncHash would still match, so nothing would ever flag it).
 *
 * Its per-value PROVENANCE is downgraded rather than copied: the page/bbox describe
 * where CASE 1's age was read, and pointing Case 4's age at Case 1's table row is a
 * false evidence claim — the single worst thing a provenance system can do. The
 * entries are kept as `manual` (with their history) so the values are still auditable
 * and are simply re-linked when the reviewer picks them from the PDF.
 * @returns {{ studies:object[], id:string, caseNumber:number } | { error:string }}
 */
export function duplicateCase(studies = [], studyId, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const idx = list.findIndex((x) => x && x.id === studyId);
  if (idx < 0) return { error: 'study not found' };
  const src = list[idx];
  const info = caseInfoOf(src);
  if (!info) return { error: 'not a case row' };
  const idFn = opts.idFn || DEFAULT_ID;

  const copy = JSON.parse(JSON.stringify(src));
  copy.id = idFn();
  const siblings = casesForPublication(list, info.publicationId);
  const nextNumber = siblings.reduce((m, st) => Math.max(m, (caseInfoOf(st) || {}).caseNumber || 0), 0) + 1;
  copy.extractionMeta = { ...(copy.extractionMeta || {}) };
  for (const k of ['completedAt', 'completedBy', 'completedByName', 'locked', 'reopenedAt',
    'reopenedBy', 'archived', 'syncHash', 'syncedAt', 'syncedBy']) {
    delete copy.extractionMeta[k];
  }
  copy.extractionMeta.provenance = downgradeProvenance(copy.extractionMeta.provenance);
  stampCase(copy, {
    publicationId: info.publicationId,
    caseId: `case_${idFn()}`,
    caseNumber: nextNumber,
    label: opts.label !== undefined ? s(opts.label) : '',
  });
  if (opts.at) copy.updatedAt = s(opts.at);

  const lastIdx = list.reduce((acc, st, i) => (publicationIdOf(st) === info.publicationId ? i : acc), idx);
  const next = list.slice();
  next.splice(lastIdx + 1, 0, copy);
  return { studies: next, id: copy.id, caseNumber: nextNumber };
}

/**
 * removeCase(studies, studyId, opts) — DELETE one case and renumber the survivors so
 * the reviewer never sees "Case 1, Case 3, Case 4".
 *
 * The LAST case of a publication cannot be removed (that would silently delete the
 * article from the review) — turn Case Series Mode off instead. A case the reviewer
 * renamed keeps its custom label through renumbering; only auto-numbered cases shift.
 * @returns {{ studies:object[], removedId:string, nextOpenId:string } | { error:string }}
 */
export function removeCase(studies = [], studyId, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const target = list.find((x) => x && x.id === studyId);
  if (!target) return { error: 'study not found' };
  const info = caseInfoOf(target);
  if (!info) return { error: 'not a case row' };
  const siblings = casesForPublication(list, info.publicationId);
  if (siblings.length <= 1) return { error: 'a case series must keep at least one case' };

  const at = s(opts.at);
  const survivors = siblings.filter((st) => st.id !== studyId);
  const numberById = new Map(survivors.map((st, i) => [st.id, i + 1]));
  const next = list
    .filter((st) => !(st && st.id === studyId))
    .map((st) => {
      if (!numberById.has(st && st.id)) return st;
      const clone = { ...st };
      stampCase(clone, { caseNumber: numberById.get(st.id) });
      if (at) clone.updatedAt = at;
      return clone;
    });

  // Open the neighbour the reviewer would expect: the case that took the deleted one's
  // number, else the new last case.
  const pos = siblings.findIndex((st) => st.id === studyId);
  const neighbour = survivors[Math.min(pos, survivors.length - 1)];
  return { studies: next, removedId: studyId, nextOpenId: neighbour ? neighbour.id : '' };
}

/**
 * renameCase(studies, studyId, label) — set a custom case label ('' restores the
 * automatic `Case N`). Pure.
 * @returns {{ studies:object[] } | { error:string }}
 */
export function renameCase(studies = [], studyId, label) {
  const target = (studies || []).find((x) => x && x.id === studyId);
  if (!target) return { error: 'study not found' };
  if (!caseInfoOf(target)) return { error: 'not a case row' };
  const { studies: next, found } = patchRow(studies, studyId, (st) => stampCase(st, { label: s(label) }));
  return found ? { studies: next } : { error: 'study not found' };
}

/**
 * reorderCases(studies, publicationId, orderedIds) — renumber the cases of one article
 * into `orderedIds` (drag-to-reorder). Ids not in the group are ignored; group members
 * missing from orderedIds keep their relative order at the end. Pure.
 * @returns {{ studies:object[] } | { error:string }}
 */
export function reorderCases(studies = [], publicationId, orderedIds = []) {
  const list = Array.isArray(studies) ? studies : [];
  const pid = s(publicationId);
  const members = casesForPublication(list, pid);
  if (!members.length) return { error: 'publication not found' };
  const byId = new Map(members.map((st) => [st.id, st]));
  const seen = new Set();
  const ordered = [];
  for (const id of orderedIds) {
    if (byId.has(id) && !seen.has(id)) { ordered.push(byId.get(id)); seen.add(id); }
  }
  for (const st of members) if (!seen.has(st.id)) { ordered.push(st); seen.add(st.id); }
  const numberById = new Map(ordered.map((st, i) => [st.id, i + 1]));
  const next = list.map((st) => {
    if (!st || !numberById.has(st.id)) return st;
    const clone = { ...st };
    stampCase(clone, { caseNumber: numberById.get(st.id) });
    return clone;
  });
  return { studies: next };
}

/**
 * propagateArticleFields(studies, sourceId, patch, opts) — 106.md §Shared article-level
 * information. Apply `patch` to the source row and mirror its ARTICLE-LEVEL keys onto
 * every sibling case of the same publication, so authors/year/journal/DOI/design are
 * entered once. Case-level keys in the patch are applied to the source row ONLY.
 *
 * Returns the ORIGINAL array untouched when the row is not part of a case series, so
 * callers can route every study write through this helper unconditionally.
 *
 * COMPLETED AND LOCKED SIBLINGS ARE INCLUDED, deliberately. An article-level field
 * describes the PUBLICATION, not a patient's extraction: completion locks the case's
 * clinical data, and letting a DOI correction skip the completed cases would leave one
 * article exporting two different DOIs — a worse failure than touching a locked row.
 * The workspace states this next to the form ("changing one here updates them all"),
 * and `lockedTouched` is returned so a caller can surface it.
 * @returns {{ studies:object[], propagated:string[], lockedTouched:string[] }}
 */
export function propagateArticleFields(studies = [], sourceId, patch = {}, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const target = list.find((x) => x && x.id === sourceId);
  const at = s(opts.at);
  const shared = {};
  for (const [k, v] of Object.entries(patch || {})) if (isArticleLevelField(k)) shared[k] = v;
  const propagated = Object.keys(shared);

  const pid = target ? publicationIdOf(target) : '';
  if (!pid || !propagated.length) {
    // No case series (or nothing shared) → a plain patch of the one row.
    const next = list.map((st) => (st && st.id === sourceId ? { ...st, ...patch, ...(at ? { updatedAt: at } : {}) } : st));
    return { studies: next, propagated: [], lockedTouched: [] };
  }

  const lockedTouched = [];
  const next = list.map((st) => {
    if (!st) return st;
    if (st.id === sourceId) return { ...st, ...patch, ...(at ? { updatedAt: at } : {}) };
    if (publicationIdOf(st) !== pid) return st;
    const m = st.extractionMeta || {};
    if (m.locked || m.completedAt) lockedTouched.push(st.id);
    return { ...st, ...shared, ...(at ? { updatedAt: at } : {}) };
  });
  return { studies: next, propagated, lockedTouched };
}

/* ════════════════════════ counting (106.md §Prevent double counting) ════════════════════════ */

/**
 * countPublications(studies, opts) — the number of distinct PUBLICATIONS represented
 * by the rows. THIS is the figure PRISMA and "included studies" must use: seven cases
 * of one article count once.
 *
 * Rows collapse only on PROVABLE identity (publicationKeyOf): an explicit
 * publicationId, else a strong citation key (DOI / PMID / author|year|title). A row
 * whose citation is still too thin to identify a paper counts as its own publication —
 * over-counting an ambiguous row is honest; merging two different trials is not.
 * @param {{ includeArchived?:boolean }} [opts]
 * @returns {number}
 */
export function countPublications(studies = [], opts = {}) {
  return publicationKeys(studies, opts).size;
}

/** The distinct publication keys present in `studies` (the set countPublications sizes). */
export function publicationKeys(studies = [], opts = {}) {
  const includeArchived = !!opts.includeArchived;
  const keys = new Set();
  for (const st of (Array.isArray(studies) ? studies : [])) {
    if (!st || typeof st !== 'object') continue;
    if (!includeArchived && isArchived(st)) continue;
    keys.add(publicationKeyOf(st));
  }
  return keys;
}

/**
 * countCases(studies, opts) — the number of individual patient CASES across the whole
 * review. Ordinary (non case-series) studies contribute 0 — a case count is not a
 * study count, and 106.md requires the two to stay separable.
 * @returns {number}
 */
export function countCases(studies = [], opts = {}) {
  const includeArchived = !!opts.includeArchived;
  let n = 0;
  for (const st of (Array.isArray(studies) ? studies : [])) {
    if (!st || !isCaseRow(st)) continue;
    if (!includeArchived && isArchived(st)) continue;
    n += 1;
  }
  return n;
}

/** The number of publications that are case series (i.e. carry at least one case). */
export function countCaseSeriesArticles(studies = [], opts = {}) {
  const includeArchived = !!opts.includeArchived;
  const pubs = new Set();
  for (const st of (Array.isArray(studies) ? studies : [])) {
    if (!st || !isCaseRow(st)) continue;
    if (!includeArchived && isArchived(st)) continue;
    pubs.add(publicationIdOf(st));
  }
  return pubs.size;
}

/**
 * caseSeriesCounts(studies, opts) — the whole counting contract in one object, so a
 * caller can never mix a publication count with a case count by accident.
 *
 *   publications        distinct articles (PRISMA / "included studies" uses THIS)
 *   caseSeriesArticles  how many of those are case series
 *   cases               individual patients extracted from case-series articles
 *   rows                raw studies[] rows (analysis observations); never a study count
 *   analyticalUnits     cases + non-case rows — the observation count for a
 *                       patient-level meta-analysis
 * @returns {{ publications:number, caseSeriesArticles:number, cases:number, rows:number, analyticalUnits:number, hasCaseSeries:boolean }}
 */
export function caseSeriesCounts(studies = [], opts = {}) {
  const includeArchived = !!opts.includeArchived;
  const list = (Array.isArray(studies) ? studies : []).filter((st) => st && (includeArchived || !isArchived(st)));
  const publications = countPublications(list, { includeArchived: true });
  const cases = countCases(list, { includeArchived: true });
  const caseSeriesArticles = countCaseSeriesArticles(list, { includeArchived: true });
  const nonCaseRows = list.filter((st) => !isCaseRow(st)).length;
  return {
    publications,
    caseSeriesArticles,
    cases,
    rows: list.length,
    analyticalUnits: cases + nonCaseRows,
    hasCaseSeries: cases > 0,
  };
}

/* ════════════════════════ downstream handoff ════════════════════════ */

/**
 * caseObservations(studies, opts) — the analysis handoff (106.md §Integration with
 * downstream analysis). One entry per CASE, each carrying the link back to its parent
 * publication, so a patient-level meta-analysis can treat cases as independent
 * observations WITHOUT losing which article they came from (a clustered / multilevel
 * model needs exactly this pairing).
 * @returns {Array<{ studyId, caseId, caseNumber, caseName, publicationId, publicationKey,
 *                   citation:{author,year,title,journal,doi,pmid}, row:object }>}
 */
export function caseObservations(studies = [], opts = {}) {
  const includeArchived = !!opts.includeArchived;
  const out = [];
  for (const st of (Array.isArray(studies) ? studies : [])) {
    const info = st && caseInfoOf(st);
    if (!info) continue;
    if (!includeArchived && isArchived(st)) continue;
    out.push({
      studyId: st.id,
      caseId: info.caseId,
      caseNumber: info.caseNumber,
      caseName: caseDisplayName(st),
      publicationId: info.publicationId,
      publicationKey: publicationKeyOf(st),
      citation: {
        author: s(st.author), year: s(st.year), title: s(st.title),
        journal: s(st.journal), doi: s(st.doi), pmid: s(st.pmid),
      },
      row: st,
    });
  }
  return out;
}

/**
 * buildCaseExportRows(studies, caseVariables, opts) — 106.md §Export. One row per
 * individual case, article-level identifiers retained on every row (Publication, DOI,
 * PubMed ID, study id) so a case-level file never loses its parent article.
 * @returns {{ columns:Array<{key,label}>, rows:object[] }}
 */
export function buildCaseExportRows(studies = [], caseVariables = [], opts = {}) {
  const vars = normalizeCaseVariables(caseVariables);
  const columns = [
    { key: 'publication', label: 'Publication' },
    { key: 'author', label: 'Author' },
    { key: 'year', label: 'Year' },
    { key: 'journal', label: 'Journal' },
    { key: 'doi', label: 'DOI' },
    { key: 'pmid', label: 'PubMed ID' },
    { key: 'design', label: 'Study design' },
    { key: 'country', label: 'Country' },
    { key: 'publicationId', label: 'Publication ID' },
    { key: 'studyId', label: 'Study row ID' },
    { key: 'caseId', label: 'Case ID' },
    { key: 'caseNumber', label: 'Case number' },
    { key: 'caseLabel', label: 'Case' },
    ...vars.map((v) => ({ key: caseVarKey(v.id), label: v.unit ? `${v.label} (${v.unit})` : v.label })),
    { key: 'esType', label: 'Effect measure' },
    { key: 'es', label: 'Effect size' },
    { key: 'lo', label: 'CI lower' },
    { key: 'hi', label: 'CI upper' },
    { key: 'notes', label: 'Notes' },
  ];
  const rows = caseObservations(studies, opts).map((obs) => {
    const st = obs.row;
    const row = {
      publication: [s(st.author), s(st.year)].filter(Boolean).join(' ') || s(st.title),
      author: s(st.author), year: s(st.year), journal: s(st.journal),
      doi: s(st.doi), pmid: s(st.pmid), design: s(st.design), country: s(st.country),
      publicationId: obs.publicationId,
      studyId: obs.studyId,
      caseId: obs.caseId,
      caseNumber: obs.caseNumber,
      caseLabel: obs.caseName,
      esType: s(st.esType), es: s(st.es), lo: s(st.lo), hi: s(st.hi),
      notes: s(st.notes),
    };
    for (const v of vars) { const k = caseVarKey(v.id); row[k] = s(st[k]); }
    return row;
  });
  return { columns, rows };
}

/* ════════════════════════ structured case tables ════════════════════════ */

/**
 * buildCasesFromTable(studies, publicationId, table, opts) — 106.md §Tables and
 * structured case series. Many case-series papers report patients as TABLE COLUMNS:
 *
 *     | Variable | Patient 1 | Patient 2 | Patient 3 |
 *     | Age      | 42        | 56        | 61        |
 *
 * This maps such a grid onto case records: one case per patient column, one case
 * variable per row. The UI does not surface it yet — 106.md asks only that the data
 * model support it cleanly — but it is exercised by tests, so an automated table
 * mapper can be wired to it later without redesigning anything.
 *
 * Existing cases are REUSED in column order (values are filled in, not duplicated) and
 * missing ones are appended, so re-running the mapper after a correction is safe.
 *
 * @param {object[]} studies
 * @param {string} publicationId
 * @param {{ patients:Array<{label?:string, values:Object<string,string>}> }} table
 *        `values` is keyed by case-variable ID (not caseVarKey).
 * @param {{ mkStudy:function, idFn?:function, at?:string, provenance?:Object }} opts
 *        `provenance` (optional) maps `${patientIndex}:${variableId}` → a
 *        mkValueProvenance-shaped entry, so each cell keeps its own source link.
 * @returns {{ studies:object[], caseIds:string[], filled:number } | { error:string }}
 */
export function buildCasesFromTable(studies = [], publicationId, table = {}, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const pid = s(publicationId);
  const patients = Array.isArray(table.patients) ? table.patients : [];
  if (!patients.length) return { error: 'table has no patient columns' };
  if (!casesForPublication(list, pid).length) return { error: 'publication not found' };

  let working = list;
  const targetIds = [];
  let filled = 0;

  for (let i = 0; i < patients.length; i++) {
    const existing = casesForPublication(working, pid);
    let row = existing[i] || null;
    if (!row) {
      const r = addCase(working, pid, { mkStudy: opts.mkStudy, idFn: opts.idFn, at: opts.at });
      if (r.error) return { error: r.error };
      working = r.studies;
      row = casesForPublication(working, pid)[i];
    }
    if (!row) return { error: 'could not materialise a case row' };
    targetIds.push(row.id);

    const p = patients[i] || {};
    const patch = {};
    const provByField = {};
    const targetRow = row;
    for (const [varId, value] of Object.entries(p.values || {})) {
      const key = caseVarKey(varId);
      patch[key] = s(value);
      filled += 1;
      const prov = opts.provenance && opts.provenance[`${i}:${varId}`];
      const prior = (targetRow.extractionMeta && targetRow.extractionMeta.provenance
        && targetRow.extractionMeta.provenance[key]) || null;
      if (prov) {
        // Normalize through the SAME writer every other provenance path uses, so an
        // unvalidated bbox or an unknown method can never reach the blob from here.
        provByField[key] = mkValueProvenance({ ...prov, field: key, at: prov.at || s(opts.at) || undefined });
      } else if (prior && (prior.page || prior.bbox)) {
        // Re-running the mapper OVERWRITES this value. Leaving the old page/bbox in
        // place would point the new value at where the OLD one was read — the same
        // false-evidence failure setField guards against on manual entry.
        const history = Array.isArray(prior.history) ? prior.history.slice(-10) : [];
        if (nonEmpty(targetRow[key]) && String(targetRow[key]) !== patch[key]) {
          history.push({ value: String(targetRow[key]), method: prior.method || 'manual', at: s(opts.at) || undefined });
        }
        provByField[key] = mkValueProvenance({
          field: key, method: 'manual', at: s(opts.at) || undefined,
          history: history.length ? history : undefined,
        });
      }
    }
    working = working.map((st) => {
      if (!st || st.id !== row.id) return st;
      const clone = { ...st, ...patch };
      if (opts.at) clone.updatedAt = s(opts.at);
      if (s(p.label)) stampCase(clone, { label: s(p.label) });
      if (Object.keys(provByField).length) {
        const meta = { ...(clone.extractionMeta || {}) };
        meta.provenance = { ...(meta.provenance || {}), ...provByField };
        clone.extractionMeta = meta;
      }
      return clone;
    });
  }

  return { studies: working, caseIds: targetIds, filled };
}
