import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMe, getPendingOnboarding } from '../auth/authClient.js';
import { api } from '../api-client/apiClient.js';
import { adoptServerTheme } from '../theme/tokens.js';
import { clearPdfBytesCache } from '../components/pdfBytesCache.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]                       = useState(null);
  const [loading, setLoading]                 = useState(true);
  // prompt32 — server-driven pending onboarding questions (empty = nothing to do)
  const [pendingOnboarding, setPendingOnboarding] = useState([]);

  // Fetch pending questions for the given user; never throws (defaults to []).
  const fetchPending = useCallback(async (u) => {
    if (!u) { setPendingOnboarding([]); return; }
    try {
      const { questions } = await getPendingOnboarding();
      setPendingOnboarding(questions || []);
    } catch {
      setPendingOnboarding([]);
    }
  }, []);

  // Check existing session on mount
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then(u => {
        if (!cancelled) {
          setUser(u);
          setLoading(false);
          if (u) adoptServerTheme(u.themePreference); // cross-device theme bootstrap
          fetchPending(u);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Called after a successful login or register
  const login = useCallback(u => {
    setUser(u);
    if (u) adoptServerTheme(u.themePreference);
    fetchPending(u);
  }, [fetchPending]);

  // Clears session cookie + local state
  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* ignore */ }
    // 116.md §95 — the session PDF byte cache is memory-only and dies with the tab, but
    // signing out must not leave one user's document bytes reachable to the next person
    // at this browser if the SPA is not reloaded. Explicit beats implicit here.
    try { clearPdfBytesCache(); } catch { /* best-effort */ }
    setUser(null);
    setPendingOnboarding([]);
  }, []);

  // Re-fetch the current user from the server
  const refreshUser = useCallback(async () => {
    const u = await getMe();
    setUser(u);
    return u;
  }, []);

  // prompt32 — re-fetch pending questions (call after submit/skip in Onboarding)
  const refreshPendingOnboarding = useCallback(async () => {
    await fetchPending(user);
  }, [fetchPending, user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, setUser, pendingOnboarding, refreshPendingOnboarding }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

/**
 * 117.md §22 (r2) — same context, but absence is an answer rather than a crash.
 * For hooks that RECORD an actor when one is signed in (audit entries, snapshot
 * authors) and must still work in SSR tests and shells without the provider.
 */
export function useOptionalAuth() {
  return useContext(AuthContext) || null;
}
