/**
 * searchWorkspace.test.jsx — 71.md + 73.md. SSR-safe smoke tests for the staged Search
 * Workspace redesign. Static render runs no effects, so no network is touched; we assert
 * the 9-stage rail renders (incl. the new Search Mode stage), each stage mounts its
 * COMPOSED existing component without throwing, the two-path mode model behaves
 * (mode cards, mode-aware Results, header badge), the PubMed pulse presents hit-state
 * snapshots honestly, the scroll-model walker + search-mode persistence helpers are
 * pure-tested, the wording rule (no user-facing "AI") holds, and the flag gate that
 * routes the dispatcher behaves. Mirrors searchWizard.test.jsx / pecanSearchTab.test.jsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SearchWorkspace, searchWorkspaceV2FlagEnabled,
  STAGES, stagesFor, PubMedPulse, findScrollableAncestor, persistSearchModeMerged,
} from '../../src/features/searchWorkspace/index.js';

afterEach(() => { vi.unstubAllGlobals(); });

const PICO = { P: 'adults with type 2 diabetes', question: 'does metformin help?' };

// Note: the SSR markup HTML-escapes "&" to "&amp;", so ampersand labels are matched escaped.
const STAGE_LABELS = [
  'Research Question', 'Concepts', 'Terms &amp; Vocabulary', 'Search Mode', 'Database Strategies',
  'Test &amp; Refine', 'Run Externally', 'Documentation', 'Send to Screening',
];

describe('SearchWorkspace (SSR smoke)', () => {
  it('renders ONE unified header + the 9-stage rail, defaulting to Research Question', () => {
    const html = renderToStaticMarkup(
      h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled: true }),
    );
    // One header, not three
    expect(html).toContain('>Pecan Search Engine<');
    // Every stage appears in the left rail
    for (const label of STAGE_LABELS) expect(html).toContain(label);
    // Default stage is Research Question (stage 1 of 9) — the run engine is NOT mounted yet
    expect(html).toContain('Stage 1 of 9');
    expect(html).toContain('Research question');
    expect(html).not.toContain('Run search — Pecan Search Engine');
  });

  it('renders without crashing in read-only mode with the automated run disabled', () => {
    const html = renderToStaticMarkup(
      h(SearchWorkspace, { projectId: 'p2', pico: {}, readOnly: true, pecanEnabled: false }),
    );
    expect(html).toContain('Stage 1 of 9');
    for (const label of STAGE_LABELS) expect(html).toContain(label);
  });
});

describe('STAGES / stagesFor — 73.md P5 renumbering + mode-aware Results label', () => {
  it('has 9 stages in the locked order, with mode inserted after terms', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'question', 'concepts', 'terms', 'mode', 'strategy', 'refine', 'results', 'documentation', 'screening',
    ]);
    expect(STAGES.map((s) => s.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(STAGES.find((s) => s.id === 'strategy').label).toBe('Database Strategies');
  });
  it('labels Results mode-aware: automated → Automated Search, manual/null → Run Externally', () => {
    const res = (mode) => stagesFor(mode).find((s) => s.id === 'results');
    expect(res('automated').label).toBe('Automated Search');
    expect(res('automated').desc).toBe('Run & deduplicate');
    expect(res('manual').label).toBe('Run Externally');
    expect(res(null).label).toBe('Run Externally');
    expect(res(null).desc).toBe('Your database accounts');
  });
  it('maps builder stages to the 3-way embedded phases', () => {
    expect(STAGES.find((s) => s.id === 'concepts').phase).toBe('concepts');
    expect(STAGES.find((s) => s.id === 'terms').phase).toBe('terms');
    expect(STAGES.find((s) => s.id === 'strategy').phase).toBe('build');
  });
});

describe('SearchWorkspace — each stage composes its existing component without throwing', () => {
  const render = (initialStage, pecanEnabled = true, initialSearchMode) => renderToStaticMarkup(
    h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled, initialStage, initialSearchMode }),
  );

  it('Research Question → PICO summary', () => {
    const html = render('question');
    expect(html).toContain('Research question');
    expect(html).toContain('does metformin help?');
  });

  it('Concepts + Terms + Strategy → the embedded Search Builder (concepts/terms/build phases)', () => {
    for (const stage of ['concepts', 'terms', 'strategy']) {
      const html = render(stage);
      // The builder mounts (its SSR loading shell) — proving the reused engine composes.
      expect(html).toContain('Loading search');
    }
    expect(render('concepts')).toContain('Concepts');
    expect(render('terms')).toContain('Terms &amp; vocabulary'); // "&" is HTML-escaped in SSR markup
    expect(render('strategy')).toContain('Database strategies');
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

  it('Strategy stage: automated mode shows the provider summary FIRST + the run CTA', () => {
    const html = render('strategy', true, 'automated');
    expect(html).toContain('automated-strategy-summary');
    expect(html).toContain('Continue to Automated Search');
    // manual mode: no automated summary
    expect(render('strategy', true, 'manual')).not.toContain('automated-strategy-summary');
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
      expect(html).toContain('Switch to Automated');
      expect(html).not.toContain('Search strategy'); // PecanSearchTab's strategy card
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

  it('Test & Refine → preview counts + quality panel + versions panel', () => {
    const html = render('refine');
    expect(html).toContain('Test &amp; refine');
    expect(html).toContain('Estimated results per database');
    expect(html).toContain('Search quality');   // SearchQualityPanel shell
    expect(html).toContain('Versions');          // SearchVersionsPanel shell
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

describe('PubMedPulse — 73.md P3: honest hit-state presentation', () => {
  const render = (props) => renderToStaticMarkup(h(PubMedPulse, props));

  it('no concepts → the invitation, never a number', () => {
    const html = render({ snapshot: { status: 'updated', count: 999, updatedAt: Date.now() }, hasConcepts: false });
    expect(html).toContain('pubmed-pulse');
    expect(html).toContain('Add concepts to see a live PubMed estimate');
    expect(html).not.toContain('999');
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

describe('persistSearchModeMerged — 73.md P5 load→merge→save persistence', () => {
  const SAVED = {
    concepts: [{ id: 'c1', label: 'Population', terms: [{ text: 'adults' }] }],
    overrides: { pubmed: 'adults[tiab]' },
    ignored: [{ text: 'x', field: '', label: '' }],
    databases: ['pubmed', 'embase'],
    dismissedWarnings: ['w1'],
    filters: { dateFrom: '2010', dateTo: '', languages: ['en'], pubTypes: [] },
    readyForScreening: true,
    revision: 4,
  };

  it('merges the saved strategy and writes searchMode WITHOUT dropping any sibling key', async () => {
    const loadFn = vi.fn(async () => SAVED);
    const saveFn = vi.fn(async () => ({ ok: true, revision: 5 }));
    const merged = await persistSearchModeMerged(loadFn, saveFn, 'p1', 'automated');
    expect(loadFn).toHaveBeenCalledWith('p1');
    expect(saveFn).toHaveBeenCalledTimes(1);
    const [pid, payload] = saveFn.mock.calls[0];
    expect(pid).toBe('p1');
    expect(payload.searchMode).toBe('automated');
    expect(payload.concepts).toEqual(SAVED.concepts);
    expect(payload.overrides).toEqual(SAVED.overrides);
    expect(payload.databases).toEqual(SAVED.databases);
    expect(payload.dismissedWarnings).toEqual(SAVED.dismissedWarnings);
    expect(payload.filters).toEqual(SAVED.filters);
    expect(payload.readyForScreening).toBe(true);
    expect(merged.searchMode).toBe('automated');
  });

  it('collapses a junk mode to null and tolerates a missing saved strategy', async () => {
    const saveFn = vi.fn(async () => ({ ok: true }));
    await persistSearchModeMerged(async () => null, saveFn, 'p2', 'evil');
    const [, payload] = saveFn.mock.calls[0];
    expect(payload.searchMode).toBeNull();
    expect(payload.concepts).toEqual([]);
    expect(payload.readyForScreening).toBe(false);
  });

  it('throws when the save is rejected (caller soft-fails with an error Note)', async () => {
    await expect(persistSearchModeMerged(async () => SAVED, async () => null, 'p3', 'manual'))
      .rejects.toThrow('save failed');
  });
});

describe('SearchWorkspace — wording rule: never says "AI"', () => {
  it('renders no user-facing "AI" across the stages (both modes)', () => {
    for (const stage of ['question', 'concepts', 'terms', 'mode', 'strategy', 'refine', 'results', 'documentation', 'screening']) {
      for (const mode of [undefined, 'manual', 'automated']) {
        const html = renderToStaticMarkup(
          h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled: true, initialStage: stage, initialSearchMode: mode }),
        );
        expect(html).not.toMatch(/\bAI\b/);
      }
    }
  });
});

describe('searchWorkspaceV2FlagEnabled — the gate that routes the dispatcher (fetch stubbed)', () => {
  const stub = (flags) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ featureFlags: flags }) })));

  it('is ON only when BOTH searchWorkspaceV2 AND searchEngine are on', async () => {
    stub({ searchWorkspaceV2: true, searchEngine: true });
    expect(await searchWorkspaceV2FlagEnabled()).toBe(true);
  });

  it('is OFF when the redesign flag is off (→ dispatcher renders the legacy SearchWizard)', async () => {
    stub({ searchWorkspaceV2: false, searchEngine: true });
    expect(await searchWorkspaceV2FlagEnabled()).toBe(false);
  });

  it('is OFF when its searchEngine dependency is off', async () => {
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
