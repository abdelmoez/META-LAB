/**
 * 117.md §K.4 — Harvard year disambiguation ("2020a" / "2020b").
 *
 * Harvard's in-text marker is "(Family, Year)", so two references by the same first
 * author in the same year render the SAME marker and the reader cannot tell which
 * bibliography entry a sentence cites. The convention is a lowercase suffix on the
 * year, assigned in BIBLIOGRAPHY ORDER.
 *
 * What this file pins:
 *   - the assignment itself: deterministic, in bibliography order, only for a real
 *     collision, and never for a reference with no author or no year;
 *   - that ONE map drives ALL FOUR surfaces — chip label, in-text marker,
 *     bibliography entry and the exported .docx — so a marker can never disagree
 *     with the entry it points at;
 *   - that it RECOMPUTES derivationally (reorder the bibliography, the letters move
 *     with it) and is never stored;
 *   - that every numeric style is byte-identical to what it was.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  assignYearSuffixes, yearSuffixLetter, yearSuffixesOf, firstAuthorFamily,
  authorYearLabel, formatCitation, formatCitationSegments, formatCitationMarker,
  generateReferenceList, renderInlineMarkers, collectCitationOrder,
  normalizeReference, CITATION_STYLE_IDS,
} from '../../../src/research-engine/manuscript/index.js';
import { citeChipLabel, mdToHtml } from '../../../src/features/manuscript/richEditor/mdDom.js';
import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';

/** Three Smith 2020 papers plus two that must NOT collide with them. */
const raw = (over) => normalizeReference({
  authors: 'Smith J', year: '2020', journal: 'Lancet', title: 'A trial', ...over,
}, over.id);

const SMITH_A = raw({ id: 'a', title: 'Aspirin and stroke' });
const SMITH_B = raw({ id: 'b', title: 'Beta blockers and stroke' });
const SMITH_C = raw({ id: 'c', title: 'Ciclosporin and stroke' });
const SMITH_2021 = raw({ id: 'd', year: '2021', title: 'A later trial' });
const DOE_2020 = raw({ id: 'e', authors: 'Doe A', title: 'Another trial' });

const draftWith = (map) => {
  const d = normalizeDraft(makeManuscriptDraft());
  d.citationStyle = 'harvard';
  for (const k of Object.keys(map)) d.sections[k].content = map[k];
  return d;
};

/* ════════════ the assignment ════════════ */

describe('117.md §K.4 — suffixes are assigned in bibliography order', () => {
  it('two references by the same first author in the same year become a/b', () => {
    expect(assignYearSuffixes([SMITH_A, SMITH_B])).toEqual({ a: 'a', b: 'b' });
  });

  it('a THREE-way tie becomes a/b/c, in list order', () => {
    expect(assignYearSuffixes([SMITH_A, SMITH_B, SMITH_C])).toEqual({ a: 'a', b: 'b', c: 'c' });
  });

  it('reordering the bibliography reassigns the letters (derivational, never stored)', () => {
    expect(assignYearSuffixes([SMITH_C, SMITH_A, SMITH_B])).toEqual({ c: 'a', a: 'b', b: 'c' });
  });

  it('NO collision means NO suffix — same author different year, same year different author', () => {
    expect(assignYearSuffixes([SMITH_A, SMITH_2021, DOE_2020])).toEqual({});
    expect(assignYearSuffixes([SMITH_A])).toEqual({});
    expect(assignYearSuffixes([])).toEqual({});
  });

  it('only the colliding group is suffixed; the rest of the list is untouched', () => {
    expect(assignYearSuffixes([SMITH_A, DOE_2020, SMITH_B, SMITH_2021]))
      .toEqual({ a: 'a', b: 'b' });
  });

  it('the family name is matched case-insensitively (databases shout)', () => {
    expect(assignYearSuffixes([SMITH_A, raw({ id: 'z', authors: 'SMITH J' })]))
      .toEqual({ a: 'a', z: 'b' });
  });

  it('a reference with no author or no year is never suffixed (nothing to group by)', () => {
    const noAuthor = normalizeReference({ id: 'n1', title: 'Anonymous report', year: '2020' }, 'n1');
    const noYear = normalizeReference({ id: 'n2', authors: 'Smith J', title: 'Undated' }, 'n2');
    expect(firstAuthorFamily(noAuthor)).toBe('');
    expect(assignYearSuffixes([noAuthor, normalizeReference({ id: 'n3', title: 'Other', year: '2020' }, 'n3')]))
      .toEqual({});
    expect(assignYearSuffixes([noYear, raw({ id: 'n4', year: '' })])).toEqual({});
  });

  it('a numeric style has no author-year marker, so it gets no suffixes at all', () => {
    for (const style of CITATION_STYLE_IDS.filter((s) => s !== 'harvard')) {
      expect(assignYearSuffixes([SMITH_A, SMITH_B], style), style).toEqual({});
    }
  });

  it('the letters keep going past z (aa, ab) instead of colliding', () => {
    expect(yearSuffixLetter(0)).toBe('a');
    expect(yearSuffixLetter(25)).toBe('z');
    expect(yearSuffixLetter(26)).toBe('aa');
    expect(yearSuffixLetter(27)).toBe('ab');
    expect(yearSuffixLetter(51)).toBe('az');
    expect(yearSuffixLetter(52)).toBe('ba');
  });
});

/* ════════════ one map, four surfaces ════════════ */

describe('117.md §K.4 — the marker, the chip, the entry and the .docx all agree', () => {
  const rows = generateReferenceList([SMITH_A, SMITH_B, DOE_2020], 'harvard');
  const suffixes = yearSuffixesOf(rows);
  const refsById = new Map(rows.map((r) => [r.id, r.ref]));

  it('the bibliography row carries its own suffix', () => {
    expect(rows.map((r) => r.yearSuffix || '')).toEqual(['a', 'b', '']);
    expect(suffixes).toEqual({ a: 'a', b: 'b' });
  });

  it('the bibliography ENTRY prints "(2020a)"', () => {
    expect(rows[0].text).toContain('(2020a)');
    expect(rows[1].text).toContain('(2020b)');
    expect(rows[2].text).toContain('(2020)');
    expect(rows[2].text).not.toContain('2020a');
  });

  it('the styled SEGMENTS carry it too (the .docx renders these, not the plain text)', () => {
    expect(rows[0].segments.map((s) => s.text).join('')).toContain('(2020a) ');
    expect(rows[2].segments.map((s) => s.text).join('')).toContain('(2020) ');
  });

  it('the IN-TEXT marker reads "(Smith, 2020a)"', () => {
    const om = new Map([['a', 1], ['b', 2]]);
    expect(formatCitationMarker(['a'], om, 'harvard', { refsById, yearSuffixes: suffixes })).toBe('(Smith, 2020a)');
    expect(formatCitationMarker(['b'], om, 'harvard', { refsById, yearSuffixes: suffixes })).toBe('(Smith, 2020b)');
    // …and a multi-cite disambiguates both halves.
    expect(formatCitationMarker(['a', 'b'], om, 'harvard', { refsById, yearSuffixes: suffixes }))
      .toBe('(Smith, 2020a; Smith, 2020b)');
  });

  it('renderInlineMarkers rewrites the prose with the suffixed markers', () => {
    const { orderMap } = collectCitationOrder(['Both trials [[cite:a]] [[cite:b]].']);
    const out = renderInlineMarkers('Both trials [[cite:a]] [[cite:b]].', orderMap, 'harvard', { refsById, yearSuffixes: suffixes });
    expect(out).toBe('Both trials (Smith, 2020a) (Smith, 2020b).');
  });

  it('the CHIP label is the same string as the marker', () => {
    const om = new Map([['a', 1], ['b', 2]]);
    expect(citeChipLabel('a', om, 'harvard', refsById, suffixes).label).toBe('(Smith, 2020a)');
    expect(mdToHtml('x [[cite:b]]', { orderMap: om, citationStyle: 'harvard', refsById, yearSuffixes: suffixes }))
      .toContain('(Smith, 2020b)');
  });

  it('without the map the label degrades to the un-suffixed form, never to nonsense', () => {
    const om = new Map([['a', 1]]);
    expect(citeChipLabel('a', om, 'harvard', refsById).label).toBe('(Smith, 2020)');
    expect(authorYearLabel(SMITH_A)).toBe('Smith, 2020');
    expect(authorYearLabel(SMITH_A, 'a')).toBe('Smith, 2020a');
    // A suffix on a reference with no year is meaningless and is not printed.
    expect(authorYearLabel(normalizeReference({ id: 'q', authors: 'Smith J' }, 'q'), 'a')).toBe('Smith');
  });

  it('an alias id inherits its survivor’s suffix (a merged citation still disambiguates)', () => {
    const withAlias = yearSuffixesOf(rows, { old: 'b' });
    expect(withAlias.old).toBe('b');
  });

  it('the exported .docx carries the SAME letters in the prose and in the list', async () => {
    const draft = draftWith({ results: 'Both trials [[cite:a]] and [[cite:b]] agreed.' });
    const blob = await buildManuscriptDocx({ studies: [] }, draft, {
      references: rows, referenceAliases: {}, includeFigures: false,
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('(Smith, 2020a)');
    expect(xml).toContain('(Smith, 2020b)');
    expect(xml).toContain('(2020a)');
    expect(xml).toContain('(2020b)');
  });
});

/* ════════════ the styles that must not move ════════════ */

describe('117.md §K.4 — nothing moves for a style without author-year markers', () => {
  it('a numeric bibliography is byte-identical with and without the collision', () => {
    for (const style of ['vancouver', 'jama', 'ama', 'apa', 'nature', 'nejm']) {
      const rows = generateReferenceList([SMITH_A, SMITH_B], style);
      expect(rows.some((r) => r.yearSuffix), style).toBe(false);
      expect(rows[0].text, style).toBe(formatCitation(SMITH_A, style));
      expect(rows[1].segments, style).toEqual(formatCitationSegments(SMITH_B, style));
    }
  });

  it('a HARVARD bibliography with no collision is byte-identical to the old output', () => {
    const rows = generateReferenceList([SMITH_A, DOE_2020], 'harvard');
    expect(rows[0].text).toBe(formatCitation(SMITH_A, 'harvard'));
    expect(rows[1].segments).toEqual(formatCitationSegments(DOE_2020, 'harvard'));
  });
});
