/**
 * screeningOverviewController.js — Overview dashboard data + audit trail (Parts 10/5).
 * Powers the project command-center: data summary, per-member progress,
 * whole-project progress, and the audit log.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, ensureLeaderMember, QUORUM } from '../screening/access.js';
import { mlAccessFromMember } from '../screening/metalabAccess.js';

/** GET /projects/:pid/overview — summary metrics for the Overview tab. */
export async function getOverview(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    await ensureLeaderMember(access.project);
    const pid = access.project.id;

    const [total, members, decisions, conflicts, dupGroups, records] = await Promise.all([
      prisma.screenRecord.count({ where: { projectId: pid } }),
      prisma.screenProjectMember.findMany({ where: { projectId: pid }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] }),
      prisma.screenDecision.findMany({ where: { projectId: pid } }),
      prisma.screenConflict.findMany({ where: { projectId: pid } }),
      prisma.screenDuplicateGroup.findMany({ where: { projectId: pid } }),
      prisma.screenRecord.findMany({ where: { projectId: pid }, select: { id: true, currentStage: true, finalStatus: true, isDuplicate: true } }),
    ]);

    const confirmedDuplicates       = records.filter(r => r.isDuplicate).length;
    const unresolvedDuplicateGroups = dupGroups.filter(g => !g.resolvedAt).length;
    const resolvedDuplicateGroups   = dupGroups.filter(g => g.resolvedAt).length;
    const eligibleSecondReview      = records.filter(r => r.currentStage === 'full_text').length;
    const acceptedToExtraction      = records.filter(r => r.finalStatus === 'accepted').length;
    const rejectedSecond            = records.filter(r => r.finalStatus === 'rejected').length;
    const unresolvedConflicts       = conflicts.filter(c => !c.resolvedAt).length;

    // Disputed = records with >1 distinct non-undecided decision at title/abstract.
    const byRecord = {};
    decisions.forEach(d => {
      if (d.stage === 'title_abstract' && d.decision !== 'undecided') {
        (byRecord[d.recordId] ||= new Set()).add(d.decision);
      }
    });
    const disputedDecisions = Object.values(byRecord).filter(s => s.size > 1).length;

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
        quorum: QUORUM,
      },
      isLeader: access.isLeader, myRole: access.role,
      dataSummary: {
        totalArticles: total,
        duplicateDetectionRun: dupGroups.length > 0,
        confirmedDuplicates, unresolvedDuplicateGroups, resolvedDuplicateGroups,
        disputedDecisions, unresolvedConflicts,
        eligibleSecondReview, acceptedToExtraction, rejectedSecond,
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
