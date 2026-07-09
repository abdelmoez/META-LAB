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

  it('still lets a non-zero manual project.prisma dedupe value win (explicit user intent)', () => {
    const r = computePrismaCounts({ prisma: { dedupe: '7' } }, { screening: { identified: 120, dedupePerformed: false } });
    expect(r.counts.dedupe).toBe(7);
    expect(r.provenance.dedupe).toBe('manual');
  });

  it('does NOT let an auto-synced manual "0" mask a live not-performed signal (§1)', () => {
    // MetaSiftPrismaSync writes project.prisma.dedupe="0" exactly when dedup was not performed.
    const r = computePrismaCounts({ prisma: { dedupe: '0' } }, { screening: { identified: 120, dedupePerformed: false } });
    expect(r.counts.dedupe).toBeNull();
    expect(r.provenance.dedupe).toBe('not-performed');
    expect(r.warnings.some((w) => /not been performed/i.test(w))).toBe(true);
  });

  it('a deliberate override of 0 still stands even when live says not-performed', () => {
    const r = computePrismaCounts({ prisma: { dedupe: '0' } }, { overrides: { dedupe: '0' }, screening: { identified: 120, dedupePerformed: false } });
    expect(r.counts.dedupe).toBe(0);
    expect(r.provenance.dedupe).toBe('override');
  });

  it('warns when dedup is simply unknown (no signal either way)', () => {
    const r = computePrismaCounts({}, { screening: { identified: 80 } });
    expect(r.counts.dedupe).toBeNull();
    expect(r.provenance.dedupe).toBe('missing');
    expect(r.warnings.some((w) => /deduplication was performed/i.test(w))).toBe(true);
  });
});

describe('computePrismaCounts — per-source split (§1)', () => {
  it('uses the canonical dbs/reg/other split when provided; identified = their sum', () => {
    const r = computePrismaCounts({}, { screening: { identified: 100, dbs: 70, reg: 20, other: 10 } });
    expect(r.counts.dbs).toBe(70);
    expect(r.counts.reg).toBe(20);
    expect(r.counts.other).toBe(10);
    expect(r.provenance.dbs).toBe('computed');
    expect(r.provenance.reg).toBe('computed');
    expect(r.counts.identified).toBe(100); // 70+20+10 derived
    expect(r.provenance.identified).toBe('derived');
  });

  it('falls back to identified-as-dbs (legacy) when no split is available', () => {
    const r = computePrismaCounts({}, { screening: { identified: 100 } });
    expect(r.counts.dbs).toBe(100);
    expect(r.provenance.dbs).toBe('computed');
    expect(r.provenance.reg).toBe('missing');
  });

  it('a manual project.prisma split still overrides the computed one', () => {
    const r = computePrismaCounts({ prisma: { dbs: '55' } }, { screening: { identified: 100, dbs: 70, reg: 20, other: 10 } });
    expect(r.counts.dbs).toBe(55);
    expect(r.provenance.dbs).toBe('manual');
  });
});
