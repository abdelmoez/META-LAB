/**
 * screeningConflictService.js
 * Detects and syncs conflicts for a record when a decision is saved.
 * A conflict = 2+ reviewers have screened the record with different decisions.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function syncConflicts(projectId, recordId) {
  const decisions = await prisma.screenDecision.findMany({
    where: { recordId, projectId },
    select: { reviewerId: true, decision: true },
  });

  // Only consider real decisions (not undecided)
  const real = decisions.filter(d => d.decision !== 'undecided');
  if (real.length < 2) return; // Not enough reviewers

  const decisionValues = new Set(real.map(d => d.decision));
  const hasConflict = decisionValues.size > 1;

  const reviewerMap = {};
  real.forEach(d => { reviewerMap[d.reviewerId] = d.decision; });

  const existing = await prisma.screenConflict.findFirst({ where: { projectId, recordId } });

  if (hasConflict) {
    if (existing) {
      if (!existing.resolvedAt) {
        await prisma.screenConflict.update({
          where: { id: existing.id },
          data: { reviewerDecisions: JSON.stringify(reviewerMap) },
        });
      }
    } else {
      await prisma.screenConflict.create({
        data: { projectId, recordId, reviewerDecisions: JSON.stringify(reviewerMap) },
      });
    }
  } else if (existing && !existing.resolvedAt && real.length >= 2) {
    // Agreement — auto-resolve
    await prisma.screenConflict.update({
      where: { id: existing.id },
      data: { finalDecision: real[0].decision, resolvedAt: new Date(), resolvedBy: 'auto' },
    });
  }
}
