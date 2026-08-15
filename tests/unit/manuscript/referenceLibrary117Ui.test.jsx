/**
 * 117.md §33/§34/§35/§38 — SSR contracts for the reference-library surfaces.
 *
 * Repo convention: react-dom/server static markup (no jsdom). These pin the FIRST
 * PAINT and the accessibility contract of the new controls — the searchable
 * multi-select citation picker, the citation chip (interactive + keyboard-reachable
 * + honestly broken), its hover preview and action menu, the Add Reference dialog
 * with its type-driven fields, the import dialog, and the library manager's search /
 * filters / sort — plus the rule that no popover or dialog exists until asked for.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RichSectionEditor, RichToolbar, CiteRefPicker, CiteRefList, citeItemOf,
  CITE_EMPTY_TEXT,
} from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import {
  EditorPanel, ReferencesPanel, CiteRefMenu, CiteHoverCard,
  AddReferenceDialog, ImportReferencesDialog, LOOKUP_UNVERIFIED_NOTE, IMPORT_HINT,
} from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { citeChipHtml, citeChipLabel, mdToHtml } from '../../../src/features/manuscript/richEditor/mdDom.js';

const noop = () => {};

const REFS = [
  {
    id: 'a', index: 1, cited: true, text: 'Lee K. Aspirin trial. Lancet. 2019.',
    segments: [{ text: 'Lee K. ' }],
    ref: {
      id: 'a', title: 'Aspirin trial', authorsRaw: 'Lee K', authorsList: [{ family: 'Lee', given: 'K' }],
      journal: 'Lancet', year: '2019', doi: '10.1/x', type: 'journal-article', tags: ['core'], origin: 'study',
    },
  },
  {
    id: 'b', index: 2, cited: false, text: 'Roe B. Diet guideline. BMJ. 2021.',
    segments: [{ text: 'Roe B. ' }],
    ref: {
      id: 'b', title: 'Diet guideline', authorsRaw: 'Roe B', authorsList: [{ family: 'Roe', given: 'B' }],
      journal: 'BMJ', year: '2021', type: 'guideline', tags: [], origin: 'library',
    },
  },
];

const pageEl = { getBoundingClientRect: () => ({ top: 40, left: 20, right: 720, width: 700 }) };
const chipRect = { top: 120, bottom: 134, left: 90, right: 150 };

/* ════════════ §34/§35 — the citation picker ════════════ */

describe('117.md §34 — the Insert Citation picker is searchable', () => {
  const items = REFS.map((r) => citeItemOf(r));

  it('offers a search box covering author, title, DOI, PMID, journal and year', () => {
    const html = renderToStaticMarkup(<CiteRefList items={items} onInsert={noop} testIdPrefix="ct" />);
    expect(html).toContain('data-testid="ct-search"');
    expect(html).toContain('aria-label="Search references"');
    expect(html).toContain('placeholder="Search author, title, DOI, PMID, journal, year…"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-multiselectable="true"');
  });

  it('lists every reference with its author-year label and title', () => {
    const html = renderToStaticMarkup(<CiteRefList items={items} onInsert={noop} testIdPrefix="ct" />);
    expect(html).toContain('data-testid="ct-item-a"');
    expect(html).toContain('data-testid="ct-item-b"');
    expect(html).toContain('Lee 2019');
    expect(html).toContain('Aspirin trial');
    expect(html).toContain('Diet guideline');
  });

  it('§35 — every row carries a checkbox so several can form ONE citation', () => {
    const html = renderToStaticMarkup(<CiteRefList items={items} onInsert={noop} testIdPrefix="ct" />);
    expect(html).toContain('data-testid="ct-check-a"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="Add Lee 2019 to a multiple citation"');
    // nothing selected on first paint → no Insert-N button
    expect(html).not.toContain('data-testid="ct-insert"');
  });

  it('says honestly when the library is empty', () => {
    const html = renderToStaticMarkup(<CiteRefList items={[]} onInsert={noop} testIdPrefix="ct" />);
    expect(html).toContain('data-testid="ct-empty"');
    expect(html).toContain(CITE_EMPTY_TEXT);
  });

  it('the popover form opens only on interaction (first paint is a button)', () => {
    const html = renderToStaticMarkup(<CiteRefPicker items={items} onInsert={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-insert-citation"');
    expect(html).toContain('aria-label="Insert citation"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="stitch-manuscript-insert-citation-popover"');
  });

  it('replaces the old bare <select> in the toolbar', () => {
    const html = renderToStaticMarkup(
      <RichToolbar getApi={() => null} citeRefs={REFS} refLabel={(r) => r.id} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-insert-citation"');
    expect(html).toContain('aria-label="Insert citation"');
    expect(html).not.toContain('<option value="">+ Cite…</option>');
  });
});

/* ════════════ §35/§38/§39 — the citation chip ════════════ */

describe('117.md §38 — the citation chip is interactive and keyboard-reachable', () => {
  it('renders as an atomic button-role island carrying its stable id', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="See [[cite:a]] here." orderMap={new Map([['a', 1]])} onChange={noop} />,
    );
    expect(html).toContain('data-cite="a"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Citation: [1]. Activate for citation actions."');
    expect(html).toContain('contenteditable="false"');
    expect(html).not.toContain('[[cite:');
  });

  it('§35 — a multi-cite token is ONE chip reading "[1,2]"', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="Several studies [[cite:a,b]]." orderMap={new Map([['a', 1], ['b', 2]])} onChange={noop} />,
    );
    expect(html).toContain('data-cite="a,b"');
    expect(html).toContain('>[1,2]<');
    expect((html.match(/class="ms-cite"/g) || []).length).toBe(1);
  });

  it('§35 — a run of three or more collapses to a range', () => {
    const om = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
    const html = renderToStaticMarkup(
      <RichSectionEditor value="x [[cite:a,b,c,d]]" orderMap={om} onChange={noop} />,
    );
    expect(html).toContain('>[1–4]<');
  });

  it('§39 — a citation whose reference is gone renders visibly BROKEN', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="x [[cite:gone]]" orderMap={new Map([['a', 1]])}
        refsById={new Map([['a', REFS[0].ref]])} onChange={noop} />,
    );
    expect(html).toContain('data-cite-broken="true"');
    expect(html).toContain('aria-label="Broken citation: [?]. Activate for citation actions."');
  });

  it('§37 — Harvard renders the chip as an author-year label', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="x [[cite:a]]" orderMap={new Map([['a', 1]])}
        citationStyle="harvard" refsById={new Map([['a', REFS[0].ref]])} onChange={noop} />,
    );
    expect(html).toContain('(Lee, 2019)');
    expect(html).not.toContain('>[1]<');
  });

  it('citeChipLabel is the ONE label function both renderers use', () => {
    expect(citeChipLabel('a,b', new Map([['a', 1], ['b', 2]]))).toEqual({ label: '[1,2]', broken: false, ids: ['a', 'b'] });
    expect(citeChipLabel('zz', new Map([['a', 1]])).broken).toBe(true);
  });

  it('a legacy single-id citeChipHtml call still produces the old markup shape', () => {
    const chip = citeChipHtml('r9', 3);
    expect(chip).toContain('data-cite="r9"');
    expect(chip).toContain('>[3]<');
  });

  it('mdToHtml never leaks a raw multi-cite token', () => {
    expect(mdToHtml('x [[cite:a,b]]', { orderMap: new Map([['a', 1], ['b', 2]]) })).not.toContain('[[cite:');
  });
});

describe('117.md §38 — the citation hover preview', () => {
  const info = { ids: ['a'], label: '[1]', broken: false, rect: chipRect };

  it('shows first author, year, title and journal', () => {
    const html = renderToStaticMarkup(<CiteHoverCard info={info} refs={[REFS[0].ref]} pageEl={pageEl} />);
    expect(html).toContain('data-testid="stitch-manuscript-cite-hover"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('Lee, 2019');
    expect(html).toContain('Aspirin trial');
    expect(html).toContain('Lancet · 2019');
  });

  it('says so when the citation matches nothing', () => {
    const html = renderToStaticMarkup(
      <CiteHoverCard info={{ ...info, broken: true }} refs={[]} pageEl={pageEl} />,
    );
    expect(html).toContain('This citation does not match any reference in the library.');
  });

  it('renders nothing without an anchor rect (no orphan popover)', () => {
    expect(renderToStaticMarkup(<CiteHoverCard info={null} refs={[]} pageEl={pageEl} />)).toBe('');
  });
});

describe('117.md §38 — the citation action menu', () => {
  const info = { ids: ['a'], label: '[1]', broken: false, rect: chipRect };

  it('offers View / Edit / Go to References / Remove, and says the reference survives', () => {
    const html = renderToStaticMarkup(<CiteRefMenu info={info} refs={[REFS[0].ref]} pageEl={pageEl} />);
    expect(html).toContain('data-testid="stitch-manuscript-cite-menu"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Citation actions"');
    expect(html).toContain('data-testid="stitch-manuscript-cite-view-a"');
    expect(html).toContain('data-testid="stitch-manuscript-cite-edit-a"');
    expect(html).toContain('data-testid="stitch-manuscript-cite-goto-references"');
    expect(html).toContain('data-testid="stitch-manuscript-cite-remove"');
    expect(html).toContain('Removing the citation leaves the reference in your library.');
  });

  it('Open PDF appears ONLY when a linked attachment exists', () => {
    const noPdf = renderToStaticMarkup(<CiteRefMenu info={info} refs={[REFS[0].ref]} pageEl={pageEl} />);
    expect(noPdf).not.toContain('Open PDF');
    const withPdf = renderToStaticMarkup(
      <CiteRefMenu info={info} refs={[{ ...REFS[0].ref, pdfAttachmentId: 'f1' }]} pageEl={pageEl} />,
    );
    expect(withPdf).toContain('data-testid="stitch-manuscript-cite-pdf-a"');
    expect(withPdf).toContain('Open PDF');
  });

  it('a MULTI citation offers per-reference removal as well as the whole chip', () => {
    const html = renderToStaticMarkup(
      <CiteRefMenu info={{ ...info, ids: ['a', 'b'], label: '[1,2]' }}
        refs={[REFS[0].ref, REFS[1].ref]} pageEl={pageEl} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-cite-remove-a"');
    expect(html).toContain('data-testid="stitch-manuscript-cite-remove-b"');
    expect(html).toContain('data-testid="stitch-manuscript-cite-remove"');
    expect(html).toContain('Remove this reference');
  });

  it('a broken citation says so instead of offering reference actions', () => {
    const html = renderToStaticMarkup(
      <CiteRefMenu info={{ ...info, broken: true }} refs={[]} pageEl={pageEl} />,
    );
    expect(html).toContain('Citation not found');
    expect(html).toContain('data-testid="stitch-manuscript-cite-menu-missing">');
  });
});

/* ════════════ §28/§29 — Add Reference ════════════ */

describe('117.md §28/§29 — the Add Reference dialog', () => {
  it('is a modal with a type selector and the journal-article fields', () => {
    const html = renderToStaticMarkup(<AddReferenceDialog onSave={noop} onCancel={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-add-reference"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-type"');
    for (const k of ['title', 'authors', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'pmid', 'pmcid']) {
      expect(html).toContain(`data-testid="stitch-manuscript-reffield-${k}"`);
    }
    expect(html).toContain('data-testid="stitch-manuscript-reference-save"');
  });

  it('offers every §28 reference type in the selector', () => {
    const html = renderToStaticMarkup(<AddReferenceDialog onSave={noop} onCancel={noop} />);
    for (const label of ['Journal Article', 'Book', 'Book Chapter', 'Conference Abstract',
      'Conference Proceeding', 'Website', 'Guideline', 'Report', 'Thesis', 'Preprint',
      'Dataset', 'Clinical Trial Registration', 'Systematic Review Registration',
      'Government Publication', 'Software', 'Other']) {
      expect(html).toContain(`>${label}</option>`);
    }
  });

  it('a BOOK reveals publisher/ISBN and hides the journal fields (§28)', () => {
    const html = renderToStaticMarkup(<AddReferenceDialog initial={{ type: 'book' }} onSave={noop} onCancel={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-reffield-publisher"');
    expect(html).toContain('data-testid="stitch-manuscript-reffield-isbn"');
    expect(html).not.toContain('data-testid="stitch-manuscript-reffield-journal"');
    expect(html).not.toContain('data-testid="stitch-manuscript-reffield-volume"');
  });

  it('§29 — the smart lookup accepts DOI / PMID / PMCID / title', () => {
    const html = renderToStaticMarkup(<AddReferenceDialog onSave={noop} onCancel={noop} onLookup={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-lookup-kind"');
    expect(html).toContain('data-testid="stitch-manuscript-lookup-value"');
    expect(html).toContain('data-testid="stitch-manuscript-lookup-run"');
    for (const label of ['DOI', 'PMID', 'PMCID', 'Title']) expect(html).toContain(`>${label}</option>`);
  });

  it('the lookup section is absent when no lookup is available', () => {
    const html = renderToStaticMarkup(<AddReferenceDialog onSave={noop} onCancel={noop} />);
    expect(html).not.toContain('data-testid="stitch-manuscript-lookup-run"');
  });

  it('pre-fills from an existing reference when editing', () => {
    const html = renderToStaticMarkup(
      <AddReferenceDialog initial={REFS[0].ref} saveLabel="Save reference" onSave={noop} onCancel={noop} />,
    );
    expect(html).toContain('value="Aspirin trial"');
    expect(html).toContain('value="Lee K"');
    expect(html).toContain('Save reference');
  });

  it('states honestly that looked-up metadata must be checked', () => {
    expect(LOOKUP_UNVERIFIED_NOTE).toMatch(/CrossRef \/ PubMed/);
    expect(LOOKUP_UNVERIFIED_NOTE).toMatch(/check it against the article/);
  });
});

describe('117.md §30 — the import dialog', () => {
  it('names the supported formats and shows no preview until the text is read', () => {
    const html = renderToStaticMarkup(<ImportReferencesDialog onCancel={noop} onImport={{}} />);
    expect(html).toContain('data-testid="stitch-manuscript-import-references"');
    expect(html).toContain(IMPORT_HINT);
    expect(IMPORT_HINT).toMatch(/RIS/);
    expect(IMPORT_HINT).toMatch(/BibTeX/);
    expect(IMPORT_HINT).toMatch(/EndNote XML/);
    expect(IMPORT_HINT).toMatch(/nbib/);
    expect(IMPORT_HINT).toMatch(/CSV/);
    expect(html).toContain('data-testid="stitch-manuscript-import-file"');
    expect(html).toContain('data-testid="stitch-manuscript-import-text"');
    expect(html).toContain('data-testid="stitch-manuscript-import-parse"');
    expect(html).not.toContain('data-testid="stitch-manuscript-import-preview"');
  });
});

/* ════════════ §33 — the library manager ════════════ */

const mockM = (over = {}) => ({
  activeDraft: normalizeDraft(makeManuscriptDraft()),
  references: REFS,
  suppressedReferences: [],
  duplicateReferences: { pairs: [], skipped: false, total: REFS.length },
  refsById: new Map(REFS.map((r) => [r.id, r.ref])),
  referenceAliases: {},
  setMeta: noop,
  ...over,
});

describe('117.md §33 — the References panel is a library manager', () => {
  it('carries search, the five filters and the sort control', () => {
    const html = renderToStaticMarkup(<ReferencesPanel m={mockM()} />);
    expect(html).toContain('data-testid="stitch-manuscript-reference-search"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-filter-cited"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-filter-type"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-filter-year"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-filter-journal"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-filter-tag"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-sort"');
  });

  it('offers Add reference and Import next to the existing exports', () => {
    const html = renderToStaticMarkup(<ReferencesPanel m={mockM()} />);
    expect(html).toContain('data-testid="stitch-manuscript-add-reference-open"');
    expect(html).toContain('data-testid="stitch-manuscript-import-open"');
    expect(html).toContain('BibTeX');
    expect(html).toContain('RIS');
    // no dialog until asked for
    expect(html).not.toContain('data-testid="stitch-manuscript-add-reference"');
    expect(html).not.toContain('data-testid="stitch-manuscript-import-references"');
  });

  it('§31 — states that included studies are already references', () => {
    const html = renderToStaticMarkup(<ReferencesPanel m={mockM()} />);
    expect(html).toContain('data-testid="stitch-manuscript-references-derived-note"');
    expect(html).toContain('Every included study is already a reference');
  });

  it('marks cited and uncited entries, and per-entry actions', () => {
    const html = renderToStaticMarkup(<ReferencesPanel m={mockM()} />);
    expect(html).toContain('data-testid="stitch-manuscript-reference-a"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-uncited-b"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-cite-a"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-edit-a"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-merge-a"');
    // a DERIVED reference is hidden, an ADDED one is deleted
    expect(html).toContain('data-testid="stitch-manuscript-reference-hide-a"');
    expect(html).toContain('data-testid="stitch-manuscript-reference-delete-b"');
  });

  it('§32 — surfaces probable duplicates with a merge action and the promise it keeps', () => {
    const dupes = {
      pairs: [{ a: REFS[0].ref, b: REFS[1].ref, verdict: { reasons: ['98% title similarity', 'same journal'], score: 98 } }],
      skipped: false, total: 2,
    };
    const html = renderToStaticMarkup(<ReferencesPanel m={mockM({ duplicateReferences: dupes })} />);
    expect(html).toContain('data-testid="stitch-manuscript-reference-duplicates"');
    expect(html).toContain('data-testid="stitch-manuscript-merge-a-b"');
    expect(html).toContain('Merging keeps every citation you have already written');
  });

  it('§31 — hidden references stay listed and restorable', () => {
    const html = renderToStaticMarkup(
      <ReferencesPanel m={mockM({ suppressedReferences: [{ id: 'z', title: 'Hidden one' }] })} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-reference-hidden"');
    expect(html).toContain('Hidden one');
    expect(html).toContain('data-testid="stitch-manuscript-reference-restore-z"');
  });

  it('§37 — the style selector offers all seven styles', () => {
    const html = renderToStaticMarkup(<ReferencesPanel m={mockM()} />);
    for (const label of ['Vancouver', 'JAMA', 'AMA', 'APA', 'Harvard', 'Nature', 'NEJM']) {
      expect(html).toContain(`>${label}</option>`);
    }
  });

  it('an empty library says so rather than rendering an empty list', () => {
    const html = renderToStaticMarkup(<ReferencesPanel m={mockM({ references: [] })} />);
    expect(html).toContain('No references yet.');
  });
});

/* ════════════ EditorPanel wiring ════════════ */

describe('117.md §34 — the editor reaches the picker from both places', () => {
  const draft = normalizeDraft(makeManuscriptDraft());
  const m = mockM({
    assets: [], assetNumbering: { byId: {} }, manualTables: [], placeholders: [],
    insights: [], outdated: {}, freshness: { status: 'ok' }, changeGroups: [],
    prismaCounts: { counts: {} }, saveState: 'saved',
  });

  it('the Tools panel keeps its testid but is now a searchable picker', () => {
    const html = renderToStaticMarkup(<EditorPanel m={m} exporters={null} />);
    expect(html).toContain('data-testid="stitch-manuscript-tools-cite"');
    expect(html).toContain('aria-haspopup="dialog"');
    // no bare <select> of references any more
    expect(html).not.toContain('+ Insert citation…</option>');
  });

  it('no citation popover exists before the researcher opens one', () => {
    const html = renderToStaticMarkup(<EditorPanel m={m} exporters={null} />);
    expect(html).not.toContain('data-testid="stitch-manuscript-cite-menu"');
    expect(html).not.toContain('data-testid="stitch-manuscript-cite-hover"');
    expect(html).not.toContain('data-testid="stitch-manuscript-tools-cite-popover"');
  });

  it('renders without a reference library at all (legacy/empty project)', () => {
    const html = renderToStaticMarkup(
      <EditorPanel m={{ ...m, references: [], refsById: null, referenceAliases: null }} exporters={null} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-editor"');
    expect(html).toContain('References appear here once your project has included studies.');
  });

  it('the draft fixture is untouched by rendering (no hidden mutation)', () => {
    const before = JSON.stringify(draft);
    renderToStaticMarkup(<EditorPanel m={m} exporters={null} />);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
