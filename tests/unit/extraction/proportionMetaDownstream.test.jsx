/**
 * proportionMetaDownstream.test.jsx — 107.md §8D/§8F/§9. The parts of the per-estimate
 * proportion metadata that live OUTSIDE the pure module: the three hand-maintained
 * allow-lists (analysis-sync hash, manuscript dependency slices, provenance
 * fingerprint), every exporter's fixed column list, the project-JSON round trip, the
 * copy/duplication semantics, and the SSR shape of the extraction form.
 *
 * These are exactly the places where a new row field fails SILENTLY, which is why they
 * are pinned here (the model is tests/unit/caseSeriesDownstream.test.jsx).
 *
 * House style for UI: renderToStaticMarkup (no jsdom) — initial render only.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkStudy } from '../../../src/research-engine/project-model/defaults.js';
import { computeSyncHash, SYNC_INPUT_FIELDS } from '../../../src/research-engine/extraction/engine/syncState.js';
import { computeDependencyState } from '../../../src/research-engine/manuscript/dependencies.js';
import { studyValues, STUDY_VALUE_FIELDS } from '../../../src/research-engine/provenance/fingerprint.js';
import { buildStudyTableCSV } from '../../../src/research-engine/import-export/journalSubmission.js';
import {
  buildCaseExportRows, enableCaseSeries, addCase, duplicateCase,
  propagateArticleFields, ARTICLE_LEVEL_FIELDS, casesForPublication,
} from '../../../src/research-engine/extraction/caseSeries.js';
import { addOutcome } from '../../../src/research-engine/extraction/outcomeGroups.js';
import { buildExtractionCSV, ESCalcInline } from '../../../src/frontend/workspace/tabs/extractionTabs.jsx';
import ArticleWorkspace from '../../../src/features/extraction/engine/ArticleWorkspace.jsx';
import { expectedFieldsFor, assignableFieldsFor } from '../../../src/research-engine/extraction/engine/articleStatus.js';
import {
  PROPORTION_META_FIELDS, effectiveActionStatus, effectiveDenominatorPopulation,
  isProportionMetaUnclassified,
} from '../../../src/research-engine/extraction/proportionMeta.js';

let seq = 0;
const idFn = () => `g${++seq}`;
const row = (over = {}) => ({ ...mkStudy(), ...over });
/** A classified PROP estimate. */
const classified = (over = {}) => row({
  id: 'p1', author: 'Smith', year: '2024', outcome: 'Diagnostic yield', esType: 'PROP',
  events: '23', total: '59',
  denominatorPopulation: 'plp_molecular_diagnoses',
  denominatorCustom: '',
  actionStatus: 'implemented',
  ...over,
});
/** A row as it exists in a project saved BEFORE this feature: the keys simply are absent. */
function legacyRow(over = {}) {
  const s = row({ id: 'L1', author: 'Old', year: '2011', esType: 'PROP', events: '4', total: '10', ...over });
  for (const f of PROPORTION_META_FIELDS) delete s[f];
  return s;
}

/* ══════════════════ allow-list 1 — the analysis-sync hash ══════════════════ */

describe('syncState.SYNC_INPUT_FIELDS carries the three fields (107.md §8)', () => {
  it('lists all three', () => {
    for (const f of PROPORTION_META_FIELDS) expect(SYNC_INPUT_FIELDS).toContain(f);
  });

  it('the hash changes when ANY of the three changes', () => {
    const base = classified();
    const h0 = computeSyncHash(base);
    for (const [f, v] of [['denominatorPopulation', 'all_patients_tested'],
      ['denominatorCustom', 'post-test counselling'], ['actionStatus', 'unclear']]) {
      expect(computeSyncHash({ ...base, [f]: v })).not.toBe(h0);
    }
  });

  it('classifying a LEGACY row (adding the keys) invalidates its prior sync', () => {
    const legacy = legacyRow();
    const before = computeSyncHash(legacy);
    expect(computeSyncHash({ ...legacy, actionStatus: 'implemented' })).not.toBe(before);
  });

  it('an untouched legacy row hashes identically to the same row with "" keys', () => {
    // Missing and "" are the SAME semantic state, so a normalizer that never writes the
    // keys cannot change an existing sync stamp (byte-stability / 107.md §15).
    const legacy = legacyRow();
    expect(computeSyncHash({ ...legacy, denominatorPopulation: '', denominatorCustom: '', actionStatus: '' }))
      .toBe(computeSyncHash(legacy));
  });
});

/* ══════════════════ allow-list 2 — manuscript dependency slices ══════════════════ */

describe('dependencies.rosterSlice carries the three fields (107.md §8)', () => {
  // computeDependencyState returns { <dependencyKey>: fingerprint }. A field absent
  // from the slices leaves every fingerprint identical while the screen changed — the
  // "Fully synchronized" lie invariant #6 of docs/case-series-106.md warns about.
  const project = (studies) => ({ id: 'pr', studies, pico: {}, search: {}, prisma: {} });
  const base = computeDependencyState(project([classified()]));

  it('studies.roster moves when ANY of the three is reclassified', () => {
    for (const [f, v] of [['denominatorPopulation', 'all_patients_tested'],
      ['denominatorCustom', 'post-test counselling'], ['actionStatus', 'unclear']]) {
      const next = computeDependencyState(project([classified({ [f]: v })]));
      expect(next['studies.roster']).not.toBe(base['studies.roster']);
    }
  });

  it('they ride in the ROSTER slice (scope/identity), not the VALUES slice', () => {
    const next = computeDependencyState(project([classified({ actionStatus: 'unclear' })]));
    expect(next['studies.values']).toBe(base['studies.values']);
    expect(next['studies.roster']).not.toBe(base['studies.roster']);
  });

  it('a legacy row is stable across repeated computations (nothing is written to it)', () => {
    // NOTE: this fingerprint (unlike computeSyncHash) distinguishes a MISSING key from
    // '' — stableStringify maps undefined→null. That is the pre-existing behaviour for
    // `reportedFormat` too, and it is harmless precisely because no load-path normalizer
    // ever stamps these keys onto an old row (107.md §15 / the byte-stability rule).
    const legacy = legacyRow();
    expect(computeDependencyState(project([legacy]))['studies.roster'])
      .toBe(computeDependencyState(project([legacyRow()]))['studies.roster']);
    for (const f of PROPORTION_META_FIELDS) expect(f in legacy).toBe(false);
  });

  it('classifying a legacy row moves the roster fingerprint', () => {
    const legacy = legacyRow();
    expect(computeDependencyState(project([{ ...legacy, actionStatus: 'implemented' }]))['studies.roster'])
      .not.toBe(computeDependencyState(project([legacy]))['studies.roster']);
  });
});

/* ══════════════════ allow-list 3 — the provenance fingerprint ══════════════════ */

describe('provenance/fingerprint STUDY_VALUE_FIELDS carries the three fields', () => {
  it('lists all three', () => {
    for (const f of PROPORTION_META_FIELDS) expect(STUDY_VALUE_FIELDS).toContain(f);
  });

  it('studyValues() surfaces them so EXTRACTED_VALUE_CHANGED can fire', () => {
    const v = studyValues(classified());
    expect(v.denominatorPopulation).toBe('plp_molecular_diagnoses');
    expect(v.actionStatus).toBe('implemented');
    expect(v.denominatorCustom).toBe('');
  });

  it('omits keys a legacy row does not have (no fabricated "before" value)', () => {
    const v = studyValues(legacyRow());
    for (const f of PROPORTION_META_FIELDS) expect(f in v).toBe(false);
  });
});

/* ══════════════════ §8F — exports ══════════════════ */

describe('extraction CSV (buildExtractionCSV) — 107.md §8F', () => {
  it('adds the three RAW-VALUE columns', () => {
    const csv = buildExtractionCSV([classified()], {});
    const [header, first] = csv.split('\n');
    const cols = header.split(',');
    expect(cols).toContain('denominatorPopulation');
    expect(cols).toContain('denominatorCustom');
    expect(cols).toContain('actionStatus');
    const cells = first.split(',');
    expect(cells[cols.indexOf('denominatorPopulation')]).toBe('plp_molecular_diagnoses');
    expect(cells[cols.indexOf('actionStatus')]).toBe('implemented');
  });

  it('a legacy row exports EMPTY cells, never a fabricated category', () => {
    const csv = buildExtractionCSV([legacyRow()], {});
    const [header, first] = csv.split('\n');
    const cols = header.split(',');
    const cells = first.split(',');
    for (const f of PROPORTION_META_FIELDS) expect(cells[cols.indexOf(f)]).toBe('');
    expect(first).not.toContain('unclear');
  });

  it('escapes a description containing a comma', () => {
    const csv = buildExtractionCSV([classified({ denominatorPopulation: 'other', denominatorCustom: 'Completed counselling, then tested' })], {});
    expect(csv).toContain('"Completed counselling, then tested"');
  });
});

describe('journal-submission study table CSV — 107.md §8F', () => {
  it('adds three LABEL columns and renders the human labels', () => {
    const csv = buildStudyTableCSV([classified()]).replace(/^﻿/, '');
    const [header, first] = csv.split('\n');
    const cols = header.split(',');
    expect(cols).toContain('Denominator population');
    expect(cols).toContain('Denominator description');
    expect(cols).toContain('Action status');
    const cells = first.split(',');
    expect(cells[cols.indexOf('Denominator population')]).toBe('P/LP molecular diagnoses');
    expect(cells[cols.indexOf('Action status')]).toBe('Implemented');
  });

  it('a legacy / unclassified row exports empty label cells', () => {
    const csv = buildStudyTableCSV([legacyRow()]).replace(/^﻿/, '');
    const [header, first] = csv.split('\n');
    const cols = header.split(',');
    const cells = first.split(',');
    expect(cells[cols.indexOf('Denominator population')]).toBe('');
    expect(cells[cols.indexOf('Action status')]).toBe('');
  });

  it('an UNKNOWN stored value also exports empty (self-healing labels)', () => {
    const csv = buildStudyTableCSV([classified({ actionStatus: 'martians' })]).replace(/^﻿/, '');
    const cols = csv.split('\n')[0].split(',');
    expect(csv.split('\n')[1].split(',')[cols.indexOf('Action status')]).toBe('');
  });
});

describe('case-level export (buildCaseExportRows) — 107.md §8F', () => {
  it('adds the three columns and carries the per-case values', () => {
    seq = 0;
    const en = enableCaseSeries([classified({ id: 's1', doi: '10.1/smith' })], 's1', { idFn });
    let studies = en.studies;
    studies = addCase(studies, en.publicationId, { mkStudy, idFn }).studies;
    const { columns, rows } = buildCaseExportRows(studies, []);
    expect(columns.map((c) => c.key)).toEqual(expect.arrayContaining([...PROPORTION_META_FIELDS]));
    expect(columns.map((c) => c.label)).toEqual(expect.arrayContaining(['Denominator population', 'Denominator description', 'Action status']));
    expect(rows[0].denominatorPopulation).toBe('plp_molecular_diagnoses');
    expect(rows[0].actionStatus).toBe('implemented');
    // A newly added sibling case starts UNCLASSIFIED — nothing is inferred for it.
    expect(rows[1].denominatorPopulation).toBe('');
    expect(rows[1].actionStatus).toBe('');
  });
});

/* ══════════════════ §8F — project JSON round trip ══════════════════ */

describe('project JSON export/import round trip (107.md §8F backward compatibility)', () => {
  // The client exporter writes {type:'metalab-project',version:1,project} and the
  // importer spreads it with a fresh id (Workspace.jsx:628-650); the server exporter is
  // JSON.stringify(project). Both are whole-blob passthrough, so this models both.
  const roundTrip = (project) => {
    const file = JSON.stringify({ type: 'metalab-project', version: 1, exported: 'x', project });
    const data = JSON.parse(file);
    const incoming = data.type === 'metalab-project' && data.project ? [data.project] : [];
    return incoming.map((p) => ({ ...p, id: 'fresh', name: `${p.name || 'Imported'}` }))[0];
  };

  it('a row carrying the fields survives verbatim', () => {
    const out = roundTrip({ id: 'p', name: 'R', studies: [classified({ denominatorPopulation: 'other', denominatorCustom: 'Patients who completed post-test genetic counseling' })] });
    const s = out.studies[0];
    expect(s.denominatorPopulation).toBe('other');
    expect(s.denominatorCustom).toBe('Patients who completed post-test genetic counseling');
    expect(s.actionStatus).toBe('implemented');
  });

  it('an OLD file whose rows lack the keys imports fine and stays UNCLASSIFIED', () => {
    const out = roundTrip({ id: 'p', name: 'Old review', studies: [legacyRow()] });
    const s = out.studies[0];
    for (const f of PROPORTION_META_FIELDS) expect(f in s).toBe(false);
    expect(effectiveDenominatorPopulation(s)).toBe('');
    expect(effectiveActionStatus(s)).toBe('');
    expect(effectiveActionStatus(s)).not.toBe('unclear');
    expect(isProportionMetaUnclassified(s)).toBe(true);
  });

  it('a FORWARD-version value survives the round trip untouched (nothing is rewritten)', () => {
    const out = roundTrip({ id: 'p', name: 'R', studies: [classified({ actionStatus: 'some_future_status' })] });
    expect(out.studies[0].actionStatus).toBe('some_future_status');
    expect(effectiveActionStatus(out.studies[0])).toBe('');   // but reads as unclassified
  });
});

/* ══════════════════ §8D — copy / duplication semantics ══════════════════ */

describe('copy semantics (107.md §8D)', () => {
  it('propagateArticleFields does NOT fan the three fields out to sibling cases', () => {
    for (const f of PROPORTION_META_FIELDS) expect(ARTICLE_LEVEL_FIELDS).not.toContain(f);
    seq = 0;
    const en = enableCaseSeries([classified({ id: 's1', doi: '10.1/smith' })], 's1', { idFn });
    let studies = addCase(en.studies, en.publicationId, { mkStudy, idFn }).studies;
    const cases = casesForPublication(studies, en.publicationId);
    const r = propagateArticleFields(studies, cases[0].id, {
      journal: 'J Med', denominatorPopulation: 'all_patients_tested', actionStatus: 'unclear',
    });
    const after = casesForPublication(r.studies, en.publicationId);
    // The citation field fanned out…
    expect(after[0].journal).toBe('J Med');
    expect(after[1].journal).toBe('J Med');
    expect(r.propagated).toContain('journal');
    // …the per-ESTIMATE classification did not.
    expect(after[0].denominatorPopulation).toBe('all_patients_tested');
    expect(after[1].denominatorPopulation).toBe('');
    expect(after[1].actionStatus).toBe('');
    expect(r.propagated).not.toContain('denominatorPopulation');
    expect(r.propagated).not.toContain('actionStatus');
  });

  it('addOutcome (the cloneForOutcome contract) starts a NEW outcome UNCLASSIFIED', () => {
    const src = classified({ denominatorPopulation: 'other', denominatorCustom: 'X', actionStatus: 'implemented' });
    const r = addOutcome([src], src.id, { mkStudy, idFn: () => 'new1', name: 'Second outcome' });
    const fresh = r.studies.find((s) => s.id === 'new1');
    for (const f of PROPORTION_META_FIELDS) expect(fresh[f]).toBe('');
    expect(isProportionMetaUnclassified(fresh)).toBe(true);
  });

  it('duplicateCase KEEPS the classification (same estimate context, documented)', () => {
    seq = 0;
    const en = enableCaseSeries([classified({ id: 's1', doi: '10.1/smith' })], 's1', { idFn });
    const cases = casesForPublication(en.studies, en.publicationId);
    const r = duplicateCase(en.studies, cases[0].id, { idFn });
    const copy = r.studies.find((s) => s.id === r.id);
    expect(copy.denominatorPopulation).toBe('plp_molecular_diagnoses');
    expect(copy.actionStatus).toBe('implemented');
  });
});

/* ══════════════════ progress must not regress for legacy rows ══════════════════ */

describe('expectedFieldsFor is unchanged (legacy rows must not regress to "incomplete")', () => {
  it('a PROP row still expects exactly author/year/outcome/esType/timepoint/events/total', () => {
    expect(expectedFieldsFor({ esType: 'PROP' })).toEqual(['author', 'year', 'outcome', 'esType', 'timepoint', 'events', 'total']);
  });
  it('the three fields are NOT click-to-pick targets (a picked token is not a term)', () => {
    const targets = assignableFieldsFor({ esType: 'PROP' });
    for (const f of PROPORTION_META_FIELDS) expect(targets).not.toContain(f);
  });
});

/* ══════════════════ §8/§9 — the extraction form (SSR shape) ══════════════════ */

describe('ArticleWorkspace SSR — PROP row (107.md §8A/§8B/§8C/§9)', () => {
  const render = (study) => renderToStaticMarkup(
    <ArticleWorkspace projectId="p1" study={study} article={{ id: study.id, status: 'in_progress' }} studies={[study]} />,
  );

  it('renders both selects with the exact labels and the "Not classified" first option', () => {
    const html = render(classified());
    expect(html).toContain('Denominator population');
    expect(html).toContain('Action status');
    expect(html).toContain('— Not classified —');
    // every §8A / §8B option is offered, with its mandated visible label
    for (const l of ['P/LP molecular diagnoses', 'All patients tested', 'Patients with management change', 'Patients with follow-up', 'Other/custom']) {
      expect(html).toContain(l);
    }
    for (const l of ['Implemented', 'Recommended/planned', 'Potential/theoretical', 'Unclear']) {
      expect(html).toContain(l);
    }
  });

  it('renders the derived percentage for a filled row (§9)', () => {
    const html = render(classified());
    expect(html).toContain('23 / 59 = 39.0%');
    expect(html).toContain('Calculated proportion: 39.0%');   // screen-reader exposure
    expect(html).toContain('aria-live="polite"');
  });

  it('shows nothing misleading when the values are incomplete or impossible (§9)', () => {
    expect(render(classified({ events: '23', total: '' }))).not.toMatch(/23 \/\s*=/);
    expect(render(classified({ events: '', total: '' }))).not.toContain('Calculated proportion');
    expect(render(classified({ events: '60', total: '59' }))).not.toContain('Calculated proportion');
    expect(render(classified({ events: '5', total: '0' }))).not.toContain('Calculated proportion');
  });

  it('a LEGACY row shows the unclassified state, not "Unclear"', () => {
    const html = render(legacyRow());
    expect(html).toContain('— Not classified —');
    // the unclassified option is the SELECTED one (React SSR marks it on the <select>)
    expect(html).toMatch(/<select[^>]*data-testid="pex-field-actionStatus"[^>]*>/);
  });

  it('the custom description appears only for Other/custom (§8A)', () => {
    expect(render(classified())).not.toContain('Denominator description');
    const html = render(classified({ denominatorPopulation: 'other' }));
    expect(html).toContain('Denominator description');
    expect(html).toContain('data-testid="pex-field-denominatorCustom"');
  });

  it('a non-PROP row renders neither the selects nor the derived line', () => {
    const html = render(row({ id: 'x', esType: 'OR', a: '5', b: '5', c: '5', d: '5' }));
    expect(html).not.toContain('Denominator population');
    expect(html).not.toContain('data-testid="pex-prop-derived"');
  });
});

describe('ESCalcInline SSR — the classic tab shows the same derived % (107.md §9)', () => {
  it('renders "23 / 59 = 39.0%" live beside the events/total inputs', () => {
    const html = renderToStaticMarkup(<ESCalcInline s={classified()} ch={() => {}} />);
    expect(html).toContain('23 / 59 = 39.0%');
    expect(html).toContain('Calculated proportion: 39.0%');
  });

  it('renders an em dash (never a number) for incomplete input', () => {
    const html = renderToStaticMarkup(<ESCalcInline s={classified({ events: '23', total: '' })} ch={() => {}} />);
    expect(html).toContain('data-testid="esc-prop-derived"');
    expect(html).not.toContain('Calculated proportion');
  });
});
