/**
 * SSR-render tests for the Screening "Search Import History" timeline
 * (src/frontend/screening/components/ImportHistory.jsx — 96.md 5B/5C, plan D12).
 *
 * Repo component-test style: renderToStaticMarkup, no jsdom. Effects (the
 * history fetch) never run under static render, so the stateful default export
 * is only smoke-tested in its loading state; the exported PURE pieces —
 * normalizeHistory / runCountsLine / RunEntry / BatchEntry / ResetHistoryAction —
 * are asserted against the EXACT /import-history server contract (H1: this
 * fixture pins the frontend↔server seam):
 *
 *   { entries, canDelete, canReset, projectName?, total, hasMore, limit, offset }
 *   run entry: { kind:'search-run', runId, name, state, origin, rolledBackAt,
 *     initiatedByName, createdAt, canonicalText (≤500, canonicalTextTruncated
 *     when cut), counts:{ found, imported, existingMatched, updated,
 *     duplicatesSkipped, ambiguous, failed },
 *     perSource:{ [provider]: { raw, imported, existingMatched, updated,
 *       exactDup, fuzzyDup, ambiguousDup, failed, state, errorDetail? } },
 *     batches:[batch rows] }
 *   batch entry: { kind:'batch', …listImportBatches row, searchRunId, updatedCount }
 *
 * The legacy /import-batches fallback shape keeps its own suite (that endpoint
 * still exists and the panel soft-fails to it on 404).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ImportHistory, {
  normalizeHistory, runCountsLine, RunEntry, BatchEntry, ResetHistoryAction,
} from '../../src/frontend/screening/components/ImportHistory.jsx';

const render = (el, props) => renderToStaticMarkup(createElement(el, props));

/* A grouped /import-history payload EXACTLY per the 96.md server contract:
   a completed run, a rolled-back living-review run with a failed source, and
   one file batch. */
const groupedPayload = {
  canDelete: true,
  canReset: true,
  projectName: 'My SR Project',
  total: 3,
  hasMore: false,
  limit: 50,
  offset: 0,
  entries: [
    {
      kind: 'search-run',
      runId: 'run-1',
      name: 'Primary search',
      state: 'completed',
      origin: 'manual',
      rolledBackAt: null,
      initiatedByName: 'Alice',
      createdAt: '2026-07-30T20:42:00Z',
      canonicalText: '("heart failure"[tiab]) AND (dapagliflozin[tiab])',
      canonicalTextTruncated: false,
      counts: { found: 312, imported: 224, existingMatched: 76, updated: 3, duplicatesSkipped: 12, ambiguous: 1, failed: 0 },
      perSource: {
        pubmed: { raw: 200, imported: 150, existingMatched: 40, updated: 2, exactDup: 5, fuzzyDup: 3, ambiguousDup: 1, failed: 0, state: 'completed' },
        europepmc: { raw: 112, imported: 74, existingMatched: 36, updated: 1, exactDup: 2, fuzzyDup: 2, ambiguousDup: 0, failed: 0, state: 'completed' },
      },
      batches: [{ kind: 'batch', id: 'b-1', filename: 'pubmed search', source: 'pecan-search', searchRunId: 'run-1', recordCount: 150, remainingCount: 150, updatedCount: 2, createdAt: '2026-07-30T20:45:00Z' }],
    },
    {
      kind: 'search-run',
      runId: 'run-2',
      name: 'Weekly living update',
      state: 'failed',
      origin: 'living',
      rolledBackAt: '2026-08-01T10:00:00Z',
      initiatedByName: '',
      createdAt: '2026-07-31T09:00:00Z',
      canonicalText: 'x'.repeat(500),
      canonicalTextTruncated: true,
      errorSummary: 'Provider outage',
      counts: { found: 50, imported: 10, existingMatched: 5, updated: 0, duplicatesSkipped: 3, ambiguous: 0, failed: 3 },
      perSource: {
        crossref: { raw: 50, imported: 10, existingMatched: 5, updated: 0, exactDup: 1, fuzzyDup: 2, ambiguousDup: 0, failed: 3, state: 'failed', errorDetail: 'timeout after 3 retries' },
      },
      batches: [],
    },
    {
      kind: 'batch',
      id: 'b-2', filename: 'refs.ris', source: 'file', format: 'ris', searchRunId: '',
      recordCount: 90, preDedupCount: 100, duplicateCount: 10, rejectedCount: 2, updatedCount: 0,
      remainingCount: 88, importedByName: 'Bob', createdAt: '2026-07-01T08:00:00Z',
    },
  ],
};

describe('normalizeHistory — the /import-history contract (H1 seam pin)', () => {
  const norm = normalizeHistory(groupedPayload);

  it('classifies entries and carries the capability flags + project name', () => {
    expect(norm.entries.map((e) => e.kind)).toEqual(['run', 'run', 'batch']);
    expect(norm.canDelete).toBe(true);
    expect(norm.canReset).toBe(true);
    expect(norm.projectName).toBe('My SR Project');
  });

  it('carries the pagination fields (total / hasMore / limit / offset)', () => {
    expect(norm.total).toBe(3);
    expect(norm.hasMore).toBe(false);
    expect(norm.limit).toBe(50);
    expect(norm.offset).toBe(0);
  });

  it('sorts the timeline newest-first', () => {
    expect(norm.entries.map((e) => e.runId || e.id)).toEqual(['run-2', 'run-1', 'b-2']);
  });

  it('maps counts.found + the contract count names to the display model', () => {
    const r1 = norm.entries.find((e) => e.runId === 'run-1');
    expect(r1.counts).toEqual({
      retrieved: 312, added: 224, alreadyPresent: 76, updated: 3, duplicatesSkipped: 12, failed: 0,
    });
  });

  it('reads perSource (object keyed by provider) as the per-source table source', () => {
    const r1 = norm.entries.find((e) => e.runId === 'run-1');
    expect(r1.sources).toHaveLength(2);
    const pm = r1.sources.find((s) => s.provider === 'pubmed');
    expect(pm).toEqual({
      provider: 'pubmed', state: 'completed',
      retrieved: 200, added: 150, alreadyPresent: 40, updated: 2,
      duplicatesSkipped: 8, // exactDup 5 + fuzzyDup 3
      failed: 0, error: '',
    });
  });

  it('derives the header database list from the perSource keys', () => {
    const r1 = norm.entries.find((e) => e.runId === 'run-1');
    expect(r1.databases).toEqual(['pubmed', 'europepmc']);
  });

  it('carries origin, rolledBackAt, canonicalTextTruncated and per-source errorDetail', () => {
    const r2 = norm.entries.find((e) => e.runId === 'run-2');
    expect(r2.origin).toBe('living');
    expect(r2.rolledBack).toBe(true);
    expect(r2.rolledBackAt).toBe('2026-08-01T10:00:00Z');
    expect(r2.canonicalTextTruncated).toBe(true);
    expect(r2.sources[0].error).toBe('timeout after 3 retries');
    expect(r2.sources[0].failed).toBe(3);
  });

  it('groups batch rows under their run (searchRunId) with updatedCount', () => {
    const r1 = norm.entries.find((e) => e.runId === 'run-1');
    expect(r1.batches).toHaveLength(1);
    expect(r1.batches[0].id).toBe('b-1');
    expect(r1.batches[0].updatedCount).toBe(2);
  });
});

describe('normalizeHistory — legacy /import-batches fallback', () => {
  it('turns the batch-only shape into batch entries with canReset/hasMore off', () => {
    const norm = normalizeHistory({
      canDelete: true,
      batches: [
        { id: 'x1', filename: 'a.ris', source: 'file', recordCount: 5, remainingCount: 5, createdAt: '2026-01-02T00:00:00Z' },
        { id: 'x2', filename: 'pubmed search', source: 'pecan-search', recordCount: 9, remainingCount: 9, createdAt: '2026-01-03T00:00:00Z' },
      ],
    });
    expect(norm.entries.map((e) => e.kind)).toEqual(['batch', 'batch']);
    expect(norm.entries.map((e) => e.id)).toEqual(['x2', 'x1']); // newest first
    expect(norm.canReset).toBe(false);
    expect(norm.hasMore).toBe(false);
    expect(norm.total).toBe(2); // falls back to the entry count
    expect(norm.projectName).toBe('');
  });

  it('tolerates an empty/absent payload', () => {
    expect(normalizeHistory(null).entries).toEqual([]);
    expect(normalizeHistory({}).canDelete).toBe(false);
    expect(normalizeHistory({}).hasMore).toBe(false);
  });
});

describe('runCountsLine — the spec 5B summary sentence', () => {
  it('includes the updated segment when the server reports it', () => {
    expect(runCountsLine({ retrieved: 312, added: 224, alreadyPresent: 76, updated: 3, duplicatesSkipped: 12, failed: 0 }))
      .toBe('312 retrieved · 224 new · 76 already present · 3 updated · 12 duplicates skipped · 0 failed');
  });

  it('omits the updated segment when the count is unknown (null)', () => {
    expect(runCountsLine({ retrieved: 50, added: 10, alreadyPresent: 5, updated: null, duplicatesSkipped: 3, failed: 3 }))
      .toBe('50 retrieved · 10 new · 5 already present · 3 duplicates skipped · 3 failed');
  });
});

describe('RunEntry — collapsed row', () => {
  const norm = normalizeHistory(groupedPayload);
  const r1 = norm.entries.find((e) => e.runId === 'run-1');
  const html = render(RunEntry, { entry: r1, canDelete: true, expanded: false, onToggle() {}, onDeleteBatch() {} });

  it('shows name, databases, user, date/time, state badge and the counts line', () => {
    expect(html).toContain('Primary search');
    expect(html).toContain('PubMed');
    expect(html).toContain('Europe PMC');
    expect(html).toContain('by Alice');
    expect(html).toContain('2026'); // date/time rendered (exact string is TZ-dependent)
    expect(html).toContain('Completed');
    expect(html).toContain('Search run');
    expect(html).toContain('312 retrieved · 224 new · 76 already present · 3 updated · 12 duplicates skipped · 0 failed');
  });

  it('is progressive-disclosure: query and per-source table stay hidden until expanded', () => {
    expect(html).not.toContain('dapagliflozin');
    expect(html).not.toContain('Search query');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>Details<');
  });

  it('does not show the rolled-back / living badges for a user-launched live run', () => {
    expect(html).not.toContain('Rolled back');
    expect(html).not.toContain('Living review');
  });
});

describe('RunEntry — expanded details', () => {
  const norm = normalizeHistory(groupedPayload);
  const r1 = norm.entries.find((e) => e.runId === 'run-1');
  const html = render(RunEntry, { entry: r1, canDelete: true, expanded: true, onToggle() {}, onDeleteBatch() {} });

  it('shows the per-source breakdown table fed from perSource', () => {
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Hide details');
    expect(html).toContain('Already present');
    expect(html).toContain('Updated');
    expect(html).toContain('150'); // pubmed imported
    expect(html).toContain('112'); // europepmc raw
    expect(html).toContain('>8<'); // pubmed exactDup 5 + fuzzyDup 3
  });

  it('shows the exact query text, monospace, inside a collapsed <details>', () => {
    expect(html).toContain('<details');
    expect(html).toContain('Search query');
    expect(html).toContain('dapagliflozin[tiab]');
    expect(html).toMatch(/<pre[^>]*>/);
    // Not truncated → no shortened-query note.
    expect(html).not.toContain('Query shortened for display');
  });

  it('lists the underlying batches with a delete affordance for owners', () => {
    expect(html).toContain('pubmed search');
    expect(html).toContain('Delete');
  });
});

describe('RunEntry — rolled-back / failed living-review run', () => {
  const norm = normalizeHistory(groupedPayload);
  const r2 = norm.entries.find((e) => e.runId === 'run-2');

  it('carries the rolled-back + living-review badges on the collapsed row', () => {
    const html = render(RunEntry, { entry: r2, canDelete: false, expanded: false, onToggle() {} });
    expect(html).toContain('Rolled back');
    expect(html).toContain('Living review');
    expect(html).toContain('Failed');
  });

  it('explains the rollback, surfaces error details and the truncated-query note when expanded', () => {
    const html = render(RunEntry, { entry: r2, canDelete: false, expanded: true, onToggle() {} });
    expect(html).toContain('deleted by a project reset');
    expect(html).toContain('Provider outage');
    expect(html).toContain('timeout after 3 retries');
    expect(html).toContain('Crossref');
    // M21 — canonicalTextTruncated → an honest "shortened" note + ellipsis.
    expect(html).toContain('Query shortened for display');
  });
});

describe('BatchEntry — file/API batch row (pre-96.md behaviour preserved)', () => {
  const norm = normalizeHistory(groupedPayload);
  const b2 = norm.entries.find((e) => e.id === 'b-2');

  it('renders the existing stats + delete button for owners', () => {
    const html = render(BatchEntry, { batch: b2, canDelete: true, onDelete() {}, onToggleIssues() {} });
    expect(html).toContain('refs.ris');
    expect(html).toContain('File upload');
    expect(html).toContain('Identified');
    expect(html).toContain('100'); // preDedupCount
    expect(html).toContain('Remaining');
    expect(html).toContain('Delete');
    expect(html).toContain('View issues'); // rejectedCount > 0
  });

  it('hides the delete button without canDelete', () => {
    const html = render(BatchEntry, { batch: b2, canDelete: false, onToggleIssues() {} });
    expect(html).not.toContain('>Delete<');
  });
});

describe('ResetHistoryAction — 96.md 6E (L16: disabled with explanation, never hidden)', () => {
  it('renders an enabled danger action for owners/admins (canReset)', () => {
    const html = render(ResetHistoryAction, { canReset: true, onOpen() {} });
    expect(html).toContain('Delete All Imported Search Records');
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain('Only the project owner or a site admin');
  });

  it('renders DISABLED with an access explanation for members without permission', () => {
    const html = render(ResetHistoryAction, { canReset: false, onOpen() {} });
    expect(html).toContain('Delete All Imported Search Records');
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('Only the project owner or a site admin can delete imported records');
  });
});

describe('ImportHistory container — SSR smoke', () => {
  it('renders the Search Import History loading state (effects never run in SSR)', () => {
    const html = render(ImportHistory, { pid: 'p1', projectName: 'My SR Project' });
    expect(html).toContain('Search Import History');
    expect(html).toContain('Loading import history…');
  });
});
