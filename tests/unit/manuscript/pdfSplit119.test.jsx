/**
 * 119.md §4 — the Editor + included-article PDF split workspace.
 *
 * House style: the RULES are pure functions (manuscriptSplit.js) and are tested as
 * such; the components are asserted through SSR markup (renderToStaticMarkup — no
 * jsdom), i.e. through control presence and ARIA state; and the two structural
 * guarantees that no rendered assertion can reach — "the editor is never remounted by
 * a layout change" and "layout never writes to the server" — are pinned against the
 * SOURCE, which is where those guarantees actually live.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT, SPLIT_PRESETS, SPLIT_STACK_BELOW,
  clampSplitRatio, activeSplitPreset, splitLayoutFor,
  splitRatioKey, splitArticleKey, readStoredRatio, writeStoredRatio,
  readStoredArticle, writeStoredArticle,
  buildSplitArticles, referenceAuthors, articleSubtitle, matchesArticleQuery, filterSplitArticles,
  articlePdfAvailability, AVAILABILITY_LABEL, buildArticleReports, pickReport, pickArticle,
} from '../../../src/features/manuscript/manuscriptSplit.js';
import {
  ManuscriptSplitToggle, SplitResizeDivider, ArticleSelector, PdfSplitPane, SPLIT_KEEPALIVE,
} from '../../../src/features/manuscript/PdfSplitPane.jsx';
// 120.md §8 — PDF View is a projection over this same pane state; the mapping is pure.
import { PDF_VIEW_TAB, panelFor, destinationFor } from '../../../src/features/manuscript/ManuscriptWorkspace.jsx';
import { MANUSCRIPT_TAB_IDS } from '../../../src/features/manuscript/ManuscriptToolbar.jsx';

/* A Map-backed localStorage, so the preference rules are tested for real. */
function stubStorage() {
  const map = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  });
  return map;
}

const REFS = [
  {
    id: 'r1',
    cited: true,
    ref: {
      origin: 'study', studyId: 's1', title: 'Statins after myocardial infarction',
      authors: 'Smith J; Lee K', year: '2020', journal: 'Lancet', doi: '10.1/abc', pmid: '12345678',
      screeningRecordId: 'rec-1', screeningProjectId: '',
    },
  },
  {
    id: 'r2',
    cited: false,
    ref: {
      origin: 'study', studyId: 's2', title: 'Aspirin in primary prevention',
      // A DERIVED reference carries `authorsList`, not `authors` — the shape
      // referencesFromProject really produces (an empty `authorsRaw` beside it).
      authorsRaw: '', authorsList: [{ family: 'Brown', given: 'T', raw: 'Brown T' }],
      year: '2019', journal: 'JAMA',
      screeningRecordId: 'rec-2', screeningProjectId: 'other-screen',
    },
  },
  // A LIBRARY reference is not an included article and must never be offered.
  { id: 'r3', cited: true, ref: { origin: 'library', title: 'A cited guideline', year: '2018' } },
];

const STUDIES = [
  { id: 's1', label: 'STAT-1' },
  { id: 's2', document: { fileName: 'brown.pdf' } },
];

describe('119.md §4 — split ratio rules', () => {
  it('defaults to a 50/50 split and clamps to usable widths', () => {
    expect(SPLIT_DEFAULT).toBe(0.5);
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.01)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(0.99)).toBe(SPLIT_MAX);
    // Neither side may be squeezed out of usefulness (§4 "sensible minimum widths").
    expect(SPLIT_MIN).toBeGreaterThanOrEqual(0.25);
    expect(SPLIT_MAX).toBeLessThanOrEqual(0.8);
    expect(clampSplitRatio('nonsense')).toBe(SPLIT_DEFAULT);
  });

  it('offers exactly the three §4 presets, all inside the clamp', () => {
    expect(SPLIT_PRESETS.map((p) => p.id)).toEqual(['even', 'editor', 'pdf']);
    for (const p of SPLIT_PRESETS) expect(clampSplitRatio(p.ratio)).toBe(p.ratio);
    expect(SPLIT_PRESETS[0].ratio).toBe(SPLIT_DEFAULT);
    // Editor-focused really is wider for the editor than PDF-focused.
    expect(SPLIT_PRESETS[1].ratio).toBeGreaterThan(SPLIT_PRESETS[2].ratio);
  });

  it('reports which preset a live ratio sits on (and none after a free drag)', () => {
    expect(activeSplitPreset(0.5)).toBe('even');
    expect(activeSplitPreset(0.7)).toBe('editor');
    expect(activeSplitPreset(0.34)).toBe('pdf');
    expect(activeSplitPreset(0.58)).toBeNull();
  });

  it('stacks below the responsive floor instead of showing two unusable columns', () => {
    expect(splitLayoutFor(1400)).toBe('split');
    expect(splitLayoutFor(SPLIT_STACK_BELOW)).toBe('split');
    expect(splitLayoutFor(SPLIT_STACK_BELOW - 1)).toBe('stacked');
    expect(splitLayoutFor(600)).toBe('stacked');
    expect(splitLayoutFor(0)).toBe('split');   // unmeasured → the desktop layout
  });
});

describe('119.md §4 — per-user preferences (localStorage, never the blob)', () => {
  beforeEach(() => { stubStorage(); });

  it('keys the ratio and the article per user, and refuses to persist without one', () => {
    expect(splitRatioKey('u1')).toBe('metalab.manuscriptSplit.u1');
    expect(splitArticleKey('u1')).toBe('metalab.manuscriptPdfArticle.u1');
    expect(splitRatioKey(null)).toBeNull();
    expect(splitArticleKey('')).toBeNull();
    writeStoredRatio(null, 0.62);
    expect(readStoredRatio(null)).toBeNull();
  });

  it('round-trips a ratio and ignores an out-of-range or corrupt stored value', () => {
    const key = splitRatioKey('u1');
    writeStoredRatio(key, 0.62);
    expect(readStoredRatio(key)).toBeCloseTo(0.62, 5);
    localStorage.setItem(key, '0.95');
    expect(readStoredRatio(key)).toBeNull();   // ignored, not clamped-and-kept
    localStorage.setItem(key, 'banana');
    expect(readStoredRatio(key)).toBeNull();
  });

  it('remembers the last article per project inside one per-user key', () => {
    const key = splitArticleKey('u1');
    writeStoredArticle(key, 'p1', { refId: 'r1', reportId: 'screening:a1', open: true });
    writeStoredArticle(key, 'p2', { refId: 'r9', reportId: '', open: false });
    expect(readStoredArticle(key, 'p1')).toEqual({ refId: 'r1', reportId: 'screening:a1', open: true });
    expect(readStoredArticle(key, 'p2')).toEqual({ refId: 'r9', reportId: '', open: false });
    expect(readStoredArticle(key, 'p3')).toBeNull();
    // One key holds every project — no key-per-project leak.
    expect(Object.keys(JSON.parse(localStorage.getItem(key)))).toEqual(['p1', 'p2']);
  });
});

describe('119.md §4 — the included-article list', () => {
  it('offers included studies only, with the project study label attached', () => {
    const list = buildSplitArticles(REFS, STUDIES);
    expect(list.map((a) => a.id)).toEqual(['r1', 'r2']);      // the library ref is gone
    expect(list[0].label).toBe('STAT-1');
    expect(list[0].screeningRecordId).toBe('rec-1');
    expect(list[0].hasStudyDoc).toBe(false);
    expect(list[1].hasStudyDoc).toBe(true);                    // blob study document
    expect(buildSplitArticles(null, null)).toEqual([]);
  });

  it('searches title, author, year, journal, DOI, PMID and study label', () => {
    const list = buildSplitArticles(REFS, STUDIES);
    const ids = (q) => filterSplitArticles(list, q).map((a) => a.id);
    expect(ids('statins')).toEqual(['r1']);          // title
    expect(ids('brown')).toEqual(['r2']);            // author
    expect(ids('2019')).toEqual(['r2']);             // year
    expect(ids('lancet')).toEqual(['r1']);           // journal
    expect(ids('10.1/abc')).toEqual(['r1']);         // DOI
    expect(ids('12345678')).toEqual(['r1']);         // PMID
    expect(ids('stat-1')).toEqual(['r1']);           // project study label
    expect(ids('smith 2020')).toEqual(['r1']);       // every term must match
    expect(ids('smith 2019')).toEqual([]);
    expect(ids('')).toEqual(['r1', 'r2']);
    expect(matchesArticleQuery(list[0], '  ')).toBe(true);
  });

  it('reads authors from the parsed authorsList a derived reference actually carries', () => {
    const list = buildSplitArticles(REFS, STUDIES);
    expect(list[1].authors).toBe('Brown T');
    expect(referenceAuthors({ authorsList: [{ family: 'Lee', given: 'K' }] })).toBe('Lee K');
    expect(referenceAuthors({ authors: 'Smith J' })).toBe('Smith J');
    expect(referenceAuthors(null)).toBe('');
    // …which is what makes the author search work at all on included studies.
    expect(filterSplitArticles(list, 'brown').map((a) => a.id)).toEqual(['r2']);
  });

  it('summarises an article in one honest identity line', () => {
    const [a] = buildSplitArticles(REFS, STUDIES);
    expect(articleSubtitle(a)).toBe('Smith J · 2020 · Lancet');
    expect(articleSubtitle(null)).toBe('');
  });
});

describe('119.md §4 — PDF availability is three answers, never two', () => {
  const list = buildSplitArticles(REFS, STUDIES);

  it('is unknown until the lazy listing answers, and never turns a failure into "no PDF"', () => {
    expect(articlePdfAvailability(list[0], {}, 'screen-1')).toBe('unknown');
    expect(AVAILABILITY_LABEL.unknown).toBe('Checking…');
  });

  it('is available with an attachment and none when the listing came back empty', () => {
    expect(articlePdfAvailability(list[0], { 'screen-1::rec-1': 'att-1' }, 'screen-1')).toBe('available');
    expect(articlePdfAvailability(list[0], { 'screen-1::rec-1': null }, 'screen-1')).toBe('none');
    // The reference's OWN screening project wins over the project-level fallback.
    expect(articlePdfAvailability(list[1], { 'other-screen::rec-2': null }, 'screen-1')).toBe('available');
  });

  it('falls back to the study-document pointer when there is no screening record', () => {
    const manual = { screeningRecordId: '', screeningProjectId: '', hasStudyDoc: true };
    expect(articlePdfAvailability(manual, {}, 'screen-1')).toBe('available');
    expect(articlePdfAvailability({ ...manual, hasStudyDoc: false }, {}, 'screen-1')).toBe('none');
  });
});

describe('119.md §4 — reports, and what opens first', () => {
  const [a] = buildSplitArticles(REFS, STUDIES);

  it('builds the multi-report list from existing identities only', () => {
    const reports = buildArticleReports({ ...a, screeningProjectId: 'screen-1' }, 'att-1', {
      primary: { fileName: 'smith-2020.pdf', fileHash: 'h1' },
      documents: [{ id: 'd2', label: 'supplement', fileName: 'appendix.pdf', fileHash: 'h2' }],
    });
    expect(reports.map((r) => r.id)).toEqual(['screening:att-1', 'study:primary', 'study:d2']);
    expect(reports[0]).toMatchObject({ kind: 'screening', recordId: 'rec-1', screenProjectId: 'screen-1' });
    expect(reports[2].label).toBe('supplement · appendix.pdf');
    expect(buildArticleReports(a, '', null)).toEqual([]);
  });

  it('keeps the remembered report when it still exists, else opens the first', () => {
    const reports = buildArticleReports({ ...a, screeningProjectId: 'p' }, 'att-1', { primary: { fileName: 'x.pdf' } });
    expect(pickReport(reports, 'study:primary').id).toBe('study:primary');
    expect(pickReport(reports, 'gone').id).toBe('screening:att-1');
    expect(pickReport([], 'anything')).toBeNull();
  });

  it('prefers the remembered article, then one that actually has a PDF', () => {
    const list = buildSplitArticles(REFS, STUDIES);
    expect(pickArticle(list, 'r2', {}, 's').id).toBe('r2');
    expect(pickArticle(list, 'deleted-ref', {}, 's').id).toBe('r2');   // r2 has a study doc
    expect(pickArticle(list, '', { 'screen-1::rec-1': 'att' }, 'screen-1').id).toBe('r1');
    expect(pickArticle([], 'r1', {}, 's')).toBeNull();
  });
});

/* ── the components (SSR contract) ──────────────────────────────────────────── */

const split = {
  ratio: 0.5, dragging: false,
  onPointerDown: () => {}, reset: () => {}, nudge: () => {}, setPreset: () => {},
};

describe('119.md §4 — the controls', () => {
  it('the toggle is one control with two states', () => {
    const off = renderToStaticMarkup(<ManuscriptSplitToggle open={false} onToggle={() => {}} />);
    expect(off).toContain('data-testid="stitch-manuscript-split-toggle"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('PDF view');
    const on = renderToStaticMarkup(<ManuscriptSplitToggle open onToggle={() => {}} />);
    expect(on).toContain('aria-pressed="true"');
    // Narrow bars condense the LABEL, never drop the control.
    expect(renderToStaticMarkup(<ManuscriptSplitToggle open={false} onToggle={() => {}} condensed />))
      .toContain('data-testid="stitch-manuscript-split-toggle"');
  });

  it('the divider is a real, keyboard-operable separator', () => {
    const html = renderToStaticMarkup(<SplitResizeDivider split={split} />);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(`aria-valuemin="${Math.round(SPLIT_MIN * 100)}"`);
    expect(html).toContain(`aria-valuemax="${Math.round(SPLIT_MAX * 100)}"`);
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuetext="Manuscript 50%, PDF 50%"');
    // The source carries the keyboard contract itself (§4 "Support keyboard resizing").
    const src = readSource('src/features/manuscript/PdfSplitPane.jsx');
    expect(src).toContain("e.key === 'ArrowLeft'");
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("e.key === 'Home'");
  });

  it('the selector shows the current article and an honest empty state', () => {
    const list = buildSplitArticles(REFS, STUDIES);
    const html = renderToStaticMarkup(
      <ArticleSelector articles={list} activeId="r1" onPick={() => {}} resolved={{}} screenProjectId="screen-1" />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-split-article"');
    expect(html).toContain('Statins after myocardial infarction');
    expect(html).toContain('Smith J · 2020 · Lancet');
    const empty = renderToStaticMarkup(
      <ArticleSelector articles={[]} activeId="" onPick={() => {}} resolved={{}} screenProjectId="" />,
    );
    expect(empty).toContain('Choose an included article');
  });

  it('the pane carries the §4 workspace toolbar and an honest no-PDF state', () => {
    const html = renderToStaticMarkup(
      <PdfSplitPane projectId="p1" articles={[]} activeArticle={null} activeReportId=""
        onPickArticle={() => {}} onPickReport={() => {}} resolved={{}} screenProjectId=""
        onExit={() => {}} split={split} layout="split" />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-split-pdf"');
    expect(html).toContain('data-testid="stitch-manuscript-split-exit"');
    for (const p of SPLIT_PRESETS) expect(html).toContain(`data-testid="stitch-manuscript-split-preset-${p.id}"`);
    expect(html).toContain('aria-pressed="true"');                 // 50/50 is the live ratio
    expect(html).toContain('No included studies yet');
    // No viewer is mounted when there is nothing to view.
    expect(html).not.toContain('stitch-manuscript-split-viewer');
  });
});

describe('119.md §4 — the structural guarantees (source pins)', () => {
  const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
  const pane = readSource('src/features/manuscript/PdfSplitPane.jsx');

  it('renders the split row in BOTH states so a layout change cannot remount the editor', () => {
    // The row and the editor pane are unconditional; only the divider and the PDF
    // pane are conditional, and they come AFTER the editor pane in the tree.
    expect(ws).toContain('data-testid="stitch-manuscript-split"');
    expect(ws).toContain('data-testid="stitch-manuscript-split-editor"');
    const editorAt = ws.indexOf('data-testid="stitch-manuscript-split-editor"');
    const dividerAt = ws.indexOf('<SplitResizeDivider');
    const paneAt = ws.indexOf('<PdfSplitPane');
    expect(editorAt).toBeGreaterThan(0);
    expect(dividerAt).toBeGreaterThan(editorAt);
    expect(paneAt).toBeGreaterThan(editorAt);
    expect(ws).not.toContain('{splitOpen && (\n        <div\n          ref={splitRowRef}');
  });

  /* 120.md §8 — RE-PINNED. The 119 toggle became the PDF View / Editor pair of
     toolbar destinations, so the open/close body is now `setSplitTo(next)` — ONE
     idempotent path shared by the two destinations, a `?ms=` deep link, browser
     Back/Forward and the pane's own exit button. The guarantee is unchanged and is
     what this pins: it flushes BEFORE it changes the layout. */
  it('flushes pending edits before a layout transition, and never on a resize', () => {
    expect(ws).toMatch(/const setSplitTo = useCallback\(\(next\) => \{\s*\n\s*if \(splitOpenRef\.current === next\) return;\s*\n\s*if \(m\.flush\) m\.flush\(\);/);
    // Every route into the pane goes through that one body …
    expect(ws).toContain('setSplitRef.current = setSplitTo;');
    expect(ws).toContain("if (id === PDF_VIEW_TAB) { if (setSplitRef.current) setSplitRef.current(true); }");
    expect(ws).toContain("else if (id === 'editor') { if (setSplitRef.current) setSplitRef.current(false); }");
    expect(ws).toContain('onExit={exitSplit}');
    // … and the divider still only commits a ratio: nothing in the pane flushes or saves.
    expect(pane).not.toContain('m.flush');
  });

  /* ── 120.md §8 — PDF View as a toolbar destination ─────────────────────────── */

  it('projects PDF View out of the ONE pane state, in both directions', () => {
    expect(PDF_VIEW_TAB).toBe('pdfview');
    // the destination the nav shows and the URL carries …
    expect(destinationFor('editor', true)).toBe('pdfview');
    expect(destinationFor('editor', false)).toBe('editor');
    // … a pane open on another destination does NOT relabel it (the pane persists
    // outside the tabpanel, exactly as in 119.md §4)
    expect(destinationFor('tables', true)).toBe('tables');
    expect(destinationFor('overview', false)).toBe('overview');
    // … and the panel that actually renders.
    expect(panelFor('pdfview')).toBe('editor');
    expect(panelFor('editor')).toBe('editor');
    expect(panelFor('tables')).toBe('tables');
  });

  it('makes ?ms=pdfview a real, valid destination', () => {
    expect(MANUSCRIPT_TAB_IDS).toContain('pdfview');
    // `normalizeSubtab` is derived from the tab ids, so the URL scheme needs no
    // special case: an unknown value still resolves to the workspace home.
    expect(MANUSCRIPT_TAB_IDS.indexOf('pdfview')).toBe(MANUSCRIPT_TAB_IDS.indexOf('editor') + 1);
  });

  /* The keep-alive pool is the whole mechanism behind §8's "switching between Editor
     and PDF View must preserve … selected study, current PDF page, PDF zoom": closing
     the pane used to UNMOUNT it, and with PDF View as a destination that would now
     happen on every switch. */
  it('keeps the pane MOUNTED once opened, and only hides it when closed', () => {
    expect(ws).toContain('const [splitMounted, setSplitMounted] = useState(splitOpen);');
    expect(ws).toContain('{splitMounted && (');
    expect(ws).toContain("hidden={!splitOpen || (splitLayout === 'stacked' && stackPane !== 'pdf')}");
    // The old unmount-on-close is gone …
    expect(ws).not.toContain('{splitOpen && (\n          <PdfSplitPane');
    // … and the pooled viewers still hide with `visibility`, never `display`, so a
    // hidden viewer keeps a real box and its ResizeObserver never sees a 0-width layout.
    expect(pane).toContain("visibility: 'hidden', pointerEvents: 'none',");
  });

  it('a ?ms=pdfview deep link opens the pane on the FIRST render (no second transition)', () => {
    expect(ws).toContain('const [tab, setTabState] = useState(() => panelFor(initialDestination));');
    expect(ws).toContain('const [splitOpen, setSplitOpen] = useState(initialDestination === PDF_VIEW_TAB);');
  });

  it('the toolbar no longer carries a second control for the same state', () => {
    expect(ws).not.toContain('<ManuscriptSplitToggle');
    expect(ws).not.toContain('splitToggle={');
    // The component itself is still exported for a host without the tablist.
    expect(typeof ManuscriptSplitToggle).toBe('function');
  });

  it('keeps layout out of the project blob and off the network', () => {
    const rules = readSource('src/features/manuscript/manuscriptSplit.js');
    expect(rules).toContain('localStorage');
    expect(rules).not.toContain('fetch(');
    // The pane's only network calls are the EXISTING document routes.
    expect(pane).not.toContain('fetch(');
    expect(pane).toContain('studyDocApi.list');
    expect(pane).toContain('pinPdfBytesVersion');
  });

  it('reuses the shared viewers rather than building a manuscript-only one', () => {
    expect(pane).toContain("import('../../frontend/screening/components/PdfViewer.jsx')");
    expect(pane).toContain("import('../../frontend/components/AppPdfViewer.jsx')");
    expect(pane).toContain('canManage={false}');
    expect(SPLIT_KEEPALIVE).toBeGreaterThanOrEqual(2);
  });

  it('drives the shell’s own Focus Mode instead of a second hide-the-rails path', () => {
    expect(ws).toContain('useFocusMode');
    expect(ws).toContain('focusOwned');
    // Releasing it only when the split turned it on.
    expect(ws).toMatch(/} else if \(focusOwned\.current\) \{/);
  });
});
