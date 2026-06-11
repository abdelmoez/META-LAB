import { useState } from "react";
import { login } from "../auth/authClient.js";
import { Icon } from "../components/icons.jsx";
// Theme-aware tokens (prompt7) — C values are `var(--t-*)` strings; use
// alpha(C.x, '40') instead of hex+alpha concatenation.
import { C, FONT, MONO, alpha } from "../theme/tokens.js";

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  background: C.surf,
  border: `1px solid ${C.brd2}`,
  borderRadius: 8,
  color: C.txt,
  fontSize: 14,
  fontFamily: FONT,
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
        fontFamily: FONT,
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
          boxShadow: `0 24px 64px ${C.shadow}`,
        }}
      >
        {/* Wordmark — matches the Landing navbar logo (hex mark + MONO middot) */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              color: C.acc,
              lineHeight: 1,
              marginBottom: 12,
              userSelect: "none",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Icon name="hexagon" size={36} strokeWidth={1.4} />
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: C.txt,
              letterSpacing: "0.08em",
              whiteSpace: "nowrap",
            }}
          >
            META<span style={{ color: C.acc, fontFamily: MONO, fontWeight: 400 }}>·</span>LAB
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
                boxShadow: emailFocus ? `0 0 0 3px ${alpha(C.acc, 0.12)}` : "none",
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
                boxShadow: passwordFocus ? `0 0 0 3px ${alpha(C.acc, 0.12)}` : "none",
              }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              style={{
                marginBottom: 18,
                padding: "10px 14px",
                background: C.redBg,
                border: `1px solid ${alpha(C.red, 0.35)}`,
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
              background: loading ? C.brd2 : C.acc,
              border: "none",
              borderRadius: 8,
              color: loading ? C.muted : C.accText,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: FONT,
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
              fontFamily: FONT,
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
