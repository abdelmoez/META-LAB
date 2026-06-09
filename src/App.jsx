import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './frontend/context/AuthContext.jsx';
import ProtectedRoute from './frontend/components/ProtectedRoute.jsx';
import PublicRoute    from './frontend/components/PublicRoute.jsx';
import AdminRoute     from './frontend/components/AdminRoute.jsx';
import AppWorkspace   from './frontend/pages/AppWorkspace.jsx';
import LoginPage      from './frontend/pages/Login.jsx';
import RegisterPage   from './frontend/pages/Register.jsx';
import Landing        from './frontend/pages/Landing.jsx';
import Profile        from './frontend/pages/Profile.jsx';
import AdminConsole   from './frontend/pages/admin/AdminConsole.jsx';
import SiftDashboard  from './frontend/screening/pages/SiftDashboard.jsx';
import SiftProject    from './frontend/screening/pages/SiftProject.jsx';
import SiftImport     from './frontend/screening/pages/SiftImport.jsx';

// ── Route adapters ──────────────────────────────────────────────────────
// Login and Register were originally prop-driven (onSuccess, onRegister, onBack).
// These thin wrappers bridge that interface to React Router navigation so the
// original page components don't need to change.

function LoginRoute() {
  const navigate = useNavigate();
  const { login } = useAuth();
  return (
    <LoginPage
      onSuccess={u => { login(u); navigate('/app'); }}
      onRegister={() => navigate('/register')}
    />
  );
}

function RegisterRoute() {
  const navigate = useNavigate();
  const { login } = useAuth();
  return (
    <RegisterPage
      onSuccess={u => { login(u); navigate('/app'); }}
      onBack={() => navigate('/login')}
    />
  );
}

// ── Route tree ──────────────────────────────────────────────────────────
// /ops is the internal admin console.
// It is NOT linked from any public page, navigation, footer, or profile.
// Access is enforced by AdminRoute (frontend) + requireAdmin middleware (backend).

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public landing page */}
        <Route path="/"         element={<Landing />} />

        {/* Auth pages — redirect to /app when already signed in */}
        <Route path="/login"    element={<PublicRoute><LoginRoute /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><RegisterRoute /></PublicRoute>} />

        {/* Protected workspace */}
        <Route path="/app"      element={<ProtectedRoute><AppWorkspace /></ProtectedRoute>} />

        {/* Protected profile */}
        <Route path="/profile"  element={<ProtectedRoute><Profile /></ProtectedRoute>} />

        {/* Internal admin console — not linked from anywhere in the normal UI */}
        <Route path="/ops"      element={<AdminRoute><AdminConsole /></AdminRoute>} />

        {/* META·SIFT Beta — Screening workspace (tabbed project shell) */}
        <Route path="/sift-beta"                      element={<ProtectedRoute><SiftDashboard /></ProtectedRoute>} />
        <Route path="/sift-beta/projects/:pid"        element={<ProtectedRoute><SiftProject /></ProtectedRoute>} />
        <Route path="/sift-beta/projects/:pid/import" element={<ProtectedRoute><SiftImport /></ProtectedRoute>} />

        {/* Fallback */}
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
