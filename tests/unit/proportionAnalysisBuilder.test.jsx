/**
 * proportionAnalysisBuilder.test.jsx — 107.md §10-§13. The analysis-builder half of the
 * per-estimate proportion metadata: the pre-analysis compatibility gate, the persisted
 * resolutions (filter / documented override), the two new stratification variables, and
 * the §13 "only when used" rule for outputs.
 *
 * House style: renderToStaticMarkup, no jsdom — initial render only, effects never run.
 * AnalysisTab/SubgroupTab auto-select when a project has exactly ONE outcome pair
 * (`outcomePairs.length===1` short-circuits the selector), which is what makes the full
 * surface reachable in SSR.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AnalysisTab, SubgroupTab, SensitivityTab, ResearchExport,
  enumerateOutcomePairs, studiesForPair, pairIsProportion, groupRowsForSubgroup,
  writeProportionFilter, writeProportionOverride, overrideActorName, detectCovariates,
} from '../../src/frontend/workspace/tabs/analysisTabs.jsx';
import { subgroupAnalysis } from '../../src/research-engine/statistics/monolithStats.js';
import {
  checkProportionCompatibility, buildProportionOverride, proportionExportFields,
  proportionExportMetaRows, ALL_UNCLASSIFIED_NOTE, UNCLASSIFIED_GROUP_LABEL,
} from '../../src/research-engine/statistics/proportionCompatibility.js';
import { analysisSettings, buildReproManifest } from '../../src/research-engine/manuscript/readiness.js';

const OUTCOME = 'Diagnostic yield';
const KEY = `${OUTCOME}|||`;

/** A pooled-ready PROP estimate on the logit scale (calcES('PROP') output shape). */
const prop = (over = {}) => ({
  id: 'r1', author: 'Smith', year: '2024', outcome: OUTCOME, timepoint: '', esType: 'PROP',
  es: '-0.43', lo: '-1.01', hi: '0.15', events: '23', total: '59',
  design: 'cohort', adjusted: 'unadjusted', dataNature: 'primary', source: 'reported',
  denominatorPopulation: 'all_patients_tested', denominatorCustom: '', actionStatus: 'implemented',
  ...over,
});
/** The same estimate as a project saved BEFORE 107.md §8 stored it: keys absent. */
const legacy = (over = {}) => {
  const s = prop(over);
  delete s.denominatorPopulation; delete s.denominatorCustom; delete s.actionStatus;
  return s;
};
const project = (studies, analysisSettingsBlob) => ({
  name: 'P', studies, ...(analysisSettingsBlob ? { analysisSettings: analysisSettingsBlob } : {}),
});
const noop = () => {};
const renderAnalysis = (p, extra) => renderToStaticMarkup(
  createElement(AnalysisTab, { project: p, updateProject: noop, ...extra }));

const HOMOGENEOUS = [
  prop({ id: '1', author: 'Smith', year: '2024' }),
  prop({ id: '2', author: 'Jones', year: '2023', es: '-0.20', lo: '-0.80', hi: '0.40' }),
  prop({ id: '3', author: 'Kim', year: '2021', es: '-0.60', lo: '-1.20', hi: '0.00' }),
];
const MIXED = [
  prop({ id: '1', author: 'Smith', year: '2024' }),
  prop({ id: '2', author: 'Jones', year: '2023', es: '-0.20', lo: '-0.80', hi: '0.40' }),
  prop({ id: '3', author: 'Lee', year: '2022', es: '0.90', lo: '0.30', hi: '1.50', denominatorPopulation: 'plp_molecular_diagnoses' }),
];
const ALL_LEGACY = [
  legacy({ id: '1', author: 'Old', year: '2011' }),
  legacy({ id: '2', author: 'Older', year: '2009', es: '-0.20', lo: '-0.80', hi: '0.40' }),
];

/* ══════════════════ shared outcome-pair scoping ══════════════════ */

describe('shared outcome scoping helpers', () => {
  const rows = [
    prop({ id: '1' }),
    prop({ id: '2', outcome: 'Management change' }),
    prop({ id: '3', extractionMeta: { includedInAnalysis: false } }),
    prop({ id: '4', es: '' }),
  ];
  it('enumerates one pair per outcome|||timepoint, skipping excluded/ES-less rows', () => {
    expect(enumerateOutcomePairs(rows).map((p) => p.key)).toEqual([KEY, 'Management change|||']);
  });
  it('studiesForPair applies isExcludedFromAnalysis (the 86.md P1.6 defect)', () => {
    const pair = enumerateOutcomePairs(rows)[0];
    expect(studiesForPair(rows, pair).map((s) => s.id)).toEqual(['1']);
    expect(studiesForPair(rows, null)).toEqual([]);
  });
  it('pairIsProportion reads the pair measure, falling back to the dominant one', () => {
    expect(pairIsProportion({ esType: 'PROP' })).toBe(true);
    expect(pairIsProportion({ esType: '' }, 'PROP')).toBe(true);
    expect(pairIsProportion({ esType: 'OR' })).toBe(false);
    expect(pairIsProportion(null, '')).toBe(false);
  });
});

/* ══════════════════ AnalysisTab — the §11 warning card ══════════════════ */

describe('AnalysisTab — homogeneous proportions are untouched', () => {
  const html = renderAnalysis(project(HOMOGENEOUS));
  it('pools and shows no compatibility card or note', () => {
    expect(html).toContain('POOLED EFFECT');
    expect(html).not.toContain('Incompatible');
    expect(html).not.toContain('OTHER WAYS TO RESOLVE THIS');
    expect(html).not.toContain(UNCLASSIFIED_GROUP_LABEL);
  });
});

describe('AnalysisTab — a non-PROP outcome never sees any of this', () => {
  const or = HOMOGENEOUS.map((s, i) => ({
    ...s, esType: 'OR',
    denominatorPopulation: i === 0 ? 'all_patients_tested' : 'plp_molecular_diagnoses',
  }));
  const html = renderAnalysis(project(or));
  it('renders the pooled result with no compatibility panel', () => {
    expect(html).toContain('POOLED EFFECT');
    expect(html).not.toContain('Incompatible');
    expect(html).not.toContain('ESTIMATES FILTERED');
  });
});

describe('AnalysisTab — mixed denominator populations block the pooled result', () => {
  const html = renderAnalysis(project(MIXED));

  it('names the conflicting variable and the 107.md §11 headline', () => {
    expect(html).toContain('Incompatible denominator population');
    expect(html).toContain('The selected estimates use multiple denominator populations:');
  });
  it('lists every value with its estimate count', () => {
    expect(html).toContain('P/LP molecular diagnoses');
    expect(html).toContain('All patients tested');
    expect(html).toContain('2 estimates');
    expect(html).toContain('1 estimate');
  });
  it('reports the total affected and the affected studies', () => {
    expect(html).toContain('3 estimates affected');
    expect(html).toContain('Smith 2024');
    expect(html).toContain('Lee 2022');
    expect(html).toContain('These proportions may not estimate the same quantity.');
  });
  it('gates the pooled result instead of silently proceeding', () => {
    expect(html).toContain('Result hidden until you confirm');
    expect(html).not.toContain('POOLED EFFECT');
  });
  it('offers all five resolution paths (107.md §12)', () => {
    expect(html).toContain('Only All patients tested');            // 1 filter
    expect(html).toContain('Group by the variable instead');       // 2 stratify
    expect(html).toContain('Correct the extraction metadata');     // 3 fix metadata
    expect(html).toContain('Exclude the problematic estimates');   // 4 exclude
    expect(html).toContain('Pool anyway (record override)');       // 5 documented override
  });
  it('offers "only unclassified" honestly labelled when legacy rows are in the mix', () => {
    const withLegacy = renderAnalysis(project(HOMOGENEOUS.slice(0, 2).concat([legacy({ id: '9', author: 'Old', year: '2011', es: '0.9', lo: '0.3', hi: '1.5' })])));
    expect(withLegacy).toContain(`Only ${UNCLASSIFIED_GROUP_LABEL}`);
    expect(withLegacy).toContain('mix a classified denominator population with unclassified legacy records');
  });
});

describe('AnalysisTab — an all-legacy outcome keeps pooling (107.md §21 guard)', () => {
  const html = renderAnalysis(project(ALL_LEGACY));
  it('shows the small informational note, not a wall', () => {
    expect(html).toContain(ALL_UNCLASSIFIED_NOTE);
    expect(html).not.toContain('Incompatible');
    expect(html).not.toContain('Result hidden until you confirm');
    expect(html).toContain('POOLED EFFECT');
  });
});

/* ══════════════════ AnalysisTab — persisted resolutions ══════════════════ */

describe('AnalysisTab — a persisted filter survives reopen and unblocks the pool', () => {
  const html = renderAnalysis(project(MIXED, { proportionFilters: { [KEY]: { denominatorPopulation: 'all_patients_tested' } } }));
  it('renders the filter chip with a clear affordance', () => {
    expect(html).toContain('ESTIMATES FILTERED');
    expect(html).toContain('Denominator population: All patients tested');
    expect(html).toContain('Clear the Denominator population filter');
  });
  it('pools only the matching estimates and drops the warning', () => {
    expect(html).toContain('POOLED EFFECT');
    expect(html).not.toContain('Incompatible');
    expect(html).toContain('k = 2');
  });
  it('the chip still renders when the filter leaves too few estimates to pool', () => {
    const one = renderAnalysis(project(MIXED, { proportionFilters: { [KEY]: { denominatorPopulation: 'plp_molecular_diagnoses' } } }));
    expect(one).toContain('ESTIMATES FILTERED');
    expect(one).toContain('Clear the Denominator population filter');
    expect(one).toContain('No pooled result for the current filter');
  });
});

describe('AnalysisTab — the documented override (107.md §12)', () => {
  const check = checkProportionCompatibility(MIXED);
  const record = buildProportionOverride(check, {
    at: '2026-08-09T09:00:00.000Z', by: 'Dr Reviewer', note: 'Both denominators are the tested cohort.',
  });

  it('a matching override renders the persistent banner and the result', () => {
    const html = renderAnalysis(project(MIXED, { proportionOverrides: { [KEY]: record } }));
    expect(html).toContain('Compatibility warning overridden 2026-08-09');
    expect(html).toContain('Denominator population: P/LP molecular diagnoses (1), All patients tested (2)');
    expect(html).toContain('Both denominators are the tested cohort.');
    expect(html).toContain('Recorded by Dr Reviewer');
    expect(html).toContain('Clear override');
    expect(html).toContain('POOLED EFFECT');
    expect(html).not.toContain('Incompatible denominator population');
  });

  it('a STALE override is neither honoured nor deleted — the warning comes back', () => {
    const grown = MIXED.concat([prop({ id: '4', author: 'Park', year: '2020', es: '0.5', lo: '0.1', hi: '0.9', denominatorPopulation: 'plp_molecular_diagnoses' })]);
    const html = renderAnalysis(project(grown, { proportionOverrides: { [KEY]: record } }));
    expect(html).toContain('Recorded override is out of date');
    expect(html).toContain('Clear the stale override');
    expect(html).toContain('Incompatible denominator population');
    expect(html).toContain('Result hidden until you confirm');
    expect(html).not.toContain('POOLED EFFECT');
  });
});

/* ══════════════════ the pure blob writers ══════════════════ */

describe('writeProportionFilter / writeProportionOverride — pure, and self-pruning', () => {
  it('writes and clears a filter without leaving empty containers behind', () => {
    const p0 = { studies: [] };
    const p1 = writeProportionFilter(p0, KEY, 'denominatorPopulation', 'other');
    expect(p1.analysisSettings.proportionFilters[KEY]).toEqual({ denominatorPopulation: 'other' });
    expect(p0.analysisSettings).toBeUndefined();                       // input untouched
    const p2 = writeProportionFilter(p1, KEY, 'denominatorPopulation', null);
    expect(p2.analysisSettings.proportionFilters).toBeUndefined();     // no empty husk
  });
  it('keeps every other analysisSettings key', () => {
    const p = writeProportionFilter({ analysisSettings: { tau2Method: 'REML' } }, KEY, 'actionStatus', 'implemented');
    expect(p.analysisSettings.tau2Method).toBe('REML');
  });
  it('is idempotent under repeated application (CAS retries re-run updaters)', () => {
    const once = writeProportionFilter({}, KEY, 'actionStatus', 'implemented');
    expect(writeProportionFilter(once, KEY, 'actionStatus', 'implemented')).toEqual(once);
  });
  it('stores and clears an override record', () => {
    const rec = { fields: ['actionStatus'], categories: [], signature: 's', at: 'x', by: null, note: null };
    const p1 = writeProportionOverride({}, KEY, rec);
    expect(p1.analysisSettings.proportionOverrides[KEY]).toBe(rec);
    expect(writeProportionOverride(p1, KEY, null).analysisSettings.proportionOverrides).toBeUndefined();
  });
  it('overrideActorName prefers a display name, then email, else null', () => {
    expect(overrideActorName({ name: 'Ada', email: 'a@b.c' })).toBe('Ada');
    expect(overrideActorName({ email: 'a@b.c' })).toBe('a@b.c');
    expect(overrideActorName({ name: '  ' })).toBeNull();
    expect(overrideActorName(null)).toBeNull();
  });
});

/* ══════════════════ SubgroupTab — §10 stratification ══════════════════ */

describe('SubgroupTab — the two new grouping keys', () => {
  const rows = [
    prop({ id: '1', author: 'A' }),
    prop({ id: '2', author: 'B', es: '-0.20', lo: '-0.80', hi: '0.40' }),
    prop({ id: '3', author: 'C', es: '0.90', lo: '0.30', hi: '1.50', actionStatus: 'unclear' }),
    prop({ id: '4', author: 'D', es: '0.70', lo: '0.10', hi: '1.30', actionStatus: 'unclear' }),
    legacy({ id: '5', author: 'E', es: '0.10', lo: '-0.50', hi: '0.70' }),
    legacy({ id: '6', author: 'F', es: '0.30', lo: '-0.30', hi: '0.90' }),
  ];
  const html = renderToStaticMarkup(createElement(SubgroupTab, { project: project(rows) }));

  it('offers Denominator population and Action status for a PROP outcome', () => {
    expect(html).toContain('Denominator population');
    expect(html).toContain('Action status');
  });
  it('does not offer them for a non-PROP outcome', () => {
    const or = rows.map((s) => ({ ...s, esType: 'OR' }));
    const h = renderToStaticMarkup(createElement(SubgroupTab, { project: project(or) }));
    expect(h).not.toContain('Denominator population');
    expect(h).not.toContain('Action status');
  });
  it('scopes to one outcome pair and shows the estimate count', () => {
    expect(html).toContain('6 estimates');
    const two = rows.concat([prop({ id: '7', outcome: 'Management change', author: 'G' })]);
    const h = renderToStaticMarkup(createElement(SubgroupTab, { project: project(two) }));
    expect(h).toContain('— select an outcome —');
    expect(h).toContain('Select an outcome above — subgroups are computed within a single outcome.');
  });
  it('shows the active proportion filter as a badge (read-only here)', () => {
    const h = renderToStaticMarkup(createElement(SubgroupTab, {
      project: project(rows, { proportionFilters: { [KEY]: { actionStatus: 'unclear' } } }),
    }));
    expect(h).toContain('Action status: Unclear');
    expect(h).toContain('2 estimates');
  });
});

describe('SubgroupTab bucket mapping — the pure transform the tab feeds subgroupAnalysis', () => {
  const rows = [
    prop({ id: '1', author: 'A', actionStatus: 'unclear' }),
    prop({ id: '2', author: 'B', es: '-0.20', lo: '-0.80', hi: '0.40', actionStatus: 'unclear' }),
    legacy({ id: '3', author: 'E', es: '0.10', lo: '-0.50', hi: '0.70' }),
    legacy({ id: '4', author: 'F', es: '0.30', lo: '-0.30', hi: '0.90' }),
    prop({ id: '5', author: 'G', es: '0.50', lo: '-0.10', hi: '1.10', actionStatus: 'made_up' }),
    prop({ id: '6', author: 'H', es: '0.70', lo: '0.10', hi: '1.30', actionStatus: 'made_up' }),
  ];

  it("buckets 'unclear' and the legacy rows into DIFFERENT groups, never merged", () => {
    const res = subgroupAnalysis(groupRowsForSubgroup(rows, 'actionStatus'), 'actionStatus', 'random');
    const names = res.groups.map((g) => g.group).sort();
    expect(names).toEqual([UNCLASSIFIED_GROUP_LABEL, 'Unclear']);
    expect(res.groups.find((g) => g.group === 'Unclear').n).toBe(2);
    // the '' rows AND the unknown hand-edited value land in the one honest legacy bucket
    expect(res.groups.find((g) => g.group === UNCLASSIFIED_GROUP_LABEL).n).toBe(4);
  });

  it('resolves denominator populations to their enum labels', () => {
    const mixed = groupRowsForSubgroup([
      prop({ id: '1' }), prop({ id: '2', denominatorPopulation: 'plp_molecular_diagnoses' }),
    ], 'denominatorPopulation');
    expect(mixed.map((s) => s.denominatorPopulation)).toEqual(['All patients tested', 'P/LP molecular diagnoses']);
  });

  it('passes the six legacy grouping keys straight through (same array reference)', () => {
    expect(groupRowsForSubgroup(rows, 'design')).toBe(rows);
    expect(groupRowsForSubgroup(rows, 'country')).toBe(rows);
  });
  it('shows the active proportion filter as a badge (read-only here)', () => {
    const h = renderToStaticMarkup(createElement(SubgroupTab, {
      project: project(rows, { proportionFilters: { [KEY]: { actionStatus: 'unclear' } } }),
    }));
    expect(h).toContain('Action status: Unclear');
    expect(h).toContain('2 estimates');
  });
});

describe('SensitivityTab — outcome scoping (86.md P1.6)', () => {
  it('asks for an outcome instead of pooling across all of them', () => {
    const rows = HOMOGENEOUS.concat([
      prop({ id: '8', outcome: 'Management change', author: 'G' }),
      prop({ id: '9', outcome: 'Management change', author: 'H', es: '0.5', lo: '0.1', hi: '0.9' }),
    ]);
    const h = renderToStaticMarkup(createElement(SensitivityTab, { project: project(rows) }));
    expect(h).toContain('Robustness checks run on one outcome at a time.');
    expect(h).toContain('Select an outcome above — each outcome is assessed separately.');
  });
  it('runs normally for a single-outcome project', () => {
    const h = renderToStaticMarkup(createElement(SensitivityTab, { project: project(HOMOGENEOUS) }));
    expect(h).toContain('LEAVE-ONE-OUT ANALYSIS');
    expect(h).not.toContain('Select an outcome above');
  });
});

/* ══════════════════ meta-regression deny-list / labels ══════════════════ */

describe('detectCovariates — 107.md §10 moderators', () => {
  const rows = [
    prop({ id: '1', denominatorCustom: 'Patients with a VUS' }),
    prop({ id: '2', author: 'B', actionStatus: 'unclear', denominatorCustom: 'Patients re-tested' }),
    prop({ id: '3', author: 'C', denominatorPopulation: 'plp_molecular_diagnoses', denominatorCustom: 'Something else' }),
  ];
  const byField = Object.fromEntries(detectCovariates(rows).map((c) => [c.field, c]));
  it('keeps the two classifications discoverable as categorical moderators', () => {
    expect(byField.denominatorPopulation && byField.denominatorPopulation.type).toBe('binary');
    expect(byField.actionStatus && byField.actionStatus.type).toBe('binary');
  });
  it('BLOCKS the free-text custom denominator', () => {
    expect(byField.denominatorCustom).toBeUndefined();
  });
});

/* ══════════════════ §13 outputs — only when used ══════════════════ */

describe('ResearchExport metadata/columns — empty unless a filter or override is in force', () => {
  it('adds nothing at all when neither is used (byte-identical export)', () => {
    expect(proportionExportFields(null, null)).toEqual([]);
    expect(proportionExportMetaRows(null, null)).toEqual([]);
    expect(proportionExportFields({}, null)).toEqual([]);
  });
  it('adds the filtered field as a column and a metadata line', () => {
    expect(proportionExportFields({ denominatorPopulation: 'all_patients_tested' }, null)).toEqual(['denominatorPopulation']);
    expect(proportionExportMetaRows({ denominatorPopulation: 'all_patients_tested' }, null))
      .toEqual([['Denominator population filter', 'All patients tested']]);
  });
  it('adds the override lines including the rationale', () => {
    const rec = buildProportionOverride(checkProportionCompatibility(MIXED), { at: '2026-08-09T09:00:00.000Z', by: 'Dr R', note: 'Same cohort.' });
    expect(proportionExportMetaRows(null, rec)).toEqual([
      ['Compatibility override', '2026-08-09 — Denominator population: P/LP molecular diagnoses (1), All patients tested (2)'],
      ['Compatibility override recorded by', 'Dr R'],
      ['Compatibility override rationale', 'Same cohort.'],
    ]);
    expect(proportionExportFields(null, rec)).toEqual(['denominatorPopulation']);
  });
  it('the rendered export block is unchanged when the new props are absent', () => {
    const result = { k: 2, studies: [], fixed: { es: 0, lo: -1, hi: 1 }, random: { es: 0, lo: -1, hi: 1 }, I2: 0, tau2: 0, Q: 0, Qpval: 1, pval: 1, tau2Method: 'DL' };
    const base = renderToStaticMarkup(createElement(ResearchExport, { result, esType: 'PROP', method: 'random', studies: [] }));
    const withNulls = renderToStaticMarkup(createElement(ResearchExport, { result, esType: 'PROP', method: 'random', studies: [], proportionFilters: null, proportionOverride: null }));
    expect(withNulls).toBe(base);
  });
});

describe('reproducibility config carries the selection (107.md §12/§13)', () => {
  const filters = { [KEY]: { denominatorPopulation: 'all_patients_tested' } };
  const override = { [KEY]: buildProportionOverride(checkProportionCompatibility(MIXED), { at: '2026-08-09T09:00:00.000Z' }) };

  it('analysisSettings omits both keys when unused', () => {
    const s = analysisSettings(project(HOMOGENEOUS), {});
    expect('proportionFilters' in s).toBe(false);
    expect('proportionOverrides' in s).toBe(false);
  });
  it('analysisSettings includes them when present', () => {
    const s = analysisSettings(project(MIXED, { proportionFilters: filters, proportionOverrides: override }), {});
    expect(s.proportionFilters).toEqual(filters);
    expect(s.proportionOverrides[KEY].signature).toBe(override[KEY].signature);
  });
  it('empty maps are treated as unused', () => {
    const s = analysisSettings(project(MIXED, { proportionFilters: {}, proportionOverrides: {} }), {});
    expect('proportionFilters' in s).toBe(false);
    expect('proportionOverrides' in s).toBe(false);
  });
  it('buildReproManifest surfaces them at the top level, and is unchanged otherwise', () => {
    const plain = buildReproManifest({ analysisSettings: { tau2Method: 'DL' } });
    expect('proportionFilters' in plain).toBe(false);
    expect('proportionOverrides' in plain).toBe(false);

    const rich = buildReproManifest({ analysisSettings: { tau2Method: 'DL', proportionFilters: filters, proportionOverrides: override } });
    expect(rich.proportionFilters).toEqual(filters);
    expect(rich.proportionOverrides[KEY].at).toBe('2026-08-09T09:00:00.000Z');
  });
});
