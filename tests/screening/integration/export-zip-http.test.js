/**
 * export-zip-http.test.js — 97.md Phase 2: live-HTTP matrix for the ZIP export.
 * Requires the META·LAB server on http://127.0.0.1:3001 (same dev DB as this
 * process); when the server is down every test reports as SKIPPED via ctx.skip()
 * (repo pattern — screening-reset.test.js) — never a false green: this suite is
 * the only coverage of the ZIP permission matrix, so a silent pass would hide a
 * permission regression.
 *
 * Proves over real HTTP:
 *  - 401 unauthenticated / 404 outsider / 403 member-without-canExportRecords;
 *  - sync GET /export?format=zip answers 400 { useAsync } (no sync ZIP path);
 *  - POST /export/start format zip → 202 job → poll → sanitized
 *    `project-title-screening-export-YYYY-MM-DD.zip` filename + zero warnings;
 *  - download streams a valid application/zip with the Content-Disposition
 *    filename (binary-safe sink — jszip parses it with CRC checks);
 *  - job artifacts stay CREATOR-ONLY (another exporter-permitted member 404s).
 *
 * Tier note: the monthly project-export allowance gate binds to product tiers;
 * this suite temporarily disables tier ENFORCEMENT via the tierSettings site
 * setting (restored in afterAll) so it pins the screening permission chain—
 * which is what the ZIP path must reuse—rather than billing state.
 */
import { restoreShellEnv } from '../helpers/prismaEnvGuard.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

restoreShellEnv();
import JSZip from 'jszip';
import { prisma } from '../../../server/db/client.js';

const API = 'http://127.0.0.1:3001/api';
const SIFT = `${API}/screening/projects`;
const tag = `ziphttp_${Date.now()}`;

const RIS = `TY  - JOUR
AU  - Zipper, Alice
TI  - ZIP Export HTTP Trial One
PY  - 2023
JO  - Journal of Archives
DO  - 10.9999/zip.http.1
AB  - First body.
ER  -

TY  - JOUR
AU  - Zipper, Bob
TI  - ZIP Export HTTP Trial Two
PY  - 2022
JO  - Journal of Archives
DO  - 10.9999/zip.http.2
AB  - Second body.
ER  -`;

let up = false;
let cookieOwner = null, cookieMember = null, cookieOutsider = null;
let projectId = null, memberUserId = null, prevTierSettings;

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function loginOrRegister(email, password, name) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (login.ok) return login.headers.get('set-cookie');
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return reg.headers.get('set-cookie');
}

async function api(method, url, cookie, body) {
  const opts = { method, headers: cookie ? { Cookie: cookie } : {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts);
}

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;

  // Disable tier ENFORCEMENT for the duration (restored below) — this suite pins
  // the project permission chain, not billing.
  const row = await prisma.siteSetting.findUnique({ where: { key: 'tierSettings' } });
  prevTierSettings = row ? row.value : null;
  const merged = JSON.stringify({ ...(row ? JSON.parse(row.value || '{}') : {}), enforcementEnabled: false });
  await prisma.siteSetting.upsert({
    where: { key: 'tierSettings' },
    update: { value: merged },
    create: { key: 'tierSettings', value: merged },
  });

  cookieOwner = await loginOrRegister(`${tag}-owner@example.com`, 'ZipOwner1!pass', 'Zip Owner');
  cookieMember = await loginOrRegister(`${tag}-member@example.com`, 'ZipMember1!pass', 'Zip Member');
  cookieOutsider = await loginOrRegister(`${tag}-out@example.com`, 'ZipOut1!pass', 'Zip Outsider');

  const create = await api('POST', SIFT, cookieOwner, { title: `HTTP Zip: "Export" Project ${tag}` });
  const created = await create.json();
  projectId = created.project?.id || created.id;

  await api('POST', `${SIFT}/${projectId}/import`, cookieOwner, { format: 'ris', content: RIS, filename: 'zip-http.ris' });

  // Member row WITHOUT canExportRecords (direct DB — the HTTP member API applies
  // presets; the flag matrix itself is not under test here).
  const memberUser = await prisma.user.findUnique({ where: { email: `${tag}-member@example.com` } });
  memberUserId = memberUser?.id || null;
  if (memberUserId && projectId) {
    await prisma.screenProjectMember.create({
      data: {
        projectId, userId: memberUserId, name: 'Zip Member', email: `${tag}-member@example.com`,
        role: 'reviewer', status: 'active', canScreen: true, canExportRecords: false,
      },
    });
  }
}, 60000);

afterAll(async () => {
  try {
    if (prevTierSettings === null || prevTierSettings === undefined) {
      await prisma.siteSetting.deleteMany({ where: { key: 'tierSettings' } });
      if (prevTierSettings !== undefined && prevTierSettings !== null) {
        await prisma.siteSetting.create({ data: { key: 'tierSettings', value: prevTierSettings } });
      }
    } else {
      await prisma.siteSetting.upsert({
        where: { key: 'tierSettings' },
        update: { value: prevTierSettings },
        create: { key: 'tierSettings', value: prevTierSettings },
      });
    }
    if (projectId) {
      const jobs = await prisma.screenExportJob.findMany({ where: { projectId } });
      const fs = await import('node:fs');
      for (const j of jobs) { if (j.resultPath) { try { fs.unlinkSync(j.resultPath); } catch { /* gone */ } } }
      await prisma.screenExportJob.deleteMany({ where: { projectId } });
      if (cookieOwner) await api('DELETE', `${SIFT}/${projectId}`, cookieOwner);
    }
    const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    const ids = users.map(u => u.id);
    if (ids.length) {
      await prisma.screenProjectMember.deleteMany({ where: { userId: { in: ids } } });
      await prisma.screenProject.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  } catch { /* best-effort */ }
}, 60000);

describe('ZIP export permission matrix (HTTP)', () => {
  it('401 without authentication', async (ctx) => {
    if (!up) return ctx.skip();
    const res = await api('POST', `${SIFT}/${projectId}/export/start`, null, { format: 'zip' });
    expect(res.status).toBe(401);
  });

  it('404 for an outsider (existence hiding)', async (ctx) => {
    if (!up) return ctx.skip();
    const res = await api('POST', `${SIFT}/${projectId}/export/start`, cookieOutsider, { format: 'zip' });
    expect(res.status).toBe(404);
  });

  it('403 for an active member without canExportRecords', async (ctx) => {
    if (!up) return ctx.skip();
    const res = await api('POST', `${SIFT}/${projectId}/export/start`, cookieMember, { format: 'zip' });
    expect(res.status).toBe(403);
  });

  it('sync GET /export?format=zip refuses with useAsync (no sync ZIP path)', async (ctx) => {
    if (!up) return ctx.skip();
    const res = await api('GET', `${SIFT}/${projectId}/export?format=zip`, cookieOwner);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.useAsync).toBe(true);
    expect(body.startUrl).toContain('/export/start');
  });
});

describe('ZIP export job flow + creator-only artifacts (HTTP)', () => {
  it('start → poll → sanitized filename → valid application/zip download; other members 404', async (ctx) => {
    if (!up) return ctx.skip();

    const start = await api('POST', `${SIFT}/${projectId}/export/start`, cookieOwner, { format: 'zip' });
    expect(start.status).toBe(202);
    const { jobId } = await start.json();
    expect(jobId).toBeTruthy();

    let st = null;
    for (let i = 0; i < 120; i++) {
      const poll = await api('GET', `${SIFT}/${projectId}/export/jobs/${jobId}`, cookieOwner);
      expect(poll.status).toBe(200);
      st = await poll.json();
      if (st.status === 'failed') throw new Error(`export failed: ${st.error}`);
      if (st.ready) break;
      await new Promise(r => setTimeout(r, 500));
    }
    expect(st?.ready).toBe(true);
    expect(st.warningCount).toBe(0);
    expect(st.warnings).toEqual([]);
    // Sanitized filename: quotes/colons in the title collapse to dashes.
    expect(st.filename).toMatch(/^http-zip-export-project-ziphttp-\d+-screening-export-\d{4}-\d{2}-\d{2}\.zip$/);

    // Creator-only: another member — even WITH export permission — cannot poll or
    // download this job (404, existence hidden).
    await prisma.screenProjectMember.updateMany({
      where: { projectId, userId: memberUserId },
      data: { canExportRecords: true },
    });
    const foreignPoll = await api('GET', `${SIFT}/${projectId}/export/jobs/${jobId}`, cookieMember);
    expect(foreignPoll.status).toBe(404);
    const foreignDl = await api('GET', `${SIFT}/${projectId}/export/jobs/${jobId}/download`, cookieMember);
    expect(foreignDl.status).toBe(404);

    const dl = await api('GET', st.downloadUrl.startsWith('http') ? st.downloadUrl : `http://127.0.0.1:3001${st.downloadUrl}`, cookieOwner);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toContain('application/zip');
    expect(dl.headers.get('content-disposition')).toContain(st.filename);

    const zip = await JSZip.loadAsync(Buffer.from(await dl.arrayBuffer()), { checkCRC32: true });
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      'README.txt', 'references-and-screening-decisions.csv',
      'references.ris', 'screening-backup.json',
    ].sort()); // clean run → exactly the four members, no EXPORT-WARNINGS.txt

    const csv = await zip.file('references-and-screening-decisions.csv').async('string');
    expect(csv).toContain('ZIP Export HTTP Trial One');
    const backup = JSON.parse(await zip.file('screening-backup.json').async('string'));
    expect(backup.schemaVersion).toBe('1');
    expect(backup.records.length).toBe(2);
  }, 90000);
});
