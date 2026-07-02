/**
 * 65.md MS-CORE/MS-3/MS-5/UX-6 — SSR smoke tests for the WYSIWYG editor surface.
 * Repo convention: react-dom/server static markup (no jsdom) — these assert the
 * first paint of the contentEditable editor (formatted content, no raw markdown,
 * no [[cite: tokens), the toolbar a11y contract, the 3-panel EditorPanel shell
 * (no textarea, no markdown-syntax advertising), the structured abstract editor,
 * and the honest save pill.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichSectionEditor, RichToolbar } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { AbstractEditor } from '../../../src/features/manuscript/richEditor/AbstractEditor.jsx';
import { EditorPanel, SaveStatusPill } from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { ManuscriptWorkspace } from '../../../src/features/manuscript/ManuscriptWorkspace.jsx';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { generateAbstract } from '../../../src/research-engine/manuscript/draft.js';

const noop = () => {};

describe('RichSectionEditor — formatted first paint', () => {
  const md = '# Study selection\n\nWe found **strong** evidence [[cite:r1]].\n\n1. one\n2. two';

  it('renders real headings/bold/lists/citation chips (no raw markup)', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value={md} orderMap={new Map([['r1', 1]])} onChange={noop} />,
    );
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<ol>');
    expect(html).toContain('ms-cite');
    expect(html).toContain('data-cite="r1"');
    expect(html).toContain('[1]');
    expect(html).toContain('contenteditable');
    expect(html).not.toContain('[[cite:');
    expect(html).not.toContain('**');
    expect(html).not.toContain('# Study');
  });

  it('is an accessible multiline textbox with a placeholder', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="" orderMap={new Map()} onChange={noop} ariaLabel="Methods" placeholder="Write here" />,
    );
    expect(html).toContain('role="textbox"');
    expect(html).toContain('aria-multiline="true"');
    expect(html).toContain('aria-label="Methods"');
    expect(html).toContain('data-placeholder="Write here"');
  });
});

describe('RichToolbar — keyboard-accessible formatting controls', () => {
  it('exposes aria-labels + titles for every control and the cite picker', () => {
    const html = renderToStaticMarkup(
      <RichToolbar getApi={() => null} citeRefs={[{ id: 'a' }]} refLabel={(r) => r.id} />,
    );
    for (const label of ['Paragraph', 'Heading level 2', 'Heading level 3', 'Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Bulleted list', 'Numbered list', 'Insert citation']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-testid="stitch-manuscript-insert-citation"');
  });
});

/* ── EditorPanel shell (MS-3) ── */
function mockM(draft) {
  return {
    activeDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    references: [{ id: 's1', index: 1, text: 'Smith J. Trial A.', ref: { authorsList: [{ family: 'Smith' }], year: '2020' } }],
    prismaCounts: { counts: {}, provenance: {}, warnings: [] },
    insights: [{ key: 'k1', severity: 'warning', message: 'Verify the pooled numbers.' }],
    readiness: null, staleness: {}, tables: {},
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

describe('EditorPanel — 3-panel WYSIWYG shell (MS-3)', () => {
  const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  draft.sections.methods.content = '## Eligibility criteria\n\ntext';

  it('renders outline · paper page · tools, with NO raw-markdown textarea', () => {
    const html = renderToStaticMarkup(<EditorPanel m={mockM(draft)} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-editor"');
    expect(html).toContain('data-testid="stitch-manuscript-page"');
    expect(html).toContain('data-testid="stitch-manuscript-tools"');
    expect(html).toContain('ms-paper');
    expect(html).not.toContain('<textarea');
    // 65.md forbids visible markdown — no syntax advertising in help copy
    expect(html).not.toContain('Markdown supported');
    expect(html).not.toMatch(/\*\*bold\*\*/);
  });

  it('derives outline sub-entries from ## headings (MS-11)', () => {
    const html = renderToStaticMarkup(<EditorPanel m={mockM(draft)} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-outline-methods-0"');
    expect(html).toContain('Eligibility criteria');
  });

  it('tools panel carries generate, PRISMA insert, insights and exports', () => {
    const html = renderToStaticMarkup(<EditorPanel m={mockM(draft)} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-generate"');
    expect(html).toContain('data-testid="stitch-manuscript-insert-prisma"');
    expect(html).toContain('data-testid="stitch-manuscript-tools-cite"');
    expect(html).toContain('Verify the pooled numbers.');
    // canonical export testid stays on the Overview panel — tools reuses the group
    expect(html).toContain('Export Word');
    expect(html).toContain('data-testid="stitch-manuscript-save-status"');
  });

  it('title section is a plain input on the page', () => {
    const html = renderToStaticMarkup(<EditorPanel m={mockM(draft)} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-title-input"');
  });
});

describe('AbstractEditor — structured subsections (MS-5)', () => {
  const project = { name: 'P', pico: { question: 'Q', O: 'MACE' }, search: { dbs: { PubMed: true }, date: '2026-01-01' }, prisma: { dbs: '10', dedupe: '2', excTA: '3', excFull: '1' }, studies: [] };

  it('renders labelled fields for a template abstract', () => {
    const value = generateAbstract(project, { templateId: 'jama' });
    const html = renderToStaticMarkup(
      <AbstractEditor value={value} templateId="jama" orderMap={new Map()} resetKey="k" onChange={noop} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-abstract-editor"');
    expect(html).toContain('Importance');
    expect(html).toContain('Conclusions and Relevance');
    expect(html).toContain('data-testid="stitch-manuscript-abstract-field-0"');
    expect(html).toContain('data-testid="stitch-manuscript-abstract-words"');
    expect(html).toContain('350');
    expect(html).not.toContain('**');
  });

  it('falls back to a single rich editor for free-form abstracts', () => {
    const html = renderToStaticMarkup(
      <AbstractEditor value={'Plain abstract text.\n\nSecond paragraph.'} templateId="generic" orderMap={new Map()} resetKey="k" onChange={noop} />,
    );
    expect(html).not.toContain('stitch-manuscript-abstract-editor');
    expect(html).toContain('Free-form abstract');
    expect(html).toContain('Plain abstract text.');
  });
});

describe('ManuscriptWorkspace shell', () => {
  it('SSR-renders overview with the authorship card (MS-6) and save pill', () => {
    const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    const project = { id: 'p', name: 'P', pico: {}, search: { dbs: {} }, prisma: {}, studies: [], manuscripts: [draft] };
    const html = renderToStaticMarkup(<ManuscriptWorkspace project={project} upd={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-workspace"');
    expect(html).toContain('data-testid="stitch-manuscript-save-status"');
    expect(html).toContain('data-testid="stitch-manuscript-authorship-list"');
    expect(html).toContain('data-testid="stitch-manuscript-add-author"');
  });
});

describe('SaveStatusPill — honest save state (UX-6)', () => {
  it('renders Saved / Saving…', () => {
    expect(renderToStaticMarkup(<SaveStatusPill saveState="saved" />)).toContain('Saved');
    expect(renderToStaticMarkup(<SaveStatusPill saveState="saving" />)).toContain('Saving…');
  });
  it('renders the failure state with a Retry action and the error as title', () => {
    const html = renderToStaticMarkup(<SaveStatusPill saveState="error" lastError="boom" onRetry={noop} />);
    expect(html).toContain('Save failed');
    expect(html).toContain('Retry');
    expect(html).toContain('title="boom"');
  });
});
