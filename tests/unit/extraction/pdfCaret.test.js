/**
 * pdfCaret.test.js — 98.md §16 (+ 79.md §4). The click-to-pick caret resolvers,
 * extracted from AppPdfViewer into src/frontend/components/pdfCaret.js so the
 * Safari/WebKit behavior is testable without a browser. House style: no jsdom — a
 * tiny fake DOM (nodes + Ranges with a per-character geometry table) is enough,
 * because the module only touches nodeType/textContent/childNodes/contains/
 * ownerDocument.createRange and the caret-from-point APIs.
 *
 * The §16 case under test: WebKit's caretRangeFromPoint mis-maps x on CSS-scaled
 * text and returns the RIGHT node with a WRONG offset — previously trusted outright
 * (the geometry fallback only ran when the caret landed OUTSIDE the span), snapping
 * the capture to an adjacent token. Now the caret answer is cross-validated against
 * the click point and a disagreeing offset falls through to geometry.
 */
import { describe, it, expect } from 'vitest';
import { caretOffsetInSpan, caretOffsetByGeometry, caretAgreesWithPoint } from '../../../src/frontend/components/pdfCaret.js';

/* ── Fake DOM: per-character rects laid out left→right, CHAR_W px per char ────── */
const CHAR_W = 10, TOP = 100, BOT = 112;
const Y = (TOP + BOT) / 2;                       // a y on the text line
const midOf = (x0, i) => x0 + i * CHAR_W + CHAR_W / 2; // centre-x of char i

/** Text node whose chars are measurable from x0 (x0 == null → unmeasurable, 0×0). */
const fakeText = (text, x0 = null) => ({ nodeType: 3, textContent: text, childNodes: [], __x0: x0 });
/** Element node (e.g. a highlight <mark>) wrapping child nodes. */
const fakeEl = (children) => ({
  nodeType: 1, childNodes: children,
  get textContent() { return children.map((c) => c.textContent).join(''); },
});

/** A text-layer span + its ownerDocument (Range rects come from each node's __x0). */
function makeSpan(children, docExtra = {}) {
  const doc = { ...docExtra };
  const span = {
    nodeType: 1, childNodes: children, ownerDocument: doc,
    get textContent() { return children.map((c) => c.textContent).join(''); },
    contains(n) {
      let hit = false;
      const walk = (x) => { if (hit) return; if (x === n) { hit = true; return; } (x.childNodes || []).forEach(walk); };
      walk(span);
      return hit;
    },
  };
  const stamp = (n) => { n.ownerDocument = doc; (n.childNodes || []).forEach(stamp); };
  children.forEach(stamp);
  doc.createRange = () => {
    let node = null, s = 0, e = 0;
    return {
      setStart(n, i) { node = n; s = i; },
      setEnd(_n, i) { e = i; },
      getBoundingClientRect() {
        if (!node || node.nodeType !== 3 || node.__x0 == null || e <= s) {
          return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
        }
        const left = node.__x0 + s * CHAR_W, right = node.__x0 + e * CHAR_W;
        return { left, right, top: TOP, bottom: BOT, width: right - left, height: BOT - TOP };
      },
    };
  };
  return { span, doc };
}

describe('caretOffsetByGeometry', () => {
  it('returns the exact character offset whose rect contains the point', () => {
    const { span } = makeSpan([fakeText('OR 2.45', 0)]);
    expect(caretOffsetByGeometry(span, midOf(0, 3), Y)).toBe(3); // the "2"
    expect(caretOffsetByGeometry(span, midOf(0, 6), Y)).toBe(6); // the "5"
  });
  it('snaps to the nearest character on the clicked line when past the run edge', () => {
    const { span } = makeSpan([fakeText('12', 0)]);
    expect(caretOffsetByGeometry(span, 500, Y)).toBe(1); // nearest = last char
  });
  it('returns null when the span has no measurable text', () => {
    const { span } = makeSpan([fakeText('12' /* no __x0 → 0×0 rects */)]);
    expect(caretOffsetByGeometry(span, 5, Y)).toBe(null);
  });
});

describe('caretAgreesWithPoint (98.md §16 cross-validation)', () => {
  it('agrees when the click sits on a character adjacent to the caret', () => {
    const { span } = makeSpan([fakeText('2.45', 0)]);
    const tn = span.childNodes[0];
    expect(caretAgreesWithPoint(tn, 2, midOf(0, 2), Y)).toBe(true);   // char after caret
    expect(caretAgreesWithPoint(tn, 2, midOf(0, 1), Y)).toBe(true);   // char before caret
    expect(caretAgreesWithPoint(tn, 4, midOf(0, 3), Y)).toBe(true);   // caret at end of node
  });
  it('vetoes a caret a whole token away from the click', () => {
    const { span } = makeSpan([fakeText('2.45 1.10', 0)]);
    const tn = span.childNodes[0];
    // Click on "1.10" (chars 5..8) but caret claims offset 0 → disagree.
    expect(caretAgreesWithPoint(tn, 0, midOf(0, 6), Y)).toBe(false);
  });
  it('cannot veto when rects are unmeasurable (no layout engine)', () => {
    const { span } = makeSpan([fakeText('2.45')]);
    expect(caretAgreesWithPoint(span.childNodes[0], 0, 999, 999)).toBe(true);
  });
});

describe('caretOffsetInSpan', () => {
  it('uses the caret API when its answer matches the click point', () => {
    const { span } = makeSpan([fakeText('OR 2.45', 0)], {});
    span.ownerDocument.caretRangeFromPoint = () => ({ startContainer: span.childNodes[0], startOffset: 5 });
    expect(caretOffsetInSpan(span, midOf(0, 5), Y)).toBe(5);
  });

  it('WebKit right-node/WRONG-offset caret is vetoed and geometry decides (§16)', () => {
    const { span } = makeSpan([fakeText('2.45 1.10', 0)]);
    // The scaleX mis-map: the API returns the right node but offset 0 for a click on "1.10".
    span.ownerDocument.caretRangeFromPoint = () => ({ startContainer: span.childNodes[0], startOffset: 0 });
    expect(caretOffsetInSpan(span, midOf(0, 6), Y)).toBe(6);
  });

  it('falls back to geometry when the caret lands outside the span', () => {
    const { span } = makeSpan([fakeText('12 34', 0)]);
    const alien = fakeText('elsewhere', 0);
    span.ownerDocument.caretRangeFromPoint = () => ({ startContainer: alien, startOffset: 2 });
    expect(caretOffsetInSpan(span, midOf(0, 4), Y)).toBe(4);
  });

  it('falls back to geometry when no caret API exists at all', () => {
    const { span } = makeSpan([fakeText('12 34', 0)]);
    expect(caretOffsetInSpan(span, midOf(0, 3), Y)).toBe(3);
  });

  it('keeps the caret answer when rects are unmeasurable (feature-detected degradation)', () => {
    const { span } = makeSpan([fakeText('2.45')]); // no rects anywhere
    span.ownerDocument.caretRangeFromPoint = () => ({ startContainer: span.childNodes[0], startOffset: 3 });
    expect(caretOffsetInSpan(span, 12345, 6789)).toBe(3);
  });

  it('sums DFS node lengths across a highlight-split span (text + <mark> + text)', () => {
    // "OR " + <mark>2.45</mark> + " more" — concatenated textContent equals dataset.t.
    const t1 = fakeText('OR ', 0);
    const t2 = fakeText('2.45', 30);
    const t3 = fakeText(' more', 70);
    const { span } = makeSpan([t1, fakeEl([t2]), t3]);
    span.ownerDocument.caretRangeFromPoint = () => ({ startContainer: t2, startOffset: 2 });
    // Click on the "4" of 2.45 (t2 char 2): total = len("OR ") + 2 = 5.
    expect(caretOffsetInSpan(span, midOf(30, 2), Y)).toBe(5);
  });

  it('prefers caretPositionFromPoint (Firefox API) over caretRangeFromPoint', () => {
    const { span } = makeSpan([fakeText('987', 0)]);
    span.ownerDocument.caretPositionFromPoint = () => ({ offsetNode: span.childNodes[0], offset: 1 });
    span.ownerDocument.caretRangeFromPoint = () => ({ startContainer: span.childNodes[0], startOffset: 2 });
    expect(caretOffsetInSpan(span, midOf(0, 1), Y)).toBe(1);
  });

  it('returns null for a null/document-less span', () => {
    expect(caretOffsetInSpan(null, 0, 0)).toBe(null);
  });
});
