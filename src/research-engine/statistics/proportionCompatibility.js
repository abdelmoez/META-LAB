/**
 * statistics/proportionCompatibility.js — 107.md §11 (pre-analysis compatibility check)
 * and §12 (resolution paths + the documented override).
 *
 * Single-arm proportions only look interchangeable. `23 P/LP diagnoses / 59 tested` and
 * `17 management changes / 23 diagnosed` are both "a proportion", but they estimate
 * different quantities, so pooling them produces a number that means nothing. The two
 * per-estimate classifications 107.md §8 added (`denominatorPopulation`, `actionStatus`,
 * plus the free-text `denominatorCustom`) make that detectable — this module is the
 * detector, and the one place the rule lives.
 *
 * ── The legacy contract, restated (107.md §8C/§12) ────────────────────────────────
 * A missing / '' / unknown classification means "not classified (legacy)". It is NOT a
 * category, and in particular it is NOT `actionStatus:'unclear'` (which is a positive
 * finding: the ARTICLE says the status is unclear). So:
 *   • real category + real category            → BLOCKING (different quantities)
 *   • real category + unclassified rows        → BLOCKING (we cannot know they agree),
 *                                                with the unclassified rows reported on
 *                                                their OWN line, never folded into one
 *   • every row unclassified                   → NOT blocking, one informational note.
 *     This is the 107.md §21 regression guard: a project extracted before this feature
 *     must keep pooling exactly as it did, with an honest note instead of a wall.
 *
 * PURE — no React, no IO, no Date/Math.random. The override timestamp is passed IN
 * (`ctx.at`) so the React caller can seed it at the event-handler call site, outside the
 * state updater (StrictMode double-invokes and CAS retries re-run mutators).
 */

import {
  DENOMINATOR_POPULATIONS, ACTION_STATUSES,
  DENOMINATOR_POPULATION_LABEL, ACTION_STATUS_LABEL,
} from '../project-model/monolithConstants.js';
import {
  effectiveDenominatorPopulation, effectiveActionStatus, denominatorCustomText, UNCLASSIFIED,
  isDenominatorPopulationKey, isActionStatusKey, exportedDenominatorCustom,
} from '../extraction/proportionMeta.js';
// 116.md §41/§46 — the derive-at-analysis-boundary view. `isPoolableRow` below must stay
// equivalent to runMeta's own row selection, and runMeta now pools derived views of
// raw-data PROP rows, so the predicate here is applied to the SAME view.
import { poolableStudyView } from './monolithStats.js';

/** How the unclassified/legacy state is named EVERYWHERE it is user-visible. */
export const UNCLASSIFIED_GROUP_LABEL = 'Not classified (legacy)';

/** Sentinel a persisted filter uses to mean "only the unclassified estimates". */
export const UNCLASSIFIED_FILTER = '__unclassified__';

/** The note shown when a whole outcome predates the classification (§21 guard). */
export const ALL_UNCLASSIFIED_NOTE =
  'These estimates predate denominator/action classification — they are pooled as before. '
  + 'Classify them in Data Extraction to let this check verify they estimate the same quantity.';

/** Fields a persisted proportion filter may key on (denominatorCustom is free text but
 *  filterable — it is never a grouping variable or a meta-regression covariate). */
export const PROPORTION_FILTER_FIELDS = Object.freeze([
  'denominatorPopulation', 'actionStatus', 'denominatorCustom',
]);

/** Fields the compatibility check inspects for CATEGORY conflicts. */
export const PROPORTION_CATEGORY_FIELDS = Object.freeze(['denominatorPopulation', 'actionStatus']);

export const PROPORTION_FIELD_LABEL = Object.freeze({
  denominatorPopulation: 'Denominator population',
  actionStatus: 'Action status',
  denominatorCustom: 'Custom denominator definition',
});

const ENUM_ORDER = {
  denominatorPopulation: DENOMINATOR_POPULATIONS.map(([k]) => k),
  actionStatus: ACTION_STATUSES.map(([k]) => k),
};
const ENUM_LABEL = {
  denominatorPopulation: DENOMINATOR_POPULATION_LABEL,
  actionStatus: ACTION_STATUS_LABEL,
};
/** Registry MEMBERSHIP, never `map[v]` truthiness — the label maps are plain
 *  `Object.fromEntries` objects, so `map['constructor']` returns a Function off the
 *  prototype and would be rendered as the category's name (107.md §8E review fix). */
const ENUM_HAS = {
  denominatorPopulation: isDenominatorPopulationKey,
  actionStatus: isActionStatusKey,
};
/** The label for a stored enum value, or '' when the value is not in the registry. */
function enumLabel(field, value) {
  const has = ENUM_HAS[field];
  return has && has(value) ? ENUM_LABEL[field][value] : '';
}

const raw = (v) => (v == null ? '' : String(v).trim());
/** Free-text comparison key: whitespace-collapsed + case-folded, so "All tested" and
 *  "all  tested" are ONE definition while genuinely different wordings stay distinct. */
const normText = (v) => raw(v).replace(/\s+/g, ' ').toLowerCase();

/** A single-arm proportion row. Everything here applies to PROP estimates only. */
export function isProportionRow(study) {
  return !!study && String(study.esType || '').trim().toUpperCase() === 'PROP';
}

/**
 * 107.md §11 — the check must describe the estimates that are ACTUALLY pooled, not every
 * row that happens to carry an effect size. `runMeta` (monolithStats.js:31) drops any row
 * without a numeric es + lo + hi, so a row with a blank CI is neither in the diamond nor
 * a reason to block it — and it must not enter the override signature either, or filling
 * that CI in later would grow the pool without invalidating the recorded consent.
 * The predicate below is `runMeta`'s, verbatim, so the two can never drift.
 */
export function isPoolableRow(study) {
  if (!study) return false;
  // 116.md §41 — runMeta pools `poolableStudyView(row)`, so the predicate inspects the
  // same view: a raw-data PROP row (valid events/total, no stored es) is poolable, and
  // its metadata therefore enters both the compatibility check and the override
  // signature — the gate signature and the pooled set can never drift.
  const s = poolableStudyView(study);
  return s.es !== '' && s.lo !== '' && s.hi !== ''
    && !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi);
}

/** The poolable subset. Byte stability: the SAME array back when nothing is dropped. */
export function poolableRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return Array.isArray(rows) ? rows : [];
  const out = rows.filter(isPoolableRow);
  return out.length === rows.length ? rows : out;
}

/** "Smith 2024" — how an affected estimate is named on the warning card. */
export function studyLabel(study) {
  const a = raw(study && study.author) || 'Study';
  const y = raw(study && study.year);
  return y ? `${a} ${y}` : a;
}

/** The persisted-filter key for an (outcome, timepoint) pair — the SAME `outcome|||timepoint`
 *  string AnalysisTab/ForestTab already use for a pair, so the two never drift. */
export function proportionFilterKey(outcome, timepoint) {
  return `${raw(outcome)}|||${raw(timepoint)}`;
}

/**
 * The row's value for one classifiable field, self-healed through the §8 readers.
 * denominatorCustom answers its comparison key (normalised text), not the display text.
 * @returns {string} '' when not classified
 */
export function effectiveProportionValue(study, field) {
  if (field === 'denominatorPopulation') return effectiveDenominatorPopulation(study);
  if (field === 'actionStatus') return effectiveActionStatus(study);
  // 107.md r2 — stale custom text on a row whose population is no longer 'other' must not
  // answer a denominatorCustom filter; only rows effectively classified 'other' carry one.
  if (field === 'denominatorCustom') return normText(exportedDenominatorCustom(study));
  return UNCLASSIFIED;
}

/** Human label for a stored value of `field`; the unclassified state is named honestly. */
export function proportionValueLabel(field, value) {
  const v = raw(value);
  if (field === 'denominatorCustom') return v || UNCLASSIFIED_GROUP_LABEL;
  if (!ENUM_LABEL[field]) return v || UNCLASSIFIED_GROUP_LABEL;
  return enumLabel(field, v) || UNCLASSIFIED_GROUP_LABEL;
}

/**
 * Display name for a subgroup bucket keyed on one of the new fields. Used to NORMALISE
 * rows before `subgroupAnalysis` buckets them, so a hand-edited/forward-version value
 * cannot open a third bucket that looks like a real category. 'unclear' and
 * "Not classified (legacy)" are different strings by construction — never merged.
 */
export function subgroupGroupLabel(field, value) {
  const v = raw(value);
  if (field === 'denominatorPopulation' || field === 'actionStatus') {
    return enumLabel(field, v) || UNCLASSIFIED_GROUP_LABEL;
  }
  return v || 'Unspecified';
}

/** The [field, value] pairs of a per-pair filter map, in a deterministic field order. */
export function activeProportionFilters(filterMap) {
  if (!filterMap || typeof filterMap !== 'object') return [];
  return PROPORTION_FILTER_FIELDS
    .filter((f) => raw(filterMap[f]) !== '')
    .map((f) => [f, String(filterMap[f])]);
}

/**
 * Apply a per-pair filter map to the rows entering an analysis.
 *
 * Byte stability: returns the SAME array reference when no filter is set or nothing is
 * removed, so a legacy project's memo chain (and every downstream `useMemo`) is
 * unchanged — the 107.md §21 regression guard at the React level.
 */
export function applyProportionFilters(rows, filterMap) {
  if (!Array.isArray(rows) || !rows.length) return Array.isArray(rows) ? rows : [];
  const entries = activeProportionFilters(filterMap);
  if (!entries.length) return rows;
  const out = rows.filter((r) => entries.every(([field, want]) => {
    const have = effectiveProportionValue(r, field);
    if (want === UNCLASSIFIED_FILTER) return have === UNCLASSIFIED;
    return have === (field === 'denominatorCustom' ? normText(want) : want);
  }));
  return out.length === rows.length ? rows : out;
}

/* ── the check ─────────────────────────────────────────────────────────────────── */

/** Stable per-row identity for the override signature: the row id when it has one,
 *  otherwise its display label — never the array index, which reordering would change. */
function rowIdentity(study) {
  return raw(study && study.id) || studyLabel(study);
}

function tally(rows, field) {
  const buckets = new Map();
  rows.forEach((s) => {
    const v = effectiveProportionValue(s, field);
    let b = buckets.get(v);
    if (!b) { b = { value: v, count: 0, studies: [], ids: [], seen: new Set(), display: '' }; buckets.set(v, b); }
    b.count += 1;
    b.ids.push(rowIdentity(s));
    if (!b.display && field === 'denominatorCustom') b.display = denominatorCustomText(s);
    const lab = studyLabel(s);
    if (!b.seen.has(lab)) { b.seen.add(lab); b.studies.push(lab); }
  });
  return buckets;
}

function lineFor(field, bucket) {
  return {
    value: bucket.value,
    label: field === 'denominatorCustom'
      ? (bucket.display || UNCLASSIFIED_GROUP_LABEL)
      : proportionValueLabel(field, bucket.value),
    count: bucket.count,
    studies: bucket.studies,
    // Sorted so the signature does not depend on studies[] order (a drag-reorder is
    // not a change of estimate set); never rendered — it exists for the signature.
    ids: bucket.ids.slice().sort(),
  };
}

/**
 * checkProportionCompatibility(rows) — 107.md §11. Inspect the estimates SELECTED for a
 * pooled proportion analysis (already outcome-scoped, exclusions applied, and with any
 * persisted filter already applied) and report what would be silently combined.
 *
 * Only the POOLABLE rows are inspected (`isPoolableRow` = runMeta's own predicate): a row
 * with an effect size but no 95% CI is not in the diamond, so it can neither create a
 * conflict nor be counted in the override signature.
 *
 * ── 116.md §41/§49 — the two-tier outcome ─────────────────────────────────────────
 * 107.md shipped every conflict as BLOCKING, including the NORMAL mid-classification
 * state: the moment the first row of an outcome was classified, `category-and-
 * unclassified` blocked Analysis, Forest, Sensitivity and the summary table at once
 * ("a metadata safeguard must not make Analysis show nothing", 116.md §49). Softened:
 *   • ≥2 REAL categories (or ≥2 different custom definitions) → still BLOCKING,
 *     resolved only by the persisted filter/override flow (107.md §12 semantics);
 *   • ONE real category + unclassified rows → a WARNING: pooling proceeds, with a
 *     visible advisory naming the unclassified count. The unclassified rows are still
 *     reported on their OWN line and are never merged into a category.
 *
 * @param {Array<object>} rows  studies[] rows for one outcome pair
 * @returns {{applicable:boolean, blocking:boolean, warning:boolean, infoOnly:boolean,
 *            issues:Array<{field:string,fieldLabel:string,kind:string,
 *                          values:Array<{value:string,label:string,count:number,studies:string[],ids:string[]}>,
 *                          unclassifiedCount:number,totalAffected:number}>,
 *            warnings:Array<same shape as issues>,
 *            unclassifiedFields:string[], propCount:number}}
 */
export function checkProportionCompatibility(rows) {
  const list = Array.isArray(rows) ? rows.filter((s) => isProportionRow(s) && isPoolableRow(s)) : [];
  // Nothing is pooled below two estimates, so there is nothing to warn about.
  if (list.length < 2) {
    return { applicable: false, blocking: false, warning: false, infoOnly: false, issues: [], warnings: [], unclassifiedFields: [], propCount: list.length };
  }

  const issues = [];
  const warnings = [];
  const unclassifiedFields = [];

  for (const field of PROPORTION_CATEGORY_FIELDS) {
    const buckets = tally(list, field);
    const realKeys = ENUM_ORDER[field].filter((k) => buckets.has(k));
    const unclassified = buckets.get(UNCLASSIFIED);
    const unclassifiedCount = unclassified ? unclassified.count : 0;

    if (!realKeys.length) { unclassifiedFields.push(field); continue; }   // §21 legacy pass-through
    if (realKeys.length === 1 && unclassifiedCount === 0) continue;       // homogeneous — fine

    const values = realKeys.map((k) => lineFor(field, buckets.get(k)));
    // The legacy rows are ALWAYS their own line, last, and never merged into a category.
    if (unclassified) values.push(lineFor(field, unclassified));
    const entry = {
      field,
      fieldLabel: PROPORTION_FIELD_LABEL[field],
      kind: realKeys.length >= 2 ? 'mixed-categories' : 'category-and-unclassified',
      values,
      unclassifiedCount,
      totalAffected: list.length,
    };
    // 116.md §49 — one real category + unclassified rows is the mid-classification
    // state: WARN (pool proceeds), never block. Two real categories still block.
    if (realKeys.length >= 2) issues.push(entry); else warnings.push(entry);
  }

  // 107.md §11 — "custom denominator definitions that may differ". Two estimates whose
  // denominator is 'Other/custom' only agree if the free text says the same thing.
  const others = list.filter((s) => effectiveDenominatorPopulation(s) === 'other');
  if (others.length >= 2) {
    const buckets = tally(others, 'denominatorCustom');
    if (buckets.size >= 2) {
      const values = [...buckets.values()]
        .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
        .map((b) => lineFor('denominatorCustom', b));
      const realTexts = [...buckets.keys()].filter((k) => k !== UNCLASSIFIED);
      const entry = {
        field: 'denominatorCustom',
        fieldLabel: PROPORTION_FIELD_LABEL.denominatorCustom,
        kind: realTexts.length >= 2 ? 'mixed-custom-definitions' : 'category-and-unclassified',
        values,
        unclassifiedCount: buckets.has(UNCLASSIFIED) ? buckets.get(UNCLASSIFIED).count : 0,
        totalAffected: others.length,
      };
      // 116.md §49 — same two-tier rule: two DIFFERENT descriptions block; one
      // description + undescribed rows is the mid-classification state and warns.
      if (realTexts.length >= 2) issues.push(entry); else warnings.push(entry);
    }
  }

  const blocking = issues.length > 0;
  return {
    applicable: true,
    blocking,
    warning: warnings.length > 0,
    infoOnly: !blocking && !warnings.length && unclassifiedFields.length > 0,
    issues,
    warnings,
    unclassifiedFields,
    propCount: list.length,
  };
}

/* ── the documented override (107.md §12) ──────────────────────────────────────── */

/**
 * Signature format marker. `v1` was `field:value=count[,…][;…]` — counts ONLY, which two
 * offsetting metadata edits (A→X while B→Y) left byte-identical, and which a row entering
 * the pool (its CI finally typed in) could also leave unchanged. `v2` additionally
 * fingerprints WHICH rows are in each bucket, so membership changes are visible.
 * A stored `v1` signature can never be re-derived, so it reads as STALE — the safe
 * direction: the reviewer is asked to re-confirm rather than silently kept unblocked.
 */
const SIGNATURE_VERSION = 'v2';

/** djb2 over the sorted member ids — short, deterministic, and locale-free. */
function idDigest(ids) {
  const s = (Array.isArray(ids) ? ids.slice().sort() : []).join('');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * A stable fingerprint of WHAT was overridden: every conflicting field, its value keys,
 * their estimate counts AND a digest of the contributing row ids. If the estimate set
 * later changes (a study added, a value corrected, two values swapped, a blank CI filled
 * in, a filter applied) the signature stops matching and the override is stale — an
 * override is consent to pool a SPECIFIC set of conflicting estimates, not a blanket
 * permission for whatever the analysis becomes later.
 */
export function proportionIssueSignature(check) {
  const issues = (check && check.issues) || [];
  if (!issues.length) return '';
  const body = issues
    .map((i) => `${i.field}:${i.values
      .map((v) => `${v.value || UNCLASSIFIED_FILTER}=${v.count}#${idDigest(v.ids)}`).join(',')}`)
    .join(';');
  return `${SIGNATURE_VERSION}|${body}`;
}

/** True when a recorded override no longer describes the estimates on screen. */
export function proportionOverrideStale(override, check) {
  if (!override) return false;
  const stored = String(override.signature || '');
  // A pre-v2 (count-only) signature cannot identify its members — treat it as stale
  // rather than honour a fingerprint that offsetting edits could have survived.
  if (stored && stored.indexOf(`${SIGNATURE_VERSION}|`) !== 0) return true;
  return stored !== proportionIssueSignature(check);
}

/**
 * buildProportionOverride(check, ctx) — the record persisted to
 * `project.analysisSettings.proportionOverrides[outcomeKey]`. PURE: `ctx.at` (ISO string)
 * must be produced by the caller at the click handler, never inside a state updater.
 */
export function buildProportionOverride(check, ctx = {}) {
  const issues = (check && check.issues) || [];
  const note = raw(ctx.note);
  return {
    fields: issues.map((i) => i.field),
    categories: issues.reduce((acc, i) => acc.concat(
      i.values.map((v) => ({ field: i.field, value: v.value, label: v.label, count: v.count })),
    ), []),
    signature: proportionIssueSignature(check),
    at: raw(ctx.at) || null,
    by: raw(ctx.by) || null,
    note: note || null,
  };
}

/** "Denominator population: All patients tested (8), Not classified (legacy) (2)" — the
 *  one phrasing used by the banner, the CSV metadata line and the repro manifest. */
export function describeOverrideCategories(override) {
  const cats = (override && override.categories) || [];
  if (!cats.length) return '';
  const byField = [];
  cats.forEach((c) => {
    let entry = byField.find((e) => e.field === c.field);
    if (!entry) { entry = { field: c.field, parts: [] }; byField.push(entry); }
    entry.parts.push(`${c.label} (${c.count})`);
  });
  return byField
    .map((e) => `${PROPORTION_FIELD_LABEL[e.field] || e.field}: ${e.parts.join(', ')}`)
    .join(' · ');
}

/** Date portion of the override timestamp — locale-free so exports stay deterministic. */
export function overrideDateText(at) {
  const s = raw(at);
  return s ? s.slice(0, 10) : '';
}

/** How one active filter reads to a human: chip text, CSV value, subgroup badge. */
export function proportionFilterLabel(field, value) {
  if (value === UNCLASSIFIED_FILTER) return UNCLASSIFIED_GROUP_LABEL;
  return field === 'denominatorCustom' ? raw(value) : proportionValueLabel(field, value);
}

/* ── 107.md §13 outputs ────────────────────────────────────────────────────────────
   Both builders return EMPTY when neither a filter nor an override is in force, which
   is what makes an untouched results export byte-identical to the pre-107 output —
   "Do not clutter unrelated outputs if these variables were not used." */

/** Which per-study classification columns the results export should carry. */
export function proportionExportFields(filters, override) {
  const out = [];
  activeProportionFilters(filters).forEach(([f]) => { if (out.indexOf(f) < 0) out.push(f); });
  ((override && override.fields) || []).forEach((f) => {
    if (PROPORTION_FILTER_FIELDS.indexOf(f) >= 0 && out.indexOf(f) < 0) out.push(f);
  });
  return out;
}

/** The [label, value] metadata lines describing how the estimate set was selected. */
export function proportionExportMetaRows(filters, override) {
  const rows = [];
  activeProportionFilters(filters).forEach(([f, v]) => {
    rows.push([`${PROPORTION_FIELD_LABEL[f] || f} filter`, proportionFilterLabel(f, v)]);
  });
  if (override) {
    const desc = [overrideDateText(override.at), describeOverrideCategories(override)].filter(Boolean).join(' — ');
    rows.push(['Compatibility override', desc]);
    if (override.by) rows.push(['Compatibility override recorded by', override.by]);
    if (override.note) rows.push(['Compatibility override rationale', override.note]);
  }
  return rows;
}

/* ── persistence hygiene (used by the repro/settings exports) ──────────────────── */

/**
 * Drop empty/unknown entries from a persisted filter map. Returns null when nothing is
 * configured, so callers can omit the key entirely and keep unused-feature output
 * byte-identical to before 107.md.
 */
export function sanitizeProportionFilters(map) {
  if (!map || typeof map !== 'object') return null;
  const out = {};
  Object.keys(map).sort().forEach((outcomeKey) => {
    const entries = activeProportionFilters(map[outcomeKey]);
    if (!entries.length) return;
    const inner = {};
    entries.forEach(([f, v]) => { inner[f] = v; });
    out[outcomeKey] = inner;
  });
  return Object.keys(out).length ? out : null;
}

/** Same idea for the override store: null when no override has been recorded. */
export function sanitizeProportionOverrides(map) {
  if (!map || typeof map !== 'object') return null;
  const out = {};
  Object.keys(map).sort().forEach((outcomeKey) => {
    const o = map[outcomeKey];
    if (!o || typeof o !== 'object' || !Array.isArray(o.categories)) return;
    out[outcomeKey] = {
      fields: Array.isArray(o.fields) ? o.fields.slice() : [],
      categories: o.categories.map((c) => ({
        field: raw(c && c.field), value: raw(c && c.value),
        label: raw(c && c.label), count: Number(c && c.count) || 0,
      })),
      signature: raw(o.signature),
      at: raw(o.at) || null,
      by: raw(o.by) || null,
      note: raw(o.note) || null,
    };
  });
  return Object.keys(out).length ? out : null;
}

export default {
  checkProportionCompatibility, applyProportionFilters, activeProportionFilters,
  isPoolableRow, poolableRows, isProportionRow,
  proportionFilterKey, proportionIssueSignature, proportionOverrideStale,
  buildProportionOverride, describeOverrideCategories, overrideDateText,
  proportionFilterLabel, proportionExportFields, proportionExportMetaRows,
  subgroupGroupLabel, proportionValueLabel, effectiveProportionValue,
  sanitizeProportionFilters, sanitizeProportionOverrides,
  UNCLASSIFIED_GROUP_LABEL, UNCLASSIFIED_FILTER, ALL_UNCLASSIFIED_NOTE,
  PROPORTION_FILTER_FIELDS, PROPORTION_CATEGORY_FIELDS, PROPORTION_FIELD_LABEL,
};
