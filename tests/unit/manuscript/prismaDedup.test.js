/**
 * 77.md §1 — the Manuscript Editor must never report a confident "0 duplicates" when
 * deduplication was not performed. computePrismaCounts resolves dedup as a tri-state.
 */
import { describe, it, expect } from 'vitest';
import { computePrismaCounts } from '../../../src/research-engine/manuscript/prismaCounts.js';

describe('computePrismaCounts — dedup honesty (§1)', () => {
  it('computes duplicates removed from live screening when dedup was performed', () => {
    const r = computePrismaCounts({}, { screening: { identified: 120, afterDedup: 100, dedupePerformed: true, dedupeMethod: 'automatic', dedupeLastRunAt: '2026-07-01T00:00:00Z' } });
    expect(r.counts.dedupe).toBe(20);
    expect(r.provenance.dedupe).toBe('computed');
    expect(r.counts.dedupePerformed).toBe(true);
    expect(r.counts.dedupeMethod).toBe('automatic');
    expect(r.counts.dedupeLastRunAt).toBe('2026-07-01T00:00:00Z');
  });

  it('reports NOT-PERFORMED (null count, warning) rather than zero', () => {
    const r = computePrismaCounts({}, { screening: { identified: 120, dedupePerformed: false } });
    expect(r.counts.dedupe).toBeNull();
    expect(r.counts.duplicatesRemoved).toBeNull();
    expect(r.provenance.dedupe).toBe('not-performed');
    expect(r.counts.dedupePerformed).toBe(false);
    expect(r.warnings.some((w) => /not been performed/i.test(w))).toBe(true);
  });

  it('honours a genuine zero when dedup ran and found no duplicates', () => {
    const r = computePrismaCounts({}, { screening: { identified: 100, afterDedup: 100, dedupePerformed: true } });
    expect(r.counts.dedupe).toBe(0);
    expect(r.provenance.dedupe).toBe('computed');
  });

  it('still lets a manual project.prisma dedupe value win (explicit user intent)', () => {
    const r = computePrismaCounts({ prisma: { dedupe: '7' } }, { screening: { identified: 120, dedupePerformed: false } });
    expect(r.counts.dedupe).toBe(7);
    expect(r.provenance.dedupe).toBe('manual');
  });

  it('warns when dedup is simply unknown (no signal either way)', () => {
    const r = computePrismaCounts({}, { screening: { identified: 80 } });
    expect(r.counts.dedupe).toBeNull();
    expect(r.provenance.dedupe).toBe('missing');
    expect(r.warnings.some((w) => /deduplication was performed/i.test(w))).toBe(true);
  });
});
