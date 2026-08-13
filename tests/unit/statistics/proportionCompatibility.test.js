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
 *
 * 116.md §41/§49 — deliberately RE-PINNED from the 107.md behaviour:
 *  - ONE real category + unclassified rows is now a WARNING (`check.warnings`), not a
 *    block: the pool proceeds with a visible advisory naming the unclassified count.
 *    The unclassified rows keep their OWN line and are still never merged/grouped
 *    into a real category. ≥2 real categories (or ≥2 different custom definitions)
 *    still BLOCK behind the persisted filter/override flow.
 *  - `isPoolableRow` now inspects runMeta's poolable VIEW: a PROP row with valid raw
 *    events/total and NO stored es/lo/hi is poolable (derived at the analysis
 *    boundary), so its metadata enters the check and the override signature.
 */
import { describe, it, expect } from 'vitest';
import {
  checkProportionCompatibility, applyProportionFilters, activeProportionFilters,
  proportionIssueSignature, proportionOverrideStale, buildProportionOverride,
  describeOverrideCategories, overrideDateText, subgroupGroupLabel, proportionFilterKey,
  sanitizeProportionFilters, sanitizeProportionOverrides, isPoolableRow, poolableRows,
  proportionValueLabel,
  UNCLASSIFIED_GROUP_LABEL, UNCLASSIFIED_FILTER,
} from '../../../src/research-engine/statistics/proportionCompatibility.js';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

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

describe('checkProportionCompatibility — real + unclassified WARNS (116.md §49), reported separately', () => {
  const rows = [
    prop({ id: '1', author: 'Smith', year: '2024', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    prop({ id: '2', author: 'Jones', year: '2023', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    legacy({ id: '3', author: 'Old', year: '2011' }),
  ];
  const c = checkProportionCompatibility(rows);
  const warnByField = (check) => Object.fromEntries(check.warnings.map((i) => [i.field, i]));

  // 116.md §49 — the mid-classification state must not make Analysis show nothing:
  // it is a WARNING (pool proceeds, advisory shown), never a block.
  it('WARNS on BOTH fields (each has one real category plus legacy rows) without blocking', () => {
    expect(c.blocking).toBe(false);
    expect(c.warning).toBe(true);
    expect(c.issues).toEqual([]);
    expect(c.warnings.map((i) => i.field).sort()).toEqual(['actionStatus', 'denominatorPopulation']);
    expect(c.warnings.every((i) => i.kind === 'category-and-unclassified')).toBe(true);
    expect(c.infoOnly).toBe(false);   // the warning card supersedes the §21 info note
  });

  it('lists the legacy rows as their own line, last, never merged into a category', () => {
    const issue = warnByField(c).denominatorPopulation;
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
    const issue = warnByField(c2).actionStatus;
    expect(issue).toBeTruthy();                       // 'unclear' + legacy is still reported
    expect(issue.values.map((v) => v.label)).toEqual(['Unclear', UNCLASSIFIED_GROUP_LABEL]);
    expect(issue.values.map((v) => v.count)).toEqual([1, 1]);
    expect(c2.blocking).toBe(false);                  // …but as a warning, not a wall
  });

  it('treats an unknown/hand-edited value as unclassified, not as a third category', () => {
    const c2 = checkProportionCompatibility([
      prop({ id: '1', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
      prop({ id: '2', denominatorPopulation: 'made_up_value', actionStatus: 'implemented' }),
    ]);
    const issue = warnByField(c2).denominatorPopulation;
    expect(issue.values.map((v) => v.label)).toEqual(['All patients tested', UNCLASSIFIED_GROUP_LABEL]);
    expect(c2.blocking).toBe(false);
  });

  // 116.md §49 — the block tier is reserved for ≥2 REAL categories.
  it('two real categories still BLOCK (unchanged 107.md semantics)', () => {
    const c2 = checkProportionCompatibility([
      prop({ id: '1', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
      prop({ id: '2', denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: 'implemented' }),
      legacy({ id: '3' }),
    ]);
    expect(c2.blocking).toBe(true);
    expect(c2.issues.map((i) => i.field)).toEqual(['denominatorPopulation']);
    // the legacy row still rides the blocking issue's value list, on its own line
    const issue = byField(c2).denominatorPopulation;
    expect(issue.values[issue.values.length - 1].label).toBe(UNCLASSIFIED_GROUP_LABEL);
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

  // 116.md §49 — one real description + undescribed rows is the mid-classification
  // state: reported as a WARNING (pool proceeds), the undescribed row on its own line.
  it('an undescribed Other/custom row is its own WARNING line, named honestly', () => {
    const c = checkProportionCompatibility([other('1', 'Patients with a VUS'), other('2', '')]);
    expect(c.blocking).toBe(false);
    const issue = c.warnings.find((i) => i.field === 'denominatorCustom');
    expect(issue).toBeTruthy();
    expect(issue.kind).toBe('category-and-unclassified');
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

  // 107.md r2 — a row whose population moved away from 'other' but still carries the old
  // text must not answer a denominatorCustom filter; it reads as unclassified instead.
  it('stale custom text on a non-other row does not match a custom filter', () => {
    const customs = [
      prop({ id: 'a', denominatorPopulation: 'other', denominatorCustom: 'Patients with a VUS' }),
      prop({ id: 'stale', denominatorPopulation: 'all_patients_tested', denominatorCustom: 'Patients with a VUS' }),
    ];
    expect(applyProportionFilters(customs, { denominatorCustom: 'patients with a vus' }).map((r) => r.id)).toEqual(['a']);
    expect(applyProportionFilters(customs, { denominatorCustom: UNCLASSIFIED_FILTER }).map((r) => r.id)).toEqual(['stale']);
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

/* ══════════════ the check runs on the rows runMeta actually pools ══════════════ */

describe('poolable subset — the check describes the pool, not every ES-bearing row', () => {
  const full = (id, denom) => prop({ id, author: 'A' + id, denominatorPopulation: denom, actionStatus: 'implemented' });
  /** An effect size with no 95% CI: extracted, but never weighted by runMeta. */
  const noCI = (id, denom) => prop({ id, author: 'A' + id, lo: '', hi: '', denominatorPopulation: denom, actionStatus: 'implemented' });

  it('isPoolableRow is runMeta’s own predicate (view-aware, 116.md §41)', () => {
    expect(isPoolableRow(prop())).toBe(true);
    // A stored numeric es with a blank CI stays UNpoolable — the stored effect wins
    // and is never shadowed by a raw-data derivation.
    expect(isPoolableRow(prop({ lo: '' }))).toBe(false);
    expect(isPoolableRow(prop({ hi: '' }))).toBe(false);
    // 116.md §41 — es blank + valid raw events/total → poolable via the derived view.
    expect(isPoolableRow(prop({ es: '' }))).toBe(true);
    // …but not when the raw data is missing or invalid.
    expect(isPoolableRow(prop({ es: '', events: '' }))).toBe(false);
    expect(isPoolableRow(prop({ es: '', total: '' }))).toBe(false);
    expect(isPoolableRow(prop({ es: '', events: '90', total: '59' }))).toBe(false);
    expect(isPoolableRow(prop({ hi: 'abc' }))).toBe(false);
    expect(isPoolableRow(null)).toBe(false);
    // and it really agrees with runMeta on the same rows
    const rows = [full('1', 'all_patients_tested'), full('2', 'all_patients_tested'), noCI('3', 'all_patients_tested')];
    expect(runMeta(rows, 'random').k).toBe(rows.filter(isPoolableRow).length);
    // agreement holds for raw-only rows too
    const rawRows = [full('1', 'all_patients_tested'), prop({ id: 'r', es: '', lo: '', hi: '' })];
    expect(runMeta(rawRows, 'random').k).toBe(rawRows.filter(isPoolableRow).length);
  });

  it('poolableRows returns the SAME array when nothing is dropped (byte stability)', () => {
    const rows = [full('1', 'all_patients_tested'), full('2', 'all_patients_tested')];
    expect(poolableRows(rows)).toBe(rows);
    expect(poolableRows(rows.concat([noCI('3', 'other')])).map((r) => r.id)).toEqual(['1', '2']);
    expect(poolableRows([])).toEqual([]);
    expect(poolableRows(null)).toEqual([]);
  });

  it('a CI-less row of another category does NOT create a false block', () => {
    const c = checkProportionCompatibility([
      full('1', 'all_patients_tested'), full('2', 'all_patients_tested'),
      noCI('3', 'plp_molecular_diagnoses'),
    ]);
    expect(c.blocking).toBe(false);
    expect(c.propCount).toBe(2);              // only the rows the diamond is drawn from
  });

  it('the same row DOES block once its CI is entered', () => {
    const c = checkProportionCompatibility([
      full('1', 'all_patients_tested'), full('2', 'all_patients_tested'),
      full('3', 'plp_molecular_diagnoses'),
    ]);
    expect(c.blocking).toBe(true);
    expect(c.propCount).toBe(3);
  });
});

/* ══════════════ the signature identifies its MEMBERS, not just counts ══════════════ */

describe('override signature — member identity, not just per-value counts', () => {
  const row = (id, denom) => prop({ id, author: 'A' + id, denominatorPopulation: denom, actionStatus: 'implemented' });
  const base = [
    row('1', 'all_patients_tested'), row('2', 'all_patients_tested'),
    row('3', 'plp_molecular_diagnoses'), row('4', 'plp_molecular_diagnoses'),
  ];
  const check = checkProportionCompatibility(base);
  const rec = buildProportionOverride(check, { at: '2026-08-09T10:00:00.000Z' });

  it('is versioned so a legacy fingerprint is recognisable', () => {
    expect(proportionIssueSignature(check).startsWith('v2|')).toBe(true);
    expect(proportionIssueSignature({ issues: [] })).toBe('');
  });

  it('does not change when the rows are merely reordered', () => {
    const shuffled = [base[3], base[0], base[2], base[1]];
    expect(proportionOverrideStale(rec, checkProportionCompatibility(shuffled))).toBe(false);
  });

  it('goes stale on an OFFSETTING metadata swap that leaves both counts identical', () => {
    const swapped = base.map((s) => (s.id === '1' ? { ...s, denominatorPopulation: 'plp_molecular_diagnoses' }
      : s.id === '3' ? { ...s, denominatorPopulation: 'all_patients_tested' } : s));
    const after = checkProportionCompatibility(swapped);
    // counts are untouched — 2 and 2 — which is exactly what the count-only signature missed
    expect(after.issues[0].values.map((v) => v.count)).toEqual(check.issues[0].values.map((v) => v.count));
    expect(proportionOverrideStale(rec, after)).toBe(true);
  });

  it('goes stale when a row ENTERS the pool because its CI was filled in', () => {
    const pending = base.concat([prop({ id: '5', author: 'A5', lo: '', hi: '', denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: 'implemented' })]);
    // while the CI is blank the row is not pooled, so the override still describes the pool
    expect(proportionOverrideStale(rec, checkProportionCompatibility(pending))).toBe(false);
    const filled = pending.map((s) => (s.id === '5' ? { ...s, lo: '-0.5', hi: '0.5' } : s));
    expect(proportionOverrideStale(rec, checkProportionCompatibility(filled))).toBe(true);
  });

  it('a persisted count-only (pre-v2) signature is treated as STALE, never honoured', () => {
    const legacySig = 'denominatorPopulation:plp_molecular_diagnoses=2,all_patients_tested=2';
    expect(proportionOverrideStale({ signature: legacySig }, check)).toBe(true);
    // even against the very check that produced it under the old scheme
    expect(proportionOverrideStale({ ...rec, signature: legacySig }, check)).toBe(true);
  });

  it('the persisted record shape is unchanged — the digest lives only in the signature', () => {
    expect(rec.categories.every((c) => Object.keys(c).sort().join(',') === 'count,field,label,value')).toBe(true);
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

  // 107.md §8E review fix — the label maps are plain objects, so a bare `map[v]` lookup
  // reads Object.prototype members as truthy "labels". Registry membership, not truthiness.
  it('an inherited Object.prototype key is unclassified, never a Function label', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(subgroupGroupLabel('denominatorPopulation', key)).toBe(UNCLASSIFIED_GROUP_LABEL);
      expect(subgroupGroupLabel('actionStatus', key)).toBe(UNCLASSIFIED_GROUP_LABEL);
      expect(proportionValueLabel('denominatorPopulation', key)).toBe(UNCLASSIFIED_GROUP_LABEL);
      expect(proportionValueLabel('actionStatus', key)).toBe(UNCLASSIFIED_GROUP_LABEL);
    }
  });

  it('proportionValueLabel still resolves real keys and names the legacy state honestly', () => {
    expect(proportionValueLabel('denominatorPopulation', 'all_patients_tested')).toBe('All patients tested');
    expect(proportionValueLabel('actionStatus', 'unclear')).toBe('Unclear');
    expect(proportionValueLabel('denominatorPopulation', '')).toBe(UNCLASSIFIED_GROUP_LABEL);
    expect(proportionValueLabel('denominatorCustom', 'Patients with a VUS')).toBe('Patients with a VUS');
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
