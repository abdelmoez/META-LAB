/**
 * useResearchProvenanceEnabled — tiny React hook over researchProvenanceFlagEnabled()
 * so the workspace chrome can flag-gate the Project History entry WITHOUT pulling the
 * heavy panel chunk. Tri-state: null (loading) | false (OFF) | true (ON). SSR-safe.
 * Mirrors useCitationMiningEnabled.
 */
import { useEffect, useState } from 'react';
import { researchProvenanceFlagEnabled } from './flag.js';

export function useResearchProvenanceEnabled() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    let alive = true;
    researchProvenanceFlagEnabled().then((v) => { if (alive) setOn(!!v); }).catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, []);
  return on;
}

export default useResearchProvenanceEnabled;
