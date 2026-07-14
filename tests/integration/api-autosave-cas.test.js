/**
 * api-autosave-cas.test.js — 83.md-limitation fix: OPT-IN optimistic concurrency on
 * the whole-blob project autosave, keyed on `Project.autosaveRev` (bumped ONLY by
 * the autosave path — module writers never touch it, so client-initiated server
 * writes can't fake a conflict). DB-direct (imports server/store.js + the shared dev
 * SQLite prisma — no live server needed). Run serially with the other DB-writing
 * integration files: `--pool=forks --poolOptions.forks.singleFork=true`.
 *
 * Contract under test (store.js save/saveAsMember):
 *  - no baseline            → legacy last-write-wins (unchanged behaviour)
 *  - current rev            → write lands, rev increments
 *  - STALE rev + diff       → typed SAVE_CONFLICT (409 at the API layer), row untouched
 *  - stale rev + SAME data  → the no-op guard wins (no conflict for identical content)
 *  - non-autosave writes (e.g. studyDoc/completion prisma.project.update) do NOT
 *    bump the rev → the initiating client's next autosave still lands.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { save, saveAsMember } from '../../server/store.js';

const TS = Date.now();
const created = { userIds: [], projectIds: [] };
let dbUp = false;
let user = null;

const proj = (over = {}) => ({ id: `cas-${TS}`, name: 'CAS project', studies: [], ...over });

beforeAll(async () => {
  try {
    user = await prisma.user.create({ data: { email: `cas-${TS}@example.com`, password: 'x', name: 'CAS Tester' } });
    created.userIds.push(user.id);
    created.projectIds.push(`cas-${TS}`);
    dbUp = true;
  } catch { dbUp = false; }
});

afterAll(async () => {
  if (!dbUp) return;
  try {
    await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  } catch { /* best-effort */ }
});

describe('autosave optimistic concurrency (autosaveRev)', () => {
  it('stale rev + changed content → SAVE_CONFLICT; row keeps the newer write', async () => {
    if (!dbUp) return;
    const v1 = await save(proj({ notes: 'v1' }), user.id);
    expect(v1.autosaveRev).toBe(1);

    const v2 = await save(proj({ notes: 'v2' }), user.id, { baseRev: 1 });
    expect(v2.notes).toBe('v2');
    expect(v2.autosaveRev).toBe(2); // current baseline → lands, rev bumps

    let conflict = null;
    try {
      await save(proj({ notes: 'v3-from-stale-tab' }), user.id, { baseRev: 1 }); // STALE
    } catch (e) { conflict = e; }
    expect(conflict && conflict.code).toBe('SAVE_CONFLICT');
    expect(conflict.status).toBe(409);
    expect(conflict.serverProject && conflict.serverProject.notes).toBe('v2'); // server copy returned

    const row = await prisma.project.findFirst({ where: { id: proj().id } });
    expect(JSON.parse(row.data).notes).toBe('v2'); // the newer write survived
    expect(row.autosaveRev).toBe(2);
  });

  it('stale rev + IDENTICAL content → no-op, no conflict', async () => {
    if (!dbUp) return;
    const same = await save(proj({ notes: 'v2' }), user.id, { baseRev: 0 });
    expect(same.notes).toBe('v2'); // returned existing, nothing thrown
    expect(same.autosaveRev).toBe(2); // and the rev did not move
  });

  it('a NON-autosave server write does not bump the rev → the client autosave still lands', async () => {
    if (!dbUp) return;
    // Simulate a module writer (studyDoc upload / extraction completion): direct
    // prisma update of the blob WITHOUT touching autosaveRev.
    const row = await prisma.project.findFirst({ where: { id: proj().id } });
    const data = JSON.parse(row.data);
    data.moduleStamp = 'server-side-write';
    await prisma.project.update({ where: { id: row.id }, data: { data: JSON.stringify(data), lastSavedAt: new Date() } });

    // The client (which merged the module result locally) autosaves with its OLD rev.
    const merged = await save(proj({ notes: 'v4', moduleStamp: 'server-side-write' }), user.id, { baseRev: 2 });
    expect(merged.notes).toBe('v4'); // NOT a conflict — module writes are rev-neutral
    expect(merged.autosaveRev).toBe(3);
  });

  it('no baseline → legacy last-write-wins (backward compatible)', async () => {
    if (!dbUp) return;
    const v5 = await save(proj({ notes: 'v5-lww' }), user.id);
    expect(v5.notes).toBe('v5-lww');
  });

  it('saveAsMember honours the same rev contract', async () => {
    if (!dbUp) return;
    let conflict = null;
    try {
      await saveAsMember(proj({ notes: 'member-stale' }), { baseRev: 1 }); // stale
    } catch (e) { conflict = e; }
    expect(conflict && conflict.code).toBe('SAVE_CONFLICT');
    const row = await prisma.project.findFirst({ where: { id: proj().id } });
    const fresh = await saveAsMember(proj({ notes: 'member-ok' }), { baseRev: row.autosaveRev });
    expect(fresh.notes).toBe('member-ok');
  });
});
