/**
 * useSearchMode — 75.md recs (Finding 2) + 78.md #5. A thin React hook that resolves a
 * project's active search mode ('manual' | 'automated' | null) so the white Search
 * side-menu can build the SAME mode-scoped stage list the in-body SearchWorkspace
 * shows. Without it the subnav ran `stagesFor(undefined)` (the full manual list) while
 * the body — driven by the saved `searchMode='automated'` — dropped Database
 * Strategies, so the menu highlighted a phantom stage.
 *
 * 78.md #5 — it must also update IMMEDIATELY when the user switches mode in the body,
 * with no page reload. It now subscribes to the shared `searchModeStore`, which the
 * in-body SearchWorkspace publishes to on every mode change (and its mount-load). The
 * store is the single reactive source of truth; the server stays authoritative because
 * the FIRST resolver to see an unknown project seeds the store from `loadSearch`.
 *
 * Only matters when the staged workspace (searchWorkspaceV2) is on and the Search
 * category is active, so callers pass `enabled=false` to skip everything on every other
 * category / when the flag is off — no wasted `/api/search/:id` request. Fail-soft: any
 * error → null (the full manual list, robust). SSR-safe: the effect never runs
 * server-side.
 */
import { useEffect, useState } from 'react';
import { loadSearch } from '../searchBuilder/index.js';
import { getSearchMode, publishSearchMode, subscribeSearchMode } from './searchModeStore.js';

export function useSearchMode(projectId, enabled = true) {
  const [mode, setMode] = useState(() => {
    const cached = getSearchMode(projectId);
    return cached === undefined ? null : cached;
  });
  useEffect(() => {
    if (!enabled || !projectId) return undefined;
    let alive = true;
    // Subscribe FIRST so an in-body mode change that lands DURING the seed fetch is
    // not missed (the body publishes to the store; we re-render from it).
    const unsub = subscribeSearchMode(projectId, (m) => { if (alive) setMode(m); });
    const cached = getSearchMode(projectId);
    if (cached !== undefined) {
      setMode(cached);
    } else {
      // Seed the shared store from the persisted mode (server is authoritative). The
      // publish notifies our own subscriber, so we never setMode() directly here.
      // recs round — only seed while the store is STILL unresolved: if the in-body
      // SearchWorkspace published a (newer, optimistic) mode while this load was in
      // flight, that published value wins and this stale seed must not clobber it.
      loadSearch(projectId)
        .then((s) => {
          if (!alive || getSearchMode(projectId) !== undefined) return;
          const m = s && (s.searchMode === 'manual' || s.searchMode === 'automated') ? s.searchMode : null;
          publishSearchMode(projectId, m);
        })
        .catch(() => { if (alive && getSearchMode(projectId) === undefined) publishSearchMode(projectId, null); });
    }
    return () => { alive = false; unsub(); };
  }, [projectId, enabled]);
  return mode;
}

export default useSearchMode;
