/**
 * demographicsDocx119.test.js — 119.md §6, the export half of the manuscript integration.
 *
 * "Exported DOCX tables must remain editable Word tables rather than flattened
 * screenshots." The study-characteristics table now carries the review's demographics
 * columns, so this file proves they arrive in word/document.xml as REAL table markup
 * (<w:tbl>/<w:tr>/<w:tc>) with the arm-scoped headers and the statistic rendered exactly
 * as the article reported it — no image, no coercion, and an unreported value that still
 * reads as "not reported" in Word.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';
import { addCatalogField, writeFieldCellPatch, projectExtractionFields } from '../../../src/research-engine/extraction/fieldRegistry.js';
import { addDemographicsArm } from '../../../src/research-engine/extraction/demographics.js';

function project() {
  let fields = addCatalogField([], 'age').fields;
  fields = addCatalogField(fields, 'sexFemale').fields;
  let cfg = addDemographicsArm({}, 'Intervention').config;
  cfg = addDemographicsArm(cfg, 'Control').config;
  const def = projectExtractionFields({ extractionFields: fields })[0];
  const study = {
    id: 's1', author: 'Smith', year: '2024', design: 'RCT',
    ...writeFieldCellPatch({}, def, { type: 'mean_sd', values: { mean: '45.2', sd: '10.1' } }, 'exp'),
  };
  const withCtrl = { ...study, ...writeFieldCellPatch(study, def, { state: 'not-reported' }, 'ctrl') };
  return {
    id: 'p1', name: 'Statins', pico: {}, search: { dbs: {} },
    extractionFields: fields, demographicsTable: cfg, studies: [withCtrl],
  };
}

const draft = () => {
  const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  d.sections.results.content = 'See {{table:study}} for the included studies.';
  return d;
};

describe('119.md §6 — demographics columns in the Word export', () => {
  it('exports a real Word table carrying the arm columns and the reported statistic', async () => {
    const blob = await buildManuscriptDocx(project(), draft(), {});
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const doc = await zip.file('word/document.xml').async('string');

    expect(doc).toContain('<w:tbl>');                       // a Word table, not a picture
    expect(doc).not.toContain('word/media/');               // …nothing rasterised
    expect(doc).toContain('Age (years) — Intervention');
    expect(doc).toContain('45.2 (10.1) years');
    // The control arm was recorded as NOT REPORTED — the column exists and says so.
    expect(doc).toContain('Age (years) — Control');
    expect(doc).toContain('NR');
    // No fabricated zero anywhere in that row's cells.
    expect(doc).not.toContain('0.0 (0.0)');
  });

  it('a project with no demographics configuration exports the table it always did', async () => {
    const plain = { id: 'p1', name: 'Statins', pico: {}, search: { dbs: {} }, studies: [{ id: 's1', author: 'Smith', year: '2024', design: 'RCT' }] };
    const blob = await buildManuscriptDocx(plain, draft(), {});
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const doc = await zip.file('word/document.xml').async('string');
    expect(doc).toContain('<w:tbl>');
    expect(doc).not.toContain('Age (years)');
  });
});
