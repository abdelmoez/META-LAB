/**
 * extraction/demographicsTable.js — 119.md §6, the TABLE view of the demographics data.
 *
 * demographics.js owns the cell (statistic types, the four empty states, slot keys) and
 * fieldRegistry.js owns the field definitions; this module is the one place that turns
 * BOTH into columns and rows. The manuscript's study-characteristics builder
 * (manuscript/tables.js) and the extraction preview render the SAME structure from here,
 * so "Table 1" cannot mean two different things in two engines (116 §10.3's gap).
 *
 * LEVELS STAY DISTINCT (§6). Every cell is read from the studies[] row it belongs to and
 * nothing is summed, averaged or fanned out: a publication-level value on a case-series
 * row is that row's value, an arm-level cell exists only where the reviewer recorded one,
 * and no path here touches PRISMA counting (which derives from records, not from this
 * table — 106.md's publication-vs-case contract).
 *
 * PURE. No DOM, no IO.
 */

import {
  activeExtractionFields, extractionFieldById, storageKeyOf, fieldDisplayLabel,
  isStatField, isArmLevelField, readFieldCell, writeFieldCellPatch, formatFieldCell,
} from './fieldRegistry.js';
import {
  demographicsArms, demographicsItems, projectDemographicsConfig,
} from './demographics.js';
import { catalogEntry, demographicsCatalogGroups, isDemographicsCatalogId } from './fieldCatalog.js';
import { isCaseRow } from './caseSeries.js';

const s = (v) => (v == null ? '' : String(v).trim());

/** The prefix every demographics column key carries — it can never collide with the
 *  study-characteristics builder's own keys ('study', 'country', 'design', …). */
export const DEMO_COLUMN_PREFIX = 'demo:';

/** The column key for one (field, arm) pair. Stable across label renames (§38). */
export function demoColumnKey(fieldId, armId = '') {
  const id = s(fieldId);
  if (!id) return '';
  const arm = s(armId);
  return arm ? `${DEMO_COLUMN_PREFIX}${id}:${arm}` : `${DEMO_COLUMN_PREFIX}${id}`;
}

/** { fieldId, armId } for a demographics column key, or null for any other key. */
export function parseDemoColumnKey(key) {
  const k = s(key);
  if (!k.startsWith(DEMO_COLUMN_PREFIX)) return null;
  const rest = k.slice(DEMO_COLUMN_PREFIX.length);
  if (!rest) return null;
  const at = rest.indexOf(':');
  return at < 0 ? { fieldId: rest, armId: '' } : { fieldId: rest.slice(0, at), armId: rest.slice(at + 1) };
}

/**
 * demographicsColumns(project) — the configured columns, in configured order.
 *
 * With NO saved table configuration the columns are simply the project's active
 * extraction fields: that is 116 §10.3's fix (the manuscript table used to ignore them
 * entirely) and it needs no setup. A saved configuration narrows and orders them, adds
 * group headings, per-row footnotes and ARM columns.
 *
 * Each column carries everything an editor needs to write the value back through the
 * extraction path: `fieldId`, `armId` and the resolved definition.
 */
export function demographicsColumns(project) {
  const fields = activeExtractionFields(project);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const cfg = projectDemographicsConfig(project);
  const items = demographicsItems(project);
  const arms = demographicsArms(project);
  const groupLabel = new Map((cfg.groups || []).map((g) => [g.id, g.label]));

  const chosen = items.length
    ? items.map((it) => ({ def: byId.get(it.fieldId), item: it })).filter((x) => x.def)
    : fields.map((def) => ({ def, item: { fieldId: def.id } }));

  const out = [];
  for (const { def, item } of chosen) {
    const base = {
      fieldId: def.id,
      def,
      label: fieldDisplayLabel(def),
      storageKey: storageKeyOf(def),
      ...(item.group && groupLabel.has(item.group) ? { group: item.group, groupLabel: groupLabel.get(item.group) } : {}),
      ...(item.note ? { note: item.note } : {}),
    };
    // §6 "Choose overall versus arm-level values" — with arms configured an arm-level
    // field offers BOTH: papers routinely report an overall age and a per-arm age, and
    // suppressing either would force the reviewer to throw one of them away. Empty
    // columns are dropped by the adaptive rule, so nothing appears that has no data.
    out.push({ ...base, key: demoColumnKey(def.id), armId: '' });
    if (arms.length && isArmLevelField(def)) {
      for (const arm of arms) {
        out.push({ ...base, key: demoColumnKey(def.id, arm.id), armId: arm.id, armLabel: arm.label, label: `${base.label} — ${arm.label}` });
      }
    }
  }
  return out;
}

/** The display text of one demographics column for one row (null ⇒ the missing state). */
export function demographicsCellValue(column, study) {
  if (!column || !column.def) return null;
  return formatFieldCell(column.def, readFieldCell(study, column.def, column.armId || ''));
}

/**
 * demographicsCellRef(project, columnKey, studyId) — resolve a table cell back to the
 * ONE extraction value it renders. The manuscript editor uses this to prove, before it
 * writes anything, that the cell it is about to change is a project extraction value and
 * to name the field and study in the upstream-impact notice (§6).
 */
export function demographicsCellRef(project, columnKey, studyId) {
  const parsed = parseDemoColumnKey(columnKey);
  if (!parsed) return null;
  const def = extractionFieldById(project, parsed.fieldId);
  if (!def || def.archived) return null;
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const study = studies.find((x) => x && x.id === studyId) || null;
  if (!study) return null;
  const arm = parsed.armId;
  const armLabel = (demographicsArms(project).find((a) => a.id === arm) || {}).label || '';
  return {
    def,
    study,
    studyId: study.id,
    armId: arm,
    armLabel,
    label: fieldDisplayLabel(def),
    isStat: isStatField(def),
    isCase: isCaseRow(study),
    cell: readFieldCell(study, def, arm),
  };
}

/**
 * demographicsCellPatch(ref, next) — the FLAT studies[] patch for a cell edit, ready for
 * the existing extraction write path (applyRowPatch / writeStudy). Never converts a
 * statistic and never fills a blank with zero.
 */
export function demographicsCellPatch(ref, next) {
  if (!ref || !ref.def) return {};
  return writeFieldCellPatch(ref.study, ref.def, next || {}, ref.armId || '');
}

/**
 * buildDemographicsTable(project) — the standalone Basic Demographics & Study
 * Characteristics table: one row per extraction row, one column per configured field
 * (or field × arm). Adaptive like every other builder — a column with no data in any row
 * is dropped rather than printed as a wall of em dashes.
 */
export function buildDemographicsTable(project, opts = {}) {
  const studies = (Array.isArray(project && project.studies) ? project.studies : []);
  const columns = demographicsColumns(project);
  const keepEmpty = !!opts.keepEmptyColumns;
  const rows = studies.map((st) => {
    const row = { __studyId: st && st.id };
    for (const c of columns) {
      const v = demographicsCellValue(c, st);
      row[c.key] = v == null ? '' : v;
    }
    return row;
  });
  const kept = keepEmpty ? columns : columns.filter((c) => rows.some((r) => s(r[c.key])));
  return {
    id: 'demographics_table',
    title: 'Basic demographics and study characteristics',
    columns: kept,
    rows,
    notes: projectDemographicsConfig(project).notes || [],
    available: rows.length > 0 && kept.length > 0,
  };
}

/* ════════════════════════ recommendations (§6 — never data) ════════════════════════ */

const DESIGN_RULES = [
  { test: /random|\brct\b|trial/i, ids: ['studyArms', 'randomizedSample', 'analyzedSample', 'blinding', 'attrition'], reason: 'randomized designs report arms, randomized and analysed numbers, blinding and attrition' },
  { test: /cohort|prospective|retrospective|longitudinal/i, ids: ['enrollPeriod', 'followup', 'attrition', 'comorbidities'], reason: 'cohorts are judged on recruitment window, follow-up and loss to follow-up' },
  { test: /case[- ]?control/i, ids: ['inclusionCriteria', 'exclusionCriteria', 'comorbidities'], reason: 'case-control studies stand or fall on how cases and controls were defined' },
  { test: /cross[- ]?sectional|survey|prevalence/i, ids: ['setting', 'enrollPeriod'], reason: 'cross-sectional estimates depend on setting and sampling window' },
  { test: /diagnostic|accuracy|sensitivity/i, ids: ['setting', 'diseaseSeverity', 'inclusionCriteria'], reason: 'diagnostic accuracy varies with setting and spectrum of disease' },
  { test: /case (report|series)/i, ids: ['age', 'sexFemale', 'previousTreatment'], reason: 'case reports are described patient by patient' },
];

/** Fields worth having in almost any study-characteristics table. */
const CORE_RECOMMENDED = Object.freeze(['country', 'design', 'age', 'sexFemale', 'followup', 'funding']);

/**
 * recommendDemographicsFields(project) — §6 "the system should recommend relevant fields
 * based on project design, but recommendations must never become fabricated data".
 *
 * It reads only the DESIGN strings already extracted, returns catalog ENTRIES with the
 * reason it proposes each, and writes nothing: adding a field creates an empty column,
 * never a value.
 */
export function recommendDemographicsFields(project) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const have = new Set(activeExtractionFields(project).map((f) => f.catalogId).filter(Boolean));
  const designs = studies.map((x) => `${s(x && x.design)} ${s(x && x.esType)}`).join(' ');
  const reasons = new Map();
  const push = (ids, reason) => {
    for (const id of ids) {
      if (have.has(id) || reasons.has(id)) continue;
      const entry = catalogEntry(id);
      if (!entry || entry.managed) continue;
      reasons.set(id, reason);
    }
  };
  push(CORE_RECOMMENDED, 'a study-characteristics table is expected to identify the study, its population and its follow-up');
  for (const rule of DESIGN_RULES) if (rule.test.test(designs)) push(rule.ids, rule.reason);
  if (studies.some((x) => isCaseRow(x))) {
    push(['age', 'sexFemale', 'previousTreatment'], 'this review extracts individual cases, which are described one patient at a time');
  }
  return [...reasons.entries()].map(([catalogId, reason]) => ({
    catalogId, reason, entry: catalogEntry(catalogId), label: (catalogEntry(catalogId) || {}).label || catalogId,
  }));
}

/** The §6 curated library, as groups, with "already added" resolved for this project. */
export function demographicsLibrary(project) {
  const have = new Set(activeExtractionFields(project).map((f) => f.catalogId).filter(Boolean));
  return demographicsCatalogGroups().map((g) => ({
    id: g.id,
    label: g.label,
    entries: g.entries.map((e) => ({ ...e, added: have.has(e.catalogId) })),
  }));
}

/** True when this project field came from the §6 demographics library. */
export function isDemographicsField(def) {
  return !!(def && isDemographicsCatalogId(def.catalogId));
}
