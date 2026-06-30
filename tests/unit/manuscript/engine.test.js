/**
 * Unit tests for the pure manuscript engine (64.md / P3).
 * Covers: model, sourceHash, prismaCounts, citations, tables, draft, checklist, readiness.
 */
import { describe, it, expect } from 'vitest';
import {
  makeManuscriptDraft, normalizeDraft, readManuscripts, migrateLegacyManuscript, sectionStatus,
  SECTION_IDS, JOURNAL_TEMPLATE_IDS,
} from '../../../src/research-engine/manuscript/model.js';
import { hashOf, computeBlockHashes, evaluateStaleness } from '../../../src/research-engine/manuscript/sourceHash.js';
import { computePrismaCounts, countsToPrismaShape } from '../../../src/research-engine/manuscript/prismaCounts.js';
import {
  splitAuthors, formatCitation, generateReferenceList, dedupeReferences,
  toBibTeX, toRIS, referencesFromProject, auditReferences,
} from '../../../src/research-engine/manuscript/citations.js';
import {
  buildStudyCharacteristicsTable, buildSummaryOfFindingsTable, buildPrismaCountsTable,
  buildRobTable, buildSearchStrategyTable,
} from '../../../src/research-engine/manuscript/tables.js';
import { generateDraft, primaryAnalysis } from '../../../src/research-engine/manuscript/draft.js';
import {
  buildPrismaChecklist, prismaChecklistToCSV, buildPrismaSChecklist,
} from '../../../src/research-engine/manuscript/prismaChecklist.js';
import { computeReadiness, smartInsights } from '../../../src/research-engine/manuscript/readiness.js';

function fixtureProject() {
  return {
    id: 'p1',
    name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events in primary prevention?', P: 'Adults without CVD', I: 'Statins', C: 'Placebo', O: 'Major adverse cardiac events', studyDesign: 'RCT', prosperoId: 'CRD42024000001', incl: 'RCTs in adults' },
    search: { dbs: { PubMed: true, Embase: true, 'Cochrane CENTRAL': true }, date: '2026-01-15', string: '(statin*) AND (cardiovascular)', notes: 'English only' },
    prisma: { dbs: '1200', reg: '50', other: '0', dedupe: '250', screened: '', excTA: '800', excFull: '180', reasons: [{ id: 'r1', r: 'Wrong population', n: '100' }, { id: 'r2', r: 'No outcome', n: '80' }], included: '', qual: '', quant: '' },
    robMethod: 'RoB2',
    grade: { rob: 'not_serious' },
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J, Doe A', author: 'Smith J', year: '2020', journal: 'Lancet', doi: '10.1/a', pmid: '111', country: 'USA', design: 'RCT', populationDef: 'Adults', interventionDef: 'Statin', comparatorDef: 'Placebo', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500', rob: { D1: 'Low', D2: 'Low', D3: 'Low', D4: 'Low', D5: 'Low' } },
      { id: 's2', title: 'Trial B', authors: 'Lee K; Park S; Kim H', year: '2021', journal: 'NEJM', doi: '10.1/b', pmid: '222', country: 'Korea', design: 'RCT', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300', rob: { D1: 'Low', D2: 'Some concerns', D3: 'Low', D4: 'Low', D5: 'Low' } },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', journal: 'JAMA', doi: '10.1/c', country: 'UK', design: 'RCT', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
    ],
  };
}

describe('manuscript/model', () => {
  it('makes a normalized draft with all sections', () => {
    const d = makeManuscriptDraft({ title: 'X' });
    expect(d.title).toBe('X');
    expect(JOURNAL_TEMPLATE_IDS).toContain(d.templateId);
    for (const id of SECTION_IDS) expect(d.sections[id]).toBeTruthy();
  });
  it('normalizeDraft fills missing keys and clamps invalids', () => {
    const d = normalizeDraft({ templateId: 'nope', status: 'weird', sections: { methods: { content: 'hi' } } });
    expect(d.templateId).toBe('generic');
    expect(d.status).toBe('draft');
    expect(d.sections.methods.content).toBe('hi');
    expect(d.sections.results.content).toBe('');
  });
  it('readManuscripts returns [] when none', () => {
    expect(readManuscripts({})).toEqual([]);
    expect(readManuscripts({ manuscripts: [{ id: 'a' }] }).length).toBe(1);
  });
  it('migrates legacy manuscript text as user-edited content', () => {
    const proj = { name: 'P', manuscript: { drafts: { methods: 'legacy methods', results: '' } } };
    const d = migrateLegacyManuscript(proj);
    expect(d.sections.methods.content).toBe('legacy methods');
    expect(d.sections.methods.userEdited).toBe(true);
    expect(d.sections.results.content).toBe('');
  });
  it('sectionStatus classifies', () => {
    expect(sectionStatus({ content: '' })).toBe('empty');
    expect(sectionStatus({ content: 'x', aiGenerated: true, userEdited: false })).toBe('ai-draft');
    expect(sectionStatus({ content: 'x', userEdited: true })).toBe('edited');
  });
});

describe('manuscript/sourceHash', () => {
  it('hash is stable across key order', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
  });
  it('detects staleness when studies change', () => {
    const proj = fixtureProject();
    const draft = makeManuscriptDraft();
    const live = computeBlockHashes(proj);
    draft.dataBlocks.study_characteristics_table.sourceHash = live.study_characteristics_table;
    draft.dataBlocks.study_characteristics_table.lastRefreshedAt = '2026-01-01';
    let staleMap = evaluateStaleness(draft, proj);
    expect(staleMap.study_characteristics_table.stale).toBe(false);
    proj.studies[0].year = '1999';
    staleMap = evaluateStaleness(draft, proj);
    expect(staleMap.study_characteristics_table.stale).toBe(true);
  });
});

describe('manuscript/prismaCounts', () => {
  it('derives flow numbers like the diagram', () => {
    const r = computePrismaCounts(fixtureProject());
    expect(r.counts.identified).toBe(1250); // 1200+50+0
    expect(r.counts.duplicatesRemoved).toBe(250);
    expect(r.counts.screened).toBe(1000); // 1250-250
    expect(r.counts.reportsAssessed).toBe(200); // 1000-800
    expect(r.counts.included).toBe(20); // 200-180
    expect(r.provenance.included).toBe('derived');
  });
  it('honors overrides with provenance', () => {
    const r = computePrismaCounts(fixtureProject(), { overrides: { included: 25 } });
    expect(r.counts.included).toBe(25);
    expect(r.provenance.included).toBe('override');
  });
  it('warns on inconsistent exclusion reasons', () => {
    const proj = fixtureProject();
    proj.prisma.excFull = '200'; // reasons sum to 180
    const r = computePrismaCounts(proj);
    expect(r.warnings.join(' ')).toMatch(/exclusion reasons/i);
  });
  it('countsToPrismaShape round-trips for the SVG builder', () => {
    const r = computePrismaCounts(fixtureProject());
    const shape = countsToPrismaShape(r);
    expect(shape.dbs).toBe(1200);
    expect(shape.excTA).toBe(800);
    expect(shape.reasons.length).toBe(2);
  });
  it('marks missing counts honestly', () => {
    const r = computePrismaCounts({ prisma: {}, studies: [] });
    expect(r.provenance.identified).toBe('missing');
    expect(r.warnings.join(' ')).toMatch(/incomplete/i);
  });
});

describe('manuscript/citations', () => {
  it('splits author strings by the right separator', () => {
    expect(splitAuthors('Smith J; Doe A')).toEqual(['Smith J', 'Doe A']);
    expect(splitAuthors('Smith J, Doe A')).toEqual(['Smith J', 'Doe A']);
    expect(splitAuthors('Smith, John')).toEqual(['Smith, John']); // ambiguous → kept whole
  });
  it('formats Vancouver and APA', () => {
    const ref = { authors: 'Smith J, Doe A', title: 'A trial', journal: 'Lancet', year: '2020', volume: '12', issue: '3', pages: '100-110', doi: '10.1/x' };
    const v = formatCitation(ref, 'vancouver');
    expect(v).toContain('Smith J, Doe A.');
    expect(v).toContain('Lancet.');
    expect(v).toContain('2020;12(3):100-110.');
    expect(v).toContain('doi:10.1/x');
    const a = formatCitation(ref, 'apa');
    expect(a).toContain('(2020).');
    expect(a).toContain('https://doi.org/10.1/x');
  });
  it('builds and numbers a reference list', () => {
    const refs = referencesFromProject(fixtureProject());
    const list = generateReferenceList(refs, 'vancouver');
    expect(list.length).toBe(3);
    expect(list[0].index).toBe(1);
    expect(list[0].text.length).toBeGreaterThan(5);
  });
  it('deduplicates by DOI', () => {
    const refs = [{ doi: '10.1/x', title: 'A' }, { doi: '10.1/X', title: 'A dup' }, { doi: '10.1/y', title: 'B' }];
    expect(dedupeReferences(refs).length).toBe(2);
  });
  it('exports BibTeX and RIS', () => {
    const refs = referencesFromProject(fixtureProject());
    expect(toBibTeX(refs)).toMatch(/@article\{/);
    expect(toRIS(refs)).toMatch(/TY {2}- JOUR/);
  });
  it('audits missing identifiers', () => {
    const a = auditReferences([{ doi: '10.1/x' }, { title: 'no id' }]);
    expect(a.missingDoiOrPmid).toBe(1);
  });
});

describe('manuscript/tables', () => {
  it('study characteristics adapts columns and lists studies', () => {
    const t = buildStudyCharacteristicsTable(fixtureProject());
    expect(t.available).toBe(true);
    expect(t.rows.length).toBe(3);
    const keys = t.columns.map((c) => c.key);
    expect(keys).toContain('study');
    expect(keys).toContain('country');
  });
  it('summary of findings pools the outcome', () => {
    const t = buildSummaryOfFindingsTable(fixtureProject());
    expect(t.available).toBe(true);
    expect(t.rows[0].nStudies).toBe('3');
    expect(t.rows[0].measure).toMatch(/odds ratio/i);
    expect(t.rows[0].estimate).not.toBe('');
    // OR back-transformed < 1 (protective): es ~ -0.29 lnOR → ~0.75
    expect(parseFloat(t.rows[0].estimate)).toBeLessThan(1);
  });
  it('prisma counts table reflects derived values', () => {
    const r = computePrismaCounts(fixtureProject());
    const t = buildPrismaCountsTable(r);
    const includedRow = t.rows.find((row) => /included in review/i.test(row.stage));
    expect(includedRow.n).toBe('20');
  });
  it('rob table shows assessed studies + overall', () => {
    const t = buildRobTable(fixtureProject());
    expect(t.rows.length).toBe(2); // s1, s2 have rob; s3 does not
    expect(t.rows[0].overall).toBe('Low');
    expect(t.rows[1].overall).toBe('Some concerns');
  });
  it('search strategy lists enabled databases', () => {
    const t = buildSearchStrategyTable(fixtureProject());
    expect(t.rows.length).toBe(3);
    expect(t.rows[0].date).toBe('2026-01-15');
  });
});

describe('manuscript/draft', () => {
  it('generates all narrative sections grounded in data', () => {
    const proj = fixtureProject();
    const d = generateDraft(proj, {});
    for (const id of ['abstract', 'introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion']) {
      expect(typeof d[id]).toBe('string');
      expect(d[id].length).toBeGreaterThan(10);
    }
    expect(d.methods).toMatch(/PubMed/);
    expect(d.results).toMatch(/20 studies|included/);
    // primary analysis reflected
    expect(d.results).toMatch(/pooled odds ratio/i);
  });
  it('emits placeholders, never fabricates, when data missing', () => {
    const empty = { name: '', pico: {}, search: { dbs: {} }, prisma: {}, studies: [] };
    const d = generateDraft(empty, {});
    expect(d.abstract).toMatch(/\[/); // has a bracketed placeholder
    expect(d.results).toMatch(/\[/);
  });
  it('primaryAnalysis picks the outcome with the most studies', () => {
    const p = primaryAnalysis(fixtureProject());
    expect(p.result.k).toBe(3);
  });
});

describe('manuscript/prismaChecklist', () => {
  it('builds PRISMA 2020 checklist with statuses and CSV', () => {
    const items = buildPrismaChecklist(fixtureProject(), makeManuscriptDraft());
    expect(items.length).toBeGreaterThan(10);
    const m2 = items.find((i) => i.id === 'M2');
    expect(m2.status).toBe('reported'); // databases + date present
    const csv = prismaChecklistToCSV(items);
    expect(csv).toMatch(/Item ID,Section/);
  });
  it('builds PRISMA-S checklist prefilled from search', () => {
    const items = buildPrismaSChecklist(fixtureProject());
    const s1 = items.find((i) => i.id === 'S1');
    expect(s1.status).toBe('reported');
    expect(s1.detail).toMatch(/PubMed/);
    const s12 = items.find((i) => i.id === 'S12');
    expect(s12.detail).toBe('2026-01-15');
  });
});

describe('manuscript/readiness', () => {
  it('computes a readiness score', () => {
    const proj = fixtureProject();
    const draft = makeManuscriptDraft();
    const r = computeReadiness(proj, draft);
    expect(r.score.total).toBeGreaterThan(5);
    const prismaItem = r.items.find((i) => i.key === 'prisma');
    expect(prismaItem.complete).toBe(true);
    const analysisItem = r.items.find((i) => i.key === 'analysis');
    expect(analysisItem.complete).toBe(true);
  });
  it('surfaces smart insights', () => {
    const proj = fixtureProject();
    proj.search.date = ''; // trigger search-date warning
    const ins = smartInsights(proj, makeManuscriptDraft(), {});
    const keys = ins.map((i) => i.key);
    expect(keys).toContain('search-date');
    expect(keys).toContain('rob'); // s3 has no rob
  });
});
