import { useState } from "react";
import { motion } from "framer-motion";
import { login } from "../auth/authClient.js";
import { Icon } from "../components/icons.jsx";
import { C, FONT, MONO, alpha } from "../theme/tokens.js";

/* ── Shared input / label tokens ─────────────────────────────────────────── */
const inputBase = {
  width: "100%",
  padding: "11px 14px",
  background: C.surf,
  border: `1.5px solid ${C.brd2}`,
  borderRadius: 10,
  color: C.txt,
  fontSize: 15,
  fontFamily: FONT,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const labelBase = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: C.txt2,
  marginBottom: 6,
};

/* ── Card entrance animation ─────────────────────────────────────────────── */
const cardVariants = {
  hidden:  { opacity: 0, y: 18, scale: 0.98 },
  visible: { opacity: 1, y: 0,  scale: 1,
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

/* ── Primary button micro-interaction ───────────────────────────────────── */
const PrimaryBtn = ({ loading, children, ...rest }) => (
  <motion.button
    type="submit"
    disabled={loading}
    whileHover={loading ? {} : { scale: 1.02 }}
    whileTap={loading   ? {} : { scale: 0.98 }}
    transition={{ type: "spring", stiffness: 400, damping: 20 }}
    style={{
      width: "100%",
      padding: "12px 0",
      background: loading ? C.brd2 : C.acc,
      border: "none",
      borderRadius: 10,
      color: loading ? C.muted : C.accText,
      fontSize: 15,
      fontWeight: 600,
      fontFamily: FONT,
      cursor: loading ? "not-allowed" : "pointer",
      letterSpacing: "0.01em",
      opacity: loading ? 0.7 : 1,
      transition: "background 0.15s, opacity 0.15s",
    }}
    {...rest}
  >
    {children}
  </motion.button>
);

/**
 * Full-page login form.
 * Props:
 *   onSuccess(user) — called with the user object on successful login
 *   onRegister()    — called when user clicks "Register"
 *   onForgot()      — called when user clicks "Forgot password?" (optional)
 */
export default function Login({ onSuccess, onRegister, onForgot }) {
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
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        style={{
          width: "100%",
          maxWidth: 440,
          background: C.card,
          border: `1px solid ${C.brd}`,
          borderRadius: 14,
          padding: "44px 40px 40px",
          boxShadow: `0 4px 6px ${alpha(C.shadow, 0.4)}, 0 24px 48px ${C.shadow}`,
        }}
      >
        {/* Brand ─────────────────────────────────────────────────────────── */}
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div
            style={{
              color: C.acc,
              lineHeight: 1,
              marginBottom: 14,
              userSelect: "none",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Icon name="hexagon" size={40} strokeWidth={1.4} />
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: C.txt,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
              lineHeight: 1.1,
            }}
          >
            META<span style={{ color: C.acc, fontFamily: MONO, fontWeight: 400 }}>·</span>LAB
          </div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
            Sign in to your research workspace
          </div>
        </div>

        {/* Divider ───────────────────────────────────────────────────────── */}
        <div style={{ height: 1, background: C.brd, margin: "28px 0" }} />

        {/* Form ──────────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: 18 }}>
            <label style={labelBase} htmlFor="login-email">
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
                ...inputBase,
                borderColor: emailFocus ? C.acc : C.brd2,
                boxShadow: emailFocus ? `0 0 0 3px ${alpha(C.acc, 0.12)}` : "none",
              }}
              placeholder="you@institution.edu"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelBase} htmlFor="login-password">
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
                ...inputBase,
                borderColor: passwordFocus ? C.acc : C.brd2,
                boxShadow: passwordFocus ? `0 0 0 3px ${alpha(C.acc, 0.12)}` : "none",
              }}
              placeholder="••••••••"
            />
          </div>

          {onForgot && (
            <div style={{ textAlign: "right", marginBottom: 22 }}>
              <button
                type="button"
                onClick={onForgot}
                style={{
                  background: "none",
                  border: "none",
                  color: C.acc,
                  fontSize: 13,
                  fontFamily: FONT,
                  cursor: "pointer",
                  padding: "4px 0",
                  fontWeight: 500,
                }}
              >
                Forgot password?
              </button>
            </div>
          )}

          {!onForgot && <div style={{ marginBottom: 22 }} />}

          {error && (
            <div
              style={{
                marginBottom: 18,
                padding: "11px 14px",
                background: C.redBg,
                border: `1px solid ${alpha(C.red, 0.3)}`,
                borderRadius: 10,
                color: C.red,
                fontSize: 13.5,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <PrimaryBtn loading={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </PrimaryBtn>
        </form>

        {/* Register link ─────────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: 13.5,
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
              fontSize: 13.5,
              fontFamily: FONT,
              cursor: "pointer",
              padding: 0,
              fontWeight: 600,
            }}
          >
            Register
          </button>
        </div>
      </motion.div>
    </div>
  );
}
