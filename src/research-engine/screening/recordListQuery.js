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
