/**
 * abstractSegments.test.js — 107.md §4. Structured-abstract heading segmentation:
 * every supported heading, every case, colon required, boundary positions, prose
 * non-matches, and the reconstruction identity. Pure; no DOM, no React.
 */
import { describe, it, expect } from 'vitest';
import {
  segmentAbstract, hasAbstractHeadings, ABSTRACT_HEADINGS,
} from '../../../src/research-engine/screening/abstractSegments.js';

const headings = t => segmentAbstract(t).filter(s => s.type === 'heading').map(s => s.text);
const reconstructs = t => segmentAbstract(t).map(s => s.text).join('') === t;

describe('segmentAbstract — heading vocabulary', () => {
  it('recognises every supported heading phrase', () => {
    for (const h of ABSTRACT_HEADINGS) {
      const text = `${h}: some body text.`;
      expect(headings(text), `heading "${h}" was not recognised`).toEqual([`${h}:`]);
    }
  });

  it('matches case-insensitively while PRESERVING the original capitalisation', () => {
    expect(headings('BACKGROUND: x')).toEqual(['BACKGROUND:']);
    expect(headings('background: x')).toEqual(['background:']);
    expect(headings('Background: x')).toEqual(['Background:']);
    expect(headings('BaCkGrOuNd: x')).toEqual(['BaCkGrOuNd:']);
  });

  it('preserves the original punctuation, including a space before the colon', () => {
    expect(headings('Methods : we did X.')).toEqual(['Methods :']);
  });

  it('prefers the LONGEST heading at a given position', () => {
    expect(headings('Materials and Methods: x')).toEqual(['Materials and Methods:']);
    expect(headings('Patients and Methods: x')).toEqual(['Patients and Methods:']);
    expect(headings('Main Outcomes and Measures: x')).toEqual(['Main Outcomes and Measures:']);
    expect(headings('Conclusions and Relevance: x')).toEqual(['Conclusions and Relevance:']);
  });
});

describe('segmentAbstract — position rules', () => {
  it('(a) at the very start of the string', () => {
    expect(headings('Objective: assess X.')).toEqual(['Objective:']);
    expect(headings('   Objective: assess X.')).toEqual(['Objective:']); // leading whitespace only
  });

  it('(b) after a line break', () => {
    const t = 'Background: a.\nMethods: b.\r\nResults: c.';
    expect(headings(t)).toEqual(['Background:', 'Methods:', 'Results:']);
  });

  it('(c) after sentence-terminal punctuation + whitespace (the PubMed flattened form)', () => {
    const t = 'BACKGROUND: Epilepsy is common. METHODS: We ran a trial. RESULTS: It worked. CONCLUSIONS: Useful.';
    expect(headings(t)).toEqual(['BACKGROUND:', 'METHODS:', 'RESULTS:', 'CONCLUSIONS:']);
  });

  it('also after ! or ? and through a closing quote', () => {
    expect(headings('Is it useful? Conclusions: yes.')).toEqual(['Conclusions:']);
    expect(headings('It works!  Results: strong.')).toEqual(['Results:']);
    expect(headings('He said "it works." Results: strong.')).toEqual(['Results:']);
  });

  it('requires the colon', () => {
    expect(headings('Background the study was small.')).toEqual([]);
    expect(headings('Methods\nWe ran a trial.')).toEqual([]);
    expect(headings('Results - it worked.')).toEqual([]);
  });
});

describe('segmentAbstract — prose must NOT be bolded', () => {
  it('does not match a heading word used as prose', () => {
    expect(headings('The methods used in previous studies differed substantially.')).toEqual([]);
    expect(headings('These results demonstrate improvement.')).toEqual([]);
    expect(headings('Our objective was to assess X.')).toEqual([]);
  });

  it('does not match mid-sentence even when a colon follows', () => {
    expect(headings('There were three results: A, B and C.')).toEqual([]);
    expect(headings('We measured two objectives: safety and efficacy.')).toEqual([]);
    expect(headings('Patients were grouped by background: rural or urban.')).toEqual([]);
  });

  it('does not match a heading word glued to another word', () => {
    expect(headings('Nonmethods: x')).toEqual([]);
    expect(headings('Subresults: x')).toEqual([]);
  });
});

describe('segmentAbstract — invariants', () => {
  const samples = [
    'BACKGROUND: Epilepsy is common. METHODS: A trial. RESULTS: Good. CONCLUSIONS: Useful.',
    'Background:\nEpilepsy.\nMethods:\nA trial.',
    'The methods used in previous studies differed substantially.',
    'There were three results: A, B and C.',
    '  Objective: assess X.  ',
    'Methods : we did X.',
    '',
    'No headings at all.',
    'Trial Registration: NCT01234567. Funding: none.',
  ];

  it('concatenating the segments reproduces the input byte-identically', () => {
    for (const s of samples) expect(reconstructs(s), JSON.stringify(s)).toBe(true);
  });

  it('emits nothing for empty / non-string input', () => {
    expect(segmentAbstract('')).toEqual([]);
    expect(segmentAbstract(null)).toEqual([]);
    expect(segmentAbstract(undefined)).toEqual([]);
    expect(segmentAbstract(42)).toEqual([]);
  });

  it('an abstract with no headings is one plain text segment', () => {
    expect(segmentAbstract('Just prose.')).toEqual([{ type: 'text', text: 'Just prose.' }]);
    expect(hasAbstractHeadings('Just prose.')).toBe(false);
    expect(hasAbstractHeadings('Methods: yes.')).toBe(true);
  });

  it('segments alternate correctly and never overlap', () => {
    const segs = segmentAbstract('Background: a. Methods: b.');
    expect(segs.map(s => s.type)).toEqual(['heading', 'text', 'heading', 'text']);
    expect(segs.map(s => s.text)).toEqual(['Background:', ' a. ', 'Methods:', ' b.']);
  });
});
