/**
 * prompt50-import.test.js — WS2: durable async import + large imports + .txt
 * format detection. Requires the API on :3001 (skips when down).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function register(email) { const r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!', name: 'imp' }) }); return cookieFrom(r); }

const risRecords = (n, tag = 'r') => Array.from({ length: n }, (_, i) =>
  `TY  - JOUR\nTI  - ${tag} study ${i}\nAU  - Author ${i}\nPY  - 2020\nDO  - 10.1000/${tag}${i}\nER  - `).join('\n');

async function newProject(cookie, title) {
  const p = await api('/screening/projects', { method: 'POST', cookie, body: { title } });
  return p.data.id;
}
async function poll(cookie, pid, jobId, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const j = await api(`/screening/projects/${pid}/import/jobs/${jobId}`, { cookie });
    if (['completed', 'completed_with_warnings', 'failed'].includes(j.data.status)) return j.data;
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

beforeAll(async () => { try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; } });

describe('prompt50 WS2 — durable async screening import', () => {
  it('start → poll → completed; records imported; idempotent on the same file', async () => {
    if (!up) return;
    const cookie = await register(`imp_${rnd()}@t.local`);
    const pid = await newProject(cookie, `Import ${rnd()}`);
    const content = risRecords(300);

    const started = await api(`/screening/projects/${pid}/import/start`, { method: 'POST', cookie, body: { format: 'auto', content, filename: 'refs.ris' } });
    expect(started.status).toBe(202);
    expect(started.data.jobId).toBeTruthy();

    const job = await poll(cookie, pid, started.data.jobId);
    expect(job).toBeTruthy();
    expect(job.status).toBe('completed');
    expect(job.importedRecords).toBe(300);
    expect(job.detectedFormat).toBe('RIS');
    expect(job.progress).toBe(100);

    // Idempotency: the same file again → 409 duplicate_import (no double insert).
    const again = await api(`/screening/projects/${pid}/import/start`, { method: 'POST', cookie, body: { format: 'auto', content, filename: 'refs.ris' } });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('duplicate_import');

    // Force re-import → a new job runs, but record-level dedupe keeps 0 new.
    const forced = await api(`/screening/projects/${pid}/import/start`, { method: 'POST', cookie, body: { format: 'auto', content, filename: 'refs.ris', force: true } });
    expect(forced.status).toBe(202);
    const forcedJob = await poll(cookie, pid, forced.data.jobId);
    expect(forcedJob.status === 'completed' || forcedJob.status === 'completed_with_warnings').toBe(true);
    expect(forcedJob.importedRecords).toBe(0);
    expect(forcedJob.duplicateRecords).toBe(300);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie });
  });

  it('a .txt file with PubMed markers is detected and imported as PubMed', async () => {
    if (!up) return;
    const cookie = await register(`imp2_${rnd()}@t.local`);
    const pid = await newProject(cookie, `Import txt ${rnd()}`);
    const pubmed = `PMID- 30000001\nTI  - Sepsis prediction with ML\nFAU - Doe, Jane\nDP  - 2021\nAB  - abstract one\n\nPMID- 30000002\nTI  - Network meta-analysis primer\nFAU - Roe, R\nDP  - 2019\nAB  - abstract two\n`;
    const started = await api(`/screening/projects/${pid}/import/start`, { method: 'POST', cookie, body: { format: 'auto', content: pubmed, filename: 'pubmed_result.txt' } });
    expect(started.status).toBe(202);
    const job = await poll(cookie, pid, started.data.jobId);
    expect(job.status).toBe('completed');
    expect(job.importedRecords).toBe(2);
    expect(job.detectedFormat).toMatch(/PubMed|MEDLINE/);
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie });
  });

  it('the synchronous endpoint no longer caps at 5000 records', async () => {
    if (!up) return;
    const cookie = await register(`imp3_${rnd()}@t.local`);
    const pid = await newProject(cookie, `Import big ${rnd()}`);
    const content = risRecords(6000, 'big');   // above the OLD 5000 hard cap
    const res = await api(`/screening/projects/${pid}/import`, { method: 'POST', cookie, body: { format: 'auto', content, filename: 'big.ris' } });
    expect(res.status).toBe(200);
    expect(res.data.imported).toBe(6000);
    expect(res.data.format).toBe('RIS');
    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie });
  }, 30000);
});
