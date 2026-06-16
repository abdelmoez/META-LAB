/**
 * accessibility-tokens.test.js — roadmap 0.4.
 *
 * Locks WCAG AA contrast on the theme's text/background pairs (both themes)
 * and validates the color-blind-safe palette tokens. If a future token edit
 * drops a primary text pair below AA, this fails in the CI gate.
 */
import { describe, it, expect } from 'vitest';
import { contrastRatio, meetsAA, hexToRgb } from '../../../src/frontend/theme/contrast.js';
import { THEMES, OKABE_ITO, CB_SERIES, SCREEN_STATUS_CB } from '../../../src/frontend/theme/tokens.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('theme text pairs meet WCAG AA', () => {
  for (const themeName of ['day', 'night']) {
    const t = THEMES[themeName];

    // Normal text (≥4.5:1): primary, secondary and muted body on every surface.
    const normalPairs = [
      ['txt', 'bg'], ['txt', 'surf'], ['txt', 'card2'],
      ['txt2', 'bg'], ['txt2', 'surf'], ['txt2', 'card2'],
      ['muted', 'bg'], ['muted', 'surf'], ['muted', 'card2'],
      ['accText', 'acc'],
    ];
    for (const [fg, bgKey] of normalPairs) {
      it(`${themeName}: ${fg} on ${bgKey} ≥ 4.5:1`, () => {
        const ratio = contrastRatio(t[fg], t[bgKey]);
        expect(ratio, `${t[fg]} on ${t[bgKey]} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }

    // Large text / UI components (≥3:1): accent + status colours as graphical fg.
    const largePairs = [['acc', 'surf'], ['red', 'surf'], ['grn', 'surf'], ['yel', 'surf']];
    for (const [fg, bgKey] of largePairs) {
      it(`${themeName}: ${fg} on ${bgKey} ≥ 3:1 (large/UI)`, () => {
        expect(meetsAA(t[fg], t[bgKey], true)).toBe(true);
      });
    }
  }
});

describe('muted body text was lifted to AA (regression lock)', () => {
  it('day muted = #676e77 (was #6b7280 = 4.39:1 on card2)', () => {
    expect(THEMES.day.muted).toBe('#676e77');
    expect(contrastRatio(THEMES.day.muted, THEMES.day.card2)).toBeGreaterThanOrEqual(4.5);
  });
  it('night muted = #8693b4 (was #6c7a99 = 4.12:1 on surf)', () => {
    expect(THEMES.night.muted).toBe('#8693b4');
    expect(contrastRatio(THEMES.night.muted, THEMES.night.surf)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('color-blind-safe palette tokens', () => {
  it('Okabe–Ito has 8 valid, distinct hex colours', () => {
    const vals = Object.values(OKABE_ITO);
    expect(vals).toHaveLength(8);
    vals.forEach(c => expect(c).toMatch(HEX));
    expect(new Set(vals).size).toBe(8);
  });

  it('CB_SERIES is a non-empty ordered subset of valid hex colours', () => {
    expect(CB_SERIES.length).toBeGreaterThanOrEqual(6);
    CB_SERIES.forEach(c => expect(c).toMatch(HEX));
    // Excludes the near-white yellow (would be invisible as a point/line on white).
    expect(CB_SERIES).not.toContain(OKABE_ITO.yellow);
  });

  it('screening decisions use the CVD-safe blue↔orange axis (not green/red)', () => {
    expect(SCREEN_STATUS_CB.include.base).toBe(OKABE_ITO.blue);
    expect(SCREEN_STATUS_CB.exclude.base).toBe(OKABE_ITO.vermillion);
  });

  it('each screening-label fg meets AA (≥4.5:1) on a white chip AND on its tint', () => {
    for (const key of Object.keys(SCREEN_STATUS_CB)) {
      const { fg, bg } = SCREEN_STATUS_CB[key];
      expect(fg).toMatch(HEX);
      expect(bg).toMatch(HEX);
      expect(contrastRatio(fg, '#ffffff'), `${key} fg on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, bg), `${key} fg on tint`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('contrast utility sanity', () => {
  it('hexToRgb parses shorthand and full hex', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#1f2937')).toEqual([31, 41, 55]);
  });
  it('black-on-white is 21:1; identical colours are 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 6);
  });
});
