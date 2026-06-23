/**
 * header-hardening.test.js — HTTP response-header fingerprinting reduction
 * (prompt 52), against a LIVE server. Follows the repo convention: hits
 * http://127.0.0.1:3001 and skips gracefully when the server is down (CI runs
 * only tests/unit + tests/screening/unit). Run during header-audit validation:
 *
 *   NODE_ENV=production CSP_MODE=enforce SERVE_SPA=true node server/index.js
 *   npx vitest run tests/integration/header-hardening.test.js
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001';
let up = false;

async function reg() {
  const email = `hdr_${Math.random().toString(36).slice(2)}@t.local`;
  const r = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', name: 'h' }),
  });
  const sc = r.headers.get('set-cookie') || '';
  return (sc.match(/metalab_session=[^;]+/) || [''])[0];
}

beforeAll(async () => { try { up = (await fetch(BASE + '/api/health')).ok; } catch { up = false; } });

describe('fingerprinting headers are absent', () => {
  it('no X-Powered-By / Server / runtime / timing headers on any response type', async () => {
    if (!up) return;
    for (const path of ['/', '/api/health', '/api/version']) {
      const res = await fetch(BASE + path);
      expect(res.headers.get('x-powered-by'), `x-powered-by on ${path}`).toBeNull();
      expect(res.headers.get('x-runtime')).toBeNull();
      expect(res.headers.get('x-response-time')).toBeNull();
      expect(res.headers.get('server-timing')).toBeNull();
      const server = res.headers.get('server') || '';
      // The app emits no Server header; if a proxy adds one it must carry no version.
      expect(/\d+\.\d+/.test(server)).toBe(false);
    }
  });
});

describe('frame protection is consistent', () => {
  it('X-Frame-Options is DENY (agrees with CSP frame-ancestors none) on SPA + API', async () => {
    if (!up) return;
    for (const path of ['/', '/api/health']) {
      const res = await fetch(BASE + path);
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });
});

describe('build metadata is not exposed to anonymous callers', () => {
  it('/api/version (anonymous) returns the product version but NO commit/build dates', async () => {
    if (!up) return;
    const res = await fetch(BASE + '/api/version');
    const body = await res.json();
    expect(body.version).toBeTruthy();        // product version is intentional/public
    expect(body.commit).toBeUndefined();       // build metadata withheld
    expect(body.commitDate).toBeUndefined();
    expect(body.buildDate).toBeUndefined();
  });

  it('/api/version (authenticated) returns full build metadata for the UI', async () => {
    if (!up) return;
    const cookie = await reg();
    const res = await fetch(BASE + '/api/version', { headers: { Cookie: cookie } });
    const body = await res.json();
    expect(body.version).toBeTruthy();
    expect(body.commit).toBeTruthy();          // UI footer/Ops Console need it
  });

  it('/api/health/ready does not leak the environment name or infra timing', async () => {
    if (!up) return;
    const res = await fetch(BASE + '/api/health/ready');
    const body = await res.json();
    expect(body.status).toBeTruthy();
    expect(body.env).toBeUndefined();
    expect(body.dbLatencyMs).toBeUndefined();
  });
});

describe('cache hygiene', () => {
  it('/api responses are no-store; static assets keep a real cache', async () => {
    if (!up) return;
    const api = await fetch(BASE + '/api/health');
    expect((api.headers.get('cache-control') || '')).toContain('no-store');

    const html = await fetch(BASE + '/');
    if ((html.headers.get('content-type') || '').includes('text/html')) {
      const asset = (await html.text()).match(/\/assets\/[^"']+\.js/);
      if (asset) {
        const a = await fetch(BASE + asset[0]);
        expect((a.headers.get('cache-control') || '')).toMatch(/max-age=\d+/);
        expect((a.headers.get('cache-control') || '')).not.toContain('no-store');
      }
    }
  });
});

describe('security headers remain present (not stripped by the audit)', () => {
  it('keeps nosniff + referrer-policy + permissions-policy + CSP', async () => {
    if (!up) return;
    const res = await fetch(BASE + '/');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBeTruthy();
    expect(res.headers.get('permissions-policy')).toBeTruthy();
    const csp = res.headers.get('content-security-policy') || res.headers.get('content-security-policy-report-only');
    expect(csp).toBeTruthy();
  });
});
