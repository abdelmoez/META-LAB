import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMe } from '../auth/authClient.js';
import { api } from '../api-client/apiClient.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Check existing session on mount
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then(u => { if (!cancelled) { setUser(u); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Called after a successful login or register
  const login = useCallback(u => setUser(u), []);

  // Clears session cookie + local state
  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* ignore */ }
    setUser(null);
  }, []);

  // Re-fetch the current user from the server
  const refreshUser = useCallback(async () => {
    const u = await getMe();
    setUser(u);
    return u;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
