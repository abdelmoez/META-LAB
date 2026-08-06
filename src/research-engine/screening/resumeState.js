/**
 * resumeState.js — 100.md §§12-15. Pure logic for "Resume Screening": deciding WHICH
 * article a returning reviewer should land on, and where it sits in the list.
 *
 * ── Why there is no `lastScreenedRecordId` column ────────────────────────────────
 * 100.md §14 requires the resume position to be scoped to user + project + screening
 * stage and to never overwrite another reviewer's position. `ScreenDecision` already
 * stores exactly that, uniquely, with a timestamp:
 *
 *     @@unique([recordId, reviewerId, stage])   +   updatedAt @updatedAt
 *
 * So the resume position is DERIVED from the reviewer's own decision history rather
 * than stored as a second, mutable pointer. That is not a shortcut — it is what makes
 * every 100.md §15 edge case fall out for free:
 *
 *   · two reviewers          — each reads only their own decision rows;
 *   · logout / login / new browser / two tabs — the server is the only source of
 *     truth, so there is nothing in localStorage to go stale;
 *   · article deleted        — the decision row cascade-deletes with it, so a dangling
 *                             pointer cannot exist;
 *   · article deduplicated   — `isDuplicate` records are excluded from the pending pool
 *                             at read time, so a resolved duplicate simply stops being
 *                             a candidate;
 *   · filters changed        — resume ignores the reviewer's current list filters and
 *                             reports the canonical position, so the caller can restore
 *                             a view that actually contains the article;
 *   · last article excluded  — an exclusion is a decision like any other; the anchor
 *                             moves on regardless of WHICH decision was made;
 *   · undo (decision → 'undecided') — the anchor skips undecided rows, so the undone
 *                             article becomes the next thing needing a decision again.
 *
 * ── The ordering contract ────────────────────────────────────────────────────────
 * Everything here assumes the canonical record order `(createdAt ASC, id ASC)` — the
 * same order `recordListQuery.buildFastListQuery` gives the default list. The id
 * tiebreak matters: bulk imports write thousands of rows with identical timestamps.
 *
 * PURE — no Prisma, no I/O. The controller supplies the rows.
 */

/** The screening stages a reviewer can hold independent progress in (100.md §14). */
export const RESUME_STAGES = Object.freeze(['title_abstract', 'full_text']);

/** Coerce any input to a supported stage id (default: Title/Abstract). */
export function normalizeResumeStage(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return RESUME_STAGES.includes(s) ? s : RESUME_STAGES[0];
}

/**
 * Resume outcomes.
 *   resume   — carry on after the reviewer's most recent decision
 *   reopen   — they opened an article but never decided it; put them back on it
 *   start    — nothing screened yet at this stage → the first eligible article
 *   complete — every eligible article at this stage already has their decision
 *   empty    — this stage holds no screenable articles at all
 */
export const RESUME_STATUS = Object.freeze({
  RESUME: 'resume', REOPEN: 'reopen', START: 'start', COMPLETE: 'complete', EMPTY: 'empty',
});

/**
 * afterCursor({ createdAt, id }) — the Prisma predicate for "strictly after this row
 * in (createdAt ASC, id ASC)". Returns null for a missing/invalid anchor so the caller
 * can fall back to "from the beginning". Pure + exported so the keyset pagination that
 * makes resume O(1)-ish is unit-tested without a database.
 */
export function afterCursor(anchor) {
  if (!anchor || anchor.createdAt == null || !anchor.id) return null;
  return {
    OR: [
      { createdAt: { gt: anchor.createdAt } },
      { AND: [{ createdAt: anchor.createdAt }, { id: { gt: String(anchor.id) } }] },
    ],
  };
}

/**
 * pickResumeTarget(input) — the whole decision, as pure data.
 *
 * input:
 *   decisionAnchor   { recordId, createdAt, id, decidedAt } | null
 *                    the reviewer's most recent NON-undecided decision at this stage
 *   openAnchor       { recordId } | null
 *                    the most recently OPENED still-undecided article (100.md §13: if
 *                    the last thing they did was open an article without deciding it,
 *                    re-opening that article is less friction than skipping past it)
 *   nextAfterAnchor  recordId | null — first pending article after decisionAnchor
 *   firstPending     recordId | null — first pending article overall (wrap-around)
 *   pendingCount     how many articles at this stage still need this reviewer
 *   stageTotal       how many screenable articles exist at this stage at all
 *
 * → { status, recordId, wrapped }
 *   `wrapped` marks the case where the reviewer had skipped articles earlier in the
 *   list: there was nothing after their anchor, so resume went back to the first
 *   outstanding one. Callers say so, instead of silently teleporting backwards.
 */
export function pickResumeTarget(input = {}) {
  const {
    decisionAnchor = null, openAnchor = null,
    nextAfterAnchor = null, firstPending = null,
    pendingCount = 0, stageTotal = 0,
  } = input;

  if (!stageTotal) return { status: RESUME_STATUS.EMPTY, recordId: null, wrapped: false };
  if (!pendingCount) return { status: RESUME_STATUS.COMPLETE, recordId: null, wrapped: false };

  if (decisionAnchor) {
    if (nextAfterAnchor) return { status: RESUME_STATUS.RESUME, recordId: nextAfterAnchor, wrapped: false };
    if (firstPending) return { status: RESUME_STATUS.RESUME, recordId: firstPending, wrapped: true };
    return { status: RESUME_STATUS.COMPLETE, recordId: null, wrapped: false };
  }

  // No decision yet at this stage. An article they were reading beats "record 1".
  if (openAnchor && openAnchor.recordId) {
    return { status: RESUME_STATUS.REOPEN, recordId: openAnchor.recordId, wrapped: false };
  }
  if (firstPending) return { status: RESUME_STATUS.START, recordId: firstPending, wrapped: false };
  return { status: RESUME_STATUS.COMPLETE, recordId: null, wrapped: false };
}

/**
 * resumePage(position, limit) — which 1-based page of the records list holds the
 * 1-based `position`. The client jumps straight there instead of paging through
 * thousands of rows. A missing/invalid position resolves to page 1.
 */
export function resumePage(position, limit) {
  const p = Number(position);
  const l = Number(limit);
  if (!Number.isFinite(p) || p < 1 || !Number.isFinite(l) || l < 1) return 1;
  return Math.floor((p - 1) / l) + 1;
}

/**
 * resumeMessage(payload) — the one user-facing sentence for a resume result, so the
 * wording is identical everywhere it is shown (button label, banner, announcement) and
 * is unit-pinned rather than duplicated in JSX. 100.md §15 requires the "you have
 * completed screening for this stage" case to say so explicitly.
 */
export function resumeMessage(payload = {}) {
  const { status, position, pending, stageLabel = 'this stage', wrapped } = payload;
  const at = Number.isFinite(Number(position)) && Number(position) > 0
    ? ` (article ${Number(position).toLocaleString()})` : '';
  switch (status) {
    case RESUME_STATUS.COMPLETE:
      return `You have completed screening for ${stageLabel}.`;
    case RESUME_STATUS.EMPTY:
      return `There are no articles to screen in ${stageLabel} yet.`;
    case RESUME_STATUS.REOPEN:
      return `Back to the article you had open${at}.`;
    case RESUME_STATUS.START:
      return `Starting at the first article that needs a decision${at}.`;
    case RESUME_STATUS.RESUME:
    default:
      return wrapped
        ? `Back to the earliest article you skipped${at} — ${Number(pending || 0).toLocaleString()} still need a decision.`
        : `Continuing from where you stopped${at} — ${Number(pending || 0).toLocaleString()} still need a decision.`;
  }
}
