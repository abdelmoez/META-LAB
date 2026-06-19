/**
 * themeEngine.test.js — the global brand palette generator (prompt37).
 *
 * Covers the Phase 3 / Phase 10 requirements:
 *   - generateThemeFromHex returns a complete day+night palette
 *   - invalid hex rejected; valid hex normalized
 *   - readable foreground chosen by contrast
 *   - presets are valid + accessible
 *   - diagnostics flag poor-contrast colors
 *   - override CSS / css-var mapping correct
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeHex, isValidHex, generateThemeFromHex, getReadableForeground,
  mixWithWhite, mixWithBlack, validateContrast, diagnosePalette,
  paletteToCssVars, buildBrandOverrideCss, PRESETS, PRESET_BY_ID,
  buildThemeRecord, defaultThemeRecord, DEFAULT_BRAND, BRAND_TOKEN_VARS,
} from '../../src/frontend/theme/themeEngine.js';
import { contrastRatio, relLuminance } from '../../src/frontend/theme/contrast.js';

const HEX6 = /^#[0-9a-f]{6}$/;
const isHex = (v) => HEX6.test(v);

describe('hex normalization', () => {
  it('normalizes 3-digit, 6-digit, with/without #, any case', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('  4f46e5 ')).toBe('#4f46e5');
  });
  it('rejects invalid input', () => {
    for (const bad of ['', 'xyz', '#12', '#1234', 'rgb(0,0,0)', null, undefined, 123, '#11223g']) {
      expect(normalizeHex(bad)).toBeNull();
      expect(isValidHex(bad)).toBe(false);
    }
  });
});

describe('generateThemeFromHex', () => {
  it('returns a complete day+night palette of valid hex', () => {
    const p = generateThemeFromHex('#4f46e5');
    for (const mode of ['day', 'night']) {
      for (const key of ['acc', 'acc2', 'accText', 'accBg']) {
        expect(isHex(p[mode][key]), `${mode}.${key}=${p[mode][key]}`).toBe(true);
      }
    }
    expect(p.brandColor).toBe('#4f46e5');
    expect(p.day.acc).toBe('#4f46e5'); // day primary IS the chosen brand
  });

  it('throws on invalid hex', () => {
    expect(() => generateThemeFromHex('nope')).toThrow();
  });

  it('does NOT flatten every token to the same color', () => {
    const p = generateThemeFromHex('#2563eb');
    const all = [p.day.acc, p.day.acc2, p.day.accBg, p.night.acc, p.night.accBg];
    expect(new Set(all).size).toBeGreaterThan(3);
  });

  it('night accent is lighter than the day accent for a dark brand', () => {
    const p = generateThemeFromHex('#1e40af'); // dark navy
    expect(relLuminance(p.night.acc)).toBeGreaterThan(relLuminance(p.day.acc));
  });

  it('button text on brand meets AA for the default indigo', () => {
    const p = generateThemeFromHex(DEFAULT_BRAND);
    expect(contrastRatio(p.day.accText, p.day.acc)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.night.accText, p.night.acc)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('getReadableForeground', () => {
  it('picks white on dark, dark on light', () => {
    expect(getReadableForeground('#000000')).toBe('#ffffff');
    expect(getReadableForeground('#ffffff')).not.toBe('#ffffff');
    // chosen foreground always beats the alternative in contrast
    const fg = getReadableForeground('#4f46e5');
    expect(contrastRatio(fg, '#4f46e5')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('mixing', () => {
  it('mixWithWhite lightens, mixWithBlack darkens', () => {
    expect(relLuminance(mixWithWhite('#4f46e5', 0.5))).toBeGreaterThan(relLuminance('#4f46e5'));
    expect(relLuminance(mixWithBlack('#4f46e5', 0.5))).toBeLessThan(relLuminance('#4f46e5'));
    expect(mixWithWhite('#4f46e5', 0.5)).toMatch(HEX6);
    expect(mixWithBlack('#4f46e5', 0.5)).toMatch(HEX6);
    expect(mixWithWhite('#000000', 1)).toBe('#ffffff');
    expect(mixWithBlack('#ffffff', 1)).toBe('#000000');
  });
});

describe('css-var mapping', () => {
  it('paletteToCssVars maps the four brand tokens', () => {
    const p = generateThemeFromHex('#0f766e');
    const vars = paletteToCssVars(p, 'day');
    expect(Object.keys(vars).sort()).toEqual(['--t-acc', '--t-acc-bg', '--t-acc-text', '--t-acc2'].sort());
    expect(vars['--t-acc']).toBe(p.day.acc);
  });
  it('buildBrandOverrideCss emits both theme selectors', () => {
    const css = buildBrandOverrideCss(generateThemeFromHex('#be123c'));
    expect(css).toContain(':root[data-theme="day"]');
    expect(css).toContain(':root[data-theme="night"]');
    expect(css).toContain('--t-acc:');
  });
  it('BRAND_TOKEN_VARS covers exactly the four tokens', () => {
    expect(Object.values(BRAND_TOKEN_VARS).sort())
      .toEqual(['--t-acc', '--t-acc-bg', '--t-acc-text', '--t-acc2'].sort());
  });
  it('paletteToCssVars drops non-hex leaves (tamper/injection guard)', () => {
    const junk = {
      day:   { acc: 'red; } body{display:none}', acc2: '#4338ca', accText: '#ffffff', accBg: '#eef2ff' },
      night: { acc: '#818cf8', acc2: '#6366f1', accText: '#0b1020', accBg: '#1e2547' },
    };
    const vars = paletteToCssVars(junk, 'day');
    expect(vars['--t-acc']).toBeUndefined();     // junk leaf omitted
    expect(vars['--t-acc2']).toBe('#4338ca');     // valid leaves kept
    expect(paletteToCssVars(null, 'day')).toEqual({});
  });
});

describe('diagnostics', () => {
  it('default indigo passes (no fail level)', () => {
    const diag = diagnosePalette(generateThemeFromHex(DEFAULT_BRAND));
    expect(diag.ok).toBe(true);
    expect(diag.checks.length).toBeGreaterThanOrEqual(5);
  });
  it('a pale low-contrast color produces warnings and is flagged unusable', () => {
    const diag = diagnosePalette(generateThemeFromHex('#ffe14d')); // pale yellow on white
    expect(diag.hasWarnings).toBe(true);
    // Accent-as-text on the near-white page background is < 3:1 → fail → not ok.
    expect(diag.ok).toBe(false);
    expect(diag.checks.some((c) => c.level === 'fail')).toBe(true);
  });
  it('validateContrast reports ratio + AA flags', () => {
    const v = validateContrast('#ffffff', '#000000');
    expect(v.ratio).toBeGreaterThan(20);
    expect(v.passesAA).toBe(true);
  });
});

describe('presets', () => {
  it('every preset has a unique id + valid hex', () => {
    const ids = new Set();
    for (const p of PRESETS) {
      expect(isHex(p.hex), `${p.id}=${p.hex}`).toBe(true);
      expect(p.name).toBeTruthy();
      ids.add(p.id);
    }
    expect(ids.size).toBe(PRESETS.length);
    expect(PRESET_BY_ID.default.hex).toBe(DEFAULT_BRAND);
  });

  it('every preset accent is usable (button text AA 4.5, accent visible on white ≥3:1)', () => {
    for (const p of PRESETS) {
      const pal = generateThemeFromHex(p.hex);
      // getReadableForeground maximizes contrast → button text is always AA.
      expect(contrastRatio(pal.day.accText, pal.day.acc), `btn-day ${p.id}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(pal.night.accText, pal.night.acc), `btn-night ${p.id}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(pal.day.acc, '#f6f7f9'), `tab ${p.id}`).toBeGreaterThanOrEqual(3.0);
      // No preset should be "unusable" (no fail-level check).
      expect(diagnosePalette(pal).ok, `diag ${p.id}`).toBe(true);
    }
  });
});

describe('buildThemeRecord / defaultThemeRecord', () => {
  it('builds from a preset id', () => {
    const rec = buildThemeRecord({ presetId: 'clinical' });
    expect(rec.brandColor).toBe(PRESET_BY_ID.clinical.hex);
    expect(rec.preset).toBe('clinical');
    expect(rec.palette.day.acc).toBe(PRESET_BY_ID.clinical.hex);
  });
  it('builds from a custom hex, labelled custom', () => {
    const rec = buildThemeRecord({ hex: '#123456' });
    expect(rec.brandColor).toBe('#123456');
    expect(rec.preset).toBe('custom');
  });
  it('a custom hex equal to a preset is labelled as that preset', () => {
    const rec = buildThemeRecord({ hex: DEFAULT_BRAND });
    expect(rec.preset).toBe('default');
  });
  it('returns null for an invalid request', () => {
    expect(buildThemeRecord({ hex: 'nope' })).toBeNull(); // not hex (o, p, e invalid)
    expect(buildThemeRecord({ hex: 'zzzzzz' })).toBeNull();
    expect(buildThemeRecord({})).toBeNull();
  });
  it('defaultThemeRecord is the indigo default', () => {
    const rec = defaultThemeRecord();
    expect(rec.brandColor).toBe(DEFAULT_BRAND);
    expect(rec.preset).toBe('default');
  });
});
