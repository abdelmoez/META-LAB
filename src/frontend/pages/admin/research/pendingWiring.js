/**
 * research/pendingWiring.js — honesty layer for the 109 Ops control plane.
 *
 * 109.md §45 says a control that cannot actually change anything must not be
 * rendered as a live toggle. The catalogue's writable knobs are declared, stored,
 * validated and AUDITED server-side in this release, but the screening /
 * extraction / analysis / history clients read them in the SAME release through a
 * separate change (the client-wiring wave). Until that lands, saving one of these
 * is a real, audited configuration change that the running UI does not yet
 * consult.
 *
 * Rather than hide the controls (which would leave the settings unreachable and
 * unauditable) or pretend they are live (a dead toggle), every affected row is
 * rendered with an explicit note. This list is the W1-A handoff list of
 * declared-but-unconsumed knobs, plus `screening.keyboardNavigation` and
 * `screening.autoLoadMore`: a repo-wide search for a consumer of
 * `publicOpsSettings()` at the time of writing returned exactly zero call sites
 * outside featureFlagState.js itself, so the two master switches are in the same
 * state as the rest.
 *
 * MAINTENANCE: delete a key from this set the moment a client consumer reads it.
 * The set is keyed by CATALOGUE key, so a typo cannot silently un-mark a row —
 * `assertKnownKeys()` (used by the unit test) fails on a key the catalogue does
 * not declare.
 */
import { OPS_SETTINGS, isWritable } from '../../../../shared/opsSettingsCatalog.js';

// 109 r1: the W2-B client-wiring wave landed consumers for every declared knob
// (via publicOpsSettings()/governanceSettings() with shipped-behaviour fallbacks),
// so the set is empty. Add a key here ONLY while its client consumer has not shipped.
export const PENDING_CLIENT_WIRING = new Set([]);

/** The note rendered under a knob whose client consumer has not landed yet. */
export const PENDING_NOTE =
  'Applies after client wiring lands — the value is saved, validated and audited now; '
  + 'the researcher-facing surface starts reading it when the 109 client-wiring change ships in this release.';

export function isPendingClientWiring(key) {
  return PENDING_CLIENT_WIRING.has(key);
}

/**
 * Every key in the set must be a WRITABLE catalogue entry: marking a read-only
 * entry "pending" would be nonsense, and a stale key means the list drifted.
 * Returns the offending keys (empty array = healthy). Used by the unit test.
 */
export function assertKnownKeys() {
  const writable = new Set(OPS_SETTINGS.filter(isWritable).map((e) => e.key));
  return [...PENDING_CLIENT_WIRING].filter((k) => !writable.has(k));
}
