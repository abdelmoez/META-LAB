/**
 * 120.md r2 — the adversarial-review follow-ups for the Writing Assistant.
 *
 * One `describe` per verified finding, and every case is the REPRO the review
 * executed, run through the same real modules (the real SCOWL dictionary, the real
 * pipeline, the real tokenizer) rather than a stand-in. Where the defect lives in
 * React lifetime rather than in data — the worker boot race, the store-clear
 * dead-end, the status filter — it is pinned the way this repo has always pinned
 * event-handler contracts, with `readSource`; the interaction proof for those is
 * e2e/manuscript/manuscript-writing-assistant-120.spec.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { readSource } from '../../../helpers/readSource.js';
import { createPipeline } from '../../../../src/features/manuscript/writingAssistant/engine/pipeline.js';
import { lookupWord, variantCandidates } from '../../../../src/features/manuscript/writingAssistant/engine/spellcheck.js';
import { checkConsistency, variantPairOf } from '../../../../src/features/manuscript/writingAssistant/engine/consistency.js';
import { tokenize, classifyWordRun, TOKEN } from '../../../../src/features/manuscript/writingAssistant/engine/tokenize.js';
import { projectBlock, projectOffset } from '../../../../src/features/manuscript/writingAssistant/waHighlights.js';
import { BLOCK_KIND } from '../../../../src/features/manuscript/writingAssistant/engine/blocks.js';
import { CATEGORY } from '../../../../src/features/manuscript/writingAssistant/engine/issueModel.js';
import { normalizeDictionaryInput } from '../../../../src/shared/writingAssistantDictionary.js';
import { normalizeTerm } from '../../../../src/features/manuscript/writingAssistant/waState.js';
import { usChecker, blocksOf } from './waFixture.js';

const HOOK = readSource('src/features/manuscript/writingAssistant/useWritingAssistant.js');
const DICT_CTRL = readSource('server/controllers/dictionaryController.js');

const check = (text) => createPipeline({ spellChecker: usChecker() })
  .checkBlock({ index: 0, rev: 'r0', text, kind: 'paragraph' });
const spellingOf = (text) => check(text)
  .filter((i) => i.category === CATEGORY.SPELLING)
  .map((i) => i.original);

/* ══════════════ the US/UK variant bridge (over-general transforms) ══════════════ */

describe('120.md r2 — the variant bridge no longer swallows real typos', () => {
  it('flags the transposition and doubling typos it used to accept silently', () => {
    /* Every one of these returned {known:true, via:'variant'} against the shipped
       en-US dictionary, and because the host always sends flagOtherVariant:false the
       sentence produced NO issue at all — the commonest class of typing error was
       invisible. `controled`/`enroled` are misspellings in BOTH variants, which is
       what proves the bridge was accepting non-variants. */
    for (const typo of [
      'othre', 'papre', 'numbre', 'aftre', 'membre', 'furthre', 'considre', 'chaptre',
      'evidense', 'sciense', 'influense', 'prevalense', 'incidense', 'referense',
      'controled', 'enroled', 'samplling',
    ]) {
      expect(lookupWord(typo, { spellChecker: usChecker() }).known, typo).toBe(false);
    }
  });

  it('reports all four of the review\'s sentence typos as spelling errors', () => {
    const found = spellingOf('The evidense from othre studies suggests a highre prevalense.');
    expect(found).toEqual(expect.arrayContaining(['evidense', 'othre', 'highre', 'prevalense']));
  });

  it('still accepts genuine -ise / -our / -re / -ll- variants as the other variant', () => {
    for (const word of [
      'organise', 'randomised', 'analyse', 'colour', 'behaviour', 'tumour',
      'centre', 'litre', 'fibre', 'calibre', 'centimetre', 'millilitre',
      'defence', 'licence', 'pretence', 'travelled', 'cancelled', 'modelling',
      'haemoglobin', 'oedema', 'paediatric', 'anaemia',
    ]) {
      const verdict = lookupWord(word, { spellChecker: usChecker() });
      expect(verdict.known, word).toBe(true);
      expect(verdict.preferred || word, word).toBeTruthy();
    }
  });

  it('offers the preferred-variant spelling as the replacement, not a guess', () => {
    expect(usChecker().otherVariantOf('colour')).toBe('color');
    expect(usChecker().otherVariantOf('centre')).toBe('center');
    expect(usChecker().otherVariantOf('travelled')).toBe('traveled');
    expect(variantCandidates('othre')).not.toContain('other');
  });
});

/* ══════════════ the 'analysis' self-pair ══════════════ */

describe('120.md r2 — “analysis” is not a variant of itself', () => {
  const blocks = blocksOf([
    'The primary analysis was prespecified.',
    'Sensitivity analyses were performed.',
  ]);
  const meta = (variant) => ({ docId: 'd1', sectionId: 's1', createdAt: 0, variant });

  it('emits no variant issue for analysis/analyses in either variant', () => {
    for (const variant of ['en-US', 'en-GB', undefined]) {
      const issues = checkConsistency(blocks, meta(variant))
        .filter((i) => /analys|analyz/i.test(i.original));
      expect(issues, String(variant)).toEqual([]);
    }
  });

  it('does not classify the -ysis nouns or their ambiguous plurals at all', () => {
    for (const w of ['analysis', 'analyses', 'paralysis', 'dialysis', 'catalysis', 'hydrolysis']) {
      expect(variantPairOf(w), w).toBeNull();
    }
  });

  it('still classifies the unambiguous -yze/-yse verb forms', () => {
    expect(variantPairOf('analyse')).toMatchObject({ us: 'analyze', side: 'en-GB' });
    expect(variantPairOf('analyzed')).toMatchObject({ gb: 'analysed', side: 'en-US' });
  });

  it('never produces a suggestion identical to the text it is offered for', () => {
    // The GB-variant symptom: an underline whose "fix" is byte-identical to the word.
    for (const variant of ['en-US', 'en-GB']) {
      for (const issue of checkConsistency(blocks, meta(variant))) {
        expect(issue.suggestions, `${variant} ${issue.original}`).not.toContain(issue.original);
      }
    }
  });
});

/* ══════════════ Latin scholarly vocabulary ══════════════ */

describe('120.md r2 — “et al.” and the Latin phrases are not misspellings', () => {
  it('produces no spelling issue for the citation form or the core phrases', () => {
    const text = 'Smith et al. reported in vivo and in vitro findings, and de novo '
      + 'mutations were assessed in silico and ex vivo, post hoc.';
    expect(spellingOf(text)).toEqual([]);
  });

  it('firewalls the phrase as ONE non-checkable token', () => {
    const { tokens } = tokenize('Smith et al. reported in vivo work.');
    const latin = tokens.filter((t) => t.kind === TOKEN.LATIN).map((t) => t.text.toLowerCase());
    expect(latin).toEqual(['et al.', 'in vivo']);
    expect(tokens.filter((t) => t.kind === TOKEN.LATIN).every((t) => t.checkable === false)).toBe(true);
  });

  it('leaves a bare “al” checkable — the phrase is what is trusted, not the word', () => {
    expect(spellingOf('We included al of the trials.')).toContain('al');
  });

  it('accepts the hyphenated forms a manuscript also writes', () => {
    expect(spellingOf('An in-vivo model and an ex-vivo perfusion were used.')).toEqual([]);
  });

  it('does not turn “an in vitro study” into an article error', () => {
    expect(check('An in vitro study was performed.')
      .filter((i) => i.category === CATEGORY.ARTICLE)).toEqual([]);
  });
});

/* ══════════════ Greek-suffixed symbols and astral Greek ══════════════ */

describe('120.md r2 — Greek letters never make a protein name a misspelling', () => {
  it('classifies a Greek-suffixed symbol as a symbol, not a word', () => {
    for (const sym of ['TNF-α', 'IFN-γ', 'TGF-β', 'NF-κB', 'IL-1β']) {
      expect(classifyWordRun(sym), sym).not.toBe(TOKEN.WORD);
    }
    // …while ordinary prose carrying a Greek letter is untouched.
    expect(classifyWordRun('α-blocker')).toBe(TOKEN.WORD);
  });

  it('reports nothing for the cytokine sentence that produced four errors', () => {
    expect(spellingOf('TNF-α and IFN-γ and NF-κB were measured. TNF was elevated. TGF-β too.'))
      .toEqual([]);
  });

  it('firewalls Word\'s MATHEMATICAL italic Greek exactly like the BMP letter', () => {
    // U+1D6FD is what the equation editor pastes for β; it is two UTF-16 units, so it
    // slipped past the "shorter than 2 characters" guard and was looked up.
    expect(spellingOf('Patients received \u{1D6FD}-blocker therapy.')).toEqual([]);
    expect(spellingOf('Patients received β-blocker therapy.')).toEqual([]);
    const { tokens } = tokenize('\u{1D6FD} = 0.42');
    expect(tokens[0].kind).toBe(TOKEN.GREEK);
  });
});

/* ══════════════ the markdown → plain-text projection ══════════════ */

describe('120.md r2 — projectBlock counts UTF-16 units, like every offset around it', () => {
  it('does not eat prose when an astral character precedes markdown syntax', () => {
    const src = 'Emoji 😀 then **bold** and a mispeled word.';
    const { plain } = projectBlock(src, BLOCK_KIND.PARAGRAPH);
    expect(plain).toBe('Emoji 😀 then bold and a mispeled word.');
    expect(plain).not.toContain('*');
  });

  it('keeps the map aligned with the source for an astral prefix', () => {
    const src = '𝛽 = 0.42 for **treatment** effects';
    const projection = projectBlock(src, BLOCK_KIND.PARAGRAPH);
    expect(projection.plain).toBe('𝛽 = 0.42 for treatment effects');
    const at = projection.plain.indexOf('treatment');
    expect(src.slice(projection.map[at], projection.map[at] + 'treatment'.length)).toBe('treatment');
    expect(projectOffset(projection, src.indexOf('effects'))).toBe(projection.plain.indexOf('effects'));
  });

  it('is unchanged for text with no astral characters', () => {
    expect(projectBlock('A **bold** claim', BLOCK_KIND.PARAGRAPH).plain).toBe('A bold claim');
    expect(projectBlock('## Heading', BLOCK_KIND.HEADING).plain).toBe('Heading');
  });
});

/* ══════════════ dictionary entry normalization ══════════════ */

describe('120.md r2 — dictionary terms are Unicode-normalized before they are judged', () => {
  it('accepts a DECOMPOSED word instead of claiming it does not start with a letter', () => {
    const nfd = 'naïve';                       // the PDF/macOS extraction artifact
    const parsed = normalizeDictionaryInput({ term: nfd });
    expect(parsed.ok).toBe(true);
    expect(parsed.entry.term).toBe('naïve');
    expect(parsed.entry.term.normalize('NFC')).toBe(parsed.entry.term);
  });

  it('gives the composed and decomposed spellings ONE uniqueness key', () => {
    const a = normalizeDictionaryInput({ term: 'naïve' });
    const b = normalizeDictionaryInput({ term: 'naïve' });
    expect(a.entry.termLower).toBe(b.entry.termLower);
    // …and the client derives the same key, or the duplicate check is a coin toss.
    expect(normalizeTerm('naïve').termLower).toBe(b.entry.termLower);
  });

  it('keeps meaningful capitalization while normalizing', () => {
    const parsed = normalizeDictionaryInput({ term: 'TP53' });
    expect(parsed.entry.term).toBe('TP53');
    expect(parsed.entry.termLower).toBe('tp53');
  });

  it('refuses control and bidi characters in the optional fields', () => {
    for (const bad of ['x\u0000y', 'x‮y', 'line\nbreak', 'zero​width']) {
      const parsed = normalizeDictionaryInput({ term: 'abc', expansion: bad });
      expect(parsed.ok, JSON.stringify(bad)).toBe(false);
      expect(parsed.error).toMatch(/unsupported characters/);
    }
    // …and an ordinary expansion still passes.
    expect(normalizeDictionaryInput({ term: 'abc', expansion: 'alpha beta' }).ok).toBe(true);
  });
});

/* ══════════════ source pins: hook lifetime and the server cap ══════════════ */

describe('120.md r2 — a store clear always re-checks the FOCUS section', () => {
  it('carries a check epoch that every clearing action bumps', () => {
    expect(HOOK).toContain('const [checkEpoch, setCheckEpoch] = useState(0);');
    expect(HOOK).toContain('const bumpCheck = useCallback(() => setCheckEpoch((n) => n + 1), []);');
    // recheck / the dict patch / the variant switch — the three §6 actions that clear.
    expect(HOOK).toContain('if (!first) { setStore({}); bumpCheck(); }');
    const recheckFn = HOOK.slice(HOOK.indexOf('const recheck = useCallback'));
    expect(recheckFn.slice(0, recheckFn.indexOf('}, ['))).toContain('bumpCheck();');
  });

  it('makes both focus-section debounces depend on it', () => {
    const blocksBeat = HOOK.slice(HOOK.indexOf("sendCheck(focusSection, 'blocks')"));
    expect(blocksBeat.slice(0, blocksBeat.indexOf('\n\n')))
      .toContain('blocksBySection, sendCheck, checkEpoch]');
    const docBeat = HOOK.slice(HOOK.indexOf("sendCheck(focusSection, 'document')"));
    expect(docBeat.slice(0, docBeat.indexOf('\n\n')))
      .toContain('blocksBySection, sendCheck, checkEpoch]');
  });
});

describe('120.md r2 — a CHECK-phase failure is an error state, never “No issues”', () => {
  it('stops filtering non-init errors out of the status machine', () => {
    // §6 forbids "No issues found" when checking failed; waState.statusFor guarantees
    // it, and this call site used to discard exactly the errors that could reach it.
    expect(HOOK).not.toContain("error: error && error.phase === 'init' ? error : null");
    const statusCall = HOOK.slice(HOOK.indexOf('const status = statusFor({'));
    expect(statusCall.slice(0, statusCall.indexOf('});'))).toContain('\n    error,\n');
  });

  it('releases the error when a check succeeds, and retries the failed work once', () => {
    expect(HOOK).toContain("if (errorRef.current && errorRef.current.phase !== 'init') {");
    expect(HOOK).toContain('else if (!wasFailing) setCheckEpoch((n) => n + 1);');
  });
});

describe('120.md r2 — a variant switch re-teaches the worker its dictionaries', () => {
  it('forgets the dictionary signature so the next teach is unconditional', () => {
    const effect = HOOK.slice(HOOK.indexOf('if (variantRef.current === prefs.variant) return;'));
    const body = effect.slice(0, effect.indexOf('}, [enabled, ready, prefs.variant'));
    expect(body).toContain("dictSig.current = '';");
    expect(body).toContain('bumpCheck();');
    expect(body).toContain("post({ type: 'init'");
    /* …and it drops `ready`, which is what ORDERS the re-teach: the worker's
       handleInit awaits the dictionary fetch before installing the new pipeline, so a
       `dict` posted in the same commit would land on the old one and be discarded with
       it. The dict effect gates on `ready`, so it re-teaches only once the worker has
       said the new pipeline exists. */
    expect(body).toContain('setReady(false);');
    expect(HOOK).toContain("useEffect(() => { if (!ready) dictSig.current = ''; }, [ready]);");
    const dictEffect = HOOK.slice(HOOK.indexOf("post({ type: 'dict'"));
    expect(dictEffect.slice(0, dictEffect.indexOf('\n  }, ['))).toBeTruthy();
    expect(HOOK).toContain('}, [enabled, ready, personal, project, ignoredTerms,');
  });
});

describe('120.md r2 — the worker boot cannot orphan a Worker', () => {
  it('re-checks after the await and terminates a boot nobody wants', () => {
    const bootFn = HOOK.slice(HOOK.indexOf('const boot = useCallback(async () => {'));
    const body = bootFn.slice(0, bootFn.indexOf('}, [onMessage, workerFactory]);'));
    expect(body).toContain('const epoch = bootEpoch.current;');
    expect(body).toContain('if (bootEpoch.current !== epoch || workerRef.current) {');
    expect(body).toContain('try { w.terminate(); } catch');
    // …and the cancellation happens BEFORE the worker is wired up or adopted.
    expect(body.indexOf('if (bootEpoch.current !== epoch'))
      .toBeLessThan(body.indexOf('workerRef.current = w;'));
    // teardown is what moves the epoch.
    const teardownFn = HOOK.slice(HOOK.indexOf('const teardown = useCallback(() => {'));
    expect(teardownFn.slice(0, teardownFn.indexOf('}, []);'))).toContain('bootEpoch.current += 1;');
  });
});

describe('120.md r2 — every stored dictionary row stays listable and deletable', () => {
  it('does not paginate the two list queries at the scope cap', () => {
    expect(DICT_CTRL).not.toContain('take: WA_SCOPE_MAX');
    // the cap itself is still enforced on the write path, and still reported
    expect(DICT_CTRL).toContain('if (count >= WA_SCOPE_MAX)');
    expect(DICT_CTRL).toContain('limit: WA_SCOPE_MAX');
  });
});

describe('120.md r2 — the writing-assistant sources are TEXT in git', () => {
  it('uses an escape rather than a raw NUL byte as a field separator', () => {
    for (const rel of [
      'src/features/manuscript/writingAssistant/waState.js',
      'src/features/manuscript/writingAssistant/engine/issueModel.js',
      'src/features/manuscript/writingAssistant/engine/projectLexicon.js',
    ]) {
      // A NUL in the first 8 kB makes git store the file as binary, and this repo
      // reviews by diff: `git diff`, `git blame` and every adversarial round go blind.
      const bytes = fs.readFileSync(path.resolve(rel));
      expect(bytes.includes(0), rel).toBe(false);
      expect(bytes.toString('utf8'), rel).toContain('\\u0000');
    }
  });
});
