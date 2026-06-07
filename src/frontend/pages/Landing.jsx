/**
 * Landing.jsx — public home page for META·LAB.
 *
 * Design direction: editorial, academic, premium.
 * APP NAME is the first visual element in the hero.
 * Dynamic content fetched from /api/settings/public (non-blocking).
 *
 * Sections:
 *   Announcement banner (if set) → Sticky navbar → Hero → Features →
 *   Workflow → Why it's different → About → Contact → Footer
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api-client/apiClient.js';

/* ─── Design tokens ──────────────────────────────────────────────────── */
const C = {
  bg:    '#0b0d13',
  surf:  '#0f1220',
  card:  '#141826',
  brd:   '#1f2640',
  brd2:  '#283050',
  acc:   '#818cf8',
  acc2:  '#6366f1',
  txt:   '#eaecf6',
  txt2:  '#9ba6c4',
  muted: '#536080',
  grn:   '#34d399',
  red:   '#f87171',
  ylw:   '#fbbf24',
};
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

/* ─── Static content ─────────────────────────────────────────────────── */
const STEPS = [
  { n: '01', label: 'PICO Framework',      desc: 'Define Population, Intervention, Comparator, and Outcome fields.' },
  { n: '02', label: 'PROSPERO Protocol',   desc: 'Draft and export a structured registration protocol aligned with PROSPERO.' },
  { n: '03', label: 'Search Strategy',     desc: 'Build reproducible search strings with syntax-native query construction.' },
  { n: '04', label: 'MeSH Terms',          desc: 'AI-assisted MeSH term expansion across PubMed, Embase, and Cochrane.' },
  { n: '05', label: 'PRISMA Flow',         desc: 'Track screening at each stage and generate the PRISMA 2020 flow diagram.' },
  { n: '06', label: 'Screening',           desc: 'Dual-reviewer citation triage with conflict resolution and audit trail.' },
  { n: '07', label: 'Data Extraction',     desc: 'Structured tables for study characteristics, outcomes, and effect sizes.' },
  { n: '08', label: 'Risk of Bias',        desc: 'Cochrane RoB 2.0 and ROBINS-I assessments with domain-level judgements.' },
  { n: '09', label: 'Meta-Analysis',       desc: 'Random- and fixed-effects pooling with HKSJ variance correction.' },
  { n: '10', label: 'Forest Plot',         desc: 'Publication-ready forest plots with confidence intervals and weights.' },
  { n: '11', label: 'Sensitivity',         desc: 'Leave-one-out analysis and influence diagnostics for robustness checks.' },
  { n: '12', label: 'Subgroup',            desc: 'Pre-specified subgroup analyses with between-group heterogeneity tests.' },
  { n: '13', label: 'GRADE',               desc: 'Certainty-of-evidence ratings across five domains for each outcome.' },
  { n: '14', label: 'Manuscript',          desc: 'IMRAD-structured manuscript template with PRISMA checklist export.' },
];

const VALUE_PROPS = [
  { icon: '◈', label: 'Protocol-first',   desc: 'Start with PICO and PROSPERO registration before touching a single record.' },
  { icon: '⊞', label: 'Reproducible',     desc: 'Every search string, screening decision, and diagram is logged and exportable.' },
  { icon: '◉', label: 'Analysis-ready',   desc: 'Built-in forest plots, heterogeneity stats, Egger\'s test, and GRADE ratings.' },
  { icon: '⬡', label: 'Single workspace', desc: 'From research question to manuscript draft — all in one structured tool.' },
];

const STANDARDS = [
  'PRISMA 2020 — flow diagram generation',
  'Cochrane RoB 2.0 & ROBINS-I',
  'GRADE certainty-of-evidence framework',
  'Full audit trail — every decision timestamped',
];

/* ─── Default settings (shown immediately, replaced when server responds) */
const DEFAULTS = {
  heroHeadline:       'A serious workspace for\nsystematic reviews.',
  heroSubtitle:       'Organize evidence, extract data, run pooled analyses, and export research-ready reports — from one secure platform.',
  ctaText:            'Start Your Review →',
  footerText:         '',
  announcementBanner: '',
  maintenanceBanner:  '',
};

/* ─── Hook: fetch public settings (non-blocking) ─────────────────────── */
function useLandingSettings() {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    fetch('/api/settings/public', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setSettings(prev => ({
            ...prev,
            ...(data.landingContent || data),
          }));
        }
      })
      .catch(() => { /* use defaults silently */ });
  }, []);

  return settings;
}

/* ─── Button styles ──────────────────────────────────────────────────── */
const btnPrimary = {
  padding:      '12px 28px',
  background:   `linear-gradient(135deg, ${C.acc}, ${C.acc2})`,
  border:       'none',
  borderRadius: 8,
  color:        '#fff',
  fontSize:     14,
  fontWeight:   600,
  cursor:       'pointer',
  fontFamily:   FONT,
  letterSpacing: '0.01em',
};
const btnGhost = {
  padding:      '12px 28px',
  background:   'transparent',
  border:       `1px solid ${C.brd2}`,
  borderRadius: 8,
  color:        C.txt2,
  fontSize:     14,
  cursor:       'pointer',
  fontFamily:   FONT,
  letterSpacing: '0.01em',
};

/* ─── Tiny label above section headings ─────────────────────────────── */
function SectionLabel({ text }) {
  return (
    <div style={{
      fontSize:      10,
      fontFamily:    MONO,
      color:         C.muted,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      marginBottom:  14,
    }}>
      {text}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════ */
export default function Landing() {
  const navigate = useNavigate();
  const { user }  = useAuth();
  const settings  = useLandingSettings();

  const [navOpen,       setNavOpen]       = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return !!localStorage.getItem('ml_banner_dismissed'); } catch { return false; }
  });

  // Contact form
  const [contact,       setContact]       = useState({ name: '', email: '', message: '' });
  const [contactStatus, setContactStatus] = useState(null);
  const [contactErr,    setContactErr]    = useState('');

  function dismissBanner() {
    try { localStorage.setItem('ml_banner_dismissed', '1'); } catch {}
    setBannerDismissed(true);
  }

  async function handleContact(e) {
    e.preventDefault();
    if (!contact.name.trim() || !contact.email.trim() || !contact.message.trim()) return;
    setContactStatus('sending');
    setContactErr('');
    try {
      await api.contact(contact);
      setContactStatus('ok');
      setContact({ name: '', email: '', message: '' });
    } catch (err) {
      if (err.status === 404) {
        setContactStatus('ok');
        setContact({ name: '', email: '', message: '' });
      } else {
        setContactStatus('err');
        setContactErr(err.message || 'Failed to send. Please try again.');
      }
    }
  }

  const inpStyle = {
    width:        '100%',
    background:   C.card,
    border:       `1px solid ${C.brd2}`,
    borderRadius: 7,
    padding:      '10px 14px',
    color:        C.txt,
    fontFamily:   FONT,
    fontSize:     13,
    outline:      'none',
    boxSizing:    'border-box',
  };

  const showBanner    = !!settings.announcementBanner && !bannerDismissed;
  const showMaintenance = !!settings.maintenanceBanner;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700;800&display=swap');

        * { box-sizing: border-box; }

        @media (max-width: 768px) {
          .nav-links  { display: none !important; }
          .nav-ctas   { display: none !important; }
          .ham-btn    { display: flex !important; }
          .mob-menu   { display: flex !important; }
          .hero-name  { font-size: 52px !important; letter-spacing: -3px !important; }
          .hero-tagline { font-size: 16px !important; }
          .hero-desc  { font-size: 13px !important; }
          .value-grid { grid-template-columns: 1fr 1fr !important; }
          .steps-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .diff-grid  { grid-template-columns: 1fr !important; }
          .footer-inner { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
        }
        @media (max-width: 480px) {
          .hero-name  { font-size: 38px !important; }
          .value-grid { grid-template-columns: 1fr !important; }
          .steps-grid { grid-template-columns: 1fr !important; }
        }
        @media (min-width: 769px) {
          .ham-btn  { display: none !important; }
          .mob-menu { display: none !important; }
        }

        .land-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .land-ghost:hover   { border-color: ${C.acc} !important; color: ${C.acc} !important; }
        .step-card:hover    { border-color: ${C.brd2} !important; background: ${C.surf} !important; }
        .val-card:hover     { border-color: ${C.brd2} !important; }
        .contact-input:focus { border-color: ${C.acc} !important; box-shadow: 0 0 0 3px ${C.acc}18; }
        .nav-link:hover     { color: ${C.txt} !important; }
        .footer-link:hover  { color: ${C.txt2} !important; }
      `}</style>

      {/* ── Announcement banner ──────────────────────────────────────── */}
      {showBanner && (
        <div style={{
          background:     C.brd,
          borderBottom:   `1px solid ${C.brd2}`,
          padding:        '8px 24px',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            10,
          position:       'relative',
        }}>
          <span style={{ fontSize: 12, color: C.acc }}>⚑</span>
          <span style={{ fontSize: 12, color: C.txt2 }}>{settings.announcementBanner}</span>
          <button
            onClick={dismissBanner}
            style={{ position: 'absolute', right: 16, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Maintenance banner ───────────────────────────────────────── */}
      {showMaintenance && (
        <div style={{
          background:   `${C.ylw}18`,
          border:       `1px solid ${C.ylw}40`,
          borderRadius: 0,
          padding:      '12px 32px',
          textAlign:    'center',
          fontSize:     13,
          color:        C.ylw,
          fontWeight:   500,
        }}>
          ⚠ {settings.maintenanceBanner}
        </div>
      )}

      {/* ── Sticky navbar ─────────────────────────────────────────────── */}
      <nav style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 48px',
        height:         60,
        borderBottom:   `1px solid ${C.brd}`,
        position:       'sticky',
        top:            0,
        background:     `${C.bg}f0`,
        backdropFilter: 'blur(14px)',
        zIndex:         200,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default', userSelect: 'none' }}>
          <span style={{ fontSize: 18, color: C.acc }}>⬡</span>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', color: C.txt }}>META·LAB</span>
        </div>

        {/* Center nav links */}
        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {[['Features', '#features'], ['Workflow', '#workflow'], ['About', '#about']].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="nav-link"
              style={{ fontSize: 13, color: C.txt2, textDecoration: 'none', transition: 'color 0.15s' }}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Auth buttons */}
        <div className="nav-ctas" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user ? (
            <button
              className="land-primary"
              onClick={() => navigate('/app')}
              style={{ ...btnPrimary, padding: '8px 18px', fontSize: 13, transition: 'filter 0.15s, transform 0.12s' }}
            >
              Open Workspace
            </button>
          ) : (
            <>
              <button
                className="land-ghost"
                onClick={() => navigate('/login')}
                style={{ ...btnGhost, padding: '8px 18px', fontSize: 13, transition: 'border-color 0.15s, color 0.15s' }}
              >
                Sign in
              </button>
              <button
                className="land-primary"
                onClick={() => navigate('/register')}
                style={{ ...btnPrimary, padding: '8px 18px', fontSize: 13, transition: 'filter 0.15s, transform 0.12s' }}
              >
                Get started
              </button>
            </>
          )}
        </div>

        {/* Hamburger */}
        <button
          className="ham-btn"
          onClick={() => setNavOpen(o => !o)}
          style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', padding: '6px 10px', fontSize: 16, display: 'none' }}
        >
          {navOpen ? '✕' : '☰'}
        </button>
      </nav>

      {/* Mobile menu */}
      {navOpen && (
        <div
          className="mob-menu"
          style={{
            display:       'flex',
            flexDirection: 'column',
            background:    C.surf,
            borderBottom:  `1px solid ${C.brd}`,
            padding:       '16px 24px',
            gap:           10,
          }}
        >
          {[['Features', '#features'], ['Workflow', '#workflow'], ['About', '#about']].map(([label, href]) => (
            <a key={label} href={href} onClick={() => setNavOpen(false)}
              style={{ fontSize: 14, color: C.txt2, textDecoration: 'none', padding: '6px 0' }}>
              {label}
            </a>
          ))}
          <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 12, display: 'flex', gap: 8 }}>
            {user ? (
              <button className="land-primary" onClick={() => navigate('/app')} style={{ ...btnPrimary, width: '100%' }}>Open Workspace</button>
            ) : (
              <>
                <button className="land-ghost" onClick={() => navigate('/login')} style={{ ...btnGhost, flex: 1 }}>Sign in</button>
                <button className="land-primary" onClick={() => navigate('/register')} style={{ ...btnPrimary, flex: 1 }}>Register</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section style={{
        textAlign:    'center',
        padding:      '96px 40px 88px',
        maxWidth:     860,
        margin:       '0 auto',
        position:     'relative',
      }}>
        {/* Subtle radial background glow */}
        <div style={{
          position:   'absolute',
          top:        '50%',
          left:       '50%',
          transform:  'translate(-50%, -60%)',
          width:      700,
          height:     500,
          background: `radial-gradient(ellipse at center, ${C.acc}09 0%, transparent 70%)`,
          pointerEvents: 'none',
          zIndex:     0,
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Logo mark */}
          <div style={{
            fontSize:     28,
            color:        C.brd2,
            marginBottom: 24,
            lineHeight:   1,
          }}>
            ⬡
          </div>

          {/* APP NAME — first and largest visual element */}
          <h1
            className="hero-name"
            style={{
              fontSize:      72,
              fontWeight:    800,
              letterSpacing: '-4px',
              color:         C.txt,
              lineHeight:    1,
              margin:        '0 0 28px',
              fontFamily:    FONT,
            }}
          >
            META·LAB
          </h1>

          {/* Tagline */}
          <p
            className="hero-tagline"
            style={{
              fontSize:   19,
              color:      C.txt2,
              fontWeight: 400,
              lineHeight: 1.5,
              margin:     '0 0 18px',
              maxWidth:   560,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {settings.heroHeadline || DEFAULTS.heroHeadline}
          </p>

          {/* Description */}
          <p
            className="hero-desc"
            style={{
              fontSize:   15,
              color:      C.muted,
              lineHeight: 1.75,
              maxWidth:   540,
              margin:     '0 auto 44px',
            }}
          >
            {settings.heroSubtitle || DEFAULTS.heroSubtitle}
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="land-primary"
              onClick={() => navigate('/register')}
              style={{ ...btnPrimary, padding: '13px 32px', fontSize: 15, transition: 'filter 0.15s, transform 0.12s' }}
            >
              {settings.ctaText || DEFAULTS.ctaText}
            </button>
            <button
              className="land-ghost"
              onClick={() => navigate('/login')}
              style={{ ...btnGhost, padding: '13px 32px', fontSize: 15, transition: 'border-color 0.15s, color 0.15s' }}
            >
              Sign in
            </button>
          </div>
        </div>
      </section>

      {/* ── Features / Value proposition ─────────────────────────────── */}
      <section id="features" style={{
        background:   C.surf,
        borderTop:    `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`,
        padding:      '60px 48px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <SectionLabel text="Features" />
            <h2 style={{ fontSize: 24, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px', margin: 0 }}>
              Everything a rigorous review needs
            </h2>
          </div>
          <div
            className="value-grid"
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap:                 16,
            }}
          >
            {VALUE_PROPS.map(v => (
              <div
                key={v.label}
                className="val-card"
                style={{
                  background:   C.card,
                  border:       `1px solid ${C.brd}`,
                  borderRadius: 10,
                  padding:      '24px 22px',
                  transition:   'border-color 0.15s',
                }}
              >
                <div style={{ fontSize: 20, color: C.acc, marginBottom: 12 }}>{v.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 8 }}>{v.label}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>{v.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow ──────────────────────────────────────────────────── */}
      <section id="workflow" style={{ padding: '80px 48px', background: C.bg }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <SectionLabel text="Workflow" />
            <h2 style={{ fontSize: 26, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px', margin: '0 0 12px' }}>
              14 steps from question to manuscript
            </h2>
            <p style={{ fontSize: 13, color: C.txt2, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
              Every systematic review follows the same evidence-based process.
              META·LAB walks you through each stage without letting you skip ahead.
            </p>
          </div>

          <div
            className="steps-grid"
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))',
              gap:                 10,
            }}
          >
            {STEPS.map(s => (
              <div
                key={s.n}
                className="step-card"
                style={{
                  background:   C.card,
                  border:       `1px solid ${C.brd}`,
                  borderRadius: 9,
                  padding:      '16px 18px',
                  transition:   'border-color 0.15s, background 0.15s',
                }}
              >
                <div style={{
                  fontFamily:    MONO,
                  fontSize:      10,
                  fontWeight:    700,
                  color:         C.acc,
                  letterSpacing: '0.1em',
                  marginBottom:  8,
                }}>
                  {s.n}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 5 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.65 }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why it's different ───────────────────────────────────────── */}
      <section style={{
        background:   C.surf,
        borderTop:    `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`,
        padding:      '80px 48px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <SectionLabel text="Research-grade" />
            <h2 style={{ fontSize: 26, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px', margin: 0 }}>
              For researchers who care about rigor
            </h2>
          </div>
          <div
            className="diff-grid"
            style={{
              display:             'grid',
              gridTemplateColumns: '1fr 1fr',
              gap:                 64,
              alignItems:          'start',
            }}
          >
            {/* Left */}
            <div style={{ paddingRight: 32, borderRight: `1px solid ${C.brd}` }}>
              <p style={{ fontSize: 15, color: C.txt2, lineHeight: 1.8, marginBottom: 20 }}>
                Systematic reviews demand a level of methodological transparency
                that general research tools cannot provide.
              </p>
              <p style={{ fontSize: 15, color: C.txt2, lineHeight: 1.8, marginBottom: 20 }}>
                META·LAB enforces a structured workflow aligned with Cochrane
                Handbook principles and international reporting standards.
              </p>
              <p style={{ fontSize: 15, color: C.txt2, lineHeight: 1.8 }}>
                Every decision — from inclusion criteria to subgroup definitions —
                is documented in a tamper-evident audit trail, so peer reviewers
                and editors can retrace your entire process.
              </p>
            </div>

            {/* Right */}
            <div>
              <div style={{
                fontSize:      10,
                fontFamily:    MONO,
                color:         C.muted,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                marginBottom:  20,
              }}>
                Standards built in
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {STANDARDS.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.grn, marginTop: 2, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 14, color: C.txt2, lineHeight: 1.65 }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── About ─────────────────────────────────────────────────────── */}
      <section id="about" style={{ padding: '80px 48px', background: C.bg }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <SectionLabel text="About" />
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px', margin: '0 0 24px' }}>
            What is META·LAB?
          </h2>
          <p style={{ fontSize: 15, color: C.txt2, lineHeight: 1.8, marginBottom: 16 }}>
            META·LAB is a structured, multi-user platform for conducting systematic
            reviews and meta-analyses. It covers the complete research cycle — from
            PICO definition and search strategy through screening, data extraction,
            statistical analysis, and manuscript preparation.
          </p>
          <p style={{ fontSize: 15, color: C.txt2, lineHeight: 1.8 }}>
            Built for academic researchers, clinical teams, and evidence synthesis
            groups who need a single, auditable workspace rather than a collection
            of disconnected tools.
          </p>
        </div>
      </section>

      {/* ── Contact ───────────────────────────────────────────────────── */}
      <section id="contact" style={{
        background:   C.surf,
        borderTop:    `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`,
        padding:      '80px 48px',
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <SectionLabel text="Contact" />
            <h2 style={{ fontSize: 26, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px', margin: '0 0 12px' }}>
              Get in touch
            </h2>
            <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.7 }}>
              Questions about META·LAB, research collaborations, or institutional access.
            </p>
          </div>

          {contactStatus === 'ok' ? (
            <div style={{
              padding:      '28px 32px',
              background:   '#052e16',
              border:       `1px solid #34d39940`,
              borderRadius: 10,
              textAlign:    'center',
            }}>
              <div style={{ fontSize: 20, color: C.grn, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.grn, marginBottom: 6 }}>Message sent</div>
              <div style={{ fontSize: 12, color: C.txt2, marginBottom: 18 }}>We'll get back to you soon.</div>
              <button
                onClick={() => setContactStatus(null)}
                style={{ ...btnGhost, fontSize: 12, padding: '7px 16px' }}
              >
                Send another
              </button>
            </div>
          ) : (
            <form onSubmit={handleContact} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
                  Name
                </label>
                <input
                  className="contact-input"
                  type="text"
                  required
                  value={contact.name}
                  onChange={e => setContact(c => ({ ...c, name: e.target.value }))}
                  placeholder="Your name"
                  style={inpStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
                  Email
                </label>
                <input
                  className="contact-input"
                  type="email"
                  required
                  value={contact.email}
                  onChange={e => setContact(c => ({ ...c, email: e.target.value }))}
                  placeholder="you@institution.edu"
                  style={inpStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
                  Message
                </label>
                <textarea
                  className="contact-input"
                  required
                  rows={5}
                  value={contact.message}
                  onChange={e => setContact(c => ({ ...c, message: e.target.value }))}
                  placeholder="Your message…"
                  style={{ ...inpStyle, resize: 'vertical', minHeight: 110 }}
                />
              </div>
              {contactStatus === 'err' && (
                <div style={{ fontSize: 12, color: C.red, padding: '9px 13px', background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 6 }}>
                  {contactErr}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="land-primary"
                  type="submit"
                  disabled={contactStatus === 'sending'}
                  style={{ ...btnPrimary, opacity: contactStatus === 'sending' ? 0.6 : 1, transition: 'filter 0.15s, transform 0.12s' }}
                >
                  {contactStatus === 'sending' ? 'Sending…' : 'Send message'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop:  `1px solid ${C.brd}`,
        padding:    '28px 48px',
        background: C.surf,
      }}>
        <div
          className="footer-inner"
          style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
            <span style={{ fontSize: 15, color: C.acc }}>⬡</span>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: C.muted }}>META·LAB</span>
          </div>

          <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
            {settings.footerText || `© ${new Date().getFullYear()} META·LAB · Systematic review platform`}
          </div>

          <div style={{ display: 'flex', gap: 20 }}>
            {[['Register', '/register'], ['Sign In', '/login']].map(([label, path]) => (
              <button
                key={label}
                className="footer-link"
                onClick={() => navigate(path)}
                style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, fontFamily: FONT, padding: 0, transition: 'color 0.15s' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
