/**
 * conceptExtraction.test.js — prompt40 Task 3. Multi-concept extraction from PICO
 * phrases, using the prompt's own worked examples as the contract.
 */
import { describe, it, expect } from 'vitest';
import {
  extractConcepts, picoToConcepts, splitSegments, stripJunk, matchFamily, expandAbbreviation, norm,
} from '../../src/research-engine/searchBuilder/conceptExtraction.js';

// Helper: the lowercased primary-term texts of each extracted concept.
const primaries = (cs) => cs.map((c) => norm(c.terms[0].text));
// Helper: all lowercased term texts of all concepts, flattened.
const allTerms = (cs) => cs.flatMap((c) => c.terms.map((t) => norm(t.text)));

describe('splitSegments', () => {
  it('splits on clinical connectors, longest first', () => {
    expect(splitSegments('type 2 diabetes mellitus with HFrEF')).toEqual(['type 2 diabetes mellitus', 'HFrEF']);
    expect(splitSegments('A versus B')).toEqual(['A', 'B']);
    expect(splitSegments('A compared with B')).toEqual(['A', 'B']);
    expect(splitSegments('a, b; c / d')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('"in"/"among" only trim a trailing population qualifier; fixed phrases stay intact', () => {
    expect(splitSegments('heart failure in adults')).toEqual(['heart failure']);
    expect(splitSegments('mortality among patients')).toEqual(['mortality']);
    expect(splitSegments('carcinoma in situ')).toEqual(['carcinoma in situ']);   // NOT ['carcinoma','situ']
    expect(splitSegments('pain in the chest')).toEqual(['pain in the chest']);   // fixed phrase preserved
  });
});

describe('stripJunk', () => {
  it('drops leading/trailing junk + stopwords, keeps the medical core', () => {
    expect(stripJunk('IBD patients')).toBe('IBD');
    expect(stripJunk('adult patients')).toBe('');
    expect(stripJunk('endoscopic submucosal dissection')).toBe('endoscopic submucosal dissection');
  });
});

describe('matchFamily — no false short-abbreviation matches', () => {
  it('does not match "af" inside "graft"', () => {
    const fam = matchFamily('coronary artery bypass grafting');
    expect(fam == null || fam.id !== 'af').toBe(true);
  });
  it('matches exact family triggers', () => {
    expect(matchFamily('type 2 diabetes mellitus').id).toBe('t2dm');
    expect(matchFamily('hfref').id).toBe('hfref');
    expect(matchFamily('endoscopic submucosal dissection').id).toBe('esd');
  });
});

describe('extractConcepts — prompt worked examples', () => {
  it('"type 2 diabetes mellitus with HFrEF" → diabetes + heart-failure concepts', () => {
    const cs = extractConcepts('type 2 diabetes mellitus with HFrEF', 'Population');
    expect(cs.length).toBe(2);
    const terms = allTerms(cs);
    expect(terms).toEqual(expect.arrayContaining(['type 2 diabetes mellitus', 'diabetes mellitus', 'diabetes']));
    expect(terms).toEqual(expect.arrayContaining(['heart failure with reduced ejection fraction', 'hfref', 'heart failure']));
    expect(cs.every((c) => c.field === 'Population')).toBe(true);
  });

  it('"IBD patients undergoing endoscopic submucosal dissection" → IBD + ESD concepts', () => {
    const cs = extractConcepts('IBD patients undergoing endoscopic submucosal dissection', 'Population');
    const terms = allTerms(cs);
    expect(terms).toEqual(expect.arrayContaining(['inflammatory bowel disease', 'ibd']));
    expect(terms).toEqual(expect.arrayContaining(['endoscopic submucosal dissection', 'esd']));
  });

  it('"EUS-guided gallbladder drainage versus percutaneous cholecystostomy" → both arms', () => {
    const cs = extractConcepts('EUS-guided gallbladder drainage versus percutaneous cholecystostomy', 'Intervention');
    expect(cs.length).toBe(2);
    const terms = allTerms(cs);
    expect(terms).toEqual(expect.arrayContaining(['eus-guided gallbladder drainage', 'endoscopic ultrasound-guided gallbladder drainage', 'eus-gbd']));
    expect(terms).toEqual(expect.arrayContaining(['percutaneous cholecystostomy', 'percutaneous gallbladder drainage', 'pt-gbd']));
  });

  it('does not stop after the first concept / does not extract only "diabetes"', () => {
    const cs = extractConcepts('type 2 diabetes mellitus with HFrEF', 'Population');
    expect(primaries(cs).length).toBeGreaterThan(1);
  });

  it('marks the first term as primary and the rest as synonyms', () => {
    const [c] = extractConcepts('type 2 diabetes mellitus', 'Population');
    expect(c.terms[0].synonym).toBe(false);
    expect(c.terms.slice(1).every((t) => t.synonym === true)).toBe(true);
    expect(c.terms.every((t) => t.source === 'pico_auto' && t.type === 'freetext')).toBe(true);
  });

  it('dedupes terms within a concept and drops junk-only segments', () => {
    const cs = extractConcepts('adult patients', 'Population');
    expect(cs).toEqual([]);
  });

  it('unknown phrase → kept as-is, abbreviation expanded when known', () => {
    const cs = extractConcepts('myocardial fibrosis', 'Outcome');
    expect(primaries(cs)).toEqual(['myocardial fibrosis']);
    const rct = extractConcepts('RCT', 'Population');
    expect(allTerms(rct)).toEqual(expect.arrayContaining(['rct', 'randomized controlled trial']));
  });
});

describe('picoToConcepts', () => {
  it('processes each field independently and tags the source field', () => {
    const cs = picoToConcepts({ P: 'type 2 diabetes', I: 'SGLT2 inhibitor', C: '', O: 'all-cause mortality' });
    const byField = cs.reduce((m, c) => { (m[c.field] = m[c.field] || []).push(c); return m; }, {});
    expect(Object.keys(byField)).toEqual(expect.arrayContaining(['Population', 'Outcome']));
    expect(allTerms(cs)).toEqual(expect.arrayContaining(['diabetes', 'mortality']));
  });
  it('tolerates empty / missing PICO', () => {
    expect(picoToConcepts(null)).toEqual([]);
    expect(picoToConcepts({})).toEqual([]);
  });
});

describe('expandAbbreviation', () => {
  it('expands known abbreviations, null otherwise', () => {
    expect(expandAbbreviation('COPD')).toBe('chronic obstructive pulmonary disease');
    expect(expandAbbreviation('zzz')).toBeNull();
  });
});

// SE1 Task 2 — each emitted term/concept carries provenance metadata so chips can
// show their source PICO field and type, WITHOUT mutating the original PICO text.
describe('term/concept metadata (SE1 Task 2)', () => {
  it('tags every term with its source PICO field and a normalizedLabel', () => {
    const cs = extractConcepts('type 2 diabetes mellitus with HFrEF', 'Population');
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c.field).toBe('Population');
      expect(c.normalizedLabel).toBe(norm(c.label));
      for (const t of c.terms) {
        expect(t.sourceField).toBe('Population');
        expect(t.normalizedLabel).toBe(norm(t.text));
        expect(t.source).toBe('pico_auto');
      }
    }
  });

  it('carries the correct source field per PICO field across the whole object', () => {
    const cs = picoToConcepts({ P: 'type 2 diabetes', I: 'SGLT2 inhibitor', C: '', O: 'all-cause mortality' });
    const fieldOf = (primary) => cs.find((c) => norm(c.terms[0].text) === primary)?.terms[0].sourceField;
    expect(fieldOf('mortality')).toBe('Outcome');
    expect(cs.find((c) => c.field === 'Population')).toBeTruthy();
  });

  it('re-extraction is idempotent — same PICO yields the same concepts (no duplicates)', () => {
    const pico = { P: 'type 2 diabetes mellitus with HFrEF', I: 'SGLT2 inhibitor', C: 'placebo', O: 'all-cause mortality' };
    const a = picoToConcepts(pico);
    const b = picoToConcepts(pico);
    expect(primaries(a)).toEqual(primaries(b));
    // No duplicate primary concepts within a single extraction.
    expect(new Set(primaries(a)).size).toBe(primaries(a).length);
  });
});
