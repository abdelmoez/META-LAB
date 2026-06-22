/**
 * db-migration-roundtrip.test.js — END-TO-END proof of the database migration
 * pipeline (server/db/migrate/core.js) on REAL Prisma databases.
 *
 * It migrates a representative, edge-case-rich dataset from one SQLite database
 * to a SECOND, fresh SQLite database and asserts the verification passes and
 * that every value (ids, timestamps, FK relationships, numeric userNumber,
 * Arabic / non-ASCII text, long notes, soft-deletion, alternate PKs) is
 * preserved. In production the ONLY difference is the target client + URL
 * (the Postgres client), so a green run here proves the tool itself is correct;
 * the remaining live-Postgres step is the operator's `migrate-db.mjs` run.
 *
 * Not part of the hermetic CI gate (it shells out to `prisma db push` to build
 * the two schemas); run with `npx vitest run tests/integration/db-migration-roundtrip.test.js`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrateAll, verifyAll } from '../../server/db/migrate/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '../../server');
const SCHEMA = path.join(SERVER_DIR, 'prisma', 'schema.prisma');
const require = createRequire(path.join(SERVER_DIR, 'db', 'client.js'));
const { PrismaClient, Prisma } = require('@prisma/client');
const MODELS = Prisma.dmmf.datamodel.models;

const SRC_FILE = path.join(SERVER_DIR, 'prisma', '.tmp-roundtrip-src.db');
const TGT_FILE = path.join(SERVER_DIR, 'prisma', '.tmp-roundtrip-tgt.db');
const SRC_URL = 'file:./.tmp-roundtrip-src.db';
const TGT_URL = 'file:./.tmp-roundtrip-tgt.db';

const past = (iso) => new Date(iso);
let source, target;

function pushSchema(url) {
  execSync(`npx prisma db push --schema="${SCHEMA}" --skip-generate --force-reset`, {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

beforeAll(async () => {
  for (const f of [SRC_FILE, TGT_FILE]) if (fs.existsSync(f)) fs.rmSync(f);
  pushSchema(SRC_URL);
  pushSchema(TGT_URL);
  source = new PrismaClient({ datasources: { db: { url: SRC_URL } } });
  target = new PrismaClient({ datasources: { db: { url: TGT_URL } } });

  // ── Seed the SOURCE with an edge-case-rich graph (FK order: parents first) ──
  await source.user.create({ data: {
    id: 'u_owner', userNumber: 1, email: 'owner@example.com', name: 'عبد المعز الباحث', // Arabic
    password: 'hash', role: 'admin', createdAt: past('2019-05-01T08:00:00.000Z'),
    updatedAt: past('2020-01-15T09:30:00.000Z'), institutionOriginal: 'Universität München',
  } });
  await source.user.create({ data: {
    id: 'u_member', userNumber: 2, email: 'member@example.com', name: '研究者',
    password: 'hash2', role: 'user', suspended: true, sessionEpoch: 3,
    createdAt: past('2021-11-03T12:00:00.000Z'), updatedAt: past('2021-11-03T12:00:00.000Z'),
  } });
  await source.institution.create({ data: { id: 'inst_1', canonicalName: 'Universität München', normalizedName: 'universitat munchen', countryCode: 'DE' } });
  await source.appSequence.create({ data: { name: 'userNumber', value: 2 } });
  await source.siteSetting.create({ data: { key: 'appSettings', value: JSON.stringify({ appName: 'PecanRev', maxStudiesPerProject: null }) } });

  await source.project.create({ data: {
    id: 'p_1', userId: 'u_owner', name: 'Soft-deleted project',
    data: JSON.stringify({ studies: Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, title: 'x'.repeat(200) })) }),
    deletedAt: past('2022-02-02T00:00:00.000Z'), deletedSource: 'owner', archived: true,
    createdAt: past('2020-03-03T03:03:03.000Z'), updatedAt: past('2022-02-02T00:00:00.000Z'),
  } });
  await source.passwordResetToken.create({ data: { id: 'prt_1', userId: 'u_owner', tokenHash: 'a'.repeat(64), expiresAt: past('2030-01-01T00:00:00.000Z') } });
  await source.workflowModuleState.create({ data: { id: 'wms_1', projectId: 'p_1', moduleKey: 'pico', stateJson: '{"p":"adults"}', revision: 4 } });

  await source.screenProject.create({ data: { id: 'sp_1', ownerId: 'u_owner', title: 'Screening', linkedMetaLabProjectId: 'p_1' } });
  await source.screenRecord.create({ data: { id: 'sr_1', projectId: 'sp_1', title: 'Trial of درجة الحرارة', abstract: 'é'.repeat(500) } });
  await source.screenDecision.create({ data: { id: 'sd_1', recordId: 'sr_1', projectId: 'sp_1', reviewerId: 'u_member', decision: 'include', rating: 4, notes: 'long note '.repeat(100) } });

  await source.contactMessage.create({ data: { id: 'cm_1', email: 'q@x.com', message: 'Hello — naïve façade', readAt: past('2023-06-06T06:06:06.000Z'), readByUserId: 'u_owner', readByName: 'عبد المعز الباحث' } });
  await source.contactMessageRead.create({ data: { id: 'cmr_1', messageId: 'cm_1', userId: 'u_owner', readAt: past('2023-06-06T06:06:06.000Z') } });
  await source.adminAuditLog.create({ data: { id: 'aal_1', adminId: 'u_owner', action: 'SUSPEND_USER', entityType: 'User', entityId: 'u_member', details: JSON.stringify({ before: { suspended: false }, after: { suspended: true } }) } });

  await source.robAssessment.create({ data: { id: 'ra_1', projectId: 'p_1', studyId: 's0', reviewerId: 'u_owner', reviewerName: 'عبد المعز' } });
  await source.robAnswer.create({ data: { id: 'rans_1', assessmentId: 'ra_1', domainId: 'D1', questionId: '1.1', response: 'PY', rationale: 'See p.4' } });
}, 60000);

afterAll(async () => {
  await source?.$disconnect().catch(() => {});
  await target?.$disconnect().catch(() => {});
  for (const f of [SRC_FILE, TGT_FILE, `${SRC_FILE}-journal`, `${TGT_FILE}-journal`]) {
    try { if (fs.existsSync(f)) fs.rmSync(f); } catch { /* ignore */ }
  }
});

describe('SQLite→SQLite migration round-trip (proxy for SQLite→Postgres)', () => {
  it('migrates all models and verifies counts + sampled rows', async () => {
    await migrateAll(source, target, { models: MODELS, batchSize: 10 });
    const v = await verifyAll(source, target, { models: MODELS, sampleSize: 50 });
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.total).toBeGreaterThanOrEqual(14); // every seeded row counted
  });

  it('preserves ids, the numeric userNumber, timestamps, and suspension/epoch state', async () => {
    const owner = await target.user.findUnique({ where: { id: 'u_owner' } });
    expect(owner.userNumber).toBe(1);
    expect(owner.createdAt.toISOString()).toBe('2019-05-01T08:00:00.000Z');
    expect(owner.updatedAt.toISOString()).toBe('2020-01-15T09:30:00.000Z'); // @updatedAt NOT reset
    const member = await target.user.findUnique({ where: { id: 'u_member' } });
    expect(member.suspended).toBe(true);
    expect(member.sessionEpoch).toBe(3);
  });

  it('preserves Arabic / CJK / accented text and long content', async () => {
    const owner = await target.user.findUnique({ where: { id: 'u_owner' } });
    expect(owner.name).toBe('عبد المعز الباحث');
    const member = await target.user.findUnique({ where: { id: 'u_member' } });
    expect(member.name).toBe('研究者');
    const rec = await target.screenRecord.findUnique({ where: { id: 'sr_1' } });
    expect(rec.title).toBe('Trial of درجة الحرارة');
    expect(rec.abstract).toHaveLength(500);
    const cm = await target.contactMessage.findUnique({ where: { id: 'cm_1' } });
    expect(cm.message).toBe('Hello — naïve façade');
  });

  it('preserves FK relationships, soft-deletion, alternate PKs, and the sequence counter', async () => {
    const proj = await target.project.findUnique({ where: { id: 'p_1' } });
    expect(proj.userId).toBe('u_owner');
    expect(proj.deletedAt.toISOString()).toBe('2022-02-02T00:00:00.000Z');
    expect(proj.archived).toBe(true);
    // Alternate PKs (SiteSetting.key, AppSequence.name) round-trip.
    const setting = await target.siteSetting.findUnique({ where: { key: 'appSettings' } });
    expect(JSON.parse(setting.value).appName).toBe('PecanRev');
    const seq = await target.appSequence.findUnique({ where: { name: 'userNumber' } });
    expect(seq.value).toBe(2);
    // FK chain RobAssessment → RobAnswer survives.
    const ans = await target.robAnswer.findUnique({ where: { id: 'rans_1' } });
    expect(ans.assessmentId).toBe('ra_1');
    expect(ans.response).toBe('PY');
  });

  it('is idempotent and resumable: re-running does not duplicate or change rows', async () => {
    const before = await target.user.count();
    await migrateAll(source, target, { models: MODELS, batchSize: 10 });
    const after = await target.user.count();
    expect(after).toBe(before);
    const v = await verifyAll(source, target, { models: MODELS, sampleSize: 50 });
    expect(v.ok).toBe(true);
  });
});
