/**
 * waitlistPage.test.jsx (54.md Part 8) — the redesigned Beta Waitlist page renders
 * Stitch-native, leads with the email step, carries accessible labels + the
 * institutional trust copy, exposes the honeypot, and fabricates NO metrics
 * (no fake queue number). renderToStaticMarkup does not run effects, so the
 * self-scope/SEO effects are inert here — we assert on the static markup.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import BetaWaitlistPage from '../../src/frontend/pages/waitlist/BetaWaitlistPage.jsx';

const html = renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(BetaWaitlistPage)),
);

describe('Beta Waitlist page (redesigned)', () => {
  it('renders the hero headline + brand', () => {
    expect(html).toContain('PecanRev');
    expect(html.toLowerCase()).toContain('evidence synthesis');
  });

  it('leads with an accessible email field (label associated)', () => {
    expect(html).toContain('type="email"');
    expect(html).toContain('for="email"'); // <label htmlFor="email">
  });

  it('keeps the bot honeypot field present and hidden', () => {
    expect(html).toContain('id="website"');
    expect(html).toContain('tabindex="-1"');
  });

  it('fabricates NO metrics (no fake queue/teams-registered count)', () => {
    expect(html).not.toMatch(/2,?841/);
    expect(html.toLowerCase()).not.toContain('teams registered');
    expect(html.toLowerCase()).not.toContain('queue status');
  });

  it('renders an aria-live status region for async updates', () => {
    expect(html).toMatch(/aria-live="polite"|role="status"/);
  });
});
