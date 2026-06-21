/**
 * prompt7.test.js — admin/mod hardening integration tests (prompt7).
 *
 *   T1   Mod target-role enforcement: mods can mutate ONLY ordinary users
 *        (role 'user') via PATCH /users/:id, PATCH /users/:id/status and
 *        POST /users/:id/reset-password — admin/mod targets → 403 with the
 *        pinned error body; admins remain unrestricted; role assignment stays
 *        admin-only (regression).
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 *
 * NEVER mutates the seeded admins (admin@metalab.local / ops@metalab.local) —
 * a throwaway user is registered and promoted to 'admin' to play the victim.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '';

const MOD_DENIED = 'Moderators cannot modify administrator or moderator accounts';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res), headers: res.headers };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id, email }; }
async function loginAs(email, password = 'Password123!') { const r = await api('/auth/login', { method: 'POST', body: { email, password } }); return r.status === 200 ? r.cookie : ''; }

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    const r = await api('/auth/login', { method: 'POST', body: { email: 'admin@metalab.local', password: process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!' } });
    adminCookie = r.status === 200 ? r.cookie : '';
  }
}, 30000);

// ── Task 1 — Mod target-role enforcement ──────────────────────────────────────
describe('prompt7 T1 — mod target-role enforcement', () => {

  // Shared cast, built once: an acting mod, a second mod (victim), a throwaway
  // admin (registered then promoted — seeded admins are never touched), and an
  // ordinary user. Role checks are DB-verified per request, so promotions take
  // effect immediately on the existing cookies.
  let cast = null;
  async function setupCast() {
    if (cast) return cast;
    const r = rnd();
    const mod = await register(`p7t1_mod${r}@t.local`);
    const otherMod = await register(`p7t1_mod2${r}@t.local`);
    const targetAdmin = await register(`p7t1_adm${r}@t.local`);
    const plain = await register(`p7t1_usr${r}@t.local`);
    expect((await api(`/admin/users/${mod.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'mod' } })).status).toBe(200);
    expect((await api(`/admin/users/${otherMod.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'mod' } })).status).toBe(200);
    expect((await api(`/admin/users/${targetAdmin.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'admin' } })).status).toBe(200);
    cast = { mod, otherMod, targetAdmin, plain };
    return cast;
  }

  it('mod PATCH /users/:id: 403 on admin and mod targets (pinned error body), 200 on ordinary user — and the name actually changed', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ T1 skipped (no admin cookie)'); return; }
    const { mod, otherMod, targetAdmin, plain } = await setupCast();

    // Mod → admin target: 403, nothing written.
    const vsAdmin = await api(`/admin/users/${targetAdmin.id}`, { method: 'PATCH', cookie: mod.cookie, body: { name: 'pwned-admin' } });
    expect(vsAdmin.status).toBe(403);
    expect(vsAdmin.data.error).toBe(MOD_DENIED);

    // Mod → other mod target: 403.
    const vsMod = await api(`/admin/users/${otherMod.id}`, { method: 'PATCH', cookie: mod.cookie, body: { name: 'pwned-mod' } });
    expect(vsMod.status).toBe(403);
    expect(vsMod.data.error).toBe(MOD_DENIED);

    // Mod → themselves via the admin endpoint: also 403 (self-service is /api/profile).
    const vsSelf = await api(`/admin/users/${mod.id}`, { method: 'PATCH', cookie: mod.cookie, body: { name: 'pwned-self' } });
    expect(vsSelf.status).toBe(403);
    expect(vsSelf.data.error).toBe(MOD_DENIED);

    // Email takeover vector is equally blocked.
    const vsEmail = await api(`/admin/users/${targetAdmin.id}`, { method: 'PATCH', cookie: mod.cookie, body: { email: `stolen${rnd()}@t.local` } });
    expect(vsEmail.status).toBe(403);

    // Verify-by-read: the admin target is untouched (GET /users/:id returns the
    // user at the top level, unlike the PATCH handlers' { user } envelope).
    const after = await api(`/admin/users/${targetAdmin.id}`, { cookie: adminCookie });
    expect(after.data.name).toBe(targetAdmin.email.split('@')[0]);
    expect(after.data.email).toBe(targetAdmin.email);

    // Mod → ordinary user: allowed, and the write actually lands.
    const ok = await api(`/admin/users/${plain.id}`, { method: 'PATCH', cookie: mod.cookie, body: { name: 'Renamed By Mod' } });
    expect(ok.status).toBe(200);
    expect(ok.data.user.name).toBe('Renamed By Mod');
    const readBack = await api(`/admin/users/${plain.id}`, { cookie: mod.cookie });
    expect(readBack.status).toBe(200);
    expect(readBack.data.name).toBe('Renamed By Mod');
  });

  it('mod reset-password: 403 on admin/mod targets; 200 secure reset LINK (no plaintext) on ordinary user', async () => {
    if (!up) return;
    if (!adminCookie) return;
    const { mod, otherMod, targetAdmin, plain } = await setupCast();

    // Mod → admin target: 403 and NO plaintext password in the body.
    const vsAdmin = await api(`/admin/users/${targetAdmin.id}/reset-password`, { method: 'POST', cookie: mod.cookie });
    expect(vsAdmin.status).toBe(403);
    expect(vsAdmin.data.error).toBe(MOD_DENIED);
    expect(vsAdmin.data.tempPassword).toBeUndefined();

    // Mod → other mod target: 403.
    const vsMod = await api(`/admin/users/${otherMod.id}/reset-password`, { method: 'POST', cookie: mod.cookie });
    expect(vsMod.status).toBe(403);
    expect(vsMod.data.error).toBe(MOD_DENIED);
    expect(vsMod.data.tempPassword).toBeUndefined();

    // The admin victim's original password still works (nothing was overwritten).
    expect(await loginAs(targetAdmin.email)).toBeTruthy();

    // prompt49 — Mod → ordinary user: allowed, but now issues a SECURE reset link
    // (single-use token emailed). NO plaintext temporary password is ever returned,
    // and the user's password is unchanged until they complete the reset themselves.
    const ok = await api(`/admin/users/${plain.id}/reset-password`, { method: 'POST', cookie: mod.cookie });
    expect(ok.status).toBe(200);
    expect(ok.data.tempPassword).toBeUndefined();
    expect(typeof ok.data.emailConfigured).toBe('boolean');
    expect(await loginAs(plain.email)).toBeTruthy(); // original password still valid
  });

  it('mod status: 403 suspending another mod; 200 suspend + unsuspend on an ordinary user', async () => {
    if (!up) return;
    if (!adminCookie) return;
    const { mod, otherMod, plain } = await setupCast();

    // Mod → other mod: 403 on suspend AND unsuspend (any status mutation).
    const susMod = await api(`/admin/users/${otherMod.id}/status`, { method: 'PATCH', cookie: mod.cookie, body: { suspended: true } });
    expect(susMod.status).toBe(403);
    expect(susMod.data.error).toBe(MOD_DENIED);
    const unsusMod = await api(`/admin/users/${otherMod.id}/status`, { method: 'PATCH', cookie: mod.cookie, body: { suspended: false } });
    expect(unsusMod.status).toBe(403);

    // The other mod is NOT suspended (write never landed) — their console still works.
    expect((await api('/admin/console', { cookie: otherMod.cookie })).status).toBe(200);

    // Mod → ordinary user: suspend 200, then unsuspend 200 (state restored).
    const sus = await api(`/admin/users/${plain.id}/status`, { method: 'PATCH', cookie: mod.cookie, body: { suspended: true } });
    expect(sus.status).toBe(200);
    expect(sus.data.user.suspended).toBe(true);
    const unsus = await api(`/admin/users/${plain.id}/status`, { method: 'PATCH', cookie: mod.cookie, body: { suspended: false } });
    expect(unsus.status).toBe(200);
    expect(unsus.data.user.suspended).toBe(false);
  });

  it('regression: mod role-assign stays 403; admin PATCH on a mod profile stays 200 (admins manage mods); cleanup', async () => {
    if (!up) return;
    if (!adminCookie) return;
    const { mod, otherMod, targetAdmin, plain } = await setupCast();

    // Role assignment is admin-only at the route level — unchanged by T1.
    expect((await api(`/admin/users/${plain.id}/role`, { method: 'PATCH', cookie: mod.cookie, body: { role: 'mod' } })).status).toBe(403);
    expect((await api(`/admin/users/${plain.id}/role`, { method: 'PATCH', cookie: mod.cookie, body: { role: 'admin' } })).status).toBe(403);

    // Admin remains unrestricted: editing a mod profile works.
    const adminEdit = await api(`/admin/users/${otherMod.id}`, { method: 'PATCH', cookie: adminCookie, body: { name: 'Mod Renamed By Admin' } });
    expect(adminEdit.status).toBe(200);
    expect(adminEdit.data.user.name).toBe('Mod Renamed By Admin');

    // The denials above were logged as MOD_TARGET_DENIED SecurityEvents (best-effort writer).
    const ev = await api('/admin/security-events?type=MOD_TARGET_DENIED&limit=50', { cookie: adminCookie });
    expect(ev.status).toBe(200);
    expect((ev.data.events || []).some(e => e.type === 'MOD_TARGET_DENIED' && (e.details || '').includes(targetAdmin.id))).toBe(true);

    // Cleanup: demote the throwaway staff back to ordinary users (seeded admins untouched).
    expect((await api(`/admin/users/${mod.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'user' } })).status).toBe(200);
    expect((await api(`/admin/users/${otherMod.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'user' } })).status).toBe(200);
    expect((await api(`/admin/users/${targetAdmin.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'user' } })).status).toBe(200);
  });
});
