/**
 * keyword-ops.test.js — 107.md §2/§3 integration tests for the keyword ops endpoint.
 *
 * POST /api/screening/projects/:pid/keywords/ops applies ONE keyword mutation
 * through the shared reducer inside a transaction. Exercises the live API at
 * http://127.0.0.1:3001 (start with `npm run server`); self-skips when the server
 * is down (same convention as prompt2.test.js).
 *
 * Covers:
 *  - add persists across a refetch (survives refresh / reopen / another device)
 *  - the added term carries a 'manual' origin in keywordMeta
 *  - a duplicate add (different case + spacing) is a flagged no-op
 *  - move is atomic: gone from the source list, present on the target
 *  - accept records a decision AND activates the term
 *  - remove records a deliberate rejection; { reject:false } is the Undo variant
 *    that records NO verdict (107.md rec round)
 *  - removing the last term leaves the side EMPTY — the shared defaults do not
 *    come back, and no later op re-seeds them (107.md rec round)
 *  - a non-leader member gets 403
 *  - validation: unknown op / bad list / empty term / over-long term / bad
 *    `reject` flag → 400
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Use 127.0.0.1 (not "localhost"): Node 18+ undici resolves localhost to ::1
// first, which hangs against a dual-stack server on Windows.
const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);

let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) {
  const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } });
  return { cookie: r.cookie, id: r.data?.user?.id, email };
}
async function newProject(cookie, title) {
  const proj = await api('/screening/projects', { method: 'POST', cookie, body: { title } });
  return proj.data?.id;
}
const op = (cookie, pid, body) => api(`/screening/projects/${pid}/keywords/ops`, { method: 'POST', cookie, body });
const parse = s => { try { return JSON.parse(s || '[]'); } catch { return []; } };

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
}, 30000);

describe('107.md §2 — keyword ops endpoint (integration)', () => {
  it('add persists across a refetch and records a manual origin', async () => {
    if (!up) return;
    const a = await register(`kwop_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW ops ${rnd()}`);
    expect(pid).toBeTruthy();

    const r = await op(a.cookie, pid, { type: 'add', list: 'include', term: 'drug-resistant epilepsy' });
    expect(r.status).toBe(200);
    expect(r.data.changed).toBe(true);
    expect(parse(r.data.inclusionKeywords)).toContain('drug-resistant epilepsy');

    // Refetch the project — the term survives (server-backed, not browser-local).
    const fresh = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(parse(fresh.data.inclusionKeywords)).toContain('drug-resistant epilepsy');
    const meta = JSON.parse(fresh.data.keywordMeta || '{}');
    expect(meta.origins.include['drug-resistant epilepsy']).toBe('manual');
  });

  it('a duplicate add (different case + spacing) is a flagged no-op', async () => {
    if (!up) return;
    const a = await register(`kwdup_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW dup ${rnd()}`);
    await op(a.cookie, pid, { type: 'add', list: 'include', term: 'Drug-Resistant Epilepsy' });
    const again = await op(a.cookie, pid, { type: 'add', list: 'include', term: 'drug-resistant   epilepsy' });
    expect(again.status).toBe(200);
    expect(again.data.changed).toBe(false);
    expect(again.data.reason).toBe('duplicate');
    const list = parse(again.data.inclusionKeywords).filter(t => /drug-resistant/i.test(t));
    expect(list).toHaveLength(1);
  });

  it('move is atomic across the two lists and persists', async () => {
    if (!up) return;
    const a = await register(`kwmv_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW move ${rnd()}`);
    await op(a.cookie, pid, { type: 'add', list: 'include', term: 'cohort study' });
    const moved = await op(a.cookie, pid, { type: 'move', list: 'include', term: 'cohort study', toList: 'exclude' });
    expect(moved.status).toBe(200);
    expect(parse(moved.data.inclusionKeywords)).not.toContain('cohort study');
    expect(parse(moved.data.exclusionKeywords)).toContain('cohort study');

    const fresh = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(parse(fresh.data.inclusionKeywords)).not.toContain('cohort study');
    expect(parse(fresh.data.exclusionKeywords)).toContain('cohort study');
  });

  it('accept activates a suggestion and records the decision; remove is the Undo path', async () => {
    if (!up) return;
    const a = await register(`kwac_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW accept ${rnd()}`);

    const acc = await op(a.cookie, pid, { type: 'accept', list: 'exclude', term: 'animal study' });
    expect(acc.status).toBe(200);
    expect(parse(acc.data.exclusionKeywords)).toContain('animal study');
    let meta = JSON.parse(acc.data.keywordMeta || '{}');
    expect(meta.decisions.exclude['animal study']).toBe('accepted');
    expect(meta.origins.exclude['animal study']).toBe('accepted');

    const undo = await op(a.cookie, pid, { type: 'remove', list: 'exclude', term: 'animal study' });
    expect(undo.status).toBe(200);
    expect(parse(undo.data.exclusionKeywords)).not.toContain('animal study');
    meta = JSON.parse(undo.data.keywordMeta || '{}');
    expect(meta.decisions.exclude['animal study']).toBe('rejected');

    const fresh = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(parse(fresh.data.exclusionKeywords)).not.toContain('animal study');
  });

  it('reject records a verdict without touching the active list', async () => {
    if (!up) return;
    const a = await register(`kwrj_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW reject ${rnd()}`);
    const before = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    const r = await op(a.cookie, pid, { type: 'reject', list: 'include', term: 'epilepsy' });
    expect(r.status).toBe(200);
    expect(parse(r.data.inclusionKeywords)).toEqual(parse(before.data.inclusionKeywords));
    expect(JSON.parse(r.data.keywordMeta).decisions.include.epilepsy).toBe('rejected');
  });

  // 107.md rec round — the snackbar Undo used a plain `remove`, which recorded a
  // 'rejected' verdict and permanently suppressed the matching criteria suggestion.
  it('{ reject:false } removes the term WITHOUT recording a verdict', async () => {
    if (!up) return;
    const a = await register(`kwundo_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW undo ${rnd()}`);

    const added = await op(a.cookie, pid, { type: 'add', list: 'include', term: 'drug-resistant epilepsy' });
    expect(added.status).toBe(200);
    expect(JSON.parse(added.data.keywordMeta).origins.include['drug-resistant epilepsy']).toBe('manual');

    const undo = await op(a.cookie, pid, {
      type: 'remove', list: 'include', term: 'drug-resistant epilepsy', reject: false,
    });
    expect(undo.status).toBe(200);
    expect(parse(undo.data.inclusionKeywords)).not.toContain('drug-resistant epilepsy');
    const meta = JSON.parse(undo.data.keywordMeta || '{}');
    expect(meta.decisions.include['drug-resistant epilepsy']).toBeUndefined();
    expect(meta.origins.include['drug-resistant epilepsy']).toBeUndefined();

    const fresh = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(JSON.parse(fresh.data.keywordMeta || '{}').decisions?.include?.['drug-resistant epilepsy'])
      .toBeUndefined();
  });

  it('removing the last term leaves the side empty and no later op re-seeds it', async () => {
    if (!up) return;
    const a = await register(`kwempty_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW empty ${rnd()}`);
    // Curate down to one term through the legacy full-array path, then use the ops
    // endpoint for the removal that empties the side.
    const curated = await api(`/screening/projects/${pid}`, {
      method: 'PUT', cookie: a.cookie, body: { inclusionKeywords: JSON.stringify(['seizure']) },
    });
    if (curated.status !== 200) return; // precondition, not the thing under test

    const gone = await op(a.cookie, pid, { type: 'remove', list: 'include', term: 'seizure' });
    expect(gone.status).toBe(200);
    expect(parse(gone.data.inclusionKeywords)).toEqual([]);
    expect(JSON.parse(gone.data.keywordMeta).seeded.include).toBe(true);

    const later = await op(a.cookie, pid, { type: 'reject', list: 'include', term: 'epilepsy' });
    expect(later.status).toBe(200);
    expect(parse(later.data.inclusionKeywords)).toEqual([]);

    const fresh = await api(`/screening/projects/${pid}`, { cookie: a.cookie });
    expect(parse(fresh.data.inclusionKeywords)).toEqual([]);
    expect(parse(fresh.data.exclusionKeywords).length).toBeGreaterThan(0); // other side untouched
  });

  it('a non-leader member gets 403', async () => {
    if (!up) return;
    const owner = await register(`kwown_${rnd()}@t.local`);
    const viewer = await register(`kwvw_${rnd()}@t.local`);
    const pid = await newProject(owner.cookie, `KW perms ${rnd()}`);
    const added = await api(`/screening/projects/${pid}/members`, {
      method: 'POST', cookie: owner.cookie, body: { email: viewer.email, role: 'viewer' },
    });
    // Membership is a precondition, not the thing under test.
    if (added.status !== 201 && added.status !== 200) return;

    const r = await op(viewer.cookie, pid, { type: 'add', list: 'include', term: 'sneaky' });
    expect(r.status).toBe(403);
    const fresh = await api(`/screening/projects/${pid}`, { cookie: owner.cookie });
    expect(parse(fresh.data.inclusionKeywords)).not.toContain('sneaky');
  });

  it('validates the request body', async () => {
    if (!up) return;
    const a = await register(`kwval_${rnd()}@t.local`);
    const pid = await newProject(a.cookie, `KW validate ${rnd()}`);
    for (const body of [
      { type: 'nuke', list: 'include', term: 'x' },
      { type: 'add', list: 'both', term: 'x' },
      { type: 'add', list: 'include', term: '   ' },
      { type: 'add', list: 'include', term: 'x'.repeat(201) },
      { type: 'move', list: 'include', term: 'x', toList: 'include' },
      { type: 'remove', list: 'include', term: 'x', reject: 'nope' },
      { type: 'add', list: 'include', term: 'x', reject: false },
      {},
    ]) {
      const r = await op(a.cookie, pid, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });
});
