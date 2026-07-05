/**
 * useSearchWorkspaceV2Enabled — tiny React hook over `searchWorkspaceV2FlagEnabled()`
 * so the navigation chrome (StitchProjectSubnav) can decide whether the Search white
 * submenu shows the numbered `?stage=` WORKFLOW (flag ON, the staged SearchWorkspace
 * honours `?stage=`) or the legacy single 'Search' destination (flag OFF, the classic
 * SearchWizard/SearchTab has no `?stage=` support). Mirrors useCitationMiningEnabled.
 * Tri-state:
 *   null    — still loading (render nothing / neutral)
 *   false   — flag OFF (legacy submenu — the pre-75 behaviour, unchanged)
 *   true    — flag ON (numbered Search workflow submenu)
 * The underlying settings read fails closed on any error, so an undetermined flag
 * always yields the safe legacy submenu. SSR-safe: the effect never runs server-side,
 * so it returns the initial value (null) until the client confirms.
 */
import { useEffect, useState } from 'react';
import { searchWorkspaceV2FlagEnabled } from './searchWorkspaceFlag.js';

export function useSearchWorkspaceV2Enabled() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    let alive = true;
    searchWorkspaceV2FlagEnabled().then((v) => { if (alive) setOn(!!v); }).catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, []);
  return on;
}

export default useSearchWorkspaceV2Enabled;
