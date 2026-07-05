/**
 * stepStatusNma.test.js — 75.md recs (Finding 5).
 *
 * The legacy per-step map (`stepStatus`) used to FORCE `nma:'done'` whenever the
 * networkMetaAnalysis flag was off (the default), painting a false "Complete" on a
 * brand-new empty project's Analyze category. It must instead report the REAL,
 * evidence-based status (empty → partial → done from the pooled-study count) regardless
 * of the flag; the flag-gated denominator exclusion lives ONLY in the canonical
 * computeProjectProgress (pinned in projectProgress.test.js), which the surfaces overlay
 * onto this map — so 100% stays reachable while `nma` never lies about completion.
 */
import { describe, it, expect } from 'vitest';
import { stepStatus } from '../../src/frontend/workspace/projectHelpers.js';

const poolable = (n) => Array.from({ length: n }, (_, i) => ({
  es: '0.5', lo: '0.2', hi: '0.8', esType: 'OR', id: `s${i}`,
}));

describe('stepStatus.nma — honest evidence, never a flag-forced "done"', () => {
  it('a brand-new empty project reports nma:"empty" (was falsely "done")', () => {
    expect(stepStatus({ studies: [] }, false).nma).toBe('empty');
  });

  it('stays "empty" no matter what opts are passed (opts no longer changes any status)', () => {
    for (const opts of [undefined, {}, { networkMetaAnalysis: false }, { networkMetaAnalysis: true }]) {
      expect(stepStatus({ studies: [] }, false, opts).nma).toBe('empty');
    }
  });

  it('is "partial" with a poolable pair and "done" once ≥3 studies can form a network', () => {
    expect(stepStatus({ studies: poolable(2) }, false).nma).toBe('partial');
    expect(stepStatus({ studies: poolable(3) }, false).nma).toBe('done');
    // and the flag being ON does not change the evidence-based value either
    expect(stepStatus({ studies: poolable(3) }, false, { networkMetaAnalysis: true }).nma).toBe('done');
  });

  it('does not regress the sibling analysis statuses on an empty project', () => {
    const s = stepStatus({ studies: [] }, false);
    expect(s.analysis).toBe('empty');
    expect(s.forest).toBe('empty');
    expect(s.subgroup).toBe('empty');
  });
});
