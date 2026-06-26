/**
 * BetaWaitlistPage.jsx — the public Beta Waitlist landing page (54.md), rendered
 * NATIVE to the app's Stitch design system.
 *
 * Stitch styling is normally admin-gated (the `data-ui-design="stitch"` root is set
 * only for admins who opted in). This is a PUBLIC page, so it SELF-SCOPES: on mount
 * it snapshots and sets `document.documentElement.dataset.uiDesign = 'stitch'`,
 * injects the scoped Stitch stylesheet once (<StitchStyle/>), wraps its content in
 * `.stitch-scope`, and restores the previous value on unmount. Nothing leaks.
 *
 * Intentionally restrained (54.md / honesty rules): no fake metrics, fake logos,
 * fake testimonials, or invented queue counts. Motion is subtle and respects
 * prefers-reduced-motion.
 *
 * When `preview` is set (the /beta-waitlist preview route), the page renders
 * regardless of the feature flag and is marked noindex so it can't be indexed as a
 * duplicate of the live homepage.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/icons.jsx';
import { S, salpha } from '../../stitch/theme/stitchTokens.js';
import { StitchButton } from '../../stitch/primitives/index.js';
import StitchStyle from '../../stitch/theme/StitchStyle.jsx';
import WaitlistFlow from './WaitlistFlow.jsx';

const PAGE_TITLE = 'Join the PecanRev Beta Waitlist';
const PAGE_DESC = 'Request early access to PecanRev — a professional workspace for systematic reviews and meta-analyses: search building, screening, data extraction, risk of bias, and meta-analysis in one place.';

/**
 * Set <title>, <meta description>, Open Graph / Twitter title+description (using
 * REAL brand info — no applicant data in metadata), a canonical link, and (preview
 * only) a noindex robots tag. Everything is restored on unmount so navigating away
 * never leaves the waitlist metadata behind.
 */
function useWaitlistSeo(preview) {
  useEffect(() => {
    const restores = [];

    // <title>
    const prevTitle = document.title;
    document.title = PAGE_TITLE;
    restores.push(() => { document.title = prevTitle; });

    // Existing meta tags: update content, remember the previous value.
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

    // Canonical → the public homepage origin (avoids indexing the preview route as
    // a duplicate; the live page only ever serves from `/`).
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

    // Preview route → noindex so it can't be indexed as a duplicate homepage.
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
 * Self-scope into Stitch design mode for the lifetime of this public page. Snapshots
 * the previous `data-ui-design` value and restores it on unmount (deleting the attr
 * if it was originally unset), so legacy users never keep the Stitch tokens.
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

const TRUST_POINTS = [
  { icon: 'shield', title: 'Private by design', body: 'Your details are stored securely and used only to manage the beta — never sold or shared.' },
  { icon: 'check', title: 'Standards-aligned', body: 'A workspace built around PRISMA-style review workflows, from search to synthesis.' },
  { icon: 'mail', title: 'No spam', body: "We'll only email you about beta access and meaningful updates. Unsubscribe anytime." },
];

export default function BetaWaitlistPage({ preview = false }) {
  const navigate = useNavigate();
  useWaitlistSeo(preview);
  useStitchSelfScope();

  return (
    <div className="stitch-scope" style={{ minHeight: '100vh', background: S.surface, color: S.textPrimary, fontFamily: S.font, display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'hidden' }}>
      <StitchStyle />
      <style>{`
        @keyframes wlOrb { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(0,-18px,0) scale(1.05); } }
        .wl-orb { animation: wlOrb 14s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .wl-orb { animation: none !important; } }
        .wl-link { color: ${S.textSecondary}; text-decoration: none; transition: color 0.15s ease; }
        .wl-link:hover { color: ${S.brand}; }
      `}</style>

      {/* Ambient background — subtle, low-opacity, non-interactive. */}
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div className="wl-orb" style={{ position: 'absolute', top: '-12%', right: '-8%', width: 620, height: 620, borderRadius: '50%', background: salpha(S.brand, 0.16), filter: 'blur(120px)' }} />
        <div className="wl-orb" style={{ position: 'absolute', bottom: '-18%', left: '-10%', width: 520, height: 520, borderRadius: '50%', background: salpha(S.brandContainer, 0.14), filter: 'blur(120px)', animationDelay: '3s' }} />
      </div>

      {preview && (
        <div role="note" style={{ position: 'relative', zIndex: 3, textAlign: 'center', background: S.warnSoft, color: S.onWarnSoft, fontSize: 12.5, fontWeight: 700, padding: '7px 12px', fontFamily: S.font, borderBottom: `1px solid ${salpha(S.warn, 0.4)}` }}>
          Preview — this is how the Beta Waitlist page looks. It is not indexed and does not change what the public sees.
        </div>
      )}

      {/* Header */}
      <header style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px clamp(16px, 5vw, 48px)' }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ width: 34, height: 34, borderRadius: S.radiusCardSm, background: S.brand, color: S.onBrand, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="hexagon" size={18} />
          </span>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', color: S.textPrimary }}>PecanRev</span>
        </a>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 'clamp(12px, 3vw, 26px)' }}>
          <a className="wl-link" href="/terms#privacy" style={{ fontSize: 13.5, fontWeight: 500 }}>Privacy</a>
          <StitchButton variant="ghost" onClick={() => navigate('/login')}>Sign in</StitchButton>
        </nav>
      </header>

      {/* Main */}
      <main style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'clamp(24px, 5vw, 56px) clamp(16px, 5vw, 48px) 56px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', maxWidth: 1080, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'clamp(28px, 4vw, 56px)', alignItems: 'start' }}>
          {/* Hero column */}
          <section style={{ paddingTop: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: S.card, border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderRadius: S.radiusPill, fontSize: 12.5, fontWeight: 700, color: S.brand, marginBottom: 22, boxShadow: S.shadowSm }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: S.brand, display: 'inline-block' }} />
              PecanRev Beta · Early access
            </span>
            <h1 style={{ fontSize: 'clamp(30px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.025em', color: S.textPrimary, margin: '0 0 18px' }}>
              Help us cultivate the future of{' '}
              <span style={{ color: S.brand, background: salpha(S.brand, 0.12), borderRadius: 4, padding: '0 6px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>evidence synthesis.</span>
            </h1>
            <p style={{ fontSize: 'clamp(15px, 2vw, 18px)', color: S.textSecondary, lineHeight: 1.65, margin: '0 0 28px', maxWidth: 520 }}>
              We're opening our intelligent research workspace to a limited group of academic and institutional teams.
              Join the waitlist to be considered for the first wave.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {TRUST_POINTS.map((t) => (
                <li key={t.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: S.radiusControl, flexShrink: 0, background: S.brandSoft, color: S.onBrandSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={t.icon} size={15} />
                  </span>
                  <span>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: S.textPrimary }}>{t.title}</span>
                    <span style={{ display: 'block', fontSize: 13, color: S.textMuted, lineHeight: 1.5, marginTop: 2 }}>{t.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Form column */}
          <section aria-label="Beta waitlist sign-up" style={{ background: S.card, border: `1px solid ${salpha(S.outlineVariant, 0.45)}`, borderRadius: S.radiusCard, padding: 'clamp(20px, 3vw, 30px)', boxShadow: S.shadow2, position: 'relative' }}>
            <WaitlistFlow onSignIn={() => navigate('/login')} />
          </section>
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
