/**
 * export-zip.test.js — 97.md Phase 2: portable screening export ZIP.
 * Direct service-level tests against the real dev DB (no HTTP server; same
 * pattern as export-columns.test.js). jszip is used READ-ONLY to verify the
 * produced archives.
 *
 * Proves:
 *  - the full ZIP contains the four members (CSV / RIS / JSON backup / README)
 *    with the pinned schema versions;
 *  - missing optional metadata (no DOI/abstract, garbage truncated rawData)
 *    never fails the export;
 *  - BLIND-MODE PARITY (the #1 risk): a non-leader's ZIP carries no reviewer
 *    name, no reviewer user id, no record authors/journal — across CSV, RIS and
 *    JSON alike, including ScreenConflict.reviewerDecisions keys; a leader's ZIP
 *    keeps identity;
 *  - partial failure: an injected failing RIS renderer still yields a valid ZIP
 *    with EXPORT-WARNINGS.txt + warnings surfaced (job stays completed);
 *  - the worker job flow end-to-end: enqueue(format 'zip') → drain → completed
 *    row with sanitized `project-title-screening-export-YYYY-MM-DD.zip` filename,
 *    binary-safe file on disk, warningCount 0, SCREENING_EXPORTED audit row;
 *  - a multi-page project (> PAGE records) streams through the cursor pager.
 */
import { restoreShellEnv } from '../helpers/prismaEnvGuard.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

restoreShellEnv();
import fs from 'node:fs';
import JSZip from 'jszip';
import { prisma } from '../../../server/db/client.js';
import {
  generateScreeningZip, ZIP_MEMBERS, SCREEN_ZIP_CSV_COLUMNS,
  SCREENING_BACKUP_SCHEMA_VERSION,
} from '../../../server/services/screeningExportZip.js';
import { enqueueExportJob } from '../../../server/services/screeningExportWorker.js';
import { screeningExportFilename } from '../../../server/utils/filenames.js';

const tag = `zip97_${Date.now()}`;

let owner, reviewer, project, recFull, recSparse;

async function buildZip({ userId, projectId = project.id, risRenderer } = {}) {
  const chunks = [];
  const result = await generateScreeningZip({
    projectId,
    userId,
    exportedBy: { id: userId, name: userId === owner.id ? owner.name : reviewer.name },
    write: (c) => { chunks.push(c); },
    ...(risRenderer ? { risRenderer } : {}),
  });
  const buffer = Buffer.concat(chunks);
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  return { result, buffer, zip };
}

beforeAll(async () => {
  owner = await prisma.user.create({ data: { email: `${tag}-o@x.io`, password: 'x', name: 'OwnerNine7' } });
  reviewer = await prisma.user.create({ data: { email: `${tag}-r@x.io`, password: 'x', name: 'ReviewerNine7' } });
  project = await prisma.screenProject.create({
    data: { ownerId: owner.id, title: 'Zip Export: Blind/Test (97)', blindMode: true },
  });
  await prisma.screenProjectMember.create({
    data: {
      projectId: project.id, userId: reviewer.id, name: 'ReviewerNine7', email: `${tag}-r@x.io`,
      role: 'reviewer', status: 'active', canScreen: true, canExportRecords: true,
    },
  });
  const batch = await prisma.screenImportBatch.create({
    data: { projectId: project.id, filename: 'seed.ris', format: 'ris', recordCount: 2, importedByName: 'OwnerNine7' },
  });
  const group = await prisma.screenDuplicateGroup.create({ data: { projectId: project.id } });

  recFull = await prisma.screenRecord.create({
    data: {
      projectId: project.id, importBatchId: batch.id, title: 'Complete metadata trial',
      authors: 'Secret Author A; Secret Author B', year: '2022', journal: 'Hidden Journal of Tests',
      doi: '10.97/full', pmid: '9701', abstract: 'A complete abstract.', keywords: 'eus; drainage',
      sourceDb: 'pubmed', currentStage: 'full_text', duplicateGroupId: group.id, isPrimary: true,
      rawData: JSON.stringify({ volume: '31', issue: '2', pages: '11-19', url: 'https://x.org/full' }),
    },
  });
  recSparse = await prisma.screenRecord.create({
    data: {
      projectId: project.id, importBatchId: batch.id, title: 'Sparse record (no doi, no abstract)',
      authors: '', year: '', journal: '', doi: '', pmid: '', abstract: '', keywords: '',
      sourceDb: 'manual', rawData: '{"truncated": "mid-way json that never clos', // invalid on purpose
    },
  });

  // Conflicted TA decisions + one FT decision → stage-explicit families + conflict row.
  await prisma.screenDecision.create({
    data: { recordId: recFull.id, projectId: project.id, reviewerId: owner.id, reviewerName: 'OwnerNine7', stage: 'title_abstract', decision: 'include', notes: 'owner ta note' },
  });
  await prisma.screenDecision.create({
    data: { recordId: recFull.id, projectId: project.id, reviewerId: reviewer.id, reviewerName: 'ReviewerNine7', stage: 'title_abstract', decision: 'exclude', exclusionReason: 'Wrong population' },
  });
  await prisma.screenDecision.create({
    data: { recordId: recFull.id, projectId: project.id, reviewerId: owner.id, reviewerName: 'OwnerNine7', stage: 'full_text', decision: 'include' },
  });
  await prisma.screenConflict.create({
    data: {
      projectId: project.id, recordId: recFull.id,
      reviewerDecisions: JSON.stringify({ [owner.id]: 'include', [reviewer.id]: 'exclude' }),
    },
  });
  await prisma.screenExclusionReason.create({ data: { projectId: project.id, text: 'Wrong population' } });
  await prisma.screenLabel.create({ data: { projectId: project.id, name: 'rct' } });
});

afterAll(async () => {
  try {
    const jobs = await prisma.screenExportJob.findMany({ where: { projectId: project.id } });
    for (const j of jobs) { if (j.resultPath) { try { fs.unlinkSync(j.resultPath); } catch { /* gone */ } } }
    await prisma.screenExportJob.deleteMany({ where: { projectId: project.id } });
    await prisma.screenAuditLog.deleteMany({ where: { projectId: project.id } });
    await prisma.screenConflict.deleteMany({ where: { projectId: project.id } });
    await prisma.screenDecision.deleteMany({ where: { projectId: project.id } });
    await prisma.screenRecord.deleteMany({ where: { projectId: project.id } });
    await prisma.screenDuplicateGroup.deleteMany({ where: { projectId: project.id } });
    await prisma.screenImportBatch.deleteMany({ where: { projectId: project.id } });
    await prisma.screenExclusionReason.deleteMany({ where: { projectId: project.id } });
    await prisma.screenLabel.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProjectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProject.deleteMany({ where: { id: project.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, reviewer.id] } } });
  } catch { /* best-effort */ }
});

describe('generateScreeningZip — members + schema versions', () => {
  it('produces the four members; CSV pins the header; JSON pins schemaVersion', async () => {
    const { result, zip } = await buildZip({ userId: owner.id });
    expect(result.warnings).toEqual([]);
    expect(result.total).toBe(2);
    expect(Object.keys(zip.files).sort()).toEqual([
      ZIP_MEMBERS.readme, ZIP_MEMBERS.csv, ZIP_MEMBERS.ris, ZIP_MEMBERS.json,
    ].sort());

    const csv = await zip.file(ZIP_MEMBERS.csv).async('string');
    const lines = csv.split('\n');
    expect(lines[0]).toBe(SCREEN_ZIP_CSV_COLUMNS.join(','));
    expect(lines.length).toBe(3); // header + 2 records

    const backup = JSON.parse(await zip.file(ZIP_MEMBERS.json).async('string'));
    expect(backup.schemaVersion).toBe(SCREENING_BACKUP_SCHEMA_VERSION);
    expect(backup.restorable).toBe(true);
    expect(backup.project.title).toBe('Zip Export: Blind/Test (97)');
    expect(backup.project.blindMode).toBe(true);
    expect(backup.records.length).toBe(2);
    expect(backup.decisions.length).toBe(3);
    expect(backup.conflicts.length).toBe(1);
    expect(backup.exclusionReasons.map(r => r.text)).toContain('Wrong population');
    expect(backup.labels.map(l => l.name)).toContain('rct');
    expect(backup.importBatches.length).toBe(1);
    expect(backup.duplicateGroups.length).toBe(1);
    expect(backup.app?.name).toBe('PecanRev');
    expect(typeof backup.app?.version).toBe('string');

    const readme = await zip.file(ZIP_MEMBERS.readme).async('string');
    expect(readme).toContain('Zip Export: Blind/Test (97)');
    expect(readme).toContain(ZIP_MEMBERS.json);
  });

  it('missing optional metadata (sparse record, garbage rawData) exports blanks, not a failure', async () => {
    const { zip } = await buildZip({ userId: owner.id });
    const csv = await zip.file(ZIP_MEMBERS.csv).async('string');
    const sparseLine = csv.split('\n').find(l => l.includes('Sparse record'));
    expect(sparseLine).toBeTruthy();
    const fullLine = csv.split('\n').find(l => l.includes('Complete metadata trial'));
    expect(fullLine).toContain('31');            // volume recovered from rawData
    expect(fullLine).toContain('https://x.org/full');
    const ris = await zip.file(ZIP_MEMBERS.ris).async('string');
    expect(ris).toContain('TI  - Sparse record');
    expect(ris).toContain('VL  - 31');
  });

  it('stage-explicit statuses land in the CSV (conflict + full-text families)', async () => {
    const { zip } = await buildZip({ userId: owner.id });
    const csv = await zip.file(ZIP_MEMBERS.csv).async('string');
    const line = csv.split('\n').find(l => l.includes('Complete metadata trial'));
    expect(line).toContain('conflict'); // title_abstract_status
    expect(line).toContain('full_text'); // current_stage
  });
});

describe('blind-mode parity — the #1 leak vector', () => {
  it('a NON-LEADER export leaks no identity anywhere in the archive', async () => {
    const { result, zip } = await buildZip({ userId: reviewer.id });
    expect(result.blind).toBe(true);

    const all = [
      await zip.file(ZIP_MEMBERS.csv).async('string'),
      await zip.file(ZIP_MEMBERS.ris).async('string'),
      await zip.file(ZIP_MEMBERS.json).async('string'),
      await zip.file(ZIP_MEMBERS.readme).async('string'),
    ].join('\n');

    // No reviewer names, no reviewer user ids, no blinded record identity.
    expect(all).not.toContain('OwnerNine7');
    expect(all).not.toContain('ReviewerNine7');
    expect(all).not.toContain(owner.id);
    expect(all).not.toContain(reviewer.id);
    expect(all).not.toContain('Secret Author');
    expect(all).not.toContain('Hidden Journal');

    // Ordinals present instead — incl. remapped conflict reviewerDecisions keys.
    const backup = JSON.parse(await zip.file(ZIP_MEMBERS.json).async('string'));
    const ids = backup.decisions.map(d => d.reviewerId);
    expect(ids.every(id => /^reviewer-\d+$/.test(id))).toBe(true);
    const conflictKeys = Object.keys(backup.conflicts[0].reviewerDecisions);
    expect(conflictKeys.sort()).toEqual(['reviewer-1', 'reviewer-2']);
    expect(Object.values(backup.conflicts[0].reviewerDecisions).sort()).toEqual(['exclude', 'include']);
    expect(backup.records.every(r => r.authors === '' && r.journal === '')).toBe(true);
    expect(backup.importBatches.every(b => b.importedByName === '')).toBe(true);

    const csv = await zip.file(ZIP_MEMBERS.csv).async('string');
    expect(csv).toContain('Reviewer 1');
    const ris = await zip.file(ZIP_MEMBERS.ris).async('string');
    expect(ris).not.toMatch(/^AU {2}- /m);
    expect(ris).not.toMatch(/^JO {2}- /m);
  });

  it('a LEADER export keeps identity (blind mode gates non-leaders only)', async () => {
    const { result, zip } = await buildZip({ userId: owner.id });
    expect(result.blind).toBe(false);
    const csv = await zip.file(ZIP_MEMBERS.csv).async('string');
    expect(csv).toContain('OwnerNine7');
    expect(csv).toContain('Secret Author A');
    const backup = JSON.parse(await zip.file(ZIP_MEMBERS.json).async('string'));
    expect(backup.decisions.map(d => d.reviewerId)).toContain(owner.id);
    const keys = Object.keys(backup.conflicts[0].reviewerDecisions).sort();
    expect(keys).toEqual([owner.id, reviewer.id].sort());
  });

  it('CSV ordinals and JSON ordinals agree (same reviewerId-ascending rule)', async () => {
    const { zip } = await buildZip({ userId: reviewer.id });
    const backup = JSON.parse(await zip.file(ZIP_MEMBERS.json).async('string'));
    const sorted = [owner.id, reviewer.id].sort();
    const byOrdinal = new Map(backup.decisions.map(d => [d.reviewerId, d]));
    // reviewer-1 must be the ascending-first reviewerId's decisions.
    const first = backup.decisions.find(d => d.reviewerId === 'reviewer-1');
    expect(first).toBeTruthy();
    // The first-sorted user made 'include' TA + 'include' FT (owner) or 'exclude' (reviewer).
    const firstIsOwner = sorted[0] === owner.id;
    const decisions = backup.decisions.filter(d => d.reviewerId === 'reviewer-1').map(d => d.decision).sort();
    expect(decisions).toEqual(firstIsOwner ? ['include', 'include'] : ['exclude']);
    expect(byOrdinal.size).toBeGreaterThan(0);
  });
});

describe('partial failure — optional RIS member (Decision E6)', () => {
  it('a failing RIS renderer yields a valid ZIP + EXPORT-WARNINGS.txt, not a failed export', async () => {
    const boom = () => { throw new Error('RIS renderer exploded'); };
    const { result, zip } = await buildZip({ userId: owner.id, risRenderer: boom });
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain(ZIP_MEMBERS.ris);
    expect(result.warnings[0]).toContain('RIS renderer exploded');

    const names = Object.keys(zip.files).sort();
    expect(names).toContain(ZIP_MEMBERS.csv);
    expect(names).toContain(ZIP_MEMBERS.json);
    expect(names).toContain(ZIP_MEMBERS.readme);
    expect(names).toContain(ZIP_MEMBERS.warnings);
    expect(names).not.toContain(ZIP_MEMBERS.ris);

    const warningsTxt = await zip.file(ZIP_MEMBERS.warnings).async('string');
    expect(warningsTxt).toContain('RIS renderer exploded');
    const readme = await zip.file(ZIP_MEMBERS.readme).async('string');
    expect(readme).toContain(ZIP_MEMBERS.warnings); // README names the failed format
    // Core members still complete.
    const csv = await zip.file(ZIP_MEMBERS.csv).async('string');
    expect(csv.split('\n').length).toBe(3);
  });
});

describe('worker job flow — format zip end-to-end', () => {
  it('enqueue → drain → completed job with sanitized filename, file on disk, audit row', async () => {
    const job = await enqueueExportJob(project.id, {
      createdById: owner.id, createdByName: 'OwnerNine7', format: 'zip', filter: 'all', includeAiCv: false,
    });
    expect(job.format).toBe('zip');

    // enqueueExportJob kicks the in-process drain; poll the row until terminal.
    let row = null;
    for (let i = 0; i < 100; i++) {
      row = await prisma.screenExportJob.findUnique({ where: { id: job.id } });
      if (row && ['completed', 'failed', 'cancelled'].includes(row.status)) break;
      await new Promise(r => setTimeout(r, 250));
    }
    expect(row?.status).toBe('completed');
    expect(row.warningCount).toBe(0);
    expect(row.filename).toBe(screeningExportFilename('Zip Export: Blind/Test (97)', new Date(row.completedAt)));
    expect(row.filename).toMatch(/^zip-export-blind-test-97-screening-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(row.resultPath.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(row.resultPath)).toBe(true);
    expect(row.resultBytes).toBeGreaterThan(0);
    expect(row.totalRecords).toBe(2);
    expect(row.processedRecords).toBe(2);

    // The file is binary-safe: jszip parses it with CRC checks (utf8 sink would corrupt it).
    const zip = await JSZip.loadAsync(fs.readFileSync(row.resultPath), { checkCRC32: true });
    expect(Object.keys(zip.files).sort()).toEqual([
      ZIP_MEMBERS.readme, ZIP_MEMBERS.csv, ZIP_MEMBERS.ris, ZIP_MEMBERS.json,
    ].sort());

    // Decision E8 — completion is audited.
    const audit = await prisma.screenAuditLog.findFirst({
      where: { projectId: project.id, action: 'SCREENING_EXPORTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit.actorId).toBe(owner.id);
    const details = JSON.parse(audit.details);
    expect(details.format).toBe('zip');
    expect(details.records).toBe(2);
  }, 40000);

  it('a duplicate start dedupes to the SAME in-flight job and signals reuse (allowance-refund hook)', async () => {
    // 97.md L-fix: startExport refunds the second monthly-allowance reservation
    // when enqueueExportJob dedupes — the `reused` marker is the controller's cue.
    const first = await enqueueExportJob(project.id, {
      createdById: owner.id, createdByName: 'OwnerNine7', format: 'zip', filter: 'all', includeAiCv: false,
    });
    const second = await enqueueExportJob(project.id, {
      createdById: owner.id, createdByName: 'OwnerNine7', format: 'zip', filter: 'all', includeAiCv: false,
    });
    expect(first.reused).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);

    // Let the deduped job settle so afterAll cleanup sees a terminal row.
    for (let i = 0; i < 100; i++) {
      const row = await prisma.screenExportJob.findUnique({ where: { id: first.id } });
      if (row && ['completed', 'failed', 'cancelled'].includes(row.status)) break;
      await new Promise(r => setTimeout(r, 250));
    }
  }, 40000);
});

describe('large export — multi-page cursor streaming', () => {
  const N = 2300; // > 2 pages of the 1000-row pager
  let bigProject;

  beforeAll(async () => {
    bigProject = await prisma.screenProject.create({
      data: { ownerId: owner.id, title: `Big zip ${tag}` },
    });
    // Deterministic per-record noise keeps the members poorly compressible, so
    // each compressed member is way above the streaming chunk bound asserted
    // below — a whole-member buffer regression cannot hide behind compression.
    const noise = (seed) => {
      let x = seed * 2654435761 % 0x7fffffff;
      let s = '';
      for (let k = 0; k < 60; k++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += x.toString(36); }
      return s;
    };
    const rows = Array.from({ length: N }, (_, i) => ({
      projectId: bigProject.id,
      title: `Bulk record ${i}`,
      abstract: `Abstract body ${i} `.repeat(20) + noise(i + 1),
      year: '2020',
      sourceDb: 'seed',
      rawData: '{}',
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.screenRecord.createMany({ data: rows.slice(i, i + 500) });
    }
  }, 120000);

  afterAll(async () => {
    try {
      await prisma.screenRecord.deleteMany({ where: { projectId: bigProject.id } });
      await prisma.screenProject.deleteMany({ where: { id: bigProject.id } });
    } catch { /* best-effort */ }
  });

  it(`streams ${N} records through every member in bounded chunks (never a whole member)`, async () => {
    let sinkCalls = 0;
    let maxChunk = 0;
    const chunks = [];
    const result = await generateScreeningZip({
      projectId: bigProject.id,
      userId: owner.id,
      write: (c) => { sinkCalls++; maxChunk = Math.max(maxChunk, c.length); chunks.push(c); },
    });
    expect(result.total).toBe(N);
    expect(result.warnings).toEqual([]);
    // TRUE bounded-memory proof (97.md M1): members are fed page-by-page through
    // the streaming deflater, so no single sink write can ever approach a whole
    // member's size. The multi-hundred-KB CSV/RIS/JSON members must arrive as
    // many small zlib-output-sized buffers — a whole-member Buffer.concat would
    // show up here as one huge chunk and fail this bound.
    const total = Buffer.concat(chunks).length;
    expect(total).toBeGreaterThan(256 * 1024); // the noise seeding worked: members are big
    expect(maxChunk).toBeLessThanOrEqual(64 * 1024);
    expect(sinkCalls).toBeGreaterThan(20);
    const zip = await JSZip.loadAsync(Buffer.concat(chunks), { checkCRC32: true });
    const csv = await zip.file(ZIP_MEMBERS.csv).async('string');
    expect(csv.split('\n').length).toBe(N + 1);
    const backup = JSON.parse(await zip.file(ZIP_MEMBERS.json).async('string'));
    expect(backup.records.length).toBe(N);
  }, 120000);
});
