import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './frontend/context/AuthContext.jsx';
import ProtectedRoute from './frontend/components/ProtectedRoute.jsx';
import PublicRoute    from './frontend/components/PublicRoute.jsx';
import AppWorkspace   from './frontend/pages/AppWorkspace.jsx';
import LoginPage      from './frontend/pages/Login.jsx';
import RegisterPage   from './frontend/pages/Register.jsx';
import Landing        from './frontend/pages/Landing.jsx';
import Profile        from './frontend/pages/Profile.jsx';

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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<Landing />} />

        {/* Auth pages — redirect to /app when already signed in */}
        <Route path="/login"    element={<PublicRoute><LoginRoute /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><RegisterRoute /></PublicRoute>} />

        {/* Protected workspace */}
        <Route path="/app"     element={<ProtectedRoute><AppWorkspace /></ProtectedRoute>} />

        {/* Protected profile */}
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
