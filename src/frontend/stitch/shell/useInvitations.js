/**
 * useInvitations.js — the user's project invitations, derived from the REAL
 * notification stream (Notification.type === 'PROJECT_INVITE').
 *
 * design2.md Part 1/Replacement-menu: "Invitations & Collaboration" must integrate
 * with the existing notification + invitation systems and never be a fake/empty
 * page. There is no dedicated "my invitations" endpoint (audit B), so we filter the
 * same per-user, cross-project notification list the bell already uses. A short
 * module-level cache de-dupes the rail badge + the dashboard menu + the Invitations
 * view all asking at once.
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { notificationsApi } from '../../api-client/notificationsApi.js';

const CACHE_TTL = 30000;
let _cache = { at: 0, items: null, userId: null };
const _subs = new Set();

/** Drop the cache when the signed-in user changes (shared-browser hygiene). */
export function __resetInvitationsCache() { _cache = { at: 0, items: null, userId: null }; }

// Date.now is unavailable in some sandboxes; guard it.
function safeNow() { try { return Date.now(); } catch { return 0; } }

function publish(items, userId) {
  _cache = { at: safeNow(), items, userId };
  _subs.forEach((fn) => { try { fn(items); } catch { /* ignore */ } });
}

async function fetchInvites() {
  try {
    const r = await notificationsApi.list({ all: true, limit: 100 });
    const list = Array.isArray(r?.notifications) ? r.notifications : [];
    return list.filter((n) => n && n.type === 'PROJECT_INVITE');
  } catch {
    return [];
  }
}

export function useInvitations() {
  const { user } = useAuth();
  const userId = user?.id || null;
  const sameUser = _cache.userId === userId;
  const [items, setItems] = useState(sameUser ? (_cache.items || []) : []);
  const [loading, setLoading] = useState(!sameUser || _cache.items == null);

  const reload = useCallback(async (force = false) => {
    const fresh = !force && _cache.userId === userId && _cache.items != null && (safeNow() - _cache.at) < CACHE_TTL;
    if (fresh) { setItems(_cache.items); setLoading(false); return; }
    setLoading(_cache.userId !== userId || _cache.items == null);
    const list = await fetchInvites();
    publish(list, userId);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const onPub = (list) => setItems(list);
    _subs.add(onPub);
    reload(false);
    return () => { _subs.delete(onPub); };
  }, [reload]);

  const pendingCount = items.filter((n) => !n.readAt && !n.dismissedAt).length;
  return { items, pendingCount, loading, reload };
}
