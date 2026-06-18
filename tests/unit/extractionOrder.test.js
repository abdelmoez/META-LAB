/**
 * extractionOrder.test.js
 * Unit tests for the Data Extraction ordering helper (prompt15 Task 3).
 */

import { describe, it, expect } from 'vitest';
import {
  orderStudies,
  EXTRACTION_SORTS,
  DEFAULT_EXTRACTION_SORT,
} from '../../src/frontend/pages/extractionOrder.js';

const mk = (over) => ({ id: over.id, title: '', author: '', authors: '', year: '', addedAt: '', updatedAt: '', ...over });

// Insertion order: A, B, C, D
const studies = [
  mk({ id: 'A', title: 'Zeta trial',  author: 'Young',  year: '2019', addedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' }),
  mk({ id: 'B', title: 'Alpha study', author: 'Adams',  year: '2023', addedAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-15T00:00:00Z' }),
  mk({ id: 'C', title: 'Mu cohort',   author: 'Miller', year: '2021', addedAt: '2026-01-03T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' }),
  mk({ id: 'D', title: 'Beta RCT',    author: 'Brown',  year: '',     addedAt: '2026-01-04T00:00:00Z', updatedAt: '' }),
];

const ids = arr => arr.map(s => s.id);

describe('catalogue', () => {
  it('exposes the required sort options', () => {
    const keys = EXTRACTION_SORTS.map(s => s.key);
    // prompt32 Task 9 — 'outcome_az' groups the extraction list by outcome name.
    expect(keys).toEqual(['manual', 'outcome_az', 'title_az', 'year_asc', 'year_desc', 'author_az', 'recent_added', 'recent_modified']);
    expect(DEFAULT_EXTRACTION_SORT).toBe('manual');
  });
  it('outcome_az groups by outcome name then timepoint (prompt32 Task 9)', () => {
    const rows = [
      { id: 'A', outcome: 'Mortality', timepoint: '12m' },
      { id: 'B', outcome: 'Adverse events', timepoint: '' },
      { id: 'C', outcome: 'Mortality', timepoint: '6m' },
      { id: 'D', outcome: 'adverse events', timepoint: '' }, // case-insensitive groups with B
    ];
    // "adverse events" (B,D by insertion) before "mortality"; within mortality the
    // timepoint string-sorts "12m" < "6m" → A before C.
    expect(orderStudies(rows, 'outcome_az').map(s => s.id)).toEqual(['B', 'D', 'A', 'C']);
  });
});

describe('orderStudies', () => {
  it('manual returns the array in its existing order', () => {
    expect(ids(orderStudies(studies, 'manual'))).toEqual(['A', 'B', 'C', 'D']);
    expect(ids(orderStudies(studies))).toEqual(['A', 'B', 'C', 'D']); // default
  });

  it('never mutates the input array', () => {
    const before = ids(studies);
    orderStudies(studies, 'title_az');
    orderStudies(studies, 'year_desc');
    expect(ids(studies)).toEqual(before);
  });

  it('title A–Z', () => {
    expect(ids(orderStudies(studies, 'title_az'))).toEqual(['B', 'D', 'C', 'A']); // Alpha, Beta, Mu, Zeta
  });

  it('author A–Z', () => {
    expect(ids(orderStudies(studies, 'author_az'))).toEqual(['B', 'D', 'C', 'A']); // Adams, Brown, Miller, Young
  });

  it('year ascending (missing year sorts to the end)', () => {
    expect(ids(orderStudies(studies, 'year_asc'))).toEqual(['A', 'C', 'B', 'D']); // 2019, 2021, 2023, (none)
  });

  it('year descending (missing year sorts to the end)', () => {
    expect(ids(orderStudies(studies, 'year_desc'))).toEqual(['B', 'C', 'A', 'D']); // 2023, 2021, 2019, (none)
  });

  it('recently added (newest insertion first when no addedAt)', () => {
    const noTs = studies.map(s => ({ ...s, addedAt: '' }));
    expect(ids(orderStudies(noTs, 'recent_added'))).toEqual(['D', 'C', 'B', 'A']);
  });

  it('recently added uses addedAt when present', () => {
    expect(ids(orderStudies(studies, 'recent_added'))).toEqual(['D', 'C', 'B', 'A']);
  });

  it('recently modified uses updatedAt desc, missing falls back', () => {
    // updatedAt: A=Feb, B=Jan15, C=Mar, D=none → C, A, B, then D (no ts → after dated)
    expect(ids(orderStudies(studies, 'recent_modified'))).toEqual(['C', 'A', 'B', 'D']);
  });

  it('is robust to empty / non-array input', () => {
    expect(orderStudies([], 'title_az')).toEqual([]);
    expect(orderStudies(undefined, 'year_asc')).toEqual([]);
    expect(orderStudies(null)).toEqual([]);
  });

  it('unknown sort key returns a copy in original order', () => {
    expect(ids(orderStudies(studies, 'bogus'))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('preserves study identity (same object references, ids intact)', () => {
    const out = orderStudies(studies, 'title_az');
    expect(out).toHaveLength(studies.length);
    expect(new Set(out.map(s => s.id))).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(out.every(s => studies.includes(s))).toBe(true);
  });
});
