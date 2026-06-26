/**
 * designModeUi.test.jsx — the admin design switch + DesignRoute gating, rendered
 * to static markup with useDesignMode mocked. Confirms the visible contract:
 *   - non-admins NEVER see the switch (returns nothing)
 *   - admins see a labelled Classic/Stitch segmented control with the active state
 *   - DesignRoute renders legacy by default and stitch only when active
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const mockState = { value: { mode: 'legacy', isStitch: false, isAdmin: false, setMode: () => {}, toggle: () => {} } };
vi.mock('../../src/frontend/design/DesignModeContext.jsx', () => ({
  useDesignMode: () => mockState.value,
  DesignModeProvider: ({ children }) => children,
}));

// Import AFTER the mock is registered.
const AdminDesignSwitch = (await import('../../src/frontend/design/AdminDesignSwitch.jsx')).default;
const DesignRoute = (await import('../../src/frontend/design/DesignRoute.jsx')).default;

// AdminDesignSwitch reads the route (useLocation) to hide the floating pill on
// project pages (55.md #21), so it must render inside a Router — as it always does
// in the app (its sibling DesignModeProvider needs one too).
const renderSwitch = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(AdminDesignSwitch, props)));

beforeEach(() => {
  mockState.value = { mode: 'legacy', isStitch: false, isAdmin: false, setMode: () => {}, toggle: () => {} };
});

describe('AdminDesignSwitch (inline)', () => {
  it('renders nothing for a non-admin', () => {
    mockState.value = { ...mockState.value, isAdmin: false };
    expect(renderSwitch({ variant: 'inline' })).toBe('');
  });

  it('renders a labelled Classic/Stitch radiogroup for an admin', () => {
    mockState.value = { mode: 'legacy', isStitch: false, isAdmin: true, setMode: () => {}, toggle: () => {} };
    const html = renderSwitch({ variant: 'inline' });
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Interface design"');
    expect(html).toContain('Classic');
    expect(html).toContain('Stitch');
  });

  it('marks the active mode with aria-checked', () => {
    mockState.value = { mode: 'stitch', isStitch: true, isAdmin: true, setMode: () => {}, toggle: () => {} };
    const html = renderSwitch({ variant: 'inline' });
    // The Stitch radio should be checked when stitch is active.
    expect(html).toMatch(/aria-checked="true"[^>]*>Stitch|Stitch<\/button>/);
    expect(html).toContain('aria-checked="true"');
  });
});

describe('DesignRoute', () => {
  const legacy = h('div', null, 'LEGACY VIEW');
  const stitch = h('div', null, 'STITCH VIEW');

  it('renders legacy when stitch is inactive', () => {
    mockState.value = { ...mockState.value, isStitch: false };
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
