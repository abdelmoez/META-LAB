/**
 * opsGovernance.js — 109.md §§3, 5, 55 (client side).
 *
 * The ONE place the browser reads the Ops control plane. Two things live here:
 *
 *   1. `useGovernanceFlags(keys)` — the 107/108 feature kill switches, resolved with
 *      a DEFAULT-ON fallback taken from the shared catalogue. A flag that is absent
 *      from `/api/settings/public` (old server, failed fetch, first paint before the
 *      snapshot lands) reads as its catalogue default, so an upgrade can never
 *      silently regress a shipped feature (109.md §5).
 *   2. `useOpsGovernance()` — the typed research-governance knobs, merged UNDER the
 *      catalogue defaults. Consumers ALSO keep their own hardcoded fallback for the
 *      synchronous path; these are UI defaults, never enforcement (enforcement is
 *      server-side).
 *
 * ── WHY IT DOES NOT FETCH ────────────────────────────────────────────────────
 * Both readers delegate to featureFlagState.js's single briefly-cached
 * `/api/settings/public` snapshot (109.md §55). Fifteen screening components asking
 * for a flag issue ONE request between them, and no new endpoint is introduced.
 *
 * ── WHY THE INITIAL VALUE IS THE DEFAULT, NOT `null` ─────────────────────────
 * The repo's UI tests are `renderToStaticMarkup` SSR-shape assertions, where effects
 * never run. Seeding state with the catalogue default means the first (and, under
 * SSR, only) render is byte-identical to pre-109 behaviour: every existing test stays
 * green, and a user whose fetch is still in flight sees the shipped behaviour rather
 * than a flash of "feature disabled".
 *
 * The module-level snapshot cache exists for the same reason in the SYNCHRONOUS
 * direction: a component that cannot wait for an effect (ScreeningTab latches its
 * page size once per reset) reads `governanceSettings()` and gets the best value
 * known so far, which is the catalogue default until the first fetch resolves.
 */
import { useEffect, useState } from 'react';
import {
  RESEARCH_GOVERNANCE_KEY, mergeDomainDefaults, flagDefaults,
} from '../../shared/opsSettingsCatalog.js';
import { publicOpsSettings, publicFeatureFlags, isFlagOn } from './featureFlagState.js';

/** The catalogue defaults for the research-governance block. Frozen; never mutated. */
export const GOVERNANCE_DEFAULTS = Object.freeze(mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, null));

const FLAG_DEFAULTS = Object.freeze(flagDefaults());

// Best value known so far. Starts at the defaults so the synchronous reader is never
// `undefined`, and is replaced (never mutated) once the shared snapshot resolves.
let _settings = GOVERNANCE_DEFAULTS;

/** The synchronous best-known governance object. Defaults until the snapshot lands. */
export function governanceSettings() {
  return _settings;
}

/** Load (or re-read) the shared public snapshot and cache the governance block. */
export function loadGovernanceSettings() {
  return publicOpsSettings()
    .then((s) => {
      const next = s && typeof s === 'object' ? s : GOVERNANCE_DEFAULTS;
      _settings = next;
      return next;
    })
    .catch(() => GOVERNANCE_DEFAULTS);
}

/** Test/HMR hook — drop the cached governance block (the flag cache has its own). */
export function resetGovernanceCache() { _settings = GOVERNANCE_DEFAULTS; }

/**
 * resolveFlag(flags, key) — 109.md §5's default-ON rule, as a pure function.
 *
 * A key the server did not send is NOT "off": it is a server that predates the flag,
 * or a fetch that failed. Both must read as the catalogue default, which for every
 * 107/108 feature is `true`. A key the server DID send goes through the normal
 * dependency-aware `isFlagOn`, so a hard dependency still gates it.
 */
export function resolveFlag(flags, key) {
  const f = (flags && typeof flags === 'object' && !Array.isArray(flags)) ? flags : null;
  if (!f || !Object.prototype.hasOwnProperty.call(f, key)) return FLAG_DEFAULTS[key] === true;
  return isFlagOn(f, key);
}

/** Pure: resolve a list of keys against one flags object. */
export function resolveFlags(flags, keys) {
  const out = {};
  for (const k of Array.isArray(keys) ? keys : []) out[k] = resolveFlag(flags, k);
  return out;
}

/**
 * useGovernanceFlags(keys) → `{[key]: boolean}`.
 *
 * `keys` is read once per identity change; pass a module-level frozen array (or a
 * stable literal) so the effect does not re-run every render. The initial value is
 * the catalogue default for each key — see the header.
 */
export function useGovernanceFlags(keys) {
  const keyList = Array.isArray(keys) ? keys : [];
  const sig = keyList.join('|');
  const [state, setState] = useState(() => resolveFlags(null, keyList));
  useEffect(() => {
    let live = true;
    publicFeatureFlags()
      .then((flags) => { if (live) setState(resolveFlags(flags, sig ? sig.split('|') : [])); })
      .catch(() => { /* keep the defaults — fail-OPEN for shipped features */ });
    return () => { live = false; };
  }, [sig]);
  return state;
}

/** Single-key convenience wrapper over useGovernanceFlags. */
export function useGovernanceFlag(key) {
  const [on, setOn] = useState(() => resolveFlag(null, key));
  useEffect(() => {
    let live = true;
    publicFeatureFlags()
      .then((flags) => { if (live) setOn(resolveFlag(flags, key)); })
      .catch(() => {});
    return () => { live = false; };
  }, [key]);
  return on;
}

/**
 * useOpsGovernance() → the merged research-governance settings object.
 * Defaults on the first render (and under SSR); the real values one effect later.
 */
export function useOpsGovernance() {
  const [settings, setSettings] = useState(governanceSettings);
  useEffect(() => {
    let live = true;
    loadGovernanceSettings().then((s) => { if (live) setSettings(s); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return settings;
}

export default useOpsGovernance;
