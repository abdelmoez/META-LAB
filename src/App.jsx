import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './frontend/context/AuthContext.jsx';
import { useGlobalPresence } from './frontend/hooks/useGlobalPresence.js';
import { ThemeProvider } from './frontend/theme/ThemeContext.jsx';
import { DesignModeProvider } from './frontend/design/DesignModeContext.jsx';
import DesignRoute from './frontend/design/DesignRoute.jsx';
import AdminDesignSwitch from './frontend/design/AdminDesignSwitch.jsx';
import ProtectedRoute from './frontend/components/ProtectedRoute.jsx';
import PublicRoute    from './frontend/components/PublicRoute.jsx';
import AdminRoute     from './frontend/components/AdminRoute.jsx';
import BetaWaitlistGate from './frontend/components/BetaWaitlistGate.jsx';
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
const Onboarding    = lazy(() => import('./frontend/pages/Onboarding.jsx'));
const RobPage       = lazy(() => import('./frontend/rob/RobPage.jsx'));
const Terms         = lazy(() => import('./frontend/pages/Terms.jsx'));
// prompt48 — Beta Waitlist preview route (noindex). The live homepage swap is
// handled by BetaWaitlistGate on `/`; this route renders the page regardless of
// the flag so admins can preview it safely.
const BetaWaitlistPreview = lazy(() => import('./frontend/pages/waitlist/BetaWaitlistPage.jsx'));

// design.md — Stitch (Vivid Enterprise) parallel presentation pages. Lazily
// imported so legacy/non-admin users never download the Stitch bundle. Each is
// paired with its legacy page through <DesignRoute>; the route/data are identical.
const StitchDashboard       = lazy(() => import('./frontend/stitch/pages/StitchDashboard.jsx'));
const StitchProfile         = lazy(() => import('./frontend/stitch/pages/StitchProfile.jsx'));
const StitchProjectOverview = lazy(() => import('./frontend/stitch/pages/StitchProjectOverview.jsx'));
const StitchProjectWorkspace = lazy(() => import('./frontend/stitch/pages/StitchProjectWorkspace.jsx'));
const StitchOpsConsole      = lazy(() => import('./frontend/stitch/pages/StitchOpsConsole.jsx'));

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

// prompt32 — paths that must never be redirected to /onboarding by the gate.
const ONBOARDING_GATE_EXEMPT = ['/onboarding', '/invite', '/verify-email', '/terms', '/reset'];

/**
 * prompt32 — OnboardingGate wraps protected content and redirects any
 * authenticated user with pending onboarding questions to /onboarding,
 * except on exempt paths. This fires on every session bootstrap (including
 * returning cookie sessions), so admin-added questions interrupt existing users.
 */
function OnboardingGate({ children }) {
  const { pendingOnboarding } = useAuth();
  const location = useLocation();
  const isExempt = ONBOARDING_GATE_EXEMPT.some(p => location.pathname.startsWith(p));
  if (!isExempt && pendingOnboarding.length > 0) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

function LoginRoute() {
  const navigate = useNavigate();
  // pendingOnboarding is intentionally NOT read here: post-login routing uses the
  // one-shot onboardingCompleted flag for an immediate redirect, and OnboardingGate
  // handles the live pending check on the destination route.
  const { login } = useAuth();
  return (
    <LoginPage
      onSuccess={u => {
        login(u);
        const invite = inviteParam();
        // prompt32 — after login the gate in OnboardingGate will handle
        // redirecting to /onboarding when there are pending questions (including
        // for existing users whose admin has added new questions). Invites still
        // take precedence. Fall back to the one-shot flag for immediate redirect
        // on first login before AuthContext has a chance to re-fetch pending.
        const dest = invite ? `/invite/${encodeURIComponent(invite)}`
          : (u && u.onboardingCompleted === false) ? '/onboarding'
          : '/app';
        navigate(dest);
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
  const { login, pendingOnboarding } = useAuth();
  return (
    <RegisterPage
      onSuccess={(u, redirectTo) => {
        login(u);
        // prompt32 — route to /onboarding when there are pending questions
        // (pendingOnboarding is populated by login() → fetchPending() in AuthContext);
        // fall back to /app when there are none. Explicit redirectTo still wins.
        const dest = redirectTo || (pendingOnboarding.length > 0 ? '/onboarding' : '/app');
        navigate(dest);
      }}
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
    <DesignModeProvider>
      <GlobalPresence />
      {/* design.md §5/§6 — admin-only design switch, mounted as a floating overlay
          beside (never inside) the legacy header. Renders nothing for non-admins
          and only in legacy mode; the Stitch header hosts its own inline switch. */}
      <AdminDesignSwitch variant="floating" />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public landing page. prompt48 — when the betaWaitlist flag is ON,
            BetaWaitlistGate shows the Beta Waitlist page to UNAUTHENTICATED
            visitors; otherwise (and for signed-in users) the existing Landing
            renders exactly as before. */}
        <Route path="/"         element={<BetaWaitlistGate><Landing /></BetaWaitlistGate>} />

        {/* prompt48 — Beta Waitlist preview (noindex; renders regardless of flag) */}
        <Route path="/beta-waitlist" element={<BetaWaitlistPreview preview />} />

        {/* Public Terms of Service + Privacy Policy (prompt29) — works signed in or out */}
        <Route path="/terms"    element={<Terms />} />
        <Route path="/privacy"  element={<Navigate to="/terms#privacy" replace />} />

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
        {/* prompt26/32 — dynamic server-driven onboarding (post-registration and
            on any sign-in when admin has added new questions). OnboardingGate on
            protected routes redirects here; /onboarding itself is gate-exempt. */}
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

        <Route path="/app"      element={<ProtectedRoute><OnboardingGate><DesignRoute legacy={<ProjectLanding />} stitch={<StitchDashboard />} /></OnboardingGate></ProtectedRoute>} />

        {/* Protected workspace — opens one project by id into the existing overview/workflow */}
        <Route path="/app/project/:projectId" element={<ProtectedRoute><OnboardingGate><DesignRoute legacy={<AppWorkspace />} stitch={<StitchProjectWorkspace />} /></OnboardingGate></ProtectedRoute>} />

        {/* Protected profile */}
        <Route path="/profile"  element={<ProtectedRoute><OnboardingGate><DesignRoute legacy={<Profile />} stitch={<StitchProfile />} /></OnboardingGate></ProtectedRoute>} />

        {/* Internal admin console — not linked from anywhere in the normal UI */}
        <Route path="/ops"      element={<AdminRoute><OnboardingGate><DesignRoute legacy={<AdminConsole />} stitch={<StitchOpsConsole />} /></OnboardingGate></AdminRoute>} />

        {/* META·SIFT Beta — Screening workspace (tabbed project shell) */}
        <Route path="/sift-beta"                      element={<ProtectedRoute><OnboardingGate><SiftDashboard /></OnboardingGate></ProtectedRoute>} />
        <Route path="/sift-beta/projects/:pid"        element={<ProtectedRoute><OnboardingGate><SiftProject /></OnboardingGate></ProtectedRoute>} />
        <Route path="/sift-beta/projects/:pid/import" element={<ProtectedRoute><OnboardingGate><SiftImport /></OnboardingGate></ProtectedRoute>} />

        {/* META·LAB RoB — Risk-of-Bias workspace (rob.md; gated on rob_engine_v2) */}
        <Route path="/rob"             element={<ProtectedRoute><OnboardingGate><RobPage /></OnboardingGate></ProtectedRoute>} />
        <Route path="/rob/:projectId"  element={<ProtectedRoute><OnboardingGate><RobPage /></OnboardingGate></ProtectedRoute>} />

        {/* Fallback */}
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </DesignModeProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
