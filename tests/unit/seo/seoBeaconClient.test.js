/**
 * seoBeaconClient.test.js — 113.md phase 19 — the browser side of the landing
 * counter (src/frontend/website/useSeoBeacon.js).
 *
 * The client half has one job and three prohibitions, and the prohibitions are
 * what a test can actually protect:
 *
 *   - the wire payload is EXACTLY { path, referrer } — nothing about the
 *     visitor, the screen, the session or the app ever gets added by accident;
 *   - it prefers sendBeacon (which survives the page unloading mid-navigation)
 *     and falls back to a keepalive fetch with credentials omitted;
 *   - it NEVER throws and never rejects, whatever the transport does — a
 *     marketing page must not break because telemetry is unhappy.
 *
 * The PageShell wiring is pinned by source scan (the adminVisibility /
 * opsSectionSync precedent): importing PageShell here would drag react-router
 * and the theme context into a plain unit test, and the thing worth pinning is
 * that the hook is called with a REGISTERED path only.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEO_BEACON_ENDPOINT, seoBeaconPayload, sendSeoBeacon,
} from '../../../src/frontend/website/useSeoBeacon.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const read = (...p) => readFileSync(resolve(ROOT, ...p), 'utf8');

describe('the wire payload', () => {
  it('carries exactly two keys — path and referrer', () => {
    const body = JSON.parse(seoBeaconPayload('/features/screening', 'https://claude.ai/'));
    expect(Object.keys(body).sort()).toEqual(['path', 'referrer']);
    expect(body).toEqual({ path: '/features/screening', referrer: 'https://claude.ai/' });
  });

  it('coerces junk to empty strings rather than sending undefined/objects', () => {
    expect(JSON.parse(seoBeaconPayload(undefined, undefined))).toEqual({ path: '', referrer: '' });
    expect(JSON.parse(seoBeaconPayload({ a: 1 }, ['x']))).toEqual({ path: '', referrer: '' });
  });

  it('posts to the public beacon endpoint', () => {
    expect(SEO_BEACON_ENDPOINT).toBe('/api/seo/pageview');
  });
});

describe('sendSeoBeacon', () => {
  it('prefers navigator.sendBeacon', () => {
    const sendBeacon = vi.fn(() => true);
    const fetchImpl = vi.fn();
    expect(sendSeoBeacon('/about', { referrer: '', nav: { sendBeacon }, fetchImpl })).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe(SEO_BEACON_ENDPOINT);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to a keepalive fetch with credentials omitted', () => {
    const fetchImpl = vi.fn(() => Promise.resolve());
    expect(sendSeoBeacon('/about', { referrer: 'https://x.test/', nav: null, fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SEO_BEACON_ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    expect(JSON.parse(init.body)).toEqual({ path: '/about', referrer: 'https://x.test/' });
  });

  it('sends nothing for a missing or non-rooted path', () => {
    const fetchImpl = vi.fn();
    for (const bad of [null, undefined, '', 'about', 'https://x.test/about', 42]) {
      expect(sendSeoBeacon(bad, { nav: null, fetchImpl }), String(bad)).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws when the transport does', () => {
    const boom = () => { throw new Error('blocked by an extension'); };
    expect(() => sendSeoBeacon('/about', { nav: { sendBeacon: boom }, fetchImpl: null })).not.toThrow();
    expect(() => sendSeoBeacon('/about', { nav: null, fetchImpl: boom })).not.toThrow();
  });

  it('swallows a rejected fetch instead of leaving an unhandled rejection', async () => {
    const fetchImpl = () => Promise.reject(new Error('offline'));
    expect(sendSeoBeacon('/about', { nav: null, fetchImpl })).toBe(true);
    await new Promise((r) => { setTimeout(r, 0); });
  });

  it('does no storage of any kind', () => {
    const src = read('src', 'frontend', 'website', 'useSeoBeacon.js');
    // Comments name these deliberately; the executable half must not touch them.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const api of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB']) {
      expect(code.includes(api), `useSeoBeacon must not use ${api}`).toBe(false);
    }
  });
});

describe('PageShell wiring (source scan)', () => {
  const src = read('src', 'frontend', 'website', 'PageShell.jsx');

  it('PageShell imports and calls the hook', () => {
    expect(src).toMatch(/import \{ useSeoBeacon \} from '\.\/useSeoBeacon\.js';/);
    expect(src).toMatch(/useSeoBeacon\(/);
  });

  it('the hook receives a REGISTERED path only — an unknown route beacons nothing', () => {
    expect(src).toMatch(/useSeoBeacon\(entry \? canonicalPath : null\)/);
  });

  it('the beacon is not wired into the authenticated app shell', () => {
    for (const rel of [['src', 'App.jsx'], ['src', 'main.jsx']]) {
      expect(read(...rel).includes('useSeoBeacon'), `${rel.join('/')} must not fire the public beacon`).toBe(false);
    }
  });
});
