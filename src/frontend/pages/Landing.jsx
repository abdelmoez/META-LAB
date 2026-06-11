/**
 * Landing.jsx — public home page for META·LAB.
 *
 * v5 "evidence pipeline" redesign (prompt8):
 * "The page is a systematic review, running in slow motion."
 * Full-bleed hero with a Canvas 2D field of drifting records converging
 * into a forest plot · evidence spine with numbered PRISMA-style nodes ·
 * self-drawing forest-plot climax with count-up PRISMA funnel ·
 * META·LAB ⇄ META·SIFT linked-workspace beam · institution spec table.
 *
 * Content architecture unchanged: useLandingSettings() merges
 * GET /api/settings/public over DEFAULTS; every admin-editable key keeps
 * working (heroHeadline, featureCards, whyStandards, footerLinks, …).
 * Anchors #features / #workflow / #about / #contact preserved.
 * All motion honors prefers-reduced-motion (static final compositions).
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api-client/apiClient.js';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { Icon, ICON_NAMES } from '../components/icons.jsx';

/* ─── Static content ─────────────────────────────────────────────────── */
const STEPS = [
  { n: '01', icon: 'target',    label: 'PICO Framework',    desc: 'Define Population, Intervention, Comparator, and Outcome fields.' },
  { n: '02', icon: 'clipboard', label: 'PROSPERO Protocol', desc: 'Draft and export a structured registration protocol aligned with PROSPERO.' },
  { n: '03', icon: 'search',    label: 'Search Strategy',   desc: 'Build reproducible search strings with syntax-native query construction.' },
  { n: '04', icon: 'bookOpen',  label: 'MeSH Terms',        desc: 'Comprehensive MeSH term expansion across PubMed, Embase, and Cochrane.' },
  { n: '05', icon: 'flow',      label: 'PRISMA Flow',       desc: 'Track screening at each stage and generate the PRISMA 2020 flow diagram.' },
  { n: '06', icon: 'filter',    label: 'Screening',         desc: 'Dual-reviewer citation triage with conflict resolution and audit trail.' },
  { n: '07', icon: 'table',     label: 'Data Extraction',   desc: 'Structured tables for study characteristics, outcomes, and effect sizes.' },
  { n: '08', icon: 'scale',     label: 'Risk of Bias',      desc: 'Cochrane RoB 2.0 and ROBINS-I assessments with domain-level judgements.' },
  { n: '09', icon: 'sigma',     label: 'Meta-Analysis',     desc: 'Random- and fixed-effects pooling with HKSJ variance correction.' },
  { n: '10', icon: 'forest',    label: 'Forest Plot',       desc: 'Publication-ready forest plots with confidence intervals and weights.' },
  { n: '11', icon: 'activity',  label: 'Sensitivity',       desc: 'Leave-one-out analysis and influence diagnostics for robustness checks.' },
  { n: '12', icon: 'layers',    label: 'Subgroup',          desc: 'Pre-specified subgroup analyses with between-group heterogeneity tests.' },
  { n: '13', icon: 'award',     label: 'GRADE',             desc: 'Certainty-of-evidence ratings across five domains for each outcome.' },
  { n: '14', icon: 'fileText',  label: 'Manuscript',        desc: 'IMRAD-structured manuscript template with PRISMA checklist export.' },
];

const VALUE_PROPS = [
  { icon: 'clipboard',   label: 'Protocol-first',   desc: 'Start with PICO and PROSPERO registration before touching a single record.' },
  { icon: 'checkSquare', label: 'Reproducible',     desc: 'Every search string, screening decision, and diagram is logged and exportable.' },
  { icon: 'sigma',       label: 'Analysis-ready',   desc: "Built-in forest plots, heterogeneity stats, Egger's test, and GRADE ratings." },
  { icon: 'hexagon',     label: 'Single workspace', desc: 'From research question to manuscript draft — all in one structured tool.' },
  { icon: 'clock',       label: 'Audit trail',      desc: 'Every decision timestamped and exportable for transparent peer review.' },
  { icon: 'users',       label: 'Multi-user',       desc: 'Collaborative extraction and dual-reviewer screening with conflict resolution.' },
];

/* Legacy unicode glyphs (older admin-saved featureCards) → icon names. */
const GLYPH_ICONS = {
  '◈': 'clipboard',
  '⊞': 'checkSquare',
  '◉': 'sigma',
  '⬡': 'hexagon',
  '◎': 'clock',
  '◫': 'users',
};

function resolveCardIcon(icon) {
  if (icon && ICON_NAMES.includes(icon)) return icon;
  if (icon && GLYPH_ICONS[icon]) return GLYPH_ICONS[icon];
  return 'hexagon';
}

const STANDARDS = [
  'PRISMA 2020 — flow diagram generation',
  'Cochrane RoB 2.0 & ROBINS-I',
  'GRADE certainty-of-evidence framework',
  'Full audit trail — every decision timestamped',
];

/* ─── Default settings (shown immediately; replaced when server responds) */
const DEFAULTS = {
  logoText:          'META·LAB',
  navLinks:          [
    { label: 'Features', href: '#features' },
    { label: 'Workflow', href: '#workflow' },
    { label: 'About',    href: '#about'    },
    { label: 'Contact',  href: '#contact'  },
  ],
  heroHeadline:      'A serious workspace for\nsystematic reviews.',
  heroSubtitle:      'Organize evidence, extract data, run pooled analyses, and export research-ready reports — from one secure platform.',
  ctaText:           'Start Your Review',
  ctaSecondaryText:  'Sign in',
  featureTitle:      'Everything a rigorous review needs',
  featureCards:      VALUE_PROPS,
  workflowTitle:     '14 steps from question to manuscript',
  workflowSubtitle:  'Every systematic review follows the same evidence-based process. META·LAB walks you through each stage without letting you skip ahead.',
  whyTitle:          'For researchers who care about rigor',
  whyBody1:          'Systematic reviews demand a level of methodological transparency that general research tools cannot provide.',
  whyBody2:          'META·LAB enforces a structured workflow aligned with Cochrane Handbook principles and international reporting standards.',
  whyBody3:          'Every decision — from inclusion criteria to subgroup definitions — is documented in a tamper-evident audit trail, so peer reviewers and editors can retrace your entire process.',
  whyStandards:      STANDARDS,
  aboutHeadline:     'What is META·LAB?',
  aboutText1:        'META·LAB is a structured, multi-user platform for conducting systematic reviews and meta-analyses. It covers the complete research cycle — from PICO definition and search strategy through screening, data extraction, statistical analysis, and manuscript preparation.',
  aboutText2:        'Built for academic researchers, clinical teams, and evidence synthesis groups who need a single, auditable workspace rather than a collection of disconnected tools.',
  contactTitle:      'Get in touch',
  contactSubtitle:   'Questions about META·LAB, research collaborations, or institutional access.',
  footerText:        '',
  footerLinks:       [{ label: 'Register', path: '/register' }, { label: 'Sign In', path: '/login' }],
  announcementBanner:'',
  maintenanceBanner: '',
  seoTitle:          '',
  seoDescription:    '',
};

/* ─── Hook: fetch public settings (non-blocking) ─────────────────────── */
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

/** One-shot in-view detector. Falls back to "visible" without IO support. */
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

/** rAF count-up: 0 → target once `run` is true (instant when reduced). */
function useCountUp(target, run, reduced, dur = 1500) {
  const [val, setVal] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) { setVal(target); return; }
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = now => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, reduced, dur]);
  return val;
}

/* ─── Runtime theme color reads (canvas cannot use var(--t-*)) ────────── */
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
    acc:  hexToRgb(get('--t-acc',  '#6ba1f7')),
    gold: hexToRgb(get('--t-gold', '#d8ab6e')),
    txt:  hexToRgb(get('--t-txt',  '#eef2fc')),
    day:  document.documentElement.dataset.theme === 'day',
  };
}

const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

/* ─── Tiny monospace section label ───────────────────────────────────── */
function SectionLabel({ text, style }) {
  return (
    <div style={{
      fontSize: 10, fontFamily: MONO, color: C.muted,
      letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 14,
      ...style,
    }}>
      {text}
    </div>
  );
}

/* ─── Wordmark: META·LAB with mono accent middot ─────────────────────── */
function Wordmark({ size = 13, weight = 700, spacing = '0.08em' }) {
  return (
    <span style={{ fontSize: size, fontWeight: weight, letterSpacing: spacing, color: C.txt, whiteSpace: 'nowrap' }}>
      META<span style={{ color: C.acc, fontFamily: MONO, fontWeight: 400 }}>·</span>LAB
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

/* ════════════════════════════════════════════════════════════════════════
   HERO CANVAS — records (drifting points) converging into a forest plot.
   Single canvas, rAF, paused when tab hidden or canvas off-viewport,
   DPR capped at 1.5. Reduced motion: one static final composition.
   ════════════════════════════════════════════════════════════════════════ */

/* Study CI rows as fractions of the mini-plot width (matches the climax
   plot data: SMD range −0.5…1.3 normalized to 0…1). */
const CANVAS_ROWS = [
  { lo: 0.478, hi: 0.767, es: 0.622, w: 1.00 },
  { lo: 0.350, hi: 0.694, es: 0.522, w: 0.72 },
  { lo: 0.556, hi: 0.789, es: 0.672, w: 1.18 },
  { lo: 0.450, hi: 0.717, es: 0.583, w: 0.96 },
  { lo: 0.311, hi: 0.667, es: 0.489, w: 0.64 },
];
const CANVAS_POOL = { lo: 0.522, hi: 0.678, es: 0.600 };

function HeroCanvas({ reduced }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let colors = readCanvasColors();
    let raf = 0;
    let running = false;
    let tabVisible = !document.hidden;
    let onScreen = true;
    let W = 0, H = 0;
    let rows = [];          // pixel geometry of the 5 CI rows
    let pool = null;        // pooled diamond geometry
    const particles = [];
    const N = 120;          // total points
    const NC = 46;          // of which converge onto the plot
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

      /* Forest geometry: right side of the hero (hidden under text on
         small screens, where the canvas is mostly ambient). */
      const fw = Math.min(W * 0.30, 380);
      const fx = Math.min(W * 0.64, W - fw - 24);
      const gap = Math.min(Math.max(H * 0.062, 30), 46);
      const fy = H * 0.5 - gap * 3.1;
      rows = CANVAS_ROWS.map((r, i) => ({
        y:  fy + i * gap,
        x1: fx + r.lo * fw,
        x2: fx + r.hi * fw,
        xm: fx + r.es * fw,
        sz: 4 + r.w * 3.4,
      }));
      pool = {
        x1: fx + CANVAS_POOL.lo * fw,
        x2: fx + CANVAS_POOL.hi * fw,
        xm: fx + CANVAS_POOL.es * fw,
        y:  fy + rows.length * gap + gap * 0.7,
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
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.10,
          vy: (Math.random() - 0.5) * 0.07,
          r: 0.7 + Math.random() * 1.3,
          a: 0.10 + Math.random() * 0.26,
          tw: Math.random() * Math.PI * 2,           // twinkle phase
          conv,
          row: i % CANVAS_ROWS.length,
          frac: Math.random(),
          jit: (Math.random() - 0.5) * 5,
          k: 0.0022 + Math.random() * 0.0030,        // attraction strength
          delay: Math.random() * 9000,               // staggered departure
          tx: 0, ty: 0,
        });
      }
      retarget();
    }

    /* Single drawn frame. `t` = elapsed ms; `final` forces the converged
       end-state (reduced-motion static composition). */
    function draw(t, final) {
      ctx.clearRect(0, 0, W, H);
      const { acc, gold, txt, day } = colors;
      const lineA  = day ? 0.34 : 0.30;
      const ptBase = day ? 0.55 : 0.85;

      /* Global convergence progress 0→1 over ~26s (the slow reveal). */
      const prog = final ? 1 : Math.min(1, t / 26000);

      /* Plot scaffold: CI rows strengthen as records arrive. */
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
          /* Effect-size square, weight-scaled. */
          ctx.fillStyle = rgba(acc, (day ? 0.7 : 0.8) * ra);
          const s = r.sz;
          ctx.fillRect(r.xm - s / 2, r.y - s / 2, s, s);
        }

        /* Pooled diamond lands last, with a soft breathing glow. */
        const da = Math.max(0, Math.min(1, prog * 1.8 - 0.8));
        if (pool && da > 0.01) {
          const pulse = final ? 0.5 : 0.5 + 0.28 * Math.sin(t / 1700);
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

      /* Records. Ambient ones drift forever; convergers ease home. */
      for (const p of particles) {
        if (p.conv && (final || t > p.delay)) {
          /* eased attraction toward the assigned CI slot */
          if (final) { p.x = p.tx; p.y = p.ty; }
          else {
            p.x += (p.tx - p.x) * p.k;
            p.y += (p.ty - p.y) * p.k;
            p.x += p.vx * 0.25;
            p.y += p.vy * 0.25;
          }
        } else if (!final) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4;
          if (p.y < -4) p.y = H + 4; else if (p.y > H + 4) p.y = -4;
        }
        const twinkle = final ? 1 : 0.78 + 0.22 * Math.sin(t / 2400 + p.tw);
        let a = p.a * ptBase * twinkle;
        if (p.conv) {
          const d = Math.hypot(p.tx - p.x, p.ty - p.y);
          const near = Math.max(0, 1 - d / 220);
          a = Math.min(0.9, a + near * 0.35);   // brighten as they settle
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
      if (should && !running) {
        running = true;
        if (!raf) raf = requestAnimationFrame(frame);
      } else if (!should && running) {
        running = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      }
    }

    const onVis = () => { tabVisible = !document.hidden; syncRun(); };
    const onTheme = () => {
      colors = readCanvasColors();
      if (reduced) draw(0, true);
    };
    const onResize = () => {
      layout();
      if (reduced) draw(0, true);
    };

    layout();
    seed();

    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(entries => {
        onScreen = entries.some(e => e.isIntersecting);
        syncRun();
      }, { threshold: 0 });
      io.observe(canvas);
    }

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('metalab:theme-change', onTheme);
    window.addEventListener('resize', onResize);

    if (reduced) draw(0, true);   // static final composition
    else syncRun();

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('metalab:theme-change', onTheme);
      window.removeEventListener('resize', onResize);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════════
   EVIDENCE CLIMAX — self-drawing forest plot (animates when scrolled into
   view, one-shot) + PRISMA funnel count-up. Illustrative data.
   ════════════════════════════════════════════════════════════════════════ */
const FP_STUDIES = [
  { label: 'Smith et al., 2021',  n: 142, es: 0.62, lo: 0.36, hi: 0.88, w: '22.4%' },
  { label: 'Chen et al., 2022',   n:  89, es: 0.44, lo: 0.13, hi: 0.75, w: '15.1%' },
  { label: 'Kumar et al., 2020',  n: 203, es: 0.71, lo: 0.50, hi: 0.92, w: '28.6%' },
  { label: 'Walsh et al., 2023',  n: 167, es: 0.55, lo: 0.31, hi: 0.79, w: '21.7%' },
  { label: 'Nakamura, 2021',      n:  98, es: 0.38, lo: 0.06, hi: 0.70, w: '12.2%' },
];
const FP_POOLED = { es: 0.58, lo: 0.44, hi: 0.72 };

function ForestPlotClimax({ active }) {
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
      borderRadius: 12, overflow: 'hidden', fontFamily: FONT,
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
        <span style={{
          marginLeft: 'auto', fontSize: 8.5, fontFamily: MONO, color: C.dim,
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          Illustrative data
        </span>
      </div>

      <div style={{ padding: '16px 14px 12px' }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
          <text x={STAT_X + 22} y={HDR_Y - 4}
            style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>N</text>
          <text x={STAT_X + 68} y={HDR_Y - 4}
            style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>Weight</text>

          <line x1={ZERO} y1={HDR_Y} x2={ZERO} y2={poolY + ROW_H * 0.4}
            stroke={C.brd2} strokeWidth={1} strokeDasharray="3,3" />

          {FP_STUDIES.map((s, i) => {
            const y   = firstY + i * ROW_H + ROW_H / 2;
            const x1  = toX(s.lo);
            const x2  = toX(s.hi);
            const xm  = toX(s.es);
            const bsz = boxSize(s.w);
            return (
              <g key={s.label} className="lp-fp-row" style={{ animationDelay: `${0.1 + i * 0.13}s` }}>
                <text x={0} y={y + 3.5}
                  style={{ fontSize: 9.5, fontFamily: FONT, fill: C.txt2 }}>
                  {s.label}
                </text>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke={C.brd2} strokeWidth={1.5} />
                <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} stroke={C.brd2} strokeWidth={1} />
                <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} stroke={C.brd2} strokeWidth={1} />
                <rect x={xm - bsz / 2} y={y - bsz / 2}
                  width={bsz} height={bsz}
                  fill={C.acc} stroke={C.acc2} strokeWidth={0.5} />
                <text x={STAT_X + 22} y={y + 3.5}
                  style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>
                  {s.n}
                </text>
                <text x={STAT_X + 68} y={y + 3.5}
                  style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>
                  {s.w}
                </text>
              </g>
            );
          })}

          <line x1={0} y1={poolY - ROW_H * 0.35} x2={VB_W} y2={poolY - ROW_H * 0.35}
            stroke={C.brd} strokeWidth={0.5} />

          {(() => {
            const y   = poolY;
            const xlo = toX(FP_POOLED.lo);
            const xhi = toX(FP_POOLED.hi);
            const xm  = toX(FP_POOLED.es);
            const dh  = 8;
            return (
              <g className="lp-fp-pool" style={{ animationDelay: '0.85s' }}>
                <text x={0} y={y + 4}
                  style={{ fontSize: 9.5, fontFamily: FONT, fill: C.txt, fontWeight: 600 }}>
                  Pooled estimate
                </text>
                <polygon
                  points={`${xlo},${y} ${xm},${y - dh} ${xhi},${y} ${xm},${y + dh}`}
                  fill={C.gold} stroke="none" />
                <text x={STAT_X + 68} y={y + 4}
                  style={{ fontSize: 9, fontFamily: MONO, fill: C.gold, textAnchor: 'middle', fontWeight: 700 }}>
                  100%
                </text>
              </g>
            );
          })()}

          {[-0.25, 0, 0.5, 1.0].map(v => (
            <text key={v} x={toX(v)} y={axisY + 12}
              style={{ fontSize: 8, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>
              {v}
            </text>
          ))}
          <text x={PLT_X + 4} y={axisY + 26}
            style={{ fontSize: 8, fontFamily: FONT, fill: C.muted }}>
            ← Favours control
          </text>
          <text x={PLT_X + PLT_W - 4} y={axisY + 26}
            style={{ fontSize: 8, fontFamily: FONT, fill: C.muted, textAnchor: 'end' }}>
            Favours treatment →
          </text>
        </svg>

        <div style={{
          display: 'flex', gap: 14, borderTop: `1px solid ${C.brd}`,
          paddingTop: 10, marginTop: 2, flexWrap: 'wrap',
        }}>
          {[
            ['SMD', '0.58 [0.44–0.72]'],
            ['I²',  '23.4%'],
            ['τ²',  '0.021'],
            ['p',   '< 0.001'],
          ].map(([k, v]) => (
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

const PRISMA_STAGES = [
  { label: 'Records identified', value: 1284, icon: 'search'   },
  { label: 'After deduplication / screened', value: 1022, icon: 'filter' },
  { label: 'Full-text assessed', value: 164,  icon: 'fileText' },
  { label: 'Studies included',   value: 38,   icon: 'check'    },
];

function PrismaStageRow({ stage, run, reduced, last, delayIdx }) {
  const val = useCountUp(stage.value, run, reduced, 1300 + delayIdx * 250);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        border: `1px solid ${last ? alpha(C.gold, 0.5) : C.brd2}`,
        background: last ? alpha(C.gold, 0.12) : C.surf,
        color: last ? C.gold : C.muted,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={stage.icon} size={14} />
      </span>
      <span style={{ fontSize: 13, color: C.txt2, flex: 1, minWidth: 0 }}>{stage.label}</span>
      <span style={{
        fontSize: 22, fontFamily: MONO, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: last ? C.gold : C.txt, letterSpacing: '-0.02em',
        minWidth: 76, textAlign: 'right',
      }}>
        {val.toLocaleString('en-US')}
      </span>
    </div>
  );
}

/* ─── Mini forest used inside the app preview frame ──────────────────── */
function MiniForest() {
  const rows = [
    { lo: 50,  hi: 150, mid: 96,  w: 7 },
    { lo: 34,  hi: 118, mid: 72,  w: 6 },
    { lo: 76,  hi: 172, mid: 122, w: 9 },
    { lo: 58,  hi: 140, mid: 102, w: 8 },
    { lo: 26,  hi: 132, mid: 80,  w: 6 },
    { lo: 64,  hi: 156, mid: 110, w: 7 },
  ];
  const ROW = 21, TOP = 14;
  const poolY = TOP + rows.length * ROW + 12;
  const H = poolY + 18;
  return (
    <svg viewBox={`0 0 210 ${H}`} style={{ width: '100%', display: 'block' }} aria-hidden="true">
      <line x1={92} y1={6} x2={92} y2={poolY + 8} stroke={C.brd2} strokeWidth={1} strokeDasharray="3,3" />
      {rows.map((r, i) => {
        const y = TOP + i * ROW;
        return (
          <g key={i}>
            <line x1={r.lo / 1.3 + 30} y1={y} x2={r.hi / 1.3 + 30} y2={y} stroke={C.brd2} strokeWidth={1.4} />
            <rect x={r.mid / 1.3 + 30 - r.w / 2} y={y - r.w / 2} width={r.w} height={r.w} fill={C.acc} />
          </g>
        );
      })}
      <polygon
        points={`${88},${poolY} ${106},${poolY - 7} ${124},${poolY} ${106},${poolY + 7}`}
        fill={C.gold} />
    </svg>
  );
}

/* ─── Product preview: stylized in-code app composition ──────────────── */
function AppPreview() {
  const sideItems = [
    ['grid',     'Overview'],
    ['search',   'Search'],
    ['filter',   'Screening'],
    ['table',    'Extraction'],
    ['scale',    'Risk of Bias'],
    ['sigma',    'Analysis'],
    ['fileText', 'Manuscript'],
  ];
  const stats = [
    ['Included studies', '38'],
    ['Pooled SMD',       '0.58'],
    ['I²',               '23.4%'],
    ['GRADE',            'Moderate'],
  ];
  const funnel = [
    ['Identified',  '1,284', 100],
    ['Deduplicated','1,022', 80],
    ['Screened',    '1,022', 80],
    ['Full-text',   '164',   38],
    ['Included',    '38',    16],
  ];
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 12,
      overflow: 'hidden', boxShadow: `0 28px 70px ${C.shadow}`,
    }}>
      {/* Chrome bar */}
      <div style={{
        background: C.surf, borderBottom: `1px solid ${C.brd}`,
        padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: C.dim, opacity: 0.8 - i * 0.18 }} />
          ))}
        </div>
        <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO, marginLeft: 4, letterSpacing: '0.04em' }}>
          META·LAB — Workspace · Analysis
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 8.5, fontFamily: MONO, color: C.dim,
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          Illustrative
        </span>
      </div>

      <div style={{ display: 'flex', minHeight: 300 }}>
        {/* Sidebar */}
        <div className="lp-frame-side" style={{
          width: 168, flexShrink: 0, background: C.surf,
          borderRight: `1px solid ${C.brd}`, padding: '14px 10px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 8px 12px' }}>
            <HexLogo size={14} />
            <Wordmark size={11} />
          </div>
          {sideItems.map(([ico, label]) => {
            const active = label === 'Analysis';
            return (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 9px', borderRadius: 6,
                background: active ? C.accBg : 'transparent',
                color: active ? C.acc : C.muted,
                fontSize: 11.5, fontWeight: active ? 600 : 400,
              }}>
                <Icon name={ico} size={13} />
                {label}
              </div>
            );
          })}
        </div>

        {/* Main area */}
        <div style={{ flex: 1, padding: '18px 18px 16px', minWidth: 0 }}>
          {/* Stat cards */}
          <div className="lp-frame-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {stats.map(([k, v], i) => (
              <div key={k} style={{
                background: C.surf, border: `1px solid ${C.brd}`,
                borderRadius: 8, padding: '10px 12px', minWidth: 0,
              }}>
                <div style={{ fontSize: 8.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {k}
                </div>
                <div style={{ fontSize: 16, fontFamily: MONO, fontWeight: 700, color: i === 3 ? C.gold : C.txt, letterSpacing: '-0.02em' }}>
                  {v}
                </div>
              </div>
            ))}
          </div>

          {/* Forest plot + PRISMA funnel */}
          <div className="lp-frame-panels" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10 }}>
            <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
              <div style={{ fontSize: 8.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="forest" size={11} /> Forest plot
              </div>
              <MiniForest />
            </div>
            <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
              <div style={{ fontSize: 8.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="flow" size={11} /> PRISMA flow
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {funnel.map(([k, v, w], i) => (
                  <div key={k + i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 9.5, color: C.txt2 }}>{k}</span>
                      <span style={{ fontSize: 9.5, fontFamily: MONO, color: i === funnel.length - 1 ? C.gold : C.txt, fontWeight: 700 }}>{v}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: alpha(C.brd, '90'), overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${w}%`, borderRadius: 99,
                        background: i === funnel.length - 1 ? C.gold : C.acc,
                        opacity: i === funnel.length - 1 ? 1 : 0.75,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── META·LAB ⇄ META·SIFT linked-workspace cards + traveling pulse ──── */
function LinkedProducts() {
  const card = (name, tag, bullets) => (
    <div className="lp-link-card" style={{
      flex: 1, minWidth: 0, background: C.card,
      border: `1px solid ${C.brd}`, borderRadius: 12, padding: '28px 28px 24px',
      position: 'relative', zIndex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <HexLogo size={17} />
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.06em', color: C.txt }}>
          {name.split('·')[0]}
          <span style={{ color: C.acc, fontFamily: MONO, fontWeight: 400 }}>·</span>
          {name.split('·')[1]}
        </span>
      </div>
      <div style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 18 }}>
        {tag}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {bullets.map(([ico, txt]) => (
          <div key={txt} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Icon name={ico} size={13} style={{ color: C.acc, marginTop: 2 }} />
            <span style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6 }}>{txt}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="lp-link-row" style={{ display: 'flex', alignItems: 'stretch', gap: 0, position: 'relative' }}>
        {card('META·LAB', 'Extraction · Analysis · Manuscript', [
          ['table',    'Structured data extraction and outcome tables'],
          ['sigma',    'Pooled analysis, heterogeneity, GRADE'],
          ['fileText', 'IMRAD manuscript with PRISMA checklist export'],
        ])}

        {/* Link beam */}
        <div className="lp-link-beam" style={{
          width: 130, flexShrink: 0, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} aria-hidden="true">
          <svg viewBox="0 0 130 60" style={{ width: '100%', height: 60, overflow: 'visible' }}>
            <line x1="0" y1="30" x2="130" y2="30" stroke={alpha(C.acc, 0.25)} strokeWidth="1.5" />
            <line className="lp-beam-pulse" x1="0" y1="30" x2="130" y2="30"
              stroke={C.acc} strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray="16 240" />
            <circle cx="0" cy="30" r="3" fill={C.acc} opacity="0.85" />
            <circle cx="130" cy="30" r="3" fill={C.acc} opacity="0.85" />
          </svg>
          <span style={{
            position: 'absolute', top: 'calc(50% - 34px)', left: '50%', transform: 'translateX(-50%)',
            fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.14em',
            textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            Linked
          </span>
        </div>

        {card('META·SIFT', 'Screening · Conflicts · PRISMA', [
          ['users',  'Dual-reviewer title/abstract and full-text screening'],
          ['scale',  'Conflict detection and adjudication'],
          ['flow',   'PRISMA counts auto-filled from screening decisions'],
        ])}
      </div>

      <p style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.8, maxWidth: 640, margin: '26px 0 0' }}>
        Linked projects share one Review Workspace — same owner, members, and
        permissions on both sides. Studies accepted in META·SIFT flow back into
        META·LAB extraction, and the PRISMA flow diagram fills itself from real
        screening decisions.
      </p>
    </div>
  );
}

/* ─── Evidence spine section wrapper ─────────────────────────────────── */
/* A numbered PRISMA-style node on a thin vertical rail; the rail draws
   downward and the body rises into view when the section is scrolled to.
   The rail hides on mobile. */
function SpineSection({ num, id, label, alt, children, wide }) {
  const [ref, inView] = useInView(0.08, '0px 0px -6% 0px');
  return (
    <section
      id={id}
      ref={ref}
      className={`lp-sp-sec${inView ? ' in-view' : ''}`}
      style={{
        background: alt ? C.surf : C.bg,
        borderTop: `1px solid ${C.brd}`,
      }}
    >
      <div className="lp-sp-inner" style={{
        maxWidth: 1200, margin: '0 auto', padding: '0 48px',
        display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)',
      }}>
        <div className="lp-sp-rail" style={{ position: 'relative' }} aria-hidden="true">
          <div className="lp-sp-line" />
          <div className="lp-sp-node" style={{ background: alt ? C.surf : C.bg }}>{num}</div>
        </div>
        <div className="lp-sp-body" style={{ minWidth: 0, padding: '78px 0 84px', maxWidth: wide ? undefined : 1020 }}>
          <SectionLabel text={label} />
          {children}
        </div>
      </div>
    </section>
  );
}

/* ─── Evidence climax block: self-drawing plot + PRISMA count-up ─────── */
function EvidenceClimax({ reduced }) {
  const [ref, inView] = useInView(0.25, '0px 0px -8% 0px');
  const active = reduced || inView;
  return (
    <div ref={ref} className="lp-climax-grid" style={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
      gap: 48, alignItems: 'center',
    }}>
      <ForestPlotClimax active={active} />
      <div>
        <div style={{
          fontSize: 10, fontFamily: MONO, color: C.muted,
          letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 22,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="flow" size={12} /> PRISMA flow
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {PRISMA_STAGES.map((st, i) => (
            <PrismaStageRow
              key={st.label}
              stage={st}
              run={active}
              reduced={reduced}
              delayIdx={i}
              last={i === PRISMA_STAGES.length - 1}
            />
          ))}
        </div>
        <div style={{
          marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.brd}`,
          fontSize: 12.5, color: C.muted, lineHeight: 1.7,
        }}>
          1,284 records enter. 38 survive. One pooled estimate comes out —
          with every decision on the record.
        </div>
        <div style={{
          marginTop: 12, fontSize: 9.5, fontFamily: MONO, color: C.dim,
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          Illustrative data
        </div>
      </div>
    </div>
  );
}

/* ─── Institution-grade specification table ──────────────────────────── */
const INSTITUTION_SPECS = [
  ['Workspaces',          'Multi-user review workspaces — one shared project across the whole team.'],
  ['Roles & permissions', 'Owner, leader, and member roles with granular per-member permissions.'],
  ['Audit trail',         'Per-decision audit trail across screening, extraction, and analysis.'],
  ['Data isolation',      'Server-side per-user data isolation — every request is scoped to the signed-in account.'],
  ['Deployment',          'Self-hostable on your own infrastructure.'],
];

function InstitutionSpecs() {
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 12, overflow: 'hidden', background: C.card }}>
      {INSTITUTION_SPECS.map(([k, v], i) => (
        <div key={k} className="lp-spec-row" style={{
          display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)',
          gap: 24, padding: '17px 26px',
          borderTop: i > 0 ? `1px solid ${C.brd}` : 'none',
        }}>
          <span style={{
            fontSize: 10.5, fontFamily: MONO, color: C.muted,
            letterSpacing: '0.12em', textTransform: 'uppercase', paddingTop: 2,
          }}>
            {k}
          </span>
          <span style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.65 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════ */
export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const settings = useLandingSettings();
  const reduced  = usePrefersReducedMotion();

  useEffect(() => {
    if (settings.seoTitle) document.title = settings.seoTitle;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && settings.seoDescription) meta.setAttribute('content', settings.seoDescription);
  }, [settings.seoTitle, settings.seoDescription]);

  const [navOpen,          setNavOpen]          = useState(false);
  const [activeStep,       setActiveStep]       = useState(0);
  const [bannerDismissed,  setBannerDismissed]  = useState(() => {
    try { return !!localStorage.getItem('ml_banner_dismissed'); } catch { return false; }
  });
  const [contact,          setContact]          = useState({ name: '', email: '', message: '' });
  const [contactStatus,    setContactStatus]    = useState(null);
  const [contactErr,       setContactErr]       = useState('');

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

  const inpStyle = {
    width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
    borderRadius: 7, padding: '11px 14px', color: C.txt,
    fontFamily: FONT, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

  const btnPrimary = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 9, padding: '13px 28px', background: C.acc, border: 'none',
    borderRadius: 8, color: C.accText, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT, letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
  };
  const btnGhost = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: '13px 28px', background: 'transparent',
    border: `1px solid ${C.brd2}`, borderRadius: 8,
    color: C.txt2, fontSize: 14, cursor: 'pointer',
    fontFamily: FONT, letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
  };

  const h2Style = {
    fontSize: 'clamp(24px, 3vw, 31px)', fontWeight: 700, color: C.txt,
    letterSpacing: '-0.7px', margin: '0 0 14px', lineHeight: 1.2,
  };
  const subStyle = {
    fontSize: 14.5, color: C.txt2, maxWidth: 560, lineHeight: 1.75, margin: 0,
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        html { scroll-behavior: smooth; }

        .lp-btn-primary { transition: background 0.15s, transform 0.12s, box-shadow 0.15s; }
        .lp-btn-primary:hover { background: ${C.acc2} !important; transform: translateY(-1px); box-shadow: 0 6px 20px ${alpha(C.acc, '40')}; }
        .lp-btn-ghost { transition: border-color 0.15s, color 0.15s; }
        .lp-btn-ghost:hover { border-color: ${C.acc} !important; color: ${C.acc} !important; }

        .lp-nav-link { transition: color 0.15s; }
        .lp-nav-link:hover { color: ${C.txt} !important; }

        .lp-val-card { transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s; }
        .lp-val-card:hover { border-color: ${C.brd2} !important; transform: translateY(-2px); box-shadow: 0 8px 28px ${C.shadow}; }

        .lp-link-card { transition: border-color 0.2s, transform 0.15s, box-shadow 0.15s; }
        .lp-link-card:hover { border-color: ${alpha(C.acc, '55')} !important; transform: translateY(-2px); box-shadow: 0 10px 32px ${C.shadow}; }

        .lp-rail-node { transition: border-color 0.15s, background 0.15s; }
        .lp-rail-node:focus-visible { border-color: ${C.acc} !important; }

        .lp-footer-link { transition: color 0.15s; }
        .lp-footer-link:hover { color: ${C.txt2} !important; }

        /* ── Hero entrance ───────────────────────────────────────────── */
        @keyframes lpFadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: none; }
        }
        .lp-fade-up { animation: lpFadeUp 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }

        /* ── Evidence spine ──────────────────────────────────────────── */
        .lp-sp-line {
          position: absolute; left: 14px; top: 0; bottom: 0; width: 1px;
          background: linear-gradient(to bottom, ${alpha(C.acc, 0.45)}, ${alpha(C.acc, 0.10)});
          transform: scaleY(0); transform-origin: top;
          transition: transform 1.2s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .lp-sp-sec.in-view .lp-sp-line { transform: scaleY(1); }
        .lp-sp-node {
          position: absolute; left: 0; top: 74px;
          width: 29px; height: 29px; border-radius: 50%;
          border: 1px solid ${alpha(C.acc, 0.55)};
          background: ${C.bg};
          color: ${C.acc}; font-family: ${MONO}; font-size: 10px;
          letter-spacing: 0.04em;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transform: scale(0.55);
          transition: opacity 0.5s ease 0.15s, transform 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.15s;
          box-shadow: 0 0 0 5px ${alpha(C.bg, 0.01)};
        }
        .lp-sp-sec.in-view .lp-sp-node { opacity: 1; transform: scale(1); }
        .lp-sp-body {
          opacity: 0; transform: translateY(14px);
          transition: opacity 0.7s ease 0.1s, transform 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.1s;
        }
        .lp-sp-sec.in-view .lp-sp-body { opacity: 1; transform: none; }

        /* ── Forest plot climax (scroll-triggered, one-shot) ─────────── */
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
        .lp-fpz.in-view .lp-fp-row  { animation: lpRowIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .lp-fpz.in-view .lp-fp-pool { animation: lpPoolIn 0.5s ease-out forwards; }

        /* ── Linked-products beam pulse ──────────────────────────────── */
        @keyframes lpBeam {
          from { stroke-dashoffset: 512; }
          to   { stroke-dashoffset: 0; }
        }
        .lp-beam-pulse { animation: lpBeam 6.4s linear infinite; }

        /* ── Reduced motion: static final compositions ───────────────── */
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
          .lp-fade-up, .lp-fpz .lp-fp-row, .lp-fpz .lp-fp-pool {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
          .lp-sp-line { transform: scaleY(1) !important; transition: none !important; }
          .lp-sp-node, .lp-sp-body { opacity: 1 !important; transform: none !important; transition: none !important; }
          .lp-beam-pulse { animation: none !important; }
          .lp-btn-primary:hover, .lp-val-card:hover, .lp-link-card:hover { transform: none !important; }
        }

        /* ── Responsive ──────────────────────────────────────────────── */
        @media (max-width: 1024px) {
          .lp-hero-inner   { padding: 96px 32px 84px !important; }
          .lp-climax-grid  { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lp-diff-grid    { gap: 44px !important; }
        }
        @media (max-width: 768px) {
          .lp-nav-links    { display: none !important; }
          .lp-nav-ctas     { display: none !important; }
          .lp-ham-btn      { display: flex !important; }
          .lp-mob-menu     { display: flex !important; }
          .lp-hero-inner   { padding: 84px 24px 72px !important; }
          .lp-hero-kpis    { gap: 26px !important; }
          .lp-sp-inner     { grid-template-columns: 1fr !important; padding: 0 24px !important; }
          .lp-sp-rail      { display: none !important; }
          .lp-sp-body      { padding: 60px 0 64px !important; }
          .lp-value-grid   { grid-template-columns: 1fr !important; }
          .lp-rail-grid    { grid-template-columns: repeat(4, 1fr) !important; }
          .lp-diff-grid    { grid-template-columns: 1fr !important; }
          .lp-trust-strip  { flex-wrap: wrap !important; gap: 12px !important; justify-content: flex-start !important; }
          .lp-footer-cols  { flex-direction: column !important; gap: 28px !important; }
          .lp-footer-bottom { flex-direction: column !important; align-items: flex-start !important; }
          .lp-frame-side   { display: none !important; }
          .lp-frame-stats  { grid-template-columns: 1fr 1fr !important; }
          .lp-frame-panels { grid-template-columns: 1fr !important; }
          .lp-link-row     { flex-direction: column !important; gap: 0 !important; }
          .lp-link-beam    { width: 100% !important; height: 64px !important; }
          .lp-link-beam svg { transform: rotate(90deg); width: 64px !important; }
          .lp-spec-row     { grid-template-columns: 1fr !important; gap: 6px !important; }
          .lp-sect-pad     { padding-left: 24px !important; padding-right: 24px !important; }
        }
        @media (min-width: 769px) {
          .lp-ham-btn  { display: none !important; }
          .lp-mob-menu { display: none !important; }
        }
        @media (max-width: 480px) {
          .lp-hero-ctas    { width: 100%; }
          .lp-hero-ctas button { flex: 1; }
          .lp-rail-grid    { grid-template-columns: repeat(2, 1fr) !important; }
          .lp-frame-stats  { grid-template-columns: 1fr 1fr !important; }
        }
        @media (min-width: 1025px) {
          .lp-value-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* ── Announcement banner ──────────────────────────────────────── */}
      {showBanner && (
        <div style={{
          background: C.surf, borderBottom: `1px solid ${C.brd2}`,
          padding: '8px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 10, position: 'relative',
        }}>
          <Icon name="info" size={13} style={{ color: C.acc }} />
          <span style={{ fontSize: 12, color: C.txt2 }}>{settings.announcementBanner}</span>
          <button onClick={dismissBanner} aria-label="Dismiss announcement" style={{
            position: 'absolute', right: 16, background: 'none', border: 'none',
            color: C.muted, cursor: 'pointer', lineHeight: 1, padding: 2,
            display: 'inline-flex',
          }}><Icon name="x" size={13} /></button>
        </div>
      )}

      {/* ── Maintenance banner ───────────────────────────────────────── */}
      {showMaintenance && (
        <div style={{
          background: C.yelBg, border: `1px solid ${alpha(C.yel, '40')}`,
          padding: '12px 32px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 9,
          fontSize: 13, color: C.yel, fontWeight: 500,
        }}>
          <Icon name="alert" size={14} style={{ color: C.yel }} />
          {settings.maintenanceBanner}
        </div>
      )}

      {/* ── Sticky navbar ───────────────────────────────────────────── */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px', height: 60, borderBottom: `1px solid ${C.brd}`,
        position: 'sticky', top: 0,
        background: alpha(C.bg, 0.9), backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 200,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'default', userSelect: 'none' }}>
          <HexLogo />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: C.txt }}>
            {settings.logoText || 'META·LAB'}
          </span>
        </div>

        <div className="lp-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {(settings.navLinks || []).map(link => (
            <a key={link.label} href={link.href} className="lp-nav-link"
              style={{ fontSize: 13, color: C.txt2, textDecoration: 'none' }}>
              {link.label}
            </a>
          ))}
        </div>

        <div className="lp-nav-ctas" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user ? (
            <button className="lp-btn-primary" onClick={() => navigate('/app')}
              style={{ ...btnPrimary, padding: '8px 20px', fontSize: 13 }}>
              Open Workspace
            </button>
          ) : (
            <>
              <button className="lp-btn-ghost" onClick={() => navigate('/login')}
                style={{ ...btnGhost, padding: '8px 18px', fontSize: 13 }}>
                {settings.ctaSecondaryText || 'Sign in'}
              </button>
              <button className="lp-btn-primary" onClick={() => navigate('/register')}
                style={{ ...btnPrimary, padding: '8px 20px', fontSize: 13 }}>
                Get started
              </button>
            </>
          )}
        </div>

        <button className="lp-ham-btn" onClick={() => setNavOpen(o => !o)}
          aria-label="Toggle navigation menu"
          style={{
            background: 'none', border: `1px solid ${C.brd2}`,
            borderRadius: 6, color: C.txt2, cursor: 'pointer',
            padding: '6px 10px', fontSize: 16, display: 'none',
            alignItems: 'center',
          }}>
          {navOpen ? <Icon name="x" size={15} /> : <Icon name="menu" size={15} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {navOpen && (
        <div className="lp-mob-menu" style={{
          display: 'flex', flexDirection: 'column',
          background: C.surf, borderBottom: `1px solid ${C.brd}`,
          padding: '16px 24px', gap: 10,
        }}>
          {(settings.navLinks || []).map(link => (
            <a key={link.label} href={link.href} onClick={() => setNavOpen(false)}
              style={{ fontSize: 14, color: C.txt2, textDecoration: 'none', padding: '6px 0' }}>
              {link.label}
            </a>
          ))}
          <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 12, display: 'flex', gap: 8 }}>
            {user ? (
              <button className="lp-btn-primary" onClick={() => navigate('/app')}
                style={{ ...btnPrimary, width: '100%' }}>Open Workspace</button>
            ) : (
              <>
                <button className="lp-btn-ghost" onClick={() => navigate('/login')}
                  style={{ ...btnGhost, flex: 1 }}>Sign in</button>
                <button className="lp-btn-primary" onClick={() => navigate('/register')}
                  style={{ ...btnPrimary, flex: 1 }}>Register</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          HERO — full-bleed: records converging into a forest plot
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{
        position: 'relative', overflow: 'hidden', background: C.bg,
        minHeight: 'min(88vh, 840px)', display: 'flex', alignItems: 'center',
      }}>
        <HeroCanvas reduced={reduced} />

        {/* Readability gradient over the canvas (text side) + bottom fade */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `linear-gradient(90deg, ${alpha(C.bg, 0.88)} 0%, ${alpha(C.bg, 0.55)} 36%, transparent 64%)`,
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 130,
          pointerEvents: 'none',
          background: `linear-gradient(to bottom, transparent, ${C.bg})`,
        }} />

        <div className="lp-hero-inner lp-fade-up" style={{
          position: 'relative', zIndex: 1, width: '100%', boxSizing: 'border-box',
          maxWidth: 1200, margin: '0 auto', padding: '110px 48px 100px',
        }}>
          {/* Eyebrow */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '30')}`,
            borderRadius: 100, padding: '5px 14px', marginBottom: 30,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.acc, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.acc, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Systematic review platform
            </span>
          </div>

          {/* Wordmark */}
          <h1 style={{
            fontSize: 'clamp(44px, 7vw, 76px)', fontWeight: 700,
            letterSpacing: '-0.045em', color: C.txt, lineHeight: 0.96,
            margin: '0 0 24px', fontFamily: FONT,
          }}>
            META<span style={{ color: C.acc, fontFamily: MONO, fontWeight: 400, letterSpacing: 0, padding: '0 0.04em' }}>·</span>LAB
          </h1>

          {/* Tagline (admin-editable) */}
          <p style={{
            fontSize: 'clamp(18px, 2.4vw, 23px)', color: C.txt2, fontWeight: 400,
            lineHeight: 1.42, margin: '0 0 16px', maxWidth: 480,
            whiteSpace: 'pre-line', letterSpacing: '-0.01em',
          }}>
            {settings.heroHeadline || DEFAULTS.heroHeadline}
          </p>

          {/* Subtitle (admin-editable) */}
          <p style={{
            fontSize: 15, color: C.muted, lineHeight: 1.8,
            maxWidth: 440, margin: '0 0 40px',
          }}>
            {settings.heroSubtitle || DEFAULTS.heroSubtitle}
          </p>

          {/* CTAs */}
          <div className="lp-hero-ctas" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 52 }}>
            {user ? (
              <button className="lp-btn-primary" onClick={() => navigate('/app')}
                style={{ ...btnPrimary }}>
                Open Workspace
                <Icon name="arrowRight" size={15} />
              </button>
            ) : (
              <>
                <button className="lp-btn-primary" onClick={() => navigate('/register')}
                  style={{ ...btnPrimary }}>
                  {settings.ctaText || 'Start Your Review'}
                  <Icon name="arrowRight" size={15} />
                </button>
                <button className="lp-btn-ghost" onClick={() => navigate('/login')}
                  style={{ ...btnGhost }}>
                  {settings.ctaSecondaryText || 'Sign in'}
                </button>
              </>
            )}
          </div>

          {/* Honest KPI strip */}
          <div className="lp-hero-kpis" style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {[
              ['14',     'review stages'],
              ['PRISMA', '2020 compliant'],
              ['RoB 2',  'built in'],
            ].map(([n, l]) => (
              <div key={n}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.txt, letterSpacing: '-0.5px', marginBottom: 3 }}>
                  {n}
                </div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: '0.05em' }}>
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Standards trust strip ────────────────────────────────────── */}
      <div className="lp-sect-pad" style={{
        background: C.surf, borderTop: `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`, padding: '14px 48px',
      }}>
        <div className="lp-trust-strip" style={{
          maxWidth: 1104, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0,
        }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', paddingRight: 24, whiteSpace: 'nowrap' }}>
            Built around
          </span>
          {['PRISMA 2020', 'Cochrane RoB 2.0', 'GRADE', 'PROSPERO', 'HKSJ Method'].map(s => (
            <span key={s} style={{
              fontSize: 11, fontFamily: MONO, color: C.txt2,
              letterSpacing: '0.06em', whiteSpace: 'nowrap',
              borderLeft: `1px solid ${C.brd2}`, padding: '0 24px',
            }}>
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          THE EVIDENCE SPINE — every section below sits on the audit rail
          ═══════════════════════════════════════════════════════════════ */}

      {/* 01 · Features — evidence workflow narrative */}
      <SpineSection num="01" id="features" label="Features · Evidence workflow">
        <h2 style={h2Style}>{settings.featureTitle || DEFAULTS.featureTitle}</h2>
        <p style={{ ...subStyle, marginBottom: 44 }}>
          From protocol registration to manuscript export — every stage of
          evidence synthesis, without switching tools.
        </p>
        <div className="lp-value-grid" style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
        }}>
          {(settings.featureCards || VALUE_PROPS).map((v, i) => (
            <div key={v.label || i} className="lp-val-card" style={{
              background: C.card, border: `1px solid ${C.brd}`,
              borderLeft: `3px solid ${alpha(C.acc, '50')}`,
              borderRadius: '0 10px 10px 0',
              padding: '24px 24px 22px',
              display: 'flex', gap: 18, alignItems: 'flex-start',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: C.accBg, border: `1px solid ${alpha(C.acc, '28')}`,
                color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name={resolveCardIcon(v.icon)} size={17} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 7 }}>{v.label}</div>
                <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.7 }}>{v.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </SpineSection>

      {/* 02 · Workflow — the 14-stage rail */}
      <SpineSection num="02" id="workflow" label="Workflow" alt wide>
        <h2 style={h2Style}>{settings.workflowTitle || DEFAULTS.workflowTitle}</h2>
        <p style={{ ...subStyle, marginBottom: 40 }}>
          {settings.workflowSubtitle || DEFAULTS.workflowSubtitle}
        </p>

        <div className="lp-rail-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2,
        }}>
          {STEPS.map((s, i) => {
            const active = i === activeStep;
            return (
              <div
                key={s.n}
                className="lp-rail-node"
                tabIndex={0}
                title={s.desc}
                onMouseEnter={() => setActiveStep(i)}
                onFocus={() => setActiveStep(i)}
                style={{
                  background: active ? C.card2 : C.card,
                  border: `1px solid ${active ? alpha(C.acc, '60') : C.brd}`,
                  borderRadius: 8,
                  padding: '12px 11px 10px',
                  cursor: 'default', outline: 'none', minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: C.gold, letterSpacing: '0.05em' }}>
                    {s.n}
                  </span>
                  <span style={{ color: active ? C.acc : C.muted, display: 'inline-flex' }}>
                    <Icon name={s.icon} size={13} />
                  </span>
                </div>
                <div style={{
                  fontSize: 10.5, fontWeight: 600, letterSpacing: '0.01em',
                  color: active ? C.txt : C.txt2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Caption area — hovering/focusing a node reveals its description */}
        <div style={{
          marginTop: 16, minHeight: 46,
          background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8,
          padding: '12px 16px', display: 'flex', alignItems: 'baseline', gap: 10,
          maxWidth: 760,
        }} aria-live="polite">
          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.gold, flexShrink: 0 }}>
            {STEPS[activeStep].n}
          </span>
          <span style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
            <span style={{ color: C.txt, fontWeight: 600 }}>{STEPS[activeStep].label}</span>
            {' — '}{STEPS[activeStep].desc}
          </span>
        </div>
      </SpineSection>

      {/* 03 · Synthesis — the evidence climax */}
      <SpineSection num="03" label="Synthesis" wide>
        <h2 style={h2Style}>Watch the evidence pool.</h2>
        <p style={{ ...subStyle, marginBottom: 48 }}>
          Five studies, weighted and pooled under a random-effects model —
          the same plot META·LAB draws from your extracted data.
        </p>
        <EvidenceClimax reduced={reduced} />
      </SpineSection>

      {/* 04 · Linked workspaces — META·LAB ⇄ META·SIFT */}
      <SpineSection num="04" label="Linked workspaces" alt wide>
        <h2 style={h2Style}>Screening and synthesis, joined at the spine.</h2>
        <p style={{ ...subStyle, marginBottom: 44 }}>
          Pair a META·SIFT screening project with a META·LAB review and the
          pipeline becomes one continuous, audited flow.
        </p>
        <LinkedProducts />
      </SpineSection>

      {/* 05 · Credibility — why rigor + standards card */}
      <SpineSection num="05" label="Research-grade" wide>
        <h2 style={{ ...h2Style, marginBottom: 40 }}>
          {settings.whyTitle || DEFAULTS.whyTitle}
        </h2>
        <div className="lp-diff-grid" style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 64, alignItems: 'start',
        }}>
          <div>
            {[settings.whyBody1 || DEFAULTS.whyBody1, settings.whyBody2 || DEFAULTS.whyBody2, settings.whyBody3 || DEFAULTS.whyBody3].map((p, i) => (
              p ? (
                <p key={i} style={{ fontSize: 15, color: C.txt2, lineHeight: 1.88, margin: '0 0 20px' }}>
                  {p}
                </p>
              ) : null
            ))}
          </div>

          <div style={{
            background: C.card, border: `1px solid ${C.brd}`,
            borderRadius: 12, padding: '30px 34px',
          }}>
            <div style={{
              fontSize: 10, fontFamily: MONO, color: C.muted,
              letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 24,
            }}>
              Standards built in
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {(settings.whyStandards || STANDARDS).map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <Icon name="check" size={13} style={{ color: C.grn, marginTop: 3 }} />
                  <span style={{ fontSize: 14, color: C.txt2, lineHeight: 1.65 }}>{s}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 30, paddingTop: 26, borderTop: `1px solid ${C.brd}` }}>
              <button className="lp-btn-primary" onClick={() => navigate(user ? '/app' : '/register')}
                style={{ ...btnPrimary, width: '100%' }}>
                {user ? 'Open Workspace' : (settings.ctaText || 'Start Your Review')}
                <Icon name="arrowRight" size={15} />
              </button>
            </div>
          </div>
        </div>
      </SpineSection>

      {/* 06 · Institutions — quiet specification table */}
      <SpineSection num="06" label="For institutions" alt>
        <h2 style={h2Style}>Built to pass a research office review.</h2>
        <p style={{ ...subStyle, marginBottom: 38 }}>
          The governance questions IRBs and research offices actually ask —
          answered in the architecture, not the brochure.
        </p>
        <InstitutionSpecs />
      </SpineSection>

      {/* 07 · Product preview */}
      <SpineSection num="07" label="Product" wide>
        <h2 style={h2Style}>Inside the workspace</h2>
        <p style={{ ...subStyle, marginBottom: 44 }}>
          One project, every stage — screening counts, pooled estimates, and
          the PRISMA flow stay in view as your review progresses.
        </p>
        <AppPreview />
        <div style={{
          marginTop: 14, fontSize: 10, fontFamily: MONO, color: C.dim, letterSpacing: '0.08em',
        }}>
          Illustrative composition — numbers shown are examples, not live data.
        </div>
      </SpineSection>

      {/* 08 · About */}
      <SpineSection num="08" id="about" label="About">
        <h2 style={h2Style}>{settings.aboutHeadline || DEFAULTS.aboutHeadline}</h2>
        <p style={{ fontSize: 16, color: C.txt2, lineHeight: 1.88, margin: '14px 0 20px', maxWidth: 760 }}>
          {settings.aboutText1 || DEFAULTS.aboutText1}
        </p>
        <p style={{ fontSize: 16, color: C.txt2, lineHeight: 1.88, margin: 0, maxWidth: 760 }}>
          {settings.aboutText2 || DEFAULTS.aboutText2}
        </p>
      </SpineSection>

      {/* ── Contact ──────────────────────────────────────────────────── */}
      <section id="contact" className="lp-sect-pad" style={{
        padding: '88px 48px', background: C.surf,
        borderTop: `1px solid ${C.brd}`,
      }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <SectionLabel text="Contact" />
            <h2 style={{ ...h2Style, fontSize: 29 }}>
              {settings.contactTitle || 'Get in touch'}
            </h2>
            <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.75, margin: 0 }}>
              {settings.contactSubtitle || DEFAULTS.contactSubtitle}
            </p>
          </div>

          {contactStatus === 'ok' ? (
            <div style={{
              padding: '36px', background: C.grnBg,
              border: `1px solid ${alpha(C.grn, '40')}`, borderRadius: 12, textAlign: 'center',
            }}>
              <div style={{ marginBottom: 12 }}>
                <Icon name="check" size={24} style={{ color: C.grn }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.grn, marginBottom: 8 }}>Message sent</div>
              <div style={{ fontSize: 13, color: C.txt2, marginBottom: 22 }}>We'll get back to you soon.</div>
              <button className="lp-btn-ghost" onClick={() => setContactStatus(null)}
                style={{ ...btnGhost, fontSize: 12, padding: '8px 20px' }}>
                Send another
              </button>
            </div>
          ) : (
            <form onSubmit={handleContact} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { key: 'name',  label: 'Name',  type: 'text',  placeholder: 'Your name' },
                { key: 'email', label: 'Email', type: 'email', placeholder: 'you@institution.edu' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{
                    display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted,
                    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7,
                  }}>
                    {f.label}
                  </label>
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
                <label style={{
                  display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted,
                  letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7,
                }}>
                  Message
                </label>
                <textarea
                  className="lp-contact-input"
                  required rows={5}
                  value={contact.message}
                  onChange={e => setContact(c => ({ ...c, message: e.target.value }))}
                  placeholder="Your message…"
                  style={{ ...inpStyle, resize: 'vertical', minHeight: 110 }}
                />
              </div>
              {contactStatus === 'err' && (
                <div style={{
                  fontSize: 12, color: C.red, padding: '9px 13px',
                  background: C.redBg, border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 6,
                }}>
                  {contactErr}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="lp-btn-primary" type="submit"
                  disabled={contactStatus === 'sending'}
                  style={{ ...btnPrimary, opacity: contactStatus === 'sending' ? 0.6 : 1 }}>
                  {contactStatus === 'sending' ? 'Sending…' : 'Send message'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ── Final CTA band ───────────────────────────────────────────── */}
      <section className="lp-sect-pad" style={{
        padding: '92px 48px', background: C.bg,
        borderTop: `1px solid ${C.brd}`, textAlign: 'center',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <SectionLabel text="Begin" style={{ textAlign: 'center' }} />
          <h2 style={{ ...h2Style, fontSize: 'clamp(26px, 3.4vw, 36px)', marginBottom: 16 }}>
            From question to pooled estimate.
          </h2>
          <p style={{ fontSize: 14.5, color: C.txt2, lineHeight: 1.75, margin: '0 auto 36px', maxWidth: 460 }}>
            Open a workspace and let the method carry the review —
            documented, auditable, and ready for peer scrutiny.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {user ? (
              <button className="lp-btn-primary" onClick={() => navigate('/app')}
                style={{ ...btnPrimary }}>
                Open Workspace
                <Icon name="arrowRight" size={15} />
              </button>
            ) : (
              <>
                <button className="lp-btn-primary" onClick={() => navigate('/register')}
                  style={{ ...btnPrimary }}>
                  {settings.ctaText || 'Start Your Review'}
                  <Icon name="arrowRight" size={15} />
                </button>
                <button className="lp-btn-ghost" onClick={() => navigate('/login')}
                  style={{ ...btnGhost }}>
                  {settings.ctaSecondaryText || 'Sign in'}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="lp-sect-pad" style={{ borderTop: `1px solid ${C.brd}`, background: C.bg, padding: '60px 48px 36px' }}>
        <div style={{ maxWidth: 1104, margin: '0 auto' }}>
          {/* Top: columns */}
          <div className="lp-footer-cols" style={{ display: 'flex', gap: 64, marginBottom: 52 }}>
            {/* Brand column */}
            <div style={{ flex: '0 0 200px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <HexLogo size={16} />
                <Wordmark />
              </div>
              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.75, maxWidth: 180 }}>
                A structured workspace for systematic reviews and meta-analyses.
              </p>
            </div>

            {/* Platform */}
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 18 }}>
                Platform
              </div>
              {['Features', 'Workflow', 'About', 'Contact'].map(l => (
                <a key={l} href={`#${l.toLowerCase()}`} className="lp-footer-link"
                  style={{ display: 'block', fontSize: 13, color: C.muted, textDecoration: 'none', marginBottom: 11 }}>
                  {l}
                </a>
              ))}
            </div>

            {/* Account */}
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 18 }}>
                Account
              </div>
              {(settings.footerLinks || [{ label: 'Register', path: '/register' }, { label: 'Sign In', path: '/login' }]).map(link => (
                <button key={link.label} className="lp-footer-link"
                  onClick={() => navigate(link.path)}
                  style={{
                    display: 'block', background: 'none', border: 'none',
                    color: C.muted, cursor: 'pointer', fontSize: 13,
                    fontFamily: FONT, padding: '0 0 11px 0', textAlign: 'left',
                  }}>
                  {link.label}
                </button>
              ))}
            </div>

            {/* Standards */}
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 18 }}>
                Standards
              </div>
              {['PRISMA 2020', 'Cochrane RoB 2.0', 'GRADE', 'PROSPERO'].map(s => (
                <div key={s} style={{ fontSize: 12, color: C.muted, fontFamily: MONO, marginBottom: 10, letterSpacing: '0.04em' }}>
                  {s}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="lp-footer-bottom" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: `1px solid ${C.brd}`, paddingTop: 24,
            flexWrap: 'wrap', gap: 12,
          }}>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
              {settings.footerText || `© ${new Date().getFullYear()} META·LAB · Systematic review platform`}
            </span>
            <a href="#contact" className="lp-footer-link" style={{
              fontSize: 11, color: C.muted, fontFamily: FONT,
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Icon name="mail" size={12} />
              Contact us
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
