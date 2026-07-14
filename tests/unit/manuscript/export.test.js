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

/* ── 85.md B2: placement-aware asset assembly — tokens resolve to numbered
      cross-references (bookmark + hyperlink) and the asset object is spliced
      after the block of its first body mention. Structure asserted by unzipping
      the OOXML (figures degrade to honest notes in Node — no canvas). ── */
describe('manuscript export — 85.md placement-aware assets', () => {
  async function unpack(project, draft, opts = {}) {
    const blob = await buildManuscriptDocx(project, draft, opts);
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    return zip.file('word/document.xml').async('string');
  }

  function blankDraft(title = 'Assets') {
    return normalizeDraft(makeManuscriptDraft({ title }));
  }

  it('(a) inline placement: mention paragraph → table → next paragraph, with bookmark + hyperlink', async () => {
    const project = fixtureProject();
    const d = blankDraft();
    d.sections.methods.content = 'Intro paragraph before.\n\nSee [[table:study]] for the details.\n\nAfter paragraph text.';
    const doc = await unpack(project, d);
    const iMention = doc.indexOf('for the details');
    const iCaption = doc.indexOf('Table 1.');
    const iTable = doc.indexOf('<w:tbl', iCaption); // the spliced study table
    const iAfter = doc.indexOf('After paragraph text');
    expect(iMention).toBeGreaterThan(-1);
    expect(iCaption).toBeGreaterThan(iMention);
    expect(iTable).toBeGreaterThan(iCaption);
    expect(iAfter).toBeGreaterThan(iTable);
    // cross-reference machinery: bookmark on the caption, hyperlink at the mention
    expect(doc).toContain('w:name="ref_table_study"');
    expect(doc).toContain('w:anchor="ref_table_study"');
    expect(doc).not.toContain('[[table:');
  });

  it('(b) mid-ordered-list mention: the WHOLE list stays one numbering instance, table after it', async () => {
    const project = fixtureProject();
    const d = blankDraft();
    d.sections.methods.content = 'Before list.\n\n1. first step [[table:study]]\n2. second step\n3. third step\n\nAfter list.';
    const doc = await unpack(project, d);
    const iThird = doc.indexOf('third step');
    const iCaption = doc.indexOf('Table 1.');
    const iAfter = doc.indexOf('After list');
    expect(iCaption).toBeGreaterThan(iThird); // never spliced INTO the list
    expect(iAfter).toBeGreaterThan(iCaption);
    // one ordered list → exactly one concrete numbering instance (no restart)
    const numIds = new Set([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((x) => x[1]));
    expect(numIds.size).toBe(1);
  });

  it('(c) repeated references emit the asset exactly once', async () => {
    const project = fixtureProject();
    const d = blankDraft();
    d.sections.methods.content = 'First mention [[table:study]].';
    d.sections.results.content = 'Second mention [[table:study]] again [[table:study]].';
    const doc = await unpack(project, d);
    expect([...doc.matchAll(/Table 1\./g)].length).toBe(1); // one caption
    expect([...doc.matchAll(/w:name="ref_table_study"/g)].length).toBe(1); // one bookmark
    expect([...doc.matchAll(/w:anchor="ref_table_study"/g)].length).toBe(3); // every mention links
  });

  it('(f) legacy token-less draft → end-section layout, sequential captions, honest figure notes', async () => {
    const project = fixtureProject();
    const d = draftFor(project); // legacy generation — no tokens
    const doc = await unpack(project, d);
    // Tables land in the end "Tables" section, numbered sequentially.
    const iTablesH = doc.indexOf('>Tables<');
    expect(iTablesH).toBeGreaterThan(-1);
    const t1 = doc.indexOf('Table 1.');
    const t2 = doc.indexOf('Table 2.');
    const t3 = doc.indexOf('Table 3.');
    expect(t1).toBeGreaterThan(iTablesH);
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
    // Figures: rasterization degrades gracefully in Node → caption + honest note.
    expect(doc).toContain('Figure 1. PRISMA 2020 flow diagram');
    expect(doc).toContain('could not be generated for this export');
  });

  it('(g) unresolved reference renders "Table ?" and never crashes or leaks the token', async () => {
    const project = fixtureProject();
    const d = blankDraft();
    d.sections.methods.content = 'See [[table:doesnotexist]] here.';
    const doc = await unpack(project, d);
    expect(doc).toContain('Table ?');
    expect(doc).not.toContain('[[table:');
  });

  it('(h) statements render BOTH cite and asset markers (no literal token leak)', async () => {
    const project = fixtureProject();
    const d = blankDraft();
    d.sections.results.content = 'Evidence [[cite:s1]] and [[table:study]].';
    d.statements.funding = 'Supported by X [[cite:s1]]; see [[table:study]].';
    const doc = await unpack(project, d);
    expect(doc).not.toContain('[[cite:');
    expect(doc).not.toContain('[[table:');
    expect(doc).toContain('Supported by X [1]; see ');
    // the statement's asset mention is a live cross-reference too
    expect([...doc.matchAll(/w:anchor="ref_table_study"/g)].length).toBeGreaterThanOrEqual(2);
  });

  it('(i) >8-column table gets FIXED layout, grid columns and the 8pt step-down (+ onInfo)', async () => {
    const project = fixtureProject();
    const d = blankDraft();
    d.sections.methods.content = 'See [[table:study]].';
    const cols = Array.from({ length: 9 }, (_, i) => ({ key: `c${i}`, label: `C${i}` }));
    const na = { available: false };
    const wideTable = {
      id: 'study_characteristics_table', title: 'Wide table', available: true,
      columns: cols, rows: [{ c0: 'alpha' }], note: '', warnings: [], generatedFrom: 'studies',
    };
    const infos = [];
    const doc = await unpack(project, d, {
      tables: { study: wideTable, sof: na, prisma: na, rob: na, search: na },
      onInfo: (code, message) => infos.push({ code, message }),
    });
    expect(doc).toContain('w:type="fixed"');
    expect(doc).toContain('<w:gridCol');
    expect(doc).toContain('<w:sz w:val="16"/>');
    expect(infos.some((x) => x.code === 'wide-table')).toBe(true);
  });

  it('(j) keep-together only on SMALL tables (row cantSplit present small, absent big)', async () => {
    const project = fixtureProject();
    const dSmall = blankDraft();
    dSmall.sections.methods.content = 'See [[table:study]].'; // 3-row fixture table → small
    const docSmall = await unpack(project, dSmall);
    expect(docSmall).toContain('<w:cantSplit');

    const na = { available: false };
    const bigRows = Array.from({ length: 12 }, (_, i) => ({ c0: `row ${i}` }));
    const bigTable = {
      id: 'study_characteristics_table', title: 'Big table', available: true,
      columns: [{ key: 'c0', label: 'C0' }], rows: bigRows, note: '', warnings: [], generatedFrom: 'studies',
    };
    const dBig = blankDraft();
    dBig.sections.methods.content = 'See [[table:study]].';
    const docBig = await unpack(project, dBig, { tables: { study: bigTable, sof: na, prisma: na, rob: na, search: na } });
    expect(docBig).not.toContain('<w:cantSplit');
  });

  it('builder warnings[] export as italic notes under the table', async () => {
    const project = fixtureProject();
    const d = blankDraft();
    d.sections.methods.content = 'See [[table:study]].';
    const na = { available: false };
    const warnTable = {
      id: 'study_characteristics_table', title: 'Warned table', available: true,
      columns: [{ key: 'c0', label: 'C0' }], rows: [{ c0: 'x' }], note: 'A note.',
      warnings: ['Participant totals are partial.'], generatedFrom: 'studies',
    };
    const doc = await unpack(project, d, { tables: { study: warnTable, sof: na, prisma: na, rob: na, search: na } });
    expect(doc).toContain('Participant totals are partial.');
    expect(doc).toContain('A note.');
  });
});
