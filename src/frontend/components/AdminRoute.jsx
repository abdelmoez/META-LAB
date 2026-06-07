import { useAuth } from '../context/AuthContext.jsx';

/**
 * AdminRoute — renders children only when the authenticated user has role === 'admin'.
 *
 * Security note: this is a frontend convenience check only.
 * Every /api/admin/* endpoint enforces admin role independently on the server.
 *
 * Non-admins (including unauthenticated visitors) see a generic 404 page so
 * the route's existence is not revealed through an "Access Denied" message.
 */
export default function AdminRoute({ children }) {
  const { user, loading } = useAuth();

  // Suppress render during initial auth check to avoid flash
  if (loading) return null;

  // Show generic 404 to everyone who isn't an admin — don't reveal route exists
  if (!user || user.role !== 'admin') return <GenericNotFound />;

  return children;
}

function GenericNotFound() {
  return (
    <div
      style={{
        minHeight:   '100vh',
        background:  '#0b0d13',
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'center',
        fontFamily:  "'IBM Plex Sans', system-ui, sans-serif",
        color:       '#536080',
        userSelect:  'none',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 72, fontWeight: 800, color: '#1a2033', letterSpacing: -2, lineHeight: 1 }}>
          404
        </div>
        <div style={{ marginTop: 16, fontSize: 14, color: '#536080' }}>Page not found</div>
      </div>
    </div>
  );
}
