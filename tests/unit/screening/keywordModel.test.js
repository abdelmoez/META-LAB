/**
 * keywordModel.test.js — 107.md §2. The shared keyword reducer + review-state
 * normalizer. Pure functions; no DOM, no React, no DB. The client and the server
 * ops endpoint both run exactly these functions.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKeywordMeta, emptyKeywordMeta, applyKeywordOp, materializeDefaults,
  resolveOrigin, dismissConflictOps, KEYWORD_ORIGIN, KEYWORD_META_VERSION, MAX_KEYWORD_LENGTH,
} from '../../../src/research-engine/screening/keywordModel.js';

const st = (inclusion = [], exclusion = [], meta = emptyKeywordMeta()) => ({ inclusion, exclusion, meta });

describe('normalizeKeywordMeta', () => {
  it('produces the canonical empty shape from nothing', () => {
    expect(normalizeKeywordMeta(null)).toEqual({
      version: KEYWORD_META_VERSION,
      decisions: { include: {}, exclude: {} },
      origins: { include: {}, exclude: {} },
    });
  });

  it('is BYTE-STABLE: already-canonical input is returned by reference', () => {
    const canonical = {
      version: 1,
      decisions: { include: { epilepsy: 'accepted' }, exclude: {} },
      origins: { include: { epilepsy: 'accepted' }, exclude: {} },
    };
    expect(normalizeKeywordMeta(canonical)).toBe(canonical);
    // and idempotent
    expect(normalizeKeywordMeta(normalizeKeywordMeta(canonical))).toBe(canonical);
  });

  it('parses a JSON string', () => {
    const out = normalizeKeywordMeta('{"version":1,"decisions":{"include":{"rct":"rejected"}},"origins":{}}');
    expect(out.decisions.include.rct).toBe('rejected');
    expect(out.decisions.exclude).toEqual({});
  });

  it('tolerates malformed input without throwing', () => {
    for (const junk of ['not json', '', undefined, 7, [], 'null', { decisions: 'nope' }]) {
      const out = normalizeKeywordMeta(junk);
      expect(out.version).toBe(KEYWORD_META_VERSION);
      expect(out.decisions.include).toEqual({});
      expect(out.origins.exclude).toEqual({});
    }
  });

  it('drops unknown values and normalizes non-canonical keys', () => {
    const out = normalizeKeywordMeta({
      version: 99,
      decisions: { include: { '  Drug-Resistant  Epilepsy ': 'accepted', junk: 'maybe' }, exclude: null },
      origins: { include: { rct: 'from-mars' }, exclude: { animal: 'manual' } },
    });
    expect(out.version).toBe(KEYWORD_META_VERSION);
    expect(out.decisions.include['drug-resistant epilepsy']).toBe('accepted');
    expect(out.decisions.include.junk).toBeUndefined();
    expect(out.origins.include.rct).toBeUndefined();
    expect(out.origins.exclude.animal).toBe('manual');
  });
});

describe('applyKeywordOp — validation', () => {
  it('rejects unknown ops, bad lists and bad terms', () => {
    const s = st(['RCT']);
    expect(applyKeywordOp(s, { type: 'nuke', list: 'include', term: 'x' }).ok).toBe(false);
    expect(applyKeywordOp(s, { type: 'add', list: 'both', term: 'x' }).ok).toBe(false);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: '   ' }).ok).toBe(false);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 42 }).ok).toBe(false);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x'.repeat(MAX_KEYWORD_LENGTH + 1) }).ok).toBe(false);
    expect(applyKeywordOp(s, { type: 'move', list: 'include', term: 'RCT', toList: 'include' }).ok).toBe(false);
    expect(applyKeywordOp(s, null).ok).toBe(false);
  });

  it('returns the SAME state object on any rejection or no-op', () => {
    const s = st(['RCT']);
    expect(applyKeywordOp(s, { type: 'nuke', list: 'include', term: 'x' }).state).toBe(s);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'rct' }).state).toBe(s);
    expect(applyKeywordOp(s, { type: 'remove', list: 'include', term: 'nope' }).state).toBe(s);
  });
});

describe('applyKeywordOp — add', () => {
  it('appends the display term and records a manual origin', () => {
    const out = applyKeywordOp(st(['RCT']), { type: 'add', list: 'include', term: 'drug-resistant epilepsy' });
    expect(out.ok).toBe(true);
    expect(out.changed).toBe(true);
    expect(out.state.inclusion).toEqual(['RCT', 'drug-resistant epilepsy']);
    expect(out.state.meta.origins.include['drug-resistant epilepsy']).toBe(KEYWORD_ORIGIN.MANUAL);
  });

  it('is a flagged no-op for an existing NORMALIZED key (case/space/dash-insensitive)', () => {
    const s = st(['Drug-Resistant Epilepsy']);
    const out = applyKeywordOp(s, { type: 'add', list: 'include', term: 'drug-resistant   epilepsy' });
    expect(out.ok).toBe(true);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe('duplicate');
    expect(out.state.inclusion).toEqual(['Drug-Resistant Epilepsy']);
  });

  it('does not mutate the input state', () => {
    const s = st(['RCT']);
    applyKeywordOp(s, { type: 'add', list: 'include', term: 'placebo' });
    expect(s.inclusion).toEqual(['RCT']);
  });
});

describe('applyKeywordOp — remove', () => {
  it('removes by normalized key and records a rejection so it is not re-suggested', () => {
    const out = applyKeywordOp(st(['RCT', 'placebo']), { type: 'remove', list: 'include', term: 'PLACEBO' });
    expect(out.state.inclusion).toEqual(['RCT']);
    expect(out.state.meta.decisions.include.placebo).toBe('rejected');
    expect(out.state.meta.origins.include.placebo).toBeUndefined();
  });

  it('is a no-op when the term is absent', () => {
    const out = applyKeywordOp(st(['RCT']), { type: 'remove', list: 'include', term: 'ghost' });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe('not_found');
  });
});

describe('applyKeywordOp — move (atomic, origin carried)', () => {
  it('moves in one operation and keeps the display text', () => {
    const added = applyKeywordOp(st(['RCT']), { type: 'add', list: 'include', term: 'Cohort Study' });
    const out = applyKeywordOp(added.state, { type: 'move', list: 'include', term: 'cohort study', toList: 'exclude' });
    expect(out.ok).toBe(true);
    expect(out.reason).toBe('moved');
    expect(out.state.inclusion).toEqual(['RCT']);
    expect(out.state.exclusion).toEqual(['Cohort Study']);          // display text preserved
    expect(out.state.meta.origins.exclude['cohort study']).toBe(KEYWORD_ORIGIN.MANUAL); // origin carried
    expect(out.state.meta.origins.include['cohort study']).toBeUndefined();
  });

  it('defaults toList to the other list and never duplicates an existing target term', () => {
    const out = applyKeywordOp(st(['epilepsy'], ['Epilepsy']), { type: 'move', list: 'include', term: 'epilepsy' });
    expect(out.state.inclusion).toEqual([]);
    expect(out.state.exclusion).toEqual(['Epilepsy']);
  });

  it('carries an accepted origin across the move', () => {
    const accepted = applyKeywordOp(st([], []), { type: 'accept', list: 'include', term: 'epilepsy' });
    const moved = applyKeywordOp(accepted.state, { type: 'move', list: 'include', term: 'epilepsy', toList: 'exclude' });
    expect(moved.state.meta.origins.exclude.epilepsy).toBe(KEYWORD_ORIGIN.ACCEPTED);
    expect(moved.state.meta.decisions.exclude.epilepsy).toBe('accepted');
  });

  it('is a no-op when the term is not on the source list', () => {
    const out = applyKeywordOp(st(['RCT']), { type: 'move', list: 'exclude', term: 'RCT', toList: 'include' });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe('not_found');
  });
});

describe('applyKeywordOp — accept / reject', () => {
  it('accept activates the suggestion and badges it as an accepted suggestion', () => {
    const out = applyKeywordOp(st([], []), { type: 'accept', list: 'exclude', term: 'animal study' });
    expect(out.state.exclusion).toEqual(['animal study']);
    expect(out.state.meta.decisions.exclude['animal study']).toBe('accepted');
    expect(out.state.meta.origins.exclude['animal study']).toBe(KEYWORD_ORIGIN.ACCEPTED);
  });

  it('accept is idempotent', () => {
    const first = applyKeywordOp(st(), { type: 'accept', list: 'include', term: 'epilepsy' });
    const second = applyKeywordOp(first.state, { type: 'accept', list: 'include', term: 'EPILEPSY' });
    expect(second.changed).toBe(false);
    expect(second.reason).toBe('already');
    expect(first.state.inclusion).toEqual(['epilepsy']);
  });

  it('reject records a verdict WITHOUT touching the active list', () => {
    const out = applyKeywordOp(st(['RCT']), { type: 'reject', list: 'include', term: 'epilepsy' });
    expect(out.state.inclusion).toEqual(['RCT']);
    expect(out.state.meta.decisions.include.epilepsy).toBe('rejected');
    expect(applyKeywordOp(out.state, { type: 'reject', list: 'include', term: 'epilepsy' }).changed).toBe(false);
  });

  it('dismissConflictOps rejects the concept on both sides', () => {
    let s = st();
    for (const op of dismissConflictOps('epilepsy')) s = applyKeywordOp(s, op).state;
    expect(s.meta.decisions.include.epilepsy).toBe('rejected');
    expect(s.meta.decisions.exclude.epilepsy).toBe('rejected');
    expect(s.inclusion).toEqual([]);
    expect(s.exclusion).toEqual([]);
  });
});

describe('manual terms survive everything (107.md §2 "Regeneration")', () => {
  it('a manual term is untouched by accept / reject / remove / move of OTHER terms', () => {
    let s = st(['my manual term'], ['my other manual term']);
    const ops = [
      { type: 'accept', list: 'include', term: 'epilepsy' },
      { type: 'reject', list: 'include', term: 'seizure' },
      { type: 'accept', list: 'exclude', term: 'animal study' },
      { type: 'reject', list: 'exclude', term: 'rodent' },
      { type: 'remove', list: 'include', term: 'epilepsy' },
      { type: 'move', list: 'exclude', term: 'animal study', toList: 'include' },
      { type: 'add', list: 'include', term: 'another term' },
      { type: 'remove', list: 'include', term: 'another term' },
    ];
    for (const op of ops) {
      const r = applyKeywordOp(s, op);
      expect(r.ok).toBe(true);
      s = r.state;
    }
    expect(s.inclusion).toContain('my manual term');
    expect(s.exclusion).toContain('my other manual term');
  });

  it('regeneration is structural: the reducer has no path that rewrites a whole list', () => {
    // Every op names exactly one term; there is no "replace" / "regenerate" op.
    const s = st(['manual A', 'manual B']);
    const after = applyKeywordOp(s, { type: 'accept', list: 'include', term: 'suggested C' }).state;
    expect(after.inclusion).toEqual(['manual A', 'manual B', 'suggested C']);
  });
});

describe('materializeDefaults + resolveOrigin', () => {
  const defaults = { include: ['RCT', 'placebo'], exclude: ['animal'] };

  it('fills only an EMPTY side and returns the same object when nothing is needed', () => {
    const empty = st([], []);
    const filled = materializeDefaults(empty, defaults, ['include']);
    expect(filled.inclusion).toEqual(['RCT', 'placebo']);
    expect(filled.exclusion).toEqual([]);
    const already = st(['mine'], ['theirs']);
    expect(materializeDefaults(already, defaults)).toBe(already);
  });

  it('badges seeded defaults as default and everything else as manual', () => {
    const meta = emptyKeywordMeta();
    expect(resolveOrigin('RCT', 'include', meta, defaults)).toBe(KEYWORD_ORIGIN.DEFAULT);
    expect(resolveOrigin('rct', 'include', meta, defaults)).toBe(KEYWORD_ORIGIN.DEFAULT);
    expect(resolveOrigin('epilepsy', 'include', meta, defaults)).toBe(KEYWORD_ORIGIN.MANUAL);
  });

  it('an explicit origin always wins over the default-list fallback', () => {
    // 'RCT' is a seeded default, but this project typed it in by hand.
    const manual = applyKeywordOp(st(['placebo']), { type: 'add', list: 'include', term: 'RCT' });
    expect(resolveOrigin('RCT', 'include', manual.state.meta, defaults)).toBe(KEYWORD_ORIGIN.MANUAL);
    const accepted = applyKeywordOp(st(['placebo']), { type: 'accept', list: 'include', term: 'RCT' });
    expect(resolveOrigin('RCT', 'include', accepted.state.meta, defaults)).toBe(KEYWORD_ORIGIN.ACCEPTED);
  });
});
