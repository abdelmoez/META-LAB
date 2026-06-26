/**
 * presence.js — ONE shared contract for project presence display (56.md §5).
 *
 * 56.md requires "active users now / total members" to be IDENTICAL on every
 * project page. Before this, the Overview counted total members from the live
 * roster (`members.length`) while the deep-tool workspace counted from the cached
 * `project._linkedMetaSift.memberCount` — two sources that can disagree mid-session.
 *
 * `totalMembersOf` is the single rule both pages now use: prefer the canonical
 * cached scalar `memberCount` (always present on a linked project, identical on
 * every page), falling back to the roster length when the cache is absent. The
 * active count + the chip rendering already come from the one shared
 * `useProjectPresence` hook + `PresenceIndicator` chip, so this closes the last gap.
 */
export function totalMembersOf(project, members) {
  const cached = project && project._linkedMetaSift && project._linkedMetaSift.memberCount;
  if (typeof cached === 'number' && cached > 0) return cached;
  if (Array.isArray(members)) return members.length;
  return undefined;
}
