/**
 * themeValidate.test.js — server-side brand theme validation (prompt37).
 *
 * The stored palette is injected into CSS custom properties on every page, so
 * the validator's job is to guarantee every value is a strict #rrggbb hex
 * (which also closes any CSS value-injection vector).
 */

import { describe, it, expect } from 'vitest';
import {
  validateThemePatch, normalizeHex, defaultThemeSettings,
  DEFAULT_BRAND, DEFAULT_PRESET,
} from '../../server/utils/themeValidate.js';

const fullPalette = {
  day:   { acc: '#4f46e5', acc2: '#4239c0', accText: '#ffffff', accBg: '#eae8fc' },
  night: { acc: '#8e88f0', acc2: '#7a72eb', accText: '#0b1020', accBg: '#1d2742' },
};

describe('normalizeHex', () => {
  it('normalizes and rejects', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('4f46e5')).toBe('#4f46e5');
    expect(normalizeHex('rgb(0,0,0)')).toBeNull();
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('validateThemePatch', () => {
  it('rejects a missing/empty body', () => {
    expect(validateThemePatch(null).ok).toBe(false);
    expect(validateThemePatch(undefined).ok).toBe(false);
    expect(validateThemePatch({}).ok).toBe(false);
  });

  it('rejects an invalid brandColor', () => {
    expect(validateThemePatch({ brandColor: 'blue' }).ok).toBe(false);
    expect(validateThemePatch({ brandColor: '#12' }).ok).toBe(false);
  });

  it('accepts + normalizes a valid brandColor', () => {
    const r = validateThemePatch({ brandColor: '#4F46E5' });
    expect(r.ok).toBe(true);
    expect(r.value.brandColor).toBe('#4f46e5');
    expect(r.value.preset).toBe(DEFAULT_PRESET);
    expect(r.value.palette).toBeNull();
  });

  it('accepts a complete hex palette', () => {
    const r = validateThemePatch({ brandColor: '#4f46e5', preset: 'default', palette: fullPalette });
    expect(r.ok).toBe(true);
    expect(r.value.palette.day.acc).toBe('#4f46e5');
    expect(r.value.palette.night.accText).toBe('#0b1020');
  });

  it('rejects a palette containing a non-hex value (injection guard)', () => {
    const evil = JSON.parse(JSON.stringify(fullPalette));
    evil.day.acc = 'red; } body{display:none}';
    expect(validateThemePatch({ brandColor: '#4f46e5', palette: evil }).ok).toBe(false);
  });

  it('rejects an incomplete palette side', () => {
    const partial = { day: { acc: '#4f46e5' }, night: fullPalette.night };
    expect(validateThemePatch({ brandColor: '#4f46e5', palette: partial }).ok).toBe(false);
  });

  it('rejects an unsafe preset slug', () => {
    expect(validateThemePatch({ brandColor: '#4f46e5', preset: 'a b' }).ok).toBe(false);
    expect(validateThemePatch({ brandColor: '#4f46e5', preset: '../x' }).ok).toBe(false);
    expect(validateThemePatch({ brandColor: '#4f46e5', preset: 'x'.repeat(40) }).ok).toBe(false);
  });

  it('reset:true returns the default theme with no palette', () => {
    const r = validateThemePatch({ reset: true });
    expect(r.ok).toBe(true);
    expect(r.value.brandColor).toBe(DEFAULT_BRAND);
    expect(r.value.preset).toBe(DEFAULT_PRESET);
    expect(r.value.palette).toBeNull();
  });
});

describe('defaultThemeSettings', () => {
  it('is the indigo default with null palette + updatedAt', () => {
    const d = defaultThemeSettings();
    expect(d.brandColor).toBe(DEFAULT_BRAND);
    expect(d.preset).toBe(DEFAULT_PRESET);
    expect(d.palette).toBeNull();
    expect(d.updatedAt).toBeNull();
  });
});
