/**
 * BetaWaitlistGate.jsx — decides what an unauthenticated visitor sees at `/`
 * (prompt48 §1). When the `betaWaitlist` feature flag is ON and the visitor is NOT
 * signed in, it renders the Beta Waitlist page; otherwise it renders `children`
 * (the existing PecanRev Landing page, completely unchanged).
 *
 *   - Authenticated users are never trapped: they always get `children` (the
 *     normal Landing, which already offers "Open workspace"). Login/register routes
 *     are separate and unaffected.
 *   - The Beta Waitlist page is lazy-loaded so it never bloats the eager landing
 *     bundle — it downloads only when actually shown.
 *   - A brief token-styled loader avoids a flash of the wrong homepage while the
 *     auth session + public flags resolve.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchFeatureFlags } from '../pages/waitlist/waitlistApi.js';

const BetaWaitlistPage = lazy(() => import('../pages/waitlist/BetaWaitlistPage.jsx'));

function GateLoader() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--t-bg)' }} aria-busy="true" aria-label="Loading">
      <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--t-brd)', borderTopColor: 'var(--t-acc)', animation: 'wlGateSpin 0.7s linear infinite' }} />
      <style>{`@keyframes wlGateSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { [aria-busy="true"] > div { animation: none; } }`}</style>
    </div>
  );
}

export default function BetaWaitlistGate({ children }) {
  const { user, loading } = useAuth();
  const [flags, setFlags] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchFeatureFlags().then((f) => { if (alive) setFlags(f || {}); });
    return () => { alive = false; };
  }, []);

  // Wait for both the session and the flags before deciding, to avoid a flash.
  if (loading || flags === null) return <GateLoader />;

  if (!user && flags.betaWaitlist === true) {
    return (
      <Suspense fallback={<GateLoader />}>
        <BetaWaitlistPage />
      </Suspense>
    );
  }
  return children;
}
