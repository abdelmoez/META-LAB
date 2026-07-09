/**
 * projectsController.js
 * CRUD handlers for Project resources.
 * All handlers are async and user-scoped via req.user.id.
 */

import { randomBytes } from 'crypto';
import { getAll, getById, save, remove, getByIdUnscoped, getManyByIds, saveAsMember } from '../store.js';
import { mkProject } from '../../src/research-engine/project-model/defaults.js';
import { prisma } from '../db/client.js';
import { getMetaLabMemberAccess, listSharedMetaLabAccess } from '../screening/metalabAccess.js';
import { createLinkedScreenProject } from '../screening/createScreenProject.js';
import { ensureScreenModuleForMetaLab } from '../screening/ensureWorkspace.js';
import { emitToMetaLabProject, emitToProjectMembers } from '../realtime/bus.js';
import { writeAudit } from '../screening/access.js';
// 67.md — product-tier enforcement (admin/mod bypass inside the service).
import { requireEntitlement, requireLimit, sendTierLimit } from '../services/entitlementService.js';
import { recordUsage, USAGE } from '../utils/usage.js';
import { screeningCountSelect, DECIDED_FINAL_STATUSES, classifyDecided } from '../utils/screeningCounts.js';
import { onlineCountsFor } from '../realtime/presence.js';
// 75.md Phases 8-9 (Workstream D) — the ONE canonical workflow-progress model.
import { computeProjectProgress } from '../../src/research-engine/progress/projectProgress.js';
import { getModuleState } from '../services/workflowState.js';
import { getEffectiveFeatureFlags } from './settingsController.js';

const generateId = () => randomBytes(4).toString('hex');

// The moduleKey the Search Builder persists its strategy under (mirrors
// searchEngineController.SEARCH_MODULE). Read best-effort for the search step.
const SEARCH_MODULE_KEY = 'search';

/**
 * 75.md — build the transient `_progress` annotation from data already resolved in
 * the controller: the parsed blob (`projectObj`), the linked-workspace summary
 * (`linkedSift` → decided/pool/record counts + progressStatus) and an optional
 * per-project `progressCtx` (search-module evidence, RoB counts, feature flags).
 * All inputs are already loaded on the GET paths, so this adds ZERO client fetches;
 * `_`-prefix guarantees strip-on-persist (store.projectToData drops `_`-keys).
 */
function progressAnnotation(projectObj, linkedSift, progressCtx) {
  const evidence = {
    screening: linkedSift ? {
      decidedCount: linkedSift.decidedCount,
      screenablePool: linkedSift.screenablePool,
      recordCount: linkedSift.recordCount,
      progressStatus: linkedSift.progressStatus,
    } : null,
  };
  if (progressCtx && progressCtx.search) evidence.search = progressCtx.search;
  if (progressCtx && progressCtx.rob) evidence.rob = progressCtx.rob;
  const opts = { networkMetaAnalysis: !!(progressCtx && progressCtx.flags && progressCtx.flags.networkMetaAnalysis) };
  return computeProjectProgress(projectObj, evidence, opts);
}

/**
 * 75.md — resolve the per-project evidence that lives OUTSIDE the blob for the
 * single-project detail GETs (search strategy + first-class RoB rows). Best-effort:
 * a failed lookup degrades to the blob-derived rule inside computeProjectProgress,
 * never breaking the response. NOT used on the list path (would be N+1).
 * @param {string} projectId
 * @param {{ networkMetaAnalysis?: boolean }} flags
 */
async function loadProgressEvidence(projectId, flags) {
  const ctx = { flags: flags || {} };
  try {
    const mod = await getModuleState(projectId, SEARCH_MODULE_KEY);
    if (mod && mod.revision > 0) {
      const st = mod.state || {};
      ctx.search = {
        revision: mod.revision,
        conceptCount: Array.isArray(st.concepts) ? st.concepts.length : 0,
        searchMode: st.searchMode || null,
        readyForScreening: !!st.readyForScreening,
      };
    }
  } catch { /* best-effort — fall back to the blob search heuristic */ }
  try {
    const rows = await prisma.robAssessment.findMany({
      where: { projectId, deletedAt: null },
      select: { studyId: true },
      distinct: ['studyId'],
    });
    ctx.rob = { assessed: rows.length };
  } catch { /* best-effort — fall back to the blob studies[].rob rule */ }
  return ctx;
}

/** Cheap per-request flag read for progress gating (only `networkMetaAnalysis` today). */
async function progressFlags() {
  try {
    const f = await getEffectiveFeatureFlags();
    return { networkMetaAnalysis: !!f.networkMetaAnalysis };
  } catch {
    return { networkMetaAnalysis: false };
  }
}

/**
 * prompt11 — transient blob-derived counts for the landing card.
 * Computed BEFORE the list strips studies/records (the blob is the source).
 * Returns `{ _studyCount, _recordCount }`.
 */
function countsFromBlob(projectObj) {
  return {
    _studyCount: Array.isArray(projectObj?.studies) ? projectObj.studies.length : 0,
    _recordCount: Array.isArray(projectObj?.records) ? projectObj.records.length : 0,
  };
}

/**
 * prompt11 / 63.md — normalise the linked-workspace summary for the card.
 * Accepts the map value from screenProjectSummaries; always returns the UNIFORM
 * shape `{ id, title, progressStatus, recordCount, memberCount, decidedCount,
 * onlineCount }` or null. Every numeric field defaults to 0 — IDENTICAL shape for
 * owned and shared projects (63.md data contract). decidedCount/onlineCount are
 * layered on by listProjects (batched groupBy + in-memory presence) and may be
 * absent on the base summary, hence the `?? 0` guards.
 */
function linkedSiftSummary(linked) {
  if (!linked) return null;
  return {
    id: linked.id,
    title: linked.title || '',
    progressStatus: linked.progressStatus ?? null,
    recordCount: linked.recordCount ?? 0,
    // 63.md M6 — duplicate-free screening pool (the REAL progress denominator,
    // mirrors screeningOverviewController's `records.filter(r => !r.isDuplicate)`).
    // recordCount stays the raw "studies imported" KPI; falls back to recordCount.
    screenablePool: linked.screenablePool ?? linked.recordCount ?? 0,
    memberCount: linked.memberCount ?? 0,
    decidedCount: linked.decidedCount ?? 0,
    onlineCount: linked.onlineCount ?? 0,
  };
}

/**
 * Attach transient collaboration annotations to a project the user accesses as a
 * member. `meta` carries prompt11 archive flags `{ archived, archivedAt }` from
 * the live DB row (the blob does not hold these first-class columns).
 */
function annotateShared(projectObj, acc, owner, meta = {}, linked = null, progressCtx = null) {
  // 63.md — prefer the DB-computed summary (full uniform shape) when listProjects
  // resolved it; fall back to the id/title carried by the membership access so the
  // card never loses the link even if the summary lookup came back empty.
  const linkedSift = linked
    ? linkedSiftSummary(linked)
    : (acc.screenProjectId
        ? linkedSiftSummary({ id: acc.screenProjectId, title: acc.screenProjectTitle || '' })
        : null);
  return {
    ...projectObj,
    // 75.md — canonical workflow progress (transient; stripped on persist).
    _progress: progressAnnotation(projectObj, linkedSift, progressCtx),
    _shared: true,
    _role: acc.role,
    _canEdit: !!acc.canEdit,
    _readOnly: !!acc.readOnly,
    _screenProjectId: acc.screenProjectId,
    _owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
    // prompt11 — archive flags + blob-derived counts (transient, stripped on persist).
    _archived: !!meta.archived,
    _archivedAt: meta.archivedAt ? new Date(meta.archivedAt).toISOString() : null,
    ...countsFromBlob(projectObj),
    // 63.md — keep the top-level _recordCount consistent with the linked
    // screening workspace's real record count when one exists (studies === records);
    // otherwise the blob-derived count from countsFromBlob stands.
    ...(linkedSift ? { _recordCount: linkedSift.recordCount } : {}),
    // prompt6 Tasks 3/8 — linked workspace + caller capability flags. All `_`
    // keys are transient and stripped on persist (store.projectToData).
    // 63.md — shared cards now carry the SAME full _linkedMetaSift shape as owned
    // (recordCount/memberCount/decidedCount/onlineCount), resolved by listProjects.
    _linkedMetaSift: linkedSift,
    _permissions: {
      role: acc.role,
      isOwner: false,
      canView: !!acc.canView,
      canEdit: !!acc.canEdit,
      readOnly: !!acc.readOnly,
      canExport: !!acc.canExport,
      canAssessRiskOfBias: !!acc.canAssessRiskOfBias, // prompt41 Task 5 — surface RoB grant to the UI
      canRunAnalysis: !!acc.canRunAnalysis,           // 78.md #2 — surface the Analysis grant to the UI
    },
  };
}

/**
 * Owner-side annotations (prompt6 Tasks 3/8): full permissions + linked workspace.
 * `meta` carries prompt11 archive flags `{ archived, archivedAt }` from the live
 * DB row (the blob does not hold these first-class columns).
 */
function annotateOwned(projectObj, linked, meta = {}, progressCtx = null) {
  const linkedSift = linkedSiftSummary(linked);
  return {
    ...projectObj,
    // 75.md — canonical workflow progress (transient; stripped on persist).
    _progress: progressAnnotation(projectObj, linkedSift, progressCtx),
    _archived: !!meta.archived,
    _archivedAt: meta.archivedAt ? new Date(meta.archivedAt).toISOString() : null,
    ...countsFromBlob(projectObj),
    // 63.md — keep the top-level _recordCount consistent with the linked
    // workspace's real record count when one exists (studies === records).
    ...(linkedSift ? { _recordCount: linkedSift.recordCount } : {}),
    _linkedMetaSift: linkedSift,
    _permissions: { role: 'owner', isOwner: true, canView: true, canEdit: true, readOnly: false, canExport: true, canAssessRiskOfBias: true, canRunAnalysis: true },
  };
}

/**
 * Batch ScreenProject summaries for the project-list cards (63.md AREA 2 — ONE
 * query, no N+1). Two lookup modes share the SAME select + the SAME uniform
 * summary shape so OWNED and SHARED cards can never diverge:
 *
 *   by:'linked'  — reverse-lookup from META·LAB project ids. Filters
 *                  `linkedMetaLabProjectId IN ids` AND `ownerId === ownerId`,
 *                  enforcing the link invariant (ScreenProject.ownerId ===
 *                  Project.userId) and blocking any foreign-link leak. The Map is
 *                  keyed by linkedMetaLabProjectId (the META·LAB project id), and
 *                  the oldest workspace wins when a project is linked twice. Uses
 *                  the @@index on ScreenProject.linkedMetaLabProjectId. (owned path)
 *
 *   by:'screenId' — direct lookup by ScreenProject id. Filters `id IN ids` with
 *                  NO ownerId (a shared member is NOT the owner — the link
 *                  invariant for these is already enforced upstream in listProjects
 *                  via accById[id].ownerId). The Map is keyed by ScreenProject id.
 *                  (shared path)
 *
 * Returns Map(lookupId -> { id, title, progressStatus, recordCount, memberCount }).
 * The lookupId is whatever the caller will use to find the summary: the META·LAB
 * project id for 'linked', the ScreenProject id for 'screenId'. decidedCount and
 * onlineCount are layered on by listProjects after this returns.
 *
 * 58.md §1 — memberCount = ACTIVE accepted members only (screeningCountSelect),
 * the ONE canonical denominator; the Overview reads the same scalar so they can
 * never disagree.
 */
async function screenProjectSummaries(ids, { by = 'linked', ownerId } = {}) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  // Chunk the id list. A very large `in (...)` on the dashboard (a user/admin with
  // hundreds of projects) intermittently trips a Prisma/SQLite query-engine panic
  // ("no entry found for key"), which 500s the whole projects list. Batching keeps
  // each query small + reliable and is a no-op for the common small-list case.
  const CHUNK = 200;
  const idChunks = [];
  for (let i = 0; i < ids.length; i += CHUNK) idChunks.push(ids.slice(i, i + CHUNK));
  const select = {
    id: true,
    title: true,
    linkedMetaLabProjectId: true,
    progressStatus: true,
    _count: { select: screeningCountSelect() },
  };
  // Run the chunks SEQUENTIALLY — the SQLite query-engine panic this guards against is
  // aggravated by concurrent reads, so fewer in-flight queries is more reliable here.
  const rows = [];
  for (const chunk of idChunks) {
    const where = by === 'screenId'
      ? { id: { in: chunk } }
      : { linkedMetaLabProjectId: { in: chunk }, ownerId };
    const group = await prisma.screenProject.findMany({ where, select, orderBy: { createdAt: 'asc' } });
    rows.push(...group);
  }
  for (const r of rows) {
    // 'linked' keys by the META·LAB project id (reverse lookup); 'screenId' keys
    // by the ScreenProject id (direct lookup). oldest-wins via the asc order + the
    // has() guard, matching the prompt11 reverse-lookup behaviour.
    const key = by === 'screenId' ? r.id : r.linkedMetaLabProjectId;
    if (key == null || out.has(key)) continue;
    out.set(key, {
      id: r.id,
      title: r.title,
      progressStatus: r.progressStatus,
      recordCount: r._count?.records ?? 0,
      memberCount: r._count?.members ?? 0,
    });
  }
  return out;
}

/**
 * 63.md AREA 2/4 — layer the real decidedCount + onlineCount onto a SINGLE
 * ScreenProject summary (the single-project getProject paths). decidedCount is a
 * cheap scoped count of terminally-decided records; onlineCount reads the
 * in-memory presence room. Both default to 0; pass-through null. Mirrors the
 * batched `withCounts` used by listProjects so the list and the detail view emit
 * an IDENTICAL _linkedMetaSift shape.
 */
async function enrichSummaryCounts(summary) {
  if (!summary) return null;
  let decidedCount = 0;
  // 63.md M6 — duplicate-free screening pool (same denominator as the list +
  // the Overview). Defaults to recordCount so list and detail agree even if the
  // count fails. recordCount stays the raw "studies imported" KPI.
  let screenablePool = summary.recordCount ?? 0;
  try {
    decidedCount = await prisma.screenRecord.count({
      where: { projectId: summary.id, finalStatus: { in: DECIDED_FINAL_STATUSES } },
    });
  } catch { /* best-effort — a count failure must never break getProject */ }
  try {
    screenablePool = await prisma.screenRecord.count({
      where: { projectId: summary.id, isDuplicate: false },
    });
  } catch { /* best-effort — fall back to recordCount */ }
  return { ...summary, decidedCount, screenablePool, onlineCount: onlineCountsFor([summary.id])[summary.id] || 0 };
}

/**
 * prompt6 Task 18 — sync-if-in-sync rename propagation.
 * When a META·LAB project is renamed and a linked ScreenProject's title was
 * EQUAL to the old name (the pair was "in sync"), rename the workspace too.
 * Best-effort: a sync failure must never fail (or slow) the rename itself.
 * Returns true when at least one workspace title was updated.
 */
async function syncLinkedTitleIfInSync(projectId, ownerUserId, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return false;
  try {
    const r = await prisma.screenProject.updateMany({
      where: { linkedMetaLabProjectId: projectId, ownerId: ownerUserId, title: oldName },
      data: { title: newName },
    });
    return r.count > 0;
  } catch {
    return false; // best-effort — never propagate
  }
}

/**
 * GET /api/projects
 * Returns a lightweight list of all projects for the authenticated user
 * (omits studies and records arrays for performance).
 */
// A transient Prisma/SQLite query-engine panic ("no entry found for key" at
// record.rs) that intermittently hits a big `in (...)` read — the SAME query
// succeeds on a retry, so these are safe to re-run for a read-only assembly.
function isTransientPrismaPanic(e) {
  return e?.name === 'PrismaClientRustPanicError'
    || /no entry found for key|query engine.*panic|panicked at/i.test(String(e?.message || ''));
}

export async function listProjects(req, res) {
  // The projects-list assembly fans out many concurrent queries over a potentially
  // large dataset; on SQLite the engine can intermittently panic on one of them and
  // 500 the whole dashboard. Retry a transient engine panic a few times (the read is
  // idempotent) before surfacing the error.
  for (let attempt = 0; ; attempt++) {
  try {
    const full = req.query.full === 'true' || req.query.full === '1';
    // prompt11 — by default EXCLUDE user-facing archived projects (owned + shared).
    // The flag (?includeArchived=1|true) surfaces them so the landing can show an
    // "Archived" view.
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';

    // Projects the user OWNS (archived filtered out at the store unless requested).
    const owned = await getAll(req.user.id, { includeArchived });

    // Batch the owned rows' first-class archive columns — the blob (rowToProject)
    // does not carry them. Drives the transient _archived/_archivedAt card fields.
    const ownedArchiveRows = owned.length
      ? await prisma.project.findMany({
          where: { id: { in: owned.map(p => p.id) } },
          select: { id: true, archived: true, archivedAt: true },
        })
      : [];
    const ownedArchiveById = new Map(ownedArchiveRows.map(r => [r.id, r]));

    // Projects the user can access AS A MEMBER of a linked Review Workspace
    // (prompt5 Task 4 §4 — the META·LAB list must include member projects too).
    // 63.md AREA 2 — we resolve the shared SUMMARIES here but DEFER annotation
    // until after the cross-list batched decidedCount/onlineCount queries, so the
    // shared cards carry the SAME full _linkedMetaSift shape as owned cards.
    const sharedAccess = await listSharedMetaLabAccess(req.user.id);
    let sharedCtx = null; // { items: [{ p, acc, owner, meta }], summaryByMlId }
    if (sharedAccess.length) {
      const ids = sharedAccess.filter(s => s.metaLabProjectId).map(s => s.metaLabProjectId);
      // Only existing, non-deleted projects the user does not already own.
      const ownedIds = new Set(owned.map(p => p.id));
      const rows = await prisma.project.findMany({
        where: { id: { in: ids }, deletedAt: null },
        // prompt11 — pull archive columns so shared archived projects can be
        // excluded by default and the transient card fields populated.
        select: { id: true, userId: true, archived: true, archivedAt: true },
      });
      const liveById = new Map(rows.map(r => [r.id, r]));
      const accById = Object.fromEntries(sharedAccess.map(s => [s.metaLabProjectId, s]));
      // SECURITY: only surface a shared project when it is live, not already owned,
      // AND actually owned by the workspace owner (enforces the link invariant —
      // blocks any foreign-link leak), mirroring getMetaLabMemberAccess.
      // prompt11 — also drop archived shared projects unless includeArchived.
      const fetchIds = [...new Set(ids)].filter(id =>
        liveById.has(id) && !ownedIds.has(id) && liveById.get(id).userId === accById[id]?.ownerId
        && (includeArchived || !liveById.get(id).archived));
      const projObjs = await getManyByIds(fetchIds);
      // Resolve owner display info in one batch.
      const ownerIds = [...new Set(fetchIds.map(id => liveById.get(id).userId))];
      const owners = ownerIds.length
        ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
        : [];
      const ownerById = Object.fromEntries(owners.map(o => [o.id, o]));
      const items = projObjs.map(p => {
        const row = liveById.get(p.id);
        return {
          p, acc: accById[p.id], owner: ownerById[row.userId] || null,
          meta: { archived: row.archived, archivedAt: row.archivedAt },
        };
      });
      // 63.md AREA 2 — batch the shared ScreenProject summaries by ScreenProject id
      // (by:'screenId', NO ownerId — the member is not the owner; the link invariant
      // is already enforced above via accById[id].ownerId). Keyed by ScreenProject id.
      const sharedScreenProjectIds = [...new Set(items.map(it => it.acc?.screenProjectId).filter(Boolean))];
      const summaryByScreenId = await screenProjectSummaries(sharedScreenProjectIds, { by: 'screenId' });
      sharedCtx = { items, summaryByScreenId };
    }

    // prompt6 Tasks 3/8 / 63.md AREA 2 — owned linked summaries, reverse-looked-up
    // by META·LAB project id and owner-scoped (the link invariant). Keyed by the
    // META·LAB project id.
    const ownedSummaryByMlId = await screenProjectSummaries(owned.map(p => p.id), { by: 'linked', ownerId: req.user.id });

    // 63.md AREA 2 — ONE batched decidedCount query for the WHOLE list (owned +
    // shared), keyed by ScreenProject id. decidedCount = ScreenRecords terminally
    // decided (finalStatus ∈ accepted|rejected) — the REAL progress numerator.
    const allScreenProjectIds = [
      ...[...ownedSummaryByMlId.values()].map(s => s.id),
      ...(sharedCtx ? [...sharedCtx.summaryByScreenId.values()].map(s => s.id) : []),
    ];
    let decidedByScreenId = new Map();
    if (allScreenProjectIds.length) {
      const decidedRows = await prisma.screenRecord.groupBy({
        by: ['projectId'],
        where: { projectId: { in: allScreenProjectIds }, finalStatus: { in: DECIDED_FINAL_STATUSES } },
        _count: { _all: true },
      });
      decidedByScreenId = classifyDecided(decidedRows);
    }

    // 63.md M6 — ONE batched duplicate-free pool count for the WHOLE list, keyed
    // by ScreenProject id. screenablePool = ScreenRecords with isDuplicate:false —
    // the REAL progress denominator (mirrors screeningOverviewController's
    // `records.filter(r => !r.isDuplicate)`). recordCount stays the raw "studies
    // imported" KPI. Same groupBy shape as `decided` above (no N+1).
    let screenablePoolByScreenId = new Map();
    if (allScreenProjectIds.length) {
      const poolRows = await prisma.screenRecord.groupBy({
        by: ['projectId'],
        where: { projectId: { in: allScreenProjectIds }, isDuplicate: false },
        _count: { _all: true },
      });
      screenablePoolByScreenId = classifyDecided(poolRows);
    }

    // 63.md AREA 4 — per-ScreenProject online counts from the in-memory presence
    // rooms (sync, cheap, never throws). Keyed by ScreenProject id.
    const onlineByScreenId = onlineCountsFor(allScreenProjectIds);

    // Enrich a base summary (keyed however the caller looked it up) with the two
    // layered, ScreenProject-id-keyed counts. decidedCount/onlineCount default 0.
    const withCounts = (summary) => summary && {
      ...summary,
      decidedCount: decidedByScreenId.get(summary.id) || 0,
      // 63.md M6 — duplicate-free pool; default to the raw recordCount (then 0)
      // when no rows came back, so the denominator is never below the numerator.
      screenablePool: screenablePoolByScreenId.get(summary.id) ?? summary.recordCount ?? 0,
      onlineCount: onlineByScreenId[summary.id] || 0,
    };

    // 75.md — ONE flag read for the whole list drives nma-gating in every card's
    // `_progress`. The list stays cheap: no per-project search/RoB lookups (that
    // would be N+1), so each card's search/rob steps use the blob-derived fallback.
    const listProgressCtx = { flags: await progressFlags() };

    // prompt6 Tasks 3/8 — annotate owned rows with their linked META·SIFT
    // workspace + full owner permissions.
    const annotatedOwned = owned.map(p => {
      const ar = ownedArchiveById.get(p.id);
      return annotateOwned(
        p, withCounts(ownedSummaryByMlId.get(p.id)) || null,
        { archived: ar?.archived, archivedAt: ar?.archivedAt },
        listProgressCtx,
      );
    });

    // 63.md AREA 2 — annotate shared rows with the SAME full _linkedMetaSift shape.
    const shared = sharedCtx
      ? sharedCtx.items.map(({ p, acc, owner, meta }) => {
          const summary = acc?.screenProjectId ? sharedCtx.summaryByScreenId.get(acc.screenProjectId) : null;
          return annotateShared(p, acc, owner, meta, withCounts(summary) || null, listProgressCtx);
        })
      : [];

    const all = [...annotatedOwned, ...shared];
    res.json(full ? all : all.map(({ studies, records, ...meta }) => meta));
    return;
  } catch (err) {
    if (isTransientPrismaPanic(err) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1))); // brief backoff, then retry
      continue;
    }
    console.error('[projects] listProjects error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  }
}

/**
 * POST /api/projects
 * Body: { name: string, createLinkedSift?: boolean }
 *
 * Creates a new project. Legacy shape (no opt-in): returns the bare project.
 * With `createLinkedSift: true` (prompt6 Task 2 — the frontend checkbox sends
 * it by default; the API default stays OFF so old clients/tests don't drift),
 * also creates a linked META·SIFT ScreenProject server-side (same owner, same
 * title, PICO snapshot, seeded reasons/keywords, owner member row) and returns
 * `{ project, linkedScreenProject }`. If the SIFT side fails, the META·LAB
 * project is NEVER rolled back — returns `{ project, linkedScreenProject:
 * null, warning }` instead.
 */
export async function createProject(req, res) {
  try {
    const { name, createLinkedSift } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    // 67.md — product-tier gate (admins/mods bypass inside the service). The
    // active-project limit counts live (non-deleted) projects the user owns.
    try {
      await requireEntitlement(req.user, 'projects.create');
      const activeCount = await prisma.project.count({ where: { userId: req.user.id, deletedAt: null } });
      await requireLimit(req.user, 'projects.maxActiveProjects', activeCount + 1);
    } catch (tierErr) {
      if (sendTierLimit(res, tierErr)) return;
      throw tierErr;
    }
    const project = mkProject(name.trim());
    const saved = await save(project, req.user.id);

    // Legacy response shape when the caller does not opt in.
    if (createLinkedSift !== true) return res.status(201).json(saved);

    try {
      const linkedScreenProject = await createLinkedScreenProject({
        ownerId: req.user.id,
        title: saved.name,
        linkedMetaLabProjectId: saved.id,
        mlData: saved,
      });
      return res.status(201).json({
        project: annotateOwned(saved, { id: linkedScreenProject.id, title: linkedScreenProject.title }),
        linkedScreenProject,
      });
    } catch (siftErr) {
      console.error('[projects] linked META·SIFT creation failed:', siftErr.message);
      return res.status(201).json({
        project: annotateOwned(saved, null),
        linkedScreenProject: null,
        warning: 'Project created, but the linked Screening project could not be created. You can create or link one later from Screening.',
      });
    }
  } catch (err) {
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.status(403).json({ error: 'You do not have permission to modify this project' });
    }
    console.error('[projects] createProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/projects/:id
 * Returns the full project object (user-scoped).
 */
export async function getProject(req, res) {
  try {
    // Owner path — annotated with the linked workspace + full permissions
    // (prompt6 Tasks 3/8).
    const project = await getById(req.params.id, req.user.id);
    if (project) {
      const links = await screenProjectSummaries([project.id], { by: 'linked', ownerId: req.user.id });
      const linked = await enrichSummaryCounts(links.get(project.id) || null);
      // prompt11 — archive flags come from the first-class columns, not the blob.
      const ar = await prisma.project.findUnique({
        where: { id: project.id }, select: { archived: true, archivedAt: true },
      });
      // 75.md — the detail GET carries the ACCURATE `_progress`: real search-strategy
      // + first-class RoB evidence, flag-gated nma. Both Overview and Workspace read
      // it off this one call (no extra client fetch).
      const progressCtx = await loadProgressEvidence(project.id, await progressFlags());
      return res.json(annotateOwned(project, linked, ar || {}, progressCtx));
    }

    // Member path (prompt5 Task 4): access a linked-workspace project they don't own.
    const acc = await getMetaLabMemberAccess(req.params.id, req.user.id);
    if (!acc) return res.status(404).json({ error: 'Project not found' });
    const raw = await getByIdUnscoped(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Project not found' });
    const owner = await prisma.user.findUnique({ where: { id: acc.ownerId }, select: { id: true, name: true, email: true } });
    const ar = await prisma.project.findUnique({
      where: { id: raw.id }, select: { archived: true, archivedAt: true },
    });
    // 63.md — resolve the FULL linked summary by ScreenProject id so the shared
    // detail view carries the same _linkedMetaSift shape as the list cards.
    let linkedShared = null;
    if (acc.screenProjectId) {
      const sums = await screenProjectSummaries([acc.screenProjectId], { by: 'screenId' });
      linkedShared = await enrichSummaryCounts(sums.get(acc.screenProjectId) || null);
    }
    // 75.md — shared detail view gets the same accurate `_progress` as the owner.
    const progressCtx = await loadProgressEvidence(raw.id, await progressFlags());
    return res.json(annotateShared(raw, acc, owner, ar || {}, linkedShared, progressCtx));
  } catch (err) {
    console.error('[projects] getProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/projects/:id
 * Partial update — merges provided fields into the existing project.
 * Protects `id`, `studies`, and `records` from overwrite via this route.
 *
 * prompt6 Task 18: a linked-workspace member may also update — in particular
 * rename — when the workspace grants META·LAB edit (owner/leader/canEditMetaLab
 * and not read-only). Outsiders keep 404 (existence-hiding convention).
 * A rename propagates to the linked ScreenProject title IFF the titles were
 * equal before the change (sync-if-in-sync), best-effort, in both paths.
 */
export async function updateProject(req, res) {
  try {
    const { id, studies, records, ...allowed } = req.body || {};

    // Owner path.
    const project = await getById(req.params.id, req.user.id);
    if (project) {
      const updated = { ...project, ...allowed, id: project.id };
      const saved = await save(updated, req.user.id);
      // Soft-deleted row (resurrection guard) → indistinguishable from gone.
      if (!saved) return res.status(404).json({ error: 'Project not found' });
      await syncLinkedTitleIfInSync(project.id, req.user.id, project.name, saved.name);
      // Realtime poke (Task 7) — recipients resolve via the linked workspace.
      emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json(saved);
    }

    // Member path.
    const acc = await getMetaLabMemberAccess(req.params.id, req.user.id);
    if (!acc) return res.status(404).json({ error: 'Project not found' });
    if (!acc.canEdit) {
      return res.status(403).json({ error: 'Read-only access — you do not have permission to edit this project' });
    }
    const raw = await getByIdUnscoped(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Project not found' });
    const updated = { ...raw, ...allowed, id: raw.id };
    const saved = await saveAsMember(updated);
    if (!saved) return res.status(404).json({ error: 'Project not found' });
    const synced = await syncLinkedTitleIfInSync(raw.id, acc.ownerId, raw.name, saved.name);
    // Realtime poke (Task 7) — workspace members + owner, minus the editor.
    emitToMetaLabProject(raw.id, acc.ownerId, { type: 'project.updated' }, { exclude: req.user.id });
    // Keep the response's workspace title fresh when the rename propagated.
    const accOut = synced && acc.screenProjectTitle === raw.name
      ? { ...acc, screenProjectTitle: saved.name }
      : acc;
    const owner = await prisma.user.findUnique({ where: { id: acc.ownerId }, select: { id: true, name: true, email: true } });
    return res.json(annotateShared(saved, accOut, owner));
  } catch (err) {
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.status(403).json({ error: 'You do not have permission to modify this project' });
    }
    console.error('[projects] updateProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/projects/:id
 * Legacy delete path (monolith autosave array-diff sweep). Now a SOFT delete
 * (deletedSource='owner') underneath; the wire contract { deleted: true } is
 * pinned and unchanged.
 */
export async function deleteProject(req, res) {
  try {
    const existed = await remove(req.params.id, req.user.id);
    if (!existed) return res.status(404).json({ error: 'Project not found' });
    recordUsage({
      type: USAGE.PROJECT_DELETED,
      userId: req.user.id,
      metaLabProjectId: req.params.id,
      meta: { source: 'sweep' },
    });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[projects] deleteProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/delete  (prompt9 — explicit owner delete)
 * Body: { confirmName: string, cascadeLinked?: boolean }
 *
 * Typed-name confirmed soft delete. confirmName must equal the project's name
 * exactly (both trimmed) → else 400. With cascadeLinked, the caller's own live
 * linked ScreenProjects are soft-deleted too (audit row written BEFORE the
 * mark — soft delete preserves the ScreenAuditLog history). Owner-scoped: any
 * non-owner (or already-deleted project) gets 404 (existence-hiding).
 * Returns { deleted: true, cascaded: [<screenProjectIds>] }.
 */
export async function ownerDeleteProject(req, res) {
  try {
    const { confirmName, cascadeLinked } = req.body || {};
    const project = await prisma.project.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id,
        OR: [{ deletedSource: null }, { deletedSource: { not: 'owner' } }],
      },
      select: { id: true, name: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const expected = String(project.name || '').trim();
    if (typeof confirmName !== 'string' || confirmName.trim() !== expected) {
      return res.status(400).json({ error: 'Project name does not match' });
    }

    const now = new Date();
    const cascaded = [];
    if (cascadeLinked === true) {
      const linked = await prisma.screenProject.findMany({
        where: { linkedMetaLabProjectId: project.id, ownerId: req.user.id, deletedAt: null },
        select: { id: true, title: true },
      });
      for (const sp of linked) {
        try {
          // Audit BEFORE marking — soft delete keeps ScreenAuditLog rows alive.
          await writeAudit(sp.id, req.user, 'PROJECT_DELETED', {
            entityType: 'project', entityId: sp.id,
            details: { title: sp.title, source: 'metalab-cascade', metaLabProjectId: project.id },
          });
          await prisma.screenProject.update({
            where: { id: sp.id },
            data: { deletedAt: now, deletedSource: 'owner' },
          });
          recordUsage({
            type: USAGE.PROJECT_DELETED,
            userId: req.user.id,
            screenProjectId: sp.id,
            metaLabProjectId: project.id,
            meta: { source: 'cascade' },
          });
          cascaded.push(sp.id);
        } catch (cascadeErr) {
          // Per-workspace best-effort — a single failed cascade must not block
          // the requested delete; the workspace stays live and removable later.
          console.error('[projects] ownerDeleteProject cascade failed:', sp.id, cascadeErr.message);
        }
      }
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { deletedAt: now, deletedSource: 'owner' },
    });
    recordUsage({
      type: USAGE.PROJECT_DELETED,
      userId: req.user.id,
      metaLabProjectId: project.id,
      meta: { source: 'explicit', cascadeLinked: cascaded.length },
    });

    // Realtime pokes — open UIs revalidate, refetch 404s → navigate away.
    emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });
    for (const spId of cascaded) {
      emitToProjectMembers(spId, { type: 'members.changed' }, { exclude: req.user.id });
    }

    return res.json({ deleted: true, cascaded });
  } catch (err) {
    console.error('[projects] ownerDeleteProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Owner-scoped lookup for the archive endpoints (prompt11).
 * Mirrors ownerDeleteProject: hides owner-soft-deleted rows behind 404. Archived
 * rows ARE still returned (archive is reversible — you must be able to unarchive).
 */
async function findOwnedProjectForArchive(id, userId) {
  return prisma.project.findFirst({
    where: {
      id,
      userId,
      OR: [{ deletedSource: null }, { deletedSource: { not: 'owner' } }],
    },
    select: { id: true, name: true, archived: true, archivedAt: true },
  });
}

/**
 * Best-effort cascade of the archive flag onto the caller's OWN linked
 * ScreenProject(s) (linkedMetaLabProjectId===id AND ownerId===userId — the link
 * invariant). Writes an audit row + usage event on each touched workspace.
 * Never throws — a cascade failure must not block the META·LAB archive.
 * @returns {Promise<string[]>} the screenProjectIds whose archived flag changed.
 */
async function cascadeWorkspaceArchive(projectId, user, archived) {
  const touched = [];
  try {
    const linked = await prisma.screenProject.findMany({
      where: {
        linkedMetaLabProjectId: projectId,
        ownerId: user.id,
        deletedAt: null,
        archived: !archived, // only those whose state actually changes
      },
      select: { id: true, title: true },
    });
    for (const sp of linked) {
      try {
        await prisma.screenProject.update({
          where: { id: sp.id },
          data: { archived },
        });
        await writeAudit(sp.id, user, archived ? 'PROJECT_ARCHIVED' : 'PROJECT_UNARCHIVED', {
          entityType: 'project', entityId: sp.id,
          details: { title: sp.title, source: 'metalab-cascade', metaLabProjectId: projectId },
        });
        recordUsage({
          type: archived ? USAGE.WORKSPACE_ARCHIVED : USAGE.WORKSPACE_UNARCHIVED,
          userId: user.id,
          screenProjectId: sp.id,
          metaLabProjectId: projectId,
          meta: { source: 'metalab-cascade' },
        });
        emitToProjectMembers(sp.id, { type: 'project.updated' }, { exclude: user.id });
        touched.push(sp.id);
      } catch (perErr) {
        console.error('[projects] cascadeWorkspaceArchive failed:', sp.id, perErr.message);
      }
    }
  } catch (err) {
    console.error('[projects] cascadeWorkspaceArchive lookup failed:', err.message);
  }
  return touched;
}

/**
 * POST /api/projects/:id/archive  (prompt11 — owner-only, reversible hide)
 *
 * Sets `archived=true, archivedAt=now`. Best-effort cascade: archive the caller's
 * own linked ScreenProject(s). Owner-scoped: non-owner / owner-soft-deleted → 404.
 * Idempotent. Returns { archived: true, archivedAt }.
 */
export async function archiveProject(req, res) {
  try {
    const project = await findOwnedProjectForArchive(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const now = new Date();
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { archived: true, archivedAt: now },
      select: { archivedAt: true },
    });

    // Cascade onto the linked workspace(s) (best-effort; writes its own audit/usage).
    const cascaded = await cascadeWorkspaceArchive(project.id, req.user, true);

    recordUsage({
      type: USAGE.PROJECT_ARCHIVED,
      userId: req.user.id,
      metaLabProjectId: project.id,
      meta: { cascaded: cascaded.length },
    });

    // Open UIs revalidate and drop the project from active lists.
    emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });

    return res.json({ archived: true, archivedAt: updated.archivedAt });
  } catch (err) {
    console.error('[projects] archiveProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/unarchive  (prompt11 — owner-only)
 *
 * Sets `archived=false, archivedAt=null`. Cascade: unarchive the caller's own
 * linked ScreenProject(s). Owner-scoped: non-owner / owner-soft-deleted → 404.
 * Idempotent. Returns { archived: false }.
 */
export async function unarchiveProject(req, res) {
  try {
    const project = await findOwnedProjectForArchive(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await prisma.project.update({
      where: { id: project.id },
      data: { archived: false, archivedAt: null },
    });

    const cascaded = await cascadeWorkspaceArchive(project.id, req.user, false);

    recordUsage({
      type: USAGE.PROJECT_UNARCHIVED,
      userId: req.user.id,
      metaLabProjectId: project.id,
      meta: { cascaded: cascaded.length },
    });

    emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });

    return res.json({ archived: false });
  } catch (err) {
    console.error('[projects] unarchiveProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/projects/:id/autosave
 * Accepts the full project payload (including studies[], records[], and all
 * nested fields) from the client-side window.storage bridge and upserts it.
 * Client-provided IDs (short base-36 strings) are valid and preserved.
 */
export async function autosaveProject(req, res) {
  try {
    const id = req.params.id;
    const fullProject = { ...req.body, id };
    if (!fullProject.name || typeof fullProject.name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    // Owner path — also the create path for brand-new projects (no row yet).
    const existing = await prisma.project.findFirst({ where: { id }, select: { userId: true } });
    if (!existing || existing.userId === req.user.id) {
      const isCreate = !existing;
      const saved = await save(fullProject, req.user.id);
      // Soft-deleted row (resurrection guard, prompt9): a stale tab must never
      // revive a deleted project — and never 4xx (batch contract). Mirror the
      // saveAsMember skipped shape.
      if (!saved) return res.json({ id, skipped: true });
      // 75.md Phase 6 — this endpoint is also a create path (legacy client-id
      // projects). On a brand-new project, eagerly provision the linked screening
      // module (+ atomic owner member row) so it never lingers in the
      // workspace-less/memberCount:0 state. Best-effort + idempotent + owner-scoped:
      // the autosave bridge PUTs every project in one batch, so this must NEVER
      // throw/reject (it would lose the user's OWN edits) — swallow any failure.
      if (isCreate) {
        try {
          await ensureScreenModuleForMetaLab(id, req.user);
        } catch (provErr) {
          console.error('[projects] autosave create — screening module provisioning failed:', provErr.message);
        }
      }
      // Realtime poke (Task 7) — fan out to linked-workspace members (owner is excluded).
      emitToMetaLabProject(id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json(saved);
    }

    // The project exists and is owned by someone else → membership-aware path.
    // IMPORTANT: the META·LAB autosave bridge PUTs every project in one batch, so
    // this endpoint must NEVER reject for a shared/read-only project — that would
    // fail the whole batch and lose the user's OWN edits. Read-only is a silent
    // no-op (prompt5 Task 4 §6).
    const acc = await getMetaLabMemberAccess(id, req.user.id);
    if (acc && acc.canEdit) {
      const saved = await saveAsMember(fullProject);
      if (saved) emitToMetaLabProject(id, acc.ownerId, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json(saved || { id, skipped: true });
    }
    return res.json({ id, skipped: true, readOnly: !!acc, reason: acc ? 'read-only member' : 'no access' });
  } catch (err) {
    // A foreign-owner race in the owner/create path must never 4xx here —
    // the autosave bridge PUTs every project in one batch (see above), so a
    // rejection would lose the user's OWN edits. Skip instead.
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.json({ id: req.params.id, skipped: true, reason: 'no access' });
    }
    console.error('[projects] autosaveProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/duplicate
 * Creates a copy of the project with a new ID and "(copy)" suffix on name.
 */
export async function duplicateProject(req, res) {
  try {
    const original = await getById(req.params.id, req.user.id);
    if (!original) return res.status(404).json({ error: 'Project not found' });
    const { id, createdAt, updatedAt, ...rest } = original;
    const duplicate = { ...rest, id: generateId(), name: `${original.name} (copy)` };
    const saved = await save(duplicate, req.user.id);
    // 75.md Phase 6 — eagerly provision the linked screening module (+ atomic
    // owner member row) at duplicate time, so the new card is consistent with the
    // createLinkedSift path: it shows a workspace + the creator as an owner member
    // immediately, instead of the workspace-less/memberCount:0 state that lasted
    // until Screening was first opened. Best-effort: idempotent + owner-scoped, and
    // a failure NEVER rolls back the duplicate (mirrors createProject's contract).
    try {
      await ensureScreenModuleForMetaLab(saved.id, req.user);
    } catch (provErr) {
      console.error('[projects] duplicate — screening module provisioning failed:', provErr.message);
    }
    res.status(201).json(saved);
  } catch (err) {
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.status(403).json({ error: 'You do not have permission to modify this project' });
    }
    console.error('[projects] duplicateProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
