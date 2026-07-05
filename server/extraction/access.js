/**
 * server/extraction/access.js — flag gate + access resolution for the structured
 * data-extraction system (66.md P5, flag `extractionAssist`, default OFF).
 *
 * Extraction is scoped to a META·LAB Project (its studies[] live in the blob).
 * Access mirrors the proven RoB pattern (robController.resolveRobAccess):
 *   - the project OWNER has full access;
 *   - a linked-workspace MEMBER gets view/edit from their META·LAB flags, and
 *     adjudication only as owner/leader or with canManageExtraction.
 */
import { prisma } from '../db/client.js';
import { mlAccessFromMember } from '../screening/metalabAccess.js';
import { featureAccess } from '../services/featureAccess.js';

const FLAG = 'extractionAssist';

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}

/**
 * Whether the `extractionAssist` feature flag is on (fail-closed).
 * 75.md Phase 7 — routed through the central seam. A gate passes `req.user` so
 * admins keep extraction usable while it is globally OFF; no user = plain flag state.
 */
export async function extractionEnabled(user = null) {
  return (await featureAccess(FLAG, user)).allowed;
}

/** Global admin extraction-AI settings (defaults merged under the stored row). */
export const EXTRACTION_AI_DEFAULTS = Object.freeze({
  enabled: true,
  provider: 'heuristic',          // heuristic | external
  requireHumanValidation: true,   // hard product rule — never configurable to false
  dualExtractionDefault: false,
  tableParsingEnabled: true,
});

export async function getExtractionAiSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'extractionAiSettings' } });
    const merged = { ...EXTRACTION_AI_DEFAULTS, ...safeParse(row?.value, {}) };
    merged.requireHumanValidation = true; // locked — suggestions can never auto-commit
    return merged;
  } catch { return { ...EXTRACTION_AI_DEFAULTS }; }
}

/**
 * resolveExtractionAccess — full access context for (metaLabProjectId, user).
 * Returns null when the user has no view access (caller 404s).
 *
 * Shape: { project (Prisma Project row), ownerId, isOwner, role,
 *          canView, canEdit, canAdjudicate, userId, userName }
 */
export async function resolveExtractionAccess(metaLabProjectId, user) {
  if (!metaLabProjectId || !user?.id) return null;
  const project = await prisma.project.findFirst({
    where: { id: metaLabProjectId, deletedAt: null },
  });
  if (!project) return null;

  const base = { project, ownerId: project.userId, userId: user.id, userName: user.name || user.email || '' };
  if (project.userId === user.id) {
    return { ...base, isOwner: true, role: 'owner', canView: true, canEdit: true, canAdjudicate: true };
  }

  // Member path via linked screening workspace(s) — same invariant checks as
  // getMetaLabMemberAccess, but we also need the raw member row for
  // canManageExtraction (the adjudication grant).
  const screenProjects = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!screenProjects.length) return null;
  const member = await prisma.screenProjectMember.findFirst({
    where: { projectId: { in: screenProjects.map(s => s.id) }, userId: user.id, status: 'active' },
  });
  if (!member) return null;
  const sp = screenProjects.find(s => s.id === member.projectId);
  if (!sp || sp.ownerId !== project.userId) return null; // defense in depth
  const acc = mlAccessFromMember(member);
  if (!acc.canView) return null;
  const isLeader = member.role === 'owner' || member.role === 'leader';
  return {
    ...base,
    isOwner: false,
    role: member.role,
    canView: true,
    canEdit: acc.canEdit,
    canAdjudicate: isLeader || !!member.canManageExtraction,
  };
}
