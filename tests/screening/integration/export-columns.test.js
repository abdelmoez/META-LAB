/**
 * export-columns.test.js — 65.md SCR-2/SCR-8: export completeness. Direct
 * service-level tests against the real dev DB (no HTTP server; same pattern as
 * tests/integration/screening-perf-jobs.test.js).
 *
 * Proves:
 *  - EXPORT_COLUMNS is APPEND-ONLY: the original 12 + AI CV columns keep their
 *    exact positions; review/consensus columns come after;
 *  - buildExportRow fills per-reviewer decisions/timestamps, conflict_status,
 *    duplicate_group_id + is_primary, my_decided_at;
 *  - identity policy mirrors listRecords: blind + non-leader → anonymous ordinals;
 *  - the async CV cap constant exists and is ≥ the sync cap (SCR-8).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../server/db/client.js';
import {
  EXPORT_COLUMNS, EXPORT_REVIEW_COLUMNS, EXPORT_REVIEWER_CAP,
  EXPORT_CV_MAX, EXPORT_CV_MAX_ASYNC,
  buildExportRow, buildExportContext, renderCsvRow, streamExportToSink,
} from '../../../server/services/screeningExportService.js';
import { AI_CV_COLUMNS } from '../../../src/research-engine/screening/ai/index.js';

const tag = `exp65_${Date.now()}`;
const blankCv = { meta: { status: 'ai_unavailable', scoreType: 'not_available', modelVersion: '' }, byRecordId: new Map(), generatedAt: '2026-01-01T00:00:00.000Z' };

let owner, reviewer, project, rec;

beforeAll(async () => {
  owner = await prisma.user.create({ data: { email: `${tag}-o@x.io`, password: 'x', name: 'Owner65' } });
  reviewer = await prisma.user.create({ data: { email: `${tag}-r@x.io`, password: 'x', name: 'Reviewer65' } });
  project = await prisma.screenProject.create({ data: { ownerId: owner.id, title: 'Export 65', blindMode: true } });
  await prisma.screenProjectMember.create({
    data: { projectId: project.id, userId: reviewer.id, name: 'Reviewer65', email: `${tag}-r@x.io`, role: 'reviewer', status: 'active', canScreen: true },
  });
  rec = await prisma.screenRecord.create({ data: { projectId: project.id, title: 'Conflicted record', authors: 'A', year: '2021' } });
  await prisma.screenDecision.create({
    data: { recordId: rec.id, projectId: project.id, reviewerId: owner.id, reviewerName: 'Owner65', stage: 'title_abstract', decision: 'include' },
  });
  await prisma.screenDecision.create({
    data: { recordId: rec.id, projectId: project.id, reviewerId: reviewer.id, reviewerName: 'Reviewer65', stage: 'title_abstract', decision: 'exclude' },
  });
});

afterAll(async () => {
  try {
    await prisma.screenDecision.deleteMany({ where: { projectId: project.id } });
    await prisma.screenRecord.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProjectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProject.deleteMany({ where: { id: project.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, reviewer.id] } } });
  } catch { /* best-effort */ }
});

describe('EXPORT_COLUMNS — append-only schema', () => {
  it('the original columns keep their exact positions; new families are appended', () => {
    const legacy = ['title', 'authors', 'year', 'journal', 'doi', 'pmid', 'decision', 'exclusionReason', 'notes', 'rating', 'isDuplicate', 'abstract'];
    expect(EXPORT_COLUMNS.slice(0, legacy.length)).toEqual(legacy);
    expect(EXPORT_COLUMNS.slice(legacy.length, legacy.length + AI_CV_COLUMNS.length)).toEqual([...AI_CV_COLUMNS]);
    expect(EXPORT_COLUMNS.slice(legacy.length + AI_CV_COLUMNS.length)).toEqual([...EXPORT_REVIEW_COLUMNS]);
  });

  it('review columns cover a fixed reviewer cap (stable CSV schema)', () => {
    expect(EXPORT_REVIEW_COLUMNS[0]).toBe('conflict_status');
    expect(EXPORT_REVIEW_COLUMNS).toContain(`reviewer_${EXPORT_REVIEWER_CAP}_decision`);
    expect(EXPORT_REVIEW_COLUMNS).not.toContain(`reviewer_${EXPORT_REVIEWER_CAP + 1}_decision`);
  });

  it('SCR-8: the async CV cap exists and is at least the sync cap', () => {
    expect(EXPORT_CV_MAX_ASYNC).toBeGreaterThanOrEqual(EXPORT_CV_MAX);
    expect(EXPORT_CV_MAX_ASYNC).toBeGreaterThanOrEqual(20000);
  });
});

describe('buildExportRow — per-reviewer / consensus / duplicate columns', () => {
  const record = (decisions = []) => ({
    id: 'r1', title: 'T', authors: 'A', year: '2020', journal: 'J', doi: '10.1/x', pmid: '1',
    abstract: 'Ab', isDuplicate: false, isPrimary: true, duplicateGroupId: 'grp9', sourceDb: 'PubMed',
    decisions,
  });
  const dec = (reviewerId, decision, at = '2026-06-01T10:00:00.000Z') => ({
    reviewerId, reviewerName: `Name-${reviewerId}`, stage: 'title_abstract', decision,
    exclusionReason: '', notes: '', rating: null, labels: '[]', createdAt: at, updatedAt: at,
  });
  const ctx = (over = {}) => ({
    canSeeIdentity: true,
    reviewers: [{ reviewerId: 'u1', name: 'Alice' }, { reviewerId: 'u2', name: 'Bob' }],
    requiredReviewers: 2,
    ...over,
  });

  it('fills reviewer_N decision + timestamp columns in the ctx (project-wide) order', () => {
    const row = buildExportRow(record([dec('u1', 'include'), dec('u2', 'exclude')]), 'u1', blankCv, ctx());
    expect(row.reviewer_1_name).toBe('Alice');
    expect(row.reviewer_1_decision).toBe('include');
    expect(row.reviewer_1_decided_at).toBe('2026-06-01T10:00:00.000Z');
    expect(row.reviewer_2_name).toBe('Bob');
    expect(row.reviewer_2_decision).toBe('exclude');
    expect(row.reviewer_3_name).toBe('');       // no third reviewer → blank family
    expect(row.reviewer_3_decision).toBe('');
    expect(row.my_decided_at).toBe('2026-06-01T10:00:00.000Z');
    expect(row.conflict_status).toBe('conflict');
    expect(row.duplicate_group_id).toBe('grp9');
    expect(row.is_primary).toBe(true);
  });

  it('anonymises reviewer identity when not permission-safe (blind, non-leader)', () => {
    const row = buildExportRow(record([dec('u1', 'include')]), 'u1', blankCv, ctx({ canSeeIdentity: false }));
    expect(row.reviewer_1_name).toBe('Reviewer 1');
    expect(row.reviewer_2_name).toBe('Reviewer 2');
    expect(row.reviewer_1_decision).toBe('include'); // decisions themselves mirror listRecords visibility
  });

  it('derives consensus states from title/abstract decisions', () => {
    const agree = buildExportRow(record([dec('u1', 'include'), dec('u2', 'include')]), 'u1', blankCv, ctx());
    expect(agree.conflict_status).toBe('agreement_included');
    const waiting = buildExportRow(record([dec('u1', 'exclude')]), 'u1', blankCv, ctx());
    expect(waiting.conflict_status).toBe('awaiting_second_reviewer');
    const none = buildExportRow(record([]), 'u1', blankCv, ctx());
    expect(none.conflict_status).toBe('awaiting_screening');
  });

  it('with no ctx (legacy callers) the new columns fail closed: blank reviewers, default consensus', () => {
    const row = buildExportRow(record([dec('u1', 'include')]), 'u1', blankCv);
    expect(row.reviewer_1_name).toBe('');
    expect(row.reviewer_1_decision).toBe('');
    expect(row.conflict_status).toBe('awaiting_second_reviewer');
    // existing columns unchanged
    expect(row.decision).toBe('include');
  });

  it('renderCsvRow emits exactly one cell per column', () => {
    const row = buildExportRow(record([dec('u1', 'include')]), 'u1', blankCv, ctx());
    const cells = renderCsvRow(row).split(',');
    // No embedded commas/quotes in this synthetic row → cell count == column count.
    expect(cells.length).toBe(EXPORT_COLUMNS.length);
  });
});

describe('buildExportContext — identity policy + deterministic reviewer order (DB)', () => {
  it('blind project: leader sees identity, plain reviewer gets anonymous ordinals', async () => {
    const asOwner = await buildExportContext(project.id, owner.id);
    expect(asOwner.canSeeIdentity).toBe(true);
    const asReviewer = await buildExportContext(project.id, reviewer.id);
    expect(asReviewer.canSeeIdentity).toBe(false);
    // Same deterministic reviewer ordering for both callers (reviewerId asc).
    expect(asOwner.reviewers.map(r => r.reviewerId)).toEqual(asReviewer.reviewers.map(r => r.reviewerId));
    expect(asOwner.reviewers.map(r => r.reviewerId)).toEqual(
      [owner.id, reviewer.id].sort(),
    );
  });

  it('unknown project → neutral fail-closed context', async () => {
    const ctx = await buildExportContext('does-not-exist', owner.id);
    expect(ctx.canSeeIdentity).toBe(false);
    expect(ctx.reviewers).toEqual([]);
  });
});

describe('streamExportToSink — new columns flow through the streaming path', () => {
  it('CSV header carries the appended columns and the conflicted record exports its consensus', async () => {
    const chunks = [];
    await streamExportToSink({
      projectId: project.id, userId: owner.id, format: 'csv', filter: 'all', cv: blankCv,
      write: (c) => { chunks.push(c); },
    });
    const csv = chunks.join('');
    const lines = csv.split('\n');
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(','));
    expect(lines[0]).toContain('conflict_status');
    expect(lines[0]).toContain('reviewer_1_decision');
    const dataLine = lines.find(l => l.includes('Conflicted record'));
    expect(dataLine).toContain('conflict');       // consensus column
    expect(dataLine).toContain('exclude');        // the other reviewer's decision column
  });
});
