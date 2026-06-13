/**
 * ResetPassword.jsx — public password-reset page (prompt14 Task 4) at /reset.
 *
 * Two modes, one page:
 *   /reset               → REQUEST mode: enter email → POST /auth/forgot-password
 *                          (always a generic "if an account exists…" response —
 *                          no account enumeration).
 *   /reset?token=<t>     → SET mode: choose a new password → POST /auth/reset-password
 *                          (consumes the single-use token).
 *
 * Deliberately mounted UNWRAPPED in App.jsx (like /invite/:token): the link must
 * work whether the visitor is signed in or out. Matches the Login/Invite design
 * tokens so it feels native.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/icons.jsx';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { api } from '../api-client/apiClient.js';

const inputStyle = {
  width: '100%', padding: '10px 14px', background: C.surf,
  border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt,
  fontSize: 14, fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
};
const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, color: C.txt2,
  marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase',
};
const btnBase = {
  width: '100%', padding: '11px 0', borderRadius: 8, fontSize: 14,
  fontWeight: 600, fontFamily: FONT, cursor: 'pointer', letterSpacing: '0.02em',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
};

function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontFamily: FONT, padding: '24px 16px',
    }}>
      <div style={{
        width: '100%', maxWidth: 440, background: C.card, border: `1px solid ${C.brd}`,
        borderRadius: 16, padding: '36px 32px 32px', boxShadow: `0 24px 64px ${C.shadow}`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: C.acc, lineHeight: 1, marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
            <Icon name="hexagon" size={34} strokeWidth={1.4} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.txt, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            META<span style={{ color: C.acc, fontFamily: MONO, fontWeight: 400 }}>·</span>LAB
          </div>
        </div>
        <div style={{ height: 1, background: C.brd, marginBottom: 24 }} />
        {children}
      </div>
    </div>
  );
}

function Notice({ tone = 'error', children }) {
  const col = tone === 'success' ? C.grn : C.red;
  const bg = tone === 'success' ? C.grnBg : C.redBg;
  return (
    <div style={{
      marginBottom: 16, padding: '10px 14px', background: bg,
      border: `1px solid ${alpha(col, 0.35)}`, borderRadius: 8,
      color: col, fontSize: 13, lineHeight: 1.5,
    }}>{children}</div>
  );
}

function PrimaryBtn({ loading, children, ...rest }) {
  return (
    <button type="submit" disabled={loading} {...rest}
      style={{
        ...btnBase, background: loading ? C.brd2 : C.acc, border: 'none',
        color: loading ? C.muted : C.accText, opacity: loading ? 0.7 : 1,
        cursor: loading ? 'not-allowed' : 'pointer',
      }}>
      {children}
    </button>
  );
}

function GhostBtn({ children, ...rest }) {
  return (
    <button type="button" {...rest}
      style={{ ...btnBase, marginTop: 10, background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2 }}>
      {children}
    </button>
  );
}

/* ── Request mode: ask for the email ───────────────────────────────── */
function RequestForm({ onBackToLogin }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      await api.auth.forgotPassword(email.trim());
      setDone(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: C.grn, display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <Icon name="mail" size={26} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Check your email</div>
        <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55, marginBottom: 20 }}>
          If an account exists for <span style={{ fontFamily: MONO, color: C.txt }}>{email.trim()}</span>, a
          password reset link is on its way. The link expires for your security — use it soon.
        </div>
        <GhostBtn onClick={onBackToLogin}>Back to sign in</GhostBtn>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 6, textAlign: 'center' }}>
        Reset your password
      </div>
      <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55, marginBottom: 22, textAlign: 'center' }}>
        Enter your account email and we'll send you a link to choose a new password.
      </div>
      {error && <Notice>{error}</Notice>}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle} htmlFor="reset-email">Email</label>
        <input id="reset-email" type="email" autoComplete="email" required value={email}
          onChange={e => setEmail(e.target.value)} placeholder="you@institution.edu" style={inputStyle} />
      </div>
      <PrimaryBtn loading={loading}>{loading ? 'Sending…' : 'Send reset link'}</PrimaryBtn>
      <GhostBtn onClick={onBackToLogin}>Back to sign in</GhostBtn>
    </form>
  );
}

/* ── Set mode: choose a new password ───────────────────────────────── */
function SetForm({ token, onBackToLogin, onRequestNew }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);

  async function submit(e) {
    e.preventDefault();
    // Once the token is known-dead, Enter must not re-fire a doomed request —
    // route the user to request a fresh link instead.
    if (expired) { onRequestNew(); return; }
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      const msg = err.message || 'Could not reset your password. Please try again.';
      if (/expired|invalid|already/i.test(msg)) setExpired(true);
      setError(msg);
    } finally { setLoading(false); }
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: C.grn, display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <Icon name="check" size={26} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Password updated</div>
        <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55, marginBottom: 20 }}>
          Your password has been changed. You can now sign in with your new password.
        </div>
        <button type="button" onClick={onBackToLogin}
          style={{ ...btnBase, background: C.acc, border: 'none', color: C.accText }}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 6, textAlign: 'center' }}>
        Choose a new password
      </div>
      <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55, marginBottom: 22, textAlign: 'center' }}>
        Pick a strong password you don't use anywhere else.
      </div>
      {error && <Notice>{error}</Notice>}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="reset-pw">New password</label>
        <input id="reset-pw" type="password" autoComplete="new-password" required value={password}
          onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 22 }}>
        <label style={labelStyle} htmlFor="reset-pw2">Confirm password</label>
        <input id="reset-pw2" type="password" autoComplete="new-password" required value={confirm}
          onChange={e => setConfirm(e.target.value)} placeholder="Re-enter your new password" style={inputStyle} />
      </div>
      {expired
        ? <GhostBtn onClick={onRequestNew}>Request a new link</GhostBtn>
        : <PrimaryBtn loading={loading}>{loading ? 'Updating…' : 'Reset password'}</PrimaryBtn>}
      <GhostBtn onClick={onBackToLogin}>Back to sign in</GhostBtn>
    </form>
  );
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const toLogin = () => navigate('/login');
  const toRequest = () => navigate('/reset');

  return (
    <Shell>
      {token
        ? <SetForm token={token} onBackToLogin={toLogin} onRequestNew={toRequest} />
        : <RequestForm onBackToLogin={toLogin} />}
    </Shell>
  );
}
