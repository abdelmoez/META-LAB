/**
 * uploadLimit.test.js — 58.md §3/§5 screening upload-limit resolver.
 * Layered resolution (per-user → workspace → tier → global → default), clamped to
 * [MIN, hard ceiling].
 */
import { describe, it, expect } from 'vitest';
import { resolveScreeningUploadLimit, MIN_SCREENING_UPLOAD_LIMIT } from '../../server/screening/uploadLimit.js';

describe('58.md §3 — resolveScreeningUploadLimit', () => {
  it('defaults to 100,000 when nothing is configured', () => {
    expect(resolveScreeningUploadLimit({})).toBe(100000);
    expect(resolveScreeningUploadLimit({ settings: {} })).toBe(100000);
  });
  it('uses the global Ops setting when present', () => {
    expect(resolveScreeningUploadLimit({ settings: { maxRecordsPerProject: 250000 } }))
      .toBe(200000); // clamped to the hard MAX_RECORDS_PER_IMPORT ceiling
    expect(resolveScreeningUploadLimit({ settings: { maxRecordsPerProject: 40000 } })).toBe(40000);
  });
  it('clamps below the minimum to the floor', () => {
    expect(resolveScreeningUploadLimit({ settings: { maxRecordsPerProject: 50 } })).toBe(MIN_SCREENING_UPLOAD_LIMIT);
    expect(MIN_SCREENING_UPLOAD_LIMIT).toBe(1000);
  });
  it('honors the layered precedence: per-user > workspace > plan > global', () => {
    const settings = { maxRecordsPerProject: 10000 };
    expect(resolveScreeningUploadLimit({ settings, planLimit: 20000 })).toBe(20000);
    expect(resolveScreeningUploadLimit({ settings, planLimit: 20000, workspaceLimit: 30000 })).toBe(30000);
    expect(resolveScreeningUploadLimit({ settings, planLimit: 20000, workspaceLimit: 30000, userLimit: 40000 })).toBe(40000);
  });
  it('ignores non-positive override layers and falls through', () => {
    expect(resolveScreeningUploadLimit({ settings: { maxRecordsPerProject: 75000 }, userLimit: 0, workspaceLimit: null }))
      .toBe(75000);
  });
});
