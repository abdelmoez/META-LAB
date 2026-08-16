/**
 * 119.md §5 — "DOCX and other supported exports must embed the actual figure at
 * adequate quality, with its number, caption, legend, and cross-references
 * rendered correctly … ensure large images do not overflow the Word document."
 *
 * The uploaded picture's bytes come from the authenticated raw route, so `fetch`
 * is stubbed here with a real 1×1 PNG; everything else is the production path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { computeManuscriptAssets } from '../../../src/research-engine/manuscript/assets.js';
import { resolveNumbering } from '../../../src/research-engine/manuscript/refTokens.js';
import {
  buildManuscriptDocx, preloadUploadedFigures, uploadedImageParagraph, DOCX_MAX_FIGURE_PT,
} from '../../../src/features/manuscript/export/manuscriptDocx.js';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
]);

const RAW = '/api/projects/p1/manuscript-figures/row-1/raw';
const figRow = (over = {}) => ({
  id: 'row-1', figKey: 'fa1', fileName: 'flow.png', fileSize: 30, mimeType: 'image/png',
  fileHash: 'h1', width: 1600, height: 1200, altText: 'A study flow chart',
  sourceNote: '', origin: 'upload', uploadedBy: 'u1', uploadedByName: 'Dr A',
  createdAt: '2026-01-01T00:00:00.000Z', replacedCount: 0, ...over,
});

const project = () => ({ id: 'p1', name: 'Statins', pico: {}, search: { dbs: {} }, studies: [] });

const draftWithFigure = (md) => {
  const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  d.sections.results.content = md;
  return d;
};

const exportModel = (d, rows = [figRow()]) => {
  const assets = computeManuscriptAssets(project(), d, { figures: rows });
  const numbering = resolveNumbering({ sections: d, assets });
  return { assets, numbering };
};

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url) !== RAW) return { ok: false };
    return { ok: true, blob: async () => new Blob([PNG], { type: 'image/png' }) };
  });
});
afterEach(() => { globalThis.fetch = realFetch; });

const unpack = async (d, opts) => {
  const blob = await buildManuscriptDocx(project(), d, opts);
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  return { doc: await zip.file('word/document.xml').async('string'), zip };
};

describe('119.md §5 — the .docx embeds the ACTUAL uploaded picture', () => {
  it('emits the image where the marker sits, with its number, caption and alt text', async () => {
    const d = draftWithFigure('[[figcap:fa1]] Study flow\n\nTail paragraph.');
    d.assets = { 'figure:fa1': { caption: 'Screened records by stage.', legend: 'Adapted from the PRISMA statement.' } };
    const { assets, numbering } = exportModel(d);
    const { doc, zip } = await unpack(d, {
      assets, numbering, figureBlobUrl: (a) => (a.figureId ? RAW : null),
    });
    expect(doc).toContain('<w:drawing>');
    expect(doc).toContain('Figure 1. Study flow');
    expect(doc).toContain('Screened records by stage.');
    expect(doc).toContain('Adapted from the PRISMA statement.');
    // §5 "Alt text" — the researcher's own description, not an invented one.
    expect(doc).toMatch(/descr="A study flow chart"/);
    expect(doc).not.toContain('could not be embedded');
    // A real media part, with a real content type (an ImageRun without `type`
    // writes a part Word must repair).
    const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/'));
    expect(media.length).toBeGreaterThan(0);
    expect(media.some((n) => /\.png$/i.test(n))).toBe(true);
  });

  it('the picture is emitted ONCE — never inline AND again at the end', async () => {
    const d = draftWithFigure('[[figcap:fa1]] Study flow\n\nSee [[figure:fa1]] for details.');
    const { assets, numbering } = exportModel(d);
    const { doc } = await unpack(d, { assets, numbering, figureBlobUrl: () => RAW });
    expect(doc.split('Figure 1. Study flow').length - 1).toBe(1);
    expect(doc.split('<w:drawing>').length - 1).toBe(1);
  });

  it('a cross-reference to it resolves as a hyperlink to the caption bookmark', async () => {
    const d = draftWithFigure('[[figcap:fa1]] Study flow\n\nAs shown in [[figure:fa1]].');
    const { assets, numbering } = exportModel(d);
    const { doc } = await unpack(d, { assets, numbering, figureBlobUrl: () => RAW });
    expect(doc).toContain('<w:bookmarkStart');
    expect(doc).toContain('<w:hyperlink');
    expect(doc).toContain('Figure 1');
    expect(doc).not.toContain('[[figure:');
    expect(doc).not.toContain('[[figcap:');
  });

  it('degrades HONESTLY when the bytes cannot be fetched — caption + bookmark stay', async () => {
    const d = draftWithFigure('[[figcap:fa1]] Study flow\n\nAs shown in [[figure:fa1]].');
    const { assets, numbering } = exportModel(d);
    const { doc } = await unpack(d, {
      assets, numbering, figureBlobUrl: () => '/api/nope',   // fetch stub answers ok:false
    });
    expect(doc).toContain('could not be embedded in this export');
    expect(doc).toContain('Figure 1. Study flow');
    expect(doc).toContain('<w:hyperlink');   // the cross-reference still resolves
    expect(doc).not.toContain('<w:drawing>');
  });

  it('a REFERENCED but no-longer-placed picture is still printed (never a number with no figure)', async () => {
    // The researcher took the picture out of the text and kept the sentence that
    // points at it. The figure still exists, so the export must still show it —
    // at the end, with the other unanchored assets.
    const d = draftWithFigure('As shown in [[figure:fa1]].');
    const { assets, numbering } = exportModel(d);
    expect(numbering.byId['figure:fa1']).toBe(1);
    const { doc } = await unpack(d, { assets, numbering, figureBlobUrl: () => RAW });
    expect(doc).toContain('<w:drawing>');
    expect(doc).toContain('Figure 1.');
    expect(doc).not.toContain('could not be embedded');
  });

  it('never leaks a raw marker when a figure is placed in a non-body section', async () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d.sections.abstract.content = '[[figcap:fa1]] Graphical abstract';
    const { assets, numbering } = exportModel(d);
    const { doc } = await unpack(d, { assets, numbering, figureBlobUrl: () => RAW });
    expect(doc).not.toContain('[[figcap:');
    expect(doc).toContain('Figure 1. Graphical abstract');
  });
});

describe('119.md §5 — large images do not overflow the Word page', () => {
  const D = {
    Paragraph: class { constructor(o) { Object.assign(this, o); } },
    AlignmentType: { LEFT: 'left', RIGHT: 'right', CENTER: 'center' },
    ImageRun: class { constructor(o) { Object.assign(this, o); } },
  };

  it('caps at the usable content width and keeps the file\'s real aspect ratio', () => {
    const img = { data: PNG, type: 'png', width: 4000, height: 3000 };
    const p = uploadedImageParagraph(img, { displayWidth: 100, figKey: 'fa1' }, 1, 'T', D, {});
    const t = p.children[0].transformation;
    expect(t.width).toBe(DOCX_MAX_FIGURE_PT);
    expect(t.height).toBe(Math.round(DOCX_MAX_FIGURE_PT * 0.75));
    expect(t.width).toBeLessThanOrEqual(468);
  });

  it('honours the researcher\'s display width as a FRACTION of that cap', () => {
    const img = { data: PNG, type: 'png', width: 1000, height: 500 };
    const p = uploadedImageParagraph(img, { displayWidth: 50, figKey: 'fa1' }, 1, 'T', D, {});
    expect(p.children[0].transformation.width).toBe(Math.round(DOCX_MAX_FIGURE_PT / 2));
  });

  it('never invents an aspect ratio for a file whose dimensions could not be read', () => {
    const img = { data: PNG, type: 'png', width: 0, height: 0 };
    const p = uploadedImageParagraph(img, {}, 1, 'T', D, {});
    const t = p.children[0].transformation;
    expect(t.height).toBe(t.width);     // square-safe, never a guessed ratio
  });

  it('carries the alignment the researcher chose', () => {
    const img = { data: PNG, type: 'png', width: 100, height: 100 };
    expect(uploadedImageParagraph(img, { align: 'left' }, 1, 'T', D, {}).alignment).toBe('left');
    expect(uploadedImageParagraph(img, { align: 'right' }, 1, 'T', D, {}).alignment).toBe('right');
    expect(uploadedImageParagraph(img, {}, 1, 'T', D, {}).alignment).toBe('center');
  });
});

describe('119.md §5 — preloadUploadedFigures', () => {
  it('fetches only PLACED, available uploads and keys them by figure key', async () => {
    const d = draftWithFigure('[[figcap:fa1]] Study flow');
    const { assets } = exportModel(d, [figRow(), figRow({ id: 'row-2', figKey: 'fb2' })]);
    const map = await preloadUploadedFigures(assets, (a) => (a.figureId === 'row-1' ? RAW : null));
    expect(Object.keys(map)).toEqual(['fa1']);
    expect(map.fa1.type).toBe('png');
    expect(map.fa1.data).toBeInstanceOf(Uint8Array);
  });

  it('returns nothing (never throws) when there is no resolver', async () => {
    expect(await preloadUploadedFigures([figRow()], null)).toEqual({});
  });
});
