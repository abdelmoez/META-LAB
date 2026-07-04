import { describe, it, expect } from 'vitest';
import { detectPageLayout, findGutter } from '../../../src/research-engine/extraction/pageLayout.js';

/** Synthetic pdf.js-user-space item (y grows UP). */
function itm(str, x, y, w, h = 10) {
  return { str, x, y, w, h };
}

/** One-column page: 25 wide lines, common left margin at x=50. */
function oneColPage() {
  const items = [];
  for (let i = 0; i < 25; i++) items.push(itm(`body line ${i}`, 50, 700 - i * 15, 500));
  return items;
}

/** Two-column page: left 40..290, right 320..570, shared baselines. */
function twoColPage({ leftX = 40, leftW = 250, rightX = 320, rightW = 250, nLeft = 20, nRight = 20 } = {}) {
  const items = [];
  for (let i = 0; i < nLeft; i++) items.push(itm(`left ${i}`, leftX, 700 - i * 15, leftW));
  for (let i = 0; i < nRight; i++) items.push(itm(`right ${i}`, rightX, 700 - i * 15, rightW));
  return items;
}

describe('pageLayout — column layout detection (§19.1)', () => {
  it('classifies a one-column page with high confidence', () => {
    const r = detectPageLayout(oneColPage());
    expect(r.columns).toBe(1);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].role).toBe('column');
    expect(r.readingOrder).toEqual([0]);
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.warnings).toEqual([]);
  });

  it('classifies a synthetic two-column page (two x-clusters, central gap)', () => {
    const r = detectPageLayout(twoColPage());
    expect(r.columns).toBe(2);
    expect(r.regions).toHaveLength(2);
    expect(r.regions.every((g) => g.role === 'column')).toBe(true);
    // Left region precedes right region in reading order and does not overlap it.
    const [a, b] = r.readingOrder.map((i) => r.regions[i]);
    expect(a.x1).toBeLessThanOrEqual(b.x0);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('carves a full-width title band above two columns (title read FIRST)', () => {
    const items = [
      itm('Effect of Something on Something Else: an RCT', 40, 750, 530, 14),
      itm('Author A, Author B, Author C', 40, 735, 530, 10),
      ...twoColPage(),
    ];
    const r = detectPageLayout(items);
    expect(r.columns).toBe(2);
    expect(r.regions).toHaveLength(3);
    const ordered = r.readingOrder.map((i) => r.regions[i]);
    expect(ordered[0].role).toBe('full-width');
    expect(ordered[1].role).toBe('column');
    expect(ordered[2].role).toBe('column');
    expect(ordered[1].x1).toBeLessThanOrEqual(ordered[2].x0);
  });

  it('slots a full-width TABLE band mid-page between the column pairs', () => {
    const items = [];
    for (let i = 0; i < 10; i++) {
      items.push(itm(`top-left ${i}`, 40, 700 - i * 15, 250));
      items.push(itm(`top-right ${i}`, 320, 700 - i * 15, 250));
    }
    for (let i = 0; i < 3; i++) items.push(itm(`table row ${i}`, 40, 540 - i * 15, 530));
    for (let i = 0; i < 10; i++) {
      items.push(itm(`bot-left ${i}`, 40, 485 - i * 15, 250));
      items.push(itm(`bot-right ${i}`, 320, 485 - i * 15, 250));
    }
    const r = detectPageLayout(items);
    expect(r.columns).toBe(2);
    expect(r.regions).toHaveLength(5);
    const roles = r.readingOrder.map((i) => r.regions[i].role);
    expect(roles).toEqual(['column', 'column', 'full-width', 'column', 'column']);
    const fw = r.regions[r.readingOrder[2]];
    // The band sits vertically BETWEEN the top and bottom column pairs.
    expect(fw.y1).toBeLessThan(r.regions[r.readingOrder[0]].y0);
    expect(fw.y0).toBeGreaterThan(r.regions[r.readingOrder[3]].y1);
  });

  it('handles asymmetric columns (narrow left, wide right, uneven line counts)', () => {
    const r = detectPageLayout(
      twoColPage({ leftX: 40, leftW: 160, rightX: 260, rightW: 310, nLeft: 24, nRight: 12 })
    );
    expect(r.columns).toBe(2);
    const [left, right] = r.readingOrder.map((i) => r.regions[i]);
    // The split lands inside the 200..260 whitespace channel (modulo binning).
    expect(left.x1).toBeGreaterThan(190);
    expect(left.x1).toBeLessThan(265);
    expect(right.x0).toBeGreaterThan(195);
    expect(right.x0).toBeLessThan(270);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('defaults a sparse page to one low-confidence column with a warning', () => {
    const r = detectPageLayout([itm('a', 50, 700, 80), itm('b', 300, 500, 80), itm('c', 100, 300, 80)]);
    expect(r.columns).toBe(1);
    expect(r.regions).toHaveLength(1);
    expect(r.confidence).toBeLessThanOrEqual(0.4);
    expect(r.warnings.join(' ')).toMatch(/sparse/i);
  });

  it('never throws on malformed / empty input and returns the safe default', () => {
    for (const bad of [null, undefined, 42, 'nope', {}, [], [null, 'x', 7], [{ str: 'no coords' }], [{ str: 'y', x: NaN, y: 'z' }]]) {
      let r;
      expect(() => { r = detectPageLayout(bad); }).not.toThrow();
      expect(r.columns).toBe(1);
      expect(r.regions).toEqual([]);
      expect(r.readingOrder).toEqual([]);
      expect(r.confidence).toBe(0);
      expect(r.warnings).toEqual(['no usable text items']);
    }
  });

  it('is deterministic — same items yield byte-identical results', () => {
    const items = [itm('T', 40, 750, 530), ...twoColPage()];
    expect(JSON.stringify(detectPageLayout(items))).toBe(JSON.stringify(detectPageLayout(items)));
  });
});

describe('findGutter — whitespace-channel helper', () => {
  const spans = [];
  for (let i = 0; i < 20; i++) spans.push({ x0: 40, x1: 290 });
  for (let i = 0; i < 20; i++) spans.push({ x0: 320, x1: 570 });

  it('finds the central channel of a two-column span set', () => {
    const g = findGutter(spans, { x0: 40, x1: 570 });
    expect(g).not.toBeNull();
    expect(g.x0).toBeGreaterThan(280);
    expect(g.x1).toBeLessThan(330);
    expect(g.leftCount).toBe(20);
    expect(g.rightCount).toBe(20);
    expect(g.crossFrac).toBe(0);
  });

  it('finds no gutter in full-width spans', () => {
    const wide = Array.from({ length: 20 }, () => ({ x0: 50, x1: 550 }));
    expect(findGutter(wide, { x0: 50, x1: 550 })).toBeNull();
  });

  it('guards malformed input (null spans, bad bounds, too few spans)', () => {
    expect(findGutter(null, { x0: 0, x1: 100 })).toBeNull();
    expect(findGutter(spans, null)).toBeNull();
    expect(findGutter(spans, { x0: 100, x1: 100 })).toBeNull();
    expect(findGutter([{ x0: 0, x1: 10 }, { x0: 60, x1: 100 }], { x0: 0, x1: 100 })).toBeNull();
  });
});
