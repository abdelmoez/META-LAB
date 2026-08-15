/**
 * 117.md §J.16 — a merged-away reference is UNMERGED, never "restored".
 *
 * THE BUG. `libraryMerge` aliases the loser onto the survivor AND (for a derived
 * reference, which cannot be deleted) suppresses it. The hidden-references card
 * listed it with a Restore button, and pressing it put the id back into `refs` — at
 * which point the alias stopped applying (a canonical id is never overwritten by an
 * alias) and the merged-away copy reappeared beside its survivor. The merge was
 * silently half-undone: one duplicate back, the survivor still carrying the metadata
 * the merge had filled in.
 *
 * THE FIX, pinned here:
 *   - `libraryRestore` REFUSES a merged-away id (structural, so no caller can
 *     reintroduce the resurrection);
 *   - `libraryMerge` records its own inverse — what it filled on the survivor, what
 *     was chained through the loser, whether the loser was already hidden;
 *   - `libraryUnmerge` is exact: merge → unmerge is byte-identical to never having
 *     merged, and conservative when the survivor moved on in between;
 *   - `resolveReferenceLibrary` says WHICH suppressed rows are merged away, so the
 *     card can render the two cases differently.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveReferenceLibrary, normalizeReferenceLibrary, materializeReferenceLibrary,
  libraryAddEntry, libraryEditReference, librarySuppress, libraryRestore,
  libraryMerge, libraryUnmerge, referenceLibrarySignature,
} from '../../../src/research-engine/manuscript/referenceLibrary.js';
import {
  collectCitationOrder, resolveCiteId,
} from '../../../src/research-engine/manuscript/citations.js';

const PROJECT = Object.freeze({
  studies: [
    { id: 's1', title: 'Preprint version', authors: 'Lee K', year: '2019' },
    { id: 's2', title: 'Journal version', authors: 'Lee K', year: '2019', journal: 'Lancet', volume: '9', pmid: '31234567' },
    { id: 's3', title: 'Unrelated study', authors: 'Roe B', year: '2021' },
  ],
});

const EMPTY = normalizeReferenceLibrary(null);
const refsOf = (lib, project = PROJECT) => resolveReferenceLibrary(project, { library: lib }).refs;
const mergeInto = (lib, survivorId, mergedId, project = PROJECT) =>
  libraryMerge(lib, { survivorId, mergedId, refs: refsOf(lib, project) });

/* ════════════ the round trip ════════════ */

describe('117.md §J.16 — merge → unmerge is byte-exact', () => {
  it('a derived merge and its unmerge leave the overlay exactly as it was', () => {
    const merged = mergeInto(EMPTY, 's1', 's2');
    expect(referenceLibrarySignature(merged)).not.toBe(referenceLibrarySignature(EMPTY));
    const back = libraryUnmerge(merged, 's2');
    expect(referenceLibrarySignature(back)).toBe(referenceLibrarySignature(EMPTY));
    // …and byte-stability holds: the key leaves the blob entirely.
    expect(materializeReferenceLibrary(back)).toBeUndefined();
  });

  it('the survivor gives back exactly the fields the merge filled', () => {
    const merged = mergeInto(EMPTY, 's1', 's2');
    const filled = resolveReferenceLibrary(PROJECT, { library: merged }).refs[0];
    expect(filled.journal).toBe('Lancet');
    expect(filled.volume).toBe('9');
    expect(filled.pmid).toBe('31234567');

    const back = libraryUnmerge(merged, 's2');
    const survivor = resolveReferenceLibrary(PROJECT, { library: back }).refs.find((r) => r.id === 's1');
    expect(survivor.journal).toBe('');
    expect(survivor.volume).toBe('');
    expect(survivor.pmid).toBe('');
    // …and the loser is a reference again, in derived order.
    expect(resolveReferenceLibrary(PROJECT, { library: back }).refs.map((r) => r.id))
      .toEqual(['s1', 's2', 's3']);
  });

  it('the alias goes with it, so nothing keeps resolving to the survivor', () => {
    const merged = mergeInto(EMPTY, 's1', 's2');
    expect(resolveReferenceLibrary(PROJECT, { library: merged }).aliases.s2).toBe('s1');
    const back = libraryUnmerge(merged, 's2');
    expect(resolveReferenceLibrary(PROJECT, { library: back }).aliases.s2).toBeUndefined();
    expect(resolveCiteId('s2', resolveReferenceLibrary(PROJECT, { library: back }).aliases)).toBe('s2');
  });

  it('a citation written before the merge points back at its own reference again', () => {
    const merged = mergeInto(EMPTY, 's1', 's2');
    const during = resolveReferenceLibrary(PROJECT, { library: merged });
    expect(collectCitationOrder(['x [[cite:s2]]'], { aliases: during.aliases }).orderMap.get('s2')).toBe(1);
    const back = libraryUnmerge(merged, 's2');
    const after = resolveReferenceLibrary(PROJECT, { library: back });
    // s2 exists again, so the citation resolves to s2 itself (never "[?]").
    expect(after.byId.get('s2').id).toBe('s2');
  });

  it('a merge of ENTRIES records no inverse — the entry is deleted, and undo owns it', () => {
    let lib = libraryAddEntry(EMPTY, { id: 'e1', title: 'A' });
    lib = libraryAddEntry(lib, { id: 'e2', title: 'A', journal: 'BMJ' });
    const merged = libraryMerge(lib, { survivorId: 'e1', mergedId: 'e2', refs: refsOf(lib, {}) });
    expect(normalizeReferenceLibrary(merged).merges).toEqual({});
    expect(merged.removed).toEqual([]);
    expect(libraryUnmerge(merged, 'e2')).not.toBeNull();     // the alias alone is reversible
  });
});

/* ════════════ the resurrection this closes ════════════ */

describe('117.md §J.16 — a merged-away reference is not independently restorable', () => {
  it('libraryRestore refuses it (the resurrection can no longer be reached)', () => {
    const merged = mergeInto(EMPTY, 's1', 's2');
    expect(merged.removed).toContain('s2');
    expect(libraryRestore(merged, 's2')).toBeNull();
  });

  it('a HAND-hidden reference still restores exactly as before', () => {
    const hidden = librarySuppress(EMPTY, 's3');
    expect(hidden.removed).toEqual(['s3']);
    const back = libraryRestore(hidden, 's3');
    expect(back.removed).toEqual([]);
    expect(referenceLibrarySignature(back)).toBe(referenceLibrarySignature(EMPTY));
  });

  it('hiding by hand and MERGING are two states the resolver tells apart', () => {
    let lib = librarySuppress(EMPTY, 's3');
    lib = mergeInto(lib, 's1', 's2');
    const res = resolveReferenceLibrary(PROJECT, { library: lib });
    expect(res.suppressed.map((r) => r.id).sort()).toEqual(['s2', 's3']);
    expect(Object.keys(res.mergedAway)).toEqual(['s2']);
    expect(res.mergedAway.s2.into).toBe('s1');
    expect(res.mergedAway.s2.survivor.title).toBe('Preprint version');
    expect(res.mergedAway.s2.recorded).toBe(true);
  });

  it('a reference hidden BEFORE the merge stays hidden after the unmerge', () => {
    let lib = librarySuppress(EMPTY, 's2');
    lib = mergeInto(lib, 's1', 's2');
    const back = libraryUnmerge(lib, 's2');
    expect(back.removed).toEqual(['s2']);                    // still hidden, by hand
    expect(back.aliases.s2).toBeUndefined();                 // but no longer merged
    expect(libraryRestore(back, 's2').removed).toEqual([]);  // and restorable again
  });

  it('a PRE-§J.16 merge (alias + suppression, no record) can still be unmerged', () => {
    // Exactly what a blob written by the shipped 117 code looks like.
    const legacy = normalizeReferenceLibrary({
      aliases: { s2: 's1' }, removed: ['s2'], edits: { s1: { journal: 'Lancet' } },
    });
    const res = resolveReferenceLibrary(PROJECT, { library: legacy });
    expect(res.mergedAway.s2.recorded).toBe(false);
    const back = libraryUnmerge(legacy, 's2');
    expect(back.aliases.s2).toBeUndefined();
    expect(back.removed).toEqual([]);
    // The fill cannot be reverted (nothing recorded what it was) — and it is NOT
    // guessed at: the correction the researcher may since have relied on survives.
    expect(back.edits.s1).toEqual({ journal: 'Lancet' });
  });
});

/* ════════════ conservatism ════════════ */

describe('117.md §J.16 — unmerge reverts what the merge owns, and nothing else', () => {
  it('a field the researcher changed after the merge is left alone', () => {
    let lib = mergeInto(EMPTY, 's1', 's2');
    lib = libraryEditReference(lib, 's1', { journal: 'BMJ' });   // a hand correction
    const back = libraryUnmerge(lib, 's2');
    expect(back.edits.s1.journal).toBe('BMJ');                  // kept
    expect(back.edits.s1.volume).toBeUndefined();               // merge-filled → reverted
  });

  it('an unrelated later edit on the survivor survives the unmerge', () => {
    let lib = mergeInto(EMPTY, 's1', 's2');
    lib = libraryEditReference(lib, 's1', { issue: '4' });
    const back = libraryUnmerge(lib, 's2');
    expect(back.edits.s1).toEqual({ issue: '4' });
  });

  it('a chain of merges unmerges one link at a time, in the right order', () => {
    let lib = mergeInto(EMPTY, 's2', 's3');   // s3 → s2
    lib = mergeInto(lib, 's1', 's2');         // s2 → s1, and s3 re-flattened onto s1
    expect(resolveReferenceLibrary(PROJECT, { library: lib }).aliases).toEqual({ s2: 's1', s3: 's1' });

    const back = libraryUnmerge(lib, 's2');   // undo only the OUTER merge
    const res = resolveReferenceLibrary(PROJECT, { library: back });
    expect(res.aliases.s2).toBeUndefined();
    expect(res.aliases.s3).toBe('s2');        // s3 belongs to s2 again, not to s1
    expect(res.refs.map((r) => r.id)).toEqual(['s1', 's2']);
  });

  it('unmerging something that was never merged is a no-op, not a write', () => {
    expect(libraryUnmerge(EMPTY, 's2')).toBeNull();
    expect(libraryUnmerge(librarySuppress(EMPTY, 's3'), 's3')).toBeNull();
    expect(libraryUnmerge(EMPTY, '')).toBeNull();
  });
});

/* ════════════ persistence shape ════════════ */

describe('117.md byte-stability — the merge record materializes only when it exists', () => {
  it('a library with no merges keeps no `merges` key', () => {
    const stored = materializeReferenceLibrary(librarySuppress(EMPTY, 's3'));
    expect(stored).toEqual({ removed: ['s3'] });
    expect(Object.prototype.hasOwnProperty.call(stored, 'merges')).toBe(false);
  });

  it('a merge stores its inverse, and the unmerge takes it away again', () => {
    const merged = mergeInto(EMPTY, 's1', 's2');
    const stored = materializeReferenceLibrary(merged);
    expect(stored.merges.s2.into).toBe('s1');
    expect(Object.keys(stored.merges.s2.filled).sort()).toEqual(['journal', 'pmid', 'volume']);
    expect(stored.merges.s2.filled.journal).toEqual({ to: 'Lancet', from: null });
    expect(materializeReferenceLibrary(libraryUnmerge(merged, 's2'))).toBeUndefined();
  });

  it('a corrupt merge record never throws and never invents a merge', () => {
    const lib = normalizeReferenceLibrary({
      merges: { a: null, b: { into: 'b' }, c: 'nonsense', d: { into: 'e', filled: { x: 'no' } } },
    });
    expect(Object.keys(lib.merges)).toEqual(['d']);
    expect(lib.merges.d).toEqual({ into: 'e' });
  });
});
