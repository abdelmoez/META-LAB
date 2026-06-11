import { useAuth } from '../context/AuthContext.jsx';
import { C, FONT } from '../theme/tokens.js';

/** Roles allowed into the ops console. The console itself renders a limited
 *  view for 'mod' (see AdminConsole role-based sections). */
const STAFF_ROLES = ['admin', 'mod'];

/**
 * AdminRoute — renders children only when the authenticated user has a staff
 * role ('admin' or 'mod'). The server already allowed mods (requireAdminOrMod);
 * this guard previously hard-checked role !== 'admin', which 404'd mods (prompt6 Task 14).
 *
 * Security note: this is a frontend convenience check only.
 * Every /api/admin/* endpoint enforces the required role independently on the server.
 *
 * Non-staff users (including unauthenticated visitors) see a generic 404 page so
 * the route's existence is not revealed through an "Access Denied" message.
 * This 404 cloak is deliberate existence-hiding — do not replace it with a 403 page.
 */
export default function AdminRoute({ children }) {
  const { user, loading } = useAuth();

  // Suppress render during initial auth check to avoid flash
  if (loading) return null;

  // Show generic 404 to everyone who isn't staff — don't reveal route exists
  if (!user || !STAFF_ROLES.includes(user.role)) return <GenericNotFound />;

  return children;
}

function GenericNotFound() {
  return (
    <div
      style={{
        minHeight:   '100vh',
        background:  C.bg,
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'center',
        fontFamily:  FONT,
        color:       C.muted,
        userSelect:  'none',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 72, fontWeight: 800, color: C.dim, letterSpacing: -2, lineHeight: 1 }}>
          404
        </div>
        <div style={{ marginTop: 16, fontSize: 14, color: C.muted }}>Page not found</div>
      </div>
    </div>
  );
}
