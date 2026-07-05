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

  it('leads with the grammatical "Join us" hero copy (no obsolete "Help us")', () => {
    // 75.md Phase 10: "Help us …" → a natural "Join us in cultivating …", while the
    // accent span "evidence synthesis." (with the Squiggle underline) stays intact.
    expect(html).toContain('Join us in cultivating the future of');
    expect(html).toContain('evidence synthesis.');
    expect(html).not.toContain('Help us');
  });

  it('uses shared Stitch tokens — no retired one-off waitlist palette (WL) hexes', () => {
    // The indigo/green WL palette (waitlistTheme.js) is retired; its hardcoded hexes
    // (rendered inline) must be absent so the page flips with the shared S.* tokens.
    for (const hex of ['#493ee5', '#635bff', '#5fce5b']) {
      expect(html.toLowerCase()).not.toContain(hex);
    }
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
