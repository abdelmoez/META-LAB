/**
 * 119.md §8 — PRE-MIGRATION DEGRADE.
 *
 * A schema change ships before `prisma generate && prisma db push` runs, so
 * there is always a window where the deployed code knows about ProjectLogEvent
 * and the generated Prisma client does not. The recordEvent.js precedent (88.md)
 * is that the feature ships DARK and lights up after the standard migration
 * step — it must never throw, and above all it must never take a project
 * mutation down with it.
 *
 * These tests run the whole writer + reader stack against a Prisma client with
 * NO `projectLogEvent` model.
 */
import { describe, it, expect, vi } from 'vitest';

const prisma = {
  // Deliberately NO projectLogEvent.
  screenProject: { async findUnique() { return { linkedMetaLabProjectId: 'ml1' }; }, async findFirst() { return null; } },
  screenAuditLog: { async findMany() { return []; }, async groupBy() { return []; } },
  projectEvent: { async findMany() { return []; } },
  extractionAuditLog: { async findMany() { return []; } },
  robAuditLog: { async findMany() { return []; } },
  screenProjectMember: { async findMany() { return []; } },
  user: { async findUnique() { return null; } },
  async $transaction(fn) { return fn(prisma); },
};

vi.mock('../../../server/db/client.js', () => ({ prisma }));
vi.mock('../../../server/realtime/bus.js', () => ({ emitToProjectLeaders: vi.fn() }));

const svc = await import('../../../server/logbook/logbookService.js');
const Q = await import('../../../server/logbook/logbookQuery.js');
const R = await import('../../../server/logbook/retention.js');
const MS = await import('../../../server/logbook/manuscriptSession.js');

describe('the Logbook ships dark before the migration', () => {
  it('logbookAvailable reports false', () => {
    expect(svc.logbookAvailable()).toBe(false);
  });

  it('recordLogEvent no-ops instead of throwing (and does not fill the outbox)', async () => {
    expect(await svc.recordLogEvent({ action: 'MEMBER_ADDED' }, { projectId: 'sp1' })).toBe(null);
    expect(svc.outboxSize()).toBe(0);
  });

  it('recordSessionEvent no-ops', async () => {
    expect(await svc.recordSessionEvent({ action: 'FILE_DOWNLOADED', resourceId: 'p1' }, { projectId: 'sp1' })).toBe(null);
  });

  it('the TRANSACTIONAL writer no-ops rather than aborting the caller\'s mutation', async () => {
    // This is the critical one: recordLogEventTx throws on a real failure so the
    // transaction rolls back — but "the table does not exist yet" is not a
    // failure to roll back over, it is the pre-migration state of the world.
    let mutated = false;
    const out = await svc.withLoggedTransaction(
      async () => { mutated = true; return { id: 'm1' }; },
      { action: 'MEMBER_ADDED' },
      { projectId: 'sp1' });
    expect(mutated).toBe(true);
    expect(out).toEqual({ id: 'm1' });
    expect(await svc.recordLogEventTx(prisma, { action: 'OWNERSHIP_TRANSFERRED' }, { projectId: 'sp1' })).toBe(null);
  });

  it('the manuscript autosave capture no-ops', async () => {
    const v = (s) => ({ manuscripts: [{ id: 'd1', title: 'D', sections: { methods: { content: s } } }] });
    expect(await MS.captureManuscriptSession('ml1', v('a'), v('ab'), {})).toBe(0);
  });

  it('the reader returns an EMPTY, honest page — available:false, not a crash', async () => {
    const page = await Q.listLogbook({ projectId: 'sp1', metaLabProjectId: 'ml1' }, Q.normalizeFilters({}));
    expect(page.available).toBe(false);
    expect(page.events).toEqual([]);
    expect(page.nextCursor).toBe(null);
  });

  it('the cutover probe degrades to null (legacy history still shows in full)', async () => {
    expect(await Q.cutoverAt({ projectId: 'sp1' })).toBe(null);
  });

  it('facets degrade to empty option lists', async () => {
    const f = await Q.logbookFacets({ projectId: 'sp1', metaLabProjectId: 'ml1' });
    expect(f).toEqual({ engines: [], actions: [], statuses: [], actors: [], roles: [] });
  });

  it('the export walk returns nothing rather than looping', async () => {
    const { rows, truncated } = await Q.collectForExport({ projectId: 'sp1' }, Q.normalizeFilters({}));
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
  });

  it('retention no-ops', async () => {
    expect(await R.pruneProjectLogbook('sp1')).toEqual({ byAge: 0, byCap: 0, kept: 0, dryRun: false });
  });
});
