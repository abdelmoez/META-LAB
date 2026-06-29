/**
 * VerifyEmail.jsx — public email-verification landing (prompt26).
 * Reads ?token=… , confirms it via /api/auth/verify-email, and shows the result.
 * Works signed-in or signed-out. Email verification is OFF by default, so this
 * page is only reached when an admin has enabled it.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, FONT, alpha } from '../theme/tokens.js';
import BrandWordmark from '../components/BrandWordmark.jsx';
import { verifyEmail, resendVerification } from '../auth/authClient.js';

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // verifying | ok | error
  const [message, setMessage] = useState('');
  const [resent, setResent] = useState(false);

  useEffect(() => {
    let token = '';
    try { token = new URLSearchParams(window.location.search).get('token') || ''; } catch { /* none */ }
    if (!token) { setStatus('error'); setMessage('This verification link is missing its token.'); return; }
    verifyEmail(token)
      .then(() => { setStatus('ok'); setMessage('Your email is verified. You can now sign in.'); })
      .catch(err => { setStatus('error'); setMessage(err.message || 'This verification link is invalid or has expired.'); });
  }, []);

  async function onResend() {
    const email = window.prompt('Enter your account email to receive a new verification link:');
    if (!email) return;
    try { await resendVerification(email.trim()); } catch { /* no-enumeration: ignore */ }
    setResent(true);
  }

  const tone = status === 'ok' ? C.grn : status === 'error' ? C.red : C.acc;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 440, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '40px', boxShadow: `0 24px 48px ${C.shadow}`, textAlign: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.txt, letterSpacing: '0.06em', marginBottom: 18 }}>
          <BrandWordmark size={24} weight={700} letterSpacing="0.06em" />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: tone, marginBottom: 10 }}>
          {status === 'verifying' ? 'Verifying your email…' : status === 'ok' ? 'Email verified' : 'Verification failed'}
        </div>
        <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.55, marginBottom: 24 }}>{message}</div>

        {status === 'ok' && (
          <button onClick={() => navigate('/login')} style={btn(C.acc, C.accText)}>Go to sign in</button>
        )}
        {status === 'error' && (
          <>
            <button onClick={onResend} disabled={resent} style={btn(C.acc, C.accText)}>
              {resent ? 'Link sent (check your inbox)' : 'Send a new link'}
            </button>
            <div style={{ marginTop: 14 }}>
              <a href="/login" style={{ color: C.acc, fontSize: 13, textDecoration: 'none' }}>Back to sign in</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function btn(bg, fg) {
  return { background: bg, color: fg, border: 'none', borderRadius: 9, padding: '11px 22px', fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: 'pointer', width: '100%' };
}
