/**
 * strategyStudio-loop.test.js — P11. Deterministic, DB-free unit test of the
 * generator↔critic optimisation loop (strategyStudioService.computeOptimization).
 *
 * The loop is fully dependency-injected: generateStrategies, critiqueStrategy and the
 * REAL-count fetcher are all stubbed here so the generator↔critic refinement is
 * deterministic and never touches a live provider or the database. This is the "runs
 * even when the dev server is down" companion to the integration gate test.
 */
import { describe, it, expect, vi } from 'vitest';
import { computeOptimization, loadStoredStrategy } from '../../server/searchEngine/strategyStudioService.js';
import { getModuleState } from '../../server/services/workflowState.js';

// Only getModuleState is stubbed — everything else in the module stays real.
vi.mock('../../server/services/workflowState.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getModuleState: vi.fn(),
}));

const INITIAL = {
  strategies: [
    { database: 'pubmed', profile: 'sensitive', searchString: 'A OR B', filters: {}, blocks: [] },
    { database: 'openalex', profile: 'sensitive', searchString: 'A|B', filters: {}, blocks: [] },
  ],
  notes: 'initial generation',
};

// Deterministic counts keyed by the exact string evaluated (proves the REAL-count
// injection point is exercised per candidate per iteration).
const COUNTS = {
  'A OR B': { count: 90000, kind: 'exact' },
  'A|B': { count: 88000, kind: 'exact' },
  '(A OR B) AND C': { count: 1200, kind: 'exact' },
  '(A|B),C': { count: 1100, kind: 'exact' },
};

describe('computeOptimization — bounded generator↔critic loop', () => {
  it('runs count→critic per DB, applies one revision, then converges and records provenance', async () => {
    const seen = [];
    const countFetcher = async (db, q) => { seen.push(`${db}:${q}`); return COUNTS[q] || { count: null, kind: 'unavailable' }; };
    // Critic: if the query is the broad initial one, propose a narrowed revision;
    // once narrowed, it is satisfied (no further revision → loop converges).
    const critiqueStrategy = async ({ strategy, hitCount }) => {
      if (strategy.database === 'pubmed' && strategy.searchString === 'A OR B') {
        return { issues: [{ type: 'too_broad', severity: 'high', message: `${hitCount} hits` }], score: 0.4, suggestedEdits: ['add concept C'], revised: { searchString: '(A OR B) AND C' } };
      }
      if (strategy.database === 'openalex' && strategy.searchString === 'A|B') {
        return { issues: [{ type: 'too_broad', severity: 'high' }], score: 0.45, suggestedEdits: ['add concept C'], revised: { searchString: '(A|B),C' } };
      }
      return { issues: [], score: 0.92, suggestedEdits: [], revised: null };
    };

    const out = await computeOptimization(
      { concepts: [{ label: 'x' }], databases: ['pubmed', 'openalex'], filters: {}, options: {} },
      { generateStrategies: async () => INITIAL, critiqueStrategy, countFetcher, maxIterations: 4 },
    );

    // Two passes: iter1 (broad → revised) + iter2 (narrowed → satisfied) = 4 records.
    expect(out.iterationRecords).toHaveLength(4);
    expect(out.iterationRecords.filter((r) => r.iteration === 1)).toHaveLength(2);
    expect(out.iterationRecords.filter((r) => r.iteration === 2)).toHaveLength(2);

    // Real counts captured as provenance.
    const iter1Pubmed = out.iterationRecords.find((r) => r.iteration === 1 && r.database === 'pubmed');
    expect(iter1Pubmed.hitCount).toBe(90000);
    expect(iter1Pubmed.hitKind).toBe('exact');
    expect(iter1Pubmed.critic.issues[0].type).toBe('too_broad');
    expect(iter1Pubmed.changes).toEqual({ reason: 'initial' });

    // Iteration 2 record documents WHAT changed (from → to + edits).
    const iter2Pubmed = out.iterationRecords.find((r) => r.iteration === 2 && r.database === 'pubmed');
    expect(iter2Pubmed.searchString).toBe('(A OR B) AND C');
    expect(iter2Pubmed.hitCount).toBe(1200);
    expect(iter2Pubmed.changes.from).toBe('A OR B');
    expect(iter2Pubmed.changes.to).toBe('(A OR B) AND C');
    expect(iter2Pubmed.changes.edits).toEqual(['add concept C']);

    // Final strategies carry the revised strings.
    expect(out.finalStrategies.find((s) => s.database === 'pubmed').searchString).toBe('(A OR B) AND C');
    expect(out.finalStrategies.find((s) => s.database === 'openalex').searchString).toBe('(A|B),C');
    // The count fetcher was hit once per DB per pass (4 total).
    expect(seen).toHaveLength(4);
  });

  it('never exceeds maxIterations even if the critic always proposes a revision', async () => {
    let n = 0;
    const countFetcher = async () => ({ count: 500, kind: 'exact' });
    // Always returns a DIFFERENT revised string → the loop would run forever if unbounded.
    const critiqueStrategy = async ({ strategy }) => ({ issues: [{ type: 'x' }], score: 0.5, suggestedEdits: ['e'], revised: { searchString: `${strategy.searchString}+${(n += 1)}` } });
    const out = await computeOptimization(
      { concepts: [{ label: 'x' }], databases: ['pubmed'], filters: {}, options: {} },
      { generateStrategies: async () => ({ strategies: [{ database: 'pubmed', profile: 's', searchString: 'q' }], notes: '' }), critiqueStrategy, countFetcher, maxIterations: 3 },
    );
    // One DB × exactly maxIterations passes.
    expect(out.iterationRecords).toHaveLength(3);
    expect(Math.max(...out.iterationRecords.map((r) => r.iteration))).toBe(3);
  });

  it('stops early when the critic proposes no revision (first pass already acceptable)', async () => {
    const out = await computeOptimization(
      { concepts: [{ label: 'x' }], databases: ['pubmed'], filters: {}, options: {} },
      {
        generateStrategies: async () => ({ strategies: [{ database: 'pubmed', profile: 's', searchString: 'q' }], notes: '' }),
        critiqueStrategy: async () => ({ issues: [], score: 0.95, suggestedEdits: [], revised: null }),
        countFetcher: async () => ({ count: 800, kind: 'exact' }),
        maxIterations: 4,
      },
    );
    expect(out.iterationRecords).toHaveLength(1);
    expect(out.iterationRecords[0].iteration).toBe(1);
  });

  it('honours a wall-clock deadline (records the unfinished count as timeout)', async () => {
    const out = await computeOptimization(
      { concepts: [{ label: 'x' }], databases: ['pubmed'], filters: {}, options: {} },
      {
        generateStrategies: async () => ({ strategies: [{ database: 'pubmed', profile: 's', searchString: 'q' }], notes: '' }),
        critiqueStrategy: async () => ({ issues: [], score: 0.9, revised: null }),
        countFetcher: async () => { throw new Error('should not be called past the deadline'); },
        maxIterations: 4,
        deadlineAt: 0, // already past → count phase short-circuits to timeout
        now: () => 1,
      },
    );
    expect(out.iterationRecords[0].hitKind).toBe('timeout');
    expect(out.iterationRecords[0].hitCount).toBeNull();
  });
});

describe('loadStoredStrategy — the server choke point strips disabled terms (85.md A1)', () => {
  it('a disabled:true term never reaches generate/optimize/recall (emptied concept kept for op chaining)', async () => {
    getModuleState.mockResolvedValueOnce({ state: {
      concepts: [
        { id: 'p', label: 'Population', op: 'AND', terms: [
          { id: 't1', text: 'stroke', type: 'freetext', field: 'tiab' },
          { id: 't2', text: 'TIA', type: 'freetext', field: 'tiab', disabled: true },
        ] },
        { id: 'i', label: 'Intervention', op: 'OR', terms: [
          { id: 't3', text: 'aspirin', type: 'freetext', field: 'tiab', disabled: true },
        ] },
      ],
      filters: { dateFrom: '2020' },
      databases: ['pubmed'],
    } });
    const out = await loadStoredStrategy('p1');
    expect(out.concepts).toHaveLength(2); // emptied concept KEPT — it carries the op chain
    expect(out.concepts[0].terms.map((t) => t.text)).toEqual(['stroke']);
    expect(out.concepts[1].terms).toEqual([]);
    expect(out.filters).toEqual({ dateFrom: '2020' });
    expect(out.databases).toEqual(['pubmed']);
  });

  it('tolerates a missing module state', async () => {
    getModuleState.mockResolvedValueOnce(null);
    const out = await loadStoredStrategy('p1');
    expect(out).toEqual({ concepts: [], filters: {}, databases: [] });
  });
});
