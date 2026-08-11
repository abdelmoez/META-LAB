/**
 * robConsensusModel.js — the PURE dual-reviewer / consensus logic behind
 * ReviewerComparisonPanel (115.md decision 10, dossier §6).
 *
 * PURE: no React, no fetch, no Date.now(), no DOM. Everything here is a total
 * function over the shapes the API already returns, so the blinding rule, the
 * conflict detection and the consensus preconditions can be tested without a
 * browser — and so the panel can never disagree with the tests about when a
 * comparison is allowed to appear.
 *
 * ── THE DATA MODEL (dossier §6, schema.prisma:1169-1174) ────────────────────
 * A dual-reviewer assessment is NOT a special row type. It is:
 *
 *   two RobAssessment rows sharing (projectId, studyId, instrumentId) with
 *   DIFFERENT reviewerId          → the two independent assessments
 *   a THIRD row with status 'consensus'
 *                                 → the reconciled record
 *
 * Neither reviewer row is ever overwritten — not by the other reviewer, and not
 * by consensus. Seeding a consensus row COPIES answers into the new row
 * (robController.createConsensusAssessment); the source is read, never written.
 *
 * ── THE BLINDING RULE (Screening philosophy, applied honestly) ──────────────
 * Screening blinds a reviewer from their colleague's decision until the quorum is
 * met (`ScreenProject.blindMode`, dossier §6). RoB has no such server machinery:
 *
 *   VERIFIED 2026-08-11 — `GET /projects/:pid/studies/:sid/reviewers`
 *   (robController.getStudyReviewers → reviewerComparison) computes
 *   disagreements over EVERY independent row regardless of status. It does not
 *   look at `status` at all, so the API returns in-progress drafts.
 *
 * So the blind is a CLIENT-side workflow rule, and this module states that
 * plainly rather than implying a server guarantee. `reviewerBlindState()` is the
 * single place the rule lives, and the panel must not fetch the comparison
 * payload until it says `unlocked` — that way the browser never RECEIVES the
 * other reviewer's answers while the comparison is locked, which is the
 * strongest blind a client can honestly offer.
 *
 * The rule: a comparison unlocks only when there are at least two independent
 * assessments AND EVERY one of them is finalised (`status === 'complete'`). The
 * "every" is load-bearing: with 2 of 3 complete, showing the diff would let the
 * third reviewer peek at their colleagues' judgements before finishing their own.
 */

/** The status a reconciled (third) row carries — robController CONSENSUS_STATUS. */
export const CONSENSUS_STATUS = 'consensus';
/** The status a finalised independent assessment carries. */
export const COMPLETE_STATUS = 'complete';

/** True for the reconciled third row. Total. */
export function isConsensusRow(row) {
  return !!row && (row.status === CONSENSUS_STATUS || row.isConsensus === true);
}

/** True when an INDEPENDENT row has been finalised by its reviewer. Total. */
export function isCompleteRow(row) {
  return !!row && row.status === COMPLETE_STATUS;
}

/**
 * The rows of ONE study under ONE instrument, split into the independent
 * assessments and the consensus record.
 *
 * Extra consensus rows cannot normally exist (the server 409s on the second), but
 * if one ever did it is surfaced in `extraConsensus` rather than silently hidden.
 * Ordering is by createdAt then id so the columns of the comparison table are
 * stable across reloads.
 */
export function partitionReviewerRows(rows = []) {
  const all = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const sorted = all.slice().sort((a, b) => {
    const t = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    return t !== 0 ? t : String(a.id || '').localeCompare(String(b.id || ''));
  });
  const consensusRows = sorted.filter(isConsensusRow);
  return {
    independent: sorted.filter(r => !isConsensusRow(r)),
    consensus: consensusRows[0] || null,
    extraConsensus: consensusRows.slice(1),
  };
}

/** Rows for one (studyId, instrumentId) pair out of the project-wide list. Total. */
export function rowsForStudy(assessments = [], studyId, instrumentId) {
  return (Array.isArray(assessments) ? assessments : []).filter(a => a
    && a.studyId === studyId
    && (instrumentId == null || (a.instrumentId || 'RoB2') === instrumentId));
}

/** A stable, human display name for a reviewer column. Never blank. */
export function reviewerLabel(row) {
  if (!row) return '';
  return row.reviewerName || (row.reviewerId ? `Reviewer ${String(row.reviewerId).slice(0, 8)}` : 'Unattributed reviewer');
}

/**
 * Should the comparison be shown at all, and if not, why not?
 *
 * @param {Array} rows  every row for one (study, instrument)
 * @param {{ minReviewers?: number }} [opts]
 * @returns {{
 *   unlocked: boolean, reason: string, message: string,
 *   independentCount: number, completeCount: number, requiredReviewers: number,
 *   pending: Array<{ id, reviewerId, reviewerName, label, status }>,
 *   consensusExists: boolean,
 * }}
 *
 * Reasons: 'unlocked' | 'no-assessments' | 'awaiting-second-reviewer' |
 *          'awaiting-completion'.
 */
export function reviewerBlindState(rows = [], { minReviewers = 2 } = {}) {
  const required = Math.max(2, Number(minReviewers) || 2);
  const { independent, consensus } = partitionReviewerRows(rows);
  const complete = independent.filter(isCompleteRow);
  const pending = independent.filter(r => !isCompleteRow(r)).map(r => ({
    id: r.id, reviewerId: r.reviewerId || '', reviewerName: r.reviewerName || '',
    label: reviewerLabel(r), status: r.status || 'draft',
  }));
  const base = {
    independentCount: independent.length,
    completeCount: complete.length,
    requiredReviewers: required,
    pending,
    consensusExists: !!consensus,
  };
  if (!independent.length) {
    return {
      ...base, unlocked: false, reason: 'no-assessments',
      message: 'No independent assessment of this study has been started yet.',
    };
  }
  if (independent.length < required) {
    return {
      ...base, unlocked: false, reason: 'awaiting-second-reviewer',
      message: `Independent assessment in progress. A comparison needs ${required} independent assessments of this study with the same tool; ${independent.length} exists so far.`,
    };
  }
  if (pending.length) {
    return {
      ...base, unlocked: false, reason: 'awaiting-completion',
      message: `Comparison stays hidden until every independent assessment is marked complete — ${complete.length} of ${independent.length} finished.`,
    };
  }
  return {
    ...base, unlocked: true, reason: 'unlocked',
    message: `${independent.length} independent assessments complete — comparison available.`,
  };
}

/**
 * Per-DOMAIN diff across the independent rows.
 *
 * A conflict requires two rows that both RECORDED a judgement and recorded
 * different ones — "one reviewer has not judged this domain yet" is missing data,
 * not a disagreement (the same rule robController.reviewerComparison applies to
 * items, dossier §6).
 *
 * @param {Array} rows        independent rows (consensus excluded by the caller)
 * @param {string[]} domainIds  the instrument's domain ids, in order
 * @param {{ field?: string }} [opts] 'domainJudgments' (default) or 'applicability'
 */
export function domainDiff(rows = [], domainIds = [], { field = 'domainJudgments' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  return (Array.isArray(domainIds) ? domainIds : []).map((domainId) => {
    const values = {};
    const recorded = [];
    for (const r of list) {
      const v = (r[field] && r[field][domainId]) || '';
      values[r.id] = v || '';
      if (v) recorded.push(v);
    }
    return {
      domainId,
      values,
      recordedCount: recorded.length,
      conflict: recorded.length >= 2 && new Set(recorded).size > 1,
      agreed: recorded.length >= 2 && new Set(recorded).size === 1,
    };
  });
}

/** The OVERALL diff across the independent rows. Same "missing ≠ disagreement" rule. */
export function overallDiff(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const values = {};
  const recorded = [];
  for (const r of list) {
    const v = r.overall || '';
    values[r.id] = v;
    if (v) recorded.push(v);
  }
  return {
    values,
    recordedCount: recorded.length,
    conflict: recorded.length >= 2 && new Set(recorded).size > 1,
    agreed: recorded.length >= 2 && new Set(recorded).size === 1,
  };
}

/**
 * Normalise the server's per-ITEM `disagreements[]` into rows keyed by the
 * reviewer columns the table renders.
 *
 * The server keys `values` by `reviewerId` (falling back to the assessment id
 * when a legacy row has an empty reviewerId — robController.reviewerComparison),
 * so the lookup tries both. An array value (the additive NOS Comparability item)
 * is joined for display; the server already compares those order-insensitively.
 */
export function itemDiffRows(disagreements = [], rows = []) {
  const cols = (Array.isArray(rows) ? rows : []).filter(Boolean);
  return (Array.isArray(disagreements) ? disagreements : []).map((d) => {
    const values = {};
    for (const r of cols) {
      const raw = (d.values && (d.values[r.reviewerId] !== undefined ? d.values[r.reviewerId] : d.values[r.id]));
      values[r.id] = Array.isArray(raw) ? raw.join(' + ') : (raw == null ? '' : String(raw));
    }
    return {
      domainId: d.domainId || '',
      domainName: d.domainName || d.domainId || '',
      questionId: d.questionId || '',
      questionText: d.questionText || '',
      select: d.select || 'one',
      values,
    };
  });
}

/** Percent agreement as a display string, or '' when nothing was compared. */
export function agreementText(agreement) {
  const a = agreement || {};
  if (a.percentAgreement == null || !a.comparedQuestions) return '';
  return `${Math.round(a.percentAgreement * 100)}% item agreement (${a.agreedQuestions}/${a.comparedQuestions})`;
}

/**
 * May this user create the consensus record, and if not, why not?
 *
 * MIRRORS the server preconditions exactly (robController.createConsensusAssessment):
 *   · 403 when the caller has read-only RoB access;
 *   · 400 when the instrument declares `consensusSupported: false`;
 *   · 409 when a consensus row already exists;
 *   · 409 without two DISTINCT, non-empty reviewerIds among the independent rows.
 * The extra client-side condition is the blind: a consensus is a reconciliation of
 * two FINISHED assessments, so the button appears only once the comparison does.
 */
export function consensusEligibility({ rows = [], canEdit = false, consensusSupported = true, blind = null } = {}) {
  const { independent, consensus } = partitionReviewerRows(rows);
  const state = blind || reviewerBlindState(rows);
  const reviewerIds = [...new Set(independent.map(r => r.reviewerId || '').filter(Boolean))];
  const deny = (reason, message) => ({ canCreate: false, reason, message, reviewerIds });

  if (consensus) return deny('exists', 'A consensus record already exists for this study.');
  if (consensusSupported === false) return deny('unsupported', 'This instrument does not support a consensus record.');
  if (!canEdit) return deny('read-only', 'You have read-only access to Risk of Bias for this project.');
  if (reviewerIds.length < 2) {
    return deny('needs-two-reviewers', 'A consensus record requires two independent reviewer assessments of this study.');
  }
  if (!state.unlocked) return deny('blinded', state.message);
  return {
    canCreate: true,
    reason: 'ok',
    message: 'Create a reconciled consensus record. Both reviewer assessments are kept unchanged.',
    reviewerIds,
  };
}

export default {
  CONSENSUS_STATUS,
  COMPLETE_STATUS,
  isConsensusRow,
  isCompleteRow,
  partitionReviewerRows,
  rowsForStudy,
  reviewerLabel,
  reviewerBlindState,
  domainDiff,
  overallDiff,
  itemDiffRows,
  agreementText,
  consensusEligibility,
};
