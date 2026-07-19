/**
 * server/auth/googleOidc.js — 94.md §2.1 — zero-dependency Google OpenID Connect
 * client (Authorization Code + PKCE + full ID-token signature verification).
 *
 * We do NOT pull in a large auth framework (Passport/openid-client): the existing
 * JWT-cookie session already carries the app's auth, and Google's OIDC surface we
 * need is small — build the authorize URL, exchange the code server-side, and
 * verify the returned ID token's RS256 signature against Google's JWKS. Node's
 * `crypto` gives us JWK→public-key + RSA-SHA256 verification with no dependency.
 *
 * DI factory (house precedent: tests/unit/oaPdfResolver.test.js injected-fetch
 * style): `createGoogleOidc({ fetch, now, env })` so unit tests can inject a fake
 * fetch + clock + env without any network or real Google credentials. A single
 * process-wide instance (`googleOidc`) is exported for the app; endpoints are
 * env-overridable FOR TESTS ONLY (documented on each var below).
 *
 * SECURITY: even though the ID token also arrives over the direct TLS token
 * exchange, its signature is verified anyway (94.md §2.1) — defense in depth, and
 * the only thing that proves the claims were minted by Google. No token is ever
 * logged; failures return typed reasons, never the provider's raw body.
 */

import crypto from 'crypto';
import { timeoutSignal, describeFetchError } from '../utils/fetchTimeout.js';

// Google's production OIDC endpoints. Overridable via env FOR TESTS ONLY (a fake
// authorization server), never a production knob — Google publishes these.
const DEFAULT_ENDPOINTS = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  issuer: 'https://accounts.google.com',
};

// Bounded outbound HTTP for token exchange + JWKS (a hung Google socket must not
// pin the callback handler). Reuses the shared timeout helper (fetchTimeout.js).
const HTTP_TIMEOUT_MS = 10_000;
const JWKS_TTL_MS = 60 * 60 * 1000; // ~1h — Google rotates keys well within this
const CLOCK_SKEW_S = 60;            // tolerated clock skew on exp/iat

/**
 * @param {{fetch?:Function, now?:()=>number, env?:NodeJS.ProcessEnv}} [deps]
 */
export function createGoogleOidc({ fetch = globalThis.fetch, now = () => Date.now(), env = process.env } = {}) {
  const endpoints = {
    authUrl: (env.GOOGLE_AUTH_URL || '').trim() || DEFAULT_ENDPOINTS.authUrl,
    tokenUrl: (env.GOOGLE_TOKEN_URL || '').trim() || DEFAULT_ENDPOINTS.tokenUrl,
    jwksUrl: (env.GOOGLE_JWKS_URL || '').trim() || DEFAULT_ENDPOINTS.jwksUrl,
    issuer: (env.GOOGLE_ISSUER || '').trim() || DEFAULT_ENDPOINTS.issuer,
  };

  const clientId = () => (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = () => (env.GOOGLE_CLIENT_SECRET || '').trim();

  /**
   * Resolve the callback URL. Explicit GOOGLE_REDIRECT_URI wins; otherwise derive
   * `${APP_BASE_URL}/api/auth/google/callback` when APP_BASE_URL is set. Returns
   * '' when neither is resolvable (→ enabled() is false).
   */
  function redirectUri() {
    const explicit = (env.GOOGLE_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    const base = (env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    return base ? `${base}/api/auth/google/callback` : '';
  }

  /** Google auth is usable iff client id + secret + a resolvable redirect URI exist. */
  function enabled() {
    return !!(clientId() && clientSecret() && redirectUri());
  }

  /**
   * Build the Google authorization-code URL. `access_type=online` because we never
   * store Google tokens (no offline refresh); `prompt=select_account` lets a user
   * pick which Google account; PKCE S256 + state + nonce are always present.
   */
  function buildAuthUrl({ state, nonce, codeChallenge, redirectUri: rUri = redirectUri() } = {}) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: rUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      access_type: 'online',
    });
    return `${endpoints.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for tokens (server-side, with client secret +
   * PKCE verifier). Returns a TYPED result; a non-200 or network error never
   * echoes the provider body into a user-facing error (94.md §2.1/§2.8). We keep
   * ONLY the id_token — access/refresh tokens are intentionally discarded.
   * @returns {Promise<{ok:true, idToken:string} | {ok:false, error:string, status?:number}>}
   */
  async function exchangeCode({ code, codeVerifier, redirectUri: rUri = redirectUri() } = {}) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: rUri,
      code_verifier: String(codeVerifier || ''),
    });
    let res;
    try {
      res = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
        signal: timeoutSignal(HTTP_TIMEOUT_MS),
      });
    } catch (e) {
      // Network/timeout — provider unreachable. describeFetchError never leaks a token.
      return { ok: false, error: 'token_request_failed', detail: describeFetchError(e, HTTP_TIMEOUT_MS) };
    }
    if (!res.ok) return { ok: false, error: 'token_exchange_failed', status: res.status };
    let json;
    try { json = await res.json(); } catch { return { ok: false, error: 'token_parse_failed' }; }
    if (!json || typeof json.id_token !== 'string' || !json.id_token) {
      return { ok: false, error: 'no_id_token' };
    }
    return { ok: true, idToken: json.id_token };
  }

  // ── JWKS cache (in-module; ~1h TTL; kid-miss triggers one refetch) ─────────────
  let jwksCache = { keys: [], fetchedAt: 0 };

  async function fetchJwks() {
    const res = await fetch(endpoints.jwksUrl, {
      headers: { Accept: 'application/json' },
      signal: timeoutSignal(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`jwks_http_${res.status}`);
    const json = await res.json();
    const keys = Array.isArray(json && json.keys) ? json.keys : [];
    jwksCache = { keys, fetchedAt: now() };
    return keys;
  }

  /** Signing key for `kid`. Serve from cache when fresh AND present; else refetch once. */
  async function getSigningKey(kid) {
    const fresh = now() - jwksCache.fetchedAt < JWKS_TTL_MS;
    if (fresh) {
      const cached = jwksCache.keys.find((k) => k.kid === kid);
      if (cached) return cached;
    }
    const keys = await fetchJwks();
    return keys.find((k) => k.kid === kid) || null;
  }

  /**
   * Verify a Google ID token: RS256 signature via JWKS, then claims. Returns
   * normalized claims or a typed failure (never throws; never logs the token).
   * @returns {Promise<{ok:true, claims:{sub,email,emailVerified,name,picture}} | {ok:false, error:string}>}
   */
  async function verifyIdToken(idToken, { nonce } = {}) {
    if (!idToken || typeof idToken !== 'string') return { ok: false, error: 'missing_id_token' };
    const parts = idToken.split('.');
    if (parts.length !== 3) return { ok: false, error: 'malformed_id_token' };

    let header, payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { return { ok: false, error: 'malformed_id_token' }; }

    if (header.alg !== 'RS256') return { ok: false, error: 'unsupported_alg' };
    if (!header.kid) return { ok: false, error: 'missing_kid' };

    let jwk;
    try { jwk = await getSigningKey(header.kid); }
    catch (e) { return { ok: false, error: 'jwks_unavailable', detail: describeFetchError(e, HTTP_TIMEOUT_MS) }; }
    if (!jwk) return { ok: false, error: 'unknown_kid' };

    let verified = false;
    try {
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const v = crypto.createVerify('RSA-SHA256');
      v.update(`${parts[0]}.${parts[1]}`);
      v.end();
      verified = v.verify(key, Buffer.from(parts[2], 'base64url'));
    } catch { return { ok: false, error: 'signature_error' }; }
    if (!verified) return { ok: false, error: 'bad_signature' };

    // Claims. iss accepts Google's two spellings; aud must equal our client id;
    // exp/iat honour a 60s skew; nonce must match the value we minted; sub present.
    const nowS = Math.floor(now() / 1000);
    const issuers = new Set([endpoints.issuer, 'accounts.google.com', 'https://accounts.google.com']);
    if (!issuers.has(payload.iss)) return { ok: false, error: 'bad_issuer' };
    if (payload.aud !== clientId()) return { ok: false, error: 'bad_audience' };
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) return { ok: false, error: 'token_expired' };
    if (typeof payload.iat !== 'number' || payload.iat - CLOCK_SKEW_S > nowS) return { ok: false, error: 'bad_iat' };
    if (nonce != null && payload.nonce !== nonce) return { ok: false, error: 'bad_nonce' };
    if (!payload.sub || typeof payload.sub !== 'string') return { ok: false, error: 'missing_sub' };

    return {
      ok: true,
      claims: {
        sub: payload.sub,
        // Normalize the email everywhere (trim + lowercase) — the identity match
        // and the invitation match both compare normalized emails.
        email: String(payload.email || '').trim().toLowerCase(),
        // Google sends email_verified as boolean true OR string "true".
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: typeof payload.name === 'string' ? payload.name : null,
        picture: typeof payload.picture === 'string' ? payload.picture : null,
      },
    };
  }

  return { enabled, buildAuthUrl, exchangeCode, verifyIdToken, redirectUri, endpoints };
}

/** Process-wide instance used by the app (controllers/service/settings/config). */
export const googleOidc = createGoogleOidc();
