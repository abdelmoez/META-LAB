/**
 * server/security/csp.js — centralized Content-Security-Policy generation
 * (prompt 51). Single source of truth for the policy string, the per-response
 * nonce, the inline-script hashes, the rollout mode, and the Express middleware
 * that attaches the header.
 *
 * Architecture (see docs/manager/csp-security.md for the full rationale):
 *  - The Node/Express server is the single source of truth for headers. It
 *    serves both the JSON API and (via spaTheme.serveSpa) the SPA HTML, so one
 *    middleware can cover every route. There is NO committed nginx/CDN policy
 *    to conflict with.
 *  - SPA responses get a strict policy with a fresh per-response nonce. The one
 *    DYNAMIC inline script (the theme globals injected by serveSpa) carries that
 *    nonce; the one STATIC inline script (the theme/brand/ui bootstrap in
 *    index.html) is allowed by its SHA-256 hash. NO 'unsafe-inline' / 'unsafe-eval'
 *    in script-src. 'wasm-unsafe-eval' is required by pdf.js (WebAssembly) only.
 *  - 'unsafe-inline' remains in style-src ONLY — an explicit, documented
 *    temporary exception forced by the React inline-style architecture and
 *    framer-motion's runtime <style> injection (a per-response nonce must not be
 *    exposed to client JS). It is scoped to styles and never to scripts.
 *  - API (/api/*) responses get a maximally strict default-src 'none' policy
 *    since they carry only JSON (no scripts/styles/resources).
 *  - Modes: disabled | report-only | enforce, selected by CSP_MODE. The default
 *    is report-only — it ships the header for observation but never blocks, and
 *    is never silently "disabled".
 *
 * The policy is built from repository evidence (see the audit in
 * docs/manager/csp-security.md). No directive is widened without a documented
 * reason, and no user-controlled value is ever placed into a directive — the
 * only dynamic value is the crypto-random nonce.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distIndexHtml = path.resolve(here, '../../dist/index.html');
const srcIndexHtml = path.resolve(here, '../../index.html');

/** First-party path that receives CSP violation reports (see cspReport.js). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** The reporting group name referenced by the `report-to` directive. */
const REPORT_GROUP = 'csp-endpoint';

/* ─────────────────────────── mode + environment ─────────────────────────── */

const VALID_MODES = new Set(['disabled', 'report-only', 'enforce']);

/**
 * Resolve the rollout mode from CSP_MODE. Unknown/empty → 'report-only' (safe:
 * sends the header for observation, never blocks, never silently disabled).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'disabled'|'report-only'|'enforce'}
 */
export function cspMode(env = process.env) {
  const raw = String(env.CSP_MODE || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'disabled') return 'disabled';
  if (raw === 'enforce' || raw === 'enforcing' || raw === 'on') return 'enforce';
  if (raw === 'report-only' || raw === 'reportonly' || raw === 'report') return 'report-only';
  return 'report-only';
}

export function isProd(env = process.env) {
  return env.NODE_ENV === 'production';
}

/* ─────────────────────────────── nonce ──────────────────────────────────── */

/**
 * A fresh, cryptographically-random, unpredictable nonce per HTTP response.
 * 128 bits of entropy, base64url so it is safe both as an HTML attribute value
 * and as a CSP nonce-source token (no quoting/escaping concerns, no padding).
 * @returns {string}
 */
export function generateNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

/** A nonce is well-formed iff it is non-empty base64url (header-injection guard). */
export function isValidNonce(n) {
  return typeof n === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(n);
}

/* ───────────────────────── inline-script hashes ─────────────────────────── */

/**
 * Compute the SHA-256 (base64, standard padding — exactly what a browser
 * computes for `'sha256-…'`) of every INLINE <script> (one without a `src`
 * attribute) in the given HTML. External `<script src>` tags are skipped — they
 * are authorized by `script-src 'self'`. Pure + unit-tested.
 * @param {string} html
 * @returns {string[]} e.g. ["'sha256-…'"]
 */
export function computeInlineScriptHashes(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // external → covered by 'self'
    const body = m[2];
    const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    out.push(`'sha256-${digest}'`);
  }
  return out;
}

let _hashCache; // undefined = not yet computed; array once computed
/**
 * Hashes of the static inline scripts in the SERVED index.html. Reads the built
 * dist/index.html (what serveSpa actually sends) so the hash always matches the
 * served bytes; falls back to the source index.html in pure-dev (no build).
 * Cached for process lifetime (the build is immutable per deploy).
 * @returns {string[]}
 */
export function inlineScriptHashes() {
  if (_hashCache !== undefined) return _hashCache;
  let html = '';
  try { html = fs.readFileSync(distIndexHtml, 'utf8'); }
  catch {
    try { html = fs.readFileSync(srcIndexHtml, 'utf8'); } catch { html = ''; }
  }
  _hashCache = computeInlineScriptHashes(html);
  return _hashCache;
}

/** Test/operational hook to force re-reading the index.html hashes. */
export function resetInlineHashCache() { _hashCache = undefined; }

/* ──────────────────────────── policy builder ────────────────────────────── */

/**
 * Build the directive map for one response.
 * @param {object} [opts]
 * @param {string} [opts.nonce] per-response nonce (SPA responses only)
 * @param {boolean} [opts.isApi] true → strict JSON policy
 * @param {boolean} [opts.prod] production toggle (gates dev-only sources)
 * @param {string[]} [opts.hashes] static inline-script hashes
 * @param {boolean} [opts.report] include reporting directives
 * @returns {Record<string,string[]>} directive → source tokens
 */
export function buildCsp({
  nonce,
  isApi = false,
  prod = isProd(),
  hashes = [],
  report = true,
} = {}) {
  /** @type {Record<string,string[]>} */
  let d;

  if (isApi) {
    // The API serves only JSON — it loads no scripts, styles, frames or other
    // resources, so the policy can be maximally strict.
    d = {
      'default-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      'frame-ancestors': ["'none'"],
    };
  } else {
    // SPA HTML policy.
    const scriptSrc = ["'self'", "'wasm-unsafe-eval'"]; // wasm-unsafe-eval: pdf.js WASM
    if (prod) {
      // Strict in production: nonce (dynamic injected theme script) + hash
      // (static bootstrap script). NO 'unsafe-inline'.
      if (isValidNonce(nonce)) scriptSrc.push(`'nonce-${nonce}'`);
      for (const h of hashes) scriptSrc.push(h);
    } else {
      // Development (e.g. Node serving a non-prod build, or Vite's HMR preamble):
      // allow inline scripts. NOTE: a nonce is intentionally NOT added in dev,
      // because mixing a nonce with 'unsafe-inline' makes browsers ignore
      // 'unsafe-inline' and would break the un-nonced HMR preamble.
      scriptSrc.push("'unsafe-inline'");
    }

    d = {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'script-src': scriptSrc,
      'script-src-attr': ["'none'"],          // block inline on*= event handlers
      // style-src: 'unsafe-inline' is a DOCUMENTED, style-only exception forced by
      // React inline style={{}} attributes + framer-motion runtime <style>
      // injection. See docs/manager/csp-security.md (remediation tracked).
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'img-src': ["'self'", 'data:', 'blob:'], // data:/blob: = export rasterization + previews
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'connect-src': prod
        ? ["'self'"]                           // SSE + /api are same-origin; externals are proxied
        : ["'self'", 'ws://localhost:*', 'ws://127.0.0.1:*', 'http://localhost:*', 'http://127.0.0.1:*'],
      'media-src': ["'self'"],
      'worker-src': ["'self'", 'blob:'],       // bundled pdf.js worker (self) + fake-worker fallback (blob)
      'manifest-src': ["'self'"],
      'frame-src': ["'self'"],
      'child-src': ["'self'"],
    };

    if (prod) d['upgrade-insecure-requests'] = [];
  }

  if (report) {
    d['report-uri'] = [CSP_REPORT_PATH];   // legacy (still the most widely supported)
    d['report-to'] = [REPORT_GROUP];       // modern Reporting API group
  }

  return d;
}

/**
 * Serialize a directive map into a valid header value. Collapses internal
 * whitespace and strips any CR/LF (header-injection guard). A valueless
 * directive (e.g. upgrade-insecure-requests) is emitted as its name alone.
 * @param {Record<string,string[]>} directives
 * @returns {string}
 */
export function serializeCsp(directives) {
  const parts = [];
  for (const [name, values] of Object.entries(directives)) {
    const tokens = (values || []).filter(Boolean);
    parts.push(tokens.length ? `${name} ${tokens.join(' ')}` : name);
  }
  return parts.join('; ').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Header name for a given mode (null when disabled). */
export function cspHeaderName(mode) {
  if (mode === 'enforce') return 'Content-Security-Policy';
  if (mode === 'report-only') return 'Content-Security-Policy-Report-Only';
  return null;
}

/* ──────────────────── Permissions-Policy (related header) ───────────────── */

// Deny powerful features the app does not use; allow fullscreen for the PDF
// viewer. Centralized here so all security headers live in one auditable place.
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
].join(', ');

/* ──────────────────────────── Express middleware ────────────────────────── */

/**
 * Attach CSP + related security headers to every response.
 *  - disabled mode → no CSP header at all (other headers still applied).
 *  - SPA responses → per-response nonce stored on res.locals.cspNonce (read by
 *    serveSpa to stamp the injected theme script) + strict SPA policy.
 *  - /api responses → strict JSON policy (no nonce needed).
 * @param {object} [opts]
 * @param {()=>('disabled'|'report-only'|'enforce')} [opts.mode]
 */
export function cspMiddleware(opts = {}) {
  const getMode = opts.mode || (() => cspMode());
  return function csp(req, res, next) {
    // Reporting-Endpoints + Permissions-Policy are independent of CSP mode and
    // safe to always send; the report group is harmless even when CSP is off.
    res.setHeader('Reporting-Endpoints', `${REPORT_GROUP}="${CSP_REPORT_PATH}"`);
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);

    const mode = getMode();
    const headerName = cspHeaderName(mode);
    if (!headerName) return next(); // disabled

    // Couple ENFORCEMENT to STRICTNESS: an enforced header must always carry the
    // strict (production) policy. Otherwise `CSP_MODE=enforce` without
    // NODE_ENV=production would enforce a permissive, dev-source-leaking policy
    // (no nonce, 'unsafe-inline', ws://localhost). Enforcing in dev only ever
    // means "test the strict policy", so force prod=true whenever mode==='enforce'.
    const prod = isProd() || mode === 'enforce';

    const isApi = req.path.startsWith('/api/') || req.path === '/api';
    let nonce;
    if (!isApi) {
      nonce = generateNonce();
      res.locals.cspNonce = nonce;
    }
    const directives = buildCsp({
      nonce,
      isApi,
      prod,
      hashes: isApi ? [] : inlineScriptHashes(),
    });
    res.setHeader(headerName, serializeCsp(directives));
    next();
  };
}
