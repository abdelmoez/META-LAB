/**
 * extraction/fieldRegistry.js — 116.md §34-§40 (project-level extraction field library)
 * and §52-§56 (the single seam the Individual Study Contributions menu reads).
 *
 * PURE, dependency-light (fieldCatalog.js + proportionMeta.js for the two 107.md enum
 * label maps). No DOM / IO / Date.now / Math.random — `idFn` is injectable, exactly like
 * caseSeries.js, because StrictMode double-invokes state updaters and blob CAS retries
 * re-run them.
 *
 * ── WHY THIS SHAPE ────────────────────────────────────────────────────────────────
 * The repo already had ONE proven per-project field-definition system: 106.md's
 * `project.caseVariables` — typed definitions in the blob, stable 8-char ids, values on
 * the study row under the FLAT key `cv_<id>`, dynamically picked up by the sync hash.
 * §34-§40 is the same machine generalised to the whole review, so this module mirrors
 * `caseSeries.js` deliberately rather than inventing a second dialect.
 *
 * ── STORAGE CONTRACT (§38 "never use mutable display strings as primary keys") ────
 *   DEFINITIONS  project.extractionFields = [
 *                  { id, catalogId, label, category, dataType, unit, options[],
 *                    description, order, hidden, archived } ]
 *   VALUES       on the studies[] row, under `storageKeyOf(def)`:
 *                  • a CATALOG field that aliases an existing mkStudy key stores in THAT
 *                    key (`country`, `journal`, `followup`, …) — enabling it exposes the
 *                    data that is already there, never a second copy (§36 "merge");
 *                  • everything else stores under the namespaced flat key `xf_<id>`,
 *                    mirroring `cv_<id>`: regex-detectable, collision-free with every
 *                    built-in row key, and — because it is FLAT —
 *                    `extractionMeta.provenance[key]` gives it click-to-pick source
 *                    linking, undo and autosave for free.
 *   The label lives ONLY in the definition. Renaming it cannot move a value, because no
 *   value was ever keyed by it.
 *
 * ── READERS SELF-HEAL, NOTHING IS WRITTEN AT LOAD (repo invariant 3) ─────────────
 * `projectExtractionFields(project)` answers `[]` for an absent / legacy / malformed
 * config, and `normalizeExtractionFields` drops unusable entries and coerces unknown
 * categories/types to their defaults. No load path ever writes the normalized form back:
 * a project that never used the feature keeps a byte-identical blob.
 *
 * ── DELETION IS NOT AN OPTION WHILE DATA EXISTS (§39) ────────────────────────────
 * `archiveExtractionField` retires a field WITHOUT touching a single stored value;
 * `removeExtractionField` refuses outright while any row still carries one. The only
 * hard delete possible is of a field nobody ever filled in.
 */

import {
  catalogEntry, isFieldCategory, isFieldDataType, DEFAULT_FIELD_CATEGORY,
  DEFAULT_FIELD_DATA_TYPE, OPTION_DATA_TYPES, NUMERIC_DATA_TYPES,
  FIELD_CATEGORY_LABEL, FIELD_CATEGORIES, ROW_CONTRIBUTION_CATALOG,
} from './fieldCatalog.js';
import { denominatorPopulationLabel, actionStatusLabel } from './proportionMeta.js';

const DEFAULT_ID = () => Math.random().toString(36).slice(2, 10);
const s = (v) => (v == null ? '' : String(v).trim());
const nonEmpty = (v) => v !== '' && v !== null && v !== undefined;

/* ════════════════════════ storage keys (§38) ════════════════════════ */

/** The namespace every NEW project field's value key carries (cf. `cv_` — 106.md). */
export const FIELD_KEY_PREFIX = 'xf_';

/** The flat study-row key a project-defined field's value is stored under. */
export function fieldKey(id) {
  return `${FIELD_KEY_PREFIX}${s(id)}`;
}

/** True for a study-row key produced by `fieldKey` (the `isCaseVarKey` analogue). */
export function isProjectFieldKey(key) {
  return /^xf_.+/.test(String(key || ''));
}

/** The field id encoded in a project-field key, or ''. */
export function fieldIdFromKey(key) {
  const m = /^xf_(.+)$/.exec(String(key || ''));
  return m ? m[1] : '';
}

/**
 * storageKeyOf(def) — where this field's VALUES live on a studies[] row.
 * A catalog field that aliases an existing mkStudy key reads/writes that key; everything
 * else (custom fields, catalog fields with no existing home) uses `xf_<id>`.
 */
export function storageKeyOf(def) {
  if (!def || !s(def.id)) return '';
  const cat = catalogEntry(def.catalogId);
  if (cat && cat.mapsTo) return cat.mapsTo;
  return fieldKey(def.id);
}

/** True when this definition aliases an existing built-in row key rather than minting one. */
export function isAliasField(def) {
  const cat = catalogEntry(def && def.catalogId);
  return !!(cat && cat.mapsTo);
}

/* ════════════════════════ definitions ════════════════════════ */

/**
 * mkExtractionField(partial, idFn) — the canonical field DEFINITION.
 * A definition is a schema, not a value; values live on the row at storageKeyOf(def).
 * Unknown categories/data types degrade to their defaults so a definition written by a
 * newer build still renders as an editable field instead of disappearing.
 * Pure (idFn injectable).
 */
export function mkExtractionField(partial = {}, idFn = DEFAULT_ID) {
  const p = partial || {};
  const catalogId = s(p.catalogId);
  const cat = catalogEntry(catalogId);
  const id = s(p.id) || (cat ? cat.catalogId : '') || idFn();
  const dataType = isFieldDataType(p.dataType)
    ? String(p.dataType)
    : (cat && isFieldDataType(cat.dataType) ? cat.dataType : DEFAULT_FIELD_DATA_TYPE);
  const category = isFieldCategory(p.category)
    ? String(p.category)
    : (cat && isFieldCategory(cat.category) ? cat.category : DEFAULT_FIELD_CATEGORY);
  const rawOptions = Array.isArray(p.options) ? p.options : (cat && Array.isArray(cat.options) ? cat.options : []);
  const order = Number.isFinite(Number(p.order)) ? Math.max(0, Math.floor(Number(p.order))) : 0;
  return {
    id,
    catalogId: cat ? cat.catalogId : '',
    label: s(p.label) || (cat ? cat.label : '') || id,
    category,
    dataType,
    unit: s(p.unit) || (cat ? s(cat.unit) : ''),
    options: OPTION_DATA_TYPES.includes(dataType) ? rawOptions.map((o) => s(o)).filter(Boolean) : [],
    description: s(p.description) || (cat ? s(cat.description) : ''),
    order,
    hidden: !!p.hidden,
    archived: !!p.archived,
  };
}

/**
 * normalizeExtractionFields(list) — coerce a project's stored definitions into canonical
 * shape: unusable entries (no id) and duplicate ids are dropped, `order` is re-indexed
 * 0..n-1 after a stable sort. Pure; safe on undefined/legacy projects. NEVER written
 * back at load (repo invariant 3) — this is a read-time view.
 */
export function normalizeExtractionFields(list = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const id = s(raw.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const def = mkExtractionField({ ...raw, id });
    out.push({ def, order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : i, i });
  });
  out.sort((a, b) => (a.order - b.order) || (a.i - b.i));
  return out.map((x, i) => ({ ...x.def, order: i }));
}

/** The project's field definitions, self-healed. Absent/legacy ⇒ `[]` with no write. */
export function projectExtractionFields(project) {
  return normalizeExtractionFields(project && project.extractionFields);
}

/**
 * activeExtractionFields(project) — the definitions the EXTRACTION FORMS render and the
 * exporters carry: neither hidden nor archived, in configured order (§39/§40).
 */
export function activeExtractionFields(project) {
  return projectExtractionFields(project).filter((f) => !f.hidden && !f.archived);
}

/** One definition by id, or null. */
export function extractionFieldById(project, id) {
  const want = s(id);
  return projectExtractionFields(project).find((f) => f.id === want) || null;
}

/** Display label including the unit, e.g. "Mean age (years)". */
export function fieldDisplayLabel(def) {
  if (!def) return '';
  return def.unit ? `${def.label} (${def.unit})` : def.label;
}

/**
 * writeExtractionFields(project, list) — the ONE blob writer. An emptied configuration
 * DELETES the key, so a project that adds a field and removes it again serialises
 * byte-identically to one that never had the feature. Pure.
 */
export function writeExtractionFields(project, list) {
  const next = normalizeExtractionFields(list);
  const out = { ...(project || {}) };
  if (next.length) out.extractionFields = next; else delete out.extractionFields;
  return out;
}

/* ════════════════════════ configuration ops (§39) ════════════════════════ */

const clone = (list) => normalizeExtractionFields(list);
const indexOfId = (list, id) => list.findIndex((f) => f.id === s(id));
/**
 * finish(list) — every op below builds its result in the INTENDED DISPLAY ORDER, so the
 * `order` field must be re-stamped from the array index before normalizing. Without this
 * `normalizeExtractionFields` (which sorts by the stored `order`) would faithfully undo
 * a move/reorder — the array said one thing and the stale numbers said another.
 */
const finish = (list) => normalizeExtractionFields(list.map((f, i) => ({ ...f, order: i })));

/**
 * addCatalogField(list, catalogId, idFn) — enable one CATALOG field for the project.
 * Idempotent-safe: re-adding an existing id is refused (`error`), and re-adding an
 * ARCHIVED field un-archives it instead of minting a duplicate — which is what makes
 * "archive, don't delete" a safe default (§39).
 * @returns {{fields:object[], id:string}|{error:string}}
 */
export function addCatalogField(list = [], catalogId, idFn = DEFAULT_ID) {
  const cat = catalogEntry(catalogId);
  if (!cat) return { error: 'unknown field' };
  if (cat.managed) return { error: 'this field is managed by the effect measure' };
  const next = clone(list);
  const at = indexOfId(next, cat.catalogId);
  if (at >= 0) {
    if (!next[at].archived && !next[at].hidden) return { error: 'already added' };
    next[at] = { ...next[at], archived: false, hidden: false };
    return { fields: finish(next), id: cat.catalogId };
  }
  next.push(mkExtractionField({ catalogId: cat.catalogId, order: next.length }, idFn));
  return { fields: finish(next), id: cat.catalogId };
}

/**
 * addCustomField(list, spec, idFn) — §37. name / description / dataType / unit /
 * category, with a GENERATED stable id (never derived from the name).
 * @returns {{fields:object[], id:string}|{error:string}}
 */
export function addCustomField(list = [], spec = {}, idFn = DEFAULT_ID) {
  const label = s(spec.label);
  if (!label) return { error: 'a field name is required' };
  const next = clone(list);
  const def = mkExtractionField({
    label,
    description: spec.description,
    dataType: spec.dataType,
    unit: spec.unit,
    category: spec.category,
    options: spec.options,
    order: next.length,
  }, idFn);
  if (indexOfId(next, def.id) >= 0) return { error: 'id collision' };
  next.push(def);
  return { fields: finish(next), id: def.id };
}

/** Generic single-field patch. Pure; unknown ids are a no-op returning the same shape. */
function patchField(list, id, patch) {
  const next = clone(list);
  const at = indexOfId(next, id);
  if (at < 0) return { error: 'field not found' };
  next[at] = mkExtractionField({ ...next[at], ...patch, id: next[at].id, catalogId: next[at].catalogId });
  return { fields: finish(next) };
}

/** §39 — rename the DISPLAY label. Values are keyed by id, so nothing moves. */
export function renameExtractionField(list = [], id, label) {
  const name = s(label);
  if (!name) return { error: 'a field name is required' };
  return patchField(list, id, { label: name });
}

/** §39 — define/clear the unit. */
export function setExtractionFieldUnit(list = [], id, unit) {
  return patchField(list, id, { unit: s(unit) });
}

/** §39 — define the allowed options (categorical / multi-select only). */
export function setExtractionFieldOptions(list = [], id, options) {
  const arr = Array.isArray(options)
    ? options
    : String(options == null ? '' : options).split(',');
  return patchField(list, id, { options: arr.map((o) => s(o)).filter(Boolean) });
}

/** §39 — change the data type (options are dropped when the type stops carrying them). */
export function setExtractionFieldDataType(list = [], id, dataType) {
  if (!isFieldDataType(dataType)) return { error: 'unknown data type' };
  return patchField(list, id, { dataType });
}

/** §39 — hide / unhide. The field and every stored value stay exactly where they are. */
export function setExtractionFieldHidden(list = [], id, hidden) {
  return patchField(list, id, { hidden: !!hidden });
}

/**
 * §39 — ARCHIVE / un-archive. The retired field disappears from the extraction forms,
 * the exports and the analysis column menu, and NOT ONE stored value is touched: an
 * un-archive brings every number straight back.
 */
export function setExtractionFieldArchived(list = [], id, archived) {
  return patchField(list, id, { archived: !!archived });
}

/**
 * reorderExtractionFields(list, orderedIds) — §39. Ids missing from `orderedIds` keep
 * their relative order at the end (same rule as reorderCases, 106.md).
 */
export function reorderExtractionFields(list = [], orderedIds = []) {
  const next = clone(list);
  const byId = new Map(next.map((f) => [f.id, f]));
  const seen = new Set();
  const ordered = [];
  for (const id of (Array.isArray(orderedIds) ? orderedIds : [])) {
    const k = s(id);
    if (byId.has(k) && !seen.has(k)) { ordered.push(byId.get(k)); seen.add(k); }
  }
  for (const f of next) if (!seen.has(f.id)) { ordered.push(f); seen.add(f.id); }
  return { fields: finish(ordered) };
}

/** Move one field up (-1) or down (+1) — the affordance the config UI actually uses. */
export function moveExtractionField(list = [], id, dir) {
  const next = clone(list);
  const at = indexOfId(next, id);
  if (at < 0) return { error: 'field not found' };
  const to = at + (Number(dir) < 0 ? -1 : 1);
  if (to < 0 || to >= next.length) return { fields: next };
  const arr = next.slice();
  [arr[at], arr[to]] = [arr[to], arr[at]];
  return { fields: finish(arr) };
}

/* ════════════════════════ values on the rows ════════════════════════ */

/** The raw stored value for one field on one row ('' when absent). */
export function fieldValueOf(study, def) {
  const key = storageKeyOf(def);
  if (!key || !study) return '';
  const v = study[key];
  return v == null ? '' : v;
}

/** How many rows currently carry a value for this field. */
export function countFieldValues(studies = [], def) {
  const key = storageKeyOf(def);
  if (!key) return 0;
  let n = 0;
  for (const st of (Array.isArray(studies) ? studies : [])) {
    if (st && nonEmpty(st[key])) n += 1;
  }
  return n;
}

/** True when ANY row carries a value for this field (§39 — the delete guard). */
export function fieldHasValues(studies = [], def) {
  return countFieldValues(studies, def) > 0;
}

/**
 * removeExtractionField(list, id, studies) — §39. A HARD delete, allowed ONLY for a
 * field no row has ever filled in. Anything else must be archived: destroying extracted
 * data is not something a configuration screen gets to do silently.
 * @returns {{fields:object[]}|{error:string, values:number}}
 */
export function removeExtractionField(list = [], id, studies = []) {
  const next = clone(list);
  const at = indexOfId(next, id);
  if (at < 0) return { error: 'field not found', values: 0 };
  const def = next[at];
  const values = countFieldValues(studies, def);
  if (values > 0) {
    return {
      error: `“${def.label}” holds extracted data in ${values} record${values === 1 ? '' : 's'} — archive it instead of deleting it.`,
      values,
    };
  }
  next.splice(at, 1);
  return { fields: finish(next) };
}

/* ════════════════════════ downstream derivation ════════════════════════ */

/**
 * projectFieldKeysOf(study) — the `xf_*` keys PRESENT on one row, sorted. This is the
 * derivation every hand-maintained allow-list downstream now uses instead of growing a
 * literal: computeSyncHash, the provenance value slice, the manuscript dependency slice.
 * Sorted so key order in the blob can never churn a digest.
 */
export function projectFieldKeysOf(study) {
  if (!study || typeof study !== 'object') return [];
  return Object.keys(study).filter(isProjectFieldKey).sort();
}

/**
 * projectFieldValuesOf(study) — `{ xf_key: value }` for every project field the row
 * carries a NON-EMPTY value for, in sorted key order. Used by the manuscript dependency
 * / provenance slices, which must notice a change but must not churn on empty keys.
 */
export function projectFieldValuesOf(study) {
  const out = {};
  for (const k of projectFieldKeysOf(study)) {
    const v = study[k];
    if (nonEmpty(v)) out[k] = v;
  }
  return out;
}

/**
 * projectFieldColumns(project) — `[{ key, label }]` for the EXPORTERS (extraction CSV,
 * case CSV, journal study table). Active fields only, in configured order, so a hidden
 * or archived field stops appearing in exports exactly as it stops appearing on the
 * form. A project with no configured fields returns `[]` ⇒ every export is byte-identical.
 */
export function projectFieldColumns(project) {
  return activeExtractionFields(project).map((f) => ({
    key: storageKeyOf(f),
    label: fieldDisplayLabel(f),
    dataType: f.dataType,
    id: f.id,
  }));
}

/* ════════════════════════ value formatting (§56) ════════════════════════ */

/** §56 — the intentional missing state. NEVER `undefined`, `null` or an ambiguous blank. */
export const MISSING_VALUE_TEXT = '—';
/** The long form, used as a tooltip/aria label beside the em dash. */
export const NOT_EXTRACTED_LABEL = 'Not extracted';

const BOOL_TRUE = new Set(['true', 'yes', 'y', '1']);
const BOOL_FALSE = new Set(['false', 'no', 'n', '0']);

/**
 * formatFieldValue(def, raw) — the DISPLAY form of one stored value, or `null` when the
 * field holds nothing. `null` is the caller's cue to print MISSING_VALUE_TEXT; this
 * function never invents a value and never returns "undefined"/"null" as text.
 */
export function formatFieldValue(def, raw) {
  if (!nonEmpty(raw)) return null;
  const type = (def && def.dataType) || DEFAULT_FIELD_DATA_TYPE;
  if (type === 'boolean') {
    const t = String(raw).trim().toLowerCase();
    if (BOOL_TRUE.has(t)) return 'Yes';
    if (BOOL_FALSE.has(t)) return 'No';
    return String(raw).trim();
  }
  if (type === 'multiselect') {
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const parts = list.map((x) => s(x)).filter(Boolean);
    return parts.length ? parts.join('; ') : null;
  }
  const text = Array.isArray(raw) ? raw.map((x) => s(x)).filter(Boolean).join('; ') : s(raw);
  if (!text) return null;
  if (type === 'percentage') return /%\s*$/.test(text) ? text : `${text}%`;
  const unit = s(def && def.unit);
  if (unit && NUMERIC_DATA_TYPES.includes(type)) return `${text} ${unit}`;
  return text;
}

/* ════════════════════════ the contributions seam (§52-§56) ════════════════════════ */

/**
 * The two 107.md classifications are stored as internal enum keys; a table must print
 * the HUMAN label (and '' — "not classified" — must read as the missing state, never as
 * a fabricated category). Everything else reads straight off the row.
 */
const SPECIAL_READERS = Object.freeze({
  denominatorPopulation: (row) => denominatorPopulationLabel(row),
  actionStatus: (row) => actionStatusLabel(row),
});

/**
 * listContributionFields(project) — §53. THE single seam the Individual Study
 * Contributions "Columns" menu reads. There is no second catalog anywhere: the options
 * are (a) the project's own configured extraction fields and (b) the catalog entries
 * that alias a built-in row key, which every row honestly either has or has not.
 *
 * A project field that ALIASES a built-in key (e.g. Country) collapses onto the same
 * column — one entry, the project's (possibly renamed) label winning.
 *
 * @returns {Array<{ id, key, label, category, categoryLabel, dataType, unit, source }>}
 *   `id` IS the storage key: stable across a label rename (§38), which is exactly what
 *   `analysisSettings.contributionColumns[pairKey]` persists.
 */
export function listContributionFields(project) {
  const byKey = new Map();
  // (b) the always-available built-in row fields, in catalog (§36 category) order.
  for (const e of ROW_CONTRIBUTION_CATALOG) {
    byKey.set(e.mapsTo, {
      id: e.mapsTo,
      key: e.mapsTo,
      label: e.label,
      category: e.category,
      categoryLabel: FIELD_CATEGORY_LABEL[e.category] || e.category,
      dataType: e.dataType,
      unit: s(e.unit),
      source: 'row',
    });
  }
  // (a) the project's configured fields — they OVERRIDE a built-in of the same key so a
  // renamed label shows, and they add every custom `xf_*` field.
  for (const f of activeExtractionFields(project)) {
    const key = storageKeyOf(f);
    if (!key) continue;
    byKey.set(key, {
      id: key,
      key,
      label: f.label,
      category: f.category,
      categoryLabel: FIELD_CATEGORY_LABEL[f.category] || f.category,
      dataType: f.dataType,
      unit: f.unit,
      source: 'project',
    });
  }
  // Project fields first (the review chose them), then the remaining built-ins.
  const list = [...byKey.values()];
  const rank = (x) => (x.source === 'project' ? 0 : 1);
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (rank(a.x) - rank(b.x)) || (a.i - b.i))
    .map((w) => w.x);
}

/**
 * resolveContributionColumns(project, ids) — turn a persisted id list into renderable
 * columns. 116.md Part XIX edge case: an id whose field was ARCHIVED, hidden or removed
 * from the project schema is NOT rendered and NOT silently deleted from the stored
 * selection — it is reported in `unavailable` so the table can say so in one quiet line
 * and an un-archive brings the column straight back. Duplicates and unknown ids can
 * never crash the table.
 * @returns {{ columns:object[], unavailable:string[] }}
 */
export function resolveContributionColumns(project, ids) {
  const available = new Map(listContributionFields(project).map((f) => [f.id, f]));
  const columns = [];
  const unavailable = [];
  const seen = new Set();
  for (const raw of (Array.isArray(ids) ? ids : [])) {
    const id = s(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const f = available.get(id);
    if (f) columns.push(f); else unavailable.push(id);
  }
  return { columns, unavailable };
}

/**
 * contributionCellValue(field, row) — the DISPLAY string for one optional cell, or
 * `null` when the study has no value. §56: callers print MISSING_VALUE_TEXT for `null`
 * and never `undefined` / `null` / an ambiguous blank.
 */
export function contributionCellValue(field, row) {
  if (!field || !row) return null;
  const reader = SPECIAL_READERS[field.key];
  if (reader) {
    const label = reader(row);
    return label ? label : null;      // '' ⇒ not classified ⇒ the missing state
  }
  return formatFieldValue(field, row[field.key]);
}

/** The cell TEXT — `contributionCellValue` with §56's missing state already applied. */
export function contributionCellText(field, row) {
  const v = contributionCellValue(field, row);
  return v == null ? MISSING_VALUE_TEXT : v;
}

/** Menu grouping for the Columns control: [{ id, label, fields[] }] in §36 order. */
export function contributionFieldsByCategory(project) {
  const list = listContributionFields(project);
  return FIELD_CATEGORIES
    .map((c) => ({ id: c.id, label: c.label, fields: list.filter((f) => f.category === c.id) }))
    .filter((g) => g.fields.length > 0);
}
