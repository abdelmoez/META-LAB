/**
 * searchWizard.test.jsx — prompt60. SSR-safe smoke tests for the unified 3-step
 * Search stage (Define → Build → Run). Static render runs no effects, so no network
 * is touched; we assert the wizard chrome renders and the embedded builder mounts in
 * the Define step.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchWizard } from '../../src/features/searchWizard/index.js';

describe('SearchWizard (SSR smoke)', () => {
  it('renders the 3-step chrome (Define → Build → Run) and mounts the builder on Define', () => {
    const html = renderToStaticMarkup(
      createElement(SearchWizard, { projectId: 'p1', pico: { P: 'adults', question: 'does X work?' }, readOnly: false, pecanEnabled: true }),
    );
    // Step header
    expect(html).toContain('Define');
    expect(html).toContain('Build');
    expect(html).toContain('Run');
    // Stage title + the embedded builder's loading state (effects don't run in SSR)
    expect(html).toContain('>Search<');
    expect(html).toContain('Loading search');
    // Default step is Define, so the run engine ("Search & Discovery") is NOT mounted yet
    expect(html).not.toContain('Review &amp; run');
  });

  it('renders without crashing in read-only mode with the run engine disabled', () => {
    const html = renderToStaticMarkup(
      createElement(SearchWizard, { projectId: 'p2', pico: {}, readOnly: true, pecanEnabled: false }),
    );
    expect(html).toContain('Define');
    expect(html).toContain('Step 1 of 3');
  });
});
