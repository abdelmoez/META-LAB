/**
 * headers.test.js — centralized non-CSP security/response headers (prompt 52).
 */
import { describe, it, expect } from 'vitest';
import { helmetOptions, apiNoStore, publicVersion } from '../../../server/security/headers.js';

describe('helmetOptions', () => {
  it('disables helmet CSP (cspMiddleware owns it → no duplicate header)', () => {
    expect(helmetOptions().contentSecurityPolicy).toBe(false);
  });
  it('sets X-Frame-Options to DENY (agrees with CSP frame-ancestors none)', () => {
    expect(helmetOptions().frameguard).toEqual({ action: 'deny' });
  });
});

describe('apiNoStore', () => {
  function mk(path) {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; }, headers };
    let nexted = false;
    apiNoStore({ path }, res, () => { nexted = true; });
    return { headers, nexted };
  }
  it('marks /api responses no-store', () => {
    expect(mk('/api/projects').headers['Cache-Control']).toBe('no-store');
    expect(mk('/api').headers['Cache-Control']).toBe('no-store');
  });
  it('does NOT touch non-/api responses (static assets / SPA HTML keep their cache)', () => {
    expect(mk('/assets/index-x.js').headers['Cache-Control']).toBeUndefined();
    expect(mk('/login').headers['Cache-Control']).toBeUndefined();
  });
  it('always calls next()', () => {
    expect(mk('/api/x').nexted).toBe(true);
    expect(mk('/').nexted).toBe(true);
  });
});

describe('publicVersion', () => {
  it('keeps the product version but drops build metadata (commit, dates)', () => {
    const full = { name: 'PecanRev', version: '3.50.0', commit: 'deadbee', commitDate: 'x', buildDate: 'y', full: 'v3.50.0 · deadbee' };
    const pub = publicVersion(full);
    expect(pub).toEqual({ name: 'PecanRev', version: '3.50.0' });
    expect(pub.commit).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('deadbee');
  });
  it('has safe fallbacks', () => {
    expect(publicVersion(undefined)).toEqual({ name: 'PecanRev', version: '0.0.0' });
  });
});
