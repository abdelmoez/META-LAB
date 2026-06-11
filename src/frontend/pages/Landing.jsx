/**
 * Landing.jsx — public home page for META·LAB.
 *
 * v4 "institutional evidence-grade" redesign (prompt7):
 * theme tokens (night/day via CSS variables) · monochrome icon system ·
 * animated forest-plot evidence panel · PRISMA funnel strip ·
 * stylized product-frame section · CSS-only motion with
 * prefers-reduced-motion fallbacks.
 *
 * Content architecture unchanged: useLandingSettings() merges
 * GET /api/settings/public over DEFAULTS; every admin-editable key keeps
 * working (heroHeadline, featureCards, whyStandards, footerLinks, …).
 */

import { useState, useEffect } from 'react';
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

/* ─── Tiny monospace section label ───────────────────────────────────── */
function SectionLabel({ text }) {
  return (
    <div style={{
      fontSize: 10, fontFamily: MONO, color: C.muted,
      letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 14,
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

/* ─── Evidence panel: animated forest plot + PRISMA funnel strip ─────── */
function ForestPlotPreview() {
  const studies = [
    { label: 'Smith et al., 2021',  n: 142, es: 0.62, lo: 0.36, hi: 0.88, w: '22.4%' },
    { label: 'Chen et al., 2022',   n:  89, es: 0.44, lo: 0.13, hi: 0.75, w: '15.1%' },
    { label: 'Kumar et al., 2020',  n: 203, es: 0.71, lo: 0.50, hi: 0.92, w: '28.6%' },
    { label: 'Walsh et al., 2023',  n: 167, es: 0.55, lo: 0.31, hi: 0.79, w: '21.7%' },
    { label: 'Nakamura, 2021',      n:  98, es: 0.38, lo: 0.06, hi: 0.70, w: '12.2%' },
  ];
  const pooled = { es: 0.58, lo: 0.44, hi: 0.72 };

  // SVG layout constants
  const PLT_X = 144;   // plot area start x
  const PLT_W = 224;   // plot area width
  const STAT_X = 378;  // stats columns start
  const VB_W   = 460;  // total viewBox width

  const X_MIN = -0.5, X_MAX = 1.3;
  const toX = v => PLT_X + ((v - X_MIN) / (X_MAX - X_MIN)) * PLT_W;
  const ZERO = toX(0);

  const ROW_H = 30;
  const HDR_Y = 22;
  const firstY = HDR_Y + ROW_H;
  const poolY  = firstY + studies.length * ROW_H + ROW_H * 0.6;
  const axisY  = poolY + ROW_H * 0.8;
  const VB_H   = axisY + 24;

  const boxSize = (w) => 5 + parseFloat(w) / 8;

  const funnel = [
    ['Identified', '1,284'],
    ['Screened',   '1,022'],
    ['Full-text',  '164'],
    ['Included',   '38'],
  ];

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.brd2}`,
      borderRadius: 12, overflow: 'hidden', fontFamily: FONT,
      boxShadow: `0 24px 60px ${C.shadow}`,
    }}>
      {/* Window chrome — monochrome dots */}
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
          ADHD / Methylphenidate SR · Forest Plot
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 8.5, fontFamily: MONO, color: C.dim,
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          Illustrative
        </span>
      </div>

      {/* Tab strip */}
      <div style={{
        display: 'flex', background: C.surf,
        borderBottom: `1px solid ${C.brd}`, padding: '0 12px',
      }}>
        {['PICO', 'Search', 'Screen', 'Extract', 'Analysis', 'Report'].map((t, i) => (
          <div key={t} style={{
            fontSize: 10, fontFamily: MONO, letterSpacing: '0.06em',
            color: i === 4 ? C.acc : C.muted,
            padding: '7px 10px',
            borderBottom: i === 4 ? `2px solid ${C.acc}` : '2px solid transparent',
            cursor: 'default',
          }}>
            {t}
          </div>
        ))}
      </div>

      {/* Plot */}
      <div style={{ padding: '14px 14px 10px' }}>
        <div style={{
          fontSize: 9, fontFamily: MONO, color: C.muted,
          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Random-Effects Model · SMD · 95% CI
        </div>

        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
          {/* Column headers */}
          <text x={STAT_X + 22} y={HDR_Y - 4}
            style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>N</text>
          <text x={STAT_X + 68} y={HDR_Y - 4}
            style={{ fontSize: 9, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>Weight</text>

          {/* Zero line */}
          <line x1={ZERO} y1={HDR_Y} x2={ZERO} y2={poolY + ROW_H * 0.4}
            stroke={C.brd2} strokeWidth={1} strokeDasharray="3,3" />

          {/* Studies — draw in once, staggered */}
          {studies.map((s, i) => {
            const y   = firstY + i * ROW_H + ROW_H / 2;
            const x1  = toX(s.lo);
            const x2  = toX(s.hi);
            const xm  = toX(s.es);
            const bsz = boxSize(s.w);
            return (
              <g key={s.label} className="lp-fp-row" style={{ animationDelay: `${0.15 + i * 0.09}s` }}>
                {/* Label */}
                <text x={0} y={y + 3.5}
                  style={{ fontSize: 9.5, fontFamily: FONT, fill: C.txt2 }}>
                  {s.label}
                </text>
                {/* CI line */}
                <line x1={x1} y1={y} x2={x2} y2={y} stroke={C.brd2} strokeWidth={1.5} />
                <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} stroke={C.brd2} strokeWidth={1} />
                <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} stroke={C.brd2} strokeWidth={1} />
                {/* Effect box */}
                <rect x={xm - bsz / 2} y={y - bsz / 2}
                  width={bsz} height={bsz}
                  fill={C.acc} stroke={C.acc2} strokeWidth={0.5} />
                {/* Stats */}
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

          {/* Divider before pooled */}
          <line x1={0} y1={poolY - ROW_H * 0.35} x2={VB_W} y2={poolY - ROW_H * 0.35}
            stroke={C.brd} strokeWidth={0.5} />

          {/* Pooled diamond — scholar gold, lands last */}
          {(() => {
            const y   = poolY;
            const xlo = toX(pooled.lo);
            const xhi = toX(pooled.hi);
            const xm  = toX(pooled.es);
            const dh  = 8;
            return (
              <g className="lp-fp-pool" style={{ animationDelay: '0.68s' }}>
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

          {/* X-axis tick labels */}
          {[-0.25, 0, 0.5, 1.0].map(v => (
            <text key={v} x={toX(v)} y={axisY + 12}
              style={{ fontSize: 8, fontFamily: MONO, fill: C.muted, textAnchor: 'middle' }}>
              {v}
            </text>
          ))}

          {/* Favours labels */}
          <text x={PLT_X + 4} y={axisY + 12}
            style={{ fontSize: 8, fontFamily: FONT, fill: C.muted }}>
            Favours control
          </text>
          <text x={PLT_X + PLT_W - 4} y={axisY + 12}
            style={{ fontSize: 8, fontFamily: FONT, fill: C.muted, textAnchor: 'end' }}>
            Favours treatment
          </text>
        </svg>

        {/* Stat pills */}
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

      {/* PRISMA funnel counts strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
        background: C.surf, borderTop: `1px solid ${C.brd}`,
        padding: '9px 14px',
      }}>
        <Icon name="flow" size={11} style={{ color: C.muted }} />
        <span style={{ fontSize: 8.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          PRISMA
        </span>
        {funnel.map(([k, v], i) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
            {i > 0 && <Icon name="chevronRight" size={9} style={{ color: C.dim }} />}
            <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.txt2 }}>
              {k}{' '}
              <span style={{ color: i === funnel.length - 1 ? C.gold : C.txt, fontWeight: 700 }}>{v}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Product frame: stylized in-code app composition ────────────────── */
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

function AppFrame() {
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

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════ */
export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const settings = useLandingSettings();

  useEffect(() => {
    if (settings.seoTitle) document.title = settings.seoTitle;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && settings.seoDescription) meta.setAttribute('content', settings.seoDescription);
  }, [settings.seoTitle, settings.seoDescription]);

  const [navOpen,          setNavOpen]          = useState(false);
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

        .lp-step-card { transition: border-color 0.2s, background 0.2s; }
        .lp-step-card:hover { border-color: ${alpha(C.acc, '60')} !important; background: ${C.card2} !important; }
        .lp-step-card:hover .lp-step-ico { color: ${C.acc} !important; }

        .lp-footer-link { transition: color 0.15s; }
        .lp-footer-link:hover { color: ${C.txt2} !important; }

        /* ── Motion (CSS only) ───────────────────────────────────────── */
        @keyframes lpFadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: none; }
        }
        .lp-fade-up { animation: lpFadeUp 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }

        @keyframes lpRowIn {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: none; }
        }
        .lp-fp-row {
          opacity: 0;
          animation: lpRowIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes lpPoolIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: none; }
        }
        .lp-fp-pool {
          opacity: 0;
          transform-box: fill-box;
          transform-origin: center;
          animation: lpPoolIn 0.5s ease-out forwards;
        }

        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
          .lp-fade-up, .lp-fp-row, .lp-fp-pool {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
          .lp-btn-primary:hover, .lp-val-card:hover { transform: none !important; }
        }

        /* ── Responsive ──────────────────────────────────────────────── */
        @media (max-width: 1024px) {
          .lp-hero-split   { grid-template-columns: 1fr !important; }
          .lp-preview-col  { display: none !important; }
          .lp-hero-text    { text-align: center !important; align-items: center !important; }
          .lp-hero-ctas    { justify-content: center !important; }
          .lp-hero-kpis    { justify-content: center !important; }
        }
        @media (max-width: 768px) {
          .lp-nav-links    { display: none !important; }
          .lp-nav-ctas     { display: none !important; }
          .lp-ham-btn      { display: flex !important; }
          .lp-mob-menu     { display: flex !important; }
          .lp-hero-name    { font-size: 52px !important; letter-spacing: -2px !important; }
          .lp-hero-tagline { font-size: 18px !important; }
          .lp-value-grid   { grid-template-columns: 1fr 1fr !important; }
          .lp-steps-grid   { grid-template-columns: repeat(2, 1fr) !important; }
          .lp-diff-grid    { grid-template-columns: 1fr !important; }
          .lp-trust-strip  { flex-wrap: wrap !important; gap: 12px !important; justify-content: flex-start !important; }
          .lp-footer-cols  { flex-direction: column !important; gap: 28px !important; }
          .lp-footer-bottom { flex-direction: column !important; align-items: flex-start !important; }
          .lp-hero-desc-text { max-width: 100% !important; }
          .lp-frame-side   { display: none !important; }
          .lp-frame-stats  { grid-template-columns: 1fr 1fr !important; }
          .lp-frame-panels { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 480px) {
          .lp-hero-name  { font-size: 40px !important; letter-spacing: -1px !important; }
          .lp-value-grid { grid-template-columns: 1fr !important; }
          .lp-steps-grid { grid-template-columns: 1fr !important; }
          .lp-diff-grid  { gap: 32px !important; }
        }
        @media (min-width: 769px) {
          .lp-ham-btn  { display: none !important; }
          .lp-mob-menu { display: none !important; }
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
          {navOpen ? <Icon name="x" size={15} /> : '☰'}
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
          HERO — split layout
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '0 48px', background: C.bg, position: 'relative', overflow: 'hidden' }}>
        {/* Subtle grid background */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(${alpha(C.brd, '26')} 1px, transparent 1px),
            linear-gradient(90deg, ${alpha(C.brd, '26')} 1px, transparent 1px)
          `,
          backgroundSize: '52px 52px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 60% 40%, black 20%, transparent 90%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 60% 40%, black 20%, transparent 90%)',
        }} />

        <div
          className="lp-hero-split"
          style={{
            maxWidth: 1200, margin: '0 auto',
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 72, alignItems: 'center',
            padding: '96px 0 88px',
            position: 'relative', zIndex: 1,
          }}
        >
          {/* LEFT: copy */}
          <div className="lp-hero-text lp-fade-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {/* Eyebrow pill */}
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

            {/* App name — first and largest */}
            <h1 className="lp-hero-name" style={{
              fontSize: 78, fontWeight: 700, letterSpacing: '-3.5px',
              color: C.txt, lineHeight: 0.94,
              margin: '0 0 26px', fontFamily: FONT,
            }}>
              META<span style={{ color: C.acc, fontFamily: MONO, fontWeight: 400, letterSpacing: 0, padding: '0 0.04em' }}>·</span>LAB
            </h1>

            {/* Tagline */}
            <p className="lp-hero-tagline" style={{
              fontSize: 22, color: C.txt2, fontWeight: 400,
              lineHeight: 1.45, margin: '0 0 16px', maxWidth: 440,
              whiteSpace: 'pre-line', letterSpacing: '-0.01em',
            }}>
              {settings.heroHeadline || DEFAULTS.heroHeadline}
            </p>

            {/* Description */}
            <p className="lp-hero-desc-text" style={{
              fontSize: 15, color: C.muted, lineHeight: 1.8,
              maxWidth: 420, margin: '0 0 42px',
            }}>
              {settings.heroSubtitle || DEFAULTS.heroSubtitle}
            </p>

            {/* CTAs */}
            <div className="lp-hero-ctas" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 50 }}>
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

            {/* Key metrics — honest, descriptive */}
            <div className="lp-hero-kpis" style={{ display: 'flex', gap: 40 }}>
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

          {/* RIGHT: evidence panel */}
          <div className="lp-preview-col lp-fade-up" style={{ position: 'relative', animationDelay: '0.12s' }}>
            <ForestPlotPreview />
          </div>
        </div>
      </section>

      {/* ── Trust strip ─────────────────────────────────────────────── */}
      <div style={{
        background: C.surf, borderTop: `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`, padding: '14px 48px',
      }}>
        <div className="lp-trust-strip" style={{
          maxWidth: 1100, margin: '0 auto',
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

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: '88px 48px', background: C.bg }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <SectionLabel text="Features" />
            <h2 style={{ fontSize: 29, fontWeight: 700, color: C.txt, letterSpacing: '-0.6px', margin: '0 0 14px' }}>
              {settings.featureTitle || 'Everything a rigorous review needs'}
            </h2>
            <p style={{ fontSize: 14, color: C.txt2, maxWidth: 460, margin: '0 auto', lineHeight: 1.75 }}>
              From protocol registration to manuscript export — every stage of evidence synthesis, without switching tools.
            </p>
          </div>

          <div className="lp-value-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}>
            {(settings.featureCards || VALUE_PROPS).map((v, i) => (
              <div key={v.label || i} className="lp-val-card" style={{
                background: C.card, border: `1px solid ${C.brd}`,
                borderLeft: `3px solid ${alpha(C.acc, '50')}`,
                borderRadius: '0 10px 10px 0',
                padding: '26px 24px',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 8,
                  background: C.accBg, border: `1px solid ${alpha(C.acc, '28')}`,
                  color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 16,
                }}>
                  <Icon name={resolveCardIcon(v.icon)} size={17} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 8 }}>{v.label}</div>
                <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.72 }}>{v.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow ─────────────────────────────────────────────────── */}
      <section id="workflow" style={{
        background: C.surf, borderTop: `1px solid ${C.brd}`,
        borderBottom: `1px solid ${C.brd}`, padding: '88px 48px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <SectionLabel text="Workflow" />
            <h2 style={{ fontSize: 29, fontWeight: 700, color: C.txt, letterSpacing: '-0.6px', margin: '0 0 14px' }}>
              {settings.workflowTitle || '14 steps from question to manuscript'}
            </h2>
            <p style={{ fontSize: 14, color: C.txt2, maxWidth: 500, margin: '0 auto', lineHeight: 1.75 }}>
              {settings.workflowSubtitle || 'Every systematic review follows the same evidence-based process. META·LAB walks you through each stage without letting you skip ahead.'}
            </p>
          </div>

          <div className="lp-steps-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 2,
          }}>
            {STEPS.map((s, i) => (
              <div key={s.n} className="lp-step-card" style={{
                background: C.card, border: `1px solid ${C.brd}`,
                padding: '20px 18px',
                borderRadius:
                  i === 0 ? '9px 0 0 9px' :
                  i === STEPS.length - 1 ? '0 9px 9px 0' :
                  0,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 12,
                }}>
                  <span style={{
                    fontFamily: MONO, fontSize: 11.5, fontWeight: 700,
                    color: C.gold, letterSpacing: '0.05em',
                  }}>
                    {s.n}
                  </span>
                  <span className="lp-step-ico" style={{ color: C.muted, display: 'inline-flex', transition: 'color 0.15s' }}>
                    <Icon name={s.icon} size={15} />
                  </span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.txt, marginBottom: 6, letterSpacing: '0.01em' }}>
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

      {/* ── Product preview: stylized app frame ──────────────────────── */}
      <section style={{ padding: '88px 48px 80px', background: C.bg }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <SectionLabel text="Product" />
            <h2 style={{ fontSize: 29, fontWeight: 700, color: C.txt, letterSpacing: '-0.6px', margin: '0 0 14px' }}>
              Inside the workspace
            </h2>
            <p style={{ fontSize: 14, color: C.txt2, maxWidth: 480, margin: '0 auto', lineHeight: 1.75 }}>
              One project, every stage — screening counts, pooled estimates, and the PRISMA flow stay in view as your review progresses.
            </p>
          </div>
          <AppFrame />
          <div style={{
            textAlign: 'center', marginTop: 14,
            fontSize: 10, fontFamily: MONO, color: C.dim, letterSpacing: '0.08em',
          }}>
            Illustrative composition — numbers shown are examples, not live data.
          </div>
        </div>
      </section>

      {/* ── Why META·LAB ─────────────────────────────────────────────── */}
      <section style={{
        padding: '88px 48px', background: C.surf,
        borderTop: `1px solid ${C.brd}`,
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <SectionLabel text="Research-grade" />
            <h2 style={{ fontSize: 29, fontWeight: 700, color: C.txt, letterSpacing: '-0.6px', margin: '0 0 14px' }}>
              {settings.whyTitle || 'For researchers who care about rigor'}
            </h2>
          </div>

          <div className="lp-diff-grid" style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 72, alignItems: 'start',
          }}>
            {/* Left: body text */}
            <div>
              {[settings.whyBody1 || DEFAULTS.whyBody1, settings.whyBody2 || DEFAULTS.whyBody2, settings.whyBody3 || DEFAULTS.whyBody3].map((p, i) => (
                p ? (
                  <p key={i} style={{ fontSize: 15, color: C.txt2, lineHeight: 1.88, marginBottom: 20 }}>
                    {p}
                  </p>
                ) : null
              ))}
            </div>

            {/* Right: standards card */}
            <div style={{
              background: C.card, border: `1px solid ${C.brd}`,
              borderRadius: 12, padding: '32px 36px',
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

              <div style={{ marginTop: 32, paddingTop: 28, borderTop: `1px solid ${C.brd}` }}>
                <button className="lp-btn-primary" onClick={() => navigate(user ? '/app' : '/register')}
                  style={{ ...btnPrimary, width: '100%' }}>
                  {user ? 'Open Workspace' : (settings.ctaText || 'Start Your Review')}
                  <Icon name="arrowRight" size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── About ────────────────────────────────────────────────────── */}
      <section id="about" style={{
        background: C.bg, borderTop: `1px solid ${C.brd}`,
        padding: '88px 48px',
      }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <SectionLabel text="About" />
          <h2 style={{ fontSize: 29, fontWeight: 700, color: C.txt, letterSpacing: '-0.6px', margin: '0 0 28px' }}>
            {settings.aboutHeadline || 'What is META·LAB?'}
          </h2>
          <p style={{ fontSize: 16, color: C.txt2, lineHeight: 1.88, marginBottom: 20 }}>
            {settings.aboutText1 || DEFAULTS.aboutText1}
          </p>
          <p style={{ fontSize: 16, color: C.txt2, lineHeight: 1.88 }}>
            {settings.aboutText2 || DEFAULTS.aboutText2}
          </p>
        </div>
      </section>

      {/* ── Contact ──────────────────────────────────────────────────── */}
      <section id="contact" style={{
        padding: '88px 48px', background: C.surf,
        borderTop: `1px solid ${C.brd}`,
      }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <SectionLabel text="Contact" />
            <h2 style={{ fontSize: 29, fontWeight: 700, color: C.txt, letterSpacing: '-0.6px', margin: '0 0 14px' }}>
              {settings.contactTitle || 'Get in touch'}
            </h2>
            <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.75 }}>
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

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer style={{ borderTop: `1px solid ${C.brd}`, background: C.bg, padding: '60px 48px 36px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
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
            {/* Dead Privacy/Terms spans removed (no real policy pages yet);
                replaced by a working contact anchor. */}
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
