/**
 * designModeUi.test.jsx — DesignRoute gating + the StitchErrorBoundary recovery
 * panel, rendered to static markup with useDesignMode mocked. Confirms the
 * visible contract (65.md — the in-app AdminDesignSwitch is GONE):
 *   - DesignRoute renders stitch when active, legacy otherwise
 *   - the error boundary passes children through when nothing threw
 *   - the crashed panel offers "Reload page" + "Back to dashboard" to everyone
 *   - the "Switch to classic UI" escape renders ONLY for admins
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockState = { value: { mode: 'stitch', isStitch: true, isAdmin: false, setMode: () => {}, toggle: () => {} } };
vi.mock('../../src/frontend/design/DesignModeContext.jsx', () => ({
  useDesignMode: () => mockState.value,
  DesignModeProvider: ({ children }) => children,
}));

// Import AFTER the mock is registered.
const DesignRoute = (await import('../../src/frontend/design/DesignRoute.jsx')).default;
const boundaryModule = await import('../../src/frontend/design/StitchErrorBoundary.jsx');
const StitchErrorBoundary = boundaryModule.default;
const { StitchErrorBoundaryClass } = boundaryModule;

beforeEach(() => {
  mockState.value = { mode: 'stitch', isStitch: true, isAdmin: false, setMode: () => {}, toggle: () => {} };
});

/* Render the crashed panel directly: error boundaries cannot catch during static
   SSR, so we drive the class's render() with the error state pre-set — the exact
   markup a browser user sees after getDerivedStateFromError fires. */
function renderCrashed({ isAdmin }) {
  const inst = new StitchErrorBoundaryClass({ isAdmin, children: null });
  inst.state = { error: new Error('boom') };
  return renderToStaticMarkup(inst.render());
}

describe('StitchErrorBoundary', () => {
  it('passes children through when nothing threw (via the hook wrapper)', () => {
    const html = renderToStaticMarkup(h(StitchErrorBoundary, null, h('div', null, 'HEALTHY CONTENT')));
    expect(html).toContain('HEALTHY CONTENT');
    expect(html).not.toContain('Something went wrong');
  });

  it('shows a calm recovery panel with Reload + Back to dashboard for a normal user', () => {
    const html = renderCrashed({ isAdmin: false });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Reload page');
    expect(html).toContain('Back to dashboard');
    // Product-grade copy — no beta/preview tone.
    expect(html.toLowerCase()).not.toContain('snag');
    expect(html.toLowerCase()).not.toContain('preview');
  });

  it('hides the classic-UI escape from non-admins', () => {
    const html = renderCrashed({ isAdmin: false });
    expect(html).not.toContain('Switch to classic UI');
  });

  it('offers the classic-UI escape to an admin', () => {
    const html = renderCrashed({ isAdmin: true });
    expect(html).toContain('Switch to classic UI');
    expect(html).toContain('Reload page');
    expect(html).toContain('Back to dashboard');
  });
});

describe('DesignRoute', () => {
  const legacy = h('div', null, 'LEGACY VIEW');
  const stitch = h('div', null, 'STITCH VIEW');

  it('renders legacy when stitch is inactive', () => {
    mockState.value = { ...mockState.value, isStitch: false, mode: 'legacy' };
    const html = renderToStaticMarkup(h(DesignRoute, { legacy, stitch }));
    expect(html).toContain('LEGACY VIEW');
    expect(html).not.toContain('STITCH VIEW');
  });

  it('renders stitch when active and a stitch element is provided', () => {
    mockState.value = { ...mockState.value, isStitch: true };
    const html = renderToStaticMarkup(h(DesignRoute, { legacy, stitch }));
    expect(html).toContain('STITCH VIEW');
    expect(html).not.toContain('LEGACY VIEW');
  });

  it('falls back to legacy when stitch is active but no stitch element exists', () => {
    mockState.value = { ...mockState.value, isStitch: true };
    const html = renderToStaticMarkup(h(DesignRoute, { legacy, stitch: null }));
    expect(html).toContain('LEGACY VIEW');
  });
});
