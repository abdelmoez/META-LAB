/**
 * 85.md B2 — figure emission structure. Node has no canvas, so the PNG
 * renderers are MOCKED here (tiny fake bytes) to assert what the exporter does
 * once rasterization succeeds: ImageRun with altText (docPr descr), captions at
 * the placement point, legend paragraphs, and the onProgress narration.
 * (The unmocked degrade-to-note path is covered in export.test.js.)
 */
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';

vi.mock('../../../src/features/manuscript/export/figures.js', () => {
  const fake = (w, h) => ({
    blob: new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
    width: w, height: h, svg: '<svg/>',
  });
  return {
    prismaPng: vi.fn(async () => fake(1800, 2000)),
    forestPng: vi.fn(async () => fake(2200, 1200)),
    funnelPng: vi.fn(async () => fake(2200, 1500)),
    robPng: vi.fn(async () => fake(1800, 900)),
  };
});

// Import AFTER the mock so manuscriptDocx binds the fakes.
import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';

function project() {
  return {
    id: 'p1', name: 'Statins', pico: { question: 'Q' },
    search: { dbs: {} },
    prisma: { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180', included: '', quant: '' },
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05' },
    ],
  };
}

async function unpack(proj, draft, opts = {}) {
  const blob = await buildManuscriptDocx(proj, draft, opts);
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  return zip.file('word/document.xml').async('string');
}

describe('manuscript export — figure emission (mocked rasterizer)', () => {
  it('(e) embeds PNG figures with altText (docPr descr = caption text)', async () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d.sections.results.content = 'Flow is shown in [[figure:prisma]].';
    const doc = await unpack(project(), d);
    expect(doc).toContain('<w:drawing>');
    // altText → wp:docPr descr/title
    expect(doc).toMatch(/descr="Figure 1\. PRISMA 2020 flow diagram"/);
    expect(doc).not.toContain('could not be generated');
  });

  it('figure is spliced after its mention block, with caption + bookmark + legend', async () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d.sections.results.content = 'Flow is shown in [[figure:prisma]].\n\nTail paragraph.';
    d.assets = { 'figure:prisma': { legend: 'Counts follow PRISMA 2020.' } };
    const doc = await unpack(project(), d);
    const iMention = doc.indexOf('Flow is shown in');
    const iCaption = doc.indexOf('Figure 1. PRISMA 2020 flow diagram');
    const iDrawing = doc.indexOf('<w:drawing>', iCaption);
    const iLegend = doc.indexOf('Counts follow PRISMA 2020.');
    const iTail = doc.indexOf('Tail paragraph');
    expect(iCaption).toBeGreaterThan(iMention);
    expect(iDrawing).toBeGreaterThan(iCaption);
    expect(iLegend).toBeGreaterThan(iDrawing);
    expect(iTail).toBeGreaterThan(iLegend);
    expect(doc).toContain('w:name="ref_figure_prisma"');
    expect(doc).toContain('w:anchor="ref_figure_prisma"');
  });

  it('onProgress narrates every rendered figure (step/total)', async () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d.sections.results.content = 'See [[figure:prisma]] and [[figure:funnel]].';
    const calls = [];
    await unpack(project(), d, { onProgress: (step, total, label) => calls.push([step, total, label]) });
    // prisma + forest-primary (default included) + funnel (auto-included by ref)
    expect(calls.length).toBe(3);
    expect(calls[0][0]).toBe(1);
    expect(calls.every((c) => c[1] === 3)).toBe(true);
    expect(calls.every((c) => typeof c[2] === 'string' && c[2].length > 0)).toBe(true);
  });

  it('includeFigures:false suppresses figure objects but keeps text markers', async () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d.sections.results.content = 'See [[figure:prisma]].';
    const doc = await unpack(project(), d, { includeFigures: false });
    expect(doc).not.toContain('<w:drawing>');
    expect(doc).toContain('Figure 1'); // the cross-reference text survives
  });
});
