/**
 * pdfAnnotationModel.test.js — 116.md §75-§94 (Part VII). The CLIENT pure core of the
 * collaborative PDF annotation layer, exercised as data (house rule: no jsdom).
 *
 * The load-bearing pins here are the anchoring ones (§76). A highlight is stored as
 * PDF USER-SPACE rectangles at scale 1, y-up, in the unrotated page frame — the same
 * space extraction provenance bboxes and pdfRevealBox.js already use. These tests make
 * the "zoom / viewport / device / page width / sidebar / resolution cannot move a
 * highlight" claim CONCRETE rather than assertion-by-comment: the same physical
 * selection captured at three different render scales must round-trip to the same
 * stored rectangle, and that one stored rectangle must project back to exactly the
 * pixels the reader sees at whatever scale they are currently using.
 */
import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_COLORS, ANNOTATION_COLOR_KEYS, DEFAULT_ANNOTATION_COLOR, colorFor,
  toPageRects, mergeLineRects, cssRectsToUser, userRectsToCss, rectsBounds,
  indexByPage, sortForList,
  canMutateAnnotation, isOwnAnnotation, annotationAriaLabel,
  pendingAnnotation, upsertByClientId, markFailed, dropByClientId, mergeServerList,
  MAX_SELECTED_TEXT, MAX_COMMENT,
  selectionThresholds, selectionCaptureDelay, SELECTION_SETTLE_MS, createMountGate,
} from '../../../src/frontend/components/pdfAnnotationModel.js';

/* A page of US-Letter size, and one physical line of text on it. */
const PAGE_H = 792;
const PAGE_W = 612;

/** A DOMRect-like as the browser reports it, for a line drawn at `user` coords at `s`. */
function clientRectFor(user, s, host = { left: 0, top: 0 }) {
  return {
    left: host.left + user.x0 * s,
    right: host.left + user.x1 * s,
    top: host.top + (PAGE_H - user.y1) * s,
    bottom: host.top + (PAGE_H - user.y0) * s,
  };
}

describe('116.md §77 — the fixed palette', () => {
  it('is exactly the six colours the directive lists, yellow first', () => {
    expect(ANNOTATION_COLOR_KEYS).toEqual(['yellow', 'green', 'blue', 'pink', 'orange', 'purple']);
    expect(DEFAULT_ANNOTATION_COLOR).toBe('yellow');
  });

  it('every entry carries a distinct own fill, a MUTED fill and a border (§81/§100)', () => {
    const fills = new Set();
    for (const c of ANNOTATION_COLORS) {
      expect(typeof c.fill).toBe('string');
      expect(typeof c.fillMuted).toBe('string');
      expect(typeof c.swatch).toBe('string');
      expect(typeof c.border).toBe('string');
      // §81 — "reduce intensity, do NOT make it so gray the colour becomes meaningless":
      // the muted variant differs from the own variant only in its alpha channel.
      expect(c.fillMuted).not.toBe(c.fill);
      expect(c.fillMuted.replace(/[\d.]+\)$/, '')).toBe(c.fill.replace(/[\d.]+\)$/, ''));
      const alphaOwn = Number(/([\d.]+)\)$/.exec(c.fill)[1]);
      const alphaMuted = Number(/([\d.]+)\)$/.exec(c.fillMuted)[1]);
      expect(alphaMuted).toBeLessThan(alphaOwn);
      expect(alphaMuted).toBeGreaterThan(0.15);       // still clearly the same hue
      fills.add(c.fill);
    }
    expect(fills.size).toBe(ANNOTATION_COLORS.length);
  });

  it('colorFor clamps anything unknown to yellow and never throws (§77)', () => {
    expect(colorFor('green').key).toBe('green');
    expect(colorFor('GREEN').key).toBe('green');
    expect(colorFor(' blue ').key).toBe('blue');
    for (const bad of [null, undefined, '', 'rgb(1,2,3)', '#ff0000', 42, {}, 'chartreuse']) {
      expect(colorFor(bad).key).toBe('yellow');
    }
  });
});

describe('116.md §75/§76 — selection geometry', () => {
  it('toPageRects makes viewport rects page-local and drops sub-pixel noise', () => {
    const host = { left: 120, top: 40 };
    const out = toPageRects([
      { left: 130, top: 50, right: 200, bottom: 62 },
      { left: 130, top: 50, right: 130.4, bottom: 62 },   // zero-width selection noise
      { left: 130, top: 50, right: 200, bottom: 50.6 },   // zero-height
      null,
      { left: NaN, top: 1, right: 2, bottom: 3 },
    ], host);
    expect(out).toEqual([{ x0: 10, y0: 10, x1: 80, y1: 22 }]);
  });

  it('mergeLineRects collapses a browser\'s per-run rects into ONE rect per line', () => {
    // Two rendered lines, each reported by the browser as three overlapping runs.
    const raw = [
      { x0: 10, y0: 100, x1: 60, y1: 112 },
      { x0: 58, y0: 100.4, x1: 120, y1: 112.2 },
      { x0: 118, y0: 100, x1: 180, y1: 112 },
      { x0: 10, y0: 118, x1: 90, y1: 130 },
      { x0: 88, y0: 118, x1: 140, y1: 130 },
    ];
    const merged = mergeLineRects(raw);
    expect(merged).toHaveLength(2);
    expect(merged[0].x0).toBe(10);
    expect(merged[0].x1).toBe(180);
    expect(merged[1].x0).toBe(10);
    expect(merged[1].x1).toBe(140);
  });

  it('mergeLineRects DEDUPES exact duplicates the browser reports twice', () => {
    const one = { x0: 10, y0: 100, x1: 60, y1: 112 };
    expect(mergeLineRects([one, { ...one }, { ...one }])).toEqual([one]);
  });

  it('mergeLineRects keeps genuinely detached runs on the same line apart (two columns)', () => {
    const merged = mergeLineRects([
      { x0: 10, y0: 100, x1: 120, y1: 112 },
      { x0: 320, y0: 100, x1: 430, y1: 112 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('is total: nonsense input yields an empty list, never a throw', () => {
    for (const bad of [null, undefined, 0, 'x', {}]) {
      expect(toPageRects(bad, null)).toEqual([]);
      expect(mergeLineRects(bad)).toEqual([]);
      expect(cssRectsToUser(bad, { scale: 1, pageHeight: PAGE_H })).toEqual([]);
      expect(userRectsToCss(bad, { w: PAGE_W, h: PAGE_H }, 1)).toEqual([]);
      expect(rectsBounds(bad)).toBe(null);
    }
  });
});

describe('116.md §76 — the anchor cannot be moved by zoom, viewport, device or sidebar', () => {
  // ONE physical highlight: the words sit at these PDF user-space coordinates.
  const TRUTH = { x0: 72, y0: 640, x1: 288, y1: 652 };

  it('the SAME selection captured at 0.5×, 1× and 3.7× stores the SAME rectangle', () => {
    const stored = [0.5, 1, 1.25, 2, 3.7].map((s) => {
      const client = [clientRectFor(TRUTH, s, { left: 0, top: 0 })];
      const pageRects = toPageRects(client, { left: 0, top: 0 });
      return cssRectsToUser(mergeLineRects(pageRects), { scale: s, pageHeight: PAGE_H })[0];
    });
    for (const r of stored) {
      expect(r.x0).toBeCloseTo(TRUTH.x0, 3);
      expect(r.y0).toBeCloseTo(TRUTH.y0, 3);
      expect(r.x1).toBeCloseTo(TRUTH.x1, 3);
      expect(r.y1).toBeCloseTo(TRUTH.y1, 3);
    }
  });

  it('a SIDEBAR opening (the page moves in the viewport) changes nothing', () => {
    // Same physical selection, same zoom — only the page's position on screen moved,
    // which is what opening a sidebar / collapsing the menu does.
    const a = cssRectsToUser(toPageRects([clientRectFor(TRUTH, 1.5, { left: 0, top: 0 })], { left: 0, top: 0 }), { scale: 1.5, pageHeight: PAGE_H });
    const b = cssRectsToUser(toPageRects([clientRectFor(TRUTH, 1.5, { left: 411, top: 96 })], { left: 411, top: 96 }), { scale: 1.5, pageHeight: PAGE_H });
    expect(a).toEqual(b);
  });

  it('rendering resolution (devicePixelRatio) is not in the projection at all', () => {
    // The viewer multiplies the CANVAS BACKING STORE by dpr and divides the CSS size
    // back out, so dpr never reaches these functions. Proven by construction: the
    // projection is a pure function of (rect, pageDims, scale).
    const css = userRectsToCss([TRUTH], { w: PAGE_W, h: PAGE_H }, 2);
    expect(css).toHaveLength(1);
    expect(css[0].left).toBeCloseTo(TRUTH.x0 * 2, 6);
    expect(css[0].top).toBeCloseTo((PAGE_H - TRUTH.y1) * 2, 6);
    expect(css[0].width).toBeCloseTo((TRUTH.x1 - TRUTH.x0) * 2, 6);
    expect(css[0].height).toBeCloseTo((TRUTH.y1 - TRUTH.y0) * 2, 6);
  });

  it('projection is exactly linear in the scale — a resize only re-multiplies', () => {
    const at1 = userRectsToCss([TRUTH], { w: PAGE_W, h: PAGE_H }, 1)[0];
    for (const s of [0.25, 0.8, 1.75, 5]) {
      const at = userRectsToCss([TRUTH], { w: PAGE_W, h: PAGE_H }, s)[0];
      expect(at.left).toBeCloseTo(at1.left * s, 6);
      expect(at.top).toBeCloseTo(at1.top * s, 6);
      expect(at.width).toBeCloseTo(at1.width * s, 6);
      expect(at.height).toBeCloseTo(at1.height * s, 6);
    }
  });

  it('capture → store → project round-trips back to the very pixels the user saw', () => {
    const s = 1.3;
    const seen = clientRectFor(TRUTH, s, { left: 0, top: 0 });
    const stored = cssRectsToUser(toPageRects([seen], { left: 0, top: 0 }), { scale: s, pageHeight: PAGE_H });
    const painted = userRectsToCss(stored, { w: PAGE_W, h: PAGE_H }, s)[0];
    expect(painted.left).toBeCloseTo(seen.left, 3);
    expect(painted.top).toBeCloseTo(seen.top, 3);
    expect(painted.width).toBeCloseTo(seen.right - seen.left, 3);
    expect(painted.height).toBeCloseTo(seen.bottom - seen.top, 3);
  });

  it('refuses to project without page dimensions or a positive scale (never guesses)', () => {
    expect(userRectsToCss([TRUTH], null, 1)).toEqual([]);
    expect(userRectsToCss([TRUTH], { w: PAGE_W, h: PAGE_H }, 0)).toEqual([]);
    expect(cssRectsToUser([{ x0: 1, y0: 2, x1: 3, y1: 4 }], { scale: 0, pageHeight: PAGE_H })).toEqual([]);
    expect(cssRectsToUser([{ x0: 1, y0: 2, x1: 3, y1: 4 }], { scale: 1, pageHeight: NaN })).toEqual([]);
  });

  it('a degenerate stored rect projects to NOTHING rather than a stray box', () => {
    expect(userRectsToCss([{ x0: 10, y0: 10, x1: 10, y1: 20 }], { w: PAGE_W, h: PAGE_H }, 1)).toEqual([]);
  });
});

/**
 * REGRESSION (116.md §76). The capture tolerances used to be fixed CSS-px constants,
 * which quietly made "can this selection become a highlight?" a question about ZOOM.
 * The e2e viewer opens fit-width inside the screening workbench's middle column and
 * lands around 0.1×, where a real 12 pt line is ~1 px tall: every such selection was
 * discarded as sub-pixel noise, so no Highlight control ever appeared and the reviewer
 * got no explanation. The suite never saw it because every case here was written at
 * 0.5× or above.
 */
describe('116.md §76 — capture tolerances are document-space, not screen-space', () => {
  const TRUTH = { x0: 72, y0: 640, x1: 288, y1: 652 };   // one 12 pt line
  const FIT_WIDTH_IN_A_NARROW_PANEL = 0.0948;

  it('selectionThresholds scales with the zoom and reproduces the pre-116 numbers at 1×', () => {
    expect(selectionThresholds(1)).toEqual({ minSize: 1.5, lineGap: 4 });
    expect(selectionThresholds(0.5).minSize).toBeCloseTo(0.75, 9);
    expect(selectionThresholds(4).lineGap).toBeCloseTo(16, 9);
    // A missing / nonsense scale must not disable the floor entirely.
    for (const bad of [0, -1, NaN, null, undefined, 'x']) {
      expect(selectionThresholds(bad)).toEqual({ minSize: 1.5, lineGap: 4 });
    }
  });

  it('a real text line selected at ~0.1× survives, and still stores the TRUE rectangle', () => {
    const s = FIT_WIDTH_IN_A_NARROW_PANEL;
    const seen = clientRectFor(TRUTH, s, { left: 0, top: 0 });
    expect(seen.bottom - seen.top).toBeLessThan(1.5);      // the line really is ~1 px tall

    // The old fixed floor threw this away — that was the bug.
    expect(toPageRects([seen], { left: 0, top: 0 }, { minSize: 1.5 })).toEqual([]);

    const kept = toPageRects([seen], { left: 0, top: 0 }, { minSize: selectionThresholds(s).minSize });
    expect(kept).toHaveLength(1);
    const stored = cssRectsToUser(mergeLineRects(kept), { scale: s, pageHeight: PAGE_H })[0];
    expect(stored.x0).toBeCloseTo(TRUTH.x0, 2);
    expect(stored.y0).toBeCloseTo(TRUTH.y0, 2);
    expect(stored.x1).toBeCloseTo(TRUTH.x1, 2);
    expect(stored.y1).toBeCloseTo(TRUTH.y1, 2);
  });

  it('genuine sub-pixel noise is still rejected at every zoom', () => {
    for (const s of [0.0948, 0.5, 1, 3.7]) {
      const { minSize } = selectionThresholds(s);
      const collapsed = { left: 100, top: 100, right: 100, bottom: 112 * s };   // zero width
      expect(toPageRects([collapsed], { left: 0, top: 0 }, { minSize })).toEqual([]);
    }
  });

  it('the two-column gap is judged in document space, so zoom cannot merge the columns', () => {
    // Two runs 40 pt apart in the document: separate at every zoom, including one so
    // small that the fixed 4 px gap would have welded them into a single rectangle.
    for (const s of [0.0948, 0.5, 1, 3.7]) {
      const { lineGap } = selectionThresholds(s);
      const merged = mergeLineRects([
        { x0: 10 * s, y0: 100 * s, x1: 120 * s, y1: 112 * s },
        { x0: 160 * s, y0: 100 * s, x1: 270 * s, y1: 112 * s },
      ], { lineGap });
      expect(merged, `scale ${s}`).toHaveLength(2);
    }
  });

  it('a broken run 2 pt from its neighbour re-joins at every zoom', () => {
    for (const s of [0.0948, 0.5, 1, 3.7]) {
      const { lineGap } = selectionThresholds(s);
      const merged = mergeLineRects([
        { x0: 10 * s, y0: 100 * s, x1: 120 * s, y1: 112 * s },
        { x0: 122 * s, y0: 100 * s, x1: 270 * s, y1: 112 * s },
      ], { lineGap });
      expect(merged, `scale ${s}`).toHaveLength(1);
    }
  });
});

/**
 * REGRESSION (116.md §100/§89). Two decisions the component makes that must not live
 * in the component: WHEN a settled selection becomes the pending control, and whether
 * this hook instance is still allowed to touch state.
 */
describe('116.md §100 — a selection reaches the control from the keyboard too', () => {
  it('a finished mouse drag captures immediately', () => {
    expect(selectionCaptureDelay('mouseup', { dragging: true })).toBe(0);
    expect(selectionCaptureDelay('mouseup', {})).toBe(0);
  });

  it('a caret-driven selection captures after a settle — that is the keyboard path', () => {
    // Shift+Arrow fires selectionchange and NOTHING else: without this branch the
    // control is unreachable without a mouse.
    expect(selectionCaptureDelay('selectionchange', { dragging: false })).toBe(SELECTION_SETTLE_MS);
    expect(SELECTION_SETTLE_MS).toBeGreaterThan(0);
  });

  it('selectionchange is ignored mid-drag, so the control does not chase the cursor', () => {
    expect(selectionCaptureDelay('selectionchange', { dragging: true })).toBe(null);
  });

  it('an unknown source is ignored rather than treated as a capture', () => {
    for (const bad of ['keyup', '', null, undefined, 'click']) {
      expect(selectionCaptureDelay(bad, { dragging: false })).toBe(null);
    }
  });
});

describe('116.md §89 — the mount gate must survive a StrictMode remount', () => {
  it('starts open, closes on teardown, and RE-OPENS when armed again', () => {
    const gate = createMountGate();
    expect(gate.isAlive()).toBe(true);

    // React 18 StrictMode: mount → cleanup → mount. A gate that only ever closes is
    // shut for the rest of the session, and every server answer after it (capabilities,
    // the annotation list, an optimistic reconcile) is silently discarded — the
    // subsystem renders but never loads.
    const teardown1 = gate.arm();
    expect(gate.isAlive()).toBe(true);
    teardown1();
    expect(gate.isAlive()).toBe(false);

    const teardown2 = gate.arm();
    expect(gate.isAlive()).toBe(true);
    teardown2();
    expect(gate.isAlive()).toBe(false);
  });

  it('tearing down twice is idempotent and never re-opens the gate', () => {
    const gate = createMountGate();
    const teardown = gate.arm();
    teardown(); teardown();
    expect(gate.isAlive()).toBe(false);
  });

  it('two instances are independent (one viewer closing cannot mute another)', () => {
    const a = createMountGate(); const b = createMountGate();
    a.arm()();
    expect(a.isAlive()).toBe(false);
    expect(b.isAlive()).toBe(true);
  });
});

describe('116.md §93/§94 — page indexing and slice stability', () => {
  const mk = (id, page, y) => ({ id, clientId: `c-${id}`, page, rects: [{ x0: 10, y0: y, x1: 80, y1: y + 12 }], authorId: 'u1', color: 'yellow', selectedText: id });

  it('indexByPage buckets by page, top-first, and skips tombstones', () => {
    const idx = indexByPage([
      mk('a', 3, 100), mk('b', 1, 700), mk('c', 3, 600),
      { ...mk('d', 3, 400), deleted: true },
      null, { id: 'x', page: 0, rects: [] },
    ]);
    expect([...idx.keys()].sort()).toEqual([1, 3]);
    expect(idx.get(3).map((a) => a.id)).toEqual(['c', 'a']);   // y1 descending = top first
    expect(idx.get(1).map((a) => a.id)).toEqual(['b']);
  });

  it('only the CHANGED page yields a new slice — the memo bail-out that §94 needs', () => {
    const list = [mk('a', 1, 700), mk('b', 25, 500)];
    const first = indexByPage(list);
    const second = indexByPage([...list, mk('c', 25, 300)]);
    // Same members ⇒ value-equal slice, which is what the hook's identity carry-over
    // turns into referential equality (see usePdfAnnotations byPage).
    expect(second.get(1)).toEqual(first.get(1));
    expect(second.get(25)).not.toEqual(first.get(25));
    expect(second.get(25)).toHaveLength(2);
  });

  it('sortForList is document order across the whole PDF (§98)', () => {
    const rows = sortForList([mk('b', 2, 700), mk('a', 1, 100), mk('c', 2, 300), { ...mk('z', 1, 50), deleted: true }]);
    expect(rows.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('116.md §81/§82/§83 — ownership, muting and the client permission mirror', () => {
  const mine = { id: 'a1', clientId: 'c1', authorId: 'me', authorName: 'Dr Ada Byron', color: 'green', selectedText: 'the primary outcome', comment: '' };
  const theirs = { id: 'a2', clientId: 'c2', authorId: 'them', authorName: 'Dr Grace Hopper', color: 'blue', selectedText: 'the secondary outcome', comment: 'unclear' };

  it('isOwnAnnotation never guesses from position — only the stored author id (§78)', () => {
    expect(isOwnAnnotation(mine, 'me')).toBe(true);
    expect(isOwnAnnotation(theirs, 'me')).toBe(false);
    expect(isOwnAnnotation(mine, '')).toBe(false);       // unknown viewer ⇒ not "mine"
    expect(isOwnAnnotation(null, 'me')).toBe(false);
  });

  it('the author may mutate their own; a plain member may not touch anyone else\'s', () => {
    expect(canMutateAnnotation(mine, { userId: 'me', canModerate: false })).toBe(true);
    expect(canMutateAnnotation(theirs, { userId: 'me', canModerate: false })).toBe(false);
  });

  it('a leader/owner (canModerate) may mutate anyone\'s — §83 elevated authority', () => {
    expect(canMutateAnnotation(theirs, { userId: 'me', canModerate: true })).toBe(true);
  });

  it('a tombstone is immutable for everyone, including a leader', () => {
    expect(canMutateAnnotation({ ...theirs, deleted: true }, { userId: 'them', canModerate: true })).toBe(false);
  });

  it('§100 — the accessible label states author AND colour, so neither is colour-only', () => {
    expect(annotationAriaLabel(mine, 'me')).toBe('green highlight by you: the primary outcome');
    expect(annotationAriaLabel(theirs, 'me')).toBe('blue highlight by Dr Grace Hopper: the secondary outcome — has a comment');
    // A masked author (blind mode strips the name on the wire) stays honest.
    expect(annotationAriaLabel({ ...theirs, authorName: '', comment: '' }, 'me')).toBe('blue highlight by another member: the secondary outcome');
  });
});

describe('116.md §89/§91 — the optimistic list reducer', () => {
  const draft = () => pendingAnnotation({
    clientId: 'an-1', docHash: 'f'.repeat(64), page: 2,
    rects: [{ x0: 1, y0: 2, x1: 3, y1: 4 }], selectedText: 'hello',
    color: 'nonsense', comment: '', authorId: 'me', authorName: 'Me', now: 'T0',
  });

  it('a pending row is marked pending, clamped to the palette and bounded', () => {
    const d = pendingAnnotation({
      clientId: 'an-1', docHash: 'a', page: 1, rects: [], color: 'zzz',
      selectedText: 'x'.repeat(MAX_SELECTED_TEXT + 500),
      comment: 'y'.repeat(MAX_COMMENT + 500), now: 'T0',
    });
    expect(d.pending).toBe(true);
    expect(d.failed).toBe(false);
    expect(d.revision).toBe(0);
    expect(d.color).toBe('yellow');
    expect(d.selectedText).toHaveLength(MAX_SELECTED_TEXT);
    expect(d.comment).toHaveLength(MAX_COMMENT);
    expect(d.id).toBe('local:an-1');
  });

  it('the server ack REPLACES the optimistic row instead of duplicating it', () => {
    const local = [draft()];
    const acked = { id: 'srv-9', clientId: 'an-1', page: 2, color: 'yellow', revision: 1, deleted: false };
    const next = upsertByClientId(local, { ...acked, pending: false, failed: false });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('srv-9');
    expect(next[0].pending).toBe(false);
    expect(next[0].selectedText).toBe('hello');   // local fields survive the merge
  });

  it('merging the SAME server payload twice is idempotent (§91 duplicate events)', () => {
    const server = [{ id: 's1', clientId: 'c1', page: 1, rects: [], color: 'blue', revision: 3, deleted: false }];
    const once = mergeServerList([], server, { full: true });
    const twice = mergeServerList(once, server, { full: true });
    const thrice = mergeServerList(twice, server, {});
    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
    expect(thrice).toHaveLength(1);
    expect(thrice[0].revision).toBe(3);
  });

  it('a tombstone in the delta REMOVES the row (deletions propagate, §91)', () => {
    const live = mergeServerList([], [{ id: 's1', clientId: 'c1', page: 1, deleted: false }], { full: true });
    const gone = mergeServerList(live, [{ id: 's1', clientId: 'c1', page: 1, deleted: true }], {});
    expect(gone).toEqual([]);
  });

  it('an in-flight local insert survives a DELTA merge but not a FULL refresh', () => {
    const local = [draft()];
    expect(mergeServerList(local, [], {})).toHaveLength(1);
    expect(mergeServerList(local, [], { full: true })).toHaveLength(1);   // still pending
    const acked = local.map((a) => ({ ...a, pending: false }));
    expect(mergeServerList(acked, [], { full: true })).toEqual([]);       // acked + absent ⇒ deleted elsewhere
  });

  it('markFailed / dropByClientId express the §89 "do not pretend it persisted" path', () => {
    const failed = markFailed([draft()], 'an-1');
    expect(failed[0].pending).toBe(false);
    expect(failed[0].failed).toBe(true);
    expect(dropByClientId(failed, 'an-1')).toEqual([]);
    expect(dropByClientId(failed, 'other')).toHaveLength(1);
  });

  it('a server row without a clientId is ignored rather than merged blind', () => {
    expect(mergeServerList([], [{ id: 's1', page: 1 }], { full: true })).toEqual([]);
  });
});
