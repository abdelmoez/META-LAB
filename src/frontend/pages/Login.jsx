import { useState } from "react";
import { login } from "../auth/authClient.js";

const C = {
  bg:    "#0b0d13",
  surf:  "#0f1220",
  card:  "#141826",
  card2: "#1a2033",
  brd:   "#1f2640",
  brd2:  "#283050",
  acc:   "#818cf8",
  acc2:  "#6366f1",
  grn:   "#34d399",
  red:   "#f87171",
  txt:   "#eaecf6",
  txt2:  "#9ba6c4",
  muted: "#536080",
};

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  background: "#0b0d13",
  border: `1px solid ${C.brd2}`,
  borderRadius: 8,
  color: C.txt,
  fontSize: 14,
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: C.txt2,
  marginBottom: 6,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

/**
 * Full-page login form.
 * Props:
 *   onSuccess(user) — called with the user object on successful login
 *   onRegister()    — called when user clicks "Register"
 */
export default function Login({ onSuccess, onRegister }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);

  const [emailFocus, setEmailFocus]       = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await login(email.trim(), password);
      const user = data && data.user ? data.user : data;
      onSuccess(user);
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: C.card,
          border: `1px solid ${C.brd}`,
          borderRadius: 16,
          padding: "40px 36px 36px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              fontSize: 36,
              color: C.acc,
              lineHeight: 1,
              marginBottom: 10,
              userSelect: "none",
            }}
          >
            ⬡
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: C.txt,
              letterSpacing: "0.04em",
            }}
          >
            META·LAB
          </div>
          <div
            style={{
              fontSize: 13,
              color: C.muted,
              marginTop: 6,
            }}
          >
            Systematic Review & Meta-Analysis
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: C.brd,
            marginBottom: 28,
          }}
        />

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle} htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setEmailFocus(true)}
              onBlur={() => setEmailFocus(false)}
              style={{
                ...inputStyle,
                borderColor: emailFocus ? C.acc : C.brd2,
                boxShadow: emailFocus ? `0 0 0 3px rgba(129,140,248,0.12)` : "none",
              }}
              placeholder="you@institution.edu"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle} htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPasswordFocus(true)}
              onBlur={() => setPasswordFocus(false)}
              style={{
                ...inputStyle,
                borderColor: passwordFocus ? C.acc : C.brd2,
                boxShadow: passwordFocus ? `0 0 0 3px rgba(129,140,248,0.12)` : "none",
              }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              style={{
                marginBottom: 18,
                padding: "10px 14px",
                background: "rgba(248,113,113,0.08)",
                border: `1px solid rgba(248,113,113,0.25)`,
                borderRadius: 8,
                color: C.red,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px 0",
              background: loading
                ? C.brd2
                : `linear-gradient(135deg, ${C.acc} 0%, ${C.acc2} 100%)`,
              border: "none",
              borderRadius: 8,
              color: loading ? C.muted : "#fff",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "opacity 0.15s, background 0.15s",
              letterSpacing: "0.02em",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Register link */}
        <div
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: 13,
            color: C.muted,
          }}
        >
          Don't have an account?{" "}
          <button
            type="button"
            onClick={onRegister}
            style={{
              background: "none",
              border: "none",
              color: C.acc,
              fontSize: 13,
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
              textDecorationColor: "transparent",
              transition: "text-decoration-color 0.15s",
            }}
            onMouseEnter={(e) => (e.target.style.textDecorationColor = C.acc)}
            onMouseLeave={(e) => (e.target.style.textDecorationColor = "transparent")}
          >
            Register
          </button>
        </div>
      </div>
    </div>
  );
}
