/**
 * Smoke tests for the CLIENT-side manuscript exporters (64.md / P3).
 * Runs in the Node (vitest) env: figure rasterization (DOM canvas) degrades
 * gracefully, so these verify the real .docx (OOXML) + repro .zip are produced
 * with valid structure and the expected entries.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';
import { buildReproPackage } from '../../../src/features/manuscript/export/manuscriptRepro.js';
import { prismaChecklistCsv, prismaSChecklistCsv } from '../../../src/features/manuscript/export/checklistExport.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { generateDraft } from '../../../src/research-engine/manuscript/draft.js';

function fixtureProject() {
  return {
    id: 'p1', name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?', P: 'Adults', I: 'Statins', C: 'Placebo', O: 'MACE', prosperoId: 'CRD42024000001' },
    search: { dbs: { PubMed: true, Embase: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180', reasons: [{ id: 'r1', r: 'Wrong population', n: '100' }], included: '', quant: '' },
    robMethod: 'RoB2',
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J, Doe A', year: '2020', journal: 'Lancet', doi: '10.1/a', pmid: '111', country: 'USA', design: 'RCT', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500', rob: { D1: 'Low', D2: 'Low', D3: 'Low', D4: 'Low', D5: 'Low' } },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', journal: 'NEJM', doi: '10.1/b', country: 'Korea', design: 'RCT', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300' },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', journal: 'JAMA', doi: '10.1/c', country: 'UK', design: 'RCT', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
    ],
  };
}

function draftFor(project) {
  const d = normalizeDraft(makeManuscriptDraft({ title: project.name }));
  const gen = generateDraft(project, {});
  for (const k of Object.keys(gen)) {
    if (d.sections[k]) { d.sections[k].content = gen[k]; d.sections[k].aiGenerated = true; }
  }
  d.statements.funding = 'None.';
  return d;
}

async function u8(blob) { return new Uint8Array(await blob.arrayBuffer()); }

describe('manuscript export — docx', () => {
  it('produces a real OOXML .docx (PK zip, non-trivial)', async () => {
    const project = fixtureProject();
    const blob = await buildManuscriptDocx(project, draftFor(project), {});
    expect(blob).toBeTruthy();
    const bytes = await u8(blob);
    expect(bytes.length).toBeGreaterThan(3000);
    // OOXML .docx is a ZIP — magic bytes "PK\x03\x04"
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    // central directory should reference word/document.xml
    const txt = Buffer.from(bytes).toString('latin1');
    expect(txt).toContain('word/document.xml');
    expect(txt).toContain('[Content_Types].xml');
  });

  it('does not throw on an empty project', async () => {
    const empty = { id: 'e', name: '', pico: {}, search: { dbs: {} }, prisma: {}, studies: [] };
    const blob = await buildManuscriptDocx(empty, normalizeDraft(makeManuscriptDraft()), {});
    const bytes = await u8(blob);
    expect(bytes[0]).toBe(0x50);
  });
});

describe('manuscript export — reproducibility zip', () => {
  it('bundles manifest + datasets + checklists', async () => {
    const project = fixtureProject();
    const blob = await buildReproPackage(project, draftFor(project), { appVersion: 'test' });
    const bytes = await u8(blob);
    expect(bytes[0]).toBe(0x50); // PK
    const txt = Buffer.from(bytes).toString('latin1');
    for (const name of [
      'manuscript.docx', 'manifest.json', 'settings/analysis_settings.json',
      'data/included_studies.csv', 'data/analysis_dataset.csv', 'data/risk_of_bias.csv',
      'search/search_strategy.csv', 'prisma/prisma_checklist.csv', 'prisma/prisma_s_checklist.csv',
      'methods/methods.txt',
    ]) {
      expect(txt, `zip should contain ${name}`).toContain(name);
    }
  });
});

describe('manuscript export — checklists', () => {
  it('emits PRISMA + PRISMA-S CSV with BOM + headers', () => {
    const project = fixtureProject();
    const c1 = prismaChecklistCsv(project, makeManuscriptDraft());
    expect(c1).toContain('Item ID,Section');
    const c2 = prismaSChecklistCsv(project);
    expect(c2).toContain('Item ID,Group');
  });
});

/* ── 65.md MS-4: converter parity — the docx path renders the SAME markdown
      subset as the WYSIWYG editor (real numbered lists, real tables, links,
      never raw tokens). Structure asserted by unzipping the OOXML. ── */
describe('manuscript export — MS-4 markdown subset parity', () => {
  // Empty-ish project → no data tables, so any <w:tbl> comes from the markdown.
  const emptyProject = () => ({ id: 'e', name: 'Parity', pico: {}, search: { dbs: {} }, prisma: {}, studies: [] });

  function subsetDraft() {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'Parity' }));
    d.sections.methods.content = [
      '# Analysis steps',
      '',
      '1. first step',
      '2. second step',
      '',
      'Later, a separate list:',
      '',
      '1. alpha step',
      '',
      'See [the protocol](https://example.com/protocol) and evidence [[cite:s1]].',
      '',
      '| Item | Value |',
      '| --- | --- |',
      '| AlphaCell | 0.05 |',
    ].join('\n');
    return d;
  }

  async function unpack(project, draft) {
    const blob = await buildManuscriptDocx(project, draft, {});
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const read = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');
    return {
      doc: await read('word/document.xml'),
      rels: await read('word/_rels/document.xml.rels'),
      numbering: await read('word/numbering.xml'),
    };
  }

  it('renders ordered lists as real Word numbering (no literal "1. ")', async () => {
    const { doc, numbering } = await unpack(emptyProject(), subsetDraft());
    expect(doc).toContain('<w:numPr>');
    expect(doc).toContain('first step');
    expect(doc).not.toContain('1. first step');
    // decimal "%1." level definition exists once in numbering.xml
    expect(numbering).toMatch(/w:numFmt w:val="decimal"/);
    expect(numbering).toContain('%1.');
    // two separate lists → two concrete numbering instances (each restarts at 1)
    const numIds = new Set([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(numIds.size).toBeGreaterThanOrEqual(2);
  });

  it('renders pipe tables as real docx tables', async () => {
    const { doc } = await unpack(emptyProject(), subsetDraft());
    expect(doc).toContain('<w:tbl>');
    expect(doc).toContain('AlphaCell');
    expect(doc).not.toContain('| AlphaCell |');
  });

  it('renders links as hyperlinks with a relationship', async () => {
    const { doc, rels } = await unpack(emptyProject(), subsetDraft());
    expect(doc).toContain('<w:hyperlink');
    expect(doc).toContain('the protocol');
    expect(rels).toContain('https://example.com/protocol');
    expect(doc).not.toContain('](https://example.com/protocol)');
  });

  it('never leaks raw cite tokens or emphasis markers', async () => {
    const project = fixtureProject();
    const d = draftFor(project);
    d.sections.results.content += '\n\nEvidence [[cite:s1]] and [[cite:s2]].';
    const { doc } = await unpack(project, d);
    expect(doc).not.toContain('[[cite:');
    expect(doc).toContain('[1]');
    expect(doc).not.toContain('**');
  });
});
