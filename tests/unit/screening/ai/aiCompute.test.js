/**
 * aiCompute.test.js (62.md) — the CPU-offload pool for the screening-AI engine.
 *
 * Two guarantees:
 *  1. OUTPUT-PRESERVING — the pool reproduces the pure engine's results exactly
 *     (it just moves the work off the event loop). Proven in the default inline mode.
 *  2. NON-BLOCKING — in worker mode a heavy compute does NOT stall the main thread
 *     (a 20ms ticker keeps cadence while the worker_thread crunches). Best-effort:
 *     skips cleanly if worker_threads can't start in this runtime.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  trainAndScore, crossValidate, crossValidatePerRecord,
} from '../../../../src/research-engine/screening/ai/index.js';
import {
  runTrainAndScore, runCrossValidate, runCrossValidatePerRecord, computeMode,
} from '../../../../server/services/aiCompute.js';

// Separable synthetic project: heart-failure RCTs (include) vs admin/policy (exclude).
function makeRecords({ nInc = 30, nExc = 30 } = {}) {
  const inc = Array.from({ length: nInc }, (_, i) => ({
    id: `inc${i}`,
    title: `Randomized controlled trial ${i} of beta blocker therapy in chronic heart failure`,
    abstract: 'A double-blind randomized placebo-controlled trial assessing mortality in patients with reduced ejection fraction heart failure receiving beta blocker therapy.',
    year: '2020', keywords: 'heart failure; randomized controlled trial', authors: 'Smith J',
  }));
  const exc = Array.from({ length: nExc }, (_, i) => ({
    id: `exc${i}`,
    title: `Narrative review ${i} of hospital administration and billing policy`,
    abstract: 'An editorial commentary discussing healthcare funding, administration, and journal formatting guidelines unrelated to clinical outcomes.',
    year: '2019', keywords: 'policy; administration', authors: 'Brown K',
  }));
  return [...inc, ...exc];
}
const picoSnapshot = {
  P: 'adults with chronic heart failure', I: 'beta blockers', O: 'mortality',
  incl: 'Randomized controlled trials in heart failure patients',
  excl: 'Editorials, reviews, and policy commentary',
};
const labelsFor = (records) => Object.fromEntries(records.map(r => [r.id, r.id.startsWith('inc') ? 'include' : 'exclude']));

describe('aiCompute — inline parity (output-preserving offload)', () => {
  it('runs inline under Vitest by default', () => {
    expect(computeMode()).toBe('inline');
  });

  it('runTrainAndScore reproduces the pure engine trainAndScore exactly', async () => {
    const records = makeRecords();
    const input = { records, labelByRecordId: labelsFor(records), picoSnapshot };
    const direct = trainAndScore(input);
    const pooled = await runTrainAndScore(input);
    expect(pooled.scores).toEqual(direct.scores);
    expect(pooled.meta).toEqual(direct.meta);
  });

  it('runCrossValidate reproduces the pure engine crossValidate exactly', async () => {
    const records = makeRecords();
    const input = { records, labelByRecordId: labelsFor(records), picoSnapshot };
    const direct = crossValidate(input);
    const pooled = await runCrossValidate(input);
    expect(pooled).toEqual(direct);
  });

  it('runCrossValidatePerRecord rebuilds the engine Map entry-for-entry', async () => {
    const records = makeRecords();
    const input = { records, labelByRecordId: labelsFor(records), picoSnapshot };
    const direct = crossValidatePerRecord(input);
    const pooled = await runCrossValidatePerRecord(input);
    expect(pooled.meta).toEqual(direct.meta);
    expect(pooled.byRecordId).toBeInstanceOf(Map);
    expect(pooled.byRecordId.size).toBe(direct.byRecordId.size);
    for (const r of records) {
      expect(pooled.byRecordId.get(r.id)).toEqual(direct.byRecordId.get(r.id));
    }
  });
});

describe('aiCompute — worker mode keeps the main event loop responsive (best-effort)', () => {
  it('does not stall the main thread while a heavy compute runs off-thread', async () => {
    process.env.AI_COMPUTE_WORKER = '1';
    vi.resetModules();
    let mod;
    try {
      mod = await import('../../../../server/services/aiCompute.js');
    } catch {
      delete process.env.AI_COMPUTE_WORKER; vi.resetModules(); return; // worker_threads unavailable → skip
    }
    if (mod.computeMode() !== 'worker') { delete process.env.AI_COMPUTE_WORKER; vi.resetModules(); return; }

    const records = makeRecords({ nInc: 150, nExc: 150 }); // real CPU: ~300 labelled × k-fold
    const input = { records, labelByRecordId: labelsFor(records), picoSnapshot };

    const gaps = [];
    let last = performance.now();
    const ticker = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 20);
    let result;
    try {
      result = await mod.runCrossValidatePerRecord(input);
    } finally {
      clearInterval(ticker);
      try { await mod.shutdownCompute?.(); } catch { /* noop */ }
      delete process.env.AI_COMPUTE_WORKER;
      vi.resetModules();
    }

    // The compute really ran (cross-validated entries present)…
    expect(result.byRecordId.size).toBe(records.length);
    // …and the main-thread ticker kept firing. Run inline, a 300-record CV would block
    // the loop for hundreds of ms in one burst; off-thread the worst gap stays small.
    expect(gaps.length).toBeGreaterThan(3);
    expect(Math.max(...gaps, 0)).toBeLessThan(300);
  }, 60000);
});
