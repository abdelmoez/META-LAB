/**
 * NotFound.jsx — 65.md UX-7: proper 404 for unknown routes.
 *
 * Previously `*` silently bounced signed-in users to the marketing landing —
 * a mistyped or stale in-app link gave zero explanation. This page is
 * self-sufficient (inline styles, Stitch tone) so it renders correctly in
 * either design mode and before any scoped stylesheet mounts.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const S = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f6f7f9', color: '#1f2937', padding: 24,
    fontFamily: "'Manrope','Inter',system-ui,sans-serif",
  },
  card: { maxWidth: 440, width: '100%', textAlign: 'center' },
  code: { margin: 0, fontSize: 56, fontWeight: 800, letterSpacing: '-0.03em', color: '#5d509b' },
  title: { margin: '2px 0 10px', fontSize: 19, fontWeight: 700 },
  body: { margin: '0 0 22px', fontSize: 13.5, lineHeight: 1.65, color: '#4b5563' },
  btn: {
    display: 'inline-block', textDecoration: 'none', borderRadius: 9,
    padding: '10px 20px', fontSize: 13, fontWeight: 600, color: '#ffffff',
    background: '#5d509b',
  },
};

export default function NotFound() {
  const { user } = useAuth();
  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <p style={S.code} aria-hidden="true">404</p>
        <h1 style={S.title}>Page not found</h1>
        <p style={S.body}>
          The page you're looking for doesn't exist or may have moved.
          Check the link, or head back to your workspace.
        </p>
        {user
          ? <Link to="/app" style={S.btn}>Back to dashboard</Link>
          : <Link to="/" style={S.btn}>Go home</Link>}
      </div>
    </div>
  );
}
