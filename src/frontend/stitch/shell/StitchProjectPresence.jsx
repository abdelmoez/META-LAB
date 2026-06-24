/**
 * StitchProjectPresence.jsx — online project members on every Stitch project page
 * (design3.md "Online Project Members").
 *
 * Reuses the EXACT legacy presence backend with zero duplication: the standalone
 * hook `useProjectPresence` (heartbeat + SSE refetch + 75s server-side staleness
 * prune + reconnect-safe via useRealtime) and the `PresenceIndicator` chip
 * (avatars/initials, accessible names, overflow popover, keyboard + ARIA). Scoped
 * to the linked ScreenProject id (`spId`); renders nothing when there is no linked
 * workspace or no one is present — never a fake static list.
 *
 * `location` = the page's user-facing stage label, so teammates see where each
 * member is. Exactly one mounted component per tab per room should heartbeat (the
 * page that IS this location), so embedded engines that own their own heartbeat can
 * pass `heartbeat={false}` (listen-only).
 */
import { useProjectPresence } from '../../screening/hooks/usePresence.js';
import PresenceIndicator from '../../screening/components/PresenceIndicator.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function StitchProjectPresence({ spId, location, totalMembers, heartbeat = true }) {
  const { user } = useAuth();
  const { users, locks } = useProjectPresence(spId, location, { enabled: !!spId, heartbeat });
  if (!spId) return null;
  return (
    <PresenceIndicator users={users} locks={locks} totalMembers={totalMembers} myUserId={user?.id} />
  );
}
