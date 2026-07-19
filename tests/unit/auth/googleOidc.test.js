/**
 * googleOidc.test.js — 94.md §2.1 — unit tests for the zero-dependency Google
 * OIDC client (createGoogleOidc). Fully mocked via the injected-fetch factory
 * pattern (house precedent: tests/unit/oaPdfResolver.test.js) — NO live network.
 * A real RSA keypair signs test id_tokens so the FULL RS256 signature path runs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { createGoogleOidc } from '../../../server/auth/googleOidc.js';

const KID = 'test-kid-1';
let keys; // { publicKey, privateKey }

beforeAll(() => {
  keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
});

const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function signIdToken(claims, { alg = 'RS256', kid = KID, tamper = false } = {}) {
  const header = b64u({ alg, kid, typ: 'JWT' });
  const payload = b64u(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey);
  const sigStr = Buffer.from(sig).toString('base64url');
  return `${header}.${payload}.${tamper ? sigStr.slice(0, -4) + 'AAAA' : sigStr}`;
}

function jwksBody(kid = KID) {
  const jwk = keys.publicKey.export({ format: 'jwk' });
  return { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
}

/** Route-table fetch mock: substring match → responder. Records calls. */
function makeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [substr, responder] of routes) {
      if (String(url).includes(substr)) {
        const out = typeof responder === 'function' ? responder({ url, opts }) : responder;
        if (out instanceof Error) throw out;
        return {
          ok: out.status ? out.status < 400 : true,
          status: out.status || 200,
          json: async () => out.body,
        };
      }
    }
    throw new Error('unmatched route: ' + url);
  };
  fn.calls = calls;
  return fn;
}

const BASE_ENV = {
  GOOGLE_CLIENT_ID: 'client-1',
  GOOGLE_CLIENT_SECRET: 'secret-1',
  GOOGLE_REDIRECT_URI: 'https://app.example/api/auth/google/callback',
};

const NOW = 1_800_000_000_000; // fixed clock
const nowS = Math.floor(NOW / 1000);

function makeClient({ env = {}, routes = [], now = () => NOW } = {}) {
  const fetch = makeFetch(routes);
  const oidc = createGoogleOidc({ fetch, now, env: { ...BASE_ENV, ...env } });
  return { oidc, fetch };
}

function validClaims(over = {}) {
  return {
    iss: 'https://accounts.google.com', aud: 'client-1', sub: 'sub-123',
    email: '  MixedCase@Example.COM ', email_verified: true, name: 'Test User',
    picture: 'https://example.com/p.png', iat: nowS - 10, exp: nowS + 3600,
    nonce: 'nonce-1', ...over,
  };
}

describe('enabled() + redirectUri()', () => {
  it('is enabled only with id + secret + resolvable redirect', () => {
    expect(makeClient().oidc.enabled()).toBe(true);
    expect(makeClient({ env: { GOOGLE_CLIENT_ID: '' } }).oidc.enabled()).toBe(false);
    expect(makeClient({ env: { GOOGLE_CLIENT_SECRET: '' } }).oidc.enabled()).toBe(false);
    expect(makeClient({ env: { GOOGLE_REDIRECT_URI: '' } }).oidc.enabled()).toBe(false);
  });
  it('derives the callback from APP_BASE_URL when GOOGLE_REDIRECT_URI is unset', () => {
    const { oidc } = makeClient({ env: { GOOGLE_REDIRECT_URI: '', APP_BASE_URL: 'https://pecanrev.com/' } });
    expect(oidc.redirectUri()).toBe('https://pecanrev.com/api/auth/google/callback');
    expect(oidc.enabled()).toBe(true);
  });
  it('explicit GOOGLE_REDIRECT_URI wins over APP_BASE_URL', () => {
    const { oidc } = makeClient({ env: { APP_BASE_URL: 'https://other.example' } });
    expect(oidc.redirectUri()).toBe(BASE_ENV.GOOGLE_REDIRECT_URI);
  });
});

describe('buildAuthUrl()', () => {
  it('carries code+PKCE(S256)+state+nonce+minimal scopes and no token-ish params', () => {
    const { oidc } = makeClient();
    const url = new URL(oidc.buildAuthUrl({ state: 'st-1', nonce: 'no-1', codeChallenge: 'ch-1' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('client-1');
    expect(p.get('scope')).toBe('openid email profile'); // §6 — basic identity only
    expect(p.get('state')).toBe('st-1');
    expect(p.get('nonce')).toBe('no-1');
    expect(p.get('code_challenge')).toBe('ch-1');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('access_type')).toBe('online'); // never offline — no stored tokens
    expect(p.get('client_secret')).toBeNull();   // the secret NEVER rides a URL
  });
  it('honours the test-only endpoint overrides', () => {
    const { oidc } = makeClient({ env: { GOOGLE_AUTH_URL: 'http://127.0.0.1:9/auth' } });
    expect(oidc.buildAuthUrl({ state: 's', nonce: 'n', codeChallenge: 'c' })).toMatch(/^http:\/\/127\.0\.0\.1:9\/auth\?/);
  });
});

describe('exchangeCode()', () => {
  it('POSTs form-encoded code+verifier and returns only the id_token', async () => {
    const { oidc, fetch } = makeClient({
      routes: [['oauth2.googleapis.com/token', { body: { id_token: 'tok', access_token: 'at', refresh_token: 'rt' } }]],
    });
    const r = await oidc.exchangeCode({ code: 'c-1', codeVerifier: 'v-1' });
    expect(r).toEqual({ ok: true, idToken: 'tok' });
    const call = fetch.calls[0];
    expect(call.opts.method).toBe('POST');
    const body = new URLSearchParams(call.opts.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('c-1');
    expect(body.get('code_verifier')).toBe('v-1');
    expect(body.get('client_secret')).toBe('secret-1'); // server-side exchange
  });
  it('maps non-200 / parse / missing-token / network failures to typed errors', async () => {
    const cases = [
      [{ status: 400, body: { error: 'invalid_grant' } }, 'token_exchange_failed'],
      [{ body: {} }, 'no_id_token'],
      [new Error('boom'), 'token_request_failed'],
    ];
    for (const [resp, code] of cases) {
      const { oidc } = makeClient({ routes: [['oauth2.googleapis.com/token', resp]] });
      const r = await oidc.exchangeCode({ code: 'c', codeVerifier: 'v' });
      expect(r.ok).toBe(false);
      expect(r.error).toBe(code);
    }
  });
});

describe('verifyIdToken()', () => {
  const routes = () => [['oauth2/v3/certs', { body: jwksBody() }]];

  it('accepts a valid RS256 token and normalizes claims', async () => {
    const { oidc } = makeClient({ routes: routes() });
    const r = await oidc.verifyIdToken(signIdToken(validClaims()), { nonce: 'nonce-1' });
    expect(r.ok).toBe(true);
    expect(r.claims.sub).toBe('sub-123');
    expect(r.claims.email).toBe('mixedcase@example.com'); // trim+lowercase policy
    expect(r.claims.emailVerified).toBe(true);
  });
  it("normalizes email_verified sent as the string 'true'", async () => {
    const { oidc } = makeClient({ routes: routes() });
    const r = await oidc.verifyIdToken(signIdToken(validClaims({ email_verified: 'true' })), { nonce: 'nonce-1' });
    expect(r.ok).toBe(true);
    expect(r.claims.emailVerified).toBe(true);
  });
  it('rejects each broken axis with a typed error', async () => {
    const { oidc } = makeClient({ routes: routes() });
    const cases = [
      [signIdToken(validClaims(), { alg: 'HS256' }), 'unsupported_alg'],
      [signIdToken(validClaims(), { tamper: true }), 'bad_signature'],
      [signIdToken(validClaims({ iss: 'https://evil.example' })), 'bad_issuer'],
      [signIdToken(validClaims({ aud: 'other-client' })), 'bad_audience'],
      [signIdToken(validClaims({ exp: nowS - 3600 })), 'token_expired'],
      [signIdToken(validClaims({ iat: nowS + 3600 })), 'bad_iat'],
      [signIdToken(validClaims({ nonce: 'wrong' })), 'bad_nonce'],
      [signIdToken(validClaims({ sub: '' })), 'missing_sub'],
      ['not-a-jwt', 'malformed_id_token'],
    ];
    for (const [tok, code] of cases) {
      const r = await oidc.verifyIdToken(tok, { nonce: 'nonce-1' });
      expect(r.ok, code).toBe(false);
      expect(r.error).toBe(code);
    }
  });
  it('caches JWKS and refetches once on an unknown kid', async () => {
    let phase = 0;
    const { oidc, fetch } = makeClient({
      routes: [['oauth2/v3/certs', () => ({ body: phase === 0 ? jwksBody('old-kid') : jwksBody() })]],
    });
    // First verify: empty cache → 1 fetch → JWKS only has old-kid → unknown_kid.
    const p1 = await oidc.verifyIdToken(signIdToken(validClaims()), { nonce: 'nonce-1' });
    expect(p1).toMatchObject({ ok: false, error: 'unknown_kid' });
    expect(fetch.calls.filter((c) => c.url.includes('certs')).length).toBe(1);
    // Key rotation happens (phase 1): fresh cache misses the kid → ONE refetch finds it.
    phase = 1;
    const p2 = await oidc.verifyIdToken(signIdToken(validClaims()), { nonce: 'nonce-1' });
    expect(p2.ok).toBe(true);
    expect(fetch.calls.filter((c) => c.url.includes('certs')).length).toBe(2);
    // Now cached with the right kid: another verify adds NO fetch.
    await oidc.verifyIdToken(signIdToken(validClaims()), { nonce: 'nonce-1' });
    expect(fetch.calls.filter((c) => c.url.includes('certs')).length).toBe(2);
  });
  it('maps a JWKS outage to jwks_unavailable (→ provider-unavailable UX)', async () => {
    const { oidc } = makeClient({ routes: [['oauth2/v3/certs', new Error('down')]] });
    const r = await oidc.verifyIdToken(signIdToken(validClaims()), { nonce: 'nonce-1' });
    expect(r).toMatchObject({ ok: false, error: 'jwks_unavailable' });
  });
});
