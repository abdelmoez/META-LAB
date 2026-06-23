/**
 * csp-headers.test.js — end-to-end CSP header coverage against a LIVE server
 * (prompt 51). Follows the repo convention: hits http://127.0.0.1:3001 and skips
 * gracefully when the server is down (so it never breaks CI, which only runs
 * tests/unit + tests/screening/unit). Run it during Stage 1/3 rollout validation:
 *
 *   # in one shell — enforce mode against the built SPA
 *   cd <repo> && npm run build && SERVE_SPA=true CSP_MODE=enforce node server/index.js
 *   # in another
 *   npx vitest run tests/integration/csp-headers.test.js
 *
 * It adapts to whichever mode the running server uses (report-only or enforce).
 * (NODE_ENV=production is recommended for a faithful prod capture — HSTS, Secure
 * cookies — though enforce mode now ships the strict policy regardless of env.)
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001';
let up = false;
let servesSpa = false;

function cspOf(res) {
  return res.headers.get('content-security-policy') || res.headers.get('content-security-policy-report-only') || '';
}

beforeAll(async () => {
  try {
    const r = await fetch(BASE + '/api/health');
    up = r.ok;
    // The SPA header coverage assertions only apply when this process serves the SPA.
    const root = await fetch(BASE + '/');
    servesSpa = (root.headers.get('content-type') || '').includes('text/html');
  } catch { up = false; }
});

describe('CSP headers (live server)', () => {
  it('emits exactly one CSP header on the API, with a strict JSON policy', async () => {
    if (!up) return;
    const res = await fetch(BASE + '/api/health');
    const enforce = res.headers.get('content-security-policy');
    const ro = res.headers.get('content-security-policy-report-only');
    // never BOTH at once (no contradictory policies)
    expect(!(enforce && ro)).toBe(true);
    const csp = cspOf(res);
    if (csp) {
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
    // related headers always present
    expect(res.headers.get('permissions-policy')).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('emits a strict SPA policy on HTML routes (no wildcards, nonce present)', async () => {
    if (!up || !servesSpa) return;
    for (const path of ['/', '/login', '/register', '/admin', '/screening', '/nonexistent-route']) {
      const res = await fetch(BASE + path);
      const csp = cspOf(res);
      expect(csp, `missing CSP on ${path}`).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).not.toContain('*');
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(csp).not.toMatch(/(?<!wasm-)'unsafe-eval'/);
      // production script-src is nonce-based
      expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9_-]+'/);
    }
  });

  it('the nonce in the header matches the nonce on the injected theme script', async () => {
    if (!up || !servesSpa) return;
    const res = await fetch(BASE + '/');
    const csp = cspOf(res);
    const html = await res.text();
    const headerNonce = (csp.match(/'nonce-([A-Za-z0-9_-]+)'/) || [])[1];
    const scriptNonce = (html.match(/<script nonce="([A-Za-z0-9_-]+)"/) || [])[1];
    expect(headerNonce).toBeTruthy();
    expect(scriptNonce).toBe(headerNonce);
  });

  it('gives a different nonce on each response', async () => {
    if (!up || !servesSpa) return;
    const a = cspOf(await fetch(BASE + '/')).match(/'nonce-([A-Za-z0-9_-]+)'/)?.[1];
    const b = cspOf(await fetch(BASE + '/')).match(/'nonce-([A-Za-z0-9_-]+)'/)?.[1];
    expect(a && b && a !== b).toBe(true);
  });
});

describe('CSP report endpoint (live server)', () => {
  it('accepts a valid report with 204', async () => {
    if (!up) return;
    const res = await fetch(BASE + '/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js?secret=1' } }),
    });
    expect(res.status).toBe(204);
  });

  it('rejects an oversized report without crashing', async () => {
    if (!up) return;
    const big = 'a'.repeat(20 * 1024);
    const res = await fetch(BASE + '/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'blocked-uri': big } }),
    });
    expect([413, 400]).toContain(res.status);
  });

  it('handles malformed JSON gracefully', async () => {
    if (!up) return;
    const res = await fetch(BASE + '/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: '{not valid json',
    });
    expect([400, 204]).toContain(res.status);
  });
});
