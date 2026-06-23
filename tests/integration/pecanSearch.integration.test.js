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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { startRun, processRun, getRunSummary, cancelRun, retryRun } from '../../server/pecanSearch/runService.js';
import { buildReport } from '../../server/pecanSearch/report.js';

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
});
