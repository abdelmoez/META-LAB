/**
 * stepIndicator.test.js (prompt22 follow-up) — the Screening workflow step shown
 * beneath each submenu tab is a READ-ONLY progress indicator, NOT a navigation
 * control. Rendered to static markup (react-dom/server, no jsdom dependency) so we
 * can assert it carries no button/clickable semantics — the regression guard for
 * "the stepper must not be clickable" (prompt22 Task 4 / prompt23 Task 3).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StepIndicator } from '../../src/frontend/screening/ui/Stepper.jsx';

const render = (props) => renderToStaticMarkup(createElement(StepIndicator, props));

describe('StepIndicator — read-only, non-clickable', () => {
  it('carries NO interactive/navigation semantics', () => {
    const html = render({ step: { status: 'active', label: 'Title & Abstract' }, num: 3, current: true });
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('cursor:pointer');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('href');
    expect(html).toContain('cursor:default');
  });

  it('renders the step number/label and marks the current step', () => {
    const html = render({ step: { status: 'active', label: 'Conflicts' }, num: 4, current: true });
    expect(html).toContain('Step 4');
    expect(html).toContain('aria-current="step"');
  });

  it('does not mark aria-current when not the current step', () => {
    const html = render({ step: { status: 'pending', label: 'Final Review' }, num: 5, current: false });
    expect(html).toContain('Step 5');
    expect(html).not.toContain('aria-current');
  });

  it('renders an empty spacer (no "Step") for a tab with no workflow step', () => {
    const html = render({ step: null, num: undefined, current: false });
    expect(html).not.toContain('Step');
    expect(html).not.toContain('cursor:pointer');
  });
});
