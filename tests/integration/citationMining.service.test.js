/**
 * tests/integration/citationMining.service.test.js — P15 citation-mining SERVICE
 * tests against the real (dev SQLite) DB, with an INJECTED stub resolver (no
 * network) and an INJECTED fake pure-engine. Deterministic; creates + cleans up its
 * own rows. NOT part of the hermetic CI unit gate (it writes the shared DB) — run:
 *
 *   npx vitest run tests/integration/citationMining.service.test.js \
 *     --pool=forks --poolOptions.forks.singleFork=true
 *
 * Covers the bounded/cancellable chase loop (depth + maxCandidates caps, job-scoped
 * candidate de-dup, cancel between nodes), ingest→resolve→dedupe→import end-to-end,
 * and import provenance (a source:'citation-mining' batch + rawData provenance).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import {
  ingestSeed, resolveSeed, dedupePreview, importCandidates,
  startChase, processChase, cancelChase, getChaseJob, listReferences,
  __setEngineForTests,
} from '../../server/citationMining/citationMiningService.js';

// ── Fake pure engine (the parallel src/research-engine/citationMining) ──────────
// parseReferences: split on blank lines; pull a DOI + a trailing "(YYYY)".
const fakeEngine = {
  parseReferences(text) {
    const blocks = String(text).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    const references = blocks.map((raw, i) => {
      const doi = (raw.match(/10\.\d{4,}\/\S+/) || [''])[0].replace(/[.,;]+$/, '');
      const year = (raw.match(/\((\d{4})\)/) || [null, ''])[1];
      const title = raw.split('.')[0].slice(0, 200);
      return { index: i, raw, title, authors: [], journal: '', year, doi, pmid: '', url: '', confidence: doi ? 0.9 : 0.4 };
    });
    return { references, meta: { count: references.length, detectedStyle: 'fake', warnings: [] } };
  },
  dedupeReferences(refs) { return refs; },
  classifyAgainstExisting(rec, existing) {
    const doi = String(rec.doi || '').toLowerCase();
    const hit = existing.find((e) => doi && String(e.doi || '').toLowerCase() === doi);
    return hit ? { outcome: 'existing_match', matchedRecordId: hit.id, score: 100 } : { outcome: 'new', matchedRecordId: '', score: 0 };
  },
};

// ── Stub resolver — deterministic forward/backward fan-out, no network ──────────
// Each node yields `fanout` synthetic works whose ids encode the parent, so the BFS
// tree is predictable and every candidate id is globally unique.
function makeStubResolver({ fanout = 3 } = {}) {
  const gen = (parent, n) => Array.from({ length: n }, (_, i) => ({
    openAlexId: `W${parent}_${i}`, doi: `10.9999/${parent}-${i}`, pmid: '',
    title: `Work ${parent}-${i}`, abstract: '', year: '2020', journal: 'J Stub', authors: ['Stub A'],
    publicationType: 'article', citedByCount: 1, referencedWorks: [],
  }));
  return {
    live: true,
    async resolveReference(ref) {
      if (ref.doi) return { status: 'resolved', source: 'openalex', doi: ref.doi, pmid: '', openAlexId: `W${ref.doi.replace(/\W/g, '')}`, title: ref.title || '', year: ref.year || '2020', journal: 'J Stub', authors: [], abstract: '', referencedWorks: [], citedByCount: 1, confidence: 0.95 };
      return { status: 'not_found', source: '', doi: '', pmid: '', openAlexId: '', title: '', year: '', journal: '', authors: [], abstract: '', referencedWorks: [], citedByCount: null, confidence: 0 };
    },
    async forwardCitingWorks(openAlexId, { limit } = {}) { return gen(openAlexId || 'root', Math.min(fanout, limit || fanout)); },
    async backwardReferences(node, { limit } = {}) { return gen(node.openAlexId || 'root', Math.min(fanout, limit || fanout)); },
    async fetchOpenAlexWork() { return null; },
  };
}

let user, project;
const tag = `p15svc_${Date.now()}`;

beforeAll(async () => {
  __setEngineForTests(fakeEngine);
  user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'P15 Svc' } });
  project = await prisma.project.create({ data: { userId: user.id, name: 'P15 Service', data: '{}' } });
});

afterAll(async () => {
  try {
    const pid = project.id;
    await prisma.citationCandidate.deleteMany({ where: { metaLabProjectId: pid } });
    await prisma.citationChaseJob.deleteMany({ where: { metaLabProjectId: pid } });
    const seeds = await prisma.seedReview.findMany({ where: { metaLabProjectId: pid }, select: { id: true } });
    await prisma.extractedReference.deleteMany({ where: { seedReviewId: { in: seeds.map((s) => s.id) } } });
    await prisma.seedReview.deleteMany({ where: { metaLabProjectId: pid } });
    const sps = await prisma.screenProject.findMany({ where: { linkedMetaLabProjectId: pid }, select: { id: true } });
    for (const sp of sps) {
      await prisma.screenDecision.deleteMany({ where: { projectId: sp.id } });
      await prisma.screenRecord.deleteMany({ where: { projectId: sp.id } });
      await prisma.screenImportBatch.deleteMany({ where: { projectId: sp.id } });
      await prisma.screenExclusionReason.deleteMany({ where: { projectId: sp.id } });
      await prisma.screenProjectMember.deleteMany({ where: { projectId: sp.id } });
    }
    await prisma.screenProject.deleteMany({ where: { linkedMetaLabProjectId: pid } });
    await prisma.project.delete({ where: { id: pid } });
    await prisma.user.delete({ where: { id: user.id } });
  } catch { /* best-effort */ }
});

const SEED_TEXT = [
  'Smith J. A trial of intervention X. J Test. 10.1234/aaa (2019).',
  'Jones K. Effect of Y on Z. Lancet. 10.1234/bbb (2020).',
  'Doe A. Observational cohort of W. BMJ. (2021).', // no DOI → not_found offline/stub
].join('\n\n');

describe('P15 service — ingest → resolve → dedupe → import', () => {
  let seedId;

  it('ingestSeed parses the reference list and stores rows', async () => {
    const out = await ingestSeed(project.id, { title: 'Prior SR', filename: 'sr.pdf', text: SEED_TEXT, user });
    expect(out.referenceCount).toBe(3);
    seedId = out.seed.id;
    const refs = await listReferences(seedId);
    expect(refs.length).toBe(3);
    expect(refs[0].doi).toBe('10.1234/aaa');
    expect(refs.every((r) => r.resolutionStatus === 'pending')).toBe(true);
  });

  it('resolveSeed updates each reference status (stub resolver, no network)', async () => {
    const summary = await resolveSeed(seedId, { resolver: makeStubResolver() });
    expect(summary.total).toBe(3);
    expect(summary.resolved).toBe(2);   // the two with DOIs
    expect(summary.notFound).toBe(1);   // the DOI-less one
    const refs = await listReferences(seedId);
    const aaa = refs.find((r) => r.doi === '10.1234/aaa');
    expect(aaa.resolutionStatus).toBe('resolved');
    expect(aaa.resolvedOpenAlexId).toBeTruthy();
  });

  it('dedupePreview classifies refs against existing records', async () => {
    // Seed one existing screening record with a matching DOI.
    const sp = await prisma.screenProject.findFirst({ where: { linkedMetaLabProjectId: project.id } })
      || await prisma.screenProject.create({ data: { ownerId: user.id, title: 'linked', linkedMetaLabProjectId: project.id } });
    await prisma.screenRecord.create({ data: { projectId: sp.id, title: 'Existing', doi: '10.1234/aaa', pmid: '', authors: '', year: '2019', journal: '' } });
    const out = await dedupePreview(project.id, { refs: [{ id: 'r1', doi: '10.1234/aaa', title: 'x' }, { id: 'r2', doi: '10.1234/zzz', title: 'y' }] });
    const r1 = out.results.find((r) => r.id === 'r1');
    const r2 = out.results.find((r) => r.id === 'r2');
    expect(r1.dedupStatus).toBe('existing_match');
    expect(r2.dedupStatus).toBe('new');
  });
});

describe('P15 service — bounded citation chase', () => {
  it('respects the maxCandidates cap and depth (job-scoped de-dup)', async () => {
    // Seed a resolved reference to use as a chase seed node.
    const ing = await ingestSeed(project.id, { title: 'chase-seed', filename: 'c.pdf', text: 'Root R. Anchor study. 10.5555/root (2018).', user });
    await resolveSeed(ing.seed.id, { resolver: makeStubResolver() });
    const seedRef = (await prisma.extractedReference.findFirst({ where: { seedReviewId: ing.seed.id } }));

    const job = await startChase(project.id, { seedIds: [seedRef.id], direction: 'forward', depth: 3, maxCandidates: 5, user }, { autoKick: false });
    await processChase(job, { resolver: makeStubResolver({ fanout: 4 }) });

    const status = await getChaseJob(job.id);
    expect(status.status).toBe('completed');
    // fanout=4, depth=3 would explode past 5 without the cap → must be exactly capped.
    expect(status.nFound).toBeLessThanOrEqual(5);
    const rows = await prisma.citationCandidate.count({ where: { chaseJobId: job.id } });
    expect(rows).toBe(status.nFound);
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(5);
  });

  it('a cancel request stops the chase (cancelled, bounded)', async () => {
    const ing = await ingestSeed(project.id, { title: 'cancel-seed', filename: 'x.pdf', text: 'Root C. Anchor. 10.5555/cxl (2018).', user });
    await resolveSeed(ing.seed.id, { resolver: makeStubResolver() });
    const seedRef = await prisma.extractedReference.findFirst({ where: { seedReviewId: ing.seed.id } });

    const job = await startChase(project.id, { seedIds: [seedRef.id], direction: 'forward', depth: 3, maxCandidates: 100, user }, { autoKick: false });
    await cancelChase(job.id);                 // request cancel BEFORE processing
    await processChase(job, { resolver: makeStubResolver({ fanout: 4 }) });
    const status = await getChaseJob(job.id);
    expect(status.status).toBe('cancelled');
    expect(status.nFound).toBe(0);             // cancelled before producing any candidate
  });

  it('imports candidates into screening with a citation-mining batch + provenance', async () => {
    // Produce a couple of candidates via a small chase.
    const ing = await ingestSeed(project.id, { title: 'imp-seed', filename: 'i.pdf', text: 'Root I. Anchor. 10.5555/imp (2018).', user });
    await resolveSeed(ing.seed.id, { resolver: makeStubResolver() });
    const seedRef = await prisma.extractedReference.findFirst({ where: { seedReviewId: ing.seed.id } });
    const job = await startChase(project.id, { seedIds: [seedRef.id], direction: 'backward', depth: 1, maxCandidates: 3, user }, { autoKick: false });
    await processChase(job, { resolver: makeStubResolver({ fanout: 3 }) });

    const cands = await prisma.citationCandidate.findMany({ where: { chaseJobId: job.id } });
    expect(cands.length).toBeGreaterThan(0);
    const out = await importCandidates(project.id, cands.map((c) => c.id), user);
    expect(out.source).toBe('citation-mining');
    expect(out.imported + out.skippedDuplicates).toBeGreaterThan(0);
    expect(out.batchId).toBeTruthy();

    // Batch provenance: source column is citation-mining.
    const batch = await prisma.screenImportBatch.findUnique({ where: { id: out.batchId } });
    expect(batch.source).toBe('citation-mining');

    // Per-record provenance survives in rawData; candidates are marked imported.
    if (out.imported > 0) {
      const rec = await prisma.screenRecord.findFirst({ where: { importBatchId: out.batchId } });
      expect(rec.rawData).toContain('citationProvenance');
    }
    const stillOpen = await prisma.citationCandidate.count({ where: { id: { in: cands.map((c) => c.id) }, imported: false } });
    expect(stillOpen).toBe(0);
  });
});
