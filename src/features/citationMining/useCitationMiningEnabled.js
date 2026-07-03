/**
 * useCitationMiningEnabled — tiny React hook over `citationMiningEnabled()` so the
 * navigation chrome (StitchProjectSubnav) and the panels can flag-gate WITHOUT
 * pulling the heavy panel chunk. Returns a tri-state:
 *   null    — still loading (render nothing / neutral)
 *   false   — flag OFF (feature must be invisible + make no citation calls)
 *   true    — flag ON
 * The underlying settings read is cached module-level, so many mounts share ONE
 * fetch. SSR-safe: the effect never runs server-side, so it returns the initial
 * value (null) and the citation entry stays hidden until the client confirms ON.
 */
import { useEffect, useState } from 'react';
import { citationMiningEnabled } from './citationMiningApi.js';

export function useCitationMiningEnabled() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    let alive = true;
    citationMiningEnabled().then((v) => { if (alive) setOn(!!v); }).catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, []);
  return on;
}

export default useCitationMiningEnabled;
