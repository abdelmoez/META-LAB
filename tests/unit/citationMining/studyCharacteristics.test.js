/**
 * studyCharacteristics.test.js — P15 Bibliomine. Year & sample-size numeric bins,
 * categorical counts (study type / design / region / rob), and missing→Unknown
 * handling, mirroring the manuscript tables.js field getters.
 */
import { describe, it, expect } from 'vitest';
import { buildCharacteristicHistograms } from '../../../src/research-engine/citationMining/studyCharacteristics.js';

const studies = [
  { id: 'a', year: '2001', n: '30', design: 'Randomized controlled trial', country: 'United States' },
  { id: 'b', year: '2003', n: '80', design: 'RCT', country: 'USA' },
  { id: 'c', year: '2007', nExp: '150', nCtrl: '150', design: 'Prospective cohort', country: 'South Korea' },
  { id: 'd', year: '', total: '600', design: 'Case-control study', country: 'Freedonia' },
  { id: 'e', year: '2008', design: '', country: '' }, // no design, no sample size, no country
];

describe('buildCharacteristicHistograms — year bins', () => {
  const { year } = buildCharacteristicHistograms(studies);

  it('buckets into aligned 5-year bins with an Unknown bucket last', () => {
    const byLabel = Object.fromEntries(year.map((y) => [y.label, y.count]));
    expect(byLabel['2000–2004']).toBe(2); // 2001, 2003
    expect(byLabel['2005–2009']).toBe(2); // 2007, 2008
    expect(byLabel['Unknown']).toBe(1);   // d has no year
    expect(year[year.length - 1].label).toBe('Unknown');
    expect(year[year.length - 1].bucket).toBeNull();
  });

  it('respects a custom bin width', () => {
    const { year: y10 } = buildCharacteristicHistograms(studies, { yearBinWidth: 10 });
    const byLabel = Object.fromEntries(y10.map((y) => [y.label, y.count]));
    expect(byLabel['2000–2009']).toBe(4);
  });
});

describe('buildCharacteristicHistograms — sample-size bins', () => {
  const { sampleSize } = buildCharacteristicHistograms(studies);
  const byLabel = Object.fromEntries(sampleSize.map((b) => [b.label, b.count]));

  it('bins n, nExp+nCtrl and total; missing → Not reported', () => {
    expect(byLabel['<50']).toBe(1);       // a: 30
    expect(byLabel['50–99']).toBe(1);     // b: 80
    expect(byLabel['250–499']).toBe(1);   // c: 150+150 = 300
    expect(byLabel['500–999']).toBe(1);   // d: total 600
    expect(byLabel['Not reported']).toBe(1); // e: none
  });
});

describe('buildCharacteristicHistograms — categorical charts', () => {
  const { studyType, design, region, rob } = buildCharacteristicHistograms(studies, {
    robByStudyId: { a: 'Low', b: 'Low', c: 'Some concerns' },
  });

  it('classifies coarse study type from the design text', () => {
    const byLabel = Object.fromEntries(studyType.map((s) => [s.label, s.count]));
    expect(byLabel['Randomized trial']).toBe(2); // "Randomized controlled trial" + "RCT"
    expect(byLabel['Cohort']).toBe(1);           // "Prospective cohort"
    expect(byLabel['Case-control']).toBe(1);
    expect(byLabel['Not reported']).toBe(1);     // e has no design
  });

  it('counts raw design values with blank → Not reported', () => {
    const byLabel = Object.fromEntries(design.map((d) => [d.label, d.count]));
    expect(byLabel['RCT']).toBe(1);
    expect(byLabel['Randomized controlled trial']).toBe(1);
    expect(byLabel['Not reported']).toBe(1);
  });

  it('groups region by normalized country; unmapped kept, blank → Not reported', () => {
    const byLabel = Object.fromEntries(region.map((r) => [r.label, r.count]));
    expect(byLabel['United States']).toBe(2); // United States + USA
    expect(byLabel['South Korea']).toBe(1);
    expect(byLabel['Freedonia']).toBe(1);     // unmapped free text preserved
    expect(byLabel['Not reported']).toBe(1);
  });

  it('counts risk-of-bias via robByStudyId; unassessed → Not assessed', () => {
    const byLabel = Object.fromEntries(rob.map((r) => [r.label, r.count]));
    expect(byLabel['Low']).toBe(2);
    expect(byLabel['Some concerns']).toBe(1);
    expect(byLabel['Not assessed']).toBe(2); // d, e
  });

  it('sorts categorical charts by count desc then label asc', () => {
    for (let i = 1; i < studyType.length; i++) {
      const prev = studyType[i - 1];
      const cur = studyType[i];
      expect(prev.count > cur.count || (prev.count === cur.count && prev.label <= cur.label)).toBe(true);
    }
  });
});

describe('buildCharacteristicHistograms — empty input', () => {
  it('returns empty charts without throwing', () => {
    const h = buildCharacteristicHistograms([]);
    expect(h.studyType).toEqual([]);
    expect(h.year).toEqual([]);
    expect(h.sampleSize).toEqual([]);
    expect(h.region).toEqual([]);
    expect(h.design).toEqual([]);
    expect(h.rob).toEqual([]);
  });
});
