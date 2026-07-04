/**
 * pmidToDoi.test.js — NCBI ID Converter PMID→DOI bridge.
 * Fully mocked injected fetch → NO live network in CI. Graceful-null on failure.
 */
import { describe, it, expect, vi } from 'vitest';
import { pmidToDoi } from '../../server/services/pmidToDoi.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('pmidToDoi', () => {
  it('returns the DOI from an idconv record', async () => {
    const fetch = vi.fn(async () => ok({ records: [{ pmid: '12345', doi: '10.1000/aaa' }] }));
    expect(await pmidToDoi('12345', { fetch })).toBe('10.1000/aaa');
    expect(String(fetch.mock.calls[0][0])).toContain('ids=12345');
  });

  it('tolerates a leading "PMID:" prefix and trims the DOI', async () => {
    const fetch = vi.fn(async () => ok({ records: [{ doi: '  10.1/b  ' }] }));
    expect(await pmidToDoi('PMID: 999', { fetch })).toBe('10.1/b');
  });

  it('accepts a numeric pmid', async () => {
    const fetch = vi.fn(async () => ok({ records: [{ doi: '10.2/c' }] }));
    expect(await pmidToDoi(555, { fetch })).toBe('10.2/c');
  });

  it('returns null for a non-numeric / empty pmid without calling fetch', async () => {
    const fetch = vi.fn();
    expect(await pmidToDoi('not-a-pmid', { fetch })).toBeNull();
    expect(await pmidToDoi('', { fetch })).toBeNull();
    expect(await pmidToDoi(null, { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null when the record has no DOI', async () => {
    const fetch = vi.fn(async () => ok({ records: [{ pmid: '12345' }] }));
    expect(await pmidToDoi('12345', { fetch })).toBeNull();
  });

  it('returns null on an idconv per-record error status', async () => {
    const fetch = vi.fn(async () => ok({ records: [{ status: 'error', doi: '10.9/x' }] }));
    expect(await pmidToDoi('12345', { fetch })).toBeNull();
  });

  it('returns null on a non-OK HTTP response', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await pmidToDoi('12345', { fetch })).toBeNull();
  });

  it('returns null (never throws) when fetch rejects', async () => {
    const fetch = vi.fn(async () => { throw new Error('network down'); });
    await expect(pmidToDoi('12345', { fetch })).resolves.toBeNull();
  });

  it('returns null on a malformed body (no records array)', async () => {
    const fetch = vi.fn(async () => ok({ nope: true }));
    expect(await pmidToDoi('12345', { fetch })).toBeNull();
  });
});
