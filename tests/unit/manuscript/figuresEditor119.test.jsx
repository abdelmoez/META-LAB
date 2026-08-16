/**
 * 119.md §5 — the EDITOR side of the uploaded-figure workflow.
 *
 *   · mdDom: the marker renders as a real <img> block and reverses to the marker
 *     (never to an <img> tag, never to the rendered "Figure 3." text);
 *   · the paste sanitiser no longer swallows a picture silently;
 *   · the Figures panel shows uploaded and generated figures in ONE menu, with
 *     honest placement status and the file's own metadata;
 *   · the removal warning states the real reference count and the real guarantee.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  mdToHtml, htmlToMd, figureBlockHtml, FIGURE_BLOCK_CLASS, FIGURE_IMG_CLASS,
  FIGURE_CAPTION_TITLE_CLASS, FIGURE_MISSING_TEXT,
} from '../../../src/features/manuscript/richEditor/mdDom.js';
import {
  FiguresPanel, FigureDeleteDialog, FigureContextBar, FIGURE_REMOVE_UNDO_NOTE,
} from '../../../src/features/manuscript/manuscriptPanels.jsx';

const RAW = '/api/projects/p1/manuscript-figures/row-1/raw';

const figures = { fa1: { src: RAW, alt: 'A flow chart', displayWidth: 60, align: 'left' } };

describe('119.md §5 — mdDom: the figure block', () => {
  it('renders the marker as an <img> pointing at the authenticated raw route', () => {
    const html = mdToHtml('[[figcap:fa1]] Study flow', {
      assetNumbers: { 'figure:fa1': 3 }, figures,
    });
    expect(html).toContain(`class="${FIGURE_BLOCK_CLASS}"`);
    expect(html).toContain('data-figcap="fa1"');
    expect(html).toContain(`src="${RAW}"`);
    expect(html).toContain('alt="A flow chart"');
    expect(html).toContain('Figure 3.');
    expect(html).toContain('Study flow');
    // The island contract: the block is not editable, its title is.
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain(`class="${FIGURE_CAPTION_TITLE_CLASS}" data-figcap-title="true" contenteditable="true"`);
    expect(html).toContain('data-fig-width="60"');
    expect(html).toContain('data-fig-align="left"');
  });

  it('says so honestly when the registry knows the file is gone', () => {
    const html = mdToHtml('[[figcap:fa1]] Study flow', { figures: { fa1: { missing: true } } });
    expect(html).toContain(FIGURE_MISSING_TEXT);
    expect(html).not.toContain('<img');
  });

  it('reverses to the MARKER — never to an <img> and never to "Figure 3."', () => {
    const html = mdToHtml('[[figcap:fa1]] Study flow', { assetNumbers: { 'figure:fa1': 3 }, figures });
    const md = htmlToMd(html);
    expect(md).toBe('[[figcap:fa1]] Study flow');
    expect(md).not.toContain('<img');
    expect(md).not.toContain('Figure 3.');
  });

  it('round-trips idempotently (the mdDom contract)', () => {
    const md0 = 'Intro paragraph\n\n[[figcap:fa1]] Study flow\n\nAfter the figure';
    const once = htmlToMd(mdToHtml(md0, { figures }));
    const twice = htmlToMd(mdToHtml(once, { figures }));
    expect(once).toBe(md0);
    expect(twice).toBe(once);
  });

  it('a corrupt figure key degrades to text rather than minting a broken object', () => {
    expect(figureBlockHtml('NOT VALID', 'x', 'Figure 1.', {})).toBe('');
  });

  it('a stray mid-sentence marker never leaks its raw syntax into the page', () => {
    const html = mdToHtml('see [[figcap:fa1]] here', { figures });
    expect(html).not.toContain('[[figcap:');
    expect(html).toContain('see');
  });

  it('a pasted <img> from foreign HTML is still dropped (the bytes path is the only one)', () => {
    // The editor intercepts image FILES before this; remote markup is never trusted.
    expect(htmlToMd('<p>before<img src="https://evil.example/x.png">after</p>'))
      .toBe('beforeafter');
  });
});

/* ── the Figures panel ─────────────────────────────────────────────────────── */

const uploadAsset = (over = {}) => ({
  id: 'figure:fa1', kind: 'figure', origin: 'upload', figKey: 'fa1', figureId: 'row-1',
  title: 'Study flow', defaultCaption: 'Study flow', available: true, included: true,
  includedDefault: true, placed: true, source: 'upload', fileName: 'flow.png',
  width: 800, height: 600, fileSize: 4096, uploadedByName: 'Dr A',
  uploadedAt: '2026-01-01T00:00:00.000Z', replacedCount: 0, ...over,
});

const mockM = (assets) => ({
  assets,
  activeDraft: { id: 'd1', templateId: 'generic', assets: {} },
  activeId: 'd1',
  saveState: 'saved',
  sourcesSettled: true,
  assetNumbering: { byId: { 'figure:fa1': 1 }, mentioned: new Set(), autoIncluded: new Set() },
  tables: {}, staleness: {},
  liveDraft: { sections: {} },
  queueAssetPatch: vi.fn(),
  uploadFigures: vi.fn(),
  replaceFigureFile: vi.fn(),
  updateFigureMeta: vi.fn(),
  deleteFigure: vi.fn(),
  figureRawUrl: (id) => `/api/projects/p1/manuscript-figures/${id}/raw`,
  figureDownloadUrl: (id) => `/api/projects/p1/manuscript-figures/${id}/download`,
  figureBusy: false, figureError: '',
});

describe('119.md §5 — the Figures menu holds uploaded and generated figures', () => {
  it('offers an upload entry point and lists the uploaded figure with its file facts', () => {
    const html = renderToStaticMarkup(<FiguresPanel m={mockM([uploadAsset()])} />);
    expect(html).toContain('stitch-manuscript-figures-upload');
    expect(html).toContain('PNG, JPEG, GIF or WebP');
    expect(html).toContain('stitch-manuscript-figure-preview-figure-fa1');
    expect(html).toContain('flow.png');
    expect(html).toContain('800 × 600 px');
    expect(html).toContain('Dr A');
    // §5 "Replace", "Download the original where permitted", "Remove it"
    expect(html).toContain('stitch-manuscript-figure-replace-figure-fa1');
    expect(html).toContain('stitch-manuscript-figure-download-figure-fa1');
    expect(html).toContain('stitch-manuscript-figure-delete-figure-fa1');
    // §5 "Alt text" + "Source/provenance" are row metadata, edited here.
    expect(html).toContain('stitch-manuscript-figure-alt-figure-fa1');
    expect(html).toContain('stitch-manuscript-figure-source-figure-fa1');
  });

  it('numbers the uploaded figure in the SAME sequence as generated ones', () => {
    const html = renderToStaticMarkup(<FiguresPanel m={mockM([uploadAsset()])} />);
    expect(html).toContain('>Figure 1<');
  });

  it('states honestly that an uploaded picture is not placed yet', () => {
    const m = mockM([uploadAsset({ placed: false, included: false })]);
    m.assetNumbering = { byId: {}, mentioned: new Set(), autoIncluded: new Set() };
    const html = renderToStaticMarkup(<FiguresPanel m={m} />);
    expect(html).toContain('stitch-manuscript-asset-unplaced-figure-fa1');
    expect(html).toContain('Not placed');
    expect(html).toContain('Not in export');
  });

  it('shows the replacement history once the image has been replaced', () => {
    const html = renderToStaticMarkup(<FiguresPanel m={mockM([uploadAsset({ replacedCount: 2, replacedAt: '2026-02-02T00:00:00.000Z' })])} />);
    expect(html).toContain('stitch-manuscript-figure-version-figure-fa1');
    expect(html).toContain('Version 3');
  });

  it('says the image file is missing rather than showing a broken picture', () => {
    const html = renderToStaticMarkup(<FiguresPanel m={mockM([uploadAsset({ available: false })])} />);
    expect(html).toContain('image file is missing');
  });
});

describe('119.md §5 — removing a referenced figure warns first', () => {
  it('states the real reference count and the real undo guarantee', () => {
    const html = renderToStaticMarkup(
      <FigureDeleteDialog info={{ figKey: 'fa1', count: 3, label: 'Figure 2' }} />,
    );
    expect(html).toContain('stitch-manuscript-figure-delete-confirm');
    expect(html).toContain('Remove Figure 2?');
    expect(html).toContain('referenced 3 times');
    // The wording is what ACTUALLY happens: the row survives, so the references
    // keep resolving and the picture prints at the end until it is placed again.
    expect(html).toContain('Those references keep working');
    expect(html).toContain('printed at the end of the exported document');
    expect(html).not.toContain('show as broken');
    expect(html).toContain(FIGURE_REMOVE_UNDO_NOTE);
    expect(FIGURE_REMOVE_UNDO_NOTE).toContain('image file is kept');
  });

  it('uses the singular for exactly one reference', () => {
    const html = renderToStaticMarkup(<FigureDeleteDialog info={{ count: 1, label: 'Figure 2' }} />);
    expect(html).toContain('referenced 1 time in the manuscript');
  });
});

describe('119.md §5 — the floating figure controls', () => {
  const rect = { top: 100, right: 400, bottom: 300, left: 100 };
  const pageEl = { getBoundingClientRect: () => ({ top: 0, right: 500, left: 0, width: 500 }) };

  it('offers replace, the safe width steps, alignment and removal', () => {
    const html = renderToStaticMarkup(
      <FigureContextBar ctx={{ figKey: 'fa1', rect, width: 60, align: 'center' }} pageEl={pageEl} />,
    );
    expect(html).toContain('stitch-manuscript-figure-ctl');
    expect(html).toContain('stitch-manuscript-figure-op-replace');
    for (const w of [40, 60, 80, 100]) expect(html).toContain(`stitch-manuscript-figure-width-${w}`);
    for (const a of ['left', 'center', 'right']) expect(html).toContain(`stitch-manuscript-figure-align-${a}`);
    expect(html).toContain('stitch-manuscript-figure-op-remove');
    // Replacing must not read as "this makes a new figure".
    expect(html).toContain('keeps its number and every cross-reference');
  });
});
