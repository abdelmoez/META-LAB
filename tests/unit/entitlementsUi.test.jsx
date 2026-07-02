/**
 * entitlementsUi.test.jsx — 67.md product-tier UI layer.
 *
 * SSR-safe contract tests (house style: renderToStaticMarkup, no jsdom):
 *  - the useEntitlements hook is FAIL-OPEN — while loading (SSR never runs the
 *    effect) and after a REJECTED fetch, has() returns true so the UI never locks
 *    a feature because a fetch failed;
 *  - TierBadge renders the plan name;
 *  - LockedFeatureCard shows the required-tier upgrade line;
 *  - tierErrorMessage() pulls the human message out of a structured
 *    TIER_LIMIT_EXCEEDED body (and ignores unrelated errors).
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  useEntitlements, _reset, _loadForTest,
  TierBadge, LockedFeatureCard, tierErrorMessage,
} from '../../src/frontend/entitlements/index.js';

afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { _reset(); });

/* A probe component that surfaces the hook's has() result into the markup. */
function Probe({ k }) {
  const ent = useEntitlements();
  return h('span', null, ent.has(k) ? 'ALLOWED' : 'BLOCKED');
}

describe('useEntitlements — fail-open', () => {
  it('has() is TRUE while loading (SSR never runs the effect that fetches)', () => {
    // No fetch resolves under renderToStaticMarkup — the hook is in its loading
    // state, which must fail OPEN.
    const html = renderToStaticMarkup(h(Probe, { k: 'screening.aiScoring' }));
    expect(html).toContain('ALLOWED');
  });

  it('has() is TRUE after the entitlements fetch REJECTS', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const api = await _loadForTest();
    expect(api.has('screening.aiScoring')).toBe(true);
    expect(api.has('anything.at.all')).toBe(true);
  });

  it('has() returns the REAL value once a concrete map is fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        bypass: false, tierId: 'free', tierDisplayName: 'Free',
        enforcementEnabled: true,
        entitlements: { 'screening.aiScoring': false, 'manuscript.editor': true },
      }),
    })));
    const api = await _loadForTest();
    expect(api.has('screening.aiScoring')).toBe(false); // free plan → locked
    expect(api.has('manuscript.editor')).toBe(true);
  });

  it('bypass users are always allowed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        bypass: true, bypassReason: 'admin', tierId: null, tierDisplayName: 'Admin',
        enforcementEnabled: true, entitlements: { 'screening.aiScoring': false },
      }),
    })));
    const api = await _loadForTest();
    expect(api.bypass).toBe(true);
    expect(api.has('screening.aiScoring')).toBe(true); // bypass overrides the false
  });
});

describe('TierBadge', () => {
  it('renders the plan name', () => {
    const html = renderToStaticMarkup(h(TierBadge, { tierDisplayName: 'Plus' }));
    expect(html).toContain('Plus');
    expect(html).toContain('plan');
  });
});

describe('LockedFeatureCard', () => {
  it('shows the required tier in the upgrade line', () => {
    const html = renderToStaticMarkup(h(LockedFeatureCard, { title: 'Living Reviews', requiredTier: 'pro' }));
    expect(html).toContain('Living Reviews');
    expect(html).toContain('Pro'); // tierDisplayName('pro')
    expect(html).toContain('and above');
    // Neutral, admin-managed — never a fake checkout.
    expect(html).toContain('administrator');
  });

  it('honours an explicit message override', () => {
    const html = renderToStaticMarkup(h(LockedFeatureCard, { title: 'X', message: 'Custom locked copy.' }));
    expect(html).toContain('Custom locked copy.');
  });
});

describe('tierErrorMessage', () => {
  it('parses a structured TIER_LIMIT_EXCEEDED body', () => {
    const body = { error: 'TIER_LIMIT_EXCEEDED', feature: 'projects.maxActiveProjects', message: 'Your Free plan allows 2 active projects.' };
    expect(tierErrorMessage(body)).toBe('Your Free plan allows 2 active projects.');
  });

  it('reads the body off a thrown error (err.body)', () => {
    const err = new Error('TIER_LIMIT_EXCEEDED');
    err.body = { error: 'TIER_LIMIT_EXCEEDED', message: 'Upgrade to Plus for AI screening.' };
    expect(tierErrorMessage(err)).toBe('Upgrade to Plus for AI screening.');
  });

  it('returns empty string for unrelated errors', () => {
    expect(tierErrorMessage(new Error('HTTP 500'))).toBe('');
    expect(tierErrorMessage({ error: 'SOMETHING_ELSE', message: 'nope' })).toBe('');
    expect(tierErrorMessage(null)).toBe('');
  });
});
