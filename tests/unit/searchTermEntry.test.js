/**
 * searchTermEntry.test.js — 85.md A1. Typed/pasted term entry: newline/semicolon
 * splitting (NEVER comma — MeSH headings contain commas), symmetric-quote
 * normalization (fixes the ""double quoting"" compile bug), and the deduped batch
 * add that fixes commitAdd's no-dedupe bug.
 */
import { describe, it, expect } from 'vitest';
import {
  splitTermInput, normalizeTypedTerm, addTypedTerms,
} from '../../src/research-engine/searchBuilder/termEntry.js';
import { compileStrategy } from '../../src/research-engine/searchBuilder/compilers/index.js';

const concept = (id, terms = []) => ({ id, label: 'C', op: 'AND', terms });
const term = (text) => ({ id: `t-${text}`, text, type: 'freetext', field: 'tiab', source: 'user_added' });

describe('splitTermInput', () => {
  it('splits on newlines', () => {
    expect(splitTermInput('stroke\nTIA\r\ncerebrovascular accident')).toEqual({
      terms: ['stroke', 'TIA', 'cerebrovascular accident'], usedSeparator: 'newline',
    });
  });
  it('splits on semicolons', () => {
    expect(splitTermInput('stroke; TIA;  brain attack ')).toEqual({
      terms: ['stroke', 'TIA', 'brain attack'], usedSeparator: 'semicolon',
    });
  });
  it('NEVER splits on comma — a pasted MeSH heading stays ONE term', () => {
    expect(splitTermInput('Diabetes Mellitus, Type 2')).toEqual({
      terms: ['Diabetes Mellitus, Type 2'], usedSeparator: null,
    });
    expect(splitTermInput('1,25-dihydroxyvitamin D').terms).toEqual(['1,25-dihydroxyvitamin D']);
  });
  it('handles both separators (newline reported as dominant), trims, drops empties, dedupes by norm', () => {
    const out = splitTermInput('stroke;\nSTROKE\n\n;  Stroke!  \nTIA');
    expect(out.terms).toEqual(['stroke', 'TIA']); // first spelling wins
    expect(out.usedSeparator).toBe('newline');
  });
  it('single plain term → no separator', () => {
    expect(splitTermInput('heart failure')).toEqual({ terms: ['heart failure'], usedSeparator: null });
    expect(splitTermInput('')).toEqual({ terms: [], usedSeparator: null });
    expect(splitTermInput(null)).toEqual({ terms: [], usedSeparator: null });
  });
});

describe('normalizeTypedTerm', () => {
  it('strips ONE symmetric outer double-quote pair and flags phrase:true', () => {
    expect(normalizeTypedTerm('"heart attack"')).toEqual({ text: 'heart attack', phrase: true });
    expect(normalizeTypedTerm('“heart attack”')).toEqual({ text: 'heart attack', phrase: true });
    expect(normalizeTypedTerm("'heart attack'")).toEqual({ text: 'heart attack', phrase: true });
  });
  it('leaves unquoted input untouched (phrase:false)', () => {
    expect(normalizeTypedTerm('heart attack')).toEqual({ text: 'heart attack', phrase: false });
    expect(normalizeTypedTerm('metformin')).toEqual({ text: 'metformin', phrase: false });
  });
  it('does NOT strip when the quotes are not one enclosing pair', () => {
    expect(normalizeTypedTerm('"a" and "b"')).toEqual({ text: '"a" and "b"', phrase: false });
    expect(normalizeTypedTerm('"unbalanced')).toEqual({ text: '"unbalanced', phrase: false });
    expect(normalizeTypedTerm('it\'s')).toEqual({ text: "it's", phrase: false });
  });
  it('tolerates junk and empty quotes', () => {
    expect(normalizeTypedTerm('""')).toEqual({ text: '""', phrase: false }); // nothing inside → untouched
    expect(normalizeTypedTerm(null)).toEqual({ text: '', phrase: false });
  });
  it('the stripped phrase compiles with exactly ONE pair of quotes (the original bug)', () => {
    const { text, phrase } = normalizeTypedTerm('"heart attack"');
    const strategy = { concepts: [concept('c1', [{ id: 't1', text, type: 'freetext', field: 'tiab', phrase }])], filters: {}, overrides: {} };
    const q = compileStrategy(strategy, 'pubmed').query;
    expect(q).toContain('"heart attack"');
    expect(q).not.toContain('""heart attack""');
  });
});

describe('addTypedTerms', () => {
  it('adds a single typed term as id-less freetext/tiab/user_added', () => {
    const { concepts, added, duplicates } = addTypedTerms([concept('c1')], 'c1', 'heart failure');
    expect(added).toEqual(['heart failure']);
    expect(duplicates).toEqual([]);
    const t = concepts[0].terms[0];
    expect(t).toEqual({ text: 'heart failure', type: 'freetext', field: 'tiab', source: 'user_added' });
    expect(t.id).toBeUndefined(); // caller assigns ids (addManualTermToField contract)
  });
  it('adds a batch from pasted lines, reporting duplicates instead of silently dropping or doubling', () => {
    const cs = [concept('c1', [term('stroke')])];
    const out = addTypedTerms(cs, 'c1', 'stroke\nTIA\nStroke!\n"brain attack"');
    expect(out.added).toEqual(['TIA', 'brain attack']);
    expect(out.duplicates).toEqual(['stroke']); // batch-internal 'Stroke!' already deduped by the splitter
    expect(out.concepts[0].terms.map((t) => t.text)).toEqual(['stroke', 'TIA', 'brain attack']);
  });
  it('dedupes case/punctuation-insensitively against the concept (fixes commitAdd)', () => {
    const cs = [concept('c1', [term('heart failure')])];
    const out = addTypedTerms(cs, 'c1', 'Heart Failure');
    expect(out.added).toEqual([]);
    expect(out.duplicates).toEqual(['Heart Failure']);
    expect(out.concepts).toBe(cs); // nothing added → same array (no spurious autosave)
  });
  it('carries the phrase hint from quoted input', () => {
    const out = addTypedTerms([concept('c1')], 'c1', '"acute coronary syndrome"');
    expect(out.concepts[0].terms[0]).toMatchObject({ text: 'acute coronary syndrome', phrase: true });
  });
  it('is a no-op for an unknown concept or empty input', () => {
    const cs = [concept('c1')];
    expect(addTypedTerms(cs, 'nope', 'x')).toEqual({ concepts: cs, added: [], duplicates: [] });
    expect(addTypedTerms(cs, 'c1', '  ')).toEqual({ concepts: cs, added: [], duplicates: [] });
    expect(addTypedTerms(null, 'c1', 'x')).toEqual({ concepts: [], added: [], duplicates: [] });
  });
  it('does not touch other concepts and never mutates the input', () => {
    const cs = [concept('c1', [term('a')]), concept('c2', [term('b')])];
    const out = addTypedTerms(cs, 'c2', 'c');
    expect(out.concepts[0]).toBe(cs[0]); // untouched concept keeps its reference
    expect(cs[1].terms.map((t) => t.text)).toEqual(['b']); // input not mutated
    expect(out.concepts[1].terms.map((t) => t.text)).toEqual(['b', 'c']);
  });
});
