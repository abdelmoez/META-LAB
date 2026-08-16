/**
 * 118.md §8.1 / §8.2 + the duplicated title block — the three follow-ups left open
 * by docs/writing-workspace-118.md §9.
 *
 * House style: renderToStaticMarkup + pure helpers + source pins (no jsdom in this
 * repo), so anything that only exists at runtime is pinned through the code that
 * decides it rather than through a fake click.
 *
 * Covered here:
 *   §8.1  the abstract's subsection editors receive the SAME shared prop bag the
 *         body sections get (citation style, reference metadata, year suffixes and
 *         both chip callbacks), with the owning section reported as 'abstract' — so
 *         a citation typed in the abstract renders its styled label and its chip
 *         opens the same hover card / action menu it opens in Methods.
 *   §8.2  the live-section overlay drops when a GENERATION supersedes it, not only
 *         when the store catches up.
 *   r3    ONE title block, rendered by both views (INK canonical).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import { EditorPanel } from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { AbstractEditor } from '../../../src/features/manuscript/richEditor/AbstractEditor.jsx';
import { TitleBlock, INK } from '../../../src/features/manuscript/ContinuousView.jsx';
import { settleLiveSections } from '../../../src/features/manuscript/manuscriptState.js';
import {
  makeManuscriptDraft, normalizeDraft, normalizeReference,
} from '../../../src/research-engine/manuscript/index.js';

const noop = () => {};

const SMITH = normalizeReference({
  authors: 'Smith J', year: '2020', journal: 'Lancet', title: 'A trial',
}, 's1');

const ABSTRACT_MD = [
  '**Background.** Prior work is mixed [[cite:s1]].',
  '**Methods.** We pooled the trials.',
  '**Results.** The estimate favours treatment.',
  '**Conclusions.** More data are needed.',
].join('\n\n');

function makeDraft(over = {}) {
  const d = normalizeDraft(makeManuscriptDraft({ title: 'A pooled analysis of X' }));
  d.sections.title.content = 'A pooled analysis of X';
  d.sections.abstract.content = ABSTRACT_MD;
  d.sections.methods.content = 'We included trials [[cite:s1]].';
  d.keywords = ['systematic review'];
  d.citationStyle = 'harvard';
  return { ...d, ...over };
}

function mockM(draft, extra = {}) {
  return {
    activeDraft: draft,
    liveDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    references: [{ id: 's1', index: 1, text: 'Smith J. A trial. Lancet. 2020.', ref: SMITH, cited: true }],
    citationOrderMap: new Map([['s1', 1]]),
    referenceAliases: {}, referenceKnownIds: new Set(['s1']),
    refsById: new Map([['s1', SMITH]]),
    citationYearSuffixes: null,
    prismaCounts: { counts: {}, provenance: {}, warnings: [] },
    insights: [], readiness: null, staleness: {}, tables: {},
    assets: [], assetNumbering: { byId: {} }, knownAssetIds: new Set(), manualTables: [],
    outdated: {}, placeholders: [], placeholderStats: null, changeGroups: [],
    saveState: 'saved', lastError: null, retry: noop,
    updateSection: noop, setMeta: noop, setMetaDebounced: noop, setStatement: noop,
    setSectionLocked: noop, setTableMeta: noop, setCurrentPlaceholderId: noop,
    generate: () => ({ skipped: [] }), refreshBlock: noop, refreshAllBlocks: noop,
    flush: noop, sourcesSettled: true,
    ...extra,
  };
}

/* ══════════════ §8.1 — the abstract is a first-class citing surface ══════════════ */

describe('118.md §8.1 — cite chips in the ABSTRACT behave like cite chips anywhere', () => {
  const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
  const abstractSrc = readSource('src/features/manuscript/richEditor/AbstractEditor.jsx');

  it('renders the STYLE-AWARE label, not a bare numeric chip (Harvard author-year)', () => {
    const html = renderToStaticMarkup(
      <EditorPanel m={mockM(makeDraft())} exporters={null} view="continuous" />,
    );
    // the abstract's own field, not the Methods editor
    const abstractBlock = html.slice(
      html.indexOf('data-testid="stitch-manuscript-doc-abstract"'),
      html.indexOf('data-testid="stitch-manuscript-doc-introduction"'),
    );
    expect(abstractBlock).toContain('data-testid="stitch-manuscript-abstract-field-0"');
    expect(abstractBlock).toContain('(Smith, 2020)');
    expect(abstractBlock).toContain('data-cite="s1"');
    // the pre-fix rendering: a numeric chip, because the style never arrived
    expect(abstractBlock).not.toContain('>[1]<');
  });

  it('a subsection editor mounts the shared bag — style, refs, suffixes, callbacks', () => {
    const seen = {};
    const html = renderToStaticMarkup(
      <AbstractEditor
        value={ABSTRACT_MD} templateId="generic" orderMap={new Map([['s1', 1]])}
        resetKey="k" onChange={noop} captionTemplateId="generic"
        fieldProps={{
          citationStyle: 'harvard',
          refsById: new Map([['s1', SMITH]]),
          yearSuffixes: null,
          onCiteChipMenu: (info) => { seen.menu = info; },
          onCiteChipHover: (info) => { seen.hover = info; },
        }} />,
    );
    expect(html).toContain('(Smith, 2020)');
    // …and WITHOUT the bag it is the old numeric chip — the test is not vacuous
    const bare = renderToStaticMarkup(
      <AbstractEditor value={ABSTRACT_MD} templateId="generic" orderMap={new Map([['s1', 1]])}
        resetKey="k" onChange={noop} />,
    );
    expect(bare).not.toContain('(Smith, 2020)');
    expect(bare).toContain('[1]');
  });

  it('per-FIELD props still win over the shared bag (a bag cannot steal an identity)', () => {
    const html = renderToStaticMarkup(
      <AbstractEditor value={ABSTRACT_MD} templateId="generic" orderMap={new Map()} resetKey="k"
        onChange={noop}
        fieldProps={{ testId: 'WRONG', value: 'WRONG', ariaLabel: 'WRONG', placeholder: 'WRONG' }} />,
    );
    expect(html).not.toContain('WRONG');
    expect(html).toContain('data-testid="stitch-manuscript-abstract-field-0"');
    expect(html).toContain('aria-label="Abstract — Background"');
  });

  it('the bag is a PROJECTION of the one editor factory, not a second prop list', () => {
    expect(panels).toContain('const sharedFieldProps = (id) => {');
    expect(panels).toContain('const p = editorProps(id);');
    for (const prop of [
      'citationStyle: p.citationStyle', 'refsById: p.refsById', 'yearSuffixes: p.yearSuffixes',
      'onCiteChipMenu: p.onCiteChipMenu', 'onCiteChipHover: p.onCiteChipHover',
      'onAssetChipMenu: p.onAssetChipMenu', 'onAssetChipHover: p.onAssetChipHover',
      'facts: p.facts', 'showChanges: p.showChanges', 'knownAssetIds: p.knownAssetIds',
    ]) expect(panels, `${prop} is missing from the shared bag`).toContain(prop);
    // handed to the abstract with the OWNING section named, so every chip action
    // routes back to 'abstract' (openCiteMenu/apiFor read info.sectionId)
    expect(panels).toContain("fieldProps: sharedFieldProps('abstract'),");
    expect(panels).toContain('onCiteChipMenu: (info) => openCiteMenu({ ...info, sectionId: id }),');
    expect(panels).toContain('const api = apiFor(citeMenu && citeMenu.sectionId) || getApi();');
    // and AbstractEditor spreads it into every field it mounts
    expect((abstractSrc.match(/\{\.\.\.field\}/g) || []).length).toBe(2); // structured + free-form
  });

  it('the popover layer is the panel\'s, and the abstract is NOT excluded from it', () => {
    // The chip menus/hover cards render as siblings of the page content, gated only
    // on "not the bare title screen" — the abstract has always been inside that gate,
    // which is why threading the callbacks is the whole fix.
    expect(panels).toContain('{(continuous || !isTitle) && citeMenu && (');
    expect(panels).toContain('{(continuous || !isTitle) && !citeMenu && citeHover && (');
    expect(panels).toContain('{(continuous || !isTitle) && chipMenu && (');
    // the ONE surface deliberately kept away from the abstract stays that way
    expect(panels).toContain('{tableCtx && (continuous || (!isTitle && !isAbstract && !locked)) && (');
  });

  it('the abstract renders inside the same .ms-paper the popovers anchor to', () => {
    const html = renderToStaticMarkup(
      <EditorPanel m={mockM(makeDraft())} exporters={null} view="continuous" />,
    );
    expect((html.match(/class="ms-paper"/g) || []).length).toBe(1);
    const paperAt = html.indexOf('class="ms-paper"');
    expect(html.indexOf('data-testid="stitch-manuscript-abstract-field-0"')).toBeGreaterThan(paperAt);
  });
});

/* ══════════════ §8.2 — a generation invalidates the pending overlay ══════════════ */

describe('118.md §8.2 — the live-section overlay drops after a regeneration', () => {
  const secs = (over = {}) => ({
    methods: { content: 'stored methods', lastGeneratedAt: '' },
    results: { content: 'stored results', lastGeneratedAt: '' },
    ...over,
  });

  it('keeps the overlay while the store is genuinely behind (unchanged behaviour)', () => {
    const r = settleLiveSections({ methods: 'typed methods' }, secs(), new Map([['methods', '']]));
    expect(r.changed).toBe(false);
    expect(r.next).toEqual({ methods: 'typed methods' });
  });

  it('drops it once the store matches (unchanged behaviour)', () => {
    const r = settleLiveSections(
      { methods: 'typed methods' },
      secs({ methods: { content: 'typed methods', lastGeneratedAt: '' } }),
      new Map([['methods', '']]),
    );
    expect(r.changed).toBe(true);
    expect(r.next).toBe(null);
  });

  it('type → GENERATE the same section → the stale overlay is gone immediately', () => {
    // typed at generation stamp '' …
    const stamps = new Map([['methods', '']]);
    const live = { methods: 'half a sentence the writer typed' };
    // … then a generation rewrote the section under it.
    const after = secs({ methods: { content: 'Generated Methods text.', lastGeneratedAt: '2026-08-15T10:00:00.000Z' } });
    const r = settleLiveSections(live, after, stamps);
    expect(r.changed).toBe(true);
    expect(r.invalidated).toEqual(['methods']);
    expect(r.next).toBe(null);
    // the old rule would have kept it forever: the two strings never match again
    expect(after.methods.content).not.toBe(live.methods);
  });

  it('only the REGENERATED section is invalidated — other pending text survives', () => {
    const r = settleLiveSections(
      { methods: 'typed methods', results: 'typed results' },
      secs({ methods: { content: 'Generated Methods.', lastGeneratedAt: '2026-08-15T10:00:00.000Z' } }),
      new Map([['methods', ''], ['results', '']]),
    );
    expect(r.invalidated).toEqual(['methods']);
    expect(r.next).toEqual({ results: 'typed results' });
  });

  it('text typed AFTER the generation is kept (the stamp travels with the entry)', () => {
    const gen = '2026-08-15T10:00:00.000Z';
    const r = settleLiveSections(
      { methods: 'edited the generated text' },
      secs({ methods: { content: 'Generated Methods.', lastGeneratedAt: gen } }),
      new Map([['methods', gen]]),
    );
    expect(r.changed).toBe(false);
    expect(r.next).toEqual({ methods: 'edited the generated text' });
  });

  it('a plain object of stamps works as well as a Map (no hidden Map contract)', () => {
    const r = settleLiveSections(
      { methods: 'typed' },
      secs({ methods: { content: 'Generated.', lastGeneratedAt: 'X' } }),
      { methods: '' },
    );
    expect(r.next).toBe(null);
  });

  it('a null overlay is a no-op', () => {
    expect(settleLiveSections(null, secs(), new Map())).toEqual({ next: null, changed: false, invalidated: [] });
  });

  it('the hook stamps every write and settles through the ONE shared rule', () => {
    const hook = readSource('src/features/manuscript/useManuscript.js');
    expect(hook).toContain('const liveGenStamps = useRef(new Map());');
    expect(hook).toContain("liveGenStamps.current.set(id, (s && s.lastGeneratedAt) || '');");
    expect(hook).toContain('MS.settleLiveSections(liveSections, activeDraft.sections, stamps)');
    // the stamps map is cleaned up with the entries it describes (no unbounded growth)
    expect(hook).toContain('for (const id of invalidated) stamps.delete(id);');
    expect(hook).toContain('if (!next) stamps.clear();');
    // and the rule itself is pure — it lives with the other draft helpers
    expect(hook).not.toContain('const stillAhead = Object.keys(liveSections)');
  });
});

/* ══════════════ r3 — ONE title block ══════════════ */

describe('118.md r3 — the title block exists ONCE and both views render it', () => {
  const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
  const doc = readSource('src/features/manuscript/ContinuousView.jsx');

  it('renders the title + keywords inputs with the historical test ids', () => {
    const html = renderToStaticMarkup(
      <TitleBlock value="A pooled analysis of X" keywords="systematic review" onTitle={noop} onKeywords={noop} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-title-block"');
    expect(html).toContain('data-testid="stitch-manuscript-title-input"');
    expect(html).toContain('aria-label="Manuscript title"');
    expect(html).toContain('aria-label="Keywords"');
    expect(html).toContain('Keywords (comma-separated)');
    expect(html).toContain('A pooled analysis of X');
    expect(html).toContain('systematic review');
  });

  it('paints in INK — the page is literally white in both themes', () => {
    const html = renderToStaticMarkup(<TitleBlock value="T" keywords="" onTitle={noop} onKeywords={noop} />);
    expect(html).toContain(INK.text);
    expect(html).toContain(INK.rule);
    expect(html).toContain(INK.soft);
    expect(html).not.toContain('var(--t-');
  });

  it('a locked title section disables BOTH inputs', () => {
    const html = renderToStaticMarkup(<TitleBlock value="T" keywords="k" locked onTitle={noop} onKeywords={noop} />);
    expect((html.match(/disabled=""/g) || []).length).toBe(2);
  });

  it('reports the raw string AND the parsed list, so both views agree on the parse', () => {
    let raw = null; let list = null;
    // the parse lives in the component; assert it through the same code path the
    // views call, rather than duplicating the split in the test
    const onKeywords = (r, l) => { raw = r; list = l; };
    const el = TitleBlock({ value: 'T', keywords: '', onTitle: noop, onKeywords });
    const input = el.props.children[1].props.children[1];
    input.props.onChange({ target: { value: ' a, b ,, c ' } });
    expect(raw).toBe(' a, b ,, c ');
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('Section View renders the SHARED block, not a second hand-written copy', () => {
    const html = renderToStaticMarkup(<EditorPanel m={mockM(makeDraft())} exporters={null} />);
    expect(html).toContain('data-testid="stitch-manuscript-title-block"');
    expect(html).toContain('data-testid="stitch-manuscript-title-input"');
    expect(panels).toContain('TitleBlock,');
    expect(panels).toContain('<TitleBlock');
    // the literal-hex copy is GONE from the panel (this is what drifted)
    expect(panels).not.toContain('#1c2330');
    expect(panels).not.toContain('#e2e6ee');
    expect(panels).not.toContain('#98a1b3');
    expect(panels).not.toContain('Keywords (comma-separated)');
  });

  it('Continuous View renders the same block, once', () => {
    const html = renderToStaticMarkup(
      <EditorPanel m={mockM(makeDraft())} exporters={null} view="continuous" />,
    );
    expect((html.match(/data-testid="stitch-manuscript-title-block"/g) || []).length).toBe(1);
    expect((html.match(/data-testid="stitch-manuscript-title-input"/g) || []).length).toBe(1);
    // it still sits inside the title anchor the outline and the observer scroll to
    const anchorAt = html.indexOf('data-testid="stitch-manuscript-doc-title"');
    expect(anchorAt).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="stitch-manuscript-title-block"')).toBeGreaterThan(anchorAt);
    // …and the component itself declares the one-way dependency it lives under
    expect(doc).toContain('export function TitleBlock(');
    expect(doc).not.toContain('manuscriptPanels');
  });
});
