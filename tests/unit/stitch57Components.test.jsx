/**
 * stitch57Components.test.jsx — 57.md component + CSS contracts:
 *   · the shared <StitchWorkflowStepper> ALWAYS shows step numbers (status never
 *     replaces the number), marks the active step, and disables unavailable steps;
 *   · the purple rail main stepper ALWAYS shows step numbers;
 *   · buildStitchCss scopes rail hover-expansion to the rail (:has) and resets
 *     native-control fonts.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildStitchCss } from '../../src/frontend/stitch/theme/stitchTokens.js';

vi.mock('../../src/frontend/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Dr Lee', email: 'l@b.co', role: 'admin' } }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('../../src/frontend/stitch/shell/useAppVersion.js', () => ({ useAppVersion: () => '3.57.0' }));
vi.mock('../../src/frontend/stitch/primitives/overlay.jsx', () => ({
  StitchTooltip: ({ children }) => children,
}));

const StitchWorkflowStepper = (await import('../../src/frontend/stitch/shell/StitchWorkflowStepper.jsx')).default;
const StitchProjectRail = (await import('../../src/frontend/stitch/shell/StitchProjectRail.jsx')).default;

const STEPS = [
  { key: 'pico', label: 'PICO & Question', icon: 'target', href: '/a', num: 1, status: 'done', count: null, desc: 'The question' },
  { key: 'prospero', label: 'Protocol', icon: 'clipboard', href: '/b', num: 2, status: 'partial', count: null, desc: 'Register it' },
  { key: 'locked', label: 'Protocol Review', icon: 'lock', href: null, num: 3, status: 'empty', count: null, desc: null, disabled: true },
];

describe('57.md §4 — shared stepper always shows step numbers', () => {
  const html = renderToStaticMarkup(h(StitchWorkflowStepper, { steps: STEPS, activeKey: 'prospero', ariaLabel: 'Plan workflow' }));

  it('renders every step number, even for a completed step', () => {
    expect(html).toContain('>1<'); // done step keeps its number (not a check)
    expect(html).toContain('>2<');
    expect(html).toContain('>3<'); // disabled step keeps its number
  });
  it('exposes accessible "Step N" labels incl. status + disabled reason', () => {
    expect(html).toContain('Step 1: PICO &amp; Question');
    expect(html).toContain('aria-current="step"');           // active = prospero
    expect(html).toContain('Available once screening is set up'); // disabled hint in aria-label
  });
  it('disables unavailable steps', () => {
    expect(html).toContain('disabled');
  });
});

describe('57.md §6/§10 — purple rail main stepper always shows step numbers', () => {
  const html = renderToStaticMarkup(h(StitchProjectRail, {
    projectId: 'p1', linkedSiftId: 's1', activeStage: 'extraction', variant: 'overlay',
    pinned: false, onTogglePin: () => {},
    statusMap: { pico: 'done', prospero: 'done', search: 'done', extraction: 'partial' },
  }));
  it('shows the six workflow step numbers regardless of completion state', () => {
    for (const n of ['1', '2', '3', '4', '5', '6']) expect(html).toContain(`>${n}<`);
  });
  it('still labels Back to Projects + the three groups', () => {
    expect(html).toContain('Back to Projects');
    expect(html).toContain('Research Workflow');
  });
});

describe('57.md §1/§2 + §8 — CSS scoping + font reset', () => {
  const css = buildStitchCss();
  it('rail hover-expansion is scoped to the rail via :has(.stitch-wsnav-rail …)', () => {
    expect(css).toContain(':has(.stitch-wsnav-rail:hover)');
    expect(css).toContain(':has(.stitch-wsnav-rail:focus-within)');
    // the old whole-group hover trigger must be gone
    expect(css).not.toContain('.stitch-wsnav:not([data-pinned="true"]):hover {');
  });
  it('native controls inherit the app font in the Stitch scope', () => {
    expect(css).toContain('.stitch-scope button');
    expect(css).toMatch(/\.stitch-scope (button|input|select|textarea)[^{]*\{[^}]*font-family: inherit/);
  });
  it('remaps the engine font token (--t-font) to the Stitch font (recs round)', () => {
    expect(css).toContain('--t-font:');
    expect(css).toContain('Manrope'); // embedded engines (fontFamily: FONT = var(--t-font)) become Manrope under Stitch
  });
});

describe('57.md recs — FONT resolves through --t-font (legacy Inter, Stitch Manrope)', () => {
  it('legacy theme defines --t-font and FONT is the var with a FOUC-safe fallback', async () => {
    const { FONT, buildThemeCss } = await import('../../src/frontend/theme/tokens.js');
    expect(FONT).toContain('var(--t-font');
    expect(FONT).toContain('Inter'); // fallback stack
    const themeCss = buildThemeCss();
    expect(themeCss).toContain('--t-font:');
    expect(themeCss).toContain('Inter');
  });
});
