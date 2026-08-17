/**
 * features/manuscript/writingAssistant/waWorker.js — 120.md §6.
 *
 * The Web Worker entry point. Imported by Wave 4b's hook with Vite's `?worker`
 * suffix, exactly like the pdf.js worker in frontend/components/AppPdfViewer.jsx:32:
 *
 *     import WaWorker from '../manuscript/writingAssistant/waWorker.js?worker';
 *     const worker = new WaWorker();
 *
 * The worker exists for one reason 120.md §6 states plainly: "Worker-thread
 * processing for expensive local analysis where practical" / "Main-thread
 * protection". Parsing a 550 KB Hunspell dictionary takes ~250 ms and
 * `nspell.suggest()` takes ~30 ms per unknown word; neither may ever happen on the
 * thread that is painting the user's keystrokes.
 *
 * This file is INTENTIONALLY almost empty. All the logic lives in
 * engine/workerCore.js, which is pure and dependency-injected, so the protocol can be
 * tested in Node without spawning a Worker. The only things here are the two
 * environment bindings a test cannot provide: `self.onmessage` and the Vite asset
 * loader.
 *
 * PRIVACY (§6): the worker has no network access beyond fetching the two bundled,
 * same-origin dictionary assets. Manuscript text arrives by postMessage, is turned
 * into offsets, and is never persisted, logged or transmitted.
 */

import { createWorkerCore } from './engine/workerCore.js';
import { loadDictionary } from './waDictAssets.js';

const core = createWorkerCore({ loadDictionary });

self.onmessage = (event) => {
  // `handle` never rejects — every failure path posts an `error` message instead, so
  // the host's state machine always leaves 'checking' (120.md §6 failure behaviour:
  // never show "No issues found" when checking actually failed).
  core.handle(event.data, (message) => { self.postMessage(message); });
};
