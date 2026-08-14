/**
 * fieldRegistry.test.js — 116.md §34-§40 (project-level extraction field library) and
 * §52-§56 (the contributions seam). Pure-engine pack; the UI/allow-list half lives in
 * tests/unit/extraction/fieldLibraryDownstream.test.jsx.
 *
 * WHAT IS PINNED
 *  1. CATALOG INTEGRITY — unique stable ids, valid categories/data types, options only on
 *     option-bearing types, and every `mapsTo` naming a REAL mkStudy key (the §36
 *     "merge, do not duplicate" proof: an aliased field exposes existing data).
 *  2. `managed` entries are not addable; `contribution:false` entries stay out of the
 *     optional-columns menu because the default table already prints them (§54).
 *  3. DEFINITION model — stable ids independent of the label (§38), unknown types/
 *     categories degrading instead of vanishing, self-healing normalization.
 *  4. CONFIG OPS (§39) — add / rename / reorder / hide / archive / unit / options, plus
 *     the two data-safety rules: RENAME preserves values, ARCHIVE preserves values, and a
 *     hard delete is REFUSED while any row still carries a value.
 *  5. SYNC-HASH BYTE STABILITY — `xf_*` keys are strictly value-conditional, so a project
 *     using no project fields hashes byte-identically to pre-116 (the 107.md r2 incident).
 *  6. `listContributionFields` / `resolveContributionColumns` / `contributionCellText` —
 *     the §53 single seam and the §56 missing-value contract.
 */
import { describe, it, expect } from 'vitest';
import { mkStudy } from '../../../src/research-engine/project-model/defaults.js';
import {
  EXTRACTION_FIELD_CATALOG, ADDABLE_CATALOG, ROW_CONTRIBUTION_CATALOG,
  FIELD_CATEGORY_IDS, FIELD_DATA_TYPES, OPTION_DATA_TYPES,
  catalogEntry, catalogByCategory, searchCatalog,
} from '../../../src/research-engine/extraction/fieldCatalog.js';
import {
  fieldKey, isProjectFieldKey, fieldIdFromKey, storageKeyOf, isAliasField,
  mkExtractionField, normalizeExtractionFields, projectExtractionFields,
  activeExtractionFields, writeExtractionFields, fieldDisplayLabel,
  addCatalogField, addCustomField, renameExtractionField, moveExtractionField,
  reorderExtractionFields, setExtractionFieldHidden, setExtractionFieldArchived,
  setExtractionFieldUnit, setExtractionFieldOptions, setExtractionFieldDataType,
  removeExtractionField, countFieldValues, fieldHasValues,
  projectFieldKeysOf, projectFieldValuesOf, projectFieldColumns,
  formatFieldValue, listContributionFields, contributionFieldsByCategory,
  resolveContributionColumns, contributionCellValue, contributionCellText,
  MISSING_VALUE_TEXT, NOT_EXTRACTED_LABEL,
} from '../../../src/research-engine/extraction/fieldRegistry.js';
import {
  computeSyncHash, syncStatusOf, SYNC_INPUT_FIELDS, SYNC_OPTIONAL_FIELDS,
} from '../../../src/research-engine/extraction/engine/syncState.js';

let seq = 0;
const idFn = () => `g${++seq}`;
const withFields = (fields) => ({ id: 'p1', studies: [], extractionFields: fields });

/* ══════════════════ 1. catalog integrity (§36) ══════════════════ */

describe('the §36 catalog is internally consistent', () => {
  it('every catalogId is unique and non-empty', () => {
    const ids = EXTRACTION_FIELD_CATALOG.map((e) => e.catalogId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a valid category, data type and a label', () => {
    for (const e of EXTRACTION_FIELD_CATALOG) {
      expect(FIELD_CATEGORY_IDS, `category of ${e.catalogId}`).toContain(e.category);
      expect(FIELD_DATA_TYPES, `dataType of ${e.catalogId}`).toContain(e.dataType);
      expect(e.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('only option-bearing data types declare options', () => {
    for (const e of EXTRACTION_FIELD_CATALOG) {
      if (e.options) expect(OPTION_DATA_TYPES, `${e.catalogId}`).toContain(e.dataType);
    }
  });

  it('every `mapsTo` names a REAL extraction row key — the §36 merge proof', () => {
    // The whole point of an alias: enabling "Country" exposes the country data that is
    // already on the row instead of minting a divergent second copy.
    const row = mkStudy();
    for (const e of EXTRACTION_FIELD_CATALOG) {
      if (!e.mapsTo) continue;
      expect(Object.prototype.hasOwnProperty.call(row, e.mapsTo), `${e.catalogId} → ${e.mapsTo}`).toBe(true);
    }
  });

  it('an aliased field never uses the xf_ namespace, and a non-aliased one always does', () => {
    for (const e of EXTRACTION_FIELD_CATALOG) {
      const def = mkExtractionField({ catalogId: e.catalogId }, idFn);
      const key = storageKeyOf(def);
      if (e.mapsTo) { expect(key).toBe(e.mapsTo); expect(isProjectFieldKey(key)).toBe(false); }
      else { expect(key).toBe(`xf_${e.catalogId}`); expect(isProjectFieldKey(key)).toBe(true); }
    }
  });

  it('ADDABLE_CATALOG excludes every measure-managed field', () => {
    expect(ADDABLE_CATALOG.some((e) => e.managed)).toBe(false);
    // events/total/es/lo/hi are owned by the effect measure — never free-floating copies.
    for (const id of ['events', 'total', 'es', 'lo', 'hi', 'outcome', 'timepoint', 'adjusted']) {
      expect(ADDABLE_CATALOG.map((e) => e.catalogId)).not.toContain(id);
      expect(catalogEntry(id).managed).toBe(true);
    }
  });

  it('the default contributions columns (n/es/lo/hi) are not offered as OPTIONAL columns (§54)', () => {
    const ids = ROW_CONTRIBUTION_CATALOG.map((e) => e.catalogId);
    for (const id of ['n', 'es', 'lo', 'hi']) expect(ids).not.toContain(id);
    // …but everything §53 names IS available.
    for (const id of ['country', 'year', 'timepoint', 'design', 'followup',
      'denominatorPopulation', 'actionStatus']) expect(ids).toContain(id);
  });

  it('catalogByCategory drops empty groups and keeps §36 order', () => {
    const groups = catalogByCategory();
    expect(groups.length).toBeGreaterThan(3);
    expect(groups.every((g) => g.entries.length > 0)).toBe(true);
    expect(groups[0].id).toBe('bibliographic');
  });

  it('searchCatalog matches label, description and category, and is case-insensitive', () => {
    expect(searchCatalog('mean age').map((e) => e.catalogId)).toContain('meanAge');
    expect(searchCatalog('COUNTRY').map((e) => e.catalogId)).toContain('country');
    expect(searchCatalog('').length).toBe(ADDABLE_CATALOG.length);
    expect(searchCatalog('zzzznotafield')).toEqual([]);
  });
});

/* ══════════════════ 2. the definition model (§37/§38) ══════════════════ */

describe('field definitions carry stable ids independent of the display label (§38)', () => {
  it('a catalog field takes the catalogId as its stable id', () => {
    const def = mkExtractionField({ catalogId: 'country' }, idFn);
    expect(def.id).toBe('country');
    expect(def.label).toBe('Country');
    expect(isAliasField(def)).toBe(true);
  });

  it('a custom field gets a GENERATED id, never one derived from its name', () => {
    seq = 0;
    const def = mkExtractionField({ label: 'Tumour stage' }, idFn);
    expect(def.id).toBe('g1');
    expect(def.catalogId).toBe('');
    expect(storageKeyOf(def)).toBe('xf_g1');
    expect(fieldIdFromKey(fieldKey('g1'))).toBe('g1');
  });

  it('unknown data types and categories DEGRADE rather than vanish', () => {
    const def = mkExtractionField({ id: 'x', label: 'X', dataType: 'quaternion', category: 'astrology' });
    expect(def.dataType).toBe('text');
    expect(def.category).toBe('study');
  });

  it('options survive only on option-bearing types', () => {
    expect(mkExtractionField({ id: 'a', label: 'A', dataType: 'categorical', options: ['x', ' y ', ''] }).options)
      .toEqual(['x', 'y']);
    expect(mkExtractionField({ id: 'a', label: 'A', dataType: 'text', options: ['x'] }).options).toEqual([]);
  });

  it('every §37 data type is accepted', () => {
    for (const t of FIELD_DATA_TYPES) {
      expect(mkExtractionField({ id: `i${t}`, label: t, dataType: t }).dataType).toBe(t);
    }
  });
});

describe('readers self-heal and never write at load (repo invariant 3)', () => {
  it('an absent / legacy / malformed config resolves to an EMPTY configuration', () => {
    for (const p of [undefined, null, {}, { extractionFields: null }, { extractionFields: 'nope' },
      { extractionFields: [null, 3, {}, { label: 'no id' }] }]) {
      expect(projectExtractionFields(p)).toEqual([]);
      expect(activeExtractionFields(p)).toEqual([]);
      expect(projectFieldColumns(p)).toEqual([]);
    }
  });

  it('reading does not mutate the project blob', () => {
    const p = { id: 'p', extractionFields: [{ id: 'country', catalogId: 'country', order: 7 }] };
    const before = JSON.stringify(p);
    projectExtractionFields(p);
    activeExtractionFields(p);
    listContributionFields(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('duplicate ids are dropped and order is re-indexed from the stored order', () => {
    const list = normalizeExtractionFields([
      { id: 'b', label: 'B', order: 5 }, { id: 'a', label: 'A', order: 1 }, { id: 'b', label: 'B2', order: 0 },
    ]);
    expect(list.map((f) => f.id)).toEqual(['a', 'b']);
    expect(list.map((f) => f.order)).toEqual([0, 1]);
    expect(list[1].label).toBe('B');   // the FIRST occurrence wins
  });

  it('writeExtractionFields deletes an emptied configuration (byte-stability)', () => {
    const base = { id: 'p', name: 'x' };
    const added = writeExtractionFields(base, [mkExtractionField({ catalogId: 'country' })]);
    expect(added.extractionFields).toHaveLength(1);
    const cleared = writeExtractionFields(added, []);
    expect('extractionFields' in cleared).toBe(false);
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(base));
  });
});

/* ══════════════════ 3. configuration ops (§39) ══════════════════ */

describe('§39 field configuration', () => {
  it('adds a catalog field, refuses a duplicate, and refuses a managed one', () => {
    const a = addCatalogField([], 'country', idFn);
    expect(a.fields.map((f) => f.id)).toEqual(['country']);
    expect(addCatalogField(a.fields, 'country', idFn).error).toBeTruthy();
    expect(addCatalogField(a.fields, 'events', idFn).error).toBeTruthy();
    expect(addCatalogField(a.fields, 'not-a-field', idFn).error).toBeTruthy();
  });

  it('re-adding an ARCHIVED field un-archives it instead of minting a duplicate', () => {
    const a = addCatalogField([], 'country', idFn).fields;
    const archived = setExtractionFieldArchived(a, 'country', true).fields;
    const re = addCatalogField(archived, 'country', idFn);
    expect(re.fields).toHaveLength(1);
    expect(re.fields[0].archived).toBe(false);
  });

  it('creates a custom field with name / description / type / unit / category (§37)', () => {
    seq = 0;
    const r = addCustomField([], {
      label: 'Tumour stage', description: 'AJCC 8th', dataType: 'categorical',
      category: 'population', options: ['I', 'II', 'III'],
    }, idFn);
    expect(r.id).toBe('g1');
    expect(r.fields[0]).toMatchObject({
      id: 'g1', catalogId: '', label: 'Tumour stage', description: 'AJCC 8th',
      dataType: 'categorical', category: 'population', options: ['I', 'II', 'III'],
    });
    expect(addCustomField([], { label: '   ' }, idFn).error).toBeTruthy();
  });

  it('renames the LABEL only — the storage key never moves (§38)', () => {
    const a = addCatalogField([], 'followup', idFn).fields;
    const keyBefore = storageKeyOf(a[0]);
    const r = renameExtractionField(a, 'followup', 'Follow-up');
    expect(r.fields[0].label).toBe('Follow-up');
    expect(r.fields[0].id).toBe('followup');
    expect(storageKeyOf(r.fields[0])).toBe(keyBefore);
    expect(renameExtractionField(a, 'followup', '  ').error).toBeTruthy();
    expect(renameExtractionField(a, 'nope', 'X').error).toBeTruthy();
  });

  it('RENAMING PRESERVES VALUES — the §38 data-loss guarantee', () => {
    seq = 0;
    const added = addCustomField([], { label: 'Follow-up duration', dataType: 'duration' }, idFn);
    const key = storageKeyOf(added.fields[0]);
    const studies = [{ ...mkStudy(), id: 's1', [key]: '24 months' }];
    const renamed = renameExtractionField(added.fields, added.id, 'Follow-up').fields;
    expect(storageKeyOf(renamed[0])).toBe(key);
    expect(studies[0][key]).toBe('24 months');
    expect(countFieldValues(studies, renamed[0])).toBe(1);
  });

  it('reorders, moves and clamps at the ends', () => {
    let f = addCatalogField([], 'country', idFn).fields;
    f = addCatalogField(f, 'setting', idFn).fields;
    f = addCatalogField(f, 'region', idFn).fields;
    expect(moveExtractionField(f, 'region', -1).fields.map((x) => x.id)).toEqual(['country', 'region', 'setting']);
    expect(moveExtractionField(f, 'country', -1).fields.map((x) => x.id)).toEqual(['country', 'setting', 'region']);
    expect(moveExtractionField(f, 'region', 1).fields.map((x) => x.id)).toEqual(['country', 'setting', 'region']);
    expect(reorderExtractionFields(f, ['region', 'country']).fields.map((x) => x.id)).toEqual(['region', 'country', 'setting']);
    expect(moveExtractionField(f, 'nope', 1).error).toBeTruthy();
  });

  it('hide / unhide keeps the definition and every value', () => {
    const f = addCatalogField([], 'country', idFn).fields;
    const hidden = setExtractionFieldHidden(f, 'country', true).fields;
    expect(hidden[0].hidden).toBe(true);
    expect(projectExtractionFields(withFields(hidden))).toHaveLength(1);
    expect(activeExtractionFields(withFields(hidden))).toHaveLength(0);
    expect(setExtractionFieldHidden(hidden, 'country', false).fields[0].hidden).toBe(false);
  });

  it('defines a unit, options and a data type', () => {
    let f = addCustomField([], { label: 'Stage', dataType: 'categorical' }, idFn).fields;
    const id = f[0].id;
    f = setExtractionFieldUnit(f, id, ' mg ').fields;
    expect(f[0].unit).toBe('mg');
    f = setExtractionFieldOptions(f, id, 'I, II , III').fields;
    expect(f[0].options).toEqual(['I', 'II', 'III']);
    f = setExtractionFieldDataType(f, id, 'text').fields;
    expect(f[0].dataType).toBe('text');
    expect(f[0].options).toEqual([]);                       // options drop with the type
    expect(setExtractionFieldDataType(f, id, 'nope').error).toBeTruthy();
    expect(fieldDisplayLabel({ label: 'Mean age', unit: 'years' })).toBe('Mean age (years)');
  });

  it('ARCHIVING PRESERVES VALUES and un-archiving brings the field straight back', () => {
    seq = 0;
    const added = addCustomField([], { label: 'Mean age', dataType: 'decimal', unit: 'years' }, idFn);
    const key = storageKeyOf(added.fields[0]);
    const studies = [{ ...mkStudy(), id: 's1', [key]: '54' }];
    const archived = setExtractionFieldArchived(added.fields, added.id, true).fields;
    expect(archived[0].archived).toBe(true);
    expect(studies[0][key]).toBe('54');                     // not one value touched
    expect(activeExtractionFields(withFields(archived))).toHaveLength(0);
    const back = setExtractionFieldArchived(archived, added.id, false).fields;
    expect(activeExtractionFields(withFields(back))).toHaveLength(1);
    expect(countFieldValues(studies, back[0])).toBe(1);
  });

  it('a HARD DELETE is refused while any row carries a value, and allowed when none does', () => {
    seq = 0;
    const added = addCustomField([], { label: 'Mean age' }, idFn);
    const key = storageKeyOf(added.fields[0]);
    const filled = [{ ...mkStudy(), id: 's1', [key]: '54' }, { ...mkStudy(), id: 's2' }];
    const refused = removeExtractionField(added.fields, added.id, filled);
    expect(refused.fields).toBeUndefined();
    expect(refused.values).toBe(1);
    expect(refused.error).toMatch(/archive it instead/i);
    expect(fieldHasValues(filled, added.fields[0])).toBe(true);

    const empty = [{ ...mkStudy(), id: 's1' }, { ...mkStudy(), id: 's2', [key]: '' }];
    expect(fieldHasValues(empty, added.fields[0])).toBe(false);
    expect(removeExtractionField(added.fields, added.id, empty).fields).toEqual([]);
    expect(removeExtractionField(added.fields, 'nope', []).error).toBeTruthy();
  });
});

/* ══════════════════ 4. sync-hash byte stability (§38, 107.md r2) ══════════════════ */

describe('project field values hash value-conditionally (the 107.md r2 contract)', () => {
  const legacy = () => ({ esType: 'OR', outcome: 'x', es: '1', lo: '0', hi: '2' });

  it('no xf_ key is a FIXED member of SYNC_INPUT_FIELDS / SYNC_OPTIONAL_FIELDS', () => {
    expect(SYNC_INPUT_FIELDS.some(isProjectFieldKey)).toBe(false);
    expect(SYNC_OPTIONAL_FIELDS.some(isProjectFieldKey)).toBe(false);
    expect([...SYNC_OPTIONAL_FIELDS]).toEqual(['denominatorPopulation', 'denominatorCustom', 'actionStatus']);
  });

  it('a project using NO custom fields keeps the byte-identical pre-116 digest', () => {
    // The very digest tests/unit/extraction/proportionMetaDownstream.test.jsx pins for a
    // pre-107 row. If this moves, every stored extractionMeta.syncHash is invalidated.
    expect(computeSyncHash(legacy())).toBe('56409487');
  });

  it('an EMPTY / whitespace / null xf_ value does not move the hash', () => {
    const base = computeSyncHash(legacy());
    for (const v of ['', '   ', null, undefined]) {
      expect(computeSyncHash({ ...legacy(), xf_meanAge: v })).toBe(base);
    }
  });

  it('a REAL value moves the hash, and clearing it returns to the baseline', () => {
    const base = computeSyncHash(legacy());
    const filled = computeSyncHash({ ...legacy(), xf_meanAge: '54' });
    expect(filled).not.toBe(base);
    expect(computeSyncHash({ ...legacy(), xf_meanAge: '55' })).not.toBe(filled);
    expect(computeSyncHash({ ...legacy(), xf_meanAge: '' })).toBe(base);
  });

  it('key ORDER in the blob cannot churn the hash', () => {
    const a = { ...legacy(), xf_b: '2', xf_a: '1' };
    const b = { ...legacy(), xf_a: '1', xf_b: '2' };
    expect(computeSyncHash(a)).toBe(computeSyncHash(b));
  });

  it('a stored pre-116 syncHash still reads "synced" after the upgrade', () => {
    const row = { ...legacy(), es: '0.5', lo: '0.3', hi: '0.7' };
    const stored = { ...row, extractionMeta: { syncHash: computeSyncHash(row), syncedAt: 't', includedInAnalysis: true } };
    expect(syncStatusOf(stored)).toBe('synced');
    expect(syncStatusOf({ ...stored, xf_meanAge: '54' })).toBe('updated_since_sync');
  });

  it('an ALIASED catalog field rides its existing key, so it hashes as it always did', () => {
    // `country` is not a sync input at all; enabling "Country" must not change any digest.
    const base = computeSyncHash(legacy());
    expect(computeSyncHash({ ...legacy(), country: 'USA' })).toBe(base);
  });
});

/* ══════════════════ 5. downstream derivation helpers ══════════════════ */

describe('the derivation helpers every downstream allow-list now uses', () => {
  it('projectFieldKeysOf returns only xf_ keys, sorted', () => {
    const row = { es: '1', cv_age: '5', xf_b: '2', xf_a: '1', xfnope: 'x' };
    expect(projectFieldKeysOf(row)).toEqual(['xf_a', 'xf_b']);
    expect(projectFieldKeysOf(null)).toEqual([]);
  });

  it('projectFieldValuesOf omits empty values (so nothing churns downstream)', () => {
    expect(projectFieldValuesOf({ xf_a: '1', xf_b: '', xf_c: null })).toEqual({ xf_a: '1' });
    expect(projectFieldValuesOf({ es: '1' })).toEqual({});
  });

  it('projectFieldColumns derives the export columns from ACTIVE fields only', () => {
    let f = addCatalogField([], 'country', idFn).fields;
    f = addCustomField(f, { label: 'Mean age', dataType: 'decimal', unit: 'years' }, () => 'k1').fields;
    f = addCatalogField(f, 'setting', idFn).fields;
    f = setExtractionFieldArchived(f, 'setting', true).fields;
    expect(projectFieldColumns(withFields(f))).toEqual([
      { key: 'country', label: 'Country', dataType: 'text', id: 'country' },
      { key: 'xf_k1', label: 'Mean age (years)', dataType: 'decimal', id: 'k1' },
    ]);
  });
});

/* ══════════════════ 6. the contributions seam (§52-§56) ══════════════════ */

describe('listContributionFields — the §53 single seam', () => {
  it('offers the built-in row fields §53 names, without a second hard-coded menu', () => {
    const ids = listContributionFields({}).map((f) => f.id);
    for (const k of ['country', 'year', 'timepoint', 'design', 'followup',
      'denominatorPopulation', 'actionStatus']) expect(ids).toContain(k);
    // …and never the columns the default table already prints (§54).
    for (const k of ['n', 'es', 'lo', 'hi']) expect(ids).not.toContain(k);
  });

  it('adds the project\'s CUSTOM fields, keyed by their storage key', () => {
    const f = addCustomField([], { label: 'Mean age', dataType: 'decimal', unit: 'years', category: 'population' }, () => 'k1').fields;
    const list = listContributionFields(withFields(f));
    const mine = list.find((x) => x.id === 'xf_k1');
    expect(mine).toMatchObject({ key: 'xf_k1', label: 'Mean age', category: 'population', source: 'project' });
    expect(list[0].source).toBe('project');      // the review's own fields come first
  });

  it('a project field that ALIASES a built-in collapses onto one column, its label winning', () => {
    let f = addCatalogField([], 'followup', idFn).fields;
    f = renameExtractionField(f, 'followup', 'Follow-up').fields;
    const list = listContributionFields(withFields(f));
    const hits = list.filter((x) => x.id === 'followup');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ label: 'Follow-up', source: 'project' });
  });

  it('hidden and archived fields leave the menu (but a built-in alias stays available)', () => {
    const f = addCustomField([], { label: 'Mean age' }, () => 'k1').fields;
    expect(listContributionFields(withFields(f)).map((x) => x.id)).toContain('xf_k1');
    const hidden = setExtractionFieldHidden(f, 'k1', true).fields;
    expect(listContributionFields(withFields(hidden)).map((x) => x.id)).not.toContain('xf_k1');
    const archived = setExtractionFieldArchived(f, 'k1', true).fields;
    expect(listContributionFields(withFields(archived)).map((x) => x.id)).not.toContain('xf_k1');
  });

  it('contributionFieldsByCategory groups in §36 order and drops empty groups', () => {
    const groups = contributionFieldsByCategory({});
    expect(groups.every((g) => g.fields.length > 0)).toBe(true);
    expect(groups.map((g) => g.id)).toEqual([...new Set(groups.map((g) => g.id))]);
  });
});

describe('§56 — missing values are an INTENTIONAL state, never undefined/null/blank', () => {
  const field = (over = {}) => ({ id: 'xf_k1', key: 'xf_k1', label: 'Mean age', dataType: 'decimal', unit: '', ...over });

  it('a study with no value renders the em dash, never "undefined" or ""', () => {
    for (const row of [{}, { xf_k1: '' }, { xf_k1: null }, { xf_k1: undefined }, { xf_k1: '   ' }]) {
      expect(contributionCellValue(field(), row)).toBeNull();
      expect(contributionCellText(field(), row)).toBe(MISSING_VALUE_TEXT);
      expect(contributionCellText(field(), row)).not.toMatch(/undefined|null/);
    }
    expect(MISSING_VALUE_TEXT).toBe('—');
    expect(NOT_EXTRACTED_LABEL).toBe('Not extracted');
  });

  it('formats by data type: unit suffix, percentage, boolean, multi-select', () => {
    expect(contributionCellText(field({ unit: 'years' }), { xf_k1: '54' })).toBe('54 years');
    expect(contributionCellText(field({ dataType: 'percentage' }), { xf_k1: '12' })).toBe('12%');
    expect(contributionCellText(field({ dataType: 'percentage' }), { xf_k1: '12%' })).toBe('12%');
    expect(contributionCellText(field({ dataType: 'boolean' }), { xf_k1: 'yes' })).toBe('Yes');
    expect(contributionCellText(field({ dataType: 'boolean' }), { xf_k1: 'no' })).toBe('No');
    expect(contributionCellText(field({ dataType: 'multiselect' }), { xf_k1: 'a, b' })).toBe('a; b');
    expect(contributionCellText(field({ dataType: 'text', unit: 'years' }), { xf_k1: 'ongoing' })).toBe('ongoing');
    expect(formatFieldValue({ dataType: 'text' }, '  ')).toBeNull();
  });

  it('the 107.md classifications print their HUMAN label, and unclassified reads as missing', () => {
    const dp = { id: 'denominatorPopulation', key: 'denominatorPopulation', label: 'Denominator population', dataType: 'text' };
    const as = { id: 'actionStatus', key: 'actionStatus', label: 'Action status', dataType: 'text' };
    expect(contributionCellText(dp, { denominatorPopulation: 'all_patients_tested' })).not.toBe(MISSING_VALUE_TEXT);
    expect(contributionCellText(dp, { denominatorPopulation: 'all_patients_tested' })).not.toMatch(/_/);
    // '' (legacy / not classified) and an out-of-registry value both read as MISSING,
    // never as a fabricated category (107.md §8C).
    expect(contributionCellText(dp, { denominatorPopulation: '' })).toBe(MISSING_VALUE_TEXT);
    expect(contributionCellText(dp, {})).toBe(MISSING_VALUE_TEXT);
    expect(contributionCellText(as, { actionStatus: 'martians' })).toBe(MISSING_VALUE_TEXT);
    expect(contributionCellText(as, { actionStatus: 'unclear' })).not.toBe(MISSING_VALUE_TEXT);
  });
});

describe('resolveContributionColumns — the Part XIX archived/removed-field edge case', () => {
  const f = addCustomField([], { label: 'Mean age' }, () => 'k1').fields;

  it('resolves a live selection in the stored order, deduping', () => {
    const r = resolveContributionColumns(withFields(f), ['xf_k1', 'country', 'xf_k1']);
    expect(r.columns.map((c) => c.id)).toEqual(['xf_k1', 'country']);
    expect(r.unavailable).toEqual([]);
  });

  it('an ARCHIVED field degrades to `unavailable` — it is not rendered and never crashes', () => {
    const archived = setExtractionFieldArchived(f, 'k1', true).fields;
    const r = resolveContributionColumns(withFields(archived), ['xf_k1', 'country']);
    expect(r.columns.map((c) => c.id)).toEqual(['country']);
    expect(r.unavailable).toEqual(['xf_k1']);
  });

  it('a REMOVED field, an unknown id and junk all degrade the same way', () => {
    const r = resolveContributionColumns(withFields([]), ['xf_k1', 'nonsense', '', null, 'country']);
    expect(r.columns.map((c) => c.id)).toEqual(['country']);
    expect(r.unavailable).toEqual(['xf_k1', 'nonsense']);
  });

  it('the stored selection is NOT rewritten — un-archiving brings the column back', () => {
    const archived = setExtractionFieldArchived(f, 'k1', true).fields;
    const selection = ['xf_k1', 'country'];
    resolveContributionColumns(withFields(archived), selection);
    expect(selection).toEqual(['xf_k1', 'country']);       // the reader mutates nothing
    const back = setExtractionFieldArchived(archived, 'k1', false).fields;
    expect(resolveContributionColumns(withFields(back), selection).columns.map((c) => c.id))
      .toEqual(['xf_k1', 'country']);
  });

  it('never throws on a malformed selection', () => {
    expect(() => resolveContributionColumns(null, null)).not.toThrow();
    expect(resolveContributionColumns(null, undefined)).toEqual({ columns: [], unavailable: [] });
  });
});
