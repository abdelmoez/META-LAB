/**
 * stats.js — META·SIFT Beta screening statistics.
 * Pure functions, no database.
 */

/**
 * computeStats — compute screening progress stats from decisions array.
 * @param {number} total — total records in project
 * @param {Array<{decision: string}>} decisions — reviewer's decisions
 * @returns {{ total, screened, included, excluded, maybe, undecided, progress }}
 */
export function computeStats(total, decisions) {
  const counts = { include: 0, exclude: 0, maybe: 0 };
  decisions.forEach(d => {
    if (counts[d.decision] !== undefined) counts[d.decision]++;
  });
  const screened = counts.include + counts.exclude + counts.maybe;
  return {
    total,
    screened,
    included: counts.include,
    excluded: counts.exclude,
    maybe: counts.maybe,
    undecided: Math.max(0, total - screened),
    progress: total > 0 ? Math.round((screened / total) * 100) : 0,
  };
}

/**
 * computePrismaNumbers — derive PRISMA-compatible counts from screening state.
 */
export function computePrismaNumbers({ total, included, excluded, maybe, undecided, duplicates = 0 }) {
  return {
    identified:      total,
    deduplicated:    total - duplicates,
    screened:        included + excluded + maybe,
    excluded_title:  excluded,
    full_text:       included + maybe,
    included_final:  included,
  };
}
