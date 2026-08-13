/**
 * 116.md §9/§10/§12 — the pure model behind the PRISMA inspector: per-box
 * explanations, facet sets, the client-side patch validation mirror, and the
 * box-records query builder.
 */
import { describe, it, expect } from 'vitest';
import {
  BOX_EXPLANATIONS, facetsForBox, FACET_LABELS,
  identificationSourceOptions, validateRecordPatch, buildBoxRecordsQuery,
} from '../../../src/features/prisma/inspectorModel.js';
import { BOX_IDS, IDENTIFICATION_SOURCE_IDS } from '../../../src/research-engine/prisma/model.js';

describe('BOX_EXPLANATIONS (§9.3) — every box explains its count', () => {
  it('covers every box the model defines', () => {
    for (const id of BOX_IDS) {
      expect(BOX_EXPLANATIONS[id], `no explanation for ${id}`).toBeTruthy();
    }
  });
});

describe('facetsForBox (§12) — clean, per-box filters', () => {
  it('gives reason filters to the reason boxes and retrieval to the retrieval boxes', () => {
    expect(facetsForBox('excluded_full_text_db')).toContain('reason');
    expect(facetsForBox('not_retrieved_other')).toContain('reason');
    expect(facetsForBox('sought_db')).toContain('retrieval');
    expect(facetsForBox('identified_db')).toContain('source');
    // Not a spreadsheet: no box carries every facet.
    for (const id of BOX_IDS) expect(facetsForBox(id).length).toBeLessThan(4);
    for (const id of BOX_IDS) {
      for (const f of facetsForBox(id)) expect(FACET_LABELS[f]).toBeTruthy();
    }
  });
});

describe('identificationSourceOptions (§13)', () => {
  it('offers "automatic" plus every model bucket, labelled', () => {
    const opts = identificationSourceOptions();
    expect(opts[0].value).toBe('');
    expect(opts.map((o) => o.value).slice(1)).toEqual(IDENTIFICATION_SOURCE_IDS);
    expect(opts.map((o) => o.label)).toContain('Previous review');
    expect(opts.map((o) => o.label)).toContain('Author contact');
  });
});

describe('validateRecordPatch — the server contract, mirrored', () => {
  it('accepts clean edits and normalizes DOI URLs', () => {
    const v = validateRecordPatch({ title: ' T ', doi: 'https://doi.org/10.1/x', year: '2020' });
    expect(v.ok).toBe(true);
    expect(v.clean).toEqual({ title: 'T', doi: '10.1/x', year: '2020' });
  });

  it('refuses bad years, pmids, unknown buckets and unknown fields', () => {
    expect(validateRecordPatch({ year: '20' }).ok).toBe(false);
    expect(validateRecordPatch({ pmid: 'x1' }).ok).toBe(false);
    expect(validateRecordPatch({ identificationSource: 'fax' }).ok).toBe(false);
    expect(validateRecordPatch({ finalStatus: 'accepted' }).ok).toBe(false); // §10 — never inline
  });

  it('accepts every real identification bucket and empty (= automatic)', () => {
    for (const id of IDENTIFICATION_SOURCE_IDS.concat([''])) {
      expect(validateRecordPatch({ identificationSource: id }).ok).toBe(true);
    }
  });
});

describe('buildBoxRecordsQuery', () => {
  it('serializes only the non-empty params', () => {
    expect(buildBoxRecordsQuery({ q: 'mri', source: '', cursor: '50', limit: 50 }))
      .toBe('?q=mri&cursor=50&limit=50');
    expect(buildBoxRecordsQuery({})).toBe('');
  });
});
