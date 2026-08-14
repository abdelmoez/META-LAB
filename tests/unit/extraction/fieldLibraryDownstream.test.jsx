/**
 * fieldLibraryDownstream.test.jsx — 116.md §34-§40 + §52-§56. The parts of the project
 * extraction field library that live OUTSIDE the pure registry: the ~12 hand-maintained
 * allow-lists that must now DERIVE from it, and the SSR shape of the two new surfaces.
 *
 * House style for UI: renderToStaticMarkup (no jsdom) — initial render only.
 *
 * WHAT IS PINNED
 *  1. DERIVED ALLOW-LISTS — the analysis-sync hash, the provenance value slice, the
 *     manuscript dependency slice, the extraction CSV, the journal study table and the
 *     case-level CSV all pick a new field up with no literal edited anywhere, AND every
 *     one of them is byte-identical for a project that configured no fields.
 *  2. STILL MANUAL, DELIBERATELY — `mkStudy` (both copies) never mints an `xf_` key,
 *     `validateStudy` never invents a rule for one, and `expectedFieldsFor` never counts
 *     one (progress denominators must not regress — the 107.md decision, restated).
 *  3. SSR — the §35 `Add field` menu (catalog by category + search + custom form), the
 *     §52 `Columns` control, and the contributions table with an optional column that is
 *     populated in one study and MISSING in another (§56), plus the Part XIX degradation
 *     of a column whose field was archived.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkStudy } from '../../../src/research-engine/project-model/defaults.js';
import { mkStudy as mkStudyUi } from '../../../src/frontend/workspace/projectHelpers.js';
import { validateStudy } from '../../../src/research-engine/validation/study-validator.js';
import { expectedFieldsFor, progressOf } from '../../../src/research-engine/extraction/engine/articleStatus.js';
import { computeSyncHash } from '../../../src/research-engine/extraction/engine/syncState.js';
import { studyValues, STUDY_VALUE_FIELDS } from '../../../src/research-engine/provenance/fingerprint.js';
import { computeDependencyState } from '../../../src/research-engine/manuscript/dependencies.js';
import { buildStudyTableCSV } from '../../../src/research-engine/import-export/journalSubmission.js';
import { buildCaseExportRows, enableCaseSeries } from '../../../src/research-engine/extraction/caseSeries.js';
import {
  addCatalogField, addCustomField, storageKeyOf, projectFieldColumns,
  setExtractionFieldArchived, isProjectFieldKey,
} from '../../../src/research-engine/extraction/fieldRegistry.js';
import { buildExtractionCSV } from '../../../src/frontend/workspace/tabs/extractionTabs.jsx';
import ProjectFieldsPanel, {
  PROJECT_FIELDS_TITLE, ADD_FIELD_LABEL, PROJECT_FIELDS_EMPTY,
} from '../../../src/features/extraction/engine/ProjectFieldsPanel.jsx';
import {
  IndividualContributions, ContributionColumnsControl, writeContributionColumns,
  pairContributionColumns, readAnalysisConfig, applyAnalysisConfig, analysisConfigLabel,
  ANALYSIS_CONFIG_TARGETS, CONTRIBUTION_DEFAULT_COLUMNS, CONTRIBUTIONS_TITLE,
} from '../../../src/frontend/workspace/tabs/analysisTabs.jsx';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/** A project whose schema carries Country (an ALIAS) + Mean age (a CUSTOM xf_ field). */
function configured() {
  let f = addCatalogField([], 'country', () => 'ig').fields;
  const cust = addCustomField(f, { label: 'Mean age', dataType: 'decimal', unit: 'years', category: 'population' }, () => 'k1');
  f = cust.fields;
  return { fields: f, ageKey: storageKeyOf(f.find((x) => x.id === 'k1')) };
}
const AGE_KEY = 'xf_k1';

const row = (over = {}) => ({ ...mkStudy(), ...over });
const baseProject = (over = {}) => ({ id: 'p1', name: 'R', studies: [], ...over });

/* ══════════════ 1. the allow-lists that now DERIVE from the registry ══════════════ */

describe('derived allow-list — the analysis-sync hash', () => {
  it('picks a project-field edit up with no literal edited anywhere', () => {
    const s0 = row({ esType: 'OR', es: '1', lo: '0', hi: '2' });
    expect(computeSyncHash({ ...s0, [AGE_KEY]: '54' })).not.toBe(computeSyncHash(s0));
  });

  it('is byte-identical for a project that configured no fields', () => {
    const s0 = row({ esType: 'OR', es: '1', lo: '0', hi: '2' });
    expect(computeSyncHash({ ...s0, [AGE_KEY]: '' })).toBe(computeSyncHash(s0));
  });
});

describe('derived allow-list — the provenance value slice (88.md)', () => {
  it('STUDY_VALUE_FIELDS holds no xf_ literal, yet studyValues carries the value', () => {
    expect(STUDY_VALUE_FIELDS.some(isProjectFieldKey)).toBe(false);
    expect(studyValues(row({ [AGE_KEY]: '54' }))[AGE_KEY]).toBe('54');
  });

  it('an unconfigured project fingerprints exactly as before', () => {
    const s0 = row({ es: '1' });
    expect(JSON.stringify(studyValues(s0))).toBe(JSON.stringify(studyValues({ ...s0, [AGE_KEY]: '' })));
  });
});

describe('derived allow-list — the manuscript dependency slice (84.md)', () => {
  const dep = (studies) => computeDependencyState({ studies, pico: {}, search: {}, prisma: {} }, {});

  it('editing a project field marks studies.values changed', () => {
    const before = dep([row({ id: 's1', es: '1', lo: '0', hi: '2' })]);
    const after = dep([row({ id: 's1', es: '1', lo: '0', hi: '2', [AGE_KEY]: '54' })]);
    expect(after['studies.values']).not.toBe(before['studies.values']);
    expect(after['studies.roster']).toBe(before['studies.roster']);   // it is a VALUE, not identity
  });

  it('an empty project-field key changes nothing (byte-stability)', () => {
    const before = dep([row({ id: 's1', es: '1' })]);
    expect(dep([row({ id: 's1', es: '1', [AGE_KEY]: '' })])['studies.values']).toBe(before['studies.values']);
  });

  it('the inline namespace rule agrees with fieldRegistry.isProjectFieldKey', () => {
    // dependencies.js deliberately restates the regex to stay free of engine imports.
    for (const k of ['xf_a', 'xf_meanAge', 'xf_k1']) expect(isProjectFieldKey(k)).toBe(true);
    for (const k of ['xf_', 'xfa', 'cv_a', 'es']) expect(isProjectFieldKey(k)).toBe(false);
    const before = computeDependencyState({ studies: [row({ id: 's1' })] }, {});
    const after = computeDependencyState({ studies: [row({ id: 's1', xfa: 'x' })] }, {});
    expect(after['studies.values']).toBe(before['studies.values']);   // `xfa` is NOT the namespace
  });
});

describe('derived allow-list — the three exporters', () => {
  const { fields } = configured();
  const studies = [row({ id: 's1', author: 'Smith', country: 'USA', [AGE_KEY]: '54' })];

  it('the extraction CSV gains the configured columns and nothing else', () => {
    const plain = buildExtractionCSV(studies, baseProject());
    const rich = buildExtractionCSV(studies, baseProject({ extractionFields: fields }));
    expect(plain.split('\n')[0]).not.toMatch(/Mean age/);
    expect(rich.split('\n')[0].endsWith(',Country,Mean age (years)')).toBe(true);
    expect(rich.split('\n')[1].endsWith(',USA,54')).toBe(true);
    // The FIXED part of the header is untouched — a project with no fields is byte-identical.
    expect(rich.split('\n')[0].startsWith(plain.split('\n')[0])).toBe(true);
  });

  it('an ARCHIVED field leaves the export exactly as a never-configured project', () => {
    const archived = setExtractionFieldArchived(fields, 'k1', true).fields;
    const csv = buildExtractionCSV(studies, baseProject({ extractionFields: archived }));
    expect(csv).not.toMatch(/Mean age/);
    expect(studies[0][AGE_KEY]).toBe('54');            // the value itself is untouched
  });

  it('the journal study table is byte-identical without a project, and gains columns with one', () => {
    const plain = buildStudyTableCSV(studies, {});
    expect(buildStudyTableCSV(studies, {}, baseProject())).toBe(plain);
    const rich = buildStudyTableCSV(studies, {}, baseProject({ extractionFields: fields }));
    expect(rich.split('\n')[0].endsWith(',Country,Mean age (years)')).toBe(true);
    expect(rich.split('\n')[1].endsWith(',USA,54')).toBe(true);
  });

  it('the case-level CSV carries them too, and is byte-identical without them', () => {
    const en = enableCaseSeries([row({ id: 'c1', doi: '10.1/x', author: 'Smith', [AGE_KEY]: '54' })], 'c1', { idFn: () => 'z1' });
    const plain = buildCaseExportRows(en.studies, []);
    expect(plain.columns.some((c) => c.key === AGE_KEY)).toBe(false);
    const rich = buildCaseExportRows(en.studies, [], { extractionFields: projectFieldColumns(baseProject({ extractionFields: fields })) });
    expect(rich.columns.map((c) => c.label)).toContain('Mean age (years)');
    expect(rich.rows[0][AGE_KEY]).toBe('54');
  });
});

/* ══════════════ 2. what deliberately STAYS manual ══════════════ */

describe('the lists a project field deliberately does NOT join', () => {
  it('neither mkStudy copy mints an xf_ key (dynamic keys, exactly like cv_*)', () => {
    for (const factory of [mkStudy, mkStudyUi]) {
      expect(Object.keys(factory()).some(isProjectFieldKey)).toBe(false);
    }
  });

  it('validateStudy invents no rule for a project field', () => {
    const clean = validateStudy(row({ esType: 'OR', es: '0.5', lo: '0.2', hi: '0.9' }));
    const withField = validateStudy(row({ esType: 'OR', es: '0.5', lo: '0.2', hi: '0.9', [AGE_KEY]: 'not a number' }));
    expect(withField).toEqual(clean);
  });

  it('expectedFieldsFor / progressOf never count one — progress must not regress', () => {
    const s0 = row({ esType: 'PROP', events: '5', total: '10' });
    expect(expectedFieldsFor(s0).some(isProjectFieldKey)).toBe(false);
    expect(progressOf({ ...s0, [AGE_KEY]: '54' }).pct).toBe(progressOf(s0).pct);
  });
});

/* ══════════════ 3. SSR — the §35 Add-field surface ══════════════ */

describe('SSR — the project extraction fields section (§35/§40)', () => {
  it('renders the section header and the Add-field affordance on every article', () => {
    const html = renderToStaticMarkup(<ProjectFieldsPanel fields={[]} study={row()} studies={[]} onSetFields={() => {}} onSetValue={() => {}} />);
    expect(html).toContain(PROJECT_FIELDS_TITLE);
    expect(html).toContain('data-testid="pex-add-field"');
    expect(html).toContain(PROJECT_FIELDS_EMPTY);
    expect(html).toContain(ADD_FIELD_LABEL);
  });

  it('renders a configured field as a typed input carrying the study\'s value', () => {
    const { fields } = configured();
    const html = renderToStaticMarkup(
      <ProjectFieldsPanel fields={fields} study={row({ country: 'USA', [AGE_KEY]: '54' })} studies={[]}
        onSetFields={() => {}} onSetValue={() => {}} />);
    expect(html).toContain('data-testid="pex-xf-field-country"');
    expect(html).toContain('data-testid="pex-xf-field-k1"');
    expect(html).toContain('Mean age (years)');
    expect(html).toContain('value="USA"');
    expect(html).toContain('value="54"');
  });

  it('a HIDDEN or ARCHIVED field is not rendered on the form', () => {
    const { fields } = configured();
    for (const list of [setExtractionFieldArchived(fields, 'k1', true).fields,
      [...fields.filter((f) => f.id !== 'k1'), { ...fields.find((f) => f.id === 'k1'), hidden: true }]]) {
      const html = renderToStaticMarkup(<ProjectFieldsPanel fields={list} study={row()} studies={[]} onSetFields={() => {}} onSetValue={() => {}} />);
      expect(html).not.toContain('data-testid="pex-xf-field-k1"');
    }
  });

  it('the Add-field menu browses the catalog BY CATEGORY and offers a custom field (§36/§37)', () => {
    const html = renderToStaticMarkup(
      <ProjectFieldsPanel fields={[]} study={row()} studies={[]} initialMode="add" onSetFields={() => {}} onSetValue={() => {}} />);
    expect(html).toContain('data-testid="pex-add-field-menu"');
    expect(html).toContain('data-testid="pex-add-field-search"');
    for (const label of ['Bibliographic', 'Study characteristics', 'Population',
      'Intervention', 'Comparator', 'Outcome metadata', 'Methodological']) expect(html).toContain(label);
    expect(html).toContain('data-testid="pex-catalog-country"');
    expect(html).toContain('data-testid="pex-catalog-meanAge"');
    expect(html).toContain('data-testid="pex-add-custom-toggle"');
    // A measure-managed field is never offered as an addable catalog entry.
    expect(html).not.toContain('data-testid="pex-catalog-events"');
  });

  it('an already-enabled catalog field is shown as enabled, not offered twice', () => {
    const { fields } = configured();
    const html = renderToStaticMarkup(
      <ProjectFieldsPanel fields={fields} study={row()} studies={[]} initialMode="add" onSetFields={() => {}} onSetValue={() => {}} />);
    expect(html).toMatch(/data-testid="pex-catalog-country"[^>]*disabled/);
  });

  it('the manage list exposes the §39 ops and states the value count before a destructive one', () => {
    const { fields } = configured();
    const studies = [row({ [AGE_KEY]: '54' }), row()];
    const html = renderToStaticMarkup(
      <ProjectFieldsPanel fields={fields} study={studies[0]} studies={studies} initialMode="manage" onSetFields={() => {}} onSetValue={() => {}} />);
    expect(html).toContain('data-testid="pex-manage-fields"');
    expect(html).toContain('data-testid="pex-xf-archive-k1"');
    expect(html).toContain('data-testid="pex-xf-delete-k1"');
    expect(html).toContain('1 value');
    expect(html).toContain('values are stored against the field, not its name');
  });

  it('a read-only viewer gets no configuration affordance at all (§114/D13)', () => {
    const { fields } = configured();
    const html = renderToStaticMarkup(
      <ProjectFieldsPanel fields={fields} study={row()} studies={[]} readOnly onSetFields={() => {}} onSetValue={() => {}} />);
    expect(html).not.toContain('data-testid="pex-add-field"');
    expect(html).toMatch(/disabled/);
  });
});

/* ══════════════ 4. SSR — the §52-§56 contributions table ══════════════ */

const POOLED = runMeta([
  { id: 's1', author: 'Smith', year: '2020', n: '100', es: '0.5', lo: '0.2', hi: '0.8', country: 'USA', [AGE_KEY]: '54' },
  { id: 's2', author: 'Jones', year: '2021', n: '80', es: '0.3', lo: '0.1', hi: '0.5' },
], 'random');

describe('SSR — Individual Study Contributions (§52-§56)', () => {
  it('the DEFAULT table is unchanged: the same eight columns, no extras (§54)', () => {
    const html = renderToStaticMarkup(
      <IndividualContributions result={POOLED} project={baseProject()} outcomeKey="o|||" prec={undefined} method="random" />);
    expect(html).toContain(CONTRIBUTIONS_TITLE);
    for (const h of CONTRIBUTION_DEFAULT_COLUMNS) expect(html).toContain(`>${h}</th>`);
    expect((html.match(/<th[ >]/g) || []).length).toBe(CONTRIBUTION_DEFAULT_COLUMNS.length);
    expect(html).not.toContain('data-testid="contrib-columns"');   // no menu without a writer
  });

  it('renders the Columns control when the caller can persist a choice (§52)', () => {
    const html = renderToStaticMarkup(
      <IndividualContributions result={POOLED} project={baseProject()} outcomeKey="o|||" method="random" onSetColumns={() => {}} />);
    expect(html).toContain('data-testid="contrib-columns-toggle"');
    expect(html).toContain('Columns');
  });

  it('an optional column renders its value where extracted and the §56 MISSING state where not', () => {
    const { fields } = configured();
    const project = baseProject({
      extractionFields: fields,
      analysisSettings: { contributionColumns: { 'o|||': [AGE_KEY, 'country'] } },
    });
    const html = renderToStaticMarkup(
      <IndividualContributions result={POOLED} project={project} outcomeKey="o|||" method="random" onSetColumns={() => {}} />);
    expect(html).toContain(`data-testid="contrib-th-${AGE_KEY}"`);
    expect(html).toContain('data-testid="contrib-th-country"');
    expect(html).toContain('54 years');            // Smith 2020 — extracted
    expect(html).toContain('USA');
    expect(html).toContain('—');                   // Jones 2021 — not extracted
    expect(html).toContain('Not extracted');       // the honest tooltip
    expect(html).not.toMatch(/>undefined</);
    expect(html).not.toMatch(/>null</);
    // The default columns are all still there, plus the two optional ones.
    expect((html.match(/<th[ >]/g) || []).length).toBe(CONTRIBUTION_DEFAULT_COLUMNS.length + 2);
  });

  it('an ARCHIVED field degrades gracefully — the column is dropped and SAID SO (Part XIX)', () => {
    const { fields } = configured();
    const project = baseProject({
      extractionFields: setExtractionFieldArchived(fields, 'k1', true).fields,
      analysisSettings: { contributionColumns: { 'o|||': [AGE_KEY, 'country'] } },
    });
    const html = renderToStaticMarkup(
      <IndividualContributions result={POOLED} project={project} outcomeKey="o|||" method="random" onSetColumns={() => {}} />);
    expect(html).toContain('data-testid="contrib-unavailable"');
    expect(html).toContain('no longer in this project&#x27;s extraction schema');
    expect(html).not.toContain(`data-testid="contrib-th-${AGE_KEY}"`);
    expect(html).toContain('data-testid="contrib-th-country"');   // the survivor still renders
    expect((html.match(/<th[ >]/g) || []).length).toBe(CONTRIBUTION_DEFAULT_COLUMNS.length + 1);
  });

  it('a selection referencing a field that no longer exists at all does not crash', () => {
    const project = baseProject({ analysisSettings: { contributionColumns: { 'o|||': ['xf_gone', 'nonsense'] } } });
    const html = renderToStaticMarkup(
      <IndividualContributions result={POOLED} project={project} outcomeKey="o|||" method="random" />);
    expect(html).toContain('data-testid="contrib-unavailable"');
    expect((html.match(/<th[ >]/g) || []).length).toBe(CONTRIBUTION_DEFAULT_COLUMNS.length);
  });

  it('the Columns menu is driven by the SAME registry — no second hard-coded list', () => {
    const { fields } = configured();
    const project = baseProject({ extractionFields: fields });
    const html = renderToStaticMarkup(
      <ContributionColumnsControl project={project} selected={[AGE_KEY]} onChange={() => {}} open />);
    expect(html).toContain('data-testid="contrib-columns-menu"');
    expect(html).toContain(`data-testid="contrib-col-${AGE_KEY}"`);
    expect(html).toContain('data-testid="contrib-col-denominatorPopulation"');
    expect(html).toContain('data-testid="contrib-col-country"');
    expect(html).toContain('data-testid="contrib-columns-reset"');   // §55 restore defaults
    expect(html).toContain('Restore defaults');
    expect(html).toContain('SHOWN, IN ORDER');
  });
});

/* ══════════════ 5. persistence + the undo rails (§54/§55) ══════════════ */

describe('analysisSettings.contributionColumns — persistence and undo (§54/§55)', () => {
  const KEY = 'Mortality|||30d';

  it('writes per outcome pair and reads back in order', () => {
    const p = writeContributionColumns(baseProject(), KEY, ['country', AGE_KEY]);
    expect(p.analysisSettings.contributionColumns[KEY]).toEqual(['country', AGE_KEY]);
    expect(pairContributionColumns(p, { key: KEY })).toEqual(['country', AGE_KEY]);
    expect(pairContributionColumns(p, { key: 'other|||' })).toEqual([]);
    expect(pairContributionColumns(baseProject(), { key: KEY })).toEqual([]);
  });

  it('deduplicates and trims, so a double-toggle cannot corrupt the list', () => {
    const p = writeContributionColumns(baseProject(), KEY, [' country ', 'country', '', null, AGE_KEY]);
    expect(p.analysisSettings.contributionColumns[KEY]).toEqual(['country', AGE_KEY]);
  });

  it('"Restore defaults" deletes the entry AND the container — byte-identical blob (§55)', () => {
    const base = baseProject();
    const withCols = writeContributionColumns(base, KEY, ['country']);
    const cleared = writeContributionColumns(withCols, KEY, []);
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(base));
    expect('analysisSettings' in cleared).toBe(false);
  });

  it('an existing analysisSettings container survives a clear', () => {
    const base = baseProject({ analysisSettings: { model: 'fixed' } });
    const cleared = writeContributionColumns(writeContributionColumns(base, KEY, ['country']), KEY, []);
    expect(cleared.analysisSettings).toEqual({ model: 'fixed' });
  });

  it('rides the 108.md undo rails as ONE op per user action', () => {
    const addr = { target: ANALYSIS_CONFIG_TARGETS.CONTRIB_COLUMNS, outcomeKey: KEY };
    const base = baseProject();
    expect(readAnalysisConfig(base, addr)).toBeNull();                       // absent ⇒ defaults
    const p1 = applyAnalysisConfig(base, { ...addr, value: ['country', AGE_KEY] });
    expect(readAnalysisConfig(p1, addr)).toEqual(['country', AGE_KEY]);
    // A REORDER is one op, not N add/remove pairs.
    const p2 = applyAnalysisConfig(p1, { ...addr, value: [AGE_KEY, 'country'] });
    expect(readAnalysisConfig(p2, addr)).toEqual([AGE_KEY, 'country']);
    // Undo restores ABSENCE as absence.
    const undone = applyAnalysisConfig(p2, { ...addr, value: null });
    expect(JSON.stringify(undone)).toBe(JSON.stringify(base));
    expect(analysisConfigLabel(addr)).toBe('Contributions columns change');
  });
});
