#!/usr/bin/env node
/**
 * smoke-deploy.mjs — post-deployment smoke test (prompt49 §11).
 *
 * Verifies a deployed PecanRev target is healthy WITHOUT any secrets:
 *   - health responds + reports a version
 *   - readiness passes (DB connectivity)
 *   - version endpoint responds (optionally matches EXPECT_COMMIT)
 *   - a protected route rejects unauthenticated callers (401)
 *   - public settings (the SPA's bootstrap) respond
 *   - when the betaWaitlist flag is ON, the waitlist DB answers with a real
 *     count (73.md Part 11 — {count:null} means the waitlist data layer is
 *     down and public submits 503 even though the page renders)
 *
 * Usage:
 *   SMOKE_BASE=https://pecanrev.com [EXPECT_COMMIT=<sha>] node scripts/smoke-deploy.mjs
 * Exits 0 when all checks pass, 1 otherwise (so CI/deploy can fail/rollback).
 */

const BASE = (process.env.SMOKE_BASE || process.env.API_BASE || 'http://localhost:3001').replace(/\/+$/, '');
const EXPECT_COMMIT = (process.env.EXPECT_COMMIT || '').trim();
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 8000);

const results = [];
const rec = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

async function getJson(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { res, body };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  // 1. Health
  try { const { res, body } = await getJson('/api/health'); rec('health', res.ok && body?.status === 'ok', body?.version ? `v${body.version}` : ''); }
  catch (e) { rec('health', false, e.message); }

  // 2. Readiness (DB)
  try { const { res, body } = await getJson('/api/health/ready'); rec('readiness(db)', res.ok && body?.checks?.database === 'ok', `db ${body?.dbLatencyMs ?? '?'}ms`); }
  catch (e) { rec('readiness(db)', false, e.message); }

  // 3. Version (+ optional commit match)
  try {
    const { res, body } = await getJson('/api/version');
    const commit = body?.commit || '';
    const commitOk = !EXPECT_COMMIT || (commit && (EXPECT_COMMIT.startsWith(commit) || commit.startsWith(EXPECT_COMMIT)));
    rec('version', res.ok && !!body?.version && commitOk, `v${body?.version} @ ${commit || '?'}`);
  } catch (e) { rec('version', false, e.message); }

  // 4. Protected route rejects unauthenticated callers
  try { const { res } = await getJson('/api/auth/me'); rec('protected-route-guard', res.status === 401); }
  catch (e) { rec('protected-route-guard', false, e.message); }

  // 5. Public settings (SPA bootstrap)
  let publicSettings = null;
  try { const { res, body } = await getJson('/api/settings/public'); publicSettings = body; rec('public-settings', res.ok); }
  catch (e) { rec('public-settings', false, e.message); }

  // 6. Waitlist DB reachable whenever the betaWaitlist flag is ON. The public
  //    count endpoint is deliberately 200-{count:null} on ANY DB failure, so a
  //    null count with the flag ON is exactly the outage class this catches.
  try {
    if (!publicSettings || typeof publicSettings.featureFlags !== 'object') {
      rec('waitlist-db', false, 'could not read featureFlags from /api/settings/public');
    } else if (publicSettings.featureFlags.betaWaitlist !== true) {
      rec('waitlist-db', true, 'skipped — betaWaitlist flag is OFF');
    } else {
      const { res, body } = await getJson('/api/waitlist/count');
      const ok = res.ok && Number.isInteger(body?.count);
      rec('waitlist-db', ok, ok
        ? `count=${body.count}`
        : 'waitlist DB unavailable while betaWaitlist flag is ON (GET /api/waitlist/count did not return an integer count)');
    }
  } catch (e) { rec('waitlist-db', false, e.message); }

  // 7. 94.md — Google OAuth start must 302 either to accounts.google.com (when
  //    configured) or to the safe not-configured error redirect. Both PASS; the
  //    detail records which mode the deployment is in. A 200/404/500 FAILS.
  try {
    const res = await fetch(`${BASE}/api/auth/google/start`, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    const configured = /accounts\.google\.com|\/o\/oauth2\//.test(loc);
    const unconfigured = loc.includes('googleError=GOOGLE_NOT_CONFIGURED');
    rec('google-oauth-start', res.status === 302 && (configured || unconfigured),
      configured ? 'configured — redirects to Google' : unconfigured ? 'not configured — safe error redirect' : `status=${res.status} location=${loc.slice(0, 80)}`);
  } catch (e) { rec('google-oauth-start', false, e.message); }

  // 8. 94.md §3.7 — auth/OAuth responses must never be cacheable. The app-wide
  //    apiNoStore should stamp every /api response; verify on the OAuth surface.
  try {
    const res = await fetch(`${BASE}/api/auth/google/start`, { redirect: 'manual' });
    const cc = (res.headers.get('cache-control') || '').toLowerCase();
    rec('api-no-store', cc.includes('no-store'), cc || 'missing Cache-Control');
  } catch (e) { rec('api-no-store', false, e.message); }

  // 9. 94.md §3.7 — hashed assets should carry the immutable CDN caching header.
  //    Informational: parse one /assets URL out of the SPA HTML; skip gracefully
  //    when the deployment serves no SPA or the HTML references no hashed asset.
  try {
    const htmlRes = await fetch(`${BASE}/`, { redirect: 'follow' });
    const html = htmlRes.ok ? await htmlRes.text() : '';
    const m = html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/);
    if (!m) {
      rec('asset-immutable-cache', true, 'skipped — no hashed /assets URL found in HTML');
    } else {
      const aRes = await fetch(`${BASE}${m[0]}`, { redirect: 'manual' });
      const cc = (aRes.headers.get('cache-control') || '').toLowerCase();
      rec('asset-immutable-cache', aRes.ok && cc.includes('max-age=31536000'),
        `${m[0].slice(0, 60)} → ${cc || 'no Cache-Control'}`);
    }
  } catch (e) { rec('asset-immutable-cache', true, `skipped — ${e.message}`); }

  const passed = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  console.log(`\nSmoke: ${passed}/${results.length} passed against ${BASE}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('Smoke runner error:', e.message); process.exit(1); });
