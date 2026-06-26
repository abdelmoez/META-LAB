/**
 * useScreeningSummary.js — the shared live screening `dataSummary` for the project
 * workspace (56.md §4/§5).
 *
 * ONE fetch of `screeningApi.getOverview(spId).dataSummary` (the exact source the
 * project Overview and the screening engine already use) refreshed on realtime
 * decision/handoff events — NOT a polling loop. The result powers:
 *   · the white-submenu screening vertical stepper (buildScreeningSteps), and
 *   · the purple rail's "needs attention" state for the Screen category.
 * Returns null until loaded / when there is no linked screening workspace, so every
 * consumer degrades gracefully (no fake counts).
 */
import { useState, useEffect, useCallback } from 'react';
import { screeningApi } from '../../screening/api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';

export function useScreeningSummary(spId) {
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    if (!spId) { setSummary(null); return; }
    try {
      const ov = await screeningApi.getOverview(spId);
      setSummary((ov && ov.dataSummary) || null);
    } catch {
      /* keep the previous value rather than flashing empty on a transient error */
    }
  }, [spId]);

  useEffect(() => { load(); }, [load]);

  // Refresh (silently) when screening data changes elsewhere — no fixed-interval poll.
  useRealtime({
    'decision.saved': () => load(),
    'handoff.updated': () => load(),
    'project.updated': () => load(),
  });

  return summary;
}

/**
 * Does the Screen category need attention right now? Derived from the SAME summary
 * the horizontal screening stepper reads — unresolved duplicates or conflicts are
 * the actionable "attention" signals (screeningSteps.js raises the same states).
 */
export function screenNeedsAttention(summary) {
  if (!summary) return false;
  const dups = summary.unresolvedDuplicateGroups || 0;
  const conflicts = summary.unresolvedConflicts || 0;
  return dups > 0 || conflicts > 0;
}
