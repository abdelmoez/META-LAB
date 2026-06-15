/**
 * memberOrder.js — pure roster ordering for the project members list (prompt22
 * Task 2). No React/JSX so the ordering is unit-testable in isolation; MembersTab
 * renders the returned sections. The roster always reads Owner → Leaders →
 * Members → Viewers, each group sorted by display name, split into contiguous
 * labelled sections.
 */

// `rank` orders the groups; `label` is the (plural) section heading shown above
// each group. Unknown roles fall into the Members group.
export const ROLE_GROUP = {
  owner:    { rank: 0, label: 'Owner' },
  leader:   { rank: 1, label: 'Leaders' },
  reviewer: { rank: 2, label: 'Members' },
  viewer:   { rank: 3, label: 'Viewers' },
};
const FALLBACK_GROUP = { rank: 2, label: 'Members' };

// Effective group role for a member, mirroring MemberRow's owner/leader detection
// (owner/leader can be flagged OR carried as a role).
export function groupRoleFor(m) {
  if (m.isOwner || m.role === 'owner') return 'owner';
  if (m.isLeader || m.role === 'leader') return 'leader';
  return m.role || 'reviewer';
}

export const groupMeta = (m) => ROLE_GROUP[groupRoleFor(m)] || FALLBACK_GROUP;

const displayName = (m) => (m.name || m.email || '').toLowerCase();

/**
 * Order members by group rank, then by display name, and split into contiguous
 * labelled sections. Returns [{ label, members }] in owner-first order.
 */
export function groupMembers(members) {
  const ordered = [...(members || [])].sort((a, b) => {
    const ra = groupMeta(a).rank, rb = groupMeta(b).rank;
    if (ra !== rb) return ra - rb;
    return displayName(a).localeCompare(displayName(b));
  });
  const sections = [];
  for (const m of ordered) {
    const label = groupMeta(m).label;
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.members.push(m);
    else sections.push({ label, members: [m] });
  }
  return sections;
}
