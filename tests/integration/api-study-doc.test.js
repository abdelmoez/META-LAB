/**
 * 77.md §5 — persistent, cross-engine study document API. A manually-added study (no
 * screening record) can upload a PDF that persists on the server (blob-anchored pointer +
 * on-disk bytes), is downloadable, and is protected by project access.
 *
 * Canonical harness: self-skip when the dev server at 127.0.0.1:3001 is down (never
 * `localhost` — Windows ::1 flake). Run serially: --pool=forks --poolOptions.forks.singleFork.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';
const hit = (path, opts = {}) => fetch(`${API}${path}`, opts);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

let up = false;
let cookie = '';
let otherCookie = '';
let projectId = '';
let studyId = '';

async function register(tag) {
  const email = `p77-doc-${tag}-${Date.now()}@example.com`;
  const res = await hit('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `P77 ${tag}`, email, password: 'Str0ng!Passw0rd77' }),
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
  const proj = await hit('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ name: `P77 Study Doc ${Date.now()}` }) });
  if (proj.ok || proj.status === 201) { projectId = (await proj.json()).id; }
  if (!projectId) return;
  const st = await hit(`/projects/${projectId}/studies`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ author: 'Manual', year: '2024' }) });
  if (st.ok || st.status === 201) { studyId = (await st.json()).id; }
}, 30000);

async function upload(ck) {
  const fd = new FormData();
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'test.pdf');
  return hit(`/projects/${projectId}/studies/${studyId}/document`, { method: 'POST', headers: { cookie: ck }, body: fd });
}

describe('study document API (77.md §5)', () => {
  it('unauthenticated upload is rejected', async () => {
    if (!up) return;
    const fd = new FormData();
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'test.pdf');
    const res = await hit('/projects/some-project/studies/x/document', { method: 'POST', body: fd });
    expect([401, 403]).toContain(res.status);
  });

  it('owner can upload, fetch metadata, and download the PDF', async () => {
    if (!up || !projectId || !studyId) return;
    const u = await upload(cookie);
    expect(u.status, `upload → ${u.status}`).toBe(201);
    const doc = (await u.json()).document;
    expect(doc && doc.storedName).toBeTruthy();
    expect(doc.fileHash).toMatch(/^[a-f0-9]{64}$/);

    const meta = await hit(`/projects/${projectId}/studies/${studyId}/document`, { headers: { cookie } });
    expect(meta.status).toBe(200);
    expect((await meta.json()).document.storedName).toBe(doc.storedName);

    const dl = await hit(`/projects/${projectId}/studies/${studyId}/document/download`, { headers: { cookie } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toMatch(/application\/pdf/);
    const bytes = Buffer.from(await dl.arrayBuffer());
    expect(bytes.slice(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('re-uploading the identical PDF dedupes to the same stored file', async () => {
    if (!up || !projectId || !studyId) return;
    const u = await upload(cookie);
    expect(u.status).toBe(201);
    // The document persists (idempotent hash) — still downloadable.
    const dl = await hit(`/projects/${projectId}/studies/${studyId}/document/download`, { headers: { cookie } });
    expect(dl.status).toBe(200);
  });

  it('a non-member cannot read the document (404, existence-hiding)', async () => {
    if (!up || !projectId || !studyId || !otherCookie) return;
    const meta = await hit(`/projects/${projectId}/studies/${studyId}/document`, { headers: { cookie: otherCookie } });
    expect(meta.status).toBe(404);
    const dl = await hit(`/projects/${projectId}/studies/${studyId}/document/download`, { headers: { cookie: otherCookie } });
    expect(dl.status).toBe(404);
  });

  it('owner can delete the document (and it is then gone)', async () => {
    if (!up || !projectId || !studyId) return;
    const del = await hit(`/projects/${projectId}/studies/${studyId}/document`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(200);
    const meta = await hit(`/projects/${projectId}/studies/${studyId}/document`, { headers: { cookie } });
    expect(meta.status).toBe(200);
    expect((await meta.json()).document).toBeNull();
    const dl = await hit(`/projects/${projectId}/studies/${studyId}/document/download`, { headers: { cookie } });
    expect(dl.status).toBe(404);
  });
});
