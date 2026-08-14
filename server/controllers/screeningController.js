/**
 * screeningController.js — META·SIFT Beta API handlers.
 */
// 86.md P1.9 — use the provider-selected, pragma'd SHARED client, not a second
// bare-schema PrismaClient (SQLite-only; splits brain under Postgres, and misses
// the WAL/busy_timeout pragmas applied only to the shared client's connection).
import { prisma } from '../db/client.js';
// 93.md — provider-aware record search: keeps the case-insensitive behaviour
// SQLite gave for free when running on PostgreSQL (mode:'insensitive' → ILIKE).
import { insensitiveContains } from '../db/searchMode.js';
import { createHash } from 'crypto';
import { recordDuplicateLabels, getDuplicateEvaluation } from '../services/screeningDuplicateService.js';
// 92.md — duplicate detection is a durable background job now (the old sync sweep froze
// the whole server); the endpoints below only enqueue/inspect/cancel ScreenDuplicateJob rows.
import { enqueueDuplicateJob, cancelDuplicateJob as cancelDuplicateJobRow } from '../services/screeningDuplicateWorker.js';
import { syncConflicts, CONFLICT_STAGE } from '../services/screeningConflictService.js';
import { ELIGIBILITY_ENGINE_REVIEWER_ID, ELIGIBILITY_ENGINE_REVIEWER_NAME } from '../services/screeningEligibilityService.js';
import { touchProjectActivity } from '../store.js';
import {
  parseImportContent, dedupeAndInsertRecords, hasUsableIdentity,
  MAX_RECORDS_PER_IMPORT, DEFAULT_MAX_RECORDS_PER_PROJECT,
} from '../services/screeningImportService.js';
import { kickImportWorker } from '../services/screeningImportWorker.js';
// 96.md Phase 6F — enqueue-side reset fence: while a scoped reset holds the
// project's in-process lock, imports/duplicate-detection must 409 instead of
// racing the delete transaction (see server/screening/resetLock.js).
import { isResetLocked } from '../screening/resetLock.js';
import { getProjectAccess, ensureLeaderMember, writeAudit, QUORUM } from '../screening/access.js';
// 109.md §22 — keyword mutations were completely unaudited; the pure row builder
// lives beside the other screening helpers so its shape is unit-testable.
import { keywordAuditRows, normalizeKeywordVia, KEYWORD_AUDIT_VIA } from '../screening/keywordAudit.js';
import { rankItems } from '../../src/research-engine/screening/ai/ranking.js';
import { splitBySource } from '../../src/research-engine/screening/sourceClassify.js';
import { fastListEligible, buildFastListQuery } from '../../src/research-engine/screening/recordListQuery.js';
// 100.md §§12-15 — pure Resume Screening logic (target selection, keyset cursor, page
// math, user-facing wording), shared with the client so both say the same thing.
import {
  normalizeResumeStage, afterCursor, pickResumeTarget, resumePage, resumeMessage,
} from '../../src/research-engine/screening/resumeState.js';
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
import { resolveKeywordState } from '../../src/research-engine/screening/criteriaKeywords.js';
// 107.md §2 — the shared keyword reducer: the ops endpoint below and the client
// apply EXACTLY the same rules, and the read-modify-write runs inside a transaction
// so two leaders editing single terms concurrently no longer clobber whole lists.
import {
  applyKeywordOps, normalizeKeywordMeta, materializeDefaults,
  KEYWORD_OPS, KEYWORD_LISTS, KEYWORD_ORIGIN, MAX_KEYWORD_LENGTH, MAX_KEYWORD_OPS,
} from '../../src/research-engine/screening/keywordModel.js';
import { isScreeningComplete } from '../utils/screeningCompletion.js';
// 98.md §14 Defect 1 — substep evidence for the 'done' sign-off corroboration warning.
import { loadScreeningProgressEvidence } from '../screening/progressEvidence.js';
import { mkProject } from '../../src/research-engine/project-model/defaults.js';
import { filterRecordsByKeywords, countArticlesByKeyword } from '../../src/research-engine/screening/keywordFilter.js';
import { studyFromRecord } from './screeningReviewController.js';
import { recordUsage, USAGE } from '../utils/usage.js';
// 93.md §5.3 — activation funnel: ONLY the user's first-ever screening decision
// is a usage event (per-decision rows live in ScreenDecision already).
import { recordEvent, recordFirstEvent } from '../services/analytics.js';
import { ensureScreenModuleForMetaLab } from '../screening/ensureWorkspace.js';
// 116.md §10/§13 — record-metadata editing from the PRISMA inspector: the
// identification-source override validates against the model's own bucket ids.
import { IDENTIFICATION_SOURCE_IDS } from '../../src/research-engine/prisma/model.js';

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

// 100.md §14 — the user-facing name of each screening stage, used in the Resume
// Screening wording ("You have completed screening for Title & Abstract."). Mirrors
// the client labels in src/frontend/screening/pages/SiftProject.jsx.
const STAGE_LABELS = { title_abstract: 'Title & Abstract', full_text: 'Final Review' };

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
      requiredScreeningReviewers, keywordMeta,
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
    // 107.md §2 — the review-state column is structured, so unlike the sibling
    // keyword arrays it is VALIDATED (garbage degrades to the empty canonical
    // shape) rather than written through unchecked.
    if (keywordMeta !== undefined) data.keywordMeta = JSON.stringify(normalizeKeywordMeta(keywordMeta));
    if (chatRestricted !== undefined) data.chatRestricted = !!chatRestricted;

    const updated = await prisma.screenProject.update({ where: { id: p.id }, data });

    // 98.md §14 Defect 1 — sign-off corroboration. The leader may still mark the
    // workspace 'done' freely (deliberately NOT hard-rejected), but when the
    // substep evidence says screening work is pending we return an ADDITIVE
    // warning with the row — the canonical progress model no longer trusts an
    // uncorroborated sign-off, and the client should be able to say why.
    let statusWarning;
    if (data.progressStatus === 'done') {
      try {
        const evd = await loadScreeningProgressEvidence(updated);
        if (!evd.complete) {
          const parts = [];
          if (evd.total === 0) parts.push('no records imported');
          if (evd.titleAbstractPending > 0) parts.push(`${evd.titleAbstractPending} awaiting title/abstract review`);
          if (evd.unresolvedConflicts > 0) parts.push(`${evd.unresolvedConflicts} unresolved conflict${evd.unresolvedConflicts === 1 ? '' : 's'}`);
          if (evd.unresolvedDuplicateGroups > 0) parts.push(`${evd.unresolvedDuplicateGroups} unresolved duplicate group${evd.unresolvedDuplicateGroups === 1 ? '' : 's'}`);
          if (evd.secondReviewPending > 0) parts.push(`${evd.secondReviewPending} awaiting a full-text decision`);
          statusWarning = `Marked done, but screening work is pending${parts.length ? ` (${parts.join(', ')})` : ''}. `
            + 'Project progress will not show Screening as complete until the work is finished.';
        }
      } catch { /* corroboration is best-effort — never blocks or slows the save */ }
    }

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
          // 98.md §14 Defect 1 — leave a trail when 'done' was signed off with
          // screening work still pending (the write is accepted regardless).
          details: { from: p.progressStatus, to: data.progressStatus, ...(statusWarning ? { pendingWorkAtSignOff: true } : {}) },
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

    // 98.md §14 Defect 1 — `statusWarning` is additive; the wire contract stays
    // "the updated ScreenProject object" for every consumer that ignores it.
    res.json(statusWarning ? { ...updated, statusWarning } : updated);
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
        { title: insensitiveContains(search) },
        { authors: insensitiveContains(search) },
        { abstract: insensitiveContains(search) },
        { doi: insensitiveContains(search) },
        { pmid: insensitiveContains(search) },
      ];
    }

    // Pull all decisions (for reviewer indicators + quorum) and this user's open-state.
    const records = await prisma.screenRecord.findMany({
      where,
      // 100.md §§13/15 — the id tiebreak the FAST path already had (recordListQuery.js)
      // was missing here, so a bulk import (thousands of rows sharing one createdAt)
      // could hand back a DIFFERENT order on every request. Resume Screening reports a
      // position in this order, and "article 412" has to mean the same article twice.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

/* ── 116.md §10 — record metadata editing (the PRISMA inspector's write path) ──
 *
 * PATCH /projects/:pid/records/:rid — bibliographic/provenance METADATA only.
 * Decision-state changes (include↔exclude, retrieval) are NOT accepted here: they
 * go through the existing domain actions (saveDecision / finalizeRecord /
 * revertFinalReview), which own their side-effects. The one decision-adjacent
 * field allowed is `rejectedReason` — re-wording an ALREADY-rejected record's
 * exclusion reason (leader/conflict-resolver only), which changes reporting, not
 * state.
 *
 * Permission: the same bar as putting records INTO the project (importRecords) —
 * owner/leader, or an active non-viewer member with canImportRecords. Outsiders
 * keep the existence-hiding 404. Blind mode: a non-leader must not edit the
 * fields the wire hides from them (authors/journal).
 */
const RECORD_PATCH_FIELDS = Object.freeze({
  title: { cap: 1000 },
  authors: { cap: 500, blindHidden: true },
  year: { cap: 4, validate: (v) => (v === '' || /^\d{4}$/.test(v)) || 'year must be a 4-digit year' },
  journal: { cap: 300, blindHidden: true },
  doi: { cap: 200, normalize: (v) => v.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') },
  pmid: { cap: 50, validate: (v) => (v === '' || /^\d+$/.test(v)) || 'pmid must be digits only' },
  sourceDb: { cap: 100 },
  identificationSource: {
    cap: 40,
    validate: (v) => (v === '' || IDENTIFICATION_SOURCE_IDS.includes(v)) || 'identificationSource is not a known PRISMA bucket',
  },
  sourceDetail: { cap: 300 },
  rejectedReason: { cap: 500, requiresFinalize: true },
});

export async function updateRecordMetadata(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const canEdit = access.isOwner || access.isLeader
      || !!(access.active && access.member && access.member.role !== 'viewer' && access.perms.canImportRecords);
    if (!canEdit) return res.status(403).json({ error: 'You do not have permission to edit records in this project' });

    const rec = await prisma.screenRecord.findFirst({
      where: { id: req.params.rid, projectId: p.id },
    });
    if (!rec) return res.status(404).json({ error: 'Record not found' });

    const blind = p.blindMode && !access.isLeader;
    const canFinalize = !!(access.isLeader || access.canResolveConflicts);

    const body = req.body || {};
    const data = {};
    const changed = {};
    for (const [field, spec] of Object.entries(RECORD_PATCH_FIELDS)) {
      if (body[field] === undefined) continue;
      if (spec.blindHidden && blind) {
        return res.status(403).json({ error: `Blind mode hides ${field} from you, so it cannot be edited here` });
      }
      if (spec.requiresFinalize) {
        if (!canFinalize) return res.status(403).json({ error: 'Only the project leader can edit the final exclusion reason' });
        if (rec.finalStatus !== 'rejected') {
          return res.status(400).json({ error: 'rejectedReason applies only to a record with a final rejection' });
        }
      }
      let v = String(body[field] == null ? '' : body[field]).trim();
      if (spec.normalize) v = spec.normalize(v);
      if (spec.validate) {
        const ok = spec.validate(v);
        if (ok !== true) return res.status(400).json({ error: ok });
      }
      v = v.slice(0, spec.cap);
      const before = String(rec[field] == null ? '' : rec[field]);
      if (v === before) continue;
      data[field] = v;
      changed[field] = { from: before.slice(0, 200), to: v.slice(0, 200) };
    }
    // A body with no editable field at all is a caller error, not a silent no-op.
    if (!Object.keys(body).some((k) => RECORD_PATCH_FIELDS[k])) {
      return res.status(400).json({ error: 'No editable field in request' });
    }
    if (!Object.keys(data).length) {
      // Nothing actually changed — idempotent success (the inspector's undo path
      // may legitimately re-apply the current state).
      return res.json({ record: shapeUpdatedRecord(rec, blind), changed: {} });
    }

    const updated = await prisma.screenRecord.update({ where: { id: rec.id }, data });

    await writeAudit(p.id, req.user, 'RECORD_UPDATED', {
      entityType: 'record', entityId: rec.id, details: { changed },
    });
    void touchProjectActivity(p.linkedMetaLabProjectId);
    // Thin poke (no content, no actor) — open PRISMA tabs refetch the flow.
    emitToProjectMembers(p.id, { type: 'record.updated', ids: [rec.id] }, { exclude: req.user.id });

    return res.json({ record: shapeUpdatedRecord(updated, blind), changed });
  } catch (err) {
    console.error('[screening] updateRecordMetadata:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** The PATCH response shape — blind-mode suppression matches listRecords (81.md). */
function shapeUpdatedRecord(r, blind) {
  return {
    id: r.id,
    title: r.title,
    authors: blind ? '' : r.authors,
    journal: blind ? '' : r.journal,
    year: r.year,
    doi: r.doi,
    pmid: r.pmid,
    sourceDb: r.sourceDb,
    identificationSource: r.identificationSource || '',
    sourceDetail: r.sourceDetail || '',
    rejectedReason: r.rejectedReason || '',
    currentStage: r.currentStage,
    finalStatus: r.finalStatus,
  };
}

export async function deleteRecord(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: p.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    // 96.md — provenance rows are bare-scoped (no FK cascade); clean them here
    // like the reset/batch-delete paths so nothing dangles after a record delete.
    for (const model of ['screenRecordSource', 'screenRecordMetadataChange']) {
      try { if (prisma[model]) await prisma[model].deleteMany({ where: { screenRecordId: rec.id } }); }
      catch { /* model/table absent — best-effort */ }
    }
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
    // prompt28 Part 1 / 107.md §2 — count the ACTIVE keyword lists AND the still
    // PENDING criteria suggestions, so the review UI can show a per-term article
    // count next to each suggestion before the reviewer accepts it. Refresh the
    // cached picoSnapshot from the linked META·LAB project first (same lazy pattern
    // as getProject) so the server's derivation matches the client's.
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
    const kw = resolveKeywordState({
      storedInclude: storedIncl,
      storedExclude: storedExcl,
      defaultInclude: DEFAULT_INCLUDE_KEYWORDS,
      defaultExclude: DEFAULT_EXCLUDE_KEYWORDS,
      picoSnapshot,
      keywordMeta: access.project.keywordMeta,
    });
    // Wire shape is unchanged ({ total, include:{term:n}, exclude:{term:n} }) —
    // pending suggestion terms are simply additional keys in the same maps.
    res.json({
      total: records.length,
      include: countArticlesByKeyword(records, [...kw.include.terms, ...kw.include.pending]),
      exclude: countArticlesByKeyword(records, [...kw.exclude.terms, ...kw.exclude.pending]),
    });
  } catch (err) {
    console.error('[screening] getKeywordStats:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// 107.md rec — bounded CAS retries for the keyword read-modify-write below. Same
// shape and budget rationale as mutateProjectBlob's loop in server/store.js.
const KEYWORD_OP_MAX_ATTEMPTS = 5;

const KEYWORD_ORIGIN_VALUES = Object.values(KEYWORD_ORIGIN);

/**
 * 108.md §20 — body validation for ONE keyword op, mirroring the shared reducer's
 * own checks so a malformed batch is rejected before the transaction is even opened.
 * Returns an error string, or null when the op is well formed.
 *
 * HARD-400 FLAG DISCIPLINE: every optional flag is legal on a fixed set of op types
 * and rejected everywhere else. A silently-ignored `index` or `clearSeeded` would
 * turn an "exact inverse" into a quiet approximation, which is worse than a 400.
 * `index` is the one exception to strictness on VALUE: any integer is accepted and
 * the reducer CLAMPS it to [0, list.length], because a collaborator can legitimately
 * shrink the list between the delete and the undo and restoring the term at the edge
 * beats refusing the undo.
 */
function validateKeywordOpBody(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return 'each keyword operation must be an object';
  if (!KEYWORD_OPS.includes(op.type)) return 'invalid keyword operation';
  if (!KEYWORD_LISTS.includes(op.list)) return 'list must be "include" or "exclude"';
  if (typeof op.term !== 'string' || !op.term.trim()) return 'term is required';
  if (op.term.length > MAX_KEYWORD_LENGTH) {
    return `term must be ${MAX_KEYWORD_LENGTH} characters or fewer`;
  }
  if (op.type === 'move') {
    if (op.toList !== undefined && !KEYWORD_LISTS.includes(op.toList)) {
      return 'toList must be "include" or "exclude"';
    }
    if (op.toList === op.list) return 'toList must differ from list';
  } else if (op.toList !== undefined) {
    return 'toList applies only to "move"';
  }
  if (op.reject !== undefined) {
    if (typeof op.reject !== 'boolean') return 'reject must be a boolean';
    if (op.type === 'clear-decision') return 'reject does not apply to "clear-decision"';
    if (op.reject === false && op.type !== 'remove' && op.type !== 'move') {
      return 'reject:false applies only to "remove" and "move"';
    }
  }
  if (op.index !== undefined) {
    if (!Number.isInteger(op.index)) return 'index must be an integer';
    if (op.type !== 'add' && op.type !== 'move') return 'index applies only to "add" and "move"';
  }
  if (op.origin !== undefined) {
    if (op.type !== 'add') return 'origin applies only to "add"';
    if (op.origin !== null && !KEYWORD_ORIGIN_VALUES.includes(op.origin)) {
      return 'origin must be "manual", "accepted", "default" or null';
    }
  }
  if (op.removeTerm !== undefined) {
    if (typeof op.removeTerm !== 'boolean') return 'removeTerm must be a boolean';
    if (op.type !== 'clear-decision') return 'removeTerm applies only to "clear-decision"';
  }
  if (op.clearSeeded !== undefined) {
    if (typeof op.clearSeeded !== 'boolean') return 'clearSeeded must be a boolean';
    if (op.type !== 'add') return 'clearSeeded applies only to "add"';
  }
  return null;
}

/** Whitelist the op fields the reducer understands — nothing else reaches it. */
function pickKeywordOp(raw) {
  const op = { type: raw.type, list: raw.list, term: raw.term.trim() };
  for (const f of ['toList', 'reject', 'index', 'origin', 'removeTerm', 'clearSeeded']) {
    if (raw[f] !== undefined) op[f] = raw[f];
  }
  return op;
}

/**
 * POST /projects/:pid/keywords/ops — keyword mutation(s) (107.md §2/§3, 108.md §20).
 *
 * Body, either shape:
 *   single — { type, list, term, toList?, reject?, index?, origin?, removeTerm?,
 *              clearSeeded? }
 *   batch  — { ops: [ …up to MAX_KEYWORD_OPS of the above… ] }
 *
 * Why this exists next to the legacy full-array PUT /projects/:pid: the old path
 * sends the WHOLE list on every chip add/remove with no concurrency control, so two
 * leaders editing keywords at the same time silently discard each other's terms.
 * Here the read-modify-write runs through the shared pure reducer and its write is
 * CONDITIONAL ON THE PRE-IMAGE it read, so concurrent single-term ops compose
 * instead of clobbering.
 *
 * `reject: false` (remove/move only) is the non-verdict Undo variant — it deletes
 * the term without recording a "rejected" decision, so undoing an accidental add
 * does not permanently suppress the matching criteria suggestion.
 *
 * 108.md §20 — the batch shape exists so a COMPOUND inverse (the reducer needs up to
 * five ops to put a moved term back exactly as it was) is ONE round trip, ONE CAS
 * write and ONE history entry. It is all-or-nothing: an invalid op anywhere in the
 * array rejects the whole request and writes nothing. Single-op bodies are unchanged
 * on the wire and in the response.
 */
export async function keywordOps(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    // Same gate as editing the keyword lists today (updateProject).
    if (!access.canManageSettings) {
      return res.status(403).json({ error: 'Only project leaders can edit keyword lists' });
    }

    const body = req.body || {};
    // 109.md §22/§23 — optional provenance hint so the ledger can distinguish a
    // deliberate edit from a 108 history replay. Additive and back-compatible: a
    // pre-109 client omits it and every row is recorded as via:'user'.
    if (body.via !== undefined && !KEYWORD_AUDIT_VIA.includes(body.via)) {
      return res.status(400).json({ error: `via must be one of ${KEYWORD_AUDIT_VIA.join(', ')}` });
    }
    const via = normalizeKeywordVia(body.via);
    const batch = body.ops !== undefined;
    if (batch && !Array.isArray(body.ops)) return res.status(400).json({ error: 'ops must be an array' });
    const rawOps = batch ? body.ops : [body];
    if (!rawOps.length) return res.status(400).json({ error: 'ops must contain at least one operation' });
    if (rawOps.length > MAX_KEYWORD_OPS) {
      return res.status(400).json({ error: `ops must contain at most ${MAX_KEYWORD_OPS} operations` });
    }
    const ops = [];
    for (const raw of rawOps) {
      const bad = validateKeywordOpBody(raw);
      if (bad) return res.status(400).json({ error: bad });
      ops.push(pickKeywordOp(raw));
    }

    const pidVal = access.project.id;
    // Every side any op touches must be materialized before the batch runs, or an op
    // late in the batch would see a still-empty list and re-seed it mid-transaction.
    const touched = [];
    for (const op of ops) {
      if (!touched.includes(op.list)) touched.push(op.list);
      if (op.type === 'move') {
        const other = op.toList || (op.list === 'include' ? 'exclude' : 'include');
        if (!touched.includes(other)) touched.push(other);
      }
    }

    // 107.md rec — OPTIMISTIC PRE-IMAGE GUARD. A bare interactive transaction is
    // ATOMIC but not ISOLATED: Prisma inherits the database default, i.e. READ
    // COMMITTED on the Postgres deployment target, where two concurrent ops both
    // SELECT the same lists and the second UPDATE — keyed only on `id` — re-applies
    // values computed from its stale read, silently dropping the first term. The
    // write below is therefore conditional on the exact strings that were read
    // (updateMany + full-column WHERE: portable to BOTH SQLite and Postgres, no
    // isolation-level games, no FOR UPDATE). A losing writer re-reads and re-runs
    // the reducer, exactly like mutateProjectBlob's CAS retry loop (server/store.js).
    let result = null;
    for (let attempt = 0; attempt < KEYWORD_OP_MAX_ATTEMPTS; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      result = await prisma.$transaction(async (tx) => {
        const row = await tx.screenProject.findUnique({
          where: { id: pidVal },
          select: { inclusionKeywords: true, exclusionKeywords: true, keywordMeta: true },
        });
        if (!row) return { missing: true };
        const before = {
          inclusion: parseJsonList(row.inclusionKeywords),
          exclusion: parseJsonList(row.exclusionKeywords),
          meta: normalizeKeywordMeta(row.keywordMeta),
        };
        // A side whose stored list is empty is DISPLAYED as the shared defaults; the
        // first real edit writes those out so the edit is additive, never a wipe.
        // A side already marked edited in keywordMeta is left empty on purpose.
        const seeded = materializeDefaults(
          before,
          { include: DEFAULT_INCLUDE_KEYWORDS, exclude: DEFAULT_EXCLUDE_KEYWORDS },
          touched,
        );
        // ALL-OR-NOTHING: applyKeywordOps folds the batch and discards everything if
        // any op is invalid, so a compound inverse never lands half applied.
        const out = applyKeywordOps(seeded, ops);
        if (!out.ok) return { badRequest: out.error };
        const next = out.state;
        const wrote = out.changed || seeded !== before;
        if (wrote) {
          const upd = await tx.screenProject.updateMany({
            where: {
              id: pidVal,
              inclusionKeywords: row.inclusionKeywords,
              exclusionKeywords: row.exclusionKeywords,
              keywordMeta: row.keywordMeta,
            },
            data: {
              inclusionKeywords: JSON.stringify(next.inclusion),
              exclusionKeywords: JSON.stringify(next.exclusion),
              keywordMeta: JSON.stringify(next.meta),
            },
          });
          // Someone else committed a keyword write between our SELECT and this
          // UPDATE — discard everything and re-derive from their state.
          if (upd.count === 0) return { contended: true };
        }
        return {
          wrote,
          changed: out.changed,
          reason: out.reason,
          results: out.results,
          inclusionKeywords: JSON.stringify(next.inclusion),
          exclusionKeywords: JSON.stringify(next.exclusion),
          keywordMeta: JSON.stringify(next.meta),
        };
      });
      if (!result?.contended) break;
    }

    if (result?.contended) {
      return res.status(409).json({
        error: 'Another leader is editing the keyword lists right now. Try again in a moment.',
        code: 'KEYWORD_OP_CONTENTION',
      });
    }
    if (result?.missing) return res.status(404).json({ error: 'Project not found' });
    if (result?.badRequest) return res.status(400).json({ error: result.badRequest });

    if (result.wrote) {
      void touchProjectActivity(access.project.linkedMetaLabProjectId);
      emitToProjectMembers(pidVal, { type: 'project.updated' }, { exclude: req.user.id });
      // 109.md §22 — append-only ledger rows for the ops that actually changed
      // state. writeAudit never throws (audit must not break the flow) and the
      // batch is capped at MAX_KEYWORD_OPS, so this is at most six small inserts.
      // §50: an undo appends a NEW row, it never rewrites the original.
      const auditRows = keywordAuditRows(ops, result.results, { via });
      await Promise.all(auditRows.map((row) => writeAudit(pidVal, req.user, row.action, {
        entityType: row.entityType,
        entityId: row.entityId,
        details: row.details,
      })));
    }
    const payload = {
      changed: !!result.changed,
      reason: result.reason,
      inclusionKeywords: result.inclusionKeywords,
      exclusionKeywords: result.exclusionKeywords,
      keywordMeta: result.keywordMeta,
    };
    // Per-op outcomes only for the batch shape — the single-op response stays byte
    // for byte what every pre-108 client already parses.
    if (batch) payload.results = result.results;
    res.json(payload);
  } catch (err) {
    console.error('[screening] keywordOps:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Import ──────────────────────────────────────────────────────────

// 96.md Phase 6F — uniform conflict envelope while a scoped reset holds the
// project's reset lock (import/enqueue paths must not race the delete).
const resetLocked409 = (res) => res.status(409).json({
  error: 'Imported records are being reset for this project. Wait for the reset to finish, then try again.',
  code: 'RESET_IN_PROGRESS',
});

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
    // 96.md 6F — reset fence (dedupeAndInsertRecords re-checks; this is the
    // cheap early 409 before parsing a potentially large payload).
    if (isResetLocked(p.id)) return resetLocked409(res);

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

    // 116.md §14 — the importer may declare the search up front ("this RIS file is
    // an Embase export, searched on the 3rd"): persisted on the batch (104.md
    // fields) so provenance + PRISMA read it without a second, after-the-fact
    // PATCH. Optional; validation mirrors updateImportBatchSearch.
    const sourceDatabase = String(req.body?.sourceDatabase || '').trim().slice(0, 100);
    let searchedAt = null;
    if (req.body?.searchedAt) {
      const d = new Date(req.body.searchedAt);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'searchedAt is not a valid date.' });
      if (d.getTime() > Date.now()) return res.status(400).json({ error: 'A search date cannot be in the future.' });
      searchedAt = d;
    }

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
        // 116.md §14 — importer-declared search provenance (optional).
        sourceDatabase, searchedAt,
      });
    } catch (e) {
      if (e && e.code === 'CAPACITY') return res.status(400).json({ error: e.message });
      // A reset that started between the early fence and the landing (the lock is
      // re-checked inside dedupeAndInsertRecords) surfaces as the same 409.
      if (e && e.code === 'RESET_IN_PROGRESS') return resetLocked409(res);
      throw e;
    }

    // prompt50 WS5 — an import is meaningful activity on the linked META·LAB project.
    if (result.imported > 0) await touchProjectActivity(p.linkedMetaLabProjectId);

    // 93.md §5.3 round 2 — the legacy SYNCHRONOUS import path now records the
    // same funnel events as the durable-worker path (fire-and-forget).
    if (result.imported > 0) {
      recordEvent(USAGE.IMPORT_COMPLETED, { userId: req.user.id, screenProjectId: p.id, meta: { count: result.imported, source: 'sync' } });
      recordFirstEvent(USAGE.FIRST_IMPORT_COMPLETED, req.user.id, { screenProjectId: p.id });
    }

    res.json({
      imported: result.imported,
      skippedDuplicates: result.skippedDuplicates,
      rejected: result.rejected,
      // 96.md D10 — additive: existing records whose blank metadata this import filled
      // (fill-blank merge; subset of skippedDuplicates — PRISMA accounting unchanged).
      updated: result.updated || 0,
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
    // 96.md 6F — reset fence: never enqueue an import job while a reset is
    // deleting this project's records (the job would race or instantly fail).
    if (isResetLocked(p.id)) return resetLocked409(res);

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

    // 97.md Phase 2 — the ZIP export is ALWAYS an async job (uniform code path; no
    // sync ZIP). Answer before reserving allowance so nothing is consumed here.
    if (req.query.format === 'zip') {
      return res.status(400).json({
        error: 'The screening ZIP export runs as a background job.',
        useAsync: true,
        startUrl: `/api/screening/projects/${p.id}/export/start`,
      });
    }

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
    // 97.md Decision E8 — sync export success joins the project audit trail
    // (writeAudit is best-effort and never throws; fire-and-forget).
    const auditExport = () => writeAudit(p.id, req.user, 'SCREENING_EXPORTED', {
      details: { format: emittedFormat, filter, records: filtered.length },
    });

    if (fmt === 'json') {
      const body = JSON.stringify(filtered);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.json"`);
      settleProjectExport(reservation?.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(body) });
      auditExport();
      return res.send(body);
    }

    if (fmt === 'ris') {
      const ris = filtered.map(renderRisBlock).join('\n\n') + (filtered.length ? '\n' : '');
      res.setHeader('Content-Type', 'application/x-research-info-systems');
      res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.ris"`);
      settleProjectExport(reservation?.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(ris) });
      auditExport();
      return res.send(ris);
    }

    // CSV — every cell goes through the shared injection-safe encoder; columns + order
    // are UNCHANGED for backwards compatibility (AI validation columns are APPENDED).
    const csv = [EXPORT_COLUMNS.join(','), ...filtered.map(renderCsvRow)].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.csv"`);
    settleProjectExport(reservation?.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(csv) });
    auditExport();
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
    // 97.md Phase 2 — 'zip' is a first-class async format (the ONLY path for the
    // portable ZIP; there is no sync ZIP). A ZIP is a complete project export, so
    // its filter is always 'all' (documented in the archive README).
    const fmt = ['csv', 'json', 'ris', 'zip'].includes(reqFmt) ? reqFmt : 'csv';
    const filter = fmt === 'zip' ? 'all'
      : ['all', 'include', 'exclude', 'maybe', 'undecided'].includes(reqFilter) ? reqFilter : 'all';

    // 79.md §3 — reserve one unit of the monthly project-export allowance at job
    // START (gateExport already verified the master gate boolean). Enqueuing a NEW
    // job IS the export event, so that reservation is confirmed immediately; a job
    // that later fails is a background concern (the allowance is not auto-refunded,
    // matching the documented policy that a submitted async export counts). A start
    // that DEDUPES to an existing queued/processing job is refunded below.
    let reservation;
    try {
      reservation = await requireProjectExport(req.user, {
        exportType: EXPORT_TYPES.SCREENING_RECORDS, projectId: access.project.id, format: fmt,
      });
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }

    const job = await enqueueExportJob(access.project.id, {
      createdById: req.user.id,
      createdByName: req.user.name || req.user.email || '',
      // The ZIP's CSV has its own schema without AI CV columns — skip the heavy
      // cross-validation pass entirely for zip jobs (97.md Phase 2).
      format: fmt, filter, includeAiCv: fmt !== 'zip',
    });
    // Duplicate start (double-click / second tab / retry) deduped to an already
    // queued/processing job → REFUND this reservation: one archive must never
    // consume two monthly export units (same refund pattern as the failed sync
    // export above; settle 'failed' flips counted=false in the ledger).
    if (job.reused) {
      settleProjectExport(reservation.reservationId, { status: 'failed', failureReason: 'deduped_to_existing_job' });
    } else {
      settleProjectExport(reservation.reservationId, { status: 'succeeded' });
      recordUsage({ type: USAGE.EXPORT, userId: req.user.id, screenProjectId: access.project.id, format: fmt, meta: { filter, async: true } });
    }
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
    // 97.md Phase 2 — surface partial-failure warnings (non-blocking; the ZIP is
    // still complete apart from the named optional member).
    let warnings = [];
    try { const w = JSON.parse(job.warnings || '[]'); if (Array.isArray(w)) warnings = w; } catch { /* keep [] */ }
    res.json({
      id: job.id, status: job.status, stage: job.stage, format: job.format, filter: job.filter,
      totalRecords: job.totalRecords, processedRecords: job.processedRecords,
      progress: job.totalRecords > 0 ? Math.min(100, Math.round((job.processedRecords / job.totalRecords) * 100)) : (ready ? 100 : 0),
      cvStatus: job.cvStatus, error: job.error, filename: job.filename, bytes: job.resultBytes,
      warningCount: job.warningCount ?? 0, warnings,
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

    // 93.md §5.3 — activation: record the user's FIRST screening decision only
    // (deterministic-id PK → at most one row per user, ever). Fire-and-forget.
    recordFirstEvent(USAGE.SCREENING_DECISION_FIRST, req.user.id, { screenProjectId: p.id, meta: { stage } });

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

/**
 * 116.md §70 (D14) — shape ONE reviewer's title/abstract decision for the Conflicts
 * tab, applying the LEADER-EXEMPT WIRE-LEVEL blinding convention used by
 * listRecords' shapeRecord and listSecondReview (81.md): under blind mode a
 * non-leader resolver receives NO colleague identity (`reviewerId` omitted, name
 * anonymised positionally) and NO free-text decision detail (exclusion reason,
 * note, quality rating) — the bare decision still ships because the whole point of
 * the tab is showing THAT the reviewers disagreed. Leaders are exempt and see
 * everything. Blinding happens here, on the wire, never only in the UI.
 *
 * The eligibility engine (86.md P1.20) can hold one of the disagreeing decisions;
 * it is not a human colleague, so its non-identifying label survives blind mode and
 * `isEngine` lets the UI say a vote was machine-made rather than imply a reviewer.
 */
/**
 * 116.md §70 — `ScreenConflict.reviewerDecisions` is a persisted {reviewerId:
 * decision} JSON map (the legacy shape the resolve UX predates). Its KEYS are user
 * ids, so shipping it verbatim handed a blinded non-leader the very colleague
 * identities the rest of this handler strips. Re-key it to positional placeholders
 * under blind mode: same shape, same decisions, no identity.
 */
function blindReviewerDecisionsJson(json) {
  try {
    const m = JSON.parse(json || '{}');
    if (!m || typeof m !== 'object' || Array.isArray(m)) return '{}';
    return JSON.stringify(Object.fromEntries(
      Object.values(m).map((decision, i) => [`reviewer-${i + 1}`, decision]),
    ));
  } catch { return '{}'; }
}

function shapeConflictDecision(d, i, { blind, me }) {
  const isEngine = d.reviewerId === ELIGIBILITY_ENGINE_REVIEWER_ID;
  return {
    reviewerId: blind ? undefined : d.reviewerId,
    reviewerName: blind
      ? (isEngine ? ELIGIBILITY_ENGINE_REVIEWER_NAME : `Reviewer ${i + 1}`)
      : (d.reviewerName || (isEngine ? ELIGIBILITY_ENGINE_REVIEWER_NAME : 'Reviewer')),
    isEngine,
    isMe: d.reviewerId === me,
    decision: d.decision,
    stage: d.stage,
    exclusionReason: blind ? '' : (d.exclusionReason || ''),
    notes: blind ? '' : (d.notes || ''),
    rating: blind ? null : (d.rating ?? null),
    decidedAt: d.updatedAt || d.createdAt || null,
  };
}

export async function listConflicts(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    // Conflicts/disagreements are a leader/resolver view. In blind mode, normal
    // reviewers never see them (Part 5); only the leader/resolver does.
    if (!access.canResolveConflicts) {
      return res.status(403).json({ error: 'Only the project leader can view conflicts' });
    }
    const p = access.project;
    // 81.md convention, reused verbatim: blinding is LEADER-EXEMPT. A member who was
    // granted canResolveConflicts without being the leader is still blinded.
    const blind = p.blindMode && !access.isLeader;
    const me = req.user.id;

    const conflicts = await prisma.screenConflict.findMany({
      where: { projectId: p.id },
      // 116.md §§67-68 (D14) — the Conflict tab renders the SAME article surface the
      // Title & Abstract workbench does (RecordArticleCard), so it needs the same
      // record metadata listRecords ships: journal/doi/pmid/keywords/sourceDb/
      // isDuplicate alongside the abstract that was already on the wire but unused.
      include: {
        record: {
          select: {
            id: true, title: true, authors: true, year: true, journal: true,
            doi: true, pmid: true, abstract: true, keywords: true, sourceDb: true,
            isDuplicate: true, currentStage: true, finalStatus: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 116.md §70 — per-reviewer decision context (reason / note / rating / name).
    // ScreenConflict.reviewerDecisions only ever carried {reviewerId: decision}; the
    // detail lives on ScreenDecision. One extra query for the whole page (conflicts
    // are unpaginated and few by construction), joined in memory.
    const recordIds = conflicts.map(c => c.recordId);
    const rows = recordIds.length
      ? await prisma.screenDecision.findMany({
        where: {
          projectId: p.id,
          recordId: { in: recordIds },
          stage: CONFLICT_STAGE,
          decision: { not: 'undecided' },
        },
        select: {
          id: true, recordId: true, reviewerId: true, reviewerName: true, stage: true,
          decision: true, exclusionReason: true, notes: true, rating: true,
          createdAt: true, updatedAt: true,
        },
        // 100.md §§13/15 — a stable order, so the positional "Reviewer N" labels
        // blind mode hands out mean the same reviewer on every request.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      : [];
    const byRecord = new Map();
    for (const d of rows) {
      const list = byRecord.get(d.recordId) || [];
      list.push(d);
      byRecord.set(d.recordId, list);
    }

    res.json({
      conflicts: conflicts.map(c => ({
        ...c,
        reviewerDecisions: blind ? blindReviewerDecisionsJson(c.reviewerDecisions) : c.reviewerDecisions,
        record: c.record
          ? { ...c.record, authors: blind ? '' : c.record.authors, journal: blind ? '' : c.record.journal }
          : c.record,
        decisions: (byRecord.get(c.recordId) || []).map((d, i) => shapeConflictDecision(d, i, { blind, me })),
      })),
      blindMode: p.blindMode,
      isLeader: access.isLeader,
    });
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

/**
 * publicDuplicateJob — the job row as the client sees it. Counters + stage are the
 * ONLY source of the progress UI (no fake progress); statsJson is parsed so admins/
 * leaders can inspect stage durations, but the error field stays the user-facing
 * message written by the worker (technical detail lives in server logs).
 */
function publicDuplicateJob(job) {
  if (!job) return null;
  let stats = {};
  try { stats = JSON.parse(job.statsJson || '{}'); } catch { /* keep {} */ }
  // Host-process metrics are observability for server logs/DB admins, not project
  // members (rec round: heap/cpu of the shared server leaks cross-tenant signal).
  delete stats.cpuMs;
  delete stats.heapUsedMb;
  return {
    id: job.id, status: job.status, stage: job.stage,
    cancelRequested: !!job.cancelRequested,
    totalRecords: job.totalRecords, processedRecords: job.processedRecords,
    comparisonsTotal: job.comparisonsTotal, comparisonsDone: job.comparisonsDone,
    groupsFound: job.groupsFound, savedGroups: job.savedGroups,
    groupsCreated: job.groupsCreated, groupsUpdated: job.groupsUpdated,
    recordsFlagged: job.recordsFlagged,
    exactMatches: job.exactMatches, fuzzyMatches: job.fuzzyMatches,
    error: job.error, attempts: job.attempts,
    createdByName: job.createdByName,
    startedAt: job.startedAt, completedAt: job.completedAt, createdAt: job.createdAt,
    // 107.md §1 — the row's own clock. pickNewerJob (duplicateJobState.js) uses it
    // to drop a slow poll response that describes an OLDER observation of the same
    // job, so an in-flight read can never move a finished job backward.
    updatedAt: job.updatedAt,
    stats,
  };
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
    // 96.md 6F — reset fence: a detection sweep enqueued mid-reset would scan
    // (and group) records the transaction is deleting.
    if (isResetLocked(p.id)) return resetLocked409(res);
    const settings = await getMetaSiftSettings();
    if (!settings.allowDuplicateDetection) return res.status(403).json({ error: 'Duplicate detection is currently disabled by the administrator' });
    // 92.md — enqueue the durable job and return immediately (202). An already-active
    // job for this project is REUSED, so double clicks / simultaneous starts by two
    // members attach to the one run instead of spawning another sweep.
    const { job, alreadyRunning } = await enqueueDuplicateJob(p.id, {
      createdById: req.user.id,
      createdByName: req.user.name || req.user.email || '',
    });
    res.status(202).json({ job: publicDuplicateJob(job), alreadyRunning: !!alreadyRunning });
  } catch (err) {
    // Rec round 2 — fairness cap: too many concurrent runs by one user across
    // projects (429, actionable message from the worker).
    if (err?.code === 'DUP_JOB_LIMIT') return res.status(429).json({ error: err.message });
    console.error('[screening] detectDuplicates:', err.message);
    res.status(500).json({ error: 'Could not start duplicate detection. Please try again.' });
  }
}

/** Latest detection job for the project (reconnect-on-refresh). Any member may view. */
export async function getDuplicateDetectStatus(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const job = await prisma.screenDuplicateJob.findFirst({
      where: { projectId: access.project.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ job: publicDuplicateJob(job) });
  } catch (err) {
    console.error('[screening] getDuplicateDetectStatus:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Poll a specific detection job. Any member may view. */
export async function getDuplicateJob(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const job = await prisma.screenDuplicateJob.findFirst({
      where: { id: req.params.jobId, projectId: access.project.id },
    });
    if (!job) return res.status(404).json({ error: 'Detection job not found' });
    res.json({ job: publicDuplicateJob(job) });
  } catch (err) {
    console.error('[screening] getDuplicateJob:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Cancel a detection job. Safe by construction: a queued job is cancelled outright;
 * a processing job stops at the next progress beat / save-batch boundary, and every
 * group already persisted is complete and valid (nothing is half-written).
 */
export async function cancelDuplicateJob(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canManage = access.isOwner || (access.active && (access.isLeader || access.perms.canManageDuplicates));
    if (!canManage) return res.status(403).json({ error: 'You do not have permission to manage duplicates in this project' });
    const job = await cancelDuplicateJobRow(access.project.id, req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Detection job not found' });
    res.json({ job: publicDuplicateJob(job) });
  } catch (err) {
    console.error('[screening] cancelDuplicateJob:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * 107.md §1 (rec round) — the `project.updated` emits on the resolution paths below
 * poke EVERY member, the resolving user INCLUDED. The Stitch workflow stepper reads
 * its summary from `useScreeningSummary`, a different owner from the embedded
 * SiftProject the Duplicates tab refreshes, and it has no polling loop — so an emit
 * carrying `{ exclude: req.user.id }` left the person who just resolved the last
 * group staring at "N unresolved" until a full reload. The initiator's extra refetch
 * is idempotent; same argument as `emitDuplicateJobTerminal` in the worker.
 */
export async function resolveDuplicateGroup(req, res) {
  try {
    // Same guard as detectDuplicates: outsider 404, member without permission 403.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const canManage = access.isOwner || (access.active && (access.isLeader || access.perms.canManageDuplicates));
    if (!canManage) return res.status(403).json({ error: 'You do not have permission to manage duplicates in this project' });
    const p = access.project;
    // 92.md rec round — resolving while a detection run is in flight would race the
    // worker's save phase (the worker skips resolved groups, but the UX becomes
    // confusing: the run may extend other groups around the reviewer). One clear
    // 409 beats a silent race; the run is short and cancellable.
    const activeJob = await prisma.screenDuplicateJob.findFirst({
      where: { projectId: p.id, status: { in: ['queued', 'processing'] } }, select: { id: true },
    });
    if (activeJob) return res.status(409).json({ error: 'Duplicate detection is currently running for this project. Wait for it to finish (or cancel it) before resolving groups.' });
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
      // 92.md — primaryId is a NON-nullable String @default("") column; writing null
      // threw a Prisma validation error, so "Not duplicates — keep all" 500'd at the
      // API since prompt23. "" is the model's own no-primary sentinel.
      await prisma.screenDuplicateGroup.update({ where: { id: group.id }, data: { resolvedAt: new Date(), primaryId: '' } });
      await writeAudit(p.id, req.user, 'DUPLICATE_GROUP_KEEP_ALL', { entityType: 'duplicateGroup', entityId: group.id });
      emitToProjectMembers(p.id, { type: 'project.updated' });
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
    emitToProjectMembers(p.id, { type: 'project.updated' });

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
    // 92.md rec round — same in-flight-run guard as resolveDuplicateGroup.
    const activeJob = await prisma.screenDuplicateJob.findFirst({
      where: { projectId: p.id, status: { in: ['queued', 'processing'] } }, select: { id: true },
    });
    if (activeJob) return res.status(409).json({ error: 'Duplicate detection is currently running for this project. Wait for it to finish (or cancel it) before resolving groups.' });

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

    if (resolvedGroups > 0) emitToProjectMembers(p.id, { type: 'project.updated' });
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

/**
 * GET /projects/:pid/resume?stage=title_abstract&limit=50 — 100.md §§12-15.
 * "Where did I stop?", answered per USER + PROJECT + STAGE.
 *
 * The position is DERIVED from the caller's own ScreenDecision rows (unique per
 * record+reviewer+stage, with `updatedAt`), never from a stored pointer or from
 * localStorage — see src/research-engine/screening/resumeState.js for why that makes
 * every 100.md §15 edge case (deleted / deduplicated / filtered / two reviewers /
 * multiple sessions) fall out correctly.
 *
 * Response:
 *   { stage, status, recordId, wrapped, position, page, limit,
 *     pending, decided, stageTotal, listTotal, lastDecidedAt, message }
 *   `position`/`page` are indices into the DEFAULT records list (every record of the
 *   project, `createdAt ASC, id ASC`), so the client can jump straight to the page
 *   that contains the article instead of paging through thousands of rows.
 */
export async function getResumePoint(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const me = req.user.id;
    const stage = normalizeResumeStage(req.query.stage);
    // A non-numeric ?limit= would otherwise propagate NaN through the page maths and
    // collapse every resume to page 1.
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(200, Math.max(10, Number.isFinite(rawLimit) ? rawLimit : 50));

    // The pool a reviewer can still act on at this stage: at the stage, not a resolved
    // duplicate, and without a decision of THEIRS that is anything but 'undecided'.
    const pendingWhere = {
      projectId: p.id,
      currentStage: stage,
      isDuplicate: false,
      decisions: { none: { reviewerId: me, stage, decision: { not: 'undecided' } } },
    };
    const ORDER = [{ createdAt: 'asc' }, { id: 'asc' }];

    const [stageTotal, pending, decided, lastDecision, listTotal] = await Promise.all([
      prisma.screenRecord.count({ where: { projectId: p.id, currentStage: stage, isDuplicate: false } }),
      prisma.screenRecord.count({ where: pendingWhere }),
      prisma.screenDecision.count({ where: { projectId: p.id, reviewerId: me, stage, decision: { not: 'undecided' } } }),
      prisma.screenDecision.findFirst({
        where: { projectId: p.id, reviewerId: me, stage, decision: { not: 'undecided' } },
        orderBy: { updatedAt: 'desc' },
        select: { recordId: true, updatedAt: true },
      }),
      prisma.screenRecord.count({ where: { projectId: p.id } }),
    ]);

    // Anchor row (may be gone if the article was hard-deleted — the decision cascades
    // with it, so this is belt-and-braces rather than a real case).
    let decisionAnchor = null;
    if (lastDecision) {
      const rec = await prisma.screenRecord.findFirst({
        where: { id: lastDecision.recordId, projectId: p.id },
        select: { id: true, createdAt: true },
      });
      if (rec) decisionAnchor = { recordId: rec.id, id: rec.id, createdAt: rec.createdAt, decidedAt: lastDecision.updatedAt };
    }

    const cursor = afterCursor(decisionAnchor);
    const [nextRow, firstRow, openRow] = await Promise.all([
      cursor
        ? prisma.screenRecord.findFirst({ where: { AND: [pendingWhere, cursor] }, orderBy: ORDER, select: { id: true } })
        : Promise.resolve(null),
      prisma.screenRecord.findFirst({ where: pendingWhere, orderBy: ORDER, select: { id: true } }),
      // Most recently OPENED article that STILL needs this reviewer's decision — the
      // "I was reading this and never decided" case (100.md §13, least friction).
      decisionAnchor
        ? Promise.resolve(null)
        : prisma.screenRecordOpenState.findFirst({
          where: { projectId: p.id, userId: me, record: pendingWhere },
          orderBy: { openedAt: 'desc' },
          select: { recordId: true },
        }),
    ]);

    const target = pickResumeTarget({
      decidedCount: decided,
      decisionAnchor,
      openAnchor: openRow ? { recordId: openRow.recordId } : null,
      nextAfterAnchor: nextRow ? nextRow.id : null,
      firstPending: firstRow ? firstRow.id : null,
      pendingCount: pending,
      stageTotal,
    });

    // 1-based position in the DEFAULT list order (all records, createdAt ASC, id ASC).
    let position = null;
    if (target.recordId) {
      const rec = await prisma.screenRecord.findFirst({
        where: { id: target.recordId, projectId: p.id },
        select: { id: true, createdAt: true },
      });
      if (rec) {
        const before = await prisma.screenRecord.count({
          where: {
            projectId: p.id,
            OR: [
              { createdAt: { lt: rec.createdAt } },
              { AND: [{ createdAt: rec.createdAt }, { id: { lt: rec.id } }] },
            ],
          },
        });
        position = before + 1;
      }
    }

    res.json({
      stage,
      status: target.status,
      recordId: target.recordId,
      wrapped: target.wrapped,
      position,
      page: position ? resumePage(position, limit) : 1,
      limit,
      pending,
      decided,
      stageTotal,
      listTotal,
      lastDecidedAt: decisionAnchor ? decisionAnchor.decidedAt : null,
      message: resumeMessage({
        status: target.status, position, pending, wrapped: target.wrapped,
        stageLabel: STAGE_LABELS[stage] || 'this stage',
      }),
    });
  } catch (err) {
    console.error('[screening] getResumePoint:', err.message);
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
      // 96.md D11 — rolled-back runs are EXCLUDED: a screening reset removed their
      // landed records/batches, so keeping their engine-side dedup counts would
      // over-report identified/duplicates-removed forever after a reset.
      prisma.pecanSearchSource.findMany({
        where: { run: { screenProjectId: sp.id, rolledBackAt: null } },
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
    // 98.md review — Finding B (mirror of progressEvidence.js): the full_text
    // population is !isDuplicate-filtered TOGETHER (all three counts, so the
    // secondReviewPending subtraction below stays consistent) — a record swept into
    // a duplicate group after reaching full text must not inflate the pending count
    // (blocking screeningComplete forever) nor keep counting as assessed/accepted/
    // rejected. Also keeps the PRISMA funnel over one population: `screened` already
    // excludes duplicates, so a duplicate-swept record cannot exceed it downstream.
    const fullTextAssessed   = records.filter(r => !r.isDuplicate && r.currentStage === 'full_text').length;
    const excludedTitleAbstract = Math.max(0, screened - fullTextAssessed);
    const fullTextExcluded   = records.filter(r => !r.isDuplicate && r.finalStatus === 'rejected').length;
    const acceptedRecords    = records.filter(r => !r.isDuplicate && r.finalStatus === 'accepted');
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
