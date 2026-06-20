/**
 * Landing.jsx — public home page for PecanRev.
 *
 * v7 "Nextly faithful" redesign (prompt17):
 * Strict 10-section structure: Navbar · Hero · Credibility strip ·
 * Features · Workflow · Screening · Analysis · Benefits · CTA · Footer.
 *
 * Changes from v6:
 * - Removed KPI strip ("14 review stages" tiles) from hero.
 * - Removed InstitutionSpecs table section.
 * - Removed AppPreview + stat-card section.
 * - Removed EvidenceClimax / MiniForest (PRISMA count-up with fake numeric
 *   tiles). ForestPlotClimax retained as illustrative visual inside
 *   Analysis section (labelled "Illustrative data").
 * - Added: Credibility strip (text-only, real standards), Screening section,
 *   Analysis section, Benefits section — all new.
 * - All removed helper components (InstitutionSpecs, AppPreview, MiniForest,
 *   EvidenceClimax, PrismaStageRow, useCountUp) also removed.
 * - Section anchors #features #workflow #about #contact preserved.
 * - All ~26 landingContent keys from useLandingSettings() preserved.
 * - Contact form, sign-in/get-started, reducedMotion, animationSpeed intact.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api-client/apiClient.js';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { Icon, ICON_NAMES } from '../components/icons.jsx';

/* ─── Static content ─────────────────────────────────────────────────── */

/** Golden-path workflow steps (Project → Export) */
const WORKFLOW_STEPS = [
  { icon: 'target',    label: 'Project',   desc: 'Define scope, PICO, and register your PROSPERO protocol.' },
  { icon: 'clipboard', label: 'Protocol',  desc: 'Draft a structured registration protocol aligned with PROSPERO.' },
  { icon: 'search',    label: 'Import',    desc: 'Load citation exports from PubMed, Embase, Cochrane, and more.' },
  { icon: 'filter',    label: 'Screen',    desc: 'Dual-reviewer title/abstract and full-text triage with conflict resolution.' },
  { icon: 'table',     label: 'Extract',   desc: 'Structured data extraction tables for study characteristics and outcomes.' },
  { icon: 'sigma',     label: 'Analyse',   desc: 'Pooled effects, heterogeneity, subgroup, and sensitivity analyses.' },
  { icon: 'flow',      label: 'PRISMA',    desc: 'Auto-generated PRISMA 2020 flow diagram from screening decisions.' },
  { icon: 'fileText',  label: 'Export',    desc: 'Publication-ready forest plots, PRISMA checklist, and manuscript draft.' },
];

/** Feature cards (admin-editable via featureCards key) */
const VALUE_PROPS = [
  { icon: 'target',       label: 'Guided review workflow',    desc: 'Step-by-step structure from PICO definition through manuscript export — no shortcuts.' },
  { icon: 'filter',       label: 'Fast study screening',      desc: 'Title/abstract and full-text review with a keyboard-first interface for speed.' },
  { icon: 'checkSquare',  label: 'Duplicate detection',       desc: 'Automatic deduplication across citation sources before screening begins.' },
  { icon: 'table',        label: 'Data extraction',           desc: 'Structured forms for study characteristics, outcomes, and effect-size data.' },
  { icon: 'sigma',        label: 'Meta-analysis engine',      desc: 'Random- and fixed-effects pooling, HKSJ correction, heterogeneity, GRADE.' },
  { icon: 'flow',         label: 'PRISMA & exports',          desc: 'PRISMA 2020 flow diagram and checklist generated from real screening decisions.' },
  { icon: 'users',        label: 'Team collaboration',        desc: 'Multi-user workspaces with owner, leader, and member roles per project.' },
  { icon: 'clock',        label: 'Audit-ready workspace',     desc: 'Every screening decision and extraction timestamped in a tamper-evident trail.' },
];

/** Benefits blocks */
const BENEFITS = [
  { icon: 'hexagon',     title: 'Less scattered workflow',      desc: 'Protocol, search, screening, extraction, and analysis live in one structured project — no more juggling spreadsheets, email threads, and separate tools.' },
  { icon: 'users',       title: 'Easier team review',           desc: 'Dual-reviewer screening with conflict detection and adjudication built in. Everyone works in the same workspace with the same data.' },
  { icon: 'checkSquare', title: 'Cleaner evidence synthesis',   desc: 'Weighted pooling, subgroup analyses, Egger\'s test, and trim-and-fill run on the data you extracted — no manual copying to statistics software.' },
  { icon: 'fileText',    title: 'Publication-ready outputs',    desc: 'Forest plots, PRISMA flow diagrams, and GRADE summary tables export directly from your review data, ready for submission.' },
];

const GLYPH_ICONS = {
  '◈': 'clipboard', '⊞': 'checkSquare', '◉': 'sigma',
  '⬡': 'hexagon',   '◎': 'clock',       '◫': 'users',
};

function resolveCardIcon(icon) {
  if (icon && ICON_NAMES.includes(icon)) return icon;
  if (icon && GLYPH_ICONS[icon]) return GLYPH_ICONS[icon];
  return 'hexagon';
}

/* ─── Default settings ───────────────────────────────────────────────── */
const DEFAULTS = {
  logoText:          'PecanRev',
  navLinks:          [
    { label: 'Features', href: '#features' },
    { label: 'Workflow', href: '#workflow' },
    { label: 'About',    href: '#about'    },
    { label: 'Contact',  href: '#contact'  },
  ],
  heroHeadline:      'From screening to meta-analysis,\none clean workspace for evidence synthesis.',
  heroSubtitle:      'Organize citations, screen studies, extract data, run pooled analyses, and export research-ready reports — all in one auditable platform.',
  ctaText:           'Get started',
  ctaSecondaryText:  'Sign in',
  featureTitle:      'Everything a rigorous review needs',
  featureCards:      VALUE_PROPS,
  workflowTitle:     'The evidence-synthesis pipeline',
  workflowSubtitle:  'Eight stages, one continuous workspace. PecanRev walks every step from project setup to final export without letting you skip the method.',
  whyTitle:          'For researchers who care about rigor',
  whyBody1:          'Systematic reviews demand a level of methodological transparency that general research tools cannot provide.',
  whyBody2:          'PecanRev enforces a structured workflow aligned with Cochrane Handbook principles and international reporting standards.',
  whyBody3:          'Every decision — from inclusion criteria to subgroup definitions — is documented in a tamper-evident audit trail, so peer reviewers and editors can retrace your entire process.',
  whyStandards:      [
    'PRISMA 2020 — flow diagram generation',
    'Cochrane RoB 2.0 & ROBINS-I',
    'GRADE certainty-of-evidence framework',
    'Full audit trail — every decision timestamped',
  ],
  aboutHeadline:     'What is PecanRev?',
  aboutText1:        'PecanRev is a structured, multi-user platform for conducting systematic reviews and meta-analyses. It covers the complete research cycle — from PICO definition and search strategy through screening, data extraction, statistical analysis, and manuscript preparation.',
  aboutText2:        'Built for academic researchers, clinical teams, and evidence synthesis groups who need a single, auditable workspace rather than a collection of disconnected tools.',
  contactTitle:      'Get in touch',
  contactSubtitle:   'Questions about PecanRev, research collaborations, or institutional access.',
  footerText:        '',
  footerLinks:       [{ label: 'Register', path: '/register' }, { label: 'Sign In', path: '/login' }],
  announcementBanner:'',
  maintenanceBanner: '',
  seoTitle:          '',
  seoDescription:    '',
  animationSpeed:    'normal',
};

/* ─── Animation speed (prompt9) ─────────────────────────────────────── */
const ANIM_SPEED_IDS = ['off', 'slow', 'normal', 'fast'];
const ANIM_RATE = { slow: 0.6, normal: 1, fast: 1.6 };

/* ─── Hook: fetch public settings ────────────────────────────────────── */
function useLandingSettings() {
  const [settings, setSettings] = useState(DEFAULTS);
  useEffect(() => {
    fetch('/api/settings/public', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          const c = data.landingContent || data;
          setSettings(prev => ({
            ...prev,
            ...c,
            navLinks:     c.navLinks?.length     > 0 ? c.navLinks     : prev.navLinks,
            featureCards: c.featureCards?.length > 0 ? c.featureCards : prev.featureCards,
            whyStandards: c.whyStandards?.length > 0 ? c.whyStandards : prev.whyStandards,
            footerLinks:  c.footerLinks?.length  > 0 ? c.footerLinks  : prev.footerLinks,
          }));
        }
      })
      .catch(() => {});
  }, []);
  return settings;
}

/* ─── Motion hooks ───────────────────────────────────────────────────── */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return; }
    const fn = e => setReduced(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', fn);
      else if (mq.removeListener) mq.removeListener(fn);
    };
  }, []);
  return reduced;
}

/* ─── Framer Motion variants ─────────────────────────────────────────── */
const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};
const fadeUpSlow = {
  hidden:  { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};
const staggerContainer = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.09 } },
};
const staggerFast = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.06 } },
};

/* ─── Runtime theme color reads (canvas needs real hex values) ──────── */
function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return [107, 161, 247];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readCanvasColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
  return {
    acc:  hexToRgb(get('--t-acc',  '#4f46e5')),
    gold: hexToRgb(get('--t-gold', '#b45309')),
    txt:  hexToRgb(get('--t-txt',  '#1f2937')),
    day:  document.documentElement.dataset.theme !== 'night',
  };
}

const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

/* ─── Wordmark: PecanRev ─────────────────────────────────────────────── */
function Wordmark({ size = 13, weight = 700, spacing = '0.08em' }) {
  return (
    <span style={{ fontSize: size, fontWeight: weight, letterSpacing: spacing, color: C.txt, whiteSpace: 'nowrap' }}>
      Pecan<span style={{ color: C.acc }}>Rev</span>
    </span>
  );
}

/* ─── SVG logo mark ──────────────────────────────────────────────────── */
function HexLogo({ size = 18, color = C.acc }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2 L21.5 7 L21.5 17 L12 22 L2.5 17 L2.5 7 Z"
        stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M12 7.5 L16.5 10 L16.5 14.5 L12 17 L7.5 14.5 L7.5 10 Z"
        fill={color} opacity="0.25" />
    </svg>
  );
}

/* ─── Nextly SectionTitle: centered pretitle + big title + desc ─────── */
function SectionTitle({ pretitle, title, children, align = 'center' }) {
  const centered = align !== 'left';
  return (
    <div style={{ textAlign: centered ? 'center' : 'left', maxWidth: centered ? 720 : undefined, margin: centered ? '0 auto' : undefined }}>
      {pretitle && (
        <div style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: C.acc, marginBottom: 12,
          fontFamily: FONT,
        }}>
          {pretitle}
        </div>
      )}
      {title && (
        <h2 style={{
          fontSize: 'clamp(26px, 3.2vw, 36px)', fontWeight: 800,
          letterSpacing: '-0.03em', color: C.txt, lineHeight: 1.18,
          margin: '0 0 16px', fontFamily: FONT,
        }}>
          {title}
        </h2>
      )}
      {children && (
        <p style={{
          fontSize: 17, color: C.txt2, lineHeight: 1.75,
          maxWidth: 640, margin: centered ? '0 auto' : '0',
        }}>
          {children}
        </p>
      )}
    </div>
  );
}

/* ─── Tiny mono section label (kept for legacy) ──────────────────────── */
function SectionLabel({ text, style }) {
  return (
    <div style={{
      fontSize: 11, fontFamily: MONO, color: C.muted,
      letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12,
      ...style,
    }}>
      {text}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   HERO CANVAS — records drifting → forest plot (product illustration)
   ════════════════════════════════════════════════════════════════════════ */
const CANVAS_ROWS = [
  { lo: 0.478, hi: 0.767, es: 0.622, w: 1.00 },
  { lo: 0.350, hi: 0.694, es: 0.522, w: 0.72 },
  { lo: 0.556, hi: 0.789, es: 0.672, w: 1.18 },
  { lo: 0.450, hi: 0.717, es: 0.583, w: 0.96 },
  { lo: 0.311, hi: 0.667, es: 0.489, w: 0.64 },
];
const CANVAS_POOL = { lo: 0.522, hi: 0.678, es: 0.600 };

function HeroCanvas({ reduced, speed = 1 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rate = Number(speed) > 0 ? Number(speed) : 1;
    let colors = readCanvasColors();
    let raf = 0, running = false, tabVisible = !document.hidden, onScreen = true;
    let W = 0, H = 0, rows = [], pool = null;
    const particles = [];
    const N = 120, NC = 46;
    const start = performance.now();

    function layout() {
      const host = canvas.parentElement;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fw = Math.min(W * 0.55, 340);
      const fx = (W - fw) / 2;
      const gap = Math.min(Math.max(H * 0.072, 32), 50);
      const fy = H * 0.5 - gap * 3.1;
      rows = CANVAS_ROWS.map((r, i) => ({
        y: fy + i * gap, x1: fx + r.lo * fw, x2: fx + r.hi * fw,
        xm: fx + r.es * fw, sz: 4 + r.w * 3.4,
      }));
      pool = {
        x1: fx + CANVAS_POOL.lo * fw, x2: fx + CANVAS_POOL.hi * fw,
        xm: fx + CANVAS_POOL.es * fw,
        y: fy + rows.length * gap + gap * 0.7,
        hh: Math.min(gap * 0.32, 11),
      };
      retarget();
    }

    function retarget() {
      for (const p of particles) {
        if (!p.conv) continue;
        const row = rows[p.row % rows.length];
        if (!row) continue;
        p.tx = row.x1 + p.frac * (row.x2 - row.x1);
        p.ty = row.y + p.jit;
      }
    }

    function seed() {
      particles.length = 0;
      for (let i = 0; i < N; i++) {
        const conv = i < NC;
        particles.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.10, vy: (Math.random() - 0.5) * 0.07,
          r: 0.7 + Math.random() * 1.3, a: 0.10 + Math.random() * 0.26,
          tw: Math.random() * Math.PI * 2, conv,
          row: i % CANVAS_ROWS.length, frac: Math.random(),
          jit: (Math.random() - 0.5) * 5,
          k: (0.0022 + Math.random() * 0.0030) * rate,
          delay: (Math.random() * 9000) / rate,
          tx: 0, ty: 0,
        });
      }
      retarget();
    }

    function draw(t, final) {
      ctx.clearRect(0, 0, W, H);
      const { acc, gold, txt, day } = colors;
      const lineA = day ? 0.34 : 0.30;
      const ptBase = day ? 0.55 : 0.85;
      const prog = final ? 1 : Math.min(1, (t * rate) / 26000);

      if (rows.length) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const ra = Math.max(0, Math.min(1, prog * 1.6 - i * 0.12));
          if (ra <= 0.01) continue;
          ctx.strokeStyle = rgba(txt, lineA * ra * 0.55);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(r.x1, r.y); ctx.lineTo(r.x2, r.y);
          ctx.moveTo(r.x1, r.y - 3.5); ctx.lineTo(r.x1, r.y + 3.5);
          ctx.moveTo(r.x2, r.y - 3.5); ctx.lineTo(r.x2, r.y + 3.5);
          ctx.stroke();
          ctx.fillStyle = rgba(acc, (day ? 0.7 : 0.8) * ra);
          const s = r.sz;
          ctx.fillRect(r.xm - s / 2, r.y - s / 2, s, s);
        }
        const da = Math.max(0, Math.min(1, prog * 1.8 - 0.8));
        if (pool && da > 0.01) {
          const pulse = final ? 0.5 : 0.5 + 0.28 * Math.sin((t * rate) / 1700);
          const grd = ctx.createRadialGradient(pool.xm, pool.y, 0, pool.xm, pool.y, 46);
          grd.addColorStop(0, rgba(gold, (day ? 0.20 : 0.26) * da * (0.55 + pulse * 0.45)));
          grd.addColorStop(1, rgba(gold, 0));
          ctx.fillStyle = grd;
          ctx.fillRect(pool.xm - 48, pool.y - 48, 96, 96);
          ctx.fillStyle = rgba(gold, (day ? 0.85 : 0.95) * da);
          ctx.beginPath();
          ctx.moveTo(pool.x1, pool.y);
          ctx.lineTo(pool.xm, pool.y - pool.hh);
          ctx.lineTo(pool.x2, pool.y);
          ctx.lineTo(pool.xm, pool.y + pool.hh);
          ctx.closePath();
          ctx.fill();
        }
      }

      for (const p of particles) {
        if (p.conv && (final || t > p.delay)) {
          if (final) { p.x = p.tx; p.y = p.ty; }
          else {
            p.x += (p.tx - p.x) * p.k; p.y += (p.ty - p.y) * p.k;
            p.x += p.vx * 0.25; p.y += p.vy * 0.25;
          }
        } else if (!final) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4;
          if (p.y < -4) p.y = H + 4; else if (p.y > H + 4) p.y = -4;
        }
        const twinkle = final ? 1 : 0.78 + 0.22 * Math.sin((t * rate) / 2400 + p.tw);
        let a = p.a * ptBase * twinkle;
        if (p.conv) {
          const d = Math.hypot(p.tx - p.x, p.ty - p.y);
          const near = Math.max(0, 1 - d / 220);
          a = Math.min(0.9, a + near * 0.35);
        }
        ctx.fillStyle = rgba(p.conv ? acc : txt, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function frame(now) {
      raf = 0;
      if (!running) return;
      draw(now - start, false);
      raf = requestAnimationFrame(frame);
    }

    function syncRun() {
      const should = !reduced && tabVisible && onScreen;
      if (should && !running) { running = true; if (!raf) raf = requestAnimationFrame(frame); }
      else if (!should && running) { running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    }

    const onVis = () => { tabVisible = !document.hidden; syncRun(); };
    const onTheme = () => { colors = readCanvasColors(); if (reduced) draw(0, true); };
    const onResize = () => { layout(); if (reduced) draw(0, true); };

    layout(); seed();

    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(entries => { onScreen = entries.some(e => e.isIntersecting); syncRun(); }, { threshold: 0 });
      io.observe(canvas);
    }

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('metalab:theme-change', onTheme);
    // prompt37 — repaint on a live brand-color change (Ops Appearance), not just
    // a day/night flip; onTheme re-reads --t-acc from the computed styles.
    window.addEventListener('metalab:brand-change', onTheme);
    window.addEventListener('resize', onResize);

    if (reduced) draw(0, true);
    else syncRun();

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('metalab:theme-change', onTheme);
      window.removeEventListener('metalab:brand-change', onTheme);
      window.removeEventListener('resize', onResize);
    };
  }, [reduced, speed]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════════
   FOREST PLOT — illustrative product visual (Analysis section)
   ════════════════════════════════════════════════════════════════════════ */
const FP_STUDIES = [
  { label: 'Smith et al., 2021',  n: 142, es: 0.62, lo: 0.36, hi: 0.88, w: '22.4%' },
  { label: 'Chen et al., 2022',   n:  89, es: 0.44, lo: 0.13, hi: 0.75, w: '15.1%' },
  { label: 'Kumar et al., 2020',  n: 203, es: 0.71, lo: 0.50, hi: 0.92, w: '28.6%' },
  { label: 'Walsh et al., 2023',  n: 167, es: 0.55, lo: 0.31, hi: 0.79, w: '21.7%' },
  { label: 'Nakamura, 2021',      n:  98, es: 0.38, lo: 0.06, hi: 0.70, w: '12.2%' },
];
const FP_POOLED = { es: 0.58, lo: 0.44, hi: 0.72 };

function ForestPlotIllustration({ active }) {
  const PLT_X = 144, PLT_W = 224, STAT_X = 378, VB_W = 460;
  const X_MIN = -0.5, X_MAX = 1.3;
  const toX = v => PLT_X + ((v - X_MIN) / (X_MAX - X_MIN)) * PLT_W;
  const ZERO = toX(0);
  const ROW_H = 30, HDR_Y = 22;
  const firstY = HDR_Y + ROW_H;
  const poolY  = firstY + FP_STUDIES.length * ROW_H + ROW_H * 0.6;
  const axisY  = poolY + ROW_H * 0.8;
  const VB_H   = axisY + 36;
  const boxSize = w => 5 + parseFloat(w) / 8;

  return (
    <div className={active ? 'lp-fpz in-view' : 'lp-fpz'} style={{
      background: C.card, border: `1px solid ${C.brd2}`,
      borderRadius: 14, overflow: 'hidden', fontFamily: FONT,
      boxShadow: `0 24px 60px ${C.shadow}`,
    }}>
      <div style={{
        background: C.surf, borderBottom: `1px solid ${C.brd}`,
        padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Icon name="forest" size={12} style={{ color: C.acc }} />
        <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em' }}>
          Random-Effects Model · SMD · 95% CI
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 8.5, fontFamily: MONO, color: C.dim, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Illustrative data
        </span>
      </div>
      <div style={{ padding: '16px 14px 12px' }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
          <text x={STAT_X + 22} y={HDR_Y - 4} style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>N</text>
          <text x={STAT_X + 68} y={HDR_Y - 4} style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>Weight</text>
          <line x1={ZERO} y1={HDR_Y} x2={ZERO} y2={poolY + ROW_H * 0.4} stroke={C.brd2} strokeWidth={1} strokeDasharray="3,3" />
          {FP_STUDIES.map((s, i) => {
            const y = firstY + i * ROW_H + ROW_H / 2;
            const x1 = toX(s.lo), x2 = toX(s.hi), xm = toX(s.es), bsz = boxSize(s.w);
            return (
              <g key={s.label} className="lp-fp-row" style={{ animationDelay: `calc(${(0.1 + i * 0.13).toFixed(2)}s * var(--lp-dur, 1))` }}>
                <text x={0} y={y + 3.5} style={{ fontSize: 9.5, fontFamily: FONT, fill: C.txt2 }}>{s.label}</text>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke={C.brd2} strokeWidth={1.5} />
                <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} stroke={C.brd2} strokeWidth={1} />
                <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} stroke={C.brd2} strokeWidth={1} />
                <rect x={xm - bsz / 2} y={y - bsz / 2} width={bsz} height={bsz} fill={C.acc} stroke={C.acc2} strokeWidth={0.5} />
                <text x={STAT_X + 22} y={y + 3.5} style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>{s.n}</text>
                <text x={STAT_X + 68} y={y + 3.5} style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>{s.w}</text>
              </g>
            );
          })}
          <line x1={0} y1={poolY - ROW_H * 0.35} x2={VB_W} y2={poolY - ROW_H * 0.35} stroke={C.brd} strokeWidth={0.5} />
          {(() => {
            const y = poolY, xlo = toX(FP_POOLED.lo), xhi = toX(FP_POOLED.hi), xm = toX(FP_POOLED.es), dh = 8;
            return (
              <g className="lp-fp-pool" style={{ animationDelay: 'calc(0.85s * var(--lp-dur, 1))' }}>
                <text x={0} y={y + 4} style={{ fontSize: 9.5, fontFamily: FONT, fill: C.txt, fontWeight: 600 }}>Pooled estimate</text>
                <polygon points={`${xlo},${y} ${xm},${y - dh} ${xhi},${y} ${xm},${y + dh}`} fill={C.gold} stroke="none" />
                <text x={STAT_X + 68} y={y + 4} style={{ fontSize: 9, fontFamily: MONO, fill: C.gold, textAnchor: 'middle', fontWeight: 700 }}>100%</text>
              </g>
            );
          })()}
          {[-0.25, 0, 0.5, 1.0].map(v => (
            <text key={v} x={toX(v)} y={axisY + 12} style={{ fontSize: 8, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>{v}</text>
          ))}
          <text x={PLT_X + 4} y={axisY + 26} style={{ fontSize: 8, fontFamily: FONT, fill: C.muted }}>← Favours control</text>
          <text x={PLT_X + PLT_W - 4} y={axisY + 26} style={{ fontSize: 8, fontFamily: FONT, fill: C.muted, textAnchor: 'end' }}>Favours treatment →</text>
        </svg>
        <div style={{ display: 'flex', gap: 14, borderTop: `1px solid ${C.brd}`, paddingTop: 10, marginTop: 2, flexWrap: 'wrap' }}>
          {[['SMD', '0.58 [0.44–0.72]'], ['I²', '23.4%'], ['τ²', '0.021'], ['p', '< 0.001']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em' }}>{k}</span>
              <span style={{ fontSize: 11, fontFamily: MONO, color: C.teal, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Scroll-reveal wrapper (Framer Motion) ──────────────────────────── */
function Reveal({ children, reduced, delay = 0, style }) {
  if (reduced) return <div style={style}>{children}</div>;
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] } } }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

/* ─── InView hook for forest plot trigger ────────────────────────────── */
function useInView(threshold = 0.15, rootMargin = '0px 0px -10% 0px') {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) { setInView(true); return; }
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const obs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setInView(true);
        obs.disconnect();
      }
    }, { threshold, rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, rootMargin]);
  return [ref, inView];
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════ */
export default function Landing() {
  const navigate  = useNavigate();
  const { user }  = useAuth();
  const settings  = useLandingSettings();
  const reduced   = usePrefersReducedMotion();

  const speedSetting = ANIM_SPEED_IDS.includes(settings.animationSpeed) ? settings.animationSpeed : 'normal';
  const motionOff    = reduced || speedSetting === 'off';
  const rate         = motionOff ? 1 : (ANIM_RATE[speedSetting] || 1);
  const durMult      = +(1 / rate).toFixed(4);

  useEffect(() => {
    if (settings.seoTitle) document.title = settings.seoTitle;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && settings.seoDescription) meta.setAttribute('content', settings.seoDescription);
  }, [settings.seoTitle, settings.seoDescription]);

  const [navOpen,         setNavOpen]        = useState(false);
  const [activeStep,      setActiveStep]     = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return !!localStorage.getItem('ml_banner_dismissed'); } catch { return false; }
  });
  const [contact,      setContact]      = useState({ name: '', email: '', message: '' });
  const [contactStatus, setContactStatus] = useState(null);
  const [contactErr,    setContactErr]    = useState('');

  // Forest plot in-view trigger (Analysis section)
  const [fpRef, fpInView] = useInView(0.2, '0px 0px -5% 0px');

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

  const showBanner      = !!settings.announcementBanner && !bannerDismissed;
  const showMaintenance = !!settings.maintenanceBanner;

  /* ── Shared style objects ──────────────────────────────────────────── */
  const inpStyle = {
    width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
    borderRadius: 8, padding: '11px 14px', color: C.txt,
    fontFamily: FONT, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };
  const btnPrimary = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 9, padding: '13px 28px', background: C.acc, border: 'none',
    borderRadius: 8, color: C.accText, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT, letterSpacing: '0.01em', whiteSpace: 'nowrap',
  };
  const btnGhost = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: '13px 28px', background: 'transparent',
    border: `1px solid ${C.brd2}`, borderRadius: 8,
    color: C.txt2, fontSize: 14, cursor: 'pointer',
    fontFamily: FONT, letterSpacing: '0.01em', whiteSpace: 'nowrap',
  };
  const sectionPad = { maxWidth: 1200, margin: '0 auto', padding: '96px 48px' };

  /* ── Framer Motion button wrappers ─────────────────────────────────── */
  const MotionBtn = ({ style, className, onClick, children, type, disabled }) => {
    if (motionOff) {
      return <button style={style} className={className} onClick={onClick} type={type} disabled={disabled}>{children}</button>;
    }
    return (
      <motion.button
        style={style} className={className} onClick={onClick} type={type} disabled={disabled}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        {children}
      </motion.button>
    );
  };

  return (
    <div
      className={motionOff ? 'lp-motion-off' : undefined}
      style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt, '--lp-dur': durMult }}
    >
      <style>{`
        html { scroll-behavior: smooth; }

        /* ── Navbar ──────────────────────────────────────────────────── */
        .lp-nav-link { transition: color 0.15s; }
        .lp-nav-link:hover { color: ${C.acc} !important; }

        /* ── Buttons ─────────────────────────────────────────────────── */
        .lp-btn-primary { transition: background 0.15s, box-shadow 0.15s; }
        .lp-btn-primary:hover { background: ${C.acc2} !important; box-shadow: 0 6px 20px ${alpha(C.acc, 0.28)}; }
        .lp-btn-ghost { transition: border-color 0.15s, color 0.15s; }
        .lp-btn-ghost:hover { border-color: ${C.acc} !important; color: ${C.acc} !important; }

        /* ── Feature cards ───────────────────────────────────────────── */
        .lp-val-card { transition: box-shadow 0.18s, transform 0.18s, border-color 0.18s; }
        .lp-val-card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px ${C.shadow}; border-color: ${alpha(C.acc, 0.35)} !important; }

        /* ── Benefit cards ───────────────────────────────────────────── */
        .lp-benefit-card { transition: box-shadow 0.18s, transform 0.18s, border-color 0.18s; }
        .lp-benefit-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px ${C.shadow}; border-color: ${alpha(C.acc, 0.3)} !important; }

        /* ── Workflow step nodes ──────────────────────────────────────── */
        .lp-step-node { transition: border-color 0.15s, background 0.15s; }
        .lp-step-node:focus-visible { border-color: ${C.acc} !important; outline: none; box-shadow: 0 0 0 3px ${alpha(C.acc, 0.2)}; }

        /* ── Screening / Analysis benefit rows ───────────────────────── */
        .lp-prod-bullet { transition: color 0.12s; }

        /* ── Footer links ────────────────────────────────────────────── */
        .lp-footer-link { transition: color 0.15s; }
        .lp-footer-link:hover { color: ${C.acc} !important; }

        /* ── Forest plot (scroll-triggered) ─────────────────────────── */
        @keyframes lpRowIn {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes lpPoolIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: none; }
        }
        .lp-fpz .lp-fp-row  { opacity: 0; }
        .lp-fpz .lp-fp-pool { opacity: 0; transform-box: fill-box; transform-origin: center; }
        .lp-fpz.in-view .lp-fp-row  { animation: lpRowIn calc(0.6s * var(--lp-dur, 1)) cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .lp-fpz.in-view .lp-fp-pool { animation: lpPoolIn calc(0.5s * var(--lp-dur, 1)) ease-out forwards; }

        /* ── Reduced motion ──────────────────────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
          .lp-fpz .lp-fp-row, .lp-fpz .lp-fp-pool { animation: none !important; opacity: 1 !important; transform: none !important; }
          .lp-btn-primary:hover, .lp-val-card:hover, .lp-benefit-card:hover { transform: none !important; }
        }

        /* ── Ops animationSpeed:'off' ────────────────────────────────── */
        .lp-motion-off .lp-fpz .lp-fp-row, .lp-motion-off .lp-fpz .lp-fp-pool { animation: none !important; opacity: 1 !important; transform: none !important; }
        .lp-motion-off .lp-btn-primary:hover, .lp-motion-off .lp-val-card:hover, .lp-motion-off .lp-benefit-card:hover { transform: none !important; }

        /* ── Responsive ──────────────────────────────────────────────── */
        @media (max-width: 1024px) {
          .lp-hero-cols    { flex-direction: column !important; }
          .lp-hero-right   { display: none !important; }
          .lp-sect-inner   { padding-left: 32px !important; padding-right: 32px !important; }
          .lp-sift-grid    { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lp-lab-grid     { grid-template-columns: 1fr !important; gap: 40px !important; }
        }
        @media (max-width: 768px) {
          .lp-nav-links    { display: none !important; }
          .lp-nav-ctas     { display: none !important; }
          .lp-ham-btn      { display: flex !important; }
          .lp-mob-menu     { display: flex !important; }
          .lp-value-grid   { grid-template-columns: 1fr !important; }
          .lp-step-grid    { grid-template-columns: repeat(4, 1fr) !important; }
          .lp-benefit-grid { grid-template-columns: 1fr !important; }
          .lp-trust-strip  { flex-wrap: wrap !important; gap: 8px !important; justify-content: flex-start !important; }
          .lp-footer-cols  { flex-direction: column !important; gap: 28px !important; }
          .lp-footer-bottom{ flex-direction: column !important; align-items: flex-start !important; }
          .lp-sect-inner   { padding-left: 24px !important; padding-right: 24px !important; }
          .lp-cta-band     { flex-direction: column !important; text-align: center !important; }
        }
        @media (min-width: 769px) {
          .lp-ham-btn  { display: none !important; }
          .lp-mob-menu { display: none !important; }
        }
        @media (max-width: 480px) {
          .lp-hero-ctas  button { flex: 1; }
          .lp-step-grid  { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (min-width: 1025px) {
          .lp-value-grid   { grid-template-columns: 1fr 1fr !important; }
          .lp-benefit-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* ── Announcement banner ──────────────────────────────────────── */}
      {showBanner && (
        <div style={{ background: C.accBg, borderBottom: `1px solid ${alpha(C.acc, 0.2)}`, padding: '9px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, position: 'relative' }}>
          <Icon name="info" size={13} style={{ color: C.acc }} />
          <span style={{ fontSize: 12.5, color: C.acc }}>{settings.announcementBanner}</span>
          <button onClick={dismissBanner} aria-label="Dismiss announcement" style={{ position: 'absolute', right: 16, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', lineHeight: 1, padding: 2, display: 'inline-flex' }}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {/* ── Maintenance banner ───────────────────────────────────────── */}
      {showMaintenance && (
        <div style={{ background: C.yelBg, border: `1px solid ${alpha(C.yel, 0.4)}`, padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontSize: 13, color: C.yel, fontWeight: 500 }}>
          <Icon name="alert" size={14} style={{ color: C.yel }} />
          {settings.maintenanceBanner}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          1. NAVBAR
          ══════════════════════════════════════════════════════════════ */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px', height: 64, borderBottom: `1px solid ${C.brd}`,
        position: 'sticky', top: 0,
        background: alpha(C.surf, 0.92), backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)', zIndex: 200,
        boxShadow: `0 1px 0 ${C.brd}`,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'default', userSelect: 'none', flexShrink: 0 }}>
          <HexLogo size={20} />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', color: C.txt }}>
            {settings.logoText || 'PecanRev'}
          </span>
        </div>

        {/* Center nav links */}
        <div className="lp-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(settings.navLinks || []).map(link => (
            <a key={link.label} href={link.href} className="lp-nav-link"
              style={{ fontSize: 14, color: C.txt2, textDecoration: 'none', padding: '6px 14px', borderRadius: 6 }}>
              {link.label}
            </a>
          ))}
        </div>

        {/* Right CTAs */}
        <div className="lp-nav-ctas" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {user ? (
            <MotionBtn className="lp-btn-primary" onClick={() => navigate('/app')}
              style={{ ...btnPrimary, padding: '9px 20px', fontSize: 13, borderRadius: 8 }}>
              Open Workspace
            </MotionBtn>
          ) : (
            <>
              <button className="lp-btn-ghost" onClick={() => navigate('/login')}
                style={{ ...btnGhost, padding: '9px 18px', fontSize: 13, borderRadius: 8 }}>
                {settings.ctaSecondaryText || 'Sign in'}
              </button>
              <MotionBtn className="lp-btn-primary" onClick={() => navigate('/register')}
                style={{ ...btnPrimary, padding: '9px 20px', fontSize: 13, borderRadius: 8 }}>
                {settings.ctaText || 'Get started'}
              </MotionBtn>
            </>
          )}
        </div>

        {/* Hamburger */}
        <button className="lp-ham-btn" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation menu"
          style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, cursor: 'pointer', padding: '6px 10px', fontSize: 16, display: 'none', alignItems: 'center' }}>
          {navOpen ? <Icon name="x" size={15} /> : <Icon name="menu" size={15} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {navOpen && (
        <div className="lp-mob-menu" style={{ display: 'flex', flexDirection: 'column', background: C.surf, borderBottom: `1px solid ${C.brd}`, padding: '16px 24px', gap: 10 }}>
          {(settings.navLinks || []).map(link => (
            <a key={link.label} href={link.href} onClick={() => setNavOpen(false)}
              style={{ fontSize: 14, color: C.txt2, textDecoration: 'none', padding: '8px 0' }}>
              {link.label}
            </a>
          ))}
          <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 12, display: 'flex', gap: 8 }}>
            {user ? (
              <button className="lp-btn-primary" onClick={() => navigate('/app')} style={{ ...btnPrimary, width: '100%' }}>Open Workspace</button>
            ) : (
              <>
                <button className="lp-btn-ghost" onClick={() => navigate('/login')} style={{ ...btnGhost, flex: 1 }}>
                  {settings.ctaSecondaryText || 'Sign in'}
                </button>
                <button className="lp-btn-primary" onClick={() => navigate('/register')} style={{ ...btnPrimary, flex: 1 }}>
                  {settings.ctaText || 'Get started'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          2. HERO — two-column: left text + CTAs, right HeroCanvas
          ══════════════════════════════════════════════════════════════ */}
      <section style={{ background: C.bg, overflow: 'hidden', borderBottom: `1px solid ${C.brd}` }}>
        <div className="lp-sect-inner" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 48px' }}>
          <div className="lp-hero-cols" style={{ display: 'flex', alignItems: 'center', gap: 64, minHeight: 'min(86vh, 820px)' }}>

            {/* Left column */}
            <div style={{ flex: '1 1 480px', minWidth: 0, paddingTop: 96, paddingBottom: 96 }}>
              {motionOff ? (
                <>
                  {/* Eyebrow */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.accBg, border: `1px solid ${alpha(C.acc, 0.25)}`, borderRadius: 100, padding: '5px 14px', marginBottom: 28 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.acc, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontFamily: MONO, color: C.acc, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Evidence synthesis platform</span>
                  </div>

                  {/* H1 */}
                  <h1 style={{ fontSize: 'clamp(36px, 5.5vw, 64px)', fontWeight: 800, letterSpacing: '-0.04em', color: C.txt, lineHeight: 1.06, margin: '0 0 22px', fontFamily: FONT, whiteSpace: 'pre-line' }}>
                    {settings.heroHeadline || DEFAULTS.heroHeadline}
                  </h1>

                  {/* Subtitle */}
                  <p style={{ fontSize: 'clamp(15px, 1.8vw, 18px)', color: C.txt2, lineHeight: 1.75, maxWidth: 480, margin: '0 0 38px', overflowWrap: 'break-word' }}>
                    {settings.heroSubtitle || DEFAULTS.heroSubtitle}
                  </p>

                  {/* CTAs */}
                  <div className="lp-hero-ctas" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {user ? (
                      <button className="lp-btn-primary" onClick={() => navigate('/app')} style={{ ...btnPrimary, borderRadius: 9 }}>
                        Open Workspace <Icon name="arrowRight" size={15} />
                      </button>
                    ) : (
                      <>
                        <button className="lp-btn-primary" onClick={() => navigate('/register')} style={{ ...btnPrimary, borderRadius: 9 }}>
                          {settings.ctaText || 'Get started'} <Icon name="arrowRight" size={15} />
                        </button>
                        <button className="lp-btn-ghost" onClick={() => navigate('/login')} style={{ ...btnGhost, borderRadius: 9 }}>
                          {settings.ctaSecondaryText || 'Sign in'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <motion.div variants={staggerContainer} initial="hidden" animate="visible">
                  {/* Eyebrow */}
                  <motion.div variants={fadeUp} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.accBg, border: `1px solid ${alpha(C.acc, 0.25)}`, borderRadius: 100, padding: '5px 14px', marginBottom: 28 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.acc, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontFamily: MONO, color: C.acc, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Evidence synthesis platform</span>
                  </motion.div>

                  {/* H1 */}
                  <motion.h1 variants={fadeUp} style={{ fontSize: 'clamp(36px, 5.5vw, 64px)', fontWeight: 800, letterSpacing: '-0.04em', color: C.txt, lineHeight: 1.06, margin: '0 0 22px', fontFamily: FONT, whiteSpace: 'pre-line' }}>
                    {settings.heroHeadline || DEFAULTS.heroHeadline}
                  </motion.h1>

                  {/* Subtitle */}
                  <motion.p variants={fadeUpSlow} style={{ fontSize: 'clamp(15px, 1.8vw, 18px)', color: C.txt2, lineHeight: 1.75, maxWidth: 480, margin: '0 0 38px', overflowWrap: 'break-word' }}>
                    {settings.heroSubtitle || DEFAULTS.heroSubtitle}
                  </motion.p>

                  {/* CTAs */}
                  <motion.div variants={fadeUp} className="lp-hero-ctas" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {user ? (
                      <MotionBtn className="lp-btn-primary" onClick={() => navigate('/app')} style={{ ...btnPrimary, borderRadius: 9 }}>
                        Open Workspace <Icon name="arrowRight" size={15} />
                      </MotionBtn>
                    ) : (
                      <>
                        <MotionBtn className="lp-btn-primary" onClick={() => navigate('/register')} style={{ ...btnPrimary, borderRadius: 9 }}>
                          {settings.ctaText || 'Get started'} <Icon name="arrowRight" size={15} />
                        </MotionBtn>
                        <MotionBtn className="lp-btn-ghost" onClick={() => navigate('/login')} style={{ ...btnGhost, borderRadius: 9 }}>
                          {settings.ctaSecondaryText || 'Sign in'}
                        </MotionBtn>
                      </>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </div>

            {/* Right column — HeroCanvas */}
            <div className="lp-hero-right" style={{ flex: '1 1 420px', minWidth: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center', paddingTop: 48, paddingBottom: 48 }}>
              {motionOff ? (
                <div style={{
                  position: 'relative', width: '100%', minHeight: 480, maxHeight: 600,
                  flex: 1, borderRadius: 20, overflow: 'hidden',
                  border: `1px solid ${C.brd}`, background: C.surf,
                  boxShadow: `0 24px 64px ${C.shadow}, 0 0 0 1px ${C.brd}`,
                }}>
                  <div aria-hidden="true" style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    backgroundImage: `linear-gradient(${alpha(C.acc, 0.04)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(C.acc, 0.04)} 1px, transparent 1px)`,
                    backgroundSize: '32px 32px', zIndex: 0,
                  }} />
                  <HeroCanvas reduced={motionOff} speed={rate} />
                  <div aria-hidden="true" style={{
                    position: 'absolute', bottom: 14, left: 14, right: 14,
                    display: 'flex', alignItems: 'center', gap: 7, zIndex: 2, pointerEvents: 'none',
                  }}>
                    <div style={{ height: 1, flex: 1, background: `linear-gradient(to right, ${alpha(C.acc, 0.35)}, transparent)` }} />
                    <span style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      Evidence pipeline · Illustrative
                    </span>
                    <div style={{ height: 1, flex: 1, background: `linear-gradient(to left, ${alpha(C.acc, 0.35)}, transparent)` }} />
                  </div>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    position: 'relative', width: '100%', minHeight: 480, maxHeight: 600,
                    flex: 1, borderRadius: 20, overflow: 'hidden',
                    border: `1px solid ${C.brd}`, background: C.surf,
                    boxShadow: `0 24px 64px ${C.shadow}, 0 0 0 1px ${C.brd}`,
                  }}
                >
                  <div aria-hidden="true" style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    backgroundImage: `linear-gradient(${alpha(C.acc, 0.04)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(C.acc, 0.04)} 1px, transparent 1px)`,
                    backgroundSize: '32px 32px', zIndex: 0,
                  }} />
                  <HeroCanvas reduced={motionOff} speed={rate} />
                  <div aria-hidden="true" style={{
                    position: 'absolute', bottom: 14, left: 14, right: 14,
                    display: 'flex', alignItems: 'center', gap: 7, zIndex: 2, pointerEvents: 'none',
                  }}>
                    <div style={{ height: 1, flex: 1, background: `linear-gradient(to right, ${alpha(C.acc, 0.35)}, transparent)` }} />
                    <span style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      Evidence pipeline · Illustrative
                    </span>
                    <div style={{ height: 1, flex: 1, background: `linear-gradient(to left, ${alpha(C.acc, 0.35)}, transparent)` }} />
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          3. CREDIBILITY STRIP — text-only, real methodology standards
          ══════════════════════════════════════════════════════════════ */}
      <div style={{ background: C.surf, borderBottom: `1px solid ${C.brd}`, padding: '20px 48px' }}>
        <div style={{ maxWidth: 1104, margin: '0 auto' }}>
          <p style={{ fontSize: 13, color: C.txt2, textAlign: 'center', lineHeight: 1.8, margin: '0 0 14px' }}>
            Built for systematic reviews, screening, extraction, meta-analysis, and PRISMA workflows.
          </p>
          <div className="lp-trust-strip" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', paddingRight: 20, whiteSpace: 'nowrap' }}>
              Implements
            </span>
            {['PRISMA 2020', 'Cochrane RoB 2.0', 'GRADE', 'PROSPERO', 'HKSJ Method'].map((s, i) => (
              <span key={s} style={{
                fontSize: 11, fontFamily: MONO, color: C.txt2, letterSpacing: '0.06em',
                whiteSpace: 'nowrap', borderLeft: `1px solid ${C.brd2}`, padding: '0 20px',
              }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          4. FEATURES — #features anchor (Nextly card grid)
          ══════════════════════════════════════════════════════════════ */}
      <section id="features" style={{ background: C.bg, borderBottom: `1px solid ${C.brd}` }}>
        <div className="lp-sect-inner" style={sectionPad}>
          <Reveal reduced={motionOff} style={{ marginBottom: 56 }}>
            <SectionTitle
              pretitle="Features"
              title={settings.featureTitle || DEFAULTS.featureTitle}
            >
              From protocol registration to manuscript export — every stage of evidence synthesis, without switching tools.
            </SectionTitle>
          </Reveal>

          {motionOff ? (
            <div className="lp-value-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              {(settings.featureCards || VALUE_PROPS).map((v, i) => (
                <div key={v.label || i} className="lp-val-card" style={{
                  background: C.surf, border: `1px solid ${C.brd}`,
                  borderRadius: 14, padding: '26px 24px 24px',
                  display: 'flex', gap: 18, alignItems: 'flex-start',
                  boxShadow: `0 1px 4px ${C.shadow}`,
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={resolveCardIcon(v.icon)} size={18} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 8 }}>{v.label}</div>
                    <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.7 }}>{v.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <motion.div
              className="lp-value-grid"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
            >
              {(settings.featureCards || VALUE_PROPS).map((v, i) => (
                <motion.div key={v.label || i} variants={fadeUp} className="lp-val-card" style={{
                  background: C.surf, border: `1px solid ${C.brd}`,
                  borderRadius: 14, padding: '26px 24px 24px',
                  display: 'flex', gap: 18, alignItems: 'flex-start',
                  boxShadow: `0 1px 4px ${C.shadow}`,
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={resolveCardIcon(v.icon)} size={18} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 8 }}>{v.label}</div>
                    <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.7 }}>{v.desc}</div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          5. WORKFLOW — #workflow anchor (golden path steps)
          ══════════════════════════════════════════════════════════════ */}
      <section id="workflow" style={{ background: C.surf, borderBottom: `1px solid ${C.brd}` }}>
        <div className="lp-sect-inner" style={sectionPad}>
          <Reveal reduced={motionOff} style={{ marginBottom: 52 }}>
            <SectionTitle
              pretitle="Workflow"
              title={settings.workflowTitle || DEFAULTS.workflowTitle}
            >
              {settings.workflowSubtitle || DEFAULTS.workflowSubtitle}
            </SectionTitle>
          </Reveal>

          {/* Step nodes */}
          {motionOff ? (
            <div className="lp-step-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}>
              {WORKFLOW_STEPS.map((s, i) => {
                const active = i === activeStep;
                return (
                  <div key={s.label} className="lp-step-node" tabIndex={0}
                    onMouseEnter={() => setActiveStep(i)} onFocus={() => setActiveStep(i)}
                    style={{
                      background: active ? C.card2 : C.card,
                      border: `1px solid ${active ? alpha(C.acc, 0.55) : C.brd}`,
                      borderRadius: 10, padding: '13px 11px 11px', cursor: 'default', outline: 'none', minWidth: 0,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.gold, letterSpacing: '0.05em' }}>0{i + 1}</span>
                      <span style={{ color: active ? C.acc : C.muted, display: 'inline-flex' }}><Icon name={s.icon} size={13} /></span>
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.01em', color: active ? C.txt : C.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.label}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <motion.div
              className="lp-step-grid"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}
              variants={staggerFast}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-40px' }}
            >
              {WORKFLOW_STEPS.map((s, i) => {
                const active = i === activeStep;
                return (
                  <motion.div key={s.label} variants={fadeUp} className="lp-step-node" tabIndex={0}
                    onMouseEnter={() => setActiveStep(i)} onFocus={() => setActiveStep(i)}
                    style={{
                      background: active ? C.card2 : C.card,
                      border: `1px solid ${active ? alpha(C.acc, 0.55) : C.brd}`,
                      borderRadius: 10, padding: '13px 11px 11px', cursor: 'default', outline: 'none', minWidth: 0,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.gold, letterSpacing: '0.05em' }}>0{i + 1}</span>
                      <span style={{ color: active ? C.acc : C.muted, display: 'inline-flex' }}><Icon name={s.icon} size={13} /></span>
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.01em', color: active ? C.txt : C.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.label}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* Active step description panel */}
          <Reveal reduced={motionOff} delay={0.12}>
            <div style={{ marginTop: 16, minHeight: 46, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'baseline', gap: 10, maxWidth: 720 }} aria-live="polite">
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.gold, flexShrink: 0 }}>0{activeStep + 1}</span>
              <span style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6 }}>
                <span style={{ color: C.txt, fontWeight: 600 }}>{WORKFLOW_STEPS[activeStep].label}</span>
                {' — '}{WORKFLOW_STEPS[activeStep].desc}
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          6. SCREENING SECTION — screening, conflicts, reviewer flow
          ══════════════════════════════════════════════════════════════ */}
      <section style={{ background: C.bg, borderBottom: `1px solid ${C.brd}` }}>
        <div className="lp-sect-inner" style={sectionPad}>
          <Reveal reduced={motionOff} style={{ marginBottom: 52 }}>
            <SectionTitle pretitle="Screening" title="Screening built for systematic reviews.">
              Citation triage with dual-reviewer support, conflict detection, and PRISMA-ready counts — all in a single module.
            </SectionTitle>
          </Reveal>

          <div className="lp-sift-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start' }}>
            {/* Left: feature bullets */}
            {motionOff ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {[
                  { icon: 'filter',  title: 'Fast title/abstract screening', body: 'Single-reviewer or dual-reviewer mode. Keyboard-first interface lets you move through hundreds of records quickly without losing context.' },
                  { icon: 'scale',   title: 'Conflict management',           body: 'When reviewers disagree, conflicts surface automatically. A third adjudicator resolves them with full context on both decisions.' },
                  { icon: 'fileText',title: 'Full-text review',              body: 'Studies that pass title/abstract screening queue for full-text assessment. Decisions and notes carry through to extraction.' },
                  { icon: 'users',   title: 'Reviewer assignments',          body: 'Assign specific reviewers to citation batches. Track progress per reviewer and see coverage at a glance.' },
                ].map(({ icon, title, body }) => (
                  <div key={title} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <Icon name={icon} size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{title}</div>
                      <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.7 }}>{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <motion.div
                style={{ display: 'flex', flexDirection: 'column', gap: 32 }}
                variants={staggerContainer}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
              >
                {[
                  { icon: 'filter',  title: 'Fast title/abstract screening', body: 'Single-reviewer or dual-reviewer mode. Keyboard-first interface lets you move through hundreds of records quickly without losing context.' },
                  { icon: 'scale',   title: 'Conflict management',           body: 'When reviewers disagree, conflicts surface automatically. A third adjudicator resolves them with full context on both decisions.' },
                  { icon: 'fileText',title: 'Full-text review',              body: 'Studies that pass title/abstract screening queue for full-text assessment. Decisions and notes carry through to extraction.' },
                  { icon: 'users',   title: 'Reviewer assignments',          body: 'Assign specific reviewers to citation batches. Track progress per reviewer and see coverage at a glance.' },
                ].map(({ icon, title, body }) => (
                  <motion.div key={title} variants={fadeUp} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <Icon name={icon} size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{title}</div>
                      <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.7 }}>{body}</div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}

            {/* Right: summary card */}
            <Reveal reduced={motionOff} delay={0.1}>
              <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 16, padding: '32px 36px', boxShadow: `0 4px 20px ${C.shadow}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <HexLogo size={16} />
                  <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', color: C.txt }}>
                    Screening
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Screening module</span>
                </div>
                <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.8, margin: '0 0 24px' }}>
                  Screening is the screening half of the review workspace. Pair it with a PecanRev project and the PRISMA counts fill automatically from real decisions — no manual tracking.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    'Duplicate detection before screening begins',
                    'Title/abstract and full-text review stages',
                    'PRISMA 2020 counts auto-filled from decisions',
                    'Shared workspace — same team, same project',
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, background: alpha(C.grn, 0.12), color: C.grn, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                        <Icon name="check" size={11} />
                      </div>
                      <span style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.65 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          7. ANALYSIS SECTION — extraction, analysis, forest plot
          ══════════════════════════════════════════════════════════════ */}
      <section style={{ background: C.surf, borderBottom: `1px solid ${C.brd}` }}>
        <div className="lp-sect-inner" style={sectionPad}>
          <Reveal reduced={motionOff} style={{ marginBottom: 52 }}>
            <SectionTitle pretitle="Analysis" title="From extracted data to pooled estimate.">
              Structured extraction tables, effect-size calculations, meta-analysis engine, and publication-ready plots — all driven by your own data.
            </SectionTitle>
          </Reveal>

          <div className="lp-lab-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 48, alignItems: 'center' }}>
            {/* Left: forest plot illustration */}
            <div ref={fpRef}>
              <ForestPlotIllustration active={reduced || fpInView} />
            </div>

            {/* Right: bullets */}
            {motionOff ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {[
                  { icon: 'table',    title: 'Structured extraction',       body: 'Pre-defined forms for study characteristics, outcomes, and risk-of-bias domains. Custom fields for any additional data points.' },
                  { icon: 'sigma',    title: 'Meta-analysis engine',        body: 'Random- and fixed-effects pooling with HKSJ variance correction. Subgroup analyses, leave-one-out, Egger\'s test, and trim-and-fill.' },
                  { icon: 'forest',   title: 'Forest & funnel plots',       body: 'Weighted forest plots and funnel plots generated from your extracted data, formatted for journal submission.' },
                  { icon: 'award',    title: 'GRADE ratings',               body: 'Certainty-of-evidence assessments across five domains for each outcome, exportable as a summary-of-findings table.' },
                ].map(({ icon, title, body }) => (
                  <div key={title} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <Icon name={icon} size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{title}</div>
                      <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.7 }}>{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <motion.div
                style={{ display: 'flex', flexDirection: 'column', gap: 28 }}
                variants={staggerContainer}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
              >
                {[
                  { icon: 'table',    title: 'Structured extraction',       body: 'Pre-defined forms for study characteristics, outcomes, and risk-of-bias domains. Custom fields for any additional data points.' },
                  { icon: 'sigma',    title: 'Meta-analysis engine',        body: 'Random- and fixed-effects pooling with HKSJ variance correction. Subgroup analyses, leave-one-out, Egger\'s test, and trim-and-fill.' },
                  { icon: 'forest',   title: 'Forest & funnel plots',       body: 'Weighted forest plots and funnel plots generated from your extracted data, formatted for journal submission.' },
                  { icon: 'award',    title: 'GRADE ratings',               body: 'Certainty-of-evidence assessments across five domains for each outcome, exportable as a summary-of-findings table.' },
                ].map(({ icon, title, body }) => (
                  <motion.div key={title} variants={fadeUp} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <Icon name={icon} size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{title}</div>
                      <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.7 }}>{body}</div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          8. BENEFITS — simple blocks (Nextly Benefits style)
          ══════════════════════════════════════════════════════════════ */}
      <section id="about" style={{ background: C.bg, borderBottom: `1px solid ${C.brd}` }}>
        <div className="lp-sect-inner" style={sectionPad}>
          <Reveal reduced={motionOff} style={{ marginBottom: 56 }}>
            <SectionTitle pretitle="Why PecanRev" title={settings.whyTitle || DEFAULTS.whyTitle}>
              A dedicated workspace built around the methods — not a general tool adapted for reviews.
            </SectionTitle>
          </Reveal>

          {motionOff ? (
            <div className="lp-benefit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              {BENEFITS.map((b, i) => (
                <div key={b.title} className="lp-benefit-card" style={{
                  background: C.surf, border: `1px solid ${C.brd}`,
                  borderRadius: 14, padding: '28px 26px',
                  boxShadow: `0 1px 4px ${C.shadow}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={b.icon} size={17} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{b.title}</div>
                  </div>
                  <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.75 }}>{b.desc}</div>
                </div>
              ))}
            </div>
          ) : (
            <motion.div
              className="lp-benefit-grid"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-40px' }}
            >
              {BENEFITS.map((b, i) => (
                <motion.div key={b.title} variants={fadeUp} className="lp-benefit-card" style={{
                  background: C.surf, border: `1px solid ${C.brd}`,
                  borderRadius: 14, padding: '28px 26px',
                  boxShadow: `0 1px 4px ${C.shadow}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: C.accBg, color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={b.icon} size={17} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{b.title}</div>
                  </div>
                  <div style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.75 }}>{b.desc}</div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* About text (preserves aboutText1/2 keys) */}
          {(settings.aboutText1 || settings.aboutText2) && (
            <Reveal reduced={motionOff} delay={0.1} style={{ marginTop: 56 }}>
              <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
                {settings.aboutText1 && (
                  <p style={{ fontSize: 16, color: C.txt2, lineHeight: 1.85, margin: '0 0 18px' }}>
                    {settings.aboutText1}
                  </p>
                )}
                {settings.aboutText2 && (
                  <p style={{ fontSize: 16, color: C.txt2, lineHeight: 1.85, margin: 0 }}>
                    {settings.aboutText2}
                  </p>
                )}
              </div>
            </Reveal>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          9. FINAL CTA — Nextly indigo band
          ══════════════════════════════════════════════════════════════ */}
      <section style={{ background: C.surf, padding: '96px 48px', borderBottom: `1px solid ${C.brd}` }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <Reveal reduced={motionOff}>
            <div className="lp-cta-band" style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
              gap: 28, background: C.acc, borderRadius: 20, padding: '52px 56px',
              boxShadow: `0 20px 60px ${alpha(C.acc, 0.28)}`,
            }}>
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <h2 style={{ fontSize: 'clamp(22px, 3vw, 34px)', fontWeight: 800, letterSpacing: '-0.03em', color: '#ffffff', margin: '0 0 12px', lineHeight: 1.18 }}>
                  Start your systematic review today.
                </h2>
                <p style={{ fontSize: 16, color: alpha('#ffffff', 0.82), lineHeight: 1.7, margin: 0, maxWidth: 420, overflowWrap: 'break-word' }}>
                  One workspace from protocol to pooled estimate — documented, auditable, and ready for peer scrutiny.
                </p>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {user ? (
                  <MotionBtn onClick={() => navigate('/app')} style={{
                    ...btnPrimary, background: '#ffffff', color: C.acc, borderRadius: 10, fontSize: 15,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  }}>
                    Open Workspace <Icon name="arrowRight" size={16} />
                  </MotionBtn>
                ) : (
                  <>
                    <MotionBtn onClick={() => navigate('/register')} style={{
                      ...btnPrimary, background: '#ffffff', color: C.acc, borderRadius: 10, fontSize: 15,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    }}>
                      {settings.ctaText || 'Get started'} <Icon name="arrowRight" size={16} />
                    </MotionBtn>
                    <MotionBtn onClick={() => navigate('/login')} style={{
                      ...btnGhost, border: '1.5px solid rgba(255,255,255,0.4)', color: '#ffffff', background: 'transparent', borderRadius: 10, fontSize: 15,
                    }}>
                      {settings.ctaSecondaryText || 'Sign in'}
                    </MotionBtn>
                  </>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          CONTACT — #contact anchor (preserved, restyled only)
          ══════════════════════════════════════════════════════════════ */}
      <section id="contact" style={{ padding: '96px 48px', background: C.bg, borderTop: `1px solid ${C.brd}` }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <Reveal reduced={motionOff} style={{ textAlign: 'center', marginBottom: 48 }}>
            <SectionTitle
              pretitle="Contact"
              title={settings.contactTitle || 'Get in touch'}
            >
              {settings.contactSubtitle || DEFAULTS.contactSubtitle}
            </SectionTitle>
          </Reveal>

          {contactStatus === 'ok' ? (
            <div style={{ padding: '36px', background: C.grnBg, border: `1px solid ${alpha(C.grn, 0.3)}`, borderRadius: 14, textAlign: 'center' }}>
              <div style={{ marginBottom: 12 }}><Icon name="check" size={26} style={{ color: C.grn }} /></div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.grn, marginBottom: 8 }}>Message sent</div>
              <div style={{ fontSize: 13.5, color: C.txt2, marginBottom: 22 }}>We'll get back to you soon.</div>
              <button className="lp-btn-ghost" onClick={() => setContactStatus(null)} style={{ ...btnGhost, fontSize: 13, padding: '9px 22px', borderRadius: 8 }}>
                Send another
              </button>
            </div>
          ) : (
            <form onSubmit={handleContact} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {[
                { key: 'name',  label: 'Name',  type: 'text',  placeholder: 'Your name' },
                { key: 'email', label: 'Email', type: 'email', placeholder: 'you@institution.edu' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>{f.label}</label>
                  <input
                    className="lp-contact-input"
                    type={f.type} required
                    value={contact[f.key]}
                    onChange={e => setContact(c => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={inpStyle}
                  />
                </div>
              ))}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Message</label>
                <textarea
                  className="lp-contact-input"
                  required rows={5}
                  value={contact.message}
                  onChange={e => setContact(c => ({ ...c, message: e.target.value }))}
                  placeholder="Your message…"
                  style={{ ...inpStyle, resize: 'vertical', minHeight: 120 }}
                />
              </div>
              {contactStatus === 'err' && (
                <div style={{ fontSize: 12.5, color: C.red, padding: '10px 14px', background: C.redBg, border: `1px solid ${alpha(C.red, 0.25)}`, borderRadius: 8 }}>
                  {contactErr}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <MotionBtn className="lp-btn-primary" type="submit" disabled={contactStatus === 'sending'}
                  style={{ ...btnPrimary, borderRadius: 9, opacity: contactStatus === 'sending' ? 0.6 : 1 }}>
                  {contactStatus === 'sending' ? 'Sending…' : 'Send message'}
                </MotionBtn>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          10. FOOTER — clean, minimal, Nextly style
          ══════════════════════════════════════════════════════════════ */}
      <footer style={{ borderTop: `1px solid ${C.brd}`, background: C.surf, padding: '64px 48px 40px' }}>
        <div style={{ maxWidth: 1104, margin: '0 auto' }}>
          <div className="lp-footer-cols" style={{ display: 'flex', gap: 64, marginBottom: 52 }}>
            {/* Brand */}
            <div style={{ flex: '0 0 220px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
                <HexLogo size={18} />
                <Wordmark size={14} />
              </div>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, maxWidth: 200 }}>
                A structured workspace for systematic reviews and meta-analyses.
              </p>
            </div>

            {/* Platform */}
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 18, fontWeight: 700 }}>
                Platform
              </div>
              {['Features', 'Workflow', 'About', 'Contact'].map(l => (
                <a key={l} href={`#${l.toLowerCase()}`} className="lp-footer-link"
                  style={{ display: 'block', fontSize: 14, color: C.muted, textDecoration: 'none', marginBottom: 12 }}>
                  {l}
                </a>
              ))}
            </div>

            {/* Account */}
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 18, fontWeight: 700 }}>
                Account
              </div>
              {(settings.footerLinks || [{ label: 'Register', path: '/register' }, { label: 'Sign In', path: '/login' }]).map(link => (
                <button key={link.label} className="lp-footer-link"
                  onClick={() => navigate(link.path)}
                  style={{ display: 'block', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, fontFamily: FONT, padding: '0 0 12px 0', textAlign: 'left' }}>
                  {link.label}
                </button>
              ))}
            </div>

            {/* Standards */}
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 18, fontWeight: 700 }}>
                Standards
              </div>
              {['PRISMA 2020', 'Cochrane RoB 2.0', 'GRADE', 'PROSPERO'].map(s => (
                <div key={s} style={{ fontSize: 12.5, color: C.muted, fontFamily: MONO, marginBottom: 10, letterSpacing: '0.04em' }}>{s}</div>
              ))}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="lp-footer-bottom" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${C.brd}`, paddingTop: 24, flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>
              {settings.footerText || `© ${new Date().getFullYear()} PecanRev · Systematic review platform`}
            </span>
            <a href="#contact" className="lp-footer-link" style={{ fontSize: 12, color: C.muted, fontFamily: FONT, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="mail" size={12} />
              Contact us
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
