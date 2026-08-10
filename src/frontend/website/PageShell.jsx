/**
 * PageShell.jsx — shared chrome for every public content page.
 *
 * 111.md §§6, 23, 24, 29, 56 — reuses Landing's visual language (theme tokens,
 * inline styles, the same navbar/footer shapes) without importing Landing,
 * which is welded to the admin-editable settings fetch and framer-motion.
 *
 * SSR contract (111 master plan item 3): the rendered markup is pure — no
 * window/document reads during render, no animation — and cross-page navigation
 * uses real <a href> anchors so the prerendered HTML is crawlable and every link
 * works with JavaScript disabled.
 *
 * It is NOT hook-free any more. PageShell calls `useLocation()` and feeds the
 * matching registry entry to `usePageHead()`, which is what gives the twelve
 * content pages (ArticlePage → PageShell) a correct RUNTIME head on the dev
 * server and after any client-side navigation. Both hooks are safe under
 * renderToStaticMarkup: effects never run there, and scripts/prerender-public.mjs
 * (line ~198) wraps every route in a <MemoryRouter initialEntries={[entry.path]}>,
 * so router context always resolves. usePageHead is additionally a no-op for a
 * null entry, so an unregistered path simply leaves the shell head alone.
 */

import { useLocation } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { Icon } from '../components/icons.jsx';
import { FEATURE_LINKS, RESOURCE_LINKS, COMPANY_LINKS, PAGE_NAV_LINKS } from './siteNav.js';
import { getPublicPage, stripTrailingSlash } from './publicPages.js';
import { usePageHead } from './usePageHead.js';

const MAX_W = 1104;

function HexMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7Z" fill="none" stroke={C.acc} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 7.4 16.6 10v5L12 17.6 7.4 15v-5Z" fill={C.acc} opacity="0.85" />
    </svg>
  );
}

const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', gap: 8, background: C.acc,
  color: '#ffffff', border: `1px solid ${C.acc}`, borderRadius: 8,
  padding: '11px 22px', fontSize: 14, fontWeight: 600, fontFamily: FONT,
  textDecoration: 'none', cursor: 'pointer',
};

const btnGhost = {
  display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent',
  color: C.txt, border: `1px solid ${C.brd2}`, borderRadius: 8,
  padding: '11px 20px', fontSize: 14, fontWeight: 600, fontFamily: FONT,
  textDecoration: 'none', cursor: 'pointer',
};

export { btnPrimary, btnGhost, MAX_W };

/** Sticky public navbar. Static links only — no auth state, so it prerenders. */
function SiteNav() {
  return (
    <nav
      aria-label="Primary"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 clamp(16px, 4vw, 48px)', height: 64,
        borderBottom: `1px solid ${C.brd}`, position: 'sticky', top: 0,
        background: alpha(C.surf, 0.94), backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)', zIndex: 200,
      }}
    >
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', flexShrink: 0 }}>
        <HexMark size={20} />
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', color: C.txt }}>PecanRev</span>
      </a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
        {PAGE_NAV_LINKS.map(link => (
          <a key={link.path} href={link.path}
            style={{ fontSize: 14, color: C.txt2, textDecoration: 'none', padding: '6px 12px', borderRadius: 6 }}>
            {link.label}
          </a>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <a href="/login" style={{ ...btnGhost, padding: '9px 16px', fontSize: 13 }}>Sign in</a>
        <a href="/register" style={{ ...btnPrimary, padding: '9px 18px', fontSize: 13 }}>Get started</a>
      </div>
    </nav>
  );
}

/**
 * Visible breadcrumb trail. The matching BreadcrumbList JSON-LD lives on the
 * registry entry — 111.md §17 forbids schema that diverges from what is shown,
 * so both are generated from the same `trail` prop shape.
 */
function Breadcrumbs({ trail }) {
  if (!trail || trail.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: 22 }}>
      <ol style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', margin: 0, padding: 0, fontSize: 13, color: C.muted, fontFamily: FONT }}>
        {trail.map((crumb, i) => (
          <li key={crumb.path || crumb.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span aria-hidden="true" style={{ color: C.brd2 }}>/</span>}
            {crumb.path
              ? <a href={crumb.path} style={{ color: C.muted, textDecoration: 'none' }}>{crumb.label}</a>
              : <span aria-current="page" style={{ color: C.txt2 }}>{crumb.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 18, fontWeight: 700 }}>
        {title}
      </div>
      {links.map(link => (
        <a key={link.path} href={link.path}
          style={{ display: 'block', fontSize: 14, color: C.muted, textDecoration: 'none', marginBottom: 12 }}>
          {link.label}
        </a>
      ))}
    </div>
  );
}

/** Shared footer. Exported so Landing can render the identical link map. */
export function SiteFooter() {
  return (
    <footer style={{ borderTop: `1px solid ${C.brd}`, background: C.surf, padding: '64px clamp(16px, 4vw, 48px) 40px' }}>
      <div style={{ maxWidth: MAX_W, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 'clamp(28px, 5vw, 64px)', flexWrap: 'wrap', marginBottom: 48 }}>
          <div style={{ flex: '0 0 220px', minWidth: 0 }}>
            <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16, textDecoration: 'none' }}>
              <HexMark size={18} />
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', color: C.txt }}>PecanRev</span>
            </a>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, maxWidth: 220 }}>
              A structured workspace for systematic reviews and meta-analyses.
            </p>
          </div>
          <FooterColumn title="Product" links={FEATURE_LINKS} />
          <FooterColumn title="Learn" links={RESOURCE_LINKS} />
          <FooterColumn title="Company" links={COMPANY_LINKS} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${C.brd}`, paddingTop: 24, flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>
            &copy; {new Date().getFullYear()} PecanRev &middot; Systematic review platform
          </span>
          <a href="/#contact" style={{ fontSize: 12, color: C.muted, fontFamily: FONT, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="mail" size={12} />
            Contact us
          </a>
        </div>
      </div>
    </footer>
  );
}

/** Standard closing call to action. 111.md §58 — one primary action per page. */
export function PageCta({ title, body, primaryLabel = 'Create a free account' }) {
  return (
    <section style={{ background: C.surf, borderTop: `1px solid ${C.brd}`, padding: '72px clamp(16px, 4vw, 48px)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 800, letterSpacing: '-0.03em', color: C.txt, margin: '0 0 12px', fontFamily: FONT, lineHeight: 1.2 }}>
          {title}
        </h2>
        <p style={{ fontSize: 16.5, color: C.txt2, lineHeight: 1.75, margin: '0 0 26px' }}>{body}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/register" style={btnPrimary}>{primaryLabel}</a>
          <a href="/features" style={btnGhost}>See all features</a>
        </div>
      </div>
    </section>
  );
}

/** A related-reading block. 111.md §23 — every page links onward, none is a dead end. */
export function RelatedLinks({ title = 'Related', links }) {
  if (!links || links.length === 0) return null;
  return (
    <aside style={{ marginTop: 56, padding: '24px 26px', border: `1px solid ${C.brd}`, borderRadius: 14, background: C.surf }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: C.txt, margin: '0 0 14px', fontFamily: FONT, letterSpacing: '-0.01em' }}>{title}</h2>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
        {links.map(link => (
          <li key={link.path}>
            <a href={link.path} style={{ color: C.acc, textDecoration: 'none', fontSize: 15, fontWeight: 600 }}>{link.label}</a>
            {link.note && <span style={{ color: C.muted, fontSize: 14 }}> &mdash; {link.note}</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * The page frame.
 *
 * @param {object}   props
 * @param {string}   props.eyebrow   small uppercase kicker above the h1
 * @param {string}   props.h1        the page's single <h1>
 * @param {string}   props.lede      one-paragraph summary directly under the h1
 * @param {object[]} props.trail     breadcrumb trail [{label, path?}]
 * @param {string}   props.updated   ISO date shown as "Last reviewed"
 * @param {string}   props.author    visible byline (111.md §36)
 * @param {boolean}  props.narrow    constrain the body to reading width
 */
export function PageShell({ eyebrow, h1, lede, trail, updated, author, narrow = true, children, footerCta }) {
  // Runtime head for every page that frames itself with PageShell. The registry is
  // keyed on the canonical, slash-stripped path; an unknown path yields undefined,
  // and usePageHead(null) is a deliberate no-op.
  const { pathname } = useLocation();
  usePageHead(getPublicPage(stripTrailingSlash(pathname)) || null);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: FONT, color: C.txt }}>
      <SiteNav />
      <main>
        <header style={{ borderBottom: `1px solid ${C.brd}`, background: C.surf, padding: 'clamp(36px, 6vw, 68px) clamp(16px, 4vw, 48px) clamp(32px, 5vw, 52px)' }}>
          <div style={{ maxWidth: narrow ? 800 : MAX_W, margin: '0 auto' }}>
            <Breadcrumbs trail={trail} />
            {eyebrow && (
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.acc, marginBottom: 14 }}>
                {eyebrow}
              </div>
            )}
            <h1 style={{ fontSize: 'clamp(30px, 4.6vw, 46px)', fontWeight: 800, letterSpacing: '-0.035em', color: C.txt, lineHeight: 1.1, margin: '0 0 18px' }}>
              {h1}
            </h1>
            {lede && (
              <p style={{ fontSize: 'clamp(16px, 1.9vw, 19px)', color: C.txt2, lineHeight: 1.7, margin: 0, maxWidth: 720 }}>
                {lede}
              </p>
            )}
            {(author || updated) && (
              <div style={{ marginTop: 22, fontSize: 13, color: C.muted, fontFamily: MONO, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {author && <span>By {author}</span>}
                {updated && <span>Last reviewed <time dateTime={updated}>{updated}</time></span>}
              </div>
            )}
          </div>
        </header>

        <div style={{ padding: 'clamp(32px, 5vw, 56px) clamp(16px, 4vw, 48px) 72px' }}>
          <div style={{ maxWidth: narrow ? 800 : MAX_W, margin: '0 auto' }}>
            {children}
          </div>
        </div>

        {footerCta !== false && (
          <PageCta
            title={(footerCta && footerCta.title) || 'Run your next review in one workspace'}
            body={(footerCta && footerCta.body) || 'PecanRev keeps the search strategy, screening decisions, extracted data, analysis, and manuscript in a single project with a full audit trail.'}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export default PageShell;
