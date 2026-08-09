/**
 * recordListQuery.js — 65.md SCR-1: pure helpers for the listRecords FAST PATH.
 *
 * The default records list loaded EVERY project record per page request (findMany
 * with no take/skip), shaping thousands of rows to return 50. When a request needs
 * no AI-rank ordering, no text search, no keyword filtering, and only a filter the
 * database can evaluate exactly, the query can be pushed into Prisma WHERE +
 * orderBy + skip/take with a groupBy-free count — the DB pages, not Node.
 *
 * SAFE SUBSET ONLY. Decision filters ('undecided'/'included'/…) are deliberately
 * NOT eligible: the in-memory path resolves "my decision" as the FIRST of the
 * caller's decision rows in array order, which a relational `some` predicate cannot
 * reproduce exactly for reviewers holding rows at multiple stages. Those filters
 * keep the in-memory path (documented residual).
 *
 * Pure functions, no DB — unit-tested without Prisma. Both SQLite and Postgres
 * support every construct emitted here (where/none/some, orderBy, skip/take).
 */

// Filters the fast path can evaluate with EXACT parity to the in-memory path:
//   all         → no extra predicate
//   unopened_me → the caller has NO open-state row for the record
//   opened_me   → the caller HAS an open-state row for the record
export const FAST_LIST_FILTERS = Object.freeze(['all', 'unopened_me', 'opened_me']);

/**
 * fastListEligible — true when the request can be served by the paged DB query.
 * Conservative: ANY search / keyword / AI-queue / hasAbstract signal falls back to
 * the existing in-memory path (identical behaviour there is the contract).
 *
 * @param {object} q  { search, filter, hasAbstract, keywords, aiQueue, aiBand }
 */
export function fastListEligible(q = {}) {
  if (q.search) return false;
  if (q.keywords) return false;
  if (q.hasAbstract !== undefined && q.hasAbstract !== null && q.hasAbstract !== '') return false;
  if (q.aiQueue && q.aiQueue !== 'default') return false;
  if (q.aiBand && q.aiBand !== 'all') return false;
  const filter = q.filter || 'all';
  return FAST_LIST_FILTERS.includes(filter);
}

/**
 * pageWindow({ firstPage, page, pages, total, limit }) — 100.md §13. What the record
 * list can still load, given that the loaded rows are a CONTIGUOUS run of pages
 * `firstPage…page`.
 *
 * Before Resume Screening the run always started at page 1, so "how many are left"
 * could be read off `records.length` vs `total`. Resume jumps straight to the page
 * holding the article the reviewer stopped at, which makes that arithmetic wrong in
 * both directions: it would promise more records ahead than exist, and it would leave
 * the pages BEFORE the jump silently unreachable.
 *
 * Returns { hasEarlier, earlierCount, hasMore, remaining } — all non-negative.
 * Pure; no DB.
 */
export function pageWindow({ firstPage = 1, page = 1, pages = 1, total = 0, limit = 50 } = {}) {
  const lim = Number(limit) > 0 ? Math.floor(Number(limit)) : 50;
  const first = Math.max(1, Math.floor(Number(firstPage) || 1));
  const last = Math.max(first, Math.floor(Number(page) || 1));
  const nPages = Math.max(1, Math.floor(Number(pages) || 1));
  const nTotal = Math.max(0, Math.floor(Number(total) || 0));
  return {
    hasEarlier: first > 1,
    earlierCount: Math.min(nTotal, (first - 1) * lim),
    hasMore: last < nPages,
    remaining: Math.max(0, nTotal - (last * lim)),
  };
}

/**
 * moveIntent — 107.md §7. What a next/previous keystroke MEANS at the current
 * position, decided before anything is selected or requested.
 *
 * Keyboard navigation used to dead-end at the last LOADED row: a reviewer arrowing
 * through 5,000 records stopped silently at 50 until they reached for the mouse. The
 * fix has to distinguish four cases, and getting any of them wrong is a data problem
 * rather than a cosmetic one — advancing into a nonexistent index blanks the reader,
 * and firing a second page request while one is in flight duplicates or skips studies.
 *
 *   'move'      → an adjacent row exists; select it.
 *   'load-next' → past the last loaded row, more exist, nothing in flight: paginate.
 *   'end'       → past the last loaded row and there is genuinely nothing more.
 *   'noop'      → before the first row, empty list, or a request already in flight
 *                 (repeated key presses while loading must NOT queue up).
 *
 * @param {object} o
 * @param {number}  o.index        index of the selected row (−1 when none is selected)
 * @param {number}  o.dir          +1 forward, −1 backward
 * @param {number}  o.count        rows currently loaded
 * @param {boolean} o.hasMore      more pages exist server-side (from pageWindow)
 * @param {boolean} o.loadingMore  a pagination request is already in flight
 * @returns {'move'|'load-next'|'end'|'noop'}
 */
export function moveIntent({ index, dir, count, hasMore, loadingMore } = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return 'noop';
  const i = Math.floor(Number(index));
  const step = Number(dir) < 0 ? -1 : 1;
  const next = (Number.isFinite(i) ? i : -1) + step;
  if (next >= 0 && next < n) return 'move';
  // Backwards off the top: the earlier pages are reachable through the list's own
  // "Earlier records" control, which is a scroll position rather than a selection.
  if (next < 0) return 'noop';
  if (!hasMore) return 'end';
  return loadingMore ? 'noop' : 'load-next';
}

/**
 * advanceContextMatches — 107.md rec. Is a pending keyboard auto-advance still about
 * the list the reviewer is looking at?
 *
 * `moveIntent` returning 'load-next' arms a deferred selection ("select the first
 * record that was not already loaded") which is resolved one render later, when the
 * batch lands. Between those two moments the reviewer can switch project, change the
 * filter, type in the search box, or a realtime `decision.saved` reset can replace the
 * whole window — and the deferred selection would then land on a record from a list
 * that is no longer displayed (and POST `markOpened` for a foreign record id).
 *
 * The arm site stamps the dataset identity; this compares it to the live one. `gen` is
 * the caller's load generation, bumped by every RESET load.
 *
 * @param {{pid?:string, filter?:string, search?:string, gen?:number}|null} pending
 * @param {{pid?:string, filter?:string, search?:string, gen?:number}} ctx
 * @returns {boolean} true only when every stamped field still matches
 */
export function advanceContextMatches(pending, ctx = {}) {
  if (!pending || typeof pending !== 'object') return false;
  return pending.pid === ctx.pid
    && pending.filter === ctx.filter
    && pending.search === ctx.search
    && pending.gen === ctx.gen;
}

/**
 * buildFastListQuery — the Prisma where/orderBy for an eligible request.
 * Ordering matches the in-memory path (createdAt asc) with an id tiebreak so
 * skip/take pagination is stable across requests when createdAt ties (bulk imports
 * write many rows with identical timestamps).
 *
 * @param {{projectId:string, userId:string, filter?:string}} args
 * @returns {{ where: object, orderBy: object[] }}
 */
export function buildFastListQuery({ projectId, userId, filter = 'all' }) {
  const where = { projectId };
  if (filter === 'unopened_me') where.openStates = { none: { userId } };
  else if (filter === 'opened_me') where.openStates = { some: { userId } };
  return {
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  };
}
