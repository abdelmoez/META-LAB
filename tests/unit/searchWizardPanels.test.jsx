/**
 * searchWizardPanels.test.jsx — 69.md. The three Search-wizard reproducibility/quality
 * panels (SearchQualityPanel, SearchVersionsPanel, SearchExportPanel).
 *
 * SSR-safe, mirroring the house pattern (fullTextPanel / pecanSearchTab): the top-level
 * panels load in effects that never run under renderToStaticMarkup, so we test the pure
 * leaves from props + the pure models, and stub `fetch` (vi.stubGlobal / unstubAllGlobals)
 * for the soft API helpers. Quality-row expectations are built against the REAL
 * searchQualityCheck so the panel's breakdown can't silently drift from the engine.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QualityRows } from '../../src/features/searchWizard/SearchQualityPanel.jsx';
import { VersionList, DiffView } from '../../src/features/searchWizard/SearchVersionsPanel.jsx';
import { MethodsModal } from '../../src/features/searchWizard/SearchExportPanel.jsx';
import { buildQualityModel } from '../../src/features/searchWizard/searchQualityModel.js';
import { formatVersionDiff } from '../../src/features/searchWizard/versionDiff.js';
import { buildReproLog, reproLogToJson, reproLogFilename } from '../../src/features/searchWizard/reproLog.js';
import { searchVersionsApi } from '../../src/features/searchWizard/searchVersionsApi.js';
import { searchQualityCheck } from '../../src/features/searchBuilder/index.js';

afterEach(() => { vi.unstubAllGlobals(); });

/* A fixture strategy: solid Population + Intervention, one thin (single-term) concept, a
   selected database set, and no controlled vocabulary — so the model exercises several
   dimensions. */
const STRATEGY = {
  concepts: [
    { id: 'p', label: 'Population', picoField: 'P', terms: [{ text: 'type 2 diabetes' }, { text: 'T2DM' }] },
    { id: 'i', label: 'Intervention', picoField: 'I', terms: [{ text: 'metformin' }] },
  ],
  filters: { dateFrom: '2015', dateTo: '', languages: ['eng'], pubTypes: [] },
  databases: ['pubmed', 'embase'],
  overrides: { pubmed: 'metformin[tiab]' },
};

describe('buildQualityModel — composes the real engine, omits empty dimensions', () => {
  it('emits transparent rows (concept/synonym/vocab/database/structure), not a vanity number', () => {
    const { rows } = buildQualityModel(STRATEGY, { versions: [], available: true });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('concept-coverage');
    expect(ids).toContain('synonym-coverage');
    expect(ids).toContain('controlled-vocab');
    expect(ids).toContain('database-readiness');
    expect(ids).toContain('structure-warnings');
    // Reproducibility rows are present because the versions backend answered.
    expect(ids).toContain('repro-saved');
    expect(ids).toContain('repro-final');
    // No fabricated sensitivity row without a real hit count.
    expect(ids).not.toContain('sensitivity');
    // Every row carries a checkable status + label (no bare score).
    for (const r of rows) {
      expect(['ok', 'warn', 'info']).toContain(r.status);
      expect(typeof r.label).toBe('string');
    }
  });

  it('flags the single-term concept for synonym coverage and P+I coverage as ok', () => {
    const { rows } = buildQualityModel(STRATEGY, { available: true, versions: [] });
    const concept = rows.find((r) => r.id === 'concept-coverage');
    expect(concept.status).toBe('ok'); // P and I both have terms
    const syn = rows.find((r) => r.id === 'synonym-coverage');
    expect(syn.status).toBe('info'); // Intervention has a single term
    expect(syn.suggestion).toContain('Intervention');
  });

  it('surfaces a sensitivity row ONLY when a real hit count is supplied', () => {
    const { rows } = buildQualityModel(STRATEGY, { available: true, versions: [], hitCount: 800 });
    const sens = rows.find((r) => r.id === 'sensitivity');
    expect(sens).toBeTruthy();
    expect(sens.label).toContain('Balanced');
  });

  it('stays consistent with the real searchQualityCheck structural warnings', () => {
    // A strategy with an EMPTY Population concept → the engine emits an empty:P warning,
    // which the model must reflect as a warn-status structure row.
    const emptyPop = {
      concepts: [
        { id: 'p', label: 'Population', picoField: 'P', terms: [] },
        { id: 'i', label: 'Intervention', picoField: 'I', terms: [{ text: 'metformin' }] },
      ],
      databases: ['pubmed'],
    };
    const engineWarnings = searchQualityCheck(emptyPop.concepts).filter((w) => w.severity === 'warning' || w.severity === 'critical');
    expect(engineWarnings.length).toBeGreaterThan(0);
    const { rows } = buildQualityModel(emptyPop, { available: true, versions: [] });
    const struct = rows.find((r) => r.id === 'structure-warnings');
    expect(struct.status).toBe('warn');
    expect(struct.label).toContain('warning');
  });
});

describe('QualityRows leaf', () => {
  it('renders a row per dimension with its label, detail and suggestion', () => {
    const { rows } = buildQualityModel(STRATEGY, { available: true, versions: [] });
    const html = renderToStaticMarkup(h(QualityRows, { rows }));
    expect(html).toContain('Concept coverage');
    expect(html).toContain('Synonym coverage');
    expect(html).toContain('Database readiness');
    // A suggestion arrow appears for at least one row (single-term concept).
    expect(html).toContain('→');
  });

  it('renders an empty hint when there are no rows', () => {
    const html = renderToStaticMarkup(h(QualityRows, { rows: [] }));
    expect(html).toContain('quality breakdown');
  });
});

describe('VersionList leaf', () => {
  const versions = [
    { id: 'v2', version: 2, name: 'After peer feedback', isFinal: true, note: 'added synonyms', createdByName: 'Sara', createdAt: '2026-06-01T10:00:00Z' },
    { id: 'v1', version: 1, name: 'First draft', isFinal: false, note: '', createdByName: 'Sara', createdAt: '2026-05-20T09:00:00Z' },
  ];

  it('lists versions with name, vN, author and a final badge', () => {
    const html = renderToStaticMarkup(h(VersionList, { versions, readOnly: false }));
    expect(html).toContain('After peer feedback');
    expect(html).toContain('First draft');
    expect(html).toContain('v2');
    expect(html).toContain('Sara');
    expect(html).toContain('FINAL');
    // Write actions present for writers.
    expect(html).toContain('Restore');
    expect(html).toContain('Mark final'); // v1 is not final → the button shows
  });

  it('hides write actions for read-only users', () => {
    const html = renderToStaticMarkup(h(VersionList, { versions, readOnly: true }));
    expect(html).toContain('After peer feedback');
    expect(html).not.toContain('Restore');
    expect(html).not.toContain('Mark final');
  });

  it('renders an empty note when there are no versions', () => {
    const html = renderToStaticMarkup(h(VersionList, { versions: [], readOnly: false }));
    expect(html).toContain('No saved versions');
  });
});

describe('formatVersionDiff + DiffView', () => {
  it('groups added/removed concepts, terms, databases and filters into readable lists', () => {
    const diff = {
      concepts: { added: ['Comparator'], removed: [] },
      terms: { added: [{ text: 'glucophage' }], removed: ['placebo'] },
      databases: { added: ['cochrane'], removed: ['embase'] },
      filters: { changed: ['date 2015→2018'] },
    };
    const groups = formatVersionDiff(diff);
    const titles = groups.map((g) => g.title);
    expect(titles).toEqual(['Concepts', 'Terms', 'Databases', 'Filters & limits']);
    const html = renderToStaticMarkup(h(DiffView, { diff }));
    expect(html).toContain('Comparator');
    expect(html).toContain('glucophage');
    expect(html).toContain('cochrane');
    expect(html).toContain('date 2015');
    // Directional markers.
    expect(html).toContain('+');
    expect(html).toContain('−');
  });

  it('is defensive: null diff → no groups, and DiffView shows a quiet note', () => {
    expect(formatVersionDiff(null)).toEqual([]);
    const html = renderToStaticMarkup(h(DiffView, { diff: null }));
    expect(html).toContain('unavailable');
  });

  it('falls back to a flat Changes group when there is no sub-structure', () => {
    const groups = formatVersionDiff({ added: ['x'], removed: ['y'] });
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Changes');
  });
});

describe('buildReproLog (pure) + MethodsModal leaf', () => {
  it('assembles a self-describing log from strategy + versions + runs', () => {
    const versions = [{ id: 'v1', version: 1, name: 'Final', isFinal: true, createdByName: 'Sara', createdAt: '2026-06-01' }];
    const runs = { runs: [{ id: 'r1', name: 'run 1', state: 'completed', createdAt: '2026-06-02', providerCounts: { pubmed: 120 }, total: 120 }] };
    const log = buildReproLog({ projectId: 'p1', strategy: STRATEGY, versions, runs });
    expect(log.schema).toContain('search-log');
    expect(log.strategy.concepts).toHaveLength(2);
    expect(log.strategy.concepts[0].terms).toContain('type 2 diabetes');
    expect(log.strategy.databases).toEqual(['pubmed', 'embase']);
    expect(log.versions).toHaveLength(1);
    expect(log.finalVersion.id).toBe('v1');
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].providerCounts).toEqual({ pubmed: 120 });
    // Serializes cleanly and the filename is safe.
    expect(() => JSON.parse(reproLogToJson({ projectId: 'p1', strategy: STRATEGY, versions }))).not.toThrow();
    expect(reproLogFilename('p 1/x')).toMatch(/^search-log-p-1-x-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('omits the runs section when Search & Discovery never ran', () => {
    const log = buildReproLog({ projectId: 'p1', strategy: STRATEGY, versions: [] });
    expect(log.runs).toBeUndefined();
  });

  it('MethodsModal renders the text + a Copy button, or a quiet hint when unavailable', () => {
    const ready = renderToStaticMarkup(h(MethodsModal, { text: 'We searched PubMed and Embase…', status: 'ready', copied: false }));
    expect(ready).toContain('We searched PubMed and Embase');
    expect(ready).toContain('Copy');
    const off = renderToStaticMarkup(h(MethodsModal, { text: '', status: 'unavailable' }));
    expect(off).toContain('Search Builder Engine');
    expect(off).toContain('Ops');
  });
});

describe('searchVersionsApi — soft reads (fetch stubbed)', () => {
  it('list() returns a quiet unavailable shape on a 404 (flag off) instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })));
    const out = await searchVersionsApi.list('p1');
    expect(out.available).toBe(false);
    expect(out.versions).toEqual([]);
  });

  it('list() parses the version list when the backend answers', async () => {
    const payload = { versions: [{ id: 'v1', version: 1, name: 'A', isFinal: false }], currentMatchesVersion: 1 };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) })));
    const out = await searchVersionsApi.list('p1');
    expect(out.available).toBe(true);
    expect(out.versions).toHaveLength(1);
    expect(out.currentMatchesVersion).toBe(1);
  });

  it('methodsText() degrades to unavailable on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })));
    const out = await searchVersionsApi.methodsText('p1');
    expect(out.available).toBe(false);
    expect(out.text).toBe('');
    expect(out.status).toBe(404);
  });

  it('methodsText() returns the paragraph when available', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ text: 'We searched…' })) })));
    const out = await searchVersionsApi.methodsText('p1');
    expect(out.available).toBe(true);
    expect(out.text).toBe('We searched…');
  });

  it('save() THROWS on failure (a real user action, not a soft read)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') })));
    await expect(searchVersionsApi.save('p1', { name: 'x' })).rejects.toThrow();
  });
});
