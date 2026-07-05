/**
 * useSearchMode — 75.md recs round (Finding 2). A thin React hook that resolves a
 * project's PERSISTED search mode ('manual' | 'automated' | null) so the white Search
 * side-menu can build the SAME mode-scoped stage list the in-body SearchWorkspace
 * shows. Without it the subnav ran `stagesFor(undefined)` (the full manual list) while
 * the body — driven by the saved `searchMode='automated'` — dropped Database
 * Strategies, so the menu highlighted a phantom stage.
 *
 * Reads the saved `search` WorkflowModuleState once via `loadSearch(projectId)` (the
 * SAME client the body uses) and returns the mode. Only matters when the staged
 * workspace (searchWorkspaceV2) is on and the Search category is active, so callers
 * pass `enabled=false` to skip the fetch entirely on every other category / when the
 * flag is off — no wasted `/api/search/:id` request. Fail-soft: any error → null (the
 * full manual list, robust). SSR-safe: the effect never runs server-side.
 */
import { useEffect, useState } from 'react';
import { loadSearch } from '../searchBuilder/index.js';

export function useSearchMode(projectId, enabled = true) {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    if (!enabled || !projectId) return undefined;
    let alive = true;
    loadSearch(projectId)
      .then((s) => {
        if (!alive) return;
        const m = s && (s.searchMode === 'manual' || s.searchMode === 'automated') ? s.searchMode : null;
        setMode(m);
      })
      .catch(() => { if (alive) setMode(null); });
    return () => { alive = false; };
  }, [projectId, enabled]);
  return mode;
}

export default useSearchMode;
