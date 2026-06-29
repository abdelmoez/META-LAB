/**
 * screening-perf-jobs.test.js (62.md) — durable AI-scoring + async-export job
 * infrastructure, against the real (dev SQLite) DB. No running server required:
 * calls the worker/service functions directly (like worker-retry-cap.test.js).
 *
 * Proves:
 *  - recoverStuckAiJobs / recoverStuckExportJobs honour the retry cap (poison-pill
 *    jobs are permanently failed; under-cap jobs re-queue; fresh jobs untouched).
 *  - enqueueManualRun / enqueueExportJob de-duplicate (an in-flight job is reused, so
 *    an impatient double-click can't start two heavy jobs).
 *  - streamExportToSink renders CSV/JSON off a paged DB read, matching the CSV schema.
 *  - computeExportCvScores degrades safely to a blank result (never throws, never leaks
 *    an in-sample score) — incl. the record cap.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { recoverStuckAiJobs, enqueueManualRun } from '../../server/services/screeningAiJobs.js';
import { recoverStuckExportJobs, enqueueExportJob } from '../../server/services/screeningExportWorker.js';
import { streamExportToSink, computeExportCvScores, EXPORT_COLUMNS } from '../../server/services/screeningExportService.js';

const tag = `perf62_${Date.now()}`;
const STALE = new Date(Date.now() - 30 * 60 * 1000); // older than STUCK_MS (15 min)
const FRESH = new Date();
const CAP = 3;

let user, project, recs;

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'Perf62' } });
  project = await prisma.screenProject.create({ data: { ownerId: user.id, title: 'Perf 62' } });
  recs = await Promise.all([
    prisma.screenRecord.create({ data: { projectId: project.id, title: 'Aspirin RCT', authors: 'A', year: '2021' } }),
    prisma.screenRecord.create({ data: { projectId: project.id, title: 'Statin review', authors: 'B', year: '2022' } }),
    prisma.screenRecord.create({ data: { projectId: project.id, title: 'Unrelated note', authors: 'C', year: '2023' } }),
  ]);
  await prisma.screenDecision.create({ data: { recordId: recs[0].id, projectId: project.id, reviewerId: user.id, stage: 'title_abstract', decision: 'include' } });
  await prisma.screenDecision.create({ data: { recordId: recs[1].id, projectId: project.id, reviewerId: user.id, stage: 'title_abstract', decision: 'exclude' } });
});

afterAll(async () => {
  try {
    await prisma.screenAiJob.deleteMany({ where: { projectId: project.id } });
    await prisma.screenExportJob.deleteMany({ where: { projectId: project.id } });
    await prisma.screenAiScore.deleteMany({ where: { projectId: project.id } });
    await prisma.screenAiRun.deleteMany({ where: { projectId: project.id } });
    await prisma.screenDecision.deleteMany({ where: { projectId: project.id } });
    await prisma.screenRecord.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProject.deleteMany({ where: { id: project.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  } catch { /* best-effort */ }
});

describe('screeningAiJobs — recoverStuckAiJobs retry cap', () => {
  it('fails over-cap, re-queues under-cap, leaves fresh running jobs alone', async () => {
    const mk = (attempts, heartbeatAt) => prisma.screenAiJob.create({
      data: { projectId: project.id, kind: 'train', status: 'running', attempts, startedAt: heartbeatAt, heartbeatAt },
    });
    const overCap = await mk(CAP, STALE);
    const underCap = await mk(CAP - 1, STALE);
    const fresh = await mk(CAP, FRESH);

    await recoverStuckAiJobs(Date.now(), CAP);

    const [a, b, c] = await Promise.all([
      prisma.screenAiJob.findUnique({ where: { id: overCap.id } }),
      prisma.screenAiJob.findUnique({ where: { id: underCap.id } }),
      prisma.screenAiJob.findUnique({ where: { id: fresh.id } }),
    ]);
    expect(a.status).toBe('failed');
    expect(b.status).toBe('queued');
    expect(c.status).toBe('running'); // fresh heartbeat → not stuck

    // tidy: drop the re-queued job so it can't be drained by a later kick
    await prisma.screenAiJob.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
  });
});

describe('screeningExportWorker — recoverStuckExportJobs retry cap', () => {
  it('fails over-cap, re-queues under-cap, leaves fresh processing jobs alone', async () => {
    const mk = (attempts, heartbeatAt) => prisma.screenExportJob.create({
      data: { projectId: project.id, createdById: user.id, status: 'processing', stage: 'rendering', attempts, startedAt: heartbeatAt, heartbeatAt },
    });
    const overCap = await mk(CAP, STALE);
    const underCap = await mk(CAP - 1, STALE);
    const fresh = await mk(CAP, FRESH);

    await recoverStuckExportJobs(Date.now(), CAP);

    const [a, b, c] = await Promise.all([
      prisma.screenExportJob.findUnique({ where: { id: overCap.id } }),
      prisma.screenExportJob.findUnique({ where: { id: underCap.id } }),
      prisma.screenExportJob.findUnique({ where: { id: fresh.id } }),
    ]);
    expect(a.status).toBe('failed');
    expect(a.stage).toBe('failed');
    expect(b.status).toBe('queued');
    expect(b.stage).toBe('queued');
    expect(c.status).toBe('processing');

    await prisma.screenExportJob.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
  });
});

describe('enqueue de-duplication (no duplicate heavy jobs)', () => {
  it('enqueueManualRun reuses an in-flight job instead of creating another', async () => {
    // A 'running' job is matched by the dedupe guard but never re-claimed by the drain.
    const existing = await prisma.screenAiJob.create({
      data: { projectId: project.id, stage: 'title_abstract', kind: 'train', status: 'running', startedAt: FRESH, heartbeatAt: FRESH },
    });
    const before = await prisma.screenAiJob.count({ where: { projectId: project.id } });
    const result = await enqueueManualRun(project.id, { stage: 'title_abstract', actor: { id: user.id, name: 'Perf62' } });
    const after = await prisma.screenAiJob.count({ where: { projectId: project.id } });
    expect(result.id).toBe(existing.id);
    expect(after).toBe(before); // no new row
    await prisma.screenAiJob.deleteMany({ where: { projectId: project.id } });
  });

  it('enqueueExportJob reuses an in-flight export with the same (format, filter)', async () => {
    const existing = await prisma.screenExportJob.create({
      data: { projectId: project.id, createdById: user.id, status: 'processing', stage: 'rendering', format: 'csv', filter: 'all', startedAt: FRESH, heartbeatAt: FRESH },
    });
    const before = await prisma.screenExportJob.count({ where: { projectId: project.id } });
    const result = await enqueueExportJob(project.id, { createdById: user.id, createdByName: 'Perf62', format: 'csv', filter: 'all' });
    const after = await prisma.screenExportJob.count({ where: { projectId: project.id } });
    expect(result.id).toBe(existing.id);
    expect(after).toBe(before);
    await prisma.screenExportJob.deleteMany({ where: { projectId: project.id } });
  });
});

describe('streamExportToSink — paged, bounded-memory render', () => {
  const blankCv = { meta: { status: 'ai_unavailable', scoreType: 'not_available', modelVersion: '' }, byRecordId: new Map(), generatedAt: '2026-01-01T00:00:00.000Z' };

  it('renders a CSV with the canonical header and one row per record', async () => {
    const chunks = [];
    const out = await streamExportToSink({ projectId: project.id, userId: user.id, format: 'csv', filter: 'all', cv: blankCv, write: (c) => { chunks.push(c); } });
    const csv = chunks.join('');
    const lines = csv.split('\n');
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(','));     // schema unchanged
    expect(lines.length).toBe(1 + 3);                    // header + 3 records
    expect(out.processed).toBe(3);
    expect(out.emitted).toBe(3);
    expect(csv).toContain('Aspirin RCT');
    expect(csv).toContain('include'); // the reviewer's decision column is populated
    expect(csv).toContain('exclude');
  });

  it('applies the decision filter', async () => {
    const chunks = [];
    const out = await streamExportToSink({ projectId: project.id, userId: user.id, format: 'csv', filter: 'include', cv: blankCv, write: (c) => { chunks.push(c); } });
    expect(out.processed).toBe(3); // all scanned
    expect(out.emitted).toBe(1);   // only the included record emitted
    expect(chunks.join('')).toContain('Aspirin RCT');
  });

  it('renders valid JSON', async () => {
    const chunks = [];
    await streamExportToSink({ projectId: project.id, userId: user.id, format: 'json', filter: 'all', cv: blankCv, write: (c) => { chunks.push(c); } });
    const arr = JSON.parse(chunks.join(''));
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(3);
    expect(arr.map(r => r.title)).toContain('Statin review');
  });
});

describe('computeExportCvScores — safe degradation + cap', () => {
  it('returns a blank (never-leaky) result and an empty map over the cap / when AI is off', async () => {
    const cv = await computeExportCvScores(project.id, { cap: 1 }); // 3 records > cap (or AI off) → blank
    expect(cv.byRecordId).toBeInstanceOf(Map);
    expect(cv.byRecordId.size).toBe(0);
    expect(cv.meta.scoreType).toBe('not_available');
  });
});
