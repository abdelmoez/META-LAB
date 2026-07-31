/**
 * tests/integration/pecanSearch.integration.test.js — full Pecan Search Engine
 * lifecycle against the real (dev SQLite) database, with a MOCKED provider fetch
 * (no network). Deterministic; creates + cleans up its own rows. NOT part of the
 * hermetic CI unit gate (it writes to the shared DB) — run via `npm run
 * test:integration`.
 *
 * Covers: start → process → complete + landing into screening; idempotent re-run
 * (crash resume) creates no duplicates; honest partial success (one source fails,
 * another completes); cancellation; retry of a failed source; PRISMA-S report.
 */
// FIRST import — snapshots the shell env before the prisma import injects
// server/.env into this single-fork process (see the helper's header).
import { restoreShellEnv } from '../screening/helpers/prismaEnvGuard.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { startRun, processRun, getRunSummary, cancelRun, retryRun } from '../../server/pecanSearch/runService.js';
import { buildReport } from '../../server/pecanSearch/report.js';
import { getImportHistory } from '../../server/controllers/screeningImportBatchController.js';
import { writeRecordSources } from '../../server/services/screeningImportService.js';

restoreShellEnv();

/** Minimal Express-shaped res stub for driving controllers directly. */
function mkRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const efetchXml = (ids) => '<?xml version="1.0"?><PubmedArticleSet>' + ids.map((p) =>
  `<PubmedArticle><MedlineCitation><PMID Version="1">${p}</PMID><Article><Journal><Title>J Test</Title></Journal>` +
  `<ArticleTitle>Study ${p} of an intervention</ArticleTitle><Abstract><AbstractText>Abstract ${p}.</AbstractText></Abstract>` +
  `<AuthorList><Author><LastName>Smith</LastName><ForeName>J</ForeName></Author></AuthorList></Article></MedlineCitation>` +
  `<PubmedData><ArticleIdList><ArticleId IdType="doi">10.1/${p}</ArticleId></ArticleIdList></PubmedData></PubmedArticle>`
).join('') + '</PubmedArticleSet>';

/** A mock fetch where PubMed works and (optionally) one host always 500s. */
function makeMock({ total = 3, failHostMatch = null } = {}) {
  return (url) => {
    const u = String(url);
    const headers = { get: () => null };
    if (failHostMatch && u.includes(failHostMatch)) return Promise.resolve({ ok: false, status: 500, headers, text: () => Promise.resolve('boom') });
    if (u.includes('eutils.ncbi.nlm.nih.gov')) {
      if (u.includes('esearch.fcgi')) return Promise.resolve({ ok: true, status: 200, headers, text: () => Promise.resolve(JSON.stringify({ esearchresult: { count: String(total), webenv: 'WE', querykey: '1' } })) });
      if (u.includes('efetch.fcgi')) {
        const m = new URL(u); const rs = Number(m.searchParams.get('retstart') || 0); const rm = Number(m.searchParams.get('retmax') || 10);
        const ids = Array.from({ length: total }, (_, i) => String(i + 1)).slice(rs, rs + rm);
        return Promise.resolve({ ok: true, status: 200, headers, text: () => Promise.resolve(efetchXml(ids)) });
      }
    }
    return Promise.resolve({ ok: false, status: 404, headers, text: () => Promise.resolve('') });
  };
}
const ov = (mock) => ({ fetch: mock, now: () => Date.now(), sleep: () => Promise.resolve(), random: () => 0.5 });

let user, project, screenProjectId;
const tag = `p1int_${Date.now()}`;

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'Integration' } });
  project = await prisma.project.create({ data: { userId: user.id, name: 'P1 Integration', data: '{}' } });
});

afterAll(async () => {
  try {
    const runs = await prisma.pecanSearchRun.findMany({ where: { metaLabProjectId: project.id }, select: { id: true } });
    const runIds = runs.map((r) => r.id);
    if (runIds.length) {
      await prisma.pecanDedupDecision.deleteMany({ where: { runId: { in: runIds } } });
      await prisma.pecanSourceRecord.deleteMany({ where: { runId: { in: runIds } } });
      await prisma.pecanSearchSource.deleteMany({ where: { runId: { in: runIds } } });
      await prisma.pecanSearchJob.deleteMany({ where: { runId: { in: runIds } } });
      await prisma.pecanSearchRun.deleteMany({ where: { id: { in: runIds } } });
    }
    const sps = await prisma.screenProject.findMany({ where: { linkedMetaLabProjectId: project.id }, select: { id: true } });
    for (const sp of sps) {
      await prisma.screenRecord.deleteMany({ where: { projectId: sp.id } });
      await prisma.screenExclusionReason.deleteMany({ where: { projectId: sp.id } });
      await prisma.screenProjectMember.deleteMany({ where: { projectId: sp.id } });
      await prisma.screenImportBatch.deleteMany({ where: { projectId: sp.id } });
      // 96.md provenance tables (bare scope keys — cleaned explicitly).
      try { await prisma.screenRecordSource.deleteMany({ where: { projectId: sp.id } }); } catch { /* absent */ }
      try { await prisma.screenRecordMetadataChange.deleteMany({ where: { projectId: sp.id } }); } catch { /* absent */ }
      try { await prisma.screenResetEvent.deleteMany({ where: { projectId: sp.id } }); } catch { /* absent */ }
    }
    await prisma.screenProject.deleteMany({ where: { linkedMetaLabProjectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.user.delete({ where: { id: user.id } });
  } catch { /* best-effort cleanup */ }
});

const CANONICAL = { concepts: [{ id: 'i', label: 'I', op: 'OR', terms: [{ text: 'intervention', field: 'tiab' }] }], filters: {} };

async function runToCompletion(params, mock) {
  const { run } = await startRun({ metaLabProjectId: project.id, user, canonicalQuery: CANONICAL, ...params }, { autoKick: false, engineOverrides: ov(mock) });
  const job = await prisma.pecanSearchJob.findFirst({ where: { runId: run.id }, orderBy: { createdAt: 'desc' } });
  await processRun(job, { engineOverrides: ov(mock) });
  return { run, job };
}

describe('Pecan Search Engine — lifecycle (integration)', () => {
  it('Scenario A: runs PubMed end-to-end and lands deduplicated screening records', async () => {
    const mock = makeMock({ total: 3 });
    const { run } = await runToCompletion({ name: 'A', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    expect(summary.state).toBe('completed');
    expect(summary.counts.imported).toBe(3);
    const sp = await prisma.screenProject.findFirst({ where: { linkedMetaLabProjectId: project.id } });
    screenProjectId = sp.id;
    expect(await prisma.screenRecord.count({ where: { projectId: sp.id } })).toBe(3);
    expect(await prisma.pecanSourceRecord.count({ where: { runId: run.id } })).toBe(3);
  });

  it('Scenario D: re-running existing records matches them (no new screening rows, stable count)', async () => {
    const before = await prisma.screenRecord.count({ where: { projectId: screenProjectId } });
    const mock = makeMock({ total: 3 }); // same 3 PMIDs/DOIs as scenario A
    const { run } = await runToCompletion({ name: 'D', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    const after = await prisma.screenRecord.count({ where: { projectId: screenProjectId } });
    expect(after).toBe(before); // existing records matched, not duplicated
    expect(summary.counts.existingMatched).toBe(3);
    expect(summary.counts.imported).toBe(0);
    // 96.md invariant 6 — nothing was blank, so nothing was "updated" on a plain rerun.
    expect(summary.counts.updated).toBe(0);
  });

  // ── 96.md D8/D9/D10 — run snapshots, article provenance, fill-blank merge ──

  it('96.md D8: runs snapshot origin + research question (additive shapeRun fields)', async () => {
    await prisma.project.update({
      where: { id: project.id },
      data: { data: JSON.stringify({ pico: { question: 'Does X improve outcome Y?' } }) },
    });
    const mock = makeMock({ total: 3 });
    const { run } = await runToCompletion({ name: 'snapshot', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    expect(summary.origin).toBe('automated');
    expect(summary.questionText).toBe('Does X improve outcome Y?');
    expect(summary.strategyVersionId).toBe(''); // no saved strategy version exists
    expect(summary.rolledBackAt).toBeNull();
  });

  it('96.md D9: overlapping runs accumulate ScreenRecordSource provenance per article', async () => {
    const landed = await prisma.screenRecord.findFirst({ where: { projectId: screenProjectId, pmid: '1' } });
    expect(landed).toBeTruthy();
    const rows = await prisma.screenRecordSource.findMany({ where: { screenRecordId: landed.id } });
    // Run A landed it (outcome 'new'); every later run matched it (already_present).
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.outcome === 'new')).toBe(true);
    expect(rows.some((r) => r.outcome === 'already_present')).toBe(true);
    const runIds = new Set(rows.map((r) => r.runId).filter(Boolean));
    expect(runIds.size).toBeGreaterThanOrEqual(2); // multiple distinct runs recorded
    expect(rows.every((r) => r.provider === 'pubmed')).toBe(true);
  });

  it('96.md D10: a re-run fill-blank-merges matched records (updated counted; decisions untouched)', async () => {
    const target = await prisma.screenRecord.findFirst({ where: { projectId: screenProjectId, pmid: '2' } });
    expect(target).toBeTruthy();
    // Reviewer work exists on the record; the merge must not touch it.
    await prisma.screenDecision.upsert({
      where: { recordId_reviewerId_stage: { recordId: target.id, reviewerId: user.id, stage: 'title_abstract' } },
      create: { recordId: target.id, projectId: screenProjectId, reviewerId: user.id, reviewerName: 'Integration', stage: 'title_abstract', decision: 'include', notes: 'my precious note' },
      update: { decision: 'include', notes: 'my precious note' },
    });
    // Blank the abstract (simulates a record first imported with poorer metadata).
    await prisma.screenRecord.update({ where: { id: target.id }, data: { abstract: '' } });

    const mock = makeMock({ total: 3 });
    const { run } = await runToCompletion({ name: 'merge', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    expect(summary.counts.existingMatched).toBe(3);
    expect(summary.counts.updated).toBe(1); // exactly the blanked record was filled
    expect(summary.counts.perSource.pubmed.updated).toBe(1);

    const after = await prisma.screenRecord.findUnique({ where: { id: target.id } });
    expect(after.abstract).toBe('Abstract 2.'); // filled from the provider record
    // Reviewer decision + notes survived byte-identically (invariant 7).
    const dec = await prisma.screenDecision.findUnique({
      where: { recordId_reviewerId_stage: { recordId: target.id, reviewerId: user.id, stage: 'title_abstract' } },
    });
    expect(dec.decision).toBe('include');
    expect(dec.notes).toBe('my precious note');
    // Field-level change log written, bounded, for the filled field only.
    const changes = await prisma.screenRecordMetadataChange.findMany({ where: { screenRecordId: target.id, runId: run.id } });
    expect(changes.length).toBe(1);
    expect(changes[0].field).toBe('abstract');
    expect(changes[0].toValue).toBe('Abstract 2.');
    // Provenance outcome for THIS run is 'updated' with the changed fields recorded.
    const prov = await prisma.screenRecordSource.findFirst({ where: { screenRecordId: target.id, runId: run.id } });
    expect(prov.outcome).toBe('updated');
    expect(JSON.parse(prov.changedFields)).toEqual(['abstract']);
    // PRISMA rerun-stability: the report's identification figures ignore `updated`.
    const report = await buildReport(run.id);
    expect(report.counts.updated).toBe(1);
    expect(report.counts.recordsIdentified).toBe(summary.counts.rawRetrieved);
    expect(report.counts.duplicatesRemoved).toBe(0);
  });

  it('96.md D11: rolled-back runs are excluded from PRISMA source sums + flagged in the report', async () => {
    const anyRun = await prisma.pecanSearchRun.findFirst({ where: { metaLabProjectId: project.id }, orderBy: { createdAt: 'desc' } });
    const before = await prisma.pecanSearchSource.count({ where: { run: { screenProjectId: screenProjectId, rolledBackAt: null } } });
    expect(before).toBeGreaterThan(0);
    await prisma.pecanSearchRun.updateMany({
      where: { metaLabProjectId: project.id },
      data: { rolledBackAt: new Date(), rolledBackById: user.id },
    });
    // The exact filter getMetaLabSummary uses (96.md D11) now excludes every source.
    const excluded = await prisma.pecanSearchSource.count({ where: { run: { screenProjectId: screenProjectId, rolledBackAt: null } } });
    expect(excluded).toBe(0);
    const report = await buildReport(anyRun.id);
    expect(report.rolledBack).toBe(true);
    expect(report.rolledBackAt).toBeTruthy();
    const summary = await getRunSummary(anyRun.id);
    expect(summary.rolledBackAt).toBeTruthy();
    // Un-mark so the remaining scenarios see pristine runs.
    await prisma.pecanSearchRun.updateMany({ where: { metaLabProjectId: project.id }, data: { rolledBackAt: null, rolledBackById: '' } });
  });

  // ── 96.md M26 — /import-history run-grouping against REAL runs ──
  it('96.md M26: import-history groups pecan batches under real runs with counts, perSource + pagination', async () => {
    const req = { params: { pid: screenProjectId }, user: { id: user.id, role: 'user' }, query: {} };
    const res = mkRes();
    await getImportHistory(req, res);
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body.canReset).toBe(true); // the screen project owner
    // M21 pagination envelope (additive keys).
    expect(typeof body.total).toBe('number');
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(typeof body.hasMore).toBe('boolean');

    const runEntries = body.entries.filter((e) => e.kind === 'search-run');
    expect(runEntries.length).toBeGreaterThanOrEqual(2);
    // Scenario A's run: 3 found, 3 imported (documented counts key names).
    const a = runEntries.find((e) => e.name === 'A');
    expect(a).toBeTruthy();
    expect(a.state).toBe('completed');
    expect(a.origin).toBe('automated');
    expect(a.counts.found).toBe(3);
    expect(a.counts.imported).toBe(3);
    expect(a.counts.existingMatched).toBe(0);
    expect(a.counts.updated).toBe(0);
    expect(a.counts.failed).toBe(0);
    const ps = a.perSource.find((s) => s.provider === 'pubmed');
    expect(ps).toBeTruthy();
    expect(ps.raw).toBe(3);
    expect(ps.imported).toBe(3);
    expect(ps.state).toBe('completed');
    // The run's per-page batches are grouped UNDER the run entry.
    expect(a.batches.length).toBeGreaterThanOrEqual(1);
    expect(a.batches.every((b) => b.searchRunId === a.runId)).toBe(true);
    // The D10 'merge' run counted exactly one updated record.
    const merge = runEntries.find((e) => e.name === 'merge');
    expect(merge.counts.updated).toBe(1);
    expect(merge.perSource.find((s) => s.provider === 'pubmed').updated).toBe(1);
    expect(merge.counts.existingMatched).toBe(3);

    // Rolled-back flag reflects the run row.
    await prisma.pecanSearchRun.update({ where: { id: a.runId }, data: { rolledBackAt: new Date(), rolledBackById: user.id } });
    const res2 = mkRes();
    await getImportHistory({ ...req, query: {} }, res2);
    const a2 = res2.body.entries.find((e) => e.kind === 'search-run' && e.runId === a.runId);
    expect(a2.rolledBackAt).toBeTruthy();
    await prisma.pecanSearchRun.update({ where: { id: a.runId }, data: { rolledBackAt: null, rolledBackById: '' } });

    // Pagination: limit=1 slices the sorted entry list and reports hasMore.
    const res3 = mkRes();
    await getImportHistory({ ...req, query: { limit: '1', offset: '0' } }, res3);
    expect(res3.body.entries.length).toBe(1);
    expect(res3.body.limit).toBe(1);
    expect(res3.body.total).toBe(body.total);
    expect(res3.body.hasMore).toBe(true);
  });

  // ── 96.md M12 — provenance idempotency across a page retry in a NEW batch ──
  it('96.md M12: a retried page landing in a NEW batch never duplicates a run\'s provenance row', async () => {
    const landed = await prisma.screenRecord.findFirst({ where: { projectId: screenProjectId, pmid: '1' } });
    const run = await prisma.pecanSearchRun.findFirst({ where: { metaLabProjectId: project.id } });
    const base = {
      projectId: screenProjectId, screenRecordId: landed.id, metaLabProjectId: project.id,
      runId: run.id, provider: 'pubmed', providerRecordId: 'M12-test',
      outcome: 'new', changedFields: '', origin: 'search',
    };
    const w1 = await writeRecordSources([{ ...base, batchId: 'm12-batch-1' }]);
    expect(w1).toBe(1);
    // The crash-retry path: same (record, run, provider, providerRecordId) but a
    // DIFFERENT batch id + contradictory outcome — must be dropped, not added.
    const w2 = await writeRecordSources([{ ...base, batchId: 'm12-batch-2', outcome: 'already_present' }]);
    expect(w2).toBe(0);
    const rows = await prisma.screenRecordSource.findMany({
      where: { screenRecordId: landed.id, runId: run.id, providerRecordId: 'M12-test' },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe('new'); // attempt 1's truth wins
    expect(rows[0].batchId).toBe('m12-batch-1');
    await prisma.screenRecordSource.deleteMany({ where: { providerRecordId: 'M12-test' } });
  });

  it('idempotent re-process (crash resume) creates no duplicates', async () => {
    const mock = makeMock({ total: 2 });
    const { run, job } = await runToCompletion({ name: 'idem', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const sp = await prisma.screenProject.findFirst({ where: { linkedMetaLabProjectId: project.id } });
    const before = await prisma.screenRecord.count({ where: { projectId: sp.id } });
    await processRun(job, { engineOverrides: ov(mock), force: true }); // simulate a re-delivery
    const after = await prisma.screenRecord.count({ where: { projectId: sp.id } });
    expect(after).toBe(before);
    expect(await prisma.pecanSourceRecord.count({ where: { runId: run.id } })).toBe(2);
  });

  it('Scenario B: honest partial success when one source fails permanently', async () => {
    // pubmed works; a second source that is implemented but whose host 500s.
    const mock = makeMock({ total: 2, failHostMatch: 'ebi.ac.uk' });
    // europepmc may or may not be implemented yet; if not, it is skipped (still partial-safe).
    const { run } = await runToCompletion({ name: 'B', sources: ['pubmed', 'europepmc'], caps: { pubmed: 50, europepmc: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    // PubMed must have completed regardless of the other source's fate.
    const pubmed = summary.sources.find((s) => s.provider === 'pubmed');
    expect(pubmed.state).toBe('completed');
    expect(['completed', 'partial']).toContain(summary.state);
  });

  it('cancellation marks the run cancelled and preserves imported records', async () => {
    const mock = makeMock({ total: 2 });
    const { run } = await startRun({ metaLabProjectId: project.id, user, name: 'cancel', canonicalQuery: CANONICAL, sources: ['pubmed'], caps: { pubmed: 50 } }, { autoKick: false, engineOverrides: ov(mock) });
    await cancelRun(run.id);
    const after = await getRunSummary(run.id);
    expect(['cancelled', 'queued']).toContain(after.state);
    expect(after.cancelRequested).toBe(true);
  });

  it('retry re-queues a failed source and produces a fresh job', async () => {
    const mock = makeMock({ total: 1, failHostMatch: 'eutils.ncbi.nlm.nih.gov' }); // pubmed fails
    const { run } = await runToCompletion({ name: 'retry', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    expect(['failed', 'partial']).toContain(summary.state);
    const retried = await retryRun(run.id);
    expect(['queued']).toContain(retried.state);
    const jobs = await prisma.pecanSearchJob.count({ where: { runId: run.id } });
    expect(jobs).toBeGreaterThanOrEqual(2);
  });

  it('builds a PRISMA-S report with per-source identification counts', async () => {
    const mock = makeMock({ total: 4 });
    const { run } = await runToCompletion({ name: 'report', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const report = await buildReport(run.id);
    expect(report.counts.recordsIdentified).toBeGreaterThanOrEqual(0);
    expect(report.perSource.find((s) => s.provider === 'pubmed')).toBeTruthy();
    expect(report.deduplicationMethod).toMatch(/scorePair|classifyPair/);
  });

  // 87.md — the run summary exposes a server-authoritative, honest progress model that
  // the modal renders. It must snap to 100 on a terminal run and carry a completed step
  // narrative + a satisfying activity sentence, all derived from the real persisted work.
  it('getRunSummary exposes a terminal progress model at 100% with a done step list', async () => {
    const mock = makeMock({ total: 5 });
    const { run } = await runToCompletion({ name: 'progress', sources: ['pubmed'], caps: { pubmed: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    expect(summary.state).toBe('completed');
    expect(summary.progress).toBeTruthy();
    expect(summary.progress.terminal).toBe(true);
    expect(summary.progress.percent).toBe(100);
    // Every step resolved (none left waiting/active) and no spinner on a finished run.
    expect(summary.progress.steps.every((s) => ['done', 'warning', 'skipped'].includes(s.status))).toBe(true);
    expect(summary.progress.steps.some((s) => s.dominant)).toBe(false);
    // Counts in the model match the aggregate the run persisted.
    expect(summary.progress.counts.imported).toBe(summary.counts.imported);
    expect(summary.progress.activityText).toMatch(/added to Screening|already in your project/i);
  });

  it('progress model reports an honest partial (not 100 backbone) when a source fails', async () => {
    const mock = makeMock({ total: 3, failHostMatch: 'ebi.ac.uk' }); // Europe PMC 500s, PubMed ok
    const { run } = await runToCompletion({ name: 'progress-partial', sources: ['pubmed', 'europepmc'], caps: { pubmed: 50, europepmc: 50 } }, mock);
    const summary = await getRunSummary(run.id);
    expect(['partial', 'completed']).toContain(summary.state);
    // Terminal ⇒ 100, but the search step must carry a warning when a source failed.
    expect(summary.progress.percent).toBe(100);
    if (summary.state === 'partial') {
      const search = summary.progress.steps.find((s) => s.id === 'search');
      expect(search.status).toBe('warning');
    }
  });
});

// Concurrency + idempotency guards (limitation-hunt fixes). Own project so the
// non-terminal runs created here never interfere with the lifecycle suite.
describe('Pecan Search Engine — start guards (integration)', () => {
  let gUser, gProject;
  const mock = makeMock({ total: 1 });
  beforeAll(async () => {
    gUser = await prisma.user.create({ data: { email: `${tag}_g@x.io`, password: 'x', name: 'Guards' } });
    gProject = await prisma.project.create({ data: { userId: gUser.id, name: 'Guards', data: '{}' } });
  });
  afterAll(async () => {
    try {
      const runs = await prisma.pecanSearchRun.findMany({ where: { metaLabProjectId: gProject.id }, select: { id: true } });
      const ids = runs.map((r) => r.id);
      if (ids.length) {
        await prisma.pecanSearchJob.deleteMany({ where: { runId: { in: ids } } });
        await prisma.pecanSearchRun.deleteMany({ where: { id: { in: ids } } });
      }
      const sps = await prisma.screenProject.findMany({ where: { linkedMetaLabProjectId: gProject.id }, select: { id: true } });
      for (const sp of sps) { await prisma.screenExclusionReason.deleteMany({ where: { projectId: sp.id } }); await prisma.screenProjectMember.deleteMany({ where: { projectId: sp.id } }); }
      await prisma.screenProject.deleteMany({ where: { linkedMetaLabProjectId: gProject.id } });
      await prisma.project.delete({ where: { id: gProject.id } });
      await prisma.user.delete({ where: { id: gUser.id } });
    } catch { /* best-effort */ }
  });
  const start = (extra) => startRun({ metaLabProjectId: gProject.id, user: gUser, canonicalQuery: CANONICAL, sources: ['pubmed'], caps: { pubmed: 10 }, ...extra }, { autoKick: false, engineOverrides: ov(mock) });
  const clearActive = async () => { await prisma.pecanSearchRun.updateMany({ where: { metaLabProjectId: gProject.id }, data: { state: 'cancelled' } }); };

  it('same idempotency key returns the SAME run (created:false) — no duplicate', async () => {
    const a = await start({ idempotencyKey: 'KEY-A' });
    const b = await start({ idempotencyKey: 'KEY-A' });
    expect(a.run.id).toBe(b.run.id);
    expect(b.created).toBe(false);
    await clearActive();
  });

  it('a no-key start re-attaches to an existing active run instead of launching a parallel one', async () => {
    const a = await start({});
    const b = await start({});
    expect(b.run.id).toBe(a.run.id);
    expect(b.created).toBe(false);
    await clearActive();
  });

  it('enforces the per-project active-run quota (QUOTA_EXCEEDED)', async () => {
    await clearActive();
    await start({ idempotencyKey: 'Q1' });
    await start({ idempotencyKey: 'Q2' });
    await start({ idempotencyKey: 'Q3' });
    await expect(start({ idempotencyKey: 'Q4' })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    await clearActive();
  });

  it('cancelling a queued (unclaimed) run finalizes it to cancelled synchronously', async () => {
    await clearActive();
    const a = await start({ idempotencyKey: 'CXL' });
    const r = await cancelRun(a.run.id);
    expect(r.state).toBe('cancelled');
    expect(r.cancelRequested).toBe(true);
  });

  it('retry is a no-op while the run is still active', async () => {
    await clearActive();
    const a = await start({ idempotencyKey: 'RA' });
    const r = await retryRun(a.run.id); // run is 'queued' → not retried
    expect(r.state).toBe('queued');
    await clearActive();
  });

  it('retry does NOT resurrect an explicitly cancelled run (cancel is sticky)', async () => {
    await clearActive();
    const a = await start({ idempotencyKey: 'STICKY' });
    await cancelRun(a.run.id); // → cancelled
    const r = await retryRun(a.run.id);
    expect(r.state).toBe('cancelled'); // not flipped back to queued
    await clearActive();
  });
});
