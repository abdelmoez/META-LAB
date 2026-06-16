/**
 * oa-fulltext.test.js — integration tests for roadmap 1.4 endpoints
 * (match-pdfs + oa-retrieve). Requires the server on 127.0.0.1:3001; skips
 * silently otherwise. Deliberately avoids triggering a real OA provider call
 * (oa-retrieve is exercised only on its no-network guard paths), so running
 * this never hits an external API.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';
const SIFT = `${API}/screening/projects`;

async function serverUp() {
  try { const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; }
  catch { return false; }
}
async function loginOrRegister(email, password, name = 'OA Tester') {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (login.ok) return login.headers.get('set-cookie');
  const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) });
  return reg.headers.get('set-cookie');
}
async function api(method, url, cookie, body) {
  const opts = { method, headers: { Cookie: cookie } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(url, opts);
}

const RIS = `TY  - JOUR
TI  - A Trial With A Known DOI For Matching
AU  - Smith, John
PY  - 2023
DO  - 10.9999/oa.match.2023
ER  -`;

let up = false, cookie = null, pid = null, recordId = null;

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  cookie = await loginOrRegister(`oa_${Date.now()}@test.local`, 'Passw0rd!23');
  if (!cookie) return;
  const pr = await api('POST', SIFT, cookie, { title: 'OA Full-text Test' });
  if (!pr.ok) return;
  pid = (await pr.json()).id || (await pr.json())?.project?.id;
  if (!pid) return;
  await api('POST', `${SIFT}/${pid}/import`, cookie, { format: 'ris', content: RIS, filename: 'oa.ris' });
  const rr = await api('GET', `${SIFT}/${pid}/records`, cookie);
  if (rr.ok) {
    const data = await rr.json();
    const list = Array.isArray(data) ? data : (data.records || []);
    recordId = (list.find(r => (r.doi || '').includes('oa.match.2023')) || list[0] || {}).id || null;
  }
}, 30000);

describe('POST /match-pdfs', () => {
  it('suggests the record whose DOI matches the PDF filename', async () => {
    if (!up || !pid || !recordId) return;
    const res = await api('POST', `${SIFT}/${pid}/match-pdfs`, cookie, {
      pdfs: [{ filename: '10.9999_oa.match.2023.pdf' }],
    });
    expect(res.ok).toBe(true);
    const { suggestions } = await res.json();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].match).toBeTruthy();
    expect(suggestions[0].match.recordId).toBe(recordId);
    expect(suggestions[0].match.matchedBy).toBe('doi');
    expect(suggestions[0].match.disposition).toBe('auto');
  });

  it('returns a null match for a PDF that matches nothing', async () => {
    if (!up || !pid) return;
    const res = await api('POST', `${SIFT}/${pid}/match-pdfs`, cookie, { pdfs: [{ filename: 'unrelated-document.pdf' }] });
    expect(res.ok).toBe(true);
    const { suggestions } = await res.json();
    expect(suggestions[0].match).toBeNull();
  });
});

describe('POST /oa-retrieve (no-network guard paths)', () => {
  it('is wired and returns the summary contract for an empty target set', async () => {
    if (!up || !pid) return;
    // Target a non-existent record id → 0 records processed → no provider call.
    const res = await api('POST', `${SIFT}/${pid}/oa-retrieve`, cookie, { recordIds: ['does-not-exist'] });
    // 200 with the summary (feature enabled) — never triggers a network attach here.
    if (res.status === 403) return; // admin disabled the flag → also acceptable
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('attached');
    expect(body).toHaveProperty('processed');
    expect(body.processed).toBe(0);
  });

  it('404s for a non-existent project', async () => {
    if (!up) return;
    const res = await api('POST', `${SIFT}/nonexistent-pid/oa-retrieve`, cookie, {});
    expect(res.status).toBe(404);
  });
});
