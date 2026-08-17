/**
 * 120.md §6 — the scientific-token FIREWALL.
 *
 * §6's "Token and identifier handling" section is a list of things that must never
 * become spelling errors. This file is that list, turned into assertions: every entry
 * is checked to tokenize as a NON-CHECKABLE token so it can never reach the
 * dictionary in the first place. It also pins the two structural invariants the
 * decoration layer depends on — masking preserves length, and every token's
 * [start,end) slices back to its own text.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenize, maskNonProse, subWords, splitSentences, classifyWordRun, isCheckable,
  MASK_CHAR, TOKEN,
} from '../../../../src/features/manuscript/writingAssistant/engine/tokenize.js';

/** The kinds of every token overlapping `needle` inside `text`. */
function kindsOf(text, needle) {
  const start = text.indexOf(needle);
  expect(start, `"${needle}" not found in "${text}"`).toBeGreaterThanOrEqual(0);
  const end = start + needle.length;
  return tokenize(text).tokens
    .filter((t) => t.start < end && t.end > start)
    .map((t) => t.kind);
}

/** Assert that nothing overlapping `needle` is offered to the spell checker. */
function expectNonCheckable(text, needle) {
  const overlapping = tokenize(text).tokens.filter((t) => {
    const start = text.indexOf(needle);
    return t.start < start + needle.length && t.end > start;
  });
  expect(overlapping.length, `no tokens for "${needle}"`).toBeGreaterThan(0);
  for (const token of overlapping) {
    expect(isCheckable(token), `"${token.text}" (${token.kind}) leaked past the firewall`).toBe(false);
  }
}

describe('120.md §6 — tokenizer firewall: identifiers', () => {
  const CASES = [
    ['A DOI: 10.1001/jama.2024.1234 was recorded.', '10.1001/jama.2024.1234'],
    ['Prefixed doi:10.1136/bmj.n71 in the reference.', 'doi:10.1136/bmj.n71'],
    ['See PMID: 38123456 for details.', 'PMID: 38123456'],
    ['Indexed as PMC9876543 in the archive.', 'PMC9876543'],
    ['Registered as NCT04512345 before enrolment.', 'NCT04512345'],
    ['Registered as ISRCTN12345678 in the registry.', 'ISRCTN12345678'],
    ['PROSPERO record CRD42021234567 was updated.', 'CRD42021234567'],
    ['Contact author@example.org for the data.', 'author@example.org'],
    ['The file supplement_v2.pdf accompanies this.', 'supplement_v2.pdf'],
    ['Analysis used version 4.2.1 of the package.', '4.2.1'],
  ];
  for (const [sentence, token] of CASES) {
    it(`never spell-checks ${token}`, () => { expectNonCheckable(sentence, token); });
  }

  it('classifies a bare URL as non-prose and masks it to the same length', () => {
    const text = 'Available at https://example.org/a/b?c=1 today.';
    const masked = maskNonProse(text);
    expect(masked).toHaveLength(text.length);
    expect(masked).toContain(MASK_CHAR);
    expectNonCheckable(text, 'https://example.org/a/b?c=1');
  });
});

describe('120.md §6 — tokenizer firewall: statistics and units', () => {
  const CASES = [
    ['Significance was set at p < 0.05 throughout.', 'p < 0.05'],
    ['Reported as P = .04 in the table.', 'P = .04'],
    ['The estimate was 1.42 (95% CI 1.11 to 1.82).', '95% CI'],
    ['Heterogeneity was I² = 46%.', 'I²'],
    ['Between-study variance was τ² = 0.08.', 'τ²'],
    ['We report OR = 1.25 for the primary outcome.', 'OR = 1.25'],
    ['The sample was n = 1204 participants.', 'n = 1204'],
    ['Blood pressure fell to 120 mmHg overall.', '120 mmHg'],
    ['Creatinine clearance was 45 mL/min/1.73 m² at baseline.', '45 mL/min/1.73 m²'],
    ['Body mass index was 27.4 kg/m² on average.', '27.4 kg/m²'],
    ['Glucose was 5.6 mmol/L at screening.', '5.6 mmol/L'],
    ['Cholesterol was 180 mg/dL at week 12.', '180 mg/dL'],
    ['The dose was 5 mg/kg every eight weeks.', '5 mg/kg'],
    ['Ages ranged 12–15 years in the cohort.', '12–15'],
    ['Enrolment spanned 2019–2021 at all sites.', '2019–2021'],
  ];
  for (const [sentence, token] of CASES) {
    it(`never spell-checks ${token}`, () => { expectNonCheckable(sentence, token); });
  }

  it('does not swallow ordinary nouns that follow a number', () => {
    // "12 months" must NOT become a unit — that would stop checking real prose.
    const kinds = kindsOf('Participants were followed for 12 months.', 'months');
    expect(kinds).toEqual([TOKEN.WORD]);
  });

  it('leaves "in" and other ambiguous single letters as ordinary words', () => {
    const kinds = kindsOf('The change in outcome was small.', 'in');
    expect(kinds).toEqual([TOKEN.WORD]);
  });
});

describe('120.md §6 — tokenizer firewall: symbols, genes and formulas', () => {
  it('treats Greek letters and the micro sign as non-checkable', () => {
    expectNonCheckable('The α level was fixed.', 'α');
    expectNonCheckable('Power was 1 − β for the primary outcome.', 'β');
    expectNonCheckable('Concentration was 5 µmol/L in serum.', 'µmol/L');
  });

  it('classifies gene and protein symbols as gene tokens', () => {
    expect(classifyWordRun('TP53')).toBe(TOKEN.GENE);
    expect(classifyWordRun('BRCA1')).toBe(TOKEN.GENE);
    expect(classifyWordRun('IL-6')).toBe(TOKEN.GENE);
    expect(classifyWordRun('HbA1c')).toBe(TOKEN.GENE);
    expect(classifyWordRun('SARS-CoV-2')).toBe(TOKEN.GENE);
    expectNonCheckable('Expression of TP53 was measured.', 'TP53');
    expectNonCheckable('Serum IL-6 rose sharply.', 'IL-6');
  });

  it('classifies chemical formulas but not database names', () => {
    expect(classifyWordRun('NaCl')).toBe(TOKEN.CHEMICAL);
    expect(classifyWordRun('CO2')).toBe(TOKEN.GENE); // digit-bearing → gene/marker path
    expect(classifyWordRun('MEDLINE')).toBe(TOKEN.ACRONYM);
    expect(classifyWordRun('PRISMA')).toBe(TOKEN.ACRONYM);
    expect(classifyWordRun('CENTRAL')).toBe(TOKEN.ACRONYM);
  });

  it('treats all-caps and mixed-case abbreviations as acronyms, not words', () => {
    expect(classifyWordRun('MRI')).toBe(TOKEN.ACRONYM);
    expect(classifyWordRun('HRQoL')).toBe(TOKEN.ACRONYM);
    expect(classifyWordRun('PubMed')).toBe(TOKEN.ACRONYM);
    // An ordinary Capitalized word has exactly one capital and stays checkable.
    expect(classifyWordRun('Patients')).toBe(TOKEN.WORD);
    expect(classifyWordRun('hepatocelular')).toBe(TOKEN.WORD);
  });
});

describe('120.md §6 — masking preserves offsets', () => {
  it('masks [[token]] chips, code spans and link targets to the same length', () => {
    const text = 'See [[cite:r1]] and `code` and [label](https://x.example/y) here.';
    const masked = maskNonProse(text);
    expect(masked).toHaveLength(text.length);
    // The link LABEL stays checkable prose; its destination does not.
    expect(masked).toContain('label');
    expect(masked).not.toContain('cite:r1');
    expect(masked).not.toContain('x.example');
  });

  it('is idempotent', () => {
    const text = 'A [[fact:k]] and `x` remain.';
    expect(maskNonProse(maskNonProse(text))).toBe(maskNonProse(text));
  });

  it('classifies a mask run as a non-checkable placeholder', () => {
    const { tokens } = tokenize('Value [[fact:k]] here.');
    const placeholder = tokens.find((t) => t.kind === TOKEN.PLACEHOLDER);
    expect(placeholder).toBeTruthy();
    expect(isCheckable(placeholder)).toBe(false);
  });

  it('gives every token offsets that slice back to its own text', () => {
    const text = 'The Newcastle–Ottawa Scale scored 7/9 (p < 0.05) in [[cite:r1]].';
    const { text: masked, tokens } = tokenize(text);
    for (const token of tokens) {
      expect(masked.slice(token.start, token.end)).toBe(token.text);
    }
  });
});

describe('120.md §6 — hyphenation, possessives and sentence splitting', () => {
  it('keeps an en-dash compound as one word and splits it for lookup', () => {
    const { tokens } = tokenize('The Newcastle–Ottawa Scale was used.');
    const compound = tokens.find((t) => t.text.includes('–'));
    expect(compound.kind).toBe(TOKEN.WORD);
    expect(subWords(compound).map((p) => p.word)).toEqual(['Newcastle', 'Ottawa']);
  });

  it('strips possessives without losing the offset of the base word', () => {
    const { tokens } = tokenize("the patient's record");
    const token = tokens.find((t) => t.text.includes("'"));
    const [part] = subWords(token);
    expect(part.word).toBe('patient');
    expect(part.start).toBe(4);
    expect(part.end).toBe(11);
  });

  it('does not split on abbreviations, initials or decimals', () => {
    const sentences = splitSentences('Smith et al. reported p < 0.05 in Fig. 2. J. Smith agreed.');
    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toContain('Fig. 2.');
    expect(sentences[1].text).toBe('J. Smith agreed.');
  });
});
