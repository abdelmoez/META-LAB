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
  try { const { res } = await getJson('/api/settings/public'); rec('public-settings', res.ok); }
  catch (e) { rec('public-settings', false, e.message); }

  const passed = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  console.log(`\nSmoke: ${passed}/${results.length} passed against ${BASE}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('Smoke runner error:', e.message); process.exit(1); });
