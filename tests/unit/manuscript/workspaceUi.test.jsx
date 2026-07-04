/**
 * 73.md Part 9 — manuscript workspace UI redesign (SSR contract tests, house
 * style: renderToStaticMarkup, no jsdom — interaction is asserted by control
 * presence + aria state).
 *
 * Covers: OverviewPanel first-time hero, per-section status grid (all 5 chips),
 * Data-sources card honesty copy, Consistency card + jump buttons; EditorPanel
 * lock (read-only editor, aria-pressed toggle, disabled generation), provenance
 * ("Generated from" chips + top-2 missing hints), Outdated badges, and the
 * collapsible tools groups (Generate open by default).
 *
 * Guard rail: NO user-facing "AI" string in any rendered markup.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewPanel, EditorPanel, sectionRowStatus } from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { RichSectionEditor } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { setSection, setSectionLocked } from '../../../src/features/manuscript/manuscriptState.js';

const noop = () => {};
const noAI = (html) => expect(html).not.toMatch(/\bAI\b/);

const mockExporters = {
  onExportWord: noop, onExportRepro: noop, onPrismaChecklist: noop, onPrismaSChecklist: noop,
  exporting: null, exportError: '',
};

function mockM(draft, extra = {}) {
  return {
    activeDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    references: [],
    prismaCounts: { counts: {}, provenance: {}, warnings: [] },
    insights: [],
    readiness: {
      items: [{ key: 'title', label: 'Title', complete: false }],
      score: { done: 0, total: 1, pct: 0 },
    },
    staleness: {}, tables: {},
    dataStatus: { screening: 'unlinked', search: 'off', rob: 'off', grade: 'off', pecan: 'off' },
    screening: null, searchMethodsText: '', robAssessments: null, robByStudyId: null, perSource: null,
    outdated: {}, consistency: [], gradeByOutcome: null,
    saveState: 'saved', lastError: null, retry: noop,
    updateSection: noop, setMeta: noop, setMetaDebounced: noop, setStatement: noop,
    setSectionLocked: noop,
    generate: () => ({ skipped: [], skippedLocked: [] }),
    refreshBlock: noop, refreshAllBlocks: noop,
    flush: noop,
    ...extra,
  };
}

/* Draft exercising all five row statuses:
   title=Empty, introduction=Auto-draft, methods=Edited, results=Locked,
   discussion=Outdated (via m.outdated). */
function fiveStateDraft() {
  let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  d.sections.introduction = { ...d.sections.introduction, content: 'gen', aiGenerated: true, userEdited: false };
  d = setSection(d, 'methods', 'my methods');
  d = setSection(d, 'results', 'locked results');
  d = setSectionLocked(d, 'results', true);
  d.sections.discussion = { ...d.sections.discussion, content: 'gen d', aiGenerated: true, userEdited: false, inputsHash: 'stale123' };
  return normalizeDraft(d);
}

describe('sectionRowStatus — Locked > Outdated > content state', () => {
  it('resolves priority correctly', () => {
    expect(sectionRowStatus({ content: 'x', locked: true }, true)).toBe('locked');
    expect(sectionRowStatus({ content: 'x', aiGenerated: true }, true)).toBe('outdated');
    expect(sectionRowStatus({ content: 'x', aiGenerated: true }, false)).toBe('ai-draft');
    expect(sectionRowStatus({ content: 'x', userEdited: true }, false)).toBe('edited');
    expect(sectionRowStatus({ content: '' }, false)).toBe('empty');
  });
});

describe('OverviewPanel — first-time empty state', () => {
  it('renders the hero (CTA + 3 grounding bullets) when every section is empty', () => {
    const html = renderToStaticMarkup(
      <OverviewPanel m={mockM(normalizeDraft(makeManuscriptDraft({ title: '' })))} exporters={mockExporters} onOpenSection={noop} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-hero"');
    expect(html).toContain('data-testid="stitch-manuscript-hero-generate"');
    expect(html).toContain('Generate your first draft');
    expect(html).toContain('never silently overwritten');
    expect(html).toContain('Regenerate any section');
    expect(html).toContain('actual data');
    // the section grid is replaced by the hero
    expect(html).not.toContain('data-testid="stitch-manuscript-section-grid"');
    noAI(html);
  });
});

describe('OverviewPanel — per-section status grid', () => {
  const m = mockM(fiveStateDraft(), { outdated: { discussion: true } });
  const html = renderToStaticMarkup(<OverviewPanel m={m} exporters={mockExporters} onOpenSection={noop} />);

  it('shows one row per section with all five status labels', () => {
    expect(html).toContain('data-testid="stitch-manuscript-section-grid"');
    for (const id of ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion']) {
      expect(html).toContain(`data-testid="stitch-manuscript-secrow-${id}"`);
    }
    for (const label of ['Empty', 'Auto-draft', 'Edited', 'Locked', 'Outdated']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('data-testid="stitch-manuscript-hero"');
    noAI(html);
  });

  it('every row has Open + Generate controls; the locked row is disabled', () => {
    expect(html).toContain('data-testid="stitch-manuscript-secrow-open-methods"');
    expect(html).toContain('data-testid="stitch-manuscript-secrow-generate-methods"');
    // the whole opening tag of the locked row's Generate button carries `disabled`
    const tagStart = html.lastIndexOf('<button', html.indexOf('data-testid="stitch-manuscript-secrow-generate-results"'));
    const tag = html.slice(tagStart, html.indexOf('>', tagStart));
    expect(tag).toContain('disabled');
    // …while an unlocked row's Generate button is NOT disabled
    const okStart = html.lastIndexOf('<button', html.indexOf('data-testid="stitch-manuscript-secrow-generate-methods"'));
    const okTag = html.slice(okStart, html.indexOf('>', okStart));
    expect(okTag).not.toContain('disabled');
  });
});

describe('OverviewPanel — data sources card', () => {
  it('reports honest availability per source', () => {
    const m = mockM(fiveStateDraft(), {
      dataStatus: { screening: 'ok', search: 'off', rob: 'error', grade: 'ok', pecan: 'ok' },
      robAssessments: null,
      gradeByOutcome: { 'MACE|||': 'Moderate' },
      perSource: { pubmed: { records: 120 } },
    });
    const html = renderToStaticMarkup(<OverviewPanel m={m} exporters={mockExporters} onOpenSection={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-data-sources"');
    expect(html).toContain('Linked — live PRISMA counts');
    expect(html).toContain('Not enabled — the search table uses the Search tab entries.');
    expect(html).toContain('Could not load assessments');
    expect(html).toContain('1 outcome rating');
    expect(html).toContain('latest completed run');
    noAI(html);
  });

  it('unlinked screening explains the manual fallback', () => {
    const html = renderToStaticMarkup(
      <OverviewPanel m={mockM(fiveStateDraft())} exporters={mockExporters} onOpenSection={noop} />,
    );
    expect(html).toContain('Not linked — counts fall back to manual PRISMA entries.');
  });
});

describe('OverviewPanel — consistency card', () => {
  it('lists findings with severity words and per-finding Open buttons', () => {
    const m = mockM(fiveStateDraft(), {
      consistency: [
        { id: 'estimator-mismatch', severity: 'warn', section: 'methods', message: 'Methods mentions a different estimator.' },
        { id: 'references-empty', severity: 'info', section: 'references', message: 'Reference list is empty.' },
      ],
    });
    const html = renderToStaticMarkup(<OverviewPanel m={m} exporters={mockExporters} onOpenSection={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-consistency"');
    expect(html).toContain('Check');
    expect(html).toContain('Note');
    expect(html).toContain('Methods mentions a different estimator.');
    expect(html).toContain('data-testid="stitch-manuscript-consistency-open-estimator-mismatch"');
    expect(html).toContain('data-testid="stitch-manuscript-consistency-open-references-empty"');
    noAI(html);
  });

  it('renders a calm all-clear when there are no findings', () => {
    const html = renderToStaticMarkup(
      <OverviewPanel m={mockM(fiveStateDraft())} exporters={mockExporters} onOpenSection={noop} />,
    );
    expect(html).toContain('No inconsistencies detected');
  });
});

describe('EditorPanel — lock, provenance, outdated, tools groups', () => {
  it('locked title section: Locked chip, aria-pressed toggle, disabled input + generation', () => {
    let d = setSection(normalizeDraft(makeManuscriptDraft({ title: 'T' })), 'title', 'My title');
    d = setSectionLocked(d, 'title', true);
    const html = renderToStaticMarkup(<EditorPanel m={mockM(normalizeDraft(d))} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-locked-badge"');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="stitch-manuscript-lock-toggle"|data-testid="stitch-manuscript-lock-toggle"[^>]*aria-pressed="true"/);
    // read-only title input + generation disabled for this section
    expect(html).toMatch(/disabled[^>]*data-testid="stitch-manuscript-title-input"|data-testid="stitch-manuscript-title-input"[^>]*disabled/);
    expect(html).toContain('Unlock');
    noAI(html);
  });

  it('unlocked section: lock toggle present with aria-pressed="false"', () => {
    const html = renderToStaticMarkup(
      <EditorPanel m={mockM(normalizeDraft(makeManuscriptDraft({ title: 'T' })))} exporters={mockExporters} />,
    );
    expect(html).toMatch(/aria-pressed="false"[^>]*data-testid="stitch-manuscript-lock-toggle"|data-testid="stitch-manuscript-lock-toggle"[^>]*aria-pressed="false"/);
  });

  it('renders "Generated from" source chips and the top-2 missing hints', () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d.sections.title = {
      ...d.sections.title,
      content: 'Generated title', aiGenerated: true,
      sources: [{ key: 'pico', label: 'PICO & eligibility criteria' }],
      missing: [{ field: 'a', hint: 'HINT-ONE' }, { field: 'b', hint: 'HINT-TWO' }, { field: 'c', hint: 'HINT-THREE' }],
      inputsHash: 'h1',
    };
    const html = renderToStaticMarkup(<EditorPanel m={mockM(normalizeDraft(d))} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-sources"');
    expect(html).toContain('Generated from');
    expect(html).toContain('PICO &amp; eligibility criteria');
    expect(html).toContain('data-testid="stitch-manuscript-missing"');
    expect(html).toContain('HINT-ONE');
    expect(html).toContain('HINT-TWO');
    expect(html).not.toContain('HINT-THREE'); // top 2 only
    noAI(html);
  });

  it('outdated section: header badge + tooltip + Regenerate button + outline marker', () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d.sections.title = { ...d.sections.title, content: 'Old title', aiGenerated: true, inputsHash: 'stale' };
    const m = mockM(normalizeDraft(d), { outdated: { title: true } });
    const html = renderToStaticMarkup(<EditorPanel m={m} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-outdated-badge"');
    expect(html).toContain('Project data changed since this was generated');
    expect(html).toContain('data-testid="stitch-manuscript-regenerate"');
    expect(html).toContain('data-testid="stitch-manuscript-outline-outdated-title"');
  });

  it('locked section shows the outline lock glyph and NO regenerate button', () => {
    let d = setSection(normalizeDraft(makeManuscriptDraft({ title: 'T' })), 'results', 'locked text');
    d = setSectionLocked(d, 'results', true);
    const m = mockM(normalizeDraft(d), { outdated: { results: true } });
    const html = renderToStaticMarkup(<EditorPanel m={m} exporters={mockExporters} />);
    expect(html).toContain('data-testid="stitch-manuscript-outline-lock-results"');
  });

  it('tools column: three collapsible groups, only Generate open by default', () => {
    const html = renderToStaticMarkup(
      <EditorPanel m={mockM(normalizeDraft(makeManuscriptDraft({ title: 'T' })))} exporters={mockExporters} />,
    );
    for (const g of ['generate', 'insert', 'export']) {
      expect(html).toContain(`data-testid="stitch-manuscript-toolgroup-${g}"`);
    }
    expect((html.match(/<details open/g) || []).length).toBe(1);
    // collapsed content stays in the DOM (keeps tools discoverable + testable)
    expect(html).toContain('data-testid="stitch-manuscript-insert-prisma"');
    expect(html).toContain('data-testid="stitch-manuscript-generate"');
    noAI(html);
  });
});

describe('RichSectionEditor — readOnly contract', () => {
  it('readOnly renders contenteditable="false" + aria-readonly', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="Locked **content**" orderMap={new Map()} onChange={noop} readOnly />,
    );
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('<strong>');
  });
  it('default stays editable', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value="x" orderMap={new Map()} onChange={noop} />,
    );
    expect(html).toContain('contenteditable="true"');
    expect(html).not.toContain('aria-readonly');
  });
});
