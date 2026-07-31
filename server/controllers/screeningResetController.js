/**
 * screeningResetController.js — 96.md Phase 6: "Delete all imported records and
 * restart" (scoped bulk reset), generalising the deleteImportBatch precedent.
 *
 * Endpoints (routes/screening.js):
 *   GET  /projects/:pid/imported-records/reset-preview?scope=search|all
 *   POST /projects/:pid/imported-records/reset   body { scope, confirm }
 *
 * Safety contract:
 *  - Permission: project OWNER or site ADMIN only (deleteImportBatch precedent;
 *    leaders are deliberately excluded — documented in the API contract). Outsiders
 *    get 404 via getProjectAccess (existence hiding).
 *  - Typed confirm: the EXACT ScreenProject title, server-validated (400 on
 *    mismatch) — the confirm is part of the API contract, not just UI. A project
 *    with a blank/whitespace title requires the literal token 'DELETE' instead
 *    (the confirm can never be vacuous); the preview exposes `confirmToken`.
 *  - Concurrency fences (96.md 6F), three layers:
 *      1. Per-project in-process reset LOCK (screening/resetLock.js — the server is
 *         single-process, so the lock is authoritative): a concurrent reset 409s
 *         (RESET_IN_PROGRESS), and every enqueue/landing path (sync import, import
 *         jobs, duplicate-detect, pecan startRun, dedupeAndInsertRecords itself)
 *         checks it and fails fast instead of racing the delete transaction.
 *      2. Job fence: 409 (JOBS_ACTIVE) while ANY project-scoped background job is
 *         active. FAIL-CLOSED: a query error during the check blocks the reset
 *         (never proceeds unverified).
 *      3. The fence is RE-RUN as the FIRST operation INSIDE the interactive
 *         transaction, so a job enqueued between the pre-check and the tx aborts
 *         the reset (no TOCTOU window).
 *  - Scope 'search' = records whose importBatchId belongs to a batch attributed to
 *    a search run (source 'pecan-search' OR a searchRunId / legacy 'pecan:' fileHash
 *    — the SAME attribution the import-history endpoint uses), EXCLUDING records
 *    that also have non-search provenance (a ScreenRecordSource row with origin
 *    file/api/mining) — those are kept (counted in manualRecordsKept) and only
 *    their search-origin provenance rows are stripped. Scope 'all' = EVERY
 *    ScreenRecord in the project (incl. manual/file/api) + all batches.
 *  - Deletion is transactional and chunked (≤400 ids per statement — SQLite's
 *    999-bind limit): bare-scope rows (AI scores/feedback, duplicate labels,
 *    eligibility assessments, full-text rows, provenance, validation samples,
 *    pending engine dedup decisions) are cleaned explicitly; ScreenDecision/
 *    Conflict/PdfAttachment/OpenState cascade via their recordId FK; duplicate
 *    groups that lost their primary or dropped under 2 members are dissolved and
 *    their surviving members un-flagged (no survivor is ever left suppressed by a
 *    dead group); scoped batches + TERMINAL ScreenImportJob rows are removed so
 *    the same file can be re-imported (scope 'all' clears EVERY terminal job —
 *    batches deleted per-batch earlier must not keep 409ing duplicate_import).
 *    Heavy read-only pre-computation happens OUTSIDE the transaction (re-validated
 *    cheaply inside); the tx timeout is 120s so a pathological reset fails fast
 *    instead of stalling SQLite's single writer for minutes.
 *  - PDF storedNames are captured INSIDE the transaction right before each delete
 *    chunk, so the post-commit disk cleanup list matches exactly what the
 *    transaction removed (no leak window for a PDF uploaded mid-request).
 *  - PecanSearchRuns are MARKED rolledBackAt/rolledBackById, never deleted —
 *    search history and the strategy remain (PRISMA excludes rolled-back runs).
 *    Only runs in TERMINAL states are marked: queued/running runs cannot exist at
 *    that point (the in-tx fence would have aborted), so a blanket mark could only
 *    ever tag a job the fence should have caught.
 *  - After commit (best-effort, never blocking): audit + ProjectEvent + PDF disk
 *    cleanup + realtime pokes to both rooms.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';
import { acquireResetLock, releaseResetLock } from '../screening/resetLock.js';
import { whenLandingIdle } from '../services/screeningImportService.js';
import { emitToProjectMembers, emitToMetaLabProject } from '../realtime/bus.js';
import { recordEvent } from '../provenance/recordEvent.js';
import { deletePdfFile } from '../screening/pdfStorage.js';
import { batchSearchRunId } from './screeningImportBatchController.js';

// SQLite in-list safety (mirrors screeningImportService.INSERT_CHUNK).
export const RESET_CHUNK = 400;

// Job states we treat as "active" across the heterogenous job tables
// (queued|processing for import/duplicate/pecan; queued|running for AI/eligibility/
// full-text — the superset is harmless per table).
const ACTIVE_STATES = ['queued', 'processing', 'running'];

// ScreenImportJob states that represent finished work (safe to clear on reset so
// the same fileHash can be imported again without a duplicate_import 409).
const TERMINAL_JOB_STATES = ['completed', 'completed_with_warnings', 'failed'];

// PecanSearchRun terminal states (queued/running are fenced out inside the tx).
const TERMINAL_RUN_STATES = ['completed', 'partial', 'failed', 'cancelled'];

const chunks = (ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += RESET_CHUNK) out.push(ids.slice(i, i + RESET_CHUNK));
  return out;
};

/**
 * partitionResetScope — PURE scope computation (unit-testable without a DB).
 *
 * A batch is search-scoped when its source is 'pecan-search' OR it is attributed
 * to a run via batchSearchRunId (first-class searchRunId or the legacy
 * 'pecan:<runId>:…' fileHash) — the SAME rule the import-history grouping uses,
 * so what displays under a run is exactly what a 'search' reset removes (M16).
 *
 * L22 — `sharedRecordIds` lists records that ALSO have non-search provenance
 * (file/api/mining ScreenRecordSource rows): they are excluded from the 'search'
 * scope (kept; counted in manualRecordsKept) and returned in sharedKeptRecordIds
 * so the caller can strip only their search-origin provenance rows.
 *
 * @param {object} a
 *   scope           'search' | 'all'
 *   records         [{ id, importBatchId, handoffStudyId, duplicateGroupId }]
 *   batches         [{ id, source, fileHash, searchRunId }]
 *   sharedRecordIds string[] | Set<string> — record ids with non-search provenance
 * @returns {{ scope, batchIds:string[], recordIds:string[], handedOff:number,
 *             manualRecordsKept:number, fileHashes:string[],
 *             sharedKeptRecordIds:string[], affectedGroupIds:string[] }}
 */
export function partitionResetScope({ scope, records = [], batches = [], sharedRecordIds = [] } = {}) {
  const searchScope = scope !== 'all';
  const isSearchBatch = (b) => !!b && (((b.source || 'file') === 'pecan-search') || batchSearchRunId(b) !== '');
  const searchBatchIds = new Set(batches.filter(isSearchBatch).map((b) => b.id));
  const scopedBatches = searchScope ? batches.filter((b) => searchBatchIds.has(b.id)) : batches;
  const shared = sharedRecordIds instanceof Set ? sharedRecordIds : new Set(sharedRecordIds);
  const sharedKeptRecordIds = [];
  const inScope = (r) => {
    if (!searchScope) return true;
    if (!(r.importBatchId && searchBatchIds.has(r.importBatchId))) return false;
    if (shared.has(r.id)) { sharedKeptRecordIds.push(r.id); return false; } // L22 — kept
    return true;
  };
  const scopedRecords = records.filter(inScope);
  return {
    scope: searchScope ? 'search' : 'all',
    batchIds: scopedBatches.map((b) => b.id),
    recordIds: scopedRecords.map((r) => r.id),
    handedOff: scopedRecords.filter((r) => r.handoffStudyId).length,
    manualRecordsKept: records.length - scopedRecords.length,
    fileHashes: [...new Set(scopedBatches.map((b) => b.fileHash).filter(Boolean))],
    sharedKeptRecordIds,
    // Duplicate groups that are losing members — candidates for the in-tx repair.
    affectedGroupIds: [...new Set(scopedRecords.map((r) => r.duplicateGroupId).filter(Boolean))],
  };
}

/**
 * planDuplicateGroupRepair — PURE repair plan for duplicate groups after scoped
 * records were deleted (H2; unit-testable). Mirrors the keep-all resolve path:
 * a group whose PRIMARY was deleted, or that dropped below 2 surviving members,
 * is dissolved — its survivors get isDuplicate/isPrimary cleared and
 * duplicateGroupId detached, so no record is ever suppressed by a dead group.
 * A group with no survivors is simply deleted. Unresolved groups (primaryId '')
 * with ≥2 survivors keep their pending suggestion.
 *
 * @param {object} a  groups: [{ id, primaryId, survivors: [{ id }] }]
 * @returns {{ deleteGroupIds:string[], clearRecordIds:string[] }}
 */
export function planDuplicateGroupRepair({ groups = [] } = {}) {
  const deleteGroupIds = [];
  const clearRecordIds = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || !g.id) continue;
    const survivors = Array.isArray(g.survivors) ? g.survivors.filter((r) => r && r.id) : [];
    if (!survivors.length) { deleteGroupIds.push(g.id); continue; }
    const primaryDeleted = !!(g.primaryId && !survivors.some((r) => r.id === g.primaryId));
    if (primaryDeleted || survivors.length < 2) {
      deleteGroupIds.push(g.id);
      for (const r of survivors) clearRecordIds.push(r.id);
    }
  }
  return { deleteGroupIds, clearRecordIds };
}

/** Load project rows + partition them for the requested scope. */
async function loadScopedTargets(pid, scope) {
  const [records, batches] = await Promise.all([
    prisma.screenRecord.findMany({
      where: { projectId: pid },
      select: { id: true, importBatchId: true, handoffStudyId: true, duplicateGroupId: true },
    }),
    prisma.screenImportBatch.findMany({
      where: { projectId: pid },
      select: { id: true, source: true, fileHash: true, searchRunId: true },
    }),
  ]);
  // L22 — records that also arrived via a non-search path stay out of the
  // 'search' scope. Pre-96 legacy shared provenance is undetectable (no
  // ScreenRecordSource rows exist for it) — documented in the API contract.
  let sharedRecordIds = [];
  if (scope !== 'all') {
    try {
      const rows = await prisma.screenRecordSource.findMany({
        where: { projectId: pid, origin: { in: ['file', 'api', 'mining'] } },
        select: { screenRecordId: true },
        distinct: ['screenRecordId'],
      });
      sharedRecordIds = rows.map((r) => r.screenRecordId);
    } catch { sharedRecordIds = []; }
  }
  return partitionResetScope({ scope, records, batches, sharedRecordIds });
}

// The fail-closed blocking reason when a fence query itself failed (L19): a
// safety check that cannot run must block, never wave the reset through.
export const FENCE_CHECK_FAILED_REASON =
  'Background job status could not be verified. Try again in a moment.';

/**
 * Human-readable reason the reset is blocked, or null when no project-scoped job
 * is active. FAIL-CLOSED (L19): a model genuinely absent from the client (stripped
 * deployment) is skipped, but a QUERY ERROR on a present model blocks the reset —
 * a transient DB failure must never let the reset proceed under active jobs.
 * Exported for unit tests; `db` accepts the shared client OR an interactive
 * transaction client so the fence can re-run INSIDE the reset transaction.
 */
export async function activeJobsReason(pid, metaLabProjectId, db = prisma) {
  const tableChecks = [
    ['screenImportJob', 'A reference import is still running for this project.'],
    ['screenDuplicateJob', 'Duplicate detection is still running for this project.'],
    ['screenAiJob', 'AI screening is still running for this project.'],
    ['screenEligibilityJob', 'Eligibility evaluation is still running for this project.'],
    ['fullTextRetrievalJob', 'Full-text retrieval is still running for this project.'],
  ];
  for (const [model, reason] of tableChecks) {
    if (!db[model]) continue; // model absent (stripped deployment) — skip
    try {
      if ((await db[model].count({ where: { projectId: pid, status: { in: ACTIVE_STATES } } })) > 0) {
        return reason;
      }
    } catch { return FENCE_CHECK_FAILED_REASON; }
  }
  if (metaLabProjectId) {
    if (db.pecanSearchJob) {
      try {
        if ((await db.pecanSearchJob.count({ where: { metaLabProjectId, status: { in: ACTIVE_STATES } } })) > 0) {
          return 'An automated search is still running for this project.';
        }
      } catch { return FENCE_CHECK_FAILED_REASON; }
    }
    if (db.pecanSearchRun) {
      try {
        if ((await db.pecanSearchRun.count({ where: { metaLabProjectId, state: { in: ['queued', 'running'] } } })) > 0) {
          return 'An automated search is still running for this project.';
        }
      } catch { return FENCE_CHECK_FAILED_REASON; }
    }
  }
  return null;
}

/** Chunk-safe count over a recordId in-list. */
async function countByRecordIds(model, recordIds, extraWhere = {}) {
  if (!prisma[model]) return 0;
  let n = 0;
  for (const chunk of chunks(recordIds)) {
    try { n += await prisma[model].count({ where: { recordId: { in: chunk }, ...extraWhere } }); }
    catch { /* best-effort preview count */ }
  }
  return n;
}

const validScope = (s) => s === 'search' || s === 'all';

/** The server-validated typed-confirm token: the exact project title, or the
 *  literal 'DELETE' when the title is blank/whitespace (L14 — never vacuous). */
const confirmTokenFor = (project) => String((project && project.title) || '').trim() || 'DELETE';

/** GET /projects/:pid/imported-records/reset-preview?scope=search|all */
export async function getResetPreview(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const isAdmin = req.user?.role === 'admin';
    if (!(access.isOwner || isAdmin)) {
      return res.status(403).json({ error: 'Only the project owner or an administrator can reset imported records.' });
    }
    const scope = String(req.query.scope || 'search');
    if (!validScope(scope)) return res.status(400).json({ error: "scope must be 'search' or 'all'" });

    const pid = req.params.pid;
    const mlpid = access.project.linkedMetaLabProjectId || '';
    const targets = await loadScopedTargets(pid, scope);

    const [decisions, notes, conflicts, pdfs] = await Promise.all([
      countByRecordIds('screenDecision', targets.recordIds),
      countByRecordIds('screenDecision', targets.recordIds, { NOT: { notes: '' } }),
      countByRecordIds('screenConflict', targets.recordIds),
      countByRecordIds('screenPdfAttachment', targets.recordIds),
    ]);
    let runsAffected = 0;
    try {
      runsAffected = await prisma.pecanSearchRun.count({ where: { screenProjectId: pid, rolledBackAt: null } });
    } catch { runsAffected = 0; }

    const blockedBy = await activeJobsReason(pid, mlpid);

    res.json({
      scope: targets.scope,
      projectName: access.project.title || '',
      // L14 — what the client must have the user type (project name, or the
      // literal 'DELETE' when the title is blank). Server-validated on POST.
      confirmToken: confirmTokenFor(access.project),
      counts: {
        records: targets.recordIds.length,
        batches: targets.batchIds.length,
        decisions, notes, conflicts, pdfs,
        runsAffected,
        handedOff: targets.handedOff,
        manualRecordsKept: targets.manualRecordsKept,
      },
      // Facts the confirm dialog states explicitly (96.md Phase 6B):
      searchHistoryRemains: true, // runs are marked rolled-back, never deleted
      strategyRemains: true, // the search strategy/versions are untouched
      undoable: false, // hard delete — no restore path
      blockedBy: blockedBy || null,
    });
  } catch (e) {
    console.error('getResetPreview', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /projects/:pid/imported-records/reset — body { scope, confirm } */
export async function postReset(req, res) {
  let lockedPid = null;
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const isAdmin = req.user?.role === 'admin';
    if (!(access.isOwner || isAdmin)) {
      return res.status(403).json({ error: 'Only the project owner or an administrator can reset imported records.' });
    }
    const scope = String((req.body && req.body.scope) || 'search');
    if (!validScope(scope)) return res.status(400).json({ error: "scope must be 'search' or 'all'" });

    // Typed confirm = the EXACT project name (server-validated; UI mirrors it),
    // or the literal 'DELETE' when the title is blank (L14).
    const confirm = String((req.body && req.body.confirm) || '').trim();
    if (confirm !== confirmTokenFor(access.project)) {
      return res.status(400).json({ error: 'Confirmation text does not match the project name.' });
    }

    const pid = req.params.pid;
    const mlpid = access.project.linkedMetaLabProjectId || '';

    // Per-project reset lock: a second reset (double-submit or another tab/user)
    // 409s instead of racing this one, and every import/landing path checks the
    // same lock (screening/resetLock.js) so nothing can repopulate mid-delete.
    if (!acquireResetLock(pid)) {
      return res.status(409).json({ error: 'A reset is already in progress for this project.', code: 'RESET_IN_PROGRESS' });
    }
    lockedPid = pid;

    // With the lock held no NEW landing can start; drain any landing already in
    // flight (the synchronous import path has no job row, so the job fence below
    // cannot see it — this await closes that gap for in-process landings).
    await whenLandingIdle(pid);

    // Fast pre-check fence (cheap 409 before any heavy work; authoritative
    // re-check runs INSIDE the transaction below). Fail-closed on query errors.
    const blockedBy = await activeJobsReason(pid, mlpid);
    if (blockedBy) return res.status(409).json({ error: `${blockedBy} Wait for it to finish (or cancel it), then try again.`, code: 'JOBS_ACTIVE' });

    const targets = await loadScopedTargets(pid, scope);

    // Pre-compute cascade counts for the response/audit (read-only, OUTSIDE the
    // transaction — the reset lock keeps the landing paths out of this project).
    const [decisions, conflicts, pdfs] = await Promise.all([
      countByRecordIds('screenDecision', targets.recordIds),
      countByRecordIds('screenConflict', targets.recordIds),
      countByRecordIds('screenPdfAttachment', targets.recordIds),
    ]);

    // Duplicate-group repair candidates, pre-computed OUTSIDE the transaction
    // (M22 — keep the tx short): groups the scoped records belong to, plus any
    // group already empty from earlier per-batch deletes. Re-validated cheaply
    // inside the tx against the post-delete survivor sets.
    let emptyGroupIds = [];
    try {
      const groups = await prisma.screenDuplicateGroup.findMany({
        where: { projectId: pid },
        select: { id: true, _count: { select: { records: true } } },
      });
      emptyGroupIds = groups.filter((g) => (g._count?.records || 0) === 0).map((g) => g.id);
    } catch { emptyGroupIds = []; }
    const groupIdsToCheck = [...new Set([...targets.affectedGroupIds, ...emptyGroupIds])];

    const now = new Date();
    let recordsDeleted = 0;
    let batchesDeleted = 0;
    let runsMarked = 0;
    // PDF disk names — filled INSIDE the tx right before each delete chunk (L18).
    const storedNames = [];

    await prisma.$transaction(async (tx) => {
      // 0) TOCTOU fence: re-run the job check as the FIRST operation inside the
      //    transaction. A job/run enqueued between the pre-check and this point
      //    aborts the whole reset (409 below). Fail-closed like the pre-check.
      const blocked = await activeJobsReason(pid, mlpid, tx);
      if (blocked) { const e = new Error(blocked); e.code = 'JOBS_ACTIVE'; throw e; }

      // 1) Per-chunk: bare-scope rows (no FK) then the records (FK children cascade).
      for (const chunk of chunks(targets.recordIds)) {
        for (const model of ['screenAiScore', 'screenAiFeedback', 'eligibilityAssessment', 'fullTextCandidate', 'fullTextRequest']) {
          if (!tx[model]) continue;
          try { await tx[model].deleteMany({ where: { recordId: { in: chunk } } }); }
          catch { /* model absent / shape differs — best-effort bare-scope cleanup */ }
        }
        // Provenance rows key the record as screenRecordId (96.md tables).
        for (const model of ['screenRecordSource', 'screenRecordMetadataChange']) {
          if (!tx[model]) continue;
          try { await tx[model].deleteMany({ where: { screenRecordId: { in: chunk } } }); }
          catch { /* ignore */ }
        }
        if (tx.screenDuplicateLabel) {
          try { await tx.screenDuplicateLabel.deleteMany({ where: { projectId: pid, recordIdA: { in: chunk } } }); } catch { /* ignore */ }
          try { await tx.screenDuplicateLabel.deleteMany({ where: { projectId: pid, recordIdB: { in: chunk } } }); } catch { /* ignore */ }
        }
        // PDF disk names captured HERE (inside the tx, right before the delete)
        // so the post-commit disk cleanup matches exactly what this tx removes.
        try {
          const rows = await tx.screenPdfAttachment.findMany({
            where: { recordId: { in: chunk } }, select: { storedName: true },
          });
          for (const r of rows) if (r.storedName) storedNames.push(r.storedName);
        } catch { /* disk cleanup is best-effort anyway */ }
        const del = await tx.screenRecord.deleteMany({ where: { projectId: pid, id: { in: chunk } } });
        recordsDeleted += del.count;
      }

      // Scope 'all': sweep any dangling provenance rows for the whole project
      // (rows whose record was deleted earlier by other paths).
      if (targets.scope === 'all') {
        if (tx.screenRecordSource) { try { await tx.screenRecordSource.deleteMany({ where: { projectId: pid } }); } catch { /* ignore */ } }
        if (tx.screenRecordMetadataChange) { try { await tx.screenRecordMetadataChange.deleteMany({ where: { projectId: pid } }); } catch { /* ignore */ } }
      }

      // L22 — shared-provenance records SURVIVE the 'search' scope: strip only
      // their search-origin provenance rows (file/api/mining provenance stays).
      if (targets.scope === 'search' && targets.sharedKeptRecordIds.length && tx.screenRecordSource) {
        for (const chunk of chunks(targets.sharedKeptRecordIds)) {
          try { await tx.screenRecordSource.deleteMany({ where: { screenRecordId: { in: chunk }, origin: 'search' } }); }
          catch { /* ignore */ }
        }
      }

      // 2) Duplicate-group repair (H2): dissolve groups that lost their primary or
      //    dropped under 2 members, clearing survivors' flags so nothing stays
      //    suppressed by a dead group. Candidates were pre-computed outside the
      //    tx; survivor sets are re-read HERE (post-delete truth).
      if (groupIdsToCheck.length && tx.screenDuplicateGroup) {
        try {
          const groupRows = [];
          const survivorsByGroup = new Map();
          for (const chunk of chunks(groupIdsToCheck)) {
            const gs = await tx.screenDuplicateGroup.findMany({
              where: { projectId: pid, id: { in: chunk } }, select: { id: true, primaryId: true },
            });
            groupRows.push(...gs);
            const survivors = await tx.screenRecord.findMany({
              where: { duplicateGroupId: { in: chunk } }, select: { id: true, duplicateGroupId: true },
            });
            for (const s of survivors) {
              if (!survivorsByGroup.has(s.duplicateGroupId)) survivorsByGroup.set(s.duplicateGroupId, []);
              survivorsByGroup.get(s.duplicateGroupId).push({ id: s.id });
            }
          }
          const plan = planDuplicateGroupRepair({
            groups: groupRows.map((g) => ({ id: g.id, primaryId: g.primaryId || '', survivors: survivorsByGroup.get(g.id) || [] })),
          });
          for (const chunk of chunks(plan.clearRecordIds)) {
            await tx.screenRecord.updateMany({
              where: { id: { in: chunk } },
              data: { isDuplicate: false, isPrimary: false, duplicateGroupId: null },
            });
          }
          for (const chunk of chunks(plan.deleteGroupIds)) {
            await tx.screenDuplicateGroup.deleteMany({ where: { id: { in: chunk } } });
          }
        } catch { /* dup-group shape differs — ignore */ }
      }

      // 2b) AI validation samples snapshot record ids — after the delete they can
      //     never be completed, so remove them for BOTH scopes (cheap to regenerate).
      if (tx.screenValidationSample) {
        try { await tx.screenValidationSample.deleteMany({ where: { projectId: pid } }); } catch { /* ignore */ }
      }

      // 2c) Pending engine dedup decisions of this project's runs reference
      //     matched/source records that are now gone — remove them (L21). Decided
      //     rows stay (audit of past automatic/manual merges).
      if (tx.pecanDedupDecision && tx.pecanSearchRun) {
        try {
          const runRows = await tx.pecanSearchRun.findMany({ where: { screenProjectId: pid }, select: { id: true } });
          for (const chunk of chunks(runRows.map((r) => r.id))) {
            await tx.pecanDedupDecision.deleteMany({ where: { runId: { in: chunk }, decision: 'pending' } });
          }
        } catch { /* ignore */ }
      }

      // 3) Scoped import batches + terminal import jobs, so re-importing after the
      //    reset never 409s duplicate_import.
      for (const chunk of chunks(targets.batchIds)) {
        const del = await tx.screenImportBatch.deleteMany({ where: { projectId: pid, id: { in: chunk } } });
        batchesDeleted += del.count;
      }
      if (targets.scope === 'all') {
        // L17 — a complete restart clears EVERY terminal job for the project (a
        // job whose batch was deleted per-batch earlier still holds its fileHash
        // and would otherwise keep 409ing that file forever).
        try {
          await tx.screenImportJob.deleteMany({
            where: { projectId: pid, status: { in: TERMINAL_JOB_STATES } },
          });
        } catch { /* ignore */ }
      } else {
        for (const chunk of chunks(targets.fileHashes)) {
          try {
            await tx.screenImportJob.deleteMany({
              where: { projectId: pid, fileHash: { in: chunk }, status: { in: TERMINAL_JOB_STATES } },
            });
          } catch { /* ignore */ }
        }
      }

      // 4) Mark search runs rolled-back (history stays; PRISMA excludes them).
      //    TERMINAL states only: queued/running runs cannot exist here — the
      //    in-tx fence above would have aborted — so a blanket mark could only
      //    ever mistag an active run the fence should catch.
      try {
        const marked = await tx.pecanSearchRun.updateMany({
          where: { screenProjectId: pid, rolledBackAt: null, state: { in: TERMINAL_RUN_STATES } },
          data: { rolledBackAt: now, rolledBackById: req.user.id },
        });
        runsMarked = marked.count;
      } catch { runsMarked = 0; }

      // 5) The durable reset event (survives everything it describes).
      if (tx.screenResetEvent) {
        await tx.screenResetEvent.create({
          data: {
            projectId: pid, metaLabProjectId: mlpid, scope: targets.scope,
            recordCount: recordsDeleted, decisionCount: decisions, runCount: runsMarked,
            initiatedById: req.user.id, initiatedByName: req.user.name || req.user.email || '',
            detailsJson: JSON.stringify({
              batches: batchesDeleted, conflicts, pdfs,
              handedOff: targets.handedOff, manualRecordsKept: targets.manualRecordsKept,
              sharedKept: targets.sharedKeptRecordIds.length,
              admin: isAdmin && !access.isOwner,
            }).slice(0, 4000),
          },
        });
      }
    }, { timeout: 120000, maxWait: 15000 });

    // ── After commit: best-effort side effects (never fail the response). ──
    await writeAudit(pid, req.user, 'RESET_IMPORTED_RECORDS', {
      entityType: 'ScreenProject', entityId: pid,
      details: {
        scope: targets.scope, recordsRemoved: recordsDeleted, batchesRemoved: batchesDeleted,
        decisionsRemoved: decisions, runsMarked, handedOff: targets.handedOff,
        source: isAdmin && !access.isOwner ? 'admin' : 'owner',
      },
    });
    if (mlpid) {
      // ProjectEvent ledger (META·LAB project scope) — module 'screening', critical.
      recordEvent({
        eventType: 'SCREENING_IMPORTED_RECORDS_RESET',
        entityType: 'screenProject', entityId: pid,
        newValue: { scope: targets.scope, recordsRemoved: recordsDeleted, runsMarked },
        metadata: { batchesRemoved: batchesDeleted, decisionsRemoved: decisions },
      }, { projectId: mlpid, actorUserId: req.user.id, actorName: req.user.name || req.user.email || '' });
    }
    // Orphaned PDF files on disk (rows cascaded away inside the transaction).
    for (const name of storedNames) deletePdfFile(pid, name);
    // Realtime pokes — open screening UIs refetch; linked workspace overview/PRISMA refresh.
    try { emitToProjectMembers(pid, { type: 'project.updated' }); } catch { /* best-effort */ }
    if (mlpid) { try { emitToMetaLabProject(mlpid, access.project.ownerId, { type: 'project.updated' }); } catch { /* best-effort */ } }

    res.json({
      deleted: true,
      scope: targets.scope,
      counts: {
        records: recordsDeleted,
        decisions,
        conflicts,
        pdfs,
        batches: batchesDeleted,
        runsMarked,
        manualRecordsKept: targets.manualRecordsKept,
      },
    });
  } catch (e) {
    // The in-transaction TOCTOU fence aborts with a coded error → 409, same
    // envelope as the pre-check (the transaction rolled back completely).
    if (e && e.code === 'JOBS_ACTIVE') {
      return res.status(409).json({ error: `${e.message} Wait for it to finish (or cancel it), then try again.`, code: 'JOBS_ACTIVE' });
    }
    console.error('postReset', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (lockedPid) releaseResetLock(lockedPid);
  }
}
