/**
 * keywordModel.test.js — 107.md §2. The shared keyword reducer + review-state
 * normalizer. Pure functions; no DOM, no React, no DB. The client and the server
 * ops endpoint both run exactly these functions.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKeywordMeta, emptyKeywordMeta, applyKeywordOp, materializeDefaults,
  resolveOrigin, isSideSeeded, dismissConflictOps,
  KEYWORD_ORIGIN, KEYWORD_META_VERSION, MAX_KEYWORD_LENGTH,
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

  it('keeps a canonical `seeded` marker by reference and drops an empty / junk one', () => {
    const withMarker = {
      version: 1,
      decisions: { include: {}, exclude: {} },
      origins: { include: {}, exclude: {} },
      seeded: { include: true },
    };
    expect(normalizeKeywordMeta(withMarker)).toBe(withMarker);
    expect(normalizeKeywordMeta(JSON.stringify(withMarker)).seeded).toEqual({ include: true });

    // An EMPTY marker is not canonical — the 3-key shape is the one true empty form,
    // so a legacy project never gains bytes it does not need.
    expect(normalizeKeywordMeta({ ...withMarker, seeded: {} })).not.toHaveProperty('seeded');
    expect(normalizeKeywordMeta({ ...withMarker, seeded: { include: 'yes', both: true } }))
      .not.toHaveProperty('seeded');
    expect(normalizeKeywordMeta({ ...withMarker, seeded: { include: true, junk: true } }).seeded)
      .toEqual({ include: true });
  });

  it('isSideSeeded reads only an explicit true marker', () => {
    const meta = normalizeKeywordMeta({ seeded: { exclude: true } });
    expect(isSideSeeded(meta, 'exclude')).toBe(true);
    expect(isSideSeeded(meta, 'include')).toBe(false);
    expect(isSideSeeded(emptyKeywordMeta(), 'include')).toBe(false);
    expect(isSideSeeded(null, 'include')).toBe(false);
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

// 107.md rec — the snackbar Undo of an abstract-selection add used a plain `remove`,
// which recorded a 'rejected' verdict and permanently killed the matching criteria
// suggestion. `reject:false` is the real inverse.
describe('applyKeywordOp — remove { reject:false } (the non-verdict Undo)', () => {
  it('undoing an add restores the EXACT prior meta, term and origin', () => {
    const before = st(['RCT']);
    const added = applyKeywordOp(before, { type: 'add', list: 'include', term: 'drug-resistant epilepsy' });
    expect(added.state.meta.origins.include['drug-resistant epilepsy']).toBe(KEYWORD_ORIGIN.MANUAL);

    const undone = applyKeywordOp(added.state, {
      type: 'remove', list: 'include', term: 'drug-resistant epilepsy', reject: false,
    });
    expect(undone.changed).toBe(true);
    expect(undone.state.inclusion).toEqual(['RCT']);
    expect(undone.state.meta).toEqual(before.meta);            // no decision, no origin
    expect(undone.state.meta.decisions.include).toEqual({});
    expect(undone.state.meta).not.toHaveProperty('seeded');    // an Undo is not an edit
  });

  it('undoing an accept restores the EXACT prior meta (the accepted verdict is dropped)', () => {
    const before = st([], []);
    const accepted = applyKeywordOp(before, { type: 'accept', list: 'exclude', term: 'animal study' });
    expect(accepted.state.meta.decisions.exclude['animal study']).toBe('accepted');

    const undone = applyKeywordOp(accepted.state, {
      type: 'remove', list: 'exclude', term: 'animal study', reject: false,
    });
    expect(undone.state.exclusion).toEqual([]);
    expect(undone.state.meta).toEqual(before.meta);
  });

  it('plain remove (the chip ×) is UNCHANGED — a deliberate rejection', () => {
    const out = applyKeywordOp(st(['RCT', 'placebo']), { type: 'remove', list: 'include', term: 'placebo' });
    expect(out.state.meta.decisions.include.placebo).toBe('rejected');
    expect(applyKeywordOp(st(['x']), { type: 'remove', list: 'include', term: 'x', reject: true })
      .state.meta.decisions.include.x).toBe('rejected');
  });

  it('rejects a non-boolean flag and refuses reject:false on ops that record no verdict', () => {
    const s = st(['RCT']);
    expect(applyKeywordOp(s, { type: 'remove', list: 'include', term: 'RCT', reject: 'no' }).ok).toBe(false);
    for (const type of ['add', 'accept', 'reject']) {
      const out = applyKeywordOp(s, { type, list: 'include', term: 'epilepsy', reject: false });
      expect(out.ok, type).toBe(false);
      expect(out.state).toBe(s);
    }
  });
});

describe('applyKeywordOp — move is restorable (107.md rec)', () => {
  it('a moved DEFAULT term comes back with its original (absent) origin, not stamped manual', () => {
    // 'epilepsy' is part of the shared seed list here: no explicit origin is stored,
    // so resolveOrigin badges it 'default'. Stamping 'manual' on the move made the
    // badge unrecoverable.
    const defaults = { include: ['epilepsy'], exclude: [] };
    const before = st(['epilepsy'], []);
    expect(resolveOrigin('epilepsy', 'include', before.meta, defaults)).toBe(KEYWORD_ORIGIN.DEFAULT);

    const moved = applyKeywordOp(before, { type: 'move', list: 'include', term: 'epilepsy', toList: 'exclude' });
    expect(moved.state.exclusion).toEqual(['epilepsy']);
    expect(moved.state.meta.origins.exclude.epilepsy).toBeUndefined();

    const back = applyKeywordOp(moved.state, {
      type: 'move', list: 'exclude', term: 'epilepsy', toList: 'include', reject: false,
    });
    expect(back.state.inclusion).toEqual(['epilepsy']);
    expect(back.state.exclusion).toEqual([]);
    expect(back.state.meta.decisions).toEqual({ include: {}, exclude: {} });  // no residue
    expect(back.state.meta.origins).toEqual({ include: {}, exclude: {} });
    expect(resolveOrigin('epilepsy', 'include', back.state.meta, defaults)).toBe(KEYWORD_ORIGIN.DEFAULT);
  });

  it('the inverse move leaves no "rejected" residue on the side it came back from', () => {
    const added = applyKeywordOp(st([], []), { type: 'add', list: 'include', term: 'cohort study' });
    const moved = applyKeywordOp(added.state, { type: 'move', list: 'include', term: 'cohort study' });
    expect(moved.state.meta.decisions.include['cohort study']).toBe('rejected');

    const back = applyKeywordOp(moved.state, { type: 'move', list: 'exclude', term: 'cohort study', reject: false });
    expect(back.state.inclusion).toEqual(['cohort study']);
    expect(back.state.meta.decisions.include['cohort study']).toBeUndefined();
    expect(back.state.meta.decisions.exclude['cohort study']).toBeUndefined();
    expect(back.state.meta.origins.include['cohort study']).toBe(KEYWORD_ORIGIN.MANUAL);
  });

  it('a plain move still records the deliberate "not on this list" verdict', () => {
    const added = applyKeywordOp(st([], []), { type: 'add', list: 'include', term: 'cohort study' });
    const moved = applyKeywordOp(added.state, { type: 'move', list: 'include', term: 'cohort study' });
    expect(moved.state.meta.decisions.include['cohort study']).toBe('rejected');
    expect(moved.state.meta.origins.exclude['cohort study']).toBe(KEYWORD_ORIGIN.MANUAL);
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

  it('materializing the seeds marks the side as edited, and never re-seeds it later', () => {
    const filled = materializeDefaults(st([], []), defaults, ['include']);
    expect(filled.meta.seeded).toEqual({ include: true });
    expect(isSideSeeded(filled.meta, 'exclude')).toBe(false);

    // The leader then deletes every default term. The side is empty ON PURPOSE, so
    // the next op must NOT quietly write the shared defaults back in.
    let s = filled;
    for (const t of defaults.include) s = applyKeywordOp(s, { type: 'remove', list: 'include', term: t }).state;
    expect(s.inclusion).toEqual([]);
    expect(materializeDefaults(s, defaults, ['include'])).toBe(s);
    expect(materializeDefaults(s, defaults).exclusion).toEqual(defaults.exclude); // other side untouched
  });

  it('an explicit origin always wins over the default-list fallback', () => {
    // 'RCT' is a seeded default, but this project typed it in by hand.
    const manual = applyKeywordOp(st(['placebo']), { type: 'add', list: 'include', term: 'RCT' });
    expect(resolveOrigin('RCT', 'include', manual.state.meta, defaults)).toBe(KEYWORD_ORIGIN.MANUAL);
    const accepted = applyKeywordOp(st(['placebo']), { type: 'accept', list: 'include', term: 'RCT' });
    expect(resolveOrigin('RCT', 'include', accepted.state.meta, defaults)).toBe(KEYWORD_ORIGIN.ACCEPTED);
  });
});

describe('the "edited" marker (107.md rec — an emptied side must STAY empty)', () => {
  it('only ops that can empty a side mark it; additive ops and Undo do not', () => {
    const mark = (op, state = st(['seizure'], ['rodent'])) => applyKeywordOp(state, op).state.meta.seeded;
    expect(mark({ type: 'remove', list: 'include', term: 'seizure' })).toEqual({ include: true });
    expect(mark({ type: 'move', list: 'exclude', term: 'rodent' })).toEqual({ exclude: true });
    // purely additive / verdict-only / undo ops leave the marker absent
    expect(mark({ type: 'add', list: 'include', term: 'new term' })).toBeUndefined();
    expect(mark({ type: 'accept', list: 'include', term: 'epilepsy' })).toBeUndefined();
    expect(mark({ type: 'reject', list: 'include', term: 'epilepsy' })).toBeUndefined();
    expect(mark({ type: 'remove', list: 'include', term: 'seizure', reject: false })).toBeUndefined();
    expect(mark({ type: 'move', list: 'include', term: 'seizure', reject: false })).toBeUndefined();
  });

  it('accumulates across sides in a stable key order', () => {
    let s = st(['a'], ['b']);
    s = applyKeywordOp(s, { type: 'remove', list: 'exclude', term: 'b' }).state;
    s = applyKeywordOp(s, { type: 'remove', list: 'include', term: 'a' }).state;
    expect(Object.keys(s.meta.seeded)).toEqual(['include', 'exclude']);
    expect(JSON.stringify(s.meta).endsWith('"seeded":{"include":true,"exclude":true}}')).toBe(true);
  });

  it('survives a JSON round-trip through the column', () => {
    const s = applyKeywordOp(st(['a']), { type: 'remove', list: 'include', term: 'a' }).state;
    const reloaded = normalizeKeywordMeta(JSON.stringify(s.meta));
    expect(isSideSeeded(reloaded, 'include')).toBe(true);
  });
});
