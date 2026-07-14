/**
 * 86.md Phase B — mutateProjectBlob is the ONE safe way for a server-side module
 * writer to change Project.data. This pins its compare-and-swap semantics with an
 * in-memory prisma mock: it bumps autosaveRev, retries on a losing CAS, and never
 * writes (nor bumps) when the mutator declines to commit.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const state = { row: null, conflictOnce: false, updateCalls: 0 };

vi.mock('../../../server/db/client.js', () => ({
  prisma: {
    project: {
      findFirst: async ({ where }) => {
        const r = state.row;
        if (!r || r.id !== where.id) return null;
        if (where.deletedAt === null && r.deletedAt) return null;
        return { ...r };
      },
      updateMany: async ({ where, data }) => {
        state.updateCalls += 1;
        const r = state.row;
        if (!r || r.id !== where.id) return { count: 0 };
        // Simulate a concurrent writer landing between our findFirst and this write.
        if (state.conflictOnce) { state.conflictOnce = false; r.autosaveRev += 1; }
        if (where.autosaveRev !== undefined && r.autosaveRev !== where.autosaveRev) return { count: 0 };
        r.data = data.data;
        r.autosaveRev += (data.autosaveRev && data.autosaveRev.increment) || 0;
        return { count: 1 };
      },
    },
  },
}));

let mutateProjectBlob;
beforeEach(async () => {
  ({ mutateProjectBlob } = await import('../../../server/store.js'));
  state.row = { id: 'p1', name: 'P', data: JSON.stringify({ studies: [{ id: 's1', es: '' }] }), autosaveRev: 3, deletedAt: null };
  state.conflictOnce = false;
  state.updateCalls = 0;
});

describe('mutateProjectBlob (Phase B CAS)', () => {
  it('commits a mutation and bumps autosaveRev', async () => {
    const out = await mutateProjectBlob('p1', (data) => {
      data.studies[0].es = '0.5';
      return { result: { ok: true } };
    });
    expect(out.committed).toBe(true);
    expect(out.result.ok).toBe(true);
    expect(state.row.autosaveRev).toBe(4);
    expect(JSON.parse(state.row.data).studies[0].es).toBe('0.5');
  });

  it('does NOT write or bump the rev when commit:false', async () => {
    const before = state.row.data;
    const out = await mutateProjectBlob('p1', () => ({ result: { skipped: true }, commit: false }));
    expect(out.committed).toBe(false);
    expect(out.result.skipped).toBe(true);
    expect(state.row.autosaveRev).toBe(3);
    expect(state.row.data).toBe(before);
    expect(state.updateCalls).toBe(0);
  });

  it('retries and succeeds when a concurrent writer wins the first CAS', async () => {
    state.conflictOnce = true;
    const out = await mutateProjectBlob('p1', (data) => {
      data.studies[0].es = '0.9';
      return { result: {} };
    });
    expect(out.committed).toBe(true);
    expect(state.updateCalls).toBe(2); // first attempt lost the CAS, second landed
    expect(JSON.parse(state.row.data).studies[0].es).toBe('0.9');
  });

  it('returns null when the project is gone', async () => {
    state.row = null;
    const out = await mutateProjectBlob('p1', () => ({ result: {} }));
    expect(out).toBeNull();
  });
});
