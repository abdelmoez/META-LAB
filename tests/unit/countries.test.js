/**
 * countries.test.js (prompt22 Task 1) — the canonical ISO-3166 country reference
 * that backs the Ops users-by-country map. These assertions are the regression
 * guard for the "UAE shows as Ukraine" bug: the code↔name↔geometry join must be
 * stable, and an abbreviation must NEVER be truncated into the wrong country.
 */
import { describe, it, expect } from 'vitest';
import {
  countryNameForCode, normalizeCountryCode, isAlpha2,
  ISO_A2_TO_NAME, ISO_A3_TO_A2, COUNTRY_OPTIONS,
} from '../../src/shared/countries.js';

describe('countryNameForCode — code drives the displayed name', () => {
  it('maps the bug fixtures correctly (UAE/Ukraine/USA are distinct)', () => {
    expect(countryNameForCode('AE')).toBe('United Arab Emirates');
    expect(countryNameForCode('UA')).toBe('Ukraine');
    expect(countryNameForCode('US')).toBe('United States');
    // The crux: AE and UA are different countries with different names.
    expect(countryNameForCode('AE')).not.toBe(countryNameForCode('UA'));
  });

  it('is case-insensitive and returns "" for blank/unknown codes', () => {
    expect(countryNameForCode('ae')).toBe('United Arab Emirates');
    expect(countryNameForCode('')).toBe('');
    expect(countryNameForCode(null)).toBe('');
    expect(countryNameForCode('ZZ')).toBe(''); // not a real ISO code
  });
});

describe('normalizeCountryCode — resolve WITHOUT truncating', () => {
  it('never truncates an abbreviation into the wrong country', () => {
    // The exact bug: "UAE".slice(0,2) === "UA" (Ukraine). Must resolve to AE.
    expect(normalizeCountryCode('UAE')).toBe('AE');
    expect(normalizeCountryCode('UAE')).not.toBe('UA');
  });

  it('accepts alpha-2, alpha-3, aliases, and full names', () => {
    expect(normalizeCountryCode('ae')).toBe('AE');     // alpha-2
    expect(normalizeCountryCode('ARE')).toBe('AE');    // alpha-3
    expect(normalizeCountryCode('UKR')).toBe('UA');    // alpha-3
    expect(normalizeCountryCode('USA')).toBe('US');    // alpha-3
    expect(normalizeCountryCode('UK')).toBe('GB');     // alias
    expect(normalizeCountryCode('United Arab Emirates')).toBe('AE'); // name
    expect(normalizeCountryCode('Ukraine')).toBe('UA');
  });

  it('returns "" for unresolvable input (never a substring guess)', () => {
    expect(normalizeCountryCode('')).toBe('');
    expect(normalizeCountryCode('Nowhereland')).toBe('');
    expect(normalizeCountryCode(null)).toBe('');
  });
});

describe('ISO tables + picker options', () => {
  it('alpha-3 → alpha-2 table is consistent for the fixtures', () => {
    expect(ISO_A3_TO_A2.ARE).toBe('AE');
    expect(ISO_A3_TO_A2.UKR).toBe('UA');
    expect(ISO_A3_TO_A2.USA).toBe('US');
  });

  it('isAlpha2 recognises real codes only', () => {
    expect(isAlpha2('AE')).toBe(true);
    expect(isAlpha2('ua')).toBe(true);
    expect(isAlpha2('USA')).toBe(false); // 3 letters
    expect(isAlpha2('ZZ')).toBe(false);
  });

  it('COUNTRY_OPTIONS is alphabetical and includes the fixtures', () => {
    const byCode = Object.fromEntries(COUNTRY_OPTIONS.map(o => [o.code, o.name]));
    expect(byCode.AE).toBe('United Arab Emirates');
    expect(byCode.UA).toBe('Ukraine');
    expect(byCode.US).toBe('United States');
    const names = COUNTRY_OPTIONS.map(o => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // Sanity: a broad ISO set (not a stub).
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(200);
    expect(Object.keys(ISO_A2_TO_NAME).length).toBe(COUNTRY_OPTIONS.length);
  });
});
