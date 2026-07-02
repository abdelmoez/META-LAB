/**
 * notificationTarget.js — 65.md NAV-1: the ONE deep-link resolver for
 * notification/activity/invitation rows (NotificationsBell, dashboard
 * ActivityView + InvitationsView).
 *
 * The /sift-beta routes are STAFF-ONLY (AdminRoute, 404-cloaked) — a
 * notification that only carries relatedScreenProjectId must NOT link a
 * normal member there: they'd land on a 404. Non-staff rows without a
 * workspace target render as plain (non-navigating) rows instead.
 */

/** Staff = the AdminRoute rule (admin | mod). */
export function isStaffUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'mod');
}

/**
 * Deep-link target for a notification, or null when the viewer has no
 * navigable destination (workspace id wins when both ids are set).
 *
 * @param {object} n      notification-like row (relatedMetaLabProjectId,
 *                        relatedScreenProjectId / relatedMetaSiftProjectId)
 * @param {object} opts   { staff } — resolver never reads the user directly
 */
export function notificationTarget(n, { staff = false } = {}) {
  if (!n) return null;
  if (n.relatedMetaLabProjectId) return `/app?project=${n.relatedMetaLabProjectId}`;
  const sift = n.relatedScreenProjectId || n.relatedMetaSiftProjectId;
  if (sift && staff) return `/sift-beta/projects/${sift}`;
  return null;
}
