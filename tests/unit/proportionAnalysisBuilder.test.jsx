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
  AnalysisTab, SubgroupTab, SensitivityTab, ForestTab, ResearchExport,
  enumerateOutcomePairs, studiesForPair, pairIsProportion, groupRowsForSubgroup,
  writeProportionFilter, writeProportionOverride, overrideActorName, detectCovariates,
  proportionGate, dominantEsType, crossPairRowsForGrouping, buildOutcomeSummaryRows,
  crossPairScopeNote, CROSS_PAIR_SCOPE_HEADLINE, proportionClassCell,
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
    // 116.md §41 — deliberately RE-PINNED: row 4 (es:'' but valid events/total) is now
    // analyzable through the derived view; the excluded row 3 still never appears.
    expect(studiesForPair(rows, pair).map((s) => s.id)).toEqual(['1', '4']);
    const derived = studiesForPair(rows, pair).find((s) => s.id === '4');
    expect(derived._derivedEs).toBe(true);
    expect(derived.es).not.toBe('');
    // …and the derivation is a computed VIEW: the stored row is untouched.
    expect(rows.find((s) => s.id === '4').es).toBe('');
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

/* ══════════════════ the SHARED gate — no tab may bypass it ══════════════════ */

const OVERRIDE_MIXED = buildProportionOverride(checkProportionCompatibility(MIXED), {
  at: '2026-08-09T09:00:00.000Z', by: 'Dr Reviewer', note: 'Both denominators are the tested cohort.',
});
const PAIR = enumerateOutcomePairs(MIXED)[0];
const renderForest = (p) => renderToStaticMarkup(createElement(ForestTab, { project: p }));
const renderSensitivity = (p) => renderToStaticMarkup(createElement(SensitivityTab, { project: p }));

describe('proportionGate — one derivation for AnalysisTab, ForestTab, SensitivityTab and the summary table', () => {
  it('blocks a mixed PROP pair and clears a homogeneous one', () => {
    expect(proportionGate(project(MIXED), PAIR, MIXED).blocked).toBe(true);
    expect(proportionGate(project(HOMOGENEOUS), PAIR, HOMOGENEOUS).blocked).toBe(false);
  });
  it('honours a matching override and re-blocks on a stale one', () => {
    const p = project(MIXED, { proportionOverrides: { [KEY]: OVERRIDE_MIXED } });
    const g = proportionGate(p, PAIR, MIXED);
    expect(g.honored).toBe(true);
    expect(g.blocked).toBe(false);
    const grown = MIXED.concat([prop({ id: '4', author: 'Park', year: '2020', es: '0.5', lo: '0.1', hi: '0.9', denominatorPopulation: 'plp_molecular_diagnoses' })]);
    const stale = proportionGate(project(grown, { proportionOverrides: { [KEY]: OVERRIDE_MIXED } }), PAIR, grown);
    expect(stale.stale).toBe(true);
    expect(stale.blocked).toBe(true);
  });
  it('never fires for a non-PROP pair', () => {
    const or = MIXED.map((s) => ({ ...s, esType: 'OR' }));
    expect(proportionGate(project(or), { ...PAIR, esType: 'OR' }, or).blocked).toBe(false);
  });
  it('dominantEsType resolves a blank first row to the majority measure', () => {
    expect(dominantEsType([{ esType: '' }, { esType: 'PROP' }, { esType: 'PROP' }])).toBe('PROP');
    expect(dominantEsType([])).toBe('');
  });
});

describe('ForestTab — the gate, the chip, and the suppressed export', () => {
  it('draws and offers the publication export for a homogeneous PROP outcome', () => {
    const html = renderForest(project(HOMOGENEOUS));
    expect(html).toContain('PUBLICATION-STYLE FIGURE');
    expect(html).toContain('Export figure');
    expect(html).not.toContain('Forest plot hidden until you confirm');
  });

  it('suppresses the diamond AND the export while the pool is blocked', () => {
    const html = renderForest(project(MIXED));
    expect(html).toContain('Forest plot hidden until you confirm');
    expect(html).not.toContain('PUBLICATION-STYLE FIGURE');
    expect(html).not.toContain('Export figure');
    expect(html).not.toContain('Detected measure');
  });

  it('explains WHY and WHERE to resolve it, without duplicating the override form', () => {
    const html = renderForest(project(MIXED));
    expect(html).toContain('Incompatible denominator population');
    expect(html).toContain('The selected estimates use multiple denominator populations:');
    expect(html).toContain('Resolve this on the Meta-Analysis tab');
    expect(html).not.toContain('OTHER WAYS TO RESOLVE THIS');
    expect(html).not.toContain('Pool anyway (record override)');
    expect(html).not.toContain('Only All patients tested');       // no filter buttons here
  });

  it('an honoured override unblocks it and states the override on the tab', () => {
    const html = renderForest(project(MIXED, { proportionOverrides: { [KEY]: OVERRIDE_MIXED } }));
    expect(html).toContain('Compatibility warning overridden 2026-08-09');
    expect(html).toContain('PUBLICATION-STYLE FIGURE');
    expect(html).not.toContain('Forest plot hidden until you confirm');
  });

  it('a stale override does NOT unblock it', () => {
    const grown = MIXED.concat([prop({ id: '4', author: 'Park', year: '2020', es: '0.5', lo: '0.1', hi: '0.9', denominatorPopulation: 'plp_molecular_diagnoses' })]);
    const html = renderForest(project(grown, { proportionOverrides: { [KEY]: OVERRIDE_MIXED } }));
    expect(html).toContain('Recorded override is out of date');
    expect(html).toContain('Forest plot hidden until you confirm');
    expect(html).not.toContain('PUBLICATION-STYLE FIGURE');
  });

  it('renders the active proportion-filter chip so the figure never silently drops estimates', () => {
    const html = renderForest(project(MIXED, { proportionFilters: { [KEY]: { denominatorPopulation: 'all_patients_tested' } } }));
    expect(html).toContain('Denominator population: All patients tested');
    expect(html).toContain('2 studies');
    expect(html).toContain('PUBLICATION-STYLE FIGURE');   // filtering resolved the conflict
  });

  it('a non-PROP outcome is byte-identical with and without the feature', () => {
    const or = HOMOGENEOUS.map((s) => ({ ...s, esType: 'OR' }));
    const html = renderForest(project(or));
    expect(html).toContain('PUBLICATION-STYLE FIGURE');
    expect(html).not.toContain('Incompatible');
    expect(html).not.toContain('Denominator population');
  });
});

describe('SensitivityTab — the gate suppresses every robustness output', () => {
  it('runs normally for a homogeneous PROP outcome', () => {
    const html = renderSensitivity(project(HOMOGENEOUS));
    expect(html).toContain('LEAVE-ONE-OUT ANALYSIS');
    expect(html).not.toContain('Robustness checks hidden until you confirm');
  });

  it('hides leave-one-out, funnel, Egger and trim-and-fill while blocked', () => {
    const html = renderSensitivity(project(MIXED));
    expect(html).toContain('Robustness checks hidden until you confirm');
    expect(html).toContain('Incompatible denominator population');
    expect(html).toContain('Resolve this on the Meta-Analysis tab');
    expect(html).not.toContain('LEAVE-ONE-OUT ANALYSIS');
    expect(html).not.toContain('FUNNEL PLOT');
    expect(html).not.toContain("EGGER'S REGRESSION TEST");
    expect(html).not.toContain('TRIM-AND-FILL');
    expect(html).not.toContain('PRIMARY-DATA-ONLY RE-ANALYSIS');
  });

  it('an honoured override unblocks it; a stale one does not', () => {
    const ok = renderSensitivity(project(MIXED, { proportionOverrides: { [KEY]: OVERRIDE_MIXED } }));
    expect(ok).toContain('LEAVE-ONE-OUT ANALYSIS');
    expect(ok).toContain('Compatibility warning overridden 2026-08-09');
    const grown = MIXED.concat([prop({ id: '4', author: 'Park', year: '2020', es: '0.5', lo: '0.1', hi: '0.9', denominatorPopulation: 'plp_molecular_diagnoses' })]);
    const stale = renderSensitivity(project(grown, { proportionOverrides: { [KEY]: OVERRIDE_MIXED } }));
    expect(stale).toContain('Robustness checks hidden until you confirm');
    expect(stale).not.toContain('LEAVE-ONE-OUT ANALYSIS');
  });

  it('shows the active proportion filter it is honouring', () => {
    const html = renderSensitivity(project(HOMOGENEOUS, { proportionFilters: { [KEY]: { actionStatus: 'implemented' } } }));
    expect(html).toContain('ESTIMATES FILTERED');
    expect(html).toContain('Action status: Implemented');
  });
});

/* ══════════════════ the all-outcomes summary table ══════════════════ */

describe('summary of findings — the table obeys the same helpers and the same gate', () => {
  const MANAGEMENT = [
    prop({ id: 'm1', outcome: 'Management change', author: 'M1' }),
    prop({ id: 'm2', outcome: 'Management change', author: 'M2', es: '-0.20', lo: '-0.80', hi: '0.40' }),
  ];
  const TWO = MIXED.concat(MANAGEMENT);
  const pairs = enumerateOutcomePairs(TWO);
  const rowFor = (rows, outcome) => rows.find((r) => r.pr.outcome === outcome);

  it('marks the blocked outcome instead of printing a pooled value for it', () => {
    const rows = buildOutcomeSummaryRows(project(TWO), TWO, pairs, 'random', {});
    expect(rowFor(rows, OUTCOME).blocked).toBe(true);
    expect(rowFor(rows, OUTCOME).r).toBeNull();
    expect(rowFor(rows, 'Management change').blocked).toBe(false);
    expect(rowFor(rows, 'Management change').r).not.toBeNull();
  });

  it('the marker is what the table actually renders', () => {
    const html = renderAnalysis(project(TWO));
    expect(html).toContain('SUMMARY OF FINDINGS — ALL OUTCOMES');
    expect(html).toContain('blocked — incompatible estimates');
  });

  it('applies the persisted filter, so k matches the headline', () => {
    const filtered = project(TWO, { proportionFilters: { [KEY]: { denominatorPopulation: 'all_patients_tested' } } });
    const rows = buildOutcomeSummaryRows(filtered, TWO, pairs, 'random', {});
    expect(rowFor(rows, OUTCOME).k).toBe(2);          // 3 rows, one filtered out
    expect(rowFor(rows, OUTCOME).blocked).toBe(false);
    expect(renderAnalysis(filtered)).not.toContain('blocked — incompatible estimates');
  });

  it('applies isExcludedFromAnalysis (the 86.md P1.6 defect)', () => {
    const withExcluded = TWO.concat([prop({ id: 'x', author: 'X', extractionMeta: { includedInAnalysis: false } })]);
    const rows = buildOutcomeSummaryRows(project(withExcluded), withExcluded, enumerateOutcomePairs(withExcluded), 'random', {});
    expect(rowFor(rows, OUTCOME).k).toBe(3);
  });

  it('an honoured override lets the table pool again', () => {
    const rows = buildOutcomeSummaryRows(project(TWO, { proportionOverrides: { [KEY]: OVERRIDE_MIXED } }), TWO, pairs, 'random', {});
    expect(rowFor(rows, OUTCOME).blocked).toBe(false);
    expect(rowFor(rows, OUTCOME).r).not.toBeNull();
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

/* ══════════════════ SubgroupTab — Time Point / Outcome Measured ══════════════════ */

describe('cross-pair grouping — Time Point and Outcome Measured are no longer no-ops', () => {
  const at = (tp, id, over = {}) => prop({
    id, author: 'A' + id, outcome: 'Mortality', timepoint: tp, esType: 'OR',
    denominatorPopulation: '', actionStatus: '', ...over,
  });
  const MORTALITY = [
    at('30d', '1'), at('30d', '2', { es: '-0.20', lo: '-0.80', hi: '0.40' }),
    at('90d', '3', { es: '0.90', lo: '0.30', hi: '1.50' }), at('90d', '4', { es: '0.70', lo: '0.10', hi: '1.30' }),
  ];
  const OTHER = [
    prop({ id: '5', author: 'E', outcome: 'Readmission', timepoint: '', esType: 'OR', es: '0.4', lo: '0.1', hi: '0.7' }),
    prop({ id: '6', author: 'F', outcome: 'Readmission', timepoint: '', esType: 'OR', es: '0.6', lo: '0.2', hi: '1.0' }),
  ];
  const ALL = MORTALITY.concat(OTHER);
  const pair30 = enumerateOutcomePairs(ALL).find((p) => p.timepoint === '30d');

  it('every other key stays pair-scoped (returns null)', () => {
    expect(crossPairRowsForGrouping(ALL, pair30, 'design')).toBeNull();
    expect(crossPairRowsForGrouping(ALL, pair30, 'denominatorPopulation')).toBeNull();
    expect(crossPairRowsForGrouping(ALL, null, 'timepoint')).toBeNull();   // needs a selected pair
  });

  it('timepoint spans the sibling pairs sharing the outcome NAME, and nothing else', () => {
    const rows = crossPairRowsForGrouping(ALL, pair30, 'timepoint');
    expect(rows.map((s) => s.id)).toEqual(['1', '2', '3', '4']);
  });

  it('outcome spans every outcome pair', () => {
    expect(crossPairRowsForGrouping(ALL, pair30, 'outcome').map((s) => s.id)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('both still apply isExcludedFromAnalysis and skip ES-less rows', () => {
    const dirty = ALL.concat([
      at('90d', '7', { extractionMeta: { includedInAnalysis: false } }),
      at('90d', '8', { es: '' }),
    ]);
    expect(crossPairRowsForGrouping(dirty, pair30, 'timepoint').map((s) => s.id)).toEqual(['1', '2', '3', '4']);
    expect(crossPairRowsForGrouping(dirty, pair30, 'outcome').map((s) => s.id)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('mortality @30d vs @90d produces two subgroups and a real Q-between again', () => {
    const rows = crossPairRowsForGrouping(ALL, pair30, 'timepoint');
    const res = subgroupAnalysis(groupRowsForSubgroup(rows, 'timepoint'), 'timepoint', 'random');
    expect(res.groups.map((g) => g.group).sort()).toEqual(['30d', '90d']);
    expect(res.Qbetween).not.toBeNull();
    expect(res.df).toBe(1);
    expect(res.pBetween).not.toBeNull();
    // and the pair-scoped rows really are the single-group no-op this replaces
    const scoped = studiesForPair(ALL, pair30);
    expect(subgroupAnalysis(scoped, 'timepoint', 'random').Qbetween).toBeNull();
  });

  it('grouping by outcome compares Mortality against Readmission', () => {
    const rows = crossPairRowsForGrouping(ALL, pair30, 'outcome');
    const res = subgroupAnalysis(groupRowsForSubgroup(rows, 'outcome'), 'outcome', 'random');
    expect(res.groups.map((g) => g.group).sort()).toEqual(['Mortality', 'Readmission']);
    expect(res.Qbetween).not.toBeNull();
  });

  it('SubgroupTab keeps both buttons; the note only appears once one is picked', () => {
    // SSR renders initial state, and the default groupKey is "design" — the note is a
    // click away, so the STRING is pinned on the pure builder below.
    const html = renderToStaticMarkup(createElement(SubgroupTab, { project: project(MORTALITY.concat(OTHER)) }));
    expect(html).toContain('Time Point');
    expect(html).toContain('Outcome Measured');
    expect(html).not.toContain(CROSS_PAIR_SCOPE_HEADLINE);
  });

  it('the note states the scope, the counts and that the pair filter is off', () => {
    const rows = crossPairRowsForGrouping(ALL, pair30, 'timepoint');
    const note = crossPairScopeNote('timepoint', pair30, rows.length, 2);
    expect(note).toContain('Every time point recorded for “Mortality” is grouped together');
    expect(note).toContain('4 estimates across 2 outcome pairs');
    expect(note).toContain("The selected pair's proportion filter does not apply here");
    const byOutcome = crossPairScopeNote('outcome', pair30, 6, 3);
    expect(byOutcome).toContain('Every outcome in the project is grouped together — 6 estimates across 3 outcome pairs');
    expect(byOutcome).toContain('Only compare outcomes measured on the same scale.');
  });
});

describe('SubgroupTab — PROP detection uses the dominant measure (blank first row)', () => {
  /** The first eligible row has no Effect measure, which is what enumerateOutcomePairs copies. */
  const rows = [
    prop({ id: '1', author: 'A', esType: '' }),
    prop({ id: '2', author: 'B', es: '-0.20', lo: '-0.80', hi: '0.40' }),
    prop({ id: '3', author: 'C', es: '0.90', lo: '0.30', hi: '1.50', denominatorPopulation: 'plp_molecular_diagnoses' }),
  ];

  it('the pair itself reports a blank measure — this is the trap', () => {
    expect(enumerateOutcomePairs(rows)[0].esType).toBe('');
  });

  it('still offers Denominator population and Action status', () => {
    const html = renderToStaticMarkup(createElement(SubgroupTab, { project: project(rows) }));
    expect(html).toContain('Denominator population');
    expect(html).toContain('Action status');
  });

  it('and AnalysisTab still points the reviewer here', () => {
    const html = renderAnalysis(project(rows));
    expect(html).toContain('the Subgroup tab can stratify by denominator population or action status');
  });

  it('a genuinely non-PROP outcome with a blank first row still offers neither', () => {
    const or = rows.map((s, i) => ({ ...s, esType: i === 0 ? '' : 'OR' }));
    const html = renderToStaticMarkup(createElement(SubgroupTab, { project: project(or) }));
    expect(html).not.toContain('Denominator population');
    expect(html).not.toContain('Action status');
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

/* ══════════════ 116.md §41/§46 — raw-data proportions are first-class ══════════════ */

describe('116.md §46 — a PROP outcome with ONLY raw events/total pools end-to-end', () => {
  /** Extraction leaves exactly this: events/total captured, es/lo/hi never backfilled. */
  const RAW = [
    prop({ id: '1', author: 'Smith', year: '2024', es: '', lo: '', hi: '', events: '18', total: '100', denominatorPopulation: '', actionStatus: '' }),
    prop({ id: '2', author: 'Jones', year: '2023', es: '', lo: '', hi: '', events: '25', total: '90', denominatorPopulation: '', actionStatus: '' }),
    prop({ id: '3', author: 'Kim', year: '2021', es: '', lo: '', hi: '', events: '10', total: '80', denominatorPopulation: '', actionStatus: '' }),
  ];

  it('AnalysisTab pools it (no "no studies with an effect size" dead end)', () => {
    const html = renderAnalysis(project(RAW));
    expect(html).toContain('POOLED EFFECT');
    expect(html).not.toContain('No studies with an effect size yet');
    expect(html).not.toContain('Enter an effect size and 95% CI');
  });

  it('ForestTab draws it and offers the publication export', () => {
    const html = renderForest(project(RAW));
    expect(html).toContain('PUBLICATION-STYLE FIGURE');
    expect(html).toContain('Export figure');
  });

  it('SensitivityTab runs the robustness checks over it', () => {
    const html = renderSensitivity(project(RAW));
    expect(html).toContain('LEAVE-ONE-OUT ANALYSIS');
    expect(html).toContain('FUNNEL PLOT');
  });

  it('the stored rows are never mutated by rendering (derived values stay views)', () => {
    const before = JSON.stringify(RAW);
    renderAnalysis(project(RAW));
    renderForest(project(RAW));
    renderSensitivity(project(RAW));
    expect(JSON.stringify(RAW)).toBe(before);
  });
});

/* ══════════════ 116.md §49 — warn tier: one category + unclassified pools ══════════════ */

describe('116.md §49 — one real category + unclassified rows POOLS with a visible advisory', () => {
  const MIX = [
    prop({ id: '1', author: 'Smith', year: '2024', denominatorPopulation: 'all_patients_tested' }),
    prop({ id: '2', author: 'Jones', year: '2023', es: '-0.20', lo: '-0.80', hi: '0.40', denominatorPopulation: 'all_patients_tested' }),
    legacy({ id: '3', author: 'Old', year: '2011', es: '0.10', lo: '-0.50', hi: '0.70' }),
  ];

  it('AnalysisTab shows the pooled result AND the advisory naming the unclassified count', () => {
    const html = renderAnalysis(project(MIX));
    expect(html).toContain('POOLED EFFECT');
    expect(html).not.toContain('Result hidden until you confirm');
    expect(html).toContain('Pooled with unclassified estimates');
    expect(html).toContain('1 of 3 pooled estimates');
    // the unclassified rows keep their own honestly-named line
    expect(html).toContain(UNCLASSIFIED_GROUP_LABEL);
    // the per-category filter affordance survives the downgrade
    expect(html).toContain('Only All patients tested');
    expect(html).toContain(`Only ${UNCLASSIFIED_GROUP_LABEL}`);
  });

  it('ForestTab and SensitivityTab render outputs plus the same advisory', () => {
    const f = renderForest(project(MIX));
    expect(f).toContain('PUBLICATION-STYLE FIGURE');
    expect(f).toContain('Pooled with unclassified estimates');
    const s = renderSensitivity(project(MIX));
    expect(s).toContain('LEAVE-ONE-OUT ANALYSIS');
    expect(s).toContain('Pooled with unclassified estimates');
  });

  it('two REAL categories still block (unchanged 107.md flow)', () => {
    const html = renderAnalysis(project(MIXED));
    expect(html).toContain('Result hidden until you confirm');
    expect(html).not.toContain('POOLED EFFECT');
  });
});

/* ══════════════ 116.md §50 — the itemized empty/blocked states ══════════════ */

describe('116.md §50 — AnalysisTab explains WHY instead of a blank panel', () => {
  it('itemizes the problems when no outcome is analyzable at all', () => {
    const broken = [
      prop({ id: '1', es: '', lo: '', hi: '', events: '23', total: '' }),
      prop({ id: '2', author: 'B', es: '', lo: '', hi: '', events: '9', total: '' }),
      prop({ id: '3', author: 'C', es: '', lo: '', hi: '', events: '120', total: '100' }),
    ];
    const html = renderAnalysis(project(broken));
    expect(html).toContain('WHY THIS ANALYSIS IS UNAVAILABLE');
    expect(html).toContain('2 studies are missing total sample size.');
    expect(html).toContain('1 study has events greater than total.');
    expect(html).toContain('At least 2 eligible studies are required for pooling.');
  });

  it('itemizes pair-scoped problems when a selected outcome cannot pool', () => {
    const rows = [
      prop({ id: '1', es: '', lo: '', hi: '', events: '18', total: '100' }),
      prop({ id: '2', author: 'B', es: '', lo: '', hi: '', events: '120', total: '100' }),
    ];
    const html = renderAnalysis(project(rows));
    expect(html).toContain('WHY THIS ANALYSIS IS UNAVAILABLE');
    expect(html).toContain('1 study has events greater than total.');
    expect(html).toContain('At least 2 eligible studies are required for pooling.');
  });

  it('the blocked state names the incompatibility with its count', () => {
    const html = renderAnalysis(project(MIXED));
    expect(html).toContain('WHY THIS RESULT IS HIDDEN');
    expect(html).toContain('3 studies use an incompatible denominator population.');
  });
});

/* ══════════════ 116.md §133 — metadata edits never hide the analysis (SSR) ══════════════ */

describe('116.md §133 — adding/editing denominatorPopulation/actionStatus keeps every output', () => {
  const RAW2 = [
    prop({ id: '1', author: 'Smith', year: '2024', es: '', lo: '', hi: '', events: '18', total: '100', denominatorPopulation: '', actionStatus: '' }),
    prop({ id: '2', author: 'Jones', year: '2023', es: '', lo: '', hi: '', events: '25', total: '90', denominatorPopulation: '', actionStatus: '' }),
  ];
  const classifyFirst = (rows, patch) => rows.map((s, i) => (i === 0 ? { ...s, ...patch } : s));
  const expectAllOutputs = (rows) => {
    expect(enumerateOutcomePairs(rows).map((p) => p.key)).toEqual([KEY]);   // analyzability
    const a = renderAnalysis(project(rows));
    expect(a).toContain('POOLED EFFECT');                                    // pooled result presence
    expect(a).not.toContain('Result hidden until you confirm');
    const f = renderForest(project(rows));
    expect(f).toContain('PUBLICATION-STYLE FIGURE');                         // forest-data presence
    expect(f).not.toContain('Forest plot hidden until you confirm');
  };

  it('baseline: the unclassified raw pair produces every output', () => {
    expectAllOutputs(RAW2);
  });
  it('adding a denominatorPopulation to one row changes nothing', () => {
    expectAllOutputs(classifyFirst(RAW2, { denominatorPopulation: 'all_patients_tested' }));
  });
  it('adding an actionStatus to one row changes nothing', () => {
    expectAllOutputs(classifyFirst(RAW2, { actionStatus: 'implemented' }));
  });
  it('editing a classification (and clearing it again) changes nothing', () => {
    expectAllOutputs(classifyFirst(RAW2, { denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: 'unclear' }));
    expectAllOutputs(classifyFirst(RAW2, { denominatorPopulation: '', actionStatus: '' }));
  });
  it('classifying BOTH rows identically changes nothing', () => {
    expectAllOutputs(RAW2.map((s) => ({ ...s, denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' })));
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
  // Review fix — ResearchExport is the FOURTH exporter of denominatorCustom. A row whose
  // population was switched away from Other/custom keeps the old text on the blob (no
  // load-path normalizer strips it, 107.md §15), and the input that would reveal it is
  // hidden, so this exporter must resolve it through `exportedDenominatorCustom` too.
  describe('proportionClassCell — the export cell never emits a stale custom denominator', () => {
    const CUSTOM = 'Patients who completed post-test genetic counseling';
    const staleRow = prop({ denominatorPopulation: 'all_patients_tested', denominatorCustom: CUSTOM });
    const realRow = prop({ denominatorPopulation: 'other', denominatorCustom: CUSTOM });

    it("drops it when the population is no longer 'other'", () => {
      expect(proportionClassCell(staleRow, 'denominatorCustom')).toBe('');
    });
    it('keeps it for a row that really is Other/custom', () => {
      expect(proportionClassCell(realRow, 'denominatorCustom')).toBe(CUSTOM);
    });
    it('still label-resolves the two enums, and stays empty for a legacy row', () => {
      expect(proportionClassCell(staleRow, 'denominatorPopulation')).toBe('All patients tested');
      expect(proportionClassCell(staleRow, 'actionStatus')).toBe('Implemented');
      expect(proportionClassCell(legacy({}), 'denominatorPopulation')).toBe('');
      expect(proportionClassCell(legacy({}), 'actionStatus')).toBe('');
      expect(proportionClassCell(staleRow, 'bogus')).toBe('');
    });
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

/* ── 116.md §49 (r2) — the two tiers are PER FIELD, so one outcome can carry a
   BLOCKING issue on one variable and a WARNING on another at the same time. While
   the block hides the result, the warning card must not tell the user the pool
   proceeded. ── */
describe('116.md §49 (r2) — warning copy never contradicts an active block', () => {
  // denominatorPopulation: 2 real categories → BLOCKING.
  // actionStatus: classified on one row, blank on the rest → WARNING.
  const BLOCK_PLUS_WARN = [
    prop({ id: '1', author: 'Smith', year: '2024', denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }),
    prop({ id: '2', author: 'Jones', year: '2023', es: '-0.20', lo: '-0.80', hi: '0.40', denominatorPopulation: 'all_patients_tested', actionStatus: '' }),
    prop({ id: '3', author: 'Kim', year: '2021', es: '-0.60', lo: '-1.20', hi: '0.00', denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: '' }),
    prop({ id: '4', author: 'Lee', year: '2022', es: '-0.10', lo: '-0.70', hi: '0.50', denominatorPopulation: 'plp_molecular_diagnoses', actionStatus: '' }),
  ];

  it('the fixture really does produce a block and a warning together', () => {
    const c = checkProportionCompatibility(BLOCK_PLUS_WARN);
    expect(c.blocking).toBe(true);
    expect(c.warning).toBe(true);
  });

  it('does not claim "the pool proceeds" while the result is hidden', () => {
    const html = renderAnalysis(project(BLOCK_PLUS_WARN));
    expect(html).toContain('Result hidden until you confirm');
    expect(html).not.toContain('the pool proceeds');
    expect(html).not.toContain('Pooled with unclassified estimates');
    expect(html).toContain('they will pool once the incompatibility above is resolved');
  });

  it('still says the pool proceeds when nothing is blocking', () => {
    const warnOnly = BLOCK_PLUS_WARN.map((s, i) => ({ ...s, denominatorPopulation: 'all_patients_tested', id: String(i + 1) }));
    const c = checkProportionCompatibility(warnOnly);
    expect(c.blocking).toBe(false);
    expect(c.warning).toBe(true);
    const html = renderAnalysis(project(warnOnly));
    expect(html).toContain('the pool proceeds');
    expect(html).toContain('Pooled with unclassified estimates');
  });
});
