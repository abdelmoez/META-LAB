/**
 * extraction/fieldCatalog.js — 116.md §34/§36/§37 (project-level extraction field library).
 *
 * THE CURATED CATALOG of common systematic-review extraction fields, organised by the
 * §36 categories. PURE literal module: no imports, no DOM, no IO, no Date/Math.random —
 * so the server, the client and the tests all read exactly the same list.
 *
 * ── MERGE, NEVER DUPLICATE (§36 "inspect what already exists and merge") ───────────
 * The extraction row (`mkStudy`, project-model/defaults.js + the lockstep copy in
 * frontend/workspace/projectHelpers.js) ALREADY carries ~60 flat keys: author/year/
 * country/design/n, the citation block (title/authors/journal/doi/pmid/abstract), the
 * descriptive block (dataSource/enrollPeriod/populationDef/interventionDef/
 * comparatorDef/primaryOutcome/secondaryOutcomes/funding/followup), the estimate block
 * (esType/timepoint/adjusted/dataNature/source) and every raw-data slot the effect
 * measures own (a/b/c/d, events/total, nExp/meanExp/sdExp…, tp/fp/fn/tn, es/lo/hi),
 * plus the 107.md proportion metadata (denominatorPopulation/denominatorCustom/
 * actionStatus). A catalog entry that names one of those is an ALIAS — it carries
 * `mapsTo: '<existing row key>'` and its values are stored in that very key, so
 * enabling "Country" on a project EXPOSES the country data that is already there
 * instead of minting a second, divergent copy. Only entries with NO `mapsTo` are new
 * storage, and those live under the namespaced `xf_<id>` key (fieldRegistry.js).
 *
 * `managed: true` marks a field the EFFECT MEASURE (or another engine) already owns and
 * renders — events/total, mean/SD, es/lo/hi, the proportion classifications. §36 asks
 * for them in the catalog so reviewers can see the review's whole variable surface, but
 * they are NOT addable: a free-floating duplicate of `events` would be a second, silent
 * source of truth for the statistics. They stay available as ANALYSIS columns (§53
 * explicitly lists "Denominator population" / "Action status"), which is a read.
 *
 * `contribution: false` marks a field the Individual Study Contributions table ALREADY
 * prints as a default column (n / es / lo / hi — §54 "preserve the existing default
 * columns"), so it never shows up twice in the optional-columns menu.
 *
 * IDS ARE STABLE STRINGS (§38), never display labels: renaming "Follow-up duration" to
 * "Follow-up" changes `label` only — `catalogId`, the field id and the storage key are
 * untouched, so no value can ever be lost to a rename.
 */

/** The §36 categories, in the order the Add-field menu renders them. */
export const FIELD_CATEGORIES = Object.freeze([
  { id: 'bibliographic', label: 'Bibliographic' },
  { id: 'study', label: 'Study characteristics' },
  { id: 'population', label: 'Population' },
  { id: 'intervention', label: 'Intervention' },
  { id: 'comparator', label: 'Comparator' },
  { id: 'outcome', label: 'Outcome metadata' },
  { id: 'numerical', label: 'Numerical data' },
  { id: 'methodological', label: 'Methodological' },
]);

export const FIELD_CATEGORY_IDS = Object.freeze(FIELD_CATEGORIES.map((c) => c.id));

export const FIELD_CATEGORY_LABEL = Object.freeze(
  FIELD_CATEGORIES.reduce((m, c) => { m[c.id] = c.label; return m; }, {}),
);

/** True for a known category id. Unknown categories normalize to 'study'. */
export function isFieldCategory(id) {
  return FIELD_CATEGORY_IDS.includes(String(id || ''));
}

/** The default category an unrecognised value falls back to. */
export const DEFAULT_FIELD_CATEGORY = 'study';

/**
 * The §37 data types. `text` is the fallback for anything unrecognised — a stored
 * definition from a newer build must degrade to an editable text box, never vanish.
 */
export const FIELD_DATA_TYPES = Object.freeze([
  'text', 'longtext', 'integer', 'decimal', 'percentage', 'date',
  'boolean', 'categorical', 'multiselect', 'duration',
]);

export const FIELD_DATA_TYPE_LABEL = Object.freeze({
  text: 'Text',
  longtext: 'Long text',
  integer: 'Integer',
  decimal: 'Decimal',
  percentage: 'Percentage',
  date: 'Date',
  boolean: 'Yes / No',
  categorical: 'Categorical (one of)',
  multiselect: 'Multi-select',
  duration: 'Time duration',
});

/** True for a known data type. */
export function isFieldDataType(t) {
  return FIELD_DATA_TYPES.includes(String(t || ''));
}

export const DEFAULT_FIELD_DATA_TYPE = 'text';

/** The types whose value is a number (used to pick the input mode / alignment). */
export const NUMERIC_DATA_TYPES = Object.freeze(['integer', 'decimal', 'percentage']);

/** The types that carry an option list. */
export const OPTION_DATA_TYPES = Object.freeze(['categorical', 'multiselect']);

/* ════════════════════════ the catalog ════════════════════════ */

const E = (o) => Object.freeze(o);

/**
 * EXTRACTION_FIELD_CATALOG — every entry is
 *   { catalogId, label, category, dataType, unit?, options?, description?,
 *     mapsTo?, managed?, contribution? }
 *
 * `mapsTo`   an EXISTING mkStudy row key — the value is read/written there (alias).
 * `managed`  the field is owned+rendered by the effect measure / another engine, so it
 *            is not addable to the project schema (it is already always present).
 * `contribution:false` the contributions table already prints it as a default column.
 */
export const EXTRACTION_FIELD_CATALOG = Object.freeze([
  /* ── Bibliographic ──────────────────────────────────────────────────────── */
  E({ catalogId: 'year', label: 'Year', category: 'bibliographic', dataType: 'integer', mapsTo: 'year', description: 'Publication year — the existing citation field. "Publication year" is the same field under another name.' }),
  E({ catalogId: 'pubDate', label: 'Publication date', category: 'bibliographic', dataType: 'date', description: 'Full publication / online-first date, when the year alone is not precise enough.' }),
  E({ catalogId: 'journal', label: 'Journal', category: 'bibliographic', dataType: 'text', mapsTo: 'journal' }),
  E({ catalogId: 'country', label: 'Country', category: 'bibliographic', dataType: 'text', mapsTo: 'country', description: 'Country / region the study was conducted in.' }),
  E({ catalogId: 'doi', label: 'DOI', category: 'bibliographic', dataType: 'text', mapsTo: 'doi' }),
  E({ catalogId: 'pmid', label: 'PMID', category: 'bibliographic', dataType: 'text', mapsTo: 'pmid' }),
  E({ catalogId: 'title', label: 'Full title', category: 'bibliographic', dataType: 'text', mapsTo: 'title' }),
  E({ catalogId: 'authors', label: 'Authors', category: 'bibliographic', dataType: 'text', mapsTo: 'authors' }),
  E({ catalogId: 'trialRegistration', label: 'Trial registration', category: 'bibliographic', dataType: 'text', description: 'e.g. NCT01234567, ISRCTN…' }),
  E({ catalogId: 'funding', label: 'Funding source', category: 'bibliographic', dataType: 'text', mapsTo: 'funding', description: 'The existing "Funding / Conflicts" field.' }),
  E({ catalogId: 'conflictOfInterest', label: 'Conflict of interest', category: 'bibliographic', dataType: 'longtext', description: 'Declared conflicts, when they are recorded separately from the funding source.' }),
  E({ catalogId: 'correspondingAuthor', label: 'Corresponding author', category: 'bibliographic', dataType: 'text' }),

  /* ── Study characteristics ──────────────────────────────────────────────── */
  E({ catalogId: 'design', label: 'Study design', category: 'study', dataType: 'text', mapsTo: 'design' }),
  E({ catalogId: 'prospectivity', label: 'Prospective / retrospective', category: 'study', dataType: 'categorical', options: ['Prospective', 'Retrospective', 'Ambidirectional', 'Not reported'] }),
  E({ catalogId: 'centres', label: 'Number of centers', category: 'study', dataType: 'integer' }),
  E({ catalogId: 'centreType', label: 'Single-center / multicenter', category: 'study', dataType: 'categorical', options: ['Single-center', 'Multicenter', 'Not reported'] }),
  E({ catalogId: 'enrollPeriod', label: 'Recruitment period', category: 'study', dataType: 'text', mapsTo: 'enrollPeriod', description: 'The existing "Enrollment period" field (e.g. 2015–2018).' }),
  E({ catalogId: 'followup', label: 'Follow-up duration', category: 'study', dataType: 'duration', mapsTo: 'followup' }),
  E({ catalogId: 'setting', label: 'Setting', category: 'study', dataType: 'text', description: 'e.g. tertiary hospital, primary care, community.' }),
  E({ catalogId: 'region', label: 'Region', category: 'study', dataType: 'text', description: 'Continent / WHO region, when country alone is too fine-grained.' }),
  E({ catalogId: 'n', label: 'Sample size', category: 'study', dataType: 'integer', mapsTo: 'n', managed: true, contribution: false, description: 'The row\'s Total N — already on every extraction form and in the contributions table.' }),
  E({ catalogId: 'randomizationMethod', label: 'Randomization method', category: 'study', dataType: 'text' }),
  E({ catalogId: 'blinding', label: 'Blinding', category: 'study', dataType: 'categorical', options: ['Open label', 'Single blind', 'Double blind', 'Triple blind', 'Not reported'] }),
  E({ catalogId: 'allocationConcealment', label: 'Allocation concealment', category: 'study', dataType: 'categorical', options: ['Adequate', 'Inadequate', 'Unclear', 'Not reported'] }),
  E({ catalogId: 'dataSource', label: 'Data source', category: 'study', dataType: 'text', mapsTo: 'dataSource', description: 'e.g. trial, registry, claims database.' }),

  /* ── Population ─────────────────────────────────────────────────────────── */
  E({ catalogId: 'meanAge', label: 'Mean age', category: 'population', dataType: 'decimal', unit: 'years' }),
  E({ catalogId: 'medianAge', label: 'Median age', category: 'population', dataType: 'decimal', unit: 'years' }),
  E({ catalogId: 'ageRange', label: 'Age range', category: 'population', dataType: 'text', unit: 'years' }),
  E({ catalogId: 'sexDistribution', label: 'Sex distribution', category: 'population', dataType: 'text', description: 'e.g. 54% female, or n male / n female.' }),
  E({ catalogId: 'baselineCharacteristics', label: 'Baseline characteristics', category: 'population', dataType: 'longtext' }),
  E({ catalogId: 'diseaseDefinition', label: 'Disease definition', category: 'population', dataType: 'longtext' }),
  E({ catalogId: 'diseaseSeverity', label: 'Disease severity', category: 'population', dataType: 'text' }),
  E({ catalogId: 'inclusionCriteria', label: 'Inclusion criteria', category: 'population', dataType: 'longtext' }),
  E({ catalogId: 'exclusionCriteria', label: 'Exclusion criteria', category: 'population', dataType: 'longtext' }),
  E({ catalogId: 'comorbidities', label: 'Comorbidities', category: 'population', dataType: 'text' }),
  E({ catalogId: 'baselineRisk', label: 'Baseline risk', category: 'population', dataType: 'percentage', description: 'Control-arm / background event rate.' }),
  E({ catalogId: 'populationDef', label: 'Population description', category: 'population', dataType: 'longtext', mapsTo: 'populationDef', description: 'The existing "Population definition" field.' }),

  /* ── Intervention ───────────────────────────────────────────────────────── */
  E({ catalogId: 'interventionDef', label: 'Intervention name', category: 'intervention', dataType: 'longtext', mapsTo: 'interventionDef', description: 'The existing "Intervention / Exposure" field.' }),
  E({ catalogId: 'dose', label: 'Dose', category: 'intervention', dataType: 'text' }),
  E({ catalogId: 'route', label: 'Route', category: 'intervention', dataType: 'text' }),
  E({ catalogId: 'frequency', label: 'Frequency', category: 'intervention', dataType: 'text' }),
  E({ catalogId: 'interventionDuration', label: 'Duration', category: 'intervention', dataType: 'duration' }),
  E({ catalogId: 'technique', label: 'Technique', category: 'intervention', dataType: 'text' }),
  E({ catalogId: 'device', label: 'Device', category: 'intervention', dataType: 'text' }),
  E({ catalogId: 'coIntervention', label: 'Co-intervention', category: 'intervention', dataType: 'text' }),

  /* ── Comparator ─────────────────────────────────────────────────────────── */
  E({ catalogId: 'comparatorDef', label: 'Comparator name', category: 'comparator', dataType: 'longtext', mapsTo: 'comparatorDef', description: 'The existing "Comparator / Control" field.' }),
  E({ catalogId: 'comparatorDose', label: 'Comparator dose', category: 'comparator', dataType: 'text' }),
  E({ catalogId: 'comparatorDetails', label: 'Comparator details', category: 'comparator', dataType: 'longtext' }),
  E({ catalogId: 'standardOfCare', label: 'Standard of care', category: 'comparator', dataType: 'text' }),
  E({ catalogId: 'placeboInfo', label: 'Placebo information', category: 'comparator', dataType: 'text' }),

  /* ── Outcome metadata ───────────────────────────────────────────────────── */
  E({ catalogId: 'outcome', label: 'Outcome name', category: 'outcome', dataType: 'text', mapsTo: 'outcome', managed: true, description: 'The row\'s outcome — it defines the analysis pair, so it is edited on the form itself (and renamed project-wide).' }),
  E({ catalogId: 'outcomeDefinition', label: 'Outcome definition', category: 'outcome', dataType: 'longtext' }),
  E({ catalogId: 'timepoint', label: 'Time point', category: 'outcome', dataType: 'text', mapsTo: 'timepoint', managed: true, description: 'The row\'s time point — it defines the analysis pair, so it is edited on the form itself.' }),
  E({ catalogId: 'measurementInstrument', label: 'Measurement instrument', category: 'outcome', dataType: 'text' }),
  E({ catalogId: 'outcomeUnit', label: 'Unit', category: 'outcome', dataType: 'text' }),
  E({ catalogId: 'outcomeDirection', label: 'Direction', category: 'outcome', dataType: 'categorical', options: ['Higher is better', 'Lower is better', 'Not applicable'] }),
  E({ catalogId: 'primaryOutcome', label: 'Primary outcome (as stated)', category: 'outcome', dataType: 'text', mapsTo: 'primaryOutcome' }),
  E({ catalogId: 'secondaryOutcomes', label: 'Secondary outcomes (as stated)', category: 'outcome', dataType: 'text', mapsTo: 'secondaryOutcomes' }),
  E({ catalogId: 'dataNature', label: 'Estimate role (primary / secondary / post-hoc)', category: 'outcome', dataType: 'text', mapsTo: 'dataNature', managed: true, description: 'The existing "Data role" select — primary, secondary, subgroup, post-hoc or sensitivity.' }),
  E({ catalogId: 'analysisPopulation', label: 'Analysis population', category: 'outcome', dataType: 'categorical', options: ['Intention-to-treat', 'Modified ITT', 'Per-protocol', 'As-treated', 'Complete case', 'Not reported'] }),
  E({ catalogId: 'denominatorPopulation', label: 'Denominator population', category: 'outcome', dataType: 'text', mapsTo: 'denominatorPopulation', managed: true, description: '107.md per-estimate proportion metadata — set on the proportion form, available here as an analysis column.' }),
  E({ catalogId: 'actionStatus', label: 'Action status', category: 'outcome', dataType: 'text', mapsTo: 'actionStatus', managed: true, description: '107.md per-estimate proportion metadata — set on the proportion form, available here as an analysis column.' }),

  /* ── Numerical data (owned by the effect measure) ───────────────────────── */
  E({ catalogId: 'events', label: 'Events', category: 'numerical', dataType: 'integer', mapsTo: 'events', managed: true, description: 'Single-arm numerator — entered on the proportion form.' }),
  E({ catalogId: 'total', label: 'Total', category: 'numerical', dataType: 'integer', mapsTo: 'total', managed: true, description: 'Single-arm denominator — entered on the proportion form.' }),
  E({ catalogId: 'meanExp', label: 'Mean (intervention)', category: 'numerical', dataType: 'decimal', mapsTo: 'meanExp', managed: true }),
  E({ catalogId: 'sdExp', label: 'SD (intervention)', category: 'numerical', dataType: 'decimal', mapsTo: 'sdExp', managed: true }),
  E({ catalogId: 'seExp', label: 'SE (intervention)', category: 'numerical', dataType: 'decimal', mapsTo: 'seExp', managed: true }),
  E({ catalogId: 'medianExp', label: 'Median (intervention)', category: 'numerical', dataType: 'decimal', mapsTo: 'medianExp', managed: true }),
  E({ catalogId: 'es', label: 'Effect estimate', category: 'numerical', dataType: 'decimal', mapsTo: 'es', managed: true, contribution: false }),
  E({ catalogId: 'lo', label: 'CI lower', category: 'numerical', dataType: 'decimal', mapsTo: 'lo', managed: true, contribution: false }),
  E({ catalogId: 'hi', label: 'CI upper', category: 'numerical', dataType: 'decimal', mapsTo: 'hi', managed: true, contribution: false }),
  E({ catalogId: 'personTime', label: 'Person-time', category: 'numerical', dataType: 'decimal', unit: 'person-years' }),
  E({ catalogId: 'rate', label: 'Rate', category: 'numerical', dataType: 'decimal', description: 'Reported incidence / event rate, when the paper gives one directly.' }),
  E({ catalogId: 'exposureTime', label: 'Exposure time', category: 'numerical', dataType: 'duration' }),

  /* ── Methodological ─────────────────────────────────────────────────────── */
  E({ catalogId: 'adjusted', label: 'Adjusted / unadjusted', category: 'methodological', dataType: 'text', mapsTo: 'adjusted', managed: true, description: 'The existing "Adjustment" select.' }),
  E({ catalogId: 'covariates', label: 'Covariates', category: 'methodological', dataType: 'longtext' }),
  E({ catalogId: 'statisticalModel', label: 'Statistical model', category: 'methodological', dataType: 'text' }),
  E({ catalogId: 'missingDataMethod', label: 'Missing data method', category: 'methodological', dataType: 'text' }),
  E({ catalogId: 'intentionToTreat', label: 'Intention-to-treat', category: 'methodological', dataType: 'boolean' }),
  E({ catalogId: 'perProtocol', label: 'Per-protocol', category: 'methodological', dataType: 'boolean' }),
  E({ catalogId: 'source', label: 'Data location in paper', category: 'methodological', dataType: 'text', mapsTo: 'source', managed: true, description: 'The existing "Data source" select — text, table, figure, supplement…' }),
  E({ catalogId: 'notes', label: 'Extraction notes', category: 'methodological', dataType: 'longtext', mapsTo: 'notes', managed: true }),
]);

const BY_ID = new Map(EXTRACTION_FIELD_CATALOG.map((e) => [e.catalogId, e]));

/** One catalog entry by its stable id, or null. Pure. */
export function catalogEntry(catalogId) {
  return BY_ID.get(String(catalogId || '')) || null;
}

/** True when `catalogId` names a catalog entry. */
export function isCatalogId(catalogId) {
  return BY_ID.has(String(catalogId || ''));
}

/**
 * The entries a reviewer may ADD to the project schema (§35). `managed` entries are
 * excluded: the effect measure (or the proportion form) already owns and renders them,
 * and a second free-floating copy would be a divergent source of truth.
 */
export const ADDABLE_CATALOG = Object.freeze(EXTRACTION_FIELD_CATALOG.filter((e) => !e.managed));

/** The entries the Individual Study Contributions menu may offer straight off the row
 *  (§53): they alias an EXISTING key, so every row honestly has the value or has none.
 *  `contribution:false` excludes the ones the default table already prints. */
export const ROW_CONTRIBUTION_CATALOG = Object.freeze(
  EXTRACTION_FIELD_CATALOG.filter((e) => e.mapsTo && e.contribution !== false),
);

/**
 * catalogByCategory(entries) — [{ id, label, entries[] }] in §36 order, empty groups
 * dropped. Defaults to the addable set (what the Add-field menu browses). Pure.
 */
export function catalogByCategory(entries = ADDABLE_CATALOG) {
  const list = Array.isArray(entries) ? entries : [];
  return FIELD_CATEGORIES
    .map((c) => ({ id: c.id, label: c.label, entries: list.filter((e) => e && e.category === c.id) }))
    .filter((g) => g.entries.length > 0);
}

/**
 * searchCatalog(query, entries) — case-insensitive substring match over label,
 * description and category label. An empty query returns the whole list. Pure.
 */
export function searchCatalog(query, entries = ADDABLE_CATALOG) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const list = Array.isArray(entries) ? entries : [];
  if (!q) return list.slice();
  return list.filter((e) => {
    if (!e) return false;
    const hay = `${e.label || ''} ${e.description || ''} ${FIELD_CATEGORY_LABEL[e.category] || ''}`.toLowerCase();
    return hay.includes(q);
  });
}
