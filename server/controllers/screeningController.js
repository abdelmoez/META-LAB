/**
 * screeningController.js — META·SIFT Beta API handlers.
 */
// 86.md P1.9 — use the provider-selected, pragma'd SHARED client, not a second
// bare-schema PrismaClient (SQLite-only; splits brain under Postgres, and misses
// the WAL/busy_timeout pragmas applied only to the shared client's connection).
import { prisma } from '../db/client.js';
import { createHash } from 'crypto';
import { detectDuplicatesInProject, recordDuplicateLabels, getDuplicateEvaluation } from '../services/screeningDuplicateService.js';
import { syncConflicts } from '../services/screeningConflictService.js';
import { ELIGIBILITY_ENGINE_REVIEWER_ID } from '../services/screeningEligibilityService.js';
import { touchProjectActivity } from '../store.js';
import {
  parseImportContent, dedupeAndInsertRecords, hasUsableIdentity,
  MAX_RECORDS_PER_IMPORT, DEFAULT_MAX_RECORDS_PER_PROJECT,
} from '../services/screeningImportService.js';
import { kickImportWorker } from '../services/screeningImportWorker.js';
import { getProjectAccess, ensureLeaderMember, writeAudit, QUORUM } from '../screening/access.js';
import { rankItems } from '../../src/research-engine/screening/ai/ranking.js';
import { splitBySource } from '../../src/research-engine/screening/sourceClassify.js';
import { fastListEligible, buildFastListQuery } from '../../src/research-engine/screening/recordListQuery.js';
import { aiFlagEnabled, stripAiInternals } from '../services/screeningAiService.js';
// 62.md — export logic moved into a shared service so the sync route + the async export
// worker share one CSV schema and one row mapping. CV is now capped + run off the event
// loop; large projects stream via the durable job instead of buffering in one request.
import {
  EXPORT_SYNC_MAX, EXPORT_COLUMNS, buildExportRow, buildExportContext, renderRisBlock, renderCsvRow,
  computeExportCvScores, exportContentType,
} from '../services/screeningExportService.js';
import { enqueueExportJob } from '../services/screeningExportWorker.js';
import { scheduleRescore } from '../services/screeningAiJobs.js';
import { emitToProjectMembers, emitToMetaLabProject } from '../realtime/bus.js';
import { getMetaSiftSettings, getEffectiveQuorum } from '../screening/settings.js';
import { resolveScreeningUploadLimit } from '../screening/uploadLimit.js';
// 67.md — product-tier enforcement (admins/mods bypass inside the service). The
// per-project record cap binds to the PROJECT OWNER's tier, not the acting member's.
import { requireEntitlement, requireLimit, sendTierLimit, loadUserForTier, planRecordLimitFor } from '../services/entitlementService.js';
import { requireProjectExport, requireProjectExportEnabled, settleProjectExport, EXPORT_TYPES } from '../services/projectExportGuard.js';
import { snapshotPico } from '../screening/picoSnapshot.js';
import { screeningCountSelect } from '../utils/screeningCounts.js';
import { derivePrismaIdentification } from '../utils/prismaDerive.js';
import {
  scorePair, normalizeTitle, classifyPair, DUP_TYPES,
  isExactDuplicateGroup, pickBulkPrimary, mergeFillBlanks,
} from '../../src/research-engine/screening/deduplication.js';
import fs from 'node:fs';

// Human-readable label per duplicate type (se2.md §10), shown in the UI.
const DUP_TYPE_LABEL = {
  [DUP_TYPES.EXACT]: 'Exact duplicate',
  [DUP_TYPES.PROBABLE]: 'Probable duplicate',
  [DUP_TYPES.POSSIBLE]: 'Possible duplicate',
  [DUP_TYPES.RELATED]: 'Related report — likely not a duplicate',
  [DUP_TYPES.FAMILY]: 'Same study family — not a duplicate record',
  [DUP_TYPES.NOT]: 'Not a duplicate',
};
import { DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS } from '../../src/research-engine/screening/defaultKeywords.js';
import { effectiveKeywords } from '../../src/research-engine/screening/criteriaKeywords.js';
import { isScreeningComplete } from '../utils/screeningCompletion.js';
import { mkProject } from '../../src/research-engine/project-model/defaults.js';
import { filterRecordsByKeywords, countArticlesByKeyword } from '../../src/research-engine/screening/keywordFilter.js';
import { studyFromRecord } from './screeningReviewController.js';
import { recordUsage, USAGE } from '../utils/usage.js';
import { ensureScreenModuleForMetaLab } from '../screening/ensureWorkspace.js';

// Parse a comma-separated keyword param into a clean phrase list.
function parseKeywordParam(v) {
  if (!v) return [];
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}
function parseJsonList(json) {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}

// ── Ownership guard ──────────────────────────────────────────────────
// deletedAt:null — soft-deleted projects are indistinguishable from
// nonexistent, even to their owner (prompt9).
async function getOwnedProject(pid, userId) {
  return prisma.screenProject.findFirst({ where: { id: pid, ownerId: userId, deletedAt: null } });
}

// ── Reviewer-quorum policy (prompt19 Task 9) ─────────────────────────
//
// REQUIRED_REVIEWERS_MIN / MAX bound the per-project requiredScreeningReviewers
// value a leader may set. The floor is 2 because the product guarantees at least
// two reviewers (mirrors getEffectiveQuorum's two-reviewer guarantee); the ceiling
// keeps the requirement sane.
const REQUIRED_REVIEWERS_MIN = 2;
const REQUIRED_REVIEWERS_MAX = 10;

/**
 * Effective number of DISTINCT title/abstract reviewer decisions a record must
 * have before it can advance to full_text for a given project.
 *
 *   effectiveRequired = max(project.requiredScreeningReviewers || 2, getEffectiveQuorum())
 *
 * The per-project value is primary, but it can NEVER drop below the global
 * two-reviewer guarantee (getEffectiveQuorum returns >= 2 when requireTwoReviewers
 * is on). This is the single source of truth for "how many reviewers gate promotion"
 * and is used by saveDecision's auto-promotion.
 */
async function effectiveRequiredReviewers(project) {
  const perProject = Number.isFinite(project?.requiredScreeningReviewers)
    ? project.requiredScreeningReviewers
    : 2;
  const globalQuorum = await getEffectiveQuorum();
  return Math.max(perProject || 2, globalQuorum);
}

// ── Projects ─────────────────────────────────────────────────────────

export async function listProjects(req, res) {
  try {
    // Projects the user OWNS or is an active MEMBER of (collaboration).
    // A member who only holds META·LAB permission (canViewMetaSift=false, e.g. the
    // readonly_metalab preset) is NOT shown META·SIFT projects (Task 4 §8).
    const memberships = await prisma.screenProjectMember.findMany({
      where: { userId: req.user.id, status: 'active' },
      select: { projectId: true, role: true, canViewMetaSift: true },
    });
    const visibleMemberships = memberships.filter(
      m => m.role === 'owner' || m.role === 'leader' || m.canViewMetaSift,
    );
    const memberProjectIds = visibleMemberships.map(m => m.projectId);
    const roleByProject = Object.fromEntries(visibleMemberships.map(m => [m.projectId, m.role]));

    const projects = await prisma.screenProject.findMany({
      // deletedAt:null — soft-deleted projects vanish from every list (prompt9).
      where: { deletedAt: null, OR: [{ ownerId: req.user.id }, { id: { in: memberProjectIds } }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        // 63.md AREA 6 / 58.md §1 — canonical denominator = ACTIVE members only
        // (status:'active'), matching the META·LAB project-list cards. Shared select
        // fragment so the two lists can never drift to different member counts.
        _count: { select: screeningCountSelect() },
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    // Resolve linked META·LAB project titles in one batch (BUG 4 — project cards).
    const linkedIds = [...new Set(projects.map(p => p.linkedMetaLabProjectId).filter(Boolean))];
    const linkedProjects = linkedIds.length
      ? await prisma.project.findMany({ where: { id: { in: linkedIds }, deletedAt: null }, select: { id: true, name: true } })
      : [];
    const linkedTitleById = Object.fromEntries(linkedProjects.map(lp => [lp.id, lp.name]));

    // Leaders are SEPARATE from the owner (prompt5 Task 1). Batch the leader rows for
    // all listed projects so each card can show owner + leaders distinctly.
    const projectIds = projects.map(p => p.id);
    const leaderRows = projectIds.length
      ? await prisma.screenProjectMember.findMany({
          where: { projectId: { in: projectIds }, role: 'leader', status: 'active' },
          select: { projectId: true, name: true, email: true, userId: true },
        })
      : [];
    const leadersByProject = {};
    for (const lr of leaderRows) {
      (leadersByProject[lr.projectId] ||= []).push({ name: lr.name || '', email: lr.email || '', userId: lr.userId });
    }

    res.json({ projects: projects.map(p => {
      const isOwner = p.ownerId === req.user.id;
      // The owner's own role is 'owner' — never 'leader' (Task 1: keep them distinct).
      const myRole = isOwner ? 'owner' : (roleByProject[p.id] || 'reviewer');
      const leaders = leadersByProject[p.id] || [];
      const ownerName = p.owner?.name || p.owner?.email || '';
      return {
        id: p.id, title: p.title, description: p.description,
        reviewQuestion: p.reviewQuestion, stage: p.stage, blindMode: p.blindMode,
        // prompt19 Task 9: per-project reviewer requirement on each card (default 2).
        requiredScreeningReviewers: p.requiredScreeningReviewers ?? 2,
        progressStatus: p.progressStatus, archived: p.archived,
        linkedMetaLabProjectId: p.linkedMetaLabProjectId,
        linkedMetaLabProjectTitle: p.linkedMetaLabProjectId ? (linkedTitleById[p.linkedMetaLabProjectId] || null) : null,
        recordCount: p._count.records, memberCount: p._count.members,
        // ── Owner vs Leader, kept as separate fields (Task 1 §5) ──
        owner: p.owner, isOwner,
        ownerName, ownerEmail: p.owner?.email || '',
        leaders, leaderCount: leaders.length,
        // Back-compat: older UIs read leaderName/leaderEmail — point them at the OWNER
        // so existing "Leader: …" copy still resolves, while new UI uses owner/leaders.
        leaderName: ownerName, leaderEmail: p.owner?.email || '',
        myRole, currentUserRole: myRole,
        totalArticles: p._count.records, status: p.progressStatus,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      };
    })});
  } catch (err) {
    console.error('[screening] listProjects:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createProject(req, res) {
  try {
    const settings = await getMetaSiftSettings();
    if (!settings.allowNewProjects) return res.status(403).json({ error: 'New project creation is currently disabled by the administrator' });
    const { title, description = '', reviewQuestion = '', blindMode, linkedMetaLabProjectId, alsoCreateMetaLab } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
    // Blind mode defaults to the admin-configured default unless the creator chose one.
    const effectiveBlind = blindMode === undefined ? !!settings.defaultBlindMode : !!blindMode;

    // SECURITY (Task 2): a provided link target must be one of the CALLER's own
    // live META·LAB projects (mirrors linkMetaLab/updateProject). Snapshot its
    // PICO at create time — the META·LAB-side "Create & link" path previously
    // left picoSnapshot empty forever.
    let linkedId = null;
    let linkedTitle = null;
    let picoSnapshot; // undefined → schema default '{}'
    if (linkedMetaLabProjectId) {
      const ml = await prisma.project.findFirst({
        where: { id: linkedMetaLabProjectId, userId: req.user.id, deletedAt: null },
        select: { id: true, name: true, data: true },
      });
      if (!ml) return res.status(400).json({ error: 'That PecanRev project was not found in your account' });
      linkedId = ml.id;
      linkedTitle = ml.name;
      const snap = snapshotPico(ml.data);
      if (snap !== '{}') picoSnapshot = snap;
    }

    // Atomic core (75.md Phase 6): the ScreenProject, its seeded exclusion
    // reasons, and the creator's owner member row succeed or fail together — an
    // interactive transaction so ensureLeaderMember writes the owner row inside
    // the SAME transaction and a mid-create failure never orphans an owner-less
    // workspace.
    const defaultReasons = [
      'Wrong population', 'Wrong intervention', 'Wrong comparator',
      'Wrong outcome', 'Wrong study design', 'Duplicate', 'Not accessible',
    ];
    let project = await prisma.$transaction(async (tx) => {
      const sp = await tx.screenProject.create({
        data: {
          ownerId: req.user.id,
          title: title.trim(),
          description,
          reviewQuestion,
          blindMode: effectiveBlind,
          linkedMetaLabProjectId: linkedId,
          ...(picoSnapshot !== undefined ? { picoSnapshot } : {}),
          // Seed editable default keyword suggestions (prompt2 Task 8). Leaders can
          // edit/replace these per project; the highlight/filter panel reads them.
          inclusionKeywords: JSON.stringify(DEFAULT_INCLUDE_KEYWORDS),
          exclusionKeywords: JSON.stringify(DEFAULT_EXCLUDE_KEYWORDS),
        },
      });
      await tx.screenExclusionReason.createMany({
        data: defaultReasons.map(text => ({ projectId: sp.id, text })),
      });
      // The creator automatically becomes the project owner (Part 4).
      await ensureLeaderMember(sp, tx);
      return sp;
    });

    // SIFT-side "Also create META·LAB project" (Task 2 — opt-in, default false,
    // never forced; ignored when an explicit link target was provided).
    // Best-effort: failure leaves the screening project unlinked with a warning
    // in the response instead of failing the request.
    let warning;
    if (!linkedId && alsoCreateMetaLab === true) {
      try {
        // Persist the exact shape store.js writes: id/name as first-class
        // columns, everything else from the mkProject skeleton in the `data` blob.
        const skeleton = mkProject(title.trim());
        const { id: mlId, name: mlName, ...mlBlob } = skeleton;
        await prisma.project.create({
          data: { id: mlId, userId: req.user.id, name: mlName, data: JSON.stringify(mlBlob) },
        });
        linkedTitle = mlName;
        project = await prisma.screenProject.update({
          where: { id: project.id },
          data: { linkedMetaLabProjectId: mlId, picoSnapshot: snapshotPico(skeleton) },
        });
      } catch (mlErr) {
        console.error('[screening] createProject alsoCreateMetaLab:', mlErr.message);
        warning = 'The screening project was created, but the linked PecanRev project could not be created';
      }
    }

    res.status(201).json({
      ...project,
      linkedMetaLabProjectTitle: project.linkedMetaLabProjectId ? linkedTitle : null,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    console.error('[screening] createProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getProject(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    await ensureLeaderMember(access.project);
    const p = await prisma.screenProject.findUnique({
      where: { id: access.project.id },
      include: {
        _count: { select: { records: true, members: true, conflicts: { where: { resolvedAt: null } } } },
      },
    });

    // Linked META·LAB title (Task 3) + lazy PICO snapshot refresh (Task 2).
    // Best-effort: a META·LAB lookup failure must never break getProject, and
    // the snapshot write is compare-before-write and never blocks the response.
    let linkedMetaLabProjectTitle = null;
    if (p.linkedMetaLabProjectId) {
      try {
        const ml = await prisma.project.findFirst({
          where: { id: p.linkedMetaLabProjectId, deletedAt: null },
          select: { name: true, data: true },
        });
        if (ml) {
          linkedMetaLabProjectTitle = ml.name;
          const snap = snapshotPico(ml.data);
          if (snap !== '{}' && snap !== p.picoSnapshot) {
            p.picoSnapshot = snap; // serve the fresh criteria immediately
            prisma.screenProject.update({ where: { id: p.id }, data: { picoSnapshot: snap } }).catch(() => {});
          }
        }
      } catch { /* best-effort — keep the cached snapshot */ }
    }

    res.json({
      ...p,
      linkedMetaLabProjectTitle,
      // prompt19 Task 9: surface the per-project reviewer requirement so the UI can
      // show/edit it. p.requiredScreeningReviewers comes straight from the column
      // (Int @default(2)); fall back to 2 for any legacy row read as null.
      requiredScreeningReviewers: p.requiredScreeningReviewers ?? 2,
      myRole: access.role,
      isLeader: access.isLeader,
      isOwner: access.isOwner,
      canScreen: access.canScreen,
      canChat: access.canChat,
      canResolveConflicts: access.canResolveConflicts,
      canManageMembers: access.canManageMembers,
      canManageSettings: access.canManageSettings,
      perms: access.perms,
    });
  } catch (err) {
    console.error('[screening] getProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateProject(req, res) {
  try {
    // Project settings: owner, leader, or a member granted canManageSettings.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageSettings) return res.status(403).json({ error: 'You do not have permission to change project settings' });
    const p = access.project;

    const {
      title, description, reviewQuestion, stage, blindMode,
      linkedMetaLabProjectId, progressStatus,
      inclusionKeywords, exclusionKeywords, studyTypeFilter, chatRestricted,
      requiredScreeningReviewers,
    } = req.body || {};

    const data = {};

    // prompt19 Task 9: per-project required reviewers. canManageSettings is already
    // enforced above (owner / leader / member with the perm), so reaching here means
    // the caller may edit settings. Validate strictly: must be an integer, then clamp
    // to [REQUIRED_REVIEWERS_MIN, REQUIRED_REVIEWERS_MAX] (the 2-floor preserves the
    // two-reviewer guarantee). Non-integer / non-finite => 400 (no silent coercion).
    let requiredReviewersChange = null; // { from, to } when it actually changes
    if (requiredScreeningReviewers !== undefined) {
      const n = Number(requiredScreeningReviewers);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return res.status(400).json({ error: 'requiredScreeningReviewers must be an integer' });
      }
      const clamped = Math.min(REQUIRED_REVIEWERS_MAX, Math.max(REQUIRED_REVIEWERS_MIN, n));
      const current = Number.isFinite(p.requiredScreeningReviewers) ? p.requiredScreeningReviewers : 2;
      if (clamped !== current) {
        data.requiredScreeningReviewers = clamped;
        requiredReviewersChange = { from: current, to: clamped };
      }
    }
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description;
    if (reviewQuestion !== undefined) data.reviewQuestion = reviewQuestion;
    if (stage !== undefined) data.stage = stage;
    if (blindMode !== undefined) data.blindMode = !!blindMode;
    // SECURITY: the link target must be one of the WORKSPACE OWNER's own META·LAB
    // projects (mirrors linkMetaLab). Without this, a non-owner leader could repoint
    // the link to a stranger's project and leak it to every member.
    if (linkedMetaLabProjectId !== undefined) {
      if (linkedMetaLabProjectId) {
        const ml = await prisma.project.findFirst({
          where: { id: linkedMetaLabProjectId, userId: p.ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!ml) return res.status(400).json({ error: 'That PecanRev project was not found in this workspace' });
        data.linkedMetaLabProjectId = ml.id;
      } else {
        data.linkedMetaLabProjectId = null;
      }
    }
    if (progressStatus !== undefined) {
      if (!['not_started', 'in_progress', 'done'].includes(progressStatus)) {
        return res.status(400).json({ error: 'invalid progressStatus' });
      }
      data.progressStatus = progressStatus;
    }
    const asJson = v => (Array.isArray(v) ? JSON.stringify(v) : v);
    if (inclusionKeywords !== undefined) data.inclusionKeywords = asJson(inclusionKeywords);
    if (exclusionKeywords !== undefined) data.exclusionKeywords = asJson(exclusionKeywords);
    if (studyTypeFilter !== undefined) data.studyTypeFilter = asJson(studyTypeFilter);
    if (chatRestricted !== undefined) data.chatRestricted = !!chatRestricted;

    const updated = await prisma.screenProject.update({ where: { id: p.id }, data });

    // Audit blind-mode changes (Part 5).
    if (blindMode !== undefined && !!blindMode !== p.blindMode) {
      await writeAudit(p.id, req.user, blindMode ? 'BLIND_MODE_ON' : 'BLIND_MODE_OFF', { entityType: 'project', entityId: p.id });
      // prompt49 item 1 — regenerate AI scores so persisted reviewer signals match
      // the new blind state (the read path also re-suppresses, but this keeps the
      // stored blobs correct). Fire-and-forget, both stages.
      scheduleRescore(p.id, { stage: 'title_abstract', actor: req.user });
      scheduleRescore(p.id, { stage: 'full_text', actor: req.user });
    }

    // Audit required-reviewers changes (prompt19 Task 9).
    if (requiredReviewersChange) {
      await writeAudit(p.id, req.user, 'REQUIRED_REVIEWERS_CHANGED', {
        entityType: 'project', entityId: p.id, details: requiredReviewersChange,
      });
    }

    // 81.md — "Restrict chat" flip. On a REAL change, (1) audit it (the sibling
    // settings blindMode/requiredReviewers were audited but this one was not — a
    // leader silencing the whole team left no trail), and (2) push a user-targeted
    // permissions.changed to every project member so an ALREADY-OPEN chat drawer /
    // header launcher re-resolves its post-gate LIVE without a reload. The server
    // gate (canWriteChat) already rejects the disallowed send immediately; this
    // just closes the up-to-30s window where a still-open composer looked writable.
    if (data.chatRestricted !== undefined && data.chatRestricted !== p.chatRestricted) {
      await writeAudit(p.id, req.user, data.chatRestricted ? 'CHAT_RESTRICTED_ON' : 'CHAT_RESTRICTED_OFF', {
        entityType: 'project', entityId: p.id,
      });
      emitToProjectMembers(p.id, { type: 'permissions.changed', projectId: p.id }, { exclude: req.user.id });
    }

    // Task 12: record REAL status transitions (old !== new) for the ops
    // "done today" distinct-project metric. Best-effort — never fails the save.
    if (data.progressStatus !== undefined && data.progressStatus !== p.progressStatus) {
      try {
        await prisma.screenProjectStatusEvent.create({
          data: {
            projectId: p.id,
            status: data.progressStatus,
            previousStatus: p.progressStatus || '',
            changedById: req.user.id,
            changedByName: access.member?.name || req.user.email || '',
          },
        });
        await writeAudit(p.id, req.user, 'PROJECT_STATUS_CHANGED', {
          entityType: 'project', entityId: p.id,
          details: { from: p.progressStatus, to: data.progressStatus },
        });
      } catch { /* metric trail is best-effort */ }
      emitToProjectMembers(p.id, { type: 'status.changed' }, { exclude: req.user.id });
    }

    // Task 18: sync-if-in-sync rename. If the linked META·LAB project's name
    // EQUALED the old SIFT title, keep the pair renamed together; if the names
    // had already diverged, leave the META·LAB side alone. Best-effort.
    if (data.title !== undefined && data.title !== p.title && updated.linkedMetaLabProjectId) {
      try {
        const ml = await prisma.project.findFirst({
          where: { id: updated.linkedMetaLabProjectId, userId: p.ownerId, deletedAt: null },
          select: { id: true, name: true },
        });
        if (ml && ml.name === p.title) {
          await prisma.project.update({ where: { id: ml.id }, data: { name: data.title } });
          // The META·LAB side changed too — poke open monoliths (Task 7).
          emitToMetaLabProject(ml.id, p.ownerId, { type: 'project.updated' }, { exclude: req.user.id });
        }
      } catch { /* name sync is best-effort */ }
    }

    // prompt50 WS5 — a screening project-config change is meaningful activity on
    // the linked META·LAB project (cross-workstream timestamp).
    void touchProjectActivity(p.linkedMetaLabProjectId);

    // Realtime poke (Task 7) — thin, fire-and-forget, error-swallowed.
    emitToProjectMembers(p.id, { type: 'project.updated' }, { exclude: req.user.id });

    res.json(updated);
  } catch (err) {
    console.error('[screening] updateProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteProject(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    // SOFT delete (prompt9): mark instead of destroy so the audit trail,
    // records, decisions and chat survive for admin restore. Audit BEFORE the
    // mark (the row persists either way now). Deleting from SIFT does NOT
    // touch the linked META·LAB project (decided — the ML project is the
    // owner's primary artifact). Wire contract stays 204.
    await writeAudit(p.id, req.user, 'PROJECT_DELETED', {
      entityType: 'project', entityId: p.id, details: { title: p.title },
    });
    await prisma.screenProject.update({
      where: { id: p.id },
      data: { deletedAt: new Date(), deletedSource: 'owner' },
    });
    recordUsage({
      type: USAGE.PROJECT_DELETED,
      userId: req.user.id,
      screenProjectId: p.id,
      meta: { source: 'sift' },
    });
    // Members with the project open revalidate → 404 → navigate away.
    emitToProjectMembers(p.id, { type: 'members.changed' }, { exclude: req.user.id });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/archive  (prompt11 — owner-only, user-facing)
 *
 * Toggle ScreenProject.archived → true (a reversible hide, NOT the admin lifecycle
 * path and NOT a delete). Owner-only (NOT leader for v1) via getOwnedProject, which
 * also hides soft-deleted projects behind 404. Idempotent.
 * Audit PROJECT_ARCHIVED + recordUsage(WORKSPACE_ARCHIVED). Returns { archived: true }.
 */
export async function archiveProject(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    if (!p.archived) {
      await prisma.screenProject.update({ where: { id: p.id }, data: { archived: true } });
    }
    await writeAudit(p.id, req.user, 'PROJECT_ARCHIVED', {
      entityType: 'project', entityId: p.id, details: { title: p.title },
    });
    recordUsage({ type: USAGE.WORKSPACE_ARCHIVED, userId: req.user.id, screenProjectId: p.id });
    // Members with the project open revalidate (it drops from their active list).
    emitToProjectMembers(p.id, { type: 'project.updated' }, { exclude: req.user.id });
    res.json({ archived: true });
  } catch (err) {
    console.error('[screening] archiveProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/unarchive  (prompt11 — owner-only, user-facing)
 *
 * Toggle ScreenProject.archived → false. Owner-only via getOwnedProject. Idempotent.
 * Audit PROJECT_UNARCHIVED + recordUsage(WORKSPACE_UNARCHIVED). Returns { archived: false }.
 */
export async function unarchiveProject(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    if (p.archived) {
      await prisma.screenProject.update({ where: { id: p.id }, data: { archived: false } });
    }
    await writeAudit(p.id, req.user, 'PROJECT_UNARCHIVED', {
      entityType: 'project', entityId: p.id, details: { title: p.title },
    });
    recordUsage({ type: USAGE.WORKSPACE_UNARCHIVED, userId: req.user.id, screenProjectId: p.id });
    emitToProjectMembers(p.id, { type: 'project.updated' }, { exclude: req.user.id });
    res.json({ archived: false });
  } catch (err) {
    console.error('[screening] unarchiveProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── META·LAB association (prompt2 Task 4) ────────────────────────────
//
// A META·SIFT project links to exactly one META·LAB project (the workspace
// pair). Accepted second-review studies hand off to that project's Data
// Extraction. The linkable list offers the workspace owner's META·LAB projects
// so handoffs can never target someone else's project.

/** GET /projects/:pid/linkable — current link + selectable META·LAB projects + handoff counts. */
export async function getLinkable(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const sp = access.project;

    let linked = null;
    if (sp.linkedMetaLabProjectId) {
      const ml = await prisma.project.findFirst({
        where: { id: sp.linkedMetaLabProjectId, deletedAt: null },
        select: { id: true, name: true, userId: true },
      });
      linked = ml ? { id: ml.id, name: ml.name, missing: false } : { id: sp.linkedMetaLabProjectId, name: '(deleted project)', missing: true };
    }

    // Offer the workspace owner's META·LAB projects as link targets.
    const available = await prisma.project.findMany({
      where: { userId: sp.ownerId, deletedAt: null },
      select: { id: true, name: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    // Handoff status rollup for this project.
    const records = await prisma.screenRecord.findMany({
      where: { projectId: sp.id },
      select: { handoffStatus: true, finalStatus: true },
    });
    const handoff = { sent: 0, pending: 0, failed: 0, already_exists: 0, accepted: 0 };
    for (const r of records) {
      if (r.finalStatus === 'accepted') handoff.accepted++;
      if (r.handoffStatus && handoff[r.handoffStatus] !== undefined) handoff[r.handoffStatus]++;
    }

    res.json({ linked, available, handoff, isLeader: access.isLeader });
  } catch (err) {
    console.error('[screening] getLinkable:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /projects/:pid/link — set or clear the linked META·LAB project (leader only). */
export async function linkMetaLab(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageSettings) return res.status(403).json({ error: 'You do not have permission to link projects' });
    const sp = access.project;
    const { metaLabProjectId } = req.body || {};

    // Unlink
    if (!metaLabProjectId) {
      const updated = await prisma.screenProject.update({
        where: { id: sp.id }, data: { linkedMetaLabProjectId: null },
      });
      await writeAudit(sp.id, req.user, 'METALAB_UNLINKED', { entityType: 'project', entityId: sp.id });
      emitToProjectMembers(sp.id, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json({ linkedMetaLabProjectId: updated.linkedMetaLabProjectId, linked: null });
    }

    // Link — the target must be a META·LAB project owned by the workspace owner.
    const ml = await prisma.project.findFirst({
      where: { id: metaLabProjectId, userId: sp.ownerId, deletedAt: null },
      select: { id: true, name: true, data: true },
    });
    if (!ml) return res.status(400).json({ error: 'That PecanRev project was not found in this workspace' });

    // Snapshot the linked project's PICO/criteria for standalone-safe highlighting
    // (shared helper — same JSON shape everywhere; '{}' means "nothing to snapshot").
    let picoSnapshot = sp.picoSnapshot;
    const snap = snapshotPico(ml.data);
    if (snap !== '{}') picoSnapshot = snap;

    const updated = await prisma.screenProject.update({
      where: { id: sp.id },
      data: { linkedMetaLabProjectId: ml.id, picoSnapshot },
    });
    await writeAudit(sp.id, req.user, 'METALAB_LINKED', {
      entityType: 'project', entityId: sp.id, details: { metaLabProjectId: ml.id, name: ml.name },
    });
    emitToProjectMembers(sp.id, { type: 'project.updated' }, { exclude: req.user.id });
    res.json({ linkedMetaLabProjectId: updated.linkedMetaLabProjectId, linked: { id: ml.id, name: ml.name } });
  } catch (err) {
    console.error('[screening] linkMetaLab:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Records ──────────────────────────────────────────────────────────

export async function listRecords(req, res) {
  try {
    // Membership-aware: any member (or owner) may list records to screen.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const me = req.user.id;
    const blind = p.blindMode && !access.isLeader;

    const page        = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit       = Math.min(200, Math.max(10, parseInt(req.query.limit || '50', 10)));
    const search      = req.query.search   || '';
    const filter      = req.query.filter || req.query.decision || 'all';
    const hasAbstract = req.query.hasAbstract;

    // Server-side AI integration flags (feature flag: aiScreening) — resolved up
    // front because BOTH list paths need them: (1) AI-ordered/filtered queues force
    // the in-memory path; (2) the returned PAGE gets inline scores either way.
    // Respect AI-blinding: a non-leader reviewer on a blindFromAi project must not
    // get AI scores or an AI-ordered worklist (both leak the model's opinion before
    // independent screening). Leaders are exempt.
    const aiQueue = String(req.query.aiQueue || '');
    const aiBand = String(req.query.aiBand || '');
    let aiBlind = false;
    try { aiBlind = !!JSON.parse(p.aiSettings || '{}').blindFromAi; } catch { /* default false */ }
    const aiBlocked = aiBlind && !access.isLeader;
    const aiStage = req.query.aiStage === 'full_text' ? 'full_text' : 'title_abstract';
    const aiOn = !aiBlocked && await aiFlagEnabled();

    // One shaping function for both paths (identical response structure).
    const shapeRecord = (r) => {
      const myDecision = r.decisions.find(d => d.reviewerId === me) || null;
      const taDecisions = r.decisions.filter(d => d.stage === 'title_abstract' && d.decision !== 'undecided');
      const includeCount = r.decisions.filter(d => d.stage === 'title_abstract' && d.decision === 'include').length;
      const distinct = new Set(taDecisions.map(d => d.decision));
      const disputed = distinct.size > 1;
      // Reviewer decision indicators (anonymised under blind mode for non-leaders).
      const reviewerDecisions = r.decisions
        .filter(d => d.decision !== 'undecided')
        .map((d, i) => ({
          reviewerId: blind ? undefined : d.reviewerId,
          reviewerName: blind ? `Reviewer ${i + 1}` : (d.reviewerName || 'Reviewer'),
          decision: d.decision,
          stage: d.stage,
          isMe: d.reviewerId === me,
          // prompt29 Part 7 — surface the decision time for the reviewer tooltip
          // (no identity leak: name stays anonymised under blind mode above).
          decidedAt: d.updatedAt || d.createdAt || null,
        }));
      return {
        id: r.id, projectId: r.projectId,
        // 81.md (blindMode audit) — blind mode promises to hide "author / journal
        // info" from non-leaders, but only `authors` was suppressed server-side;
        // `journal` shipped in the JSON, so a non-leader could read it straight from
        // GET /records (the client only hid it visually). Suppress journal too.
        title: r.title, authors: blind ? '' : r.authors, year: r.year, journal: blind ? '' : r.journal,
        doi: r.doi, pmid: r.pmid, abstract: r.abstract, keywords: r.keywords, sourceDb: r.sourceDb,
        isDuplicate: r.isDuplicate, isPrimary: r.isPrimary,
        currentStage: r.currentStage, finalStatus: r.finalStatus, promotedAt: r.promotedAt,
        handoffStatus: r.handoffStatus,
        myDecision,
        myOpened: r.openStates.length > 0,
        reviewerDecisions,
        includeCount,
        quorumMet: includeCount >= QUORUM || r.currentStage === 'full_text',
        disputed,
        createdAt: r.createdAt,
      };
    };

    // Attach the FULL persisted AI score + explanation to a page (bounded by limit)
    // → instant Layer-1 "Why this score?" with no extra request (se2.md §5).
    // 89.md — model internals (raw/calibrated probs, confidence/uncertainty, per-signal
    // breakdown, raw signals) are administrator-only. Trim the inline aiScore for regular
    // screeners so the data matches the render gate and can't be read from the raw list
    // response. Administrators = project leader / settings-manager / site admin.
    const aiConfigurer = access.isLeader || access.canManageSettings || req.user?.role === 'admin';
    const attachAiScores = async (paged) => {
      if (!aiOn || !paged.length) return paged;
      const ids = paged.map(r => r.id);
      const full = await prisma.screenAiScore.findMany({ where: { projectId: p.id, stage: aiStage, recordId: { in: ids } } });
      const fMap = new Map(full.map(s => [s.recordId, s]));
      const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
      return paged.map(r => {
        const s = fMap.get(r.id);
        if (!s) return r;
        const aiScore = {
          recordId: s.recordId, score: s.score, proba: s.proba, calibratedProba: s.calibratedProba ?? null,
          band: s.band, prediction: s.prediction,
          confidence: s.confidence, uncertainty: s.uncertainty, mode: s.mode, lowConfidence: s.lowConfidence,
          missingAbstract: s.missingAbstract, picoMean: s.picoMean,
          subScores: parse(s.subScoresJson), signals: parse(s.signalsJson), explanation: parse(s.explanationJson),
          updatedAt: s.updatedAt,
        };
        return { ...r, aiScore: aiConfigurer ? aiScore : stripAiInternals(aiScore) };
      });
    };

    // ── FAST PATH (65.md SCR-1) — no search / keywords / AI ordering / hasAbstract
    // and a filter the DB can evaluate exactly: push WHERE + orderBy + skip/take into
    // Prisma so the whole project is never loaded per page request. Response shape is
    // identical to the in-memory path. Decision filters stay in-memory (see
    // recordListQuery.js for why).
    if (fastListEligible({ search, filter, hasAbstract, keywords: req.query.keywords, aiQueue, aiBand })) {
      const fast = buildFastListQuery({ projectId: p.id, userId: me, filter });
      const [total, pageRows] = await Promise.all([
        prisma.screenRecord.count({ where: fast.where }),
        prisma.screenRecord.findMany({
          where: fast.where,
          orderBy: fast.orderBy,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            decisions: true,
            openStates: { where: { userId: me } },
          },
        }),
      ]);
      const paged = await attachAiScores(pageRows.map(shapeRecord));
      return res.json({
        records: paged,
        total,
        page,
        pages: Math.ceil(total / limit) || 1,
        blindMode: p.blindMode,
        isLeader: access.isLeader,
      });
    }

    // ── IN-MEMORY PATH — text search, keyword filters, decision filters, and
    // AI-queue ordering need the whole pool before pagination (unchanged).
    const where = { projectId: p.id };
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { authors: { contains: search } },
        { abstract: { contains: search } },
        { doi: { contains: search } },
        { pmid: { contains: search } },
      ];
    }

    // Pull all decisions (for reviewer indicators + quorum) and this user's open-state.
    const records = await prisma.screenRecord.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        decisions: true,
        openStates: { where: { userId: me } },
      },
    });

    const shaped = records.map(shapeRecord);

    // Filtering (the workbench left-column filter set).
    let filtered = shaped;
    const byMine = d => (r => (r.myDecision?.decision || 'undecided') === d);
    switch (filter) {
      case 'all': break;
      case 'undecided': filtered = filtered.filter(byMine('undecided')); break;
      case 'included':  filtered = filtered.filter(byMine('include')); break;
      case 'excluded':  filtered = filtered.filter(byMine('exclude')); break;
      case 'maybe':     filtered = filtered.filter(byMine('maybe')); break;
      case 'include': case 'exclude':
        filtered = filtered.filter(byMine(filter === 'include' ? 'include' : 'exclude')); break;
      case 'unopened_me': filtered = filtered.filter(r => !r.myOpened); break;
      case 'opened_me':   filtered = filtered.filter(r => r.myOpened); break;
      case 'quorum':      filtered = filtered.filter(r => r.quorumMet); break;
      case 'disputed':    filtered = filtered.filter(r => r.disputed); break;
      default: break;
    }
    if (hasAbstract === 'yes') filtered = filtered.filter(r => r.abstract && r.abstract.trim().length > 10);
    if (hasAbstract === 'no')  filtered = filtered.filter(r => !r.abstract || r.abstract.trim().length <= 10);

    // Keyword filtering (Task 8) — OR by default: show articles containing ANY
    // selected keyword. Phrase/token-boundary matching via the research engine.
    const selectedKeywords = parseKeywordParam(req.query.keywords);
    if (selectedKeywords.length) {
      const mode = (req.query.keywordMode || 'or').toLowerCase() === 'and' ? 'AND' : 'OR';
      filtered = filterRecordsByKeywords(filtered, selectedKeywords, { mode });
    }

    // AI-ordered/filtered queue — only when the client requests aiQueue/aiBand,
    // ordering/filtering the WHOLE pool before pagination. The default screening
    // path stays byte-identical when the feature flag is OFF (no aiScore field).
    if (aiOn && ((aiQueue && aiQueue !== 'default') || (aiBand && aiBand !== 'all'))) {
      const scoreRows = await prisma.screenAiScore.findMany({
        where: { projectId: p.id, stage: aiStage },
        select: { recordId: true, score: true, band: true, prediction: true, uncertainty: true, picoMean: true, missingAbstract: true },
      });
      const sMap = new Map(scoreRows.map(s => [s.recordId, s]));
      if (aiBand && aiBand !== 'all') {
        filtered = filtered.filter(r => {
          const sc = sMap.get(r.id);
          if (!sc) return false;
          if (aiBand === 'uncertain') return sc.prediction === 'uncertain';
          if (aiBand === 'low') return sc.score != null && sc.score < 0.4;
          return sc.band === aiBand;
        });
      }
      if (aiQueue && aiQueue !== 'default') {
        const items = filtered.map((r, i) => {
          const sc = sMap.get(r.id) || {};
          return { recordId: r.id, score: sc.score, uncertainty: sc.uncertainty, picoMean: sc.picoMean, missingAbstract: sc.missingAbstract, isDuplicate: r.isDuplicate, hasConflict: r.disputed, order: i };
        });
        const byId = new Map(filtered.map(r => [r.id, r]));
        filtered = rankItems(items, aiQueue).map(it => byId.get(it.recordId)).filter(Boolean);
      }
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const paged = await attachAiScores(filtered.slice(start, start + limit));

    res.json({
      records: paged,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      blindMode: p.blindMode,
      isLeader: access.isLeader,
    });
  } catch (err) {
    console.error('[screening] listRecords:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createRecord(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const { title = '', authors = '', year = '', journal = '', doi = '', pmid = '', abstract = '', keywords = '', sourceDb = '' } = req.body || {};
    const record = await prisma.screenRecord.create({
      data: { projectId: p.id, title, authors, year, journal, doi, pmid, abstract, keywords, sourceDb },
    });
    res.status(201).json(record);
  } catch (err) {
    console.error('[screening] createRecord:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteRecord(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: p.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    await prisma.screenRecord.delete({ where: { id: rec.id } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteRecord:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Mark a record opened by the current member (per-member open-state, Part 11).
export async function markOpened(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: access.project.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    await prisma.screenRecordOpenState.upsert({
      where: { recordId_userId: { recordId: rec.id, userId: req.user.id } },
      update: { openedAt: new Date() },
      create: { recordId: rec.id, projectId: access.project.id, userId: req.user.id },
    });
    res.json({ opened: true });
  } catch (err) {
    console.error('[screening] markOpened:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /projects/:pid/keyword-stats — per-keyword article counts (Task 8).
 * Counts ARTICLES (not occurrences) containing each inclusion/exclusion keyword
 * across ALL project records, so the keyword panel can show "term (n)".
 */
export async function getKeywordStats(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const records = await prisma.screenRecord.findMany({
      where: { projectId: access.project.id },
      select: { id: true, title: true, abstract: true, keywords: true },
    });
    // prompt28 Part 1 — count the EFFECTIVE keyword lists: stored (default/manual)
    // PLUS this project's criteria-derived terms, so the criteria badges in the
    // panel also show article counts. Refresh the cached picoSnapshot from the
    // linked META·LAB project first (same lazy pattern as getProject) so the
    // server's effective list matches the freshly-derived one on the client.
    let picoSnapshot = access.project.picoSnapshot;
    if (access.project.linkedMetaLabProjectId) {
      try {
        const ml = await prisma.project.findFirst({
          where: { id: access.project.linkedMetaLabProjectId, deletedAt: null },
          select: { data: true },
        });
        if (ml) {
          const snap = snapshotPico(ml.data);
          if (snap !== '{}') {
            if (snap !== access.project.picoSnapshot) {
              prisma.screenProject.update({ where: { id: access.project.id }, data: { picoSnapshot: snap } }).catch(() => {});
            }
            picoSnapshot = snap;
          }
        }
      } catch { /* best-effort — keep the cached snapshot */ }
    }
    // Fall back to the shared defaults for projects created before keyword seeding.
    const storedIncl = parseJsonList(access.project.inclusionKeywords);
    const storedExcl = parseJsonList(access.project.exclusionKeywords);
    const eff = effectiveKeywords({
      storedInclude: storedIncl,
      storedExclude: storedExcl,
      defaultInclude: DEFAULT_INCLUDE_KEYWORDS,
      defaultExclude: DEFAULT_EXCLUDE_KEYWORDS,
      picoSnapshot,
    });
    res.json({
      total: records.length,
      include: countArticlesByKeyword(records, eff.include.terms),
      exclude: countArticlesByKeyword(records, eff.exclude.terms),
    });
  } catch (err) {
    console.error('[screening] getKeywordStats:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Import ──────────────────────────────────────────────────────────

export async function importRecords(req, res) {
  try {
    // Task 17: access-guard, not owner-only. True outsiders keep the
    // existence-hiding 404; an authenticated active member without import
    // permission gets a clear 403. The brief's `canImportStudiesToMetaSift`
    // is the existing `canImportRecords` flag (owner/leader always pass).
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canImport = access.isOwner || (access.active && (access.isLeader || access.perms.canImportRecords));
    if (!canImport) return res.status(403).json({ error: 'You do not have permission to import records in this project' });
    const p = access.project;

    const settings = await getMetaSiftSettings();
    if (!settings.allowImport) return res.status(403).json({ error: 'Import is currently disabled by the administrator' });

    // 67.md — product-tier gates: the import feature (caller's tier) + the
    // per-project record cap (the OWNER's tier governs project capacity). The
    // admin-configured hard cap below still applies on top.
    try {
      await requireEntitlement(req.user, 'screening.import');
      const owner = await loadUserForTier(p.ownerId);
      if (owner) {
        const current = await prisma.screenRecord.count({ where: { projectId: p.id } });
        await requireLimit(owner, 'screening.maxRecordsPerProject', current + 1, {
          message: 'This project has reached its plan record limit.',
        });
      }
    } catch (tierErr) {
      if (sendTierLimit(res, tierErr)) return;
      throw tierErr;
    }

    const { format = 'ris', content = '', filename = 'import', force } = req.body || {};
    if (!content.trim()) return res.status(400).json({ error: 'content is required' });

    // Task 19: import fingerprint — sha256 of the CRLF-normalized raw content,
    // computed SERVER-side (a client-supplied hash could trivially bypass the
    // warning). Normalizing line endings makes the same file from Windows/Mac
    // dedupe identically. Legacy batches have fileHash NULL — string equality
    // below never matches them, so the pre-check is safe on old projects.
    const fileHash = createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
    const priorBatch = await prisma.screenImportBatch.findFirst({
      where: { projectId: p.id, fileHash },
      orderBy: { createdAt: 'desc' },
    });
    if (priorBatch && force !== true) {
      return res.status(409).json({
        error: 'duplicate_import',
        batch: {
          filename: priorBatch.filename,
          importedAt: priorBatch.createdAt,
          importedByName: priorBatch.importedByName || '',
          recordCount: priorBatch.recordCount,
        },
      });
    }

    // Parse via the modular registry (BOM-tolerant; explicit format or
    // content/extension auto-detect). prompt50 WS2 — pass the real filename so a
    // .txt/.csv/.nbib extension hints detection; content markers still win.
    const { records, detectedFormat } = parseImportContent(content, { format, filename });
    if (!records.length) return res.status(400).json({ error: 'No records found in the provided content' });
    // prompt50 WS2 — the old 5000-per-batch cap is GONE. The only ceilings are a
    // generous absolute safety bound and the admin-configurable per-project total.
    if (records.length > MAX_RECORDS_PER_IMPORT) {
      return res.status(413).json({ error: `This file holds ${records.length} records, above the ${MAX_RECORDS_PER_IMPORT.toLocaleString()} single-import safety limit. Split it into smaller files or use the async import.` });
    }
    // 58.md §3/§5 — resolve the limit through the ONE layered resolver (per-user →
    // workspace → tier → global Ops default → ceiling). 72.md — the tier layer is
    // now wired: planLimit = the OWNER's tier screening.maxRecordsPerProject
    // (UNLIMITED / bypass → null so it never lowers the global default).
    const planLimit = await planRecordLimitFor(p.ownerId);
    const maxRecords = resolveScreeningUploadLimit({ settings, planLimit });

    let result;
    try {
      result = await dedupeAndInsertRecords(p.id, records, {
        format: detectedFormat, filename,
        fileHash, fileSize: Buffer.byteLength(content, 'utf8'),
        importedById: req.user.id, importedByName: access.member?.name || req.user.email || '',
        parser: detectedFormat, maxRecords,
      });
    } catch (e) {
      if (e && e.code === 'CAPACITY') return res.status(400).json({ error: e.message });
      throw e;
    }

    // prompt50 WS5 — an import is meaningful activity on the linked META·LAB project.
    if (result.imported > 0) await touchProjectActivity(p.linkedMetaLabProjectId);

    res.json({
      imported: result.imported,
      skippedDuplicates: result.skippedDuplicates,
      rejected: result.rejected,
      total: result.total,
      batchId: result.batchId,
      format: detectedFormat,
      // 65.md SCR-3 — per-row reject/invalid-decision reasons (capped; additive field).
      errorReport: result.errorReport || [],
    });
  } catch (err) {
    console.error('[screening] importRecords:', err.message);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
}

// 65.md SCR-10 — only this much of the pasted/uploaded text is parsed for a preview.
// Enough for format detection + a 5-record sample without shipping a whole library.
const IMPORT_PREVIEW_MAX_CHARS = 256 * 1024;

/**
 * POST /projects/:pid/import/preview (65.md SCR-10) — run the REAL parser registry
 * over (at most) the first 256KB of the text and return what an import WOULD see:
 * detected format, the first 5 parsed records, parse/reject counts, and whether a
 * screening-decision column was detected. Read-only — nothing is inserted, so the
 * admin allowImport switch does not apply (permission gate mirrors import).
 */
export async function previewImport(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canImport = access.isOwner || (access.active && (access.isLeader || access.perms.canImportRecords));
    if (!canImport) return res.status(403).json({ error: 'You do not have permission to import records in this project' });

    const { format = 'auto', content = '', filename = '' } = req.body || {};
    if (!String(content).trim()) return res.status(400).json({ error: 'content is required' });

    const truncated = String(content).length > IMPORT_PREVIEW_MAX_CHARS;
    const head = String(content).slice(0, IMPORT_PREVIEW_MAX_CHARS);
    const { records, detectedFormat } = parseImportContent(head, { format, filename });

    const rejected = records.filter((r) => !hasUsableIdentity(r)).length;
    // A decision column "exists" when any record carries a non-neutral decision —
    // including an unrecognised value (normalised to '' so the import can warn).
    const decisionColumnDetected = records.some((r) => r.decision !== 'undecided');
    res.json({
      detectedFormat,
      sample: records.slice(0, 5).map((r) => ({
        title: r.title || '', authors: r.authors || '', year: r.year || '',
        journal: r.journal || '', doi: r.doi || '', decision: r.decision,
      })),
      counts: { parsed: records.length, rejected },
      decisionColumnDetected,
      // Counts describe only the previewed head when the file was larger.
      truncated,
    });
  } catch (err) {
    console.error('[screening] previewImport:', err.message);
    res.status(500).json({ error: 'Preview failed' });
  }
}

/**
 * POST /projects/:pid/import/start — prompt50 WS2.
 * Create a DURABLE import job and return immediately (202 { jobId }). The
 * in-process worker parses + dedupes + bulk-inserts off the request thread, so
 * the browser need not keep the dialog open and a large file never blocks/times
 * out the request. Idempotent by (projectId, fileHash): an in-flight job for the
 * same file is reused; a completed one returns 409 duplicate_import unless force.
 */
export async function startImport(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canImport = access.isOwner || (access.active && (access.isLeader || access.perms.canImportRecords));
    if (!canImport) return res.status(403).json({ error: 'You do not have permission to import records in this project' });
    const p = access.project;

    const settings = await getMetaSiftSettings();
    if (!settings.allowImport) return res.status(403).json({ error: 'Import is currently disabled by the administrator' });

    // 67.md — same product-tier gates as the sync import path.
    try {
      await requireEntitlement(req.user, 'screening.import');
      const owner = await loadUserForTier(p.ownerId);
      if (owner) {
        const current = await prisma.screenRecord.count({ where: { projectId: p.id } });
        await requireLimit(owner, 'screening.maxRecordsPerProject', current + 1, {
          message: 'This project has reached its plan record limit.',
        });
      }
    } catch (tierErr) {
      if (sendTierLimit(res, tierErr)) return;
      throw tierErr;
    }

    const { format = 'auto', content = '', filename = 'import', force } = req.body || {};
    if (!String(content).trim()) return res.status(400).json({ error: 'content is required' });
    const fileSize = Buffer.byteLength(String(content), 'utf8');
    const fileHash = createHash('sha256').update(String(content).replace(/\r\n/g, '\n'), 'utf8').digest('hex');

    // Idempotency / duplicate-file guard (mirrors the sync endpoint's Task 19).
    if (force !== true) {
      const priorJob = await prisma.screenImportJob.findFirst({
        where: { projectId: p.id, fileHash, status: { not: 'failed' } },
        orderBy: { createdAt: 'desc' },
      });
      if (priorJob && (priorJob.status === 'queued' || priorJob.status === 'processing')) {
        // Same file already being imported → return the in-flight job (no double insert).
        return res.status(202).json({ jobId: priorJob.id, status: priorJob.status, alreadyRunning: true });
      }
      const prior = priorJob || await prisma.screenImportBatch.findFirst({
        where: { projectId: p.id, fileHash }, orderBy: { createdAt: 'desc' },
      });
      if (prior) {
        return res.status(409).json({
          error: 'duplicate_import',
          batch: {
            filename: prior.filename,
            importedAt: priorJob ? (priorJob.completedAt || priorJob.createdAt) : prior.createdAt,
            importedByName: priorJob ? priorJob.createdByName : (prior.importedByName || ''),
            recordCount: priorJob ? priorJob.importedRecords : prior.recordCount,
          },
        });
      }
    }

    const job = await prisma.screenImportJob.create({
      data: {
        projectId: p.id,
        createdById: req.user.id,
        createdByName: access.member?.name || req.user.email || '',
        status: 'queued', stage: 'queued',
        filename: String(filename).slice(0, 300),
        format: String(format).slice(0, 40),
        fileHash, fileSize,
        content: String(content),
        force: force === true,
      },
    });
    kickImportWorker();
    return res.status(202).json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    console.error('[screening] startImport:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/import/jobs/:jobId — poll import progress/result (no raw content). */
export async function getImportJob(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const job = await prisma.screenImportJob.findFirst({
      where: { id: req.params.jobId, projectId: access.project.id },
    });
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    const done = job.status === 'completed' || job.status === 'completed_with_warnings';
    res.json({
      id: job.id, status: job.status, stage: job.stage,
      filename: job.filename, format: job.format, detectedFormat: job.detectedFormat,
      totalRecords: job.totalRecords, processedRecords: job.processedRecords,
      importedRecords: job.importedRecords, duplicateRecords: job.duplicateRecords,
      rejectedRecords: job.rejectedRecords, warningCount: job.warningCount,
      // 65.md SCR-3 — per-row reject/invalid-decision reasons (capped; additive field).
      errorReport: parseJsonObjectList(job.errorReport),
      error: job.error, batchId: job.batchId,
      createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt,
      progress: job.totalRecords > 0
        ? Math.min(100, Math.round((job.processedRecords / job.totalRecords) * 100))
        : (done ? 100 : 0),
    });
  } catch (err) {
    console.error('[screening] getImportJob:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Parse a JSON array of objects, tolerating legacy/blank values.
function parseJsonObjectList(json) {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/**
 * GET /projects/:pid/import-batches/:batchId/error-report (65.md SCR-3) — the per-row
 * issue list for a finished import, read from the ScreenImportJob that produced the
 * batch. Member-visible (same audience as the Import History list). Older batches
 * imported synchronously (no job row) return an empty report.
 */
export async function getImportBatchErrorReport(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const batch = await prisma.screenImportBatch.findFirst({
      where: { id: req.params.batchId, projectId: access.project.id },
      select: { id: true, rejectedCount: true },
    });
    if (!batch) return res.status(404).json({ error: 'Import batch not found' });
    const job = await prisma.screenImportJob.findFirst({
      where: { projectId: access.project.id, batchId: batch.id },
      orderBy: { createdAt: 'desc' },
      select: { errorReport: true, warningCount: true },
    });
    res.json({
      batchId: batch.id,
      rejectedCount: batch.rejectedCount,
      warningCount: job?.warningCount ?? batch.rejectedCount,
      errorReport: parseJsonObjectList(job?.errorReport),
    });
  } catch (err) {
    console.error('[screening] getImportBatchErrorReport:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function fallbackParseRIS(content) {
  const entries = content.split(/\nER\s*-?\s*\n/i).filter(e => e.trim());
  return entries.map(entry => {
    const get = (tag) => {
      const m = entry.match(new RegExp(`^${tag}\\s+-\\s+(.+)`, 'm'));
      return m ? m[1].trim() : '';
    };
    return {
      title:    get('TI') || get('T1') || get('TY'),
      authors:  get('AU') || get('A1'),
      year:     get('PY') || get('Y1'),
      journal:  get('JO') || get('JF') || get('T2'),
      doi:      get('DO') || get('M3'),
      pmid:     get('AN'),
      abstract: get('AB') || get('N2'),
    };
  }).filter(r => r.title);
}

// ── Export ───────────────────────────────────────────────────────────

// computeExportCvScores now lives in services/screeningExportService.js (62.md): capped
// and run in a worker_thread so it never blocks the event loop, shared by the sync route
// and the async export worker.

export async function exportRecords(req, res) {
  let reservation = null;
  try {
    // Access-guard (prompt6 403-vs-404 audit): outsider → 404; active member
    // without canExportRecords (and not leader/owner) → 403.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canExport = access.isOwner || (access.active && (access.isLeader || access.perms.canExportRecords));
    if (!canExport) return res.status(403).json({ error: 'You do not have permission to export records from this project' });
    const p = access.project;

    const settings = await getMetaSiftSettings();
    if (!settings.allowExport) return res.status(403).json({ error: 'Export is currently disabled by the administrator' });

    // 67.md — screening.export tier gate (the sync path historically SKIPPED this, a
    // bypass the async path already blocked). 79.md §3 — plus the master project-export
    // gate + monthly allowance RESERVATION (Free = blocked; failed exports refunded below).
    try {
      await requireEntitlement(req.user, 'screening.export');
      reservation = await requireProjectExport(req.user, {
        exportType: EXPORT_TYPES.SCREENING_RECORDS, projectId: p.id, format: req.query.format || 'csv',
      });
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }

    const fmt    = req.query.format || 'csv';
    const filter = req.query.filter || 'all';

    // 62.md — guard the SYNCHRONOUS path. A large project must not build its whole export
    // in one request (it would block the single Node event loop and 504 behind the proxy).
    // Over the cap we return 413 and the client switches to the async export job
    // (POST …/export/start), which streams to a file off the request thread.
    const recordCount = await prisma.screenRecord.count({ where: { projectId: p.id } });
    if (recordCount > EXPORT_SYNC_MAX) {
      // Not an export the user completed → refund the reserved allowance (79.md §3).
      settleProjectExport(reservation?.reservationId, { status: 'failed', failureReason: 'too_large_use_async' });
      return res.status(413).json({
        error: 'This project is too large for a direct download. Use background export instead.',
        useAsync: true,
        count: recordCount,
        max: EXPORT_SYNC_MAX,
        startUrl: `/api/screening/projects/${p.id}/export/start`,
      });
    }

    const records = await prisma.screenRecord.findMany({
      where: { projectId: p.id },
      include: { decisions: true },
    });

    // ── AI out-of-sample (cross-validated) relevance scores (59.md Change 2) ─────
    // For validation studies the export carries TRULY out-of-sample AI scores so a
    // researcher can recompute WSS@95 / AUC / calibration / Brier offline (leakage-free).
    // 62.md — capped + computed in a worker_thread so it never freezes the event loop.
    const aiCv = await computeExportCvScores(p.id);
    // 65.md SCR-2 — per-reviewer/consensus column context (identity permission-safe).
    const exportCtx = await buildExportContext(p.id, req.user.id);

    // Build + filter rows (shared row mapping; existing columns unchanged, new
    // review/consensus columns appended).
    const rows = records.map(r => buildExportRow(r, req.user.id, aiCv, exportCtx));
    const filtered = filter === 'all' ? rows : rows.filter(r => r.decision === filter);

    // Usage metric (prompt9) — every export, every format. Best-effort, fire-and-forget.
    const emittedFormat = fmt === 'json' ? 'json' : fmt === 'ris' ? 'ris' : 'csv';
    recordUsage({
      type: USAGE.EXPORT,
      userId: req.user.id,
      screenProjectId: p.id,
      format: emittedFormat,
      meta: { filter },
    });

    if (fmt === 'json') {
      const body = JSON.stringify(filtered);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.json"`);
      settleProjectExport(reservation?.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(body) });
      return res.send(body);
    }

    if (fmt === 'ris') {
      const ris = filtered.map(renderRisBlock).join('\n\n') + (filtered.length ? '\n' : '');
      res.setHeader('Content-Type', 'application/x-research-info-systems');
      res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.ris"`);
      settleProjectExport(reservation?.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(ris) });
      return res.send(ris);
    }

    // CSV — every cell goes through the shared injection-safe encoder; columns + order
    // are UNCHANGED for backwards compatibility (AI validation columns are APPENDED).
    const csv = [EXPORT_COLUMNS.join(','), ...filtered.map(renderCsvRow)].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.csv"`);
    settleProjectExport(reservation?.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(csv) });
    res.send(csv);
  } catch (err) {
    // Refund the reserved allowance — a failed export never consumes usage (79.md §3).
    settleProjectExport(reservation?.reservationId, { status: 'failed', failureReason: err?.message });
    console.error('[screening] exportRecords:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
}

/** Shared export permission gate: outsider → 404; no canExportRecords/leader/owner → 403. */
async function gateExport(req, res) {
  const access = await getProjectAccess(req.params.pid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  const canExport = access.isOwner || (access.active && (access.isLeader || access.perms.canExportRecords));
  if (!canExport) { res.status(403).json({ error: 'You do not have permission to export records from this project' }); return null; }
  // 67.md — product-tier gate on top of the project permission (both must pass).
  // 79.md §3 — also require the master project-export entitlement (Free = blocked).
  // Boolean-only here: gateExport is called on start AND every poll/download, so it
  // must NOT consume the monthly allowance (that is reserved once, in startExport).
  try {
    await requireEntitlement(req.user, 'screening.export');
    await requireProjectExportEnabled(req.user);
  } catch (e) { if (sendTierLimit(res, e)) return null; throw e; }
  return access;
}

/**
 * POST /projects/:pid/export/start (62.md) — enqueue a durable async export job and return
 * 202 + jobId immediately. The export worker computes capped CV off the event loop and
 * streams the file; the client polls GET …/export/jobs/:id, then downloads when ready.
 */
export async function startExport(req, res) {
  try {
    const access = await gateExport(req, res); if (!access) return;
    const settings = await getMetaSiftSettings();
    if (!settings.allowExport) return res.status(403).json({ error: 'Export is currently disabled by the administrator' });

    const reqFmt = req.body?.format || req.query.format;
    const reqFilter = req.body?.filter || req.query.filter;
    const fmt = ['csv', 'json', 'ris'].includes(reqFmt) ? reqFmt : 'csv';
    const filter = ['all', 'include', 'exclude', 'maybe', 'undecided'].includes(reqFilter) ? reqFilter : 'all';

    // 79.md §3 — reserve one unit of the monthly project-export allowance at job
    // START (gateExport already verified the master gate boolean). Enqueuing the job
    // IS the export event, so the reservation is confirmed immediately; a job that
    // later fails is a background concern (the allowance is not auto-refunded, matching
    // the documented policy that a submitted async export counts).
    let reservation;
    try {
      reservation = await requireProjectExport(req.user, {
        exportType: EXPORT_TYPES.SCREENING_RECORDS, projectId: access.project.id, format: fmt,
      });
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }

    const job = await enqueueExportJob(access.project.id, {
      createdById: req.user.id,
      createdByName: req.user.name || req.user.email || '',
      format: fmt, filter, includeAiCv: true,
    });
    settleProjectExport(reservation.reservationId, { status: 'succeeded' });
    recordUsage({ type: USAGE.EXPORT, userId: req.user.id, screenProjectId: access.project.id, format: fmt, meta: { filter, async: true } });
    res.status(202).json({ ok: true, jobId: job.id, status: job.status, format: fmt, filter });
  } catch (err) {
    console.error('[screening] startExport:', err.message);
    res.status(500).json({ error: 'Failed to start export' });
  }
}

/** GET /projects/:pid/export/jobs/:jobId (62.md) — poll async export progress/status. */
export async function getExportJob(req, res) {
  try {
    const access = await gateExport(req, res); if (!access) return;
    const job = await prisma.screenExportJob.findUnique({ where: { id: req.params.jobId } });
    // 62.md rec round (CRITICAL): an export is PERSONAL — its per-reviewer decision columns
    // reflect the CREATOR. A jobId is NOT a shareable handle: only the creator may poll or
    // download it, else one reviewer's decisions/notes/ratings could leak to another member
    // who also has export permission. 404 (not 403) so the job's existence is never revealed.
    if (!job || job.projectId !== access.project.id || job.createdById !== req.user.id) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    const ready = job.status === 'completed' && !!job.resultPath;
    res.json({
      id: job.id, status: job.status, stage: job.stage, format: job.format, filter: job.filter,
      totalRecords: job.totalRecords, processedRecords: job.processedRecords,
      progress: job.totalRecords > 0 ? Math.min(100, Math.round((job.processedRecords / job.totalRecords) * 100)) : (ready ? 100 : 0),
      cvStatus: job.cvStatus, error: job.error, filename: job.filename, bytes: job.resultBytes,
      ready, createdAt: job.createdAt, completedAt: job.completedAt,
      downloadUrl: ready ? `/api/screening/projects/${access.project.id}/export/jobs/${job.id}/download` : null,
    });
  } catch (err) {
    console.error('[screening] getExportJob:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /projects/:pid/export/jobs/:jobId/download (62.md) — stream the finished export file.
 * Permission is RE-checked here and the job must belong to this project — a jobId is NOT a
 * capability token, so files never leak across users/projects.
 */
export async function downloadExport(req, res) {
  try {
    const access = await gateExport(req, res); if (!access) return;
    const settings = await getMetaSiftSettings();
    if (!settings.allowExport) return res.status(403).json({ error: 'Export is currently disabled by the administrator' });

    const job = await prisma.screenExportJob.findUnique({ where: { id: req.params.jobId } });
    // CRITICAL (62.md rec round): creator-only — a jobId is NOT a capability token; the file
    // carries the creator's per-reviewer decisions, so only the creator may download it.
    if (!job || job.projectId !== access.project.id || job.createdById !== req.user.id) {
      return res.status(404).json({ error: 'Export job not found' });
    }
    if (job.status !== 'completed' || !job.resultPath) return res.status(409).json({ error: 'Export is not ready yet', status: job.status });
    if (!fs.existsSync(job.resultPath)) return res.status(410).json({ error: 'This export has expired — please run it again.' });

    const { type } = exportContentType(job.format);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${job.filename || `sift-export.${job.format}`}"`);
    if (job.resultBytes > 0) res.setHeader('Content-Length', String(job.resultBytes));
    const stream = fs.createReadStream(job.resultPath);
    stream.on('error', (e) => {
      console.error('[screening] downloadExport stream:', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Download failed' }); else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[screening] downloadExport:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
  }
}

// ── Decisions ────────────────────────────────────────────────────────

export async function saveDecision(req, res) {
  try {
    // Membership-aware: owner OR an active member with screening permission.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canScreen) {
      return res.status(403).json({ error: 'You do not have permission to screen in this project' });
    }
    const p = access.project;

    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: p.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });

    const { decision = 'undecided', exclusionReason = '', notes = '', rating, labels = '[]', stage: bodyStage } = req.body || {};
    const validDecisions = ['include', 'exclude', 'maybe', 'undecided'];
    if (!validDecisions.includes(decision)) return res.status(400).json({ error: 'Invalid decision value' });

    // A decision belongs to the record's current review stage unless the
    // caller explicitly targets one (used by the Second Review screen).
    const stage = (bodyStage === 'full_text' || bodyStage === 'title_abstract')
      ? bodyStage
      : (rec.currentStage || 'title_abstract');
    const reviewerName = access.member?.name || req.user.email || '';

    // prompt49 item 1 — capture the PRIOR rating/note so a rescore also fires when
    // a reviewer CLEARS a previously-set quality signal (rating:null / notes:'')
    // while leaving the decision as maybe/undecided — otherwise stale quality/note
    // factors would linger in the persisted AI explanation.
    const prior = await prisma.screenDecision.findUnique({
      where: { recordId_reviewerId_stage: { recordId: rec.id, reviewerId: req.user.id, stage } },
      select: { rating: true, notes: true },
    });

    // One active decision per reviewer per record per stage (schema-enforced).
    const d = await prisma.screenDecision.upsert({
      where: { recordId_reviewerId_stage: { recordId: rec.id, reviewerId: req.user.id, stage } },
      update: {
        decision, exclusionReason, notes, reviewerName,
        rating: rating != null ? parseInt(rating) : null,
        labels: Array.isArray(labels) ? JSON.stringify(labels) : labels,
      },
      create: {
        recordId: rec.id, projectId: p.id, reviewerId: req.user.id, reviewerName, stage,
        decision, exclusionReason, notes,
        rating: rating != null ? parseInt(rating) : null,
        labels: Array.isArray(labels) ? JSON.stringify(labels) : labels,
      },
    });

    // Promotion gate (prompt19 Task 9 — BACKEND-ENFORCED).
    //
    // A record advances title_abstract → full_text ONLY when BOTH hold:
    //   (1) it has at least `effectiveRequired` DISTINCT reviewer decisions at the
    //       title/abstract stage (any decision counts toward "enough reviewers
    //       weighed in"), AND
    //   (2) the include threshold is met: >= getEffectiveQuorum() distinct
    //       reviewers chose INCLUDE (reuses the existing include/quorum logic).
    //
    // `effectiveRequired = max(project.requiredScreeningReviewers||2, quorum)`, so
    // raising requiredScreeningReviewers raises the reviewer bar but never lowers
    // the global two-reviewer guarantee. Insufficient distinct decisions OR too few
    // includes => the record stays pending in title_abstract. include+exclude (and
    // any disagreement) is left to syncConflicts as a CONFLICT (unchanged) — the
    // leader resolves it via resolveConflict. This runs server-side so a forged
    // request body cannot bypass the requirement.
    let promoted = false;
    if (stage === 'title_abstract' && rec.currentStage === 'title_abstract') {
      // 86.md P1.20 — the eligibility engine's governed auto-apply writes real
      // ScreenDecision rows under a dedicated non-human reviewerId. Those must NOT
      // count toward the DISTINCT-HUMAN-REVIEWER promotion quorum: otherwise one
      // human include + one auto-applied engine include silently satisfies the
      // "two independent reviewers" guarantee while PRISMA/audit claim quorum was
      // met by humans. Excluded here at the source. (Conflict detection deliberately
      // STILL sees the engine — see screeningConflictService — so a genuine
      // human-vs-engine disagreement still surfaces for the leader to resolve.)
      const stageDecisions = await prisma.screenDecision.findMany({
        where: { recordId: rec.id, stage: 'title_abstract', decision: { not: 'undecided' }, reviewerId: { not: ELIGIBILITY_ENGINE_REVIEWER_ID } },
        select: { reviewerId: true, decision: true },
      });
      // DISTINCT reviewers: collapse any duplicate rows per reviewer (the unique
      // constraint already enforces one row per reviewer/stage, but be defensive).
      const byReviewer = new Map();
      for (const dec of stageDecisions) byReviewer.set(dec.reviewerId, dec.decision);
      const distinctDecisions = byReviewer.size;
      let includeCount = 0;
      for (const v of byReviewer.values()) if (v === 'include') includeCount++;

      const effectiveRequired = await effectiveRequiredReviewers(p);
      const includeThreshold = await getEffectiveQuorum();

      if (distinctDecisions >= effectiveRequired && includeCount >= includeThreshold) {
        await prisma.screenRecord.update({
          where: { id: rec.id },
          data: { currentStage: 'full_text', promotedAt: new Date(), promotedVia: 'quorum' },
        });
        promoted = true;
        await writeAudit(p.id, req.user, 'RECORD_PROMOTED', {
          entityType: 'record', entityId: rec.id,
          details: { via: 'quorum', includeCount, distinctDecisions, effectiveRequired, includeThreshold },
        });
      }
    }

    // Recalculate the conflict row from the reviewers' CURRENT active decisions
    // BEFORE poking clients, so any refetch triggered by the event observes a
    // consistent conflict state (prompt50 WS3). The decision is already
    // persisted; a sync failure must never fail the save — log and continue.
    try {
      await syncConflicts(p.id, rec.id);
    } catch (e) {
      console.error('[screening] syncConflicts:', e.message);
    }

    // prompt50 WS5 — a screening decision is meaningful activity on the linked
    // META·LAB project; bump its authoritative "Last Modified" timestamp so the
    // project dashboard + Ops analytics reflect it. Awaited (a sub-ms scoped
    // update that never throws) so a subsequent project list is consistent.
    await touchProjectActivity(p.linkedMetaLabProjectId);

    // Realtime poke (Task 7) — deliberately carries NO actor identity
    // (blind-mode safe by construction); recipients refetch what they may see.
    // The Conflicts tab subscribes to this to add/remove a record without reload.
    emitToProjectMembers(p.id, { type: 'decision.saved' }, { exclude: req.user.id });

    // se2.md §6 — near-real-time rescoring. The human decision is ALREADY saved;
    // this only queues a debounced background rescore so rankings reflect the latest
    // labels. Fire-and-forget — it can never block or lose the decision. A settled
    // include/exclude label changes the TRAINING set; a quality rating or reviewer
    // note changes the SEPARATE reviewer-signal layer (prompt49 item 1) — both
    // warrant a rescore so the AI panel reflects the latest human input.
    const hasReviewerSignalInput = rating != null || (typeof notes === 'string' && notes.trim() !== '');
    const hadReviewerSignal = !!prior && (prior.rating != null || (typeof prior.notes === 'string' && prior.notes.trim() !== ''));
    if (decision === 'include' || decision === 'exclude' || hasReviewerSignalInput || hadReviewerSignal) {
      scheduleRescore(p.id, { stage, actor: req.user });
    }

    res.json({ ...d, promoted });
  } catch (err) {
    console.error('[screening] saveDecision:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function listDecisions(req, res) {
  try {
    // Any active member may read (their OWN decisions — the query below is
    // already scoped to reviewerId). Outsiders keep the 404.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isOwner && !access.active) return res.status(403).json({ error: 'Your membership in this project is inactive' });
    const p = access.project;
    const decisions = await prisma.screenDecision.findMany({
      where: { projectId: p.id, reviewerId: req.user.id },
    });
    res.json({ decisions });
  } catch (err) {
    console.error('[screening] listDecisions:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Conflicts ────────────────────────────────────────────────────────

export async function listConflicts(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    // Conflicts/disagreements are a leader/resolver view. In blind mode, normal
    // reviewers never see them (Part 5); only the leader/resolver does.
    if (!access.canResolveConflicts) {
      return res.status(403).json({ error: 'Only the project leader can view conflicts' });
    }
    const conflicts = await prisma.screenConflict.findMany({
      where: { projectId: access.project.id },
      include: { record: { select: { id: true, title: true, authors: true, year: true, abstract: true, currentStage: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ conflicts });
  } catch (err) {
    console.error('[screening] listConflicts:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function resolveConflict(req, res) {
  try {
    // Leader OR a member granted canResolveConflicts may resolve (Part 4 security).
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canResolveConflicts) {
      return res.status(403).json({ error: 'You do not have permission to resolve conflicts in this project' });
    }
    const p = access.project;
    const settings = await getMetaSiftSettings();
    if (!settings.allowConflictResolution) return res.status(403).json({ error: 'Conflict resolution is currently disabled by the administrator' });

    const conflict = await prisma.screenConflict.findFirst({ where: { id: req.params.cid, projectId: p.id } });
    if (!conflict) return res.status(404).json({ error: 'Conflict not found' });

    const { finalDecision, notes = '' } = req.body || {};
    const valid = ['include', 'exclude', 'maybe'];
    if (!valid.includes(finalDecision)) {
      return res.status(400).json({ error: "finalDecision must be 'include', 'exclude', or 'maybe'" });
    }

    // include / exclude are terminal resolutions; 'maybe' keeps the record in the
    // disputed/pending area (prompt2 Task 2), so we don't stamp resolvedAt for it.
    const terminal = finalDecision !== 'maybe';
    const updated = await prisma.screenConflict.update({
      where: { id: conflict.id },
      data: {
        finalDecision,
        notes: String(notes).slice(0, 1000),
        resolvedBy: req.user.id,
        resolvedAt: terminal ? new Date() : null,
      },
    });

    // Resolved as INCLUDE → record becomes eligible for Second Review (full_text).
    let promoted = false;
    const rec = await prisma.screenRecord.findFirst({ where: { id: conflict.recordId, projectId: p.id } });
    if (rec) {
      if (finalDecision === 'include' && rec.currentStage !== 'full_text') {
        await prisma.screenRecord.update({
          where: { id: rec.id },
          data: { currentStage: 'full_text', promotedAt: new Date(), promotedVia: 'conflict_resolution' },
        });
        promoted = true;
      } else if (finalDecision === 'exclude') {
        // Stays out of Second Review; persist the leader's reason on the record.
        await prisma.screenRecord.update({
          where: { id: rec.id },
          data: { rejectedReason: String(notes).slice(0, 500) },
        });
      }
    }

    await writeAudit(p.id, req.user, 'CONFLICT_RESOLVED', {
      entityType: 'record', entityId: conflict.recordId,
      details: { finalDecision, promoted, notes: String(notes).slice(0, 200) },
    });

    // prompt50 WS5 — conflict resolution is meaningful activity (cross-workstream).
    void touchProjectActivity(p.linkedMetaLabProjectId);

    // Realtime poke (Task 7) — a resolution changes effective decisions (no actor in the event).
    emitToProjectMembers(p.id, { type: 'decision.saved' }, { exclude: req.user.id });

    res.json({ ...updated, promoted });
  } catch (err) {
    console.error('[screening] resolveConflict:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Duplicates ───────────────────────────────────────────────────────

export async function listDuplicates(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const groups = await prisma.screenDuplicateGroup.findMany({
      where: { projectId: access.project.id },
      include: { records: { select: {
        id: true, title: true, authors: true, year: true, journal: true,
        doi: true, pmid: true, sourceDb: true, abstract: true, isPrimary: true, isDuplicate: true,
      } } },
      orderBy: { createdAt: 'desc' },
    });
    // Surface an explainable similarity % + a TYPED verdict per group (se2.md §10):
    // the strongest pair's classification, conflicts, and whether a merge may even be
    // suggested. `mergeable:false` (related report / same study family) must never be
    // auto-merged — separate reports of one study are not duplicate records.
    const scored = groups.map(g => {
      const recs = g.records || [];
      let best = null;
      for (let i = 0; i < recs.length; i++) {
        for (let j = i + 1; j < recs.length; j++) {
          const c = classifyPair(recs[i], recs[j]);
          if (!best || c.score >= best.score) best = c;
        }
      }
      const v = best || { score: 0, reasons: [], conflicts: [], type: DUP_TYPES.NOT, mergeable: false };
      return {
        ...g,
        similarity: v.score,
        similarityReason: (v.reasons || []).join('; '),
        dupType: v.type,
        dupTypeLabel: DUP_TYPE_LABEL[v.type] || v.type,
        dupConflicts: v.conflicts || [],
        mergeable: !!v.mergeable,
        resolved: !!g.resolvedAt,
      };
    });
    // Leaders also get the evaluation of the classifier against accrued reviewer labels.
    const evaluation = access.isLeader ? await getDuplicateEvaluation(access.project.id, prisma).catch(() => null) : null;
    res.json({ groups: scored, isLeader: access.isLeader, evaluation });
  } catch (err) {
    console.error('[screening] listDuplicates:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function detectDuplicates(req, res) {
  try {
    // Outsider → 404; active member without canManageDuplicates (and not
    // leader/owner) → 403.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canManage = access.isOwner || (access.active && (access.isLeader || access.perms.canManageDuplicates));
    if (!canManage) return res.status(403).json({ error: 'You do not have permission to manage duplicates in this project' });
    const p = access.project;
    const settings = await getMetaSiftSettings();
    if (!settings.allowDuplicateDetection) return res.status(403).json({ error: 'Duplicate detection is currently disabled by the administrator' });
    const result = await detectDuplicatesInProject(p.id, prisma);
    res.json(result);
  } catch (err) {
    console.error('[screening] detectDuplicates:', err.message);
    res.status(500).json({ error: 'Detection failed: ' + err.message });
  }
}

export async function resolveDuplicateGroup(req, res) {
  try {
    // Same guard as detectDuplicates: outsider 404, member without permission 403.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canManage = access.isOwner || (access.active && (access.isLeader || access.perms.canManageDuplicates));
    if (!canManage) return res.status(403).json({ error: 'You do not have permission to manage duplicates in this project' });
    const p = access.project;
    const group = await prisma.screenDuplicateGroup.findFirst({ where: { id: req.params.gid, projectId: p.id } });
    if (!group) return res.status(404).json({ error: 'Duplicate group not found' });
    const { primaryId, keepAll } = req.body || {};

    // se2.md §10 — accrue a reviewer-confirmed label for every pair in this group so the
    // duplicate classifier can be evaluated against real decisions. Best-effort: a
    // labelling failure must never block the resolution. Fetch the records once up front.
    const labelPairs = async (label) => {
      try {
        const recs = await prisma.screenRecord.findMany({
          where: { duplicateGroupId: group.id },
          select: { id: true, title: true, doi: true, pmid: true, authors: true, year: true, journal: true, abstract: true },
        });
        await recordDuplicateLabels({ projectId: p.id, records: recs, label, reviewerId: req.user.id, prisma });
      } catch (e) { console.error('[screening] duplicate label accrual failed:', e.message); }
    };

    // prompt23 Task 10 — "Not duplicates / keep all": the suggestion was a false
    // positive. Resolve the group WITHOUT merging — every record stays active (no
    // record is flagged isDuplicate), so both remain in screening.
    if (keepAll) {
      await labelPairs('not_duplicate');
      await prisma.screenRecord.updateMany({ where: { duplicateGroupId: group.id }, data: { isDuplicate: false, isPrimary: false } });
      await prisma.screenDuplicateGroup.update({ where: { id: group.id }, data: { resolvedAt: new Date(), primaryId: null } });
      await writeAudit(p.id, req.user, 'DUPLICATE_GROUP_KEEP_ALL', { entityType: 'duplicateGroup', entityId: group.id });
      emitToProjectMembers(p.id, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json({ resolved: true, keepAll: true });
    }

    if (!primaryId) return res.status(400).json({ error: 'primaryId is required' });

    // Reviewer confirmed these ARE the same record → label every pair 'duplicate'.
    await labelPairs('duplicate');
    // 65.md SCR-4(b) — fill-blank-only metadata merge: the reviewer confirmed these
    // are one record, so the kept copy inherits any metadata it is MISSING (abstract/
    // DOI/PMID/…) from the discarded copies. Never overwrites a non-empty field.
    const groupRecs = await prisma.screenRecord.findMany({
      where: { duplicateGroupId: group.id },
      select: { id: true, title: true, authors: true, year: true, journal: true, doi: true, pmid: true, abstract: true, keywords: true, createdAt: true },
    });
    const primaryRec = groupRecs.find(r => r.id === primaryId);
    if (!primaryRec) return res.status(400).json({ error: 'primaryId is not in this duplicate group' });
    const { patch, filledFrom } = mergeFillBlanks(primaryRec, groupRecs.filter(r => r.id !== primaryId));
    // Mark all in group as duplicate, except primary
    await prisma.screenRecord.updateMany({ where: { duplicateGroupId: group.id }, data: { isDuplicate: true, isPrimary: false } });
    await prisma.screenRecord.update({ where: { id: primaryId }, data: { isDuplicate: false, isPrimary: true, ...patch } });
    await prisma.screenDuplicateGroup.update({ where: { id: group.id }, data: { resolvedAt: new Date(), primaryId } });
    await writeAudit(p.id, req.user, 'DUPLICATE_GROUP_RESOLVED', {
      entityType: 'duplicateGroup', entityId: group.id, primaryId,
      details: { mergedFields: Object.keys(patch), filledFrom },
    });
    emitToProjectMembers(p.id, { type: 'project.updated' }, { exclude: req.user.id });

    res.json({ resolved: true, primaryId, mergedFields: Object.keys(patch) });
  } catch (err) {
    console.error('[screening] resolveDuplicateGroup:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/duplicates/resolve-exact (65.md SCR-4a) — bulk-resolve every
 * unresolved group whose members ALL pairwise-classify as exact_duplicate (hard
 * DOI/PMID identifier match, confidence .99). Non-destructive: the most complete
 * record is kept as primary (with a fill-blank metadata merge), the rest are only
 * FLAGGED isDuplicate — nothing is deleted. Fuzzy/related groups are skipped for
 * human review.
 */
export async function resolveAllExactDuplicates(req, res) {
  try {
    // Same guard as detectDuplicates: outsider 404, member without permission 403.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canManage = access.isOwner || (access.active && (access.isLeader || access.perms.canManageDuplicates));
    if (!canManage) return res.status(403).json({ error: 'You do not have permission to manage duplicates in this project' });
    const p = access.project;

    const groups = await prisma.screenDuplicateGroup.findMany({
      where: { projectId: p.id, resolvedAt: null },
      include: { records: { select: {
        id: true, title: true, authors: true, year: true, journal: true,
        doi: true, pmid: true, abstract: true, keywords: true, createdAt: true,
      } } },
    });

    let resolvedGroups = 0, flaggedDuplicates = 0, mergedFieldCount = 0, skippedGroups = 0;
    for (const group of groups) {
      const recs = group.records || [];
      if (recs.length < 2 || !isExactDuplicateGroup(recs)) { skippedGroups += 1; continue; }
      const primary = pickBulkPrimary(recs);
      const others = recs.filter(r => r.id !== primary.id);
      const { patch, filledFrom } = mergeFillBlanks(primary, others);

      // Accrue reviewer-confirmed labels (best-effort — must never block the resolve).
      try { await recordDuplicateLabels({ projectId: p.id, records: recs, label: 'duplicate', reviewerId: req.user.id, prisma }); }
      catch (e) { console.error('[screening] duplicate label accrual failed:', e.message); }

      await prisma.screenRecord.updateMany({ where: { duplicateGroupId: group.id }, data: { isDuplicate: true, isPrimary: false } });
      await prisma.screenRecord.update({ where: { id: primary.id }, data: { isDuplicate: false, isPrimary: true, ...patch } });
      await prisma.screenDuplicateGroup.update({ where: { id: group.id }, data: { resolvedAt: new Date(), primaryId: primary.id } });
      await writeAudit(p.id, req.user, 'DUPLICATE_GROUP_RESOLVED', {
        entityType: 'duplicateGroup', entityId: group.id, primaryId: primary.id,
        details: { bulk: 'resolve-exact', mergedFields: Object.keys(patch), filledFrom },
      });
      resolvedGroups += 1;
      flaggedDuplicates += others.length;
      mergedFieldCount += Object.keys(patch).length;
    }

    if (resolvedGroups > 0) emitToProjectMembers(p.id, { type: 'project.updated' }, { exclude: req.user.id });
    res.json({ resolvedGroups, flaggedDuplicates, mergedFieldCount, skippedGroups });
  } catch (err) {
    console.error('[screening] resolveAllExactDuplicates:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Labels ────────────────────────────────────────────────────────────

export async function listLabels(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const labels = await prisma.screenLabel.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
    res.json({ labels });
  } catch (err) {
    console.error('[screening] listLabels:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createLabel(req, res) {
  try {
    // Label management is leader/owner-level. Outsiders keep the 404.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!(access.isOwner || (access.active && access.isLeader))) {
      return res.status(403).json({ error: 'Only the project owner or a leader can manage labels' });
    }
    const p = access.project;
    const { name, color = '#5b9cf6' } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const label = await prisma.screenLabel.create({ data: { projectId: p.id, name: name.trim(), color } });
    res.status(201).json(label);
  } catch (err) {
    console.error('[screening] createLabel:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteLabel(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!(access.isOwner || (access.active && access.isLeader))) {
      return res.status(403).json({ error: 'Only the project owner or a leader can manage labels' });
    }
    const p = access.project;
    const label = await prisma.screenLabel.findFirst({ where: { id: req.params.lid, projectId: p.id } });
    if (!label) return res.status(404).json({ error: 'Label not found' });
    await prisma.screenLabel.delete({ where: { id: label.id } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteLabel:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Exclusion reasons ────────────────────────────────────────────────

export async function listReasons(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const reasons = await prisma.screenExclusionReason.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
    res.json({ reasons });
  } catch (err) {
    console.error('[screening] listReasons:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createReason(req, res) {
  try {
    // Exclusion-reason management is leader/owner-level. Outsiders keep the 404.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!(access.isOwner || (access.active && access.isLeader))) {
      return res.status(403).json({ error: 'Only the project owner or a leader can manage exclusion reasons' });
    }
    const p = access.project;
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    const reason = await prisma.screenExclusionReason.create({ data: { projectId: p.id, text: text.trim() } });
    res.status(201).json(reason);
  } catch (err) {
    console.error('[screening] createReason:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteReason(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!(access.isOwner || (access.active && access.isLeader))) {
      return res.status(403).json({ error: 'Only the project owner or a leader can manage exclusion reasons' });
    }
    const p = access.project;
    const reason = await prisma.screenExclusionReason.findFirst({ where: { id: req.params.rid2, projectId: p.id } });
    if (!reason) return res.status(404).json({ error: 'Reason not found' });
    await prisma.screenExclusionReason.delete({ where: { id: reason.id } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteReason:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Stats ─────────────────────────────────────────────────────────────

export async function getStats(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;

    const [total, myDecisions, conflicts, duplicates] = await Promise.all([
      prisma.screenRecord.count({ where: { projectId: p.id } }),
      prisma.screenDecision.findMany({ where: { projectId: p.id, reviewerId: req.user.id } }),
      prisma.screenConflict.count({ where: { projectId: p.id, resolvedAt: null } }),
      prisma.screenRecord.count({ where: { projectId: p.id, isDuplicate: true } }),
    ]);

    const counts = { include: 0, exclude: 0, maybe: 0, undecided: 0 };
    myDecisions.forEach(d => { if (counts[d.decision] !== undefined) counts[d.decision]++; });
    const screened = counts.include + counts.exclude + counts.maybe;
    counts.undecided = total - screened;

    res.json({
      total, screened,
      included: counts.include,
      excluded: counts.exclude,
      maybe: counts.maybe,
      undecided: counts.undecided,
      conflicts,
      duplicates,
      progress: total > 0 ? Math.round((screened / total) * 100) : 0,
    });
  } catch (err) {
    console.error('[screening] getStats:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── META·LAB integration: PRISMA summary for a linked META·LAB project ──
// GET /metalab/:mlpid/summary — returns screening-derived PRISMA flow numbers
// for the META·SIFT project linked to the given META·LAB project. Used by the
// monolith to auto-update its PRISMA diagram (Part 12).
//
// Membership-aware (prompt6 Tasks 3/8): the link belongs to the workspace, not
// the individual user — a user sees linked:true when they OWN the linked
// screening project OR are an ACTIVE member of it. (Previously this filtered by
// ownerId, so added members saw linked:false in META·LAB/PRISMA.)
export async function getMetaLabSummary(req, res) {
  try {
    const candidates = await prisma.screenProject.findMany({
      // deletedAt:null — soft-deleted workspaces no longer answer for the pair (prompt9).
      where: { linkedMetaLabProjectId: req.params.mlpid, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    // Prefer the caller's own workspace (preserves the pre-prompt6 behavior
    // when the same META·LAB project is linked from more than one workspace).
    let sp = candidates.find(x => x.ownerId === req.user.id) || null;
    if (!sp && candidates.length) {
      const membership = await prisma.screenProjectMember.findFirst({
        where: { projectId: { in: candidates.map(x => x.id) }, userId: req.user.id, status: 'active' },
        select: { projectId: true },
      });
      if (membership) sp = candidates.find(x => x.id === membership.projectId) || null;
    }
    if (!sp) return res.json({ linked: false });

    const [records, decisions, conflicts, dupGroups, batches, pecanSources] = await Promise.all([
      prisma.screenRecord.findMany({ where: { projectId: sp.id } }),
      prisma.screenDecision.findMany({ where: { projectId: sp.id }, select: { recordId: true, reviewerId: true, decision: true, stage: true } }),
      prisma.screenConflict.findMany({ where: { projectId: sp.id }, select: { resolvedAt: true } }),
      prisma.screenDuplicateGroup.findMany({ where: { projectId: sp.id }, select: { resolvedAt: true, createdAt: true } }),
      prisma.screenImportBatch.findMany({ where: { projectId: sp.id }, select: { preDedupCount: true, duplicateCount: true, createdAt: true, source: true } }),
      // 78.md #4 — the AUTOMATED (Pecan Search Engine) runs that LANDED in THIS resolved
      // workspace (sp.id — recs round: scoped to the SAME ScreenProject as `records`/
      // `batches`, NOT the raw mlpid, so when one META·LAB project is linked from more
      // than one workspace the automated dedup aligns with the records it counts). The
      // engine removes cross-source duplicates BEFORE landing, so those raw retrievals
      // never became ScreenRecords/import batches; we fold their exact+fuzzy dedup into
      // the PRISMA identified/duplicates-removed counts below so an automated search's
      // flow reflects the true retrieval. Fail-soft: any error → no automated contribution.
      prisma.pecanSearchSource.findMany({
        where: { run: { screenProjectId: sp.id } },
        select: { exactDupCount: true, fuzzyDupCount: true },
      }).catch(() => []),
    ]);
    const total              = records.length;
    // 58.md §7 — PRISMA must show total-identified BEFORE dedup + ALL duplicates
    // removed, for EVERY source (file + Pecan Search). Import-time duplicates were
    // skipped at insert (never become ScreenRecords), so they are recovered from the
    // per-batch dedup accounting; post-import detected duplicates are flagged on the
    // surviving records. `identified` = pre-dedup total; `screened` = pool after dedup.
    const importDuplicates   = batches.reduce((a, b) => a + (b.duplicateCount || 0), 0);
    const preDedupAccounting = batches.reduce((a, b) => a + (b.preDedupCount || 0), 0);
    const postImportDupes    = records.filter(r => r.isDuplicate).length;
    // 78.md #4 — automated-run cross-source duplicates (engine-removed before landing).
    // existingMatch is excluded on purpose (rerun-safety — see prismaDerive.js).
    const pecanExactDup      = pecanSources.reduce((a, s) => a + (s.exactDupCount || 0), 0);
    const pecanFuzzyDup      = pecanSources.reduce((a, s) => a + (s.fuzzyDupCount || 0), 0);
    // Manual + imported + automated all feed the SAME normalized derivation (pure helper).
    const { identified, duplicatesRemoved, screened } = derivePrismaIdentification({
      recordCount: total, importDuplicates, postImportDuplicates: postImportDupes, pecanExactDup, pecanFuzzyDup,
    });

    // 77.md §1 — HONEST deduplication metadata so the Manuscript Editor never reports a
    // confident "0 duplicates" when dedup was never performed (or is only legacy data with
    // no accounting). `performed` is the tri-state signal; method distinguishes the
    // automatic import-time dedupe (dedupeAndInsertRecords) from human duplicate-group
    // resolution; lastRunAt is the most recent of either.
    const anyImportAccounting = preDedupAccounting > 0 || importDuplicates > 0;
    const dupGroupCount       = dupGroups.length;
    const dedupPerformed      = anyImportAccounting || postImportDupes > 0 || dupGroupCount > 0;
    const dedupMethod         = anyImportAccounting && dupGroupCount > 0 ? 'combination'
      : anyImportAccounting ? 'automatic'
        : (dupGroupCount > 0 || postImportDupes > 0) ? 'manual' : null;
    // Only a batch that actually recorded dedup accounting (or a resolved duplicate group)
    // counts as a dedup "run", so lastRunAt aligns with `performed` and is null when dedup
    // was never performed (review finding).
    const dedupTimes = [
      ...batches.filter(b => (b.preDedupCount || 0) > 0 || (b.duplicateCount || 0) > 0).map(b => b.createdAt),
      ...dupGroups.map(g => g.resolvedAt || g.createdAt),
    ].filter(Boolean).map(t => new Date(t).getTime()).filter(n => Number.isFinite(n));
    const dedupLastRunAt = dedupPerformed && dedupTimes.length ? new Date(Math.max(...dedupTimes)).toISOString() : null;
    const fullTextAssessed   = records.filter(r => r.currentStage === 'full_text').length;
    const excludedTitleAbstract = Math.max(0, screened - fullTextAssessed);
    const fullTextExcluded   = records.filter(r => r.finalStatus === 'rejected').length;
    const acceptedRecords    = records.filter(r => r.finalStatus === 'accepted');
    const includedFinal      = acceptedRecords.length;

    // prompt29 Part 9 — true screening completeness for the main workflow stepper.
    // The old rule ("any included study → done") flipped Screening green too early.
    // Mirror the Screening module's own substep rules (see screeningOverviewController
    // + ui/screeningSteps.js): every substep must be finished. Assumptions are
    // documented in docs/manager/screening-completion-rule.md.
    // 81.md (requiredScreeningReviewers audit) — floor by the SAME admin-driven quorum
    // the promotion gate uses (effectiveRequiredReviewers → getEffectiveQuorum), not the
    // hardcoded QUORUM=2. Under the default (minIncludeQuorum=2) this is identical; when
    // an admin raises the global quorum it stops "done screening" from displaying at
    // fewer reviewers than promotion actually requires. Monotonic — never lowers the bar.
    const effectiveRequired = await effectiveRequiredReviewers(sp);
    const taReviewers = {};
    for (const d of decisions) {
      if (d.stage === 'title_abstract' && d.decision !== 'undecided') (taReviewers[d.recordId] ||= new Set()).add(d.reviewerId);
    }
    const titleAbstractPending      = records.filter(r => !r.isDuplicate && r.currentStage === 'title_abstract' && (taReviewers[r.id]?.size || 0) < effectiveRequired).length;
    const unresolvedConflicts       = conflicts.filter(c => !c.resolvedAt).length;
    const unresolvedDuplicateGroups = dupGroups.filter(g => !g.resolvedAt).length;
    const eligibleSecondReview      = fullTextAssessed;
    const secondReviewPending       = Math.max(0, eligibleSecondReview - includedFinal - fullTextExcluded);
    const screeningStarted  = total > 0;
    const screeningComplete = isScreeningComplete({
      total, unresolvedDuplicateGroups, titleAbstractPending,
      unresolvedConflicts, secondReviewPending, includedFinal,
    });

    // Accepted studies, ready for the META·LAB Data Extraction pull-merge (BUG 5).
    // Idempotent on the client via screeningRecordId / doi / pmid / title.
    const acceptedStudies = acceptedRecords.map(r => studyFromRecord(r, req.user));

    res.json({
      linked: true,
      screeningProjectId: sp.id,
      title: sp.title,
      prisma: { identified, duplicatesRemoved, screened, excludedTitleAbstract, fullTextAssessed, fullTextExcluded, included: includedFinal },
      // 77.md §1 — canonical, honest dedup metadata for the Manuscript Editor + PRISMA.
      dedup: {
        performed: dedupPerformed,
        method: dedupMethod,
        lastRunAt: dedupLastRunAt,
        beforeDedup: identified,
        duplicatesDetected: duplicatesRemoved,
        duplicatesRemoved,
        afterDedup: screened,
      },
      // 77.md §1 — per-source identification split (databases vs registers vs other) from
      // ScreenRecord.sourceDb. `exact` is true only when there were no import-time duplicates,
      // so the split (over surviving records) equals `identified` and can safely drive the
      // PRISMA dbs/reg/other cells; otherwise it is an informational breakdown only.
      sources: { ...splitBySource(records), exact: importDuplicates === 0 },
      // prompt29 Part 9 — workflow-stepper completeness signals.
      screeningStarted,
      screeningComplete,
      screeningPending: { titleAbstractPending, unresolvedConflicts, unresolvedDuplicateGroups, secondReviewPending },
      acceptedStudies,
    });
  } catch (err) {
    console.error('[screening] getMetaLabSummary:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /metalab/:mlpid/study-record/:studyId  (prompt29 Part 2)
 *
 * Resolve the screening RECORD (if any) a META·LAB study was handed off from, so
 * the RoB workspace can REUSE the screening PDF panel (same paper → same file,
 * no duplicate PDF system). Mirrors getMetaLabSummary's workspace resolution
 * (own workspace preferred, else active membership). recordId is null when the
 * study was not created from a screening hand-off (e.g. a manually added study).
 *
 * Returns { linked, screenProjectId, recordId }. No access → { linked:false }.
 */
export async function getMetaLabStudyRecord(req, res) {
  try {
    const candidates = await prisma.screenProject.findMany({
      where: { linkedMetaLabProjectId: req.params.mlpid, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    let sp = candidates.find(x => x.ownerId === req.user.id) || null;
    if (!sp && candidates.length) {
      const membership = await prisma.screenProjectMember.findFirst({
        where: { projectId: { in: candidates.map(x => x.id) }, userId: req.user.id, status: 'active' },
        select: { projectId: true },
      });
      if (membership) sp = candidates.find(x => x.id === membership.projectId) || null;
    }
    if (!sp) return res.json({ linked: false, screenProjectId: null, recordId: null });

    const studyId = String(req.params.studyId || '');
    let recordId = null;
    let record = null;
    if (studyId) {
      // prompt32 Task 2 — additively return the article fields so the RoB workspace
      // can render an "Article Information" tab + a real header WITHOUT a second
      // round-trip. All columns already exist on ScreenRecord (no schema change).
      const rec = await prisma.screenRecord.findFirst({
        where: { projectId: sp.id, handoffStudyId: studyId },
        select: {
          id: true, title: true, authors: true, year: true, journal: true,
          doi: true, pmid: true, abstract: true, keywords: true, sourceDb: true,
          isDuplicate: true, currentStage: true, finalStatus: true, acceptedAt: true,
          rejectedReason: true, handoffStatus: true,
        },
      });
      recordId = rec?.id || null;
      if (rec) {
        const { id, ...fields } = rec;
        record = { id, ...fields };
      }
    }
    return res.json({ linked: true, screenProjectId: sp.id, recordId, record });
  } catch (err) {
    console.error('[screening] getMetaLabStudyRecord:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /metalab/:mlpid/workspace  (prompt18 — unified Review Workspace)
 *
 * Resolve — and, for the project OWNER, silently create — the internal META·SIFT
 * screening module for a META·LAB project. This powers the unified "Screening"
 * stage so the frontend never asks the user to link anything.
 *
 * Returns { screenProjectId, ownerId, created, repaired }.
 * 404 when the caller has no access to the project (existence-hiding).
 * (Under checkEnabled — returns 503 when META·SIFT is disabled by an admin.)
 */
export async function getWorkspace(req, res) {
  try {
    const result = await ensureScreenModuleForMetaLab(req.params.mlpid, req.user);
    if (!result) return res.status(404).json({ error: 'Project not found' });
    return res.json(result);
  } catch (err) {
    console.error('[screening] getWorkspace:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
