/**
 * 117.md §26-§41 — the integrated reference library + citation workflow (engine).
 *
 * What these pin, in the order the prompt asks for it:
 *   §26/§27  ONE resolver seam: derived included-study refs + a project-level
 *            overlay, materialized only when non-empty (byte-stability).
 *   §29      a user correction is NEVER clobbered by a refresh or by a later lookup.
 *   §30      the importers actually capture volume/issue/pages/publisher/ISBN/URL.
 *   §31      derived entries can be suppressed and restored.
 *   §32      dedupe and merge record ALIASES — a citation written before a merge
 *            keeps resolving forever. This is the bug the wave fixes: the old
 *            dedupe DROPPED later duplicates and orphaned their citations to "[?]".
 *   §35/§36  multi-cite tokens, range collapse, first-appearance numbering.
 *   §37      three new styles, and the four original ones byte-identical.
 *   §39      citation-integrity checks at the right severities.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';
import {
  citationToken, parseCiteIds, collectCitationOrder, renderInlineMarkers,
  collapseNumberRanges, formatCitationMarker, orderReferencesForManuscript,
  dedupeReferences, dedupeReferencesWithAliases, formatCitation, formatCitationSegments,
  generateReferenceList, collectCitationUsage, authorYearLabel, resolveCiteId,
  referencesFromProject, toRIS, toBibTeX, CITATION_TOKEN_RE,
} from '../../../src/research-engine/manuscript/citations.js';
import {
  resolveReferenceLibrary, normalizeReferenceLibrary, materializeReferenceLibrary,
  libraryAddEntry, libraryEditReference, librarySuppress, libraryRestore,
  libraryMerge, libraryDeleteEntry, recordToReferenceEntry, previewReferenceImport,
  suggestReferenceDuplicates, fieldsForType, REFERENCE_TYPES, referenceTypeLabel,
  filterReferenceRows, sortReferences, collectReferenceTags, referenceMatches,
  flattenAliases, resolveAliasId,
} from '../../../src/research-engine/manuscript/referenceLibrary.js';
import { validateCitations } from '../../../src/research-engine/manuscript/exportValidation.js';
import {
  makeManuscriptDraft, normalizeDraft, CITATION_STYLES, CITATION_STYLE_IDS,
} from '../../../src/research-engine/manuscript/model.js';
import { parseRIS, parseBibTeX, parseNBIB, parseCSV } from '../../../src/research-engine/import-export/parsers.js';

const REF = {
  id: 'r1', authors: 'Smith J, Doe A', title: 'A trial', journal: 'Lancet',
  year: '2020', volume: '12', issue: '3', pages: '100-110', doi: '10.1/x',
};

const draftWith = (map) => {
  const d = normalizeDraft(makeManuscriptDraft());
  for (const k of Object.keys(map)) d.sections[k].content = map[k];
  return d;
};

/* ════════════ §26/§27 — the resolver seam ════════════ */

describe('117.md §26/§27 — resolveReferenceLibrary is the one seam', () => {
  const project = {
    studies: [
      { id: 's1', title: 'Study one', authors: 'Lee K', year: '2019', doi: '10.1/a' },
      { id: 's2', title: 'Study two', authors: 'Roe B', year: '2021', doi: '10.1/b' },
    ],
  };

  it('derives included studies with their STUDY ids (never positional ref_N)', () => {
    const res = resolveReferenceLibrary(project);
    expect(res.refs.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(res.derivedIds.has('s1')).toBe(true);
    expect(res.refs[0].origin).toBe('study');
    expect(res.refs[0].studyId).toBe('s1');
  });

  it('a project with no overlay resolves to the derived set alone', () => {
    const res = resolveReferenceLibrary(project);
    expect(res.entryIds.size).toBe(0);
    expect(Object.keys(res.aliases)).toHaveLength(0);
    expect(res.library.entries).toHaveLength(0);
  });

  it('appends overlay entries AFTER the derived ones', () => {
    const lib = libraryAddEntry(normalizeReferenceLibrary(null), { id: 'lib1', title: 'A guideline', type: 'guideline' });
    const res = resolveReferenceLibrary(project, { library: lib });
    expect(res.refs.map((r) => r.id)).toEqual(['s1', 's2', 'lib1']);
    expect(res.refs[2].origin).toBe('library');
    expect(res.refs[2].type).toBe('guideline');
  });

  it('reads the overlay off project.referenceLibrary when no library is passed', () => {
    const withLib = { ...project, referenceLibrary: { entries: [{ id: 'lib9', title: 'Book', type: 'book' }] } };
    const res = resolveReferenceLibrary(withLib);
    expect(res.refs.map((r) => r.id)).toContain('lib9');
  });
});

describe('117.md byte-stability — the overlay materializes only when non-empty', () => {
  it('an empty overlay materializes to undefined (no phantom key)', () => {
    expect(materializeReferenceLibrary(null)).toBeUndefined();
    expect(materializeReferenceLibrary({})).toBeUndefined();
    expect(materializeReferenceLibrary({ entries: [], edits: {}, aliases: {}, removed: [] })).toBeUndefined();
  });

  it('only the non-empty containers are stored', () => {
    const lib = librarySuppress(normalizeReferenceLibrary(null), 's1');
    const out = materializeReferenceLibrary(lib);
    expect(out).toEqual({ removed: ['s1'] });
    expect(Object.prototype.hasOwnProperty.call(out, 'entries')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'edits')).toBe(false);
  });

  it('emptying the last container removes the key again', () => {
    const suppressed = librarySuppress(normalizeReferenceLibrary(null), 's1');
    const restored = libraryRestore(suppressed, 's1');
    expect(materializeReferenceLibrary(restored)).toBeUndefined();
  });

  it('a project that never used the library is untouched by resolution', () => {
    const project = { studies: [{ id: 's1', title: 'T' }] };
    const before = JSON.stringify(project);
    resolveReferenceLibrary(project);
    expect(JSON.stringify(project)).toBe(before);
  });
});

/* ════════════ §29 — corrections are never clobbered ════════════ */

describe('117.md §29 — user-corrected metadata survives everything', () => {
  const project = { studies: [{ id: 's1', title: 'Wrong title', authors: 'Lee K', year: '2019' }] };

  it('an edit over a DERIVED reference patches without touching the study', () => {
    const lib = libraryEditReference(normalizeReferenceLibrary(null), 's1', { title: 'Right title' });
    const res = resolveReferenceLibrary(project, { library: lib });
    expect(res.refs[0].title).toBe('Right title');
    expect(project.studies[0].title).toBe('Wrong title'); // the record is untouched
  });

  it('the patch wins even after the study record itself changes', () => {
    const lib = libraryEditReference(normalizeReferenceLibrary(null), 's1', { title: 'Right title' });
    const moved = { studies: [{ id: 's1', title: 'Changed upstream', authors: 'Lee K', year: '2019' }] };
    expect(resolveReferenceLibrary(moved, { library: lib }).refs[0].title).toBe('Right title');
  });

  it('an AUTO (lookup) fill never overwrites a hand-typed field', () => {
    let lib = libraryEditReference(normalizeReferenceLibrary(null), 's1', { title: 'Typed by hand' });
    lib = libraryEditReference(lib, 's1', { title: 'From CrossRef', journal: 'Lancet' }, { auto: true });
    const res = resolveReferenceLibrary(project, { library: lib });
    expect(res.refs[0].title).toBe('Typed by hand');   // protected
    expect(res.refs[0].journal).toBe('Lancet');        // blank field filled
  });

  it('an entry records WHICH fields the researcher corrected', () => {
    let lib = libraryAddEntry(normalizeReferenceLibrary(null), { id: 'e1', title: 'A' });
    lib = libraryEditReference(lib, 'e1', { year: '2020' });
    expect(lib.entries[0].corrected).toContain('year');
    lib = libraryEditReference(lib, 'e1', { year: '1999' }, { auto: true });
    expect(lib.entries[0].year).toBe('2020');
  });
});

/* ════════════ §31 — suppress / restore ════════════ */

describe('117.md §31 — derived references can be hidden and brought back', () => {
  const project = { studies: [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }] };

  it('suppressing removes it from the list but keeps it restorable', () => {
    const lib = librarySuppress(normalizeReferenceLibrary(null), 's1');
    const res = resolveReferenceLibrary(project, { library: lib });
    expect(res.refs.map((r) => r.id)).toEqual(['s2']);
    expect(res.suppressed.map((r) => r.id)).toEqual(['s1']);
    expect(res.removedIds.has('s1')).toBe(true);
  });

  it('restoring puts it back in derived order', () => {
    const lib = libraryRestore(librarySuppress(normalizeReferenceLibrary(null), 's1'), 's1');
    expect(resolveReferenceLibrary(project, { library: lib }).refs.map((r) => r.id)).toEqual(['s1', 's2']);
  });

  it('deleting an ENTRY removes it outright (a derived one cannot be deleted)', () => {
    const lib = libraryAddEntry(normalizeReferenceLibrary(null), { id: 'e1', title: 'A' });
    expect(libraryDeleteEntry(lib, 'e1').entries).toHaveLength(0);
    expect(libraryDeleteEntry(lib, 's1')).toBeNull();
  });
});

/* ════════════ §32 — aliases: the citation-preservation contract ════════════ */

describe('117.md §32 — dedupe records aliases instead of orphaning citations', () => {
  it('a dropped duplicate becomes an alias of the survivor', () => {
    const { refs, aliases } = dedupeReferencesWithAliases([
      { id: 'a', doi: '10.1/x', title: 'A' },
      { id: 'b', doi: '10.1/X', title: 'A dup', year: '2021' },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe('a');
    expect(aliases).toEqual({ b: 'a' });
    // the surviving record is still the more complete one
    expect(refs[0].year).toBe('2021');
  });

  it('dedupeReferences keeps its array signature (no caller breaks)', () => {
    expect(dedupeReferences([{ doi: '10.1/x' }, { doi: '10.1/X' }])).toHaveLength(1);
  });

  it('a citation of the DROPPED id still numbers as the survivor', () => {
    const project = {
      studies: [
        { id: 'a', doi: '10.1/x', title: 'A', authors: 'Lee K' },
        { id: 'b', doi: '10.1/x', title: 'A', authors: 'Lee K' },
      ],
    };
    const res = resolveReferenceLibrary(project);
    expect(res.aliases).toEqual({ b: 'a' });
    const { orderMap } = collectCitationOrder(['see [[cite:b]]'], { aliases: res.aliases });
    expect(orderMap.get('b')).toBe(1);
    expect(renderInlineMarkers('see [[cite:b]]', orderMap, 'vancouver', { aliases: res.aliases })).toBe('see [1]');
  });

  it('resolveAliasId survives a corrupt cycle instead of hanging', () => {
    expect(resolveAliasId({ a: 'b', b: 'a' }, 'a')).toBeTruthy();
    expect(flattenAliases({ a: 'b', b: 'c' })).toEqual({ a: 'c', b: 'c' });
  });
});

describe('117.md §32 — merge preserves citations, notes, tags and links', () => {
  const project = {
    studies: [
      { id: 's1', title: 'Preprint version', authors: 'Lee K', year: '2019' },
      { id: 's2', title: 'Journal version', authors: 'Lee K', year: '2019', journal: 'Lancet', volume: '9' },
    ],
  };

  it('the losing id aliases to the survivor and disappears from the list', () => {
    let lib = normalizeReferenceLibrary(null);
    const refs = resolveReferenceLibrary(project, { library: lib }).refs;
    lib = libraryMerge(lib, { survivorId: 's1', mergedId: 's2', refs });
    const res = resolveReferenceLibrary(project, { library: lib });
    expect(res.refs.map((r) => r.id)).toEqual(['s1']);
    expect(res.aliases.s2).toBe('s1');
  });

  it('a citation written BEFORE the merge still resolves after it', () => {
    let lib = normalizeReferenceLibrary(null);
    const refs = resolveReferenceLibrary(project, { library: lib }).refs;
    lib = libraryMerge(lib, { survivorId: 's1', mergedId: 's2', refs });
    const res = resolveReferenceLibrary(project, { library: lib });
    const draft = draftWith({ results: 'Reported previously [[cite:s2]].' });
    const { orderMap } = collectCitationOrder(['Reported previously [[cite:s2]].'], { aliases: res.aliases });
    expect(orderMap.get('s2')).toBe(1);
    const ordered = orderReferencesForManuscript(draft, res.refs, { aliases: res.aliases });
    expect(ordered.map((r) => r.id)).toEqual(['s1']);
  });

  it('metadata fills BLANKS only — the survivor is never overwritten', () => {
    let lib = normalizeReferenceLibrary(null);
    const refs = resolveReferenceLibrary(project, { library: lib }).refs;
    lib = libraryMerge(lib, { survivorId: 's1', mergedId: 's2', refs });
    const survivor = resolveReferenceLibrary(project, { library: lib }).refs[0];
    expect(survivor.title).toBe('Preprint version');   // kept
    expect(survivor.journal).toBe('Lancet');           // filled from the loser
    expect(survivor.volume).toBe('9');
  });

  it('notes and tags survive a merge (union / concatenation, never replacement)', () => {
    let lib = normalizeReferenceLibrary(null);
    lib = libraryAddEntry(lib, { id: 'e1', title: 'A', notes: 'keep me', tags: ['core'] });
    lib = libraryAddEntry(lib, { id: 'e2', title: 'A', notes: 'and me', tags: ['extra'] });
    const refs = resolveReferenceLibrary({}, { library: lib }).refs;
    lib = libraryMerge(lib, { survivorId: 'e1', mergedId: 'e2', refs });
    const survivor = resolveReferenceLibrary({}, { library: lib }).refs[0];
    expect(survivor.notes).toContain('keep me');
    expect(survivor.notes).toContain('and me');
    expect(survivor.tags).toEqual(expect.arrayContaining(['core', 'extra']));
  });

  it('a chain of merges still resolves to the final survivor', () => {
    let lib = normalizeReferenceLibrary(null);
    lib = libraryAddEntry(lib, { id: 'a', title: 'A' });
    lib = libraryAddEntry(lib, { id: 'b', title: 'A' });
    lib = libraryAddEntry(lib, { id: 'c', title: 'A' });
    let refs = resolveReferenceLibrary({}, { library: lib }).refs;
    lib = libraryMerge(lib, { survivorId: 'b', mergedId: 'c', refs });
    refs = resolveReferenceLibrary({}, { library: lib }).refs;
    lib = libraryMerge(lib, { survivorId: 'a', mergedId: 'b', refs });
    const res = resolveReferenceLibrary({}, { library: lib });
    expect(res.refs.map((r) => r.id)).toEqual(['a']);
    expect(resolveCiteId('c', res.aliases)).toBe('a');
  });

  it('classifyPair-backed suggestions surface probable duplicates only', () => {
    const { pairs } = suggestReferenceDuplicates([
      { id: 'a', title: 'Effects of aspirin on stroke', authors: 'Lee K; Roe B', journal: 'Lancet', year: '2019', doi: '10.1/x' },
      { id: 'b', title: 'Effects of aspirin on stroke', authors: 'Lee K; Roe B', journal: 'Lancet', year: '2019', doi: '10.1/x' },
      { id: 'c', title: 'Something else entirely about diet', authors: 'Zed Q', year: '2001' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.id).toBe('a');
    expect(pairs[0].b.id).toBe('b');
  });

  it('the duplicate scan is bounded so a huge library cannot freeze the panel', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, title: `T${i}` }));
    expect(suggestReferenceDuplicates(many, { maxRefs: 10 })).toEqual({ pairs: [], skipped: true, total: 30 });
  });
});

/* ════════════ §35/§36 — multi-cite + ordering ════════════ */

describe('117.md §35 — one chip, several references', () => {
  it('the token grammar accepts a comma list (verified, not assumed)', () => {
    const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
    const m = re.exec('x [[cite:a,b,c]] y');
    expect(m && m[1]).toBe('a,b,c');
    expect(parseCiteIds('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('citationToken builds one token from a list', () => {
    expect(citationToken(['a', 'b'])).toBe('[[cite:a,b]]');
    expect(citationToken('a')).toBe('[[cite:a]]');   // legacy single-id form unchanged
  });

  it('numbers every id in a multi-cite by first appearance', () => {
    const { orderMap, orderedIds } = collectCitationOrder(['see [[cite:b,a]] and [[cite:c]]']);
    expect(orderedIds).toEqual(['b', 'a', 'c']);
    expect(orderMap.get('a')).toBe(2);
  });

  it('renders "[1,2]" for two and collapses runs of three or more', () => {
    const { orderMap } = collectCitationOrder(['[[cite:a]][[cite:b]][[cite:c]][[cite:d]][[cite:e]]']);
    expect(renderInlineMarkers('x [[cite:a,b]]', orderMap)).toBe('x [1,2]');
    expect(renderInlineMarkers('x [[cite:a,b,c,d]]', orderMap)).toBe('x [1–4]');
    expect(renderInlineMarkers('x [[cite:a,b,c,e]]', orderMap)).toBe('x [1–3,5]');
  });

  it('collapseNumberRanges sorts, dedupes and only collapses runs of 3+', () => {
    expect(collapseNumberRanges([2, 1])).toBe('1,2');
    expect(collapseNumberRanges([1, 2, 3])).toBe('1–3');
    expect(collapseNumberRanges([1, 2, 3, 7, 9, 10, 11])).toBe('1–3,7,9–11');
    expect(collapseNumberRanges([3, 3, 3])).toBe('3');
  });

  it('an unknown id inside a multi-cite is reported, never silently dropped', () => {
    const { orderMap } = collectCitationOrder(['[[cite:a]]']);
    expect(renderInlineMarkers('x [[cite:a,zz]]', orderMap)).toBe('x [1,?]');
    expect(renderInlineMarkers('x [[cite:zz]]', orderMap)).toBe('x [?]');
  });

  it('APA wraps the same body in parentheses', () => {
    const { orderMap } = collectCitationOrder(['[[cite:a]][[cite:b]]']);
    expect(renderInlineMarkers('x [[cite:a,b]]', orderMap, 'apa')).toBe('x (1,2)');
  });
});

describe('117.md §36 — numbering follows first appearance and is never stored', () => {
  it('moving a citation earlier renumbers both it and the bibliography', () => {
    const refs = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
    const before = draftWith({ introduction: 'x [[cite:a]]', results: 'y [[cite:c]]' });
    expect(orderReferencesForManuscript(before, refs).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    const after = draftWith({ introduction: 'x [[cite:c]]', results: 'y [[cite:a]]' });
    expect(orderReferencesForManuscript(after, refs).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('§39 — an unresolvable citation takes NO number (markers stay in step)', () => {
    const refs = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
    const texts = ['first [[cite:a]] then [[cite:typo]] then [[cite:b]]'];
    const known = new Set(['a', 'b']);
    const { orderMap, orderedIds } = collectCitationOrder(texts, { knownIds: known });
    expect(orderedIds).toEqual(['a', 'b']);
    expect(orderMap.get('b')).toBe(2);           // NOT 3
    expect(orderMap.get('typo')).toBeUndefined();
    expect(renderInlineMarkers(texts[0], orderMap))
      .toBe('first [1] then [?] then [2]');
    // …and the bibliography agrees: entry 2 IS "B".
    const d = draftWith({ results: texts[0] });
    const list = generateReferenceList(orderReferencesForManuscript(d, refs), 'vancouver');
    expect(list[1].id).toBe('b');
  });

  it('without knownIds the numbering is unchanged (legacy callers unaffected)', () => {
    const { orderMap } = collectCitationOrder(['[[cite:a]] [[cite:typo]] [[cite:b]]']);
    expect(orderMap.get('b')).toBe(3);
  });

  it('collectCitationUsage sees section AND statement citations', () => {
    const d = draftWith({ results: 'r [[cite:a]]' });
    d.statements.funding = 'Supported by X [[cite:b,c]]';
    const usage = collectCitationUsage(d);
    expect([...usage.cited].sort()).toEqual(['a', 'b', 'c']);
    expect(usage.tokens).toHaveLength(2);
    expect(usage.tokens[1].sectionId).toBe('statement:funding');
  });
});

/* ════════════ §37 — styles ════════════ */

describe('117.md §37 — the four original styles are byte-identical', () => {
  it('Vancouver / JAMA / AMA / APA output is unchanged', () => {
    expect(formatCitation(REF, 'vancouver')).toBe('Smith J, Doe A. A trial. Lancet. 2020;12(3):100-110. doi:10.1/x');
    expect(formatCitation(REF, 'jama')).toBe('Smith J, Doe A. A trial. Lancet. 2020;12(3):100-110. doi:10.1/x');
    expect(formatCitation(REF, 'ama')).toBe('Smith J, Doe A. A trial. Lancet. 2020;12(3):100-110. doi:10.1/x');
    expect(formatCitation(REF, 'apa')).toBe('Smith, J., & Doe, A. (2020). A trial. Lancet, 12(3), 100-110. https://doi.org/10.1/x');
  });

  it('JAMA still italicises the journal and Vancouver still does not', () => {
    expect(formatCitationSegments(REF, 'jama').some((s) => /Lancet/.test(s.text) && s.italics)).toBe(true);
    expect(formatCitationSegments(REF, 'vancouver').some((s) => /Lancet/.test(s.text) && s.italics)).toBe(false);
  });
});

describe('117.md §37 — Harvard, Nature and NEJM', () => {
  it('registers all seven styles', () => {
    expect(CITATION_STYLE_IDS).toEqual(['vancouver', 'jama', 'ama', 'apa', 'harvard', 'nature', 'nejm']);
    expect(CITATION_STYLES.find((s) => s.id === 'harvard').marker).toBe('author-year');
    expect(CITATION_STYLES.find((s) => s.id === 'nature').marker).toBe('numeric');
  });

  it('Harvard is author-year, with a quoted title and an italic journal', () => {
    expect(formatCitation(REF, 'harvard'))
      .toBe("Smith, J. and Doe, A. (2020) 'A trial', Lancet, 12(3), pp. 100-110. doi: 10.1/x.");
    expect(formatCitationSegments(REF, 'harvard').some((s) => /Lancet/.test(s.text) && s.italics)).toBe(true);
  });

  it('Harvard uses "et al." from four authors', () => {
    const four = { ...REF, authors: 'Smith J; Doe A; Roe B; Poe C' };
    expect(formatCitation(four, 'harvard')).toContain('Smith, J. et al. (2020)');
  });

  it('Nature puts the year last and bolds the volume', () => {
    expect(formatCitation(REF, 'nature')).toBe('Smith J, Doe A. A trial. Lancet 12, 100-110 (2020). doi:10.1/x');
    const segs = formatCitationSegments(REF, 'nature');
    expect(segs.some((s) => s.text.includes('Lancet') && s.italics)).toBe(true);
    expect(segs.some((s) => s.text === '12' && s.bold)).toBe(true);
  });

  it('NEJM is the numbered Vancouver family with an italic journal', () => {
    expect(formatCitation(REF, 'nejm')).toBe(formatCitation(REF, 'vancouver'));
    expect(formatCitationSegments(REF, 'nejm').some((s) => /Lancet/.test(s.text) && s.italics)).toBe(true);
  });

  it('an author-year marker reads "(Smith et al., 2020)" and needs the metadata', () => {
    const refsById = new Map([['r1', { ...REF, authorsList: [{ family: 'Smith', given: 'J' }, { family: 'Doe', given: 'A' }, { family: 'Roe', given: 'B' }], year: '2020' }]]);
    expect(formatCitationMarker(['r1'], new Map([['r1', 1]]), 'harvard', { refsById }))
      .toBe('(Smith et al., 2020)');
    expect(authorYearLabel({ authorsList: [{ family: 'Smith' }], year: '2020' })).toBe('Smith, 2020');
  });

  it('Harvard renders author-year markers in the prose', () => {
    const refsById = { a: { authorsList: [{ family: 'Lee' }], year: '2019' }, b: { authorsList: [{ family: 'Roe' }], year: '2021' } };
    const { orderMap } = collectCitationOrder(['[[cite:a]][[cite:b]]']);
    expect(renderInlineMarkers('x [[cite:a,b]]', orderMap, 'harvard', { refsById }))
      .toBe('x (Lee, 2019; Roe, 2021)');
  });

  it('every registered style formats without throwing', () => {
    for (const s of CITATION_STYLE_IDS) {
      expect(typeof formatCitation(REF, s)).toBe('string');
      expect(Array.isArray(formatCitationSegments(REF, s))).toBe(true);
      expect(generateReferenceList([REF], s)[0].index).toBe(1);
    }
  });
});

/* ════════════ §28/§30 — types + import ════════════ */

describe('117.md §28 — the reference type taxonomy reveals relevant fields', () => {
  it('offers the fifteen types the prompt lists', () => {
    expect(REFERENCE_TYPES.map((t) => t.id)).toEqual([
      'journal-article', 'book', 'book-chapter', 'conference-abstract', 'conference-proceeding',
      'website', 'guideline', 'report', 'thesis', 'preprint', 'dataset',
      'trial-registration', 'review-registration', 'government-publication', 'software', 'other',
    ]);
    expect(referenceTypeLabel('trial-registration')).toBe('Clinical Trial Registration');
  });

  it('a book asks for publisher/ISBN and NOT for a journal volume', () => {
    const keys = fieldsForType('book').map((f) => f.key);
    expect(keys).toContain('publisher');
    expect(keys).toContain('isbn');
    expect(keys).not.toContain('journal');
    expect(keys).not.toContain('volume');
  });

  it('a journal article asks for volume/issue/pages/DOI/PMID', () => {
    const keys = fieldsForType('journal-article').map((f) => f.key);
    for (const k of ['journal', 'volume', 'issue', 'pages', 'doi', 'pmid', 'pmcid']) expect(keys).toContain(k);
  });

  it('a website always asks for an accessed date', () => {
    expect(fieldsForType('website').map((f) => f.key)).toContain('accessed');
  });

  it('an unknown type falls back to journal article rather than throwing', () => {
    expect(fieldsForType('nonsense').map((f) => f.key)).toContain('journal');
  });
});

describe('117.md §30 — the importers capture the bibliographic fields', () => {
  it('RIS: VL/IS/SP/EP/PB/SN/UR are read (they used to be dropped)', () => {
    const ris = [
      'TY  - JOUR', 'AU  - Smith, J', 'TI  - A trial', 'JO  - Lancet', 'PY  - 2020',
      'VL  - 12', 'IS  - 3', 'SP  - 100', 'EP  - 110', 'PB  - Elsevier',
      'SN  - 978-0-306-40615-7', 'UR  - https://example.com/x', 'LA  - eng', 'ER  - ',
    ].join('\n');
    const [rec] = parseRIS(ris);
    expect(rec.volume).toBe('12');
    expect(rec.issue).toBe('3');
    expect(rec.pages).toBe('100-110');
    expect(rec.publisher).toBe('Elsevier');
    expect(rec.isbn).toBe('978-0-306-40615-7');
    expect(rec.url).toBe('https://example.com/x');
    expect(rec.language).toBe('eng');
  });

  it('RIS: an ISSN in SN is NOT claimed as an ISBN', () => {
    const ris = ['TY  - JOUR', 'TI  - T', 'SN  - 0140-6736', 'ER  - '].join('\n');
    expect(parseRIS(ris)[0].isbn).toBeUndefined();
  });

  it('RIS: the TY tag maps onto the reference-type taxonomy', () => {
    expect(parseRIS(['TY  - BOOK', 'TI  - A book', 'ER  - '].join('\n'))[0].referenceType).toBe('book');
    expect(parseRIS(['TY  - JOUR', 'TI  - T', 'ER  - '].join('\n'))[0].referenceType).toBe('journal-article');
  });

  it('BibTeX: volume/number/pages/publisher/isbn/url are read, and @book maps to book', () => {
    const bib = '@book{k1,\n author = {Smith, J},\n title = {A book},\n year = {2020},\n publisher = {Wiley},\n isbn = {123},\n volume = {2},\n number = {4},\n pages = {10--20},\n url = {https://e.com}\n}';
    const [rec] = parseBibTeX(bib);
    expect(rec.referenceType).toBe('book');
    expect(rec.publisher).toBe('Wiley');
    expect(rec.isbn).toBe('123');
    expect(rec.volume).toBe('2');
    expect(rec.issue).toBe('4');
    expect(rec.pages).toBe('10-20');
    expect(rec.url).toBe('https://e.com');
  });

  it('NBIB: VI/IP/PG/PMC/LA are read', () => {
    const nbib = ['PMID- 123', 'TI  - A trial', 'JT  - Lancet', 'DP  - 2020', 'VI  - 12', 'IP  - 3', 'PG  - 100-10', 'PMC - PMC7745181', 'LA  - eng'].join('\n');
    const [rec] = parseNBIB(nbib);
    expect(rec.volume).toBe('12');
    expect(rec.issue).toBe('3');
    expect(rec.pages).toBe('100-10');
    expect(rec.pmcid).toBe('PMC7745181');
  });

  it('CSV: volume/issue/pages columns are read', () => {
    const csv = 'Title,Authors,Year,Journal,Volume,Issue,Pages\nA trial,Smith J,2020,Lancet,12,3,100-110';
    const [rec] = parseCSV(csv);
    expect(rec.volume).toBe('12');
    expect(rec.pages).toBe('100-110');
  });

  it('screening records WITHOUT these fields keep their exact old shape', () => {
    const [rec] = parseRIS(['TY  - JOUR', 'AU  - Smith, J', 'TI  - A trial', 'ER  - '].join('\n'));
    expect(Object.keys(rec).sort()).toEqual([
      'abstract', 'authors', 'decision', 'doi', 'dupOf', 'id', 'journal', 'notes',
      'pmid', 'referenceType', 'reviewer2', 'source', 'sourceDb', 'title', 'year',
    ]);
  });

  it('an imported record becomes a library entry with its metadata intact', () => {
    const [rec] = parseRIS(['TY  - JOUR', 'AU  - Smith, J', 'TI  - A trial', 'VL  - 12', 'SP  - 100', 'EP  - 110', 'ER  - '].join('\n'));
    const entry = recordToReferenceEntry(rec, { id: 'e1' });
    expect(entry.volume).toBe('12');
    expect(entry.pages).toBe('100-110');
    expect(entry.type).toBe('journal-article');
  });

  it('the import preview matches incoming records against what is already there', () => {
    const existing = [{ id: 'a', title: 'A trial', authors: 'Smith J', year: '2020', doi: '10.1/x' }];
    const incoming = [
      { title: 'A trial', authors: 'Smith J', year: '2020', doi: '10.1/x' },
      { title: 'Something new', authors: 'Roe B', year: '2021' },
    ];
    const rows = previewReferenceImport(incoming, existing);
    expect(rows[0].match.id).toBe('a');
    expect(rows[1].match).toBeNull();
  });

  it('the preview matches on a shared TITLE even without any identifier', () => {
    const existing = [{ id: 'a', title: 'Effects of aspirin on stroke prevention', authors: 'Lee K; Roe B', journal: 'Lancet', year: '2019' }];
    const rows = previewReferenceImport(
      [{ title: 'Effects of aspirin on stroke prevention', authors: 'Lee K; Roe B', journal: 'Lancet', year: '2019' }],
      existing,
    );
    expect(rows[0].match.id).toBe('a');
  });

  it('the preview stays fast on a large import (blocked, not exhaustive)', () => {
    const existing = Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`, title: `Existing study number ${i} about outcomes`, doi: `10.1/e${i}` }));
    const incoming = Array.from({ length: 600 }, (_, i) => ({ title: `Incoming study number ${i} about outcomes`, doi: `10.1/e${i}` }));
    const t0 = Date.now();
    const rows = previewReferenceImport(incoming, existing);
    expect(rows).toHaveLength(600);
    // every incoming record shares a DOI with an existing one → all matched
    expect(rows.every((r) => r.match)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

/* ════════════ §33 — search / filter / sort ════════════ */

describe('117.md §33 — the library stays searchable and organisable', () => {
  const rows = [
    { id: 'a', cited: true, ref: { id: 'a', title: 'Aspirin trial', authorsRaw: 'Lee K', journal: 'Lancet', year: '2019', doi: '10.1/x', type: 'journal-article', tags: ['core'], authorsList: [{ family: 'Lee' }] } },
    { id: 'b', cited: false, ref: { id: 'b', title: 'Diet guideline', authorsRaw: 'Roe B', journal: 'BMJ', year: '2021', type: 'guideline', tags: [], authorsList: [{ family: 'Roe' }] } },
  ];

  it('searches across author, title, DOI, journal, year and tag', () => {
    expect(referenceMatches(rows[0].ref, 'aspirin')).toBe(true);
    expect(referenceMatches(rows[0].ref, 'lee 2019')).toBe(true);
    expect(referenceMatches(rows[0].ref, '10.1/x')).toBe(true);
    expect(referenceMatches(rows[0].ref, 'core')).toBe(true);
    expect(referenceMatches(rows[0].ref, 'nonsense')).toBe(false);
  });

  it('filters by cited status, type, year, journal and tag', () => {
    expect(filterReferenceRows(rows, { cited: 'cited' }).map((r) => r.id)).toEqual(['a']);
    expect(filterReferenceRows(rows, { cited: 'uncited' }).map((r) => r.id)).toEqual(['b']);
    expect(filterReferenceRows(rows, { type: 'guideline' }).map((r) => r.id)).toEqual(['b']);
    expect(filterReferenceRows(rows, { year: '2019' }).map((r) => r.id)).toEqual(['a']);
    expect(filterReferenceRows(rows, { journal: 'BMJ' }).map((r) => r.id)).toEqual(['b']);
    expect(filterReferenceRows(rows, { tag: 'core' }).map((r) => r.id)).toEqual(['a']);
  });

  it('sorts by author, year and title; "order" keeps citation order', () => {
    expect(sortReferences(rows, 'author').map((r) => r.id)).toEqual(['a', 'b']);
    expect(sortReferences(rows, 'year').map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortReferences(rows, 'title').map((r) => r.id)).toEqual(['a', 'b']);
    expect(sortReferences(rows, 'order').map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('collects the distinct tag vocabulary', () => {
    expect(collectReferenceTags(rows.map((r) => r.ref))).toEqual(['core']);
  });
});

/* ════════════ §39 — citation integrity ════════════ */

describe('117.md §39 — citation integrity checks', () => {
  const refs = [
    { id: 'a', title: 'A trial', authorsRaw: 'Lee K', year: '2019' },
    { id: 'b', title: 'B trial', authorsRaw: 'Roe B', year: '2021' },
  ];

  it('an unknown citation id is an ERROR with the closest match named', () => {
    const d = draftWith({ results: 'x [[cite:aa]]' });
    const v = validateCitations({ draft: d, references: refs });
    expect(v.errors.map((e) => e.code)).toContain('cite-unknown');
    expect(v.errors[0].message).toContain('A trial');
  });

  it('citing a SUPPRESSED reference is its own ERROR', () => {
    const d = draftWith({ results: 'x [[cite:z]]' });
    const v = validateCitations({ draft: d, references: refs, removedIds: new Set(['z']) });
    expect(v.errors.map((e) => e.code)).toEqual(['cite-suppressed']);
  });

  it('a citation of a MERGED id is not an error (aliases resolve first)', () => {
    const d = draftWith({ results: 'x [[cite:old]]' });
    const v = validateCitations({ draft: d, references: refs, aliases: { old: 'a' } });
    expect(v.errors).toHaveLength(0);
  });

  it('a CITED reference missing key metadata is a WARNING', () => {
    const d = draftWith({ results: 'x [[cite:c]]' });
    const v = validateCitations({ draft: d, references: [...refs, { id: 'c', title: '', authorsRaw: '', year: '' }] });
    expect(v.warnings.map((w) => w.code)).toContain('cited-ref-incomplete');
    expect(v.warnings.find((w) => w.code === 'cited-ref-incomplete').message).toMatch(/title/);
  });

  it('an UNCITED library entry is INFO, never a warning', () => {
    const d = draftWith({ results: 'x [[cite:a]]' });
    const v = validateCitations({ draft: d, references: refs });
    expect(v.info.map((i) => i.code)).toContain('uncited-references');
    expect(v.warnings.map((w) => w.code)).not.toContain('uncited-references');
  });

  it('probable duplicate bibliography entries are a WARNING', () => {
    const dupes = [
      { id: 'a', title: 'Effects of aspirin on stroke', authorsRaw: 'Lee K', authors: 'Lee K; Roe B', journal: 'Lancet', year: '2019', doi: '10.1/x' },
      { id: 'b', title: 'Effects of aspirin on stroke', authorsRaw: 'Lee K', authors: 'Lee K; Roe B', journal: 'Lancet', year: '2019', doi: '10.1/x' },
    ];
    const v = validateCitations({ draft: draftWith({ results: '' }), references: dupes });
    expect(v.warnings.map((w) => w.code)).toContain('duplicate-references');
  });

  it('a clean manuscript produces no citation errors or warnings', () => {
    const d = draftWith({ results: 'x [[cite:a]] y [[cite:b]]' });
    const v = validateCitations({ draft: d, references: refs });
    expect(v.errors).toHaveLength(0);
    expect(v.warnings).toHaveLength(0);
  });
});

/* ════════════ §41 — interchange export carries the new metadata ════════════ */

describe('117.md §41 — RIS/BibTeX export the extended metadata', () => {
  it('RIS emits PB/SN/UR when present and stays byte-identical when not', () => {
    const plain = toRIS([{ id: 'r', authors: 'Smith J', title: 'T', year: '2020', pages: '100--110' }]);
    expect(plain).not.toMatch(/PB {2}-/);
    expect(plain).toMatch(/SP {2}- 100/);
    const rich = toRIS([{ id: 'r', authors: 'Smith J', title: 'T', publisher: 'Wiley', isbn: '123', url: 'https://e.com', type: 'book' }]);
    expect(rich).toMatch(/TY {2}- BOOK/);
    expect(rich).toMatch(/PB {2}- Wiley/);
    expect(rich).toMatch(/SN {2}- 123/);
    expect(rich).toMatch(/UR {2}- https:\/\/e\.com/);
  });

  it('BibTeX keeps @article for a journal article and switches for a book', () => {
    expect(toBibTeX([{ id: 'r', authors: 'Smith J', title: 'T', journal: 'J', year: '2020' }])).toMatch(/@article\{/);
    expect(toBibTeX([{ id: 'r', authors: 'Smith J', title: 'T', type: 'book', publisher: 'Wiley' }])).toMatch(/@book\{/);
  });
});

/* ════════════ §41 — the Word export ════════════ */

describe('117.md §41 — the .docx carries the library through', () => {
  const project = {
    id: 'p', name: 'P', pico: {}, search: { dbs: {} }, prisma: {},
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', journal: 'Lancet', volume: '12', issue: '3', pages: '100-110', doi: '10.1/a' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', journal: 'NEJM', doi: '10.1/b' },
      { id: 's3', title: 'Trial C', authors: 'Roe B', year: '2019', journal: 'BMJ', doi: '10.1/c' },
      { id: 's4', title: 'Trial D', authors: 'Poe C', year: '2018', journal: 'JAMA', doi: '10.1/d' },
    ],
  };

  const docOf = async (draft, opts = {}) => {
    const zip = await JSZip.loadAsync(Buffer.from(await (await buildManuscriptDocx(project, draft, opts)).arrayBuffer()));
    return zip.file('word/document.xml').async('string');
  };

  it('renders a multi-cite marker and collapses a run to a range', async () => {
    const d = draftWith({ results: 'One [[cite:s1,s2]] and all [[cite:s1,s2,s3,s4]].' });
    const doc = await docOf(d);
    expect(doc).not.toContain('[[cite:');
    expect(doc).toContain('[1,2]');
    expect(doc).toContain('[1–4]');
  });

  it('resolves an ALIASED citation to its survivor instead of "[?]"', async () => {
    const withLib = {
      ...project,
      referenceLibrary: { aliases: { old: 's2' }, removed: [] },
    };
    const d = draftWith({ results: 'Cited before the merge [[cite:old]].' });
    const zip = await JSZip.loadAsync(Buffer.from(await (await buildManuscriptDocx(withLib, d, {})).arrayBuffer()));
    const doc = await zip.file('word/document.xml').async('string');
    expect(doc).toContain('[1]');
    expect(doc).not.toContain('[?]');
  });

  it('the bibliography is ordered by first appearance, with real volume/issue/pages', async () => {
    const d = draftWith({ results: 'B first [[cite:s2]] then A [[cite:s1]].' });
    const doc = await docOf(d);
    const posB = doc.indexOf('Trial B');
    const posA = doc.indexOf('Trial A');
    expect(posB).toBeGreaterThan(-1);
    expect(posA).toBeGreaterThan(posB);
    expect(doc).toContain('2020;12(3):100-110.');
  });

  it('a suppressed reference is not in the bibliography', async () => {
    const withLib = { ...project, referenceLibrary: { removed: ['s3'] } };
    const d = draftWith({ results: 'A [[cite:s1]].' });
    const zip = await JSZip.loadAsync(Buffer.from(await (await buildManuscriptDocx(withLib, d, {})).arrayBuffer()));
    const doc = await zip.file('word/document.xml').async('string');
    expect(doc).not.toContain('Trial C');
  });

  it('a Nature-styled bibliography bolds the volume run', async () => {
    const d = draftWith({ results: 'A [[cite:s1]].' });
    d.citationStyle = 'nature';
    const doc = await docOf(d);
    expect(doc).toContain('Trial A');
    expect(doc).toContain('<w:b/>');
  });

  it('a Harvard manuscript renders author-year markers, not numbers', async () => {
    const d = draftWith({ results: 'As shown [[cite:s1]].' });
    d.citationStyle = 'harvard';
    const doc = await docOf(d);
    expect(doc).toContain('(Smith, 2020)');
    expect(doc).not.toContain('[[cite:');
  });

  it('a caller-supplied reference list is used verbatim (validated == exported)', async () => {
    const d = draftWith({ results: 'A [[cite:s1]].' });
    const custom = generateReferenceList([{ id: 's1', title: 'Overridden title', authors: 'Smith J' }], 'vancouver');
    const doc = await docOf(d, { references: custom });
    expect(doc).toContain('Overridden title');
    expect(doc).not.toContain('Trial B');
  });
});

/* ════════════ derived-reference regression ════════════ */

describe('117.md — referencesFromProject keeps its contract', () => {
  it('a study without an id still gets a stable positional fallback', () => {
    const refs = referencesFromProject({ studies: [{ title: 'No id here' }] });
    expect(refs[0].id).toBe('ref_1');
  });

  it('opts.dedupe:false returns the raw per-study list', () => {
    const project = { studies: [{ id: 'a', doi: '10.1/x', title: 'A' }, { id: 'b', doi: '10.1/x', title: 'A' }] };
    expect(referencesFromProject(project, { dedupe: false })).toHaveLength(2);
    expect(referencesFromProject(project)).toHaveLength(1);
  });
});
