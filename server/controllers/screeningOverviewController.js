/**
 * screeningOverviewController.js — Overview dashboard data + audit trail (Parts 10/5).
 * Powers the project command-center: data summary, per-member progress,
 * whole-project progress, and the audit log.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, ensureLeaderMember } from '../screening/access.js';
import { mlAccessFromMember } from '../screening/metalabAccess.js';
import { getEffectiveQuorum } from '../screening/settings.js';
// 103.md §10 — the canonical, record-derived PRISMA flow. 116.md §11 — served
// slim (counts only); per-box record lists page through getPrismaBoxRecords.
import { loadPrismaFlow, slimPrismaFlow } from '../screening/prismaFlowService.js';
import {
  BOX_IDS, boxMeta, dispositionOf, DISPOSITION_LABELS,
  reasonGroupKey, displayReason,
} from '../../src/research-engine/prisma/index.js';
// 110.md §1 — multi-reviewer whole-project progress.
import { computeScreeningProgress } from '../../src/research-engine/screening/screeningProgress.js';
import { ELIGIBILITY_ENGINE_REVIEWER_ID } from '../services/screeningEligibilityService.js';

/** GET /projects/:pid/overview — summary metrics for the Overview tab. */
export async function getOverview(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    await ensureLeaderMember(access.project);
    const pid = access.project.id;

    // 107.md §1 — the ScreenDuplicateJob ROW is authoritative for duplicate
    // detection state; the group rows are only its results. `latestDupJob` drives
    // the live status, `lastCompletedDupJob` proves a sweep finished (even one
    // that found nothing), and the newest record timestamp answers "has the input
    // set changed since?". All three are cheap indexed lookups — never a full
    // record load.
    const [total, members, decisions, conflicts, dupGroups, records, latestDupJob, lastCompletedDupJob, newestRecordAgg, taReviewerGroups] = await Promise.all([
      prisma.screenRecord.count({ where: { projectId: pid } }),
      prisma.screenProjectMember.findMany({ where: { projectId: pid }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] }),
      prisma.screenDecision.findMany({ where: { projectId: pid } }),
      prisma.screenConflict.findMany({ where: { projectId: pid } }),
      prisma.screenDuplicateGroup.findMany({ where: { projectId: pid } }),
      prisma.screenRecord.findMany({ where: { projectId: pid }, select: { id: true, currentStage: true, finalStatus: true, isDuplicate: true } }),
      prisma.screenDuplicateJob.findFirst({
        where: { projectId: pid },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, error: true, completedAt: true, createdAt: true },
      }),
      prisma.screenDuplicateJob.findFirst({
        where: { projectId: pid, status: 'completed' },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, completedAt: true, totalRecords: true, statsJson: true },
      }),
      prisma.screenRecord.aggregate({ where: { projectId: pid }, _max: { createdAt: true } }),
      // 110.md §1 — DISTINCT non-engine human reviewers per record at title/abstract,
      // as a GROUP BY (one small row per touched record) rather than a decision load:
      // @@unique([recordId, reviewerId, stage]) makes the per-recordId row count
      // exactly the distinct-reviewer count. The eligibility engine writes real
      // ScreenDecision rows under a non-human reviewerId and must never count toward
      // the independent-reviewer requirement (same exclusion as the promotion gate in
      // screeningController.saveDecision).
      prisma.screenDecision.groupBy({
        by: ['recordId'],
        where: {
          projectId: pid, stage: 'title_abstract',
          decision: { not: 'undecided' },
          reviewerId: { not: ELIGIBILITY_ENGINE_REVIEWER_ID },
        },
        _count: { _all: true },
      }),
    ]);

    const confirmedDuplicates       = records.filter(r => r.isDuplicate).length;
    const unresolvedDuplicateGroups = dupGroups.filter(g => !g.resolvedAt).length;
    const resolvedDuplicateGroups   = dupGroups.filter(g => g.resolvedAt).length;
    const eligibleSecondReview      = records.filter(r => r.currentStage === 'full_text').length;
    const acceptedToExtraction      = records.filter(r => r.finalStatus === 'accepted').length;
    const rejectedSecond            = records.filter(r => r.finalStatus === 'rejected').length;
    const unresolvedConflicts       = conflicts.filter(c => !c.resolvedAt).length;

    // ── 107.md §1 — explicit duplicate-detection state ───────────────────────
    // Previously `duplicateDetectionRun` was `dupGroups.length > 0`, i.e. "has
    // detection run?" was inferred from whether it FOUND anything. A completed
    // sweep that found zero duplicates therefore read as never-run forever (the
    // stepper's permanent "Pending"), and the flag silently regressed whenever a
    // batch delete or scoped reset removed the last group rows. The job row is
    // the authoritative signal; groups stay in the OR so projects whose groups
    // predate the job model keep reading as run.
    const DUP_STATUSES = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
    const duplicateDetectionStatus = DUP_STATUSES.includes(latestDupJob?.status) ? latestDupJob.status : 'never_run';
    const duplicateDetectionRun = dupGroups.length > 0 || !!lastCompletedDupJob;
    // Staleness is DETERMINISTIC, not a UI guess (107.md "explicit and
    // deterministic"): a record created after the last sweep finished was
    // provably never scanned, and a changed project-wide record count means
    // records were added or deleted since. `job.totalRecords` counts only the
    // records the sweep CONSIDERED (frozen resolved-group members are excluded),
    // so it cannot be compared against the project total — the worker records the
    // project-wide count in statsJson.projectRecordCount instead. Jobs completed
    // before that field existed fall back to the timestamp rule alone rather than
    // fabricating a comparison.
    let duplicateDetectionStale = false;
    let duplicateDetectionStaleReason = null;
    if (lastCompletedDupJob) {
      const completedMs = lastCompletedDupJob.completedAt ? new Date(lastCompletedDupJob.completedAt).getTime() : null;
      const newestRecordAt = newestRecordAgg?._max?.createdAt || null;
      const newestMs = newestRecordAt ? new Date(newestRecordAt).getTime() : null;
      let scannedProjectCount = null;
      try {
        const st = JSON.parse(lastCompletedDupJob.statsJson || '{}');
        if (Number.isFinite(st?.projectRecordCount)) scannedProjectCount = st.projectRecordCount;
      } catch { /* unparseable stats → timestamp rule only */ }
      if (completedMs != null && newestMs != null && newestMs > completedMs) {
        duplicateDetectionStale = true;
        duplicateDetectionStaleReason = 'records_added';
      } else if (scannedProjectCount != null && scannedProjectCount !== total) {
        duplicateDetectionStale = true;
        duplicateDetectionStaleReason = 'record_count_changed';
      }
    }
    const duplicateDetection = {
      status: duplicateDetectionStatus,
      lastCompletedAt: lastCompletedDupJob?.completedAt || null,
      // Only a failed run carries a user-facing message (the worker clears `error`
      // on every claim); truncated so a pathological message can never bloat the
      // overview payload.
      lastError: duplicateDetectionStatus === 'failed' && latestDupJob?.error
        ? String(latestDupJob.error).slice(0, 300)
        : null,
      stale: duplicateDetectionStale,
      staleReason: duplicateDetectionStaleReason,
    };

    // Disputed = records with >1 distinct non-undecided decision at title/abstract.
    const byRecord = {};
    decisions.forEach(d => {
      if (d.stage === 'title_abstract' && d.decision !== 'undecided') {
        (byRecord[d.recordId] ||= new Set()).add(d.decision);
      }
    });
    const disputedDecisions = Object.values(byRecord).filter(s => s.size > 1).length;

    // prompt21 follow-up — EXACT, member-visible title/abstract progress for the
    // workflow stepper (previously the stepper only knew "some records advanced").
    // A record's T/A work is done once enough DISTINCT reviewers have weighed in —
    // the same effectiveRequired bar the promotion gate uses (access.js). Records
    // below that bar still need screening. Duplicates are out of the pool.
    // 81.md — floor by the admin-driven global quorum (same as the promotion gate),
    // not the hardcoded QUORUM=2, so T/A "pending" never under-counts when an admin
    // raised minIncludeQuorum. Identical to today under the default (getEffectiveQuorum→2).
    const effectiveRequired = Math.max(Number(access.project.requiredScreeningReviewers) || 2, await getEffectiveQuorum());
    const taReviewers = {};
    decisions.forEach(d => {
      if (d.stage === 'title_abstract' && d.decision !== 'undecided') {
        (taReviewers[d.recordId] ||= new Set()).add(d.reviewerId);
      }
    });
    const screeningPool = records.filter(r => !r.isDuplicate).length;
    const titleAbstractPending = records.filter(r =>
      !r.isDuplicate && r.currentStage === 'title_abstract' &&
      (taReviewers[r.id]?.size || 0) < effectiveRequired
    ).length;

    // ── 110.md §1 — whole-project progress across ALL required reviewers ─────
    // The old headline ("screened at least once / records") read 100% when a single
    // reviewer worked through the whole library, even with the second required pass
    // untouched and every conflict open. Progress is now denominated in reviewer
    // DECISIONS (records x effectiveRequired) plus conflict resolution.
    //
    // Denominator conventions match the rest of this endpoint: duplicates are out of
    // the pool (`screeningPool`, `titleAbstractPending`). A record whose T/A stage has
    // CLOSED (promoted to full_text, or finalised) is reported at the required count —
    // the workflow moved past title/abstract for it, so a leader-resolved conflict that
    // promoted a record on fewer than `effectiveRequired` decisions cannot deadlock the
    // model below 100% forever.
    const taReviewerCountByRecord = new Map(
      (taReviewerGroups || []).map(g => [g.recordId, g?._count?._all || 0])
    );
    const reviewerHistogram = {};
    for (const r of records) {
      if (r.isDuplicate) continue;
      const observed = taReviewerCountByRecord.get(r.id) || 0;
      const taClosed = r.currentStage !== 'title_abstract' || !!r.finalStatus;
      const k = taClosed ? Math.max(observed, effectiveRequired) : observed;
      if (k >= 1) reviewerHistogram[k] = (reviewerHistogram[k] || 0) + 1;
    }
    // 110 review (F6) — the conflict counts fed to the progress model must obey the
    // SAME pool convention as its denominator. `poolSize`/`reviewerHistogram` exclude
    // duplicate-flagged records, but the project-wide `unresolvedConflicts` above does
    // not: a disagreement raised before a record was flagged as a duplicate then added
    // a work unit to `totalUnits` for a record that can never contribute a decision,
    // pinning the strip at 99% with "Conflict resolution — Now" forever. Scoped here
    // (from the records already in memory — no extra query) rather than at line ~72,
    // because `dataSummary.unresolvedConflicts` is the Conflicts TAB badge and must
    // keep matching `listConflicts`, which lists duplicates' conflicts too.
    const poolRecordIds = new Set(records.filter(r => !r.isDuplicate).map(r => r.id));
    const poolConflicts = conflicts.filter(c => poolRecordIds.has(c.recordId));
    const screeningProgress = computeScreeningProgress({
      requiredReviewers: effectiveRequired,
      poolSize: screeningPool,
      reviewerHistogram,
      unresolvedConflicts: poolConflicts.filter(c => !c.resolvedAt).length,
      resolvedConflicts: poolConflicts.filter(c => c.resolvedAt).length,
    });

    const memberProgress = members.map(m => {
      const md = m.userId ? decisions.filter(d => d.reviewerId === m.userId && d.stage === 'title_abstract') : [];
      const c = { include: 0, exclude: 0, maybe: 0 };
      md.forEach(d => { if (c[d.decision] !== undefined) c[d.decision]++; });
      const screened = c.include + c.exclude + c.maybe;
      return {
        id: m.id, userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status,
        canScreen: m.canScreen, canChat: m.canChat, canResolveConflicts: m.canResolveConflicts,
        screened, included: c.include, excluded: c.exclude, maybe: c.maybe,
        undecided: Math.max(0, total - screened),
        progress: total > 0 ? Math.round((screened / total) * 100) : 0,
      };
    });

    const screenedAtLeastOnce = new Set(
      decisions.filter(d => d.stage === 'title_abstract' && d.decision !== 'undecided').map(d => d.recordId)
    ).size;

    // ── Progress visibility (BUG 6) ──────────────────────────────────────────
    // Regular members see ONLY their own progress; the leader sees every member's
    // progress, team comparison, and whole-project progress. Enforced server-side
    // so a non-leader can never receive other members' activity.
    const myProgress = memberProgress.filter(m => m.userId === req.user.id);
    const visibleMembers   = access.isLeader ? memberProgress : myProgress;

    // ── prompt9 (additive): linked META·LAB descriptor for the Overview tab ──
    // null when unlinked; otherwise { id, title, missing, canOpen }.
    // missing = ML row gone OR soft-deleted (any source) OR not owned by the
    // workspace owner (link invariant). canOpen: owner → ML live; member →
    // ML-side view permission (mlAccessFromMember) AND ML live. Title is only
    // disclosed while the target is live. Best-effort — never breaks Overview.
    let linkedMetaLab = null;
    if (access.project.linkedMetaLabProjectId) {
      const linkedId = access.project.linkedMetaLabProjectId;
      let ml = null;
      try {
        ml = await prisma.project.findFirst({
          where: { id: linkedId, userId: access.project.ownerId },
          select: { name: true, deletedAt: true },
        });
      } catch { ml = null; }
      const live = !!ml && !ml.deletedAt;
      const canOpen = live && (
        access.isOwner ||
        (access.member ? !!mlAccessFromMember(access.member).canView : false)
      );
      linkedMetaLab = {
        id: linkedId,
        title: live ? ml.name : null,
        missing: !live,
        canOpen,
      };
    }
    const wholeProjectProgress = access.isLeader ? {
      totalArticles: total,
      screened: screenedAtLeastOnce,
      unscreened: Math.max(0, total - screenedAtLeastOnce),
      eligibleSecondReview, acceptedToExtraction, conflicts: unresolvedConflicts,
      completion: total > 0 ? Math.round((screenedAtLeastOnce / total) * 100) : 0,
    } : null;

    res.json({
      project: {
        id: access.project.id, title: access.project.title,
        blindMode: access.project.blindMode, progressStatus: access.project.progressStatus,
        linkedMetaLabProjectId: access.project.linkedMetaLabProjectId, stage: access.project.stage,
        // prompt23 Task 11 — report the EFFECTIVE required-reviewer count (driven by
        // the project's requiredScreeningReviewers setting, floored by the global
        // quorum) so every "quorum" label in the UI follows the setting, not a 2.
        quorum: effectiveRequired,
        requiredScreeningReviewers: access.project.requiredScreeningReviewers || effectiveRequired,
      },
      isLeader: access.isLeader, myRole: access.role,
      dataSummary: {
        totalArticles: total,
        // 107.md §1 — kept as the coarse "is there a valid dedup result?" flag
        // (many callers/tests read it); `duplicateDetection` carries the states.
        duplicateDetectionRun,
        duplicateDetection,
        confirmedDuplicates, unresolvedDuplicateGroups, resolvedDuplicateGroups,
        disputedDecisions, unresolvedConflicts,
        eligibleSecondReview, acceptedToExtraction, rejectedSecond,
        // prompt21 follow-up — exact, member-visible title/abstract progress.
        screeningPool, titleAbstractPending,
        // 110.md §1 — additive. The multi-reviewer progress model (stage strip +
        // decision-denominated completion). Every field above is unchanged; the
        // legacy `projectProgress.completion` is kept for existing consumers.
        screeningProgress,
      },
      members: visibleMembers,
      // null for non-leaders (frontend shows only "My Progress")
      projectProgress: wholeProjectProgress,
      // prompt9 — additive; null when the project is not linked.
      linkedMetaLab,
    });
  } catch (err) {
    console.error('[screening] getOverview:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/audit — leader-only audit trail. */
export async function getAuditLog(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isLeader) return res.status(403).json({ error: 'Only the project leader can view the audit log' });
    const entries = await prisma.screenAuditLog.findMany({
      where: { projectId: access.project.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({
      entries: entries.map(e => ({
        id: e.id, actorId: e.actorId, actorName: e.actorName, action: e.action,
        entityType: e.entityType, entityId: e.entityId,
        details: (() => { try { return JSON.parse(e.details); } catch { return {}; } })(),
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    console.error('[screening] getAuditLog:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}


/**
 * GET /projects/:pid/prisma — 103.md §10/§12. The canonical PRISMA flow, derived
 * from the project's actual records.
 *
 * Every box carries the record ids behind it, so a client can answer "which records
 * created this number?" (§12) without a second request, and the reconciliation
 * report says whether the flow is internally consistent (§13).
 */
export async function getPrismaFlow(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    await ensureLeaderMember(access.project);

    const result = await loadPrismaFlow(access.project.id, {
      previous: req.query.previousStudies
        ? { studies: Number(req.query.previousStudies) || 0, reports: Number(req.query.previousReports) || 0 }
        : null,
    });
    // No records yet is not an error — it is an empty flow, and the UI should say so
    // rather than showing fabricated zeros.
    if (!result) return res.json({ flow: null, reconciliation: null, empty: true });

    const { flow, reconciliation } = result;
    // 116.md §11 — SLIM wire shape: counts + labelled breakdown rows, no id
    // arrays. The ids stay server-side; the box endpoint serves the record lists.
    return res.json({ flow: slimPrismaFlow(flow), reconciliation, empty: false });
  } catch (err) {
    console.error('[screening] getPrismaFlow error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ════════════ 116.md §9-§12 — the per-box record list ════════════ */

const BOX_PAGE_LIMIT_DEFAULT = 50;
const BOX_PAGE_LIMIT_MAX = 200;

/** Facet option rows [{ value, label, n }], sorted by n desc then label. */
function facetRows(counts) {
  return Array.from(counts.values())
    .sort((a, b) => (b.n - a.n) || (a.label < b.label ? -1 : 1));
}

function countFacet(map, value, label) {
  const key = String(value);
  const cur = map.get(key);
  if (cur) cur.n += 1;
  else map.set(key, { value: key, label, n: 1 });
}

/**
 * GET /projects/:pid/prisma/box/:boxId/records — 116.md §9/§11/§12.
 *
 * The paginated, searchable record list behind ONE PRISMA box. The flow is
 * re-derived server-side (one pass — §19), the box's id set selects the records,
 * and q + facet filters + cursor/limit are applied HERE so a 50k-record box never
 * ships to the client.
 *
 * Query: q (title/DOI/PMID), source (casefolded effective source), status
 * (disposition id), reason (casefolded exclusion/not-retrieved reason), retrieval
 * (retrieved|not_retrieved|pending), cursor (opaque offset), limit (≤200).
 *
 * Blinding follows the listRecords convention (81.md): under blindMode a
 * non-leader gets authors/journal suppressed AT THE WIRE, and no reviewer
 * identity ever appears in this list.
 */
export async function getPrismaBoxRecords(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    await ensureLeaderMember(access.project);
    const p = access.project;

    const boxId = String(req.params.boxId || '');
    // An unknown box id is a nonexistent resource, not a validation hint (§9).
    if (!BOX_IDS.includes(boxId)) return res.status(404).json({ error: 'Unknown PRISMA box' });
    const meta = boxMeta(boxId);

    const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), BOX_PAGE_LIMIT_MAX)
      : BOX_PAGE_LIMIT_DEFAULT;
    const cursorRaw = Number.parseInt(String(req.query.cursor ?? ''), 10);
    const offset = Number.isFinite(cursorRaw) ? Math.max(cursorRaw, 0) : 0;
    const q = String(req.query.q || '').trim().toLowerCase();
    const fSource = String(req.query.source || '').trim().toLowerCase();
    const fStatus = String(req.query.status || '').trim();
    const fReason = String(req.query.reason || '').trim().toLowerCase();
    const fRetrieval = String(req.query.retrieval || '').trim();

    const result = await loadPrismaFlow(p.id);
    const box = result && result.flow && result.flow.boxes && result.flow.boxes[boxId];
    if (!result || !box) {
      return res.json({
        boxId, unit: meta.unit, total: 0, listed: 0, uninspectable: 0,
        records: [], nextCursor: null, facets: {}, blindMode: !!p.blindMode,
        isLeader: !!access.isLeader, canEdit: false, canFinalize: false,
      });
    }

    // The studies box counts DISTINCT studies (ids are study keys, not record
    // ids); its inspectable rows are the included REPORTS, grouped by studyId in
    // the response so the §9 "studies + reports attached" shape is explicit.
    const recordIds = boxId === 'included_studies'
      ? result.flow.boxes.included_reports.ids
      : box.ids;
    const idSet = new Set(recordIds);

    const projById = new Map(result.projections.map((pr) => [pr.id, pr]));

    // One indexed query, display columns only (same class of cost as the flow
    // load itself), then in-memory membership + filters — the listRecords
    // in-memory path precedent.
    const rows = await prisma.screenRecord.findMany({
      where: { projectId: p.id },
      select: {
        id: true, title: true, authors: true, year: true, journal: true,
        doi: true, pmid: true, sourceDb: true, importBatchId: true,
        isDuplicate: true, isPrimary: true, duplicateGroupId: true,
        currentStage: true, finalStatus: true, rejectedReason: true,
        identificationSource: true, sourceDetail: true, createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const batches = await prisma.screenImportBatch.findMany({
      where: { projectId: p.id },
      select: { id: true, filename: true, format: true, sourceDatabase: true, createdAt: true },
    });
    const batchById = new Map(batches.map((b) => [b.id, b]));

    const blind = p.blindMode && !access.isLeader;

    const sourceFacet = new Map();
    const statusFacet = new Map();
    const reasonFacet = new Map();
    const retrievalFacet = new Map();

    const candidates = [];
    for (const r of rows) {
      if (!idSet.has(r.id)) continue;
      const proj = projById.get(r.id) || {};
      const disp = dispositionOf(proj);
      const effectiveSource = proj.sourceDb || '';
      const sourceKey = effectiveSource.toLowerCase() || 'unspecified';
      const reasonValue = disp === 'not_retrieved' ? proj.notRetrievedReason : proj.exclusionReason;
      const reasonKey = reasonGroupKey(reasonValue) || 'unrecorded';
      const retrieval = proj.soughtRetrieval
        ? (proj.retrieved === true ? 'retrieved' : proj.retrieved === false ? 'not_retrieved' : 'pending')
        : '';

      countFacet(sourceFacet, sourceKey, effectiveSource || 'Unspecified source');
      countFacet(statusFacet, disp, DISPOSITION_LABELS[disp] || disp);
      if (reasonGroupKey(reasonValue)) countFacet(reasonFacet, reasonKey, displayReason(reasonValue));
      if (retrieval) {
        countFacet(retrievalFacet, retrieval, retrieval === 'retrieved' ? 'Retrieved'
          : retrieval === 'not_retrieved' ? 'Not retrieved' : 'Retrieval pending');
      }

      if (q) {
        const hay = `${r.title || ''}\n${r.doi || ''}\n${r.pmid || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (fSource && sourceKey !== fSource) continue;
      if (fStatus && disp !== fStatus) continue;
      if (fReason && reasonKey !== fReason) continue;
      if (fRetrieval && retrieval !== fRetrieval) continue;

      candidates.push({ r, proj, disp, effectiveSource, retrieval });
    }

    const pageItems = candidates.slice(offset, offset + limit);
    const nextCursor = offset + pageItems.length < candidates.length
      ? String(offset + pageItems.length)
      : null;

    // §10 — who may edit metadata here: the same bar as editing/importing records
    // in Screening (owner/leader, or an active non-viewer member with the
    // import-records permission). Decision actions follow finalizeRecord's bar.
    const canEdit = access.isOwner || access.isLeader
      || !!(access.active && access.member && access.member.role !== 'viewer' && access.perms.canImportRecords);
    const canFinalize = !!(access.isLeader || access.canResolveConflicts);

    const records = pageItems.map(({ r, proj, disp, effectiveSource, retrieval }) => {
      const batch = r.importBatchId ? batchById.get(r.importBatchId) : null;
      return {
        id: r.id,
        title: r.title,
        // 81.md blind-mode convention (listRecords): author/journal info is
        // suppressed at the wire for non-leaders, not just visually.
        authors: blind ? '' : r.authors,
        journal: blind ? '' : r.journal,
        year: r.year,
        doi: r.doi,
        pmid: r.pmid,
        sourceDb: r.sourceDb,
        effectiveSource,
        identificationSource: r.identificationSource || '',
        sourceDetail: r.sourceDetail || '',
        importBatch: batch
          ? {
            id: batch.id, filename: batch.filename, format: batch.format,
            sourceDatabase: batch.sourceDatabase || '',
          }
          : null,
        importedAt: (batch && batch.createdAt) || r.createdAt,
        isDuplicate: !!r.isDuplicate,
        isPrimary: !!r.isPrimary,
        duplicateGroupId: r.duplicateGroupId || null,
        currentStage: r.currentStage,
        finalStatus: r.finalStatus,
        rejectedReason: r.rejectedReason || '',
        disposition: disp,
        dispositionLabel: DISPOSITION_LABELS[disp] || disp,
        exclusionReason: proj.exclusionReason ? displayReason(proj.exclusionReason) : '',
        notRetrievedReason: proj.notRetrievedReason ? displayReason(proj.notRetrievedReason) : '',
        retrieval,
        studyId: proj.studyId || '',
      };
    });

    return res.json({
      boxId,
      unit: meta.unit,
      total: box.n,
      listed: candidates.length,
      // Import-time duplicates were discarded before becoming records: counted,
      // never listable (103.md §2) — the panel says so instead of looking short.
      uninspectable: Math.max(0, box.n - recordIds.length),
      records,
      nextCursor,
      // Facets are computed over the WHOLE box (pre-filter) so options don't
      // vanish as they are used; sent on the first page only.
      facets: offset === 0
        ? {
          source: facetRows(sourceFacet),
          status: facetRows(statusFacet),
          reason: facetRows(reasonFacet),
          retrieval: facetRows(retrievalFacet),
        }
        : undefined,
      blindMode: !!p.blindMode,
      isLeader: !!access.isLeader,
      canEdit,
      canFinalize,
    });
  } catch (err) {
    console.error('[screening] getPrismaBoxRecords error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
