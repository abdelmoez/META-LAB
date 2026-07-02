/**
 * fullTextCoerce.test.js — coerceFullTextSettings (68.md P9, Ops edit path).
 *
 * Target: server/fullText/fullTextService.js#coerceFullTextSettings, the whitelist
 * that sanitises an admin-supplied full-text settings patch before it is persisted.
 * It must: keep only known keys, bounds-check the numeric caps, keep only known
 * providers in the caller's order (deduped), and never leave an empty provider
 * order (falls back to the default).
 *
 * Pure function (no DB) → unit-tested directly.
 */
import { describe, it, expect } from 'vitest';
import { coerceFullTextSettings, FT_DEFAULTS } from '../../server/fullText/fullTextService.js';

describe('coerceFullTextSettings — defaults + passthrough', () => {
  it('returns the defaults for an empty patch', () => {
    const out = coerceFullTextSettings({}, {});
    expect(out).toEqual(FT_DEFAULTS);
  });
  it('ignores unknown keys', () => {
    const out = coerceFullTextSettings({ bogus: 1, hacker: true }, {});
    expect(out.bogus).toBeUndefined();
    expect(out.hacker).toBeUndefined();
  });
  it('treats null / non-object input as an empty patch', () => {
    expect(coerceFullTextSettings(null, {})).toEqual(FT_DEFAULTS);
    expect(coerceFullTextSettings('nope', {})).toEqual(FT_DEFAULTS);
  });
});

describe('coerceFullTextSettings — booleans', () => {
  it('applies enabled + autoParseOnArrival only when boolean', () => {
    expect(coerceFullTextSettings({ enabled: false }, {}).enabled).toBe(false);
    expect(coerceFullTextSettings({ autoParseOnArrival: true }, {}).autoParseOnArrival).toBe(true);
    // wrong type → keep default
    expect(coerceFullTextSettings({ enabled: 'no' }, {}).enabled).toBe(FT_DEFAULTS.enabled);
  });
});

describe('coerceFullTextSettings — numeric caps', () => {
  it('clamps maxPdfMb into [1,100] and rounds', () => {
    expect(coerceFullTextSettings({ maxPdfMb: 40 }, {}).maxPdfMb).toBe(40);
    expect(coerceFullTextSettings({ maxPdfMb: 0 }, {}).maxPdfMb).toBe(1);
    expect(coerceFullTextSettings({ maxPdfMb: 9999 }, {}).maxPdfMb).toBe(100);
    expect(coerceFullTextSettings({ maxPdfMb: 12.7 }, {}).maxPdfMb).toBe(13);
  });
  it('clamps maxBulkUploadPdfs into [1,500]', () => {
    expect(coerceFullTextSettings({ maxBulkUploadPdfs: 100 }, {}).maxBulkUploadPdfs).toBe(100);
    expect(coerceFullTextSettings({ maxBulkUploadPdfs: -5 }, {}).maxBulkUploadPdfs).toBe(1);
    expect(coerceFullTextSettings({ maxBulkUploadPdfs: 100000 }, {}).maxBulkUploadPdfs).toBe(500);
  });
  it('rejects non-finite caps (keeps the default)', () => {
    expect(coerceFullTextSettings({ maxPdfMb: NaN }, {}).maxPdfMb).toBe(FT_DEFAULTS.maxPdfMb);
    expect(coerceFullTextSettings({ maxBulkUploadPdfs: Infinity }, {}).maxBulkUploadPdfs).toBe(FT_DEFAULTS.maxBulkUploadPdfs);
  });
});

describe('coerceFullTextSettings — providerOrder', () => {
  it('keeps only known providers, in the caller order, deduped', () => {
    const out = coerceFullTextSettings({ providerOrder: ['openalex', 'bogus', 'unpaywall', 'openalex'] }, {});
    expect(out.providerOrder).toEqual(['openalex', 'unpaywall']);
  });
  it('falls back to the default order when nothing legal remains', () => {
    const out = coerceFullTextSettings({ providerOrder: ['bogus', 'nope'] }, {});
    expect(out.providerOrder).toEqual(FT_DEFAULTS.providerOrder);
  });
  it('ignores a non-array providerOrder', () => {
    const out = coerceFullTextSettings({ providerOrder: 'unpaywall' }, { providerOrder: ['europepmc'] });
    expect(out.providerOrder).toEqual(['europepmc']);
  });
});
