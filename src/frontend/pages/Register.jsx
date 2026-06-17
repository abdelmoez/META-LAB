import { useState } from "react";
import { motion } from "framer-motion";
import { register } from "../auth/authClient.js";
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

/* ── Required-field marker (prompt29 Part 12) ───────────────────────────── */
function RequiredStar() {
  // Red asterisk + a screen-reader-only "(required)" so the requirement is
  // conveyed accessibly, not by colour alone.
  return (
    <span aria-hidden="true" style={{ color: C.red, marginLeft: 3, fontWeight: 700 }}>*</span>
  );
}

/* ── Field component (focus-ring managed locally) ───────────────────────── */
function Field({ id, label, type = "text", value, onChange, placeholder, autoComplete, required = false }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelBase} htmlFor={id}>
        {label}{required && <RequiredStar />}
        {required && <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}> (required)</span>}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        required={required}
        aria-required={required || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...inputBase,
          borderColor: focused ? C.acc : C.brd2,
          boxShadow: focused ? `0 0 0 3px ${alpha(C.acc, 0.12)}` : "none",
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

// Pragmatic email format check (shared regex decision, prompt9 Task 2).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Full-page registration form.
 * Props:
 *   onSuccess(user, redirectTo?) — called on successful registration; the
 *     optional second argument overrides the default /app destination
 *     (used by the invite flow to land directly in the joined project)
 *   onBack()        — called when user clicks "Sign in"
 *
 * Invite handoff (prompt9 Task 2): /register?invite=<token> passes the token
 * through authClient.register, then AUTO-ACCEPTS (POST /api/invites/:token/
 * accept — idempotent, so it is safe even when the server already claimed the
 * invite during registration) and redirects straight into the project; on
 * accept failure it falls back to /invite/<token> where the now-signed-in
 * user gets the one-click accept with a readable error.
 */
export default function Register({ onSuccess, onBack }) {
  const [name, setName]               = useState("");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [error, setError]             = useState(null);
  const [loading, setLoading]         = useState(false);
  // Read once on mount — the page is reached via /register?invite=<token>.
  const [terms, setTerms] = useState(false);
  const [inviteToken] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("invite") || ""; }
    catch { return ""; }
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address (e.g. you@institution.edu).");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!terms) {
      setError("Please agree to the Terms and Privacy Policy to continue.");
      return;
    }

    setLoading(true);
    try {
      const data = await register(
        email.trim(),
        password,
        name.trim() || undefined,
        inviteToken || undefined,
        terms
      );
      const user = data && data.user ? data.user : data;

      // Invite auto-accept: fewer clicks — land directly in the project.
      let redirectTo = null;
      if (inviteToken) {
        redirectTo = `/invite/${encodeURIComponent(inviteToken)}`; // fallback
        try {
          const res = await fetch(`/api/invites/${encodeURIComponent(inviteToken)}/accept`, {
            method: "POST",
            credentials: "include",
          });
          const body = await res.json().catch(() => null);
          if (res.ok && body && body.projectId) {
            redirectTo = `/sift-beta/projects/${body.projectId}`;
          }
        } catch { /* fall back to the invite page */ }
      } else if (data && data.requireEmailVerification) {
        // prompt29 Part 13 — when email verification is ON, send the new user to
        // the verification page first. When it is OFF (default), redirectTo stays
        // null and RegisterRoute lands them on the skippable /onboarding page.
        redirectTo = "/verify-email";
      }
      onSuccess(user, redirectTo || undefined);
    } catch (err) {
      setError(err.message || "Registration failed. Please try again.");
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
          <div style={{ fontSize: 18, fontWeight: 600, color: C.txt, marginTop: 10, lineHeight: 1.3 }}>
            Create your research workspace
          </div>
          <div style={{ fontSize: 13.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Start screening, extracting, analyzing, and exporting evidence from one clean workspace.
          </div>
        </div>

        {/* Divider ───────────────────────────────────────────────────────── */}
        <div style={{ height: 1, background: C.brd, margin: "28px 0" }} />

        {/* Invite handoff notice ─────────────────────────────────────────── */}
        {inviteToken && (
          <div
            style={{
              marginBottom: 20,
              padding: "11px 14px",
              background: C.accBg,
              border: `1px solid ${alpha(C.acc, 0.3)}`,
              borderRadius: 10,
              color: C.txt2,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            You're accepting a project invite — create your account to join the
            project automatically.
          </div>
        )}

        {/* Form ──────────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} noValidate>
          <Field
            id="reg-name"
            label="Full name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dr. Jane Smith"
            required
          />

          <Field
            id="reg-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@institution.edu"
            required
          />

          <Field
            id="reg-password"
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
          />

          <Field
            id="reg-confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
            required
          />

          {/* Terms & Privacy agreement (prompt26; links added prompt29 Part 11) */}
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "2px 0 18px", cursor: "pointer", fontSize: 13, color: C.txt2, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              required
              aria-required="true"
              style={{ marginTop: 2, width: 16, height: 16, accentColor: C.acc, flexShrink: 0, cursor: "pointer" }}
            />
            <span>
              I agree to the{" "}
              <a href="/terms#terms" target="_blank" rel="noopener noreferrer" style={{ color: C.acc, fontWeight: 600 }}>Terms</a>
              {" "}and{" "}
              <a href="/terms#privacy" target="_blank" rel="noopener noreferrer" style={{ color: C.acc, fontWeight: 600 }}>Privacy Policy</a>.
              <RequiredStar />
            </span>
          </label>

          {error && (
            <div
              style={{
                marginBottom: 16,
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

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={loading ? {} : { scale: 1.02 }}
            whileTap={loading   ? {} : { scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            style={{
              width: "100%",
              padding: "12px 0",
              marginTop: 4,
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
          >
            {loading ? "Creating account…" : "Create account"}
          </motion.button>
        </form>

        {/* Sign-in link ──────────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: 13.5,
            color: C.muted,
          }}
        >
          Already have an account?{" "}
          <button
            type="button"
            onClick={onBack}
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
            Sign in
          </button>
        </div>
      </motion.div>
    </div>
  );
}
