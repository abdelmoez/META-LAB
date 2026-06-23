/**
 * csp.test.js — Content-Security-Policy generator (prompt 51).
 *
 * Pure-unit coverage (no live server) of the central policy builder, the
 * per-response nonce, the inline-script hashing, the header-name/mode selection,
 * and the Express middleware exercised against a mock req/res. These run in CI
 * (tests/unit) and assert the production safety invariants required by the task.
 */

import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  cspMode,
  generateNonce,
  isValidNonce,
  computeInlineScriptHashes,
  buildCsp,
  serializeCsp,
  cspHeaderName,
  cspMiddleware,
  CSP_REPORT_PATH,
  PERMISSIONS_POLICY,
} from '../../../server/security/csp.js';

/* helpers ------------------------------------------------------------------ */

function prodSpa(nonce = 'AAAAAAAAAAAAAAAA', hashes = ["'sha256-abc'"]) {
  return buildCsp({ nonce, isApi: false, prod: true, hashes });
}
function devSpa(nonce = 'AAAAAAAAAAAAAAAA') {
  return buildCsp({ nonce, isApi: false, prod: false, hashes: ["'sha256-abc'"] });
}
const flat = (d) => serializeCsp(d);

function mockRes() {
  const headers = {};
  return {
    locals: {},
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    getHeader: (k) => headers[k.toLowerCase()],
    _headers: headers,
  };
}

/* mode + header name ------------------------------------------------------- */

describe('cspMode', () => {
  it('maps known values and defaults to report-only', () => {
    expect(cspMode({ CSP_MODE: 'enforce' })).toBe('enforce');
    expect(cspMode({ CSP_MODE: 'ENFORCE' })).toBe('enforce');
    expect(cspMode({ CSP_MODE: 'report-only' })).toBe('report-only');
    expect(cspMode({ CSP_MODE: 'disabled' })).toBe('disabled');
    expect(cspMode({ CSP_MODE: 'off' })).toBe('disabled');
    expect(cspMode({ CSP_MODE: 'nonsense' })).toBe('report-only');
    expect(cspMode({})).toBe('report-only'); // safe default, never silently disabled
  });
});

describe('cspHeaderName', () => {
  it('selects the correct header per mode', () => {
    expect(cspHeaderName('enforce')).toBe('Content-Security-Policy');
    expect(cspHeaderName('report-only')).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeaderName('disabled')).toBeNull();
  });
});

/* nonce -------------------------------------------------------------------- */

describe('nonce', () => {
  it('is base64url, >=128 bits, and unpredictable across responses', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(isValidNonce(a)).toBe(true);
    expect(/^[A-Za-z0-9_-]+$/.test(a)).toBe(true); // base64url: no +,/,=
    expect(a).not.toBe(b);
    const many = new Set(Array.from({ length: 200 }, generateNonce));
    expect(many.size).toBe(200); // no collisions
  });
  it('rejects malformed nonces (header-injection guard)', () => {
    expect(isValidNonce("abc'; script-src *")).toBe(false);
    expect(isValidNonce('short')).toBe(false);
    expect(isValidNonce('')).toBe(false);
    expect(isValidNonce('with\nnewline-aaaaaaaaaa')).toBe(false);
  });
});

/* inline-script hashing ---------------------------------------------------- */

describe('computeInlineScriptHashes', () => {
  it('hashes inline scripts and skips external (src) scripts', () => {
    const body = '\n  var x = 1;\n';
    const html =
      `<head><script>${body}</script>` +
      `<script type="module" crossorigin src="/assets/index-x.js"></script></head>`;
    const expected = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    const hashes = computeInlineScriptHashes(html);
    expect(hashes).toEqual([`'sha256-${expected}'`]);
  });
  it('returns [] for empty/garbage input', () => {
    expect(computeInlineScriptHashes('')).toEqual([]);
    expect(computeInlineScriptHashes(null)).toEqual([]);
    expect(computeInlineScriptHashes('<div>no scripts</div>')).toEqual([]);
  });
});

/* production SPA policy invariants ----------------------------------------- */

describe('buildCsp — production SPA invariants', () => {
  const d = prodSpa();
  const s = flat(d);

  it('has the strict baseline directives', () => {
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['script-src-attr']).toEqual(["'none'"]);
    expect(d['worker-src']).toEqual(["'self'", 'blob:']);
    expect(d['manifest-src']).toEqual(["'self'"]);
    expect(d['connect-src']).toEqual(["'self'"]);
    expect(d['upgrade-insecure-requests']).toEqual([]);
  });

  it('script-src uses nonce + hash, never unsafe-inline/unsafe-eval', () => {
    expect(d['script-src']).toContain("'self'");
    expect(d['script-src']).toContain("'nonce-AAAAAAAAAAAAAAAA'");
    expect(d['script-src']).toContain("'sha256-abc'");
    expect(d['script-src']).toContain("'wasm-unsafe-eval'"); // pdf.js only
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(s).not.toMatch(/'unsafe-eval'/); // wasm-unsafe-eval is allowed, unsafe-eval is NOT
  });

  it('keeps unsafe-inline ONLY in style-src (documented exception)', () => {
    expect(d['style-src']).toContain("'unsafe-inline'");
    expect(d['style-src']).toContain('https://fonts.googleapis.com');
    // unsafe-inline must not appear in any script directive
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(d['script-src-attr']).not.toContain("'unsafe-inline'");
  });

  it('contains no wildcard / blanket-scheme sources', () => {
    expect(s).not.toContain('*');
    expect(s).not.toMatch(/(^|\s)https:(\s|;|$)/); // bare https: scheme
    expect(s).not.toMatch(/(^|\s)http:(\s|;|$)/);
    // 'wasm-unsafe-eval' is allowed (pdf.js); the dangerous 'unsafe-eval' token is not.
    expect(s).not.toMatch(/(?<!wasm-)'?unsafe-eval'?/);
  });

  it('img/font/connect are narrow and external origins are only Google Fonts', () => {
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(d['font-src']).toEqual(["'self'", 'https://fonts.gstatic.com']);
    const external = s.match(/https:\/\/[^\s;]+/g) || [];
    expect(new Set(external)).toEqual(new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']));
  });

  it('includes reporting directives pointing at the first-party endpoint', () => {
    expect(d['report-uri']).toEqual([CSP_REPORT_PATH]);
    expect(d['report-to']).toEqual(['csp-endpoint']);
  });
});

/* dev vs prod separation --------------------------------------------------- */

describe('buildCsp — development additions never leak to production', () => {
  it('dev allows HMR ws + inline scripts; prod does not', () => {
    const dev = devSpa();
    expect(dev['connect-src']).toContain('ws://localhost:*');
    expect(dev['script-src']).toContain("'unsafe-inline'"); // HMR preamble
    // a nonce must NOT be added in dev (it would disable unsafe-inline)
    expect(dev['script-src'].some((t) => t.startsWith("'nonce-"))).toBe(false);
    expect(dev['upgrade-insecure-requests']).toBeUndefined();

    const prod = prodSpa();
    const ps = flat(prod);
    expect(ps).not.toContain('ws://');
    expect(ps).not.toContain('localhost');
    expect(prod['script-src']).not.toContain("'unsafe-inline'");
  });
});

/* API policy --------------------------------------------------------------- */

describe('buildCsp — API JSON policy is maximally strict', () => {
  const d = buildCsp({ isApi: true, prod: true });
  it('locks everything to none', () => {
    expect(d['default-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['script-src']).toBeUndefined();
  });
});

/* serialization ------------------------------------------------------------ */

describe('serializeCsp', () => {
  it('produces a valid single-line header with no CR/LF', () => {
    const s = flat(prodSpa());
    expect(s).not.toMatch(/[\r\n]/);
    expect(s).toContain("default-src 'self'");
    expect(s).toContain('upgrade-insecure-requests'); // valueless directive emitted bare
    expect(s.split('; ').length).toBeGreaterThan(10);
  });
});

/* middleware --------------------------------------------------------------- */

describe('cspMiddleware', () => {
  it('sets the report-only header on SPA routes and a fresh nonce in res.locals', () => {
    // The per-response nonce is a PRODUCTION behavior (dev uses unsafe-inline for
    // HMR and intentionally omits the nonce), so exercise the prod path.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const mw = cspMiddleware({ mode: () => 'report-only' });
      const res = mockRes();
      let called = false;
      mw({ path: '/dashboard' }, res, () => { called = true; });
      expect(called).toBe(true);
      expect(res.getHeader('Content-Security-Policy-Report-Only')).toBeTruthy();
      expect(res.getHeader('Content-Security-Policy')).toBeUndefined();
      expect(isValidNonce(res.locals.cspNonce)).toBe(true);
      // the SAME nonce is present in the header
      expect(res.getHeader('Content-Security-Policy-Report-Only')).toContain(`'nonce-${res.locals.cspNonce}'`);
      // a DIFFERENT response gets a DIFFERENT nonce
      const res2 = mockRes();
      mw({ path: '/dashboard' }, res2, () => {});
      expect(res2.locals.cspNonce).not.toBe(res.locals.cspNonce);
      // related headers always present
      expect(res.getHeader('Permissions-Policy')).toBe(PERMISSIONS_POLICY);
      expect(res.getHeader('Reporting-Endpoints')).toContain(CSP_REPORT_PATH);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('sets the enforce header in enforce mode', () => {
    const mw = cspMiddleware({ mode: () => 'enforce' });
    const res = mockRes();
    mw({ path: '/' }, res, () => {});
    expect(res.getHeader('Content-Security-Policy')).toBeTruthy();
    expect(res.getHeader('Content-Security-Policy-Report-Only')).toBeUndefined();
  });

  it('emits NO CSP header in disabled mode but keeps related headers', () => {
    const mw = cspMiddleware({ mode: () => 'disabled' });
    const res = mockRes();
    mw({ path: '/' }, res, () => {});
    expect(res.getHeader('Content-Security-Policy')).toBeUndefined();
    expect(res.getHeader('Content-Security-Policy-Report-Only')).toBeUndefined();
    expect(res.getHeader('Permissions-Policy')).toBe(PERMISSIONS_POLICY);
  });

  it('serves the strict default-src none policy on /api routes (no nonce)', () => {
    const mw = cspMiddleware({ mode: () => 'enforce' });
    const res = mockRes();
    mw({ path: '/api/projects' }, res, () => {});
    const h = res.getHeader('Content-Security-Policy');
    expect(h).toContain("default-src 'none'");
    expect(res.locals.cspNonce).toBeUndefined();
  });

  it('enforce mode ALWAYS ships the strict policy, even when NODE_ENV is not production', () => {
    // Regression guard: enforcement must be coupled to strictness, so CSP_MODE=enforce
    // can never silently enforce a permissive, dev-source-leaking policy.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const mw = cspMiddleware({ mode: () => 'enforce' });
      const res = mockRes();
      mw({ path: '/' }, res, () => {});
      const h = res.getHeader('Content-Security-Policy');
      expect(h).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9_-]+'/);
      expect(h).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(h).not.toContain('ws://');
      expect(h).not.toContain('localhost');
      expect(h).toContain('upgrade-insecure-requests');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});

describe('inlineScriptHashes (served HTML)', () => {
  it('derives sha256 hashes from the served index.html (the load-bearing bootstrap-script authorization)', async () => {
    const { inlineScriptHashes } = await import('../../../server/security/csp.js');
    const hashes = inlineScriptHashes();
    expect(Array.isArray(hashes)).toBe(true);
    // At least the static theme bootstrap script must be hashed; every token is a
    // well-formed base64 sha256 source expression.
    expect(hashes.length).toBeGreaterThanOrEqual(1);
    for (const h of hashes) expect(h).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });
});
