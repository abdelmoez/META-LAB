/**
 * features/manuscript/writingAssistant/engine/workerCore.js — 120.md §6.
 *
 * The Web Worker's BRAIN, extracted from the worker shell so it is a pure,
 * dependency-injected function that Node tests can drive directly. `waWorker.js` is
 * eight lines of `self.onmessage` glue around this; everything that could be wrong
 * lives here where it can be tested without spawning a real Worker.
 *
 * ── MESSAGE PROTOCOL (the contract for Wave 4b's hook) ──────────────────────────
 *
 * IN → { type:'init',   requestId, variant:'en-US'|'en-GB', options? }
 * OUT ← { type:'ready',  requestId, variant, lexiconVersion, protocol, dictionaryBytes, ms }
 * OUT ← { type:'error',  requestId, phase:'init', code:'dict-load-failed', message }
 *
 * IN → { type:'dict',   requestId, patch:{ userDictionary?, projectDictionary?,
 *                        ignoredTerms?, mutedCategories?, mutedRules?,
 *                        commonAcronyms?, projectShape? } }
 * OUT ← { type:'dict-ack', requestId, sizes:{ user, project, lexicon, ignored } }
 *
 * IN → { type:'check',  requestId, docId, sectionId, mode:'blocks'|'document',
 *                        blocks:[{ index, rev, text, checkText?, kind, checkable? }],
 *                        opts:{ sectionKind?, variant?, suggestionBudget?,
 *                               flagOtherVariant? } }
 * OUT ← { type:'result', requestId, docId, sectionId, mode,
 *          blocks:[{ index, rev, issues:[Issue] }], documentIssues:[Issue],
 *          counts:{category:n}, stats:{ blockCount, issueCount, ms } }
 * OUT ← { type:'error',  requestId, phase:'check', code, message }
 *
 * IN → { type:'cancel', requestId }            (requestId = the check to abandon)
 * OUT ← { type:'cancelled', requestId }
 *
 * IN → { type:'suggest', requestId, word, limit? }
 * OUT ← { type:'suggestions', requestId, word, suggestions:[string] }
 *
 * IN → { type:'dispose' }                      (no response; frees the dictionary)
 *
 * RULES the host must rely on:
 *   1. EVERY response carries the `requestId` it answers. Responses to a requestId
 *      the host has moved past are stale and must be dropped.
 *   2. Every result block carries the `rev` the host sent. 120.md §6 stale-result
 *      protection: if the block's current revision differs, the issues are void.
 *   3. `mode:'blocks'` never runs the document passes (consistency, acronyms,
 *      repeated openers) — they need the whole section and would be wrong on a
 *      partial view. The host runs a `mode:'document'` check on a longer debounce.
 *   4. `cancel` is cooperative. The core yields between chunks of blocks, so a
 *      cancel that arrives mid-check takes effect at the next chunk boundary and is
 *      always acknowledged.
 *   5. NO MANUSCRIPT TEXT IS EVER ECHOED IN AN ERROR. Error payloads carry a code and
 *      a fixed message only (§6 privacy: no manuscript content in error metadata).
 */

import { createSpellChecker, indexDictionary, normalizeVariant } from './spellcheck.js';
import { createPipeline } from './pipeline.js';
import { buildProjectLexicon, EMPTY_PROJECT_LEXICON } from './projectLexicon.js';
import { LEXICON_VERSION } from './medicalLexicon.js';

export const WA_PROTOCOL_VERSION = 1;

export const WA_IN = Object.freeze({
  INIT: 'init', CHECK: 'check', CANCEL: 'cancel', DICT: 'dict',
  SUGGEST: 'suggest', DISPOSE: 'dispose',
});

export const WA_OUT = Object.freeze({
  READY: 'ready', RESULT: 'result', CANCELLED: 'cancelled', ERROR: 'error',
  DICT_ACK: 'dict-ack', SUGGESTIONS: 'suggestions',
});

/** Blocks processed between cancellation checks. */
const CHUNK = 8;

const nextTick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * @param {Object} deps
 * @param {(variant:string) => Promise<{aff:any, dic:any, bytes?:number}>} deps.loadDictionary
 * @param {Function} [deps.createChecker] defaults to createSpellChecker
 * @param {() => number} [deps.now]
 * @param {() => Promise<void>} [deps.yieldToQueue] injected so tests can step it
 */
export function createWorkerCore(deps = {}) {
  const loadDictionary = deps.loadDictionary;
  const createChecker = deps.createChecker || createSpellChecker;
  const now = deps.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const yieldToQueue = deps.yieldToQueue || nextTick;

  const state = {
    ready: false,
    variant: null,
    dictionaryBytes: 0,
    checker: null,
    pipeline: null,
    projectLexicon: EMPTY_PROJECT_LEXICON,
    cancelled: new Set(),
    inFlight: null,
  };

  const fail = (post, requestId, phase, code, message) => {
    post({ type: WA_OUT.ERROR, requestId: requestId ?? null, phase, code, message });
  };

  async function handleInit(message, post) {
    const started = now();
    const variant = normalizeVariant(message.variant);
    let dictionary;
    try {
      dictionary = await loadDictionary(variant);
    } catch (err) {
      state.ready = false;
      // The message is a fixed string plus the error's own name — never any text
      // from the manuscript, and never the raw error, which could contain a path.
      fail(post, message.requestId, 'init', 'dict-load-failed',
        `Dictionary could not be loaded (${(err && err.name) || 'Error'}).`);
      return;
    }
    try {
      state.checker = createChecker({ aff: dictionary.aff, dic: dictionary.dic, variant });
      state.variant = variant;
      state.dictionaryBytes = dictionary.bytes || 0;
      state.pipeline = createPipeline({
        spellChecker: state.checker,
        projectLexicon: state.projectLexicon,
        ...(message.options || {}),
      });
      state.ready = true;
      post({
        type: WA_OUT.READY,
        requestId: message.requestId ?? null,
        variant,
        lexiconVersion: LEXICON_VERSION,
        protocol: WA_PROTOCOL_VERSION,
        dictionaryBytes: state.dictionaryBytes,
        ms: Math.round(now() - started),
      });
    } catch (err) {
      state.ready = false;
      fail(post, message.requestId, 'init', 'engine-init-failed',
        `Writing assistant could not start (${(err && err.name) || 'Error'}).`);
    }
  }

  function handleDict(message, post) {
    if (!state.pipeline) {
      fail(post, message.requestId, 'dict', 'not-ready', 'Writing assistant is not initialised.');
      return;
    }
    const patch = message.patch || {};
    const next = {};
    if ('userDictionary' in patch) next.userDictionary = indexDictionary(patch.userDictionary);
    if ('projectDictionary' in patch) next.projectDictionary = indexDictionary(patch.projectDictionary);
    if ('ignoredTerms' in patch) next.ignoredTerms = new Set(patch.ignoredTerms || []);
    if ('mutedCategories' in patch) next.mutedCategories = new Set(patch.mutedCategories || []);
    if ('mutedRules' in patch) next.mutedRules = new Set(patch.mutedRules || []);
    if ('commonAcronyms' in patch) next.commonAcronyms = new Set(patch.commonAcronyms || []);
    if ('projectShape' in patch) {
      state.projectLexicon = patch.projectShape
        ? buildProjectLexicon(patch.projectShape)
        : EMPTY_PROJECT_LEXICON;
      next.projectLexicon = state.projectLexicon;
    }
    // Teach nspell every accepted term so `suggest()` can offer them (§6: a user's
    // own dictionary entry must be reachable as a suggestion, not just accepted).
    const teachWords = [];
    if (next.userDictionary) teachWords.push(...[...next.userDictionary.values()].map((e) => e.term));
    if (next.projectDictionary) teachWords.push(...[...next.projectDictionary.values()].map((e) => e.term));
    if (teachWords.length) next.teachWords = teachWords;

    state.pipeline.update(next);
    post({
      type: WA_OUT.DICT_ACK,
      requestId: message.requestId ?? null,
      sizes: {
        user: state.pipeline.state.userDictionary ? state.pipeline.state.userDictionary.size ?? 0 : 0,
        project: state.pipeline.state.projectDictionary ? state.pipeline.state.projectDictionary.size ?? 0 : 0,
        lexicon: state.projectLexicon.size,
        ignored: state.pipeline.state.ignoredTerms.size,
      },
    });
  }

  async function handleCheck(message, post) {
    const { requestId } = message;
    if (!state.ready || !state.pipeline) {
      fail(post, requestId, 'check', 'not-ready', 'Writing assistant is not initialised.');
      return;
    }
    if (state.cancelled.has(requestId)) {
      state.cancelled.delete(requestId);
      post({ type: WA_OUT.CANCELLED, requestId });
      return;
    }
    const started = now();
    const blocks = Array.isArray(message.blocks) ? message.blocks : [];
    const mode = message.mode === 'document' ? 'document' : 'blocks';
    const opts = {
      ...(message.opts || {}),
      docId: message.docId ?? null,
      sectionId: message.sectionId ?? null,
      createdAt: Date.now(),
      mode,
      variant: (message.opts && message.opts.variant) || state.variant,
    };

    const perBlock = [];
    const budget = {
      left: Number.isFinite(opts.suggestionBudget) ? opts.suggestionBudget : 25,
    };
    try {
      for (let i = 0; i < blocks.length; i += CHUNK) {
        for (const block of blocks.slice(i, i + CHUNK)) {
          perBlock.push({
            index: block.index,
            rev: block.rev ?? null,
            issues: state.pipeline.checkBlock(block, opts, budget),
          });
        }
        if (i + CHUNK < blocks.length) {
          await yieldToQueue();
          if (state.cancelled.has(requestId)) {
            state.cancelled.delete(requestId);
            post({ type: WA_OUT.CANCELLED, requestId });
            return;
          }
        }
      }
      const documentIssues = mode === 'document'
        ? state.pipeline.documentPasses(blocks, opts)
        : [];
      if (state.cancelled.has(requestId)) {
        state.cancelled.delete(requestId);
        post({ type: WA_OUT.CANCELLED, requestId });
        return;
      }
      const counts = {};
      for (const issue of [...perBlock.flatMap((b) => b.issues), ...documentIssues]) {
        counts[issue.category] = (counts[issue.category] || 0) + 1;
      }
      post({
        type: WA_OUT.RESULT,
        requestId,
        docId: opts.docId,
        sectionId: opts.sectionId,
        mode,
        blocks: perBlock,
        documentIssues,
        counts,
        stats: {
          blockCount: blocks.length,
          issueCount: perBlock.reduce((n, b) => n + b.issues.length, 0) + documentIssues.length,
          ms: Math.round(now() - started),
        },
      });
    } catch (err) {
      fail(post, requestId, 'check', 'check-failed',
        `Checking failed (${(err && err.name) || 'Error'}).`);
    }
  }

  function handleSuggest(message, post) {
    if (!state.checker) {
      fail(post, message.requestId, 'suggest', 'not-ready', 'Writing assistant is not initialised.');
      return;
    }
    const word = String(message.word || '');
    const limit = Number.isFinite(message.limit) ? message.limit : 5;
    post({
      type: WA_OUT.SUGGESTIONS,
      requestId: message.requestId ?? null,
      word,
      suggestions: word ? state.checker.suggest(word, { limit }) : [],
    });
  }

  /**
   * Dispatch. Always resolves — a thrown handler becomes an `error` response so the
   * host's state machine can show its recoverable-error chip instead of hanging
   * (120.md §6 failure behaviour).
   */
  async function handle(message, post) {
    if (!message || typeof message.type !== 'string') {
      fail(post, null, 'dispatch', 'bad-message', 'Unrecognised message.');
      return;
    }
    try {
      switch (message.type) {
        case WA_IN.INIT: await handleInit(message, post); break;
        case WA_IN.DICT: handleDict(message, post); break;
        case WA_IN.CHECK: await handleCheck(message, post); break;
        case WA_IN.CANCEL:
          state.cancelled.add(message.requestId);
          post({ type: WA_OUT.CANCELLED, requestId: message.requestId });
          break;
        case WA_IN.SUGGEST: handleSuggest(message, post); break;
        case WA_IN.DISPOSE:
          state.ready = false;
          state.checker = null;
          state.pipeline = null;
          state.projectLexicon = EMPTY_PROJECT_LEXICON;
          state.cancelled.clear();
          break;
        default:
          fail(post, message.requestId, 'dispatch', 'unknown-type',
            `Unsupported message type “${message.type}”.`);
      }
    } catch (err) {
      fail(post, message.requestId, 'dispatch', 'handler-failed',
        `Writing assistant error (${(err && err.name) || 'Error'}).`);
    }
  }

  return { handle, state };
}
