/**
 * aiCompute.js — CPU-offload pool for the screening-AI engine (62.md).
 *
 * WHY: the pure engine's two heavy phases (trainAndScore + k-fold cross-validation) are
 * monolithic synchronous calls. Run on the HTTP event loop they froze the entire single
 * Node process for the length of a run and 504-ed exports. These wrappers run that work
 * in a long-lived worker_thread so the event loop stays responsive; output is identical
 * (deterministic engine, same inputs).
 *
 * Public API (all async; all return PLAIN data matching the pure engine output):
 *   runTrainAndScore(payload)         → { scores, meta }
 *   runCrossValidate(payload)         → cv object
 *   runCrossValidatePerRecord(payload)→ { meta, byRecordId: Map }
 *
 * Modes:
 *   - worker (default in dev/prod): ONE long-lived thread → CPU bounded to one heavy
 *     compute at a time, so a large project can never oversubscribe cores and starve the
 *     box. Concurrent callers queue. The event loop is never blocked by the compute.
 *   - inline: when AI_COMPUTE_INLINE=1, under Vitest, or NODE_ENV=test (UNLESS
 *     AI_COMPUTE_WORKER=1 forces the worker), the task runs in-process synchronously.
 *     Same results — only the event-loop-isolation guarantee is dropped. Keeps tests
 *     deterministic and degrades safely where worker_threads are unavailable.
 */
import { Worker } from 'node:worker_threads';

const FORCE_WORKER = process.env.AI_COMPUTE_WORKER === '1';
const INLINE = !FORCE_WORKER && (
  process.env.AI_COMPUTE_INLINE === '1' ||
  !!process.env.VITEST ||
  process.env.NODE_ENV === 'test'
);

let worker = null;
let nextId = 1;
const pending = new Map(); // id → { resolve, reject }

function rejectAll(err) {
  for (const { reject } of pending.values()) reject(err);
  pending.clear();
  syncRef();
}

// Keep the process alive ONLY while a compute is in flight: ref the worker when work
// is pending, unref it when idle. This lets a standalone awaiter (CLI/load test) wait
// for a result, while an idle worker never blocks a clean process exit.
function syncRef() {
  if (!worker) return;
  try { (pending.size > 0 ? worker.ref : worker.unref)?.call(worker); } catch { /* noop */ }
}

function onMessage(msg) {
  const { id, ok, result, error } = msg || {};
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  syncRef();
  if (ok) p.resolve(result);
  else p.reject(Object.assign(new Error((error && error.message) || 'compute failed'), { stack: error && error.stack }));
}

/** Lazily start (or reuse) the compute worker. Throws if it cannot be spawned. */
function getWorker() {
  if (worker) return worker;
  const url = new URL('./aiComputeWorker.js', import.meta.url);
  const w = new Worker(url);
  w.on('message', onMessage);
  w.on('error', (err) => { rejectAll(err); try { w.terminate(); } catch { /* noop */ } worker = null; });
  w.on('exit', (code) => {
    if (code !== 0) rejectAll(new Error(`ai-compute worker exited (${code})`));
    if (worker === w) worker = null;
  });
  worker = w;
  syncRef(); // start idle/unref'd until a task is queued
  return worker;
}

async function dispatchInline(task, payload) {
  const eng = await import('../../src/research-engine/screening/ai/index.js');
  switch (task) {
    case 'trainAndScore': return eng.trainAndScore(payload);
    case 'crossValidate': return eng.crossValidate(payload);
    case 'crossValidatePerRecord': {
      const cv = eng.crossValidatePerRecord(payload);
      return { meta: cv.meta, byRecordIdEntries: [...(cv.byRecordId || new Map())] };
    }
    default: throw new Error(`unknown compute task: ${task}`);
  }
}

async function dispatch(task, payload) {
  if (INLINE) return dispatchInline(task, payload);
  let w;
  try {
    w = getWorker();
  } catch (e) {
    // worker_threads unavailable on this runtime → degrade to inline (still correct,
    // just no event-loop isolation for this run).
    console.error('[ai-compute] worker unavailable, running inline:', e && e.message);
    return dispatchInline(task, payload);
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    syncRef(); // work pending → keep the worker (and the process) alive
    try { w.postMessage({ id, task, payload }); }
    catch (e) { pending.delete(id); syncRef(); reject(e); }
  });
}

export async function runTrainAndScore(payload) {
  return dispatch('trainAndScore', payload);
}

export async function runCrossValidate(payload) {
  return dispatch('crossValidate', payload);
}

export async function runCrossValidatePerRecord(payload) {
  const r = await dispatch('crossValidatePerRecord', payload);
  return { meta: r.meta, byRecordId: new Map(r.byRecordIdEntries || []) };
}

/** Current execution mode — for logging/tests. */
export function computeMode() { return INLINE ? 'inline' : 'worker'; }

/** Terminate the worker (tests / graceful shutdown). Safe to call when none exists. */
export async function shutdownCompute() {
  const w = worker;
  worker = null;
  if (w) { try { await w.terminate(); } catch { /* noop */ } }
}
