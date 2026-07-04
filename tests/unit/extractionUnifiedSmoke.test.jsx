/**
 * extractionUnifiedSmoke.test.jsx — e1.md. SSR-safe smoke tests for the wired
 * ExtractionTab: the classic empty state (which the e2e spec drives) still renders, the
 * split-screen assisted workspace is now the MAIN surface (mounted as the tab body once a
 * study exists), and a protocol-scoped DRAFT renders through DraftReviewList without
 * crashing. Mirrors the house SSR style (no jsdom; effects don't run in
 * renderToStaticMarkup, so the lazy PDF workspace renders only its Suspense fallback).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExtractionTab } from '../../src/frontend/workspace/tabs/extractionTabs.jsx';
import DraftReviewList from '../../src/features/extraction/unified/DraftReviewList.jsx';
import { mkExtractionRecord } from '../../src/research-engine/extraction/records.js';
import { mkProject } from '../../src/research-engine/project-model/defaults.js';

const renderTab = (project) =>
  renderToStaticMarkup(createElement(ExtractionTab, { project, updateProject: () => {}, activeId: project.id }));

const withStudy = (project) => {
  project.studies = [{ id: 'st1', author: 'Smith', year: '2024', design: 'RCT', outcome: '', es: '', lo: '', hi: '' }];
  return project;
};

describe('ExtractionTab (unified workspace wiring, SSR smoke)', () => {
  it('renders the classic empty state + the Data Extraction heading (e2e-critical)', () => {
    const project = mkProject('Demo');
    const html = renderTab(project);
    expect(html).toContain('Data Extraction');
    expect(html).toContain('No studies yet');
  });

  it('mounts the split-screen assisted workspace as the main surface once a study exists', () => {
    const project = withStudy(mkProject('Demo'));
    const html = renderTab(project);
    // The panel is lazy — its Suspense fallback proves it is wired as the primary body.
    expect(html).toContain('Loading the extraction workspace');
    // The classic records table lives below, under its scroll anchor.
    expect(html).toContain('extraction-records');
    expect(html).toContain('Extracted records');
  });

  it('does NOT show edit affordances on a read-only project', () => {
    const project = { ...mkProject('Demo'), _readOnly: true };
    const html = renderTab(project);
    expect(html).not.toContain('Add First Study');   // add CTA is gated behind !readOnly
    expect(html).not.toContain('Loading the extraction workspace'); // panel hidden for read-only
  });

  it('renders a protocol-scoped draft through DraftReviewList without crashing', () => {
    const draft = mkExtractionRecord({
      author: 'Smith', year: '2024', outcome: 'All-cause mortality', esType: 'HR',
      scope: { level: 'primary', outcomeId: 'p1', canonicalName: 'all-cause mortality' },
      values: { es: String(Math.log(0.75)), lo: String(Math.log(0.6)), hi: String(Math.log(0.94)) },
      provenance: { method: 'auto', page: 4, excerpt: 'All-cause mortality was lower (HR 0.75).', at: '2026-07-03T00:00:00Z' },
      confidence: 'medium',
    });
    const outcomes = [{ id: 'p1', level: 'primary', name: 'All-cause mortality', canonical: 'all-cause mortality' }];
    const html = renderToStaticMarkup(createElement(DraftReviewList, { drafts: [draft], parked: [], outcomes }));
    // the draft's outcome surfaces in the review list, and the confirm gate is present
    expect(html.toLowerCase()).toContain('mortality');
    expect(html).toContain('Confirm');
  });

  it('DraftReviewList returns empty output when there is nothing to review', () => {
    const html = renderToStaticMarkup(createElement(DraftReviewList, { drafts: [], parked: [] }));
    expect(html).toBe('');
  });
});
