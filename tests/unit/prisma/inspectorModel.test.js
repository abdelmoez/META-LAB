/**
 * 116.md §9/§10/§12 — the pure model behind the PRISMA inspector: per-box
 * explanations, facet sets, the client-side patch validation mirror, and the
 * box-records query builder.
 */
import { describe, it, expect } from 'vitest';
import {
  BOX_EXPLANATIONS, facetsForBox, FACET_LABELS,
  identificationSourceOptions, validateRecordPatch, buildBoxRecordsQuery,
  acceptBoxResponse, affectsBoxMembership, shouldReloadForRecordPoke, canRevertFinal,
} from '../../../src/features/prisma/inspectorModel.js';
import { boxBreakdown } from '../../../src/features/prisma/PrismaInspector.jsx';
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

/* ════════ 116.md §10/§11 (r2) — the adversarial-review repairs ════════
 *
 * These decisions live in the pure model precisely so they can be tested in Node
 * (renderToStaticMarkup house style — no jsdom, no interaction unit tests). Each
 * one is the whole of a defect that used to be unobservable inside the component.
 */

describe('acceptBoxResponse — the stale-response guard (§11 r2)', () => {
  it('paints the newest request', () => {
    expect(acceptBoxResponse({ seq: 4, currentSeq: 4, payloadBoxId: 'identified_db', boxId: 'identified_db' })).toBe(true);
  });

  it('DISCARDS a superseded response — the box-switch race', () => {
    // Click excluded_screening (slow, 40k ids), then included_studies (fast). The
    // slow response lands last and used to overwrite rows/total/facets/canEdit while
    // the header still read "Studies included in review — n = 12".
    expect(acceptBoxResponse({ seq: 1, currentSeq: 2, payloadBoxId: 'excluded_screening', boxId: 'included_studies' })).toBe(false);
  });

  it('discards a superseded response even for the SAME box (filter / load-more race)', () => {
    expect(acceptBoxResponse({ seq: 1, currentSeq: 2, payloadBoxId: 'identified_db', boxId: 'identified_db' })).toBe(false);
  });

  it('refuses a payload whose own boxId does not match, belt and braces', () => {
    expect(acceptBoxResponse({ seq: 2, currentSeq: 2, payloadBoxId: 'identified_other', boxId: 'identified_db' })).toBe(false);
  });

  it('tolerates a payload with no boxId (older server)', () => {
    expect(acceptBoxResponse({ seq: 2, currentSeq: 2, payloadBoxId: undefined, boxId: 'identified_db' })).toBe(true);
  });
});

describe('affectsBoxMembership — the offset-cursor skip (§10 r2)', () => {
  it('is true for the fields that feed armOf()', () => {
    // Editing either can move the record OUT of the listed box, renumbering every
    // later candidate so the held offset cursor skips one on "Load more".
    expect(affectsBoxMembership({ identificationSource: 'manual' })).toBe(true);
    expect(affectsBoxMembership({ sourceDb: 'Embase' })).toBe(true);
    expect(affectsBoxMembership({ title: 'x', sourceDb: '' })).toBe(true);
  });

  it('is false for purely bibliographic edits, which keep the fast path', () => {
    expect(affectsBoxMembership({ title: 'Corrected title' })).toBe(false);
    expect(affectsBoxMembership({ year: '2021', doi: '10.1/x', pmid: '1' })).toBe(false);
    expect(affectsBoxMembership({ rejectedReason: 'Wrong dose' })).toBe(false);
    expect(affectsBoxMembership({ sourceDetail: 'reference list of Smith 2020' })).toBe(false);
    expect(affectsBoxMembership(null)).toBe(false);
  });

  it('an empty-string value still counts — clearing sourceDb moves arms', () => {
    expect(affectsBoxMembership({ sourceDb: '' })).toBe(true);
  });
});

describe('shouldReloadForRecordPoke — the orphaned realtime event (§10 r2)', () => {
  it('reloads for this project', () => {
    expect(shouldReloadForRecordPoke({ type: 'record.updated', ids: ['r1'], projectId: 'sp1' }, 'sp1')).toBe(true);
  });

  it('ignores another project on the shared per-user stream', () => {
    expect(shouldReloadForRecordPoke({ type: 'record.updated', ids: ['r1'], projectId: 'sp2' }, 'sp1')).toBe(false);
  });

  it('is inert without a linked screening project', () => {
    expect(shouldReloadForRecordPoke({ projectId: 'sp1' }, null)).toBe(false);
    expect(shouldReloadForRecordPoke(null, 'sp1')).toBe(false);
  });
});

describe('canRevertFinal — no button that is guaranteed to 400 (§10 r2)', () => {
  it('only an ACCEPTED record can be reverted', () => {
    expect(canRevertFinal({ finalStatus: 'accepted' }, true)).toBe(true);
  });

  it('a REJECTED record cannot — revertFinalReview 400s on it', () => {
    // The button used to render on `isFinalized`, so a leader opening "Reports
    // excluded" and clicking it got a guaranteed 400 with zero feedback.
    expect(canRevertFinal({ finalStatus: 'rejected' }, true)).toBe(false);
  });

  it('an unfinalized record and a caller without the capability cannot', () => {
    expect(canRevertFinal({ finalStatus: '' }, true)).toBe(false);
    expect(canRevertFinal({ finalStatus: 'accepted' }, false)).toBe(false);
    expect(canRevertFinal(null, true)).toBe(false);
  });
});

describe('boxBreakdown — the other column shows the work it cannot draw (§13 r2)', () => {
  it('lists other-arm removals and screening decisions under identified_other', () => {
    const flow = {
      sources: { other: [{ key: 'Hand-searching / manually added', label: 'Hand-searching / manually added', n: 100 }] },
      otherArm: {
        removed: { n: 20 }, excludedScreening: { n: 50 }, awaitingScreening: { n: 0 },
      },
    };
    const rows = boxBreakdown(flow, 'identified_other');
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('Hand-searching / manually added');
    expect(labels).toContain('Removed before screening (no box in this column)');
    expect(labels).toContain('Excluded at title/abstract (no box in this column)');
    // A zero is not worth a row — the panel stays a summary, not a form.
    expect(labels).not.toContain('Awaiting title/abstract screening');
    expect(rows.find((r) => r.key === 'other_excluded').n).toBe(50);
  });

  it('degrades to the source rows on a flow that predates otherArm', () => {
    const rows = boxBreakdown({ sources: { other: [{ key: 'x', label: 'x', n: 1 }] } }, 'identified_other');
    expect(rows).toHaveLength(1);
  });

  it('leaves the database column breakdown alone', () => {
    const rows = boxBreakdown({ sources: { db: [{ key: 'PubMed', label: 'PubMed', n: 4 }] } }, 'identified_db');
    expect(rows.map((r) => r.label)).toEqual(['PubMed']);
  });
});
