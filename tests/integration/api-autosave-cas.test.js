/**
 * api-autosave-cas.test.js — 83.md-limitation fix: OPT-IN optimistic concurrency on
 * the whole-blob project autosave, keyed on `Project.autosaveRev` (bumped ONLY by
 * the autosave path — module writers never touch it, so client-initiated server
 * writes can't fake a conflict). DB-direct (imports server/store.js + the shared dev
 * SQLite prisma — no live server needed). Run serially with the other DB-writing
 * integration files: `--pool=forks --poolOptions.forks.singleFork=true`.
 *
 * Contract under test (store.js save/saveAsMember/mutateProjectBlob):
 *  - no baseline            → legacy last-write-wins (unchanged behaviour)
 *  - current rev            → write lands, rev increments
 *  - STALE rev + diff       → typed SAVE_CONFLICT (409 at the API layer), row untouched
 *  - stale rev + SAME data  → the no-op guard wins (no conflict for identical content)
 *  - 86.md Phase B — module writers now route through mutateProjectBlob, which DOES
 *    bump the rev (CAS + retry), so a stale client autosave 409s instead of silently
 *    erasing the module's change. A RAW prisma.project.update that bypasses the helper
 *    still leaves the rev untouched (documented so no one re-introduces that pattern).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { save, saveAsMember, mutateProjectBlob } from '../../server/store.js';

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

  it('a RAW prisma write (bypassing the helper) does not bump the rev → the client autosave still lands', async () => {
    if (!dbUp) return;
    // Legacy anti-pattern: a direct prisma update that DOESN'T touch autosaveRev.
    const row = await prisma.project.findFirst({ where: { id: proj().id } });
    const data = JSON.parse(row.data);
    data.moduleStamp = 'raw-write';
    await prisma.project.update({ where: { id: row.id }, data: { data: JSON.stringify(data), lastSavedAt: new Date() } });

    // The client autosaves with its OLD rev; the raw write left the rev at 2 so it lands.
    const merged = await save(proj({ notes: 'v4', moduleStamp: 'raw-write' }), user.id, { baseRev: 2 });
    expect(merged.notes).toBe('v4');
    expect(merged.autosaveRev).toBe(3);
  });

  it('86.md Phase B — mutateProjectBlob DOES bump the rev → a stale client autosave 409s', async () => {
    if (!dbUp) return;
    // Current rev is 3 (from the previous test). A real module writer routes through
    // mutateProjectBlob, which commits + bumps the rev to 4.
    const out = await mutateProjectBlob(proj().id, (d) => { d.moduleStamp = 'helper-write'; return { result: { ok: true } }; });
    expect(out.committed).toBe(true);
    const row = await prisma.project.findFirst({ where: { id: proj().id } });
    expect(row.autosaveRev).toBe(4);

    // A client holding the pre-write baseline (3) now 409s instead of clobbering.
    let conflict = null;
    try { await save(proj({ notes: 'stale-after-module' }), user.id, { baseRev: 3 }); }
    catch (e) { conflict = e; }
    expect(conflict && conflict.code).toBe('SAVE_CONFLICT');

    // commit:false leaves the rev untouched.
    const noop = await mutateProjectBlob(proj().id, () => ({ result: {}, commit: false }));
    expect(noop.committed).toBe(false);
    const same = await prisma.project.findFirst({ where: { id: proj().id } });
    expect(same.autosaveRev).toBe(4);
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
