/**
 * countryStats.test.js (prompt22 Task 1) — the Ops users-by-country aggregation.
 * The map joins geometry by ISO alpha-2 code and labels it with the name DERIVED
 * FROM THE CODE, so a stale stored name can never mislabel the wrong geometry.
 * These fixtures are the regression guard for the "UAE colours Ukraine" bug.
 */
import { describe, it, expect } from 'vitest';
import { buildCountryDistribution } from '../../server/utils/countryStats.js';

const byCode = (countries) => Object.fromEntries(countries.map(c => [c.countryCode || '__unknown__', c]));

describe('buildCountryDistribution', () => {
  it('UAE colours UAE (AE) only — never Ukraine, even with a stale stored name', () => {
    // A legacy record where the code is AE but the stored name was wrong: the map
    // name must come from the CODE (United Arab Emirates), not the stored value.
    const { countries } = buildCountryDistribution([
      { registrationCountryCode: 'AE', registrationCountryName: 'Wrongland', createdAt: '2026-01-01' },
    ]);
    const m = byCode(countries);
    expect(m.AE).toBeTruthy();
    expect(m.AE.countryName).toBe('United Arab Emirates');
    expect(m.UA).toBeUndefined(); // Ukraine is NOT coloured
  });

  it('Ukraine (UA) is its own bucket labelled "Ukraine" — distinct from UAE', () => {
    const { countries } = buildCountryDistribution([
      { registrationCountryCode: 'UA', registrationCountryName: 'United Arab Emirates', createdAt: '2026-01-02' },
      { registrationCountryCode: 'AE', registrationCountryName: null, createdAt: '2026-01-03' },
    ]);
    const m = byCode(countries);
    expect(m.UA.countryName).toBe('Ukraine');          // NOT "United Arab Emirates"
    expect(m.AE.countryName).toBe('United Arab Emirates');
    expect(m.UA.userCount).toBe(1);
    expect(m.AE.userCount).toBe(1);
  });

  it('USA still maps correctly (US)', () => {
    const { countries, summary } = buildCountryDistribution([
      { registrationCountryCode: 'US', createdAt: '2026-01-01' },
      { registrationCountryCode: 'us', createdAt: '2026-01-04' }, // case-insensitive → same bucket
    ]);
    const m = byCode(countries);
    expect(m.US.countryName).toBe('United States');
    expect(m.US.userCount).toBe(2);
    expect(summary.countriesRepresented).toBe(1);
  });

  it('Unknown / Local users never colour a country (no code, or junk code)', () => {
    const { countries, summary } = buildCountryDistribution([
      { registrationCountryCode: '',   registrationCountryName: 'Local',   createdAt: '2026-01-01' },
      { registrationCountryCode: null, registrationCountryName: 'Unknown', createdAt: '2026-01-02' },
      { registrationCountryCode: 'ZZ', registrationCountryName: 'Junk',    createdAt: '2026-01-03' }, // not a real ISO code
    ]);
    const known = countries.filter(c => c.countryCode);
    expect(known).toHaveLength(0);             // nothing colours the map
    expect(summary.totalKnown).toBe(0);
    expect(summary.unknown).toBe(3);
    expect(summary.countriesRepresented).toBe(0);
  });

  it('totals reconcile and rows sort by userCount desc', () => {
    const { countries, summary } = buildCountryDistribution([
      { registrationCountryCode: 'US' }, { registrationCountryCode: 'US' }, { registrationCountryCode: 'US' },
      { registrationCountryCode: 'AE' }, { registrationCountryCode: 'AE' },
      { registrationCountryCode: 'UA' },
      { registrationCountryCode: '' },
    ]);
    expect(summary.totalUsers).toBe(7);
    expect(summary.totalKnown + summary.unknown).toBe(summary.totalUsers);
    const counts = countries.map(c => c.userCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
    expect(countries.reduce((a, c) => a + c.userCount, 0)).toBe(7);
  });
});
