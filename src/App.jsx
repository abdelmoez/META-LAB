import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './frontend/context/AuthContext.jsx';
import { useGlobalPresence } from './frontend/hooks/useGlobalPresence.js';
import { ThemeProvider } from './frontend/theme/ThemeContext.jsx';
import ProtectedRoute from './frontend/components/ProtectedRoute.jsx';
import PublicRoute    from './frontend/components/PublicRoute.jsx';
import AdminRoute     from './frontend/components/AdminRoute.jsx';
import Landing        from './frontend/pages/Landing.jsx';

// ── Route-level code splitting ──────────────────────────────────────────
// Landing stays eager (first paint of the public page). Everything else is
// split per route so visitors never download the workspace monolith, the
// ops console, or the screening module until they navigate there.
const ProjectLanding = lazy(() => import('./frontend/pages/ProjectLanding.jsx'));
const AppWorkspace  = lazy(() => import('./frontend/pages/AppWorkspace.jsx'));
const LoginPage     = lazy(() => import('./frontend/pages/Login.jsx'));
const RegisterPage  = lazy(() => import('./frontend/pages/Register.jsx'));
const Profile       = lazy(() => import('./frontend/pages/Profile.jsx'));
const AdminConsole  = lazy(() => import('./frontend/pages/admin/AdminConsole.jsx'));
const SiftDashboard = lazy(() => import('./frontend/screening/pages/SiftDashboard.jsx'));
const SiftProject   = lazy(() => import('./frontend/screening/pages/SiftProject.jsx'));
const SiftImport    = lazy(() => import('./frontend/screening/pages/SiftImport.jsx'));
const InvitePage    = lazy(() => import('./frontend/pages/InvitePage.jsx'));
const ResetPassword = lazy(() => import('./frontend/pages/ResetPassword.jsx'));
const VerifyEmail   = lazy(() => import('./frontend/pages/VerifyEmail.jsx'));

/* Minimal theme-token loading state shown while a route chunk downloads. */
function RouteFallback() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--t-bg)',
    }} aria-busy="true" aria-label="Loading">
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        border: '2px solid var(--t-brd)', borderTopColor: 'var(--t-acc)',
        animation: 'appChunkSpin 0.7s linear infinite',
      }} />
      <style>{`@keyframes appChunkSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { [aria-busy="true"] > div { animation: none; } }`}</style>
    </div>
  );
}

// ── Route adapters ──────────────────────────────────────────────────────
// Login and Register were originally prop-driven (onSuccess, onRegister, onBack).
// These thin wrappers bridge that interface to React Router navigation so the
// original page components don't need to change.

// Invite handoff (prompt9 Task 2): /login?invite=<t> and /register?invite=<t>
// keep the token alive across the auth pages without modifying Login.jsx —
// the adapters read it from the live query string at navigation time.
function inviteParam() {
  try { return new URLSearchParams(window.location.search).get('invite') || ''; }
  catch { return ''; }
}

function LoginRoute() {
  const navigate = useNavigate();
  const { login } = useAuth();
  return (
    <LoginPage
      onSuccess={u => {
        login(u);
        const invite = inviteParam();
        navigate(invite ? `/invite/${encodeURIComponent(invite)}` : '/app');
      }}
      onRegister={() => {
        const invite = inviteParam();
        navigate(invite ? `/register?invite=${encodeURIComponent(invite)}` : '/register');
      }}
      onForgot={() => navigate('/reset')}
    />
  );
}

function RegisterRoute() {
  const navigate = useNavigate();
  const { login } = useAuth();
  return (
    <RegisterPage
      onSuccess={(u, redirectTo) => { login(u); navigate(redirectTo || '/app'); }}
      onBack={() => {
        const invite = inviteParam();
        navigate(invite ? `/login?invite=${encodeURIComponent(invite)}` : '/login');
      }}
    />
  );
}

// ── Route tree ──────────────────────────────────────────────────────────
// /ops is the internal admin console.
// It is NOT linked from any public page, navigation, footer, or profile.
// Access is enforced by AdminRoute (frontend) + requireAdmin middleware (backend).

// prompt25 follow-up — app-wide "online now" heartbeat. Renders nothing; pings
// /api/presence/ping with a route-derived location whenever a user is signed in,
// so users not inside a project still show online in the Ops console.
function GlobalPresence() {
  const { user } = useAuth();
  const location = useLocation();
  useGlobalPresence(user, location.pathname);
  return null;
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <GlobalPresence />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public landing page */}
        <Route path="/"         element={<Landing />} />

        {/* Auth pages — redirect to /app when already signed in */}
        <Route path="/login"    element={<PublicRoute><LoginRoute /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><RegisterRoute /></PublicRoute>} />

        {/* Invite landing — deliberately unwrapped: must work signed-in AND
            signed-out (PublicRoute would bounce signed-in invitees to /app) */}
        <Route path="/invite/:token" element={<InvitePage />} />

        {/* Public password reset — unwrapped (must work signed-out AND signed-in).
            /reset = request a link; /reset?token=… = choose a new password. */}
        <Route path="/reset" element={<ResetPassword />} />

        {/* prompt26 — public email-verification landing (only reached when an
            admin has enabled requireEmailVerification). */}
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Protected post-login home — project command center (prompt11) */}
        <Route path="/app"      element={<ProtectedRoute><ProjectLanding /></ProtectedRoute>} />

        {/* Protected workspace — opens one project by id into the existing overview/workflow */}
        <Route path="/app/project/:projectId" element={<ProtectedRoute><AppWorkspace /></ProtectedRoute>} />

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
      </Suspense>
    </AuthProvider>
    </ThemeProvider>
  );
}
