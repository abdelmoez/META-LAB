/**
 * prompt93-observability.test.js — pre-beta observability + CSRF surface (93.md).
 *
 *   T1  Server reachability guard (anti-vacuous-green)
 *   T2  GET /api/health/ready — public readiness probe shape
 *       { status, checks.database, version } and nothing leaky
 *   T3  GET /api/admin/metrics/runtime — the NEW runtime metrics endpoint is
 *       admin-only (401 anon / 403 plain user / 200 admin with
 *       eventLoopDelayMs + memory + queues), and the LEGACY dashboard metrics
 *       at /api/admin/metrics keep their users/projects shape (the runtime
 *       router originally shadowed them — regression guard)
 *   T4  originCheck (93.md §4.6) — a cross-site Origin / Sec-Fetch-Site on a
 *       mutating route → 403 ORIGIN_FORBIDDEN, while no-Origin, allowlisted-
 *       Origin, and same-host-Origin requests keep working
 *   T5  X-Request-Id (93.md §4.11) — every response carries a correlation id;
 *       a sane inbound id is echoed back
 *
 * Live API at http://127.0.0.1:3001 (npm run server).
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '', userCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* non-JSON (403 CORS text etc.) */ }
  return { status: res.status, data, cookie: cookieFrom(res), headers: res.headers };
}

beforeAll(async () => {
  // Spaced-retry reachability probe (same rationale as api-password-reset.test.js:
  // Windows ephemeral-port churn at the tail of a long run).
  for (let attempt = 0; attempt < 5 && !up; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000));
    try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  }
  if (up) {
    const candidates = [...new Set([process.env.ADMIN_SEED_PASSWORD, 'MetaLabAdmin2026!'].filter(Boolean))];
    for (const password of candidates) {
      if (adminCookie) break;
      try {
        const r = await api('/auth/login', { method: 'POST', body: { email: 'admin@metalab.local', password } });
        adminCookie = r.status === 200 ? r.cookie : '';
      } catch { adminCookie = ''; }
    }
    const u = await api('/auth/register', { method: 'POST', body: { email: `obs${rnd()}@example.com`, password: 'Password123!', name: 'obs' } });
    userCookie = u.cookie;
  }
}, 30000);

describe('obs T1 — server reachability (anti-vacuous-green guard)', () => {
  it('the live API on 127.0.0.1:3001 is reachable and admin login works', () => {
    expect(up).toBe(true);
    expect(adminCookie).not.toBe('');
    expect(userCookie).not.toBe('');
  });
});

describe('obs T2 — GET /api/health/ready shape', () => {
  it('returns 200 { status: ok, checks.database: ok, version } with a healthy DB', async () => {
    if (!up) return;
    const r = await api('/health/ready');
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('ok');
    expect(r.data.checks).toBeTruthy();
    expect(r.data.checks.database).toBe('ok');
    expect(r.data.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(new Date(r.data.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('exposes no environment name, DB latency, or connection details (prompt 52 fingerprinting)', async () => {
    if (!up) return;
    const r = await api('/health/ready');
    const flat = JSON.stringify(r.data).toLowerCase();
    for (const leak of ['environment', 'latency', 'database_url', 'postgres', 'sqlite', 'file:']) {
      expect(flat).not.toContain(leak);
    }
  });
});

describe('obs T3 — admin runtime metrics gating + legacy dashboard metrics intact', () => {
  it('anon → 401; plain user → 403 (fail closed)', async () => {
    if (!up) return;
    const anon = await api('/admin/metrics/runtime');
    expect(anon.status).toBe(401);
    const plain = await api('/admin/metrics/runtime', { cookie: userCookie });
    expect(plain.status).toBe(403);
  });

  it('admin → 200 with eventLoopDelayMs percentiles, memory, uptime and queue depths', async () => {
    if (!up || !adminCookie) return;
    const r = await api('/admin/metrics/runtime', { cookie: adminCookie });
    expect(r.status).toBe(200);
    const d = r.data;
    for (const p of ['p50', 'p95', 'p99', 'max']) {
      expect(typeof d.eventLoopDelayMs[p]).toBe('number');
      expect(d.eventLoopDelayMs[p]).toBeGreaterThanOrEqual(0);
    }
    expect(d.memory.rssMb).toBeGreaterThan(0);
    expect(d.memory.heapUsedMb).toBeGreaterThan(0);
    expect(typeof d.uptimeSec).toBe('number');
    // dbPingMs is a number on a healthy DB (null only when the ping failed).
    expect(typeof d.dbPingMs).toBe('number');
    expect(d.queues && typeof d.queues).toBe('object');
    // The durable-job tables exist in the dev schema → their depths are reported.
    for (const q of Object.values(d.queues)) {
      expect(typeof q.queued).toBe('number');
      expect(typeof q.processing).toBe('number');
    }
  });

  it('LEGACY /api/admin/metrics still serves the dashboard shape (users/projects totals)', async () => {
    if (!up || !adminCookie) return;
    // 93.md regression guard: the runtime router was first mounted ON this path,
    // shadowing the Ops dashboard payload the Admin Console renders.
    const r = await api('/admin/metrics', { cookie: adminCookie });
    expect(r.status).toBe(200);
    expect(typeof r.data.users?.total).toBe('number');
    expect(r.data).toHaveProperty('projects');
    // And it must NOT have silently become the runtime payload.
    expect(r.data.eventLoopDelayMs).toBeUndefined();
  });
});

describe('obs T4 — originCheck rejects cross-site mutations, passes legitimate ones (93.md §4.6)', () => {
  it('POST with a foreign Origin → 403 ORIGIN_FORBIDDEN before any handler runs', async () => {
    if (!up) return;
    const r = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@metalab.local', password: 'whatever' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
    expect(r.data?.code).toBe('ORIGIN_FORBIDDEN');
  });

  it('POST with Sec-Fetch-Site: cross-site → 403 even with an allowlisted Origin', async () => {
    if (!up) return;
    const r = await api('/auth/login', {
      method: 'POST',
      body: { email: 'x@example.com', password: 'whatever' },
      headers: { Origin: 'http://localhost:3000', 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(r.status).toBe(403);
    expect(r.data?.code).toBe('ORIGIN_FORBIDDEN');
  });

  it('POST with NO Origin keeps working (the integration-suite norm) — 401 not 403', async () => {
    if (!up) return;
    const r = await api('/auth/login', { method: 'POST', body: { email: `nobody${rnd()}@example.com`, password: 'WrongPass1!' } });
    expect(r.status).toBe(401); // reached the handler; origin layer let it through
  });

  it('POST with an ALLOWLISTED Origin reaches the handler', async () => {
    if (!up) return;
    // http://localhost:3000 is the dev allowlist default (CORS_ORIGIN).
    const r = await api('/auth/login', {
      method: 'POST',
      body: { email: `nobody${rnd()}@example.com`, password: 'WrongPass1!' },
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(r.status).toBe(401); // 401 = handler ran; 403 would mean origin-blocked
  });

  it('POST with a same-host Origin (http://127.0.0.1:3001) passes via the Host fallback', async () => {
    if (!up) return;
    const r = await api('/auth/login', {
      method: 'POST',
      body: { email: `nobody${rnd()}@example.com`, password: 'WrongPass1!' },
      headers: { Origin: 'http://127.0.0.1:3001' },
    });
    expect(r.status).toBe(401);
  });

  it('GET with a foreign Origin is untouched (read-only requests are not origin-gated)', async () => {
    if (!up) return;
    const r = await api('/health', { headers: { Origin: 'https://evil.example' } });
    expect(r.status).toBe(200);
  });
});

describe('obs T5 — X-Request-Id correlation (93.md §4.11)', () => {
  it('every response carries a minted X-Request-Id', async () => {
    if (!up) return;
    const r = await api('/health');
    const id = r.headers.get('x-request-id');
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('a sane inbound X-Request-Id is honoured and echoed', async () => {
    if (!up) return;
    const inbound = `it-${rnd()}${rnd()}${rnd()}`; // matches [A-Za-z0-9_-]{8,64}
    const r = await api('/health', { headers: { 'X-Request-Id': inbound } });
    expect(r.headers.get('x-request-id')).toBe(inbound);
  });

  it('a garbage inbound id is replaced, never echoed (log-injection resistance)', async () => {
    if (!up) return;
    const r = await api('/health', { headers: { 'X-Request-Id': 'bad id !!' } });
    const id = r.headers.get('x-request-id');
    expect(id).toBeTruthy();
    expect(id).not.toBe('bad id !!');
  });
});
