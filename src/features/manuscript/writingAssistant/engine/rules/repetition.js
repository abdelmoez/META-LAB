/**
 * rules/repetition.js — 120.md §6 "Repeated phrasing".
 *
 * A DOCUMENT rule, not a block rule: sentences that open the same way usually sit in
 * different paragraphs ("We searched… We screened… We extracted…"), so the pass runs
 * over the whole ordered block list rather than one block at a time. pipeline.js
 * therefore only calls it in the document phase — see DOCUMENT_RULES in ./index.js.
 *
 * Reported once, on the THIRD sentence of a run, because that is the first point at
 * which the pattern exists. Articles are excluded: "The …" three times running is
 * ordinary English, not a style problem.
 */

import { CATEGORY, SEVERITY } from '../issueModel.js';
import { makeIssue, SOURCE } from '../issueModel.js';
import { splitSentences } from '../tokenize.js';
import { SENTENCE_EXEMPT_BLOCKS } from './ruleUtils.js';

export const RULE_ID = 'wa.repeated-sentence-opener';

const IGNORED_OPENERS = new Set(['the', 'a', 'an']);
const RUN_LENGTH = 3;

/**
 * @param {Array<{index:number, rev?:any, text:string, kind?:string}>} blocks
 * @param {{docId?:string, sectionId?:string, createdAt?:number}} [meta]
 */
export function repeatedSentenceOpener(blocks, meta = {}) {
  const issues = [];
  /** @type {{word:string, entries:Array<{block:any, start:number, end:number}>}} */
  let run = { word: '', entries: [] };

  const flush = () => {
    if (run.entries.length >= RUN_LENGTH) {
      const third = run.entries[RUN_LENGTH - 1];
      issues.push(makeIssue({
        docId: meta.docId ?? null,
        sectionId: meta.sectionId ?? null,
        blockIndex: third.block.index,
        blockRev: third.block.rev ?? null,
        start: third.start,
        end: third.end,
        original: third.block.text.slice(third.start, third.end),
        category: CATEGORY.REPETITION,
        severity: SEVERITY.SUGGESTION,
        confidence: 0.4,
        message: `${run.entries.length} sentences in a row begin with “${third.block.text.slice(third.start, third.end)}”.`,
        explanation: 'Varying sentence openings makes a passage easier to read.',
        ruleId: RULE_ID,
        source: SOURCE.RULE,
        createdAt: meta.createdAt || 0,
      }));
    }
    run = { word: '', entries: [] };
  };

  for (const block of blocks) {
    if (SENTENCE_EXEMPT_BLOCKS.has(block.kind)) { flush(); continue; }
    for (const sentence of splitSentences(block.text)) {
      const m = /\p{L}[\p{L}\p{M}'’-]*/u.exec(sentence.text);
      if (!m) { flush(); continue; }
      const word = m[0].toLowerCase();
      const start = sentence.start + m.index;
      const end = start + m[0].length;
      if (IGNORED_OPENERS.has(word)) { flush(); continue; }
      if (word === run.word) run.entries.push({ block, start, end });
      else { flush(); run = { word, entries: [{ block, start, end }] }; }
    }
  }
  flush();
  return issues;
}

export default repeatedSentenceOpener;
