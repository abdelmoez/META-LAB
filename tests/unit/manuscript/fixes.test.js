/**
 * Round-2 review fixes for the P3 manuscript engine (64.md).
 * Locks in: JAMA≠Vancouver, inline citations, BibTeX/RIS escaping, dedupe merge,
 * PRISMA `identified` provenance, DIAG back-transform, template-driven abstracts,
 * and references-from-project including non-pooled studies.
 */
import { describe, it, expect } from 'vitest';
import {
  formatCitationSegments, collectCitationOrder, renderInlineMarkers, citationToken,
  orderReferencesForManuscript, generateReferenceList, dedupeReferences, toBibTeX, toRIS,
  referencesFromProject,
} from '../../../src/research-engine/manuscript/citations.js';
import { computePrismaCounts } from '../../../src/research-engine/manuscript/prismaCounts.js';
import { buildSummaryOfFindingsTable } from '../../../src/research-engine/manuscript/tables.js';
import { generateAbstract } from '../../../src/research-engine/manuscript/draft.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';

describe('JAMA ≠ Vancouver (segments italicise journal)', () => {
  const ref = { id: 'r1', authors: 'Smith J, Doe A', title: 'A trial', journal: 'Lancet', year: '2020', volume: '12', issue: '3', pages: '100-110', doi: '10.1/x' };
  it('JAMA marks the journal segment italic; Vancouver does not', () => {
    const van = formatCitationSegments(ref, 'vancouver');
    const jama = formatCitationSegments(ref, 'jama');
    const vanJournalItalic = van.some((s) => /Lancet/.test(s.text) && s.italics);
    const jamaJournalItalic = jama.some((s) => /Lancet/.test(s.text) && s.italics);
    expect(vanJournalItalic).toBe(false);
    expect(jamaJournalItalic).toBe(true);
  });
  it('reference list carries per-style segments', () => {
    const list = generateReferenceList([ref], 'jama');
    expect(Array.isArray(list[0].segments)).toBe(true);
    expect(list[0].segments.some((s) => s.italics)).toBe(true);
  });
});

describe('inline citations', () => {
  it('numbers tokens by first appearance across sections', () => {
    const texts = [
      'See evidence [[cite:b]] and more [[cite:a]].',
      'Again [[cite:b]] then [[cite:c]].',
    ];
    const { orderMap, orderedIds } = collectCitationOrder(texts);
    expect(orderedIds).toEqual(['b', 'a', 'c']);
    expect(orderMap.get('b')).toBe(1);
    expect(orderMap.get('a')).toBe(2);
    expect(orderMap.get('c')).toBe(3);
  });
  it('renders tokens to numeric markers; unknown → [?]', () => {
    const { orderMap } = collectCitationOrder(['x [[cite:a]] y']);
    expect(renderInlineMarkers('x [[cite:a]] y', orderMap, 'vancouver')).toBe('x [1] y');
    expect(renderInlineMarkers('z [[cite:zz]]', orderMap, 'vancouver')).toBe('z [?]');
  });
  it('orders references by appearance then appends uncited', () => {
    const draft = normalizeDraft(makeManuscriptDraft());
    draft.sections.results.content = `A ${citationToken('s2')} then B ${citationToken('s1')}`;
    const refs = [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }, { id: 's3', title: 'Three' }];
    const ordered = orderReferencesForManuscript(draft, refs);
    expect(ordered.map((r) => r.id)).toEqual(['s2', 's1', 's3']);
  });
  it('leaves order unchanged when no inline citations', () => {
    const draft = normalizeDraft(makeManuscriptDraft());
    const refs = [{ id: 'a' }, { id: 'b' }];
    expect(orderReferencesForManuscript(draft, refs).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('BibTeX/RIS robustness', () => {
  it('escapes LaTeX specials in BibTeX', () => {
    const bib = toBibTeX([{ id: 'r', authors: 'Smith J', title: 'A & B in 50% of #1 cases', journal: 'J', year: '2020' }]);
    expect(bib).toMatch(/\\&/);
    expect(bib).toMatch(/\\%/);
    expect(bib).toMatch(/\\#/);
  });
  it('handles double-hyphen page ranges in RIS', () => {
    const ris = toRIS([{ id: 'r', authors: 'Smith J', title: 'T', year: '2020', pages: '100--110' }]);
    expect(ris).toMatch(/SP {2}- 100/);
    expect(ris).toMatch(/EP {2}- 110/);
  });
});

describe('dedupe merge keeps the more complete record', () => {
  it('backfills a missing title from the duplicate', () => {
    const out = dedupeReferences([
      { id: '1', doi: '10.1/x', title: '', journal: 'J' },
      { id: '2', doi: '10.1/x', title: 'Real title', year: '2021' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Real title');
    expect(out[0].year).toBe('2021');
  });
});

describe('PRISMA identified provenance', () => {
  it('does not mark identified "missing" when only registers are entered', () => {
    const r = computePrismaCounts({ prisma: { reg: '40' }, studies: [] });
    expect(r.counts.identified).toBe(40);
    expect(r.provenance.identified).not.toBe('missing');
    expect((r.warnings || []).join(' ')).not.toMatch(/identified/);
  });
});

describe('DIAG back-transform', () => {
  it('back-transforms a diagnostic odds ratio (lnDOR → DOR)', () => {
    const project = {
      studies: [
        { id: 'a', esType: 'DIAG', outcome: 'Dx', es: '1.6', lo: '1.2', hi: '2.0' },
        { id: 'b', esType: 'DIAG', outcome: 'Dx', es: '1.4', lo: '1.0', hi: '1.8' },
      ],
    };
    const t = buildSummaryOfFindingsTable(project);
    expect(t.rows[0].measure).toMatch(/diagnostic odds ratio/i);
    // pooled lnDOR ~1.5 → DOR ~4.5 (definitely > 2, proving exp() applied)
    expect(parseFloat(t.rows[0].estimate)).toBeGreaterThan(2.5);
  });
});

describe('template-driven abstracts', () => {
  const project = { name: 'P', pico: { question: 'Q', O: 'MACE' }, search: { dbs: { PubMed: true }, date: '2026-01-01' }, prisma: { dbs: '10', dedupe: '2', excTA: '3', excFull: '1' }, studies: [] };
  it('JAMA abstract uses JAMA headings', () => {
    const a = generateAbstract(project, { templateId: 'jama' });
    expect(a).toMatch(/Importance/);
    expect(a).toMatch(/Conclusions and Relevance/);
  });
  it('Lancet abstract uses Findings/Interpretation/Funding', () => {
    const a = generateAbstract(project, { templateId: 'lancet' });
    expect(a).toMatch(/\*\*Findings\.\*\*/);
    expect(a).toMatch(/\*\*Interpretation\.\*\*/);
    expect(a).toMatch(/\*\*Funding\.\*\*/);
  });
  it('generic abstract uses Background/Methods/Results/Conclusions', () => {
    const a = generateAbstract(project, { templateId: 'generic' });
    expect(a).toMatch(/\*\*Background\.\*\*/);
    expect(a).toMatch(/\*\*Conclusions\.\*\*/);
    expect(a).not.toMatch(/Importance/);
  });
});

describe('referencesFromProject includes non-pooled studies', () => {
  it('lists a titled study with no effect size', () => {
    const refs = referencesFromProject({ studies: [{ id: 's1', title: 'Qualitative only', authors: 'Lee K', year: '2019' }] });
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBe('Qualitative only');
  });
});
