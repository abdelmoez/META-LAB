/**
 * rules/punctuation.js — 120.md §6 "Punctuation".
 *
 * Three small, high-precision passes plus bracket balance. Every one of them consults
 * the PROSE MASK first (ruleUtils.buildProseMask), because the raw regexes would
 * otherwise fire inside `mL/min/1.73 m²`, `10.1001/jama.2024.1`, `p < 0.05` and every
 * URL in the reference list. That mask is the punctuation half of §6's token firewall.
 */

import { CATEGORY, SEVERITY } from '../issueModel.js';
import { emit, isProse } from './ruleUtils.js';

export const DOUBLE_SPACE_RULE_ID = 'wa.double-space';
export const SPACE_BEFORE_PUNCT_RULE_ID = 'wa.space-before-punctuation';
export const MISSING_SPACE_RULE_ID = 'wa.missing-space-after-punctuation';
export const BRACKET_RULE_ID = 'wa.unbalanced-brackets';

const DOUBLE_SPACE_RE = /(\S)([ ]{2,})(\S)/g;
const SPACE_BEFORE_RE = /(\S)([ ]+)([,.;:!?])(?=[\s ]|$)/g;
const MISSING_SPACE_RE = /(\p{L})([,;])(\p{L})/gu;

export function spacing(ctx) {
  const issues = [];
  const { text, proseMask } = ctx;

  DOUBLE_SPACE_RE.lastIndex = 0;
  let m;
  while ((m = DOUBLE_SPACE_RE.exec(text)) !== null) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    if (!isProse(proseMask, m.index, end + 1)) continue;
    issues.push(emit(ctx, {
      start,
      end,
      category: CATEGORY.PUNCTUATION,
      ruleId: DOUBLE_SPACE_RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.75,
      message: 'Extra space between words.',
      explanation: 'Use a single space between words.',
      suggestions: [' '],
    }));
    DOUBLE_SPACE_RE.lastIndex = end;
  }

  SPACE_BEFORE_RE.lastIndex = 0;
  while ((m = SPACE_BEFORE_RE.exec(text)) !== null) {
    const start = m.index + m[1].length;
    const end = start + m[2].length + 1;
    if (!isProse(proseMask, m.index, end)) continue;
    issues.push(emit(ctx, {
      start,
      end,
      category: CATEGORY.PUNCTUATION,
      ruleId: SPACE_BEFORE_PUNCT_RULE_ID,
      severity: SEVERITY.ERROR,
      confidence: 0.85,
      message: `Remove the space before “${m[3]}”.`,
      explanation: 'Punctuation follows the preceding word without a space.',
      suggestions: [m[3]],
    }));
    SPACE_BEFORE_RE.lastIndex = end;
  }

  MISSING_SPACE_RE.lastIndex = 0;
  while ((m = MISSING_SPACE_RE.exec(text)) !== null) {
    const start = m.index + 1;
    const end = start + 1;
    if (!isProse(proseMask, m.index, m.index + m[0].length)) continue;
    issues.push(emit(ctx, {
      start,
      end,
      category: CATEGORY.PUNCTUATION,
      ruleId: MISSING_SPACE_RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.6,
      message: `Add a space after “${m[2]}”.`,
      explanation: 'A comma or semicolon is followed by a space.',
      suggestions: [`${m[2]} `],
    }));
  }

  return issues;
}

const PAIRS = { ')': '(', ']': '[', '}': '{' };
const OPENERS = new Set(['(', '[', '{']);

/**
 * Bracket balance within one block. Reported at the position of the offending
 * bracket, so the decoration underlines the character the writer has to fix.
 */
export function brackets(ctx) {
  const issues = [];
  const { text, proseMask } = ctx;
  const stack = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!OPENERS.has(ch) && !PAIRS[ch]) continue;
    if (!proseMask[i]) continue;
    if (OPENERS.has(ch)) { stack.push({ ch, i }); continue; }
    const expected = PAIRS[ch];
    if (stack.length && stack[stack.length - 1].ch === expected) { stack.pop(); continue; }
    issues.push(emit(ctx, {
      start: i,
      end: i + 1,
      category: CATEGORY.PUNCTUATION,
      ruleId: BRACKET_RULE_ID,
      severity: SEVERITY.ERROR,
      confidence: 0.7,
      message: `“${ch}” has no matching “${expected}”.`,
      explanation: 'Every closing bracket needs an opening bracket.',
    }));
  }
  for (const open of stack) {
    issues.push(emit(ctx, {
      start: open.i,
      end: open.i + 1,
      category: CATEGORY.PUNCTUATION,
      ruleId: BRACKET_RULE_ID,
      severity: SEVERITY.ERROR,
      confidence: 0.7,
      message: `“${open.ch}” is never closed.`,
      explanation: 'Every opening bracket needs a closing bracket.',
    }));
  }
  return issues;
}
