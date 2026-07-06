import { describe, it, expect } from 'vitest';
import {
  buildArticleSummary, filterSortArticles, articleListStats, ARTICLE_SORTS,
} from '../../../../src/research-engine/extraction/engine/articleList.js';
import { mkStudy } from '../../../../src/research-engine/project-model/defaults.js';

function study(over = {}) { return { ...mkStudy(), ...over }; }

describe('articleList.buildArticleSummary', () => {
  it('derives status/progress/sync/validation from a study', () => {
    const s = study({ id: 's1', author: 'Smith', year: '2020', outcome: 'Mortality', timepoint: '12w', esType: 'OR', es: '0.1', lo: '-0.2', hi: '0.4', a: '5', b: '95', c: '10', d: '90' });
    const sum = buildArticleSummary(s, { pdfAvailable: true, tablesDetected: 2 });
    expect(sum.id).toBe('s1');
    expect(sum.status).toBe('in_progress');
    expect(sum.progressPct).toBe(100);
    expect(sum.syncStatus).toBe('ready');
    expect(sum.pdfAvailable).toBe(true);
    expect(sum.tablesDetected).toBe(2);
  });
  it('surfaces validation errors in the summary', () => {
    const s = study({ id: 's2', esType: 'PROP', events: '50', total: '10' });
    const sum = buildArticleSummary(s);
    expect(sum.status).toBe('validation_required');
    expect(sum.validationErrors).toBeGreaterThanOrEqual(1);
  });
});

describe('articleList.filterSortArticles', () => {
  const summaries = [
    buildArticleSummary(study({ id: 'a', author: 'Alpha', year: '2019', outcome: 'Death', es: '0.5', updatedAt: '2026-01-03' })),
    buildArticleSummary(study({ id: 'b', author: 'Beta', year: '2021', outcome: 'Relapse', updatedAt: '2026-01-05' }), { pdfAvailable: true }),
    buildArticleSummary(study({ id: 'c', author: 'Gamma', year: '2020', esType: 'PROP', events: '9', total: '3', updatedAt: '2026-01-01' })),
  ];

  it('search matches author/outcome/year', () => {
    expect(filterSortArticles(summaries, { search: 'beta' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSortArticles(summaries, { search: 'death' }).map((s) => s.id)).toEqual(['a']);
  });
  it('filters by PDF availability', () => {
    expect(filterSortArticles(summaries, { pdf: 'yes' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSortArticles(summaries, { pdf: 'no' }).map((s) => s.id).sort()).toEqual(['a', 'c']);
  });
  it('filters by validation issues', () => {
    expect(filterSortArticles(summaries, { issues: 'errors' }).map((s) => s.id)).toEqual(['c']);
  });
  it('sorts recent by lastEditedAt desc', () => {
    expect(filterSortArticles(summaries, { sort: 'recent' }).map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });
  it('sorts by author A→Z', () => {
    expect(filterSortArticles(summaries, { sort: 'author' }).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
  it('does not mutate the input array', () => {
    const before = summaries.map((s) => s.id);
    filterSortArticles(summaries, { sort: 'author' });
    expect(summaries.map((s) => s.id)).toEqual(before);
  });
  it('exposes a sort catalogue', () => {
    expect(ARTICLE_SORTS.map((s) => s.key)).toContain('recent');
  });
});

describe('articleList.articleListStats', () => {
  it('counts statuses and averages progress', () => {
    const summaries = [
      buildArticleSummary(study({ id: 'a', outcome: 'X', es: '0.5', esType: 'GENERIC', lo: '0.1', hi: '0.9' })),
      buildArticleSummary(study({ id: 'b' })),
      buildArticleSummary(study({ id: 'c', esType: 'PROP', events: '9', total: '3' })),
    ];
    const stats = articleListStats(summaries);
    expect(stats.total).toBe(3);
    expect(stats.notStarted).toBe(1);
    expect(stats.needsValidation).toBe(1);
    expect(stats.avgProgress).toBeGreaterThanOrEqual(0);
  });
});
