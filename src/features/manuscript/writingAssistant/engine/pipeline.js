/**
 * features/manuscript/writingAssistant/engine/pipeline.js — 120.md §6
 * "Grammar-analysis architecture".
 *
 * §6 asks for a layered pipeline and specifically says "Do not implement the entire
 * feature as a few regular expressions". This module is the layering:
 *
 *   3. scientific-aware tokenization          → tokenize.js (the firewall)
 *   4. local spelling and terminology         → spellcheck.js → medicalLexicon →
 *                                               projectLexicon → project/user dicts
 *   5. rule-based grammar and punctuation     → rules/
 *   6. contextual/document analysis           → consistency.js, acronyms.js,
 *                                               rules/repetition.js
 *   7. issue normalization and deduplication  → issueModel.js
 *
 * Steps 1-2 (block extraction and classification) are blocks.js; steps 8-11
 * (position mapping, decoration, user actions, persistence) belong to Wave 4b.
 *
 * §6 also demands a PROVIDER ABSTRACTION "so the underlying grammar engine can be
 * replaced or upgraded without rewriting the editor UI and selection logic". That is
 * exactly what `createPipeline` is: everything above the pipeline speaks only in
 * blocks-in / issues-out, so swapping nspell for a different local engine, or adding
 * a server-side provider, touches this file and nothing the editor knows about.
 *
 * PRIVACY: nothing in this file or anything it imports performs I/O of any kind.
 * Manuscript text enters as a string and leaves as issue offsets. There is no
 * network call, no logging of block text, and no telemetry hook — 120.md §6's
 * privacy section is satisfied by construction, not by policy.
 */

import { tokenize, subWords, splitSentences, TOKEN } from './tokenize.js';
import {
  CATEGORY, SEVERITY, SOURCE, makeIssue, dedupeIssues, filterMuted, sortIssues,
  countByCategory,
} from './issueModel.js';
import { BLOCK_RULES, DOCUMENT_RULES } from './rules/index.js';
import { buildProseMask, NON_PROSE_BLOCKS } from './rules/ruleUtils.js';
import { lookupWord } from './spellcheck.js';
import { checkConsistency } from './consistency.js';
import { analyzeAcronyms } from './acronyms.js';
import { EMPTY_PROJECT_LEXICON } from './projectLexicon.js';

export const SPELLING_RULE_ID = 'wa.spelling';
export const VARIANT_SPELLING_RULE_ID = 'wa.variant-spelling';

/** Suggestions are the expensive part (nspell.suggest ≈ 30 ms/word); budget them. */
export const DEFAULT_SUGGESTION_BUDGET = 25;

/** A single letter, a bare digit run, or a masked placeholder is not a word. */
function isCheckableWord(word) {
  if (word.length < 2) return false;
  if (!/\p{L}/u.test(word)) return false;
  return true;
}

/**
 * Build the pipeline.
 *
 * @param {Object} config
 * @param {Object} [config.spellChecker]     from createSpellChecker(); null → rules only
 * @param {Object} [config.projectLexicon]   from buildProjectLexicon()
 * @param {Map|Set|Array} [config.userDictionary]
 * @param {Map|Set|Array} [config.projectDictionary]
 * @param {Set<string>}  [config.ignoredTerms]      "ignore this term in this manuscript"
 * @param {Set<string>}  [config.mutedCategories]
 * @param {Set<string>}  [config.mutedRules]
 * @param {Set<string>}  [config.commonAcronyms]
 */
export function createPipeline(config = {}) {
  const state = {
    spellChecker: config.spellChecker || null,
    projectLexicon: config.projectLexicon || EMPTY_PROJECT_LEXICON,
    userDictionary: config.userDictionary || null,
    projectDictionary: config.projectDictionary || null,
    ignoredTerms: config.ignoredTerms instanceof Set ? config.ignoredTerms : new Set(config.ignoredTerms || []),
    mutedCategories: config.mutedCategories instanceof Set ? config.mutedCategories : new Set(config.mutedCategories || []),
    mutedRules: config.mutedRules instanceof Set ? config.mutedRules : new Set(config.mutedRules || []),
    commonAcronyms: config.commonAcronyms instanceof Set ? config.commonAcronyms : null,
  };

  /* ------------------------------------------------------------ spelling ---- */

  function spellingPass(ctx, budget) {
    const issues = [];
    for (const token of ctx.tokens) {
      if (token.kind !== TOKEN.WORD) continue;
      for (const part of subWords(token)) {
        if (!isCheckableWord(part.word)) continue;
        const verdict = lookupWord(part.word, {
          spellChecker: state.spellChecker,
          projectLexicon: state.projectLexicon,
          userDictionary: state.userDictionary,
          projectDictionary: state.projectDictionary,
          ignoredTerms: state.ignoredTerms,
        });
        if (verdict.known) {
          // 120.md §6 — the other English variant is NEVER a spelling error. It is
          // reported (if at all) as a consistency suggestion, and only when the
          // caller asks: the document-level consistency pass does a better job of
          // deciding whether the manuscript is actually inconsistent.
          if (verdict.via === 'variant' && ctx.flagOtherVariant && verdict.preferred) {
            issues.push(makeIssue({
              docId: ctx.docId,
              sectionId: ctx.sectionId,
              blockIndex: ctx.blockIndex,
              blockRev: ctx.blockRev,
              start: part.start,
              end: part.end,
              original: part.word,
              category: CATEGORY.CONSISTENCY,
              severity: SEVERITY.SUGGESTION,
              confidence: 0.55,
              message: `“${verdict.preferred}” is the spelling for the selected English variant.`,
              explanation: 'Both spellings are correct English; journals expect one variant throughout.',
              suggestions: [verdict.preferred],
              ruleId: VARIANT_SPELLING_RULE_ID,
              source: SOURCE.LEXICON,
              createdAt: ctx.createdAt,
            }));
          }
          continue;
        }

        let suggestions = [];
        if (state.spellChecker && budget.left > 0) {
          budget.left -= 1;
          suggestions = state.spellChecker.suggest(part.word, { limit: 5 });
        }
        issues.push(makeIssue({
          docId: ctx.docId,
          sectionId: ctx.sectionId,
          blockIndex: ctx.blockIndex,
          blockRev: ctx.blockRev,
          start: part.start,
          end: part.end,
          original: part.word,
          category: CATEGORY.SPELLING,
          severity: SEVERITY.ERROR,
          confidence: 0.9,
          message: `“${part.word}” is not in the dictionary.`,
          explanation: 'Not found in the English, medical or project dictionaries. '
            + 'Add it to your personal or project dictionary if it is correct.',
          suggestions,
          ruleId: SPELLING_RULE_ID,
          source: SOURCE.LEXICON,
          createdAt: ctx.createdAt,
          meta: suggestions.length ? null : { noSuggestions: true },
        }));
      }
    }
    return issues;
  }

  /* -------------------------------------------------------------- context --- */

  function makeContext(block, opts, budget) {
    const text = typeof block.checkText === 'string' ? block.checkText : String(block.text ?? '');
    const { tokens } = tokenize(text, { mask: typeof block.checkText !== 'string' });
    return {
      text,
      tokens,
      sentences: splitSentences(text),
      proseMask: buildProseMask(text, tokens),
      blockIndex: block.index,
      blockRev: block.rev ?? null,
      blockKind: block.kind || 'paragraph',
      sectionId: opts.sectionId ?? null,
      sectionKind: opts.sectionKind ?? null,
      docId: opts.docId ?? null,
      createdAt: opts.createdAt || 0,
      flagOtherVariant: Boolean(opts.flagOtherVariant),
      budget,
    };
  }

  /* ------------------------------------------------------------ per block --- */

  function checkBlock(block, opts = {}, budget = { left: DEFAULT_SUGGESTION_BUDGET }) {
    if (!block || typeof block.text !== 'string') return [];
    if (block.checkable === false) return [];
    if (NON_PROSE_BLOCKS.has(block.kind)) return [];

    const ctx = makeContext(block, opts, budget);
    const issues = spellingPass(ctx, budget);
    for (const rule of BLOCK_RULES) {
      if (opts.skipRules && opts.skipRules.has(rule.id)) continue;
      issues.push(...rule.run(ctx));
    }
    return dedupeIssues(filterMuted(issues, state));
  }

  /* ------------------------------------------------------- per document ----- */

  function documentPasses(blocks, opts = {}) {
    const meta = {
      docId: opts.docId ?? null,
      sectionId: opts.sectionId ?? null,
      createdAt: opts.createdAt || 0,
      variant: opts.variant || (state.spellChecker && state.spellChecker.variant),
      isCommonWord: state.spellChecker ? (w) => state.spellChecker.isKnown(w) : null,
      commonAcronyms: state.commonAcronyms,
      maxPerFamily: opts.maxPerFamily,
    };
    const checkable = blocks.filter((b) => b && b.checkable !== false
      && !NON_PROSE_BLOCKS.has(b.kind)
      && typeof b.text === 'string');
    const prepared = checkable.map((b) => ({
      index: b.index,
      rev: b.rev ?? null,
      kind: b.kind || 'paragraph',
      text: typeof b.checkText === 'string' ? b.checkText : b.text,
    }));

    const issues = [];
    if (!opts.skipConsistency) issues.push(...checkConsistency(prepared, meta));
    if (!opts.skipAcronyms) issues.push(...analyzeAcronyms(prepared, meta));
    for (const rule of DOCUMENT_RULES) {
      if (opts.skipRules && opts.skipRules.has(rule.id)) continue;
      issues.push(...rule.run(prepared, meta));
    }
    return dedupeIssues(filterMuted(issues, state));
  }

  /* ------------------------------------------------------------- entry ------ */

  /**
   * Check a set of blocks. `mode: 'blocks'` is the incremental path used on every
   * keystroke-debounce and deliberately skips the document passes — consistency and
   * acronym analysis need the whole section and would otherwise report nonsense from
   * a one-paragraph view (120.md §6 "Incremental checking and performance").
   */
  function check(blocks, opts = {}) {
    const started = opts.now ? opts.now() : 0;
    const budget = { left: Number.isFinite(opts.suggestionBudget) ? opts.suggestionBudget : DEFAULT_SUGGESTION_BUDGET };
    const list = Array.isArray(blocks) ? blocks : [];
    const perBlock = list.map((block) => ({
      index: block.index,
      rev: block.rev ?? null,
      issues: checkBlock(block, opts, budget),
    }));
    const documentIssues = opts.mode === 'document' ? documentPasses(list, opts) : [];
    const all = [...perBlock.flatMap((b) => b.issues), ...documentIssues];
    return {
      blocks: perBlock,
      documentIssues,
      counts: countByCategory(all),
      stats: {
        blockCount: list.length,
        issueCount: all.length,
        suggestionsComputed: (Number.isFinite(opts.suggestionBudget) ? opts.suggestionBudget : DEFAULT_SUGGESTION_BUDGET) - budget.left,
        ms: opts.now ? opts.now() - started : 0,
      },
    };
  }

  return {
    check,
    checkBlock,
    documentPasses,

    /** Replace one of the mutable inputs without rebuilding the spell checker. */
    update(patch = {}) {
      for (const key of ['projectLexicon', 'userDictionary', 'projectDictionary']) {
        if (key in patch) state[key] = patch[key];
      }
      for (const key of ['ignoredTerms', 'mutedCategories', 'mutedRules', 'commonAcronyms']) {
        if (key in patch) {
          state[key] = patch[key] instanceof Set ? patch[key] : new Set(patch[key] || []);
        }
      }
      // Newly accepted terms must reach nspell too, or `suggest()` will keep
      // offering the dictionary's guesses instead of the user's own word.
      if (state.spellChecker) {
        if (patch.projectLexicon) state.spellChecker.addWords(patch.projectLexicon.terms());
        if (patch.teachWords) state.spellChecker.addWords(patch.teachWords);
      }
      return state;
    },

    /** For tests and diagnostics. */
    state,
  };
}

/** Flatten a `check()` result into one ordered issue list. */
export function mergeIssues(result) {
  if (!result) return [];
  return sortIssues([
    ...result.blocks.flatMap((b) => b.issues),
    ...result.documentIssues,
  ]);
}
