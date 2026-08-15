/**
 * 117.md §9/§10/§11/§71 — SSR contracts for the cross-reference surfaces.
 *
 * Repo convention: react-dom/server static markup (no jsdom). These pin the FIRST
 * PAINT and the accessibility contract of the new controls — the picker (search +
 * number + origin), the chip action menu (Go / Edit / Relink / Remove), the hover
 * preview, the delete-with-citations warning, and the "+ Caption" promotion — plus
 * the rule that none of the popovers exist until the researcher asks for them.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RichSectionEditor, RichToolbar, CrossRefPicker, CrossRefList,
  CROSSREF_EMPTY_TEXT,
} from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import {
  EditorPanel, TablesPanel, TableContextBar, AssetRefMenu, AssetRefHoverCard, TableDeleteDialog,
  TABLE_DELETE_UNDO_NOTE,
} from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { tableCaptionLine } from '../../../src/research-engine/manuscript/refTokens.js';

const noop = () => {};
const TBL = ['| Group | N |', '| --- | --- |', '| A | 12 |'].join('\n');

const ITEMS = [
  { id: 'table:study', kind: 'table', origin: 'auto', title: 'Characteristics of included studies', label: 'Table 1' },
  { id: 'table:mine', kind: 'table', origin: 'manual', title: 'Sensitivity analyses', label: 'Table 2' },
  { id: 'figure:prisma', kind: 'figure', origin: 'auto', title: 'PRISMA 2020 flow diagram', label: 'Figure 1' },
];

const pageEl = { getBoundingClientRect: () => ({ top: 40, left: 20, right: 720, width: 700 }) };
const chipRect = { top: 120, bottom: 134, left: 90, right: 150 };

/* ════════════ §9 — the cross-reference picker ════════════ */

describe('117.md §9 — Insert → Cross-reference picker', () => {
  it('lists number, title and ORIGIN for tables and figures alike', () => {
    const html = renderToStaticMarkup(<CrossRefList items={ITEMS} onPick={noop} testIdPrefix="xr" />);
    expect(html).toContain('data-testid="xr-search"');
    expect(html).toContain('aria-label="Search tables and figures"');
    expect(html).toContain('role="listbox"');
    for (const it of ITEMS) expect(html).toContain(`data-testid="xr-item-${it.id.replace(/:/g, '-')}"`);
    expect(html).toContain('Table 1');
    expect(html).toContain('Characteristics of included studies');
    expect(html).toContain('Manual');   // the manual table's origin badge
    expect(html).toContain('Auto');     // a generated object's origin badge
    // figures are referenceable through the SAME control (§70)
    expect(html).toContain('PRISMA 2020 flow diagram');
  });

  it('says so honestly when there is nothing to reference yet', () => {
    const html = renderToStaticMarkup(<CrossRefList items={[]} onPick={noop} testIdPrefix="xr" />);
    expect(html).toContain('data-testid="xr-empty"');
    expect(html).toContain(CROSSREF_EMPTY_TEXT);
  });

  it('the popover form opens only on interaction (first paint is a button)', () => {
    const html = renderToStaticMarkup(<CrossRefPicker items={ITEMS} onPick={noop} testIdPrefix="xr" />);
    expect(html).toContain('data-testid="xr-open"');
    expect(html).toContain('aria-label="Insert cross-reference"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="xr-popover"');
  });

  it('is reachable from the toolbar, next to Insert → Table', () => {
    const html = renderToStaticMarkup(
      <RichToolbar getApi={() => null} citeRefs={[]} refLabel={(r) => r.id} crossRefs={ITEMS} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-tb-table"');
    expect(html).toContain('data-testid="stitch-manuscript-crossref-open"');
    // no bare <select> for assets any more
    expect(html).not.toContain('stitch-manuscript-tools-insert-asset');
  });
});

/* ════════════ §10/§11 — chip surfaces ════════════ */

describe('117.md §10 — the cross-reference chip is interactive and keyboard-reachable', () => {
  it('renders as an atomic button-role island carrying its stable id', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="See [[table:study]] here." orderMap={new Map()}
        assetNumbers={{ 'table:study': 2 }} onChange={noop} />,
    );
    expect(html).toContain('data-asset="table:study"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Cross-reference: Table 2. Activate for cross-reference actions."');
    expect(html).toContain('contenteditable="false"');
    expect(html).not.toContain('[[table:');
  });

  it('renders BROKEN when the id is outside the live registry (§11)', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="See [[table:gone]]." orderMap={new Map()}
        assetNumbers={{}} knownAssetIds={new Set(['table:study'])} onChange={noop} />,
    );
    expect(html).toContain('data-asset-broken="true"');
    expect(html).toContain('Table (deleted)');
    expect(html).toContain('aria-label="Broken cross-reference: Table (deleted).');
  });

  it('renders the manual-table caption as a non-prose block with an editable title', () => {
    const md = `${tableCaptionLine('mine', 'Sensitivity analyses')}\n\n${TBL}`;
    const html = renderToStaticMarkup(
      <RichSectionEditor value={md} orderMap={new Map()} assetNumbers={{ 'table:mine': 2 }} onChange={noop} />,
    );
    expect(html).toContain('data-tblcap="mine"');
    expect(html).toContain('Table 2.');
    expect(html).toContain('Sensitivity analyses');
    expect(html).toContain('aria-label="Table title"');
    expect(html).not.toContain('[[tblcap:');
  });
});

describe('117.md §10 — the chip action menu', () => {
  const info = { id: 'table:mine', label: 'Table 2', broken: false, rect: chipRect };

  it('offers Go to / Edit / Relink / Remove, and says the table survives a removal', () => {
    const html = renderToStaticMarkup(
      <AssetRefMenu info={info} asset={{ origin: 'manual', title: 'Sensitivity analyses' }}
        pageEl={pageEl} relinkItems={ITEMS} onClose={noop} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-xref-menu"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Cross-reference actions"');
    expect(html).toContain('data-testid="stitch-manuscript-xref-goto"');
    expect(html).toContain('data-testid="stitch-manuscript-xref-edit"');
    expect(html).toContain('data-testid="stitch-manuscript-xref-relink-open"');
    expect(html).toContain('data-testid="stitch-manuscript-xref-remove"');
    expect(html).toContain('Remove cross-reference');
    expect(html).toContain('Removing the reference leaves the table itself untouched.');
  });

  it('a BROKEN chip offers only Relink and Remove (§11)', () => {
    const html = renderToStaticMarkup(
      <AssetRefMenu info={{ ...info, broken: true, label: 'Table (deleted)' }} pageEl={pageEl}
        relinkItems={ITEMS} onClose={noop} />,
    );
    expect(html).toContain('Broken reference');
    expect(html).not.toContain('data-testid="stitch-manuscript-xref-goto"');
    expect(html).not.toContain('data-testid="stitch-manuscript-xref-edit"');
    expect(html).toContain('data-testid="stitch-manuscript-xref-relink-open"');
    expect(html).toContain('data-testid="stitch-manuscript-xref-remove"');
  });

  it('the relink step reuses the SAME searchable picker', () => {
    const html = renderToStaticMarkup(
      <AssetRefMenu info={info} pageEl={pageEl} relinking relinkItems={ITEMS} onClose={noop} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-xref-relink-search"');
    expect(html).toContain('data-testid="stitch-manuscript-xref-relink-item-table-mine"');
  });

  it('renders nothing without an anchor rect (never a stray popover)', () => {
    expect(renderToStaticMarkup(<AssetRefMenu info={null} pageEl={pageEl} onClose={noop} />)).toBe('');
    expect(renderToStaticMarkup(<AssetRefMenu info={info} pageEl={null} onClose={noop} />)).toBe('');
  });
});

describe('117.md §10 — the hover preview', () => {
  it('shows number, title, origin and last-modified when known', () => {
    const html = renderToStaticMarkup(
      <AssetRefHoverCard
        info={{ id: 'table:mine', label: 'Table 2', broken: false, rect: chipRect }}
        asset={{ origin: 'manual', title: 'Sensitivity analyses', updatedAt: '2026-02-03T10:00:00.000Z' }}
        pageEl={pageEl} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-xref-hover"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('Table 2');
    expect(html).toContain('Sensitivity analyses');
    expect(html).toContain('Manual table');
    expect(html).toContain('Last modified');
  });

  it('a broken target explains itself instead of showing a stale title', () => {
    const html = renderToStaticMarkup(
      <AssetRefHoverCard info={{ id: 'table:gone', label: 'Table (deleted)', broken: true, rect: chipRect }}
        asset={null} pageEl={pageEl} />,
    );
    expect(html).toContain('no longer exists in the manuscript');
    expect(html).not.toContain('Last modified');
  });
});

/* ════════════ §11 — deleting a cited table ════════════ */

describe('117.md §11 — deleting a table that is referenced', () => {
  it('states the exact count and promises undo before allowing it', () => {
    const html = renderToStaticMarkup(
      <TableDeleteDialog info={{ tableId: 'mine', count: 4, label: 'Table 2' }} onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-table-delete-confirm"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Delete Table 2?');
    expect(html).toContain('This table is referenced 4 times in the manuscript.');
    expect(html).toContain(TABLE_DELETE_UNDO_NOTE);
    expect(html).toContain('data-testid="stitch-manuscript-table-delete-confirm-btn"');
    expect(html).toContain('data-testid="stitch-manuscript-table-delete-cancel"');
  });

  it('singularizes one reference, and renders nothing when nothing is pending', () => {
    const html = renderToStaticMarkup(
      <TableDeleteDialog info={{ tableId: 'mine', count: 1 }} onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain('referenced 1 time in the manuscript');
    expect(renderToStaticMarkup(<TableDeleteDialog info={null} onConfirm={noop} onCancel={noop} />)).toBe('');
  });
});

describe('117.md §4 — promoting an anonymous table to an object', () => {
  it('offers "+ Caption" only while the caret is in an UNCAPTIONED table', () => {
    const base = { gridRow: 1, col: 0, rows: 3, cols: 2, rect: { top: 120, right: 640 } };
    const anon = renderToStaticMarkup(<TableContextBar ctx={base} pageEl={pageEl} getApi={() => null} />);
    expect(anon).toContain('data-testid="stitch-manuscript-table-op-addCaption"');
    expect(anon).toContain('aria-label="Add table caption"');
    const named = renderToStaticMarkup(
      <TableContextBar ctx={{ ...base, tableId: 'mine' }} pageEl={pageEl} getApi={() => null} />,
    );
    expect(named).not.toContain('stitch-manuscript-table-op-addCaption');
    // the 116.md ops are untouched in both states
    for (const op of ['rowAbove', 'deleteRow', 'deleteTable']) {
      expect(named).toContain(`data-testid="stitch-manuscript-table-op-${op}"`);
    }
  });
});

/* ════════════ EditorPanel first paint ════════════ */

function mockM(draft) {
  return {
    activeDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    references: [],
    prismaCounts: { counts: {}, provenance: {}, warnings: [] },
    insights: [],
    readiness: null, staleness: {}, tables: {},
    sourcesSettled: true,
    assets: [
      { id: 'table:study', kind: 'table', origin: 'auto', available: true, included: true, title: 'Characteristics of included studies' },
      { id: 'table:mine', kind: 'table', origin: 'manual', manualId: 'mine', sectionId: 'results', available: true, included: true, title: 'Sensitivity analyses' },
    ],
    assetNumbering: { byId: { 'table:study': 1, 'table:mine': 2 }, mentioned: new Set(), autoIncluded: new Set() },
    knownAssetIds: new Set(['table:study', 'table:mine']),
    manualTables: [{ id: 'table:mine', manualId: 'mine', sectionId: 'results' }],
    setTableMeta: noop,
    saveState: 'saved', lastError: null, retry: noop,
    updateSection: noop, setMeta: noop, setMetaDebounced: noop, setStatement: noop,
    generate: () => ({ skipped: [] }), refreshBlock: noop, refreshAllBlocks: noop,
    flush: noop,
  };
}
const mockExporters = {
  onExportWord: noop, onExportRepro: noop, onPrismaChecklist: noop, onPrismaSChecklist: noop,
  exporting: null, exportError: '',
};

describe('117.md §4 — the Tables panel lists manual tables without duplicating them', () => {
  const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  draft.sections.results.content = `${tableCaptionLine('mine', 'Sensitivity analyses')}\n\n${TBL}`;

  it('shows the manual table with its number and points editing back at the Editor', () => {
    const m = { ...mockM(draft), staleness: {}, tables: {}, refreshBlock: noop, refreshAllBlocks: noop, queueAssetPatch: noop };
    const html = renderToStaticMarkup(<TablesPanel m={m} />);
    expect(html).toContain('data-testid="stitch-manuscript-asset-table-mine"');
    expect(html).toContain('data-testid="stitch-manuscript-asset-number-table-mine"');
    expect(html).toContain('Table 2');
    expect(html).toContain('In the text');
    expect(html).toContain('data-testid="stitch-manuscript-asset-manual-table-mine"');
    // no second, editable copy of the title (the page owns it)
    expect(html).not.toContain('data-testid="stitch-manuscript-asset-title-table-mine"');
    expect(html).toContain('data-testid="stitch-manuscript-asset-title-prose-table-mine"');
    expect(html).toContain('Edit this table’s title in its caption, in the Editor.');
    // …and it cannot be "excluded", because that would mean deleting prose
    expect(html).toMatch(/disabled=""[^>]*data-testid="stitch-manuscript-asset-include-table-mine"/);
    expect(html).toContain('delete it in the Editor to remove it');
  });
});

describe('EditorPanel — the cross-reference surface on first paint', () => {
  const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  draft.sections.results.content = `${tableCaptionLine('mine', 'Sensitivity analyses')}\n\n${TBL}`;

  it('carries the Tools picker and NO open popovers, menus or dialogs', () => {
    const html = renderToStaticMarkup(<EditorPanel m={mockM(draft)} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-tools-crossref-open"');
    for (const gone of [
      'stitch-manuscript-tools-crossref-popover',
      'stitch-manuscript-xref-menu',
      'stitch-manuscript-xref-hover',
      'stitch-manuscript-table-delete-confirm',
      'stitch-manuscript-table-ctl',
    ]) expect(html).not.toContain(gone);
  });
});
