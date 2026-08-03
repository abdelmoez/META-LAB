/**
 * searchWorkspace.test.jsx — 71.md + 73.md, re-staged by 96.md. SSR-safe smoke tests
 * for the staged Search Workspace. Static render runs no effects, so no network is
 * touched; we assert the 7-stage rail renders (96.md — Concepts and Test & Refine are
 * retired; Terms & Vocabulary is the central workspace), each stage mounts its
 * COMPOSED existing component without throwing, the two-path mode model behaves
 * (mode cards, mode-aware Results, header badge), the retired-stage ALIASES resolve
 * (concepts/refine → terms), the Research Question stage is an EDITOR (no PICO
 * cards), the PubMed pulse presents hit-state snapshots honestly, the scroll-model
 * walker + search-mode persistence helpers are pure-tested, the wording rule (no
 * user-facing "AI") holds, and the flag gate that routes the dispatcher behaves.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SearchWorkspace, searchWorkspaceV2FlagEnabled,
  STAGES, STAGE_ALIASES, stagesFor, stageAfterModeChange, reconcileStageUrl,
  PubMedPulse, findScrollableAncestor, persistSearchModeMerged,
} from '../../src/features/searchWorkspace/index.js';

afterEach(() => { vi.unstubAllGlobals(); });

const PICO = { P: 'adults with type 2 diabetes', question: 'does metformin help?' };

// Note: the SSR markup HTML-escapes "&" to "&amp;", so ampersand labels are matched escaped.
// 97.md Phase 5 — the second stage is renamed (label-only) to "Select & Build Key
// Terms"; the stage id `terms` and every deep link / alias are unchanged.
const STAGE_LABELS = [
  'Research Question', 'Select &amp; Build Key Terms', 'Search Mode', 'Database Strategies',
  'Run Externally', 'Documentation', 'Send to Screening',
];

describe('SearchWorkspace (SSR smoke)', () => {
  it('renders ONE unified header + the 7-stage rail, defaulting to Research Question', () => {
    const html = renderToStaticMarkup(
      h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled: true }),
    );
    // One header, not three
    expect(html).toContain('>Pecan Search Engine<');
    // Every stage appears in the left rail
    for (const label of STAGE_LABELS) expect(html).toContain(label);
    // Default stage is Research Question (stage 1 of 7) — the run engine is NOT mounted yet
    expect(html).toContain('Stage 1 of 7');
    expect(html).toContain('Research question');
    expect(html).not.toContain('Run search — Pecan Search Engine');
  });

  it('renders without crashing in read-only mode with the automated run disabled', () => {
    const html = renderToStaticMarkup(
      h(SearchWorkspace, { projectId: 'p2', pico: {}, readOnly: true, pecanEnabled: false }),
    );
    expect(html).toContain('Stage 1 of 7');
    for (const label of STAGE_LABELS) expect(html).toContain(label);
  });
});

describe('STAGES / stagesFor — 96.md D3 mode-scoped stage list', () => {
  it('has 7 master stages in the locked order (concepts/refine retired)', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'question', 'terms', 'mode', 'strategy', 'results', 'documentation', 'screening',
    ]);
    expect(STAGES.map((s) => s.num)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STAGES.find((s) => s.id === 'strategy').label).toBe('Database Strategies');
    expect(STAGES.find((s) => s.id === 'strategy').manualOnly).toBe(true);
    expect(STAGES.find((s) => s.id === 'terms').desc).toBe('Build your search');
  });
  it('labels Results mode-aware: automated → Automated Search, manual/null → Run Externally', () => {
    const res = (mode) => stagesFor(mode).find((s) => s.id === 'results');
    expect(res('automated').label).toBe('Automated Search');
    expect(res('automated').desc).toBe('Run & deduplicate');
    expect(res('manual').label).toBe('Run Externally');
    expect(res(null).label).toBe('Run Externally');
    expect(res(null).desc).toBe('Your database accounts');
  });
  it('maps builder stages to the embedded phases (terms + build only)', () => {
    expect(STAGES.find((s) => s.id === 'terms').phase).toBe('terms');
    expect(STAGES.find((s) => s.id === 'strategy').phase).toBe('build');
  });
  // 74.md — the selected mode controls the ENTIRE visible workflow.
  it('automated mode REMOVES Database Strategies and renumbers the pips 1..6', () => {
    const auto = stagesFor('automated');
    expect(auto.map((s) => s.id)).toEqual([
      'question', 'terms', 'mode', 'results', 'documentation', 'screening',
    ]);
    expect(auto.map((s) => s.num)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(auto.some((s) => s.label === 'Database Strategies')).toBe(false);
  });
  it('manual and undecided keep the full 7-stage rail (existing projects keep working)', () => {
    for (const mode of ['manual', null, undefined]) {
      const list = stagesFor(mode);
      expect(list.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
      expect(list.map((s) => s.num)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });
  it('never mutates the master STAGES table', () => {
    stagesFor('automated'); stagesFor('manual');
    expect(STAGES.find((s) => s.id === 'results').label).toBe('Run Externally');
    expect(STAGES.length).toBe(7);
  });
});

describe('stageAfterModeChange — 74.md/96.md: removed + retired stages never strand the user', () => {
  it('keeps the stage when it survives the mode switch', () => {
    for (const id of ['question', 'terms', 'mode', 'results', 'documentation', 'screening']) {
      expect(stageAfterModeChange(id, 'automated')).toBe(id);
      expect(stageAfterModeChange(id, 'manual')).toBe(id);
    }
    expect(stageAfterModeChange('strategy', 'manual')).toBe('strategy');
    expect(stageAfterModeChange('strategy', null)).toBe('strategy');
  });
  it('Database Strategies → Results when switching to automated (nearest FOLLOWING stage)', () => {
    expect(stageAfterModeChange('strategy', 'automated')).toBe('results');
  });
  it('96.md — RETIRED stage ids resolve through STAGE_ALIASES to Terms & Vocabulary', () => {
    expect(STAGE_ALIASES).toEqual({ concepts: 'terms', refine: 'terms' });
    for (const mode of [null, 'manual', 'automated']) {
      expect(stageAfterModeChange('concepts', mode)).toBe('terms');
      expect(stageAfterModeChange('refine', mode)).toBe('terms');
    }
  });
  it('an unknown stage id lands home on Research Question', () => {
    expect(stageAfterModeChange('nope', 'automated')).toBe('question');
    expect(stageAfterModeChange(undefined, 'manual')).toBe('question');
  });
});

describe('reconcileStageUrl — 75.md recs (Finding 3): the reconcile re-syncs the URL', () => {
  it('a non-surviving deep link normalizes the URL to the resolved stage', () => {
    // ?stage=strategy on an automated project → the body shows results AND the URL is
    // pushed to results (so the side-menu highlight + back/forward stop pointing at the
    // phantom Database Strategies stage). Body still on the dead stage → apply too.
    expect(reconcileStageUrl('strategy', 'automated', 'strategy')).toEqual({ apply: 'results', syncUrl: 'results' });
  });

  it('96.md — a retired ?stage=concepts / ?stage=refine deep link lands on terms AND rewrites the URL', () => {
    expect(reconcileStageUrl('concepts', 'manual', 'question')).toEqual({ apply: 'terms', syncUrl: 'terms' });
    expect(reconcileStageUrl('refine', 'automated', 'question')).toEqual({ apply: 'terms', syncUrl: 'terms' });
    // body already on terms → only the URL is normalized (loop-safe: once the URL says
    // terms, the resolver is the identity and nothing is pushed again)
    expect(reconcileStageUrl('concepts', 'manual', 'terms')).toEqual({ apply: null, syncUrl: 'terms' });
    expect(reconcileStageUrl('terms', 'manual', 'terms')).toEqual({ apply: null, syncUrl: null });
  });

  it('syncs the URL even when the body already landed on the survivor (apply is a no-op)', () => {
    expect(reconcileStageUrl('strategy', 'automated', 'results')).toEqual({ apply: null, syncUrl: 'results' });
  });

  it('a surviving deep link adopts the stage but leaves an already-correct URL alone', () => {
    expect(reconcileStageUrl('terms', 'manual', 'question')).toEqual({ apply: 'terms', syncUrl: null });
  });

  it('is a no-op once body + URL agree (loop-safe: nothing pushed, nothing applied)', () => {
    expect(reconcileStageUrl('terms', 'manual', 'terms')).toEqual({ apply: null, syncUrl: null });
    expect(reconcileStageUrl('results', 'automated', 'results')).toEqual({ apply: null, syncUrl: null });
  });

  it('no URL stage (SSR / bare tab) → does nothing', () => {
    expect(reconcileStageUrl(null, 'automated', 'question')).toEqual({ apply: null, syncUrl: null });
    expect(reconcileStageUrl('', 'manual', 'question')).toEqual({ apply: null, syncUrl: null });
  });
});

describe('SearchWorkspace — each stage composes its existing component without throwing', () => {
  const render = (initialStage, pecanEnabled = true, initialSearchMode) => renderToStaticMarkup(
    h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled, initialStage, initialSearchMode }),
  );

  it('Research Question → the EDITOR when updNested is threaded (96.md D1), no PICO cards', () => {
    const html = renderToStaticMarkup(
      h(SearchWorkspace, { projectId: 'p1', pico: PICO, updNested: () => {}, readOnly: false, pecanEnabled: true, initialStage: 'question' }),
    );
    expect(html).toContain('search-question-editor');
    expect(html).toContain('does metformin help?');
    expect(html).toContain('built directly from this question');
    // 96.md D1 — NO P/I/C/O cards or copy anywhere on the Search question stage.
    expect(html).not.toContain('Population / Problem');
    expect(html).not.toContain('Comparator / Control');
    expect(html).not.toContain('PICO');
  });

  it('Research Question → plain display without an editor seam (read-only / legacy mount)', () => {
    const html = render('question');
    expect(html).toContain('does metformin help?');
    expect(html).not.toContain('search-question-editor');
  });

  it('Terms + Strategy → the embedded Search Builder (terms/build phases)', () => {
    for (const stage of ['terms', 'strategy']) {
      // The builder mounts (its SSR loading shell) — proving the reused engine composes.
      expect(render(stage)).toContain('Loading search');
    }
    expect(render('terms')).toContain('Select &amp; build key terms'); // "&" is HTML-escaped in SSR markup (97.md rename)
    expect(render('strategy')).toContain('Database strategies');
  });

  it('96.md — Terms & Vocabulary carries the relocated estimates + versions panels', () => {
    const html = render('terms');
    expect(html).toContain('Estimated results per database'); // PreviewEstimates (relocated from refine)
    expect(html).toContain('Versions');                       // SearchVersionsPanel (relocated from refine)
    expect(html).not.toContain('Search quality');             // the SearchQualityPanel is deleted
  });

  it('Search Mode → the two path cards with radio semantics', () => {
    const html = render('mode');
    expect(html).toContain('search-mode-card-manual');
    expect(html).toContain('search-mode-card-automated');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('Manual search');
    expect(html).toContain('Automated search');
    // Both unchecked before any choice (SSR renders the null state)
    expect(html).not.toContain('aria-checked="true"');
    expect(html).toContain('You can switch modes at any time');
  });

  it('Search Mode reflects a chosen mode (aria-checked) + the header badge appears', () => {
    const html = render('mode', true, 'manual');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('search-mode-badge');
    expect(html).toContain('Manual search');
    // No badge before a mode exists
    expect(render('mode', true)).not.toContain('search-mode-badge');
  });

  it('74.md — a strategy deep link under an automated seed REMAPS to Results', () => {
    const html = render('strategy', true, 'automated');
    // The removed stage never renders — the workspace lands on the nearest survivor…
    expect(html).toContain('data-stage="results"');
    expect(html).not.toContain('automated-strategy-summary');
    expect(render('strategy', true, 'manual')).toContain('data-stage="strategy"');
  });

  it('96.md — a retired concepts/refine deep link lands on Terms & Vocabulary', () => {
    for (const retired of ['concepts', 'refine']) {
      const html = render(retired);
      expect(html).toContain('data-stage="terms"');
    }
  });

  it('Strategy/Results with NO mode chosen → the slim non-blocking chooser strip', () => {
    expect(render('strategy')).toContain('mode-chooser-strip');
    expect(render('results')).toContain('mode-chooser-strip');
    expect(render('strategy', true, 'manual')).not.toContain('mode-chooser-strip');
  });

  it('Results: manual/null → the external-run guidance (NOT the Pecan run surface)', () => {
    for (const mode of [undefined, 'manual']) {
      const html = render('results', true, mode);
      expect(html).toContain('manual-run-guide');
      expect(html).toContain('Import your results');
      expect(html).not.toContain('Search strategy'); // PecanSearchTab's strategy card
      // 74.md — no automated advert inside the manual workflow; only the neutral
      // mode-change affordance remains.
      expect(html).not.toContain('Switch to Automated');
      expect(html).toContain('change-mode-link');
      expect(html).toContain('Change the search mode');
    }
  });

  it('Results: automated → the embedded PecanSearchTab (its own big header suppressed)', () => {
    const html = render('results', true, 'automated');
    // The run surface's cards mount…
    expect(html).toContain('Search strategy');
    expect(html).toContain('Sources');
    // …but its standalone header does NOT (embedded: the workspace owns the header)
    expect(html).not.toContain('Run search — Pecan Search Engine');
  });

  it('Results: automated with the run engine off → a calm enable-in-Ops surface', () => {
    expect(render('results', false, 'automated')).toContain('Run the search');
  });

  it('Documentation → the reproducibility export panel (methods + PRISMA-S)', () => {
    const html = render('documentation');
    expect(html).toContain('Documentation');
    expect(html).toContain('Reproducibility'); // SearchExportPanel
  });

  it('Send to Screening → first-class handoff, with mode-aware copy', () => {
    const html = render('screening');
    expect(html).toContain('Send to screening');
    expect(html).toContain('Go to Screening');
    expect(render('screening', true, 'manual')).toContain('manual mode');
    expect(render('screening', true, 'automated')).toContain('Automated Search');
  });
});

describe('SearchWorkspace — 74.md: one workflow visible at a time', () => {
  const render = (initialStage, pecanEnabled = true, initialSearchMode, readOnly = false) => renderToStaticMarkup(
    h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly, pecanEnabled, initialStage, initialSearchMode }),
  );

  it('automated mode: Database Strategies never appears on any workflow stage', () => {
    // Every automated stage except the mode CHOOSER itself (whose manual card must
    // describe the manual path so the distinction stays understandable).
    for (const stage of ['question', 'terms', 'results', 'documentation', 'screening']) {
      for (const pecan of [true, false]) {
        expect(render(stage, pecan, 'automated')).not.toContain('Database Strategies');
      }
    }
  });

  it('automated mode: the rail is the renumbered 6-stage list', () => {
    const html = render('question', true, 'automated');
    expect(html).toContain('Stage 1 of 6');
    expect(html).toContain('Automated Search');
    expect(html).not.toContain('Run Externally');
  });

  it('manual mode: the full 7-stage rail, and no automated-workflow surfaces anywhere', () => {
    const html = render('question', true, 'manual');
    expect(html).toContain('Stage 1 of 7');
    expect(html).toContain('Database Strategies');
    expect(html).toContain('Run Externally');
    expect(html).not.toContain('Automated Search'); // the automated stage label never leaks
    // The run stage never mounts the automated engine surface in manual mode.
    const results = render('results', true, 'manual');
    expect(results).toContain('manual-run-guide');
    expect(results).not.toContain('Sources'); // PecanSearchTab's source cards
  });

  it('automated + engine off: the run dead-end offers a mode change, never a manual stage', () => {
    const html = render('results', false, 'automated');
    expect(html).toContain('Run the search');
    expect(html).toContain('Change the search mode');
    expect(html).not.toContain('Database Strategies');
    // read-only: the surface stays calm with no mode-change controls
    const ro = render('results', false, 'automated', true);
    expect(ro).toContain('Run the search');
    expect(ro).not.toContain('Change the search mode');
  });

  it('Terms & Vocabulary: the enable-in-Ops estimates card is an automated-only indicator — hidden in manual mode', () => {
    expect(render('terms', false, 'manual')).not.toContain('Estimated results per database');
    expect(render('terms', true, 'manual')).toContain('Estimated results per database');   // live estimates stay shared
    expect(render('terms', false, 'automated')).toContain('Estimated results per database');
    expect(render('terms', false, undefined)).toContain('Estimated results per database'); // undecided keeps the neutral note
  });

  it('Send to Screening (automated, engine off) points to the mode stage, not Database Strategies', () => {
    const html = render('screening', false, 'automated');
    expect(html).not.toContain('Database Strategies');
    expect(html).toContain('change the search mode');
    // recs round — the interactive affordance is for editors only; read-only viewers
    // get the plain status without an action they cannot perform.
    const ro = render('screening', false, 'automated', true);
    expect(ro).not.toContain('change the search mode');
    expect(ro).toContain('Pecan Search Engine — Automated Run');
  });

  it('a mode switch is announced to screen readers (polite status with the new stage count)', () => {
    const auto = render('question', true, 'automated');
    expect(auto).toContain('search-mode-announcement');
    expect(auto).toContain('Automated search selected. The workflow now has 6 stages.');
    const manual = render('question', true, 'manual');
    expect(manual).toContain('Manual search selected. The workflow now has 7 stages.');
    // No mode → no badge, no announcement region.
    expect(render('question', true, undefined)).not.toContain('search-mode-announcement');
  });

  it('mode cards form ONE tab stop via roving tabindex', () => {
    // No selection → the first card (manual) is the group's tab stop.
    const none = render('mode', true, undefined);
    expect(none).toContain('tabindex="0" data-testid="search-mode-card-manual"');
    expect(none).toContain('tabindex="-1" data-testid="search-mode-card-automated"');
    // Selection moves the tab stop with it.
    const auto = render('mode', true, 'automated');
    expect(auto).toContain('tabindex="-1" data-testid="search-mode-card-manual"');
    expect(auto).toContain('tabindex="0" data-testid="search-mode-card-automated"');
    const manual = render('mode', true, 'manual');
    expect(manual).toContain('tabindex="0" data-testid="search-mode-card-manual"');
    expect(manual).toContain('tabindex="-1" data-testid="search-mode-card-automated"');
  });
});

describe('SearchWorkspace — 75.md: side-menu-driven stage control + Next-after-screening', () => {
  const render = (props) => renderToStaticMarkup(
    h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled: true, ...props }),
  );

  it('hideRail removes the DUPLICATE in-body rail, keeping the heading + Back/Next footer', () => {
    // Default (side-menu not driving) → the in-body rail still renders.
    expect(render({ initialStage: 'terms' })).toContain('search-workspace-rail');
    expect(render({ initialStage: 'terms', hideRail: false })).toContain('search-workspace-rail');
    // Driven by the white side-menu → the numbered rail is dropped (no duplication)…
    const chromeless = render({ initialStage: 'terms', hideRail: true });
    expect(chromeless).not.toContain('search-workspace-rail');
    // …but the per-stage heading, the stage surface and the footer stay.
    expect(chromeless).toContain('data-stage="terms"');
    expect(chromeless).toContain('Stage 2 of 7');
  });

  it('opens the stage the host derived from ?stage= (deep-link contract)', () => {
    // StitchProjectWorkspace reads ?stage= (readSearchStageParam) and passes it as
    // initialStage; the workspace must open on exactly that stage — the URL is the
    // source of truth for both the side-menu highlight and the body.
    const html = render({ hideRail: true, initialStage: 'documentation' });
    expect(html).toContain('data-stage="documentation"');
    expect(html).toContain('Stage 6 of 7');
    expect(html).toContain('Documentation');
    // a mode-invalid deep link is remapped (74.md) even when it arrives via the URL/host.
    expect(render({ hideRail: true, initialStage: 'strategy', initialSearchMode: 'automated' }))
      .toContain('data-stage="results"');
    // 96.md — a retired initialStage resolves through the alias map.
    expect(render({ hideRail: true, initialStage: 'concepts' })).toContain('data-stage="terms"');
  });

  it('the Send-to-Screening stage exposes a "Continue to Screening" handoff, disabled until ready', () => {
    const html = render({ hideRail: true, initialStage: 'screening' });
    expect(html).toContain('continue-to-screening');
    expect(html).toContain('Continue to Screening');
    // "do NOT mark complete on mere click": readyForScreening gates it, and under SSR
    // (no effects) the marker has not loaded → the handoff is disabled (no href).
    expect(html).toContain('aria-disabled="true"');
    // it is the LAST stage → the ordinary "Next:" stage button is not rendered.
    expect(html).not.toContain('Next:');
  });

  it('non-terminal stages still render the ordinary Back/Next footer (regression)', () => {
    const html = render({ hideRail: true, initialStage: 'mode' });
    expect(html).toContain('Next:');
    expect(html).not.toContain('continue-to-screening');
  });
});

describe('PubMedPulse — 73.md P3: honest hit-state presentation', () => {
  const render = (props) => renderToStaticMarkup(h(PubMedPulse, props));

  it('no concepts → the phrase-selection invitation, never a number', () => {
    const html = render({ snapshot: { status: 'updated', count: 999, updatedAt: Date.now() }, hasConcepts: false });
    expect(html).toContain('pubmed-pulse');
    expect(html).toContain('Select phrases from your research question to see a live PubMed estimate');
    expect(html).not.toContain('999');
  });

  it('concepts exist but zero live terms → "Add terms…" invitation, never a number', () => {
    const html = render({ snapshot: { status: 'updated', count: 999, updatedAt: Date.now() }, hasConcepts: true, liveTermCount: 0 });
    expect(html).toContain('Add terms to see a live PubMed estimate');
    expect(html).not.toContain('999');
  });

  it('a positive live-term count keeps the normal lifecycle (no empty branch)', () => {
    const html = render({ snapshot: { status: 'updated', count: 999, updatedAt: Date.now() }, hasConcepts: true, liveTermCount: 3 });
    expect(html).toContain('≈ 999 PubMed records');
    expect(html).not.toContain('Add terms to see');
  });

  it('an unknown live-term count (builder not reporting yet) never fakes the empty state', () => {
    const html = render({ snapshot: { status: 'updated', count: 42, updatedAt: Date.now() }, hasConcepts: true, liveTermCount: null });
    expect(html).toContain('≈ 42 PubMed records');
    expect(html).not.toContain('Add terms to see');
  });

  it('updated → the count as current, with a LIVE marker + relative time', () => {
    const html = render({ snapshot: { status: 'updated', count: 1234, updatedAt: Date.now() - 120000 }, hasConcepts: true });
    expect(html).toContain('≈ 1,234 PubMed records');
    expect(html).toContain('2m ago');
    expect(html.toLowerCase()).toContain('live');
    expect(html).not.toContain('<s>');
  });

  it('stale → amber refresh message; the old count is EXPLICITLY previous (struck through)', () => {
    const html = render({ snapshot: { status: 'stale', count: 1234, updatedAt: Date.now() }, hasConcepts: true });
    expect(html).toContain('Strategy changed — estimate refreshing…');
    expect(html).toContain('previous:');
    expect(html).toContain('<s>');
    expect(html).not.toContain('≈ 1,234 PubMed records'); // never presented as current
  });

  it('updating → spinner text; previous count struck through', () => {
    const html = render({ snapshot: { status: 'updating', count: 88, updatedAt: null }, hasConcepts: true });
    expect(html).toContain('Updating estimate…');
    expect(html).toContain('<s>');
  });

  it('failed → the unavailable message + a Retry button wired to the registered refresh', () => {
    const html = render({ snapshot: { status: 'failed', count: null, error: 'HTTP 500' }, hasConcepts: true, onRetry: () => {} });
    expect(html).toContain('PubMed estimate unavailable');
    expect(html).toContain('HTTP 500');
    expect(html).toContain('Retry');
  });

  it('is a polite live region', () => {
    const html = render({ snapshot: null, hasConcepts: true });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
  });
});

describe('findScrollableAncestor — 73.md P1 scroll model (pure walk, injectable styles)', () => {
  const node = (name, parentElement = null) => ({ name, parentElement, scrollTop: 99 });
  it('returns the nearest ancestor whose computed overflowY is auto|scroll', () => {
    const main = node('main');            // the Stitch shell scroller (overflowY:auto)
    const wrap = node('wrap', main);
    const root = node('root', wrap);
    const styles = { main: { overflowY: 'auto' }, wrap: { overflowY: 'visible' } };
    const found = findScrollableAncestor(root, (n) => styles[n.name] || {});
    expect(found).toBe(main);
  });
  it('skips the element itself and prefers the CLOSEST scrollable ancestor', () => {
    const outer = node('outer');
    const inner = node('inner', outer);
    const el = node('el', inner);
    const styles = { outer: { overflowY: 'scroll' }, inner: { overflowY: 'scroll' }, el: { overflowY: 'scroll' } };
    expect(findScrollableAncestor(el, (n) => styles[n.name]).name).toBe('inner');
  });
  it('returns null when no ancestor scrolls (caller falls back to window.scrollTo)', () => {
    const a = node('a');
    const b = node('b', a);
    expect(findScrollableAncestor(b, () => ({ overflowY: 'visible' }))).toBeNull();
    expect(findScrollableAncestor(null)).toBeNull();
  });
  it('survives a throwing getComputedStyle', () => {
    const a = node('a');
    const b = node('b', a);
    expect(findScrollableAncestor(b, () => { throw new Error('boom'); })).toBeNull();
  });
});

describe('persistSearchModeMerged — 73.md P5 (recs round: single-key save)', () => {
  // recs round — persistence is now a SINGLE-KEY save ({ searchMode }); the server
  // only overwrites named keys, so there is no read-merge that could replay an
  // empty strategy over the saved one when the read-back fails.
  it('writes ONLY searchMode and never reads the saved strategy back', async () => {
    const loadFn = vi.fn(async () => { throw new Error('should not be called'); });
    const saveFn = vi.fn(async () => ({ ok: true, revision: 5 }));
    const merged = await persistSearchModeMerged(loadFn, saveFn, 'p1', 'automated');
    expect(loadFn).not.toHaveBeenCalled();
    expect(saveFn).toHaveBeenCalledTimes(1);
    const [pid, payload] = saveFn.mock.calls[0];
    expect(pid).toBe('p1');
    expect(payload).toEqual({ searchMode: 'automated' });
    expect(Object.keys(payload)).toEqual(['searchMode']);
    expect(merged.searchMode).toBe('automated');
  });

  it('collapses a junk mode to null', async () => {
    const saveFn = vi.fn(async () => ({ ok: true }));
    await persistSearchModeMerged(async () => null, saveFn, 'p2', 'evil');
    const [, payload] = saveFn.mock.calls[0];
    expect(payload).toEqual({ searchMode: null });
  });

  it('throws when the save is rejected (caller soft-fails with an error Note)', async () => {
    await expect(persistSearchModeMerged(async () => null, async () => null, 'p3', 'manual'))
      .rejects.toThrow('save failed');
  });
});

describe('SearchWorkspace — wording rule: never says "AI"', () => {
  it('renders no user-facing "AI" across each mode\'s OWN stage list', () => {
    // recs round — iterate stagesFor(mode) so every reachable (stage, mode) cell is
    // exercised exactly once (a 'strategy'×automated seed would just remap to results).
    for (const mode of [undefined, 'manual', 'automated']) {
      for (const s of stagesFor(mode == null ? null : mode)) {
        const html = renderToStaticMarkup(
          h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled: true, initialStage: s.id, initialSearchMode: mode }),
        );
        expect(html).not.toMatch(/\bAI\b/);
      }
    }
  });
});

describe('searchWorkspaceV2FlagEnabled — the gate that routes the dispatcher (fetch stubbed)', () => {
  const stub = (flags) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ featureFlags: flags }) })));

  // 96.md — the legacy wizard is deleted, so the old searchWorkspaceV2 key is
  // deprecated/IGNORED: the workspace renders whenever searchEngine is ON.
  it('is ON whenever searchEngine is on (searchWorkspaceV2 ignored)', async () => {
    stub({ searchEngine: true });
    expect(await searchWorkspaceV2FlagEnabled()).toBe(true);
    stub({ searchWorkspaceV2: false, searchEngine: true });
    expect(await searchWorkspaceV2FlagEnabled()).toBe(true);
  });

  it('is OFF when searchEngine is off (→ dispatcher renders the legacy in-blob SearchTab)', async () => {
    stub({ searchWorkspaceV2: true, searchEngine: false });
    expect(await searchWorkspaceV2FlagEnabled()).toBe(false);
  });

  it('is OFF when the flag is absent, and fails closed on a network error', async () => {
    stub({});
    expect(await searchWorkspaceV2FlagEnabled()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    expect(await searchWorkspaceV2FlagEnabled()).toBe(false);
  });
});

/* ══════════ 96.md QA M18 + L24 — question editor: field lock + legacy empty copy ══ */

describe('QuestionStage — QA M18 field lock + QA L24 legacy-PICO empty state (SSR)', () => {
  const mount = (props) => renderToStaticMarkup(
    h(SearchWorkspace, { projectId: 'p1', readOnly: false, pecanEnabled: true, initialStage: 'question', updNested: () => {}, ...props }),
  );

  it('M18: a teammate holding the pico.question lock disables the editor with "X is editing"', () => {
    const lockCtx = { pid: 'sp1', myUserId: 'me', locks: [{ field: 'pico.question', userId: 'other', name: 'Aisha' }] };
    const html = mount({ pico: PICO, lockCtx });
    expect(html).toContain('data-testid="search-question-editor"');
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toContain('data-testid="search-question-locked"');
    expect(html).toContain('Aisha is editing');
  });
  it('M18: my own lock (or no lock) leaves the editor enabled — fail-open', () => {
    const mine = { pid: 'sp1', myUserId: 'me', locks: [{ field: 'pico.question', userId: 'me', name: 'Me' }] };
    expect(mount({ pico: PICO, lockCtx: mine })).not.toMatch(/<textarea[^>]*disabled/);
    expect(mount({ pico: PICO })).not.toMatch(/<textarea[^>]*disabled/); // no lockCtx at all
    expect(mount({ pico: PICO })).not.toContain('is editing');
  });
  it('L24: blank question + legacy P/I/C/O values → the "planned with PICO" helper copy', () => {
    const legacy = { P: 'adults with T2DM', I: 'metformin', question: '' };
    const html = mount({ pico: legacy });
    expect(html).toContain('This project was planned with PICO');
    // read-only variant carries the copy too (no editor seam)
    const ro = renderToStaticMarkup(h(SearchWorkspace, { projectId: 'p1', readOnly: true, pecanEnabled: true, initialStage: 'question', pico: legacy }));
    expect(ro).toContain('This project was planned with PICO');
  });
  it('L24: a blank question WITHOUT legacy PICO keeps the plain empty copy', () => {
    const html = mount({ pico: { question: '' } });
    expect(html).not.toContain('planned with PICO');
    expect(html).toContain('What question should this review answer?');
  });
  it('L28: the editor renders the question as its value (local draft seeds from pico.question)', () => {
    const html = mount({ pico: PICO });
    expect(html).toContain('does metformin help?');
  });
});
