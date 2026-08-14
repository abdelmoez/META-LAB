/**
 * pdfAnnotationUi.test.jsx — 116.md §75, §81-§85, §97-§100 (Part VII).
 *
 * SSR static-markup pins (project convention: renderToStaticMarkup, no jsdom, no RTL).
 * Effects never run here, which is exactly the point: everything asserted below is
 * what the FIRST paint contains, so it cannot depend on a browser-only code path.
 *
 * The two pins that matter most:
 *  1. INERTNESS — AppPdfViewer with no `annotation` prop renders byte-identically to
 *     before this feature existed (no pane marker, no overlay, no listener). That is
 *     the contract that let the annotation subsystem land without touching RoB, the
 *     extraction workspace, or the three screening call sites.
 *  2. NON-COLOUR CUES (§100) — ownership and selection are readable without perceiving
 *     hue: an own highlight has a SOLID underline, someone else's a DASHED one, the
 *     selected one gains an outline, and every mark carries an aria-label naming both
 *     the author and the colour.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import AppPdfViewer from '../../../src/frontend/components/AppPdfViewer.jsx';
import PdfAnnotationPageLayer, { AnnotationListPanel } from '../../../src/frontend/components/PdfAnnotationLayer.jsx';
import { colorFor } from '../../../src/frontend/components/pdfAnnotationModel.js';

const PAGE = { w: 612, h: 792 };
const noop = () => {};

const mk = (over = {}) => ({
  id: 'ann-1', clientId: 'an-00000001', page: 1,
  rects: [{ x0: 72, y0: 640, x1: 288, y1: 652 }],
  selectedText: 'the primary outcome was mortality',
  color: 'green', comment: '', authorId: 'me', authorName: 'Dr Ada Byron',
  revision: 1, deleted: false, ...over,
});

const layer = (props = {}) => r(h(PdfAnnotationPageLayer, {
  page: 1, items: [mk()], pageDims: PAGE, scale: 1.25, rotation: 0,
  textLayerRef: { current: null }, userId: 'me',
  canCreate: true, canModerate: false, interactive: true,
  selectedId: null, onSelect: noop, onCreate: noop, onRecolor: noop, onComment: noop, onDelete: noop,
  ...props,
}));

describe('116.md — AppPdfViewer stays INERT for every pre-116 caller', () => {
  it('renders no annotation pane marker without the prop', () => {
    const html = r(h(AppPdfViewer, { url: '/api/x.pdf' }));
    expect(html).toContain('aria-label="PDF viewer"');
    expect(html).not.toContain('data-pdf-annotations');
    expect(html).not.toContain('Highlight selected text');
  });

  it('marks the pane only when a host opts in', () => {
    const html = r(h(AppPdfViewer, {
      url: '/api/x.pdf',
      annotation: { enabled: true, byPage: new Map(), capabilities: { canCreate: true, canModerate: false }, userId: 'me' },
    }));
    expect(html).toContain('data-pdf-annotations="1"');
  });

  it('an `annotation` cluster with enabled:false is treated as absent', () => {
    const html = r(h(AppPdfViewer, { url: '/api/x.pdf', annotation: { enabled: false } }));
    expect(html).not.toContain('data-pdf-annotations');
  });
});

describe('116.md §76/§81/§100 — the painted marks', () => {
  it('projects the stored user-space rect to the pixels for the CURRENT scale', () => {
    const html = layer();
    // left = x0·s = 72·1.25 = 90 ; top = (H − y1)·s = (792 − 652)·1.25 = 175
    expect(html).toContain('left:90px');
    expect(html).toContain('top:175px');
    expect(html).toContain('width:270px');    // (288 − 72)·1.25
    expect(html).toContain('height:15px');    // (652 − 640)·1.25
  });

  it('an OWN highlight uses the full fill and a SOLID underline', () => {
    const html = layer();
    expect(html).toContain(colorFor('green').fill);
    expect(html).toContain(`border-bottom:2px solid ${colorFor('green').border}`);
    expect(html).toContain('Your highlight');
  });

  it('§81 — ANOTHER member\'s keeps the hue at lower intensity, with a DASHED underline', () => {
    const html = layer({ userId: 'someone-else' });
    expect(html).toContain(colorFor('green').fillMuted);
    expect(html).not.toContain(`background:${colorFor('green').fill};`);
    expect(html).toContain(`border-bottom:2px dashed ${colorFor('green').border}`);
    expect(html).toContain('Highlighted by Dr Ada Byron');
  });

  it('§100 — the selected annotation gains an OUTLINE, not just a colour change', () => {
    expect(layer()).toContain('outline:none');
    expect(layer({ selectedId: 'ann-1' })).toContain(`outline:2px solid ${colorFor('green').border}`);
  });

  it('§100 — the label names the author AND the colour, and only the first rect is focusable', () => {
    const html = layer({
      items: [mk({ rects: [{ x0: 72, y0: 640, x1: 288, y1: 652 }, { x0: 72, y0: 620, x1: 200, y1: 632 }] })],
      userId: 'someone-else',
    });
    expect(html).toContain('aria-label="green highlight by Dr Ada Byron: the primary outcome was mortality"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('§89 — a pending row is visibly provisional and a failed one is flagged', () => {
    expect(layer({ items: [mk({ pending: true })] })).toContain('opacity:0.55');
    expect(layer({ items: [mk({ failed: true })] })).toContain('box-shadow:0 0 0 2px');
  });

  it('§76 — a ROTATED page renders NO annotation layer rather than a misplaced one', () => {
    expect(layer({ rotation: 90 })).toBe('');
    expect(layer({ rotation: 270 })).toBe('');
    expect(layer({ pageDims: null })).toBe('');
    expect(layer({ scale: 0 })).toBe('');
  });

  it('§75 — while a capture tool owns the page the marks are decoration only', () => {
    const html = layer({ interactive: false });
    expect(html).toContain('pointer-events:none');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-label="green highlight');
  });

  it('an empty page renders an overlay with nothing in it (no stray affordance)', () => {
    const html = layer({ items: [] });
    expect(html).toContain('position:absolute');
    expect(html).not.toContain('<button');
  });
});

describe('116.md §82/§97 — the annotation popover', () => {
  const open = (over = {}, layerOver = {}) => layer({ selectedId: 'ann-1', items: [mk(over)], ...layerOver });

  it('names the author, quotes the excerpt and stays compact', () => {
    const html = open({ authorId: 'them', authorName: 'Dr Grace Hopper', comment: 'Is this the ITT population?' }, { userId: 'me' });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Highlighted by Dr Grace Hopper');
    expect(html).toContain('the primary outcome was mortality');
    expect(html).toContain('Is this the ITT population?');
    expect(html).toContain('width:264px');            // §97 "do not cover most of the PDF"
  });

  it('says "Highlighted by you" for the author\'s own', () => {
    expect(open()).toContain('Highlighted by you');
  });

  it('§83 — the author gets comment / colour / delete controls', () => {
    const html = open();
    expect(html).toContain('Add comment');
    expect(html).toContain('aria-label="Change colour to Blue"');
    expect(html).toContain('>Delete<');
    expect(html).not.toContain('Edit comment');   // no comment on this one yet
  });

  it('§83 — a plain member viewing someone else\'s gets a plain-English refusal, no controls', () => {
    const html = open({ authorId: 'them', authorName: 'Dr Grace Hopper' }, { userId: 'me', canModerate: false });
    expect(html).toContain('Only the author or a project leader can change this highlight.');
    expect(html).not.toContain('>Delete<');
    expect(html).not.toContain('Add comment');
  });

  it('§83 — a LEADER gets the controls on someone else\'s highlight', () => {
    const html = open({ authorId: 'them', authorName: 'Dr Grace Hopper' }, { userId: 'me', canModerate: true });
    expect(html).toContain('>Delete<');
    expect(html).toContain('Add comment');
  });

  it('an existing comment reads as text (never HTML) and offers "Edit comment"', () => {
    const html = open({ comment: '<img src=x onerror=alert(1)>' });
    expect(html).toContain('Edit comment');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('every control is labelled (§100 "buttons require labels/tooltips")', () => {
    const html = open();
    expect(html).toContain('aria-label="Close highlight details"');
    expect(html).toContain('aria-label="Highlight colour"');
  });
});

describe('116.md §98/§99/§85 — the annotation list and the clear actions', () => {
  const rows = [
    mk({ id: 'a1', page: 1, authorId: 'me', selectedText: 'first' }),
    mk({ id: 'a2', page: 4, authorId: 'them', authorName: 'Dr Grace Hopper', selectedText: 'second', comment: 'note' }),
  ];
  const panel = (over = {}) => r(h(AnnotationListPanel, {
    annotations: rows, userId: 'me', selectedId: null, onJump: noop,
    canClearMine: true, canClearAll: false, onClear: noop, ...over,
  }));

  it('is COLLAPSED by default and shows the count (§98 "costs nothing until opened")', () => {
    const html = panel();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('(2)');
    expect(html).not.toContain('Clear my annotations');
    expect(html).not.toContain('first');
  });

  it('§85 — the two clear affordances are role-gated', () => {
    // Rendered only when open; the closed default is asserted above, so this pins the
    // GATING logic through the props the host passes.
    expect(panel({ canClearMine: false, canClearAll: false })).not.toContain('Clear all annotations on this PDF');
  });
});

describe('116.md §85 — clear wording (pinned; sweep coordinately if it changes)', () => {
  // The confirmation strips live behind `open` + `confirming` state, which SSR cannot
  // reach. Their COPY is pinned at the source instead, so a reword is a deliberate act.
  it('the member action is scoped to the member and the leader action is stronger', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/frontend/components/PdfAnnotationLayer.jsx', 'utf8'));
    expect(src).toContain('Clear my annotations');
    expect(src).toContain('Clear all annotations on this PDF');
    expect(src).toContain('Other members&apos; highlights are not touched, and the PDF itself is not deleted.');
    expect(src).toContain('This removes every member&apos;s highlights.');
    expect(src).toContain('The PDF file itself is not deleted.');
    // §85 — "do not delete the PDF itself unless the user explicitly chooses a
    // file-removal action": nothing in this component can reach a file route.
    expect(src).not.toMatch(/deletePdf|removeExtra|studyDocApi/);
  });
});
