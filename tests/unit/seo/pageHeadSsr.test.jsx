/**
 * pageHeadSsr.test.jsx — 111.md §2 — a page wired to usePageHead must still render
 * under react-dom/server.
 *
 * This is the guard for the prerenderer (111.md §3): renderToStaticMarkup runs no
 * effects and there is no `document`, so a head manager that touched the DOM during
 * render — or that a component called outside an effect — would blow the build up.
 * Terms is the wired page under test; the head data it WOULD apply is asserted from
 * the pure builder alongside the markup.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Terms from '../../../src/frontend/pages/Terms.jsx';
import { getPublicPage } from '../../../src/frontend/website/publicPages.js';
import { buildHead, renderHeadHtml } from '../../../src/frontend/website/usePageHead.js';

const html = renderToStaticMarkup(
  createElement(MemoryRouter, { initialEntries: ['/terms'] }, createElement(Terms)),
);

describe('a usePageHead-wired page under renderToStaticMarkup', () => {
  it('renders without a document (no DOM access during render)', () => {
    expect(html).toContain('Terms of Service');
    expect(html).toContain('id="privacy"');
  });

  it('emits no head markup into the body — the head is data, injected separately', () => {
    expect(html).not.toContain('<title>');
    expect(html).not.toContain('application/ld+json');
  });

  it('its registry head is renderable as a standalone prerender fragment', () => {
    const head = renderHeadHtml(buildHead(getPublicPage('/terms')));
    expect(head).toContain('<title>Terms of Service &amp; Privacy Policy — PecanRev</title>');
    expect(head).toContain('<link rel="canonical" href="https://pecanrev.com/terms" />');
    expect(head).toContain('"@type":"WebPage"');
  });
});
