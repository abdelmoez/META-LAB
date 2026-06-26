/**
 * BetaWaitlistPage.jsx — the public Beta Waitlist landing page (54.md), rendered
 * NATIVE to the app's Stitch design system and skinned to match the reference at
 * Design/waitlist (a centered hero + inline email-capture, vivid indigo accent,
 * squiggle-underlined headline, and a floating "teams registered" queue card).
 *
 * The reference is a single email field; the required questionnaire (country +
 * consent + 7 questions) is preserved as the steps AFTER the email pill, so the
 * first impression matches the example exactly while we still collect what we must.
 * The hero + queue card show only on the first (email) step — once the visitor
 * engages, the questionnaire card takes over for a focused flow.
 *
 * Stitch styling is normally admin-gated. This is a PUBLIC page, so it SELF-SCOPES:
 * on mount it sets `document.documentElement.dataset.uiDesign = 'stitch'`, injects
 * the scoped Stitch stylesheet once (<StitchStyle/>), wraps its content in
 * `.stitch-scope`, and restores the previous value on unmount. Nothing leaks. The
 * indigo accent lives in a page-local palette (waitlistTheme.js), never the global
 * Stitch brand token.
 *
 * Intentionally honest (54.md): the queue card shows the REAL signup count (or
 * hides when unavailable) — no invented numbers, logos, or testimonials. Motion is
 * subtle and respects prefers-reduced-motion. When `preview` is set, the page
 * renders regardless of the feature flag and is marked noindex.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../../stitch/theme/stitchTokens.js';
import StitchStyle from '../../stitch/theme/StitchStyle.jsx';
import { WL } from './waitlistTheme.js';
import WaitlistFlow from './WaitlistFlow.jsx';
import { fetchWaitlistCount } from './waitlistApi.js';

const PAGE_TITLE = 'Join the PecanRev Beta Waitlist';
const PAGE_DESC = 'Request early access to PecanRev — a professional workspace for systematic reviews and meta-analyses: search building, screening, data extraction, risk of bias, and meta-analysis in one place.';

/**
 * Set <title>, <meta description>, Open Graph / Twitter title+description (using
 * REAL brand info — no applicant data in metadata), a canonical link, and (preview
 * only) a noindex robots tag. Everything is restored on unmount.
 */
function useWaitlistSeo(preview) {
  useEffect(() => {
    const restores = [];

    const prevTitle = document.title;
    document.title = PAGE_TITLE;
    restores.push(() => { document.title = prevTitle; });

    const setMeta = (selector, content) => {
      const el = document.querySelector(selector);
      if (!el) return;
      const prev = el.getAttribute('content');
      el.setAttribute('content', content);
      restores.push(() => { if (prev != null) el.setAttribute('content', prev); });
    };
    setMeta('meta[name="description"]', PAGE_DESC);
    setMeta('meta[property="og:title"]', PAGE_TITLE);
    setMeta('meta[property="og:description"]', PAGE_DESC);
    setMeta('meta[name="twitter:title"]', PAGE_TITLE);
    setMeta('meta[name="twitter:description"]', PAGE_DESC);

    let canonical = document.querySelector('link[rel="canonical"]');
    let createdCanonical = false;
    const prevHref = canonical ? canonical.getAttribute('href') : null;
    try {
      const canonicalHref = `${window.location.origin}/`;
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
        createdCanonical = true;
      }
      canonical.setAttribute('href', canonicalHref);
      restores.push(() => {
        if (createdCanonical && canonical.parentNode) canonical.parentNode.removeChild(canonical);
        else if (prevHref != null) canonical.setAttribute('href', prevHref);
      });
    } catch { /* no window — SSR safety */ }

    if (preview) {
      const robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      robots.setAttribute('content', 'noindex, nofollow');
      document.head.appendChild(robots);
      restores.push(() => { if (robots.parentNode) robots.parentNode.removeChild(robots); });
    }

    return () => { for (const r of restores.reverse()) r(); };
  }, [preview]);
}

/**
 * Self-scope into Stitch design mode for the lifetime of this public page.
 * Snapshots the previous `data-ui-design` value and restores it on unmount.
 */
function useStitchSelfScope() {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.uiDesign; // undefined when unset
    root.dataset.uiDesign = 'stitch';
    return () => {
      if (prev === undefined) delete root.dataset.uiDesign;
      else root.dataset.uiDesign = prev;
    };
  }, []);
}

export default function BetaWaitlistPage({ preview = false }) {
  const navigate = useNavigate();
  useWaitlistSeo(preview);
  useStitchSelfScope();

  const [currentStep, setCurrentStep] = useState('email');
  const [liveCount, setLiveCount] = useState(null);

  // Real signup count for the queue card. Never throws; null → card hides.
  useEffect(() => {
    let alive = true;
    fetchWaitlistCount().then((n) => { if (alive) setLiveCount(n); });
    return () => { alive = false; };
  }, []);

  const showHero = currentStep === 'email';
  const showQueue = showHero && typeof liveCount === 'number' && liveCount >= 1;

  return (
    <div className="stitch-scope" style={{ minHeight: '100vh', background: S.surface, color: S.textPrimary, fontFamily: S.font, display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'hidden' }}>
      <StitchStyle />
      <style>{`
        @keyframes wlOrb { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(0,-18px,0) scale(1.05); } }
        .wl-orb { animation: wlOrb 14s ease-in-out infinite; }
        @keyframes wlPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
        .wl-pulse-dot { animation: wlPulse 2.2s ease-in-out infinite; }
        .wl-link { color: ${S.textSecondary}; text-decoration: none; font-weight: 500; transition: color 0.15s ease; }
        .wl-link:hover { color: ${WL.primary}; }
        @media (prefers-reduced-motion: reduce) { .wl-orb, .wl-pulse-dot { animation: none !important; } }
        @media (max-width: 880px) { .wl-queue-card { display: none !important; } }
      `}</style>

      {/* Ambient background — subtle, low-opacity, non-interactive. */}
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div className="wl-orb" style={{ position: 'absolute', top: '-12%', right: '-8%', width: 680, height: 680, borderRadius: '50%', background: WL.orbA, filter: 'blur(120px)' }} />
        <div className="wl-orb" style={{ position: 'absolute', bottom: '-18%', left: '-10%', width: 560, height: 560, borderRadius: '50%', background: WL.orbB, filter: 'blur(120px)', animationDelay: '3s' }} />
      </div>

      {preview && (
        <div role="note" style={{ position: 'relative', zIndex: 3, textAlign: 'center', background: S.warnSoft, color: S.onWarnSoft, fontSize: 12.5, fontWeight: 700, padding: '7px 12px', fontFamily: S.font, borderBottom: `1px solid ${salpha(S.warn, 0.4)}` }}>
          Preview — this is how the Beta Waitlist page looks. It is not indexed and does not change what the public sees.
        </div>
      )}

      {/* Header */}
      <header style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px clamp(16px, 5vw, 48px)' }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ width: 34, height: 34, borderRadius: S.radiusControl, background: WL.primary, color: WL.onPrimary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: S.shadowSm }}>
            <Icon name="forest" size={18} />
          </span>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', color: S.textPrimary }}>PecanRev</span>
        </a>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 'clamp(14px, 3vw, 26px)' }}>
          <a className="wl-link" href="/terms#privacy" style={{ fontSize: 13.5 }}>Research ethics</a>
          <a className="wl-link" href="/terms" style={{ fontSize: 13.5 }}>Help</a>
          <a className="wl-link" href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }} style={{ fontSize: 13.5, fontWeight: 600, color: WL.primary }}>Sign in</a>
        </nav>
      </header>

      {/* Main */}
      <main style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 4vw, 40px) clamp(16px, 5vw, 48px) 48px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', maxWidth: 1080, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {showQueue && <QueueCard count={liveCount} />}
          {showHero && <Hero />}
          <div style={{ width: '100%', maxWidth: showHero ? 600 : 640, margin: '0 auto', position: 'relative', zIndex: 2 }}>
            <WaitlistFlow onSignIn={() => navigate('/login')} onStepChange={setCurrentStep} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ position: 'relative', zIndex: 1, borderTop: `1px solid ${salpha(S.outlineVariant, 0.5)}`, padding: '20px clamp(16px, 5vw, 48px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: S.textMuted }}>© {new Date().getFullYear()} PecanRev · Systematic review &amp; meta-analysis platform</span>
        <span style={{ display: 'flex', gap: 18 }}>
          <a className="wl-link" href="/terms" style={{ fontSize: 12.5 }}>Terms</a>
          <a className="wl-link" href="/terms#privacy" style={{ fontSize: 12.5 }}>Privacy</a>
        </span>
      </footer>
    </div>
  );
}

/* ── Hero (shown only on the first/email step) ───────────────────────────────── */
function Hero() {
  return (
    <div className="stitch-fade-in" style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto', position: 'relative', zIndex: 1, padding: '8px 0 30px' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 14px', background: S.card, border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderRadius: S.radiusPill, fontSize: 12.5, fontWeight: 700, color: WL.primary, marginBottom: 22, boxShadow: S.shadowSm }}>
        <span aria-hidden="true" style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
          <span className="wl-pulse-dot" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: WL.primary }} />
        </span>
        PecanRev Beta · Early access
      </span>
      <h1 style={{ fontSize: 'clamp(32px, 5.5vw, 52px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.025em', color: S.textPrimary, margin: '0 0 18px' }}>
        Help us cultivate the future of{' '}
        <span style={{ position: 'relative', display: 'inline-block', color: WL.primary }}>
          evidence synthesis.
          <Squiggle />
        </span>
      </h1>
      <p style={{ fontSize: 'clamp(15px, 2vw, 19px)', color: S.textSecondary, lineHeight: 1.6, margin: '0 auto', maxWidth: 600 }}>
        We're opening our intelligent research workspace to a limited group of academic and institutional teams.
        Join the waitlist to be part of the first wave.
      </p>
    </div>
  );
}

/** The reference's hand-drawn underline beneath the highlighted phrase. */
function Squiggle() {
  return (
    <svg
      aria-hidden="true" viewBox="0 0 200 9" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"
      style={{ position: 'absolute', left: 0, bottom: -6, width: '100%', height: 10, color: WL.squiggle, opacity: 0.75 }}
    >
      <path d="M2.00035 7.42624C48.0617 2.65824 100.866 0.812328 198.544 3.01166" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

/**
 * Floating "teams registered" card — REAL signup count (honest: rendered only when
 * a real count is available and ≥ 1). The progress bar / wave labels are decorative
 * scaffolding from the reference, carrying no fabricated metric.
 */
function QueueCard({ count }) {
  return (
    <div
      className="wl-queue-card"
      aria-hidden="true"
      style={{
        position: 'absolute', right: 0, top: -20, width: 236, transform: 'rotate(4deg)',
        background: salpha(S.card, 0.85), backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        padding: 18, borderRadius: S.radiusCard, border: `1px solid ${salpha(S.outlineVariant, 0.4)}`,
        boxShadow: S.shadow2, zIndex: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: S.textMuted }}>Queue status</span>
        <span style={{ color: WL.primary, display: 'inline-flex' }}><Icon name="clock" size={15} /></span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', color: S.textPrimary, lineHeight: 1, marginBottom: 4 }}>{count.toLocaleString()}</div>
      <div style={{ fontSize: 12.5, color: S.textMuted, marginBottom: 14 }}>Teams registered</div>
      <div style={{ position: 'relative', width: '100%', height: 7, background: S.surfaceHigh, borderRadius: 9999, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '62%', background: WL.primary, borderRadius: 9999 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: salpha(S.textMuted, 0.75) }}>
        <span>Wave 1</span><span>Wave 2</span>
      </div>
    </div>
  );
}
