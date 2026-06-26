/**
 * useSidebarPin.js — the ONE source of truth for the project sidebar pin
 * preference (56.md §6).
 *
 * Default: collapsed (no saved preference). The server-backed boolean
 * `user.projectSidebarPinned` is canonical (cross-device, survives logout/login);
 * a localStorage mirror keeps the choice across a refresh before getMe resolves and
 * synchronizes the state across tabs. Toggling is OPTIMISTIC and persists via
 * `PUT /api/profile` (api.profile.update); a failed write reverts so the UI never
 * lies about the saved preference.
 */
import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api-client/apiClient.js';

const LS_KEY = 'pecanrev.projectSidebarPinned';

function readLocal() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}
function writeLocal(v) {
  try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* private mode / disabled storage */ }
}

export function useSidebarPin() {
  const { user, setUser } = useAuth();
  const serverPinned = !!(user && user.projectSidebarPinned);

  // Before getMe resolves, fall back to the local mirror so a pinned rail does not
  // flash collapsed on reload.
  const [pinned, setPinned] = useState(() => (user ? serverPinned : readLocal()));

  // The server preference is canonical: re-sync whenever the auth user changes
  // (login, refreshUser, role change). Only react to a loaded user.
  useEffect(() => {
    if (user) { setPinned(serverPinned); writeLocal(serverPinned); }
  }, [user, serverPinned]);

  // Cross-tab synchronization (another tab toggled the pin).
  useEffect(() => {
    const onStorage = (e) => { if (e.key === LS_KEY && e.newValue != null) setPinned(e.newValue === '1'); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const togglePin = useCallback(async () => {
    const next = !pinned;
    setPinned(next);          // optimistic
    writeLocal(next);
    try {
      await api.profile.update({ projectSidebarPinned: next });
      if (setUser) setUser((u) => (u ? { ...u, projectSidebarPinned: next } : u));
    } catch {
      setPinned(!next);       // revert — never claim a preference we failed to save
      writeLocal(!next);
    }
  }, [pinned, setUser]);

  return { pinned, togglePin };
}
