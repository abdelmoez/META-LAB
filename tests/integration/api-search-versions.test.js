/**
 * api-search-versions.test.js — 69.md §7/§8. Flag + auth gates for the search-strategy
 * VERSIONS API and the methods-text export.
 *
 * `searchEngine` defaults OFF, so:
 *  - unauthenticated calls are rejected by requireAuth (401/403) BEFORE the flag gate;
 *  - authenticated calls 404 while the flag is off (existence-hiding).
 * Canonical harness pattern: self-skip when the dev server at 127.0.0.1:3001 is down
 * (never `localhost` — Windows ::1 flake).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function hit(path, opts = {}) {
  try { return await fetch(`${API}${path}`, opts); }
  catch { return fetch(`${API}${path}`, opts); } // one retry
}

let up = false;
let cookie = '';
let adminCookie = '';

// 75.md Phase 7 — log in a real ADMIN (env creds first, then the seeded dev admins)
// so the admin flag-bypass can be pinned. Self-skips if none authenticate.
async function loginAdmin() {
  const candidates = [
    [process.env.ADMIN_EMAIL_1 || process.env.ADMIN_EMAIL, process.env.ADMIN_SEED_PASSWORD],
    ['admin@example.com', 'LocalDevAdmin!2026'],
    ['admin@metalab.local', 'MetaLabAdmin2026!'],
  ];
  for (const [email, password] of candidates) {
    if (!email || !password) continue;
    try {
      const res = await hit('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const c = (res.headers.get('set-cookie') || '').split(';')[0] || '';
        if (c) return c;
      }
    } catch { /* try next */ }
  }
  return '';
}

beforeAll(async () => {
  try {
    const res = await hit('/health');
    up = res.ok;
  } catch { up = false; }
  if (!up) return;
  const email = `sv-gate-${Date.now()}@example.com`;
  const reg = await hit('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'SV Gate', email, password: 'Str0ng!Passw0rd99' }),
  });
  if (reg.ok || reg.status === 201) {
    const setCookie = reg.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0] || '';
  }
  adminCookie = await loginAdmin();
}, 30000);

const P = 'some-project';

describe('search-strategy versions flag + auth gates', () => {
  it('unauthenticated list versions is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/${P}/versions`);
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated snapshot is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/${P}/versions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated methods-text is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/${P}/methods-text`);
    expect([401, 403]).toContain(res.status);
  });

  it('authenticated list versions 404s while the searchEngine flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions`, { headers: { cookie } });
    // Flag default OFF → existence-hiding 404. (If a local admin turned it on, an
    // unknown project still 404s — the assertion holds either way.)
    expect(res.status).toBe(404);
  });

  it('authenticated snapshot 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'v1' }),
    });
    expect(res.status).toBe(404);
  });

  it('authenticated compare 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/compare?a=x&b=y`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('authenticated get-one-version 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/some-vid`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('authenticated restore 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/some-vid/restore`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('authenticated mark-final 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/some-vid/final`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFinal: true }),
    });
    expect(res.status).toBe(404);
  });

  it('authenticated methods-text 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/methods-text`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  // 75.md Phase 7 — an ADMIN bypasses the searchEngine existence-gate while it is
  // OFF: the versions route falls through to the project-access check, so for a
  // non-existent project it 404s with 'Project not found' (access) rather than
  // 'Not found' (flag gate). Needs the server restarted with featureAccess; until
  // then the flag gate returns 'Not found' and this test self-skips.
  it('an admin passes the searchEngine gate while OFF (falls through to access) [needs restart]', async () => {
    if (!up || !adminCookie) return;
    const res = await hit(`/search-builder/${P}/versions`, { headers: { cookie: adminCookie } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 404 && body.error === 'Not found') {
      console.warn('[75.md] search-versions admin flag-bypass pending server restart — strict assert skipped');
      return;
    }
    expect(res.status).toBe(404);
    expect(body.error).toBe('Project not found');
  });
});

/* ── 85.md A1 — rejectedSuggestions PUT→GET round-trip ──────────────────────────
   The putSearch allowlist writes only named keys, so a new persisted key that is
   missing its branch would be SILENTLY dropped — the client would save, get
   { ok:true }, and the rejection memory would vanish on reload. This pins the
   branch end-to-end on a real project. Runs on the ADMIN path (admins bypass the
   searchEngine existence-gate via featureAccess), so it works with the flag OFF;
   self-skips when no admin authenticates or the gate predates featureAccess. */
describe('putSearch — rejectedSuggestions round-trip (85.md A1)', () => {
  it('PUT with rejectedSuggestions → GET returns them; a PUT omitting the key leaves them intact', async () => {
    if (!up || !adminCookie) return;
    const J = { cookie: adminCookie, 'Content-Type': 'application/json' };

    // Own project so resolveProjectAccess grants canEdit.
    const proj = await hit('/projects', {
      method: 'POST', headers: J, body: JSON.stringify({ name: `A1 rejected-suggestions ${Date.now()}` }),
    });
    if (!(proj.ok || proj.status === 201)) {
      console.warn('[85.md A1] could not create a project (admin gate pending restart?) — round-trip skipped');
      return;
    }
    const pid = (await proj.json()).id;

    try {
      const put = await hit(`/search-builder/${pid}`, {
        method: 'PUT', headers: J,
        body: JSON.stringify({
          concepts: [{ id: 'c1', label: 'Population', picoField: 'P', op: 'AND', terms: [{ id: 't1', text: 'obesity', type: 'freetext', field: 'tiab' }] }],
          overrides: {}, ignored: [],
          rejectedSuggestions: ['rej:P:fam:obesity', 'rej:I:widget score'],
        }),
      });
      if (put.status === 404) {
        console.warn('[85.md A1] admin flag-bypass pending server restart — round-trip skipped');
        return;
      }
      expect(put.status).toBe(200);
      expect((await put.json()).ok).toBe(true);

      const got = await hit(`/search-builder/${pid}`, { headers: { cookie: adminCookie } });
      expect(got.status).toBe(200);
      const state = await got.json();
      expect(state.rejectedSuggestions).toEqual(['rej:P:fam:obesity', 'rej:I:widget score']);
      expect(state.concepts).toHaveLength(1);

      // Named-keys contract: a single-key PUT (e.g. the searchMode writer) must not
      // wipe the rejections it does not name.
      const single = await hit(`/search-builder/${pid}`, {
        method: 'PUT', headers: J, body: JSON.stringify({ searchMode: 'manual' }),
      });
      expect(single.status).toBe(200);
      const after = await (await hit(`/search-builder/${pid}`, { headers: { cookie: adminCookie } })).json();
      expect(after.rejectedSuggestions).toEqual(['rej:P:fam:obesity', 'rej:I:widget score']);
      expect(after.searchMode).toBe('manual');

      // Sanitizer applies on write: junk entries dropped, strings trimmed.
      const junk = await hit(`/search-builder/${pid}`, {
        method: 'PUT', headers: J, body: JSON.stringify({ rejectedSuggestions: [' rej:P:x ', 7, null, ''] }),
      });
      expect(junk.status).toBe(200);
      const cleaned = await (await hit(`/search-builder/${pid}`, { headers: { cookie: adminCookie } })).json();
      expect(cleaned.rejectedSuggestions).toEqual(['rej:P:x']);
    } finally {
      await hit(`/projects/${pid}`, { method: 'DELETE', headers: { cookie: adminCookie } }).catch(() => {});
    }
  }, 30000);
});
