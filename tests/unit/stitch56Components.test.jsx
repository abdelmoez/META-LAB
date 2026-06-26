/**
 * stitch56Components.test.jsx — SSR smoke for the 56.md navigation components:
 *   · StitchProjectRail — grouping + separators, Back to Projects, the main vertical
 *     stepper, and the accessible pin control.
 *   · StitchProjectSubnav — the Screen category's detailed vertical screening
 *     stepper, driven by the shared buildScreeningSteps() model (live counts).
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildScreeningSteps } from '../../src/frontend/screening/ui/screeningSteps.js';

vi.mock('../../src/frontend/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Dr Lee', email: 'l@b.co', role: 'admin' } }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('../../src/frontend/stitch/shell/useAppVersion.js', () => ({ useAppVersion: () => '3.56.0' }));
// Isolate the subnav from the heavy app chrome (StitchContextRail pulls the whole
// shell). A minimal passthrough keeps the screening-stepper render assertions sharp.
vi.mock('../../src/frontend/stitch/shell/shellParts.jsx', () => ({
  StitchContextRail: ({ title, subtitle, children }) => h('aside', { 'aria-label': title },
    h('h1', null, title), subtitle ? h('p', null, subtitle) : null, children),
}));
vi.mock('../../src/frontend/stitch/primitives/overlay.jsx', () => ({
  StitchTooltip: ({ children }) => children,
}));

const StitchProjectRail = (await import('../../src/frontend/stitch/shell/StitchProjectRail.jsx')).default;
const StitchProjectSubnav = (await import('../../src/frontend/stitch/shell/StitchProjectSubnav.jsx')).default;

describe('56.md — StitchProjectRail', () => {
  const html = renderToStaticMarkup(h(StitchProjectRail, {
    projectId: 'p1', linkedSiftId: 's1', activeStage: 'screening', variant: 'overlay',
    pinned: false, onTogglePin: () => {},
    statusMap: { pico: 'done', prospero: 'done', search: 'partial' },
    attentionMap: { screen: true },
  }));

  it('is a labelled navigation landmark', () => {
    expect(html).toContain('aria-label="Project workflow"');
  });
  it('shows Back to Projects and the three conceptual groups', () => {
    expect(html).toContain('Back to Projects');
    expect(html).toContain('Project Management');
    expect(html).toContain('Research Workflow');
    expect(html).toContain('Project Resources');
  });
  it('renders the workflow categories as a stepper with the active step marked', () => {
    expect(html).toContain('Plan &amp; Protocol');
    expect(html).toContain('aria-current="step"'); // active screening step
  });
  it('renders an accessible pin control (aria-pressed)', () => {
    expect(html).toContain('aria-pressed="false"');
    expect(html.toLowerCase()).toContain('pin');
    const pinned = renderToStaticMarkup(h(StitchProjectRail, { projectId: 'p1', activeStage: 'overview', pinned: true, onTogglePin: () => {} }));
    expect(pinned).toContain('aria-pressed="true"');
  });
  it('separators are present between groups', () => {
    expect(html).toContain('role="separator"');
  });
});

describe('56.md — StitchProjectSubnav screening vertical stepper', () => {
  const summary = {
    totalArticles: 3900, duplicateDetectionRun: true, unresolvedDuplicateGroups: 312,
    titleAbstractPending: 1796, unresolvedConflicts: 14, eligibleSecondReview: 63,
    acceptedToExtraction: 0, rejectedSecond: 0,
  };
  const steps = buildScreeningSteps(summary);
  const html = renderToStaticMarkup(h(StitchProjectSubnav, {
    projectId: 'p1', linkedSiftId: 's1', category: 'screen', activeKey: 'conflicts', screeningSteps: steps,
  }));

  it('renders the screening workflow with live counts from the shared model', () => {
    expect(html).toContain('Screening workflow');
    expect(html).toContain('Import');
    expect(html).toContain('Conflicts');
    expect(html).toContain('312 unresolved'); // duplicates count
    expect(html).toContain('14 conflict');     // conflicts count
  });
  it('marks the active screening step', () => {
    expect(html).toContain('aria-current="step"');
  });

  it('disables screening sub-pages with no linked workspace (still navigable PRISMA)', () => {
    const noLink = renderToStaticMarkup(h(StitchProjectSubnav, {
      projectId: 'p1', linkedSiftId: null, category: 'screen', activeKey: 'overview', screeningSteps: [],
    }));
    expect(noLink).toContain('disabled'); // import/etc. disabled until screening is linked
  });
});
