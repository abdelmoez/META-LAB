/**
 * proportionCompatibility.test.js — 107.md §11/§12. The pre-analysis compatibility
 * engine for single-arm proportions.
 *
 * The invariants that matter scientifically:
 *  - two REAL categories in one field never pool silently;
 *  - "not classified (legacy)" is reported on its OWN line and is never folded into a
 *    real category — including never into `actionStatus:'unclear'`;
 *  - an ALL-unclassified outcome stays poolable with an informational note (the 107.md
 *    §21 regression guard: projects extracted before this feature keep working);
 *  - two different free-text 'Other/custom' denominators are a conflict;
 *  - an override is consent for a SPECIFIC estimate set — change the set and it goes stale.
 */
import { describe, it, expect } from 'vitest';
import {
  checkProportionCompatibility, applyProportionFilters, activeProportionFilters,
  proportionIssueSignature, proportionOverrideStale, buildProportionOverride,
  describeOverrideCategories, overrideDateText, subgroupGroupLabel, proportionFilterKey,
  sanitizeProportionFilters, sanitizeProportionOverrides,
  UNCLASSIFIED_GROUP_LABEL, UNCLASSIFIED_FILTER,
} from '../../../src/research-engine/statistics/proportionCompatibility.js';

const prop = (over = {}) => ({
  id: 'x', author: 'Smith', year: '2024', esType: 'PROP',
  es: '0.2', lo: '0.1', hi: '0.3', events: '23', total: '59', ...over,
});
/** A row saved before 107.md §8: the three keys simply are not there. */
const legacy = (over = {}) => {
  const s = prop(over);
  delete s.denominatorPopulation; delete s.denominatorCustom; delete s.actionStatus;
  return s;
};

const byField = (check) => Object.fromEntries(check.issues.map((i) => [i.field, i]));

describe('checkProportionCompatibility — applicability', () => {
  it('is not applicable to non-PROP rows', () => {
    const c = checkProportionCompatibility([
      { id: '1', esType: 'OR', es: '0.2', denominatorPopulation: 'all_patients_tested' },
      { id: '2', esType: 'OR', es: '0.4', denominatorPopulation: 'plp_molecular_diagnoses' },
    ]);
    expect(c.applicable).toBe(false);
    expect(c.blocking).toBe(false);
    expect(c.issues).toEqual([]);
  });

  it('is not applicable below two proportion estimates (nothing is pooled)', () => {
    expect(checkProportionCompatibility([prop({ denominatorPopulation: 'other' })]).applicable).toBe(false);
    expect(checkProportionCompatibility([]).applicable).toBe(false);
    expect(checkProportionCompatibility(null).applicable).toBe(false);
  });

  it('ignores non-PROP rows mixed into the set', () => {
    const c = checkProportionCompatibility([
      prop({ id: 'a', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
      prop({ id: 'b', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
      { id: 'c', esType: 'OR', es: '0.1', denominatorPopulation: 'other' },
    ]);
    expect(c.propCount).toBe(2);
    expect(c.blocking).toBe(false);
  });
});

describe('checkProportionCompatibility — mixed real categories block', () => {
  const rows = [
    prop({ id: '1', author: 'Smith', year: '2024', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    prop({ id: '2', author: 'Jones', year: '2023', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    prop({ id: '3', author: 'Lee', year: '2022', denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: 'implemented' }),
  ];
  const c = checkProportionCompatibility(rows);

  it('blocks with one issue on the conflicting field only', () => {
    expect(c.applicable).toBe(true);
    expect(c.blocking).toBe(true);
    expect(c.issues.map((i) => i.field)).toEqual(['denominatorPopulation']);
    expect(c.issues[0].kind).toBe('mixed-categories');
  });

  it('reports per-value counts and resolved labels', () => {
    const v = c.issues[0].values;
    expect(v.map((x) => [x.label, x.count])).toEqual([
      ['P/LP molecular diagnoses', 1],
      ['All patients tested', 2],
    ]);
    expect(c.issues[0].totalAffected).toBe(3);
    expect(c.issues[0].unclassifiedCount).toBe(0);
  });

  it('names the affected studies per value (deduped author year)', () => {
    const v = c.issues[0].values;
    expect(v.find((x) => x.value === 'all_patients_tested').studies).toEqual(['Smith 2024', 'Jones 2023']);
    expect(v.find((x) => x.value === 'plp_molecular_diagnoses').studies).toEqual(['Lee 2022']);
  });

  it('detects the same conflict on actionStatus', () => {
    const c2 = checkProportionCompatibility([
      prop({ id: '1', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
      prop({ id: '2', denominatorPopulation: 'all_patients_tested', actionStatus: 'recommended_planned' }),
    ]);
    expect(byField(c2).actionStatus.values.map((x) => x.label)).toEqual(['Implemented', 'Recommended/planned']);
  });
});

describe('checkProportionCompatibility — real + unclassified is a conflict, reported separately', () => {
  const rows = [
    prop({ id: '1', author: 'Smith', year: '2024', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    prop({ id: '2', author: 'Jones', year: '2023', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    legacy({ id: '3', author: 'Old', year: '2011' }),
  ];
  const c = checkProportionCompatibility(rows);

  it('blocks on BOTH fields (each has one real category plus legacy rows)', () => {
    expect(c.blocking).toBe(true);
    expect(c.issues.map((i) => i.field).sort()).toEqual(['actionStatus', 'denominatorPopulation']);
    expect(c.issues.every((i) => i.kind === 'category-and-unclassified')).toBe(true);
  });

  it('lists the legacy rows as their own line, last, never merged into a category', () => {
    const issue = byField(c).denominatorPopulation;
    expect(issue.unclassifiedCount).toBe(1);
    const last = issue.values[issue.values.length - 1];
    expect(last.value).toBe('');
    expect(last.label).toBe(UNCLASSIFIED_GROUP_LABEL);
    expect(last.count).toBe(1);
    expect(last.studies).toEqual(['Old 2011']);
    // the real category keeps ONLY its own two estimates
    expect(issue.values[0].count).toBe(2);
  });

  it("never treats an empty actionStatus as 'unclear'", () => {
    const c2 = checkProportionCompatibility([
      prop({ id: '1', actionStatus: 'unclear', denominatorPopulation: 'all_patients_tested' }),
      legacy({ id: '2', denominatorPopulation: 'all_patients_tested' }),
    ]);
    const issue = byField(c2).actionStatus;
    expect(issue).toBeTruthy();                       // 'unclear' + legacy is still a conflict
    expect(issue.values.map((v) => v.label)).toEqual(['Unclear', UNCLASSIFIED_GROUP_LABEL]);
    expect(issue.values.map((v) => v.count)).toEqual([1, 1]);
  });

  it('treats an unknown/hand-edited value as unclassified, not as a third category', () => {
    const c2 = checkProportionCompatibility([
      prop({ id: '1', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
      prop({ id: '2', denominatorPopulation: 'made_up_value', actionStatus: 'implemented' }),
    ]);
    const issue = byField(c2).denominatorPopulation;
    expect(issue.values.map((v) => v.label)).toEqual(['All patients tested', UNCLASSIFIED_GROUP_LABEL]);
  });
});

describe('checkProportionCompatibility — an all-legacy outcome keeps pooling (107.md §21)', () => {
  const c = checkProportionCompatibility([legacy({ id: '1' }), legacy({ id: '2', author: 'Old2' }), legacy({ id: '3', author: 'Old3' })]);

  it('is applicable, informational, and NOT blocking', () => {
    expect(c.applicable).toBe(true);
    expect(c.blocking).toBe(false);
    expect(c.infoOnly).toBe(true);
    expect(c.issues).toEqual([]);
    expect(c.unclassifiedFields).toEqual(['denominatorPopulation', 'actionStatus']);
  });

  it('a fully classified, homogeneous outcome produces no note at all', () => {
    const ok = checkProportionCompatibility([
      prop({ id: '1', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
      prop({ id: '2', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    ]);
    expect(ok.blocking).toBe(false);
    expect(ok.infoOnly).toBe(false);
    expect(ok.unclassifiedFields).toEqual([]);
  });
});

describe('checkProportionCompatibility — custom denominator definitions', () => {
  const other = (id, text) => prop({
    id, author: 'A' + id, denominatorPopulation: 'other', denominatorCustom: text, actionStatus: 'implemented',
  });

  it('blocks when two Other/custom rows describe different denominators', () => {
    const c = checkProportionCompatibility([other('1', 'Patients with a VUS'), other('2', 'Patients re-tested at 12 months')]);
    const issue = byField(c).denominatorCustom;
    expect(issue).toBeTruthy();
    expect(issue.kind).toBe('mixed-custom-definitions');
    expect(issue.values.map((v) => v.label).sort()).toEqual(['Patients re-tested at 12 months', 'Patients with a VUS']);
    expect(issue.totalAffected).toBe(2);
  });

  it('does NOT block when the wording matches (case/whitespace-insensitive)', () => {
    const c = checkProportionCompatibility([other('1', 'Patients with a VUS'), other('2', '  patients   with a vus ')]);
    expect(c.blocking).toBe(false);
    expect(c.issues).toEqual([]);
  });

  it('an undescribed Other/custom row is its own line, named honestly', () => {
    const c = checkProportionCompatibility([other('1', 'Patients with a VUS'), other('2', '')]);
    const issue = byField(c).denominatorCustom;
    expect(issue.values.map((v) => v.label)).toContain(UNCLASSIFIED_GROUP_LABEL);
    expect(issue.unclassifiedCount).toBe(1);
  });

  it('does not fire for a single Other/custom row', () => {
    const c = checkProportionCompatibility([
      other('1', 'Patients with a VUS'),
      prop({ id: '2', denominatorPopulation: 'other', denominatorCustom: 'Patients with a VUS', actionStatus: 'implemented' }),
    ]);
    expect(c.issues.find((i) => i.field === 'denominatorCustom')).toBeUndefined();
  });
});

describe('applyProportionFilters', () => {
  const rows = [
    prop({ id: '1', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    prop({ id: '2', denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: 'implemented' }),
    legacy({ id: '3' }),
  ];

  it('returns the SAME array reference when nothing is configured (byte stability)', () => {
    expect(applyProportionFilters(rows, null)).toBe(rows);
    expect(applyProportionFilters(rows, {})).toBe(rows);
    expect(applyProportionFilters(rows, { denominatorPopulation: '' })).toBe(rows);
  });

  it('keeps only the chosen category', () => {
    expect(applyProportionFilters(rows, { denominatorPopulation: 'all_patients_tested' }).map((r) => r.id)).toEqual(['1']);
  });

  it('the unclassified sentinel selects ONLY the legacy rows', () => {
    expect(applyProportionFilters(rows, { denominatorPopulation: UNCLASSIFIED_FILTER }).map((r) => r.id)).toEqual(['3']);
  });

  it('combines fields with AND', () => {
    expect(applyProportionFilters(rows, { denominatorPopulation: 'all_patients_tested', actionStatus: 'recommended_planned' })).toEqual([]);
  });

  it('filters free-text custom denominators on the normalised text', () => {
    const customs = [
      prop({ id: 'a', denominatorPopulation: 'other', denominatorCustom: 'Patients with a VUS' }),
      prop({ id: 'b', denominatorPopulation: 'other', denominatorCustom: 'Other cohort' }),
    ];
    expect(applyProportionFilters(customs, { denominatorCustom: 'patients with a vus' }).map((r) => r.id)).toEqual(['a']);
  });

  it('activeProportionFilters reports the configured pairs in a stable order', () => {
    expect(activeProportionFilters({ actionStatus: 'implemented', denominatorPopulation: 'other' }))
      .toEqual([['denominatorPopulation', 'other'], ['actionStatus', 'implemented']]);
    expect(activeProportionFilters(null)).toEqual([]);
  });
});

describe('override signature — consent is for a specific estimate set', () => {
  const mixed = [
    prop({ id: '1', author: 'Smith', year: '2024', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    prop({ id: '2', author: 'Lee', year: '2022', denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: 'implemented' }),
  ];
  const check = checkProportionCompatibility(mixed);
  const rec = buildProportionOverride(check, { at: '2026-08-09T10:11:12.000Z', by: 'Dr Reviewer', note: '  Both denominators are the tested cohort.  ' });

  it('records the conflicting fields, categories, timestamp, actor and rationale', () => {
    expect(rec.fields).toEqual(['denominatorPopulation']);
    expect(rec.categories).toEqual([
      { field: 'denominatorPopulation', value: 'plp_molecular_diagnoses', label: 'P/LP molecular diagnoses', count: 1 },
      { field: 'denominatorPopulation', value: 'all_patients_tested', label: 'All patients tested', count: 1 },
    ]);
    expect(rec.at).toBe('2026-08-09T10:11:12.000Z');
    expect(rec.by).toBe('Dr Reviewer');
    expect(rec.note).toBe('Both denominators are the tested cohort.');
    expect(rec.signature).toBe(proportionIssueSignature(check));
  });

  it('an empty rationale is stored as null, never as ""', () => {
    expect(buildProportionOverride(check, { at: 'x', note: '   ' }).note).toBeNull();
    expect(buildProportionOverride(check, { at: 'x' }).by).toBeNull();
  });

  it('matches while the estimate set is unchanged', () => {
    expect(proportionOverrideStale(rec, checkProportionCompatibility(mixed.slice()))).toBe(false);
  });

  it('goes stale when an estimate is added to the conflict', () => {
    const grown = mixed.concat([prop({ id: '3', author: 'Kim', year: '2021', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' })]);
    expect(proportionOverrideStale(rec, checkProportionCompatibility(grown))).toBe(true);
  });

  it('goes stale when the conflict is resolved (nothing left to override)', () => {
    const fixed = mixed.map((s) => ({ ...s, denominatorPopulation: 'all_patients_tested' }));
    const after = checkProportionCompatibility(fixed);
    expect(after.blocking).toBe(false);
    expect(proportionOverrideStale(rec, after)).toBe(true);
  });

  it('no override → never stale', () => {
    expect(proportionOverrideStale(null, check)).toBe(false);
  });

  it('describeOverrideCategories reads as one honest sentence', () => {
    expect(describeOverrideCategories(rec))
      .toBe('Denominator population: P/LP molecular diagnoses (1), All patients tested (1)');
    expect(overrideDateText(rec.at)).toBe('2026-08-09');
    expect(overrideDateText(null)).toBe('');
  });
});

describe('subgroupGroupLabel — display buckets never merge legacy with a real category', () => {
  it("maps '' / missing / unknown to the legacy label", () => {
    expect(subgroupGroupLabel('denominatorPopulation', '')).toBe(UNCLASSIFIED_GROUP_LABEL);
    expect(subgroupGroupLabel('denominatorPopulation', undefined)).toBe(UNCLASSIFIED_GROUP_LABEL);
    expect(subgroupGroupLabel('denominatorPopulation', 'Unspecified')).toBe(UNCLASSIFIED_GROUP_LABEL);
    expect(subgroupGroupLabel('actionStatus', '')).toBe(UNCLASSIFIED_GROUP_LABEL);
  });
  it('maps real values to their enum labels', () => {
    expect(subgroupGroupLabel('denominatorPopulation', 'all_patients_tested')).toBe('All patients tested');
    expect(subgroupGroupLabel('actionStatus', 'unclear')).toBe('Unclear');
  });
  it("'unclear' and the legacy bucket are DIFFERENT bucket names", () => {
    expect(subgroupGroupLabel('actionStatus', 'unclear')).not.toBe(subgroupGroupLabel('actionStatus', ''));
  });
  it('leaves unrelated grouping keys alone', () => {
    expect(subgroupGroupLabel('design', 'RCT')).toBe('RCT');
    expect(subgroupGroupLabel('design', '')).toBe('Unspecified');
  });
});

describe('persistence hygiene', () => {
  it('proportionFilterKey matches the outcome|||timepoint pair key', () => {
    expect(proportionFilterKey(' Diagnostic yield ', ' 12 months ')).toBe('Diagnostic yield|||12 months');
    expect(proportionFilterKey('', '')).toBe('|||');
  });
  it('sanitizeProportionFilters returns null when nothing is configured', () => {
    expect(sanitizeProportionFilters(null)).toBeNull();
    expect(sanitizeProportionFilters({})).toBeNull();
    expect(sanitizeProportionFilters({ 'a|||': {} })).toBeNull();
    expect(sanitizeProportionFilters({ 'a|||': { denominatorPopulation: '' } })).toBeNull();
  });
  it('sanitizeProportionFilters keeps configured entries', () => {
    expect(sanitizeProportionFilters({ 'a|||': { denominatorPopulation: 'other', bogus: 'x' } }))
      .toEqual({ 'a|||': { denominatorPopulation: 'other' } });
  });
  it('sanitizeProportionOverrides returns null when nothing is recorded', () => {
    expect(sanitizeProportionOverrides(null)).toBeNull();
    expect(sanitizeProportionOverrides({})).toBeNull();
    expect(sanitizeProportionOverrides({ k: { at: 'x' } })).toBeNull();  // no categories → not a record
  });
  it('sanitizeProportionOverrides normalises a record', () => {
    const out = sanitizeProportionOverrides({
      'a|||': { fields: ['actionStatus'], categories: [{ field: 'actionStatus', value: 'implemented', label: 'Implemented', count: 3 }], signature: 's', at: '2026-01-01T00:00:00Z', by: '', note: '' },
    });
    expect(out['a|||'].by).toBeNull();
    expect(out['a|||'].note).toBeNull();
    expect(out['a|||'].categories[0].count).toBe(3);
  });
});
