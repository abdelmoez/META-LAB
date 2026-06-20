/**
 * robAccess.js — pure RoB authorization + study-source helpers (prompt46 #3/#4).
 * No Prisma, no Express → unit-testable in isolation.
 */

/**
 * Who may MUTATE (edit / finalise / reopen / delete) an EXISTING assessment:
 * the project OWNER, a workspace LEADER, OR the assessment's own creator
 * (reviewerId). Read-only members and other reviewers may VIEW but not modify
 * someone else's assessment (prompt46 #3).
 *
 * Legacy fallback: assessments created before reviewerId was always populated
 * (empty/null) match no creator, so only owner/leader pass — a safe, non-data-
 * losing default (never auto-claim an empty reviewerId to the current user).
 *
 * @param {{reviewerId?:string}} assessment
 * @param {{canEdit?:boolean,isOwner?:boolean,role?:string}} access
 * @param {string} userId
 */
export function canMutateAssessment(assessment, access, userId) {
  if (!access || !access.canEdit) return false;        // read-only never mutates
  if (access.isOwner) return true;                      // project owner
  if (access.role === 'leader') return true;            // workspace leader
  const creatorId = (assessment && assessment.reviewerId) || '';
  return creatorId !== '' && creatorId === userId;      // the creator
}

/** Normalise a screening/extraction-derived study (project.studies blob) for the
 *  RoB study universe. source:'screening' — NOT deletable from RoB. */
export function normaliseScreeningStudy(s) {
  return {
    id: s.id,
    source: 'screening',
    title: s.title || '',
    author: s.author || '',
    year: s.year != null ? String(s.year) : '',
  };
}

/** Normalise a RoB-local manual study row for the RoB study universe.
 *  source:'manual' — deletable by creator/owner/leader. */
export function normaliseManualStudy(m) {
  return {
    id: m.id,
    source: 'manual',
    title: m.title || '',
    author: m.authors || '',
    year: m.year || '',
    doi: m.doi || null,
    pmid: m.pmid || null,
    createdById: m.createdById || '',
    createdByName: m.createdByName || '',
  };
}
