/**
 * screening-reset.test.js — 96.md Phases 5/6 (server): metadata merge on
 * duplicate import, import-history timeline, and the scoped "delete imported
 * records" reset (typed confirm, job fence, mixed-scope deletion, permissions,
 * re-import after reset).
 * Requires the API on :3001 — tests report SKIPPED (ctx.skip) when it is down,
 * never a silent green (M28).
 */
// FIRST import — snapshots the shell env before the prisma import injects
// server/.env into this single-fork process (see the helper's header).
import { restoreShellEnv } from '../helpers/prismaEnvGuard.js';
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../../server/db/client.js';

restoreShellEnv();

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}
async function register(email) { const r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!', name: 'reset' }) }); return cookieFrom(r); }

/** n RIS records tagged `tag`; withAbstract controls the AB line. */
const risRecords = (n, tag, withAbstract) => Array.from({ length: n }, (_, i) =>
  `TY  - JOUR\nTI  - ${tag} reset study ${i}\nAU  - Author ${i}\nPY  - 2021\nDO  - 10.2000/${tag}${i}\n${withAbstract ? `AB  - Abstract for ${tag} ${i}\n` : ''}ER  - `).join('\n');

beforeAll(async () => { try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; } });

describe('96.md — merge on duplicate import + import history + reset', () => {
  it('full journey: merge fills blanks, history lists batches, reset deletes scoped data, re-import works', async (ctx) => {
    if (!up) return ctx.skip();
    const cookie = await register(`reset_${rnd()}@t.local`);
    const title = `Reset target ${rnd()}`;
    const create = await api('/screening/projects', { method: 'POST', cookie, body: { title } });
    const pid = create.data.id;
    const tag = `rst${rnd()}`;

    // 1) Import file A — 10 records WITHOUT abstracts.
    const a = await api(`/screening/projects/${pid}/import`, { method: 'POST', cookie, body: { format: 'auto', content: risRecords(10, tag, false), filename: 'a.ris' } });
    expect(a.status).toBe(200);
    expect(a.data.imported).toBe(10);
    expect(a.data.updated).toBe(0); // additive field present from day one

    // 2) Reviewer work exists (must survive the merge).
    const list = await api(`/screening/projects/${pid}/records?limit=10`, { cookie });
    const rid = list.data.records[0].id;
    const dec = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie, body: { decision: 'include', notes: 'precious note' } });
    expect(dec.status).toBe(200);

    // 3) Import file B — same 10 DOIs/titles WITH abstracts → fill-blank merge.
    const b = await api(`/screening/projects/${pid}/import`, { method: 'POST', cookie, body: { format: 'auto', content: risRecords(10, tag, true), filename: 'b.ris' } });
    expect(b.status).toBe(200);
    expect(b.data.imported).toBe(0);
    expect(b.data.skippedDuplicates).toBe(10);
    expect(b.data.updated).toBe(10); // every record had its blank abstract filled

    const after = await api(`/screening/projects/${pid}/records?limit=10`, { cookie });
    expect(after.data.records.every((r) => r.abstract && r.abstract.length > 0)).toBe(true);
    const mine = await api(`/screening/projects/${pid}/decisions`, { cookie });
    const kept = mine.data.decisions.find((d) => d.recordId === rid);
    expect(kept.decision).toBe('include');
    expect(kept.notes).toBe('precious note'); // reviewer work untouched (invariant 7)

    // 4) Import history timeline — two batch entries, no run entries, capability
    //    flags, and the M21 pagination envelope.
    const hist = await api(`/screening/projects/${pid}/import-history`, { cookie });
    expect(hist.status).toBe(200);
    expect(hist.data.canReset).toBe(true);
    expect(hist.data.total).toBe(2);
    expect(hist.data.hasMore).toBe(false);
    expect(hist.data.limit).toBe(50);
    expect(hist.data.offset).toBe(0);
    const batchEntries = hist.data.entries.filter((e) => e.kind === 'batch');
    expect(batchEntries.length).toBe(2);
    expect(batchEntries.every((e) => e.searchRunId === '')).toBe(true);
    const bBatch = batchEntries.find((e) => e.filename === 'b.ris');
    expect(bBatch.updatedCount).toBe(10);

    // 5) Preview — scope 'search' finds nothing (file imports are out of scope).
    const prevSearch = await api(`/screening/projects/${pid}/imported-records/reset-preview?scope=search`, { cookie });
    expect(prevSearch.status).toBe(200);
    expect(prevSearch.data.counts.records).toBe(0);
    expect(prevSearch.data.counts.manualRecordsKept).toBe(10);
    expect(prevSearch.data.searchHistoryRemains).toBe(true);
    expect(prevSearch.data.undoable).toBe(false);
    expect(prevSearch.data.confirmToken).toBe(title); // L14 — token the UI must require

    //    Scope 'all' counts everything incl. reviewer work to be lost.
    const prevAll = await api(`/screening/projects/${pid}/imported-records/reset-preview?scope=all`, { cookie });
    expect(prevAll.data.counts.records).toBe(10);
    expect(prevAll.data.counts.batches).toBe(2);
    expect(prevAll.data.counts.decisions).toBeGreaterThanOrEqual(1);
    expect(prevAll.data.counts.notes).toBeGreaterThanOrEqual(1);
    expect(prevAll.data.projectName).toBe(title);

    // 6) Typed confirm is server-validated.
    const bad = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie, body: { scope: 'all', confirm: 'wrong name' } });
    expect(bad.status).toBe(400);
    const badScope = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie, body: { scope: 'everything', confirm: title } });
    expect(badScope.status).toBe(400);

    // 7) Job fence — an active import job blocks the reset with 409.
    const job = await prisma.screenImportJob.create({
      data: { projectId: pid, createdById: 'fence', status: 'queued', stage: 'queued', filename: 'fence.ris' },
    });
    const fenced = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie, body: { scope: 'all', confirm: title } });
    expect(fenced.status).toBe(409);
    expect(fenced.data.code).toBe('JOBS_ACTIVE');
    await prisma.screenImportJob.delete({ where: { id: job.id } });

    // 8) Scope 'search' reset is a safe no-op here (manual imports kept).
    const rSearch = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie, body: { scope: 'search', confirm: title } });
    expect(rSearch.status).toBe(200);
    expect(rSearch.data.counts.records).toBe(0);
    expect(rSearch.data.counts.manualRecordsKept).toBe(10);
    const still = await api(`/screening/projects/${pid}/records?limit=10`, { cookie });
    expect(still.data.total).toBe(10);

    // 9) Scope 'all' reset removes everything transactionally.
    const rAll = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie, body: { scope: 'all', confirm: title } });
    expect(rAll.status).toBe(200);
    expect(rAll.data.deleted).toBe(true);
    expect(rAll.data.counts.records).toBe(10);
    expect(rAll.data.counts.batches).toBe(2);
    const empty = await api(`/screening/projects/${pid}/records?limit=10`, { cookie });
    expect(empty.data.total).toBe(0);
    const histAfter = await api(`/screening/projects/${pid}/import-history`, { cookie });
    expect(histAfter.data.entries.length).toBe(0);

    // 10) Re-importing the SAME file after the reset works (no duplicate_import 409).
    const again = await api(`/screening/projects/${pid}/import`, { method: 'POST', cookie, body: { format: 'auto', content: risRecords(10, tag, false), filename: 'a.ris' } });
    expect(again.status).toBe(200);
    expect(again.data.imported).toBe(10);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie });
  }, 60000);

  it('mixed project (M27): scope "search" deletes pecan records, keeps file + shared records, marks the run', async (ctx) => {
    if (!up) return ctx.skip();
    const cookie = await register(`rstm_${rnd()}@t.local`);
    const title = `Mixed reset ${rnd()}`;
    const create = await api('/screening/projects', { method: 'POST', cookie, body: { title } });
    const pid = create.data.id;
    const tag = `mx${rnd()}`;

    // 1) A REAL file import (5 records) through the API.
    const f = await api(`/screening/projects/${pid}/import`, { method: 'POST', cookie, body: { format: 'auto', content: risRecords(5, tag, true), filename: 'manual.ris' } });
    expect(f.status).toBe(200);
    expect(f.data.imported).toBe(5);

    // 2) Seed a completed pecan run + its batches/records directly (the pipeline
    //    shape: modern batch with searchRunId + a LEGACY batch whose only run
    //    attribution is the synthetic fileHash — M16 must scope both).
    const run = await prisma.pecanSearchRun.create({
      data: { metaLabProjectId: `mlp_${tag}`, screenProjectId: pid, state: 'completed', name: 'Seeded search' },
    });
    const batch = await prisma.screenImportBatch.create({
      data: { projectId: pid, filename: 'pubmed search', format: 'pecan-search', source: 'pecan-search', searchRunId: run.id, fileHash: `pecan:${run.id}:pubmed:1`, recordCount: 3 },
    });
    await prisma.screenRecord.createMany({
      data: [0, 1, 2].map((i) => ({ projectId: pid, importBatchId: batch.id, title: `${tag} pecan ${i}`, doi: `10.9000/${tag}${i}` })),
    });
    const pecanRecs = await prisma.screenRecord.findMany({ where: { importBatchId: batch.id }, orderBy: { title: 'asc' } });
    const legacyBatch = await prisma.screenImportBatch.create({
      data: { projectId: pid, filename: 'legacy pecan', format: 'pecan-search', source: 'file', searchRunId: '', fileHash: `pecan:${run.id}:pubmed:2`, recordCount: 1 },
    });
    await prisma.screenRecord.create({
      data: { projectId: pid, importBatchId: legacyBatch.id, title: `${tag} legacy pecan`, doi: `10.9000/${tag}L` },
    });

    // 3) L22 — one pecan record ALSO has file provenance (a manual upload found
    //    it too): the search reset must KEEP it and strip only its search rows.
    const sharedRec = pecanRecs[0];
    await prisma.screenRecordSource.createMany({
      data: [
        { projectId: pid, screenRecordId: sharedRec.id, runId: run.id, batchId: batch.id, provider: 'pubmed', providerRecordId: 'shared-1', outcome: 'new', origin: 'search' },
        { projectId: pid, screenRecordId: sharedRec.id, runId: '', batchId: '', provider: '', providerRecordId: '', outcome: 'already_present', origin: 'file' },
      ],
    });

    // 4) H2 — a duplicate group pairing a FILE record with a pecan primary: the
    //    reset deletes the primary, so the surviving file record must be
    //    un-flagged and the dead group dissolved.
    const fileRec = await prisma.screenRecord.findFirst({ where: { projectId: pid, title: { contains: `${tag} reset study 0` } } });
    const group = await prisma.screenDuplicateGroup.create({ data: { projectId: pid, primaryId: pecanRecs[1].id, resolvedAt: new Date() } });
    await prisma.screenRecord.update({ where: { id: pecanRecs[1].id }, data: { duplicateGroupId: group.id, isPrimary: true, isDuplicate: false } });
    await prisma.screenRecord.update({ where: { id: fileRec.id }, data: { duplicateGroupId: group.id, isDuplicate: true, isPrimary: false } });

    // 5) M17/L21 — a validation sample + a pending engine dedup decision that
    //    reference records the reset deletes must be cleaned up too.
    await prisma.screenValidationSample.create({
      data: { projectId: pid, seed: 7, size: 2, recordIds: JSON.stringify([pecanRecs[1].id, pecanRecs[2].id]) },
    });
    await prisma.pecanDedupDecision.create({
      data: { runId: run.id, sourceRecordId: 'seed-src', matchedScreenRecordId: pecanRecs[2].id, decision: 'pending', decisionSource: 'pending' },
    });

    // 6) Preview reflects the mixed scope: 9 records total; 4 in search batches;
    //    the shared one is excluded → 3 to delete, 6 kept.
    const prev = await api(`/screening/projects/${pid}/imported-records/reset-preview?scope=search`, { cookie });
    expect(prev.status).toBe(200);
    expect(prev.data.counts.records).toBe(3);
    expect(prev.data.counts.batches).toBe(2);
    expect(prev.data.counts.manualRecordsKept).toBe(6);
    expect(prev.data.counts.runsAffected).toBe(1);
    expect(prev.data.confirmToken).toBe(title);

    // 7) The reset itself.
    const r = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie, body: { scope: 'search', confirm: title } });
    expect(r.status).toBe(200);
    expect(r.data.counts.records).toBe(3);
    expect(r.data.counts.batches).toBe(2);
    expect(r.data.counts.runsMarked).toBe(1);
    expect(r.data.counts.manualRecordsKept).toBe(6);

    // 8) File records + the shared pecan record survive; pecan-only records gone.
    const still = await api(`/screening/projects/${pid}/records?limit=50`, { cookie });
    expect(still.data.total).toBe(6);
    // The shared record survives (its importBatchId nulls out when the batch row
    // is deleted — optional relation, SetNull); the two pecan-only ones are gone.
    expect(await prisma.screenRecord.count({ where: { id: sharedRec.id } })).toBe(1);
    expect(await prisma.screenRecord.count({ where: { id: { in: [pecanRecs[1].id, pecanRecs[2].id] } } })).toBe(0);
    expect(await prisma.screenImportBatch.count({ where: { id: { in: [batch.id, legacyBatch.id] } } })).toBe(0);

    //    L22 — the shared record kept its file provenance, lost its search rows.
    const sharedRows = await prisma.screenRecordSource.findMany({ where: { screenRecordId: sharedRec.id } });
    expect(sharedRows.some((row) => row.origin === 'file')).toBe(true);
    expect(sharedRows.some((row) => row.origin === 'search')).toBe(false);

    //    H2 — the surviving file record was un-flagged and detached; group gone.
    const fr = await prisma.screenRecord.findUnique({ where: { id: fileRec.id } });
    expect(fr.isDuplicate).toBe(false);
    expect(fr.duplicateGroupId).toBeNull();
    expect(await prisma.screenDuplicateGroup.count({ where: { id: group.id } })).toBe(0);

    //    M17/L21 — validation sample + pending dedup decision removed.
    expect(await prisma.screenValidationSample.count({ where: { projectId: pid } })).toBe(0);
    expect(await prisma.pecanDedupDecision.count({ where: { runId: run.id, decision: 'pending' } })).toBe(0);

    //    The run survives, MARKED rolled back.
    const runAfter = await prisma.pecanSearchRun.findUnique({ where: { id: run.id } });
    expect(runAfter).toBeTruthy();
    expect(runAfter.rolledBackAt).toBeTruthy();

    // 9) History shows the rolled-back run entry (its batches gone) + file batch.
    const hist = await api(`/screening/projects/${pid}/import-history`, { cookie });
    const runEntry = hist.data.entries.find((e) => e.kind === 'search-run' && e.runId === run.id);
    expect(runEntry).toBeTruthy();
    expect(runEntry.rolledBackAt).toBeTruthy();
    expect(runEntry.batches.length).toBe(0);
    expect(hist.data.entries.some((e) => e.kind === 'batch' && e.filename === 'manual.ris')).toBe(true);

    // Cleanup (run cascades sources/decisions; project soft-deletes via API).
    await prisma.pecanSearchRun.delete({ where: { id: run.id } });
    await prisma.screenRecordSource.deleteMany({ where: { projectId: pid } });
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie });
  }, 60000);

  it('permissions: outsiders get 404 (existence hiding) on preview and reset', async (ctx) => {
    if (!up) return ctx.skip();
    const owner = await register(`rsto_${rnd()}@t.local`);
    const outsider = await register(`rstx_${rnd()}@t.local`);
    const title = `Reset perms ${rnd()}`;
    const create = await api('/screening/projects', { method: 'POST', cookie: owner, body: { title } });
    const pid = create.data.id;

    const prev = await api(`/screening/projects/${pid}/imported-records/reset-preview?scope=all`, { cookie: outsider });
    expect(prev.status).toBe(404);
    const reset = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie: outsider, body: { scope: 'all', confirm: title } });
    expect(reset.status).toBe(404);
    const hist = await api(`/screening/projects/${pid}/import-history`, { cookie: outsider });
    expect(hist.status).toBe(404);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner });
  });

  it('permissions (M28): a reviewer MEMBER gets 403 on preview/reset and canReset:false in history', async (ctx) => {
    if (!up) return ctx.skip();
    const owner = await register(`rstmo_${rnd()}@t.local`);
    const memberEmail = `rstmm_${rnd()}@t.local`;
    const memberCookie = await register(memberEmail);
    const title = `Reset member ${rnd()}`;
    const create = await api('/screening/projects', { method: 'POST', cookie: owner, body: { title } });
    const pid = create.data.id;

    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: owner, body: { email: memberEmail, preset: 'reviewer' } });
    expect(add.status).toBe(201);

    // Member CAN read history, but the capability flag is off…
    const hist = await api(`/screening/projects/${pid}/import-history`, { cookie: memberCookie });
    expect(hist.status).toBe(200);
    expect(hist.data.canReset).toBe(false);
    expect(hist.data.canDelete).toBe(false);
    // …and the destructive endpoints refuse with a descriptive 403 (not 404 —
    // the member legitimately knows the project exists).
    const prev = await api(`/screening/projects/${pid}/imported-records/reset-preview?scope=all`, { cookie: memberCookie });
    expect(prev.status).toBe(403);
    const reset = await api(`/screening/projects/${pid}/imported-records/reset`, { method: 'POST', cookie: memberCookie, body: { scope: 'all', confirm: title } });
    expect(reset.status).toBe(403);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner });
  });
});
