/**
 * adminMetrics.js — admin-only runtime metrics (93.md Phase 10 observability).
 *
 * GET /api/admin/metrics/runtime → process + queue health for load testing and
 * beta operations: event-loop delay percentiles, memory, uptime, DB ping latency,
 * and the queued/processing depth of every durable job table. Everything here
 * is operational telemetry — no user content, no secrets, no connection info.
 * (Mounted at /metrics/runtime, not /metrics — the bare path belongs to the
 * legacy Admin Console dashboard metrics in routes/admin.js.)
 *
 * Mounted with requireAuth + requireAdmin in index.js (admin-only: these are
 * infrastructure fingerprints; see prompt 52's fingerprinting policy).
 */
import { Router } from 'express';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { prisma } from '../db/client.js';

// Sample continuously from module load; 20ms resolution is cheap (<0.1% CPU).
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

const MS = 1e6; // histogram reports nanoseconds

/** Depth of one durable-job table; returns null (and omits) when unavailable. */
async function jobDepth(model, queuedWhere, processingWhere) {
  try {
    const [queued, processing] = await Promise.all([
      model.count({ where: queuedWhere }),
      model.count({ where: processingWhere }),
    ]);
    return { queued, processing };
  } catch {
    return null;
  }
}

const router = Router();

router.get('/', async (_req, res) => {
  const mem = process.memoryUsage();

  let dbPingMs = null;
  try {
    const t0 = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    dbPingMs = Math.round(performance.now() - t0);
  } catch { /* reported as null — readiness endpoint owns hard failures */ }

  const queues = {};
  const defs = [
    ['import',      () => prisma.screenImportJob,    { status: 'queued' },  { status: 'processing' }],
    ['export',      () => prisma.screenExportJob,    { status: 'queued' },  { status: 'processing' }],
    ['duplicates',  () => prisma.screenDuplicateJob, { status: 'queued' },  { status: 'processing' }],
    ['aiScoring',   () => prisma.screenAiRun,        { status: 'queued' },  { status: 'running' }],
    ['fullText',    () => prisma.fullTextJob,        { status: 'queued' },  { status: 'processing' }],
  ];
  for (const [name, getModel, q, p] of defs) {
    try {
      const depth = await jobDepth(getModel(), q, p);
      if (depth) queues[name] = depth;
    } catch { /* model absent in this schema build — skip */ }
  }

  res.json({
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    eventLoopDelayMs: {
      p50: +(loopDelay.percentile(50) / MS).toFixed(2),
      p95: +(loopDelay.percentile(95) / MS).toFixed(2),
      p99: +(loopDelay.percentile(99) / MS).toFixed(2),
      max: +(loopDelay.max / MS).toFixed(2),
    },
    memory: {
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
      externalMb: Math.round(mem.external / 1048576),
    },
    dbPingMs,
    queues,
  });
  // Reset max between reads so each poll window reports its own worst case.
  loopDelay.reset();
});

export default router;
