/**
 * projectStore.roundtrip.test.js — roadmap 0.2 (hermetic, no DB).
 *
 * Proves the adapter preserves the mkProject JSON contract:
 *   rowsToProject(projectToRows(project))  deep-equals  project
 * and that identity columns are extracted for querying, order is preserved, and
 * the mapping scales to a 5,000-record project (per-record granularity, not a
 * whole-document rewrite).
 */
import { describe, it, expect } from 'vitest';
import { projectToRows, rowsToProject } from '../../../server/services/projectStore.js';
import { mkProject, mkStudy } from '../../../src/research-engine/project-model/defaults.js';
import { mkRecord } from '../../../src/research-engine/import-export/parsers.js';

function sampleProject() {
  const p = mkProject('Round-trip review');
  p.pico.P = 'adults with hypertension';
  p.pico.I = 'ACE inhibitor';
  p.records = [
    mkRecord({ title: 'Study A', doi: '10.1/aaa', pmid: '111' }),
    mkRecord({ title: 'Study B', doi: '10.1/bbb', pmid: '222' }),
    mkRecord({ title: 'Dup of A', doi: '10.1/aaa', pmid: '111' }),
  ];
  // mkRecord forces decision:"" / dupOf:null, so set screening state after creation.
  p.records[0].decision = 'include';
  p.records[1].decision = 'exclude';
  p.records[2].dupOf = p.records[0].id; // a soft-merge pointer
  p.studies = [
    { ...mkStudy(), author: 'Smith', year: '2020', esType: 'OR', es: '0.69', lo: '0.18', hi: '1.20' },
    { ...mkStudy(), author: 'Jones', year: '2021', esType: 'OR', es: '0.41', lo: '0.05', hi: '0.76' },
  ];
  return p;
}

describe('projectStore round-trip (JSON contract preserved)', () => {
  it('rowsToProject(projectToRows(p)) deep-equals p', () => {
    const p = sampleProject();
    expect(rowsToProject(projectToRows(p))).toEqual(p);
  });

  it('round-trips an empty (freshly created) project', () => {
    const p = mkProject('Empty');
    expect(rowsToProject(projectToRows(p))).toEqual(p);
  });

  it('extracts identity columns for querying (doi/pmid/decision/mergedIntoId)', () => {
    const { records, studies } = projectToRows(sampleProject());
    expect(records[0].doi).toBe('10.1/aaa');
    expect(records[0].pmid).toBe('111');
    expect(records[0].decision).toBe('include');
    expect(records[2].mergedIntoId).toBe(records[0].recordId); // dupOf -> mergedIntoId
    expect(studies[0].author).toBe('Smith');
    expect(studies[0].esType).toBe('OR');
  });

  it('preserves records[]/studies[] order via position even if rows are shuffled', () => {
    const p = sampleProject();
    const rows = projectToRows(p);
    const shuffled = {
      meta: rows.meta,
      records: [...rows.records].reverse(),
      studies: [...rows.studies].reverse(),
    };
    expect(rowsToProject(shuffled)).toEqual(p);
  });

  it('a single record edit touches only that row (per-record granularity)', () => {
    const p = sampleProject();
    const rows = projectToRows(p);
    const before = rows.records.map(r => r.data);
    // Edit one record in the document and re-map just that row.
    p.records[1].decision = 'maybe';
    const rows2 = projectToRows(p);
    expect(rows2.records[0].data).toBe(before[0]); // unchanged rows are byte-identical
    expect(rows2.records[2].data).toBe(before[2]);
    expect(rows2.records[1].data).not.toBe(before[1]); // only the edited row differs
    expect(JSON.parse(rows2.records[1].data).decision).toBe('maybe');
  });

  it('scales: 5,000 records + 1,000 studies round-trip correctly and quickly', () => {
    const p = mkProject('Large review');
    p.records = Array.from({ length: 5000 }, (_, i) =>
      mkRecord({ title: `Rec ${i}`, doi: `10.5/${i}`, pmid: String(100000 + i) }));
    p.studies = Array.from({ length: 1000 }, (_, i) =>
      ({ ...mkStudy(), author: `A${i}`, year: '2020', esType: 'SMD', es: '0.2', lo: '0.0', hi: '0.4' }));

    const t0 = performance.now();
    const rows = projectToRows(p);
    const back = rowsToProject(rows);
    const ms = performance.now() - t0;

    expect(rows.records).toHaveLength(5000);
    expect(rows.studies).toHaveLength(1000);
    expect(back).toEqual(p);
    expect(ms).toBeLessThan(2000); // generous ceiling; mapping is O(n), not a whole-doc rewrite
  });
});
