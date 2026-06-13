/**
 * notificationsApi.js — REST client for the user notification system (prompt6 Task 1).
 *
 * Server mounts these routes at /api/notifications on their OWN router behind
 * requireAuth only — deliberately NOT under the rate-limited /api/admin or
 * /api/auth mounts (bell polling there would self-DoS the console).
 *
 * Follows the apiClient.js req() pattern: cookie auth via credentials:'include',
 * parsed JSON bodies, and on non-2xx throws an Error whose `message` is the
 * server's { error } string with `.status` and `.body` attached.
 */

const BASE = '/api/notifications';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { credentials: 'include', ...opts });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = (body && body.error) || `HTTP ${res.status} ${res.statusText}`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const notificationsApi = {
  /**
   * GET /api/notifications — newest-first list for the signed-in user.
   * @param {{ unread?: boolean, page?: number, limit?: number, all?: boolean }} [params]
   * @returns {Promise<{ notifications: Array<object>, total: number, unreadCount: number }>}
   */
  list: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.unread) qs.set('unread', '1');
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.all) qs.set('all', '1');
    const s = qs.toString();
    return req(s ? `?${s}` : '');
  },

  /** GET /api/notifications/unread-count → { count } (server-authoritative). */
  unreadCount: () => req('/unread-count'),

  /** POST /api/notifications/:id/read — mark one notification read. */
  markRead: (id) => req(`/${id}/read`, { method: 'POST' }),

  /**
   * POST /api/notifications/:id/opened — click-through (prompt9 Task 1):
   * stamps readAt + dismissedAt + clickedAt in one idempotent call.
   * 404 on foreign ids (existence hiding). → { notification }
   */
  opened: (id) => req(`/${id}/opened`, { method: 'POST' }),

  /** POST /api/notifications/:id/dismiss — dismiss (hide) one notification. */
  dismiss: (id) => req(`/${id}/dismiss`, { method: 'POST' }),

  /** POST /api/notifications/mark-all-read — clear the unread badge. */
  markAllRead: () => req('/mark-all-read', { method: 'POST' }),
};
