/**
 * aiComputeWorker.js — worker_threads entry for CPU-heavy screening-AI compute (62.md).
 *
 * The pure scoring engine (trainAndScore / crossValidate / crossValidatePerRecord) is
 * dependency-free SYNCHRONOUS JavaScript. Running it on the main HTTP event loop froze
 * the whole single-process server for the duration of a run (≈tens of seconds at 5–10k
 * records) and 504-ed large exports. This worker runs that EXACT pure code in a separate
 * thread, so the HTTP event loop stays free while it computes. Results are byte-identical
 * (the engine is deterministic; same inputs → same output). Only plain, serialisable data
 * crosses the boundary — all Prisma/DB I/O stays on the main thread.
 *
 * Protocol: parent posts { id, task, payload }; we reply { id, ok:true, result } or
 * { id, ok:false, error:{ message, stack } }. The handler is synchronous, so messages are
 * processed one at a time (a single worker bounds CPU to one heavy compute at a time).
 */
import { parentPort } from 'node:worker_threads';
import {
  trainAndScore,
  crossValidate,
  crossValidatePerRecord,
} from '../../src/research-engine/screening/ai/index.js';

function run(task, payload) {
  switch (task) {
    case 'trainAndScore':
      return trainAndScore(payload);
    case 'crossValidate':
      return crossValidate(payload);
    case 'crossValidatePerRecord': {
      const cv = crossValidatePerRecord(payload);
      // byRecordId is a Map → ship as entries so the shape is identical on BOTH the
      // worker and the inline-fallback path (aiCompute.js rebuilds the Map).
      return { meta: cv.meta, byRecordIdEntries: [...(cv.byRecordId || new Map())] };
    }
    default:
      throw new Error(`unknown compute task: ${task}`);
  }
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    const { id, task, payload } = msg || {};
    try {
      const result = run(task, payload);
      parentPort.postMessage({ id, ok: true, result });
    } catch (e) {
      parentPort.postMessage({
        id, ok: false,
        error: { message: String((e && e.message) || e), stack: e && e.stack },
      });
    }
  });
}
