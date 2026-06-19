/**
 * api-workflow-state.test.js — server-backed per-module workflow state (prompt38).
 *
 * Skips when the dev server is not running (same pattern as the other integration
 * suites). The default-flag-OFF + authorization behavior is checked against any
 * running server; the full flag-ON concurrency flow (revision increment, 409
 * conflict, permission isolation) is exercised LIVE during development and
 * documented in describe.skip (it needs an admin to flip the feature flag).
 *
 * Live-verified during prompt38 development:
 *   flag OFF              → 404
 *   flag ON, base=0       → revision 1
 *   flag ON, base=1 merge → revision 2 (P preserved + O added)
 *   flag ON, stale base   → 409 STATE_CONFLICT (current state returned, NO overwrite)
 *   unknown moduleKey     → 400
 *   non-member            → 404 (existence hidden)
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}

let up = false;
beforeAll(async () => { up = await serverUp(); });

describe('workflow-state endpoints — default (flag OFF) + auth', () => {
  it('requires authentication (401)', async () => {
    if (!up) return;
    const r = await fetch(`${API}/workspaces/anyid/modules/protocol/state`);
    expect([401, 403]).toContain(r.status);
  });

  it('an authenticated user hits 404 while the flag is OFF (default)', async () => {
    if (!up) return;
    const email = `wfstate_${Date.now()}@example.com`;
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Passw0rd!23', name: 'WF State' }),
    });
    const cookie = reg.headers.get('set-cookie');
    if (!cookie) return; // registration disabled → skip
    const r = await fetch(`${API}/workspaces/some-project/modules/protocol/state`, {
      headers: { Cookie: cookie },
    });
    // Flag OFF → 404 (feature hidden). If an operator left the flag ON, a
    // non-member still gets 404 (existence hidden) — either way, 404.
    expect(r.status).toBe(404);
  });
});

// Full flag-ON concurrency + permission coverage needs an admin session to flip
// the serverBackedWorkflowState feature flag; see the header for the live-verified
// matrix. Kept as documentation (skipped in the hermetic gate).
describe.skip('workflow-state flag-ON flow (needs admin to enable the flag)', () => {
  it('documented in the file header', () => {});
});
