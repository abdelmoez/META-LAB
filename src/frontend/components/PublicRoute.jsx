import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Renders children only when the user is NOT authenticated.
 * Redirects authenticated users to /app.
 * Renders nothing (null) while the initial auth check is in flight
 * to avoid a flash of the login page before auth resolves.
 */
export default function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user)    return <Navigate to="/app" replace />;
  return children;
}
