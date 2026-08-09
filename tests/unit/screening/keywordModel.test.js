/**
 * keywordModel.test.js — 107.md §2. The shared keyword reducer + review-state
 * normalizer. Pure functions; no DOM, no React, no DB. The client and the server
 * ops endpoint both run exactly these functions.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKeywordMeta, emptyKeywordMeta, applyKeywordOp, applyKeywordOps, materializeDefaults,
  resolveOrigin, isSideSeeded, dismissConflictOps, keywordInverseOps, keywordRemoveInverse,
  KEYWORD_ORIGIN, KEYWORD_META_VERSION, MAX_KEYWORD_LENGTH, MAX_KEYWORD_OPS,
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

/* ══════════════════════════════════════════════════════════════════════════════
 * 108.md §4/§20 — every keyword op needs an EXACT, byte-identical inverse so the
 * centralized Undo/Redo stack can reverse it. Three reducer gaps are closed here:
 * position (`index`), origin ABSENCE (`origin: null`) and the seeded marker
 * (`clearSeeded`), plus the `clear-decision` op that withdraws a verdict.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** Serialized form — this is literally what lands in the keywordMeta column. */
const bytes = (s) => JSON.stringify({
  inclusion: s.inclusion, exclusion: s.exclusion, meta: normalizeKeywordMeta(s.meta),
});
const metaOf = (raw) => normalizeKeywordMeta(raw);
/** Apply a forward op, then the inverse the history layer would have recorded. */
const roundTrip = (before, op) => {
  const fwd = applyKeywordOp(before, op);
  expect(fwd.ok, `forward op rejected: ${fwd.error}`).toBe(true);
  const inverse = keywordInverseOps(before, op);
  const back = applyKeywordOps(fwd.state, inverse);
  expect(back.ok, `inverse rejected: ${back.error}`).toBe(true);
  return { fwd, inverse, back };
};

describe('108.md §20 — add/move accept an `index` (restore the original position)', () => {
  it('splices at the index and CLAMPS an out-of-range one', () => {
    const s = st(['a', 'b', 'c']);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', index: 0 }).state.inclusion)
      .toEqual(['x', 'a', 'b', 'c']);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', index: 2 }).state.inclusion)
      .toEqual(['a', 'b', 'x', 'c']);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', index: 3 }).state.inclusion)
      .toEqual(['a', 'b', 'c', 'x']);
    // A collaborator can shrink the list between the delete and the undo, so an
    // out-of-range index restores the term at the edge instead of failing.
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', index: -7 }).state.inclusion)
      .toEqual(['x', 'a', 'b', 'c']);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', index: 99 }).state.inclusion)
      .toEqual(['a', 'b', 'c', 'x']);
  });

  it('BYTE STABILITY: an add with NO index is identical to the pre-108 append', () => {
    const s = st(['a', 'b'], ['q']);
    const withoutIndex = applyKeywordOp(s, { type: 'add', list: 'include', term: 'z' });
    const atEnd = applyKeywordOp(s, { type: 'add', list: 'include', term: 'z', index: 2 });
    expect(bytes(withoutIndex.state)).toBe(bytes(atEnd.state));
    expect(withoutIndex.state.inclusion).toEqual(['a', 'b', 'z']);
  });

  it('move inserts into the TARGET at the index, and appends without one', () => {
    const s = st(['x'], ['a', 'b', 'c']);
    expect(applyKeywordOp(s, { type: 'move', list: 'include', term: 'x', index: 1 }).state.exclusion)
      .toEqual(['a', 'x', 'b', 'c']);
    expect(applyKeywordOp(s, { type: 'move', list: 'include', term: 'x' }).state.exclusion)
      .toEqual(['a', 'b', 'c', 'x']);
  });

  it('400s a non-integer index and an index on an op that cannot place a term', () => {
    const s = st(['a']);
    for (const index of ['2', 1.5, NaN, null, {}]) {
      expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'z', index }).ok, String(index)).toBe(false);
    }
    for (const type of ['remove', 'accept', 'reject', 'clear-decision']) {
      const out = applyKeywordOp(s, { type, list: 'include', term: 'a', index: 0 });
      expect(out.ok, type).toBe(false);
      expect(out.error).toMatch(/index applies only to "add" and "move"/);
      expect(out.state).toBe(s);
    }
  });
});

describe('108.md §20 — `origin: null` restores the ABSENCE of an origin', () => {
  const defaults = { include: ['epilepsy'], exclude: [] };

  it('a restored shared default is not re-badged manual', () => {
    const before = st(['epilepsy', 'z']);
    expect(resolveOrigin('epilepsy', 'include', before.meta, defaults)).toBe(KEYWORD_ORIGIN.DEFAULT);
    const removed = applyKeywordOp(before, { type: 'remove', list: 'include', term: 'epilepsy' });

    const naive = applyKeywordOp(removed.state, { type: 'add', list: 'include', term: 'epilepsy', index: 0 });
    expect(naive.state.meta.origins.include.epilepsy).toBe(KEYWORD_ORIGIN.MANUAL);   // the bug

    const exact = applyKeywordOp(removed.state, {
      type: 'add', list: 'include', term: 'epilepsy', index: 0, origin: null,
    });
    expect(exact.state.meta.origins.include.epilepsy).toBeUndefined();
    expect(resolveOrigin('epilepsy', 'include', exact.state.meta, defaults)).toBe(KEYWORD_ORIGIN.DEFAULT);
  });

  it('an explicit origin still wins, and a junk one is a hard failure', () => {
    const s = st([]);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', origin: 'accepted' })
      .state.meta.origins.include.x).toBe(KEYWORD_ORIGIN.ACCEPTED);
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', origin: 'default' })
      .state.meta.origins.include.x).toBe(KEYWORD_ORIGIN.DEFAULT);
    const bad = applyKeywordOp(s, { type: 'add', list: 'include', term: 'x', origin: 'from-mars' });
    expect(bad.ok).toBe(false);
    expect(bad.state).toBe(s);
    // origin is meaningless anywhere but `add` — move carries the source's verbatim.
    expect(applyKeywordOp(st(['x']), { type: 'move', list: 'include', term: 'x', origin: 'manual' }).ok).toBe(false);
  });
});

describe('108.md §20 — `clearSeeded` (the reducer may CLEAR the marker, never set it)', () => {
  it('clears the side marker a verdict remove set, leaving the 3-key meta shape', () => {
    const before = st(['a', 'b']);
    const removed = applyKeywordOp(before, { type: 'remove', list: 'include', term: 'a' });
    expect(removed.state.meta.seeded).toEqual({ include: true });

    const back = applyKeywordOp(removed.state, {
      type: 'add', list: 'include', term: 'a', index: 0, origin: null, clearSeeded: true,
    });
    expect(back.state.meta).not.toHaveProperty('seeded');
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('clears only the named side and keeps the other one marked', () => {
    const marked = st(['a'], ['q'], metaOf({ seeded: { include: true, exclude: true } }));
    const removed = applyKeywordOp(marked, { type: 'remove', list: 'include', term: 'a' });
    const back = applyKeywordOp(removed.state, {
      type: 'add', list: 'include', term: 'a', index: 0, origin: null, clearSeeded: true,
    });
    expect(back.state.meta.seeded).toEqual({ exclude: true });
  });

  it('is inert on a duplicate add — a no-op can never clear the marker', () => {
    const marked = st(['a'], [], metaOf({ seeded: { include: true } }));
    const out = applyKeywordOp(marked, { type: 'add', list: 'include', term: 'A', clearSeeded: true });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe('duplicate');
    expect(out.state).toBe(marked);
    expect(isSideSeeded(out.state.meta, 'include')).toBe(true);
  });

  it('is valid ONLY on add and only as a boolean', () => {
    const s = st(['a'], ['q']);
    for (const type of ['remove', 'move', 'accept', 'reject', 'clear-decision']) {
      const out = applyKeywordOp(s, { type, list: 'include', term: 'a', clearSeeded: true });
      expect(out.ok, type).toBe(false);
      expect(out.error).toMatch(/clearSeeded applies only to "add"/);
    }
    expect(applyKeywordOp(s, { type: 'add', list: 'include', term: 'z', clearSeeded: 'yes' }).ok).toBe(false);
  });
});

describe('108.md §20 — the `clear-decision` op (withdraw a verdict, back to PENDING)', () => {
  it('deletes the decision and touches nothing else', () => {
    const rejected = applyKeywordOp(st(['RCT']), { type: 'reject', list: 'include', term: 'epilepsy' });
    const cleared = applyKeywordOp(rejected.state, { type: 'clear-decision', list: 'include', term: 'EPILEPSY' });
    expect(cleared.changed).toBe(true);
    expect(cleared.reason).toBe('cleared');
    expect(cleared.state.inclusion).toEqual(['RCT']);
    expect(cleared.state.meta.decisions.include).toEqual({});
    expect(cleared.state.meta).not.toHaveProperty('seeded');   // withdrawing is not an edit
  });

  it('`removeTerm` also drops the term and its origin (undoing an accept that ADDED it)', () => {
    const accepted = applyKeywordOp(st([], []), { type: 'accept', list: 'exclude', term: 'animal study' });
    expect(accepted.state.exclusion).toEqual(['animal study']);
    const undone = applyKeywordOp(accepted.state, {
      type: 'clear-decision', list: 'exclude', term: 'animal study', removeTerm: true,
    });
    expect(undone.state.exclusion).toEqual([]);
    expect(undone.state.meta.origins.exclude).toEqual({});
    expect(undone.state.meta.decisions.exclude).toEqual({});
    expect(undone.state.meta).not.toHaveProperty('seeded');
  });

  it('is a no-op when there is no decision and nothing to remove', () => {
    const s = st(['a']);
    const out = applyKeywordOp(s, { type: 'clear-decision', list: 'include', term: 'a' });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe('already');
    expect(out.state).toBe(s);
  });

  it('still clears a DANGLING decision for a term that is not on the list', () => {
    const rejected = applyKeywordOp(st([]), { type: 'reject', list: 'include', term: 'ghost' });
    const out = applyKeywordOp(rejected.state, {
      type: 'clear-decision', list: 'include', term: 'ghost', removeTerm: true,
    });
    expect(out.changed).toBe(true);
    expect(out.state.meta.decisions.include).toEqual({});
  });

  it('valid combos only — reject/toList/index/origin/clearSeeded are all hard failures', () => {
    const s = st(['a'], ['q']);
    const base = { type: 'clear-decision', list: 'include', term: 'a' };
    for (const [extra, pattern] of [
      [{ reject: false }, /reject does not apply to "clear-decision"/],
      [{ reject: true }, /reject does not apply to "clear-decision"/],
      [{ toList: 'exclude' }, /toList applies only to "move"/],
      [{ index: 0 }, /index applies only to "add" and "move"/],
      [{ origin: 'manual' }, /origin applies only to "add"/],
      [{ clearSeeded: true }, /clearSeeded applies only to "add"/],
      [{ removeTerm: 'yes' }, /removeTerm must be a boolean/],
    ]) {
      const out = applyKeywordOp(s, { ...base, ...extra });
      expect(out.ok, JSON.stringify(extra)).toBe(false);
      expect(out.error).toMatch(pattern);
      expect(out.state).toBe(s);
    }
    // …and removeTerm is meaningless on any other op.
    for (const type of ['add', 'remove', 'move', 'accept', 'reject']) {
      expect(applyKeywordOp(s, { type, list: 'include', term: 'a', removeTerm: true }).ok, type).toBe(false);
    }
  });
});

describe('108.md §20 — applyKeywordOps (transactional batch)', () => {
  it('folds the ops in order and reports each one', () => {
    const out = applyKeywordOps(st(['a']), [
      { type: 'add', list: 'include', term: 'b', index: 0 },
      { type: 'reject', list: 'exclude', term: 'rodent' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.changed).toBe(true);
    expect(out.reason).toBe('batch');
    expect(out.state.inclusion).toEqual(['b', 'a']);
    expect(out.state.meta.decisions.exclude.rodent).toBe('rejected');
    expect(out.results).toEqual([
      { changed: true, reason: 'added' },
      { changed: true, reason: 'rejected' },
    ]);
  });

  it('ALL-OR-NOTHING: one invalid op discards the whole batch', () => {
    const s = st(['a']);
    const out = applyKeywordOps(s, [
      { type: 'add', list: 'include', term: 'b' },
      { type: 'add', list: 'include', term: 'c', index: 'nope' },
      { type: 'add', list: 'include', term: 'd' },
    ]);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('invalid');
    expect(out.error).toMatch(/index must be an integer/);
    expect(out.state).toBe(s);          // nothing half applied
    expect(out.results).toEqual([]);
  });

  it('a 1-op batch keeps the single-op reason verbatim (wire compatibility)', () => {
    expect(applyKeywordOps(st(['a']), [{ type: 'add', list: 'include', term: 'A' }]).reason).toBe('duplicate');
    expect(applyKeywordOps(st(['a']), [{ type: 'remove', list: 'include', term: 'z' }]).reason).toBe('not_found');
    expect(applyKeywordOps(st(['a']), [{ type: 'add', list: 'include', term: 'z' }]).reason).toBe('added');
  });

  it('returns the SAME state object when no op changed anything', () => {
    const s = st(['a']);
    const out = applyKeywordOps(s, [
      { type: 'add', list: 'include', term: 'A' },
      { type: 'remove', list: 'include', term: 'ghost' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe('noop');
    expect(out.state).toBe(s);
  });

  it('bounds the array on both ends', () => {
    const s = st(['a']);
    for (const ops of [[], null, 'add', {}]) {
      const out = applyKeywordOps(s, ops);
      expect(out.ok, JSON.stringify(ops)).toBe(false);
      expect(out.error).toMatch(/ops must be a non-empty array/);
    }
    const tooMany = Array.from({ length: MAX_KEYWORD_OPS + 1 },
      (_, i) => ({ type: 'add', list: 'include', term: `t${i}` }));
    const over = applyKeywordOps(s, tooMany);
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/at most/);
    expect(over.state).toBe(s);
  });
});

describe('108.md §20 — keywordInverseOps: BYTE-IDENTICAL round trips', () => {
  it('add → inverse restores the exact prior bytes, including a pending verdict', () => {
    for (const before of [
      st(['RCT']),
      st(['RCT'], [], metaOf({ decisions: { include: { dre: 'rejected' } } })),
      st([], [], metaOf({ seeded: { include: true } })),
    ]) {
      const { back } = roundTrip(before, { type: 'add', list: 'include', term: 'dre' });
      expect(bytes(back.state)).toBe(bytes(before));
    }
  });

  it('remove(verdict) → inverse restores position, origin, decision AND meta.seeded', () => {
    const before = st(['alpha', 'beta', 'gamma'], ['q'],
      metaOf({ origins: { include: { beta: 'manual' } } }));
    const { fwd, inverse, back } = roundTrip(before, { type: 'remove', list: 'include', term: 'BETA' });

    expect(fwd.state.inclusion).toEqual(['alpha', 'gamma']);
    expect(fwd.state.meta.seeded).toEqual({ include: true });
    // the recorded inverse, exactly as the history layer will replay it
    expect(inverse).toEqual([
      { type: 'add', list: 'include', term: 'beta', index: 1, origin: 'manual', clearSeeded: true },
    ]);
    expect(back.state.inclusion).toEqual(['alpha', 'beta', 'gamma']);
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('remove on an ALREADY-marked side does NOT clear the marker (no guessing)', () => {
    const before = st(['alpha', 'beta'], [], metaOf({ seeded: { include: true } }));
    const op = { type: 'remove', list: 'include', term: 'beta' };
    expect(keywordInverseOps(before, op)[0]).not.toHaveProperty('clearSeeded');
    const { back } = roundTrip(before, op);
    expect(back.state.meta.seeded).toEqual({ include: true });
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('remove { reject:false } needs no marker clear at all', () => {
    const before = st(['alpha', 'beta']);
    const op = { type: 'remove', list: 'include', term: 'beta', reject: false };
    expect(keywordInverseOps(before, op))
      .toEqual([{ type: 'add', list: 'include', term: 'beta', index: 1, origin: null }]);
    expect(bytes(roundTrip(before, op).back.state)).toBe(bytes(before));
  });

  it('keywordRemoveInverse is the named delete-path entry point and agrees exactly', () => {
    const before = st(['alpha', 'beta']);
    const op = { type: 'remove', list: 'include', term: 'beta' };
    expect(keywordRemoveInverse(before, op)).toEqual(keywordInverseOps(before, op));
    const back = applyKeywordOps(applyKeywordOp(before, op).state, keywordRemoveInverse(before, op));
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('move → inverse restores both sides, the source position and the marker', () => {
    const before = st(['a', 'moved', 'c'], ['q'], metaOf({
      origins: { include: { moved: 'accepted' } },
      decisions: { include: { moved: 'accepted' } },
    }));
    const { fwd, back } = roundTrip(before, { type: 'move', list: 'include', term: 'moved', toList: 'exclude' });
    expect(fwd.state.exclusion).toEqual(['q', 'moved']);
    expect(fwd.state.meta.seeded).toEqual({ include: true });
    expect(back.state.inclusion).toEqual(['a', 'moved', 'c']);
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('move onto a list that ALREADY holds the term rebuilds the target in place', () => {
    // The forward move overwrites the target's origin + decision without pushing it,
    // so the inverse drops and re-adds the target term at its exact prior index.
    const before = st(['A'], ['q', 'a', 'r'], metaOf({
      origins: { include: { a: 'manual' }, exclude: { a: 'accepted' } },
      decisions: { exclude: { a: 'accepted' } },
    }));
    const { inverse, back } = roundTrip(before, { type: 'move', list: 'include', term: 'A', toList: 'exclude' });
    expect(inverse.length).toBeLessThanOrEqual(MAX_KEYWORD_OPS);
    expect(back.state.exclusion).toEqual(['q', 'a', 'r']);
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('accept → inverse, BOTH shapes: the term already existed, and the accept added it', () => {
    // (a) the term was already active — the accept only wrote a decision, so the
    // inverse is clear-decision WITHOUT removeTerm and the list is untouched.
    const existed = st(['epilepsy'], [], metaOf({ origins: { include: { epilepsy: 'manual' } } }));
    const acceptExisted = { type: 'accept', list: 'include', term: 'epilepsy' };
    expect(keywordInverseOps(existed, acceptExisted))
      .toEqual([{ type: 'clear-decision', list: 'include', term: 'epilepsy' }]);
    const backExisted = roundTrip(existed, acceptExisted).back;
    expect(backExisted.state.inclusion).toEqual(['epilepsy']);
    expect(bytes(backExisted.state)).toBe(bytes(existed));

    // (b) the accept ADDED the term — the inverse must take it and its origin away.
    const pending = st([], ['other']);
    const acceptNew = { type: 'accept', list: 'exclude', term: 'animal study' };
    expect(keywordInverseOps(pending, acceptNew))
      .toEqual([{ type: 'clear-decision', list: 'exclude', term: 'animal study', removeTerm: true }]);
    expect(bytes(roundTrip(pending, acceptNew).back.state)).toBe(bytes(pending));
  });

  it('accept over a PRIOR rejection puts the rejection back', () => {
    const before = st([], [], metaOf({ decisions: { include: { epilepsy: 'rejected' } } }));
    const { inverse, back } = roundTrip(before, { type: 'accept', list: 'include', term: 'epilepsy' });
    expect(inverse).toEqual([
      { type: 'clear-decision', list: 'include', term: 'epilepsy', removeTerm: true },
      { type: 'reject', list: 'include', term: 'epilepsy' },
    ]);
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('reject → inverse returns the suggestion to PENDING with the lists untouched', () => {
    const before = st(['RCT'], ['animal']);
    const { fwd, inverse, back } = roundTrip(before, { type: 'reject', list: 'include', term: 'epilepsy' });
    expect(fwd.state.meta.decisions.include.epilepsy).toBe('rejected');
    expect(inverse).toEqual([{ type: 'clear-decision', list: 'include', term: 'epilepsy' }]);
    expect(back.state.meta.decisions.include.epilepsy).toBeUndefined();   // pending again
    expect(back.state.inclusion).toEqual(['RCT']);
    expect(back.state.exclusion).toEqual(['animal']);
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('clear-decision is itself invertible (both shapes)', () => {
    const withVerdict = st([], [], metaOf({ decisions: { include: { ghost: 'rejected' } } }));
    expect(bytes(roundTrip(withVerdict, { type: 'clear-decision', list: 'include', term: 'ghost' }).back.state))
      .toBe(bytes(withVerdict));
    const withTerm = st(['a', 'accepted term'], [], metaOf({
      origins: { include: { 'accepted term': 'accepted' } },
      decisions: { include: { 'accepted term': 'accepted' } },
    }));
    expect(bytes(roundTrip(withTerm, {
      type: 'clear-decision', list: 'include', term: 'accepted term', removeTerm: true,
    }).back.state)).toBe(bytes(withTerm));
  });

  it('returns NO inverse for an invalid op or a no-op (record no history entry)', () => {
    const s = st(['a']);
    expect(keywordInverseOps(s, { type: 'nuke', list: 'include', term: 'a' })).toEqual([]);
    expect(keywordInverseOps(s, null)).toEqual([]);
    expect(keywordInverseOps(s, { type: 'add', list: 'include', term: 'A' })).toEqual([]);        // duplicate
    expect(keywordInverseOps(s, { type: 'remove', list: 'include', term: 'ghost' })).toEqual([]); // not_found
    const rejected = applyKeywordOp(s, { type: 'reject', list: 'include', term: 'x' }).state;
    expect(keywordInverseOps(s, { type: 'reject', list: 'include', term: 'x' })).toHaveLength(1);
    expect(keywordInverseOps(rejected, { type: 'reject', list: 'include', term: 'x' })).toEqual([]); // already
  });

  it('DOCUMENTED INEXACT CASE: an accepted verdict for an absent term re-activates it', () => {
    // Only the legacy full-array PUT can produce this (it replaces a list without
    // touching keywordMeta); no op can write the decision without the term, so the
    // inverse repairs the state by re-activating the term instead.
    const before = st([], [], metaOf({ decisions: { include: { orphan: 'accepted' } } }));
    const { inverse, back } = roundTrip(before, { type: 'clear-decision', list: 'include', term: 'orphan' });
    expect(inverse).toEqual([{ type: 'accept', list: 'include', term: 'orphan' }]);
    expect(back.state.meta.decisions.include.orphan).toBe('accepted');   // verdict restored
    expect(back.state.inclusion).toEqual(['orphan']);                    // …and the term is back
  });
});

describe('108.md §20 — canonical key order is what makes "byte-identical" true', () => {
  it('a delete + re-add lands the key back in its original slot', () => {
    const before = st(['a', 'b', 'c'], [], metaOf({
      decisions: { include: { a: 'rejected', b: 'rejected', c: 'rejected' } },
    }));
    const { back } = roundTrip(before, { type: 'remove', list: 'include', term: 'b' });
    expect(Object.keys(back.state.meta.decisions.include)).toEqual(['a', 'b', 'c']);
    expect(bytes(back.state)).toBe(bytes(before));
  });

  it('every written map is sorted, while `seeded` keeps its KEYWORD_LISTS order', () => {
    let s = st([], []);
    for (const t of ['zebra', 'alpha', 'mango']) {
      s = applyKeywordOp(s, { type: 'reject', list: 'include', term: t }).state;
    }
    expect(Object.keys(s.meta.decisions.include)).toEqual(['alpha', 'mango', 'zebra']);
    s = applyKeywordOp(st(['a'], ['b']), { type: 'remove', list: 'exclude', term: 'b' }).state;
    s = applyKeywordOp(s, { type: 'remove', list: 'include', term: 'a' }).state;
    expect(Object.keys(s.meta.seeded)).toEqual(['include', 'exclude']);
  });

  it('LOAD PATH is untouched: an unsorted stored meta still comes back by reference', () => {
    const stored = {
      version: KEYWORD_META_VERSION,
      decisions: { include: { zebra: 'rejected', alpha: 'rejected' }, exclude: {} },
      origins: { include: {}, exclude: {} },
    };
    expect(normalizeKeywordMeta(stored)).toBe(stored);
    expect(Object.keys(normalizeKeywordMeta(stored).decisions.include)).toEqual(['zebra', 'alpha']);
  });
});
