/**
 * criteriaKeywords.test.js — the ACTIVE vs SUGGESTED keyword contract.
 *
 * prompt28 Part 1 established the criteria → keyword derivation and its provenance
 * badges. 107.md §2 changed what happens to those derived terms: they are now
 * SUGGESTIONS awaiting review instead of instantly-active highlight/filter terms.
 * The derivation itself (criteriaKeywordsFromSnapshot) is unchanged — it still
 * backs the AI cold-start prior — so its tests stay as they were.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKeyword,
  criteriaKeywordsFromSnapshot,
  mergeKeywordSources,
  effectiveKeywords,
  resolveKeywordState,
  KEYWORD_SOURCE,
} from '../../src/research-engine/screening/criteriaKeywords.js';
import { applyKeywordOp, materializeDefaults } from '../../src/research-engine/screening/keywordModel.js';

describe('normalizeKeyword', () => {
  it('lowercases, trims, collapses internal whitespace', () => {
    expect(normalizeKeyword('  Randomized   Controlled  Trial ')).toBe('randomized controlled trial');
    expect(normalizeKeyword(null)).toBe('');
    expect(normalizeKeyword(undefined)).toBe('');
  });
});

describe('criteriaKeywordsFromSnapshot (unchanged — also feeds the AI cold-start prior)', () => {
  it('digests criteria into concepts (not whole sentences) for each side', () => {
    const snap = { incl: '• randomized controlled trial\n• adults with diabetes', excl: '• animal study\n• case report' };
    const { inclusion, exclusion } = criteriaKeywordsFromSnapshot(snap);
    expect(inclusion).toContain('randomized controlled trial');
    expect(inclusion).toContain('RCT'); // conservative abbreviation added
    // "adults with diabetes" is split into concepts — not copied verbatim
    expect(inclusion).toContain('adults');
    expect(inclusion).toContain('diabetes');
    expect(inclusion).not.toContain('adults with diabetes');
    expect(exclusion).toContain('animal study'); // meaningful trailing "study" preserved
    expect(exclusion).toContain('case report');
    // criteria layer must NOT cross sides
    expect(exclusion).not.toContain('randomized controlled trial');
    expect(inclusion).not.toContain('animal study');
  });

  it('accepts a JSON string snapshot and tolerates junk', () => {
    const out = criteriaKeywordsFromSnapshot(JSON.stringify({ incl: 'cohort study' }));
    expect(out.inclusion).toContain('cohort study');
    expect(criteriaKeywordsFromSnapshot('not json')).toEqual({ inclusion: [], exclusion: [] });
    expect(criteriaKeywordsFromSnapshot(null)).toEqual({ inclusion: [], exclusion: [] });
    expect(criteriaKeywordsFromSnapshot({})).toEqual({ inclusion: [], exclusion: [] });
  });

  it('does NOT fold the whole PICO into the criteria layer', () => {
    const out = criteriaKeywordsFromSnapshot({ P: 'elderly population', I: 'aspirin', incl: 'rct only' });
    expect(out.inclusion).toContain('rct'); // "only" is filler, trimmed off
    expect(out.inclusion).not.toContain('elderly population');
    expect(out.inclusion).not.toContain('aspirin');
  });
});

describe('mergeKeywordSources (generic merge helper)', () => {
  it('appends criteria terms not already present, tagging provenance', () => {
    const { terms, sourceByTerm } = mergeKeywordSources(
      ['RCT', 'placebo'],
      ['randomized controlled trial', 'placebo'], // "placebo" already present
      { storedSource: KEYWORD_SOURCE.MANUAL },
    );
    expect(terms).toEqual(['RCT', 'placebo', 'randomized controlled trial']);
    expect(sourceByTerm['RCT']).toBe('manual');
    expect(sourceByTerm['placebo']).toBe('manual'); // kept as manual, not re-badged
    expect(sourceByTerm['randomized controlled trial']).toBe('criteria');
  });

  it('dedupes case/space-insensitively but preserves stored display text', () => {
    const { terms, sourceByTerm } = mergeKeywordSources(
      ['Randomized  Controlled Trial'],
      ['randomized controlled trial'],
    );
    expect(terms).toEqual(['Randomized  Controlled Trial']); // criteria dup dropped
    expect(sourceByTerm['Randomized  Controlled Trial']).toBe('manual');
  });

  it('handles empty / non-array inputs', () => {
    expect(mergeKeywordSources(null, null).terms).toEqual([]);
    expect(mergeKeywordSources(undefined, ['x']).terms).toEqual(['x']);
  });
});

// ── 107.md §2 — the new active/suggested contract ────────────────────────────

const defaults = { inc: ['RCT', 'placebo'], exc: ['animal', 'cohort'] };
const base = {
  defaultInclude: defaults.inc,
  defaultExclude: defaults.exc,
};

describe('effectiveKeywords — ACTIVE terms only', () => {
  it('criteria-derived terms are NO LONGER auto-active', () => {
    const res = effectiveKeywords({
      ...base,
      storedInclude: ['RCT', 'placebo'],
      storedExclude: ['animal', 'cohort'],
      picoSnapshot: { incl: 'Adults with drug-resistant epilepsy', excl: 'Animal studies' },
    });
    expect(res.include.terms).toEqual(['RCT', 'placebo']);
    expect(res.include.terms).not.toContain('drug-resistant epilepsy');
    expect(res.exclude.terms).toEqual(['animal', 'cohort']);
  });

  it('falls back to the shared defaults when a stored list is empty, badged "default"', () => {
    const res = effectiveKeywords({ ...base, storedInclude: [], storedExclude: [], picoSnapshot: {} });
    expect(res.include.terms).toEqual(defaults.inc);
    expect(res.include.sourceByTerm['RCT']).toBe('default');
    expect(res.exclude.sourceByTerm['animal']).toBe('default');
  });

  it('badges a manually added term "manual" and an accepted suggestion "accepted"', () => {
    let state = { inclusion: ['RCT'], exclusion: [], meta: undefined };
    state = applyKeywordOp(state, { type: 'add', list: 'include', term: 'my term' }).state;
    state = applyKeywordOp(state, { type: 'accept', list: 'include', term: 'epilepsy' }).state;
    const res = effectiveKeywords({
      ...base,
      storedInclude: state.inclusion, storedExclude: state.exclusion,
      keywordMeta: state.meta, picoSnapshot: {},
    });
    expect(res.include.sourceByTerm['RCT']).toBe('default');   // part of the seed list
    expect(res.include.sourceByTerm['my term']).toBe('manual');
    expect(res.include.sourceByTerm['epilepsy']).toBe('accepted');
  });
});

describe('resolveKeywordState — suggestions + conflicts', () => {
  it('offers criteria-derived terms as PENDING, not active', () => {
    const st = resolveKeywordState({
      ...base,
      storedInclude: ['RCT'], storedExclude: ['animal'],
      picoSnapshot: { incl: 'Adults with drug-resistant epilepsy', excl: 'Case reports' },
    });
    expect(st.include.terms).toEqual(['RCT']);
    expect(st.include.pending).toContain('drug-resistant epilepsy');
    expect(st.exclude.pending).toContain('case reports');
    expect(st.pendingCount).toBeGreaterThan(0);
  });

  it('an accepted suggestion becomes active and stops being pending', () => {
    const snap = { incl: 'Adults with drug-resistant epilepsy' };
    const before = resolveKeywordState({ ...base, storedInclude: ['RCT'], storedExclude: [], picoSnapshot: snap });
    expect(before.include.pending).toContain('drug-resistant epilepsy');

    const after = applyKeywordOp(
      { inclusion: ['RCT'], exclusion: [], meta: undefined },
      { type: 'accept', list: 'include', term: 'drug-resistant epilepsy' },
    ).state;
    const st = resolveKeywordState({
      ...base, storedInclude: after.inclusion, storedExclude: after.exclusion,
      keywordMeta: after.meta, picoSnapshot: snap,
    });
    expect(st.include.terms).toContain('drug-resistant epilepsy');
    expect(st.include.pending).not.toContain('drug-resistant epilepsy');
  });

  it('a rejected suggestion never comes back', () => {
    const snap = { incl: 'Adults with drug-resistant epilepsy' };
    const rejected = applyKeywordOp(
      { inclusion: ['RCT'], exclusion: [], meta: undefined },
      { type: 'reject', list: 'include', term: 'drug-resistant epilepsy' },
    ).state;
    const st = resolveKeywordState({
      ...base, storedInclude: rejected.inclusion, storedExclude: rejected.exclusion,
      keywordMeta: rejected.meta, picoSnapshot: snap,
    });
    expect(st.include.pending).not.toContain('drug-resistant epilepsy');
    expect(st.include.terms).not.toContain('drug-resistant epilepsy');
  });

  it('107.md regression fixture: "epilepsy" is never active on both sides', () => {
    const st = resolveKeywordState({
      ...base, storedInclude: ['RCT'], storedExclude: ['animal'],
      picoSnapshot: { incl: 'Adults with epilepsy', excl: 'Exclude studies without confirmed epilepsy' },
    });
    const isEpilepsy = t => t.toLowerCase() === 'epilepsy';
    expect(st.include.terms.some(isEpilepsy)).toBe(false);  // suggestions are not active
    expect(st.exclude.terms.some(isEpilepsy)).toBe(false);
    expect(st.include.pending.some(isEpilepsy)).toBe(true); // legitimate inclusion concept
    expect(st.exclude.pending.some(isEpilepsy)).toBe(false); // negated → nothing on this side
  });

  it('a genuinely ambiguous concept is flagged for review, active on neither side', () => {
    const st = resolveKeywordState({
      ...base, storedInclude: ['RCT'], storedExclude: ['animal'],
      picoSnapshot: { incl: 'Adults with epilepsy', excl: 'Studies with epilepsy' },
    });
    expect(st.include.pending.map(t => t.toLowerCase())).not.toContain('epilepsy');
    expect(st.exclude.pending.map(t => t.toLowerCase())).not.toContain('epilepsy');
    expect(st.conflicts.map(c => c.term.toLowerCase())).toContain('epilepsy');
  });

  it('a dismissed conflict stops being flagged', () => {
    const snap = { incl: 'Adults with epilepsy', excl: 'Studies with epilepsy' };
    let state = { inclusion: ['RCT'], exclusion: ['animal'], meta: undefined };
    state = applyKeywordOp(state, { type: 'reject', list: 'include', term: 'epilepsy' }).state;
    state = applyKeywordOp(state, { type: 'reject', list: 'exclude', term: 'epilepsy' }).state;
    const st = resolveKeywordState({
      ...base, storedInclude: state.inclusion, storedExclude: state.exclusion,
      keywordMeta: state.meta, picoSnapshot: snap,
    });
    expect(st.conflicts).toEqual([]);
  });

  it('is project-specific: a different snapshot yields different suggestions', () => {
    const shared = { ...base, storedInclude: ['RCT'], storedExclude: [] };
    const a = resolveKeywordState({ ...shared, picoSnapshot: { incl: 'paediatric epilepsy' } });
    const b = resolveKeywordState({ ...shared, picoSnapshot: { incl: 'geriatric epilepsy' } });
    expect(a.include.pending).toContain('paediatric epilepsy');
    expect(a.include.pending).not.toContain('geriatric epilepsy');
    expect(b.include.pending).toContain('geriatric epilepsy');
  });

  it('removing the criteria removes the suggestion (nothing derived is persisted)', () => {
    const withCriteria = resolveKeywordState({ ...base, storedInclude: ['RCT'], storedExclude: [], picoSnapshot: { incl: 'open-label trial' } });
    expect(withCriteria.include.pending).toContain('open-label trial');
    const without = resolveKeywordState({ ...base, storedInclude: ['RCT'], storedExclude: [], picoSnapshot: {} });
    expect(without.include.pending).toEqual([]);
    expect(without.include.terms).toContain('RCT'); // stored preserved
  });

  it('regeneration never overwrites a manually added term', () => {
    let state = { inclusion: ['RCT'], exclusion: [], meta: undefined };
    state = applyKeywordOp(state, { type: 'add', list: 'include', term: 'my manual term' }).state;
    for (const snap of [{ incl: 'Adults with epilepsy' }, { incl: 'Type 2 diabetes' }, {}]) {
      const st = resolveKeywordState({
        ...base, storedInclude: state.inclusion, storedExclude: state.exclusion,
        keywordMeta: state.meta, picoSnapshot: snap,
      });
      expect(st.include.terms).toContain('my manual term');
      expect(st.include.sourceByTerm['my manual term']).toBe('manual');
    }
  });

  it('tolerates malformed keywordMeta', () => {
    for (const junk of ['not json', 7, [], null, undefined, { decisions: 'x' }]) {
      const st = resolveKeywordState({ ...base, storedInclude: ['RCT'], storedExclude: [], keywordMeta: junk, picoSnapshot: {} });
      expect(st.include.terms).toEqual(['RCT']);
    }
  });

  // 107.md rec — the snackbar Undo must not silently kill a live suggestion.
  it('undoing an accidental add leaves the criteria suggestion PENDING again', () => {
    const snap = { incl: 'Adults with drug-resistant epilepsy' };
    const term = 'drug-resistant epilepsy';
    const before = resolveKeywordState({ ...base, storedInclude: ['RCT'], storedExclude: [], picoSnapshot: snap });
    expect(before.include.pending).toContain(term);

    let state = { inclusion: ['RCT'], exclusion: [], meta: undefined };
    state = applyKeywordOp(state, { type: 'add', list: 'include', term }).state;
    const undone = applyKeywordOp(state, { type: 'remove', list: 'include', term, reject: false }).state;
    const after = resolveKeywordState({
      ...base, storedInclude: undone.inclusion, storedExclude: undone.exclusion,
      keywordMeta: undone.meta, picoSnapshot: snap,
    });
    expect(after.include.terms).toEqual(['RCT']);
    expect(after.include.pending).toEqual(before.include.pending);
    expect(after.pendingCount).toBe(before.pendingCount);

    // …while the deliberate chip × still suppresses it, as designed.
    const rejected = applyKeywordOp(state, { type: 'remove', list: 'include', term }).state;
    const suppressed = resolveKeywordState({
      ...base, storedInclude: rejected.inclusion, storedExclude: rejected.exclusion,
      keywordMeta: rejected.meta, picoSnapshot: snap,
    });
    expect(suppressed.include.pending).not.toContain(term);
  });
});

// 107.md rec — an empty stored list means "show the shared defaults" ONLY while the
// side has never been edited. Removing the last chip used to resurrect all ~28/~50
// default terms as live highlight/filter terms, and the next op re-persisted them.
describe('resolveKeywordState — an emptied side stays empty', () => {
  const kwState = (inclusion, exclusion, meta) => ({ inclusion, exclusion, meta });
  const resolve = (state) => resolveKeywordState({
    ...base,
    storedInclude: state.inclusion, storedExclude: state.exclusion,
    keywordMeta: state.meta, picoSnapshot: {},
  });

  it('BACK-COMPAT: empty lists with empty meta still show the shared defaults', () => {
    for (const meta of [undefined, null, '{}', {}, 'not json']) {
      const st = resolveKeywordState({ ...base, storedInclude: [], storedExclude: [], keywordMeta: meta, picoSnapshot: {} });
      expect(st.include.terms).toEqual(defaults.inc);
      expect(st.exclude.terms).toEqual(defaults.exc);
      expect(st.include.sourceByTerm['RCT']).toBe('default');
    }
  });

  it('removing the LAST active term leaves the side empty, not repopulated', () => {
    const curated = kwState(['seizure'], [], undefined);
    expect(resolve(curated).include.terms).toEqual(['seizure']);

    const emptied = applyKeywordOp(curated, { type: 'remove', list: 'include', term: 'seizure' }).state;
    expect(emptied.inclusion).toEqual([]);
    const st = resolve(emptied);
    expect(st.include.terms).toEqual([]);          // NOT defaults.inc
    expect(st.exclude.terms).toEqual(defaults.exc); // the untouched side is unaffected
  });

  it('the NEXT op does not re-materialize the defaults (the controller sequence)', () => {
    // Mirrors keywordOps: materializeDefaults(touched sides) → applyKeywordOp.
    const seeds = { include: defaults.inc, exclude: defaults.exc };
    let state = kwState(['seizure'], [], undefined);
    state = applyKeywordOp(materializeDefaults(state, seeds, ['include']), {
      type: 'remove', list: 'include', term: 'seizure',
    }).state;
    expect(state.inclusion).toEqual([]);

    for (const op of [
      { type: 'reject', list: 'include', term: 'epilepsy' },
      { type: 'add', list: 'include', term: 'my term' },
      { type: 'remove', list: 'include', term: 'my term' },
    ]) {
      const seeded = materializeDefaults(state, seeds, ['include']);
      expect(seeded.inclusion).not.toContain('RCT');   // never re-seeded
      state = applyKeywordOp(seeded, op).state;
    }
    expect(state.inclusion).toEqual([]);
    expect(resolve(state).include.terms).toEqual([]);
  });

  it('an emptied side can be repopulated by hand and keeps working normally', () => {
    let state = applyKeywordOp(kwState(['seizure'], [], undefined), {
      type: 'remove', list: 'include', term: 'seizure',
    }).state;
    state = applyKeywordOp(state, { type: 'add', list: 'include', term: 'refractory epilepsy' }).state;
    const st = resolve(state);
    expect(st.include.terms).toEqual(['refractory epilepsy']);
    expect(st.include.sourceByTerm['refractory epilepsy']).toBe('manual');
  });
});
