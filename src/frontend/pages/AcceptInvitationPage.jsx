/**
 * AcceptInvitationPage.jsx — public waitlist → account activation page (80.md) at
 * /accept-invitation?token=<t>. Structurally mirrors ResetPassword.jsx (same Shell,
 * design tokens, and motion) and grafts a token-validation step onto the front:
 *
 *   1. On mount, GET /api/accept-invitation/:token to validate. While loading, a
 *      spinner; on a bad token, a specific non-sensitive message (expired / used /
 *      revoked / superseded / invalid) with a "Sign in" affordance where useful.
 *   2. On a valid token, show the create-password form (password + confirm,
 *      show/hide, Terms checkbox, autocomplete=new-password so password managers
 *      work). Validation runs on BOTH sides (shared validateInvitePassword).
 *   3. On success the server has already set the session cookie (auto-sign-in via
 *      the normal mechanism) — refresh the auth context and land in /app; the
 *      OnboardingGate then routes new users to /onboarding.
 *
 * Deliberately mounted UNWRAPPED in App.jsx (like /invite/:token and /reset): the
 * link must work whether the visitor is signed in or out (PublicRoute would bounce
 * a signed-in visitor to /app before they could accept).
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/icons.jsx';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import BrandWordmark from '../components/BrandWordmark.jsx';
import { api } from '../api-client/apiClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { validateInvitePassword, INVITE_PASSWORD_MIN } from '../../shared/waitlistInvitation.js';

/* ── Shared style tokens (mirrors ResetPassword.jsx) ─────────────────────── */
const inputBase = {
  width: '100%', padding: '11px 14px', background: C.surf,
  border: `1.5px solid ${C.brd2}`, borderRadius: 10, color: C.txt,
  fontSize: 15, fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};
const labelBase = { display: 'block', fontSize: 13, fontWeight: 600, color: C.txt2, marginBottom: 6 };
const btnBase = {
  width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 15,
  fontWeight: 600, fontFamily: FONT, letterSpacing: '0.01em',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
};

const cardVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <motion.div
        variants={cardVariants} initial="hidden" animate="visible"
        style={{
          width: '100%', maxWidth: 460, background: C.card,
          border: `1px solid ${C.brd}`, borderRadius: 14, padding: '44px 40px 40px',
          boxShadow: `0 4px 6px ${alpha(C.shadow, 0.4)}, 0 24px 48px ${C.shadow}`,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ color: C.acc, lineHeight: 1, marginBottom: 14, display: 'flex', justifyContent: 'center', userSelect: 'none' }}>
            <Icon name="hexagon" size={40} strokeWidth={1.4} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.txt, letterSpacing: '0.06em', whiteSpace: 'nowrap', lineHeight: 1.1 }}>
            <BrandWordmark size={26} weight={700} letterSpacing="0.06em" />
          </div>
        </div>
        <div style={{ height: 1, background: C.brd, margin: '28px 0' }} />
        {children}
      </motion.div>
    </div>
  );
}

function Notice({ tone = 'error', children }) {
  const col = tone === 'success' ? C.grn : C.red;
  const bg = tone === 'success' ? C.grnBg : C.redBg;
  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{ marginBottom: 16, padding: '11px 14px', background: bg, border: `1px solid ${alpha(col, 0.3)}`, borderRadius: 10, color: col, fontSize: 13.5, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function PrimaryBtn({ loading, children, ...rest }) {
  return (
    <motion.button
      type="submit" disabled={loading}
      whileHover={loading ? {} : { scale: 1.02 }} whileTap={loading ? {} : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      style={{ ...btnBase, background: loading ? C.brd2 : C.acc, border: 'none', color: loading ? C.muted : C.accText, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
      {...rest}
    >{children}</motion.button>
  );
}

function GhostBtn({ children, ...rest }) {
  return (
    <motion.button
      type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      style={{ ...btnBase, marginTop: 10, background: 'none', border: `1.5px solid ${C.brd2}`, color: C.txt2 }}
      {...rest}
    >{children}</motion.button>
  );
}

/* ── Password field with an accessible show/hide toggle ──────────────────── */
function PasswordField({ id, label, value, onChange, placeholder, show, onToggle, autoComplete }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelBase} htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} required
          value={value} onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          placeholder={placeholder}
          style={{ ...inputBase, paddingRight: 62, borderColor: focus ? C.acc : C.brd2, boxShadow: focus ? `0 0 0 3px ${alpha(C.acc, 0.12)}` : 'none' }}
        />
        <button
          type="button" onClick={onToggle}
          aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: 'pointer', padding: '4px 6px' }}
        >{show ? 'Hide' : 'Show'}</button>
      </div>
    </div>
  );
}

/* ── State screens ───────────────────────────────────────────────────────── */
function CenteredState({ icon, iconColor, title, body, primary, ghost }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: iconColor, display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        <Icon name={icon} size={28} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.txt, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, color: C.txt2, lineHeight: 1.6, marginBottom: 24 }}>{body}</div>
      {primary}
      {ghost}
    </div>
  );
}

/* ── Non-valid-token messages (Phase 8) ──────────────────────────────────── */
const INVALID_COPY = {
  invalid: { title: 'Invitation not found', body: 'This invitation link is invalid. Please check the link in your email, or contact the PecanRev team for a new invitation.' },
  expired: { title: 'Invitation expired', body: 'This invitation has expired. Please contact the PecanRev team for a new invitation.' },
  revoked: { title: 'Invitation revoked', body: 'This invitation is no longer valid. Please contact the PecanRev team if you think this is a mistake.' },
  accepted: { title: 'Already activated', body: 'This invitation has already been used. You can sign in to your account.', signIn: true },
  superseded: { title: 'Newer invitation issued', body: 'This invitation is no longer valid because a newer invitation was sent. Please use the most recent email.' },
  account_exists: { title: 'You already have an account', body: 'An account already exists for this email. Please sign in instead.', signIn: true },
  server_error: { title: 'Something went wrong', body: 'We could not load this invitation. Please try again in a moment.' },
};

export default function AcceptInvitationPage() {
  const navigate = useNavigate();
  const { refreshUser, refreshPendingOnboarding } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [phase, setPhase] = useState('loading'); // loading | valid | invalid | done
  const [invalidCode, setInvalidCode] = useState('invalid');
  const [invite, setInvite] = useState(null); // { email(masked), name, expiresAt }

  // form state
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) { setInvalidCode('invalid'); setPhase('invalid'); return; }
    (async () => {
      try {
        const res = await api.invitations.get(token);
        if (cancelled) return;
        setInvite(res);
        setName(res.name || '');
        setPhase('valid');
      } catch (err) {
        if (cancelled) return;
        const code = err?.body?.code || 'invalid';
        setInvalidCode(INVALID_COPY[code] ? code : 'invalid');
        setPhase('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const check = validateInvitePassword(password, confirm);
    if (!check.ok) { setError(check.error); return; }
    if (!agree) { setError('Please accept the Terms and Privacy Policy to continue.'); return; }
    setSubmitting(true);
    try {
      await api.invitations.accept(token, { password, name: name.trim(), acceptedTerms: true });
      // Server set the session cookie — hydrate the auth context, then land in-app.
      try { await refreshUser(); } catch { /* non-fatal */ }
      try { await refreshPendingOnboarding?.(); } catch { /* non-fatal */ }
      setPhase('done');
      // Brief success frame, then into the app (OnboardingGate routes new users).
      setTimeout(() => navigate('/app', { replace: true }), 900);
    } catch (err) {
      const code = err?.body?.code;
      // A terminal token state (expired/used/revoked/superseded) → switch to the
      // message screen. validation + server_error are RETRYABLE, so keep the form
      // and show an inline error instead of dead-ending.
      if (code && INVALID_COPY[code] && !['validation', 'server_error'].includes(code)) {
        setInvalidCode(code);
        setPhase('invalid');
      } else {
        const raw = err?.message || '';
        setError(!raw || /internal server error/i.test(raw)
          ? 'Something went wrong activating your account. Please try again.'
          : raw);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{ display: 'inline-block', width: 22, height: 22, border: `2.5px solid ${alpha(C.acc, 0.25)}`, borderTopColor: C.acc, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
          <div style={{ marginTop: 14, fontSize: 14, color: C.txt2 }}>Checking your invitation…</div>
        </div>
      </Shell>
    );
  }

  if (phase === 'invalid') {
    const copy = INVALID_COPY[invalidCode] || INVALID_COPY.invalid;
    return (
      <Shell>
        <CenteredState
          icon="alert" iconColor={C.red} title={copy.title} body={copy.body}
          primary={copy.signIn ? (
            <motion.button type="button" onClick={() => navigate('/login')} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }} style={{ ...btnBase, background: C.acc, border: 'none', color: C.accText }}>Sign in</motion.button>
          ) : null}
          ghost={<GhostBtn onClick={() => navigate('/')}>Back to home</GhostBtn>}
        />
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <CenteredState icon="check" iconColor={C.grn} title="Account activated" body="Welcome to PecanRev! Taking you to your workspace…" />
      </Shell>
    );
  }

  // phase === 'valid'
  return (
    <Shell>
      <form onSubmit={submit} noValidate>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.txt, marginBottom: 6, textAlign: 'center' }}>Create your account</div>
        <div style={{ fontSize: 14, color: C.txt2, lineHeight: 1.6, marginBottom: 20, textAlign: 'center' }}>
          You've been invited to PecanRev{invite?.email ? <> for <span style={{ fontFamily: MONO, color: C.txt }}>{invite.email}</span></> : ''}. Set a password to activate your workspace.
        </div>
        {error && <Notice>{error}</Notice>}

        <div style={{ marginBottom: 16 }}>
          <label style={labelBase} htmlFor="inv-name">Your name <span style={{ color: C.muted, fontWeight: 400 }}>(optional)</span></label>
          <input
            id="inv-name" type="text" autoComplete="name" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Jane Researcher"
            style={inputBase}
          />
        </div>

        <PasswordField id="inv-pw" label="Password" value={password} onChange={setPassword} placeholder={`At least ${INVITE_PASSWORD_MIN} characters`} show={showPw} onToggle={() => setShowPw((s) => !s)} autoComplete="new-password" />
        <PasswordField id="inv-pw2" label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Re-enter your password" show={showPw} onToggle={() => setShowPw((s) => !s)} autoComplete="new-password" />

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '4px 0 22px', fontSize: 13, color: C.txt2, lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2, accentColor: C.acc, width: 16, height: 16, flexShrink: 0 }} />
          <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: C.acc, textDecoration: 'none' }}>Terms</a> and <a href="/terms#privacy" target="_blank" rel="noreferrer" style={{ color: C.acc, textDecoration: 'none' }}>Privacy Policy</a>.</span>
        </label>

        <PrimaryBtn loading={submitting}>{submitting ? 'Activating…' : 'Create account'}</PrimaryBtn>
        <GhostBtn onClick={() => navigate('/login')}>Already activated? Sign in</GhostBtn>
      </form>
    </Shell>
  );
}
