import { useState, useEffect } from "react";
import { getMe } from "./frontend/auth/authClient.js";
import { api } from "./frontend/api-client/apiClient.js";
import Login from "./frontend/pages/Login.jsx";
import Register from "./frontend/pages/Register.jsx";
import MetaLab from "../meta-lab-3-patched.jsx";

// Auth states
const AUTH_LOADING        = "loading";
const AUTH_UNAUTHENTICATED = "unauthenticated";
const AUTH_AUTHENTICATED   = "authenticated";

export default function App() {
  const [authState, setAuthState]       = useState(AUTH_LOADING);
  const [user, setUser]                 = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [logoutHover, setLogoutHover]   = useState(false);

  // On mount, check whether a session cookie already exists
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((u) => {
        if (cancelled) return;
        if (u) {
          setUser(u);
          setAuthState(AUTH_AUTHENTICATED);
        } else {
          setAuthState(AUTH_UNAUTHENTICATED);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthState(AUTH_UNAUTHENTICATED);
      });
    return () => { cancelled = true; };
  }, []);

  function handleAuthSuccess(u) {
    setUser(u);
    setShowRegister(false);
    setAuthState(AUTH_AUTHENTICATED);
  }

  async function handleLogout() {
    try {
      await api.auth.logout();
    } catch {
      // ignore errors — clear session regardless
    }
    setUser(null);
    setShowRegister(false);
    setAuthState(AUTH_UNAUTHENTICATED);
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (authState === AUTH_LOADING) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0b0d13",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          color: "#536080",
          fontSize: 14,
          letterSpacing: "0.05em",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 32,
              color: "#818cf8",
              marginBottom: 16,
              userSelect: "none",
            }}
          >
            ⬡
          </div>
          <div>Loading…</div>
        </div>
        <style>{`
          @keyframes metaLabPulse {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.35; }
          }
        `}</style>
      </div>
    );
  }

  // ── Unauthenticated ────────────────────────────────────────────────────
  if (authState === AUTH_UNAUTHENTICATED) {
    if (showRegister) {
      return (
        <Register
          onSuccess={handleAuthSuccess}
          onBack={() => setShowRegister(false)}
        />
      );
    }
    return (
      <Login
        onSuccess={handleAuthSuccess}
        onRegister={() => setShowRegister(true)}
      />
    );
  }

  // ── Authenticated ──────────────────────────────────────────────────────
  return (
    <>
      <MetaLab />

      {/* Floating logout pill — rendered as an overlay, outside MetaLab */}
      <button
        type="button"
        onClick={handleLogout}
        onMouseEnter={() => setLogoutHover(true)}
        onMouseLeave={() => setLogoutHover(false)}
        title="Sign out"
        style={{
          position: "fixed",
          bottom: 20,
          left: 16,
          zIndex: 9999,
          background: logoutHover ? "rgba(31,38,64,0.92)" : "transparent",
          border: logoutHover ? "1px solid #283050" : "1px solid transparent",
          borderRadius: 20,
          padding: "5px 12px",
          color: logoutHover ? "#9ba6c4" : "#536080",
          fontSize: 12,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
          backdropFilter: logoutHover ? "blur(8px)" : "none",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 13 }}>⎋</span>
        <span>Sign out</span>
        {user && (user.name || user.email) && (
          <span
            style={{
              color: logoutHover ? "#536080" : "#374060",
              fontSize: 11,
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.name || user.email}
          </span>
        )}
      </button>
    </>
  );
}
