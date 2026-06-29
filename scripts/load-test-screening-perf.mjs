#!/usr/bin/env node
/**
 * load-test-screening-perf.mjs (62.md) — demonstrate, on a realistic large project,
 * that AI scoring + export no longer block the single Node event loop.
 *
 * Usage:   node scripts/load-test-screening-perf.mjs [N=5000]
 *
 * What it shows:
 *  1. SCORING — the same compute run INLINE (the old in-request behaviour) vs in the
 *     WORKER_THREAD pool (the 62.md fix). It reports wall-clock AND the worst
 *     event-loop block during the run. Inline blocks the loop for ~the whole compute
 *     (the "whole app freezes" symptom); the worker keeps the loop free (max block is
 *     just the message serialisation), so concurrent HTTP requests keep being served.
 *  2. EXPORT — streams N records to an in-memory sink page-by-page and reports peak RSS
 *     growth, proving memory stays bounded instead of buffering the whole CSV.
 *
 * No HTTP server required. Seeds + cleans up its own temp project in the dev DB.
 */
import { performance } from 'node:perf_hooks';
import { prisma } from '../server/db/client.js';

const N = Math.max(100, Number(process.argv[2]) || 5000);

const picoSnapshot = {
  P: 'adults with chronic heart failure', I: 'beta blockers', O: 'mortality',
  incl: 'Randomized controlled trials in heart failure patients',
  excl: 'Editorials, reviews, and policy commentary',
};

function genRecords(n, nLabeled) {
  const records = []; const labelByRecordId = {};
  for (let i = 0; i < n; i++) {
    const inc = i % 2 === 0;
    const id = `lt${i}`;
    records.push({
      id,
      title: inc
        ? `Randomized controlled trial ${i} of beta blocker therapy in chronic heart failure`
        : `Narrative review ${i} of hospital administration and billing policy`,
      abstract: inc
        ? 'A double-blind randomized placebo-controlled trial assessing mortality in patients with reduced ejection fraction heart failure receiving beta blocker therapy.'
        : 'An editorial commentary discussing healthcare funding, administration, and journal formatting guidelines unrelated to clinical outcomes.',
      year: inc ? '2020' : '2019', authors: 'Author', journal: 'J', keywords: inc ? 'heart failure; rct' : 'policy',
    });
    // A large settled-decision cohort → heavy k-fold CV (the real CPU cost).
    if (i < nLabeled) labelByRecordId[id] = inc ? 'include' : 'exclude';
  }
  return { records, labelByRecordId };
}

async function measure(fn) {
  // A 10ms ticker on the main thread: if the event loop is blocked by a synchronous
  // compute, the ticker can't fire — the gap when it resumes IS the worst block. This
  // is reliable across a single uninterrupted block (unlike monitorEventLoopDelay).
  if (global.gc) global.gc();
  const rss0 = process.memoryUsage().rss;
  const gaps = [];
  let last = performance.now();
  const ticker = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 10);
  const t0 = performance.now();
  const r = await fn();
  const ms = performance.now() - t0;
  // Yield ONE loop turn so the tick pending since before a fully-blocking run finally
  // fires and records the block (otherwise clearInterval cancels it in the same
  // microtask continuation and a 100%-blocking run would misreport as 0ms).
  await new Promise(res => setImmediate(res));
  clearInterval(ticker);
  const rssPeak = process.memoryUsage().rss;
  // If the ticker NEVER fired during a multi-ms run, the loop was blocked the entire
  // time (a fully-synchronous compute) → the block ≈ the wall-clock. Otherwise the worst
  // observed gap IS the worst block (the loop was free between ticks).
  const maxLoopBlockMs = gaps.length ? +Math.max(...gaps).toFixed(1) : +ms.toFixed(1);
  return { ms: Math.round(ms), maxLoopBlockMs, rssDeltaMB: +((rssPeak - rss0) / 1048576).toFixed(1), r };
}

function row(label, m, extra = '') {
  return `  ${label.padEnd(34)} wall=${String(m.ms).padStart(7)}ms  maxLoopBlock=${String(m.maxLoopBlockMs).padStart(8)}ms  ${extra}`;
}

async function main() {
  const nLabeled = Math.min(N, 2000); // big labelled cohort → heavy CV (the real cost)
  console.log(`\n=== 62.md screening perf load test — N=${N} records, ${nLabeled} labelled ===\n`);
  const { records, labelByRecordId } = genRecords(N, nLabeled);
  const job = { records, labelByRecordId, picoSnapshot };
  const tiny = { records: records.slice(0, 60), labelByRecordId: Object.fromEntries(Object.entries(labelByRecordId).slice(0, 60)), picoSnapshot };

  // ── 1. SCORING: inline (old) vs worker (fix) ───────────────────────────────
  console.log('1) AI scoring compute (trainAndScore + crossValidate)\n');

  process.env.AI_COMPUTE_INLINE = '1'; delete process.env.AI_COMPUTE_WORKER;
  const inlineMod = await import('../server/services/aiCompute.js?mode=inline');
  await inlineMod.runTrainAndScore(tiny); // warm up module load so we time COMPUTE, not import
  const inline = await measure(async () => {
    const s = await inlineMod.runTrainAndScore(job);
    await inlineMod.runCrossValidate(job);
    return s;
  });
  console.log(row('INLINE  (old in-request path)', inline, `scored=${inline.r.scores.length}`));

  delete process.env.AI_COMPUTE_INLINE; process.env.AI_COMPUTE_WORKER = '1';
  const workerMod = await import('../server/services/aiCompute.js?mode=worker');
  await workerMod.runTrainAndScore(tiny); // warm up worker spawn + in-thread module load
  const worker = await measure(async () => {
    const s = await workerMod.runTrainAndScore(job);
    await workerMod.runCrossValidate(job);
    return s;
  });
  console.log(row('WORKER  (62.md fix)', worker, `scored=${worker.r.scores.length}  mode=${workerMod.computeMode()}`));
  await workerMod.shutdownCompute();

  const blockReduction = inline.maxLoopBlockMs > 0 ? Math.round((1 - worker.maxLoopBlockMs / inline.maxLoopBlockMs) * 100) : 0;
  console.log(`\n  → event-loop block during scoring cut by ~${blockReduction}% ` +
    `(${inline.maxLoopBlockMs}ms → ${worker.maxLoopBlockMs}ms). The web loop stays responsive while the worker computes.\n`);

  // ── 2. EXPORT: streamed, bounded memory ────────────────────────────────────
  console.log('2) Export streaming (bounded memory)\n');
  let user, project;
  try {
    const tag = `loadtest_${Date.now()}`;
    user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'LoadTest' } });
    project = await prisma.screenProject.create({ data: { ownerId: user.id, title: 'Load Test' } });
    // Bulk-insert N records.
    const CHUNK = 1000;
    for (let i = 0; i < records.length; i += CHUNK) {
      await prisma.screenRecord.createMany({
        data: records.slice(i, i + CHUNK).map(r => ({ projectId: project.id, title: r.title, authors: r.authors, year: r.year, journal: r.journal, abstract: r.abstract })),
      });
    }
    const { streamExportToSink } = await import('../server/services/screeningExportService.js?mode=worker');
    const blankCv = { meta: { status: 'ai_unavailable', scoreType: 'not_available' }, byRecordId: new Map(), generatedAt: new Date().toISOString() };
    let bytes = 0;
    const exp = await measure(() => streamExportToSink({
      projectId: project.id, userId: user.id, format: 'csv', filter: 'all', cv: blankCv,
      write: (c) => { bytes += Buffer.byteLength(c); }, // count bytes; never hold the whole file
    }));
    console.log(row('EXPORT  (streamed CSV)', exp, `rows=${exp.r.emitted}  size=${(bytes / 1048576).toFixed(1)}MB  rssDelta=${exp.rssDeltaMB}MB`));
    console.log(`\n  → ${(bytes / 1048576).toFixed(1)}MB CSV produced while RSS grew only ~${exp.rssDeltaMB}MB ` +
      `(memory bounded to one page of records, not the whole file).\n`);
  } catch (e) {
    console.error('  export demo skipped:', e?.message);
  } finally {
    try {
      if (project) {
        await prisma.screenRecord.deleteMany({ where: { projectId: project.id } });
        await prisma.screenProject.deleteMany({ where: { id: project.id } });
      }
      if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    } catch { /* best-effort cleanup */ }
  }

  console.log('=== done ===\n');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); try { await prisma.$disconnect(); } catch { /* noop */ } process.exit(1); });
