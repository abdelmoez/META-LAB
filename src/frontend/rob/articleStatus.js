/**
 * articleStatus.js — 79.md §1. Pure derivation of a RoB article's card-level status
 * from its assessments. Kept out of the panel component so it is unit-testable
 * without pulling in the PDF viewer / React tree.
 *
 * Encoding is REDUNDANT (icon + label, never colour alone):
 *   not-started  → 0 assessments
 *   in-progress  → assessments exist but none finalised (all drafts)
 *   partial      → some (not all) finalised  → "n/N complete"
 *   complete     → every assessment finalised
 */
import { C } from '../theme/tokens.js';

export function articleStatusOf(list) {
  const n = Array.isArray(list) ? list.length : 0;
  if (n === 0) return { key: 'not-started', label: 'Not started', icon: 'minus', tone: C.muted };
  const complete = list.filter((a) => a && a.status === 'complete').length;
  if (complete === n) return { key: 'complete', label: n > 1 ? 'All complete' : 'Complete', icon: 'circleCheck', tone: C.grn };
  if (complete > 0) return { key: 'partial', label: `${complete}/${n} complete`, icon: 'clock', tone: C.teal };
  return { key: 'in-progress', label: 'In progress', icon: 'clock', tone: C.yel };
}

export default articleStatusOf;
