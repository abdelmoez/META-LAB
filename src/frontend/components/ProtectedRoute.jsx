import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0b0d13',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      color: '#536080',
      fontSize: 14,
      letterSpacing: '0.05em',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, color: '#818cf8', marginBottom: 16, userSelect: 'none' }}>⬡</div>
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
  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" replace />;
  return children;
}
