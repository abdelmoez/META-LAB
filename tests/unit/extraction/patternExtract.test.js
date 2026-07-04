/**
 * patternExtract.test.js — deterministic regex statistics harvesting (P5+).
 * Covers: every kind (nEq, eventsTotal, meanSd, ci, ratioCI, pValue, percent,
 * followup, doi, pmid), dash/minus variants, adjusted flags, rejection rules
 * (ambiguous negative ranges, events>total, date/dose adjacency), thousands
 * commas, same-kind overlap dedupe, ordering, and empty input.
 *
 * Unicode characters are written as \uXXXX escapes so the file survives any
 * editor/encoding round-trip: ± plus-minus, – en dash, — em dash,
 * − minus sign.
 */

import { describe, it, expect } from 'vitest';
import {
  extractStats,
  matchCi,
  matchDoi,
  matchEventsTotal,
  matchRatioCi,
} from '../../../src/research-engine/extraction/patternExtract.js';

const byKind = (text, kind) => extractStats(text).filter((m) => m.kind === kind);

describe('extractStats — input handling', () => {
  it('returns [] for falsy or non-string input', () => {
    expect(extractStats('')).toEqual([]);
    expect(extractStats(null)).toEqual([]);
    expect(extractStats(undefined)).toEqual([]);
    expect(extractStats(0)).toEqual([]);
    expect(extractStats('   ')).toEqual([]);
  });

  it('anchors index/length to the literal matched span and excerpt to the sentence', () => {
    const text = 'Enrolled n = 250 total.';
    const [m] = extractStats(text);
    expect(m.kind).toBe('nEq');
    expect(text.slice(m.index, m.index + m.length)).toBe('n = 250');
    expect(m.excerpt).toBe('Enrolled n = 250 total.');
  });
});

describe('nEq', () => {
  it('extracts n = / N= with thousands commas', () => {
    const ms = byKind('We enrolled n = 123 adults. The registry held N=1,234 records.', 'nEq');
    expect(ms.length).toBe(2);
    expect(ms[0].value).toEqual({ n: 123 });
    expect(ms[1].value).toEqual({ n: 1234 });
    expect(ms[0].excerpt).toBe('We enrolled n = 123 adults.');
  });

  it('does not truncate a decimal into a bogus integer N', () => {
    expect(byKind('The rate was n = 0.5 per year.', 'nEq')).toEqual([]);
  });
});

describe('eventsTotal', () => {
  it('extracts a/b and "a of b" forms', () => {
    expect(byKind('Mortality was 12/45 in the arm.', 'eventsTotal')[0].value).toEqual({
      events: 12,
      total: 45,
    });
    expect(byKind('Death occurred in 12 of 45 patients.', 'eventsTotal')[0].value).toEqual({
      events: 12,
      total: 45,
    });
  });

  it('rejects events > total and zero totals', () => {
    expect(byKind('The ratio was 99/45 overall.', 'eventsTotal')).toEqual([]);
    expect(byKind('A score of 0/0 was recorded.', 'eventsTotal')).toEqual([]);
  });

  it('rejects date-like slash pairs', () => {
    expect(byKind('Enrollment began 05/12/2020 at three sites.', 'eventsTotal')).toEqual([]);
    expect(byKind('Recruitment opened in 12/2020 nationwide.', 'eventsTotal')).toEqual([]);
  });

  it('rejects dose/pressure pairs and %-adjacent pairs', () => {
    expect(byKind('Blood pressure was 120/80 mmHg.', 'eventsTotal')).toEqual([]);
    expect(byKind('Each tablet contained 5/325 mg.', 'eventsTotal')).toEqual([]);
    const res = extractStats('A 20/30% split was used.');
    expect(res.filter((m) => m.kind === 'eventsTotal')).toEqual([]);
    expect(res.filter((m) => m.kind === 'percent').map((m) => m.value)).toEqual([{ pct: 30 }]);
  });

  it('"45/100 patients (45%)" yields ONE eventsTotal AND ONE percent (no double count)', () => {
    const res = extractStats('Response was seen in 45/100 patients (45%).');
    const et = res.filter((m) => m.kind === 'eventsTotal');
    const pc = res.filter((m) => m.kind === 'percent');
    expect(et.length).toBe(1);
    expect(et[0].value).toEqual({ events: 45, total: 100 });
    expect(pc.length).toBe(1);
    expect(pc[0].value).toEqual({ pct: 45 });
  });
});

describe('meanSd', () => {
  it('extracts plus-minus forms (ASCII and unicode)', () => {
    expect(byKind('Mean age was 62.4 ± 10.1 years.', 'meanSd')[0].value).toEqual({
      mean: 62.4,
      sd: 10.1,
    });
    expect(byKind('The score was 12.3 +/- 4.5 overall.', 'meanSd')[0].value).toEqual({
      mean: 12.3,
      sd: 4.5,
    });
  });

  it('extracts parenthesised SD forms', () => {
    expect(byKind('The score was 12.3 (SD 4.5).', 'meanSd')[0].value).toEqual({ mean: 12.3, sd: 4.5 });
    expect(byKind('The score was 12.3 (SD: 4.5).', 'meanSd')[0].value).toEqual({ mean: 12.3, sd: 4.5 });
  });

  it('handles a negative mean with the unicode minus sign', () => {
    expect(byKind('The change was −2.1 ± 0.4 units.', 'meanSd')[0].value).toEqual({
      mean: -2.1,
      sd: 0.4,
    });
  });
});

describe('ci', () => {
  it('extracts all separator variants', () => {
    expect(byKind('Effect 2.1 (95% CI 1.2 to 3.4).', 'ci')[0].value).toEqual({ lo: 1.2, hi: 3.4, level: 95 });
    expect(byKind('Effect 2.1, 95% CI: 1.2-3.4.', 'ci')[0].value).toEqual({ lo: 1.2, hi: 3.4, level: 95 });
    expect(byKind('Effect 2.1 (95% CI, 1.2–3.4).', 'ci')[0].value).toEqual({ lo: 1.2, hi: 3.4, level: 95 });
    expect(byKind('Effect 2.1 (95% CI 1.2—3.4).', 'ci')[0].value).toEqual({ lo: 1.2, hi: 3.4, level: 95 });
    expect(byKind('the 95% confidence interval 1.2 to 3.4 was reported', 'ci')[0].value).toEqual({
      lo: 1.2,
      hi: 3.4,
      level: 95,
    });
  });

  it('handles negative bounds via "to", spaced hyphen, unicode minus, and en dash', () => {
    expect(byKind('MD 0.4 (95% CI -0.5 to 1.2).', 'ci')[0].value).toEqual({ lo: -0.5, hi: 1.2, level: 95 });
    expect(byKind('MD 0.4 (95% CI -0.5 - 1.2).', 'ci')[0].value).toEqual({ lo: -0.5, hi: 1.2, level: 95 });
    expect(byKind('MD 0.4 (95% CI −0.5–1.2).', 'ci')[0].value).toEqual({ lo: -0.5, hi: 1.2, level: 95 });
  });

  it('REJECTS the ambiguous unspaced negative hyphen range "-0.5-1.2"', () => {
    expect(byKind('MD 0.4 (95% CI -0.5-1.2).', 'ci')).toEqual([]);
  });

  it('accepts thousands commas in the bounds', () => {
    expect(byKind('Cost difference (95% CI 1,100 to 1,300 dollars).', 'ci')[0].value).toEqual({
      lo: 1100,
      hi: 1300,
      level: 95,
    });
  });
});

describe('ratioCI', () => {
  it('extracts an unadjusted HR with an en-dash CI', () => {
    const [m] = byKind('HR 0.75 (95% CI 0.60–0.94) for death.', 'ratioCI');
    expect(m.value).toEqual({ measure: 'HR', est: 0.75, lo: 0.6, hi: 0.94, adjusted: false });
  });

  it('flags adjusted via the word and via the attached "a" prefix', () => {
    const [a] = byKind('The adjusted OR: 1.32; 95% CI, 1.01 to 1.72 was reported.', 'ratioCI');
    expect(a.value).toEqual({ measure: 'OR', est: 1.32, lo: 1.01, hi: 1.72, adjusted: true });
    const [b] = byKind('We found aHR = 0.8, 95% CI 0.7-0.9 for relapse.', 'ratioCI');
    expect(b.value).toEqual({ measure: 'HR', est: 0.8, lo: 0.7, hi: 0.9, adjusted: true });
  });

  it('drops estimates outside their own CI but keeps the standalone ci match', () => {
    const res = extractStats('RR 2.5 (95% CI 0.6-0.9) was implausible.');
    expect(res.filter((m) => m.kind === 'ratioCI')).toEqual([]);
    expect(res.filter((m) => m.kind === 'ci').map((m) => m.value)).toEqual([{ lo: 0.6, hi: 0.9, level: 95 }]);
  });

  it('drops non-positive bounds (ratios live on the positive scale)', () => {
    const res = extractStats('OR 0.9 (95% CI -0.2 to 1.4) was mis-typed.');
    expect(res.filter((m) => m.kind === 'ratioCI')).toEqual([]);
    expect(res.filter((m) => m.kind === 'ci').map((m) => m.value)).toEqual([{ lo: -0.2, hi: 1.4, level: 95 }]);
  });

  it('a ratioCI phrase also yields its embedded ci match (different kinds may overlap)', () => {
    const res = extractStats('HR 0.75 (95% CI 0.60–0.94).');
    expect(res.filter((m) => m.kind === 'ratioCI').length).toBe(1);
    expect(res.filter((m) => m.kind === 'ci').length).toBe(1);
  });
});

describe('pValue', () => {
  it('extracts =, <, > and a leading-dot p', () => {
    expect(byKind('The result was p = 0.03 overall.', 'pValue')[0].value).toEqual({ p: 0.03, op: '=' });
    expect(byKind('Significance was P<0.001 for all.', 'pValue')[0].value).toEqual({ p: 0.001, op: '<' });
    expect(byKind('We found p = .04 here.', 'pValue')[0].value).toEqual({ p: 0.04, op: '=' });
    expect(byKind('It was p > 0.05 there.', 'pValue')[0].value).toEqual({ p: 0.05, op: '>' });
  });

  it('drops an impossible p > 1', () => {
    expect(byKind('A typo gave p = 1.5 somewhere.', 'pValue')).toEqual([]);
  });
});

describe('percent', () => {
  it('extracts a plain percentage', () => {
    expect(byKind('The response rate was 45.2% overall.', 'percent')[0].value).toEqual({ pct: 45.2 });
  });

  it('does NOT report a CI level ("95% CI") as a percent', () => {
    expect(byKind('Effect 2.1 (95% CI 1.2 to 3.4).', 'percent')).toEqual([]);
  });
});

describe('followup', () => {
  it('extracts "followed for N months"', () => {
    const [m] = byKind('Patients were followed for 24 months.', 'followup');
    expect(m.value.amount).toBe(24);
    expect(m.value.unit).toBe('month');
    expect(m.value.text).toContain('followed');
  });

  it('extracts "N-month follow-up" and "median follow-up of N years"', () => {
    const [a] = byKind('After a 12-month follow-up period, outcomes improved.', 'followup');
    expect(a.value.amount).toBe(12);
    expect(a.value.unit).toBe('month');
    const [b] = byKind('The median follow-up of 3 years was complete.', 'followup');
    expect(b.value.amount).toBe(3);
    expect(b.value.unit).toBe('year');
  });

  it('dedupes overlapping same-kind matches, keeping the first', () => {
    const ms = byKind('Patients were followed for 12 months follow-up.', 'followup');
    expect(ms.length).toBe(1);
    expect(ms[0].value.text).toContain('followed for 12 months');
  });
});

describe('doi + pmid', () => {
  it('extracts a DOI and strips trailing punctuation (length adjusted)', () => {
    const [m] = byKind('Available at doi:10.1001/jama.2020.12345.', 'doi');
    expect(m.value).toEqual({ doi: '10.1001/jama.2020.12345' });
    expect(m.length).toBe('10.1001/jama.2020.12345'.length);
    expect(byKind('See (10.5555/abc-123);', 'doi')[0].value).toEqual({ doi: '10.5555/abc-123' });
  });

  it('extracts PMIDs case-insensitively as string identifiers', () => {
    expect(byKind('Indexed as PMID: 12345678 today.', 'pmid')[0].value).toEqual({ pmid: '12345678' });
    expect(byKind('see pmid 9876543 for details', 'pmid')[0].value).toEqual({ pmid: '9876543' });
  });
});

describe('helper matchers are exported and usable standalone', () => {
  it('each returns Match[] on its own', () => {
    expect(matchDoi('see 10.1000/xyz;')[0].value.doi).toBe('10.1000/xyz');
    expect(matchEventsTotal('7/10 responded')[0].value).toEqual({ events: 7, total: 10 });
    expect(matchCi('95% CI 0.1 to 0.2')[0].value.level).toBe(95);
    expect(matchRatioCi('IRR 1.5 (95% CI 1.2-1.9)')[0].value.measure).toBe('IRR');
    expect(matchDoi('')).toEqual([]);
  });
});

describe('extractStats — composite abstract, ordering, and cross-kind coexistence', () => {
  const ABSTRACT =
    'We enrolled n = 1,240 adults (mean age 62.4 ± 10.1 years). ' +
    'Death occurred in 45 of 310 patients (14.5%) versus 60/310 (19.4%). ' +
    'Adjusted HR: 0.75 (95% CI 0.60–0.94; p = 0.01) over a median follow-up of 3 years. ' +
    'PMID: 12345678. doi:10.1001/jama.2020.12345.';

  it('finds every kind exactly once (twice for the two arms) in index order', () => {
    const res = extractStats(ABSTRACT);
    expect(res.map((m) => m.kind)).toEqual([
      'nEq',
      'meanSd',
      'eventsTotal',
      'percent',
      'eventsTotal',
      'percent',
      'ratioCI',
      'ci',
      'pValue',
      'followup',
      'pmid',
      'doi',
    ]);
  });

  it('is ordered by index and carries sentence excerpts', () => {
    const res = extractStats(ABSTRACT);
    for (let i = 1; i < res.length; i++) {
      expect(res[i].index).toBeGreaterThanOrEqual(res[i - 1].index);
    }
    const nEq = res.find((m) => m.kind === 'nEq');
    expect(nEq.value).toEqual({ n: 1240 });
    expect(nEq.excerpt).toBe('We enrolled n = 1,240 adults (mean age 62.4 ± 10.1 years).');
    const p = res.find((m) => m.kind === 'pValue');
    expect(p.excerpt).toContain('Adjusted HR');
  });

  it('extracts the expected values from the composite', () => {
    const res = extractStats(ABSTRACT);
    expect(res.filter((m) => m.kind === 'eventsTotal').map((m) => m.value)).toEqual([
      { events: 45, total: 310 },
      { events: 60, total: 310 },
    ]);
    expect(res.filter((m) => m.kind === 'percent').map((m) => m.value)).toEqual([
      { pct: 14.5 },
      { pct: 19.4 },
    ]);
    expect(res.find((m) => m.kind === 'ratioCI').value).toEqual({
      measure: 'HR',
      est: 0.75,
      lo: 0.6,
      hi: 0.94,
      adjusted: true,
    });
    expect(res.find((m) => m.kind === 'followup').value.amount).toBe(3);
    expect(res.find((m) => m.kind === 'pmid').value).toEqual({ pmid: '12345678' });
    expect(res.find((m) => m.kind === 'doi').value).toEqual({ doi: '10.1001/jama.2020.12345' });
  });
});
