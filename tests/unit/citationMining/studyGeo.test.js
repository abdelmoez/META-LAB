/**
 * studyGeo.test.js — P15 Bibliomine. Free-text country → ISO alpha-2 aggregation
 * via the shared truncation-safe normalizer, with an explicit unmapped bucket and
 * deterministic counts/sorting.
 */
import { describe, it, expect } from 'vitest';
import { aggregateStudyGeography } from '../../../src/research-engine/citationMining/studyGeo.js';

describe('aggregateStudyGeography', () => {
  const studies = [
    { id: 's1', country: 'United States' },
    { id: 's2', country: 'USA' },        // alias → US (same code as s1)
    { id: 's3', country: 'US' },         // alpha-2 → US
    { id: 's4', country: 'South Korea' },
    { id: 's5', country: 'Germany' },
    { id: 's6', country: 'Freedonia' },  // unmappable free text
    { id: 's7', country: 'Korea' },      // ambiguous → unmapped (honest, not guessed)
    { id: 's8', country: '' },           // blank → excluded from the denominator
  ];

  const res = aggregateStudyGeography(studies);

  it('maps aliases and names to one ISO code and counts them together', () => {
    const us = res.byCountry.find((c) => c.code === 'US');
    expect(us).toBeTruthy();
    expect(us.count).toBe(3);
    expect(us.name).toBe('United States');
    expect(us.studyIds).toEqual(['s1', 's2', 's3']);
  });

  it('sorts byCountry by count desc (US first)', () => {
    expect(res.byCountry[0].code).toBe('US');
  });

  it('routes unmappable free text to the unmapped bucket', () => {
    const labels = res.unmapped.map((u) => u.country).sort();
    expect(labels).toEqual(['Freedonia', 'Korea']);
  });

  it('computes total (non-blank countries) and mappedTotal', () => {
    expect(res.total).toBe(7);       // s8 blank excluded
    expect(res.mappedTotal).toBe(5); // US×3, KR, DE
  });

  it('uses the array index as a fallback id', () => {
    const r = aggregateStudyGeography([{ country: 'France' }]);
    expect(r.byCountry[0].studyIds).toEqual(['0']);
  });

  it('handles empty / non-array input', () => {
    expect(aggregateStudyGeography([])).toEqual({ byCountry: [], unmapped: [], total: 0, mappedTotal: 0 });
    expect(aggregateStudyGeography(null).total).toBe(0);
  });
});
