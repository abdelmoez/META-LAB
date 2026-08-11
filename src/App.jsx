import { createElement, lazy, useRef, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { stripTrailingSlash } from './frontend/website/publicPages.js';
import { AuthProvider, useAuth } from './frontend/context/AuthContext.jsx';
import { useGlobalPresence } from './frontend/hooks/useGlobalPresence.js';
import { ThemeProvider } from './frontend/theme/ThemeContext.jsx';
import { DesignModeProvider } from './frontend/design/DesignModeContext.jsx';
import { FocusModeProvider } from './frontend/focus/FocusModeContext.jsx';
import DesignRoute from './frontend/design/DesignRoute.jsx';
import ForceLegacyDesign from './frontend/design/ForceLegacyDesign.jsx';
import ProtectedRoute from './frontend/components/ProtectedRoute.jsx';
import PublicRoute    from './frontend/components/PublicRoute.jsx';
import AdminRoute     from './frontend/components/AdminRoute.jsx';
import BetaWaitlistGate from './frontend/components/BetaWaitlistGate.jsx';
import Landing        from './frontend/pages/Landing.jsx';

// ── Route-level code splitting ──────────────────────────────────────────
// Landing stays eager (first paint of the public page). Everything else is
// split per route so visitors never download the workspace monolith, the
// ops console, or the screening module until they navigate there.
// Routes the build PRERENDERS use `preloadableLazy` instead of `lazy` — see the
// helper below for why a bare lazy() flashes a spinner over prerendered markup.
const ProjectLanding = lazy(() => import('./frontend/pages/ProjectLanding.jsx'));
const AppWorkspace  = lazy(() => import('./frontend/pages/AppWorkspace.jsx'));
const LoginPage     = preloadableLazy(() => import('./frontend/pages/Login.jsx'));
const RegisterPage  = preloadableLazy(() => import('./frontend/pages/Register.jsx'));
const Profile       = lazy(() => import('./frontend/pages/Profile.jsx'));
const AdminConsole  = lazy(() => import('./frontend/pages/admin/AdminConsole.jsx'));
const SiftDashboard = lazy(() => import('./frontend/screening/pages/SiftDashboard.jsx'));
const SiftProject   = lazy(() => import('./frontend/screening/pages/SiftProject.jsx'));
const SiftImport    = lazy(() => import('./frontend/screening/pages/SiftImport.jsx'));
const InvitePage    = lazy(() => import('./frontend/pages/InvitePage.jsx'));
const AcceptInvitationPage = lazy(() => import('./frontend/pages/AcceptInvitationPage.jsx'));
const ResetPassword = lazy(() => import('./frontend/pages/ResetPassword.jsx'));
const VerifyEmail   = lazy(() => import('./frontend/pages/VerifyEmail.jsx'));
const Onboarding    = lazy(() => import('./frontend/pages/Onboarding.jsx'));
const RobPage       = lazy(() => import('./frontend/rob/RobPage.jsx'));

/**
 * 111.md §3 — a lazy route that can be PRELOADED, used for every route the build
 * prerenders (see PRERENDERED_ROUTES below).
 *
 * WHY this exists rather than a bare `lazy()`. A prerendered document arrives with
 * the real article already in `<div id="root">`. `createRoot()` discards those
 * children on its first commit and renders from scratch (this app mounts with
 * createRoot, not hydrateRoot — see src/main.jsx and §5 of docs/seo-overhaul-111.md).
 * If the matched route is a plain `lazy()`, that first render SUSPENDS, so the
 * commit that clears `#root` also paints `<RouteFallback/>` — a full-viewport
 * spinner where the article was. The visitor sees content → spinner → content on
 * exactly the pages this round built for Core Web Vitals.
 *
 * `preload()` resolves the chunk BEFORE React mounts; the wrapper then renders the
 * real component synchronously, so nothing suspends and nothing flashes. The choice
 * is frozen per mount in a ref: switching element type mid-life would remount the
 * page, so a route that was NOT preloaded keeps using the Suspense path for its
 * whole life (the normal in-app navigation case, where a spinner is correct).
 */
function preloadableLazy(loader) {
  let loaded = null;
  const resolve = () => loader().then((mod) => { loaded = mod; return mod; });
  const Lazy = lazy(resolve);
  function PreloadableRoute(props) {
    const pinned = useRef(loaded);
    return pinned.current
      ? createElement(pinned.current.default, props)
      : createElement(Lazy, props);
  }
  PreloadableRoute.displayName = 'PreloadableRoute';
  // A failed preload must never block the mount: fall through to the Suspense path,
  // where the same import is retried and the error boundary can do its job.
  PreloadableRoute.preload = () => resolve().catch(() => null);
  return PreloadableRoute;
}

const Terms         = preloadableLazy(() => import('./frontend/pages/Terms.jsx'));

// 111.md §§6, 8, 9 — public marketing/education pages. Registered in
// src/frontend/website/publicPages.js; each is a pure, SSR-safe component so the
// build-time prerenderer can emit crawlable HTML for it. All are `preloadableLazy`
// because all are prerendered (see PRERENDERED_ROUTES).
const FeaturesIndexPage        = preloadableLazy(() => import('./frontend/website/pages/FeaturesIndexPage.jsx'));
const SearchEnginePage         = preloadableLazy(() => import('./frontend/website/pages/SearchEnginePage.jsx'));
const ScreeningFeaturePage     = preloadableLazy(() => import('./frontend/website/pages/ScreeningPage.jsx'));
const DataExtractionPage       = preloadableLazy(() => import('./frontend/website/pages/DataExtractionPage.jsx'));
const MetaAnalysisFeaturePage  = preloadableLazy(() => import('./frontend/website/pages/MetaAnalysisPage.jsx'));
const ManuscriptPage           = preloadableLazy(() => import('./frontend/website/pages/ManuscriptPage.jsx'));
const ResourcesIndexPage       = preloadableLazy(() => import('./frontend/website/pages/ResourcesIndexPage.jsx'));
const WhatIsSystematicReviewPage = preloadableLazy(() => import('./frontend/website/pages/WhatIsSystematicReviewPage.jsx'));
const Prisma2020Page           = preloadableLazy(() => import('./frontend/website/pages/Prisma2020Page.jsx'));
const ScreeningGuidePage       = preloadableLazy(() => import('./frontend/website/pages/ScreeningGuidePage.jsx'));
const MetaAnalysisGuidePage    = preloadableLazy(() => import('./frontend/website/pages/MetaAnalysisGuidePage.jsx'));
const AboutPage                = preloadableLazy(() => import('./frontend/website/pages/AboutPage.jsx'));
// 113 W1-A — commercial + feature + comparison pages. Same contract as above:
// pure, SSR-safe, prerendered, therefore preloadableLazy.
const SystematicReviewSoftwarePage = preloadableLazy(() => import('./frontend/website/pages/SystematicReviewSoftwarePage.jsx'));
const AiSystematicReviewPage   = preloadableLazy(() => import('./frontend/website/pages/AiSystematicReviewPage.jsx'));
const RiskOfBiasFeaturePage    = preloadableLazy(() => import('./frontend/website/pages/RiskOfBiasPage.jsx'));
const PrismaFlowDiagramPage    = preloadableLazy(() => import('./frontend/website/pages/PrismaFlowDiagramPage.jsx'));
const NetworkMetaAnalysisPage  = preloadableLazy(() => import('./frontend/website/pages/NetworkMetaAnalysisPage.jsx'));
const CaseSeriesFeaturePage    = preloadableLazy(() => import('./frontend/website/pages/CaseSeriesPage.jsx'));
const CompareIndexPage         = preloadableLazy(() => import('./frontend/website/pages/CompareIndexPage.jsx'));
const CompareCovidencePage     = preloadableLazy(() => import('./frontend/website/pages/CompareCovidencePage.jsx'));
const CompareRayyanPage        = preloadableLazy(() => import('./frontend/website/pages/CompareRayyanPage.jsx'));
// 113 W1-B — the eight methodology guides under /resources. Same contract again.
const ConductSystematicReviewPage = preloadableLazy(() => import('./frontend/website/pages/ConductSystematicReviewPage.jsx'));
const SearchStrategyGuidePage  = preloadableLazy(() => import('./frontend/website/pages/SearchStrategyGuidePage.jsx'));
const DataExtractionGuidePage  = preloadableLazy(() => import('./frontend/website/pages/DataExtractionGuidePage.jsx'));
const RiskOfBiasGuidePage      = preloadableLazy(() => import('./frontend/website/pages/RiskOfBiasGuidePage.jsx'));
const ForestPlotsGuidePage     = preloadableLazy(() => import('./frontend/website/pages/ForestPlotsGuidePage.jsx'));
const PublicationBiasGuidePage = preloadableLazy(() => import('./frontend/website/pages/PublicationBiasGuidePage.jsx'));
const NetworkMetaAnalysisGuidePage = preloadableLazy(() => import('./frontend/website/pages/NetworkMetaAnalysisGuidePage.jsx'));
const PrismaFlowDiagramGuidePage = preloadableLazy(() => import('./frontend/website/pages/PrismaFlowDiagramGuidePage.jsx'));
const NotFound      = lazy(() => import('./frontend/pages/NotFound.jsx'));
// 68.md (P8) — the PUBLIC synthesis page. Unwrapped (no auth): serves both the
// shareable public page and the chrome-less embed. Same component, `embed` prop.
const PublicSynthesisPage = lazy(() => import('./features/publicSynthesis/PublicSynthesisPage.jsx'));
// prompt48 — Beta Waitlist preview route (noindex). The live homepage swap is
// handled by BetaWaitlistGate on `/`; this route renders the page regardless of
// the flag so admins can preview it safely.
const BetaWaitlistPreview = preloadableLazy(() => import('./frontend/pages/waitlist/BetaWaitlistPage.jsx'));

// design.md — Stitch (Vivid Enterprise) parallel presentation pages. Lazily
// imported so legacy/non-admin users never download the Stitch bundle. Each is
// paired with its legacy page through <DesignRoute>; the route/data are identical.
const StitchDashboard       = lazy(() => import('./frontend/stitch/pages/StitchDashboard.jsx'));
const StitchProfile         = lazy(() => import('./frontend/stitch/pages/StitchProfile.jsx'));
const StitchProjectOverview = lazy(() => import('./frontend/stitch/pages/StitchProjectOverview.jsx'));
const StitchProjectWorkspace = lazy(() => import('./frontend/stitch/pages/StitchProjectWorkspace.jsx'));

/**
 * 111.md §3 — registry path → the route component the build prerenders for it.
 *
 * Every entry in PUBLIC_PAGES that renders through a code-split chunk is here; `/`
 * is deliberately absent because Landing is imported eagerly and therefore never
 * suspends. tests/unit/seo/prerenderPreload.test.js pins this map against the
 * registry, so a new prerendered page that forgets to register here fails the suite
 * rather than silently reintroducing the flash.
 */
const PRERENDERED_ROUTES = {
  '/terms': Terms,
  '/login': LoginPage,
  '/register': RegisterPage,
  '/beta-waitlist': BetaWaitlistPreview,
  '/features': FeaturesIndexPage,
  '/features/search-engine': SearchEnginePage,
  '/features/screening': ScreeningFeaturePage,
  '/features/data-extraction': DataExtractionPage,
  '/features/meta-analysis': MetaAnalysisFeaturePage,
  '/features/manuscript': ManuscriptPage,
  '/resources': ResourcesIndexPage,
  '/resources/what-is-a-systematic-review': WhatIsSystematicReviewPage,
  '/resources/prisma-2020-explained': Prisma2020Page,
  '/resources/title-and-abstract-screening': ScreeningGuidePage,
  '/resources/how-to-run-a-meta-analysis': MetaAnalysisGuidePage,
  '/about': AboutPage,
  // 113 W1-A
  '/systematic-review-software': SystematicReviewSoftwarePage,
  '/ai-systematic-review': AiSystematicReviewPage,
  '/features/risk-of-bias': RiskOfBiasFeaturePage,
  '/features/prisma-flow-diagram': PrismaFlowDiagramPage,
  '/features/network-meta-analysis': NetworkMetaAnalysisPage,
  '/features/case-series': CaseSeriesFeaturePage,
  '/compare': CompareIndexPage,
  '/compare/pecanrev-vs-covidence': CompareCovidencePage,
  '/compare/pecanrev-vs-rayyan': CompareRayyanPage,
  // 113 W1-B
  '/resources/how-to-conduct-a-systematic-review': ConductSystematicReviewPage,
  '/resources/systematic-review-search-strategy': SearchStrategyGuidePage,
  '/resources/data-extraction-for-systematic-reviews': DataExtractionGuidePage,
  '/resources/risk-of-bias-assessment': RiskOfBiasGuidePage,
  '/resources/forest-plots-and-heterogeneity': ForestPlotsGuidePage,
  '/resources/publication-bias': PublicationBiasGuidePage,
  '/resources/network-meta-analysis-explained': NetworkMetaAnalysisGuidePage,
  '/resources/prisma-flow-diagram-guide': PrismaFlowDiagramGuidePage,
};

/**
 * Resolve the chunk behind a prerendered route BEFORE React mounts.
 *
 * src/main.jsx awaits this when the server delivered a prerendered document, so the
 * first commit — which unavoidably discards the server's markup, since this app uses
 * createRoot rather than hydrateRoot — can render the real page synchronously instead
 * of committing the Suspense fallback over it.
 *
 * Always resolves (never rejects): a chunk that fails to load must not stop the app
 * from mounting; the Suspense path retries it and AppErrorBoundary owns the failure.
 *
 * @param {string} pathname window.location.pathname
 * @returns {Promise<unknown>}
 */
export function preloadPublicRoute(pathname) {
  const route = PRERENDERED_ROUTES[stripTrailingSlash(String(pathname || ''))];
  return route && typeof route.preload === 'function'
    ? route.preload()
    : Promise.resolve(null);
}

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
const ONBOARDING_GATE_EXEMPT = ['/onboarding', '/invite', '/accept-invitation', '/verify-email', '/terms', '/reset'];

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
  const routerLocation = useLocation();
  // 86.md P2.24 — a deep link that bounced through /login carries its origin in
  // location.state.from; return the user THERE after auth (not always /app). Only
  // trust an internal path that isn't itself an auth page, to avoid open-redirect
  // and login loops.
  const rawFrom = routerLocation.state && routerLocation.state.from;
  const safeFrom = (typeof rawFrom === 'string' && rawFrom.startsWith('/') && !/^\/(login|register|reset|onboarding)\b/.test(rawFrom)) ? rawFrom : null;
  // pendingOnboarding is intentionally NOT read here: post-login routing uses the
  // one-shot onboardingCompleted flag for an immediate redirect, and OnboardingGate
  // handles the live pending check on the destination route.
  const { login } = useAuth();
  return (
    <LoginPage
      returnTo={safeFrom || undefined}
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
          : (safeFrom || '/app');
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
    {/* 104.md — Focus Mode is application state, above the router, so activating it
        and clicking Next keeps it active through the whole workflow instead of
        resetting on every navigation. */}
    <FocusModeProvider>
      <GlobalPresence />
      {/* 65.md — the in-app design switch is gone: Stitch is the product UI for
          everyone. Admins control the theme from Ops › Appearance + ?ui= only. */}
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public landing page. prompt48 — when the betaWaitlist flag is ON,
            BetaWaitlistGate shows the Beta Waitlist page to UNAUTHENTICATED
            visitors; otherwise (and for signed-in users) the existing Landing
            renders exactly as before. */}
        <Route path="/"         element={<BetaWaitlistGate><Landing /></BetaWaitlistGate>} />

        {/* prompt48 — Beta Waitlist preview (noindex; renders regardless of flag) */}
        <Route path="/beta-waitlist" element={<BetaWaitlistPreview preview />} />

        {/* 111.md §§6, 8, 9 — public marketing + methodology pages. Anonymous-reachable,
            indexable, and prerendered at build time. Kept above the auth routes so the
            public information architecture reads as one block. */}
        <Route path="/systematic-review-software"                  element={<SystematicReviewSoftwarePage />} />
        <Route path="/ai-systematic-review"                        element={<AiSystematicReviewPage />} />
        <Route path="/features"                                    element={<FeaturesIndexPage />} />
        <Route path="/features/search-engine"                      element={<SearchEnginePage />} />
        <Route path="/features/screening"                          element={<ScreeningFeaturePage />} />
        <Route path="/features/data-extraction"                    element={<DataExtractionPage />} />
        <Route path="/features/meta-analysis"                      element={<MetaAnalysisFeaturePage />} />
        <Route path="/features/manuscript"                         element={<ManuscriptPage />} />
        <Route path="/features/risk-of-bias"                       element={<RiskOfBiasFeaturePage />} />
        <Route path="/features/prisma-flow-diagram"                element={<PrismaFlowDiagramPage />} />
        <Route path="/features/network-meta-analysis"              element={<NetworkMetaAnalysisPage />} />
        <Route path="/features/case-series"                        element={<CaseSeriesFeaturePage />} />
        <Route path="/compare"                                     element={<CompareIndexPage />} />
        <Route path="/compare/pecanrev-vs-covidence"               element={<CompareCovidencePage />} />
        <Route path="/compare/pecanrev-vs-rayyan"                  element={<CompareRayyanPage />} />
        <Route path="/resources"                                   element={<ResourcesIndexPage />} />
        <Route path="/resources/what-is-a-systematic-review"       element={<WhatIsSystematicReviewPage />} />
        <Route path="/resources/prisma-2020-explained"             element={<Prisma2020Page />} />
        <Route path="/resources/title-and-abstract-screening"      element={<ScreeningGuidePage />} />
        <Route path="/resources/how-to-run-a-meta-analysis"        element={<MetaAnalysisGuidePage />} />
        {/* 113 W1-B — the eight methodology guides. Registry-gated prefix, so each
            one needs BOTH this route and a PUBLIC_PAGES entry. */}
        <Route path="/resources/how-to-conduct-a-systematic-review"    element={<ConductSystematicReviewPage />} />
        <Route path="/resources/systematic-review-search-strategy"     element={<SearchStrategyGuidePage />} />
        <Route path="/resources/data-extraction-for-systematic-reviews" element={<DataExtractionGuidePage />} />
        <Route path="/resources/risk-of-bias-assessment"               element={<RiskOfBiasGuidePage />} />
        <Route path="/resources/forest-plots-and-heterogeneity"        element={<ForestPlotsGuidePage />} />
        <Route path="/resources/publication-bias"                      element={<PublicationBiasGuidePage />} />
        <Route path="/resources/network-meta-analysis-explained"       element={<NetworkMetaAnalysisGuidePage />} />
        <Route path="/resources/prisma-flow-diagram-guide"             element={<PrismaFlowDiagramGuidePage />} />
        <Route path="/about"                                       element={<AboutPage />} />

        {/* Public Terms of Service + Privacy Policy (prompt29) — works signed in or out */}
        <Route path="/terms"    element={<Terms />} />
        {/* 111.md §5 — /privacy is now a real HTTP 301 to /terms#privacy, owned by
            server/middleware/publicPages.js (production) and mirrored by the Vite
            dev server (vite.config.js) so dev + e2e behave identically. The client
            <Navigate> it replaces could only ever produce a soft 200, which made
            /privacy look like an indexable duplicate of /terms to crawlers. */}

        {/* Auth pages — redirect to /app when already signed in */}
        <Route path="/login"    element={<PublicRoute><LoginRoute /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><RegisterRoute /></PublicRoute>} />

        {/* Invite landing — deliberately unwrapped: must work signed-in AND
            signed-out (PublicRoute would bounce signed-in invitees to /app) */}
        <Route path="/invite/:token" element={<InvitePage />} />

        {/* 80.md — waitlist → account activation. Unwrapped like /invite + /reset:
            the emailed link must work signed-out (and not bounce a signed-in visitor). */}
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

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

        {/* Internal admin console — not linked from anywhere in the normal UI.
            LEGACY ONLY: the Ops Console is intentionally never rendered in the
            Stitch design. ForceLegacyDesign pins /ops to legacy even for an admin
            whose global preference is Stitch (the Stitch ops surface was removed). */}
        <Route path="/ops"      element={<AdminRoute><OnboardingGate><ForceLegacyDesign><AdminConsole /></ForceLegacyDesign></OnboardingGate></AdminRoute>} />

        {/* PecanRev Screening — standalone/internal engine. 58.md §6: the DIRECT
            /sift-beta routes are STAFF-ONLY (AdminRoute = admin|mod, 404-cloaked for
            everyone else), matching the staff-gated entry link in UserMenu. Regular
            users still use Screening through the integrated project workspace
            (StitchProjectWorkspace ?tab=screening / the legacy workspace), which does
            NOT go through these routes. The server enforces project access on every
            screening API independently. */}
        <Route path="/sift-beta"                      element={<AdminRoute><OnboardingGate><SiftDashboard /></OnboardingGate></AdminRoute>} />
        <Route path="/sift-beta/projects/:pid"        element={<AdminRoute><OnboardingGate><SiftProject /></OnboardingGate></AdminRoute>} />
        <Route path="/sift-beta/projects/:pid/import" element={<AdminRoute><OnboardingGate><SiftImport /></OnboardingGate></AdminRoute>} />

        {/* META·LAB RoB — Risk-of-Bias workspace (rob.md; gated on rob_engine_v2) */}
        <Route path="/rob"             element={<ProtectedRoute><OnboardingGate><RobPage /></OnboardingGate></ProtectedRoute>} />
        <Route path="/rob/:projectId"  element={<ProtectedRoute><OnboardingGate><RobPage /></OnboardingGate></ProtectedRoute>} />

        {/* 68.md (P8) — PUBLIC synthesis pages. Deliberately unwrapped (like
            /invite/:token): a published synthesis must be readable by anyone with
            the link, signed-in or not. The embed variant renders chrome-less. The
            server serves a frozen, pre-sanitized payload; an unknown/unpublished
            token yields a clean in-page "not available" state. */}
        <Route path="/public/synthesis/:token" element={<PublicSynthesisPage />} />
        <Route path="/embed/synthesis/:token"  element={<PublicSynthesisPage embed />} />

        {/* 65.md UX-7 — unknown routes get a real 404 page instead of a silent
            bounce to the marketing landing (stale/mistyped in-app links were
            dropping signed-in researchers on the public page with no explanation). */}
        <Route path="*"         element={<NotFound />} />
      </Routes>
      </Suspense>
    </FocusModeProvider>
    </DesignModeProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
