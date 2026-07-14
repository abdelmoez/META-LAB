/**
 * pdfRevealBox.test.js — 83.md §3. Pure geometry for the persistent jump-to-source
 * highlight: PDF user-space (y-up) → CSS px mapping, the page-only fallback (a
 * DISTINCT marker, never a fabricated box), and the centred scroll-top math.
 */
import { describe, it, expect } from 'vitest';
import { isExactRegion, revealBoxFor, revealScrollTop } from '../../src/frontend/components/pdfRevealBox.js';

const DIMS = { w: 612, h: 792 }; // US-Letter at scale 1

describe('isExactRegion', () => {
  it('accepts a finite, positive-area rect only', () => {
    expect(isExactRegion({ x0: 10, y0: 20, x1: 40, y1: 50 })).toBe(true);
    expect(isExactRegion(null)).toBe(false);
    expect(isExactRegion({ x0: 10, y0: 20, x1: 10, y1: 50 })).toBe(false);  // zero width
    expect(isExactRegion({ x0: 10, y0: 50, x1: 40, y1: 20 })).toBe(false);  // inverted
    expect(isExactRegion({ x0: 'a', y0: 20, x1: 40, y1: 50 })).toBe(false); // non-finite
  });
});

describe('revealBoxFor — user-space (y-up) → CSS px (y-down) at the live scale', () => {
  it('maps left=x0·s, top=(H−y1)·s and scales width/height', () => {
    const box = revealBoxFor({ x0: 100, y0: 700, x1: 200, y1: 720 }, DIMS, 2);
    expect(box.kind).toBe('exact');
    expect(box.left).toBe(200);              // 100·2
    expect(box.top).toBe((792 - 720) * 2);   // near the TOP of the page (y-up flip)
    expect(box.width).toBe(200);             // (200−100)·2
    expect(box.height).toBe(40);             // (720−700)·2
  });
  it('repositions when the scale changes (zoom keeps the highlight aligned)', () => {
    const r = { x0: 50, y0: 100, x1: 150, y1: 130 };
    const at1 = revealBoxFor(r, DIMS, 1);
    const at3 = revealBoxFor(r, DIMS, 3);
    expect(at3.left).toBe(at1.left * 3);
    expect(at3.top).toBe(at1.top * 3);
    expect(at3.width).toBe(at1.width * 3);
  });
  it('page-only provenance → a distinct page marker, never a fabricated box', () => {
    expect(revealBoxFor(null, DIMS, 1)).toEqual({ kind: 'page' });
    expect(revealBoxFor({ x0: 1 }, DIMS, 1)).toEqual({ kind: 'page' });
  });
  it('null without page dims or a usable scale', () => {
    expect(revealBoxFor({ x0: 0, y0: 0, x1: 1, y1: 1 }, null, 1)).toBeNull();
    expect(revealBoxFor({ x0: 0, y0: 0, x1: 1, y1: 1 }, DIMS, 0)).toBeNull();
  });
});

describe('revealScrollTop — centres the source comfortably in the viewport', () => {
  it('centres an exact box vertically', () => {
    const box = { kind: 'exact', left: 0, top: 400, width: 100, height: 20 };
    // pageTop 1000, box at +400, viewport 600 → centred ≈ 1000+400−(600−20)/2 = 1110
    expect(revealScrollTop({ pageTop: 1000, box, viewportH: 600 })).toBe(1110);
  });
  it('clamps to 0 for a source near the document start', () => {
    const box = { kind: 'exact', left: 0, top: 10, width: 100, height: 20 };
    expect(revealScrollTop({ pageTop: 0, box, viewportH: 900 })).toBe(0);
  });
  it('page-only reveals land on the page top', () => {
    expect(revealScrollTop({ pageTop: 500, box: { kind: 'page' }, viewportH: 600, pagePad: 8 })).toBe(492);
    expect(revealScrollTop({ pageTop: 500, box: null, viewportH: 600, pagePad: 8 })).toBe(492);
  });
});
