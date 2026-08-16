/**
 * demographics119.test.js — 119.md §6 (Basic Demographics & Study Characteristics).
 *
 * What this file is FOR (the §6 rules that are easy to break silently):
 *   1. a statistic is stored AS REPORTED and is never converted or zero-filled;
 *   2. not-reported ≠ not-applicable ≠ unclear ≠ missing — four states, four renderings;
 *   3. arm-level, overall, publication-level and case-level values stay distinct, and a
 *      case row can never move a publication-level count;
 *   4. the whole feature is ADDITIVE and byte-stable — a project that never uses it, and
 *      a project that uses and then clears it, serialise identically;
 *   5. the manuscript's study-characteristics table renders the CONFIGURED fields
 *      (116.md §10.3's gap) and a cell edit maps back to exactly one extraction value;
 *   6. recommendations recommend FIELDS, never values.
 */
import { describe, it, expect } from 'vitest';
import {
  DEMOGRAPHIC_STAT_TYPES, DEMOGRAPHIC_VALUE_STATES, isStatType, statType, isValueState,
  valueStateShort, demoSlotKey, parseDemoSlotKey, readDemoCell, writeDemoCellPatch,
  formatDemoCell, demoCellText, normalizeDemographicsConfig, projectDemographicsConfig,
  writeDemographicsConfig, addDemographicsArm, renameDemographicsArm, removeDemographicsArm,
  moveDemographicsArm, addDemographicsItem, removeDemographicsItem, moveDemographicsItem,
  setDemographicsItemNote, setDemographicsNotes, demographicsArms, DEFAULT_ARMS,
} from '../../../src/research-engine/extraction/demographics.js';
import {
  addCatalogField, addCustomField, countFieldValues, removeExtractionField,
  readFieldCell, writeFieldCellPatch, formatFieldCell, fieldCellText, isStatField,
  isArmLevelField, projectFieldColumns, fieldColumnText, listContributionFields,
  contributionCellText, projectFieldValuesOf, writeExtractionFields,
} from '../../../src/research-engine/extraction/fieldRegistry.js';
import {
  demographicsColumns, demoColumnKey, parseDemoColumnKey, demographicsCellRef,
  demographicsCellPatch, buildDemographicsTable, recommendDemographicsFields,
  demographicsLibrary,
} from '../../../src/research-engine/extraction/demographicsTable.js';
import { EXTRACTION_FIELD_CATALOG, catalogEntry, DEMOGRAPHICS_CATALOG_IDS } from '../../../src/research-engine/extraction/fieldCatalog.js';
import { buildStudyCharacteristicsTable } from '../../../src/research-engine/manuscript/tables.js';
import { computeBlockHashes } from '../../../src/research-engine/manuscript/sourceHash.js';
import { applyRowPatch } from '../../../src/research-engine/interaction/extractionHistory.js';

const idFn = () => 'gen1';
const ageDef = () => addCatalogField([], 'age').fields[0];

/** A project with the Age statistic field configured and two arms. */
function multiArmProject(rows = []) {
  let fields = addCatalogField([], 'age').fields;
  fields = addCatalogField(fields, 'sexFemale').fields;
  let cfg = addDemographicsArm({}, 'Intervention').config;
  cfg = addDemographicsArm(cfg, 'Control').config;
  return { extractionFields: fields, demographicsTable: cfg, studies: rows };
}

/* ══════════════════ 1. statistic types are recorded, never converted ══════════════════ */

describe('§6 statistic types', () => {
  it('offers every statistic §6 names, each with its own slots', () => {
    const ids = DEMOGRAPHIC_STAT_TYPES.map((t) => t.id);
    for (const id of ['mean_sd', 'mean_se', 'median_iqr', 'median_range']) expect(ids).toContain(id);
    expect(statType('mean_sd').slots).toEqual(['mean', 'sd']);
    expect(statType('median_iqr').slots).toEqual(['median', 'q1', 'q3']);
    expect(isStatType('nonsense')).toBe(false);
  });

  it('changing the statistic type NEVER converts or drops the numbers already recorded', () => {
    const def = ageDef();
    let row = { id: 's1' };
    row = { ...row, ...writeFieldCellPatch(row, def, { type: 'mean_sd', values: { mean: '45.2', sd: '10.1' } }) };
    expect(fieldCellText(def, row)).toBe('45.2 (10.1) years');

    // The reviewer realises the paper reported a median instead.
    row = { ...row, ...writeFieldCellPatch(row, def, { type: 'median_iqr' }) };
    // The mean/SD are STILL on the row, untouched — nothing was converted or deleted…
    expect(row.xf_age__mean).toBe('45.2');
    expect(row.xf_age__sd).toBe('10.1');
    // …and the cell now shows what the new type actually has: nothing yet.
    expect(formatFieldCell(def, readFieldCell(row, def))).toBe(null);
    expect(fieldCellText(def, row)).toBe('—');
  });

  it('a missing dispersion prints the point estimate alone — never a fabricated zero', () => {
    const def = ageDef();
    const row = { id: 's1', ...writeFieldCellPatch({}, def, { type: 'mean_sd', values: { mean: '61' } }) };
    expect(fieldCellText(def, row)).toBe('61 years');
    expect(fieldCellText(def, row)).not.toMatch(/0/);
  });

  it('median+IQR and median+range render in the shape the article used', () => {
    const def = ageDef();
    const iqr = { ...writeFieldCellPatch({}, def, { type: 'median_iqr', values: { median: '58', q1: '49', q3: '67' } }) };
    expect(fieldCellText(def, iqr)).toBe('58 (IQR 49–67) years');
    const rng = { ...writeFieldCellPatch({}, def, { type: 'median_range', values: { median: '58', min: '21', max: '89' } }) };
    expect(fieldCellText(def, rng)).toBe('58 (range 21–89) years');
  });

  it('a count prints the percentage the article reported and never computes one', () => {
    const def = addCatalogField([], 'sexFemale').fields[0];
    const only = { ...writeFieldCellPatch({}, def, { values: { n: '42' } }) };
    expect(fieldCellText(def, only)).toBe('42');          // no denominator ⇒ no percentage
    const both = { ...writeFieldCellPatch({}, def, { values: { n: '42', pct: '54' } }) };
    expect(fieldCellText(def, both)).toBe('42 (54%)');
  });
});

/* ══════════════════ 2. the four empty states ══════════════════ */

describe('§6 not-reported ≠ not-applicable ≠ unclear ≠ missing', () => {
  it('names three recordable states, and MISSING is not one of them', () => {
    expect(DEMOGRAPHIC_VALUE_STATES.map((x) => x.id)).toEqual(['not-reported', 'not-applicable', 'unclear']);
    expect(isValueState('')).toBe(false);
    expect(isValueState('missing')).toBe(false);
  });

  it('each state renders differently, and differently from an unextracted cell', () => {
    const def = ageDef();
    const seen = new Set();
    for (const st of DEMOGRAPHIC_VALUE_STATES) {
      const row = { ...writeFieldCellPatch({}, def, { state: st.id }) };
      const text = fieldCellText(def, row);
      expect(text).toBe(valueStateShort(st.id));
      seen.add(text);
    }
    expect(seen.size).toBe(3);
    expect(seen.has('—')).toBe(false);          // …and none of them is the missing dash
    expect(fieldCellText(def, {})).toBe('—');
  });

  it('recording a state clears the contradicting numbers, and a number clears the state', () => {
    const def = ageDef();
    let row = { ...writeFieldCellPatch({}, def, { type: 'mean_sd', values: { mean: '45', sd: '9' } }) };
    row = { ...row, ...writeFieldCellPatch(row, def, { state: 'not-reported' }) };
    expect(row.xf_age__mean).toBe('');
    expect(fieldCellText(def, row)).toBe('NR');
    row = { ...row, ...writeFieldCellPatch(row, def, { values: { mean: '45' } }) };
    expect(row.xf_age__state).toBe('');
    expect(fieldCellText(def, row)).toBe('45 years');
  });

  it('an ALIAS field keeps its built-in value key, but its state slot is namespaced', () => {
    // §36's merge rule is about the VALUE (Country still lives in `country`); the §6
    // state is new storage, so it goes in the `xf_` namespace every derivation walks.
    const def = addCatalogField([], 'country').fields[0];
    const row = { id: 's1', country: 'Japan' };
    const nr = { ...row, ...writeFieldCellPatch(row, def, { state: 'not-reported' }) };
    expect(nr.country).toBe('');
    expect(nr.xf_country__state).toBe('not-reported');
    expect(fieldCellText(def, nr)).toBe('NR');
    expect(projectFieldValuesOf(nr)).toEqual({ xf_country__state: 'not-reported' });
  });

  it('a plain (non-statistic) field keeps its 116 key and gains a state slot', () => {
    const def = addCatalogField([], 'setting').fields[0];
    const row = { ...writeFieldCellPatch({}, def, { values: { value: 'tertiary hospital' } }) };
    expect(row.xf_setting).toBe('tertiary hospital');      // 116 storage, untouched
    const nr = { ...writeFieldCellPatch(row, def, { state: 'unclear' }) };
    expect(nr.xf_setting).toBe('');
    expect(nr.xf_setting__state).toBe('unclear');
    expect(fieldCellText(def, nr)).toBe('Unclear');
  });
});

/* ══════════════════ 3. arms, overall, and the case-level contract ══════════════════ */

describe('§6 levels stay distinct', () => {
  it('arm-level values are stored under the ARM id, not merged with the overall value', () => {
    const def = ageDef();
    let row = { id: 's1' };
    row = { ...row, ...writeFieldCellPatch(row, def, { type: 'mean_sd', values: { mean: '50', sd: '8' } }, '') };
    row = { ...row, ...writeFieldCellPatch(row, def, { type: 'mean_sd', values: { mean: '45', sd: '9' } }, 'exp') };
    row = { ...row, ...writeFieldCellPatch(row, def, { type: 'mean_sd', values: { mean: '55', sd: '7' } }, 'ctrl') };
    expect(fieldCellText(def, row, '')).toBe('50 (8) years');
    expect(fieldCellText(def, row, 'exp')).toBe('45 (9) years');
    expect(fieldCellText(def, row, 'ctrl')).toBe('55 (7) years');
    expect(row.xf_age__arm_exp__mean).toBe('45');
    expect(parseDemoSlotKey('xf_age', 'xf_age__arm_exp__mean')).toEqual({ armId: 'exp', slot: 'mean' });
    expect(parseDemoSlotKey('xf_age', 'xf_age__mean')).toEqual({ armId: '', slot: 'mean' });
    expect(parseDemoSlotKey('xf_bmi', 'xf_age__mean')).toBe(null);
  });

  it('renaming an arm moves no value (ids are the key, labels are display only)', () => {
    let cfg = addDemographicsArm({}, 'Intervention').config;
    const armId = cfg.arms[0].id;
    cfg = renameDemographicsArm(cfg, armId, 'Drug A 10 mg').config;
    expect(cfg.arms[0].id).toBe(armId);
    expect(cfg.arms[0].label).toBe('Drug A 10 mg');
    expect(demoSlotKey('xf_age', 'mean', armId)).toBe(`xf_age__arm_${armId}__mean`);
  });

  it('an arm holding extracted values cannot be silently removed', () => {
    const def = ageDef();
    const cfg = addDemographicsArm({}, 'Intervention').config;
    const armId = cfg.arms[0].id;
    const row = { id: 's1', ...writeFieldCellPatch({}, def, { values: { mean: '45' } }, armId) };
    const refused = removeDemographicsArm(cfg, armId, [row], ['xf_age']);
    expect(refused.error).toMatch(/holds 1 extracted value/);
    expect(removeDemographicsArm(cfg, armId, [{ id: 's2' }], ['xf_age']).config).toEqual({});
  });

  it('a CASE row carries its own values and never speaks for the publication', () => {
    const def = ageDef();
    const pub = { id: 'p1', author: 'Smith', year: '2024', ...writeFieldCellPatch({}, def, { values: { mean: '60' } }) };
    const kase = { id: 'c1', author: 'Smith', year: '2024', caseOf: 'p1', caseIndex: 1, caseLabel: 'Case 1',
      ...writeFieldCellPatch({}, def, { values: { mean: '31' } }) };
    expect(fieldCellText(def, pub)).toBe('60 years');
    expect(fieldCellText(def, kase)).toBe('31 years');
    // …and the two rows are two rows: nothing here aggregates, sums or fans out.
    expect(pub.xf_age__mean).toBe('60');
    expect(kase.xf_age__mean).toBe('31');
  });
});

/* ══════════════════ 4. additive, byte-stable configuration ══════════════════ */

describe('§6 configuration is additive and byte-stable', () => {
  it('an untouched project has no config key and nothing is written at read time', () => {
    const p = { studies: [] };
    expect(projectDemographicsConfig(p)).toEqual({});
    expect(demographicsArms(p)).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(p, 'demographicsTable')).toBe(false);
    expect(JSON.stringify(writeDemographicsConfig(p, {}))).toBe(JSON.stringify(p));
  });

  it('configuring and then clearing the table restores a byte-identical project', () => {
    const before = { studies: [{ id: 's1' }] };
    const json = JSON.stringify(before);
    let cfg = addDemographicsArm({}, 'Intervention').config;
    cfg = addDemographicsItem(cfg, 'age').config;
    const configured = writeDemographicsConfig(before, cfg);
    expect(configured.demographicsTable.arms).toHaveLength(1);
    const cleared = writeDemographicsConfig(configured, normalizeDemographicsConfig({}));
    expect(JSON.stringify(cleared)).toBe(json);
  });

  it('a malformed or legacy config self-heals to a usable shape without throwing', () => {
    expect(normalizeDemographicsConfig(null)).toEqual({});
    expect(normalizeDemographicsConfig({ arms: 'nope', items: [{}, { fieldId: 'a' }, { fieldId: 'a' }] }))
      .toEqual({ items: [{ fieldId: 'a' }] });
    expect(normalizeDemographicsConfig({ arms: [{ id: 'bad id!' }, { id: 'ok', label: 'Ok' }] }).arms)
      .toEqual([{ id: 'ok', label: 'Ok' }]);
  });

  it('field definitions gain armLevel/statType ONLY when they mean something', () => {
    const plain = addCustomField([], { label: 'Tumour stage' }, idFn).fields[0];
    expect(Object.prototype.hasOwnProperty.call(plain, 'armLevel')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(plain, 'statType')).toBe(false);
    const age = ageDef();
    expect(age.armLevel).toBe(true);
    expect(age.statType).toBe('mean_sd');
    // …and a re-normalize is idempotent (no churn on the next blob write).
    const p = writeExtractionFields({}, [plain, age]);
    expect(JSON.stringify(writeExtractionFields(p, p.extractionFields))).toBe(JSON.stringify(p));
  });

  it('the ops keep items ordered, note-able and removable without touching values', () => {
    let cfg = addDemographicsItem({}, 'age').config;
    cfg = addDemographicsItem(cfg, 'bmi').config;
    expect(addDemographicsItem(cfg, 'age').error).toMatch(/already/);
    cfg = moveDemographicsItem(cfg, 'bmi', -1).config;
    expect(cfg.items.map((i) => i.fieldId)).toEqual(['bmi', 'age']);
    cfg = setDemographicsItemNote(cfg, 'age', 'Reported as median in two studies').config;
    expect(cfg.items.find((i) => i.fieldId === 'age').note).toMatch(/median/);
    cfg = setDemographicsNotes(cfg, ['SD unless stated.', '']).config;
    expect(cfg.notes).toEqual(['SD unless stated.']);
    cfg = removeDemographicsItem(cfg, 'age').config;
    expect(cfg.items.map((i) => i.fieldId)).toEqual(['bmi']);
    cfg = moveDemographicsArm(cfg, 'nope', 1);
    expect(cfg.error).toMatch(/not found/);
  });
});

/* ══════════════════ 5. the archive guard sees slot values ══════════════════ */

describe('§39 archive-don\'t-delete, with statistic slots', () => {
  it('a field whose only data is in its slots still refuses a hard delete', () => {
    const fields = addCatalogField([], 'age').fields;
    const def = fields[0];
    const row = { id: 's1', ...writeFieldCellPatch({}, def, { values: { mean: '45' } }, 'exp') };
    expect(row.xf_age).toBeUndefined();                    // the base key was never written
    expect(countFieldValues([row], def)).toBe(1);
    const refused = removeExtractionField(fields, 'age', [row]);
    expect(refused.error).toMatch(/archive it instead/);
    expect(removeExtractionField(fields, 'age', [{ id: 's2' }]).fields).toEqual([]);
  });
});

/* ══════════════════ 6. downstream: exports, contributions, manuscript ══════════════════ */

describe('§6 downstream consumers', () => {
  it('projectFieldColumns expands ARM columns and keeps the 116 shape without arms', () => {
    const noArms = { extractionFields: addCatalogField([], 'age').fields };
    expect(projectFieldColumns(noArms).map((c) => c.label)).toEqual(['Age (years)']);
    const p = multiArmProject();
    const labels = projectFieldColumns(p).map((c) => c.label);
    expect(labels).toContain('Age (years) — Intervention');
    expect(labels).toContain('Age (years) — Control');
  });

  it('a plain overall CSV cell still emits the raw stored string (no unit decoration)', () => {
    const fields = addCatalogField([], 'setting').fields;
    const p = { extractionFields: fields };
    const col = projectFieldColumns(p)[0];
    expect(fieldColumnText(col, { xf_setting: 'ICU' })).toBe('ICU');
  });

  it('the contributions menu renders a statistic column through the cell formatter', () => {
    const p = multiArmProject();
    const field = listContributionFields(p).find((f) => f.key === 'xf_age');
    const row = { id: 's1', ...writeFieldCellPatch({}, ageDef(), { values: { mean: '45', sd: '9' } }) };
    expect(contributionCellText(field, row)).toBe('45 (9) years');
    expect(contributionCellText(field, { id: 's2' })).toBe('—');
  });

  it('116 §10.3: the manuscript study-characteristics table renders configured fields', () => {
    const def = ageDef();
    const s1 = { id: 's1', author: 'Smith', year: '2024', design: 'RCT',
      ...writeFieldCellPatch({}, def, { values: { mean: '45', sd: '9' } }, 'exp'),
    };
    const p = multiArmProject([s1]);
    const t = buildStudyCharacteristicsTable(p);
    const col = t.columns.find((c) => c.label === 'Age (years) — Intervention');
    expect(col).toBeTruthy();
    expect(col.editable).toBe(true);
    expect(col.fieldId).toBe('age');
    expect(col.armId).toBe(p.demographicsTable.arms[0].id);
    expect(t.rows[0][col.key]).toBe('45 (9) years');
    // The empty arm column is dropped, exactly like every other adaptive column.
    expect(t.columns.some((c) => c.label === 'Age (years) — Control')).toBe(false);
    // Row identity travels with the table so a cell can be written back.
    expect(t.rowRefs[0].studyId).toBe('s1');
  });

  it('a project with no configured fields builds the SAME table it always did', () => {
    const p = { studies: [{ id: 's1', author: 'Smith', year: '2024', design: 'RCT' }] };
    const t = buildStudyCharacteristicsTable(p);
    expect(t.columns.every((c) => !c.editable)).toBe(true);
    expect(t.columns.map((c) => c.key)).toEqual(['study', 'design']);
  });

  it('the table hash learns demographics values, so an inserted table goes stale honestly', () => {
    const def = ageDef();
    const base = { studies: [{ id: 's1', author: 'Smith', year: '2024' }] };
    const p = multiArmProject(base.studies);
    const before = computeBlockHashes(p).study_characteristics_table;
    const edited = { ...p, studies: [{ ...base.studies[0], ...writeFieldCellPatch({}, def, { values: { mean: '45' } }) }] };
    expect(computeBlockHashes(edited).study_characteristics_table).not.toBe(before);
    // …and a project that never configured a field hashes exactly as before.
    expect(computeBlockHashes(base).study_characteristics_table)
      .toBe(computeBlockHashes({ studies: [{ id: 's1', author: 'Smith', year: '2024' }] }).study_characteristics_table);
  });
});

/* ══════════════════ 7. manuscript-side editing maps to ONE extraction value ══════════════════ */

describe('§6 editing a value from the manuscript', () => {
  it('resolves a table cell to the study, field and arm behind it', () => {
    const def = ageDef();
    const s1 = { id: 's1', author: 'Smith', year: '2024', ...writeFieldCellPatch({}, def, { values: { mean: '45' } }, 'exp') };
    const p = multiArmProject([s1]);
    const armId = p.demographicsTable.arms[0].id;
    const key = demoColumnKey('age', armId);
    expect(parseDemoColumnKey(key)).toEqual({ fieldId: 'age', armId });
    const ref = demographicsCellRef(p, key, 's1');
    expect(ref.label).toBe('Age (years)');
    expect(ref.armLabel).toBe('Intervention');
    expect(ref.isStat).toBe(true);
    expect(ref.cell.values.mean).toBe('45');
    expect(demographicsCellRef(p, 'design', 's1')).toBe(null);      // not a demographics cell
    expect(demographicsCellRef(p, key, 'nope')).toBe(null);
  });

  it('the edit patch writes the SAME flat keys the extraction form writes', () => {
    const p = multiArmProject([{ id: 's1', author: 'Smith' }]);
    const armId = p.demographicsTable.arms[0].id;
    const ref = demographicsCellRef(p, demoColumnKey('age', armId), 's1');
    const patch = demographicsCellPatch(ref, { values: { mean: '48', sd: '11' } });
    expect(Object.keys(patch).sort()).toEqual([`xf_age__arm_${armId}__mean`, `xf_age__arm_${armId}__sd`]);
    const next = applyRowPatch(p.studies, 's1', patch, { at: '2026-01-01' });
    expect(fieldCellText(ageDef(), next[0], armId)).toBe('48 (11) years');
    expect(next[0].updatedAt).toBe('2026-01-01');
    // The row is the ONE structured source — no manuscript-side copy exists.
    expect(projectFieldValuesOf(next[0])[`xf_age__arm_${armId}__mean`]).toBe('48');
  });
});

/* ══════════════════ 8. the curated catalog + recommendations ══════════════════ */

describe('§6 catalog and recommendations', () => {
  it('the library covers what §6 lists, and every id resolves to a real catalog entry', () => {
    for (const id of DEMOGRAPHICS_CATALOG_IDS) expect(catalogEntry(id), id).toBeTruthy();
    const ids = EXTRACTION_FIELD_CATALOG.map((e) => e.catalogId);
    for (const want of ['centres', 'setting', 'studyArms', 'randomizedSample', 'analyzedSample',
      'age', 'sexFemale', 'sexMale', 'raceEthnicity', 'bmi', 'diseaseDuration', 'diseaseSeverity',
      'comorbidities', 'previousTreatment', 'followup', 'attrition', 'funding']) {
      expect(ids, want).toContain(want);
    }
    expect(demographicsLibrary({}).length).toBeGreaterThan(3);
  });

  it('recommendations are FIELDS with reasons — they never carry a value', () => {
    const recs = recommendDemographicsFields({ studies: [{ id: 's1', design: 'Randomized controlled trial' }] });
    const ids = recs.map((r) => r.catalogId);
    expect(ids).toContain('randomizedSample');
    expect(ids).toContain('age');
    for (const r of recs) {
      expect(r.reason).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(r, 'value')).toBe(false);
    }
    // A field the project already has is not recommended again.
    const withAge = { extractionFields: addCatalogField([], 'age').fields, studies: [{ id: 's1', design: 'RCT' }] };
    expect(recommendDemographicsFields(withAge).map((r) => r.catalogId)).not.toContain('age');
  });

  it('a managed field is never recommended or offered (the effect measure owns it)', () => {
    const recs = recommendDemographicsFields({ studies: [{ id: 's1', design: 'RCT' }] });
    for (const r of recs) expect(catalogEntry(r.catalogId).managed).toBeFalsy();
    for (const g of demographicsLibrary({})) for (const e of g.entries) expect(e.managed).toBeFalsy();
  });

  it('buildDemographicsTable is adaptive and honest about an empty review', () => {
    const p = multiArmProject([]);
    expect(buildDemographicsTable(p).available).toBe(false);
    const def = ageDef();
    const withRow = multiArmProject([{ id: 's1', ...writeFieldCellPatch({}, def, { values: { mean: '45' } }) }]);
    const t = buildDemographicsTable(withRow);
    expect(t.available).toBe(true);
    // The OVERALL column survives; both arm columns are empty ⇒ dropped.
    expect(t.columns.map((c) => c.label)).toEqual(['Age (years)']);
  });
});

/* ══════════════════ 9. cell primitives ══════════════════ */

describe('demographics cell primitives', () => {
  it('demoCellText renders the missing dash for an empty cell', () => {
    expect(demoCellText(readDemoCell({}, 'xf_age'), null)).toBe('—');
    expect(formatDemoCell(null)).toBe(null);
  });

  it('a slot key round-trips and refuses a foreign base key', () => {
    expect(demoSlotKey('xf_a', 'mean')).toBe('xf_a__mean');
    expect(demoSlotKey('xf_a', 'mean', 'exp')).toBe('xf_a__arm_exp__mean');
    expect(demoSlotKey('', 'mean')).toBe('');
    expect(parseDemoSlotKey('xf_a', 'xf_a')).toBe(null);
  });

  it('writeDemoCellPatch only touches the keys the caller named', () => {
    const patch = writeDemoCellPatch({}, 'xf_a', { values: { mean: '1' } });
    expect(Object.keys(patch)).toEqual(['xf_a__mean']);
  });

  it('the default arms match the repo\'s existing intervention/control model', () => {
    expect(DEFAULT_ARMS.map((a) => a.id)).toEqual(['exp', 'ctrl']);
    expect(addDemographicsArm({}, 'Intervention').id).toBe('exp');
    expect(addDemographicsArm({}, '').error).toBeTruthy();
  });

  it('isStatField / isArmLevelField answer for the fields §6 needs them to', () => {
    expect(isStatField(ageDef())).toBe(true);
    expect(isArmLevelField(ageDef())).toBe(true);
    const plain = addCustomField([], { label: 'Tumour stage' }, idFn).fields[0];
    expect(isStatField(plain)).toBe(false);
    expect(isArmLevelField(plain)).toBe(false);
  });

  it('demographicsColumns falls back to the project\'s active fields with no saved items', () => {
    const p = { extractionFields: addCatalogField([], 'setting').fields };
    expect(demographicsColumns(p).map((c) => c.label)).toEqual(['Setting']);
    const narrowed = { ...p, demographicsTable: addDemographicsItem({}, 'nothing-here').config };
    expect(demographicsColumns(narrowed)).toEqual([]);        // an explicit list wins, even a wrong one
  });
});
