/**
 * useGlobalPresence.js (prompt25 follow-up) — an app-wide presence heartbeat.
 *
 * The project-scoped presence (usePresence) only knows a user is "here" while they
 * have a project open. This hook fires a lightweight POST /api/presence/ping from
 * EVERY authenticated page (with a coarse, route-derived location) so a user who is
 * only on the dashboard / profile / ops still counts as "online now" in the Ops
 * console. Best-effort: failures are swallowed; paused while the tab is hidden.
 */
import { useEffect, useRef } from 'react';

const PING_MS = 30000;

function labelFor(pathname) {
  if (pathname.startsWith('/app/project/')) return 'In a project';
  if (pathname === '/app') return 'Dashboard';
  if (pathname.startsWith('/profile')) return 'Account settings';
  if (pathname === '/ops') return 'Ops console';
  if (pathname.startsWith('/sift-beta/projects/')) return 'Screening';
  if (pathname.startsWith('/sift-beta')) return 'Screening dashboard';
  return 'PecanRev';
}

export function useGlobalPresence(user, pathname) {
  const locRef = useRef(pathname);
  locRef.current = pathname;
  useEffect(() => {
    if (!user) return undefined;
    const ping = () => {
      if (document.hidden) return;
      fetch('/api/presence/ping', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: labelFor(locRef.current) }),
      }).catch(() => { /* best-effort */ });
    };
    ping(); // immediately on mount + on every route change
    const t = setInterval(ping, PING_MS);
    return () => clearInterval(t);
  }, [user, pathname]);
}
