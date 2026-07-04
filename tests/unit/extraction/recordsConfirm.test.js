/**
 * recordsConfirm.test.js — RoadMap/1.md recs round. Confirming an auto/assisted
 * draft must APPEND a new per-outcome study row that inherits the source study's
 * CITATION metadata, and must NEVER overwrite or discard another outcome's data
 * (the bug the earlier baseStudyId wiring caused).
 */
import { describe, it, expect } from 'vitest';
import { confirmDraft, mkExtractionRecord } from '../../../src/research-engine/extraction/records.js';
import { mkStudy } from '../../../src/research-engine/project-model/defaults.js';

function sourceStudy() {
  return {
    ...mkStudy(),
    id: 'src1', author: 'Smith', year: '2024', title: 'A trial', doi: '10.1/x', journal: 'NEJM',
    // this row already holds a DIFFERENT outcome with real numbers
    outcome: 'All-cause mortality', esType: 'HR', es: '-0.28', lo: '-0.51', hi: '-0.06',
  };
}

const miDraft = () => mkExtractionRecord({
  author: 'Smith', year: '2024', outcome: 'Myocardial infarction', esType: 'OR',
  scope: { level: 'secondary', outcomeId: 's1', canonical: 'myocardial infarction' },
  values: { es: '0.41', lo: '0.10', hi: '0.72' },
  provenance: { method: 'auto', page: 3, excerpt: 'MI occurred less often…', at: '2026-07-03T00:00:00Z' },
});

describe('confirmDraft — citationBaseId (append + inherit, no data loss)', () => {
  it('appends a NEW row and leaves the source outcome untouched', () => {
    const src = sourceStudy();
    const draft = miDraft();
    const res = confirmDraft({ studies: [src], drafts: [draft] }, draft.id, { at: '2026-07-03T00:00:00Z', citationBaseId: 'src1' });
    expect(res.ok).toBe(true);
    expect(res.studies.length).toBe(2);
    // Source row is byte-for-byte unchanged (its mortality numbers survive).
    const srcAfter = res.studies.find((s) => s.id === 'src1');
    expect(srcAfter.outcome).toBe('All-cause mortality');
    expect(srcAfter.es).toBe('-0.28');
    // New row carries the DRAFT's outcome + values, with a fresh id.
    const added = res.studies.find((s) => s.id !== 'src1');
    expect(added.outcome).toBe('Myocardial infarction');
    expect(added.es).toBe('0.41');
    expect(added.esType).toBe('OR');
    // …and INHERITS the source citation metadata.
    expect(added.title).toBe('A trial');
    expect(added.doi).toBe('10.1/x');
    expect(added.journal).toBe('NEJM');
    expect(added.author).toBe('Smith');
    // No "kept/extracted" conflict note — nothing was overwritten.
    expect(added.notes || '').not.toMatch(/kept .* extracted/);
  });

  it('does not mutate the input arrays', () => {
    const src = sourceStudy();
    const draft = miDraft();
    const studies = [src];
    const drafts = [draft];
    confirmDraft({ studies, drafts }, draft.id, { at: 'x', citationBaseId: 'src1' });
    expect(studies.length).toBe(1);
    expect(drafts.length).toBe(1);
    expect(studies[0].es).toBe('-0.28');
  });

  it('appends a fresh row even when the citation source is missing', () => {
    const draft = miDraft();
    const res = confirmDraft({ studies: [], drafts: [draft] }, draft.id, { at: 'x', citationBaseId: 'nope' });
    expect(res.ok).toBe(true);
    expect(res.studies.length).toBe(1);
    expect(res.studies[0].es).toBe('0.41');
  });
});
