/**
 * searchWorkspace.test.jsx — 71.md. SSR-safe smoke tests for the staged Search
 * Workspace redesign. Static render runs no effects, so no network is touched; we assert
 * the 8-stage rail renders, each stage mounts its COMPOSED existing component without
 * throwing, the wording rule (no user-facing "AI") holds, and the flag gate that routes
 * the dispatcher (searchWorkspaceV2 → SearchWorkspace, else the byte-identical
 * SearchWizard) behaves. Mirrors searchWizard.test.jsx / pecanSearchTab.test.jsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchWorkspace, searchWorkspaceV2FlagEnabled } from '../../src/features/searchWorkspace/index.js';

afterEach(() => { vi.unstubAllGlobals(); });

const PICO = { P: 'adults with type 2 diabetes', question: 'does metformin help?' };

// Note: the SSR markup HTML-escapes "&" to "&amp;", so ampersand labels are matched escaped.
const STAGE_LABELS = [
  'Research Question', 'Concepts', 'Terms &amp; Vocabulary', 'Strategy Builder',
  'Test &amp; Refine', 'Results', 'Documentation', 'Send to Screening',
];

describe('SearchWorkspace (SSR smoke)', () => {
  it('renders ONE unified header + the 8-stage rail, defaulting to Research Question', () => {
    const html = renderToStaticMarkup(
      h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled: true }),
    );
    // One header, not three
    expect(html).toContain('>Pecan Search Engine<');
    // Every stage appears in the left rail
    for (const label of STAGE_LABELS) expect(html).toContain(label);
    // Default stage is Research Question (stage 1 of 8) — the run engine is NOT mounted yet
    expect(html).toContain('Stage 1 of 8');
    expect(html).toContain('Research question');
    expect(html).not.toContain('Run search — Pecan Search Engine');
  });

  it('renders without crashing in read-only mode with the automated run disabled', () => {
    const html = renderToStaticMarkup(
      h(SearchWorkspace, { projectId: 'p2', pico: {}, readOnly: true, pecanEnabled: false }),
    );
    expect(html).toContain('Stage 1 of 8');
    for (const label of STAGE_LABELS) expect(html).toContain(label);
  });
});

describe('SearchWorkspace — each stage composes its existing component without throwing', () => {
  const render = (initialStage, pecanEnabled = true) => renderToStaticMarkup(
    h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled, initialStage }),
  );

  it('Research Question → PICO summary', () => {
    const html = render('question');
    expect(html).toContain('Research question');
    expect(html).toContain('does metformin help?');
  });

  it('Concepts + Terms + Strategy → the embedded Search Builder (define/build phases)', () => {
    for (const stage of ['concepts', 'terms', 'strategy']) {
      const html = render(stage);
      // The builder mounts (its SSR loading shell) — proving the reused engine composes.
      expect(html).toContain('Loading search');
    }
    expect(render('concepts')).toContain('Concepts');
    expect(render('terms')).toContain('Terms &amp; vocabulary'); // "&" is HTML-escaped in SSR markup
    expect(render('strategy')).toContain('Strategy builder');
  });

  it('Test & Refine → preview counts + quality panel + versions panel', () => {
    const html = render('refine');
    expect(html).toContain('Test &amp; refine');
    expect(html).toContain('Estimated results per database');
    expect(html).toContain('Search quality');   // SearchQualityPanel shell
    expect(html).toContain('Versions');          // SearchVersionsPanel shell
  });

  it('Results → the PecanSearchTab run surface (when the automated run is enabled)', () => {
    expect(render('results', true)).toContain('Run search — Pecan Search Engine');
    // When the run engine is off, a calm enable-in-Ops surface (no silent 404)
    expect(render('results', false)).toContain('Run the search');
  });

  it('Documentation → the reproducibility export panel (methods + PRISMA-S)', () => {
    const html = render('documentation');
    expect(html).toContain('Documentation');
    expect(html).toContain('Reproducibility'); // SearchExportPanel
  });

  it('Send to Screening → first-class handoff (readyForScreening + Go to Screening)', () => {
    const html = render('screening');
    expect(html).toContain('Send to screening');
    expect(html).toContain('Go to Screening');
  });
});

describe('SearchWorkspace — wording rule: never says "AI"', () => {
  it('renders no user-facing "AI" across the stages', () => {
    for (const stage of ['question', 'concepts', 'terms', 'strategy', 'refine', 'results', 'documentation', 'screening']) {
      const html = renderToStaticMarkup(
        h(SearchWorkspace, { projectId: 'p1', pico: PICO, readOnly: false, pecanEnabled: true, initialStage: stage }),
      );
      expect(html).not.toMatch(/\bAI\b/);
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
