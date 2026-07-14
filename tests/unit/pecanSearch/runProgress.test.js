/**
 * Unit tests for the pure Pecan run progress model (research-engine/search/runProgress.js).
 * No DB, no network — exercises the honest-percentage rules, step narrative, activity
 * text, indeterminate degradation, estimate down-weighting, and the monotonic clamp.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRunProgress, nextProgressPercent, expectedTotalFor, providerLabel,
  TERMINAL_RUN_STATES, EXACT_TOTAL_PROVIDERS, ESTIMATE_TOTAL_PROVIDERS,
} from '../../../src/research-engine/search/runProgress.js';

/** Build a source row with sensible defaults. */
function src(o = {}) {
  return {
    id: o.id || o.provider || 'sid', provider: o.provider || 'pubmed',
    state: o.state || 'pending', stage: o.stage || 'queued',
    rawCount: o.rawCount || 0, normalizedCount: o.normalizedCount || 0, importedCount: o.importedCount || 0,
    existingMatchCount: o.existingMatchCount || 0, exactDupCount: o.exactDupCount || 0,
    fuzzyDupCount: o.fuzzyDupCount || 0, ambiguousDupCount: o.ambiguousDupCount || 0,
    failedRecordCount: o.failedRecordCount || 0, cap: o.cap || 0, capReached: !!o.capReached,
    previewCount: o.previewCount == null ? null : o.previewCount, previewKind: o.previewKind || '',
    retryCount: o.retryCount || 0, errorClass: o.errorClass || '', errorDetail: o.errorDetail || '',
  };
}
/** Build a run summary (shapeRun shape) with aggregate counts derived where omitted. */
function run(o = {}) {
  const sources = o.sources || [];
  const counts = o.counts || aggregate(sources);
  return { id: 'run1', name: 'Test', state: o.state || 'queued', sources, counts, ...o.extra };
}
function aggregate(sources) {
  const c = { rawRetrieved: 0, normalized: 0, imported: 0, existingMatched: 0, exactDup: 0, fuzzyDup: 0, ambiguousDup: 0, failedRecords: 0, sourcesCompleted: 0, sourcesFailed: 0, sourcesPartial: 0 };
  for (const s of sources) {
    c.rawRetrieved += s.rawCount || 0; c.imported += s.importedCount || 0;
    c.existingMatched += s.existingMatchCount || 0; c.exactDup += s.exactDupCount || 0;
    c.fuzzyDup += s.fuzzyDupCount || 0; c.ambiguousDup += s.ambiguousDupCount || 0;
    c.failedRecords += s.failedRecordCount || 0;
    if (s.state === 'completed') c.sourcesCompleted += 1;
    else if (s.state === 'failed') c.sourcesFailed += 1;
    else if (s.state === 'partial') c.sourcesPartial += 1;
  }
  return c;
}

describe('provider trust tables', () => {
  it('classifies providers as exact / estimate', () => {
    expect(EXACT_TOTAL_PROVIDERS.has('pubmed')).toBe(true);
    expect(EXACT_TOTAL_PROVIDERS.has('europepmc')).toBe(true);
    expect(EXACT_TOTAL_PROVIDERS.has('openalex')).toBe(true);
    expect(ESTIMATE_TOTAL_PROVIDERS.has('crossref')).toBe(true);
    expect(ESTIMATE_TOTAL_PROVIDERS.has('semanticscholar')).toBe(true);
  });
  it('labels providers for humans', () => {
    expect(providerLabel('pubmed')).toBe('PubMed');
    expect(providerLabel('semanticscholar')).toBe('Semantic Scholar');
    expect(providerLabel('unknownxyz')).toBe('unknownxyz');
  });
});

describe('expectedTotalFor', () => {
  it('is null with no previewCount', () => {
    expect(expectedTotalFor(src({ provider: 'pubmed', previewCount: null }))).toBeNull();
  });
  it('uses min(previewCount, cap) for an exact provider', () => {
    expect(expectedTotalFor(src({ provider: 'pubmed', previewCount: 500, cap: 2000 }))).toEqual({ total: 500, trust: 'exact' });
    expect(expectedTotalFor(src({ provider: 'pubmed', previewCount: 5000, cap: 2000 }))).toEqual({ total: 2000, trust: 'exact' });
  });
  it('flags estimate providers', () => {
    expect(expectedTotalFor(src({ provider: 'crossref', previewCount: 900 })).trust).toBe('estimate');
  });
});

describe('computeRunProgress — honest percentage', () => {
  it('queued run with no sources is indeterminate with a small floor', () => {
    const m = computeRunProgress(run({ state: 'queued', sources: [] }));
    expect(m.indeterminate).toBe(true);
    expect(m.percent).toBeGreaterThan(0);
    expect(m.percent).toBeLessThan(10);
    expect(m.terminal).toBe(false);
  });

  it('running with no records and no totals degrades to indeterminate (no fabricated number)', () => {
    const m = computeRunProgress(run({
      state: 'running',
      sources: [src({ provider: 'pubmed', state: 'pending', stage: 'queued', previewCount: null })],
    }));
    expect(m.indeterminate).toBe(true);
  });

  it('backbone: 2 of 4 sources completed ⇒ at least 50%', () => {
    const m = computeRunProgress(run({
      state: 'running',
      sources: [
        src({ provider: 'pubmed', state: 'completed' }),
        src({ provider: 'europepmc', state: 'completed' }),
        src({ provider: 'crossref', state: 'running', stage: 'fetching' }),
        src({ provider: 'openalex', state: 'pending' }),
      ],
    }));
    expect(m.percent).toBeGreaterThanOrEqual(50);
    expect(m.percent).toBeLessThanOrEqual(99);
    expect(m.indeterminate).toBe(false);
  });

  it('refines the in-flight source by rawRetrieved/expected for an exact provider', () => {
    // 1 of 2 done (=50%), the other exact source half-fetched (250/500 of its 1/2 slice).
    const m = computeRunProgress(run({
      state: 'running',
      sources: [
        src({ provider: 'pubmed', state: 'completed' }),
        src({ provider: 'europepmc', state: 'running', stage: 'fetching', rawCount: 250, previewCount: 500, cap: 2000 }),
      ],
    }));
    // 0.5 + (0.5 * 0.5) = 0.75
    expect(m.percent).toBe(75);
  });

  it('caps an in-flight exact source below its full slice until it terminalises', () => {
    // Single source, rawCount == expected → should NOT claim 100 while running.
    const m = computeRunProgress(run({
      state: 'running',
      sources: [src({ provider: 'pubmed', state: 'running', stage: 'importing', rawCount: 500, previewCount: 500, cap: 2000 })],
    }));
    expect(m.percent).toBeLessThanOrEqual(95);
    expect(m.percent).toBeGreaterThanOrEqual(90);
  });

  it('down-weights an estimate provider vs an exact one at the same ratio', () => {
    const exact = computeRunProgress(run({ state: 'running', sources: [src({ provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 400, previewCount: 500, cap: 1000 })] }));
    const est = computeRunProgress(run({ state: 'running', sources: [src({ provider: 'crossref', state: 'running', stage: 'fetching', rawCount: 400, previewCount: 500, cap: 1000 })] }));
    // Same 0.8 ratio, but estimate is capped at 0.8 and exact at 0.95 → exact ≥ estimate.
    expect(exact.percent).toBeGreaterThanOrEqual(est.percent);
    expect(est.percent).toBeLessThanOrEqual(80);
  });

  it('uses a bounded stage credit when the total is unknown but records exist', () => {
    const fetching = computeRunProgress(run({ state: 'running', sources: [src({ provider: 'semanticscholar', state: 'running', stage: 'fetching', rawCount: 10, previewCount: null })] }));
    const importing = computeRunProgress(run({ state: 'running', sources: [src({ provider: 'semanticscholar', state: 'running', stage: 'importing', rawCount: 10, previewCount: null })] }));
    expect(importing.percent).toBeGreaterThan(fetching.percent);
    expect(importing.percent).toBeLessThan(99);
  });

  it('does NOT fabricate progress for a running source with no total and zero records', () => {
    // A source can sit in fetching/importing with 0 rows committed — later stages must
    // not claim a solid 20%/82% for nothing (honesty fix). Capped to a tiny nudge.
    const fetching = computeRunProgress(run({ state: 'running', sources: [src({ provider: 'semanticscholar', state: 'running', stage: 'fetching', rawCount: 0, previewCount: null })] }));
    const importing = computeRunProgress(run({ state: 'running', sources: [src({ provider: 'semanticscholar', state: 'running', stage: 'importing', rawCount: 0, previewCount: null })] }));
    expect(fetching.percent).toBeLessThanOrEqual(5);
    expect(importing.percent).toBeLessThanOrEqual(5);
  });

  it('never reaches 100 while non-terminal', () => {
    const m = computeRunProgress(run({
      state: 'running',
      sources: [
        src({ provider: 'pubmed', state: 'completed' }),
        src({ provider: 'europepmc', state: 'running', stage: 'importing', rawCount: 999999, previewCount: 100, cap: 100 }),
      ],
    }));
    expect(m.percent).toBeLessThanOrEqual(99);
  });

  it('snaps to 100 on every terminal state', () => {
    for (const state of ['completed', 'partial', 'failed', 'cancelled']) {
      const m = computeRunProgress(run({ state, sources: [src({ provider: 'pubmed', state: state === 'failed' ? 'failed' : 'completed' })] }));
      expect(m.percent).toBe(100);
      expect(m.terminal).toBe(true);
    }
  });
});

describe('computeRunProgress — steps + activity + phase', () => {
  it('queued: prepare active, everything else waiting', () => {
    const m = computeRunProgress(run({ state: 'queued', sources: [src({ provider: 'pubmed' })] }));
    const byId = Object.fromEntries(m.steps.map((s) => [s.id, s]));
    expect(byId.prepare.status).toBe('active');
    expect(byId.search.status).toBe('waiting');
    expect(byId.finalize.status).toBe('waiting');
    expect(m.phase).toBe('preparing');
    expect(m.activityText).toMatch(/Preparing/i);
  });

  it('mid-run: prepare done, search active, dominant carries the spinner', () => {
    const m = computeRunProgress(run({
      state: 'running',
      sources: [src({ provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 120, previewCount: 1000, cap: 2000 })],
    }));
    const byId = Object.fromEntries(m.steps.map((s) => [s.id, s]));
    expect(byId.prepare.status).toBe('done');
    expect(byId.search.status).toBe('active');
    expect(m.phase).toBe('searching');
    const dominant = m.steps.filter((s) => s.dominant);
    expect(dominant).toHaveLength(1);
    expect(dominant[0].id).toBe('search');
    expect(m.activityText).toMatch(/PubMed/);
    expect(m.activityText).toMatch(/1,000/);
  });

  it('dominant phase surfaces importing over fetching', () => {
    const m = computeRunProgress(run({
      state: 'running',
      sources: [
        src({ provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 50, previewCount: 500 }),
        src({ provider: 'europepmc', state: 'running', stage: 'importing', rawCount: 300, importedCount: 40, previewCount: 500 }),
      ],
    }));
    expect(m.phase).toBe('adding');
    expect(m.activityText).toMatch(/Adding/);
  });

  it('completed: all streaming steps done, finalize done, satisfying activity', () => {
    const m = computeRunProgress(run({
      state: 'completed',
      sources: [src({ provider: 'pubmed', state: 'completed', rawCount: 500, importedCount: 300, exactDupCount: 100, existingMatchCount: 100 })],
    }));
    for (const s of m.steps) expect(['done']).toContain(s.status);
    expect(m.steps.every((s) => !s.dominant)).toBe(true);
    expect(m.activityText).toMatch(/300/);
    expect(m.activityText).toMatch(/added to Screening/i);
  });

  it('partial: search step warns but records still counted', () => {
    const m = computeRunProgress(run({
      state: 'partial',
      sources: [
        src({ provider: 'pubmed', state: 'completed', rawCount: 500, importedCount: 300 }),
        src({ provider: 'crossref', state: 'failed', errorDetail: 'timeout' }),
      ],
    }));
    const byId = Object.fromEntries(m.steps.map((s) => [s.id, s]));
    expect(byId.search.status).toBe('warning');
    expect(byId.add.status).toBe('done');
    expect(m.activityText).toMatch(/300/);
  });

  it('failed with zero imports: steps that started show failed, activity reassures on consistency', () => {
    const m = computeRunProgress(run({
      state: 'failed',
      sources: [src({ provider: 'pubmed', state: 'failed', rawCount: 10, errorDetail: 'db down' })],
    }));
    expect(m.steps.find((s) => s.id === 'finalize').status).toBe('failed');
    expect(m.activityText).toMatch(/could not be completed/i);
    expect(m.activityText).toMatch(/No records were added/i);
  });

  it('failed AFTER landing some records: activity must NOT claim nothing was added', () => {
    // Streaming pipeline lands page 1, then page 2 fails fatally → run failed, imported>0.
    const m = computeRunProgress(run({
      state: 'failed',
      sources: [src({ provider: 'pubmed', state: 'failed', rawCount: 50, importedCount: 40, errorDetail: 'db down' })],
    }));
    expect(m.activityText).toMatch(/40/);
    expect(m.activityText).toMatch(/added to Screening/i);
    expect(m.activityText).toMatch(/will not create duplicates/i);
    expect(m.activityText).not.toMatch(/No records were added/i);
  });

  it('all-skipped run explains no databases were available (not a generic failure)', () => {
    const m = computeRunProgress(run({
      state: 'failed', // deriveRunState reports all-skipped as failed
      sources: [
        src({ provider: 'pubmed', state: 'skipped' }),
        src({ provider: 'crossref', state: 'skipped' }),
      ],
    }));
    expect(m.activityText).toMatch(/None of the selected databases were available/i);
  });

  it('cancelled: kept records are communicated', () => {
    const m = computeRunProgress(run({
      state: 'cancelled',
      sources: [src({ provider: 'pubmed', state: 'cancelled', rawCount: 40, importedCount: 12 })],
    }));
    expect(m.percent).toBe(100);
    expect(m.activityText).toMatch(/cancelled/i);
    expect(m.activityText).toMatch(/12/);
  });

  it('per-source view carries expected/percent/trust', () => {
    const m = computeRunProgress(run({
      state: 'running',
      sources: [src({ provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 250, previewCount: 500, cap: 2000 })],
    }));
    expect(m.sources[0]).toMatchObject({ provider: 'pubmed', label: 'PubMed', expected: 500, expectedTrust: 'exact', percent: 50 });
  });
});

describe('nextProgressPercent — monotonic clamp', () => {
  it('never decreases across samples', () => {
    const r1 = run({ state: 'running', sources: [src({ provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 400, previewCount: 500, cap: 1000 })] });
    const p1 = nextProgressPercent(0, r1);
    // A later poll where the estimate shrank (denominator effectively grew) would push raw % down.
    const r2 = run({ state: 'running', sources: [src({ provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 300, previewCount: 800, cap: 1000 })] });
    const p2 = nextProgressPercent(p1, r2);
    expect(p2).toBeGreaterThanOrEqual(p1);
  });
  it('terminal always returns 100 regardless of prior', () => {
    expect(nextProgressPercent(40, run({ state: 'completed', sources: [src({ provider: 'pubmed', state: 'completed' })] }))).toBe(100);
  });
  it('caps below 100 while running even if prev was inflated', () => {
    const p = nextProgressPercent(150, run({ state: 'running', sources: [src({ provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 1, previewCount: 1000 })] }));
    expect(p).toBeLessThanOrEqual(99);
  });
});

describe('TERMINAL_RUN_STATES', () => {
  it('contains exactly the four terminal states', () => {
    expect([...TERMINAL_RUN_STATES].sort()).toEqual(['cancelled', 'completed', 'failed', 'partial']);
  });
});
