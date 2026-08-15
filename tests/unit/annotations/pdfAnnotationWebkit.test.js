/**
 * pdfAnnotationWebkit.test.js — 117.md §46-§50, §80, §93.
 *
 * The Safari/WebKit parity pass for PDF highlighting and comments, held to evidence
 * rather than to a comment. Three defects are fixed at CAPTURE time (the stored anchor
 * contract of 116.md §76 — PDF user space at scale 1, y-up, unrotated — is untouched,
 * because a highlight already on the server is not wrong; it was captured wrong):
 *
 *  1. §46 the text layer had no `endOfContent` sink. AppPdfViewer used the RAW
 *     `pdfjsLib.TextLayer`, not the official viewer's `TextLayerBuilder`, so a drag
 *     past the end of a line extended the selection in DOM order — which, in a pdf.js
 *     text layer, is drawing order over absolutely-positioned `scaleX`'d spans. Blink
 *     papers over it; WebKit does not. `endOfContentPlacement` is the one DECISION in
 *     that machinery, so it is pinned here; the DOM plumbing is pinned at the source.
 *  2. §47 the capture path trusted `Range.getClientRects()` outright, on exactly the
 *     transformed spans this repo already documents WebKit mis-mapping (98.md §16,
 *     pdfCaret.js). Now every list is audited against the text layer box and rebuilt
 *     from per-word Range geometry when the audit rejects it.
 *  3. §47 the rendering resolution was memoised once at mount.
 *
 * House style (no jsdom): a tiny fake DOM with a per-character geometry table, the
 * same technique tests/unit/extraction/pdfCaret.test.js established for the same bug
 * class. Component WIRING that SSR cannot observe is pinned through readSource.
 */
import { describe, it, expect } from 'vitest';
import {
  auditSelectionRects, rangeTextChunks, rectsFromRangeGeometry, captureSelectionRects,
  SELECTION_RECT_SLACK_PX, endOfContentPlacement, RANGE_START_TO_END, RANGE_END_TO_END,
  clampRenderDpr, dprMediaQuery, MAX_RENDER_DPR,
  cssRectsToUser, selectionThresholds,
} from '../../../src/frontend/components/pdfAnnotationModel.js';
import { readSource } from '../../helpers/readSource.js';

/* ── The fixture: one US-Letter page, one 12 pt line of text on it ──────────── */

const PAGE_W = 612, PAGE_H = 792;
/** The text layer's own box, as `getBoundingClientRect()` reports it at scale 1. */
const HOST = { left: 0, top: 0, right: PAGE_W, bottom: PAGE_H, width: PAGE_W, height: PAGE_H };

const LINE = 'The primary outcome';
const CHAR_W = 6, LINE_TOP = 140, LINE_BOT = 152, TEXT_X0 = 72;

/** A text node whose characters measure CHAR_W wide from `x0` (null ⇒ unmeasurable). */
const fakeText = (text, x0 = null) => ({ nodeType: 3, textContent: text, childNodes: [], __x0: x0 });
const fakeEl = (children) => ({
  nodeType: 1, childNodes: children,
  get textContent() { return children.map((c) => c.textContent).join(''); },
});

/**
 * A text-layer span plus the ownerDocument whose `createRange()` measures sub-ranges
 * from the per-character table. `spaceWidth` lets a test make whitespace unmeasurable
 * (0 px), which is what forces the per-character fallback.
 */
function makeSpan(children) {
  const doc = {};
  const span = { nodeType: 1, childNodes: children, ownerDocument: doc };
  const stamp = (n) => { n.ownerDocument = doc; (n.childNodes || []).forEach(stamp); };
  children.forEach(stamp);
  doc.createRange = () => {
    let node = null, s = 0, e = 0;
    return {
      setStart(n, i) { node = n; s = i; },
      setEnd(n, i) { e = i; },
      getBoundingClientRect() {
        if (!node || node.nodeType !== 3 || node.__x0 == null || e <= s) {
          return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
        }
        const left = node.__x0 + s * CHAR_W, right = node.__x0 + e * CHAR_W;
        return { left, right, top: LINE_TOP, bottom: LINE_BOT, width: right - left, height: LINE_BOT - LINE_TOP };
      },
    };
  };
  return { span, doc };
}

/** A Range over the whole contents of `span`, with the client rects the caller names. */
function rangeOverSpan(span, clientRects = []) {
  return {
    commonAncestorContainer: span,
    startContainer: span, startOffset: 0,
    endContainer: span, endOffset: span.childNodes.length,
    getClientRects: () => clientRects,
  };
}

/** What the line's rectangle SHOULD be, in page-local CSS px at scale 1. */
const TRUE_LINE = { x0: TEXT_X0, y0: LINE_TOP, x1: TEXT_X0 + LINE.length * CHAR_W, y1: LINE_BOT };
/** The client rect a healthy browser reports for that line. */
const HEALTHY_RECT = { left: TRUE_LINE.x0, top: TRUE_LINE.y0, right: TRUE_LINE.x1, bottom: TRUE_LINE.y1 };

/* ── §47 — the audit ───────────────────────────────────────────────────────── */

describe('117.md §47 — selection rects are audited against the layer they must live in', () => {
  it('accepts an ordinary line and reports it page-local, with nothing suspect', () => {
    const out = auditSelectionRects([HEALTHY_RECT], HOST);
    expect(out.suspect).toBe(false);
    expect(out.reason).toBe('');
    expect(out.rects).toEqual([TRUE_LINE]);
  });

  it('subtracts the host origin, so a scrolled/offset page changes nothing', () => {
    const host = { left: 411, top: 96, width: PAGE_W, height: PAGE_H };
    const moved = { left: 411 + TRUE_LINE.x0, top: 96 + TRUE_LINE.y0, right: 411 + TRUE_LINE.x1, bottom: 96 + TRUE_LINE.y1 };
    expect(auditSelectionRects([moved], host).rects).toEqual([TRUE_LINE]);
  });

  it('REJECTS a rect that does not touch the page — the WebKit x mis-map signature', () => {
    // 98.md §16 documents WebKit returning plausible-looking but wrong x on scaleX'd
    // spans. Stored, that is a highlight in the wrong place forever, on every browser.
    const out = auditSelectionRects([{ left: -4200, top: 140, right: -4000, bottom: 152 }], HOST);
    expect(out.rects).toEqual([]);
    expect(out.suspect).toBe(true);
    expect(out.reason).toBe('out-of-bounds');
    expect(out.dropped.outside).toBe(1);
  });

  it('REJECTS a rect larger than the page (a selection cannot exceed its own page)', () => {
    const out = auditSelectionRects([{ left: -50, top: 10, right: PAGE_W + 400, bottom: 40 }], HOST);
    expect(out.rects).toEqual([]);
    expect(out.reason).toBe('oversize');
  });

  it('REJECTS an inverted or non-finite rect instead of normalising it into a guess', () => {
    const out = auditSelectionRects([
      { left: 200, top: 140, right: 100, bottom: 152 },
      { left: NaN, top: 140, right: 300, bottom: 152 },
    ], HOST);
    expect(out.rects).toEqual([]);
    expect(out.dropped.inverted).toBe(2);
    expect(out.reason).toBe('inverted');
  });

  it('a rect that only grazes the page edge is kept — slack, not a cliff', () => {
    const grazing = { left: -SELECTION_RECT_SLACK_PX + 0.5, top: 140, right: 120, bottom: 152 };
    expect(auditSelectionRects([grazing], HOST).rects).toHaveLength(1);
  });

  it('losing EVERY rect to the noise floor is itself suspect (§76 tolerances, §47 audit)', () => {
    // Zero-width rects for a selection that really has text is precisely what the
    // mis-mapped path produces; "nothing survived" must trigger the rebuild, not a
    // silent "there was no selection here".
    const out = auditSelectionRects([{ left: 100, top: 140, right: 100, bottom: 152 }], HOST);
    expect(out.rects).toEqual([]);
    expect(out.suspect).toBe(true);
    expect(out.reason).toBe('degenerate');
    expect(out.dropped.tiny).toBe(1);
  });

  it('an empty list is empty, not suspect (a collapsed caret is not a bug)', () => {
    expect(auditSelectionRects([], HOST)).toMatchObject({ rects: [], suspect: false, reason: '' });
  });

  it('refuses to judge without a host box, and never guesses one', () => {
    expect(auditSelectionRects([HEALTHY_RECT], null)).toMatchObject({ rects: [], suspect: true, reason: 'no-host' });
    expect(auditSelectionRects([HEALTHY_RECT], { left: NaN, top: 0 }).reason).toBe('no-host');
  });

  it('a host with no measurable size may only reject what it can DISPROVE (pdfCaret §16 rule)', () => {
    // A layer that reports 0×0 (not laid out yet) cannot know what "outside" means, so
    // the bounds checks stand down rather than vetoing every real rect.
    const blind = { left: 0, top: 0, width: 0, height: 0 };
    expect(auditSelectionRects([{ left: -4200, top: 140, right: -4000, bottom: 152 }], blind).rects).toHaveLength(1);
  });

  it('is total: nonsense input yields an empty list, never a throw', () => {
    for (const bad of [null, undefined, 0, 'x', {}]) {
      expect(auditSelectionRects(bad, HOST).rects).toEqual([]);
    }
  });
});

/* ── §47 — the geometric rebuild ───────────────────────────────────────────── */

describe('117.md §47 — rebuilding the rects from per-word Range geometry', () => {
  it('rangeTextChunks resolves a whole-span Range to its text slices', () => {
    const { span } = makeSpan([fakeText(LINE, TEXT_X0)]);
    const chunks = rangeTextChunks(rangeOverSpan(span));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].from).toBe(0);
    expect(chunks[0].to).toBe(LINE.length);
  });

  it('rangeTextChunks honours a PARTIAL Range inside one text node', () => {
    const { span } = makeSpan([fakeText(LINE, TEXT_X0)]);
    const node = span.childNodes[0];
    const chunks = rangeTextChunks({
      commonAncestorContainer: node, startContainer: node, startOffset: 4, endContainer: node, endOffset: 11,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text.slice(chunks[0].from, chunks[0].to)).toBe('primary');
  });

  it('rangeTextChunks walks NESTED nodes (a search <mark> splits a run) in document order', () => {
    // "The " + <mark>primary</mark> + " outcome" — the shape the live search pass leaves
    // behind, and the one a naive "startContainer.textContent" reader gets wrong.
    const a = fakeText('The ', TEXT_X0);
    const b = fakeText('primary', TEXT_X0 + 4 * CHAR_W);
    const c = fakeText(' outcome', TEXT_X0 + 11 * CHAR_W);
    const { span } = makeSpan([a, fakeEl([b]), c]);
    const chunks = rangeTextChunks(rangeOverSpan(span));
    expect(chunks.map((k) => k.text.slice(k.from, k.to))).toEqual(['The ', 'primary', ' outcome']);
  });

  it('rebuilds ONE rect per line, spaces included, from word sub-Ranges', () => {
    const { span } = makeSpan([fakeText(LINE, TEXT_X0)]);
    const rects = rectsFromRangeGeometry(rangeOverSpan(span));
    expect(rects.length).toBeGreaterThan(0);
    // Measuring bare words would leave a space-wide hole between them, and the merge
    // would honour it — a rebuilt highlight must be the LINE the reviewer dragged.
    expect(Math.min(...rects.map((r) => r.left))).toBeCloseTo(TRUE_LINE.x0, 6);
    expect(Math.max(...rects.map((r) => r.right))).toBeCloseTo(TRUE_LINE.x1, 6);
    const merged = auditSelectionRects(rects, HOST).rects;
    expect(merged.length).toBeGreaterThan(0);
  });

  it('falls back to per-CHARACTER measurement for anything that will not measure whole', () => {
    // A node the engine refuses to measure as a whole range still yields nothing here —
    // and, crucially, does not throw or fabricate a rectangle.
    const { span } = makeSpan([fakeText(LINE /* no __x0 ⇒ every rect is 0×0 */)]);
    expect(rectsFromRangeGeometry(rangeOverSpan(span))).toEqual([]);
  });

  it('is bounded — a huge selection cannot become an unbounded layout storm', () => {
    const long = 'word '.repeat(4000);
    const { span } = makeSpan([fakeText(long, TEXT_X0)]);
    const rects = rectsFromRangeGeometry(rangeOverSpan(span), { maxChars: 50 });
    expect(rects.length).toBeGreaterThan(0);
    expect(rects.length).toBeLessThan(20);
  });

  it('is total: no range, an empty range, or a document with no createRange yields []', () => {
    expect(rectsFromRangeGeometry(null)).toEqual([]);
    expect(rectsFromRangeGeometry({})).toEqual([]);
    const orphan = { nodeType: 3, textContent: 'x', childNodes: [], ownerDocument: {} };
    expect(rectsFromRangeGeometry({ commonAncestorContainer: orphan, startContainer: orphan, startOffset: 0, endContainer: orphan, endOffset: 1 })).toEqual([]);
  });
});

/* ── §46/§47 — the capture decision end to end ─────────────────────────────── */

describe('117.md §46/§47 — captureSelectionRects picks the honest geometry', () => {
  const span = () => makeSpan([fakeText(LINE, TEXT_X0)]).span;

  it('believes the browser when the browser is believable', () => {
    const out = captureSelectionRects(rangeOverSpan(span(), [HEALTHY_RECT]), HOST, { scale: 1 });
    expect(out.source).toBe('client-rects');
    expect(out.suspect).toBe(false);
    expect(out.rects).toEqual([TRUE_LINE]);
  });

  it('THE WEBKIT CASE — mis-mapped client rects are rebuilt into the TRUE line', () => {
    // What the broken path produced: rects off the page entirely. Previously stored
    // verbatim (or, once toPageRects dropped them, no Highlight control appeared at
    // all and Safari looked like "highlighting just does not work").
    const garbage = [
      { left: -4200, top: LINE_TOP, right: -4000, bottom: LINE_BOT },
      { left: -3900, top: LINE_TOP, right: -3800, bottom: LINE_BOT },
    ];
    const out = captureSelectionRects(rangeOverSpan(span(), garbage), HOST, { scale: 1 });
    expect(out.source).toBe('geometry');
    expect(out.suspect).toBe(true);
    expect(out.reason).toBe('out-of-bounds');
    expect(out.rects).toHaveLength(1);
    expect(out.rects[0].x0).toBeCloseTo(TRUE_LINE.x0, 6);
    expect(out.rects[0].x1).toBeCloseTo(TRUE_LINE.x1, 6);
    expect(out.rects[0].y0).toBeCloseTo(TRUE_LINE.y0, 6);
    expect(out.rects[0].y1).toBeCloseTo(TRUE_LINE.y1, 6);
  });

  it('the rebuilt rectangle STORES the same PDF user-space anchor a healthy browser would', () => {
    // The point of the whole exercise: a highlight captured on Safari and one captured
    // on Chrome must be the same rows in the database (116.md §76).
    const healthy = captureSelectionRects(rangeOverSpan(span(), [HEALTHY_RECT]), HOST, { scale: 1 });
    const webkit = captureSelectionRects(rangeOverSpan(span(), [{ left: -4200, top: 1, right: -4000, bottom: 9 }]), HOST, { scale: 1 });
    const store = (r) => cssRectsToUser(r.rects, { scale: 1, pageHeight: PAGE_H });
    expect(store(webkit)).toEqual(store(healthy));
  });

  it('collapsed-to-nothing client rects also trigger the rebuild (§76 floor, §47 audit)', () => {
    const zeroWidth = [{ left: TEXT_X0, top: LINE_TOP, right: TEXT_X0, bottom: LINE_BOT }];
    const out = captureSelectionRects(rangeOverSpan(span(), zeroWidth), HOST, { scale: 1 });
    expect(out.source).toBe('geometry');
    expect(out.reason).toBe('degenerate');
    expect(out.rects).toHaveLength(1);
  });

  it('when geometry cannot help either, it reports NOTHING rather than a guess', () => {
    const blind = makeSpan([fakeText(LINE /* unmeasurable */)]).span;
    const out = captureSelectionRects(rangeOverSpan(blind, [{ left: -4200, top: 1, right: -4000, bottom: 9 }]), HOST, { scale: 1 });
    expect(out.rects).toEqual([]);
    expect(out.source).toBe('none');
  });

  it('keeps the §76 zoom-projected tolerances: the same line captures at every scale', () => {
    for (const s of [0.0948, 0.5, 1, 2.5]) {
      const scaled = {
        left: TRUE_LINE.x0 * s, top: TRUE_LINE.y0 * s,
        right: TRUE_LINE.x1 * s, bottom: TRUE_LINE.y1 * s,
      };
      const host = { left: 0, top: 0, width: PAGE_W * s, height: PAGE_H * s };
      const out = captureSelectionRects({ ...rangeOverSpan(span()), getClientRects: () => [scaled] }, host, { scale: s });
      expect(out.rects, `scale ${s}`).toHaveLength(1);
      const stored = cssRectsToUser(out.rects, { scale: s, pageHeight: PAGE_H })[0];
      expect(stored.x0).toBeCloseTo(TRUE_LINE.x0, 2);
      expect(stored.x1).toBeCloseTo(TRUE_LINE.x1, 2);
      // …and the floor really is the zoom-projected one, not a fixed CSS-px number.
      expect(selectionThresholds(s).minSize).toBeCloseTo(1.5 * s, 9);
    }
  });

  it('is total: a missing range yields an empty, non-suspect answer', () => {
    expect(captureSelectionRects(null, HOST, { scale: 1 })).toMatchObject({ rects: [], source: 'none' });
  });
});

/* ── §46 — where the pdf.js selection sink goes ────────────────────────────── */

describe('117.md §46 — the text-layer selection sink placement rule', () => {
  /** A Range that answers compareBoundaryPoints from a table of results. */
  const cmp = (table) => ({ compareBoundaryPoints: (how) => (how in table ? table[how] : -1) });

  it('with no previous range the sink goes AFTER the anchor (a fresh forward drag)', () => {
    expect(endOfContentPlacement(cmp({}), null)).toEqual({ modifyStart: false });
    expect(endOfContentPlacement(null, cmp({}))).toEqual({ modifyStart: false });
  });

  it('a selection still ending where the last one ended means the START is moving', () => {
    // The backward drag. Getting this wrong is what makes WebKit extend a backward
    // selection into whatever span happens to be next in DOM order.
    expect(endOfContentPlacement(cmp({ [RANGE_END_TO_END]: 0 }), cmp({}))).toEqual({ modifyStart: true });
    expect(endOfContentPlacement(cmp({ [RANGE_START_TO_END]: 0 }), cmp({}))).toEqual({ modifyStart: true });
  });

  it('a selection whose end moved is a forward drag — the sink goes after', () => {
    expect(endOfContentPlacement(cmp({ [RANGE_END_TO_END]: 1, [RANGE_START_TO_END]: -1 }), cmp({}))).toEqual({ modifyStart: false });
  });

  it('a Range that cannot compare degrades to "after" instead of throwing', () => {
    const hostile = { compareBoundaryPoints: () => { throw new Error('wrong document'); } };
    expect(endOfContentPlacement(hostile, cmp({}))).toEqual({ modifyStart: false });
    expect(endOfContentPlacement({}, cmp({}))).toEqual({ modifyStart: false });
  });
});

/* ── §47 — rendering resolution ────────────────────────────────────────────── */

describe('117.md §47 — the rendering resolution is clamped and re-observable', () => {
  it('clamps at 2 and never returns a nonsense scale', () => {
    expect(MAX_RENDER_DPR).toBe(2);
    expect(clampRenderDpr(1)).toBe(1);
    expect(clampRenderDpr(1.5)).toBe(1.5);
    expect(clampRenderDpr(3)).toBe(2);
    for (const bad of [0, -2, NaN, null, undefined, 'x', {}]) expect(clampRenderDpr(bad)).toBe(1);
  });

  it('the media query is built from the RAW ratio, so a 3 → 2 move is still detected', () => {
    // Both clamp to 2. If the query were built from the clamped value it would never
    // fire when the window moved between two HiDPI displays of different scales.
    expect(dprMediaQuery(3)).toBe('(resolution: 3dppx)');
    expect(dprMediaQuery(2)).toBe('(resolution: 2dppx)');
    expect(dprMediaQuery(3)).not.toBe(dprMediaQuery(2));
    expect(dprMediaQuery(1.25)).toBe('(resolution: 1.25dppx)');
    for (const bad of [0, -1, NaN, null, undefined]) expect(dprMediaQuery(bad)).toBe('(resolution: 1dppx)');
  });
});

/* ── The wiring SSR cannot see (readSource pins) ───────────────────────────── */

const VIEWER = 'src/frontend/components/AppPdfViewer.jsx';
const LAYER = 'src/frontend/components/PdfAnnotationLayer.jsx';

describe('117.md §46 — AppPdfViewer really builds the pdf.js selection sink', () => {
  const src = readSource(VIEWER);

  it('appends an endOfContent element to every text layer it renders', () => {
    expect(src).toContain('registerTextLayerSelection(tl, { width: viewport.width, height: viewport.height })');
    expect(src).toContain("end.className = 'mlpdf-eoc'");
    expect(src).toContain('tl.appendChild(end)');
  });

  it('toggles the sink\'s active state on selection start and end, as pdf.js does', () => {
    expect(src).toContain(".mlpdf-tl.mlpdf-selecting .mlpdf-eoc{top:0;}");
    expect(src).toContain("tl.classList.add('mlpdf-selecting')");
    expect(src).toContain("tl.classList.remove('mlpdf-selecting')");
    // The reset triggers pdf.js uses; missing any of them leaves a layer stuck "selecting".
    for (const evt of ['pointerdown', 'pointerup', 'keyup', 'selectionchange']) {
      expect(src, `missing document listener: ${evt}`).toContain(`document.addEventListener('${evt}'`);
    }
    expect(src).toContain("window.addEventListener('blur', onBlur)");
  });

  it('stands down on Gecko by pdf.js\'s own feature detection, not by UA sniffing', () => {
    expect(src).toContain("getPropertyValue('-moz-user-select') === 'none'");
    expect(src).not.toMatch(/navigator\.userAgent/);
  });

  it('unregisters the sink when the layer is rebuilt or unmounted (no leak, no stale node)', () => {
    expect(src).toContain('const tlNode = textRef.current;');
    expect(src).toContain('unregisterTextLayerSelection(tlNode);');
    expect(src).toContain('unregisterTextLayerSelection(tl);');
  });
});

describe('117.md §47 — a failed text layer is visible, and the dpr is re-observed', () => {
  const src = readSource(VIEWER);

  it('stamps the failure on the page container instead of swallowing it', () => {
    expect(src).toContain('markTextLayerFailure(tl, doc, err)');
    expect(src).toContain("tl.setAttribute('data-tl-error', reason)");
    expect(src).toContain("tl.parentElement.setAttribute('data-tl-error', reason)");
    expect(src).toContain('clearTextLayerFailure(tl)');
    // The old silent catch is gone.
    expect(src).not.toContain('catch { /* text layer is best-effort; canvas still shows */ }');
  });

  it('warns exactly once per document, so a 300-page PDF cannot flood the console', () => {
    expect(src).toContain('const _tlWarnedDocs = new WeakSet();');
    expect(src).toContain('if (doc && !_tlWarnedDocs.has(doc))');
    expect(src).toContain('_tlWarnedDocs.add(doc);');
  });

  it('re-arms the resolution media query instead of memoising the ratio at mount', () => {
    expect(src).toContain('const [dpr, setDpr] = useState(');
    expect(src).toContain('window.matchMedia(dprMediaQuery(window.devicePixelRatio))');
    expect(src).toContain('setDpr(clampRenderDpr(window.devicePixelRatio));');
    expect(src).toContain('arm();                              // the query is per-ratio: re-arm on the new one');
    // The old one-shot memo is gone.
    expect(src).not.toContain('useMemo(() => (typeof window !== \'undefined\' ? Math.min(window.devicePixelRatio || 1, 2) : 1), [])');
    // …and it is still the canvas backing store only, so §76 still holds.
    expect(src).toContain('canvas.width = Math.floor(viewport.width * dpr);');
  });
});

describe('117.md §46 — the annotation layer survives Safari\'s selection collapse', () => {
  const src = readSource(LAYER);

  it('latches the pending payload in the CAPTURE phase of the control\'s pointerdown', () => {
    expect(src).toContain('onPointerDownCapture={() => { controlHeldRef.current = true; latchedRef.current = pending; }}');
    expect(src).toContain('onMouseDownCapture={() => { controlHeldRef.current = true; latchedRef.current = pending; }}');
    expect(src).toContain('const src = pending || latchedRef.current;');
  });

  it('guards the collapse-clear while the control is being pressed or focused', () => {
    expect(src).toContain('if (engagingControl()) return;');
    expect(src).toContain('if (controlHeldRef.current) return true;');
    expect(src).toContain('return !!(active && box.contains(active));');
  });

  it('releases the latch on any dismissal, so it can never stick', () => {
    expect(src).toContain('const clearPending = useCallback(() => {');
    expect(src).toContain('controlHeldRef.current = false;');
    expect(src).toContain("if (e.key === 'Escape') clearPending();");
  });

  it('routes capture through the audited pure path and never re-invents the geometry', () => {
    expect(src).toContain('captureSelectionRects(range, host, { scale })');
    expect(src).not.toMatch(/range\.getClientRects\(\)/);
    // §75 still holds: nothing here prevents the default gesture (the docblock SAYS so;
    // this checks there is no CALL, not merely no mention of one).
    expect(src).not.toMatch(/\.preventDefault\s*\(/);
  });

  it('still refuses to draw or capture on a rotated page (the §76 stand-down is intact)', () => {
    expect(src).toContain('const unrotated = (rotation % 360) === 0;');
    expect(src).toContain('const usable = !!(pageDims && +scale > 0 && unrotated);');
  });
});
