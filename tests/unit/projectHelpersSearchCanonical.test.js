/**
 * projectHelpersSearchCanonical.test.js — 96.md M2 (Project Overview truth).
 *
 * The new Terms & Vocabulary workflow persists its strategy to the 'search'
 * WorkflowModuleState and NEVER writes the legacy blob fields (search.dbs /
 * search.string), so the blob-graded readiness/audit/step heuristics painted
 * permanent red Search items on projects the canonical model (`_progress`,
 * computeProjectProgress) reports as done — two contradicting truths on one
 * page. Rule under test: when `project._progress` reports the search step (any
 * status), the blob heuristics for Search are SILENCED in favour of that
 * status; without the annotation the legacy behaviour stays byte-identical
 * (older payloads / list rows / flag-off contexts).
 */
import { describe, it, expect } from 'vitest';
import {
  readinessCheck, auditProject, stepStatus, canonicalSearchStatus,
} from '../../src/frontend/workspace/projectHelpers.js';

/* A blob that FAILS every legacy Search heuristic (no dbs, no string) but is a
   complete new-workflow project; PICO complete so readiness isolates Search. */
const basePico = { P: 'adults', I: 'x', C: 'y', O: 'z', timeframe: '10y', question: 'q?' };
const blobOnly = { pico: basePico, search: { dbs: {}, string: '', date: '', notes: '' }, studies: [], prisma: {}, mesh: null };
const withProgress = (status) => ({
  ...blobOnly,
  _progress: {
    pct: 40,
    steps: [
      { id: 'pico', label: 'PICO & Question', num: 1, required: true, status: 'done' },
      { id: 'search', label: 'Search', num: 3, required: true, status },
    ],
    requiredDone: 1, requiredTotal: 15, nextStepId: 'search',
  },
});

describe('canonicalSearchStatus', () => {
  it('reads the search step status from _progress', () => {
    expect(canonicalSearchStatus(withProgress('done'))).toBe('done');
    expect(canonicalSearchStatus(withProgress('partial'))).toBe('partial');
    expect(canonicalSearchStatus(withProgress('empty'))).toBe('empty');
  });

  it('returns null without the annotation (legacy path stays in charge)', () => {
    expect(canonicalSearchStatus(blobOnly)).toBeNull();
    expect(canonicalSearchStatus({ ...blobOnly, _progress: { pct: 0 } })).toBeNull();
    expect(canonicalSearchStatus({ ...blobOnly, _progress: { steps: [{ id: 'pico', status: 'done' }] } })).toBeNull();
    expect(canonicalSearchStatus(null)).toBeNull();
  });
});

describe('readinessCheck — canonical progress silences the blob Search rows', () => {
  it('canonical done → NO Search rows even with an empty blob', () => {
    const r = readinessCheck(withProgress('done'));
    expect(r.missing.filter((m) => /database|search/i.test(m))).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('canonical partial/empty → ONE canonical-driven row, not the blob pair', () => {
    for (const status of ['partial', 'empty']) {
      const r = readinessCheck(withProgress(status));
      const searchRows = r.missing.filter((m) => /database|search/i.test(m));
      expect(searchRows).toEqual(['Search strategy not completed yet (build and save it in the Search stage)']);
    }
  });

  it('without _progress the legacy blob rows stay byte-identical', () => {
    const r = readinessCheck(blobOnly);
    expect(r.missing).toContain('At least 3 databases required (0 selected)');
    expect(r.missing).toContain('Search strategy not saved yet');
  });
});

describe('auditProject — canonical progress silences the blob Search advisories', () => {
  const searchItems = (p) => auditProject(p).filter((i) => i.phase === 'Search');

  it('canonical done → zero Search advisories (was up to 4 permanent ones)', () => {
    expect(searchItems(withProgress('done'))).toEqual([]);
  });

  it('canonical empty → one high canonical advisory; partial → one med', () => {
    const empty = searchItems(withProgress('empty'));
    expect(empty).toHaveLength(1);
    expect(empty[0].sev).toBe('high');
    const partial = searchItems(withProgress('partial'));
    expect(partial).toHaveLength(1);
    expect(partial[0].sev).toBe('med');
  });

  it('without _progress the four legacy advisories stay', () => {
    const items = searchItems(blobOnly);
    expect(items.map((i) => i.sev).sort()).toEqual(['high', 'low', 'low', 'med']);
    expect(items.some((i) => /Only 0 databases/.test(i.msg))).toBe(true);
    expect(items.some((i) => /No search string documented/.test(i.msg))).toBe(true);
  });
});

describe('stepStatus.search — canonical status wins; legacy rule otherwise', () => {
  it('uses the canonical status verbatim when reported', () => {
    expect(stepStatus(withProgress('done'), false).search).toBe('done');
    expect(stepStatus(withProgress('partial'), false).search).toBe('partial');
    expect(stepStatus(withProgress('empty'), false).search).toBe('empty');
  });

  it('keeps the legacy blob rule without the annotation', () => {
    expect(stepStatus(blobOnly, false).search).toBe('empty');
    const legacyDone = {
      ...blobOnly,
      search: { dbs: { PubMed: true, Embase: true, 'Cochrane CENTRAL': true }, string: 'x AND y' },
    };
    expect(stepStatus(legacyDone, false).search).toBe('done');
    const legacyPartial = { ...blobOnly, search: { dbs: { PubMed: true }, string: '' } };
    expect(stepStatus(legacyPartial, false).search).toBe('partial');
  });

  it('does not disturb sibling step statuses', () => {
    const s = stepStatus(withProgress('done'), false);
    expect(s.pico).toBe('done');
    expect(s.extraction).toBe('empty');
  });
});
