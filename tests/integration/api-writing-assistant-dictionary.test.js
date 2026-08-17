/**
 * 120.md §6 "Dictionary scopes" — the personal and project writing-assistant
 * dictionaries, end to end against the real server.
 *
 * What this file is actually protecting:
 *   · authentication on every route (there is no anonymous path to a dictionary);
 *   · the project scope's access model — a non-member gets 404, not 403, because the
 *     repo hides existence;
 *   · duplicate prevention (409) that does NOT destroy meaningful capitalization —
 *     "TP53" and "tp53" are the same entry, and the stored casing stays the author's;
 *   · the input caps §6 asks for (per entry) and the shape of the refusal;
 *   · the reversal §6 requires ("Provide a way to reverse an accidental dictionary
 *     addition") actually removing the row;
 *   · the preference blob riding the profile allowlist under its 500-character cap.
 *
 * Canonical harness: self-skip when the dev server at 127.0.0.1:3001 is down (never
 * `localhost` — Windows ::1 flake). Run serially: --pool=forks --poolOptions.forks.singleFork.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';
const hit = (path, opts = {}) => fetch(`${API}${path}`, opts);
const json = (cookie, body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify(body),
});

let up = false;
let cookie = '';
let otherCookie = '';
let projectId = '';
const tag = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function register(who) {
  const email = `wa-dict-${who}-${tag}@example.com`;
  const res = await hit('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `WA ${who}`, email, password: 'Str0ng!Passw0rd120' }),
  });
  if (res.ok || res.status === 201) return (res.headers.get('set-cookie') || '').split(';')[0] || '';
  return '';
}

beforeAll(async () => {
  try { const res = await hit('/health'); up = res.ok; } catch { up = false; }
  if (!up) return;
  cookie = await register('owner');
  otherCookie = await register('outsider');
  if (!cookie) return;
  const proj = await hit('/projects', json(cookie, { name: `WA Dictionary ${tag}` }));
  if (proj.ok || proj.status === 201) projectId = (await proj.json()).id;
}, 30000);

/** Unique per assertion so a re-run against the same dev DB cannot collide. */
let n = 0;
const term = (base) => `${base}${tag.replace(/\D/g, '').slice(-6)}${(n += 1)}`;

describe('120.md §6 — writing-assistant dictionaries', () => {
  it('every route requires authentication', async () => {
    if (!up) return;
    for (const [method, path] of [
      ['GET', '/dictionary/personal'],
      ['POST', '/dictionary/personal'],
      ['DELETE', '/dictionary/personal/whatever'],
      ['GET', '/dictionary/project/whatever'],
      ['POST', '/dictionary/project/whatever'],
      ['DELETE', '/dictionary/project/whatever/entry'],
    ]) {
      const res = await hit(path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect([401, 403], `${method} ${path} → ${res.status}`).toContain(res.status);
    }
  });

  /* ── personal scope ──────────────────────────────────────────────────────── */

  it('adds a personal term, lists it, and preserves its capitalization exactly', async () => {
    if (!up || !cookie) return;
    const t = term('Upadacitinib');
    const add = await hit('/dictionary/personal', json(cookie, { term: t }));
    expect(add.status, `add → ${add.status}`).toBe(201);
    const entry = (await add.json()).entry;
    expect(entry.term).toBe(t);                 // NOT lowercased
    expect(entry.source).toBe('user');
    expect(entry.id).toBeTruthy();

    const list = await hit('/dictionary/personal', { headers: { cookie } });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.entries.some((e) => e.term === t)).toBe(true);
    expect(body.limit).toBeGreaterThan(0);
  });

  it('refuses a DUPLICATE with 409, case-insensitively, without a second row', async () => {
    if (!up || !cookie) return;
    const t = term('Risankizumab');
    expect((await hit('/dictionary/personal', json(cookie, { term: t }))).status).toBe(201);

    const same = await hit('/dictionary/personal', json(cookie, { term: t }));
    expect(same.status).toBe(409);
    // A different CASING of the same word is the same entry (termLower is the key).
    const cased = await hit('/dictionary/personal', json(cookie, { term: t.toUpperCase() }));
    expect(cased.status).toBe(409);

    const list = await (await hit('/dictionary/personal', { headers: { cookie } })).json();
    expect(list.entries.filter((e) => e.term.toLowerCase() === t.toLowerCase())).toHaveLength(1);
  });

  it('enforces the per-entry input caps with a readable refusal', async () => {
    if (!up || !cookie) return;
    const tooLong = await hit('/dictionary/personal', json(cookie, { term: 'x'.repeat(65) }));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toMatch(/64 characters/i);

    const sentence = await hit('/dictionary/personal', json(cookie, { term: 'not a single term' }));
    expect(sentence.status).toBe(400);

    const blank = await hit('/dictionary/personal', json(cookie, { term: '   ' }));
    expect(blank.status).toBe(400);

    const badCategory = await hit('/dictionary/personal', json(cookie, { term: term('Aterm'), category: 'nonsense' }));
    expect(badCategory.status).toBe(400);
  });

  it('reverses an accidental addition, and a second delete is an honest 404', async () => {
    if (!up || !cookie) return;
    const t = term('Mistake');
    const id = (await (await hit('/dictionary/personal', json(cookie, { term: t }))).json()).entry.id;

    const del = await hit(`/dictionary/personal/${id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(200);
    const list = await (await hit('/dictionary/personal', { headers: { cookie } })).json();
    expect(list.entries.some((e) => e.id === id)).toBe(false);

    expect((await hit(`/dictionary/personal/${id}`, { method: 'DELETE', headers: { cookie } })).status).toBe(404);
  });

  it('a personal dictionary is PRIVATE — another user cannot see or delete it', async () => {
    if (!up || !cookie || !otherCookie) return;
    const t = term('Privateterm');
    const id = (await (await hit('/dictionary/personal', json(cookie, { term: t }))).json()).entry.id;

    const theirs = await (await hit('/dictionary/personal', { headers: { cookie: otherCookie } })).json();
    expect(theirs.entries.some((e) => e.term === t)).toBe(false);
    expect((await hit(`/dictionary/personal/${id}`, { method: 'DELETE', headers: { cookie: otherCookie } })).status).toBe(404);
  });

  /* ── project scope ───────────────────────────────────────────────────────── */

  it('the project owner can add, list and remove a shared term', async () => {
    if (!up || !cookie || !projectId) return;
    const t = term('Sharedterm');
    const add = await hit(`/dictionary/project/${projectId}`, json(cookie, { term: t }));
    expect(add.status, `add → ${add.status}`).toBe(201);
    const entry = (await add.json()).entry;
    expect(entry.term).toBe(t);
    // §6 "Creator" — denormalised at the time, so a rename cannot rewrite history.
    expect(entry).toHaveProperty('addedById');

    const list = await (await hit(`/dictionary/project/${projectId}`, { headers: { cookie } })).json();
    expect(list.entries.some((e) => e.term === t)).toBe(true);
    expect(list.canEdit).toBe(true);
    expect(list.canCurate).toBe(true);   // the owner may remove anyone's entry

    expect((await hit(`/dictionary/project/${projectId}/${entry.id}`, { method: 'DELETE', headers: { cookie } })).status).toBe(200);
  });

  it('rejects a duplicate project term with 409', async () => {
    if (!up || !cookie || !projectId) return;
    const t = term('Dupterm');
    expect((await hit(`/dictionary/project/${projectId}`, json(cookie, { term: t }))).status).toBe(201);
    expect((await hit(`/dictionary/project/${projectId}`, json(cookie, { term: t.toLowerCase() }))).status).toBe(409);
  });

  it('a NON-MEMBER gets 404 on read and on write — existence is hidden, not refused', async () => {
    if (!up || !projectId || !otherCookie) return;
    expect((await hit(`/dictionary/project/${projectId}`, { headers: { cookie: otherCookie } })).status).toBe(404);
    expect((await hit(`/dictionary/project/${projectId}`, json(otherCookie, { term: term('Sneak') }))).status).toBe(404);
    expect((await hit(`/dictionary/project/${projectId}/anything`, { method: 'DELETE', headers: { cookie: otherCookie } })).status).toBe(404);
  });

  it('a project that does not exist is a 404, not a 500', async () => {
    if (!up || !cookie) return;
    expect((await hit('/dictionary/project/00000000-0000-0000-0000-000000000000', { headers: { cookie } })).status).toBe(404);
  });

  /* ── the preference blob rides the profile allowlist ─────────────────────── */

  it('stores the writingAssistant preference blob and returns it on GET /api/profile', async () => {
    if (!up || !cookie) return;
    const prefs = { enabled: true, variant: 'en-GB', mutedCategories: ['style'], mutedRules: [], showStyle: false };
    const put = await hit('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ writingAssistant: prefs }),
    });
    expect(put.status, `PUT → ${put.status}`).toBe(200);
    expect(JSON.parse((await put.json()).user.writingAssistant)).toEqual(prefs);

    const got = await (await hit('/profile', { headers: { cookie } })).json();
    expect(JSON.parse(got.user.writingAssistant).variant).toBe('en-GB');
  });

  it('refuses a preference blob over the 500-character allowlist cap', async () => {
    if (!up || !cookie) return;
    const huge = { enabled: true, variant: 'en-US', mutedRules: Array.from({ length: 60 }, (_, i) => `wa.some-long-rule-identifier-${i}`) };
    const res = await hit('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ writingAssistant: huge }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/i);
  });

  it('null clears the preference, so a user can reset the feature completely', async () => {
    if (!up || !cookie) return;
    const res = await hit('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ writingAssistant: null }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).user.writingAssistant).toBeNull();
  });
});
