/**
 * duplicateDetectionEngine.test.js — 92.md pure detection engine.
 *
 * Covers: banded-Levenshtein equivalence with the reference implementation,
 * exact DOI/PMID grouping, fuzzy matching behaviour (threshold, year gate,
 * min-title-length), blocking recall vs the legacy brute-force detector,
 * reviewer-exclusion + pre-union rules, safety caps, determinism, cooperative
 * yielding, and a 10k-record performance smoke test.
 */
import { describe, it, expect } from 'vitest';
import {
  DUP_DETECT_DEFAULTS,
  boundedLevenshtein,
  similarityAtLeast,
  maxDistFor,
  blockKeysFor,
  createUnionFind,
  pairKey,
  normalizeRecordForDedup,
  detectDuplicateGroups,
} from '../../../src/research-engine/screening/duplicateDetectionEngine.js';
import {
  levenshtein as refLevenshtein,
  titleSimilarity as refTitleSimilarity,
  findDuplicateGroups as legacyFindDuplicateGroups,
  normalizeTitle,
} from '../../../src/research-engine/screening/deduplication.js';

// Seeded RNG — deterministic tests.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['effect', 'randomized', 'controlled', 'trial', 'outcomes', 'therapy', 'patients', 'chronic', 'disease', 'intervention', 'systematic', 'analysis', 'cohort', 'treatment', 'clinical', 'double', 'blind', 'placebo', 'versus', 'standard', 'care', 'mortality', 'risk', 'reduction', 'evaluation'];
function makeTitle(rnd, nWords = 9) {
  const parts = [];
  for (let i = 0; i < nWords; i++) parts.push(WORDS[Math.floor(rnd() * WORDS.length)] + Math.floor(rnd() * 50));
  return parts.join(' ');
}

// Normalization-equivalent cosmetic variant (case/punctuation/spacing).
function cosmeticVariant(title, rnd) {
  const modes = [
    (t) => t.toUpperCase(),
    (t) => t.replace(/ /g, '  '),
    (t) => `${t}.`,
    (t) => t.replace(/ /g, ' - '),
  ];
  return modes[Math.floor(rnd() * modes.length)](title);
}

// Single-character typo somewhere in the middle (a REAL edit after normalization).
function typoVariant(title, rnd) {
  const i = 5 + Math.floor(rnd() * Math.max(1, title.length - 10));
  const c = title[i] === 'a' ? 'e' : 'a';
  return title.slice(0, i) + c + title.slice(i + 1);
}

describe('boundedLevenshtein', () => {
  it('matches the reference distance whenever the reference is within budget', () => {
    const rnd = mulberry32(42);
    const alphabet = 'abcd ';
    const randStr = (len) => Array.from({ length: len }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    for (let t = 0; t < 500; t++) {
      const a = randStr(Math.floor(rnd() * 25));
      const b = randStr(Math.floor(rnd() * 25));
      const maxDist = Math.floor(rnd() * 8);
      const ref = refLevenshtein(a, b);
      const got = boundedLevenshtein(a, b, maxDist);
      if (ref <= maxDist) expect(got).toBe(ref);
      else expect(got).toBeGreaterThan(maxDist);
    }
  });

  it('handles trivial and edge inputs', () => {
    expect(boundedLevenshtein('', '', 3)).toBe(0);
    expect(boundedLevenshtein('abc', 'abc', 0)).toBe(0);
    expect(boundedLevenshtein('abc', 'abd', 0)).toBeGreaterThan(0);
    expect(boundedLevenshtein('abc', 'abcd', 1)).toBe(1);
    expect(boundedLevenshtein('a', 'abcdefgh', 3)).toBeGreaterThan(3); // length gap early-exit
  });
});

describe('similarityAtLeast', () => {
  it('agrees with the reference titleSimilarity at/above the threshold and returns 0 below it', () => {
    const rnd = mulberry32(7);
    for (let t = 0; t < 200; t++) {
      const na = normalizeTitle(makeTitle(rnd));
      const nb = rnd() < 0.5 ? normalizeTitle(typoVariant(na, rnd)) : normalizeTitle(makeTitle(rnd));
      const ref = refTitleSimilarity(na, nb);
      const got = similarityAtLeast(na, nb, 0.92);
      if (ref >= 0.92) expect(got).toBeCloseTo(ref, 10);
      else expect(got).toBe(0);
    }
  });
});

describe('maxDistFor — threshold boundary (rec-round float fix)', () => {
  it('accepts pairs at EXACTLY the threshold: (1-0.92) is 0.0799…96 in IEEE floats', () => {
    // floor((1-0.92)*25) = 1 (wrong); the legacy rule accepts d=2 (23/25 = 0.92).
    expect(maxDistFor(25, 0.92)).toBe(2);
    expect(maxDistFor(50, 0.92)).toBe(4);
    expect(maxDistFor(75, 0.92)).toBe(6);
    expect(maxDistFor(13, 0.92)).toBe(1); // 12/13 ≥ 0.92, 11/13 < 0.92
    expect(maxDistFor(10, 0.92)).toBe(0); // 9/10 < 0.92
  });

  it('is exactly the largest d with (maxLen-d)/maxLen >= threshold, brute-forced', () => {
    for (let maxLen = 1; maxLen <= 200; maxLen++) {
      for (const t of [0.8, 0.85, 0.9, 0.92, 0.95]) {
        let want = 0;
        while (want + 1 <= maxLen && (maxLen - (want + 1)) / maxLen >= t - 1e-12) want += 1;
        expect(maxDistFor(maxLen, t)).toBe(want);
      }
    }
  });

  it('groups a pair at exactly 0.92 similarity (50-char titles, 4 end edits)', async () => {
    // 50 normalized chars, 4 substitutions clustered at the END (shared p: key),
    // similarity = 46/50 = 0.92 exactly — the legacy >= rule accepts it; the
    // pre-fix floor((1-0.92)*50) budget of 3 rejected it.
    const a50 = 'aaaab bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
    const b50 = 'aaaab bbbb cccc dddd eeee ffff gggg hhhh iiii zzzz';
    expect(a50.length).toBe(50);
    expect(similarityAtLeast(a50, b50, 0.92)).toBeCloseTo(0.92, 12);
    const { groups } = await detectDuplicateGroups([
      { id: 'x', title: a50, doi: '', pmid: '', year: '2020' },
      { id: 'y', title: b50, doi: '', pmid: '', year: '2020' },
    ]);
    expect(groups).toEqual([['x', 'y']]);
  });
});

describe('blockKeysFor / union-find', () => {
  it('produces prefix, middle, suffix, and two token-tier keys', () => {
    const keys = blockKeysFor('alpha beta gamma delta epsilon zeta omicron sigma upsilon lambda');
    expect(keys.some((k) => k.startsWith('p:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('m:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('s:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('t:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('u:'))).toBe(true);
  });

  it('union-find tracks ≥2-member group count through merges', () => {
    const uf = createUnionFind();
    expect(uf.union('a', 'b')).toBe(true);
    expect(uf.groupCount).toBe(1);
    uf.union('c', 'd');
    expect(uf.groupCount).toBe(2);
    uf.union('a', 'c'); // two groups merge → one
    expect(uf.groupCount).toBe(1);
    expect(uf.union('a', 'd')).toBe(false); // already connected
    expect(uf.groups()).toEqual([['a', 'b', 'c', 'd']]);
  });
});

describe('detectDuplicateGroups — matching rules', () => {
  it('groups exact DOI duplicates regardless of case/whitespace', async () => {
    const { groups } = await detectDuplicateGroups([
      { id: 'a', title: 'Completely different title one about hearts', doi: ' 10.1000/XYZ ', pmid: '', year: '2020' },
      { id: 'b', title: 'Another unrelated title about lungs entirely', doi: '10.1000/xyz', pmid: '', year: '2021' },
      { id: 'c', title: 'Third record with its own topic and words', doi: '10.1000/other', pmid: '', year: '2020' },
    ]);
    expect(groups).toEqual([['a', 'b']]);
  });

  it('groups exact PMID duplicates and unions across DOI groups', async () => {
    const { groups } = await detectDuplicateGroups([
      { id: 'a', title: 'First distinct long title for testing here', doi: '10.1/a', pmid: '111', year: '' },
      { id: 'b', title: 'Second distinct long title for testing here yes', doi: '10.1/a', pmid: '', year: '' },
      { id: 'c', title: 'Third totally different words in this title', doi: '', pmid: '111', year: '' },
    ]);
    expect(groups).toEqual([['a', 'b', 'c']]);
  });

  it('fuzzy-matches normalized titles across punctuation/case/spacing/typos', async () => {
    const base = 'Effect of aspirin therapy on cardiovascular outcomes in chronic disease patients';
    const { groups } = await detectDuplicateGroups([
      { id: 'a', title: base, doi: '', pmid: '', year: '2020' },
      { id: 'b', title: base.toUpperCase() + '.', doi: '', pmid: '', year: '2020' },      // cosmetic
      { id: 'c', title: typoVariant(base, mulberry32(3)), doi: '', pmid: '', year: '' },  // typo, year missing → allowed
      { id: 'e', title: 'Short title', doi: '', pmid: '', year: '2020' },                 // below min length
    ]);
    expect(groups).toEqual([['a', 'b', 'c']]);
  });

  it('never fuzzy-links records whose years both exist and differ', async () => {
    const base = 'Effect of aspirin therapy on cardiovascular outcomes in chronic disease patients';
    const { groups } = await detectDuplicateGroups([
      { id: 'a', title: base, doi: '', pmid: '', year: '2020' },
      { id: 'd', title: base, doi: '', pmid: '', year: '2019' },
    ]);
    expect(groups).toEqual([]);
  });

  it('unicode/diacritic differences normalize away', async () => {
    const { groups } = await detectDuplicateGroups([
      { id: 'a', title: 'Café-au-lait spots in neurofibromatosis: a systematic review', doi: '', pmid: '', year: '2020' },
      { id: 'b', title: 'Cafe au lait spots in neurofibromatosis a systematic review', doi: '', pmid: '', year: '2020' },
    ]);
    // "é" is stripped by normalizeTitle ("caf" vs "cafe" → 1 edit) — still a match.
    expect(groups).toEqual([['a', 'b']]);
  });

  it('an excluded pair cannot eject a record from its own identifier group (rec-round fix)', async () => {
    // A,B,C share a DOI; the reviewer labelled (A,B) not_duplicate. B must still
    // join the group THROUGH C (transitive co-membership is documented); with the
    // old first-predecessor chain, B was silently orphaned.
    const { groups } = await detectDuplicateGroups(
      [
        { id: 'a', title: 'First topic entirely about cardiology outcomes', doi: '10.1/same', pmid: '', year: '' },
        { id: 'b', title: 'Second unrelated words all about pulmonology', doi: '10.1/same', pmid: '', year: '' },
        { id: 'c', title: 'Third distinct title concerning nephrology care', doi: '10.1/same', pmid: '', year: '' },
      ],
      { excludedPairs: new Set([pairKey('a', 'b')]) },
    );
    expect(groups).toEqual([['a', 'b', 'c']]);
  });

  it('a junk identifier shared by very many records is skipped as degenerate, not mega-grouped', async () => {
    const records = Array.from({ length: 30 }, (_, i) => ({
      id: `j${String(i).padStart(2, '0')}`,
      title: `Completely distinct study number ${i} on its own topic entirely`,
      doi: 'n/a', pmid: '', year: String(1990 + i),
    }));
    const { groups, stats } = await detectDuplicateGroups(records, { maxBlockSize: 10 });
    expect(groups).toEqual([]);
    expect(stats.oversizedIdBuckets).toBeGreaterThan(0);
    expect(stats.oversizedIdBucketMembers).toBe(30);
  });

  it('never links a reviewer-confirmed not_duplicate pair directly', async () => {
    const base = 'Effect of aspirin therapy on cardiovascular outcomes in chronic disease patients';
    const { groups } = await detectDuplicateGroups(
      [
        { id: 'a', title: base, doi: '', pmid: '', year: '2020' },
        { id: 'b', title: base + '.', doi: '', pmid: '', year: '2020' },
      ],
      { excludedPairs: new Set([pairKey('a', 'b')]) },
    );
    expect(groups).toEqual([]);
  });

  it('pre-unioned existing groups absorb new matches (idempotent re-detection)', async () => {
    const base = 'Effect of aspirin therapy on cardiovascular outcomes in chronic disease patients';
    const { groups } = await detectDuplicateGroups(
      [
        { id: 'a', title: base, doi: '', pmid: '', year: '2020' },
        { id: 'b', title: 'Unrelated words entirely about other topics here', doi: '', pmid: '', year: '2020' },
        { id: 'c', title: base + '!', doi: '', pmid: '', year: '2020' },
      ],
      { preUnion: [['a', 'b']] }, // an existing (unresolved) group
    );
    expect(groups).toEqual([['a', 'b', 'c']]);
  });
});

describe('detectDuplicateGroups — equivalence with the legacy brute-force detector', () => {
  it('finds the same partition on a realistic mixed dataset', async () => {
    const rnd = mulberry32(2026);
    const records = [];
    let n = 0;
    const add = (r) => records.push({ id: `r${String(n++).padStart(4, '0')}`, ...r });

    for (let i = 0; i < 40; i++) {
      const title = makeTitle(rnd);
      const year = String(2015 + Math.floor(rnd() * 10));
      add({ title, doi: '', pmid: '', year });
      if (i % 2 === 0) add({ title: cosmeticVariant(title, rnd), doi: '', pmid: '', year });
      if (i % 3 === 0) add({ title: typoVariant(title, rnd), doi: '', pmid: '', year });
    }
    // DOI/PMID duplicate clusters with unrelated titles.
    for (let i = 0; i < 10; i++) {
      add({ title: makeTitle(rnd), doi: `10.9/${i}`, pmid: '', year: '2020' });
      add({ title: makeTitle(rnd), doi: `10.9/${i}`, pmid: String(9000 + i), year: '2021' });
      add({ title: makeTitle(rnd), doi: '', pmid: String(9000 + i), year: '2022' });
    }
    // Noise.
    for (let i = 0; i < 60; i++) add({ title: makeTitle(rnd), doi: '', pmid: '', year: String(2010 + (i % 12)) });

    const legacy = legacyFindDuplicateGroups(records, 0.92).map((g) => [...g].sort()).sort();
    const { groups } = await detectDuplicateGroups(records);
    expect(groups.map((g) => [...g].sort()).sort()).toEqual(legacy);
  });
});

describe('detectDuplicateGroups — safety caps + determinism + yielding', () => {
  it('skips degenerate oversized blocks and reports them honestly', async () => {
    const records = Array.from({ length: 30 }, (_, i) => ({
      id: `x${i}`, title: 'exactly the same generic untitled record here', doi: '', pmid: '', year: '',
    }));
    const { groups, stats } = await detectDuplicateGroups(records, { maxBlockSize: 10 });
    expect(groups).toEqual([]); // every bucket oversized → honestly skipped, not silently partial
    expect(stats.oversizedBlocks).toBeGreaterThan(0);
    expect(stats.oversizedBlockMembers).toBeGreaterThan(0);
  });

  it('stops at maxComparisons and flags truncation', async () => {
    const rnd = mulberry32(5);
    const base = makeTitle(rnd, 12);
    const records = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, title: typoVariant(base, rnd), doi: '', pmid: '', year: '2020',
    }));
    const { stats } = await detectDuplicateGroups(records, { maxComparisons: 5 });
    expect(stats.truncated).toBe(true);
    expect(stats.comparisonsIterated).toBeLessThanOrEqual(5);
  });

  it('is deterministic (same input → identical output)', async () => {
    const rnd = mulberry32(99);
    const records = Array.from({ length: 150 }, (_, i) => ({
      id: `d${i}`,
      title: i % 3 === 0 ? typoVariant(makeTitle(mulberry32(i)), rnd) : makeTitle(mulberry32(i)),
      doi: i % 7 === 0 ? `10.7/${Math.floor(i / 7)}` : '',
      pmid: '', year: String(2018 + (i % 5)),
    }));
    const a = await detectDuplicateGroups(records);
    const b = await detectDuplicateGroups(records);
    expect(a.groups).toEqual(b.groups);
  });

  it('yields cooperatively during large runs', async () => {
    const rnd = mulberry32(11);
    const records = Array.from({ length: 5000 }, (_, i) => ({
      id: `y${i}`, title: makeTitle(rnd), doi: '', pmid: '', year: '2020',
    }));
    let yields = 0;
    await detectDuplicateGroups(records, { yieldEvery: 500, yieldFn: async () => { yields += 1; } });
    expect(yields).toBeGreaterThan(5);
  });
});

describe('detectDuplicateGroups — performance smoke (10k records)', () => {
  it('processes 10,000 records with bounded comparisons in seconds, not minutes', async () => {
    const rnd = mulberry32(123);
    const records = [];
    for (let i = 0; i < 9500; i++) {
      records.push({
        id: `p${String(i).padStart(5, '0')}`, title: makeTitle(rnd, 10),
        doi: i % 20 === 0 ? `10.5/${i}` : '', pmid: '', year: String(2010 + (i % 15)),
      });
    }
    // Plant 250 duplicate pairs (cosmetic + typo variants).
    const planted = [];
    for (let i = 0; i < 250; i++) {
      const src = records[i * 30];
      const variant = i % 2 === 0 ? cosmeticVariant(src.title, rnd) : typoVariant(src.title, rnd);
      const id = `q${String(i).padStart(5, '0')}`;
      records.push({ id, title: variant, doi: '', pmid: '', year: src.year });
      planted.push([src.id, id]);
    }
    const t0 = Date.now();
    const { groups, stats } = await detectDuplicateGroups(records);
    const elapsed = Date.now() - t0;

    // The legacy detector needed ~8 MINUTES for 2k records; 10k must stay in seconds.
    expect(elapsed).toBeLessThan(30_000);
    // Blocking must collapse the candidate space far below C(9750,2) ≈ 47.5M.
    expect(stats.comparisonsEvaluated).toBeLessThan(2_000_000);
    expect(stats.truncated).toBe(false);
    // Recall: every planted pair ends up in one group.
    const groupOf = new Map();
    groups.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));
    const found = planted.filter(([a, b]) => groupOf.has(a) && groupOf.get(a) === groupOf.get(b)).length;
    expect(found).toBe(planted.length);
  }, 60_000);
});

describe('normalizeRecordForDedup', () => {
  it('normalizes once, deterministically', () => {
    expect(normalizeRecordForDedup({ id: 'x', doi: ' 10.1/AB ', pmid: 123, title: 'A B-C!', year: 2020 }))
      .toEqual({ id: 'x', normDoi: '10.1/ab', normPmid: '123', normTitle: 'a bc', year: '2020' });
  });
});
