/**
 * 85.md B2 — SSR contract tests (house style: renderToStaticMarkup, no jsdom)
 * for the pre-export validation review + the asset-driven Tables/Figures panels
 * + asset-chip numbering in the editor, plus two pure invariants:
 *   - a freshly GENERATED (assetRefs) draft on a well-populated project
 *     validates CLEAN → the one-click export path stays one-click;
 *   - robMatrixFromAssessments maps the manuscript RoB shape to the
 *     traffic-light matrix.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ExportValidationDialog, TablesPanel, FiguresPanel, EditorPanel, assetNumberLabel,
} from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { RichSectionEditor } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { generateDraft } from '../../../src/research-engine/manuscript/draft.js';
import {
  computeManuscriptAssets, resolveNumbering, computePlacements, validateExport,
  buildStudyCharacteristicsTable, buildSummaryOfFindingsTable, buildPrismaCountsTable,
  buildRobTable, buildSearchStrategyTable, computePrismaCounts,
} from '../../../src/research-engine/manuscript/index.js';
import { robMatrixFromAssessments } from '../../../src/features/manuscript/export/figures.js';

const noop = () => {};

function fixtureProject() {
  return {
    id: 'p1', name: 'Statins',
    pico: { question: 'Q', P: 'Adults', I: 'Statins', C: 'Placebo', O: 'MACE' },
    search: { dbs: { PubMed: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180', included: '', quant: '' },
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', rob: { D1: 'Low', D2: 'Low' } },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05' },
    ],
  };
}

/* ── ExportValidationDialog ── */
describe('ExportValidationDialog — errors block, warnings offer Export anyway', () => {
  const review = (validation) => ({ validation, fetchedAt: '2026-07-14T10:00:00.000Z' });

  it('warnings-only: Export anyway + Fix first, with action hints and fetchedAt', () => {
    const html = renderToStaticMarkup(
      <ExportValidationDialog
        review={review({ errors: [], warnings: [{ code: 'x', message: 'Figure never referenced.', action: 'Insert a reference.' }], info: [] })}
        onExportAnyway={noop} onClose={noop} exporting={null} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-export-validation"');
    expect(html).toContain('data-testid="stitch-manuscript-export-anyway"');
    expect(html).toContain('data-testid="stitch-manuscript-export-fix-first"');
    expect(html).toContain('Figure never referenced.');
    expect(html).toContain('Insert a reference.');
    expect(html).toContain('data-testid="stitch-manuscript-export-fetchedat"');
    expect(html).toContain('Check before you export');
  });

  it('errors: blocked — NO Export anyway', () => {
    const html = renderToStaticMarkup(
      <ExportValidationDialog
        review={review({ errors: [{ code: 'unknown-asset-ref', message: 'Unknown ref.', action: 'Fix it.' }], warnings: [], info: [] })}
        onExportAnyway={noop} onClose={noop} exporting={null} />,
    );
    expect(html).toContain('Export blocked');
    expect(html).not.toContain('data-testid="stitch-manuscript-export-anyway"');
    expect(html).toContain('Unknown ref.');
    expect(html).toContain('Fix it.');
  });

  it('renders nothing without a review', () => {
    expect(renderToStaticMarkup(<ExportValidationDialog review={null} onExportAnyway={noop} onClose={noop} />)).toBe('');
  });
});

/* ── Assets panels ── */
function assetsMockM(overrides = {}) {
  const project = fixtureProject();
  const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  draft.sections.results.content = 'See [[table:study]].';
  const prismaCounts = computePrismaCounts(project, {});
  const tables = {
    study: buildStudyCharacteristicsTable(project, {}),
    sof: buildSummaryOfFindingsTable(project, {}),
    prisma: buildPrismaCountsTable(prismaCounts),
    rob: buildRobTable(project, {}),
    search: buildSearchStrategyTable(project, {}),
  };
  const assets = computeManuscriptAssets(project, draft, { tables, prismaCounts });
  const assetNumbering = resolveNumbering({ sections: draft, assets });
  return {
    activeDraft: draft, activeId: draft.id, drafts: [draft],
    tables, prismaCounts, staleness: {}, assets, assetNumbering,
    primary: null, references: [], insights: [], readiness: null,
    outdated: {}, consistency: [], dataStatus: {},
    saveState: 'saved', lastError: null, retry: noop,
    sourcesSettled: true, draftUsesTokens: true,
    setMeta: noop, setMetaDebounced: noop, setStatement: noop, updateSection: noop,
    setAssetOverride: noop, insertAssetReference: () => true,
    generate: () => ({ skipped: [], skippedLocked: [] }),
    refreshBlock: noop, refreshAllBlocks: noop, flush: noop,
    ...overrides,
  };
}

describe('TablesPanel — asset rows with live numbers, include toggle, insert reference', () => {
  const m = assetsMockM();
  const html = renderToStaticMarkup(<TablesPanel m={m} />);

  it('renders one asset row per table with controls + testids', () => {
    expect(html).toContain('data-testid="stitch-manuscript-assets-tables"');
    for (const id of ['table-study', 'table-sof', 'table-prisma', 'table-rob', 'table-search']) {
      expect(html).toContain(`data-testid="stitch-manuscript-asset-${id}"`);
      expect(html).toContain(`data-testid="stitch-manuscript-asset-include-${id}"`);
      expect(html).toContain(`data-testid="stitch-manuscript-asset-insert-${id}"`);
      expect(html).toContain(`data-testid="stitch-manuscript-asset-title-${id}"`);
    }
    expect(html).toContain('data-testid="stitch-manuscript-refresh-all"');
  });

  it('shows the resolved number for the referenced table and honest availability', () => {
    expect(html).toContain('Table 1'); // table:study — first (only) body mention
    expect(html).toContain('Referenced in text');
    expect(html).toContain('Available');
  });

  it('pre-settle shows "Table …" instead of flickering numbers', () => {
    const pending = renderToStaticMarkup(<TablesPanel m={assetsMockM({ sourcesSettled: false })} />);
    expect(pending).toContain('Table …');
  });
});

describe('FiguresPanel — asset rows incl. rob/funnel with caption + legend editors', () => {
  const m = assetsMockM();
  const html = renderToStaticMarkup(<FiguresPanel m={m} />);

  it('renders every figure asset row (prisma, primary forest, rob, funnel)', () => {
    // review-round #13: forest/funnel rows are pair-keyed (fixture primary = MACE)
    for (const id of ['figure-prisma', 'figure-forest-mace', 'figure-rob', 'figure-funnel-mace']) {
      expect(html).toContain(`data-testid="stitch-manuscript-asset-${id}"`);
    }
    expect(html).toContain('data-testid="stitch-manuscript-assets-figures"');
    // legend editor exists for figures
    expect(html).toContain('Optional legend under the figure');
    // honest availability: no structured RoB assessments → the traffic light has no data
    expect(html).toContain('No data');
  });
});

/* ── Editor: asset chips + insert-reference tool ── */
describe('RichSectionEditor — asset chips carry live numbers', () => {
  it('renders [[table:study]] as an atomic chip with its number', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="See [[table:study]] here." orderMap={new Map()}
        assetNumbers={{ 'table:study': 2 }} onChange={noop} />,
    );
    expect(html).toContain('ms-asset');
    expect(html).toContain('data-asset="table:study"');
    expect(html).toContain('Table 2');
    expect(html).not.toContain('[[table:');
  });

  it('pre-settle lookup renders "Table …"', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="See [[table:study]]." orderMap={new Map()}
        assetNumbers={{ get: () => '…' }} onChange={noop} />,
    );
    expect(html).toContain('Table …');
  });
});

describe('EditorPanel — insert-reference tool lists available assets', () => {
  it('renders the asset picker with numbered labels', () => {
    const m = assetsMockM();
    const html = renderToStaticMarkup(<EditorPanel m={m} exporters={{
      onExportWord: noop, onExportRepro: noop, onPrismaChecklist: noop, onPrismaSChecklist: noop, exporting: null, exportError: '',
    }} />);
    expect(html).toContain('data-testid="stitch-manuscript-tools-insert-asset"');
    expect(html).toContain('Reference a table/figure');
  });
});

describe('assetNumberLabel', () => {
  it('numbers, not-in-export and pre-settle states', () => {
    const m = { sourcesSettled: true, assetNumbering: { byId: { 'table:study': 3 } } };
    expect(assetNumberLabel(m, { id: 'table:study', kind: 'table' })).toBe('Table 3');
    expect(assetNumberLabel(m, { id: 'figure:rob', kind: 'figure' })).toBe('Not in export');
    expect(assetNumberLabel({ sourcesSettled: false }, { id: 'x', kind: 'figure' })).toBe('Figure …');
  });
});

/* ── One-click invariant: a generated (assetRefs) draft validates CLEAN ── */
describe('clean-path invariant — generated token draft has no errors/warnings', () => {
  it('generateDraft(assetRefs) on a populated project → validateExport is clean', () => {
    const project = fixtureProject();
    const draft = normalizeDraft(makeManuscriptDraft({ title: project.name }));
    const gen = generateDraft(project, { assetRefs: true });
    for (const k of Object.keys(gen)) {
      if (draft.sections[k]) { draft.sections[k].content = gen[k]; draft.sections[k].aiGenerated = true; }
    }
    const assets = computeManuscriptAssets(project, draft, {});
    const numbering = resolveNumbering({ sections: draft, assets });
    const placements = computePlacements({ sections: draft, numbering, assets });
    const v = validateExport({
      project, draft, assets, numbering, placements,
      saveState: 'saved', sourcesSettled: true,
      freshness: { status: 'synced', label: 'Fully synchronized' }, dataStatus: {},
    });
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });
});

/* ── robMatrixFromAssessments (pure) ── */
describe('robMatrixFromAssessments', () => {
  it('maps display labels to judgment keys, labels rows by author/year, keeps study order', () => {
    const studies = [
      { id: 's1', title: 'Trial A', authors: 'Smith J, Doe A', year: '2020' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021' },
    ];
    const assessments = {
      s2: { domains: { D1: 'Some concerns', D2: 'High' }, overall: 'High', tool: 'rob2' },
      s1: { domains: { D1: 'Low' }, overall: 'Low' },
    };
    const mx = robMatrixFromAssessments(assessments, studies);
    expect(mx.rows.map((r) => r.label)).toEqual(['Smith J 2020', 'Lee K 2021']);
    expect(mx.domains.map((d) => d.id)).toEqual(['D1', 'D2']);
    expect(mx.rows[0].overall).toBe('low');
    expect(mx.rows[1].cells).toEqual([
      { domainId: 'D1', judgment: 'some' },
      { domainId: 'D2', judgment: 'high' },
    ]);
    expect(mx.rows[0].cells[1]).toEqual({ domainId: 'D2', judgment: 'na' }); // unassessed domain
    expect(mx.instrumentId).toBe('rob2');
  });

  it('null for an empty map', () => {
    expect(robMatrixFromAssessments({}, [])).toBe(null);
    expect(robMatrixFromAssessments(null, [])).toBe(null);
  });
});
