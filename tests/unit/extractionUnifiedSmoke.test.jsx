/**
 * extractionUnifiedSmoke.test.jsx — RoadMap/1.md. SSR-safe smoke tests for the wired
 * ExtractionTab: the classic empty state (which the e2e spec drives) still renders,
 * the new "Assisted workspace" toggle is present, and a protocol-scoped DRAFT renders
 * through DraftReviewList without crashing. Mirrors the house SSR style (no jsdom;
 * effects don't run in renderToStaticMarkup, so the lazy PDF workspace is never
 * imported here).
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

describe('ExtractionTab (unified workspace wiring, SSR smoke)', () => {
  it('renders the classic empty state + the Data Extraction heading (e2e-critical)', () => {
    const project = mkProject('Demo');
    const html = renderTab(project);
    expect(html).toContain('Data Extraction');
    expect(html).toContain('No studies yet');
  });

  it('shows the "Assisted workspace" toggle on an editable project', () => {
    const project = mkProject('Demo');
    const html = renderTab(project);
    expect(html).toContain('Assisted workspace');
  });

  it('does NOT show edit affordances on a read-only project', () => {
    const project = { ...mkProject('Demo'), _readOnly: true };
    const html = renderTab(project);
    expect(html).not.toContain('Assisted workspace');
  });

  it('renders a protocol-scoped draft through DraftReviewList without crashing', () => {
    const project = mkProject('Demo');
    project.studies = [{ ...require_mkStudy() }];
    project.extractionDrafts = [mkExtractionRecord({
      author: 'Smith', year: '2024', outcome: 'All-cause mortality', esType: 'HR',
      scope: { level: 'primary', outcomeId: 'p1', canonical: 'all-cause mortality' },
      values: { es: String(Math.log(0.75)), lo: String(Math.log(0.6)), hi: String(Math.log(0.94)) },
      provenance: { method: 'auto', page: 4, excerpt: 'All-cause mortality was lower (HR 0.75).', at: '2026-07-03T00:00:00Z' },
      confidence: 'medium',
    })];
    const html = renderTab(project);
    expect(html).toContain('Data Extraction');
    // the draft's outcome + method surface in the review list
    expect(html.toLowerCase()).toContain('mortality');
  });

  it('DraftReviewList returns empty output when there is nothing to review', () => {
    const html = renderToStaticMarkup(createElement(DraftReviewList, { drafts: [], parked: [] }));
    expect(html).toBe('');
  });
});

// mkStudy is not exported from defaults under that name into this scope cleanly in SSR;
// build a minimal study inline to avoid importing the workspace helper barrel.
function require_mkStudy() {
  return { id: 'st1', author: 'Smith', year: '2024', design: 'RCT', outcome: '', es: '', lo: '', hi: '' };
}
