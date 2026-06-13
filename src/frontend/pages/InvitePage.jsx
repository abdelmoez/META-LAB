/**
 * InvitePage.jsx — public invite landing page at /invite/:token (prompt9 Task 2).
 *
 * Deliberately wrapped in NEITHER PublicRoute NOR ProtectedRoute: the page must
 * work signed-in AND signed-out (PublicRoute would bounce signed-in invitees to
 * /app and strand them — see map-invites.md §4.6).
 *
 * Server contract (Wave B1):
 *   GET  /api/invites/:token         → 200 { projectName, inviterName, roleLabel,
 *                                            email, expiresAt }
 *                                    | 404 { error } (invalid/revoked/used)
 *                                    | 410 { error } (expired)
 *   POST /api/invites/:token/accept  → auth required; 200 { projectId, projectName }
 *
 * UX decision (noted for the report): the post-login return path is handled by
 * this page accepting signed-in users — after signing in (or re-clicking the
 * email link while signed in) the user lands here and gets one-click accept.
 * Login.jsx itself is untouched; App.jsx's LoginRoute forwards ?invite= back
 * to /invite/<token> after a successful sign-in.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Icon } from '../components/icons.jsx';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

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
        {/* Wordmark — matches Login/Register */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: C.acc, lineHeight: 1, marginBottom: 12, userSelect: 'none', display: 'flex', justifyContent: 'center' }}>
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

function StateCard({ icon, title, body, children }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: C.muted, display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <Icon name={icon} size={26} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55, marginBottom: 20 }}>{body}</div>
      {children}
    </div>
  );
}

export default function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState('loading'); // loading | invalid | expired | error | valid
  const [info, setInfo] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (res.ok) { setInfo(body || {}); setStatus('valid'); }
      else if (res.status === 410) setStatus('expired');
      else if (res.status === 404) setStatus('invalid');
      else setStatus('error');
    } catch { setStatus('error'); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const accept = useCallback(async () => {
    setAccepting(true); setAcceptError(null);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST', credentials: 'include',
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.projectId) { navigate(`/sift-beta/projects/${body.projectId}`); return; }
      if (res.status === 410) setAcceptError('This invite has expired — ask your inviter to send a new one.');
      else if (res.status === 404) setAcceptError('This invite link is no longer valid — ask your inviter to send a new one.');
      else setAcceptError((body && body.error) || 'Could not accept the invite. Please try again.');
    } catch {
      setAcceptError('Could not reach the server. Please check your connection and try again.');
    } finally { setAccepting(false); }
  }, [token, navigate]);

  /* ── Non-valid states ─────────────────────────────────────────────── */
  if (status === 'loading' || (status === 'valid' && authLoading)) {
    return (
      <Shell>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%', display: 'inline-block',
            border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
            animation: 'invite-spin 0.7s linear infinite',
          }} />
          <style>{`@keyframes invite-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Shell>
    );
  }
  if (status === 'invalid') {
    return (
      <Shell>
        <StateCard icon="alert" title="This invite link isn't valid"
          body="The link may have been revoked, already used, or mistyped. Ask your inviter to send a new invite.">
          <button type="button" onClick={() => navigate('/')}
            style={{ ...btnBase, background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2 }}>
            Go to META·LAB
          </button>
        </StateCard>
      </Shell>
    );
  }
  if (status === 'expired') {
    return (
      <Shell>
        <StateCard icon="clock" title="This invite has expired"
          body="Invite links are only valid for a limited time — ask your inviter to send a new invite.">
          <button type="button" onClick={() => navigate('/')}
            style={{ ...btnBase, background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2 }}>
            Go to META·LAB
          </button>
        </StateCard>
      </Shell>
    );
  }
  if (status === 'error') {
    return (
      <Shell>
        <StateCard icon="alert" title="Couldn't load this invite"
          body="Something went wrong while checking the invite link. Please try again.">
          <button type="button" onClick={load}
            style={{ ...btnBase, background: C.acc, border: 'none', color: C.accText }}>
            Retry
          </button>
        </StateCard>
      </Shell>
    );
  }

  /* ── Valid invite ─────────────────────────────────────────────────── */
  const { projectName, inviterName, roleLabel, email, expiresAt } = info || {};
  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO }}>
          Project invitation
        </div>
        <div className="t-wrap" style={{ fontSize: 18, fontWeight: 700, color: C.txt, lineHeight: 1.35, marginBottom: 8 }}>
          {projectName || 'A research project'}
        </div>
        <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55 }}>
          {inviterName ? <><strong style={{ color: C.txt }}>{inviterName}</strong> invited you</> : 'You have been invited'}
          {roleLabel ? <> to join as <strong style={{ color: C.txt }}>{roleLabel}</strong></> : ' to join'}.
        </div>
        {(email || expiresAt) && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
            {email && <div>Invited email: <span style={{ fontFamily: MONO }}>{email}</span></div>}
            {expiresAt && <div>Valid until {fmtDate(expiresAt)}</div>}
          </div>
        )}
      </div>

      {acceptError && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', background: C.redBg,
          border: `1px solid ${alpha(C.red, 0.35)}`, borderRadius: 8,
          color: C.red, fontSize: 13, lineHeight: 1.5,
        }}>{acceptError}</div>
      )}

      {user ? (
        <>
          <button type="button" onClick={accept} disabled={accepting}
            style={{
              ...btnBase, background: accepting ? C.brd2 : C.acc, border: 'none',
              color: accepting ? C.muted : C.accText, opacity: accepting ? 0.7 : 1,
              cursor: accepting ? 'not-allowed' : 'pointer',
            }}>
            {accepting ? 'Accepting…' : 'Accept invite & open project'}
          </button>
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: C.muted }}>
            Signed in as <span style={{ fontFamily: MONO }}>{user.email}</span>
          </div>
        </>
      ) : (
        <>
          <button type="button"
            onClick={() => navigate(`/register?invite=${encodeURIComponent(token)}`)}
            style={{ ...btnBase, background: C.acc, border: 'none', color: C.accText }}>
            Create account
          </button>
          <button type="button"
            onClick={() => navigate(`/login?invite=${encodeURIComponent(token)}`)}
            style={{ ...btnBase, marginTop: 10, background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2 }}>
            Sign in
          </button>
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
            Create your account with the invited email to join automatically.
          </div>
        </>
      )}
    </Shell>
  );
}
