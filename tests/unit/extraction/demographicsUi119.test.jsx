/**
 * demographicsUi119.test.jsx — 119.md §6, the SURFACES.
 *
 * House style for UI in this repo: renderToStaticMarkup (no jsdom) — the initial render
 * is pinned, and the interaction itself is covered by the Playwright spec
 * (e2e/extraction/demographics-119.spec.ts, §10 scenarios 13-14).
 *
 * WHAT IS PINNED
 *  1. the Extraction demographics area exists, is honest about being unconfigured, and
 *     recommends FIELDS with reasons (never values);
 *  2. a statistic field renders a statistic-type select, its slots and the four-state
 *     control — overall AND once per configured arm;
 *  3. the manuscript's study-characteristics table marks the extraction-backed cells as
 *     editable and says, in words, that editing one changes the project data.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ProjectFieldsPanel from '../../../src/features/extraction/engine/ProjectFieldsPanel.jsx';
import DemographicsPanel, {
  DEMOGRAPHICS_TITLE, DEMOGRAPHICS_EMPTY, RECOMMEND_NOTE, ARMS_NOTE,
} from '../../../src/features/extraction/engine/DemographicsPanel.jsx';
import { DemographicsDataTable, DEMO_UPSTREAM_NOTICE } from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { addCatalogField, writeFieldCellPatch, projectExtractionFields } from '../../../src/research-engine/extraction/fieldRegistry.js';
import { addDemographicsArm } from '../../../src/research-engine/extraction/demographics.js';
import { buildStudyCharacteristicsTable } from '../../../src/research-engine/manuscript/tables.js';

function armedProject(rows = []) {
  let fields = addCatalogField([], 'age').fields;
  fields = addCatalogField(fields, 'sexFemale').fields;
  let cfg = addDemographicsArm({}, 'Intervention').config;
  cfg = addDemographicsArm(cfg, 'Control').config;
  return { extractionFields: fields, demographicsTable: cfg, studies: rows };
}

describe('§6 the Extraction demographics area', () => {
  it('is present, and says plainly that nothing is configured yet', () => {
    const html = renderToStaticMarkup(
      <DemographicsPanel project={{ studies: [] }} studies={[]} defaultOpen
        onSetFields={() => {}} onSetConfig={() => {}} />,
    );
    expect(html).toContain('data-testid="pex-demographics"');
    expect(html).toContain(DEMOGRAPHICS_TITLE.replace('&', '&amp;'));
    expect(html).toContain('not configured');
    expect(html).toContain(DEMOGRAPHICS_EMPTY);
  });

  it('offers the curated library and design-aware recommendations, with the honest note', () => {
    const html = renderToStaticMarkup(
      <DemographicsPanel project={{ studies: [{ id: 's1', design: 'Randomized controlled trial' }] }}
        studies={[{ id: 's1', design: 'Randomized controlled trial' }]} defaultOpen
        onSetFields={() => {}} onSetConfig={() => {}} />,
    );
    expect(html).toContain(RECOMMEND_NOTE);
    expect(html).toContain('data-testid="pex-demo-recommend-randomizedSample"');
    expect(html).toContain('data-testid="pex-demo-add-age"');
    expect(html).toContain('data-testid="pex-demo-add-followup"');
  });

  it('a read-only member sees the table but no way to change it', () => {
    const html = renderToStaticMarkup(
      <DemographicsPanel project={armedProject()} studies={[]} readOnly defaultOpen />,
    );
    expect(html).toContain('You can view this table but not change it.');
  });

  it('the arms tab explains that per-arm values are never merged', () => {
    const html = renderToStaticMarkup(
      <DemographicsPanel project={armedProject()} studies={[]} defaultOpen initialTab="arms"
        onSetFields={() => {}} onSetConfig={() => {}} />,
    );
    expect(html).toContain(ARMS_NOTE.slice(0, 40));
    expect(html).toContain('data-testid="pex-demo-arm-add"');
  });
});

describe('§6 the statistic cell on the article form', () => {
  it('renders the statistic select, its slots and the four-state control per arm', () => {
    const project = armedProject();
    const fields = projectExtractionFields(project);
    const study = { id: 's1', ...writeFieldCellPatch({}, fields[0], { values: { mean: '45', sd: '9' } }, 'exp') };
    const html = renderToStaticMarkup(
      <ProjectFieldsPanel fields={fields} study={study} studies={[study]} project={project}
        onSetValue={() => {}} onSetValues={() => {}} onSetFields={() => {}} />,
    );
    const arms = project.demographicsTable.arms;
    expect(html).toContain('data-testid="pex-xf-cell-age-overall"');
    expect(html).toContain(`data-testid="pex-xf-cell-age-${arms[0].id}"`);
    expect(html).toContain(`data-testid="pex-xf-cell-age-${arms[1].id}"`);
    expect(html).toContain(`data-testid="pex-xf-slot-age-${arms[0].id}-mean"`);
    expect(html).toContain(`data-testid="pex-xf-slot-age-${arms[0].id}-sd"`);
    expect(html).toContain(`data-testid="pex-xf-state-age-${arms[0].id}"`);
    // The four states are offered by name, and the missing state is not one of them.
    expect(html).toContain('Not reported');
    expect(html).toContain('Not applicable');
    expect(html).toContain('Unclear');
    // The value the reviewer already recorded is in the arm's own input.
    expect(html).toContain('value="45"');
  });

  it('a project with NO arms renders the 116 single input for a plain field', () => {
    const project = { extractionFields: addCatalogField([], 'setting').fields };
    const fields = projectExtractionFields(project);
    const html = renderToStaticMarkup(
      <ProjectFieldsPanel fields={fields} study={{ id: 's1', xf_setting: 'ICU' }} studies={[]} project={project}
        onSetValue={() => {}} onSetFields={() => {}} />,
    );
    expect(html).toContain('data-testid="pex-xf-field-setting"');
    expect(html).not.toContain('pex-xf-state-setting');
  });
});

describe('§6 the manuscript table stays connected to the extraction data', () => {
  it('marks extraction-backed cells editable and says what editing one does', () => {
    const project = armedProject();
    const armId = project.demographicsTable.arms[0].id;
    const study = { id: 's1', author: 'Smith', year: '2024', design: 'RCT',
      ...writeFieldCellPatch({}, projectExtractionFields(project)[0], { values: { mean: '45', sd: '9' } }, armId) };
    const p = { ...project, studies: [study] };
    const table = buildStudyCharacteristicsTable(p);
    const m = { demographicsCell: () => null, editDemographicsCell: () => ({ ok: true }) };
    const html = renderToStaticMarkup(<DemographicsDataTable m={m} table={table} />);
    expect(html).toContain('data-testid="stitch-manuscript-demo-cell-s1-demo-age-');
    expect(html).toContain('45 (9) years');
    expect(html).toContain('changing one here changes the study record itself');
    // The builder's own columns are NOT editable from the manuscript.
    expect(html).not.toContain('demo-cell-s1-design');
    expect(DEMO_UPSTREAM_NOTICE).toMatch(/extracted project data/);
  });

  it('without the write seam (no permission / older host) the table is plain text', () => {
    const project = armedProject();
    const study = { id: 's1', author: 'Smith', year: '2024',
      ...writeFieldCellPatch({}, projectExtractionFields(project)[0], { values: { mean: '45' } }) };
    const table = buildStudyCharacteristicsTable({ ...project, studies: [study] });
    const html = renderToStaticMarkup(<DemographicsDataTable m={{}} table={table} />);
    expect(html).toContain('45 years');
    expect(html).not.toContain('stitch-manuscript-demo-cell-');
  });
});
