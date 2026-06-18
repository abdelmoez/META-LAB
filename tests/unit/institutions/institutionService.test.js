import { describe, it, expect } from 'vitest';
import { buildInstitutionPatch, clearInstitutionPatch } from '../../../server/services/institutionService.js';
import { mapRorOrganization } from '../../../server/services/rorClient.js';
import { mapOpenAlexInstitution } from '../../../server/services/openAlexClient.js';

describe('buildInstitutionPatch — canonical institution save (prompt35)', () => {
  it('treats a plain string as a custom institution, preserving the typed text', () => {
    const p = buildInstitutionPatch('Harvard University');
    expect(p.institutionOriginal).toBe('Harvard University');
    expect(p.institutionNormalized).toBe('harvard university');
    expect(p.institutionSource).toBe('custom');
    expect(p.institutionRorId).toBe(null);
    expect(p.institutionCanonicalName).toBe(null);
    expect(p.institutionNeedsReview).toBe(false);
  });

  it('links a ROR selection and preserves the user-typed name', () => {
    const p = buildInstitutionPatch({
      name: 'Harvard', canonicalName: 'Harvard University', rorId: 'https://ror.org/03vek6s52',
      city: 'Cambridge', countryName: 'United States', countryCode: 'US', source: 'ror',
    });
    expect(p.institutionSource).toBe('ror');
    expect(p.institutionRorId).toBe('https://ror.org/03vek6s52');
    expect(p.institutionCanonicalName).toBe('Harvard University');
    expect(p.institutionOriginal).toBe('Harvard'); // typed text preserved
    expect(p.institutionCity).toBe('Cambridge');
    expect(p.institutionCountryCode).toBe('US');
    expect(p.institutionMatchConfidence).toBe(1);
    expect(p.institutionNeedsReview).toBe(false);
  });

  it('links an explicit local pick without a ROR id', () => {
    const p = buildInstitutionPatch({ name: 'MIT', canonicalName: 'Massachusetts Institute of Technology', source: 'local', confidence: 0.97 });
    expect(p.institutionSource).toBe('local');
    expect(p.institutionRorId).toBe(null);
    expect(p.institutionCanonicalName).toBe('Massachusetts Institute of Technology');
    expect(p.institutionMatchConfidence).toBeCloseTo(0.97, 5);
  });

  it('clears all institution fields for null / empty input', () => {
    for (const v of [null, '', '   ']) {
      const p = buildInstitutionPatch(v);
      expect(p.institutionOriginal).toBe(null);
      expect(p.institutionCanonicalName).toBe(null);
      expect(p.institutionRorId).toBe(null);
      expect(p.institutionNeedsReview).toBe(false);
    }
    expect(clearInstitutionPatch().institutionSource).toBe(null);
  });
});

describe('mapRorOrganization — ROR v2 record normalization (prompt35)', () => {
  const rec = {
    id: 'https://ror.org/03vek6s52',
    names: [
      { value: 'Harvard University', types: ['ror_display', 'label'] },
      { value: 'Harvard', types: ['alias'] },
    ],
    locations: [{ geonames_details: { name: 'Cambridge', country_name: 'United States', country_code: 'US' } }],
    links: [{ type: 'website', value: 'https://www.harvard.edu' }],
  };

  it('maps display name, ror id, location, aliases, and website', () => {
    const m = mapRorOrganization(rec);
    expect(m.canonicalName).toBe('Harvard University');
    expect(m.rorId).toBe('https://ror.org/03vek6s52');
    expect(m.city).toBe('Cambridge');
    expect(m.countryName).toBe('United States');
    expect(m.countryCode).toBe('US');
    expect(m.aliases).toContain('Harvard');
    expect(m.website).toBe('https://www.harvard.edu');
    expect(m.source).toBe('ror');
  });

  it('falls back to an alias when no ror_display name is present', () => {
    const m = mapRorOrganization({ id: 'https://ror.org/x', names: [{ value: 'Some Org', types: ['alias'] }], locations: [], links: [] });
    expect(m.canonicalName).toBe('Some Org');
  });

  it('returns null for an unusable record', () => {
    expect(mapRorOrganization(null)).toBe(null);
    expect(mapRorOrganization({ names: [] })).toBe(null);
  });
});

describe('mapOpenAlexInstitution — OpenAlex record normalization (prompt35 follow-up)', () => {
  it('maps display name, ROR id, location, aliases, and website', () => {
    const m = mapOpenAlexInstitution({
      id: 'https://openalex.org/I136199984', ror: 'https://ror.org/03vek6s52',
      display_name: 'Harvard University', display_name_alternatives: ['Harvard'],
      country_code: 'US', geo: { city: 'Cambridge', country: 'United States' },
      homepage_url: 'https://www.harvard.edu',
    });
    expect(m.canonicalName).toBe('Harvard University');
    expect(m.rorId).toBe('https://ror.org/03vek6s52'); // carries ROR id → dedupes vs ROR
    expect(m.city).toBe('Cambridge');
    expect(m.countryCode).toBe('US');
    expect(m.aliases).toContain('Harvard');
    expect(m.source).toBe('openalex');
  });

  it('returns null without a display name', () => {
    expect(mapOpenAlexInstitution(null)).toBe(null);
    expect(mapOpenAlexInstitution({ ror: 'x' })).toBe(null);
  });
});
