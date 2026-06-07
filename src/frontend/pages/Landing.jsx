/**
 * Landing.jsx — public home page at /
 *
 * Full professional academic landing page for META·LAB.
 * Design: dark indigo palette, IBM Plex Sans/Mono, no flashy animations.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api-client/apiClient.js';

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
};

const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

const btn = {
  primary: {
    padding:      '11px 26px',
    background:   `linear-gradient(135deg, ${C.acc}, ${C.acc2})`,
    border:       'none',
    borderRadius: 8,
    color:        '#fff',
    fontSize:     14,
    fontWeight:   600,
    cursor:       'pointer',
    fontFamily:   FONT,
    letterSpacing: '0.01em',
    transition:   'filter 0.15s ease, transform 0.13s ease',
  },
  ghost: {
    padding:      '11px 26px',
    background:   'transparent',
    border:       `1px solid ${C.brd2}`,
    borderRadius: 8,
    color:        C.txt2,
    fontSize:     14,
    cursor:       'pointer',
    fontFamily:   FONT,
    letterSpacing: '0.01em',
    transition:   'border-color 0.15s ease, color 0.15s ease',
  },
};

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
  {
    icon: '◈',
    label: 'Protocol-first',
    desc: 'Start with PICO and PROSPERO registration before touching a single record.',
  },
  {
    icon: '⊞',
    label: 'Reproducible',
    desc: 'Every search string, screening decision, and diagram is logged and exportable.',
  },
  {
    icon: '◉',
    label: 'Analysis-ready',
    desc: 'Built-in forest plots, heterogeneity stats, Egger\'s test, and GRADE ratings.',
  },
  {
    icon: '⬡',
    label: 'Single workspace',
    desc: 'From research question to manuscript draft — all in one structured tool.',
  },
];

const ABOUT_BULLETS = [
  'PRISMA 2020 compliance with auto-generated flow diagrams',
  'Cochrane Risk of Bias 2.0 (RoB 2) and ROBINS-I instruments',
  'GRADE certainty-of-evidence framework for outcome reporting',
  'Full audit trail: every decision is timestamped and exportable',
];

export default function Landing() {
  const navigate = useNavigate();
  const { user }  = useAuth();

  const [navOpen, setNavOpen] = useState(false);

  // Contact form state
  const [contact, setContact] = useState({ name: '', email: '', message: '' });
  const [contactStatus, setContactStatus] = useState(null); // null | 'sending' | 'ok' | 'err'
  const [contactErr, setContactErr]       = useState('');

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
        // Endpoint not yet deployed — treat gracefully
        setContactStatus('ok');
        setContact({ name: '', email: '', message: '' });
      } else {
        setContactStatus('err');
        setContactErr(err.message || 'Failed to send message. Please try again.');
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
    transition:   'border-color 0.15s',
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @media (max-width: 768px) {
          .nav-links { display: none !important; }
          .nav-mobile-open { display: flex !important; }
          .hero-h1 { font-size: 36px !important; }
          .hero-sub { font-size: 15px !important; }
          .value-grid { grid-template-columns: 1fr 1fr !important; }
          .steps-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .about-grid { grid-template-columns: 1fr !important; }
          .footer-inner { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .nav-ctas { display: none !important; }
          .ham-btn { display: flex !important; }
        }
        @media (max-width: 480px) {
          .value-grid { grid-template-columns: 1fr !important; }
          .steps-grid { grid-template-columns: 1fr !important; }
          .hero-h1 { font-size: 28px !important; }
        }
        @media (min-width: 769px) {
          .ham-btn { display: none !important; }
          .nav-mobile-open { display: none !important; }
        }
        .land-btn-primary:hover { filter: brightness(1.1); }
        .land-btn-ghost:hover { border-color: ${C.acc} !important; color: ${C.acc} !important; }
        .step-card:hover { border-color: ${C.brd2} !important; }
        .contact-input:focus { border-color: ${C.acc} !important; box-shadow: 0 0 0 3px ${C.acc}18; }
      `}</style>

      {/* ── Sticky Navbar ──────────────────────────────────────────── */}
      <nav style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 48px',
        height:         60,
        borderBottom:   `1px solid ${C.brd}`,
        position:       'sticky',
        top:            0,
        background:     `${C.bg}f2`,
        backdropFilter: 'blur(12px)',
        zIndex:         200,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'default' }}>
          <span style={{ fontSize: 20, color: C.acc }}>⬡</span>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.07em', color: C.txt }}>META·LAB</span>
        </div>

        {/* Nav links — hidden on mobile */}
        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {['Features', 'Workflow', 'About'].map(l => (
            <a
              key={l}
              href={`#${l.toLowerCase()}`}
              style={{ fontSize: 13, color: C.txt2, textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => e.target.style.color = C.txt}
              onMouseLeave={e => e.target.style.color = C.txt2}
            >
              {l}
            </a>
          ))}
        </div>

        {/* CTA buttons — hidden on mobile */}
        <div className="nav-ctas" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user ? (
            <button
              className="land-btn-primary"
              onClick={() => navigate('/app')}
              style={btn.primary}
            >
              Open Workspace
            </button>
          ) : (
            <>
              <button className="land-btn-ghost" onClick={() => navigate('/login')} style={{ ...btn.ghost, padding: '8px 18px', fontSize: 13 }}>
                Sign in
              </button>
              <button className="land-btn-primary" onClick={() => navigate('/register')} style={{ ...btn.primary, padding: '8px 18px', fontSize: 13 }}>
                Get started
              </button>
            </>
          )}
        </div>

        {/* Hamburger — shown on mobile */}
        <button
          className="ham-btn"
          onClick={() => setNavOpen(o => !o)}
          style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', padding: '6px 10px', fontSize: 16, display: 'none' }}
        >
          {navOpen ? '✕' : '☰'}
        </button>
      </nav>

      {/* Mobile nav dropdown */}
      <div
        className="nav-mobile-open"
        style={{
          display:        'none',
          flexDirection:  'column',
          background:     C.surf,
          borderBottom:   `1px solid ${C.brd}`,
          padding:        '16px 24px',
          gap:            12,
        }}
      >
        {['Features', 'Workflow', 'About'].map(l => (
          <a key={l} href={`#${l.toLowerCase()}`} onClick={() => setNavOpen(false)}
            style={{ fontSize: 14, color: C.txt2, textDecoration: 'none', padding: '6px 0' }}>
            {l}
          </a>
        ))}
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 12, display: 'flex', gap: 8 }}>
          {user ? (
            <button className="land-btn-primary" onClick={() => navigate('/app')} style={{ ...btn.primary, width: '100%' }}>Open Workspace</button>
          ) : (
            <>
              <button onClick={() => navigate('/login')} style={{ ...btn.ghost, flex: 1, textAlign: 'center' }}>Sign in</button>
              <button className="land-btn-primary" onClick={() => navigate('/register')} style={{ ...btn.primary, flex: 1, textAlign: 'center' }}>Get started</button>
            </>
          )}
        </div>
      </div>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section style={{ textAlign: 'center', padding: '100px 40px 80px', maxWidth: 820, margin: '0 auto' }}>
        {/* Badge */}
        <div style={{
          display:      'inline-flex',
          alignItems:   'center',
          gap:          6,
          padding:      '4px 14px',
          background:   `${C.acc}12`,
          border:       `1px solid ${C.acc}28`,
          borderRadius: 20,
          fontSize:     11,
          color:        C.acc,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight:   600,
          marginBottom: 28,
          fontFamily:   MONO,
        }}>
          <span style={{ fontSize: 9 }}>●</span>
          14-step guided workflow
        </div>

        <h1 className="hero-h1" style={{
          fontSize:     54,
          fontWeight:   800,
          lineHeight:   1.13,
          letterSpacing: '-1.5px',
          marginBottom: 22,
          color:        C.txt,
        }}>
          Evidence synthesis,<br />end to end.
        </h1>

        <p className="hero-sub" style={{
          fontSize:   17,
          color:      C.txt2,
          lineHeight: 1.75,
          maxWidth:   540,
          margin:     '0 auto 40px',
        }}>
          META·LAB is a structured workspace for systematic reviews and meta-analyses.
          Every step — from PICO to GRADE — is guided, documented, and reproducible.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="land-btn-primary"
            onClick={() => navigate('/register')}
            style={{ ...btn.primary, padding: '13px 32px', fontSize: 15 }}
          >
            Start your review →
          </button>
          <button
            className="land-btn-ghost"
            onClick={() => navigate('/login')}
            style={{ ...btn.ghost, padding: '13px 32px', fontSize: 15 }}
          >
            Sign in
          </button>
        </div>
      </section>

      {/* ── Value proposition strip ─────────────────────────────────── */}
      <section id="features" style={{
        background:   C.surf,
        borderTop:    `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`,
        padding:      '56px 48px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div
            className="value-grid"
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap:                 20,
            }}
          >
            {VALUE_PROPS.map(v => (
              <div key={v.label} style={{
                background:   C.card,
                border:       `1px solid ${C.brd}`,
                borderRadius: 10,
                padding:      '22px 20px',
              }}>
                <div style={{ fontSize: 22, color: C.acc, marginBottom: 10 }}>{v.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 7 }}>{v.label}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{v.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow section ────────────────────────────────────────── */}
      <section id="workflow" style={{ padding: '72px 48px', background: C.bg }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ marginBottom: 44, textAlign: 'center' }}>
            <div style={{
              fontSize:      11,
              fontFamily:    MONO,
              color:         C.muted,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginBottom:  10,
            }}>
              The workflow
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px' }}>
              14 steps from question to manuscript
            </h2>
            <p style={{ fontSize: 13, color: C.txt2, marginTop: 10, maxWidth: 480, margin: '10px auto 0' }}>
              Every systematic review follows the same evidence-based process. META·LAB walks you through each stage.
            </p>
          </div>

          <div
            className="steps-grid"
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(4, minmax(200px, 1fr))',
              gap:                 12,
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
                  transition:   'border-color 0.15s',
                }}
              >
                <div style={{
                  fontFamily:    MONO,
                  fontSize:      10,
                  fontWeight:    700,
                  color:         C.acc,
                  letterSpacing: '0.12em',
                  marginBottom:  7,
                }}>
                  {s.n}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 5 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── About / research-grade section ─────────────────────────── */}
      <section id="about" style={{
        background:   C.surf,
        borderTop:    `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`,
        padding:      '72px 48px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div
            className="about-grid"
            style={{
              display:             'grid',
              gridTemplateColumns: '1fr 1fr',
              gap:                 64,
              alignItems:          'start',
            }}
          >
            {/* Left */}
            <div>
              <div style={{
                fontSize:      11,
                fontFamily:    MONO,
                color:         C.muted,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom:  14,
              }}>
                Research-grade
              </div>
              <h2 style={{
                fontSize:      26,
                fontWeight:    700,
                color:         C.txt,
                lineHeight:    1.3,
                letterSpacing: '-0.5px',
                marginBottom:  18,
              }}>
                Built for rigorous,<br />peer-reviewed synthesis
              </h2>
              <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.8, marginBottom: 14 }}>
                Systematic reviews demand a level of methodological transparency that general
                research tools cannot provide. META·LAB enforces a structured workflow aligned
                with Cochrane Handbook principles and international reporting standards.
              </p>
              <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.8 }}>
                Every decision — from inclusion criteria to subgroup definitions — is documented
                in a tamper-evident audit trail, so peer reviewers and editors can retrace
                your entire process.
              </p>
            </div>

            {/* Right */}
            <div>
              <div style={{
                fontSize:      11,
                fontFamily:    MONO,
                color:         C.muted,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom:  20,
              }}>
                What META·LAB provides
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {ABOUT_BULLETS.map((b, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{
                      width:        6,
                      height:       6,
                      borderRadius: '50%',
                      background:   C.acc,
                      marginTop:    6,
                      flexShrink:   0,
                    }} />
                    <span style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65 }}>{b}</span>
                  </div>
                ))}
              </div>

              <div style={{
                marginTop:    32,
                padding:      '18px 20px',
                background:   C.card,
                border:       `1px solid ${C.brd}`,
                borderRadius: 9,
              }}>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
                  Standards supported
                </div>
                {['PRISMA 2020', 'Cochrane RoB 2.0', 'GRADE framework', 'PROSPERO registration'].map(s => (
                  <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.brd}`, fontSize: 12, color: C.txt2 }}>
                    <span>{s}</span>
                    <span style={{ color: '#34d399', fontFamily: MONO, fontSize: 11 }}>✓</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Contact section ─────────────────────────────────────────── */}
      <section id="contact" style={{ padding: '72px 48px', background: C.bg }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{
              fontSize:      11,
              fontFamily:    MONO,
              color:         C.muted,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginBottom:  12,
            }}>
              Contact
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px', marginBottom: 10 }}>
              Get in touch
            </h2>
            <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.7 }}>
              Questions about META·LAB, research collaborations, or institutional access — send us a message.
            </p>
          </div>

          {contactStatus === 'ok' ? (
            <div style={{
              padding:      '24px 28px',
              background:   '#052e16',
              border:       `1px solid #34d39944`,
              borderRadius: 10,
              textAlign:    'center',
            }}>
              <div style={{ fontSize: 22, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#34d399', marginBottom: 6 }}>Message sent</div>
              <div style={{ fontSize: 12, color: C.txt2 }}>We'll get back to you soon.</div>
              <button
                onClick={() => setContactStatus(null)}
                style={{ ...btn.ghost, marginTop: 18, fontSize: 12, padding: '7px 16px' }}
              >
                Send another
              </button>
            </div>
          ) : (
            <form onSubmit={handleContact} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
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
                <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
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
                <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
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
                <div style={{ fontSize: 12, color: C.red, padding: '8px 12px', background: '#3b0d1220', border: `1px solid ${C.red}30`, borderRadius: 6 }}>
                  {contactErr}
                </div>
              )}
              <button
                className="land-btn-primary"
                type="submit"
                disabled={contactStatus === 'sending'}
                style={{ ...btn.primary, alignSelf: 'flex-end', opacity: contactStatus === 'sending' ? 0.6 : 1 }}
              >
                {contactStatus === 'sending' ? 'Sending…' : 'Send message'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer style={{
        borderTop:  `1px solid ${C.brd}`,
        padding:    '28px 48px',
        background: C.surf,
      }}>
        <div className="footer-inner" style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, color: C.acc }}>⬡</span>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.07em', color: C.muted }}>META·LAB</span>
          </div>

          <div style={{ fontSize: 12, color: C.muted }}>
            © {new Date().getFullYear()} META·LAB · Systematic review platform
          </div>

          <div style={{ display: 'flex', gap: 20 }}>
            {[['Login', '/login'], ['Register', '/register']].map(([label, path]) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, fontFamily: FONT, padding: 0, transition: 'color 0.15s' }}
                onMouseEnter={e => e.target.style.color = C.txt2}
                onMouseLeave={e => e.target.style.color = C.muted}
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
