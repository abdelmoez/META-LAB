/**
 * termsPage.test.jsx — prompt29 Part 11. The Terms & Privacy page renders both
 * sections, the "not a substitute for legal review" disclaimer, and the anchors
 * the registration links point at (#terms / #privacy).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Terms from '../../src/frontend/pages/Terms.jsx';

const html = renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(Terms)),
);

describe('Terms & Privacy page', () => {
  it('renders the Terms of Service and Privacy Policy sections', () => {
    expect(html).toContain('Terms of Service');
    expect(html).toContain('Privacy Policy');
  });

  it('carries the #terms and #privacy anchors used by the registration links', () => {
    expect(html).toContain('id="terms"');
    expect(html).toContain('id="privacy"');
  });

  it('includes the not-a-substitute-for-legal-review disclaimer', () => {
    expect(html.toLowerCase()).toContain('not a substitute for formal legal review');
  });

  it('covers key required topics (open-access / paywalls, statistical review, retention)', () => {
    expect(html.toLowerCase()).toContain('open-access');
    expect(html.toLowerCase()).toContain('paywall');
    expect(html.toLowerCase()).toContain('require your review');
    expect(html.toLowerCase()).toContain('data retention');
  });
});
