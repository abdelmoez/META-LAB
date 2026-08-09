/**
 * menuPosition.test.js — 108.md §21 "context menu appears close to the pointer …
 * remains within viewport boundaries". The clamp/flip matrix, as pure maths.
 */
import { describe, it, expect } from 'vitest';
import { placeMenu } from '../../../src/research-engine/interaction/menuPosition.js';

const VW = 1000;
const VH = 800;
const MENU = { menuWidth: 200, menuHeight: 120, viewportWidth: VW, viewportHeight: VH };

describe('placeMenu — the happy case', () => {
  it('opens down-right from the pointer with no flipping', () => {
    expect(placeMenu({ x: 300, y: 200, ...MENU })).toEqual({
      left: 300, top: 200, flippedX: false, flippedY: false,
    });
  });

  it('sits exactly at the pointer when there is room to spare', () => {
    const r = placeMenu({ x: 10, y: 10, ...MENU, gap: 8 });
    expect(r.left).toBe(10);
    expect(r.top).toBe(10);
  });
});

describe('placeMenu — flipping', () => {
  it('flips left when the right edge would overflow and the left side fits', () => {
    const r = placeMenu({ x: 900, y: 200, ...MENU });   // 900 + 200 = 1100 > 1000 - 8
    expect(r).toEqual({ left: 700, top: 200, flippedX: true, flippedY: false });
  });

  it('flips up when the bottom edge would overflow and there is room above', () => {
    const r = placeMenu({ x: 300, y: 750, ...MENU });   // 750 + 120 = 870 > 800 - 8
    expect(r).toEqual({ left: 300, top: 630, flippedX: false, flippedY: true });
  });

  it('flips on BOTH axes in the bottom-right corner', () => {
    const r = placeMenu({ x: 950, y: 780, ...MENU });
    expect(r).toEqual({ left: 750, top: 660, flippedX: true, flippedY: true });
  });

  it('does not flip when the opposite side has no room either — it clamps', () => {
    // x=100 with a 200-wide menu: right overflows only if the viewport is narrow.
    const r = placeMenu({ x: 100, y: 40, menuWidth: 200, menuHeight: 120, viewportWidth: 260, viewportHeight: 800 });
    expect(r.flippedX).toBe(false);          // 100 - 200 < gap, so no flip
    expect(r.left).toBe(52);                 // clamped to 260 - 200 - 8
  });
});

describe('placeMenu — clamping', () => {
  it('never lets the menu leave the viewport on either axis', () => {
    for (const x of [-500, -1, 0, 500, 999, 5000]) {
      for (const y of [-500, -1, 0, 400, 799, 5000]) {
        const r = placeMenu({ x, y, ...MENU, gap: 8 });
        expect(r.left).toBeGreaterThanOrEqual(8);
        expect(r.left + MENU.menuWidth).toBeLessThanOrEqual(VW - 8);
        expect(r.top).toBeGreaterThanOrEqual(8);
        expect(r.top + MENU.menuHeight).toBeLessThanOrEqual(VH - 8);
      }
    }
  });

  it('clamps a negative pointer position to the gap margin', () => {
    const r = placeMenu({ x: -40, y: -40, ...MENU });
    expect(r).toEqual({ left: 8, top: 8, flippedX: false, flippedY: false });
  });

  it('pins to the top-left when the menu is larger than the viewport', () => {
    const r = placeMenu({
      x: 300, y: 300, menuWidth: 2000, menuHeight: 2000,
      viewportWidth: VW, viewportHeight: VH,
    });
    expect(r).toEqual({ left: 8, top: 8, flippedX: false, flippedY: false });
  });

  it('honours a custom gap', () => {
    // A pointer far outside the viewport is degenerate input (it cannot come from
    // a real contextmenu event): the menu flips and is then clamped to the margin.
    const r = placeMenu({ x: 5000, y: 5000, ...MENU, gap: 24 });
    expect(r.left).toBe(VW - 200 - 24);
    expect(r.top).toBe(VH - 120 - 24);
  });

  it('gap 0 places flush against the edge', () => {
    const r = placeMenu({ x: 5000, y: 5000, ...MENU, gap: 0 });
    expect(r.left).toBe(800);
    expect(r.top).toBe(680);
  });
});

describe('placeMenu — defensive input handling', () => {
  it('coerces missing / non-finite numbers instead of returning NaN', () => {
    for (const args of [undefined, {}, { x: NaN, y: 'nope', menuWidth: null, viewportWidth: undefined }]) {
      const r = placeMenu(args);
      expect(Number.isFinite(r.left)).toBe(true);
      expect(Number.isFinite(r.top)).toBe(true);
      expect(r.flippedX).toBe(false);
      expect(r.flippedY).toBe(false);
    }
  });

  it('treats a negative gap or size as zero', () => {
    const r = placeMenu({ x: 100, y: 100, menuWidth: -50, menuHeight: -50, viewportWidth: VW, viewportHeight: VH, gap: -10 });
    expect(r.left).toBe(100);
    expect(r.top).toBe(100);
  });
});
