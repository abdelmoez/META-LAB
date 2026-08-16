/**
 * 118.md §10-§19 / §43 / §45 / §60 / §64-§65 — the Continuous Document View and the
 * view switcher (SSR contract tests, house style: renderToStaticMarkup, no jsdom —
 * behaviour that only exists at runtime is pinned through the PURE helpers and
 * through source pins, the readSource.js technique).
 *
 * Covered here:
 *   - the document  : every section, in order, inside ONE paper; real headings; the
 *                     abstract's structured editor; declarations; a READ-ONLY
 *                     rendered bibliography (§11/§14/§21/§60).
 *   - eager mount   : all ten editors exist at first paint — no virtualization, no
 *                     "loads when it scrolls into view" blanking (§19).
 *   - one state     : both views mount from the SAME prop factory, the numbering
 *                     comes from the LIVE draft (never a single-section buffer), and
 *                     the mount value is the COMMITTED draft (§13/§18).
 *   - the switcher  : radiogroup semantics, both labels, tooltips, roving tabindex,
 *                     the toolbar slot, and the per-user persistence key (§12/§42).
 *   - navigation    : the sticky-toolbar offset, the smooth/reduced-motion rule and
 *                     the IntersectionObserver active-section rule (§15-§17, §58).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import { EditorPanel } from '../../../src/features/manuscript/manuscriptPanels.jsx';
import {
  ContinuousView, BODY_SECTIONS, DOC_SECTION_IDS, docSectionTestId, msSectionSelector,
  MS_SECTION_ATTR, SCROLL_GAP, INK,
} from '../../../src/features/manuscript/ContinuousView.jsx';
import {
  ManuscriptViewSwitcher, ManuscriptToolbar, MANUSCRIPT_VIEWS, MANUSCRIPT_VIEW_IDS,
  DEFAULT_MANUSCRIPT_VIEW, normalizeManuscriptView, MANUSCRIPT_TOOLBAR_CSS,
} from '../../../src/features/manuscript/ManuscriptToolbar.jsx';
import { viewPrefKey, readStoredView } from '../../../src/features/manuscript/ManuscriptWorkspace.jsx';
// 119.md §3 — the href builder is asserted BEHAVIOURALLY as well as by source text:
// the symmetric omit-the-default rule is what Back/Forward depends on.
import { manuscriptSubHref } from '../../../src/frontend/stitch/nav/navConfig.js';
import { makeManuscriptDraft, normalizeDraft, SECTION_TYPES } from '../../../src/research-engine/manuscript/model.js';

const noop = () => {};

function makeDraft() {
  const d = normalizeDraft(makeManuscriptDraft({ title: 'A pooled analysis of X' }));
  d.sections.title.content = 'A pooled analysis of X';
  d.sections.abstract.content = '**Background.** Why.\n\n**Methods.** How.\n\n**Results.** What.\n\n**Conclusions.** So what.';
  d.sections.introduction.content = 'Systematic reviews synthesise evidence.';
  d.sections.methods.content = '## Eligibility criteria\n\nWe included trials [[cite:s1]].';
  d.sections.results.content = 'Three trials were included.';
  d.sections.discussion.content = 'The pooled estimate favours treatment.';
  d.sections.limitations.content = 'Few trials.';
  d.sections.conclusion.content = 'Treatment may help.';
  d.keywords = ['systematic review'];
  return d;
}

function mockM(draft, extra = {}) {
  return {
    activeDraft: draft,
    liveDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    references: [
      { id: 's1', index: 1, text: 'Smith J. Trial A. Lancet. 2020.', ref: { authorsList: [{ family: 'Smith' }], year: '2020' }, cited: true },
      { id: 's2', index: 2, text: 'Lee K. Trial B. NEJM. 2021.', ref: { authorsList: [{ family: 'Lee' }], year: '2021' }, cited: false },
    ],
    citationOrderMap: new Map([['s1', 1], ['s2', 2]]),
    referenceAliases: {}, referenceKnownIds: new Set(['s1', 's2']), refsById: new Map(),
    citationYearSuffixes: null,
    prismaCounts: { counts: {}, provenance: {}, warnings: [] },
    insights: [], readiness: null, staleness: {}, tables: {},
    assets: [], assetNumbering: { byId: {} }, knownAssetIds: new Set(), manualTables: [],
    outdated: { results: true }, placeholders: [], placeholderStats: null, changeGroups: [],
    saveState: 'saved', lastError: null, retry: noop,
    updateSection: noop, setMeta: noop, setMetaDebounced: noop, setStatement: noop,
    setSectionLocked: noop, setTableMeta: noop, setCurrentPlaceholderId: noop,
    generate: () => ({ skipped: [] }), refreshBlock: noop, refreshAllBlocks: noop,
    flush: noop, sourcesSettled: true,
    ...extra,
  };
}

const continuousHtml = (extra) => renderToStaticMarkup(
  <EditorPanel m={mockM(makeDraft(), extra)} exporters={null} view="continuous" />,
);

/* ══════════════ the document (§11/§14/§60) ══════════════ */

describe('118.md §11/§14/§60 — the manuscript reads as ONE document', () => {
  const html = continuousHtml();

  it('renders the continuous document inside the ONE paper page', () => {
    expect(html).toContain('data-testid="stitch-manuscript-continuous"');
    // exactly one page, exactly one paper — not a stack of cards (§11)
    expect((html.match(/data-testid="stitch-manuscript-page"/g) || []).length).toBe(1);
    expect((html.match(/class="ms-paper"/g) || []).length).toBe(1);
    expect(html).toContain('data-view="continuous"');
  });

  it('carries every section, in canonical manuscript order', () => {
    let cursor = -1;
    for (const s of SECTION_TYPES) {
      const at = html.indexOf(`data-testid="${docSectionTestId(s.id)}"`);
      expect(at, `${s.id} block is missing`).toBeGreaterThan(-1);
      expect(at, `${s.id} is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // …and each one is a scroll/observe anchor (§15/§16)
    for (const id of DOC_SECTION_IDS) expect(html).toContain(`${MS_SECTION_ATTR}="${id}"`);
  });

  it('section headings are real document headings, not card titles', () => {
    for (const s of BODY_SECTIONS) expect(html).toMatch(new RegExp(`<h2[^>]*>${s.label}</h2>`));
    expect(html).toMatch(/<h2[^>]*>Abstract<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>References<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Declarations<\/h2>/);
  });

  it('opens with the title block and the keywords, not a section picker', () => {
    expect(html).toContain('data-testid="stitch-manuscript-title-input"');
    expect(html).toContain('A pooled analysis of X');
    expect(html).toContain('Keywords (comma-separated)');
    expect(html).toContain('aria-label="Keywords"');
  });

  it('the abstract keeps its structured subsection editor', () => {
    expect(html).toContain('data-testid="stitch-manuscript-abstract-editor"');
    expect(html).toContain('data-testid="stitch-manuscript-abstract-field-0"');
  });

  it('the outline column stays visible in the continuous view (§15)', () => {
    for (const s of SECTION_TYPES) expect(html).toContain(`data-testid="stitch-manuscript-section-${s.id}"`);
    expect(html).toContain('data-testid="stitch-manuscript-tools"');
  });

  it('§14 — the page keeps a document reading width rather than the full monitor', () => {
    const page = html.slice(html.indexOf('data-testid="stitch-manuscript-page"'));
    expect(page.slice(0, page.indexOf('>'))).toMatch(/max-width:760px/);
  });
});

/* ══════════════ eager mount (§19) ══════════════ */

describe('118.md §19 — every section is mounted, none is blanked', () => {
  const html = continuousHtml();

  it('all body editors exist at first paint (no virtualization, no scroll gate)', () => {
    for (const s of BODY_SECTIONS) {
      expect(html, `${s.id} editor missing`).toContain(`data-testid="stitch-manuscript-rich-editor-${s.id}"`);
    }
    // Effects do NOT run under renderToStaticMarkup, so an IntersectionObserver-gated
    // mount would show up here as a missing editor. This is the regression guard for
    // "do not sacrifice editing reliability to over-optimize prematurely".
    expect((html.match(/class="ms-rich ms-page-body"/g) || []).length)
      .toBeGreaterThanOrEqual(BODY_SECTIONS.length);
  });

  it('each mounted editor is editable — the document is not a read-only preview (§18)', () => {
    const intro = html.slice(html.indexOf('data-testid="stitch-manuscript-rich-editor-introduction"') - 400);
    expect(intro.slice(0, 600)).toContain('contenteditable="true"');
  });

  it('the shared formatting toolbar is present, and acts on the caret owner', () => {
    expect(html).toContain('data-testid="stitch-manuscript-toolbar"');
    expect(html).toContain('data-testid="stitch-manuscript-tb-bold"');
    expect(html).toContain('data-testid="stitch-manuscript-crossref-open"');
  });
});

/* ══════════════ per-section chrome (§11) ══════════════ */

describe('118.md §11 — per-section chrome is real, and subordinate', () => {
  const html = continuousHtml();

  it('every section carries its own status row with lock / regenerate / Why?', () => {
    for (const s of BODY_SECTIONS) {
      expect(html).toContain(`data-testid="stitch-manuscript-doc-chrome-${s.id}"`);
      expect(html).toContain(`data-testid="stitch-manuscript-doc-lock-${s.id}"`);
      expect(html).toContain(`data-testid="stitch-manuscript-doc-why-${s.id}"`);
    }
    // Regenerate appears only where there IS something to regenerate (§69).
    expect(html).toContain('data-testid="stitch-manuscript-doc-regenerate-results"');
    expect(html).not.toContain('data-testid="stitch-manuscript-doc-regenerate-methods"');
    expect(html).toContain('data-testid="stitch-manuscript-doc-outdated-results"');
  });

  it('the page chrome names the DOCUMENT instead of repeating one section', () => {
    expect(html).toContain('Full manuscript');
    // the single-section badges/actions belong to Section View
    expect(html).not.toContain('data-testid="stitch-manuscript-lock-toggle"');
    expect(html).not.toContain('data-testid="stitch-manuscript-why-toggle"');
    expect(html).not.toContain('data-testid="stitch-manuscript-outdated-badge"');
  });

  it('a locked section renders read-only, in the document', () => {
    const draft = makeDraft();
    draft.sections.methods.locked = true;
    const locked = renderToStaticMarkup(<EditorPanel m={mockM(draft)} exporters={null} view="continuous" />);
    const methods = locked.slice(locked.indexOf('data-testid="stitch-manuscript-doc-methods"'));
    expect(methods.slice(0, 2600)).toContain('aria-readonly="true"');
    expect(locked).toContain('data-testid="stitch-manuscript-doc-locked-methods"');
  });
});

/* ══════════════ declarations + references (§11/§21) ══════════════ */

describe('118.md §11/§21 — declarations and a rendered bibliography end the document', () => {
  const html = continuousHtml();

  it('declarations are editable in place, through the same setStatement path', () => {
    expect(html).toContain('data-testid="stitch-manuscript-continuous-statements"');
    for (const label of ['Funding', 'Conflicts of interest', 'Data availability', 'Ethics approval']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('data-testid="stitch-manuscript-doc-statement-funding"');
  });

  it('the bibliography is RENDERED and READ-ONLY — the library lives in References', () => {
    expect(html).toContain('data-testid="stitch-manuscript-continuous-references"');
    expect(html).toContain('Smith J. Trial A. Lancet. 2020.');
    expect(html).toContain('data-testid="stitch-manuscript-continuous-reference-s1"');
    const refs = html.slice(html.indexOf('data-testid="stitch-manuscript-continuous-references"'));
    expect(refs).not.toContain('<input');
    expect(refs).not.toContain('<textarea');
    expect(refs).not.toContain('contenteditable="true"');
    // …and it says where the real manager is (§21), rather than pretending to be one.
    expect(refs).toContain('data-testid="stitch-manuscript-continuous-references-open"');
    expect(refs).toContain('Add, edit or import references in the References tab');
  });

  it('an empty library says so instead of rendering an empty list (§39/§69)', () => {
    const html2 = continuousHtml({ references: [] });
    expect(html2).toContain('No references yet — they appear here as you cite them');
    expect(html2).not.toContain('data-testid="stitch-manuscript-continuous-reference-list"');
  });
});

/* ══════════════ one manuscript, not two (§13/§18) ══════════════ */

describe('118.md §13/§18 — one state, one prop factory, one write path', () => {
  const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
  const doc = readSource('src/features/manuscript/ContinuousView.jsx');
  const hook = readSource('src/features/manuscript/useManuscript.js');

  it('both views mount their editors from the SAME factory', () => {
    expect(panels).toContain('const editorProps = (id) => {');
    // Section View
    expect(panels).toContain('<RichSectionEditor key={mainEditor.mountKey} ref={mainEditor.apiRef} {...mainEditor} />');
    // Continuous View
    expect(doc).toContain('<RichSectionEditor key={props.mountKey} ref={props.apiRef} {...props} />');
  });

  /* RE-PINNED by 119.md §7. The key was section identity + generation stamp, which
     covered the two ways prose changed from outside the editor at the time (a
     generate, a draft switch). Two more arrived since — a snapshot RESTORE and a
     structure switch that MERGES one section's text into another — and neither
     moves `lastGeneratedAt`, so the mounted editor kept rendering the pre-change
     paragraph and the next keystroke committed it back over the new text. The
     `contentEpoch` component is a mount-lifetime counter (never persisted) meaning
     "the draft's prose was replaced wholesale". The 118 contract is otherwise
     unchanged: one DOM render per key, mounted from the COMMITTED draft. */
  it('the per-section mount key is section identity + generation stamp + content epoch', () => {
    expect(panels).toContain('mountKey: `${m.activeId}:${id}:${sec.lastGeneratedAt || \'\'}:${m.contentEpoch || 0}`');
    // …and the MOUNT VALUE is the committed draft, never a buffer.
    expect(panels).toContain("value: sec.content || ''");
  });

  it('editing goes through ONE write path in both views', () => {
    expect(panels).toContain('onChange: (md) => commitSection(id, md)');
    expect(panels).toContain('const commitSection = useCallback((id, val) => {');
    expect(panels).toContain('m.updateSection(id, val);');
    // no second manuscript buffer survives: only the plain-input title is buffered
    expect(panels).not.toContain('const [buf, setBuf] = useState(section.content');
  });

  it('numbering and outline read the LIVE draft, never a single-section override', () => {
    expect(panels).toContain('const liveDraft = m.liveDraft || m.activeDraft;');
    expect(panels).toContain('const orderMap = m.citationOrderMap || orderMapFallback;');
    expect(panels).toContain("const md = ((liveDraft.sections || {})[s.id] || {}).content || '';");
    // the pre-118 buf override is gone
    expect(panels).not.toContain('SECTION_IDS[i] === sel ? buf : t');
    // and the hook exposes the live draft it already derives everything else from
    expect(hook).toContain('    liveDraft,');
  });

  it('one api per mounted section; the toolbar still follows the caret', () => {
    expect(panels).toContain('const apis = useRef(new Map());');
    // r2 — the fallback chain: the caret's own handle, then the LIVE registry entry
    // for the caret's section (a regenerate remounts that editor and drops the
    // handle), and only then the selected section.
    expect(panels).toContain('const getApi = () => activeApi.current\n'
      + '    || (activeSectionRef.current ? apis.current.get(activeSectionRef.current) : null)\n'
      + '    || apis.current.get(sel)\n'
      + '    || null;');
    // chip menus / table ops are routed by the OWNING section, not by the caret
    expect(panels).toContain('setChipMenu({ ...info, sectionId: id })');
    expect(panels).toContain('onCiteChipMenu: (info) => openCiteMenu({ ...info, sectionId: id })');
    expect(panels).toContain('getApi={() => apiFor(tableCtx.sectionId) || getApi()}');
  });

  /* r2 — a regenerate changes the section's mountKey, so React unmounts the editor
     instance the caret was in. `activeApi` used to keep pointing at the dead one and
     every toolbar action silently no-op'd until the writer clicked back into the
     text. The registry callback ref is the ONE place that knows an instance died. */
  it('r2 — a remounted section replaces (never orphans) the caret handle', () => {
    expect(panels).toContain('if (activeSectionRef.current === s.id) activeApi.current = api;');
    expect(panels).toContain('if (activeSectionRef.current === s.id) activeApi.current = null;');
    // …and leaving a section in Section View clears the OWNER, not just the handle.
    expect(panels).toContain('activeSectionRef.current = null;');
  });

  /* r2 — in Continuous View `sel` is written by the IntersectionObserver as the
     reader scrolls. Gating the shared editing tools on it meant a locked section
     drifting through the reading band disabled Bold and "+ Cite…" for a caret in an
     unlocked section four screens up. Scroll position is not an editing permission. */
  it('r2 — the editing tools are gated on the CARET-owning section, not on scroll', () => {
    expect(panels).toContain('const toolSectionId = continuous ? caretSection : sel;');
    expect(panels).toContain('const toolsLocked = !!(toolSectionId && (sections[toolSectionId] || {}).locked);');
    expect(panels).toContain('disabled={toolsLocked}');
    // every Insert control in the Tools column follows the same rule …
    expect(panels).not.toMatch(/disabled=\{\(!continuous && isTitle\) \|\| locked\}/);
    // … and the runtime guards resolve the section the insert would LAND in.
    expect(panels).toContain('const targetLocked = () => {');
    for (const guard of ['insertCitation', 'insertPrisma', 'insertAssetRef']) {
      const at = panels.indexOf(`const ${guard} = (`);
      expect(at, guard).toBeGreaterThan(-1);
      expect(panels.slice(at, at + 260)).toContain('targetLocked()');
    }
    // the caret owner is real render state, written where the caret actually lands
    expect(panels).toContain('const [caretSection, setCaretSection] = useState(null);');
    expect(panels).toContain('setCaretSection(s.id);');
  });

  /* r2 §71 — a writer four thousand pixels into the document had scrolled the only
     formatting and citation controls off the top of the page. The tools column is
     not a substitute: it has no Bold, no Italic, no heading levels. */
  it('r2 §71 — the format toolbar sticks below the manuscript toolbar in Continuous View', () => {
    expect(panels).toContain("position: 'sticky', top: barH, zIndex: 19,");
    // MEASURED offset (the same value the outline pins against), never a constant …
    expect(panels).toContain('const barH = useStickyBarHeight();');
    // … and it degrades to a normal toolbar when the bar has not been measured.
    expect(panels).toContain('data-testid="stitch-manuscript-toolbar-dock"');
    expect(panels).toContain("data-sticky={continuous && barH > 0 ? 'true' : undefined}");
    expect(panels).toContain('style={continuous && barH > 0 ? {');
    // z stays UNDER the manuscript toolbar's 20 (ARCH-118: sticky chrome ≤ 20).
    const at = panels.indexOf("position: 'sticky', top: barH, zIndex: 19,");
    expect(panels.slice(at, at + 220)).toContain('background: C.bg');
  });

  it('the RICH_EDITOR_CSS is still injected exactly once', () => {
    expect((panels.match(/<style>\{RICH_EDITOR_CSS\}<\/style>/g) || []).length).toBe(1);
    // the document view injects no stylesheet of its own — it renders INSIDE the
    // page the panel already styled
    expect(doc).not.toContain('<style>');
    expect((continuousHtml().match(/\.ms-paper\{background:#ffffff/g) || []).length).toBe(1);
  });

  it('the document paints in PAPER ink, never in theme tokens', () => {
    // The page is literally white in both themes (RICH_EDITOR_CSS), so a --t- colour
    // inside it would be a dark-theme colour on a white page.
    // (the module header names the rule; the check is on the CODE below it)
    const body = doc.slice(doc.indexOf('export const INK'));
    expect(body).not.toContain('var(--t-');
    expect(INK.text).toBe('#1c2330');
  });
});

/* ══════════════ navigation (§15-§17, §58) ══════════════ */

describe('118.md §15-§17 — navigation inside the document', () => {
  const doc = readSource('src/features/manuscript/ContinuousView.jsx');
  const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');

  it('clicking a section SCROLLS, and never leaves the continuous view (§15)', () => {
    expect(panels).toContain('const goToSection = (id) => {\n    if (!continuous) { switchTo(id); return; }');
    expect(panels).toContain('scrollToSection(id);');
    expect(panels).toContain('onClick={() => goToSection(s.id)}');
  });

  it('the scroll offset is the LIVE sticky toolbar, so the heading lands below it (§17)', () => {
    expect(doc).toContain("document.querySelector('[data-testid=\"stitch-manuscript-header\"]')");
    expect(doc).toContain('const delta = Math.round(el.getBoundingClientRect().top - stickyFloor(el) - SCROLL_GAP);');
    expect(SCROLL_GAP).toBeGreaterThan(0);
    // scrollIntoView cannot express "below a sticky bar" — the delta scroll can.
    expect(doc).toContain('target.scrollBy({ top: delta, left: 0, behavior })');
  });

  it('§58 — smooth by default, instant under prefers-reduced-motion', () => {
    expect(doc).toContain("const behavior = (opts.instant || prefersReducedMotion()) ? 'auto' : 'smooth';");
    expect(doc).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    // heading jumps inside a section respect it too
    expect(panels).toContain("behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center'");
  });

  it('heading navigation is scoped to the OWNING editor root', () => {
    expect(panels).toContain('return continuous ? page.querySelector(`${msSectionSelector(secId)} .ms-rich`) : page;');
    expect(msSectionSelector('methods')).toBe('[data-ms-section="methods"]');
  });

  it('§16 — IntersectionObserver drives the active section, with the toolbar in the margin', () => {
    expect(doc).toContain('new IntersectionObserver');
    expect(doc).toContain('rootMargin: `-${top}px 0px -${bottom}px 0px`');
    expect(doc).toContain('const top = Math.max(0, Math.round(stickyFloor(root) - rootTop));');
    // topmost-visible wins → no flip-flop at a boundary, and the tops are
    // RE-MEASURED at decision time (entries from different moments are not comparable)
    expect(doc).toContain('if (t != null && t < bestTop) { bestTop = t; bestId = id; }');
    expect(doc).toContain("const topOf = (el) => ((el && typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect().top : null);");
    // scrolled PAST the last section (into declarations/references) → the last
    // section that started stays active; the indicator is never cleared
    expect(doc).toContain('if (t != null && t <= floor && t > lastTop) { lastTop = t; bestId = id; }');
    expect(doc).toContain('if (bestId && onActiveRef.current) onActiveRef.current(bestId);');
    // a programmatic scroll owns the indicator until it settles — and the update is
    // DEFERRED rather than dropped, or the indicator would stay where it came from
    expect(doc).toContain('const until = (suppressRef && suppressRef.current) || 0;');
    expect(doc).toContain('deferred = setTimeout(apply, (until - Date.now()) + 60);');
    // no IntersectionObserver → click-driven only, never a broken indicator
    expect(doc).toContain("if (typeof IntersectionObserver === 'undefined') return undefined;");
  });

  it('the outline marks the active section for assistive tech as well as the eye', () => {
    const html = continuousHtml();
    expect(html).toMatch(/data-testid="stitch-manuscript-section-title"[^>]*data-active="true"/);
    expect(html).toContain('aria-current="true"');
  });

  it('§19 — no remount race: the reveal is a direct call when every section is mounted', () => {
    expect(panels).toContain('if (!(wantsAsset && revealAssetIn(id, sectionRequest))) scrollToSection(id);');
    expect(panels).toContain('if (!revealPlaceholderIn(p.sectionId, p)) scrollToSection(p.sectionId);');
  });
});

/* ══════════════ the view switcher (§12/§42) ══════════════ */

describe('118.md §12 — the view switcher', () => {
  const html = renderToStaticMarkup(<ManuscriptViewSwitcher view="sections" onChange={noop} />);

  it('offers exactly the two views, in the prompt\'s own terminology', () => {
    expect(MANUSCRIPT_VIEW_IDS).toEqual(['sections', 'continuous']);
    expect(MANUSCRIPT_VIEWS.map((v) => v.label)).toEqual(['Section View', 'Continuous View']);
    expect(html).toContain('Section View');
    expect(html).toContain('Continuous View');
    // 119.md §3 (re-pinned from 'sections') — a manuscript is ONE document, and the
    // view that shows it as one is what a researcher with no stored preference opens.
    expect(DEFAULT_MANUSCRIPT_VIEW).toBe('continuous');
  });

  it('is ONE setting with two exclusive states (radiogroup), not two toggles', () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Manuscript view"');
    expect((html.match(/role="radio"/g) || []).length).toBe(2);
    expect((html.match(/aria-checked="true"/g) || []).length).toBe(1);
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="stitch-manuscript-view-sections"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-testid="stitch-manuscript-view-continuous"/);
    // roving tabindex (APG) — one stop for the whole control
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) || []).length).toBe(1);
  });

  it('carries icons and tooltips that say what each view DOES (§12)', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('title="Section View — write one section at a time');
    expect(html).toContain('title="Continuous View — read and edit the whole manuscript as one scrolling document"');
  });

  it('condenses to short labels without losing the accessible name (§41)', () => {
    const small = renderToStaticMarkup(<ManuscriptViewSwitcher view="continuous" onChange={noop} condensed />);
    expect(small).toContain('>Sections</button>');
    expect(small).toContain('>Continuous</button>');
    expect(small).toContain('aria-label="Section View"');
    expect(small).toMatch(/aria-checked="true"[^>]*data-testid="stitch-manuscript-view-continuous"/);
  });

  it('an unknown stored/URL value resolves to the default view', () => {
    // A KNOWN value is always honoured — that is how an explicitly saved 'sections'
    // preference keeps winning after the 119.md §3 default flip.
    expect(normalizeManuscriptView('continuous')).toBe('continuous');
    expect(normalizeManuscriptView('sections')).toBe('sections');
    // …and only the unknown/absent cases follow the default (re-pinned, §3).
    expect(normalizeManuscriptView('nonsense')).toBe('continuous');
    expect(normalizeManuscriptView(undefined)).toBe('continuous');
    expect(normalizeManuscriptView('nonsense')).toBe(DEFAULT_MANUSCRIPT_VIEW);
  });

  it('lives in the toolbar, and ONLY on the Editor destination', () => {
    const draft = makeDraft();
    const bar = (tab) => renderToStaticMarkup(
      <ManuscriptToolbar m={mockM(draft)} tab={tab} onTabChange={noop}
        viewSwitcher={({ condensed }) => <ManuscriptViewSwitcher view="sections" onChange={noop} condensed={condensed} />} />,
    );
    expect(bar('editor')).toContain('data-testid="stitch-manuscript-view-switcher"');
    expect(bar('overview')).not.toContain('data-testid="stitch-manuscript-view-switcher"');
    expect(bar('tables')).not.toContain('data-testid="stitch-manuscript-view-switcher"');
  });

  it('its hover rules stay scoped to the toolbar', () => {
    for (const rule of MANUSCRIPT_TOOLBAR_CSS.split('}').map((r) => r.trim()).filter(Boolean)) {
      expect(rule.startsWith('.ms-toolbar ')).toBe(true);
    }
    expect(MANUSCRIPT_TOOLBAR_CSS).toContain('.ms-toolbar .ms-view-btn:hover');
  });
});

/* ══════════════ persistence + URL (§12/§45/§47) ══════════════ */

describe('118.md §12/§47 — the view preference is remembered, per user', () => {
  const original = globalThis.localStorage;
  afterEach(() => {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  });
  const fakeStorage = (value) => {
    globalThis.localStorage = {
      getItem: () => value,
      setItem: () => {},
    };
  };

  it('keys the preference per user, and never touches the project blob', () => {
    expect(viewPrefKey('user-7')).toBe('metalab.manuscriptView.user-7');
    expect(viewPrefKey(null)).toBe(null);
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    expect(ws).toContain('localStorage.setItem(key, view)');
    expect(ws).not.toContain('upd(');
  });

  it('reads a stored preference, and ignores a corrupted one', () => {
    fakeStorage('continuous');
    expect(readStoredView('metalab.manuscriptView.u')).toBe('continuous');
    fakeStorage('nonsense');
    expect(readStoredView('metalab.manuscriptView.u')).toBe(null);
    fakeStorage('continuous');
    expect(readStoredView(null)).toBe(null);
  });

  it('§45 — every view toggle flushes the pending edit first', () => {
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    const setView = ws.slice(ws.indexOf('const setView = useCallback('), ws.indexOf('const setView = useCallback(') + 700);
    expect(setView).toContain('if (m.flush) m.flush();');
    expect(setView.indexOf('m.flush()')).toBeLessThan(setView.indexOf('setViewState(id)'));
  });

  /* r2 — DATA LOSS. `setView` is not the only way the view changes: browser
     Back/Forward (and any host href) walks `?msv=` and lands in the [initialView]
     reconcile effect instead. That path wrote the new view WITHOUT flushing, so
     text still inside the 600 ms field-patch debounce mounted the other view's
     editors from a COMMITTED draft that did not contain it — and the next keystroke
     committed over it. Same seam, same flush, same order. */
  it('§45/r2 — the URL-driven view change (Back/Forward) flushes too', () => {
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    const at = ws.indexOf('  }, [initialView]);');
    expect(at).toBeGreaterThan(-1);
    const effect = ws.slice(ws.lastIndexOf('useEffect(() => {', at), at);
    expect(effect).toContain('if (flushRef.current) flushRef.current();');
    expect(effect.indexOf('flushRef.current()')).toBeLessThan(effect.indexOf('setViewState(id)'));
    // the flush handle is a live ref, so the effect stays keyed on the URL prop
    // alone (a `m`-shaped dependency would re-run it on every keystroke).
    expect(ws).toContain('const flushRef = useRef(m.flush);');
    expect(ws).toContain('flushRef.current = m.flush;');
  });

  /* r2 — re-selecting the destination you are already on is not a navigation:
     it pushed a duplicate history entry (so Back appeared to do nothing) and
     re-ran the deliberately lazy Updates sync plan. */
  it('r2 — an unchanged destination pushes no history and re-runs no sync plan', () => {
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    const setTab = ws.slice(ws.indexOf('const setTab = useCallback('), ws.indexOf('}, []);', ws.indexOf('const setTab = useCallback(')));
    expect(setTab).toContain('if (id === tabRef.current) return;');
    expect(setTab.indexOf('if (id === tabRef.current) return;'))
      .toBeLessThan(setTab.indexOf('refreshPlanRef.current()'));
    expect(setTab.indexOf('if (id === tabRef.current) return;'))
      .toBeLessThan(setTab.indexOf('hostNavRef.current('));
  });

  /* r2 — §3 BACK/FORWARD ASYMMETRY, for exactly the researchers §3 promised not to
     disturb: someone whose SAVED preference is Sections. Their bare-URL history
     entry was displaying Sections, but the reconcile effect resolved its absent
     `?msv=` to the CONSTANT default (Continuous) — so Back onto their own entry
     changed nothing and looked dead. Toggling Sections → Continuous also pushed a
     href identical to that bare URL, i.e. a duplicate entry. Two halves of one fix:
     entries this session pushes name their view explicitly, and an absent param
     means the view the session STARTED on. */
  it('§3/r2 — a toggle pushes an EXPLICIT view, for both values', () => {
    expect(manuscriptSubHref('editor', { projectId: 'p1', view: 'continuous', explicitView: true }))
      .toContain('&msv=continuous');
    expect(manuscriptSubHref('editor', { projectId: 'p1', view: 'sections', explicitView: true }))
      .toContain('&msv=sections');
    // …so the pushed entry is never byte-identical to the bare URL it came from.
    expect(manuscriptSubHref('editor', { projectId: 'p1', view: 'continuous', explicitView: true }))
      .not.toBe(manuscriptSubHref('editor', { projectId: 'p1' }));
    // A garbage view never fabricates a param.
    expect(manuscriptSubHref('editor', { projectId: 'p1', view: 'nonsense', explicitView: true }))
      .not.toContain('msv=');
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    expect(ws).toContain('hostNavRef.current(tabRef.current, id, true);');
    expect(ws).toContain('hostNavRef.current(id, viewRef.current, viewTouched.current);');
  });

  it('§3/r2 — an absent ?msv= means the view this session STARTED on, not the constant', () => {
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    expect(ws).toContain('const baselineView = useRef(view);');
    // the stored-preference hydration moves the baseline with the view it applies…
    expect(ws).toContain('if (stored) { setViewState(stored); baselineView.current = stored; }');
    // …and the reconcile effect resolves an absent param through it.
    expect(ws).toContain(
      'const id = normalizeManuscriptView(initialView || baselineView.current || DEFAULT_MANUSCRIPT_VIEW);',
    );
  });

  it('§47 — a LINK carries the view only when it is not the default', () => {
    const nav = readSource('src/frontend/stitch/nav/navConfig.js');
    /* 119.md §3 (re-pinned) — for a link built WITHOUT an explicit-view flag the
       builder omits the DEFAULT view and emits the other one, so every pre-118 link
       stays exactly as short as it was. The reconcile effect reads an absent `?msv=`
       from such an entry as the view that entry was displaying, so these two rules
       are one contract. Byte-exact on purpose — a loosened match would let them
       drift apart again. */
    expect(nav).toContain("    : (ctx.view === 'sections' ? '&msv=sections' : '');");
    expect(manuscriptSubHref('editor', { projectId: 'p1', view: DEFAULT_MANUSCRIPT_VIEW }))
      .not.toContain('msv=');
    expect(manuscriptSubHref('editor', { projectId: 'p1', view: 'sections' }))
      .toContain('&msv=sections');
    expect(nav).toContain('export function readManuscriptViewParam(search)');
    // absent ≠ "sections": absent means the URL does not express a view at all, so
    // the stored preference still wins on a plain load (§12).
    expect(nav).toContain("return (v === 'continuous' || v === 'sections') ? v : null;");
    const page = readSource('src/frontend/stitch/pages/StitchProjectWorkspace.jsx');
    expect(page).toContain('initialView={readManuscriptViewParam(search)}');
  });
});

/* ══════════════ §64/§65 — View in manuscript ══════════════ */

describe('118.md §64/§65 — "View in manuscript" points at the SAME object', () => {
  const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
  const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');

  it('an update card can open the section it is about', () => {
    expect(panels).toContain('data-testid={`stitch-manuscript-update-view-${id}`}');
    expect(panels).toContain('View in manuscript');
    // r2 — UpdatesPanel takes `onOpenSection` only; the `onNavigate` that used to be
    // passed alongside it was never read by the panel or its cards.
    expect(ws).toContain('<UpdatesPanel m={m} onOpenSection={openSection} />');
    expect(panels).toContain('export function UpdatesPanel({ m, onOpenSection })');
  });

  it('a table/figure row resolves its real place in the text, or shows nothing', () => {
    expect(panels).toContain('export function assetManuscriptTarget(m, asset)');
    // a manual table lives in its section; a generated one lives where it is cited
    expect(panels).toContain("if (asset.origin === 'manual' && asset.sectionId && asset.manualId)");
    expect(panels).toContain('for (const tk of findAssetTokens(sec.content))');
    // §69 — no button when there is nowhere to go
    expect(panels).toContain('const target = onOpenAsset ? assetManuscriptTarget(m, asset) : null;');
    expect(panels).toContain('{target && (');
    expect(ws).toContain('onOpenAsset={openAsset}');
  });

  it('the editor reveals the object itself, in whichever view is open', () => {
    expect(panels).toContain('const revealAssetIn = (secId, req) => {');
    const editor = readSource('src/features/manuscript/richEditor/RichSectionEditor.jsx');
    expect(editor).toContain('focusAssetRef: (assetId) => {');
    expect(editor).toContain('span.${ASSET_CHIP_CLASS}[data-asset=');
  });
});

/* ══════════════ Section View is unchanged (§10/§67) ══════════════ */

describe('118.md §10/§67 — Section View keeps working exactly as before', () => {
  const html = renderToStaticMarkup(<EditorPanel m={mockM(makeDraft())} exporters={null} />);

  it('still opens one section at a time, with its own chrome and test ids', () => {
    expect(html).toContain('data-testid="stitch-manuscript-editor"');
    expect(html).toContain('data-view="sections"');
    expect(html).toContain('data-testid="stitch-manuscript-page"');
    expect(html).toContain('data-testid="stitch-manuscript-title-input"');
    expect(html).toContain('data-testid="stitch-manuscript-tools-toggle"');
    // the continuous document is NOT mounted alongside it
    expect(html).not.toContain('data-testid="stitch-manuscript-continuous"');
    expect(html).not.toContain('data-testid="stitch-manuscript-rich-editor-introduction"');
  });

  it('the single editor keeps the historical test id', () => {
    const draft = makeDraft();
    const m = mockM(draft);
    // the panel opens on the title section, so assert through the shared factory's
    // rule rather than a second render path
    const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
    expect(panels).toContain("testId: continuous ? `stitch-manuscript-rich-editor-${id}` : 'stitch-manuscript-rich-editor',");
    expect(m.activeDraft.sections.methods.content).toContain('Eligibility criteria');
  });
});
