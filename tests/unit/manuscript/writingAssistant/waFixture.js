/**
 * Shared fixture for the 120.md §6 Writing Assistant engine tests.
 *
 * Not a test file (no `.test.js` suffix) — vitest never collects it. It owns the two
 * expensive things the suite needs: the real SCOWL dictionaries read off disk, and a
 * rule context built the same way pipeline.js builds one, so a rule can be tested as
 * the pure function it is without standing up the whole pipeline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokenize, splitSentences } from '../../../../src/features/manuscript/writingAssistant/engine/tokenize.js';
import { buildProseMask } from '../../../../src/features/manuscript/writingAssistant/engine/rules/ruleUtils.js';
import { createSpellChecker } from '../../../../src/features/manuscript/writingAssistant/engine/spellcheck.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');

/** Read a bundled Hunspell dictionary pair straight from node_modules. */
export function readDictionary(pkg) {
  const dir = path.join(ROOT, 'node_modules', pkg);
  return {
    aff: fs.readFileSync(path.join(dir, 'index.aff'), 'utf8'),
    dic: fs.readFileSync(path.join(dir, 'index.dic'), 'utf8'),
  };
}

let cachedUs = null;

/** One en-US checker per test file — nspell construction costs ~250 ms. */
export function usChecker() {
  if (!cachedUs) {
    const { aff, dic } = readDictionary('dictionary-en');
    cachedUs = createSpellChecker({ aff, dic, variant: 'en-US' });
  }
  return cachedUs;
}

/** The context object every rule in engine/rules receives. */
export function makeCtx(text, opts = {}) {
  const { tokens } = tokenize(text);
  const masked = tokenize(text).text;
  return {
    text: masked,
    tokens,
    sentences: splitSentences(masked),
    proseMask: buildProseMask(masked, tokens),
    blockIndex: opts.blockIndex ?? 0,
    blockRev: opts.blockRev ?? 'r0',
    blockKind: opts.blockKind ?? 'paragraph',
    sectionId: opts.sectionId ?? 's1',
    sectionKind: opts.sectionKind ?? null,
    docId: opts.docId ?? 'd1',
    createdAt: 0,
    flagOtherVariant: Boolean(opts.flagOtherVariant),
  };
}

/** Ordered blocks in the shape the pipeline and document passes expect. */
export function blocksOf(lines, kind = 'paragraph') {
  return lines.map((text, index) => ({ index, rev: `r${index}`, text, kind }));
}

/**
 * A tiny Hunspell pair for protocol tests: real nspell, no 550 KB parse. `NEEDAFFIX`
 * is absent, so every line is a literal word.
 */
export const TINY_DICTIONARY = Object.freeze({
  aff: 'SET UTF-8\nTRY esianrtolcdugmphbyfvkwz\n',
  dic: '8\nhello\nworld\nstudies\npatients\nthe\nreceived\nwere\nincluded\n',
});
