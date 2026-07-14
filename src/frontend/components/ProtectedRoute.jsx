import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { C, FONT } from '../theme/tokens.js';

function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FONT,
      color: C.muted,
      fontSize: 14,
      letterSpacing: '0.05em',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, color: C.acc, marginBottom: 16, userSelect: 'none' }}>⬡</div>
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

/**
 * Renders children only when the user is authenticated.
 * Redirects to /login while unauthenticated; shows a loading screen
 * while the initial auth check is in flight.
 */
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  // 86.md P2.24 — preserve the intended destination so a deep link (a project,
  // a specific tab) survives the login bounce instead of always dumping the user
  // on the dashboard. The login page reads location.state.from after auth.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}
