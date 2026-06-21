/**
 * AdminConsole.jsx — META·LAB Ops internal control panel.
 * v2.2 — inbox messages, user+projects panel, redesigned overview, full content editor
 */

import { useState, useEffect, useCallback, useRef, Component } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { adminApi, fetchVersion } from './adminApiClient.js';
import UserMenu from '../../components/UserMenu.jsx';
import NotificationsBell from '../../components/NotificationsBell.jsx';
import Icon from '../../components/icons.jsx';

/* ─── Design tokens ──────────────────────────────────────────────────── */
// Theme-aware tokens (prompt7): C values are `var(--t-*)` strings switched by
// data-theme on <html>. Hex+alpha concatenation does not work on vars — use
// `alpha(C.x, '40')` instead.
import { C, FONT, MONO, alpha } from '../../theme/tokens.js';
// prompt37 — global brand theme. useTheme exposes live preview/commit/reset of
// the accent palette; themeEngine is the pure generator + presets + diagnostics.
import { useTheme } from '../../theme/ThemeContext.jsx';
import {
  PRESETS, generateThemeFromHex, normalizeHex, isValidHex,
  diagnosePalette, buildThemeRecord, defaultThemeRecord, DEFAULT_BRAND,
} from '../../theme/themeEngine.js';
// Central editable-user-field schema (shared with the server) — the Ops edit
// form is rendered + validated from this single source of truth (prompt20 Task 5).
import { editableFieldsForRole, PRIMARY_ROLE_OPTIONS, RESEARCH_FIELD_OPTIONS, MAIN_USE_CASE_OPTIONS } from '../../../shared/editableUserFields.js';
import { countryNameForCode, COUNTRY_OPTIONS } from '../../../shared/countries.js';
// prompt48 — Beta Waitlist domain constants (shared with the public form + server).
import { WAITLIST_ROLES, WAITLIST_STATUSES, WAITLIST_STATUS_LABELS, applicantRoleLabel, applicantDisplayName } from '../../../shared/betaWaitlist.js';
// Real world-country geometry (pre-projected equirectangular paths, no map lib)
// for the Ops users-by-country choropleth (prompt20 Task 6).
import { WORLD_COUNTRIES, WORLD_VIEWBOX } from './worldGeo.js';
const SIDEBAR_W = 220;
const TOPBAR_H  = 52;

/* ─── Helpers ────────────────────────────────────────────────────────── */
function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString() : '—'; }
function fmtAgo(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
}

/* ════════════════════════════════════════════════════════════════════════
   SHARED UI PRIMITIVES
   ════════════════════════════════════════════════════════════════════════ */

function Spinner({ size = 14, color = C.acc }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${alpha(color, '30')}`, borderTop: `2px solid ${color}`,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

function SaveButton({ onClick, status, label = 'Save Changes', disabled = false }) {
  const map = {
    idle:   { bg: C.acc2,  text: label,     icon: null },
    saving: { bg: C.muted, text: 'Saving…', icon: <Spinner size={12} color={C.accText} /> },
    saved:  { bg: C.grn2,  text: 'Saved',   icon: <Icon name="check" size={12} /> },
    error:  { bg: C.red,   text: 'Error',   icon: <Icon name="x" size={12} /> },
  };
  const s = map[status] || map.idle;
  return (
    <button onClick={onClick} disabled={disabled || status === 'saving'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '8px 18px', background: s.bg, border: 'none',
      borderRadius: 7, color: C.accText, fontSize: 13, fontWeight: 600,
      cursor: disabled || status === 'saving' ? 'not-allowed' : 'pointer',
      fontFamily: FONT, opacity: disabled ? 0.6 : 1, transition: 'background 0.2s',
    }}>
      {s.icon && <span>{s.icon}</span>}
      {s.text}
    </button>
  );
}

function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: alpha(C.bg, 0.65), zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 12, padding: '28px 32px', maxWidth: 420, width: '90%', boxShadow: `0 24px 64px ${C.shadow}` }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 12 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, marginBottom: 24 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 16px', background: danger ? C.red : C.acc2, border: 'none', borderRadius: 7, color: C.accText, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function DataTable({ columns, rows, loading, emptyMessage = 'No data.', onRowClick, selectedId }) {
  // Readability (prompt7): consistent 10px/12px cell padding, spaced uppercase
  // headers, row hover = C.card2 (works in both night and day themes).
  const thStyle = { padding: '10px 12px', textAlign: 'left', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}`, fontWeight: 600, whiteSpace: 'nowrap' };
  const tdStyle = { padding: '10px 12px', fontSize: 12, color: C.txt2, borderBottom: `1px solid ${C.brd}`, verticalAlign: 'middle' };

  if (loading) return (
    <div style={{ padding: '40px 0', textAlign: 'center' }}>
      <Spinner size={20} />
      <div style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{columns.map(c => <th key={c.key} style={{ ...thStyle, width: c.width || 'auto' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ ...tdStyle, textAlign: 'center', color: C.muted, padding: '32px 12px' }}>{emptyMessage}</td></tr>
          ) : rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => onRowClick && onRowClick(row)}
              style={{ transition: 'background 0.1s', cursor: onRowClick ? 'pointer' : 'default', background: selectedId && row.id === selectedId ? alpha(C.acc, '0e') : 'transparent', borderLeft: selectedId && row.id === selectedId ? `3px solid ${C.acc}` : '3px solid transparent' }}
              onMouseEnter={e => { if (!selectedId || row.id !== selectedId) e.currentTarget.style.background = C.card2; }}
              onMouseLeave={e => { e.currentTarget.style.background = selectedId && row.id === selectedId ? alpha(C.acc, '0e') : 'transparent'; }}
            >
              {columns.map(c => <td key={c.key} style={tdStyle}>{c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <div onClick={() => !disabled && onChange(!checked)} style={{ width: 40, height: 22, borderRadius: 11, background: checked ? C.acc2 : C.brd2, position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 0.2s', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: `0 1px 4px ${C.shadow}` }} />
    </div>
  );
}

function Badge({ text, color = C.acc, bg }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 12, fontSize: 10, fontWeight: 700, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', color, background: bg || alpha(color, '20'), border: `1px solid ${alpha(color, '40')}` }}>
      {text}
    </span>
  );
}

function Pagination({ page, total, perPage, onPage }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', justifyContent: 'flex-end' }}>
      <span style={{ fontSize: 11, color: C.muted }}>Page {page} of {totalPages} ({total} total)</span>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} style={{ padding: '4px 10px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 12, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontFamily: FONT }}>‹</button>
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} style={{ padding: '4px 10px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 12, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontFamily: FONT }}>›</button>
    </div>
  );
}

// prompt36 — Ops sub-view error boundary: a render crash in one section shows a
// recoverable message instead of white-screening the whole console. The thrown
// error is logged (not silently swallowed) so the real bug stays diagnosable.
class OpsErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[Ops] render error in', this.props.label || 'a section', error, info); }
  render() {
    if (this.state.error) {
      return (
        <SectionCard>
          <div style={{ padding: '28px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 6 }}>This section couldn’t be displayed</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
              Something went wrong rendering {this.props.label || 'this view'}. The rest of the Ops Console is unaffected.
              <span style={{ display: 'block', marginTop: 8, fontFamily: MONO, fontSize: 11, color: C.dim, overflowWrap: 'anywhere' }}>{String(this.state.error?.message || this.state.error)}</span>
            </div>
            <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: '7px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Try again</button>
          </div>
        </SectionCard>
      );
    }
    return this.props.children;
  }
}

// prompt36 — module-level stat chip (was a country-panel-local const, which made
// it crash the Institutions tab when referenced there). Shared by both panels.
function Chip({ label, value, color = C.acc }) {
  return (
    <div style={{ flex: '1 1 120px', minWidth: 0, background: alpha(color, '10'), border: `1px solid ${alpha(color, '30')}`, borderRadius: 9, padding: '10px 14px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.txt, fontFamily: MONO, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function SectionCard({ title, children, action }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.brd}` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.txt, letterSpacing: '0.01em' }}>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Field({ label, children, note }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>{label}</label>
      {children}
      {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>{note}</div>}
    </div>
  );
}

const inputStyle = {
  width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
  borderRadius: 7, padding: '9px 12px', color: C.txt,
  fontFamily: FONT, fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

function ErrorBox({ msg }) {
  return (
    <div style={{ padding: '10px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 7, color: C.red, fontSize: 12, marginBottom: 16 }}>
      {msg}
    </div>
  );
}

function NoticeBox({ msg, color = C.ylw }) {
  return (
    <div style={{ padding: '10px 14px', background: alpha(color, '12'), border: `1px solid ${alpha(color, '40')}`, borderRadius: 7, color, fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
      {msg}
    </div>
  );
}

function AccessDenied({ section }) {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 32, color: C.red, marginBottom: 14 }}>⊘</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Access denied</div>
      <div style={{ fontSize: 13, color: C.txt2, maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
        Your role does not have access to{section ? ` the ${section} section` : ' this section'}. Server-side authorization enforces this regardless of UI.
      </div>
    </div>
  );
}

function CopyableBox({ value, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard unavailable */ }
  }
  return (
    <div style={{ marginTop: 4 }}>
      {label && <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, fontFamily: MONO, fontSize: 13, color: C.txt, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7, padding: '9px 12px', wordBreak: 'break-all' }}>{value}</code>
        <button onClick={copy} style={{ padding: '9px 14px', background: copied ? C.grn2 : C.acc2, border: 'none', borderRadius: 7, color: C.accText, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function FilterBar({ filters, active, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {filters.map(f => (
        <button key={f.id} onClick={() => onSelect(f.id)} style={{
          padding: '6px 13px', background: active === f.id ? C.acc2 : 'transparent',
          border: `1px solid ${active === f.id ? C.acc2 : C.brd2}`, borderRadius: 6,
          color: active === f.id ? C.accText : C.txt2, fontSize: 12, cursor: 'pointer',
          fontFamily: FONT, textTransform: 'capitalize',
        }}>
          {f.label}
          {f.count != null && f.count > 0 && (
            <span style={{ marginLeft: 5, background: active === f.id ? alpha(C.accText, 0.2) : alpha(C.acc, '22'), borderRadius: 8, padding: '1px 6px', fontSize: 10, fontFamily: MONO, color: active === f.id ? C.accText : C.acc }}>{f.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   CHART KIT (prompt8) — tiny hand-rolled SVG charts. Theme-token colors
   only, 10–11px MONO labels, explicit loading + empty states everywhere.
   Draw-in animations run ONCE per mount; prefers-reduced-motion renders
   every chart and counter instantly (no transition, no rAF loop).
   ════════════════════════════════════════════════════════════════════════ */

const REDUCED_MOTION_MQ = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(REDUCED_MOTION_MQ).matches : false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(REDUCED_MOTION_MQ);
    const onChange = e => setReduced(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

/* Container width via callback ref + ResizeObserver, so SVG charts render in
   true pixel coordinates (no preserveAspectRatio stroke distortion). */
function useMeasuredWidth() {
  const [width, setWidth] = useState(0);
  const roRef = useRef(null);
  const ref = useCallback(node => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (!node) return;
    const update = () => setWidth(node.clientWidth || 0);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      roRef.current = new ResizeObserver(update);
      roRef.current.observe(node);
    }
  }, []);
  useEffect(() => () => { if (roRef.current) { roRef.current.disconnect(); roRef.current = null; } }, []);
  return [ref, width];
}

/* One-shot draw-in trigger: flips `drawn` one frame after data is ready so
   CSS transitions (dashoffset / width / dasharray) animate exactly once per
   mount. Reduced motion → drawn immediately, transitions disabled. */
function useDrawIn(ready) {
  const reduced = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!ready || drawn) return undefined;
    if (reduced) { setDrawn(true); return undefined; }
    let id2 = 0;
    const id1 = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => setDrawn(true)); });
    return () => { cancelAnimationFrame(id1); if (id2) cancelAnimationFrame(id2); };
  }, [ready, reduced, drawn]);
  return { drawn, reduced };
}

/* Animated count-up (rAF, ~600ms, ease-out cubic). Counts from the previous
   value on refresh and from 0 on first load. Reduced motion → instant.
   Callers render with fontVariantNumeric:'tabular-nums' so digits don't jitter. */
function useCountUp(target, duration = 600) {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(null);
  const fromRef = useRef(0);
  useEffect(() => {
    if (target == null || Number.isNaN(Number(target))) { setValue(null); return undefined; }
    const to = Number(target);
    if (reduced || fromRef.current === to) { fromRef.current = to; setValue(to); return undefined; }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = now => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); fromRef.current = to; };
  }, [target, duration, reduced]);
  return value;
}

function ChartLoading({ height = 120 }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size={16} />
    </div>
  );
}

function ChartEmpty({ label = 'No trend data yet', height = 120 }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.muted }}>
      <Icon name="activity" size={13} />
      <span style={{ fontSize: 11, fontFamily: MONO, letterSpacing: '0.04em' }}>{label}</span>
    </div>
  );
}

/* Catmull-Rom → cubic bezier smoothing; control-point Y is clamped into the
   plot band so spiky series never overshoot below the baseline. */
function smoothPath(pts, yMin = -Infinity, yMax = Infinity) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  const cl = y => Math.min(yMax, Math.max(yMin, y));
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = +(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1);
    const c1y = +cl(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1);
    const c2x = +(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1);
    const c2y = +cl(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1);
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function niceCeil(v) {
  if (v <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / pow) * pow;
}

/* ── AreaChart — multi-series smooth area/line chart with hover readout ── */
function AreaChart({ series, labels, height = 180, loading, emptyLabel = 'No trend data yet' }) {
  const [wrapRef, w] = useMeasuredWidth();
  const hasData = !loading && Array.isArray(series) && series.length > 0 && Array.isArray(labels) && labels.length > 1;
  const { drawn, reduced } = useDrawIn(hasData && w > 0);
  const [hover, setHover] = useState(null);

  if (loading) return <ChartLoading height={height + 46} />;
  if (!hasData) return <ChartEmpty label={emptyLabel} height={height + 46} />;

  const padL = 34, padR = 10, padT = 10, padB = 6;
  const n = labels.length;
  const innerW = Math.max(1, w - padL - padR);
  const plotH = height - padT - padB;
  const norm = series.map(s => ({ ...s, values: labels.map((_, i) => Math.max(0, Number(s.values?.[i]) || 0)) }));
  const yMax = niceCeil(Math.max(1, ...norm.map(s => Math.max(...s.values))));
  const X = i => padL + (i * innerW) / (n - 1);
  const Y = v => padT + (1 - v / yMax) * plotH;
  const baseY = padT + plotH;

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = Math.round(((e.clientX - rect.left - padL) / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  return (
    <div>
      <div ref={wrapRef} style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {w > 0 && (
          <svg width={w} height={height} style={{ display: 'block' }} aria-hidden="true">
            {[0, 0.5, 1].map(f => (
              <line key={f} x1={padL} x2={w - padR} y1={padT + f * plotH} y2={padT + f * plotH} stroke={alpha(C.muted, 0.16)} strokeDasharray="3 4" />
            ))}
            <text x={padL - 7} y={padT + 4} textAnchor="end" fontSize="10" fontFamily={MONO} fill={C.muted}>{yMax.toLocaleString()}</text>
            <text x={padL - 7} y={padT + plotH / 2 + 4} textAnchor="end" fontSize="10" fontFamily={MONO} fill={C.muted}>{Math.round(yMax / 2).toLocaleString()}</text>
            <text x={padL - 7} y={baseY + 3} textAnchor="end" fontSize="10" fontFamily={MONO} fill={C.muted}>0</text>
            {norm.map(s => {
              const pts = s.values.map((v, i) => [+X(i).toFixed(1), +Y(v).toFixed(1)]);
              const line = smoothPath(pts, padT, baseY);
              return (
                <g key={s.id || s.label}>
                  <path d={`${line} L ${pts[pts.length - 1][0]} ${baseY} L ${pts[0][0]} ${baseY} Z`} fill={alpha(s.color, 0.08)} stroke="none"
                    style={{ opacity: drawn ? 1 : 0, transition: reduced ? 'none' : 'opacity 0.45s ease 0.25s' }} />
                  <path d={line} fill="none" stroke={s.color} strokeWidth="1.8" pathLength="1"
                    style={{ strokeDasharray: 1, strokeDashoffset: drawn ? 0 : 1, transition: reduced ? 'none' : 'stroke-dashoffset 0.5s ease' }} />
                </g>
              );
            })}
            {hover != null && (
              <g>
                <line x1={X(hover)} x2={X(hover)} y1={padT} y2={baseY} stroke={alpha(C.txt, 0.22)} />
                {norm.map(s => (
                  <circle key={s.id || s.label} cx={X(hover)} cy={Y(s.values[hover])} r="3" fill={s.color} stroke={C.card} strokeWidth="1.5" />
                ))}
              </g>
            )}
          </svg>
        )}
        {hover != null && w > 0 && (
          <div style={{ position: 'absolute', top: 4, left: Math.min(Math.max(X(hover) + 12, padL), Math.max(padL, w - 170)), background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7, padding: '7px 10px', pointerEvents: 'none', zIndex: 5, boxShadow: `0 8px 24px ${C.shadow}`, minWidth: 132 }}>
            <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginBottom: 4 }}>{labels[hover]}</div>
            {norm.map(s => (
              <div key={s.id || s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: MONO, color: C.txt2, lineHeight: 1.7, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <span style={{ color: C.txt, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.values[hover].toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: `4px ${padR}px 0 ${padL}px` }}>
        {[labels[0], labels[Math.floor((n - 1) / 2)], labels[n - 1]].map((d, i) => (
          <span key={i} style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>{(d || '').slice(5)}</span>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
        {norm.map(s => (
          <span key={s.id || s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: MONO, color: C.txt2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Sparkline — single series, for KPI cards ── */
function Sparkline({ values, color = C.acc, height = 30, loading, emptyLabel = 'no trend data yet' }) {
  const [wrapRef, w] = useMeasuredWidth();
  const hasData = !loading && Array.isArray(values) && values.length > 1;
  const { drawn, reduced } = useDrawIn(hasData && w > 0);
  if (loading) {
    return <div style={{ height, display: 'flex', alignItems: 'center' }}><Spinner size={10} color={C.muted} /></div>;
  }
  if (!hasData) {
    return <div style={{ height, display: 'flex', alignItems: 'center', color: C.muted, fontSize: 9, fontFamily: MONO, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{emptyLabel}</div>;
  }
  const vals = values.map(v => Math.max(0, Number(v) || 0));
  const max = Math.max(1, ...vals);
  const n = vals.length;
  const padY = 2;
  const pts = w > 1 ? vals.map((v, i) => [+((i * (w - 2)) / (n - 1) + 1).toFixed(1), +(padY + (1 - v / max) * (height - padY * 2)).toFixed(1)]) : [];
  const line = pts.length ? smoothPath(pts, padY, height - padY) : '';
  return (
    <div ref={wrapRef} style={{ height, minWidth: 0 }}>
      {pts.length > 0 && (
        <svg width={w} height={height} style={{ display: 'block' }} aria-hidden="true">
          <path d={`${line} L ${pts[n - 1][0]} ${height - 1} L ${pts[0][0]} ${height - 1} Z`} fill={alpha(color, 0.12)} stroke="none"
            style={{ opacity: drawn ? 1 : 0, transition: reduced ? 'none' : 'opacity 0.45s ease 0.2s' }} />
          <path d={line} fill="none" stroke={color} strokeWidth="1.5" pathLength="1"
            style={{ strokeDasharray: 1, strokeDashoffset: drawn ? 0 : 1, transition: reduced ? 'none' : 'stroke-dashoffset 0.5s ease' }} />
        </svg>
      )}
    </div>
  );
}

/* ── BarRow — horizontal labeled bars (e.g. unique-login windows) ── */
function BarRow({ rows, color = C.acc, loading, emptyLabel = 'No data yet' }) {
  const list = Array.isArray(rows) ? rows : [];
  const ready = !loading && list.length > 0 && list.some(r => r.value != null);
  const { drawn, reduced } = useDrawIn(ready);
  if (loading) return <ChartLoading height={Math.max(100, list.length * 26)} />;
  if (!ready) return <ChartEmpty label={emptyLabel} height={100} />;
  const max = Math.max(1, ...list.map(r => Number(r.value) || 0));
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {list.map(r => {
        const v = Math.max(0, Number(r.value) || 0);
        return (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '78px minmax(0, 1fr) 48px', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
            <div style={{ height: 10, borderRadius: 5, background: alpha(C.muted, 0.14), overflow: 'hidden', minWidth: 0 }}>
              <div style={{ height: '100%', borderRadius: 5, background: r.color || color, width: drawn ? `${v > 0 ? Math.max(2, (v / max) * 100) : 0}%` : '0%', transition: reduced ? 'none' : 'width 0.5s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.txt, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── DonutGauge — segments + center label, with a side legend ── */
function DonutGauge({ segments, centerValue, centerLabel, size = 132, thickness = 13, loading, emptyLabel = 'No data yet' }) {
  const segs = (segments || []).map(s => ({ ...s, value: Math.max(0, Number(s.value) || 0) }));
  const total = segs.reduce((a, s) => a + s.value, 0);
  const ready = !loading && total > 0;
  const { drawn, reduced } = useDrawIn(ready);
  if (loading) return <ChartLoading height={size} />;
  if (!ready) return <ChartEmpty label={emptyLabel} height={size} />;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ display: 'block', transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={alpha(C.muted, 0.14)} strokeWidth={thickness} />
          {segs.filter(s => s.value > 0).map(s => {
            const frac = s.value / total;
            const offset = acc; acc += frac;
            const seg = Math.max(0.5, frac * circ - 1.5);
            return (
              <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
                strokeDasharray={drawn ? `${seg} ${circ - seg}` : `0.01 ${circ}`}
                strokeDashoffset={-offset * circ}
                style={{ transition: reduced ? 'none' : 'stroke-dasharray 0.55s ease' }} />
            );
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 21, fontWeight: 800, fontFamily: MONO, color: C.txt, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>{centerValue}</div>
          {centerLabel && <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{centerLabel}</div>}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 7, minWidth: 0, flex: 1 }}>
        {segs.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.txt2, letterSpacing: '0.04em', textTransform: 'uppercase', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.label}>{s.label}</span>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.txt, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── FunnelBar — labeled horizontal bars, widths relative to the first/max
   stage; a stage may carry stacked sub-segments (e.g. decision mix) ── */
function FunnelBar({ stages, loading, emptyLabel = 'No data yet' }) {
  const list = (stages || []).map(s => ({ ...s, value: Math.max(0, Number(s.value) || 0) }));
  const ready = !loading && list.length > 0 && list.some(s => s.value > 0);
  const { drawn, reduced } = useDrawIn(ready);
  if (loading) return <ChartLoading height={150} />;
  if (!ready) return <ChartEmpty label={emptyLabel} height={150} />;
  const max = Math.max(1, ...list.map(s => s.value));
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {list.map(s => {
        const pct = (s.value / max) * 100;
        const segs = (s.segments || []).map(g => ({ ...g, value: Math.max(0, Number(g.value) || 0) }));
        const segTotal = segs.reduce((a, g) => a + g.value, 0);
        return (
          <div key={s.label} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
              <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={s.label}>{s.label}</span>
              <span style={{ fontSize: 11, fontFamily: MONO, color: C.txt, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{s.value.toLocaleString()}</span>
            </div>
            <div style={{ height: 16, borderRadius: 5, background: alpha(C.muted, 0.12), overflow: 'hidden' }}>
              <div style={{ height: '100%', width: drawn ? `${s.value > 0 ? Math.max(1.5, pct) : 0}%` : '0%', transition: reduced ? 'none' : 'width 0.55s ease', display: 'flex', overflow: 'hidden', borderRadius: 5, background: segTotal > 0 ? 'transparent' : alpha(s.color || C.acc, 0.55) }}>
                {segTotal > 0 && segs.map(g => (
                  <div key={g.label} title={`${g.label}: ${g.value.toLocaleString()}`} style={{ height: '100%', width: `${(g.value / segTotal) * 100}%`, background: g.color, minWidth: g.value > 0 ? 2 : 0 }} />
                ))}
              </div>
            </div>
            {segTotal > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 5 }}>
                {segs.map(g => (
                  <span key={g.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                    {g.label} <span style={{ color: C.txt2, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{g.value.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── RankedBars — ranked horizontal bars from [{label,count}] (prompt26) ──
   For analytics distributions (research field, primary role, country, etc.).
   Bars scale to the max; shows a "+N more" line when truncated. */
function RankedBars({ items, color = C.acc, max = 8, loading, emptyLabel = 'No data yet' }) {
  const list = Array.isArray(items) ? items.filter(d => d && d.label != null) : [];
  const ready = !loading && list.length > 0;
  const { drawn, reduced } = useDrawIn(ready);
  if (loading) return <ChartLoading height={Math.max(90, max * 24)} />;
  if (!ready) return <ChartEmpty label={emptyLabel} height={120} />;
  const shown = list.slice(0, max);
  const hiddenCount = list.length - shown.length;
  const top = Math.max(1, ...shown.map(d => Number(d.count) || 0));
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {shown.map(d => {
        const v = Math.max(0, Number(d.count) || 0);
        return (
          <div key={d.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 40px', alignItems: 'center', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.txt2, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</div>
              <div style={{ height: 8, borderRadius: 4, background: alpha(C.muted, 0.14), overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 4, background: color, width: drawn ? `${v > 0 ? Math.max(3, (v / top) * 100) : 0}%` : '0%', transition: reduced ? 'none' : 'width 0.5s ease' }} />
              </div>
            </div>
            <span style={{ fontSize: 12, fontFamily: MONO, color: C.txt, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginTop: 2 }}>+{hiddenCount} more</div>
      )}
    </div>
  );
}

/* ── PercentCard — a single big % with a slim progress bar + sub count.
   Used for onboarding completion (prompt26). ── */
function PercentCard({ value, total, label, color = C.acc, loading, suffix }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const { drawn, reduced } = useDrawIn(!loading);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800, fontFamily: MONO, color, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
          {loading ? '—' : `${pct}%`}
        </span>
        {!loading && (
          <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{value.toLocaleString()} / {total.toLocaleString()}{suffix ? ` ${suffix}` : ''}</span>
        )}
      </div>
      <div style={{ height: 8, borderRadius: 4, background: alpha(C.muted, 0.14), overflow: 'hidden', marginTop: 10 }}>
        <div style={{ height: '100%', borderRadius: 4, background: color, width: drawn && !loading ? `${pct}%` : '0%', transition: reduced ? 'none' : 'width 0.55s ease' }} />
      </div>
      {label && <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: OVERVIEW — ops control center (prompt8 redesign)
   Tier 1: KPI cards (count-up + sparkline) · Tier 2: 14-day activity chart
   + live system health · Tier 3: screening pipeline funnel, completion
   donut, unique-login windows · Tier 4: live activity feed + alerts/actions.
   Admin-only: never mounted for mods (allowed-set gating in the root), and
   every fetch + the EventSource is additionally gated on `isAdmin`.
   ════════════════════════════════════════════════════════════════════════ */

function LivePulseDot({ live }) {
  return (
    <span style={{ position: 'relative', width: 9, height: 9, display: 'inline-block', flexShrink: 0 }}>
      {live && <span className="ops-pulse" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: alpha(C.grn, 0.55) }} />}
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: live ? C.grn : C.muted }} />
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   NEW USER GROWTH (prompt27) — registration analytics. Shared between the
   Overview (high-level summary + trend) and Users › Growth (detailed). All
   windows use SERVER-LOCAL time, week starts Sunday (see server userGrowth.js).
   ════════════════════════════════════════════════════════════════════════ */

/* Period-over-period change pill. null → neutral "no prior data"; >0 green ▲,
   <0 red ▼, 0 muted →. */
function DeltaBadge({ delta, title }) {
  if (delta == null) return <span title={title} style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>—</span>;
  const up = delta > 0, flat = delta === 0;
  const color = flat ? C.muted : (up ? C.grn : C.red);
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontFamily: MONO, fontWeight: 700, color }}>
      <span>{flat ? '→' : (up ? '▲' : '▼')}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{up ? '+' : ''}{delta}%</span>
    </span>
  );
}

/* One registration-window count + its delta vs the previous full period. */
function GrowthSummaryCard({ label, win, accent = C.acc, loading, prevLabel }) {
  const value = useCountUp(loading ? null : (win?.count ?? 0));
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '14px 16px', minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent, fontFamily: MONO, letterSpacing: '-1px', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
        {loading || value == null ? '—' : value.toLocaleString()}
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</div>
      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <DeltaBadge delta={win?.deltaPct} title={prevLabel ? `${win?.prev ?? 0} in the previous ${prevLabel}` : undefined} />
        {!loading && win && <span style={{ fontSize: 9, fontFamily: MONO, color: C.muted }}>vs {(win.prev ?? 0).toLocaleString()} prior</span>}
      </div>
    </div>
  );
}

/* Segmented range switch for the trend chart. */
function RangeSwitch({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: alpha(C.muted, 0.1), borderRadius: 7, padding: 2 }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            padding: '4px 10px', background: on ? C.card : 'transparent', border: 'none',
            borderRadius: 5, color: on ? C.txt : C.txt2, fontSize: 11, fontFamily: MONO,
            fontWeight: on ? 700 : 500, cursor: 'pointer',
            boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

const GROWTH_RANGES = [
  { id: '7d',     label: '7d' },
  { id: '30d',    label: '30d' },
  { id: '90d',    label: '90d' },
  { id: '12mo',   label: '12 mo' },
  { id: 'yearly', label: 'Yearly' },
];

/* Build {labels, values} for the new-users trend from a growth payload + range. */
function growthTrend(data, range) {
  if (!data) return { labels: [], values: [] };
  if (range === '12mo') {
    const m = Array.isArray(data.byMonth12) ? data.byMonth12 : [];
    return { labels: m.map(x => x.label), values: m.map(x => x.count) };
  }
  if (range === 'yearly') {
    const y = Array.isArray(data.byYear) ? data.byYear : [];
    return { labels: y.map(x => String(x.year)), values: y.map(x => x.count) };
  }
  const n = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const days = Array.isArray(data.byDay) ? data.byDay.slice(-n) : [];
  return { labels: days.map(d => d.date), values: days.map(d => d.count) };
}

/* Overview's compact New-User-Growth card: window summary + trend + insights. */
function NewUserGrowthOverview() {
  const [data, setData]   = useState(null);  // null = loading, undefined = error
  const [error, setError] = useState('');
  const [range, setRange] = useState('30d');

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const d = await adminApi.getUserGrowth(); if (alive) setData(d); }
      catch (e) { if (alive) { setError(e.message); setData(undefined); } }
    })();
    return () => { alive = false; };
  }, []);

  const loading = data === null;
  const w = data?.windows || {};
  const ins = data?.insights || {};
  const { labels, values } = growthTrend(data, range);
  const series = [{ id: 'newUsers', label: 'New users', color: C.grn, values }];

  const insightItems = [
    { label: 'Top country',        v: ins.topCountry },
    { label: 'Top institution',    v: ins.topInstitution },
    { label: 'Top research field', v: ins.topResearchField },
    { label: 'Top role',           v: ins.topPrimaryRole },
  ];
  const anyInsight = insightItems.some(i => i.v);

  return (
    <SectionCard title="New User Growth" action={
      <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.05em' }}>registrations · server-local time</span>
    }>
      <div style={{ padding: '16px 18px' }}>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox msg={error} /></div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10, marginBottom: 18 }}>
          <GrowthSummaryCard label="Today"        win={w.today}   accent={C.acc}  loading={loading} prevLabel="day" />
          <GrowthSummaryCard label="This week"    win={w.week}    accent={C.teal} loading={loading} prevLabel="week" />
          <GrowthSummaryCard label="This month"   win={w.month}   accent={C.grn}  loading={loading} prevLabel="month" />
          <GrowthSummaryCard label="This quarter" win={w.quarter} accent={C.purp} loading={loading} prevLabel="quarter" />
          <GrowthSummaryCard label="This year"    win={w.year}    accent={C.acc2} loading={loading} prevLabel="year" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.txt2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>New users over time</span>
          <RangeSwitch options={GROWTH_RANGES} value={range} onChange={setRange} />
        </div>
        <AreaChart series={loading ? null : series} labels={labels} height={170} loading={loading} emptyLabel="Not enough registration data yet" />

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
          <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>This month's highlights</div>
          {!anyInsight ? (
            <div style={{ fontSize: 12, color: C.muted }}>{loading ? 'Loading…' : 'Not enough profile data yet.'}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))', gap: 10 }}>
              {insightItems.map(i => (
                <div key={i.label} style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '9px 11px', minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{i.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.v ? i.v.label : undefined}>
                    {i.v ? i.v.label : <span style={{ color: C.muted, fontWeight: 400 }}>—</span>}
                  </div>
                  {i.v && <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginTop: 2 }}>{i.v.count.toLocaleString()} new</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function KpiCard({ label, value, sub, color = C.acc, spark, trendLoading, loading, onClick }) {
  const display = useCountUp(loading ? null : value);
  return (
    <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '16px 18px 12px', cursor: onClick ? 'pointer' : 'default', transition: 'border-color 0.15s', minWidth: 0 }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor = color)}
      onMouseLeave={e => onClick && (e.currentTarget.style.borderColor = C.brd)}
    >
      {loading ? <div style={{ height: 32, display: 'flex', alignItems: 'center' }}><Spinner /></div> : (
        <div style={{ fontSize: 30, fontWeight: 800, color, fontFamily: MONO, letterSpacing: '-1.2px', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
          {display == null ? '—' : display.toLocaleString()}
        </div>
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 7, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
      <div style={{ marginTop: 8 }}>
        <Sparkline values={spark} color={color} height={28} loading={trendLoading} emptyLabel="no trend data yet" />
      </div>
    </div>
  );
}

function OverviewSection({ onNavigate, isAdmin = true }) {
  const { brand } = useTheme(); // prompt37 — surface the active brand swatch
  const [metrics, setMetrics] = useState(null);
  const [health,  setHealth]  = useState(null);
  const [siftM,   setSiftM]   = useState(null);      // screening metrics (funnel / donut / KPI sub-stat)
  const [trend,   setTrend]   = useState(undefined); // undefined = loading, null = unavailable, array = data
  const [feed,    setFeed]    = useState(null);      // null = loading, [] = empty
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [live,    setLive]    = useState(false);     // SSE stream open
  const [lastEventAt, setLastEventAt] = useState(null);
  const feedDebounce = useRef(null);

  // Live activity feed: merge latest audit-log + security events, newest first.
  const loadFeed = useCallback(async () => {
    if (!isAdmin) return;
    const [a, s] = await Promise.all([
      adminApi.auditLog({ limit: 10 }).catch(() => null),
      adminApi.securityEvents({ limit: 10 }).catch(() => null),
    ]);
    const items = [
      ...(a?.logs || []).map(l => ({
        kind: 'audit', id: `a-${l.id}`, at: l.createdAt,
        actor: l.admin?.email || 'system', action: l.action, entity: l.entityType,
      })),
      ...(s?.events || []).map(ev => ({
        kind: 'security', id: `s-${ev.id}`, at: ev.createdAt,
        actor: ev.email || ev.ip || 'unknown', action: ev.type, type: ev.type,
      })),
    ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 12);
    setFeed(items);
  }, [isAdmin]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setError('');
    try {
      const [m, h, sm] = await Promise.all([
        adminApi.metrics(),
        adminApi.health().catch(() => null),
        adminApi.screening.getMetrics().catch(() => null),
      ]);
      setMetrics(m); setHealth(h); setSiftM(sm);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
    // Trend buckets are best-effort: any error/404 → explicit "no trend data
    // yet" chart states. NEVER fabricated values.
    adminApi.metricsTimeseries(14)
      .then(d => setTrend(Array.isArray(d?.days) ? d.days : null))
      .catch(() => setTrend(null));
    loadFeed();
  }, [isAdmin, loadFeed]);

  useEffect(() => { load(); }, [load]);

  // Feed safety-net refresh (60s) on top of the debounced SSE poke below.
  useEffect(() => {
    if (!isAdmin) return undefined;
    const t = setInterval(loadFeed, 60_000);
    return () => clearInterval(t);
  }, [isAdmin, loadFeed]);

  // Live indicator: lightweight EventSource on the poke channel. Used ONLY to
  // flip the pulse dot (open/error), stamp lastEventAt, and debounce a feed
  // refetch — event payloads are never trusted as data. Admin-only (this
  // section never mounts for mods) and closed on unmount.
  useEffect(() => {
    if (!isAdmin || typeof EventSource === 'undefined') return undefined;
    let es;
    try { es = new EventSource('/api/events'); } catch { return undefined; }
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = () => {
      setLastEventAt(Date.now());
      if (feedDebounce.current) clearTimeout(feedDebounce.current);
      feedDebounce.current = setTimeout(loadFeed, 4000);
    };
    return () => {
      if (feedDebounce.current) { clearTimeout(feedDebounce.current); feedDebounce.current = null; }
      try { es.close(); } catch { /* already closed */ }
      setLive(false);
    };
  }, [isAdmin, loadFeed]);

  const m = metrics || {};
  const unread  = m.contactMessages?.unread ?? 0;
  const failed7 = m.securityEvents?.failedLogins7d ?? 0;
  const suspended = m.users?.suspended ?? 0;
  const dbOk = health?.db === 'ok' || health?.database === 'ok';

  const trendLoading = trend === undefined;
  const sparkOf = key => (Array.isArray(trend) ? trend.map(d => Math.max(0, Number(d?.[key]) || 0)) : undefined);
  const areaSeries = Array.isArray(trend) ? [
    { id: 'logins',      label: 'Logins',       color: C.acc,  values: sparkOf('logins') },
    { id: 'newUsers',    label: 'New users',    color: C.grn,  values: sparkOf('newUsers') },
    { id: 'newProjects', label: 'New projects', color: C.purp, values: sparkOf('newProjects') },
    { id: 'decisions',   label: 'Screening decisions', color: C.teal, values: sparkOf('screeningDecisions') },
  ] : null;
  const areaLabels = Array.isArray(trend) ? trend.map(d => d?.date || '') : [];

  // Screening pipeline + completion — real screening metrics; null (fetch
  // failed / module empty) → explicit chart empty states.
  const sift = siftM || null;
  const funnelStages = sift ? [
    { label: 'Records',  value: sift.totalRecords, color: C.txt2 },
    { label: 'Screened', value: sift.screened, color: C.acc, segments: [
      { label: 'Included', value: sift.included, color: C.grn },
      { label: 'Excluded', value: sift.excluded, color: C.red },
      { label: 'Maybe',    value: sift.maybe,    color: C.yel },
    ] },
    { label: '2nd Review',    value: sift.eligibleSecondReview, color: C.teal },
    { label: 'To Extraction', value: sift.sentToExtraction,     color: C.grn },
  ] : [];
  const doneN       = sift?.doneProjects ?? 0;
  const inProgN     = sift?.inProgressProjects ?? 0;
  const totalSift   = sift?.totalProjects ?? 0;
  const notStartedN = Math.max(0, totalSift - doneN - inProgN);
  const donePct     = totalSift > 0 ? Math.round((doneN / totalSift) * 100) : 0;

  const attention = [
    unread > 0    && { icon: 'mail',     color: C.ylw, msg: `${unread} unread message${unread !== 1 ? 's' : ''}`,          go: 'messages' },
    suspended > 0 && { icon: 'users',    color: C.red, msg: `${suspended} suspended user${suspended !== 1 ? 's' : ''}`,    go: 'users' },
    failed7 > 10  && { icon: 'shield',   color: C.red, msg: `${failed7} failed login attempts in the last 7 days`,         go: 'security' },
    health && !dbOk && { icon: 'activity', color: C.red, msg: 'Database health check failed',                              go: 'health' },
  ].filter(Boolean);

  const secTint = t => ({ FAILED_LOGIN: C.red, ADMIN_ACCESS_DENIED: C.ylw, RATE_LIMITED: C.acc }[t] || C.muted);

  const healthTiles = [
    { label: 'Backend',     value: health ? <Badge text="OK" color={C.grn} /> : <Badge text="Unknown" color={C.muted} /> },
    { label: 'Database',    value: health ? (dbOk ? <Badge text="OK" color={C.grn} /> : <Badge text="Error" color={C.red} />) : <Badge text="Unknown" color={C.muted} /> },
    { label: 'Environment', value: <Badge text={health?.env || 'unknown'} color={health?.env === 'production' ? C.ylw : C.grn} /> },
    { label: 'Version',     value: <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt2 }}>{health?.version || '—'}</span> },
    { label: 'Uptime',      value: health?.uptime != null ? <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt2 }}>{Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m</span> : <span style={{ color: C.muted }}>—</span> },
    { label: 'Last Event',  value: <span style={{ fontFamily: MONO, fontSize: 12, color: lastEventAt ? C.txt2 : C.muted }}>{lastEventAt ? fmtAgo(lastEventAt) : (live ? 'listening…' : '—')}</span> },
  ];

  return (
    <div>
      {/* opsPulse keyframes are now in the AdminConsole root <style> tag so
          UsersSection / UserDetailPanel can use them too. */}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>Platform Overview</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* prompt37 — active brand swatch + quick link to Ops › Appearance */}
          <button onClick={() => onNavigate('style')} title="Open Appearance"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 11px', background: alpha(C.acc, 0.08), border: `1px solid ${alpha(C.acc, 0.3)}`, borderRadius: 999, cursor: 'pointer', fontFamily: FONT }}>
            <span style={{ width: 13, height: 13, borderRadius: 4, background: brand.brandColor || C.acc, border: `1px solid ${alpha('#000000', 0.15)}` }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: C.acc }}>
              {PRESETS.find(p => p.id === brand.preset)?.name || 'Custom theme'}
            </span>
          </button>
          <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      {/* ── Tier 1: KPI cards — animated counters + sparklines ─────────── */}
      {/* grid uses auto-fit so the two new online/offline tiles reflow gracefully */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
        <KpiCard label="Total Users" value={m.users?.total} sub={`+${m.users?.thisMonth ?? 0} this month`} color={C.acc}
          spark={sparkOf('newUsers')} trendLoading={trendLoading} loading={loading} onClick={() => onNavigate('users')} />
        <KpiCard label="Total Projects (Workspace)" value={m.projects?.total} sub={`Screening: ${sift ? (sift.totalProjects ?? 0).toLocaleString() : '—'}`} color={C.grn}
          spark={sparkOf('newProjects')} trendLoading={trendLoading} loading={loading} onClick={() => onNavigate('projects')} />
        {/* prompt25 — online/offline counts from live presence heartbeats (~75s window) */}
        <KpiCard label="Online Users" value={m.users?.online} sub="live presence" color={C.grn}
          trendLoading={false} loading={loading} onClick={() => onNavigate('users')} />
        <KpiCard label="Offline Users" value={m.users?.offline} sub="no recent heartbeat" color={C.muted}
          trendLoading={false} loading={loading} onClick={() => onNavigate('users')} />
        <KpiCard label="Unread Messages" value={unread} sub={`${(m.contactMessages?.total ?? 0).toLocaleString()} total`} color={unread > 0 ? C.ylw : C.muted}
          spark={sparkOf('contactMessages')} trendLoading={trendLoading} loading={loading} onClick={() => onNavigate('messages')} />
        <KpiCard label="Failed Logins (7d)" value={failed7} sub="security posture" color={failed7 > 10 ? C.red : C.muted}
          spark={sparkOf('failedLogins')} trendLoading={trendLoading} loading={loading} onClick={() => onNavigate('security')} />
      </div>

      {/* ── New User Growth (prompt27) — registration analytics summary ── */}
      <div style={{ marginBottom: 14 }}>
        <NewUserGrowthOverview />
      </div>

      {/* ── Tier 2: 14-day activity + live system health ───────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr)', gap: 14 }}>
        <SectionCard title="Activity — Last 14 Days">
          <div style={{ padding: '16px 18px 14px' }}>
            <AreaChart series={areaSeries} labels={areaLabels} height={190} loading={trendLoading} emptyLabel="No trend data yet" />
          </div>
        </SectionCard>
        <SectionCard title="System Health" action={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 10, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', color: live ? C.grn : C.muted }}>
            <LivePulseDot live={live} />
            {live ? 'live' : 'offline'}
          </span>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {healthTiles.map((row, i) => (
              <div key={row.label} style={{ padding: '13px 16px', borderBottom: i < healthTiles.length - 2 ? `1px solid ${C.brd}` : 'none', borderRight: i % 2 === 0 ? `1px solid ${C.brd}` : 'none', minWidth: 0 }}>
                <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</div>
                {loading ? <Spinner size={12} /> : row.value}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ── Tier 3: screening pipeline · completion · login windows ────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.1fr) minmax(0, 1fr)', gap: 14 }}>
        <SectionCard title="Screening Pipeline">
          <div style={{ padding: '16px 18px' }}>
            <FunnelBar stages={funnelStages} loading={loading} emptyLabel="No screening data yet" />
          </div>
        </SectionCard>
        <SectionCard title="Completion (Screening)">
          <div style={{ padding: '16px 18px' }}>
            <DonutGauge
              loading={loading}
              segments={[
                { label: 'Done',        value: doneN,       color: C.grn },
                { label: 'In Progress', value: inProgN,     color: C.teal },
                { label: 'Not Started', value: notStartedN, color: C.muted },
              ]}
              centerValue={`${donePct}%`}
              centerLabel="done"
              emptyLabel="No screening projects yet"
            />
            {sift && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
                {[
                  { label: 'Done Today', value: sift.doneToday },
                  { label: 'This Week',  value: sift.doneThisWeek },
                  { label: 'This Month', value: sift.doneThisMonth },
                ].map(d => (
                  <div key={d.label} style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: C.grn, fontVariantNumeric: 'tabular-nums' }}>{d.value ?? 0}</div>
                    <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
        <SectionCard title="Unique Active Users">
          <div style={{ padding: '16px 18px' }}>
            <BarRow
              loading={loading}
              color={C.teal}
              emptyLabel="No activity data yet"
              rows={[
                { label: '24h',      value: m.activeUsers?.day },
                { label: '7 days',   value: m.activeUsers?.week },
                { label: '30 days',  value: m.activeUsers?.month },
                { label: '90 days',  value: m.activeUsers?.quarter },
                { label: '365 days', value: m.activeUsers?.year },
              ]}
            />
            <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, marginTop: 12, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.6 }}>
              active users · rolling windows · any authenticated action (open app, open/save project, run/export analysis, …) — includes returning sessions, not only fresh logins
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Unique Logins">
          <div style={{ padding: '16px 18px' }}>
            <BarRow
              loading={loading}
              color={C.acc}
              emptyLabel="No login data yet"
              rows={[
                { label: '24 hours', value: m.logins?.day },
                { label: '7 days',   value: m.logins?.week },
                { label: '30 days',  value: m.logins?.month },
                { label: '90 days',  value: m.logins?.quarter },
                { label: '365 days', value: m.logins?.year },
              ]}
            />
            <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, marginTop: 12, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.6 }}>
              sign-in events only · rolling windows · distinct users who authenticated with a password during the window
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Tier 3.5: engagement — prompt9 additive metric groups. Keys are
          delivered by Wave B2 (invites / notificationsStats / lifecycle /
          emailStats / linking / exportsByFormat); every tile renders '—'
          gracefully while a key is absent. Existing metrics untouched. ── */}
      <SectionCard title="Engagement" action={
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.05em' }}>invites · notifications · lifecycle · email · linking</span>
      }>
        <div style={{ padding: '14px 18px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 8 }}>
            {[
              { label: 'Invites Pending',   value: m.invites?.pending,                 color: C.ylw },
              { label: 'Invites Accepted',  value: m.invites?.accepted,                color: C.grn },
              { label: 'Invites Expired',   value: m.invites?.expired,                 color: C.muted },
              { label: 'Notifs Sent',       value: m.notificationsStats?.sent,         color: C.acc },
              { label: 'Notifs Clicked',    value: m.notificationsStats?.clicked,      color: C.teal },
              { label: 'Notifs Dismissed',  value: m.notificationsStats?.dismissed,    color: C.muted },
              { label: 'Projects Deleted',  value: m.lifecycle?.projectsDeleted,       color: C.red },
              { label: 'SIFT Deleted',      value: m.lifecycle?.siftProjectsDeleted,   color: C.red },
              { label: 'Members Left',      value: m.lifecycle?.membersLeft,           color: C.muted },
              { label: 'Emails Sent',       value: m.emailStats?.sent,                 color: C.grn },
              { label: 'Emails Failed',     value: m.emailStats?.failed,               color: C.red },
              { label: 'Linked Workspaces', value: m.linking?.linkedWorkspaces,        color: C.acc },
              { label: 'Unlinked Screening', value: m.linking?.unlinkedSiftProjects,    color: C.muted },
              { label: 'Unlinked Workspace', value: m.linking?.unlinkedMetaLabProjects, color: C.muted },
            ].map(t => (
              <div key={t.label} style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '9px 11px', minWidth: 0 }}>
                {loading ? <Spinner size={12} /> : (
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: t.value == null ? C.muted : t.color, fontVariantNumeric: 'tabular-nums' }}>
                    {t.value == null ? '—' : Number(t.value).toLocaleString()}
                  </div>
                )}
                <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.label}>{t.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <span style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Exports by format</span>
            {(() => {
              const entries = m.exportsByFormat && typeof m.exportsByFormat === 'object'
                ? Object.entries(m.exportsByFormat).filter(([, v]) => v != null) : [];
              if (!entries.length) return <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>—</span>;
              return entries.map(([fmt, count]) => (
                <span key={fmt} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', background: alpha(C.acc, '10'), border: `1px solid ${alpha(C.acc, '30')}`, borderRadius: 10, fontSize: 10, fontFamily: MONO, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.txt2 }}>
                  {fmt}
                  <span style={{ color: C.acc, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Number(count).toLocaleString()}</span>
                </span>
              ));
            })()}
          </div>
        </div>
      </SectionCard>

      {/* ── Email System status + delivery metrics (prompt14 Task 5) ──────
          Config snapshot (m.email) is secret-free; delivery counts (m.emailStats)
          split by context. Each tile renders '—' gracefully when a key is absent. */}
      <SectionCard title="Email System" action={
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.05em' }}>SMTP · delivery · fallbacks</span>
      }>
        <div style={{ padding: '14px 18px 16px' }}>
          {/* Config status pills (booleans + provider label only — never secrets) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(() => {
              const e = m.email || {};
              // Plain element-returning helper (NOT a component): called as pill(...)
              // so it does not create a new component type — and thus no remount —
              // on every Overview render.
              const pill = ({ key, label, ok, okText, badText, neutral, text }) => (
                <span key={key} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                  background: neutral ? alpha(C.acc, '10') : (ok ? alpha(C.grn, '12') : alpha(C.ylw, '12')),
                  border: `1px solid ${neutral ? alpha(C.acc, '30') : (ok ? alpha(C.grn, '30') : alpha(C.ylw, '30'))}`,
                  borderRadius: 10, fontSize: 10.5, fontFamily: MONO, letterSpacing: '0.04em',
                  color: neutral ? C.txt2 : (ok ? C.grn : C.ylw),
                }}>
                  <span style={{ textTransform: 'uppercase', color: C.muted }}>{label}</span>
                  {neutral ? text : (ok ? okText : badText)}
                </span>
              );
              return [
                pill({ key: 'status', label: 'Status', ok: !!e.configured, okText: 'configured', badText: 'not configured' }),
                pill({ key: 'provider', label: 'Provider', neutral: true, text: e.provider || '—' }),
                pill({ key: 'host', label: 'SMTP host', ok: !!e.smtpHostConfigured, okText: 'set', badText: 'missing' }),
                pill({ key: 'from', label: 'From', ok: !!e.emailFromConfigured, okText: 'set', badText: 'missing' }),
                pill({ key: 'auth', label: 'Auth', ok: !!e.smtpAuthConfigured, okText: 'set', badText: 'none' }),
                pill({ key: 'baseurl', label: 'Base URL', ok: !!e.appBaseUrlConfigured, okText: 'set', badText: 'missing' }),
              ];
            })()}
          </div>

          {m.email && !m.email.configured && (
            <div style={{ marginBottom: 12 }}>
              <NoticeBox msg="Email is not configured — contact replies save as drafts and invite/reset links are shown to operators. See server/docs/email-setup.md." />
            </div>
          )}

          {/* Delivery counts, split by context */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {[
              { label: 'Emails Sent',   value: m.emailStats?.sent,                   color: C.grn },
              { label: 'Emails Failed', value: m.emailStats?.failed,                 color: C.red },
              { label: 'Invite Sent',   value: m.emailStats?.invites?.sent,          color: C.acc },
              { label: 'Invite Failed', value: m.emailStats?.invites?.failed,        color: C.red },
              { label: 'Reset Sent',    value: m.emailStats?.passwordResets?.sent,   color: C.acc },
              { label: 'Reset Failed',  value: m.emailStats?.passwordResets?.failed, color: C.red },
              { label: 'Reply Sent',    value: m.emailStats?.contactReplies?.sent,   color: C.grn },
              { label: 'Reply Drafts',  value: m.emailStats?.contactReplies?.draft,  color: C.ylw },
              { label: 'Reply Failed',  value: m.emailStats?.contactReplies?.failed, color: C.red },
            ].map(t => (
              <div key={t.label} style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '9px 11px', minWidth: 0 }}>
                {loading ? <Spinner size={12} /> : (
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: t.value == null ? C.muted : t.color, fontVariantNumeric: 'tabular-nums' }}>
                    {t.value == null ? '—' : Number(t.value).toLocaleString()}
                  </div>
                )}
                <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.label}>{t.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>Last sent: <span style={{ color: C.txt2 }}>{m.emailStats?.lastSentAt ? fmtAgo(m.emailStats.lastSentAt) : '—'}</span></span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>Last failed: <span style={{ color: C.txt2 }}>{m.emailStats?.lastFailedAt ? fmtAgo(m.emailStats.lastFailedAt) : '—'}</span></span>
          </div>
        </div>
      </SectionCard>

      {/* ── Tier 4: live activity feed + alerts / quick actions ────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 14 }}>
        <SectionCard title="Live Activity" action={
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.05em' }}>audit log + security events</span>
        }>
          {feed === null ? <ChartLoading height={180} /> : feed.length === 0 ? (
            <ChartEmpty label="No recent activity" height={180} />
          ) : (
            <div>
              {feed.map((it, i) => {
                // Day-group separator whenever the (local) calendar day changes.
                const day = new Date(it.at).toDateString();
                const prevDay = i > 0 ? new Date(feed[i - 1].at).toDateString() : null;
                const today = new Date().toDateString();
                const yesterday = new Date(Date.now() - 86_400_000).toDateString();
                const dayLabel = day === today ? 'Today' : day === yesterday ? 'Yesterday' : fmtDate(it.at);
                return (
                <div key={it.id}>
                  {day !== prevDay && (
                    <div style={{ padding: '7px 16px 3px', fontSize: 9, fontWeight: 700, fontFamily: MONO, color: C.muted, letterSpacing: '0.14em', textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}`, background: alpha(C.brd, 0.18) }}>
                      {dayLabel}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: i < feed.length - 1 ? `1px solid ${C.brd}` : 'none', minWidth: 0, background: it.kind === 'security' ? alpha(secTint(it.type), 0.05) : 'transparent' }}>
                  <span style={{ color: it.kind === 'security' ? secTint(it.type) : C.acc, display: 'inline-flex', flexShrink: 0 }}>
                    <Icon name={it.kind === 'security' ? 'shield' : 'clipboard'} size={13} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, letterSpacing: '0.03em', color: it.kind === 'security' ? secTint(it.type) : C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.action}>
                      {it.action}{it.entity ? <span style={{ color: C.muted, fontWeight: 400 }}>{` · ${it.entity}`}</span> : null}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.actor}>{it.actor}</div>
                  </div>
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO, flexShrink: 0 }}>{fmtAgo(it.at)}</span>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <div style={{ minWidth: 0 }}>
          <SectionCard title="Needs Attention">
            <div style={{ padding: '4px 0' }}>
              {attention.length === 0 ? (
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: C.grn, display: 'inline-flex' }}><Icon name="check" size={14} /></span>
                  <span style={{ fontSize: 12, color: C.txt2 }}>Everything looks good.</span>
                </div>
              ) : attention.map((a, i) => (
                <button key={i} onClick={() => onNavigate(a.go)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: i < attention.length - 1 ? `1px solid ${C.brd}` : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: FONT, minWidth: 0 }}>
                  <span style={{ color: a.color, display: 'inline-flex', flexShrink: 0 }}><Icon name={a.icon} size={14} /></span>
                  <span style={{ fontSize: 12, color: C.txt2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.msg}>{a.msg}</span>
                  <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>→</span>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Quick Actions">
            <div style={{ padding: '4px 0' }}>
              {[
                { icon: 'users',    label: 'Manage Users',     sub: `${m.users?.total ?? '—'} total`,    go: 'users' },
                { icon: 'folders',  label: 'Manage Projects',  sub: `${m.projects?.total ?? '—'} total`, go: 'projects' },
                { icon: 'mail',     label: 'View Messages',    sub: `${unread} unread`,                  go: 'messages' },
                { icon: 'fileText', label: 'Edit Website',     sub: 'landing page content',              go: 'content' },
              ].map((a, i, arr) => (
                <button key={a.go} onClick={() => onNavigate(a.go)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '9px 16px', background: 'transparent', border: 'none', borderBottom: i < arr.length - 1 ? `1px solid ${C.brd}` : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: FONT, minWidth: 0 }}
                  onMouseEnter={e => e.currentTarget.style.background = alpha(C.acc, '08')}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: C.acc, width: 20, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}><Icon name={a.icon} size={14} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.sub}</div>
                  </div>
                  <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>→</span>
                </button>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: MESSAGES (inbox redesign)
   ════════════════════════════════════════════════════════════════════════ */

function InboxItem({ msg, selected, onClick }) {
  const isUnread = !msg.readByMe && !msg.archived;
  // Clearer unread styling (prompt7): tinted row + accent dot next to the
  // sender, in addition to the bold text and the yellow edge marker.
  const restBg = selected ? alpha(C.acc, '10') : isUnread ? alpha(C.ylw, '08') : 'transparent';
  return (
    <div onClick={onClick} style={{
      padding: '11px 14px', borderBottom: `1px solid ${C.brd}`,
      background: restBg,
      borderLeft: `3px solid ${selected ? C.acc : isUnread ? C.ylw : 'transparent'}`,
      cursor: 'pointer', transition: 'background 0.1s',
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = alpha(C.acc, '07'); }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = restBg; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, fontWeight: isUnread ? 700 : 500, color: isUnread ? C.txt : C.txt2, flex: 1, marginRight: 8 }}>
          {isUnread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.ylw, flexShrink: 0 }} />}
          <span title={msg.name || msg.email} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.name || msg.email}</span>
        </span>
        <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO, flexShrink: 0 }}>{fmtAgo(msg.createdAt)}</span>
      </div>
      <div title={msg.subject || '(no subject)'} style={{ fontSize: 11, color: isUnread ? C.txt2 : C.muted, fontWeight: isUnread ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
        {msg.subject || '(no subject)'}
      </div>
      <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {msg.message ? msg.message.slice(0, 70) + (msg.message.length > 70 ? '…' : '') : ''}
      </div>
    </div>
  );
}

function ReplyComposer({ msg, emailConfigured, onSent }) {
  const [open,    setOpen]    = useState(false);
  const [subject, setSubject] = useState(`Re: ${msg.subject || '(no subject)'}`);
  const [body,    setBody]    = useState('');
  const [preview, setPreview] = useState(false);
  const [status,  setStatus]  = useState('idle');
  const [error,   setError]   = useState('');

  useEffect(() => { setSubject(`Re: ${msg.subject || '(no subject)'}`); setBody(''); setOpen(false); setPreview(false); setError(''); setStatus('idle'); }, [msg.id]);

  async function send() {
    if (!body.trim()) { setError('Reply body is required.'); return; }
    setStatus('saving'); setError('');
    try {
      const res = await adminApi.messages.reply(msg.id, { subject, body });
      setStatus('saved'); setBody('');
      onSent?.(res);
      setTimeout(() => { setStatus('idle'); setOpen(false); }, 1400);
    } catch (e) { setStatus('error'); setError(e.message); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: alpha(C.acc, '15'), border: `1px solid ${alpha(C.acc, '40')}`, borderRadius: 6, color: C.acc, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
        <Icon name="pencil" size={12} /> Reply
      </button>
    );
  }

  return (
    <div style={{ width: '100%', marginTop: 14, padding: 16, background: C.surf, borderRadius: 8, border: `1px solid ${C.brd2}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Reply to {msg.email}</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      {!emailConfigured && (
        <NoticeBox msg="Email is not configured — reply will be saved as a draft. See server/docs/email-setup.md." />
      )}
      {error && <ErrorBox msg={error} />}

      <label style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Subject</label>
      <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={{ ...inputStyle, fontSize: 12, margin: '4px 0 10px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <label style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Message</label>
        <button onClick={() => setPreview(p => !p)} style={{ background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 11, padding: '2px 9px', cursor: 'pointer', fontFamily: FONT }}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {preview ? (
        <div style={{ background: '#ffffff', borderRadius: 7, border: `1px solid ${C.brd2}`, padding: 16, marginBottom: 12, color: '#1f2937' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb', paddingBottom: 12, marginBottom: 14 }}>PecanRev</div>
          {msg.subject && <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>In reply to: {msg.subject}</div>}
          <div style={{ fontSize: 13, marginBottom: 12 }}>{msg.name ? `Hi ${msg.name},` : 'Hello,'}</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{body || <span style={{ color: '#9ca3af' }}>(empty)</span>}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', borderTop: '1px solid #e5e7eb', marginTop: 16, paddingTop: 12 }}>Sent by the PecanRev team</div>
        </div>
      ) : (
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Type your reply…" style={{ ...inputStyle, fontSize: 13, minHeight: 130, resize: 'vertical', lineHeight: 1.6, marginBottom: 12 }} />
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <SaveButton onClick={send} status={status} label={emailConfigured ? 'Send Reply' : 'Save Draft'} />
      </div>
    </div>
  );
}

function ReplyThread({ replies }) {
  if (!replies || replies.length === 0) return null;
  const statusColor = s => ({ sent: C.grn, draft: C.ylw, failed: C.red }[s] || C.muted);
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        Replies ({replies.length})
      </div>
      {replies.map(r => (
        <div key={r.id} style={{ padding: '12px 16px', background: C.surf, borderRadius: 8, border: `1px solid ${C.brd}`, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{r.subject}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge text={r.status} color={statusColor(r.status)} />
              <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>{fmtAgo(r.createdAt)}</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{r.body}</div>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, marginTop: 8 }}>
            to {r.toEmail} · by {r.repliedByName || '—'}{r.error ? ` · error: ${r.error}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageDetail({ msg, emailConfigured, onMarkRead, onArchive, onDelete, onReplied }) {
  const isUnread = !msg.readByMe && !msg.archived;
  const [replies, setReplies] = useState([]);

  const loadReplies = useCallback(() => {
    adminApi.messages.replies(msg.id).then(d => setReplies(d.replies || [])).catch(() => setReplies([]));
  }, [msg.id]);

  useEffect(() => { loadReplies(); }, [loadReplies]);

  function handleSent(res) {
    loadReplies();
    onReplied?.(msg.id);
  }

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 6, minWidth: 0, overflowWrap: 'anywhere' }}>{msg.subject || '(no subject)'}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {msg.archived
                ? <Badge text="archived" color={C.muted} />
                : isUnread
                  ? <Badge text="unread" color={C.ylw} />
                  : <Badge text="read" color={C.grn} />}
              {msg.replied && <Badge text="replied" color={C.teal} />}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
            {fmtDateTime(msg.createdAt)}
          </div>
        </div>
        <div style={{ padding: '12px 16px', background: C.surf, borderRadius: 8, border: `1px solid ${C.brd}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 3, minWidth: 0, overflowWrap: 'anywhere' }}>{msg.name}</div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, minWidth: 0, overflowWrap: 'anywhere' }}>{msg.email}</div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.85, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 18, background: C.surf, borderRadius: 8, border: `1px solid ${C.brd}`, marginBottom: 18, minHeight: 100 }}>
        {msg.message}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ReplyComposer msg={msg} emailConfigured={emailConfigured} onSent={handleSent} />
        {isUnread ? (
          <button onClick={() => onMarkRead(msg.id, true)} style={{ padding: '7px 14px', background: alpha(C.grn, '15'), border: `1px solid ${alpha(C.grn, '30')}`, borderRadius: 6, color: C.grn, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Mark as Read</button>
        ) : !msg.archived ? (
          <button onClick={() => onMarkRead(msg.id, false)} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Mark as Unread</button>
        ) : null}
        {!msg.archived && (
          <button onClick={() => onArchive(msg.id)} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Archive</button>
        )}
        <button onClick={() => onDelete(msg)} style={{ padding: '7px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 6, color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Delete</button>
      </div>

      <ReplyThread replies={replies} />
    </div>
  );
}

function MessagesSection({ onUnreadChange }) {
  const [messages, setMessages] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sort,     setSort]     = useState('newest');
  const [page,     setPage]     = useState(1);
  const [selected, setSelected] = useState(null);
  const [confirm,  setConfirm]  = useState(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [serverUnread, setServerUnread] = useState(0); // authoritative per-staff count (not page-scoped)
  const [compose, setCompose] = useState(null);          // null | { to, subject, body, toName } — new outbound email
  const [composeStatus, setComposeStatus] = useState('idle'); // idle | sending | sent | error
  const [composeErr, setComposeErr] = useState('');
  const searchTimer = useRef(null);
  const PER_PAGE = 30;

  useEffect(() => {
    adminApi.console().then(d => setEmailConfigured(!!d.emailConfigured)).catch(() => {});
  }, []);

  // Refresh the per-staff unread badge from the server (authoritative) — drives both
  // the parent sidebar badge and this section's header/tab count.
  const refreshUnread = useCallback(async () => {
    try { const res = await adminApi.messages.unreadCount(); setServerUnread(res.unread); onUnreadChange?.(res.unread); } catch { /* silent */ }
  }, [onUnreadChange]);

  function markRepliedLocal(id) {
    setMessages(ms => ms.map(m => m.id === id ? { ...m, replied: true, readByMe: true, status: m.archived ? 'archived' : 'read' } : m));
    setSelected(m => m && m.id === id ? { ...m, replied: true, readByMe: true } : m);
    refreshUnread();
  }

  const load = useCallback(async (f, s, so, p) => {
    setLoading(true); setError('');
    try {
      const params = { page: p, limit: PER_PAGE, sort: so };
      // Per-staff inbox boxes (prompt5 Task 9): unread/read are computed per-user.
      if (f === 'unread' || f === 'read' || f === 'archived') params.box = f;
      if (s) params.search = s;
      const data = await adminApi.messages.list(params);
      const msgs = (data.messages || []).map(m => ({
        ...m,
        status: m.archived ? 'archived' : m.readByMe ? 'read' : 'unread',
      }));
      setMessages(msgs);
      setTotal(data.total || msgs.length);
    } catch (e) { setMessages([]); setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(filter, search, sort, 1); refreshUnread(); }, []);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(filter, val, sort, 1); }, 280);
  }

  async function selectMsg(msg) {
    setSelected(msg);
    if (!msg.readByMe && !msg.archived) {
      try {
        // Mark read FOR THIS STAFF MEMBER and update the badge from the response.
        const res = await adminApi.messages.markRead(msg.id, true);
        setMessages(ms => ms.map(m => m.id === msg.id ? { ...m, readByMe: true, status: 'read' } : m));
        setSelected(m => m ? { ...m, readByMe: true, status: 'read' } : m);
        setServerUnread(res.unread);
        onUnreadChange?.(res.unread);
      } catch { /* silent */ }
    }
  }

  async function markRead(id, isRead) {
    try {
      const res = await adminApi.messages.markRead(id, isRead);
      const next = ms => ms.map(m => m.id === id ? { ...m, readByMe: isRead, status: m.archived ? 'archived' : isRead ? 'read' : 'unread' } : m);
      setMessages(next);
      setSelected(m => m && m.id === id ? { ...m, readByMe: isRead, status: m.archived ? 'archived' : isRead ? 'read' : 'unread' } : m);
      setServerUnread(res.unread);
      onUnreadChange?.(res.unread);
    } catch { /* silent */ }
  }

  async function archiveMsg(id) {
    try {
      await adminApi.messages.update(id, { archived: true });
      load(filter, search, sort, page);
      setSelected(m => m && m.id === id ? null : m);
      refreshUnread();
    } catch { /* silent */ }
  }

  async function doDelete() {
    if (!confirm) return;
    try {
      await adminApi.messages.delete(confirm.id);
      load(filter, search, sort, page);
      setSelected(m => m && m.id === confirm.id ? null : m);
      refreshUnread();
    } catch { /* silent */ }
    setConfirm(null);
  }

  async function doCompose() {
    if (!compose?.to?.trim() || !compose?.body?.trim()) { setComposeErr('Recipient email and message are required.'); return; }
    setComposeStatus('sending'); setComposeErr('');
    try {
      const res = await adminApi.messages.compose({ to: compose.to.trim(), subject: compose.subject || '', body: compose.body, toName: compose.toName || '' });
      if (res.sent) { setComposeStatus('sent'); setTimeout(() => { setCompose(null); setComposeStatus('idle'); }, 1100); load(filter, search, sort, 1); refreshUnread(); }
      else { setComposeStatus('error'); setComposeErr(res.emailConfigured ? 'Could not send — saved as a draft.' : 'Email is not configured on the server.'); }
    } catch (e) { setComposeStatus('error'); setComposeErr(e.message || 'Failed to send.'); }
  }

  // Authoritative per-staff count from the server (not the loaded page slice).
  const unreadCount = serverUnread;

  const filterDefs = [
    { id: 'all',      label: 'All' },
    { id: 'unread',   label: 'Unread', count: unreadCount },
    { id: 'read',     label: 'Read' },
    { id: 'archived', label: 'Archived' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>Contact Messages</h2>
        {unreadCount > 0 && <Badge text={`${unreadCount} unread`} color={C.ylw} />}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { setCompose({ to: '', subject: '', body: '', toName: '' }); setComposeStatus('idle'); setComposeErr(''); }}
            style={{ padding: '6px 13px', background: C.acc, color: C.accText, border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
            ✉ Compose
          </button>
          <span style={{ fontSize: 11, color: C.muted }}>Sort:</span>
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); load(filter, search, e.target.value, 1); }}
            style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      {compose && (
        <div onClick={() => composeStatus !== 'sending' && setCompose(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 20, width: 560, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: C.txt, margin: 0 }}>New email</h3>
              <span style={{ flex: 1 }} />
              <button onClick={() => setCompose(null)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            {!emailConfigured && <div style={{ fontSize: 11.5, color: C.ylw, marginBottom: 10 }}>Email is not configured on the server — this will be saved as a draft.</div>}
            {[['To (email)', 'to', 'person@example.com', 'email'], ['Recipient name (optional)', 'toName', 'Jane Doe', 'text'], ['Subject', 'subject', 'Subject', 'text']].map(([label, key, ph, type]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 3 }}>{label}</label>
                <input type={type} value={compose[key]} onChange={e => setCompose(c => ({ ...c, [key]: e.target.value }))} placeholder={ph} style={{ ...inputStyle, fontSize: 13 }} />
              </div>
            ))}
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 3 }}>Message</label>
              <textarea value={compose.body} onChange={e => setCompose(c => ({ ...c, body: e.target.value }))} rows={8} placeholder="Write your message…"
                style={{ ...inputStyle, fontSize: 13, resize: 'vertical', minHeight: 120 }} />
            </div>
            {composeErr && <div style={{ fontSize: 11.5, color: C.red, marginBottom: 8 }}>{composeErr}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 11, color: C.muted, marginRight: 'auto' }}>The recipient sees your name, not your email.</span>
              <button onClick={doCompose} disabled={composeStatus === 'sending'}
                style={{ padding: '8px 18px', background: composeStatus === 'sent' ? C.grn : C.acc, color: C.accText, border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: composeStatus === 'sending' ? 'default' : 'pointer', fontFamily: FONT, opacity: composeStatus === 'sending' ? 0.6 : 1 }}>
                {composeStatus === 'sending' ? 'Sending…' : composeStatus === 'sent' ? 'Sent ✓' : 'Send email'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', height: 620, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden' }}>
        {/* Left panel — list */}
        <div style={{ width: 340, flexShrink: 0, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 10px 6px' }}>
            <input type="text" placeholder="Search messages…" value={search} onChange={e => handleSearch(e.target.value)}
              style={{ ...inputStyle, fontSize: 12 }} />
          </div>
          <div style={{ padding: '0 10px 8px', display: 'flex', gap: 3 }}>
            {filterDefs.map(f => (
              <button key={f.id} onClick={() => { setFilter(f.id); setPage(1); load(f.id, search, sort, 1); }} style={{
                flex: 1, padding: '4px 2px', background: filter === f.id ? C.acc2 : 'transparent',
                border: `1px solid ${filter === f.id ? C.acc2 : C.brd2}`, borderRadius: 5,
                color: filter === f.id ? C.accText : C.txt2, fontSize: 10, cursor: 'pointer', fontFamily: FONT,
              }}>
                {f.label}{f.count > 0 ? ` (${f.count})` : ''}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div>
            ) : messages.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>No messages found.</div>
            ) : messages.map(msg => (
              <InboxItem key={msg.id} msg={msg} selected={selected?.id === msg.id} onClick={() => selectMsg(msg)} />
            ))}
          </div>
          <div style={{ padding: '4px 10px', borderTop: `1px solid ${C.brd}` }}>
            <Pagination page={page} total={total} perPage={PER_PAGE} onPage={p => { setPage(p); load(filter, search, sort, p); }} />
          </div>
        </div>

        {/* Right panel — detail */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {selected ? (
            <MessageDetail msg={selected} emailConfigured={emailConfigured} onMarkRead={markRead} onArchive={archiveMsg} onDelete={setConfirm} onReplied={markRepliedLocal} />
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ color: C.brd2, display: 'inline-flex' }}><Icon name="mail" size={28} /></span>
              <span style={{ fontSize: 13, color: C.muted }}>Select a message to read it</span>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal open={!!confirm} title="Delete Message"
        message={`Permanently delete message from ${confirm?.name}? This cannot be undone.`}
        confirmLabel="Delete" danger onConfirm={doDelete} onCancel={() => setConfirm(null)} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: USERS (redesigned — table + detail side panel with projects)
   ════════════════════════════════════════════════════════════════════════ */

function UserProjectItem({ project }) {
  return (
    <div style={{ margin: '0 12px 8px', padding: '10px 12px', background: C.surf, borderRadius: 7, border: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span title={project.name} style={{ fontSize: 12, fontWeight: 600, color: C.txt, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{project.name}</span>
        {project.status === 'archived' && <Badge text="archived" color={C.ylw} />}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: C.muted, fontFamily: MONO, marginBottom: 3 }}>
        <span>{project.studyCount} studies</span>
        <span>{project.recordCount} records</span>
        {project.metaRuns > 0 && <span>{project.metaRuns} meta-runs</span>}
      </div>
      <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>Updated {fmtAgo(project.updatedAt)}</div>
    </div>
  );
}

// Institutional role colors (prompt12 Task 2): admin subtle-red, mod subtle-green, user muted.
const ROLE_COLORS = { admin: C.red, mod: C.grn, user: C.muted };
function RoleBadge({ role }) {
  return <Badge text={role || 'user'} color={ROLE_COLORS[role] || C.muted} />;
}

function UserDetailPanel({ user, isAdmin, onClose, onStatusChange, onUserUpdate }) {
  const [current,     setCurrent]     = useState(user);
  const [projects,    setProjects]    = useState([]);
  const [projLoading, setProjLoading] = useState(true);
  const [confirm,     setConfirm]     = useState(null);

  // Schema-driven profile edit (prompt20 Task 5). The set of editable fields and
  // their validation come from the shared editableUserFields schema, filtered to
  // what THIS viewer (admin vs mod) may change; high-impact fields (role, status)
  // keep their own dedicated controls below and are excluded here.
  const viewerRole = isAdmin ? 'admin' : 'mod';
  const formFields = editableFieldsForRole(viewerRole).filter(f => !f.dedicatedControl);
  const seedForm = (u) => {
    const f = {};
    for (const fld of formFields) { const v = u ? u[fld.key] : undefined; f[fld.key] = v == null ? '' : v; }
    return f;
  };
  const [editing,    setEditing]    = useState(false);
  const [form,       setForm]       = useState(() => seedForm(user));
  const [editStatus, setEditStatus] = useState('idle');
  const [editError,  setEditError]  = useState('');

  // Role change
  const [roleConfirm, setRoleConfirm] = useState(null); // pending new role
  const [roleError,   setRoleError]   = useState('');

  // Reset password (legacy temp-password fallback)
  const [tempPw,      setTempPw]      = useState('');
  const [pwStatus,    setPwStatus]    = useState('idle');
  const [pwError,     setPwError]     = useState('');
  // Token-based reset email (prompt14, preferred)
  const [resetEmail,  setResetEmail]  = useState(null); // { sent, emailConfigured, link?, expiresAt }
  const [resetStatus, setResetStatus] = useState('idle');
  const [resetError,  setResetError]  = useState('');

  // prompt25 — real-time activity snapshot for this user (admin only).
  // { id, name, email, lastActive, onlineNow, currentProjectId,
  //   currentProjectTitle, currentLocation }
  const [activity,    setActivity]    = useState(null);

  useEffect(() => {
    setCurrent(user);
    setEditing(false); setForm(seedForm(user));
    setEditError(''); setRoleError(''); setTempPw(''); setPwError('');
    setResetEmail(null); setResetStatus('idle'); setResetError('');
    setActivity(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    setProjLoading(true);
    adminApi.users.getProjects(user.id)
      .then(d => setProjects(d.projects || []))
      .catch(() => setProjects([]))
      .finally(() => setProjLoading(false));
  }, [user.id]);

  // The list row carries only the summary columns; fetch the full record so the
  // edit form + read-only display include the admin-editable profile fields
  // (theme, registration country) and the latest server-side values.
  useEffect(() => {
    let alive = true;
    adminApi.users.get(user.id)
      .then(full => { if (alive && full && full.id) { setCurrent(c => ({ ...c, ...full })); setForm(seedForm(full)); } })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  // prompt25 — fetch real-time activity snapshot on panel open (admin only).
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    adminApi.users.activity(user.id)
      .then(d => { if (alive) setActivity(d); })
      .catch(() => { if (alive) setActivity(null); });
    return () => { alive = false; };
  }, [user.id, isAdmin]);

  async function doStatus() {
    if (!confirm) return;
    try {
      await adminApi.users.updateStatus(current.id, { suspended: confirm === 'suspend' });
      onStatusChange();
      onClose();
    } catch { /* silent */ }
    setConfirm(null);
  }

  async function saveEdit() {
    setEditError('');
    // Validate every field with the SAME schema the server enforces, then send
    // only the fields that actually changed (keeps the audit trail meaningful).
    const body = {};
    for (const fld of formFields) {
      const res = fld.validate(form[fld.key]);
      if (!res.ok) { setEditStatus('error'); setEditError(`${fld.label}: ${res.error}`); return; }
      const curVal  = current[fld.key] == null ? null : current[fld.key];
      const nextVal = res.value == null ? null : res.value;
      if (nextVal !== curVal) body[fld.key] = res.value;
    }
    if (Object.keys(body).length === 0) { setEditing(false); setEditStatus('idle'); return; }
    setEditStatus('saving');
    try {
      const { user: updated } = await adminApi.users.update(current.id, body);
      setCurrent(c => ({ ...c, ...updated }));
      setForm(seedForm(updated));
      setEditStatus('saved'); setEditing(false);
      onUserUpdate?.();
      setTimeout(() => setEditStatus('idle'), 2000);
    } catch (e) { setEditStatus('error'); setEditError(e.message); }
  }

  async function doRoleChange() {
    if (!roleConfirm) return;
    setRoleError('');
    try {
      const { user: updated } = await adminApi.users.updateRole(current.id, roleConfirm);
      setCurrent(c => ({ ...c, role: updated.role }));
      onUserUpdate?.();
    } catch (e) { setRoleError(e.message); }
    setRoleConfirm(null);
  }

  async function doResetPassword() {
    setPwStatus('saving'); setPwError(''); setTempPw('');
    try {
      const { tempPassword } = await adminApi.users.resetPassword(current.id);
      setTempPw(tempPassword); setPwStatus('idle');
    } catch (e) { setPwStatus('error'); setPwError(e.message); }
  }

  // Token-based reset (prompt14): emails the user a self-service link; when email
  // is unconfigured or the send fails, the response carries a copyable link for
  // the operator to relay. No plaintext password is ever handled.
  async function doSendResetEmail() {
    setResetStatus('saving'); setResetError(''); setResetEmail(null);
    try {
      const r = await adminApi.users.sendPasswordReset(current.id);
      setResetEmail(r); setResetStatus('idle');
    } catch (e) { setResetStatus('error'); setResetError(e.message); }
  }

  const u = current;

  // Task-1 (prompt7): mods must not be offered mutating controls on privileged
  // targets. When the viewer is a mod (isAdmin === false) and the target row is
  // an admin or another mod, Edit / Reset Password / Suspend are hidden entirely
  // and a lock note is shown instead. The server 403s these calls regardless —
  // this only mirrors that contract in the UI. Admins see everything unchanged.
  const lockedForMod = !isAdmin && (u.role === 'admin' || u.role === 'mod');

  return (
    <div style={{ width: 300, flexShrink: 0, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', position: 'sticky', top: TOPBAR_H + 28, maxHeight: `calc(100vh - ${TOPBAR_H + 60}px)`, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>User Detail</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>

      {/* Profile */}
      <div style={{ padding: '16px 16px 12px' }}>
        {editing ? (
          <div style={{ marginBottom: 12 }}>
            {editError && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{editError}</div>}
            {/* Fields + validation come from the shared schema; mods see fewer. */}
            {formFields.map(fld => (
              <div key={fld.key} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>{fld.label}</label>
                {fld.type === 'select' ? (
                  <select value={form[fld.key] ?? ''} onChange={e => setForm(f => ({ ...f, [fld.key]: e.target.value }))} style={{ ...inputStyle, fontSize: 12 }}>
                    {fld.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    type={fld.type === 'email' ? 'email' : 'text'}
                    value={form[fld.key] ?? ''}
                    onChange={e => setForm(f => ({ ...f, [fld.key]: fld.uppercase ? e.target.value.toUpperCase() : e.target.value }))}
                    maxLength={fld.maxLength}
                    placeholder={fld.placeholder || ''}
                    style={{ ...inputStyle, fontSize: 12 }} />
                )}
                {fld.help && <div style={{ fontSize: 10, color: C.muted, marginTop: 3, lineHeight: 1.4 }}>{fld.help}</div>}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <SaveButton onClick={saveEdit} status={editStatus} label="Save" />
              <button onClick={() => { setEditing(false); setForm(seedForm(current)); setEditError(''); setEditStatus('idle'); }} style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
              <div title={u.name || undefined} style={{ fontSize: 15, fontWeight: 700, color: C.txt, minWidth: 0, overflowWrap: 'anywhere' }}>{u.name || '—'}</div>
              {!lockedForMod && (
                <button onClick={() => { setForm(seedForm(current)); setEditError(''); setEditStatus('idle'); setEditing(true); }} style={{ background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 11, padding: '3px 9px', cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>Edit</button>
              )}
            </div>
            <div title={u.email} style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginBottom: 10, minWidth: 0, overflowWrap: 'anywhere' }}>{u.email}</div>
            {editStatus === 'saved' && <div style={{ fontSize: 11, color: C.grn, marginBottom: 8 }}>✓ Changes saved</div>}
          </>
        )}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
          <RoleBadge role={u.role} />
          {u.suspended ? <Badge text="suspended" color={C.red} /> : <Badge text="active" color={C.grn} />}
        </div>
        {[
          { label: 'Joined',      value: fmtDate(u.createdAt) },
          { label: 'Last Active', value: u.lastActive ? fmtAgo(u.lastActive) : '—' },
          { label: 'Projects',    value: u.projectCount ?? 0 },
          { label: 'Theme',       value: u.themePreference || '—' },
          { label: 'Country',     value: u.registrationCountryCode
              // Name derived from the ISO code (matches the map) — never the stale stored name.
              ? `${countryNameForCode(u.registrationCountryCode) || u.registrationCountryName || ''} (${u.registrationCountryCode})`.trim()
              : (u.registrationCountryName || '—') },
        ].map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.brd}` }}>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.label}</span>
            <span style={{ fontSize: 11, color: C.txt2, fontFamily: MONO }}>{r.value}</span>
          </div>
        ))}

        {/* prompt25 — online/offline status row + current location (admin only) */}
        {isAdmin && activity != null && (
          <div style={{ marginTop: 8, padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: activity.onlineNow ? 5 : 0 }}>
              <LivePulseDot live={activity.onlineNow} />
              {activity.onlineNow ? (
                <span style={{ fontSize: 11, color: C.grn, fontFamily: MONO, fontWeight: 700 }}>Online now</span>
              ) : (
                <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
                  Offline{activity.lastActive ? ` · ${fmtAgo(activity.lastActive)}` : ''}
                </span>
              )}
            </div>
            {activity.onlineNow && activity.currentProjectTitle && (
              <div style={{ fontSize: 10, color: C.txt2, fontFamily: MONO, lineHeight: 1.6, paddingLeft: 14 }}>
                <div>Project: {activity.currentProjectTitle}</div>
                {activity.currentLocation && <div>Location: {activity.currentLocation}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Role (admin only) */}
      {isAdmin && (
        <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${C.brd}` }}>
          <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>Role</div>
          {roleError && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{roleError}</div>}
          <select value={u.role || 'user'} onChange={e => { if (e.target.value !== u.role) setRoleConfirm(e.target.value); }}
            style={{ ...inputStyle, fontSize: 12, padding: '8px 10px' }}>
            <option value="user">user</option>
            <option value="mod">mod</option>
            <option value="admin">admin</option>
          </select>
        </div>
      )}

      {/* Projects */}
      <div style={{ borderTop: `1px solid ${C.brd}` }}>
        <div style={{ padding: '10px 16px 6px', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Projects ({projects.length})
        </div>
        {projLoading ? (
          <div style={{ padding: 16, textAlign: 'center' }}><Spinner /></div>
        ) : projects.length === 0 ? (
          <div style={{ padding: '10px 16px', color: C.muted, fontSize: 12 }}>No projects.</div>
        ) : (
          <div style={{ paddingBottom: 8 }}>
            {projects.map(p => <UserProjectItem key={p.id} project={p} />)}
          </div>
        )}
      </div>

      {/* Password reset — hidden from mods for admin/mod targets (Task-1).
          Preferred: token-based reset email (operator never handles a secret).
          Fallback: legacy temporary password. (prompt14 Task 4) */}
      {!lockedForMod && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}` }}>
          <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Password</div>

          {/* ── Preferred: send a self-service reset link ── */}
          {resetError && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{resetError}</div>}
          {resetEmail?.sent && (
            <div style={{ fontSize: 11, color: C.grn, marginBottom: 8, lineHeight: 1.5 }}>
              ✓ Reset link emailed to the user. It is single-use and expires for security.
            </div>
          )}
          {resetEmail && !resetEmail.sent && resetEmail.link && (
            <div style={{ marginBottom: 8 }}>
              <CopyableBox
                value={resetEmail.link}
                label={resetEmail.emailConfigured ? 'Reset link (email send failed)' : 'Reset link (email not configured)'}
              />
              <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                Dev/fallback only — share over a trusted channel. The link is single-use; the user sets their own password.
              </div>
            </div>
          )}
          <button onClick={doSendResetEmail} disabled={resetStatus === 'saving'}
            style={{ width: '100%', padding: '8px', background: alpha(C.acc, '15'), border: `1px solid ${alpha(C.acc, '30')}`, borderRadius: 6, color: C.acc, fontSize: 12, cursor: resetStatus === 'saving' ? 'not-allowed' : 'pointer', fontFamily: FONT, marginBottom: 10 }}>
            {resetStatus === 'saving' ? 'Sending…' : 'Send password reset email'}
          </button>

          {/* ── Fallback: legacy temporary password ── */}
          {pwError && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{pwError}</div>}
          {tempPw ? (
            <div>
              <CopyableBox value={tempPw} label="Temporary password (shown once)" />
              <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                Share this securely with the user. It is not stored and cannot be retrieved again.
              </div>
            </div>
          ) : (
            <button onClick={doResetPassword} disabled={pwStatus === 'saving'} style={{ width: '100%', padding: '7px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.muted, fontSize: 11, cursor: pwStatus === 'saving' ? 'not-allowed' : 'pointer', fontFamily: FONT }}>
              {pwStatus === 'saving' ? 'Generating…' : 'Generate temporary password (legacy)'}
            </button>
          )}
        </div>
      )}

      {/* Status actions — admins can never be suspended; mods additionally
          cannot suspend other mods (Task-1, lockedForMod) */}
      {!lockedForMod && u.role !== 'admin' && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}` }}>
          {u.suspended ? (
            <button onClick={() => setConfirm('reactivate')} style={{ width: '100%', padding: '8px', background: alpha(C.grn, '15'), border: `1px solid ${alpha(C.grn, '30')}`, borderRadius: 6, color: C.grn, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
              Reactivate Account
            </button>
          ) : (
            <button onClick={() => setConfirm('suspend')} style={{ width: '100%', padding: '8px', background: alpha(C.red, '10'), border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 6, color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
              Suspend Account
            </button>
          )}
        </div>
      )}

      {/* Task-1 lock note — shown to mods in place of the management controls
          when the target is an admin or another mod */}
      {lockedForMod && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 11 }}>
          <Icon name="lock" size={12} />
          <span>Managed by administrators</span>
        </div>
      )}

      <ConfirmModal open={!!confirm}
        title={confirm === 'suspend' ? 'Suspend User' : 'Reactivate User'}
        message={confirm === 'suspend' ? `Suspend ${u.email}? They will not be able to log in.` : `Reactivate ${u.email}? They will regain full access.`}
        confirmLabel={confirm === 'suspend' ? 'Suspend' : 'Reactivate'}
        danger={confirm === 'suspend'} onConfirm={doStatus} onCancel={() => setConfirm(null)} />

      <ConfirmModal open={!!roleConfirm}
        title="Change User Role"
        message={`Change ${u.email}'s role from "${u.role}" to "${roleConfirm}"? This affects their access immediately.`}
        confirmLabel="Change Role"
        danger={roleConfirm === 'admin'} onConfirm={doRoleChange} onCancel={() => setRoleConfirm(null)} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   USERS BY COUNTRY (prompt19 Task 12 · rebuilt prompt20 Task 6) — a REAL
   interactive world-country choropleth + ranked table, in Map / Countries Table
   sub-tabs. Country-LEVEL only. Geometry is real Natural Earth 110m polygons
   (pre-projected equirectangular paths in worldGeo.js — no map library, no heavy
   runtime deps). Country borders are light gray; fills scale with each country's
   user share toward the app accent (C.acc) via the alpha() color-mix helper, so
   the map re-themes automatically and works in BOTH day and night.
   ════════════════════════════════════════════════════════════════════════ */

function UsersByCountryCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);   // selected countryCode (table↔map link)
  const [view, setView] = useState('map');           // 'map' | 'table'
  const [hover, setHover] = useState(null);          // { code, name, count, pct }
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const mapWrapRef = useRef(null);
  const mapWidthRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const d = await adminApi.users.countries();
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const countries = data?.countries || [];
  const summary = data?.summary || { totalUsers: 0, totalKnown: 0, unknown: 0, countriesRepresented: 0 };

  // Join the endpoint data to the map by ISO-3166 alpha-2 (the canonical key —
  // both sides are uppercased, so codes never silently mismatch). The Unknown
  // bucket (countryCode '') is excluded from the map + the colour ceiling so one
  // large Unknown bucket can't wash out the real geographic signal.
  const byCode = {};
  for (const c of countries) if (c.countryCode) byCode[c.countryCode] = c;
  const maxCount = countries.reduce((m, c) => (c.countryCode ? Math.max(m, c.userCount) : m), 0) || 1;

  // Accent-driven choropleth scale. No users → light neutral (near-white in day,
  // faint in night); more users → closer to the app accent. color-mix via alpha()
  // keeps it live under theme/accent changes.
  const NEUTRAL_FILL = alpha(C.muted, 0.12);
  const BORDER = alpha(C.muted, 0.5);                 // light gray country borders
  const fillFor = (code) => {
    const d = code ? byCode[code] : null;
    if (!d || !d.userCount) return NEUTRAL_FILL;
    const t = Math.min(1, d.userCount / maxCount);
    return alpha(C.acc, 0.18 + Math.sqrt(t) * 0.72);
  };

  const onMapMove = (e) => {
    const r = mapWrapRef.current?.getBoundingClientRect();
    if (r) { mapWidthRef.current = r.width; setMouse({ x: e.clientX - r.left, y: e.clientY - r.top }); }
  };

  const ViewTab = ({ id, label }) => {
    const on = view === id;
    return (
      <button onClick={() => setView(id)} style={{
        padding: '6px 14px', fontSize: 12, fontFamily: FONT, fontWeight: on ? 700 : 500,
        cursor: 'pointer', background: on ? alpha(C.acc, '16') : 'transparent',
        color: on ? C.acc : C.txt2, border: `1px solid ${on ? alpha(C.acc, '45') : C.brd2}`,
        borderRadius: 8,
      }}>{label}</button>
    );
  };

  // ── Map view: real country choropleth, fills the whole container ──────────
  const mapView = (
    <div>
      <div ref={mapWrapRef} onMouseMove={onMapMove} onMouseLeave={() => setHover(null)}
        style={{ position: 'relative', width: '100%' }}>
        <svg viewBox={`0 0 ${WORLD_VIEWBOX.w} ${WORLD_VIEWBOX.h}`} width="100%" role="img"
          aria-label="World map of users by country"
          style={{ display: 'block', width: '100%', height: 'auto', background: alpha(C.brd, 0.12), border: `1px solid ${C.brd}`, borderRadius: 10 }}>
          {WORLD_COUNTRIES.map((f, i) => {
            const d = f.a2 ? byCode[f.a2] : null;
            return (
              <path key={f.a2 || `g${i}`} d={f.d}
                fill={fillFor(f.a2)} stroke={BORDER} strokeWidth={0.6} strokeLinejoin="round"
                style={{ cursor: d ? 'pointer' : 'default', transition: 'fill 0.15s' }}
                onClick={() => d && setSelected(prev => prev === f.a2 ? null : f.a2)}
                onMouseEnter={() => setHover({ code: f.a2, name: (d?.countryName) || f.name, count: d?.userCount || 0, pct: d?.percentage || 0, online: d?.onlineCount ?? 0, offline: d?.offlineCount ?? 0 })}>
                <title>{d ? `${d.countryName}: ${d.userCount} users (${d.percentage}%)` : `${f.name}: 0 users`}</title>
              </path>
            );
          })}
          {/* selected country re-drawn on top so its highlight is never occluded */}
          {selected && WORLD_COUNTRIES.filter(f => f.a2 === selected).map((f, i) => (
            <path key={`sel${i}`} d={f.d} fill={fillFor(f.a2)} stroke={C.acc} strokeWidth={1.4} strokeLinejoin="round" pointerEvents="none" />
          ))}
        </svg>

        {/* HTML hover tooltip — country name, users, percentage */}
        {hover && (
          <div style={{
            position: 'absolute', pointerEvents: 'none', zIndex: 5,
            left: Math.min(mouse.x + 14, Math.max(0, (mapWidthRef.current || 9999) - 168)),
            top: Math.max(0, mouse.y + 14),
            background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8,
            padding: '7px 10px', boxShadow: `0 6px 20px ${C.shadow}`, maxWidth: 168,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hover.name}</div>
            {/* prompt25 — online/offline breakdown in map tooltip */}
            {(hover.online > 0 || hover.offline > 0) && (
              <div style={{ fontSize: 10, fontFamily: MONO, marginTop: 2 }}>
                <span style={{ color: C.grn }}>{hover.online} online</span>
                <span style={{ color: C.muted }}> · {hover.offline} offline</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginTop: 2 }}>{hover.count} total · {hover.pct}%</div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
        Country fill scales with each country's share of users toward the app accent colour.
        Users without a resolved country (local or unknown) appear in the Countries Table, not on the map.
        {summary.totalKnown === 0 && <span style={{ color: C.txt2 }}> {' '}No country-resolved users yet — the map is shown in its neutral state.</span>}
      </div>
    </div>
  );

  // ── Table view: ranked countries (rank, country, users, %, latest reg) ────
  const tableView = countries.length === 0 ? (
    <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 12 }}>No users yet.</div>
  ) : (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden' }}>
      {/* prompt25 — Online/Offline columns added alongside existing Rank/Country/Users/%/Latest */}
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 56px 52px 52px 56px 1fr', gap: 0, padding: '8px 12px', borderBottom: `1px solid ${C.brd}`, fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', background: alpha(C.brd, 0.18) }}>
        <span>#</span><span>Country</span><span style={{ textAlign: 'right' }}>Users</span><span style={{ textAlign: 'right' }}>%</span><span style={{ textAlign: 'right', color: C.grn }}>Online</span><span style={{ textAlign: 'right' }}>Offline</span><span style={{ textAlign: 'right' }}>Latest</span>
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {countries.map((c, i) => {
          const known = !!c.countryCode;
          const isSel = known && selected === c.countryCode;
          const barPct = summary.totalUsers > 0 ? (c.userCount / summary.totalUsers) * 100 : 0;
          return (
            <div key={c.countryCode || `unknown-${i}`}
              onClick={() => known && setSelected(prev => prev === c.countryCode ? null : c.countryCode)}
              style={{
                position: 'relative', display: 'grid', gridTemplateColumns: '32px 1fr 56px 52px 52px 56px 1fr',
                alignItems: 'center', padding: '7px 12px',
                borderBottom: i < countries.length - 1 ? `1px solid ${C.brd}` : 'none',
                background: isSel ? alpha(C.acc, '12') : 'transparent',
                borderLeft: isSel ? `3px solid ${C.acc}` : '3px solid transparent',
                cursor: known ? 'pointer' : 'default',
              }}>
              <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${barPct}%`, background: alpha(known ? C.acc : C.muted, 0.1), pointerEvents: 'none' }} />
              <span style={{ position: 'relative', fontSize: 11, fontFamily: MONO, color: C.muted }}>{i + 1}</span>
              <span style={{ position: 'relative', fontSize: 12, color: C.txt, fontWeight: known ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {known && <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginRight: 6 }}>{c.countryCode}</span>}
                {c.countryName}
              </span>
              <span style={{ position: 'relative', textAlign: 'right', fontSize: 12, fontFamily: MONO, color: C.txt }}>{c.userCount}</span>
              <span style={{ position: 'relative', textAlign: 'right', fontSize: 11, fontFamily: MONO, color: C.muted }}>{c.percentage}%</span>
              {/* prompt25 — online/offline counts per country */}
              <span style={{ position: 'relative', textAlign: 'right', fontSize: 11, fontFamily: MONO, color: (c.onlineCount ?? 0) > 0 ? C.grn : C.muted }}>{c.onlineCount ?? 0}</span>
              <span style={{ position: 'relative', textAlign: 'right', fontSize: 11, fontFamily: MONO, color: C.muted }}>{c.offlineCount ?? 0}</span>
              <span style={{ position: 'relative', textAlign: 'right', fontSize: 10, fontFamily: MONO, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.latestRegistrationAt ? fmtDate(c.latestRegistrationAt) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <SectionCard title="Users by Country">
      <div style={{ padding: '16px 18px' }}>
        {error && <ErrorBox msg={error} />}

        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Chip label="Total users" value={loading ? '—' : summary.totalUsers} />
          <Chip label="Known country" value={loading ? '—' : summary.totalKnown} color={C.grn} />
          <Chip label="Unknown / local" value={loading ? '—' : summary.unknown} color={C.muted} />
          <Chip label="Countries" value={loading ? '—' : summary.countriesRepresented} color={C.teal} />
        </div>

        {/* Map / Table sub-tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <ViewTab id="map" label="Map" />
          <ViewTab id="table" label="Countries Table" />
        </div>

        {loading
          ? <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 12 }}>Loading distribution…</div>
          : (view === 'map' ? mapView : tableView)}
      </div>
    </SectionCard>
  );
}

/* prompt26 — Users area sub-tabs: Directory (table + filters), Analytics
   (getUserAnalytics charts), Institutions (canonical institution management).
   Keeps the area uncluttered — only one view is mounted at a time. */
function UsersSubTabs({ active, onSelect, tabs }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.brd}`, flexWrap: 'wrap' }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onSelect(t.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px',
            background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? C.acc : 'transparent'}`,
            color: on ? C.acc : C.txt2, fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer',
            fontFamily: FONT, marginBottom: -1, transition: 'color 0.15s',
          }}
            onMouseEnter={e => { if (!on) e.currentTarget.style.color = C.txt; }}
            onMouseLeave={e => { if (!on) e.currentTarget.style.color = C.txt2; }}
          >
            {t.icon && <Icon name={t.icon} size={14} />}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function UsersSection({ isAdmin = false }) {
  // Sub-view: Directory (default) · Analytics (admin) · Institutions (admin).
  const [view, setView] = useState('directory');

  const subTabs = [
    { id: 'directory', icon: 'users', label: 'Directory' },
    ...(isAdmin ? [
      { id: 'growth',       icon: 'barChart', label: 'Growth' },
      { id: 'analytics',    icon: 'activity', label: 'Analytics' },
      { id: 'institutions', icon: 'globe',    label: 'Institutions' },
    ] : []),
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 16px' }}>Users</h2>
      <UsersSubTabs active={view} onSelect={setView} tabs={subTabs} />
      {/* prompt36 — an error boundary per sub-view so a render crash shows a
          message instead of white-screening the whole Ops Console. Keyed by view
          so switching tabs clears a prior error. */}
      <OpsErrorBoundary key={view} label={`the ${view} view`}>
        {view === 'directory'    && <UsersDirectory isAdmin={isAdmin} />}
        {view === 'growth'       && isAdmin && <NewUserGrowthSection />}
        {view === 'analytics'    && isAdmin && <UserAnalyticsSection />}
        {view === 'institutions' && isAdmin && <InstitutionsManager />}
      </OpsErrorBoundary>
    </div>
  );
}

/* Profile-field filter options (mirror the onboarding/editable schema). The
   leading "" entry is the "any" option in each select. */
const USER_FILTER_OPTS = {
  primaryRole:   PRIMARY_ROLE_OPTIONS,
  researchField: RESEARCH_FIELD_OPTIONS,
  mainUseCase:   MAIN_USE_CASE_OPTIONS,
};

function UsersDirectory({ isAdmin = false }) {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [selectedUser, setSelectedUser] = useState(null);
  // prompt25 — global online/offline summary from the dedicated endpoint
  // (gives the total across ALL pages, not just the current page).
  const [actSummary, setActSummary] = useState(null);
  // prompt26 — advanced CLIENT-SIDE filters over the already-loaded page.
  // Profile fields (role/field/use-case/country/verified/onboarding) are not in
  // the list payload, so each page's rows are lazily enriched once via
  // adminApi.users.get(id) and the result is cached + filtered in the browser.
  const [adv, setAdv] = useState({ primaryRole: '', researchField: '', mainUseCase: '', country: '', verified: '', onboarded: '' });
  const [advOpen, setAdvOpen] = useState(false);
  const [profiles, setProfiles] = useState({});   // userId -> { primaryRole, researchField, ... } | 'loading'
  // prompt27 — SERVER-SIDE quick filters: registration window + status toggles +
  // sort. Applied across the whole dataset (not just the loaded page) and
  // pagination-safe. The latest values live in a ref so load() — called right
  // after a setState in a handler — never reads a stale value.
  const [regWindow, setRegWindow] = useState('any');
  const [quick, setQuick] = useState({ unverified: false, onboardingIncomplete: false, noInstitution: false });
  const [sort, setSort] = useState('newest');
  const filtersRef = useRef({ regWindow, quick, sort });
  filtersRef.current = { regWindow, quick, sort };
  const searchTimer = useRef(null);
  const PER_PAGE = 25;

  const load = useCallback(async (s, f, p) => {
    setLoading(true); setError('');
    try {
      const { regWindow: rw, quick: q, sort: so } = filtersRef.current;
      const params = { page: p, limit: PER_PAGE };
      if (s) params.search = s;
      if (f === 'suspended') params.suspended = true;
      if (f === 'active')    params.suspended = false;
      if (f === 'admins')    params.role = 'admin';
      if (f === 'mods')      params.role = 'mod';
      if (rw && rw !== 'any') params.createdWithin = rw;
      if (q.unverified) params.verified = 'false';
      if (q.onboardingIncomplete) params.onboarded = 'false';
      if (q.noInstitution) params.noInstitution = 'true';
      if (so === 'oldest') params.sort = 'oldest';
      const data = await adminApi.users.list(params);
      setRows((data.users || []).map(u => ({ ...u, status: u.suspended ? 'suspended' : 'active' })));
      setTotal(data.total || 0);
    } catch (e) { setRows([]); setError(e.message); }
    finally { setLoading(false); }
  }, []);

  // Apply a server-side quick-filter change and reload from page 1. Mirrors the
  // value into filtersRef synchronously so load() reads it immediately. Fetches
  // exactly once: when already on page 1 we load directly; otherwise resetting
  // the page fires the [page] effect (which reads the updated ref).
  function applyServerFilter(next) {
    filtersRef.current = { ...filtersRef.current, ...next };
    if (page === 1) load(search, filter, 1);
    else setPage(1);
  }
  function pickRegWindow(v) { setRegWindow(v); applyServerFilter({ regWindow: v }); }
  function toggleQuick(k)   { const q = { ...quick, [k]: !quick[k] }; setQuick(q); applyServerFilter({ quick: q }); }
  function pickSort(v)      { setSort(v); applyServerFilter({ sort: v }); }

  // prompt25 — fetch global online/offline summary on mount (admin only).
  // Refreshes alongside the user list on page/filter changes.
  useEffect(() => {
    if (!isAdmin) return;
    adminApi.users.activitySummary()
      .then(d => setActSummary(d))
      .catch(() => setActSummary(null));
  }, [isAdmin, page, filter]);

  useEffect(() => { load(search, filter, page); }, [page, filter]);

  // Lazily enrich the current page's rows with profile fields ONCE a profile
  // filter is active (admin only — those fields are admin-readable). Cached by id.
  const advActive = isAdmin && Object.values(adv).some(Boolean);
  useEffect(() => {
    if (!advActive || rows.length === 0) return;
    const missing = rows.filter(r => profiles[r.id] === undefined);
    if (missing.length === 0) return;
    setProfiles(prev => { const n = { ...prev }; for (const r of missing) n[r.id] = 'loading'; return n; });
    let alive = true;
    (async () => {
      const results = await Promise.allSettled(missing.map(r => adminApi.users.get(r.id)));
      if (!alive) return;
      setProfiles(prev => {
        const n = { ...prev };
        missing.forEach((r, i) => {
          const res = results[i];
          n[r.id] = res.status === 'fulfilled' && res.value ? res.value : null;
        });
        return n;
      });
    })();
    return () => { alive = false; };
  }, [advActive, rows, profiles]);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(val, filter, 1); }, 280);
  }

  // CLIENT-SIDE filter of the loaded page (does NOT change the server fetch).
  const matchesAdv = (row) => {
    if (!advActive) return true;
    const prof = profiles[row.id];
    if (prof === 'loading' || prof === undefined) return true;   // not yet known — keep visible
    if (prof === null) return false;                              // enrich failed — hide under active profile filter
    if (adv.primaryRole   && prof.primaryRole   !== adv.primaryRole)   return false;
    if (adv.researchField && prof.researchField !== adv.researchField) return false;
    if (adv.mainUseCase   && prof.mainUseCase   !== adv.mainUseCase)   return false;
    if (adv.country) {
      const c = (prof.country || prof.registrationCountryName || '').toLowerCase();
      if (!c.includes(adv.country.toLowerCase())) return false;
    }
    if (adv.verified === 'yes' && !prof.emailVerifiedAt) return false;
    if (adv.verified === 'no'  &&  prof.emailVerifiedAt) return false;
    if (adv.onboarded === 'yes' && !prof.onboardingCompletedAt) return false;
    if (adv.onboarded === 'no'  &&  prof.onboardingCompletedAt) return false;
    return true;
  };
  const visibleRows = rows.filter(matchesAdv);
  const advFilteredOut = rows.length - visibleRows.length;
  const clearAdv = () => setAdv({ primaryRole: '', researchField: '', mainUseCase: '', country: '', verified: '', onboarded: '' });

  const dash = <span style={{ color: C.muted }}>—</span>;
  const columns = [
    { key: 'name',         label: 'Name',         render: (v, row) => <span title={v || undefined} style={{ color: C.txt, fontWeight: 600, display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || dash}</span> },
    { key: 'email',        label: 'Email',         render: v => <span title={v} style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{v}</span> },
    { key: 'role',         label: 'Role',          render: v => <RoleBadge role={v} /> },
    // prompt27 — non-secret profile columns from the list payload (no per-row fetch).
    { key: 'institution',  label: 'Institution',   render: v => v ? <span title={v} style={{ display: 'block', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> : dash },
    { key: 'researchField',label: 'Field',         render: v => v ? <span title={v} style={{ display: 'block', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> : dash },
    { key: 'country',      label: 'Country',       render: v => v ? <span title={v} style={{ display: 'block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> : dash },
    { key: 'status',       label: 'Status',        render: v => v === 'active' ? <Badge text="active" color={C.grn} /> : <Badge text="suspended" color={C.red} /> },
    { key: 'createdAt',    label: 'Joined',        render: v => fmtDate(v) },
    // Readable relative time ("3h ago"); em-dash when null (prompt6 Task 10).
    { key: 'lastActive',   label: 'Last Active',   render: v => v ? fmtAgo(v) : dash },
    // prompt27 — email verification badge (no token/hash ever in the payload).
    { key: 'emailVerified',label: 'Verified',      render: v => v ? <Badge text="verified" color={C.grn} /> : <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>—</span> },
    // prompt25 — live presence status (green pulsing dot = online, muted = offline).
    // Uses .ops-pulse keyframes now defined in the root AdminConsole <style>.
    { key: 'isOnline', label: 'Presence', render: v => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
        <LivePulseDot live={!!v} />
        <span style={{ fontSize: 11, fontFamily: MONO, color: v ? C.grn : C.muted }}>{v ? 'Online' : 'Offline'}</span>
      </span>
    ) },
  ];

  // Task-1 lock note, row-level mirror of the UserDetailPanel one: mods see at
  // a glance which rows are admin-managed (the server 403s those calls anyway).
  if (!isAdmin) {
    columns.push({
      key: 'managed', label: '',
      render: (_v, row) => (row.role === 'admin' || row.role === 'mod') ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: C.muted, fontSize: 10, whiteSpace: 'nowrap' }}>
          <Icon name="lock" size={12} />
          <span>Managed by administrators</span>
        </span>
      ) : null,
    });
  }

  const filterDefs = [
    { id: 'all',       label: 'All' },
    { id: 'active',    label: 'Active' },
    { id: 'suspended', label: 'Suspended' },
    { id: 'mods',      label: 'Mods' },
    { id: 'admins',    label: 'Admins' },
  ];

  // Count of active advanced filters (for the "Filters" toggle badge).
  const advCount = Object.values(adv).filter(Boolean).length;
  const enriching = advActive && rows.some(r => profiles[r.id] === 'loading' || profiles[r.id] === undefined);

  const advSelect = (key, label, opts, withYesNo) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <select value={adv[key]} onChange={e => setAdv(a => ({ ...a, [key]: e.target.value }))}
        style={{ ...inputStyle, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}>
        <option value="">Any</option>
        {withYesNo
          ? (<><option value="yes">Yes</option><option value="no">No</option></>)
          : opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      {/* prompt25 — global online/offline summary line */}
      {isAdmin && actSummary && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 11, fontFamily: MONO, color: C.muted }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <LivePulseDot live={true} />
              <span style={{ color: C.grn, fontWeight: 700 }}>{actSummary.online ?? 0} online</span>
            </span>
            <span>·</span>
            <span style={{ color: C.muted }}>{actSummary.offline ?? 0} offline</span>
            <span>·</span>
            <span>{actSummary.totalUsers ?? 0} total</span>
            {actSummary.percentOnline != null && (
              <><span>·</span><span style={{ color: C.acc }}>{actSummary.percentOnline}% online</span></>
            )}
          </span>
        </div>
      )}
      {error && <ErrorBox msg={error} />}

      {/* prompt19 — users-by-country distribution (admin only; endpoint is requireAdmin). */}
      {isAdmin && <UsersByCountryCard />}

      {/* Search + role/status quick filters + advanced-filters toggle */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search name or email…" value={search} onChange={e => handleSearch(e.target.value)}
          style={{ ...inputStyle, width: 260, flex: 'none' }} />
        <FilterBar filters={filterDefs} active={filter} onSelect={f => { setFilter(f); setPage(1); load(search, f, 1); }} />
        {isAdmin && (
          <button onClick={() => setAdvOpen(o => !o)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px',
            background: advCount > 0 ? alpha(C.acc, '16') : 'transparent',
            border: `1px solid ${advCount > 0 ? alpha(C.acc, '45') : C.brd2}`, borderRadius: 6,
            color: advCount > 0 ? C.acc : C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT,
          }}>
            <Icon name="filter" size={13} />
            <span>Filters</span>
            {advCount > 0 && <span style={{ background: alpha(C.acc, '22'), borderRadius: 8, padding: '1px 6px', fontSize: 10, fontFamily: MONO, color: C.acc }}>{advCount}</span>}
            <Icon name={advOpen ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
        )}
      </div>

      {/* prompt27 — registration-window + status quick filters (SERVER-SIDE, whole
          dataset) + sort. Admin only. */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Registered</span>
          <FilterBar
            filters={[
              { id: 'any',     label: 'Any' },
              { id: 'today',   label: 'Today' },
              { id: 'week',    label: 'Week' },
              { id: 'month',   label: 'Month' },
              { id: 'quarter', label: 'Quarter' },
              { id: 'year',    label: 'Year' },
            ]}
            active={regWindow}
            onSelect={pickRegWindow}
          />
          <span style={{ width: 1, height: 18, background: C.brd2 }} />
          {[
            { k: 'unverified',          label: 'Unverified' },
            { k: 'onboardingIncomplete', label: 'Onboarding incomplete' },
            { k: 'noInstitution',       label: 'No institution' },
          ].map(c => {
            const on = quick[c.k];
            return (
              <button key={c.k} onClick={() => toggleQuick(c.k)} style={{
                padding: '6px 12px', background: on ? alpha(C.ylw, '18') : 'transparent',
                border: `1px solid ${on ? alpha(C.ylw, '55') : C.brd2}`, borderRadius: 6,
                color: on ? C.ylw : C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT,
              }}>{c.label}</button>
            );
          })}
          <span style={{ flex: 1 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Sort</span>
            <select value={sort} onChange={e => pickSort(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
      )}

      {/* Advanced profile filters — applied CLIENT-SIDE to the loaded page */}
      {isAdmin && advOpen && (
        <SectionCard>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {advSelect('primaryRole',   'Primary role',   USER_FILTER_OPTS.primaryRole)}
              {advSelect('researchField', 'Research field', USER_FILTER_OPTS.researchField)}
              {advSelect('mainUseCase',   'Main use case',  USER_FILTER_OPTS.mainUseCase)}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Country contains</span>
                <input type="text" value={adv.country} onChange={e => setAdv(a => ({ ...a, country: e.target.value }))}
                  placeholder="e.g. United States" style={{ ...inputStyle, padding: '7px 10px', fontSize: 12 }} />
              </label>
              {advSelect('verified',  'Email verified',     null, true)}
              {advSelect('onboarded', 'Onboarding done',    null, true)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: C.muted }}>
                {advActive
                  ? <>Filtering the current page client-side{enriching ? ' (loading profiles…)' : ''}{advFilteredOut > 0 ? ` · ${advFilteredOut} hidden` : ''}</>
                  : 'Filters apply to the rows on the current page.'}
              </span>
              {advCount > 0 && (
                <button onClick={clearAdv} style={{ padding: '5px 12px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Clear filters</button>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionCard>
            <DataTable columns={columns} rows={visibleRows} loading={loading}
              emptyMessage={advActive && rows.length > 0 ? 'No users on this page match the active filters.' : 'No users found.'}
              onRowClick={u => setSelectedUser(prev => prev?.id === u.id ? null : u)}
              selectedId={selectedUser?.id} />
            <div style={{ padding: '0 14px' }}>
              <Pagination page={page} total={total} perPage={PER_PAGE} onPage={setPage} />
            </div>
          </SectionCard>
          {!selectedUser && (
            <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: -10, marginBottom: 8 }}>
              Click a row to view user details and projects
            </div>
          )}
        </div>

        {selectedUser && (
          <UserDetailPanel
            user={selectedUser}
            isAdmin={isAdmin}
            onClose={() => setSelectedUser(null)}
            onStatusChange={() => load(search, filter, page)}
            onUserUpdate={() => load(search, filter, page)}
          />
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: USERS · GROWTH (prompt27) — detailed new-user registration
   analytics: window summary (today→year + all-time) with period deltas,
   historical year/month/quarter/day trends, a year selector, and this-month
   site-growth stats. One getUserGrowth fetch (re-fetched on year change).
   Admin-only (the endpoint is requireAdmin).
   ════════════════════════════════════════════════════════════════════════ */

/* Small stat tile for the site-growth grid. */
function StatTile({ label, value, sub, color = C.txt, loading }) {
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO, color, marginTop: 5, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {loading ? '—' : value}
      </div>
      {sub && <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sub}>{sub}</div>}
    </div>
  );
}

/* Format a 'YYYY-MM-DD' key as a local-readable short date. */
function fmtDayKey(key) {
  if (!key || typeof key !== 'string') return '—';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function NewUserGrowthSection() {
  const [data, setData]   = useState(null);    // null = first-load, undefined = error
  const [years, setYears] = useState([]);
  const [year, setYear]   = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const [dayRange, setDayRange] = useState('30d');

  const load = useCallback(async (y) => {
    setBusy(true);
    try {
      const d = await adminApi.getUserGrowth(y || undefined);
      setData(d);
      setYears(d.availableYears || []);
      if (y == null) setYear(d.selectedYear);
      setError('');
    } catch (e) { setError(e.message); if (y == null) setData(undefined); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(null); }, [load]);

  function pickYear(y) { setYear(y); load(y); }

  const loading = data === null;
  const w = data?.windows || {};
  const byYear = data?.byYear || [];
  const byMonth = data?.byMonth || [];
  const byQuarter = data?.byQuarter || [];
  const stats = data?.stats || {};

  const dayTrend = growthTrend(data, dayRange);
  const monthRows = byMonth.map(m => ({ label: m.label, value: m.count }));
  const quarterRows = byQuarter.map(q => ({ label: q.label, value: q.count }));
  const yearRows = byYear.map(y => ({ label: String(y.year), value: y.count }));
  // Label the quarter card with the years actually present (e.g. "2026" or
  // "2025–2026"), not an assumed two-year span.
  const quarterYearsShown = [...new Set(byQuarter.map(q => q.year))].sort((a, b) => a - b);
  const quarterLabel = quarterYearsShown.length
    ? (quarterYearsShown.length === 1 ? String(quarterYearsShown[0]) : `${quarterYearsShown[0]}–${quarterYearsShown[quarterYearsShown.length - 1]}`)
    : '';

  const dayRanges = [{ id: '7d', label: '7d' }, { id: '30d', label: '30d' }, { id: '90d', label: '90d' }];

  return (
    <div>
      {error && <ErrorBox msg={error} />}

      {/* A. Window summary + all-time total */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10, marginBottom: 18 }}>
        <GrowthSummaryCard label="Today"        win={w.today}   accent={C.acc}  loading={loading} prevLabel="day" />
        <GrowthSummaryCard label="This week"    win={w.week}    accent={C.teal} loading={loading} prevLabel="week" />
        <GrowthSummaryCard label="This month"   win={w.month}   accent={C.grn}  loading={loading} prevLabel="month" />
        <GrowthSummaryCard label="This quarter" win={w.quarter} accent={C.purp} loading={loading} prevLabel="quarter" />
        <GrowthSummaryCard label="This year"    win={w.year}    accent={C.acc2} loading={loading} prevLabel="year" />
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '14px 16px', minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.txt, fontFamily: MONO, letterSpacing: '-1px', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '—' : (w.total?.count ?? 0).toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total · all time</div>
          <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, marginTop: 5 }}>registered accounts</div>
        </div>
      </div>

      {/* C. Daily trend (last 7/30/90) */}
      <SectionCard title="New users by day" action={<RangeSwitch options={dayRanges} value={dayRange} onChange={setDayRange} />}>
        <div style={{ padding: '16px 18px' }}>
          <AreaChart series={loading ? null : [{ id: 'newUsers', label: 'New users', color: C.grn, values: dayTrend.values }]}
            labels={dayTrend.labels} height={180} loading={loading} emptyLabel="Not enough registration data yet" />
        </div>
      </SectionCard>

      {/* B. Historical totals — by year (with YoY) + year-driven month/quarter */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 16 }}>
        <SectionCard title="New users by year" action={<span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>year-over-year</span>}>
          <div style={{ padding: '16px 18px' }}>
            <BarRow rows={yearRows} color={C.acc2} loading={loading} emptyLabel="no yearly data yet" />
            {!loading && byYear.length > 0 && (
              <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
                {byYear.map(y => (
                  <div key={y.year} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontFamily: MONO, color: C.txt2 }}>
                    <span>{y.year}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: C.txt, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{y.count.toLocaleString()}</span>
                      <DeltaBadge delta={y.growthPct} title="vs previous year" />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="New users by month" action={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {busy && <Spinner size={11} />}
            {years.map(y => (
              <button key={y} onClick={() => pickYear(y)} style={{
                padding: '3px 9px', background: y === year ? C.acc2 : 'transparent',
                border: `1px solid ${y === year ? C.acc2 : C.brd2}`, borderRadius: 6,
                color: y === year ? C.accText : C.txt2, fontSize: 11, fontFamily: MONO, cursor: 'pointer',
              }}>{y}</button>
            ))}
          </span>
        }>
          <div style={{ padding: '16px 18px' }}>
            <BarRow rows={monthRows} color={C.grn} loading={loading} emptyLabel="no monthly data yet" />
          </div>
        </SectionCard>
      </div>

      {/* C. Quarterly (selected + previous year when present) */}
      <SectionCard title="New users by quarter" action={<span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>{quarterLabel}</span>}>
        <div style={{ padding: '16px 18px' }}>
          <BarRow rows={quarterRows} color={C.purp} loading={loading} emptyLabel="no quarterly data yet" />
        </div>
      </SectionCard>

      {/* G. This-month site-growth stats */}
      <SectionCard title="This month at a glance" action={<span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>current calendar month</span>}>
        <div style={{ padding: '16px 18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <StatTile label="New users" value={(stats.newUsersThisMonth ?? 0).toLocaleString()} color={C.grn} loading={loading} />
            <StatTile label="Avg / day" value={stats.avgPerDayThisMonth ?? 0} color={C.acc} loading={loading} sub="month-to-date" />
            <StatTile label="Best day" value={stats.bestDay ? stats.bestDay.count.toLocaleString() : '—'} color={C.teal} loading={loading} sub={stats.bestDay ? fmtDayKey(stats.bestDay.date) : 'no registrations yet'} />
            <StatTile label="Onboarded" value={(stats.onboardingCompletedThisMonth ?? 0).toLocaleString()} color={C.acc2} loading={loading} sub="completed profile" />
            <StatTile label="With institution" value={(stats.withInstitutionThisMonth ?? 0).toLocaleString()} color={C.purp} loading={loading} />
            <StatTile label="Countries" value={(stats.countriesThisMonth ?? 0).toLocaleString()} color={C.txt} loading={loading} sub="represented this month" />
            <StatTile label="New institutions" value={(stats.newInstitutionsThisMonth ?? 0).toLocaleString()} color={C.acc} loading={loading} sub={`${(stats.totalInstitutions ?? 0).toLocaleString()} total`} />
          </div>
          <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginTop: 12, letterSpacing: '0.04em' }}>
            Demographic breakdowns by country / institution / field / role / use-case are in the <strong style={{ color: C.txt2 }}>Analytics</strong> tab (filterable by time window).
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: USERS · ANALYTICS (prompt26) — one getUserAnalytics fetch →
   distributions by research field / primary role / country, top institutions,
   onboarding completion %, and email-verification donut. Small, theme-driven,
   no chart library. Admin-only (the endpoint is requireAdmin).
   prompt27 — adds a registration-window filter + use-case & institution-
   provided breakdowns.
   ════════════════════════════════════════════════════════════════════════ */
const ANALYTICS_WINDOWS = [
  { id: 'all',     label: 'All time' },
  { id: 'today',   label: 'Today' },
  { id: 'week',    label: 'Week' },
  { id: 'month',   label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year',    label: 'Year' },
];

function UserAnalyticsSection() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [window, setWindow]   = useState('all'); // registration-window filter (prompt27)

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const d = await adminApi.getUserAnalytics(window);
        if (alive) setData(d);
      } catch (e) { if (alive) setError(e.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [window]);

  const onb = data?.onboarding || { completed: 0, total: 0 };
  const ver = data?.verification || { verified: 0, unverified: 0, total: 0 };
  const inst = data?.institution || { provided: 0, missing: 0, total: 0 };
  const topInst = (data?.topInstitutions || []).map(i => ({ label: i.canonicalName || i.key, count: i.count }));
  const windowLabel = (ANALYTICS_WINDOWS.find(x => x.id === window) || {}).label || 'All time';

  return (
    <div>
      {error && <ErrorBox msg={error} />}

      {/* Registration-window filter — distributions reflect accounts CREATED in
          the selected window (prompt27). Default "All time". */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Registered in</span>
        <FilterBar filters={ANALYTICS_WINDOWS} active={window} onSelect={setWindow} />
      </div>

      {/* KPI row — total users + completion/verification headline cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 18 }}>
        <SectionCard title={window === 'all' ? 'Total users' : 'New users'}>
          <div style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 34, fontWeight: 800, fontFamily: MONO, color: C.acc, letterSpacing: '-1.2px', fontVariantNumeric: 'tabular-nums' }}>
              {loading ? '—' : (data?.totalUsers ?? 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 6 }}>{window === 'all' ? 'registered accounts' : `${windowLabel.toLowerCase()} · new accounts`}</div>
          </div>
        </SectionCard>
        <SectionCard title="Onboarding completion">
          <div style={{ padding: '16px 18px' }}>
            <PercentCard value={onb.completed || 0} total={onb.total || 0} label="completed onboarding" color={C.grn} loading={loading} suffix="users" />
          </div>
        </SectionCard>
        <SectionCard title="Email verification">
          <div style={{ padding: '16px 18px' }}>
            <DonutGauge
              segments={[
                { label: 'Verified',   value: ver.verified || 0,   color: C.grn },
                { label: 'Unverified', value: ver.unverified || 0, color: C.muted },
              ]}
              centerValue={ver.total > 0 ? `${Math.round(((ver.verified || 0) / ver.total) * 100)}%` : '—'}
              centerLabel="verified"
              size={108} thickness={12} loading={loading} emptyLabel="no users yet" />
          </div>
        </SectionCard>
        <SectionCard title="Institution provided">
          <div style={{ padding: '16px 18px' }}>
            <PercentCard value={inst.provided || 0} total={inst.total || 0} label="provided an institution" color={C.acc2} loading={loading} suffix="users" />
          </div>
        </SectionCard>
      </div>

      {/* Distributions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <SectionCard title="By research field">
          <div style={{ padding: '16px 18px' }}>
            <RankedBars items={data?.byResearchField} color={C.acc} loading={loading} emptyLabel="no field data yet" />
          </div>
        </SectionCard>
        <SectionCard title="By primary role">
          <div style={{ padding: '16px 18px' }}>
            <RankedBars items={data?.byPrimaryRole} color={C.teal} loading={loading} emptyLabel="no role data yet" />
          </div>
        </SectionCard>
        <SectionCard title="By main use case">
          <div style={{ padding: '16px 18px' }}>
            <RankedBars items={data?.byMainUseCase} color={C.purp} loading={loading} emptyLabel="no use-case data yet" />
          </div>
        </SectionCard>
        <SectionCard title="By country">
          <div style={{ padding: '16px 18px' }}>
            <RankedBars items={data?.byCountry} color={C.acc2} loading={loading} emptyLabel="no country data yet" />
          </div>
        </SectionCard>
        <SectionCard title="Top institutions">
          <div style={{ padding: '16px 18px' }}>
            <RankedBars items={topInst} color={C.grn} max={10} loading={loading} emptyLabel="no institutions yet" />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: USERS · INSTITUTIONS (prompt26) — canonical-institution registry
   with Rename / Merge / Reject-duplicate. Possible-duplicate pairs carry a
   confidence badge and a "Needs review" state. Admin-only.
   ════════════════════════════════════════════════════════════════════════ */
function ConfidenceBadge({ confidence }) {
  const pct = Math.round((Number(confidence) || 0) * 100);
  // ≥95 = strong, ≥85 = likely, else possible. All are still "needs review".
  const color = pct >= 95 ? C.red : pct >= 85 ? C.ylw : C.muted;
  return <Badge text={`${pct}% match`} color={color} />;
}

function InstitutionsManager() {
  const [institutions, setInstitutions] = useState([]);
  const [summary, setSummary] = useState(null); // prompt35 follow-up — coverage rollup
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState('');          // key currently mutating
  const [expanded, setExpanded] = useState({});        // key -> bool (aliases/dupes open)
  const [mergeFor, setMergeFor] = useState(null);      // institution being merged
  const [mergeInto, setMergeInto] = useState('');      // target key
  const [onlyReview, setOnlyReview] = useState(false); // show only needs-review

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const d = await adminApi.getInstitutions();
      setInstitutions(d.institutions || []);
      setSummary(d.summary || null);
    } catch (e) { setError(e.message); setInstitutions([]); setSummary(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byKey = {};
  for (const inst of institutions) byKey[inst.key] = inst;
  const nameOf = k => byKey[k]?.canonicalName || k;

  async function doRename(inst) {
    const next = window.prompt(`Rename institution\n\nCanonical display name for all ${inst.userCount} user(s):`, inst.canonicalName || '');
    if (next == null) return;
    const name = next.trim();
    if (!name || name === inst.canonicalName) return;
    setBusy(inst.key); setError('');
    try { await adminApi.renameInstitution(inst.key, name); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function doMerge() {
    if (!mergeFor || !mergeInto || mergeInto === mergeFor.key) return;
    setBusy(mergeFor.key); setError('');
    try {
      await adminApi.mergeInstitutions(mergeFor.key, mergeInto);
      setMergeFor(null); setMergeInto('');
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function doReject(keyA, keyB) {
    setBusy(keyA); setError('');
    try { await adminApi.rejectInstitutionDuplicate(keyA, keyB); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  const needsReview = institutions.filter(i => (i.possibleDuplicates || []).length > 0);
  const shown = onlyReview ? needsReview : institutions;

  return (
    <div>
      {error && <ErrorBox msg={error} />}

      {/* prompt35 follow-up — institution coverage rollup (ROR/local linkage,
          custom/unmatched, uncertain matches needing Ops review, users with none). */}
      {summary && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <Chip label="Users with institution" value={summary.withInstitution} />
          <Chip label="Canonical-linked" value={summary.canonicalLinked} color={C.grn} />
          <Chip label="ROR-linked" value={summary.rorLinked} color={C.teal} />
          <Chip label="Custom / unmatched" value={summary.customUnmatched} color={C.muted} />
          <Chip label="Needs review" value={summary.needsReview} color={summary.needsReview > 0 ? (C.ylw || C.yel) : C.muted} />
          <Chip label="Without institution" value={summary.withoutInstitution} color={C.muted} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.txt2 }}>
          <strong style={{ color: C.txt, fontFamily: MONO }}>{institutions.length}</strong> canonical institution{institutions.length === 1 ? '' : 's'}
          {needsReview.length > 0 && <span style={{ color: C.ylw }}> · {needsReview.length} need review</span>}
        </span>
        <FilterBar
          filters={[{ id: 'all', label: 'All' }, { id: 'review', label: 'Needs review', count: needsReview.length }]}
          active={onlyReview ? 'review' : 'all'}
          onSelect={id => setOnlyReview(id === 'review')} />
        <button onClick={load} disabled={loading} style={{ marginLeft: 'auto', padding: '6px 13px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: loading ? 'wait' : 'pointer', fontFamily: FONT }}>Refresh</button>
      </div>

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}><Spinner size={20} /><div style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Loading institutions…</div></div>
      ) : shown.length === 0 ? (
        <SectionCard><div style={{ padding: '32px 18px', textAlign: 'center', color: C.muted, fontSize: 12 }}>{onlyReview ? 'No possible duplicates to review.' : 'No institutions recorded yet.'}</div></SectionCard>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {shown.map(inst => {
            const dupes = inst.possibleDuplicates || [];
            const aliases = inst.aliases || [];
            const open = !!expanded[inst.key];
            const isBusy = busy === inst.key;
            return (
              <div key={inst.key} style={{ background: C.card, border: `1px solid ${dupes.length > 0 ? alpha(C.ylw, '45') : C.brd}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflowWrap: 'anywhere' }}>{inst.canonicalName || inst.key}</span>
                      {dupes.length > 0 && <Badge text="Needs review" color={C.ylw} />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>
                        <strong style={{ color: C.txt2 }}>{inst.userCount}</strong> user{inst.userCount === 1 ? '' : 's'}
                      </span>
                      {aliases.length > 0 && (
                        <button onClick={() => setExpanded(e => ({ ...e, [inst.key]: !open }))} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: C.acc, fontSize: 11, cursor: 'pointer', fontFamily: MONO, padding: 0 }}>
                          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
                          {aliases.length} alias{aliases.length === 1 ? '' : 'es'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {isBusy && <Spinner size={13} />}
                    <button onClick={() => doRename(inst)} disabled={isBusy} title="Rename canonical display name" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: isBusy ? 'wait' : 'pointer', fontFamily: FONT }}>
                      <Icon name="pencil" size={12} /> Rename
                    </button>
                    <button onClick={() => { setMergeFor(inst); setMergeInto(''); }} disabled={isBusy || institutions.length < 2} title="Merge this institution into another" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: alpha(C.acc, '12'), border: `1px solid ${alpha(C.acc, '30')}`, borderRadius: 6, color: C.acc, fontSize: 12, cursor: (isBusy || institutions.length < 2) ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: institutions.length < 2 ? 0.5 : 1 }}>
                      <Icon name="link" size={12} /> Merge
                    </button>
                  </div>
                </div>

                {/* Aliases (the distinct original names grouped under this key) */}
                {open && aliases.length > 0 && (
                  <div style={{ padding: '0 18px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {aliases.map(a => (
                      <span key={a} style={{ fontSize: 11, fontFamily: MONO, color: C.txt2, background: alpha(C.muted, 0.12), border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px' }}>{a}</span>
                    ))}
                  </div>
                )}

                {/* Possible duplicates — each with confidence + merge/reject */}
                {dupes.length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.brd}`, background: alpha(C.ylw, '08'), padding: '12px 18px' }}>
                    <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Possible duplicates</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {dupes.map(d => (
                        <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: C.txt, flex: 1, minWidth: 140, overflowWrap: 'anywhere' }}>{d.canonicalName || d.key}</span>
                          <ConfidenceBadge confidence={d.confidence} />
                          <button onClick={() => { setMergeFor(inst); setMergeInto(d.key); }} disabled={isBusy} style={{ padding: '5px 11px', background: alpha(C.acc, '12'), border: `1px solid ${alpha(C.acc, '30')}`, borderRadius: 6, color: C.acc, fontSize: 11, cursor: isBusy ? 'wait' : 'pointer', fontFamily: FONT }}>Merge →</button>
                          <button onClick={() => doReject(inst.key, d.key)} disabled={isBusy} title="Mark as not a duplicate" style={{ padding: '5px 11px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 11, cursor: isBusy ? 'wait' : 'pointer', fontFamily: FONT }}>Not a duplicate</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Merge dialog — choose the target institution; users repoint into it */}
      {mergeFor && (
        <div style={{ position: 'fixed', inset: 0, background: alpha(C.bg, 0.65), zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 12, padding: '26px 30px', maxWidth: 460, width: '92%', boxShadow: `0 24px 64px ${C.shadow}` }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 12 }}>Merge institution</div>
            <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, marginBottom: 18 }}>
              Move all <strong style={{ color: C.txt }}>{mergeFor.userCount}</strong> user(s) from{' '}
              <strong style={{ color: C.txt }}>{mergeFor.canonicalName || mergeFor.key}</strong> into the institution below.
              Each user's original institution name is preserved as an alias. This cannot be undone automatically.
            </div>
            <Field label="Merge into">
              <select value={mergeInto} onChange={e => setMergeInto(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— Select target institution —</option>
                {institutions.filter(i => i.key !== mergeFor.key).map(i => (
                  <option key={i.key} value={i.key}>{i.canonicalName || i.key} ({i.userCount})</option>
                ))}
              </select>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button onClick={() => { setMergeFor(null); setMergeInto(''); }} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={doMerge} disabled={!mergeInto || mergeInto === mergeFor.key || busy === mergeFor.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: C.acc2, border: 'none', borderRadius: 7, color: C.accText, fontSize: 13, fontWeight: 600, cursor: (!mergeInto || busy === mergeFor.key) ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: !mergeInto ? 0.6 : 1 }}>
                {busy === mergeFor.key && <Spinner size={12} color={C.accText} />}
                Merge {mergeInto ? `into ${nameOf(mergeInto)}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: PROJECTS (redesigned — search + detail drawer)
   ════════════════════════════════════════════════════════════════════════ */

function ProjectDetailPanel({ project, onClose, onAction }) {
  const [confirm, setConfirm] = useState(null);

  async function doAction() {
    if (!confirm) return;
    try {
      if (confirm === 'archive') await adminApi.projects.archive(project.id);
      else await adminApi.projects.restore(project.id);
      onAction();
      onClose();
    } catch { /* silent */ }
    setConfirm(null);
  }

  const isArchived = !!project.deletedAt;

  return (
    <div style={{ width: 280, flexShrink: 0, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', position: 'sticky', top: TOPBAR_H + 28 }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Project Detail</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div style={{ padding: '16px 16px 12px' }}>
        <div title={project.name} style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 4, minWidth: 0, overflowWrap: 'anywhere' }}>{project.name}</div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
          {!isArchived
            ? <Badge text="active" color={C.grn} />
            : project.deletedSource === 'owner'
              ? <Badge text="owner-deleted" color={C.red} />
              : <Badge text="admin-archived" color={C.ylw} />}
        </div>
        {[
          { label: 'Owner',    value: <span style={{ fontFamily: MONO, fontSize: 11 }}>{project.owner?.name || project.ownerEmail || project.userEmail || '—'}</span> },
          // Linked Review Workspace (prompt6 Task 11) — workspaceId == linked ScreenProject id.
          { label: 'Linked Screening', value: project.linkedMetaSift?.id
              ? <span style={{ fontSize: 11 }}>{project.linkedMetaSift.title || '(untitled)'}</span>
              : <span style={{ color: C.muted }}>not linked</span> },
          { label: 'Workspace', value: project.linkedMetaSift?.id
              ? <span style={{ fontFamily: MONO, fontSize: 10, wordBreak: 'break-all' }} title={project.linkedMetaSift.id}>{project.linkedMetaSift.id}</span>
              : <span style={{ color: C.muted }}>—</span> },
          { label: 'Created',  value: fmtDate(project.createdAt) },
          { label: 'Updated',  value: fmtAgo(project.updatedAt) },
          { label: 'Studies',  value: project.studyCount ?? 0 },
          { label: 'Records',  value: project.recordCount ?? 0 },
        ].map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: `1px solid ${C.brd}`, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>{r.label}</span>
            <span style={{ fontSize: 11, color: C.txt2, minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere' }}>{r.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}` }}>
        {isArchived ? (
          <button onClick={() => setConfirm('restore')} style={{ width: '100%', padding: '8px', background: alpha(C.grn, '15'), border: `1px solid ${alpha(C.grn, '30')}`, borderRadius: 6, color: C.grn, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
            Restore Project
          </button>
        ) : (
          <button onClick={() => setConfirm('archive')} style={{ width: '100%', padding: '8px', background: alpha(C.ylw, '10'), border: `1px solid ${alpha(C.ylw, '30')}`, borderRadius: 6, color: C.ylw, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
            Archive Project
          </button>
        )}
      </div>

      <ConfirmModal open={!!confirm}
        title={confirm === 'archive' ? 'Archive Project' : 'Restore Project'}
        message={confirm === 'archive' ? `Archive "${project.name}"? It will be hidden from the owner.` : `Restore "${project.name}"?`}
        confirmLabel={confirm === 'archive' ? 'Archive' : 'Restore'}
        danger={confirm === 'archive'} onConfirm={doAction} onCancel={() => setConfirm(null)} />
    </div>
  );
}

function ProjectsSection() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [selectedProject, setSelectedProject] = useState(null);
  const searchTimer = useRef(null);
  const PER_PAGE = 25;

  const load = useCallback(async (s, f, p) => {
    setLoading(true); setError('');
    try {
      const params = { page: p, limit: PER_PAGE };
      if (s) params.search = s;
      if (f !== 'all') params.status = f;
      const data = await adminApi.projects.list(params);
      // prompt25 Task 5 — show the LIVE owner name (falls back to email) so a rename reflects.
      setRows((data.projects || []).map(p => ({ ...p, ownerEmail: p.owner?.name || p.userEmail || p.ownerEmail })));
      setTotal(data.total || 0);
    } catch (e) { setRows([]); setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(search, filter, page); }, [page]);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(val, filter, 1); }, 280);
  }

  const columns = [
    { key: 'name',       label: 'Name',    render: v => <span title={v} style={{ color: C.txt, fontWeight: 600, display: 'block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> },
    // Linked META·SIFT screening project (prompt6 Task 11). linkedMetaSift = { id, title } | null;
    // its id IS the shared Review Workspace id (shown in the detail panel).
    { key: 'linkedMetaSift', label: 'Linked Screening',
      render: v => v?.id
        ? <span title={v.title || '(linked, untitled)'} style={{ fontSize: 11, display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title || '(linked, untitled)'}</span>
        : <span style={{ fontSize: 11, color: C.muted }}>— not linked</span> },
    { key: 'ownerEmail', label: 'Owner',   render: v => <span title={v || undefined} style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{v || '—'}</span> },
    { key: 'createdAt',  label: 'Created', render: v => fmtDate(v) },
    { key: 'updatedAt',  label: 'Updated', render: v => fmtAgo(v) },
    { key: 'studyCount', label: 'Studies', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'recordCount',label: 'Records', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'deletedAt',  label: 'Status',  render: (v, row) => {
        if (!v) return <Badge text="active" color={C.grn} />;
        if (row.deletedSource === 'owner') return <Badge text="owner-deleted" color={C.red} />;
        return <Badge text="admin-archived" color={C.ylw} />;
      } },
  ];

  const filterDefs = [
    { id: 'all',      label: 'All' },
    { id: 'active',   label: 'Active' },
    { id: 'archived', label: 'Archived' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Projects</h2>
      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search by project name…" value={search} onChange={e => handleSearch(e.target.value)}
          style={{ ...inputStyle, width: 260, flex: 'none' }} />
        <FilterBar filters={filterDefs} active={filter} onSelect={f => { setFilter(f); setPage(1); load(search, f, 1); }} />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionCard>
            <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No projects found."
              onRowClick={p => setSelectedProject(prev => prev?.id === p.id ? null : p)}
              selectedId={selectedProject?.id} />
            <div style={{ padding: '0 14px' }}>
              <Pagination page={page} total={total} perPage={PER_PAGE} onPage={setPage} />
            </div>
          </SectionCard>
        </div>

        {selectedProject && (
          <ProjectDetailPanel
            project={selectedProject}
            onClose={() => setSelectedProject(null)}
            onAction={() => load(search, filter, page)}
          />
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: CONTENT (expanded — full website editor)
   ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_CONTENT = {
  logoText: 'PecanRev',
  navLinks: [
    { label: 'Features', href: '#features' },
    { label: 'Workflow', href: '#workflow' },
    { label: 'About',    href: '#about' },
  ],
  heroHeadline:      'A serious workspace for\nsystematic reviews.',
  heroSubtitle:      'Organize evidence, extract data, run pooled analyses, and export research-ready reports — from one secure platform.',
  ctaText:           'Start Your Review →',
  ctaSecondaryText:  'Sign in',
  featureTitle:      'Everything a rigorous review needs',
  featureCards: [
    { icon: '◈', label: 'Protocol-first',   desc: 'Start with PICO and PROSPERO registration before touching a single record.' },
    { icon: '⊞', label: 'Reproducible',     desc: 'Every search string, screening decision, and diagram is logged and exportable.' },
    { icon: '◉', label: 'Analysis-ready',   desc: "Built-in forest plots, heterogeneity stats, Egger's test, and GRADE ratings." },
    { icon: '⬡', label: 'Single workspace', desc: 'From research question to manuscript draft — all in one structured tool.' },
  ],
  workflowTitle:    '14 steps from question to manuscript',
  workflowSubtitle: 'Every systematic review follows the same evidence-based process. PecanRev walks you through each stage without letting you skip ahead.',
  whyTitle:  'For researchers who care about rigor',
  whyBody1:  'Systematic reviews demand a level of methodological transparency that general research tools cannot provide.',
  whyBody2:  'PecanRev enforces a structured workflow aligned with Cochrane Handbook principles and international reporting standards.',
  whyBody3:  'Every decision — from inclusion criteria to subgroup definitions — is documented in a tamper-evident audit trail, so peer reviewers and editors can retrace your entire process.',
  whyStandards: [
    'PRISMA 2020 — flow diagram generation',
    'Cochrane RoB 2.0 & ROBINS-I',
    'GRADE certainty-of-evidence framework',
    'Full audit trail — every decision timestamped',
  ],
  aboutHeadline: 'What is PecanRev?',
  aboutText1: 'PecanRev is a structured, multi-user platform for conducting systematic reviews and meta-analyses. It covers the complete research cycle — from PICO definition and search strategy through screening, data extraction, statistical analysis, and manuscript preparation.',
  aboutText2: 'Built for academic researchers, clinical teams, and evidence synthesis groups who need a single, auditable workspace rather than a collection of disconnected tools.',
  contactTitle:    'Get in touch',
  contactSubtitle: 'Questions about PecanRev, research collaborations, or institutional access.',
  footerText:  `© ${new Date().getFullYear()} PecanRev · Systematic review platform`,
  footerLinks: [
    { label: 'Register', path: '/register' },
    { label: 'Sign In',  path: '/login' },
  ],
  announcementBanner: '',
  maintenanceBanner:  '',
  seoTitle:       'PecanRev — Systematic Review Platform',
  seoDescription: 'A structured, multi-user platform for conducting systematic reviews and meta-analyses.',
  // prompt9: landing animation speed. CRITICAL — this default must exist
  // client-side: saveAll() PUTs the WHOLE content object, so if the initial
  // GET fails, any key missing from DEFAULT_CONTENT would be wiped server-side.
  animationSpeed: 'normal',
};

const ANIMATION_SPEEDS = [
  { id: 'off',    label: 'Off'    },
  { id: 'slow',   label: 'Slow'   },
  { id: 'normal', label: 'Normal' },
  { id: 'fast',   label: 'Fast'   },
];

const CONTENT_TABS = [
  { id: 'hero',    label: 'Hero & CTA' },
  { id: 'nav',     label: 'Navbar & Logo' },
  { id: 'features',label: 'Features' },
  { id: 'workflow',label: 'Workflow' },
  { id: 'about',   label: 'About & Why' },
  { id: 'contact', label: 'Contact & Footer' },
  { id: 'seo',     label: 'SEO & Banners' },
  { id: 'animation', label: 'Animation' },
];

function ContentSection() {
  const [content, setContent]   = useState(DEFAULT_CONTENT);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('hero');
  const [statuses, setStatuses]  = useState({}); // { [tabId]: 'idle'|'saving'|'saved'|'error' }

  useEffect(() => {
    adminApi.landingContent.get()
      .then(d => { if (d && typeof d === 'object') setContent(c => ({ ...DEFAULT_CONTENT, ...c, ...d })); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setStatus(tabId, s) {
    setStatuses(prev => ({ ...prev, [tabId]: s }));
    if (s === 'saved' || s === 'error') setTimeout(() => setStatuses(prev => ({ ...prev, [tabId]: 'idle' })), 3000);
  }

  async function saveAll() {
    setStatus(activeTab, 'saving');
    try {
      await adminApi.landingContent.save(content);
      setStatus(activeTab, 'saved');
    } catch {
      setStatus(activeTab, 'error');
    }
  }

  function upd(key, value) { setContent(c => ({ ...c, [key]: value })); }
  function updCard(i, key, value) {
    const cards = [...(content.featureCards || [])];
    cards[i] = { ...cards[i], [key]: value };
    upd('featureCards', cards);
  }
  function addCard() {
    upd('featureCards', [...(content.featureCards || []), { icon: '◈', label: 'New Feature', desc: '' }]);
  }
  function removeCard(i) {
    upd('featureCards', (content.featureCards || []).filter((_, idx) => idx !== i));
  }
  function updNavLink(i, key, value) {
    const links = [...(content.navLinks || [])];
    links[i] = { ...links[i], [key]: value };
    upd('navLinks', links);
  }
  function addNavLink() { upd('navLinks', [...(content.navLinks || []), { label: 'New', href: '#' }]); }
  function removeNavLink(i) { upd('navLinks', (content.navLinks || []).filter((_, idx) => idx !== i)); }
  function updStandard(i, val) {
    const s = [...(content.whyStandards || [])];
    s[i] = val;
    upd('whyStandards', s);
  }
  function addStandard() { upd('whyStandards', [...(content.whyStandards || []), '']); }
  function removeStandard(i) { upd('whyStandards', (content.whyStandards || []).filter((_, idx) => idx !== i)); }
  function updFooterLink(i, key, value) {
    const links = [...(content.footerLinks || [])];
    links[i] = { ...links[i], [key]: value };
    upd('footerLinks', links);
  }
  function addFooterLink() { upd('footerLinks', [...(content.footerLinks || []), { label: '', path: '/' }]); }
  function removeFooterLink(i) { upd('footerLinks', (content.footerLinks || []).filter((_, idx) => idx !== i)); }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const ta = { ...inputStyle, resize: 'vertical', minHeight: 88, lineHeight: 1.65 };
  const tabStatus = statuses[activeTab] || 'idle';

  const ListEditor = ({ items, onUpdate, onAdd, onRemove, fields, addLabel }) => (
    <div>
      {(items || []).map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
          {fields.map(f => (
            <input key={f.key} type="text" value={item[f.key] || ''} onChange={e => onUpdate(i, f.key, e.target.value)}
              placeholder={f.placeholder} style={{ ...inputStyle, flex: f.flex || 1 }} />
          ))}
          <button onClick={() => onRemove(i)} style={{ padding: '9px 10px', background: alpha(C.red, '10'), border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 6, color: C.red, cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      ))}
      <button onClick={onAdd} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
        + {addLabel}
      </button>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case 'hero': return (
        <div>
          <SectionCard title="Hero">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Hero Headline">
                <textarea value={content.heroHeadline || ''} onChange={e => upd('heroHeadline', e.target.value)} style={{ ...ta, minHeight: 64 }} placeholder="Main headline text" />
              </Field>
              <Field label="Hero Subtitle / Description">
                <textarea value={content.heroSubtitle || ''} onChange={e => upd('heroSubtitle', e.target.value)} style={ta} />
              </Field>
              <Field label="Primary CTA Button Text">
                <input type="text" value={content.ctaText || ''} onChange={e => upd('ctaText', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Secondary CTA Button Text">
                <input type="text" value={content.ctaSecondaryText || ''} onChange={e => upd('ctaSecondaryText', e.target.value)} style={inputStyle} placeholder="e.g. Sign in" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'nav': return (
        <div>
          <SectionCard title="Logo">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Logo Text">
                <input type="text" value={content.logoText || ''} onChange={e => upd('logoText', e.target.value)} style={{ ...inputStyle, maxWidth: 300 }} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Navbar Links">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Navigation Links" note="Label and anchor href (e.g. #features)">
                <ListEditor items={content.navLinks} onUpdate={updNavLink} onAdd={addNavLink} onRemove={removeNavLink}
                  fields={[{ key: 'label', placeholder: 'Label', flex: 1 }, { key: 'href', placeholder: '#anchor', flex: 1 }]} addLabel="Add Link" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'features': return (
        <div>
          <SectionCard title="Features Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.featureTitle || ''} onChange={e => upd('featureTitle', e.target.value)} style={inputStyle} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Feature Cards">
            <div style={{ padding: '18px 20px' }}>
              {(content.featureCards || []).map((card, i) => (
                <div key={i} style={{ background: C.surf, borderRadius: 8, border: `1px solid ${C.brd}`, padding: '14px 16px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Card {i + 1}</span>
                    <button onClick={() => removeCard(i)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 12, fontFamily: FONT }}>Remove</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 8 }}>
                    <input type="text" value={card.icon || ''} onChange={e => updCard(i, 'icon', e.target.value)} placeholder="Icon" style={{ ...inputStyle, textAlign: 'center', fontSize: 18 }} />
                    <input type="text" value={card.label || ''} onChange={e => updCard(i, 'label', e.target.value)} placeholder="Card title" style={inputStyle} />
                  </div>
                  <textarea value={card.desc || ''} onChange={e => updCard(i, 'desc', e.target.value)} placeholder="Description" style={{ ...ta, minHeight: 60 }} />
                </div>
              ))}
              <button onClick={addCard} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
                + Add Feature Card
              </button>
            </div>
          </SectionCard>
        </div>
      );
      case 'workflow': return (
        <div>
          <SectionCard title="Workflow Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.workflowTitle || ''} onChange={e => upd('workflowTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Section Subtitle">
                <textarea value={content.workflowSubtitle || ''} onChange={e => upd('workflowSubtitle', e.target.value)} style={ta} />
              </Field>
            </div>
          </SectionCard>
          <div style={{ padding: '10px 0 4px', fontSize: 11, color: C.muted, fontFamily: MONO }}>
            Workflow steps are managed in code. Contact your developer to add/remove steps.
          </div>
        </div>
      );
      case 'about': return (
        <div>
          <SectionCard title="About Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Headline">
                <input type="text" value={content.aboutHeadline || ''} onChange={e => upd('aboutHeadline', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Paragraph 1">
                <textarea value={content.aboutText1 || ''} onChange={e => upd('aboutText1', e.target.value)} style={{ ...ta, minHeight: 110 }} />
              </Field>
              <Field label="Paragraph 2">
                <textarea value={content.aboutText2 || ''} onChange={e => upd('aboutText2', e.target.value)} style={{ ...ta, minHeight: 110 }} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Why It's Different">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.whyTitle || ''} onChange={e => upd('whyTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Body Paragraph 1">
                <textarea value={content.whyBody1 || ''} onChange={e => upd('whyBody1', e.target.value)} style={ta} />
              </Field>
              <Field label="Body Paragraph 2">
                <textarea value={content.whyBody2 || ''} onChange={e => upd('whyBody2', e.target.value)} style={ta} />
              </Field>
              <Field label="Body Paragraph 3">
                <textarea value={content.whyBody3 || ''} onChange={e => upd('whyBody3', e.target.value)} style={ta} />
              </Field>
              <Field label="Standards List">
                {(content.whyStandards || []).map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input type="text" value={s} onChange={e => updStandard(i, e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => removeStandard(i)} style={{ padding: '9px 10px', background: alpha(C.red, '10'), border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 6, color: C.red, cursor: 'pointer', fontSize: 12 }}>✕</button>
                  </div>
                ))}
                <button onClick={addStandard} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
                  + Add Standard
                </button>
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'contact': return (
        <div>
          <SectionCard title="Contact Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.contactTitle || ''} onChange={e => upd('contactTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Section Subtitle">
                <textarea value={content.contactSubtitle || ''} onChange={e => upd('contactSubtitle', e.target.value)} style={ta} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Footer">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Footer Text" note="Copyright line shown in the footer.">
                <input type="text" value={content.footerText || ''} onChange={e => upd('footerText', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Footer Links">
                <ListEditor items={content.footerLinks} onUpdate={updFooterLink} onAdd={addFooterLink} onRemove={removeFooterLink}
                  fields={[{ key: 'label', placeholder: 'Label', flex: 1 }, { key: 'path', placeholder: '/path', flex: 1 }]} addLabel="Add Footer Link" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'seo': return (
        <div>
          <SectionCard title="SEO">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Page Title" note="Used in <title> and social previews.">
                <input type="text" value={content.seoTitle || ''} onChange={e => upd('seoTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Meta Description" note="Used by search engines and social cards.">
                <textarea value={content.seoDescription || ''} onChange={e => upd('seoDescription', e.target.value)} style={{ ...ta, minHeight: 72 }} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Banners">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Announcement Banner" note="Shown as a slim dismissable bar at the top. Leave blank to hide.">
                <input type="text" value={content.announcementBanner || ''} onChange={e => upd('announcementBanner', e.target.value)} style={inputStyle} placeholder="Optional announcement…" />
              </Field>
              <Field label="Maintenance Banner" note="Shown prominently if set. Leave blank to hide.">
                <input type="text" value={content.maintenanceBanner || ''} onChange={e => upd('maintenanceBanner', e.target.value)} style={inputStyle} placeholder="Optional maintenance message…" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'animation': {
        const current = ANIMATION_SPEEDS.some(s => s.id === content.animationSpeed) ? content.animationSpeed : 'normal';
        return (
          <div>
            <SectionCard title="Landing Animation">
              <div style={{ padding: '18px 20px 4px' }}>
                <Field label="Animation Speed" note="Off disables landing-page motion; users with reduced-motion preferences always get a static page.">
                  <div role="radiogroup" aria-label="Landing animation speed" style={{ display: 'inline-flex', border: `1px solid ${C.brd2}`, borderRadius: 7, overflow: 'hidden' }}>
                    {ANIMATION_SPEEDS.map((s, i) => {
                      const on = current === s.id;
                      return (
                        <button
                          key={s.id}
                          role="radio"
                          aria-checked={on}
                          onClick={() => upd('animationSpeed', s.id)}
                          style={{
                            padding: '8px 18px', background: on ? C.acc2 : 'transparent',
                            border: 'none', borderLeft: i > 0 ? `1px solid ${C.brd2}` : 'none',
                            color: on ? C.accText : C.txt2, fontSize: 12,
                            fontWeight: on ? 700 : 400, cursor: 'pointer', fontFamily: FONT,
                          }}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            </SectionCard>
          </div>
        );
      }
      default: return null;
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Website Content Editor</h2>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${C.brd}`, paddingBottom: 0 }}>
        {CONTENT_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '8px 16px', background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.id ? `2px solid ${C.acc}` : '2px solid transparent',
            color: activeTab === tab.id ? C.acc : C.txt2, fontSize: 12,
            fontWeight: activeTab === tab.id ? 700 : 400, cursor: 'pointer',
            fontFamily: FONT, marginBottom: -1,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {renderTab()}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <SaveButton onClick={saveAll} status={tabStatus} label="Save Changes" />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: SETTINGS — grouped cards (prompt9)
   Save mechanism (PINNED): GET /api/admin/settings returns the nested
   { appSettings, landingContent, featureFlags } objects, which are merged
   into the form and ride along on save so PUT /api/admin/settings always
   carries valid SETTING_KEYS. Edited flat fields are additionally nested
   into body.appSettings on save — additive: unknown stored keys survive
   the round-trip via spread. Backend enforcement of the prompt9 keys
   (notificationsEnabled, emailInvitesEnabled, defaultTheme,
   maintenanceMessage, exportFormats, projectDeletion) lands in Wave B2.
   ════════════════════════════════════════════════════════════════════════ */

const EXPORT_FORMATS = ['png', 'svg', 'csv', 'json', 'ris', 'xls'];

// Flat appSettings keys owned by this form (existing 8 + prompt9 additions).
const APP_SETTING_KEYS = [
  'appName', 'registrationOpen', 'maintenanceMode', 'contactFormEnabled',
  'projectCreationEnabled', 'exportEnabled', 'maxProjectsPerUser', 'maxStudiesPerProject',
  'notificationsEnabled', 'emailInvitesEnabled', 'defaultTheme', 'maintenanceMessage',
  'exportFormats', 'projectDeletion',
  // prompt26 — email verification (OFF by default; persisted additively).
  'requireEmailVerification',
];

function SettingsSection() {
  const [form, setForm] = useState({
    appName: 'PecanRev', registrationOpen: true, maintenanceMode: false,
    contactFormEnabled: true, projectCreationEnabled: true, exportEnabled: true,
    maxProjectsPerUser: '', maxStudiesPerProject: '',
    // prompt9 additions — defaults mirror the frozen Wave B2 spec.
    notificationsEnabled: true, emailInvitesEnabled: true,
    defaultTheme: 'night', maintenanceMessage: '',
    exportFormats: [...EXPORT_FORMATS], projectDeletion: 'soft',
    // prompt26 — require email verification before login (OFF by default).
    requireEmailVerification: false,
  });
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('idle');
  // SMTP-config status (from /admin/console) so the verification toggle can warn
  // when turning it on would lock users out. null = unknown (never warn on null).
  const [emailConfigured, setEmailConfigured] = useState(null);
  // Wipe-safety: if the initial GET failed, the form holds client defaults
  // only — saving would overwrite stored values, so saving is blocked.
  const [loadFailed, setLoadFailed] = useState(false);

  const mergeServer = d => setForm(f => ({
    ...f,
    // Flatten stored appSettings into the editable fields…
    ...(d && typeof d.appSettings === 'object' && d.appSettings ? d.appSettings : {}),
    // …and keep the nested objects riding along for the save round-trip.
    ...(d && typeof d === 'object' ? d : {}),
  }));

  useEffect(() => {
    adminApi.settings.get()
      .then(d => { mergeServer(d); setLoadFailed(false); })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
    // Best-effort: learn whether SMTP is configured so the verification toggle
    // can warn before it locks users out. Leave null (no warning) on any error.
    adminApi.console()
      .then(c => setEmailConfigured(!!c?.emailConfigured))
      .catch(() => setEmailConfigured(null));
  }, []);

  async function save() {
    if (loadFailed) return;
    setStatus('saving');
    try {
      const flat = {};
      for (const k of APP_SETTING_KEYS) if (form[k] !== undefined) flat[k] = form[k];
      if (flat.maxProjectsPerUser === '')   flat.maxProjectsPerUser = null;
      if (flat.maxStudiesPerProject === '') flat.maxStudiesPerProject = null;
      const body = {
        ...form,
        // Spread the stored appSettings object first so unknown server-side
        // keys survive; edited flat fields override (additive only).
        appSettings: { ...(typeof form.appSettings === 'object' && form.appSettings ? form.appSettings : {}), ...flat },
      };
      const d = await adminApi.settings.save(body);
      if (d && typeof d === 'object') mergeServer(d);
      setStatus('saved'); setTimeout(() => setStatus('idle'), 3000);
    }
    catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  function toggleFormat(fmt) {
    setForm(f => {
      const cur = Array.isArray(f.exportFormats) ? f.exportFormats : [...EXPORT_FORMATS];
      const next = cur.includes(fmt)
        ? cur.filter(x => x !== fmt)
        : EXPORT_FORMATS.filter(x => cur.includes(x) || x === fmt); // canonical order
      return { ...f, exportFormats: next };
    });
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const Row = ({ label, note, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.brd}`, gap: 20 }}>
      <div>
        <div style={{ fontSize: 13, color: C.txt, fontWeight: 500 }}>{label}</div>
        {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{note}</div>}
      </div>
      {children}
    </div>
  );

  const fmts = Array.isArray(form.exportFormats) ? form.exportFormats : EXPORT_FORMATS;

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>App Settings</h2>

      {loadFailed && <NoticeBox msg="Settings could not be loaded — saving is disabled so stored values are not overwritten. Reload to retry." color={C.red} />}

      <SectionCard title="Platform">
        <div style={{ padding: '14px 20px 0', borderBottom: `1px solid ${C.brd}` }}>
          <Field label="App Name"><input type="text" value={form.appName ?? ''} onChange={e => setForm(f => ({ ...f, appName: e.target.value }))} style={{ ...inputStyle, maxWidth: 320 }} /></Field>
          <Field label="Default Theme" note="Theme for first-visit users with no saved preference. Per-user choices always win.">
            <select value={form.defaultTheme === 'day' ? 'day' : 'night'} onChange={e => setForm(f => ({ ...f, defaultTheme: e.target.value }))} style={{ ...inputStyle, maxWidth: 160 }}>
              <option value="night">Night</option>
              <option value="day">Day</option>
            </select>
          </Field>
        </div>
        <Row label="Registration Open" note="Allow new users to register."><Toggle checked={!!form.registrationOpen} onChange={v => setForm(f => ({ ...f, registrationOpen: v }))} /></Row>
        <Row label="Maintenance Mode" note={form.maintenanceMode ? '⚠ Users cannot log in.' : 'Put the site in maintenance mode.'}><Toggle checked={!!form.maintenanceMode} onChange={v => setForm(f => ({ ...f, maintenanceMode: v }))} /></Row>
        <div style={{ padding: '14px 20px 0', borderBottom: `1px solid ${C.brd}` }}>
          <Field label="Maintenance Message" note="Shown to users while maintenance mode is on.">
            <textarea value={form.maintenanceMessage ?? ''} onChange={e => setForm(f => ({ ...f, maintenanceMessage: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional message…" />
          </Field>
        </div>
        <Row label="Contact Form Enabled"><Toggle checked={!!form.contactFormEnabled} onChange={v => setForm(f => ({ ...f, contactFormEnabled: v }))} /></Row>
      </SectionCard>

      <SectionCard title="Notifications & Invites">
        <Row label="Notifications Enabled" note="Master switch for in-app notifications (invites, role changes, screening events).">
          <Toggle checked={!!form.notificationsEnabled} onChange={v => setForm(f => ({ ...f, notificationsEnabled: v }))} />
        </Row>
        <Row label="Email Invites Enabled" note="Also send collaborator invites by email when SMTP is configured.">
          <Toggle checked={!!form.emailInvitesEnabled} onChange={v => setForm(f => ({ ...f, emailInvitesEnabled: v }))} />
        </Row>
      </SectionCard>

      {/* prompt26 — account email verification. Gated behind a clear SMTP +
          grandfather warning because turning it on with no SMTP, or before
          back-filling existing accounts, would lock real users out of login. */}
      <SectionCard title="Account Verification" action={
        emailConfigured === false
          ? <span style={{ fontSize: 10, fontFamily: MONO, color: C.ylw, letterSpacing: '0.05em' }}>SMTP not configured</span>
          : emailConfigured === true
            ? <span style={{ fontSize: 10, fontFamily: MONO, color: C.grn, letterSpacing: '0.05em' }}>SMTP configured</span>
            : null
      }>
        <Row
          label="Require Email Verification"
          note={form.requireEmailVerification
            ? '⚠ New users must verify their email before they can sign in.'
            : 'New users can sign in immediately; emails are not verified.'}
        >
          <Toggle checked={!!form.requireEmailVerification} onChange={v => setForm(f => ({ ...f, requireEmailVerification: v }))} />
        </Row>
        {form.requireEmailVerification && emailConfigured === false && (
          <div style={{ padding: '12px 20px 4px' }}>
            <NoticeBox color={C.red} msg="SMTP is not configured. With verification required, new users will never receive a verification email and cannot sign in. Configure SMTP (server/docs/email-setup.md) before enabling this." />
          </div>
        )}
        {form.requireEmailVerification && (
          <div style={{ padding: '12px 20px 4px' }}>
            <NoticeBox color={C.ylw} msg={`Before enabling in production, grandfather existing users so they aren't locked out — run: UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL.`} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Exports">
        <Row label="Export Enabled" note="Master switch for project and data exports.">
          <Toggle checked={!!form.exportEnabled} onChange={v => setForm(f => ({ ...f, exportEnabled: v }))} />
        </Row>
        <div style={{ padding: '14px 20px 4px' }}>
          <Field label="Allowed Export Formats" note="Formats offered in export dialogs across the platform.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EXPORT_FORMATS.map(fmt => {
                const on = fmts.includes(fmt);
                return (
                  <label key={fmt} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', background: on ? alpha(C.acc, '12') : 'transparent', border: `1px solid ${on ? alpha(C.acc, '50') : C.brd2}`, borderRadius: 7, cursor: 'pointer', fontSize: 11, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', color: on ? C.acc : C.txt2, userSelect: 'none' }}>
                    <input type="checkbox" checked={on} onChange={() => toggleFormat(fmt)} style={{ accentColor: C.acc, margin: 0 }} />
                    {fmt}
                  </label>
                );
              })}
            </div>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Projects">
        <Row label="Project Creation Enabled"><Toggle checked={!!form.projectCreationEnabled} onChange={v => setForm(f => ({ ...f, projectCreationEnabled: v }))} /></Row>
        <div style={{ padding: '14px 20px 0', borderBottom: `1px solid ${C.brd}` }}>
          <Field label="Max Projects Per User" note="Leave blank for unlimited.">
            <input type="number" min="0" value={form.maxProjectsPerUser ?? ''} onChange={e => setForm(f => ({ ...f, maxProjectsPerUser: e.target.value }))} style={{ ...inputStyle, maxWidth: 160 }} placeholder="Unlimited" />
          </Field>
          <Field label="Max Studies Per Project" note="Leave blank for unlimited.">
            <input type="number" min="0" value={form.maxStudiesPerProject ?? ''} onChange={e => setForm(f => ({ ...f, maxStudiesPerProject: e.target.value }))} style={{ ...inputStyle, maxWidth: 160 }} placeholder="Unlimited" />
          </Field>
        </div>
        <Row label="Deletion Policy" note="Platform-wide policy — not editable from the console.">
          <span style={{ fontSize: 12, color: C.txt2, fontFamily: MONO, textAlign: 'right' }}>
            {(form.projectDeletion || 'soft') === 'soft' ? 'Soft delete / archive — hard delete disabled' : String(form.projectDeletion)}
          </span>
        </Row>
      </SectionCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><SaveButton onClick={save} status={status} disabled={loadFailed} /></div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: APPEARANCE — global brand color / style engine (prompt37)
   ════════════════════════════════════════════════════════════════════════ */

// A scoped light/dark mini-preview: sets the four brand CSS vars (which inherit
// down to every var(--t-acc*) inside) plus neutral chrome for the chosen mode,
// so the admin sees the palette on real UI samples without flipping the app.
const PREVIEW_NEUTRALS = {
  day:   { bg: '#ffffff', card: '#f3f4f6', txt: '#1f2937', txt2: '#4b5563', brd: '#e5e7eb' },
  night: { bg: '#151e30', card: '#1d2840', txt: '#f1f5f9', txt2: '#aab6cf', brd: '#283449' },
};

function ThemePreviewCard({ palette, mode }) {
  const side = palette[mode];
  const n = PREVIEW_NEUTRALS[mode];
  const vars = {
    '--t-acc': side.acc, '--t-acc2': side.acc2,
    '--t-acc-text': side.accText, '--t-acc-bg': side.accBg,
  };
  return (
    <div style={{
      ...vars, flex: 1, minWidth: 220, background: n.bg, color: n.txt,
      border: `1px solid ${n.brd}`, borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: n.txt2 }}>
          {mode === 'day' ? 'Light mode' : 'Dark mode'}
        </span>
        <span style={{ fontSize: 10, fontFamily: MONO, color: n.txt2 }}>{side.acc}</span>
      </div>
      {/* Sample tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${n.brd}` }}>
        <span style={{ padding: '6px 10px', fontSize: 12, fontWeight: 700, color: 'var(--t-acc)', borderBottom: '2px solid var(--t-acc)' }}>Active</span>
        <span style={{ padding: '6px 10px', fontSize: 12, color: n.txt2 }}>Inactive</span>
      </div>
      {/* Sample button + badge + link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--t-acc)', color: 'var(--t-acc-text)', fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: 'default' }}>Primary</button>
        <span style={{ padding: '4px 10px', borderRadius: 999, background: 'var(--t-acc-bg)', color: 'var(--t-acc)', fontSize: 11, fontWeight: 600 }}>Badge</span>
        <a style={{ color: 'var(--t-acc)', fontSize: 12, fontWeight: 500, textDecoration: 'underline' }}>Link</a>
      </div>
      {/* Sample card + focus ring */}
      <div style={{ background: n.card, border: `1px solid ${n.brd}`, borderRadius: 8, padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--t-acc)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 6, width: '70%', borderRadius: 4, background: 'var(--t-acc-bg)' }} />
          <div style={{ height: 6, width: '45%', borderRadius: 4, background: n.brd, marginTop: 5 }} />
        </div>
        <div style={{ width: 30, height: 18, borderRadius: 999, background: 'var(--t-acc)', boxShadow: `0 0 0 3px color-mix(in srgb, var(--t-acc) 28%, transparent)` }} />
      </div>
    </div>
  );
}

function SwatchButton({ hex, name, note, active, onClick }) {
  return (
    <button onClick={onClick} title={note} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
      background: active ? alpha(C.acc, 0.1) : C.card,
      border: `1.5px solid ${active ? C.acc : C.brd}`, fontFamily: FONT,
    }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, background: hex, flexShrink: 0, border: `1px solid ${alpha('#000000', 0.12)}` }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.txt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        <span style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted }}>{hex}</span>
      </span>
    </button>
  );
}

function StyleSection() {
  const { brand, previewBrand, clearBrandPreview, commitBrand } = useTheme();
  // Seed from the ALREADY-APPLIED context brand so `dirty` starts false — never
  // push the placeholder default as a global preview before the server loads
  // (which would flash the whole app to indigo on mount under a custom brand).
  const [hexInput, setHexInput] = useState(() => normalizeHex(brand?.brandColor) || DEFAULT_BRAND);
  const [preset, setPreset]     = useState('default');
  const [status, setStatus]     = useState('idle');
  const [loading, setLoading]   = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  // Initialize from the server record (falls back to the live context brand).
  useEffect(() => {
    let alive = true;
    adminApi.theme.get()
      .then(d => {
        if (!alive || !d) return;
        setHexInput(d.brandColor || DEFAULT_BRAND);
        setPreset(d.preset || 'custom');
        setUpdatedAt(d.updatedAt || null);
      })
      .catch(() => { setHexInput(brand.brandColor || DEFAULT_BRAND); setPreset(brand.preset || 'custom'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const normalized = normalizeHex(hexInput);
  const valid = !!normalized;
  const palette = valid ? generateThemeFromHex(normalized) : null;
  const diag = palette ? diagnosePalette(palette) : null;
  const savedColor = normalizeHex(brand.brandColor) || DEFAULT_BRAND;
  const dirty = valid && normalized !== savedColor;

  // Live global preview: whenever the (valid) draft differs from saved, theme
  // the whole console; revert to saved on cleanup (tab switch / unmount).
  useEffect(() => {
    // Gate on `loading` too: never preview the placeholder color before the
    // authoritative server value has resolved.
    if (!loading && palette && dirty) previewBrand(palette);
    else clearBrandPreview();
    return () => clearBrandPreview();
  }, [normalized, dirty, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickPreset(p) { setHexInput(p.hex); setPreset(p.id); }
  function pickHex(v) {
    setHexInput(v);
    const nh = normalizeHex(v);
    const match = nh && PRESETS.find(p => p.hex === nh);
    setPreset(match ? match.id : 'custom');
  }

  async function save() {
    if (!valid) return;
    setStatus('saving');
    try {
      const record = buildThemeRecord({ presetId: preset !== 'custom' ? preset : null, hex: normalized });
      const saved = await adminApi.theme.save({
        brandColor: record.brandColor, preset: record.preset, palette: record.palette,
      });
      commitBrand({ brandColor: saved.brandColor, preset: saved.preset, palette: saved.palette || record.palette });
      setUpdatedAt(saved.updatedAt || null);
      setStatus('saved'); setTimeout(() => setStatus('idle'), 3000);
    } catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  async function resetDefault() {
    setStatus('saving');
    try {
      const saved = await adminApi.theme.save({ reset: true });
      const rec = defaultThemeRecord();
      commitBrand({ brandColor: rec.brandColor, preset: 'default', palette: null });
      setHexInput(DEFAULT_BRAND); setPreset('default');
      setUpdatedAt(saved.updatedAt || null);
      setStatus('saved'); setTimeout(() => setStatus('idle'), 3000);
    } catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const diagColor = lvl => (lvl === 'good' ? C.grn : lvl === 'warn' ? C.yel : C.red);

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 6px' }}>Appearance</h2>
      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 20px', maxWidth: 720, lineHeight: 1.6 }}>
        Set the platform-wide <strong style={{ color: C.txt2 }}>brand color</strong>. One accent drives a balanced palette
        (primary, hover, soft tint, accessible text) across landing, dashboard, screening, RoB, GRADE, analysis,
        ops, buttons, tabs, badges, charts and maps — in both light and dark mode. Semantic colors
        (success / warning / danger) stay meaningful.
      </p>

      {dirty && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: alpha(C.acc, 0.1), border: `1px solid ${alpha(C.acc, 0.4)}` }}>
          <span style={{ fontSize: 12.5, color: C.txt, fontWeight: 500 }}>Live preview active — not yet saved.</span>
          <button onClick={() => { setHexInput(savedColor); setPreset(brand.preset || 'custom'); }} style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 12, fontFamily: FONT, cursor: 'pointer' }}>Revert preview</button>
        </div>
      )}

      <SectionCard title="Live preview">
        <div style={{ padding: 16, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {palette
            ? (<><ThemePreviewCard palette={palette} mode="day" /><ThemePreviewCard palette={palette} mode="night" /></>)
            : <div style={{ fontSize: 12, color: C.red, padding: 10 }}>Enter a valid hex color to preview.</div>}
        </div>
      </SectionCard>

      <SectionCard title="Preset colors">
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {PRESETS.map(p => (
            <SwatchButton key={p.id} hex={p.hex} name={p.name} note={p.note} active={preset === p.id} onClick={() => pickPreset(p)} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Custom color">
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <input type="color" value={normalized || '#000000'} onChange={e => pickHex(e.target.value)}
            style={{ width: 44, height: 38, padding: 0, border: `1px solid ${C.brd2}`, borderRadius: 8, background: 'transparent', cursor: 'pointer' }} aria-label="Pick a brand color" />
          <input type="text" value={hexInput} onChange={e => pickHex(e.target.value)} placeholder="#4f46e5" spellCheck={false}
            style={{ ...inputStyle, maxWidth: 160, fontFamily: MONO, textTransform: 'lowercase' }} aria-label="Brand color hex" />
          {!valid && <span style={{ fontSize: 12, color: C.red, fontWeight: 500 }}>Invalid hex — use #RRGGBB.</span>}
          {valid && <span style={{ fontSize: 12, color: C.muted }}>{preset === 'custom' ? 'Custom color' : PRESETS.find(p => p.id === preset)?.name}</span>}
        </div>
      </SectionCard>

      <SectionCard title="Accessibility diagnostics" action={
        diag && (diag.hasWarnings
          ? <span style={{ fontSize: 10, fontFamily: MONO, color: diag.ok ? C.yel : C.red, letterSpacing: '0.05em' }}>{diag.ok ? 'WARNINGS' : 'POOR CONTRAST'}</span>
          : <span style={{ fontSize: 10, fontFamily: MONO, color: C.grn, letterSpacing: '0.05em' }}>WCAG AA OK</span>)
      }>
        {diag && (
          <div style={{ padding: '6px 0' }}>
            {diag.checks.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 20px', borderBottom: i < diag.checks.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                <span style={{ fontSize: 12.5, color: C.txt2 }}>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>{c.ratio}:1 (min {c.min})</span>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: diagColor(c.level) }} />
                </span>
              </div>
            ))}
          </div>
        )}
        {diag && diag.warnings.length > 0 && (
          <div style={{ padding: '12px 20px 4px' }}>
            <NoticeBox color={diag.ok ? C.yel : C.red} msg={diag.warnings.join(' ')} />
          </div>
        )}
      </SectionCard>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <button onClick={resetDefault} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 13, fontWeight: 500, fontFamily: FONT, cursor: 'pointer' }}>Reset to default</button>
        {updatedAt && <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>Last changed {fmtDate(updatedAt)}</span>}
        <div style={{ marginLeft: 'auto' }}>
          <SaveButton onClick={save} status={status} label={diag && diag.hasWarnings ? 'Save anyway' : 'Save theme'} disabled={!valid || !dirty} />
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: FEATURE FLAGS (unchanged)
   ════════════════════════════════════════════════════════════════════════ */

const FLAG_META = [
  { key: 'autosave',             label: 'Autosave',              desc: 'Automatically save project changes as the user types.' },
  { key: 'contactForm',          label: 'Contact Form',          desc: 'Show the public contact form on the landing page.' },
  { key: 'projectDuplication',   label: 'Project Duplication',   desc: 'Allow users to clone existing projects.' },
  { key: 'advancedMetaAnalysis', label: 'Advanced Meta-Analysis',desc: "Enable trim-and-fill, Egger's test, and influence diagnostics." },
  { key: 'exportTools',          label: 'Export Tools',          desc: 'Allow project and data exports in various formats.' },
  { key: 'rob_engine_v2',        label: 'Risk of Bias (RoB 2)',  desc: 'Enable the PecanRev RoB 2 assessment workspace (beta). Off by default until validated.' },
  { key: 'serverBackedWorkflowState', label: 'Server-Backed Workflow State', desc: 'Persist migrated workflow modules (Protocol, Search Builder) server-side with revision-based conflict detection. Off keeps the legacy whole-project autosave.' },
  { key: 'searchEngine',         label: 'Search Builder Engine', desc: 'Enable the new concept→multi-database Search Builder (MeSH lookup + live PubMed counts via the NLM proxy). Off keeps the legacy in-app search builder.' },
  { key: 'aiScreening',          label: 'AI Screening Engine',   desc: 'Enable the PecanRev Screening Intelligence Engine: deterministic TF-IDF + active-learning relevance scoring, ranking, explanations, and validation metrics inside the screening workbench. Assistive only — human decisions are never automated. Off by default until validated. Configure global policy in Screening → AI Policy.' },
  { key: 'betaWaitlist',         label: 'Beta Waitlist Landing Page', desc: 'When ON, unauthenticated visitors to the homepage ( / ) see the Beta Waitlist sign-up page instead of the standard landing page. Signed-in users and the login/register pages are unaffected. The existing landing page is preserved and returns when this is OFF. Manage applicants in the Beta Waitlist tab. Preview at /beta-waitlist.' },
];

function FlagsSection() {
  const [flags,   setFlags]   = useState({});
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('idle');

  useEffect(() => { adminApi.featureFlags.get().then(d => setFlags(d)).catch(() => {}).finally(() => setLoading(false)); }, []);

  async function save() {
    setStatus('saving');
    try { await adminApi.featureFlags.save(flags); setStatus('saved'); setTimeout(() => setStatus('idle'), 3000); }
    catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Feature Flags</h2>
      <SectionCard>
        {FLAG_META.map((f, i) => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: i < FLAG_META.length - 1 ? `1px solid ${C.brd}` : 'none', gap: 20 }}>
            <div>
              <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{f.desc}</div>
            </div>
            <Toggle checked={!!flags[f.key]} onChange={v => setFlags(fl => ({ ...fl, [f.key]: v }))} />
          </div>
        ))}
      </SectionCard>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><SaveButton onClick={save} status={status} /></div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: AI SCREENING ENGINE (screeningEngin.md / se2.md §4) — global policy,
   run health + audit. This is the SINGLE source of truth for the AI policy; it
   renders as the "AI Policy" sub-tab of the Screening Ops section (it used to be
   buried in the Feature Flags view — moved here in se2.md Increment 1b). The
   master `aiScreening` feature flag still lives in Flags; this configures the
   engine that flag turns on.
   ════════════════════════════════════════════════════════════════════════ */

// Honest, precise descriptions of each embedding provider (se2.md §7/§19 —
// lexical TF-IDF is NOT semantic understanding; never mislabel it as such).
const AI_PROVIDER_LABELS = {
  lexical: 'lexical — in-process TF-IDF (no external calls). Lexical similarity, not semantic.',
  hashing: 'hashing — dependency-free dense hashing vectors (no external calls).',
  hosted:  'hosted — bring-your-own embedding service (server-configured base URL).',
};

function AiPolicyBanner({ tone, children }) {
  const col = tone === 'danger' ? C.red : C.ylw;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 14px', marginBottom: 14, borderRadius: 8, background: alpha(col, '14'), border: `1px solid ${alpha(col, '50')}`, fontSize: 12.5, color: C.txt, lineHeight: 1.55 }}>
      <span style={{ color: col, display: 'inline-flex', marginTop: 1 }}><Icon name="alertTriangle" size={14} /></span>
      <div>{children}</div>
    </div>
  );
}

function AiScreeningSection() {
  const [s, setS] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [runs, setRuns] = useState(null);
  const [errorCount, setErrorCount] = useState(0);
  const [flagOn, setFlagOn] = useState(null);   // master aiScreening feature flag
  const [audit, setAudit] = useState(null);     // recent UPDATE_AI_SCREENING changes
  const [status, setStatus] = useState('idle');

  const loadAudit = useCallback(() => {
    adminApi.auditLog({ action: 'UPDATE_AI_SCREENING', limit: 15 })
      .then(d => setAudit(d.logs || [])).catch(() => setAudit([]));
  }, []);

  useEffect(() => {
    adminApi.aiScreening.getSettings().then(d => { setS(d.settings); setLoadErr(false); }).catch(() => { setS(null); setLoadErr(true); });
    adminApi.aiScreening.getRuns({ limit: 20 }).then(d => { setRuns(d.runs || []); setErrorCount(d.errorCount || 0); }).catch(() => setRuns([]));
    adminApi.featureFlags.get().then(d => setFlagOn(!!d.aiScreening)).catch(() => setFlagOn(null));
    loadAudit();
  }, [loadAudit]);

  async function save() {
    setStatus('saving');
    try {
      const d = await adminApi.aiScreening.saveSettings(s);
      setS(d.settings); setStatus('saved'); setTimeout(() => setStatus('idle'), 3000);
      loadAudit(); // reflect the change we just audited
    } catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  if (loadErr) return <div style={{ padding: 24, fontSize: 13, color: C.red }}>Could not load AI screening policy. Check that you have admin access and retry.</div>;
  if (!s) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const set = (k, v) => setS(p => ({ ...p, [k]: v }));
  const setNum = (k, raw, dflt = 0) => { const v = parseFloat(raw); set(k, Number.isFinite(v) ? v : dflt); };
  const inp = { background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '6px 9px', color: C.txt, fontSize: 13, width: 160 };
  const Row = ({ label, desc, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.brd}`, gap: 20 }}>
      <div><div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{label}</div>{desc && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{desc}</div>}</div>
      {children}
    </div>
  );
  const Sub = ({ children }) => (
    <h3 style={{ fontSize: 12.5, fontWeight: 700, color: C.txt2, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '24px 0 8px' }}>{children}</h3>
  );

  return (
    <div>
      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 14px', lineHeight: 1.6, maxWidth: 760 }}>
        Authoritative global policy for the PecanRev Screening Intelligence Engine. The deterministic engine
        runs in-process with no external calls under the default <code>lexical</code> provider. AI is
        assistive only — it never finalises a screening decision. Every change here is recorded in the audit
        history below.
      </p>

      {flagOn === false && (
        <AiPolicyBanner tone="warn">
          The <strong>AI Screening Engine</strong> feature flag is currently <strong>OFF</strong> (Ops → Flags).
          These settings are saved but the engine stays inactive until the flag is enabled.
        </AiPolicyBanner>
      )}
      {s.killSwitch && (
        <AiPolicyBanner tone="danger">
          <strong>Emergency kill switch is ENGAGED.</strong> AI scoring is force-disabled everywhere,
          overriding the toggles below, until the kill switch is turned off.
        </AiPolicyBanner>
      )}

      <Sub>Global policy</Sub>
      <SectionCard>
        <Row label="AI screening enabled" desc="Master switch within the feature flag (per-project opt-in still applies).">
          <Toggle checked={!!s.enabled} onChange={v => set('enabled', v)} />
        </Row>
        <Row label="Require human final decision" desc="AI may never finalise an include/exclude. Strongly recommended on.">
          <Toggle checked={!!s.requireHumanFinalDecision} onChange={v => set('requireHumanFinalDecision', v)} />
        </Row>
        <Row label="Allow reviewers to run scoring" desc="Off = only project leaders/owners may trigger scoring.">
          <Toggle checked={!!s.allowReviewersToRun} onChange={v => set('allowReviewersToRun', v)} />
        </Row>
        <Row label="Default project policy" desc="assist = suggest only · prioritize = also reorder the queue.">
          <select value={s.defaultPolicy} onChange={e => set('defaultPolicy', e.target.value)} style={inp}>
            <option value="assist">assist</option><option value="prioritize">prioritize</option>
          </select>
        </Row>
        <Row label="Max records per run" desc="Upper bound on records scored in a single run.">
          <input type="number" min={10} max={100000} value={s.maxRecordsPerRun} onChange={e => set('maxRecordsPerRun', parseInt(e.target.value, 10) || 0)} style={inp} />
        </Row>
      </SectionCard>

      <Sub>Providers &amp; privacy</Sub>
      <SectionCard>
        <Row label="Embedding provider" desc={AI_PROVIDER_LABELS[s.embeddingProvider] || 'Similarity backend used for ranking.'}>
          <select value={s.embeddingProvider} onChange={e => set('embeddingProvider', e.target.value)} style={inp}>
            <option value="lexical">lexical</option><option value="hashing">hashing</option><option value="hosted">hosted</option>
          </select>
        </Row>
        <div style={{ padding: '12px 20px', fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
          <code>lexical</code> and <code>hashing</code> are fully in-process — no project text leaves the server.
          <code> hosted</code> sends record text to the configured embedding service; only enable it when the
          provider is permitted by your data-handling policy. Real biomedical embeddings are a later increment.
        </div>
      </SectionCard>

      <Sub>Thresholds</Sub>
      <SectionCard>
        <Row label="Include threshold" desc="Score at or above which a record is suggested for inclusion.">
          <input type="number" min={0} max={1} step={0.01} value={s.includeThreshold} onChange={e => setNum('includeThreshold', e.target.value, 0.65)} style={inp} />
        </Row>
        <Row label="Exclude threshold" desc="Score at or below which a record is suggested for exclusion.">
          <input type="number" min={0} max={1} step={0.01} value={s.excludeThreshold} onChange={e => setNum('excludeThreshold', e.target.value, 0.35)} style={inp} />
        </Row>
        <div style={{ padding: '12px 20px', fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
          These are <strong>uncalibrated</strong> default cut-offs on the raw ranking score — not calibrated
          probabilities. Calibrated probabilities and a reliability curve arrive in the calibration increment.
        </div>
      </SectionCard>

      <Sub>Live updating &amp; background jobs</Sub>
      <SectionCard>
        <Row label="Live rescoring after decisions" desc="Queue a debounced rescore when reviewers make new include/exclude decisions (se2.md §6).">
          <Toggle checked={!!s.liveUpdateEnabled} onChange={v => set('liveUpdateEnabled', v)} />
        </Row>
        <Row label="Rescore debounce (ms)" desc="Coalesce rapid decisions into one job. 500–60000 ms.">
          <input type="number" min={500} max={60000} step={500} value={s.retrainDebounceMs} onChange={e => set('retrainDebounceMs', parseInt(e.target.value, 10) || 0)} style={inp} />
        </Row>
      </SectionCard>

      <Sub>Emergency kill switch</Sub>
      <div style={{ border: `1px solid ${alpha(C.red, '50')}`, borderRadius: 10, background: alpha(C.red, '08'), overflow: 'hidden' }}>
        <Row label="Force-disable all AI scoring" desc="Immediately disables AI scoring everywhere, overriding every toggle above. Use during an incident.">
          <Toggle checked={!!s.killSwitch} onChange={v => set('killSwitch', v)} />
        </Row>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><SaveButton onClick={save} status={status} /></div>

      <Sub>Validation &amp; health — recent runs {errorCount > 0 && <span style={{ color: C.red, fontSize: 11, fontWeight: 600 }}>· {errorCount} failed</span>}</Sub>
      <SectionCard>
        {runs && runs.length === 0 && <div style={{ padding: 18, fontSize: 12.5, color: C.muted }}>No AI runs yet.</div>}
        {runs && runs.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: i < runs.length - 1 ? `1px solid ${C.brd}` : 'none', fontSize: 12 }}>
            <span style={{ fontFamily: MONO, color: r.status === 'failed' ? C.red : C.grn, width: 70 }}>{r.status}</span>
            <span style={{ color: C.txt2, width: 90 }}>{r.mode}</span>
            <span style={{ color: C.muted }}>{r.nScored} scored</span>
            {r.metrics?.auc != null && <span style={{ color: C.muted }}>· AUC {Number(r.metrics.auc).toFixed(2)}</span>}
            {r.failureReason && <span style={{ color: C.red }}>· {r.failureReason}</span>}
            <span style={{ flex: 1 }} />
            <span style={{ color: C.muted, fontFamily: MONO, fontSize: 10 }}>{r.projectId?.slice(0, 8)}</span>
          </div>
        ))}
        {!runs && <div style={{ padding: 18 }}><Spinner size={16} /></div>}
      </SectionCard>

      <Sub>Audit history — policy changes</Sub>
      <SectionCard>
        {audit && audit.length === 0 && <div style={{ padding: 18, fontSize: 12.5, color: C.muted }}>No policy changes recorded yet.</div>}
        {audit && audit.map((a, i) => {
          let changes = {};
          try { changes = JSON.parse(a.details || '{}').changes || {}; } catch { changes = {}; }
          const keys = Object.keys(changes);
          return (
            <div key={a.id} style={{ padding: '11px 18px', borderBottom: i < audit.length - 1 ? `1px solid ${C.brd}` : 'none', fontSize: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.txt, fontWeight: 600 }}>{a.admin?.name || a.admin?.email || 'admin'}</span>
                <span style={{ color: C.muted }}>{fmtAgo(a.createdAt)}</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: C.muted, fontFamily: MONO, fontSize: 10 }}>{a.ip || ''}</span>
              </div>
              <div style={{ marginTop: 4, color: C.txt2, fontSize: 11.5, fontFamily: MONO, lineHeight: 1.6 }}>
                {keys.length === 0 ? <span style={{ color: C.muted }}>no field changes</span>
                  : keys.map(k => <div key={k}>{k}: <span style={{ color: C.red }}>{String(changes[k]?.from)}</span> → <span style={{ color: C.grn }}>{String(changes[k]?.to)}</span></div>)}
              </div>
            </div>
          );
        })}
        {!audit && <div style={{ padding: 18 }}><Spinner size={16} /></div>}
      </SectionCard>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: SECURITY (unchanged)
   ════════════════════════════════════════════════════════════════════════ */

function SecuritySection() {
  const [tab,        setTab]        = useState('audit');
  const [auditRows,  setAuditRows]  = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage,  setAuditPage]  = useState(1);
  const [secRows,    setSecRows]    = useState([]);
  const [secTotal,   setSecTotal]   = useState(0);
  const [secPage,    setSecPage]    = useState(1);
  const [loading,    setLoading]    = useState(false);
  const PER_PAGE = 25;

  const loadAudit = useCallback(async p => {
    setLoading(true);
    try { const d = await adminApi.auditLog({ page: p, limit: PER_PAGE }); setAuditRows(d.logs || []); setAuditTotal(d.total || 0); }
    catch { setAuditRows([]); } finally { setLoading(false); }
  }, []);

  const loadSec = useCallback(async p => {
    setLoading(true);
    try { const d = await adminApi.securityEvents({ page: p, limit: PER_PAGE }); setSecRows(d.events || []); setSecTotal(d.total || 0); }
    catch { setSecRows([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { tab === 'audit' ? loadAudit(auditPage) : loadSec(secPage); }, [tab]);
  useEffect(() => { if (tab === 'audit') loadAudit(auditPage); }, [auditPage]);
  useEffect(() => { if (tab === 'security') loadSec(secPage); }, [secPage]);

  const typeColor = t => ({ FAILED_LOGIN: C.red, ADMIN_ACCESS_DENIED: C.ylw, RATE_LIMITED: C.acc }[t] || C.muted);

  const auditCols = [
    { key: 'createdAt', label: 'Time',    render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{fmtDateTime(v)}</span> },
    { key: 'admin',     label: 'Admin',   render: v => <span style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{v?.email || v}</span> },
    { key: 'action',    label: 'Action',  render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v}</span> },
    { key: 'entityType',label: 'Entity',  render: v => v || '—' },
    { key: 'details',   label: 'Details', render: v => <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof v === 'object' ? JSON.stringify(v) : v}>{typeof v === 'object' ? JSON.stringify(v) : (v || '—')}</span> },
  ];

  const secCols = [
    { key: 'createdAt', label: 'Time',    render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{fmtDateTime(v)}</span> },
    { key: 'type',      label: 'Type',    render: v => <Badge text={v} color={typeColor(v)} /> },
    { key: 'email',     label: 'Email',   render: v => <span style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{v || '—'}</span> },
    { key: 'ip',        label: 'IP',      render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v || '—'}</span> },
    { key: 'details',   label: 'Details', render: v => <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeof v === 'object' ? JSON.stringify(v) : (v || '—')}</span> },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Security</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.brd}` }}>
        {[['audit', 'Audit Log'], ['security', 'Security Events']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '8px 18px', background: 'transparent', border: 'none', borderBottom: tab === id ? `2px solid ${C.acc}` : '2px solid transparent', color: tab === id ? C.acc : C.txt2, fontSize: 13, fontWeight: tab === id ? 700 : 400, cursor: 'pointer', fontFamily: FONT, marginBottom: -1 }}>{label}</button>
        ))}
      </div>
      {tab === 'audit' ? (
        <SectionCard>
          <DataTable columns={auditCols} rows={auditRows} loading={loading} emptyMessage="No audit log entries." />
          <div style={{ padding: '0 14px' }}><Pagination page={auditPage} total={auditTotal} perPage={PER_PAGE} onPage={setAuditPage} /></div>
        </SectionCard>
      ) : (
        <SectionCard>
          <DataTable columns={secCols} rows={secRows} loading={loading} emptyMessage="No security events." />
          <div style={{ padding: '0 14px' }}><Pagination page={secPage} total={secTotal} perPage={PER_PAGE} onPage={setSecPage} /></div>
        </SectionCard>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: HEALTH (unchanged)
   ════════════════════════════════════════════════════════════════════════ */

function HealthSection() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await adminApi.health()); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); timer.current = setInterval(load, 30_000); return () => clearInterval(timer.current); }, [load]);

  const statusBadge = ok => ok ? <Badge text="OK" color={C.grn} /> : <Badge text="ERROR" color={C.red} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>System Health</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: C.muted }}>Auto-refreshes every 30s</span>
          <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
        </div>
      </div>
      {error && <ErrorBox msg={error} />}
      {loading && !data ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div> : data ? (
        <SectionCard>
          {[
            { label: 'Backend',     value: statusBadge(data.status === 'ok') },
            { label: 'Database',    value: statusBadge(data.db === 'ok') },
            { label: 'Environment', value: <Badge text={data.env || 'unknown'} color={data.env === 'production' ? C.ylw : C.grn} /> },
            { label: 'Version',     value: <span style={{ fontFamily: MONO, fontSize: 12 }}>{data.version || '—'}</span> },
            { label: 'Uptime',      value: <span style={{ fontFamily: MONO, fontSize: 12 }}>{data.uptime != null ? `${Math.floor(data.uptime/3600)}h ${Math.floor((data.uptime%3600)/60)}m ${Math.floor(data.uptime%60)}s` : '—'}</span> },
            { label: 'Timestamp',   value: <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{fmtDateTime(data.timestamp)}</span> },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: i < arr.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
              <span style={{ fontSize: 13, color: C.txt2, fontWeight: 500 }}>{row.label}</span>
              {row.value}
            </div>
          ))}
        </SectionCard>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   META·SIFT ADMIN SECTION
   ════════════════════════════════════════════════════════════════════════ */

const SIFT_DEFAULTS = {
  enabled: true,
  badgeText: 'BETA',
  allowNewProjects: true,
  allowImport: true,
  allowExport: true,
  allowPdfUpload: true,
  allowDuplicateDetection: true,
  allowConflictResolution: true,
  allowChat: true,
  allowSecondReview: true,
  requireTwoReviewers: true,
  minIncludeQuorum: 2,
  defaultBlindMode: false,
  maxPdfSizeMb: 25,
  maxRecordsPerProject: 10000,
  // prompt9: invite-link lifetime (Wave B2 adds it to META_SIFT_DEFAULTS +
  // coerceSettings; until then the server may drop it and this default
  // keeps the round-trip intact).
  inviteExpiryDays: 14,
  maintenanceMessage: 'Screening is currently undergoing maintenance. Please try again later.',
};

const SIFT_TABS = [
  { id: 'overview', label: 'Overview'  },
  { id: 'projects', label: 'Projects'  },
  { id: 'members',  label: 'Members'   },
  { id: 'settings', label: 'Settings'  },
  { id: 'aiPolicy', label: 'AI Policy' },
  { id: 'handoff',  label: 'Handoff'   },
  { id: 'audit',    label: 'Audit'     },
];

const siftMiniBtn = (color) => ({
  padding: '3px 8px', background: alpha(color, '18'), border: `1px solid ${alpha(color, '40')}`,
  borderRadius: 5, color, fontSize: 10, fontFamily: MONO, cursor: 'pointer',
  letterSpacing: '0.05em', fontWeight: 600,
});

function siftHandoffColor(status) {
  return ({ sent: C.grn, failed: C.red, already_exists: C.teal, pending: C.ylw }[status] || C.muted);
}

/* ── Internal screening-engine health (prompt18 unified Review Workspace) ──
   Lets ops confirm every review project has its internal META·SIFT module, and
   one-click repair any legacy project that predates auto-creation. */
function SiftWorkspaceHealth() {
  const [h, setH]           = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const [msg, setMsg]       = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setH(await adminApi.screening.getWorkspaceHealth()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const repair = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await adminApi.screening.repairWorkspaces();
      setH(r.health);
      setMsg(`Repaired — created ${r.summary?.created ?? 0} module(s).`);
    } catch (e) { setError(e.message || 'Repair failed.'); }
    finally { setBusy(false); }
  };

  const missing = h?.missingModule ?? 0;
  const healthy = !loading && !error && missing === 0;
  const dot = loading ? C.muted : error ? C.red : (healthy ? C.grn : C.gold);

  return (
    <SectionCard title="Internal Screening Engine">
      <div style={{ padding: '16px 18px' }}>
        {error && <ErrorBox msg={error} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: dot }}>
            {loading ? 'Checking…' : error ? 'Unavailable' : (healthy ? 'Healthy — every project has its screening module' : `${missing} project${missing === 1 ? '' : 's'} missing a screening module`)}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
          {[
            { label: 'Projects',    value: h?.projects,         color: C.acc },
            { label: 'With module', value: h?.withModule,       color: C.grn },
            { label: 'Missing',     value: h?.missingModule,    color: missing > 0 ? C.gold : C.muted },
            { label: 'Standalone',  value: h?.standaloneModules, color: C.muted },
          ].map(s => (
            <div key={s.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
              {loading ? <Spinner /> : <div style={{ fontSize: 22, fontWeight: 800, fontFamily: MONO, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value ?? 0}</div>}
              <div style={{ fontSize: 10, color: C.muted, marginTop: 6, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={repair} disabled={busy || loading || missing === 0}
            style={{ padding: '7px 16px', background: missing > 0 ? alpha(C.acc, '18') : 'transparent', border: `1px solid ${missing > 0 ? C.acc : C.brd2}`, borderRadius: 7, color: missing > 0 ? C.acc : C.muted, fontSize: 12, fontWeight: 600, cursor: (busy || loading || missing === 0) ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: (busy || missing === 0) ? 0.75 : 1 }}>
            {busy ? 'Repairing…' : (missing > 0 ? `Repair ${missing} now` : 'Nothing to repair')}
          </button>
          <button onClick={load} disabled={loading || busy} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
          {msg && <span style={{ fontSize: 12, color: C.grn }}>{msg}</span>}
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
          Every review project carries an internal screening module, created automatically on project creation and on first open of the Screening stage. Repair backfills any older project that predates that. <b>Standalone</b> = screening projects with no linked PecanRev project (legacy/admin-only).
        </div>
      </div>
    </SectionCard>
  );
}

/* ── (A) Overview panel ── */
function SiftOverview() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setMetrics(await adminApi.screening.getMetrics()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const m = metrics || {};
  const primary = [
    { label: 'Total Projects',  value: m.totalProjects,    color: C.acc },
    { label: 'Active',          value: m.activeProjects,   color: C.grn },
    { label: 'Archived',        value: m.archivedProjects, color: C.muted },
    { label: 'Disabled',        value: m.disabledProjects, color: C.red },
  ];
  // Counts already visualized by the funnel/donut below are NOT repeated here.
  const cards = [
    { label: 'Undecided',       value: m.undecided,          color: C.muted },
    { label: 'Handoffs Sent',   value: m.handoffSent,        color: C.grn },
    { label: 'Disputes',        value: m.totalDisputes,      color: C.gold },
    { label: 'Resolved Conf.',  value: m.resolvedConflicts,  color: C.muted },
    { label: 'Dup Groups',      value: m.totalDuplicateGroups, color: C.muted },
    { label: 'Active Members',  value: m.activeMembers,      color: C.acc },
    { label: 'PDFs',            value: m.totalPdfs,          color: C.muted },
    { label: 'Chat Msgs',      value: m.totalChatMessages,  color: C.muted },
    { label: 'New This Week',   value: m.projectsThisWeek,   color: C.teal },
  ];

  // Pipeline + completion shapes (prompt8 chart kit) — same data as before,
  // drawn instead of dumped as a flat card wall.
  const hasMetrics = !!metrics;
  const funnelStages = hasMetrics ? [
    { label: 'Records',  value: m.totalRecords, color: C.txt2 },
    { label: 'Screened', value: m.screened, color: C.acc, segments: [
      { label: 'Included', value: m.included, color: C.grn },
      { label: 'Excluded', value: m.excluded, color: C.red },
      { label: 'Maybe',    value: m.maybe,    color: C.yel },
    ] },
    { label: '2nd Review',    value: m.eligibleSecondReview, color: C.teal },
    { label: 'To Extraction', value: m.sentToExtraction,     color: C.grn },
  ] : [];
  const doneN       = m.doneProjects ?? 0;
  const inProgN     = m.inProgressProjects ?? 0;
  const totalN      = m.totalProjects ?? 0;
  const notStartedN = Math.max(0, totalN - doneN - inProgN);
  const donePct     = totalN > 0 ? Math.round((doneN / totalN) * 100) : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Module Overview</span>
        <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 14 }}>
        {primary.map(p => (
          <div key={p.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '18px 20px', minWidth: 0 }}>
            {loading ? <div style={{ height: 32, display: 'flex', alignItems: 'center' }}><Spinner /></div>
              : <div style={{ fontSize: 28, fontWeight: 800, fontFamily: MONO, color: p.color, letterSpacing: '-1px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{p.value ?? 0}</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 8, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.label}>{p.label}</div>
          </div>
        ))}
      </div>
      {/* Internal screening-engine health + repair (prompt18) */}
      <div style={{ marginBottom: 14 }}>
        <SiftWorkspaceHealth />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 14 }}>
        <SectionCard title="Screening Pipeline">
          <div style={{ padding: '16px 18px' }}>
            <FunnelBar stages={funnelStages} loading={loading} emptyLabel="No screening data yet" />
          </div>
        </SectionCard>
        <SectionCard title="Project Completion">
          <div style={{ padding: '16px 18px' }}>
            <DonutGauge
              loading={loading}
              segments={[
                { label: 'Done',        value: doneN,       color: C.grn },
                { label: 'In Progress', value: inProgN,     color: C.teal },
                { label: 'Not Started', value: notStartedN, color: C.muted },
              ]}
              centerValue={`${donePct}%`}
              centerLabel="done"
              emptyLabel="No screening projects yet"
            />
            {hasMetrics && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
                {[
                  // prompt6 Task 12 — DISTINCT projects whose status changed to
                  // 'done' in the window (done→in progress→done counts once).
                  { label: 'Done Today', value: m.doneToday },
                  { label: 'This Week',  value: m.doneThisWeek },
                  { label: 'This Month', value: m.doneThisMonth },
                ].map(d => (
                  <div key={d.label} style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: C.grn, fontVariantNumeric: 'tabular-nums' }}>{d.value ?? 0}</div>
                    <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
            {loading ? <Spinner size={12} /> : <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO, color: c.color, fontVariantNumeric: 'tabular-nums' }}>{c.value ?? 0}</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.label}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── (B) Projects panel ── */

// Normalize the expanded progress shape from GET /api/admin/screening/projects/:id
// (prompt6 Task 11). Prefers the `progress` object from the prompt6 contract and
// falls back to flat/legacy fields so the panel degrades gracefully (shows '—')
// instead of crashing on an older response shape.
function normalizeSiftProgress(d) {
  if (!d) return {};
  const p = d.progress || {};
  const total    = p.total    ?? d.totalRecords ?? d._count?.records ?? null;
  const screened = p.screened ?? d.screened ?? null;
  return {
    total,
    screened,
    unscreened:       p.unscreened ?? d.unscreened ?? (total != null && screened != null ? Math.max(0, total - screened) : null),
    included:         p.included   ?? d.included   ?? null,
    excluded:         p.excluded   ?? d.excluded   ?? null,
    maybe:            p.maybe      ?? d.maybe      ?? null,
    conflicts:        p.conflicts  ?? d.conflicts  ?? d._count?.conflicts ?? null,
    duplicates:       p.duplicates ?? d.duplicates ?? null,
    secondReview:     p.secondReview     ?? d.secondReview     ?? d.secondReviewCount ?? null,
    sentToExtraction: p.sentToExtraction ?? d.sentToExtraction ?? d.handoffSentCount  ?? null,
  };
}

// Side panel: per-project screening progress + per-member table (prompt6 Task 11).
// Opened by clicking a row in SiftProjects. workspaceId == the ScreenProject id.
function SiftProjectDetailPanel({ projectId, onClose }) {
  const [detail,  setDetail]  = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setDetail(null); setMembers([]);
    Promise.all([
      adminApi.screening.getProject(projectId),
      // The members endpoint guarantees the per-member table (name + screenedCount)
      // even when the detail response doesn't embed memberProgress.
      adminApi.screening.getMembers(projectId).catch(() => null),
    ])
      .then(([d, mem]) => {
        if (!alive) return;
        setDetail(d);
        const embedded = d?.memberProgress || d?.progress?.members;
        setMembers(Array.isArray(embedded) && embedded.length ? embedded : (mem?.members || []));
      })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  const prog = normalizeSiftProgress(detail);
  const cells = [
    { label: 'Total Records', value: prog.total,        color: C.txt2 },
    { label: 'Screened',      value: prog.screened,     color: C.acc },
    { label: 'Unscreened',    value: prog.unscreened,   color: C.muted },
    { label: 'Included',      value: prog.included,     color: C.grn },
    { label: 'Excluded',      value: prog.excluded,     color: C.red },
    { label: 'Maybe',         value: prog.maybe,        color: C.ylw },
    { label: 'Conflicts',     value: prog.conflicts,    color: C.gold },
    { label: 'Duplicates',    value: prog.duplicates,   color: C.muted },
    { label: '2nd Review',    value: prog.secondReview, color: C.teal },
    { label: 'To Extraction', value: prog.sentToExtraction, color: C.grn },
  ];

  const infoRows = detail ? [
    { label: 'Owner', value: <span style={{ fontFamily: MONO, fontSize: 11 }}>{detail.owner?.name || detail.owner?.email || '—'}</span> },
    { label: 'Linked Workspace', value: detail.linkedMetaLabProjectId
        ? <span style={{ fontSize: 11 }}>{detail.linkedMetaLabProjectTitle || '(linked, untitled)'}</span>
        : <span style={{ color: C.muted }}>not linked</span> },
    // The ScreenProject IS the shared Review Workspace — its id is the workspaceId.
    { label: 'Workspace', value: <span style={{ fontFamily: MONO, fontSize: 10, wordBreak: 'break-all' }} title={detail.id}>{detail.id}</span> },
    { label: 'Created', value: fmtDate(detail.createdAt) },
    { label: 'Updated', value: fmtAgo(detail.updatedAt) },
  ] : [];

  return (
    <div style={{ width: 320, flexShrink: 0, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', position: 'sticky', top: TOPBAR_H + 28, maxHeight: `calc(100vh - ${TOPBAR_H + 60}px)`, overflowY: 'auto' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Project Progress</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>

      {loading ? (
        <div style={{ padding: 28, textAlign: 'center' }}><Spinner /></div>
      ) : error ? (
        <div style={{ padding: 16 }}><ErrorBox msg={error} /></div>
      ) : detail && (
        <>
          <div style={{ padding: '16px 16px 12px' }}>
            <div title={detail.title || '(untitled)'} style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 6, minWidth: 0, overflowWrap: 'anywhere' }}>{detail.title || '(untitled)'}</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
              <Badge text={detail.disabled ? 'disabled' : 'active'} color={detail.disabled ? C.red : C.grn} />
              {detail.archived && <Badge text="archived" color={C.muted} />}
              {detail.progressStatus && detail.progressStatus !== 'not_started' &&
                <Badge text={detail.progressStatus.replace('_', ' ')} color={detail.progressStatus === 'done' ? C.grn : C.teal} />}
            </div>
            {infoRows.map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: `1px solid ${C.brd}` }}>
                <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>{r.label}</span>
                <span style={{ fontSize: 11, color: C.txt2, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{r.value}</span>
              </div>
            ))}
          </div>

          {/* Progress grid */}
          <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${C.brd}` }}>
            <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Screening Progress</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {cells.map(c => (
                <div key={c.label} style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: c.color }}>{c.value ?? '—'}</div>
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 3, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO }}>{c.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-member progress */}
          <div style={{ padding: '10px 16px 16px', borderTop: `1px solid ${C.brd}` }}>
            <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Member Progress ({members.length})
            </div>
            {members.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>No members.</div>
            ) : members.map((mm, i) => {
              const screened = mm.screenedCount ?? mm.screened ?? 0;
              const pct = prog.total ? Math.min(100, Math.round((screened / prog.total) * 100)) : null;
              return (
                <div key={mm.id || mm.email || i} style={{ padding: '7px 0', borderBottom: i < members.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span title={mm.name || mm.email || undefined} style={{ fontSize: 12, fontWeight: 600, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mm.name || mm.email || '—'}</span>
                    <Badge text={mm.role || 'reviewer'} color={mm.role === 'owner' ? C.acc : mm.role === 'leader' ? C.acc : mm.role === 'viewer' ? C.muted : C.teal} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>{screened} screened{pct != null ? ` · ${pct}%` : ''}</span>
                    {mm.status && mm.status !== 'active' && <Badge text={mm.status} color={mm.status === 'pending' ? C.ylw : C.muted} />}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SiftProjects() {
  const [projects, setProjects] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [selectedId, setSelectedId] = useState(null); // progress detail panel (prompt6 Task 11)
  const PER_PAGE = 25;

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError('');
    try {
      const d = await adminApi.screening.listProjects({ page: p, limit: PER_PAGE });
      setProjects(d.projects || []); setTotal(d.total || 0); setPage(p);
    } catch (e) { setError(e.message); setProjects([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(1); }, [load]);

  async function act(id, flags) {
    try { await adminApi.screening.setFlags(id, flags); load(page); }
    catch (e) { setError('Failed to update: ' + e.message); }
  }

  async function actRestore(id) {
    try { await adminApi.screening.restore(id); load(page); }
    catch (e) { setError('Failed to restore: ' + e.message); }
  }

  const cols = [
    { key: 'title',  label: 'Title', width: '17%', render: v => <span title={v || undefined} style={{ color: C.txt, fontWeight: 600, display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '—'}</span> },
    { key: 'linkedMetaLabProjectTitle', label: 'Linked Workspace', width: '14%',
      render: (v, row) => v
        ? <span title={v} style={{ fontSize: 11, display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
        : <span style={{ fontSize: 11, color: C.muted }}>{row.linkedMetaLabProjectId ? '(linked, untitled)' : '— not linked'}</span> },
    { key: 'owner',  label: 'Owner', width: '12%', render: v => <span title={v?.email || undefined} style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{v?.email || '—'}</span> },
    { key: 'recordCount', label: 'Articles', width: '7%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'memberCount', label: 'Members', width: '6%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'secondReviewCount', label: '2nd Rev', width: '6%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'handoffSentCount',  label: 'Handoff', width: '6%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: '_status', label: 'Status', width: '10%', render: (_, row) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Badge text={row.disabled ? 'disabled' : 'active'} color={row.disabled ? C.red : C.grn} />
        {row.archived && <Badge text="archived" color={C.muted} />}
        {row.progressStatus && row.progressStatus !== 'not_started' &&
          <Badge text={row.progressStatus.replace('_', ' ')} color={row.progressStatus === 'done' ? C.grn : C.teal} />}
      </div>
    )},
    // Deleted state: shows owner-deleted badge when the workspace has been soft-deleted by its owner.
    // Admin-restore is the only recovery path — surfaced in the Actions column for these rows.
    { key: '_deleted', label: 'Deleted', width: '8%', render: (_, row) => (
      row.deleted
        ? <Badge text={row.deletedSource === 'owner' ? 'owner-deleted' : 'deleted'} color={C.red} />
        : <span style={{ fontSize: 11, color: C.muted }}>—</span>
    )},
    { key: 'updatedAt', label: 'Updated', width: '8%', render: v => <span style={{ fontSize: 11 }}>{fmtAgo(v)}</span> },
    // stopPropagation: rows are clickable (progress panel) — action buttons must not toggle it.
    { key: '_actions', label: 'Actions', width: '16%', render: (_, row) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {row.deleted
          ? <button onClick={e => { e.stopPropagation(); actRestore(row.id); }} style={siftMiniBtn(C.grn)}>Restore</button>
          : <>
              {row.disabled
                ? <button onClick={e => { e.stopPropagation(); act(row.id, { disabled: false }); }} style={siftMiniBtn(C.grn)}>Enable</button>
                : <button onClick={e => { e.stopPropagation(); act(row.id, { disabled: true }); }}  style={siftMiniBtn(C.red)}>Disable</button>}
              {row.archived
                ? <button onClick={e => { e.stopPropagation(); act(row.id, { archived: false }); }} style={siftMiniBtn(C.grn)}>Unarchive</button>
                : <button onClick={e => { e.stopPropagation(); act(row.id, { archived: true }); }}  style={siftMiniBtn(C.muted)}>Archive</button>}
            </>}
      </div>
    )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Screening Projects ({total})</span>
        <button onClick={() => load(page)} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionCard>
            <DataTable columns={cols} rows={projects} loading={loading} emptyMessage="No screening projects yet."
              onRowClick={p => setSelectedId(prev => prev === p.id ? null : p.id)}
              selectedId={selectedId} />
            <div style={{ padding: '0 14px' }}>
              <Pagination page={page} total={total} perPage={PER_PAGE} onPage={load} />
            </div>
          </SectionCard>
          {!selectedId && (
            <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: -10, marginBottom: 8 }}>
              Click a row to view screening progress and member activity
            </div>
          )}
        </div>

        {selectedId && (
          <SiftProjectDetailPanel projectId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  );
}

/* ── (C) Members panel ── */
function SiftMembers() {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState('');
  const [members,  setMembers]  = useState([]);
  const [loadingP, setLoadingP] = useState(true);
  const [loadingM, setLoadingM] = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    setLoadingP(true);
    adminApi.screening.listProjects({ page: 1, limit: 100 })
      .then(d => setProjects(d.projects || []))
      .catch(e => setError(e.message))
      .finally(() => setLoadingP(false));
  }, []);

  function pick(id) {
    setSelected(id);
    if (!id) { setMembers([]); return; }
    setLoadingM(true); setError('');
    adminApi.screening.getMembers(id)
      .then(d => setMembers(d.members || []))
      .catch(e => { setError(e.message); setMembers([]); })
      .finally(() => setLoadingM(false));
  }

  const cols = [
    { key: 'name',  label: 'Name',  render: v => <span title={v || undefined} style={{ color: C.txt, fontWeight: 600, overflowWrap: 'anywhere' }}>{v || '—'}</span> },
    { key: 'email', label: 'Email', render: v => <span title={v || undefined} style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{v || '—'}</span> },
    { key: 'role',  label: 'Role',  render: v => <Badge text={v || 'reviewer'} color={v === 'leader' ? C.acc : v === 'viewer' ? C.muted : C.teal} /> },
    { key: 'status', label: 'Status', render: v => <Badge text={v || 'active'} color={v === 'active' ? C.grn : v === 'pending' ? C.ylw : C.muted} /> },
    { key: 'canScreen', label: 'Screen', render: v => v ? <span style={{ color: C.grn }}>✓</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'canChat', label: 'Chat', render: v => v ? <span style={{ color: C.grn }}>✓</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'canResolveConflicts', label: 'Resolve', render: v => v ? <span style={{ color: C.grn }}>✓</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'screenedCount', label: 'Screened', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Project Members</span>
        <select value={selected} onChange={e => pick(e.target.value)} disabled={loadingP}
          style={{ ...inputStyle, width: 'auto', minWidth: 280, padding: '7px 10px', fontSize: 12 }}>
          <option value="">{loadingP ? 'Loading projects…' : '— Select a project —'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.title} ({p.memberCount ?? 0} members)</option>)}
        </select>
      </div>
      {error && <ErrorBox msg={error} />}
      {!selected ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
          Select a project to view its members.
        </div>
      ) : (
        <SectionCard>
          <DataTable columns={cols} rows={members} loading={loadingM} emptyMessage="No members in this project." />
        </SectionCard>
      )}
    </div>
  );
}

/* ── (D) Settings panel ── */
function SiftSettings() {
  const [settings, setSettings] = useState(SIFT_DEFAULTS);
  const [loading,  setLoading]  = useState(true);
  const [status,   setStatus]   = useState('idle');
  const [error,    setError]    = useState('');

  useEffect(() => {
    adminApi.screening.getSettings()
      .then(s => setSettings({ ...SIFT_DEFAULTS, ...s }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setStatus('saving'); setError('');
    try { const s = await adminApi.screening.saveSettings(settings); setSettings({ ...SIFT_DEFAULTS, ...s }); setStatus('saved'); }
    catch (e) { setStatus('error'); setError(e.message); }
    finally { setTimeout(() => setStatus('idle'), 2500); }
  }

  const upd = (k, v) => setSettings(s => ({ ...s, [k]: v }));

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const toggles = [
    { key: 'enabled',                 label: 'Screening Enabled',        note: 'Disabling shows maintenance page and blocks /sift-beta' },
    { key: 'allowNewProjects',        label: 'New Project Creation',     note: 'Allow users to create new screening projects' },
    { key: 'allowImport',             label: 'Import (RIS/BibTeX/NBIB)', note: 'Allow reference imports' },
    { key: 'allowExport',             label: 'Export (CSV/JSON)',        note: 'Allow record exports' },
    { key: 'allowPdfUpload',          label: 'PDF Upload',               note: 'Allow full-text PDF attachments' },
    { key: 'allowChat',               label: 'Team Chat',                note: 'Allow in-project chat between members' },
    { key: 'allowDuplicateDetection', label: 'Duplicate Detection',      note: 'Run dedup algorithms' },
    { key: 'allowConflictResolution', label: 'Conflict Resolution',      note: 'Show and resolve reviewer conflicts' },
    { key: 'allowSecondReview',       label: 'Second (Full-Text) Review',note: 'Enable the two-stage full-text review' },
    { key: 'requireTwoReviewers',     label: 'Require Two Reviewers',    note: 'A single include never promotes on its own' },
    { key: 'defaultBlindMode',        label: 'Default Blind Mode',       note: 'Applied to newly created projects' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Module Settings</span>
        <SaveButton onClick={save} status={status} />
      </div>
      {error && status === 'error' && <ErrorBox msg={error} />}

      <SectionCard title="Feature Toggles">
        <div style={{ padding: '8px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {toggles.map(({ key, label, note }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: `1px solid ${C.brd}` }}>
              <div>
                <div style={{ fontSize: 12, color: C.txt, fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{note}</div>
              </div>
              <Toggle checked={!!settings[key]} onChange={v => upd(key, v)} />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Policy & Limits">
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
          <Field label="Min Include Quorum" note="Distinct includes required to reach 2nd review">
            <input type="number" min="1" value={settings.minIncludeQuorum ?? 2}
              onChange={e => upd('minIncludeQuorum', Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 140 }} />
          </Field>
          <Field label="Max PDF Size (MB)" note="1–200 MB per attachment">
            <input type="number" min="1" max="200" value={settings.maxPdfSizeMb ?? 25}
              onChange={e => upd('maxPdfSizeMb', Math.min(200, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ ...inputStyle, width: 140 }} />
          </Field>
          <Field label="Max Records / Project">
            <input type="number" min="1" value={settings.maxRecordsPerProject ?? 10000}
              onChange={e => upd('maxRecordsPerProject', Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 140 }} />
          </Field>
          <Field label="Invite Expiry (Days)" note="New invite links expire after this many days">
            <input type="number" min="1" max="90" value={settings.inviteExpiryDays ?? 14}
              onChange={e => upd('inviteExpiryDays', Math.min(90, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ ...inputStyle, width: 140 }} />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Badge Text" note="Shown next to Screening in the nav (e.g. BETA, PREVIEW, GA)">
              <input value={settings.badgeText || ''} onChange={e => upd('badgeText', e.target.value)}
                style={{ ...inputStyle, width: 200 }} />
            </Field>
            <Field label="Maintenance Message" note="Shown to users when Screening is disabled">
              <textarea value={settings.maintenanceMessage || ''} onChange={e => upd('maintenanceMessage', e.target.value)}
                rows={2} style={{ ...inputStyle, resize: 'vertical', width: '100%' }} />
            </Field>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ── (E) Handoff panel ── */
function SiftHandoff() {
  const [data,    setData]    = useState({ handoffs: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await adminApi.screening.getHandoffs()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = data.counts || {};
  const summary = [
    { label: 'Sent',           value: counts.sent,           color: C.grn },
    { label: 'Failed',         value: counts.failed,         color: C.red },
    { label: 'Already Exists', value: counts.already_exists, color: C.teal },
    { label: 'Pending',        value: counts.pending,        color: C.ylw },
  ];

  const cols = [
    { key: 'recordTitle',  label: 'Record', width: '28%', render: v => <span style={{ color: C.txt }}>{v || '(untitled)'}</span> },
    { key: 'projectTitle', label: 'Project', width: '18%', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'handoffStatus', label: 'Status', width: '12%', render: v => <Badge text={v || '—'} color={siftHandoffColor(v)} /> },
    { key: 'handoffAt',    label: 'Handoff At', width: '14%', render: (v, row) => <span style={{ fontSize: 11 }}>{fmtAgo(v || row.acceptedAt)}</span> },
    { key: 'handoffError', label: 'Error', width: '18%', render: v => v ? <span style={{ fontSize: 11, color: C.red }} title={v}>{v.slice(0, 40)}</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'finalStatus',  label: 'Final', width: '10%', render: v => v ? <Badge text={v} color={v === 'accepted' ? C.grn : C.red} /> : <span style={{ color: C.muted }}>—</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Extraction Handoff Log</span>
        <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {summary.map(s => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px' }}>
            {loading ? <Spinner size={12} /> : <div style={{ fontSize: 20, fontWeight: 700, fontFamily: MONO, color: s.color }}>{s.value ?? 0}</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO }}>{s.label}</div>
          </div>
        ))}
      </div>
      <SectionCard>
        <DataTable columns={cols} rows={data.handoffs || []} loading={loading} emptyMessage="No handoff events yet." />
      </SectionCard>
    </div>
  );
}

/* ── (F) Audit panel ── */
function SiftAudit() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const d = await adminApi.screening.getAudit(); setEntries(d.entries || []); }
    catch (e) { setError(e.message); setEntries([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const actionColor = a => {
    if (/ACCEPTED|ADDED|ON|RESOLVED|UPLOADED/.test(a || '')) return C.grn;
    if (/REJECTED|REMOVED|OFF/.test(a || '')) return C.red;
    return C.acc;
  };

  const cols = [
    { key: 'createdAt',    label: 'Time',    width: '15%', render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{fmtDateTime(v)}</span> },
    { key: 'projectTitle', label: 'Project', width: '15%', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'actorName',    label: 'Actor',   width: '15%', render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v || '—'}</span> },
    { key: 'action',       label: 'Action',  width: '15%', render: v => <Badge text={v} color={actionColor(v)} /> },
    { key: 'entityType',   label: 'Entity',  width: '10%', render: v => v || '—' },
    { key: 'details',      label: 'Details', width: '30%', render: v => <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof v === 'string' ? v : JSON.stringify(v)}>{typeof v === 'string' ? v : JSON.stringify(v || {})}</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Audit Log ({entries.length})</span>
        <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <SectionCard>
        <DataTable columns={cols} rows={entries} loading={loading} emptyMessage="No audit entries yet." />
      </SectionCard>
    </div>
  );
}

function SiftAdminSection() {
  const [tab, setTab] = useState('overview');

  const panels = {
    overview: <SiftOverview />,
    projects: <SiftProjects />,
    members:  <SiftMembers />,
    settings: <SiftSettings />,
    aiPolicy: <AiScreeningSection />,
    handoff:  <SiftHandoff />,
    audit:    <SiftAudit />,
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0, letterSpacing: '-0.02em' }}>
          Screening
          <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', background: alpha(C.teal, '18'), border: `1px solid ${alpha(C.teal, '50')}`, color: C.teal, borderRadius: 4, padding: '2px 7px', marginLeft: 10 }}>BETA</span>
        </h2>
        <p style={{ fontSize: 13, color: C.txt2, marginTop: 6, marginBottom: 0 }}>
          Manage the screening module, control feature access, and monitor usage.
        </p>
      </div>

      {/* Sub-navigation */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${C.brd}` }}>
        {SIFT_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', background: 'transparent', border: 'none',
            borderBottom: tab === t.id ? `2px solid ${C.acc}` : '2px solid transparent',
            color: tab === t.id ? C.acc : C.txt2, fontSize: 12,
            fontWeight: tab === t.id ? 700 : 400, cursor: 'pointer',
            fontFamily: FONT, marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {panels[tab]}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: RISK OF BIAS (prompt32 Task 12) — engine controls + metrics
   ════════════════════════════════════════════════════════════════════════ */

// Default robSettings shape — merged under whatever the server returns so the UI
// never reads `undefined` for a toggle (server stays the source of truth on save).
const ROB_DEFAULTS = {
  showPdfPanel: true,
  showArticleInfoTab: true,
  defaultLeftTab: 'pdf',          // 'pdf' | 'article'
  compactAssessmentCards: false,
  tools: { rob2: true, robinsI: false, quadas2: false, nos: false, custom: false },
  defaultTool: 'RoB2',            // canonical engine tool id (matches server ROB_DEFAULTS)
  defaultRequiredReviewers: 1,    // 1–5 (matches server ROB_DEFAULTS)
  allowLeaderChangeReviewers: true,
  requireConsensusBeforeComplete: false,
  allowConflictResolutionByLeader: true,
  allowOwnerOverride: true,
  requireNotesForHighOrUnclear: false,
  requireDomainJustifications: false,
  requireFinalJudgment: true,
  includeInReport: true,
  includeSummaryFigure: true,
  includeDomainTable: true,
  includeReviewerNotes: true,
  allowCsvXlsxPdfExport: true,
  logChanges: true,
  requireReasonWhenChangingCompleted: true,
  lockCompletedAssessments: false,
  allowReopenCompleted: true,
};

const ROB_TOOL_LABELS = {
  rob2: 'RoB 2 (randomised trials)',
  robinsI: 'ROBINS-I (non-randomised interventions)',
  quadas2: 'QUADAS-2 (diagnostic accuracy)',
  nos: 'Newcastle–Ottawa Scale',
  custom: 'Custom tool',
};
// The `tools` enable-flags use lowercase keys (above). `defaultTool` must store a
// CANONICAL engine tool id (the same ids in src/research-engine/rob/tools.js) so
// the engine's normalizeRobTool recognises it — hence this flag-key → canonical-id
// map for the Default Tool selector. (prompt32 follow-up: fixes a controlled-select
// mismatch where the option values were lowercase but the stored default was "RoB2".)
const ROB_TOOL_CANONICAL = { rob2: 'RoB2', robinsI: 'ROBINS-I', quadas2: 'QUADAS-2', nos: 'NOS', custom: 'custom' };

// One labelled toggle row reused across the grouped RoB settings cards.
function RobToggleRow({ label, note, checked, onChange, last = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: last ? 'none' : `1px solid ${C.brd}` }}>
      <div>
        <div style={{ fontSize: 12, color: C.txt, fontWeight: 500 }}>{label}</div>
        {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{note}</div>}
      </div>
      <Toggle checked={!!checked} onChange={onChange} />
    </div>
  );
}

function RobAdminSection() {
  const [settings, setSettings] = useState(ROB_DEFAULTS);
  const [engineEnabled, setEngineEnabled] = useState(false);
  const [metrics,  setMetrics]  = useState(null);   // null = loading/none
  const [loading,  setLoading]  = useState(true);
  const [status,   setStatus]   = useState('idle');
  const [error,    setError]    = useState('');

  useEffect(() => {
    let alive = true;
    adminApi.rob.getSettings()
      .then(d => {
        if (!alive) return;
        setSettings({ ...ROB_DEFAULTS, ...(d?.settings || {}), tools: { ...ROB_DEFAULTS.tools, ...(d?.settings?.tools || {}) } });
        setEngineEnabled(!!d?.engineEnabled);
      })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    // Metrics are best-effort — never block the settings UI or crash on absence.
    adminApi.rob.getMetrics().then(m => { if (alive) setMetrics(m || {}); }).catch(() => { if (alive) setMetrics({}); });
    return () => { alive = false; };
  }, []);

  async function save() {
    setStatus('saving'); setError('');
    try {
      const d = await adminApi.rob.saveSettings(settings);
      setSettings({ ...ROB_DEFAULTS, ...(d?.settings || {}), tools: { ...ROB_DEFAULTS.tools, ...(d?.settings?.tools || {}) } });
      setStatus('saved');
    } catch (e) { setStatus('error'); setError(e.message); }
    finally { setTimeout(() => setStatus('idle'), 2500); }
  }

  const upd     = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const updTool = (k, v) => setSettings(s => ({ ...s, tools: { ...s.tools, [k]: v } }));

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const m = metrics || {};
  const overall = m.overall || {};

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>Risk of Bias</h2>
        <SaveButton onClick={save} status={status} />
      </div>
      {error && status === 'error' && <ErrorBox msg={error} />}

      {/* Engine status — mirrors the rob_engine_v2 feature flag (read-only here) */}
      <NoticeBox
        color={engineEnabled ? C.grn : C.ylw}
        msg={engineEnabled
          ? 'RoB engine is ON. The Risk of Bias workspace is available inside projects. Turn it off by disabling the rob_engine_v2 flag in Feature Flags.'
          : 'RoB engine is OFF. Enable the rob_engine_v2 flag in Feature Flags to expose the Risk of Bias workspace. These settings still apply once it is enabled.'}
      />

      {/* Metrics — best-effort; renders zeros gracefully if absent */}
      <SectionCard title="Usage">
        <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <StatTile label="Projects Using RoB" value={m.projectsUsingRoB ?? 0} />
          <StatTile label="Total Assessments" value={m.totalAssessments ?? 0} />
          <StatTile label="Completed" value={m.completedAssessments ?? 0} color={C.grn} />
          <StatTile label="Pending" value={m.pendingAssessments ?? 0} color={C.ylw} />
          <StatTile label="Reviewer Conflicts" value={m.reviewerConflicts ?? 0} color={(m.reviewerConflicts ?? 0) > 0 ? C.red : C.txt} />
        </div>
        <div style={{ padding: '0 18px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <StatTile label="Overall — Low" value={overall.low ?? 0} color={C.grn} />
          <StatTile label="Overall — Some Concerns" value={overall.some ?? 0} color={C.ylw} />
          <StatTile label="Overall — High" value={overall.high ?? 0} color={C.red} />
        </div>
      </SectionCard>

      {/* Panels / UI */}
      <SectionCard title="Workspace & UI">
        <div style={{ padding: '8px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          <RobToggleRow label="Show PDF Panel" note="Display the study PDF beside the assessment" checked={settings.showPdfPanel} onChange={v => upd('showPdfPanel', v)} />
          <RobToggleRow label="Show Article Info Tab" note="Expose the structured article-information tab" checked={settings.showArticleInfoTab} onChange={v => upd('showArticleInfoTab', v)} />
          <RobToggleRow label="Compact Assessment Cards" note="Denser domain cards in the workspace" checked={settings.compactAssessmentCards} onChange={v => upd('compactAssessmentCards', v)} last />
          <Field label="Default Left Tab" note="Which panel opens first per study">
            <select value={settings.defaultLeftTab} onChange={e => upd('defaultLeftTab', e.target.value)} style={{ ...inputStyle, width: 200 }}>
              <option value="pdf">Study PDF</option>
              <option value="article">Article Information</option>
            </select>
          </Field>
        </div>
      </SectionCard>

      {/* Tools */}
      <SectionCard title="Tools">
        <div style={{ padding: '8px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {Object.keys(ROB_TOOL_LABELS).map((k, i, arr) => (
            <RobToggleRow key={k} label={ROB_TOOL_LABELS[k]} checked={settings.tools?.[k]} onChange={v => updTool(k, v)} last={i >= arr.length - 2} />
          ))}
        </div>
        <div style={{ padding: '6px 18px 16px' }}>
          <Field label="Default Tool" note="Pre-selected when an assessment is created">
            <select value={settings.defaultTool} onChange={e => upd('defaultTool', e.target.value)} style={{ ...inputStyle, width: 280 }}>
              {Object.keys(ROB_TOOL_LABELS).map(k => <option key={k} value={ROB_TOOL_CANONICAL[k]}>{ROB_TOOL_LABELS[k]}</option>)}
            </select>
          </Field>
        </div>
      </SectionCard>

      {/* Workflow */}
      <SectionCard title="Workflow">
        <div style={{ padding: '6px 18px 0' }}>
          <Field label="Default Required Reviewers" note="Per outcome (1–5)">
            <input type="number" min="1" max="5" value={settings.defaultRequiredReviewers ?? 2}
              onChange={e => upd('defaultRequiredReviewers', Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ ...inputStyle, width: 120 }} />
          </Field>
        </div>
        <div style={{ padding: '0 18px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          <RobToggleRow label="Leaders Can Change Reviewer Count" checked={settings.allowLeaderChangeReviewers} onChange={v => upd('allowLeaderChangeReviewers', v)} />
          <RobToggleRow label="Require Consensus Before Complete" checked={settings.requireConsensusBeforeComplete} onChange={v => upd('requireConsensusBeforeComplete', v)} />
          <RobToggleRow label="Leaders Resolve Conflicts" checked={settings.allowConflictResolutionByLeader} onChange={v => upd('allowConflictResolutionByLeader', v)} />
          <RobToggleRow label="Owner Override" note="Owner may override domain & overall judgements" checked={settings.allowOwnerOverride} onChange={v => upd('allowOwnerOverride', v)} />
          <RobToggleRow label="Require Notes for High / Unclear" checked={settings.requireNotesForHighOrUnclear} onChange={v => upd('requireNotesForHighOrUnclear', v)} />
          <RobToggleRow label="Require Domain Justifications" checked={settings.requireDomainJustifications} onChange={v => upd('requireDomainJustifications', v)} />
          <RobToggleRow label="Require Final Judgment" note="Overall judgement must be set to complete" checked={settings.requireFinalJudgment} onChange={v => upd('requireFinalJudgment', v)} last />
        </div>
      </SectionCard>

      {/* Export / Report */}
      <SectionCard title="Report & Export">
        <div style={{ padding: '8px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          <RobToggleRow label="Include RoB in Report" checked={settings.includeInReport} onChange={v => upd('includeInReport', v)} />
          <RobToggleRow label="Include Summary Figure" note="Traffic-light / robvis plot" checked={settings.includeSummaryFigure} onChange={v => upd('includeSummaryFigure', v)} />
          <RobToggleRow label="Include Domain Table" checked={settings.includeDomainTable} onChange={v => upd('includeDomainTable', v)} />
          <RobToggleRow label="Include Reviewer Notes" checked={settings.includeReviewerNotes} onChange={v => upd('includeReviewerNotes', v)} />
          <RobToggleRow label="Allow CSV / XLSX / PDF Export" checked={settings.allowCsvXlsxPdfExport} onChange={v => upd('allowCsvXlsxPdfExport', v)} last />
        </div>
      </SectionCard>

      {/* Audit / Safety */}
      <SectionCard title="Audit & Safety">
        <div style={{ padding: '8px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          <RobToggleRow label="Log Changes" note="Record an audit entry on every edit" checked={settings.logChanges} onChange={v => upd('logChanges', v)} />
          <RobToggleRow label="Require Reason When Changing Completed" checked={settings.requireReasonWhenChangingCompleted} onChange={v => upd('requireReasonWhenChangingCompleted', v)} />
          <RobToggleRow label="Lock Completed Assessments" note="Completed assessments become read-only" checked={settings.lockCompletedAssessments} onChange={v => upd('lockCompletedAssessments', v)} />
          <RobToggleRow label="Allow Reopen Completed" checked={settings.allowReopenCompleted} onChange={v => upd('allowReopenCompleted', v)} last />
        </div>
      </SectionCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><SaveButton onClick={save} status={status} /></div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: ONBOARDING (prompt32 Task 7) — behaviour + questions manager
   ════════════════════════════════════════════════════════════════════════ */

const ONBOARDING_TYPES = [
  { value: 'text',          label: 'Text' },
  { value: 'single_select', label: 'Single select' },
  { value: 'multi_select',  label: 'Multi select' },
  { value: 'boolean',       label: 'Yes / No' },
  { value: 'number',        label: 'Number' },
  { value: 'date',          label: 'Date' },
];
const ONBOARDING_TYPE_LABEL = t => (ONBOARDING_TYPES.find(o => o.value === t)?.label || t);
const ONBOARDING_NEEDS_OPTIONS = t => t === 'single_select' || t === 'multi_select';

const blankOnbForm = () => ({
  prompt: '', description: '', type: 'text',
  options: [{ value: '', label: '' }],
  isRequired: false, allowSkip: true, displayOrder: 0,
});

// Renders how a question would appear to a user — used by both the create form
// preview and each row's "Preview" expander. Read-only / inert.
function OnboardingPreview({ q }) {
  const opts = (q.options || []).filter(o => o && (o.value || o.label));
  return (
    <div style={{ background: C.surf, border: `1px dashed ${C.brd2}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>
        {q.prompt || <span style={{ color: C.muted }}>Question prompt…</span>}
        {q.isRequired && <span style={{ color: C.red, marginLeft: 4 }}>*</span>}
      </div>
      {q.description && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{q.description}</div>}
      <div style={{ marginTop: 8 }}>
        {q.type === 'text' && <input disabled placeholder="Free text answer" style={{ ...inputStyle, opacity: 0.7 }} />}
        {q.type === 'number' && <input disabled type="number" placeholder="0" style={{ ...inputStyle, width: 160, opacity: 0.7 }} />}
        {q.type === 'date' && <input disabled type="date" style={{ ...inputStyle, width: 200, opacity: 0.7 }} />}
        {q.type === 'boolean' && (
          <div style={{ display: 'flex', gap: 8 }}>
            {['Yes', 'No'].map(b => <span key={b} style={{ padding: '6px 16px', border: `1px solid ${C.brd2}`, borderRadius: 7, fontSize: 12, color: C.txt2 }}>{b}</span>)}
          </div>
        )}
        {ONBOARDING_NEEDS_OPTIONS(q.type) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {opts.length ? opts.map((o, i) => (
              <span key={i} style={{ padding: '6px 14px', border: `1px solid ${C.brd2}`, borderRadius: q.type === 'multi_select' ? 6 : 16, fontSize: 12, color: C.txt2 }}>
                {o.label || o.value}
              </span>
            )) : <span style={{ fontSize: 12, color: C.muted }}>No options defined.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Value/label option-row editor for *_select question types (create + edit).
function OnboardingOptionsEditor({ options, onChange }) {
  const rows = options && options.length ? options : [{ value: '', label: '' }];
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => onChange([...rows, { value: '', label: '' }]);
  const del = i => onChange(rows.filter((_, j) => j !== i).length ? rows.filter((_, j) => j !== i) : [{ value: '', label: '' }]);
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input value={r.value} onChange={e => set(i, 'value', e.target.value)} placeholder="value" style={{ ...inputStyle, flex: 1 }} />
          <input value={r.label} onChange={e => set(i, 'label', e.target.value)} placeholder="label" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={() => del(i)} title="Remove option" style={{ background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.muted, cursor: 'pointer', padding: '0 10px', fontFamily: FONT }}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      <button onClick={add} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px dashed ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', padding: '6px 12px', fontFamily: FONT, marginTop: 2 }}>
        <Icon name="plus" size={12} /> Add option
      </button>
    </div>
  );
}

/* prompt36 Task 6 — onboarding ANALYTICS view. Aggregate counts + percentages are
   shown by default; individual answer VALUES live only in the drill-down modal and
   stay hidden until an admin explicitly clicks "Show answers" (privacy). */
function onbFmtTs(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}
function OnbStackBar({ answered, skipped, pending }) {
  const total = Math.max(1, (answered || 0) + (skipped || 0) + (pending || 0));
  const seg = (n, color, title) => (n > 0
    ? <div title={`${title}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: color, height: '100%' }} />
    : null);
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: alpha(C.muted, 0.14), minWidth: 90 }}>
      {seg(answered, C.grn, 'Answered')}
      {seg(skipped, C.ylw, 'Skipped')}
      {seg(pending, alpha(C.muted, 0.45), 'Pending')}
    </div>
  );
}
function OnbLegend() {
  const dot = (c) => <span style={{ width: 9, height: 9, borderRadius: 2, background: c, display: 'inline-block' }} />;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 10.5, fontFamily: MONO, color: C.muted }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{dot(C.grn)} answered</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{dot(C.ylw)} skipped</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{dot(alpha(C.muted, 0.45))} pending</span>
    </div>
  );
}

function OnboardingAnalytics() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [drill, setDrill]     = useState(null); // { kind:'question'|'user', id, label }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await adminApi.onboarding.analytics()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;
  if (error) return <ErrorBox msg={error} />;
  if (!data) return null;
  const o = data.overview || {};
  const questions = data.questions || [];
  const users = data.users || [];
  const n = (v) => (v ?? 0).toLocaleString();

  const exportCsv = () => {
    const head = ['key', 'prompt', 'active', 'required', 'answered', 'skipped', 'pending', 'answered_pct', 'skipped_pct', 'pending_pct', 'last_answered', 'last_skipped'];
    const rows = questions.map(q => [q.key, q.prompt, q.isActive, q.isRequired, q.answered, q.skipped, q.pending, q.answeredPct, q.skippedPct, q.pendingPct, q.lastAnsweredAt || '', q.lastSkippedAt || '']);
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'onboarding-analytics.csv';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { /* best-effort */ }
  };

  const smallBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Overview */}
      <SectionCard title="Overview" action={<button onClick={load} style={smallBtn}><Icon name="refresh" size={12} /> Refresh</button>}>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatTile label="Questions" value={n(o.totalQuestions)} sub={`${n(o.activeQuestions)} active`} />
          <StatTile label="Users" value={n(o.totalUsers)} sub="registered" color={C.acc2} />
          <StatTile label="Assigned" value={n(o.totalAssignedResponses)} sub="active × users" />
          <StatTile label="Answered" value={n(o.answered)} color={C.grn} />
          <StatTile label="Skipped" value={n(o.skipped)} color={C.ylw} />
          <StatTile label="Pending" value={n(o.pending)} color={C.muted} />
          <StatTile label="Completed users" value={n(o.completedUsers)} color={C.acc} sub={`${o.completedUserRate ?? 0}% of users`} />
        </div>
        <div style={{ padding: '4px 18px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 22 }}>
          <PercentCard value={o.answered || 0} total={o.totalAssignedResponses || 0} label="completion rate" color={C.grn} suffix="responses" />
          <PercentCard value={o.skipped || 0} total={o.totalAssignedResponses || 0} label="skip rate" color={C.ylw} />
          <PercentCard value={o.pending || 0} total={o.totalAssignedResponses || 0} label="pending rate" color={C.muted} />
        </div>
        {data.denominatorNote && (
          <div style={{ padding: '0 18px 16px', fontSize: 11, color: C.muted, fontFamily: MONO, lineHeight: 1.55 }}>
            <Icon name="info" size={11} /> {data.denominatorNote}
          </div>
        )}
      </SectionCard>

      {/* Per-question */}
      <SectionCard
        title={`Per-question (${questions.length})`}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <OnbLegend />
            <button onClick={exportCsv} style={smallBtn}><Icon name="download" size={12} /> Export CSV</button>
          </div>
        }
      >
        {questions.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No onboarding questions yet.</div>
        ) : questions.map((q, idx) => (
          <div key={q.id} style={{ padding: '14px 18px', borderBottom: idx < questions.length - 1 ? `1px solid ${C.brd}` : 'none', opacity: q.isActive ? 1 : 0.62 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{q.prompt}</span>
                  {q.isRequired && <Badge text="Required" color={C.red} />}
                  {!q.isActive && <Badge text="Inactive" color={C.ylw} />}
                  {q.allowSkip && q.isActive && <Badge text="Skippable" color={C.muted} />}
                </div>
                <div style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, marginTop: 5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>key: {q.key || '—'}</span>
                  <span>last answered: {onbFmtTs(q.lastAnsweredAt)}</span>
                  <span>last skipped: {onbFmtTs(q.lastSkippedAt)}</span>
                </div>
              </div>
              <div style={{ width: 200, maxWidth: '100%' }}>
                <OnbStackBar answered={q.answered} skipped={q.skipped} pending={q.pending} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: MONO, marginTop: 6 }}>
                  <span style={{ color: C.grn }}>{q.answered} · {q.answeredPct}%</span>
                  <span style={{ color: C.ylw }}>{q.skipped} · {q.skippedPct}%</span>
                  <span style={{ color: C.muted }}>{q.pending} · {q.pendingPct}%</span>
                </div>
              </div>
              <button onClick={() => setDrill({ kind: 'question', id: q.id, label: q.prompt })} style={smallBtn}>Details</button>
            </div>
          </div>
        ))}
      </SectionCard>

      {/* User-level */}
      <SectionCard title={`Users with onboarding activity${data.usersTruncated ? ` (showing ${users.length})` : ` (${users.length})`}`}>
        {users.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No users have answered or skipped a question yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['User', 'Answered', 'Skipped', 'Pending', 'Completion', ''].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 0 ? 'left' : i === 5 ? 'right' : 'center', padding: '9px 14px', fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${alpha(C.brd, 0.6)}` }}>
                    <td style={{ padding: '9px 14px', minWidth: 0 }}>
                      <div style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{u.name || '—'}</div>
                      <div style={{ color: C.muted, fontFamily: MONO, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{u.email || '—'}</div>
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'center', color: C.grn, fontFamily: MONO }}>{u.answered}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'center', color: C.ylw, fontFamily: MONO }}>{u.skipped}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'center', color: C.muted, fontFamily: MONO }}>{u.pending}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'center', fontFamily: MONO, color: u.complete ? C.grn : C.txt2 }}>{u.completionPct}%{u.complete ? ' ✓' : ''}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                      <button onClick={() => setDrill({ kind: 'user', id: u.id, label: u.name || u.email })} style={smallBtn}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.usersTruncated && (
          <div style={{ padding: '10px 18px', fontSize: 11, color: C.muted, fontFamily: MONO }}>
            Showing the {users.length} users with the most pending questions. Use a per-question drill-down for the full picture.
          </div>
        )}
      </SectionCard>

      {drill && <OnboardingDrillModal drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function OnboardingDrillModal({ drill, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [showAnswers, setShowAnswers] = useState(false);
  const [tab, setTab]         = useState('answered'); // question kind: answered|skipped|pending

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    const p = drill.kind === 'question' ? adminApi.onboarding.questionAnalytics(drill.id) : adminApi.onboarding.userStatus(drill.id);
    p.then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [drill]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const smallBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
  const userRow = (u, right) => (
    <div key={u.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: `1px solid ${alpha(C.brd, 0.5)}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</div>
        <div style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || '—'}</div>
      </div>
      <div style={{ fontSize: 11, color: C.txt2, fontFamily: MONO, flexShrink: 0, textAlign: 'right' }}>{right}</div>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Onboarding drill-down" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: alpha('#000', 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, width: 620, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{drill.kind === 'question' ? 'Question drill-down' : 'User onboarding status'}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{drill.label}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ ...smallBtn, padding: '6px 10px' }}>✕</button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto' }}>
          {loading ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner size={18} /></div>
            : error ? <ErrorBox msg={error} />
            : !data ? null
            : drill.kind === 'question' ? (() => {
              const lists = { answered: data.answeredUsers || [], skipped: data.skippedUsers || [], pending: data.pendingUsers || [] };
              const q = data.question || {};
              return (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                    {[['answered', `Answered (${q.answered ?? lists.answered.length})`, C.grn], ['skipped', `Skipped (${q.skipped ?? lists.skipped.length})`, C.ylw], ['pending', `Pending (${data.pendingCount ?? lists.pending.length})`, C.muted]].map(([k, label, color]) => (
                      <button key={k} onClick={() => setTab(k)} style={{ ...smallBtn, background: tab === k ? alpha(color, 0.14) : 'transparent', borderColor: tab === k ? alpha(color, 0.5) : C.brd2, color: tab === k ? color : C.txt2 }}>{label}</button>
                    ))}
                    <div style={{ flex: 1 }} />
                    {tab === 'answered' && lists.answered.some(u => u.answer != null) && (
                      <button onClick={() => setShowAnswers(s => !s)} style={smallBtn}>{showAnswers ? 'Hide answers' : 'Show answers'}</button>
                    )}
                  </div>
                  {tab === 'answered' && !showAnswers && lists.answered.some(u => u.answer != null) && (
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontStyle: 'italic' }}>Answer values are hidden. Click “Show answers” to reveal them.</div>
                  )}
                  {lists[tab].length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: C.muted, fontSize: 12.5 }}>No users in this group.</div>
                  ) : lists[tab].map(u => userRow(u,
                    tab === 'answered' ? (showAnswers ? (u.answer ?? '—') : onbFmtTs(u.answeredAt))
                      : tab === 'skipped' ? onbFmtTs(u.skippedAt) : 'pending'))}
                  {tab === 'pending' && data.pendingTruncated && (
                    <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginTop: 8 }}>Showing the first {lists.pending.length} of {data.pendingCount} pending users.</div>
                  )}
                </>
              );
            })() : (() => {
              const items = data.items || [];
              const c = data.counts || {};
              const statusColor = { answered: C.grn, skipped: C.ylw, pending: C.muted, not_assigned: C.dim };
              const anyAnswers = items.some(i => i.answer != null);
              return (
                <>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14, fontSize: 11.5, fontFamily: MONO }}>
                    <span style={{ color: C.grn }}>answered {c.answered ?? 0}</span>
                    <span style={{ color: C.ylw }}>skipped {c.skipped ?? 0}</span>
                    <span style={{ color: C.muted }}>pending {c.pending ?? 0}</span>
                    <span style={{ color: C.txt2 }}>completion {c.completionPct ?? 0}%</span>
                    <div style={{ flex: 1 }} />
                    {anyAnswers && <button onClick={() => setShowAnswers(s => !s)} style={smallBtn}>{showAnswers ? 'Hide answers' : 'Show answers'}</button>}
                  </div>
                  {items.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: C.muted, fontSize: 12.5 }}>No questions.</div>
                  ) : items.map(it => (
                    <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: `1px solid ${alpha(C.brd, 0.5)}` }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.prompt}</div>
                        {it.status === 'answered' && it.answer != null && (
                          <div style={{ fontSize: 11, color: C.txt2, fontFamily: MONO, marginTop: 3 }}>{showAnswers ? `↳ ${it.answer}` : '↳ (answer hidden)'}</div>
                        )}
                      </div>
                      <span style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 700, color: statusColor[it.status] || C.muted, flexShrink: 0, textTransform: 'uppercase' }}>{it.status.replace('_', ' ')}</span>
                    </div>
                  ))}
                </>
              );
            })()}
        </div>
      </div>
    </div>
  );
}

function OnboardingSection() {
  // Behaviour settings
  const [beh,        setBeh]        = useState({ enabled: false, introTitle: '', introBody: '' });
  const [behStatus,  setBehStatus]  = useState('idle');
  // Questions
  const [questions,  setQuestions]  = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  // Create form
  const [creating,   setCreating]   = useState(false);
  const [form,       setForm]       = useState(blankOnbForm());
  const [createBusy, setCreateBusy] = useState(false);
  // Per-row UI state
  const [editId,     setEditId]     = useState(null);
  const [editForm,   setEditForm]   = useState(null);
  const [editBusy,   setEditBusy]   = useState(false);
  const [previewId,  setPreviewId]  = useState(null);
  const [confirm,    setConfirm]    = useState(null);   // { kind:'reset'|'delete', q }
  const [view,       setView]       = useState('manage'); // prompt36 Task 6 — 'manage' | 'analytics'

  const loadQuestions = useCallback(async () => {
    try {
      const d = await adminApi.onboarding.list();
      setQuestions((d?.questions || []).slice().sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)));
      setTotalUsers(d?.totalUsers ?? 0);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      adminApi.onboarding.getSettings().then(s => { if (alive) setBeh({ enabled: !!s?.enabled, introTitle: s?.introTitle || '', introBody: s?.introBody || '' }); }).catch(e => { if (alive) setError(e.message); }),
      loadQuestions(),
    ]).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadQuestions]);

  async function saveBehaviour() {
    setBehStatus('saving'); setError('');
    try { await adminApi.onboarding.saveSettings(beh); setBehStatus('saved'); }
    catch (e) { setBehStatus('error'); setError(e.message); }
    finally { setTimeout(() => setBehStatus('idle'), 2500); }
  }

  // Normalise a form payload for create/update — strip empty option rows.
  const cleanPayload = f => ({
    prompt: f.prompt,
    description: f.description,
    type: f.type,
    options: ONBOARDING_NEEDS_OPTIONS(f.type) ? (f.options || []).filter(o => o.value || o.label) : [],
    isRequired: !!f.isRequired,
    allowSkip: !!f.allowSkip,
    displayOrder: Number.isFinite(f.displayOrder) ? f.displayOrder : 0,
  });

  async function createQuestion() {
    if (!form.prompt.trim()) { setError('A prompt is required.'); return; }
    setCreateBusy(true); setError('');
    try {
      // Honor an explicit Display Order from the form; default (0) appends to the end.
      await adminApi.onboarding.create({ ...cleanPayload(form), isActive: true, displayOrder: form.displayOrder || questions.length });
      setForm(blankOnbForm()); setCreating(false);
      await loadQuestions();
    } catch (e) { setError(e.message); }
    finally { setCreateBusy(false); }
  }

  async function patchQuestion(id, body) {
    setError('');
    try { await adminApi.onboarding.update(id, body); await loadQuestions(); }
    catch (e) { setError(e.message); }
  }

  function startEdit(q) {
    setEditId(q.id);
    setEditForm({
      prompt: q.prompt || '', description: q.description || '', type: q.type,
      options: (q.options && q.options.length ? q.options : [{ value: '', label: '' }]),
      isRequired: !!q.isRequired, allowSkip: !!q.allowSkip,
      displayOrder: q.displayOrder ?? 0,
    });
  }
  async function saveEdit() {
    if (!editForm.prompt.trim()) { setError('A prompt is required.'); return; }
    setEditBusy(true); setError('');
    try { await adminApi.onboarding.update(editId, cleanPayload(editForm)); setEditId(null); setEditForm(null); await loadQuestions(); }
    catch (e) { setError(e.message); }
    finally { setEditBusy(false); }
  }

  // Move a question up/down — POST the full reordered id list.
  async function move(idx, dir) {
    const next = idx + dir;
    if (next < 0 || next >= questions.length) return;
    const order = questions.map(q => q.id);
    [order[idx], order[next]] = [order[next], order[idx]];
    // Optimistic local reorder for snappy UX; reload confirms server truth.
    setQuestions(qs => { const c = qs.slice(); [c[idx], c[next]] = [c[next], c[idx]]; return c; });
    try { await adminApi.onboarding.reorder(order); await loadQuestions(); }
    catch (e) { setError(e.message); await loadQuestions(); }
  }

  async function doConfirm() {
    const { kind, q } = confirm;
    setConfirm(null); setError('');
    try {
      if (kind === 'reset') await adminApi.onboarding.reset(q.id);    // no userId ⇒ ALL users
      else if (kind === 'delete') await adminApi.onboarding.remove(q.id);
      await loadQuestions();
    } catch (e) { setError(e.message); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const iconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontFamily: FONT };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '0 0 18px' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>Onboarding</h2>
        {/* prompt36 Task 6 — Manage (questions/behaviour) vs Analytics segmented toggle */}
        <div style={{ display: 'inline-flex', background: C.bg, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: 3, gap: 3 }}>
          {[['manage', 'Manage'], ['analytics', 'Analytics']].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600,
              background: view === v ? C.acc2 : 'transparent', color: view === v ? C.accText : C.txt2,
            }}>{label}</button>
          ))}
        </div>
      </div>
      {error && <ErrorBox msg={error} />}

      {view === 'analytics' ? <OnboardingAnalytics /> : (<>
      {/* Behaviour */}
      <SectionCard title="Behaviour" action={<SaveButton onClick={saveBehaviour} status={behStatus} />}>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 14, marginBottom: 14, borderBottom: `1px solid ${C.brd}` }}>
            <div>
              <div style={{ fontSize: 12, color: C.txt, fontWeight: 500 }}>Onboarding Enabled</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>When on, users who have not completed onboarding are prompted at login.</div>
            </div>
            <Toggle checked={beh.enabled} onChange={v => setBeh(b => ({ ...b, enabled: v }))} />
          </div>
          <Field label="Intro Title" note="Heading shown at the top of the onboarding flow">
            <input value={beh.introTitle} onChange={e => setBeh(b => ({ ...b, introTitle: e.target.value }))} style={inputStyle} placeholder="Welcome to PecanRev" />
          </Field>
          <Field label="Intro Body" note="Short description shown under the title">
            <textarea value={beh.introBody} onChange={e => setBeh(b => ({ ...b, introBody: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Tell us a little about your work so we can tailor your experience." />
          </Field>
        </div>
      </SectionCard>

      {/* Questions */}
      <SectionCard
        title={`Questions (${questions.length})`}
        action={
          <button onClick={() => { setCreating(c => !c); setForm(blankOnbForm()); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: creating ? 'transparent' : C.acc2, border: creating ? `1px solid ${C.brd2}` : 'none', borderRadius: 7, color: creating ? C.txt2 : C.accText, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
            {creating ? 'Cancel' : <><Icon name="plus" size={12} /> New Question</>}
          </button>
        }
      >
        {/* Create form */}
        {creating && (
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.brd}`, background: alpha(C.acc, '06') }}>
            <Field label="Prompt">
              <input value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} style={inputStyle} placeholder="What is your primary research field?" />
            </Field>
            <Field label="Description" note="Optional helper text">
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
              <Field label="Type">
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                  {ONBOARDING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Display Order">
                <input type="number" value={form.displayOrder} onChange={e => setForm(f => ({ ...f, displayOrder: parseInt(e.target.value) || 0 }))} style={inputStyle} />
              </Field>
            </div>
            {ONBOARDING_NEEDS_OPTIONS(form.type) && (
              <Field label="Options">
                <OnboardingOptionsEditor options={form.options} onChange={o => setForm(f => ({ ...f, options: o }))} />
              </Field>
            )}
            <div style={{ display: 'flex', gap: 24, margin: '4px 0 16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt, cursor: 'pointer' }}>
                <Toggle checked={form.isRequired} onChange={v => setForm(f => ({ ...f, isRequired: v }))} /> Required
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt, cursor: 'pointer' }}>
                <Toggle checked={form.allowSkip} onChange={v => setForm(f => ({ ...f, allowSkip: v }))} /> Allow skip
              </label>
            </div>
            <Field label="Preview"><OnboardingPreview q={form} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => { setCreating(false); setForm(blankOnbForm()); }} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={createQuestion} disabled={createBusy} style={{ padding: '8px 18px', background: C.acc2, border: 'none', borderRadius: 7, color: C.accText, fontSize: 13, fontWeight: 600, cursor: createBusy ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: createBusy ? 0.6 : 1 }}>
                {createBusy ? 'Creating…' : 'Create Question'}
              </button>
            </div>
          </div>
        )}

        {/* Question list */}
        {questions.length === 0 && !creating ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No onboarding questions yet.</div>
        ) : questions.map((q, idx) => {
          const c = q.counts || {};
          const isEditing = editId === q.id;
          return (
            <div key={q.id} style={{ padding: '14px 18px', borderBottom: idx < questions.length - 1 ? `1px solid ${C.brd}` : 'none', opacity: q.isActive ? 1 : 0.62 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Reorder */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up" style={{ ...iconBtn, width: 24, height: 22, opacity: idx === 0 ? 0.35 : 1 }}>
                    <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevronDown" size={12} /></span>
                  </button>
                  <button onClick={() => move(idx, 1)} disabled={idx === questions.length - 1} title="Move down" style={{ ...iconBtn, width: 24, height: 22, opacity: idx === questions.length - 1 ? 0.35 : 1 }}>
                    <Icon name="chevronDown" size={12} />
                  </button>
                </div>
                {/* Body */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{q.prompt}</span>
                    <Badge text={ONBOARDING_TYPE_LABEL(q.type)} color={C.acc} />
                    {q.isRequired && <Badge text="Required" color={C.red} />}
                    {q.allowSkip && <Badge text="Skippable" color={C.muted} />}
                    {!q.isActive && <Badge text="Inactive" color={C.ylw} />}
                  </div>
                  {q.description && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{q.description}</div>}
                  <div style={{ fontSize: 11, fontFamily: MONO, color: C.muted, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span>key: {q.key || '—'}</span>
                    <span style={{ color: C.grn }}>answered {c.answered ?? 0}</span>
                    <span style={{ color: C.ylw }}>skipped {c.skipped ?? 0}</span>
                    <span>pending {c.pending ?? 0}</span>
                    <span>of {totalUsers} users</span>
                  </div>
                </div>
                {/* Quick toggles + actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, cursor: 'pointer' }} title="Active">
                    <Toggle checked={q.isActive} onChange={v => patchQuestion(q.id, { isActive: v })} />
                  </label>
                  <button onClick={() => setPreviewId(p => (p === q.id ? null : q.id))} title="Preview" style={iconBtn}><Icon name="eye" size={14} /></button>
                  <button onClick={() => startEdit(q)} title="Edit" style={iconBtn}><Icon name="pencil" size={13} /></button>
                  <button onClick={() => setConfirm({ kind: 'reset', q })} title="Reset all responses" style={iconBtn}><Icon name="refresh" size={13} /></button>
                  <button onClick={() => setConfirm({ kind: 'delete', q })} title="Delete" style={{ ...iconBtn, color: C.red, borderColor: alpha(C.red, '40') }}><Icon name="trash" size={13} /></button>
                </div>
              </div>

              {/* Preview expander */}
              {previewId === q.id && !isEditing && (
                <div style={{ marginTop: 12, marginLeft: 36 }}><OnboardingPreview q={q} /></div>
              )}

              {/* Inline edit */}
              {isEditing && editForm && (
                <div style={{ marginTop: 12, marginLeft: 36, padding: '14px 16px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8 }}>
                  <Field label="Prompt"><input value={editForm.prompt} onChange={e => setEditForm(f => ({ ...f, prompt: e.target.value }))} style={inputStyle} /></Field>
                  <Field label="Description"><input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} /></Field>
                  <Field label="Type">
                    <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))} style={{ ...inputStyle, width: 240 }}>
                      {ONBOARDING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                  {ONBOARDING_NEEDS_OPTIONS(editForm.type) && (
                    <Field label="Options"><OnboardingOptionsEditor options={editForm.options} onChange={o => setEditForm(f => ({ ...f, options: o }))} /></Field>
                  )}
                  <div style={{ display: 'flex', gap: 24, margin: '4px 0 16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt, cursor: 'pointer' }}>
                      <Toggle checked={editForm.isRequired} onChange={v => setEditForm(f => ({ ...f, isRequired: v }))} /> Required
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt, cursor: 'pointer' }}>
                      <Toggle checked={editForm.allowSkip} onChange={v => setEditForm(f => ({ ...f, allowSkip: v }))} /> Allow skip
                    </label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button onClick={() => { setEditId(null); setEditForm(null); }} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
                    <button onClick={saveEdit} disabled={editBusy} style={{ padding: '8px 18px', background: C.acc2, border: 'none', borderRadius: 7, color: C.accText, fontSize: 13, fontWeight: 600, cursor: editBusy ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: editBusy ? 0.6 : 1 }}>
                      {editBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </SectionCard>
      </>)}

      <ConfirmModal
        open={!!confirm}
        title={confirm?.kind === 'delete' ? 'Delete question?' : 'Reset responses?'}
        message={confirm?.kind === 'delete'
          ? `Permanently delete “${confirm?.q?.prompt}” and all its responses. This cannot be undone.`
          : `Clear ALL user responses to “${confirm?.q?.prompt}”. Users will be asked this question again. This cannot be undone.`}
        confirmLabel={confirm?.kind === 'delete' ? 'Delete' : 'Reset'}
        danger
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   BETA WAITLIST (prompt48) — admin-only management of the strictly-separate
   waitlist DB. All numbers come from real records; empty data → empty states.
   ════════════════════════════════════════════════════════════════════════ */

const WL_PAGE = 25;
const WL_STATUS_COLOR = { WAITLISTED: C.acc, UNDER_REVIEW: C.yel, INVITED: C.purp, ACCEPTED: C.grn, DECLINED: C.red, REMOVED: C.muted };
const WL_STATUS_BG = { WAITLISTED: C.accBg, UNDER_REVIEW: C.yelBg, INVITED: C.purpBg, ACCEPTED: C.grnBg, DECLINED: C.redBg, REMOVED: C.card2 };
const WL_EMAIL_COLOR = { sent: C.grn, failed: C.red, pending: C.yel, queued: C.yel, skipped: C.muted };
const WL_EMAIL_STATUSES = ['sent', 'failed', 'pending', 'queued', 'skipped'];

const wlFmtDate = (d) => { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
const wlFmtDateTime = (d) => { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

const wlInput = { height: 34, boxSizing: 'border-box', padding: '0 10px', fontSize: 12.5, fontFamily: FONT, color: C.txt, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, outline: 'none' };
const wlSelect = { ...wlInput, appearance: 'none', paddingRight: 22, cursor: 'pointer' };
const wlBtn = { height: 34, padding: '0 13px', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, borderRadius: 7, cursor: 'pointer', border: `1px solid ${C.brd2}`, background: C.card, color: C.txt, display: 'inline-flex', alignItems: 'center', gap: 6 };

function WlBadge({ status }) {
  const color = WL_STATUS_COLOR[status] || C.muted;
  const bg = WL_STATUS_BG[status] || C.card2;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, color, background: bg, border: `1px solid ${alpha(color, '40')}`, fontFamily: FONT, whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {WAITLIST_STATUS_LABELS[status] || status}
    </span>
  );
}

const WL_EMAIL_BG = { sent: C.grnBg, failed: C.redBg, pending: C.yelBg, queued: C.yelBg, skipped: C.card2 };
function WlEmailBadge({ status }) {
  const color = WL_EMAIL_COLOR[status] || C.muted;
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
  return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color, background: WL_EMAIL_BG[status] || C.card2, padding: '2px 8px', borderRadius: 6, fontFamily: MONO }}>{label}</span>;
}

function WlBars({ title, items, color = C.acc }) {
  if (!items || items.length === 0) return null;
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span title={it.label} style={{ width: 130, flexShrink: 0, fontSize: 12.5, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
            <span style={{ flex: 1, height: 7, background: C.card2, borderRadius: 99, overflow: 'hidden', minWidth: 0 }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.round((it.count / max) * 100)}%`, background: color, borderRadius: 99 }} />
            </span>
            <span style={{ width: 32, textAlign: 'right', fontSize: 12, fontFamily: MONO, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WlConfigNeeded({ config }) {
  return (
    <div style={{ background: C.card, border: `1px dashed ${C.brd2}`, borderRadius: 12, padding: '28px 24px', textAlign: 'center', maxWidth: 640, margin: '24px auto' }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: C.yelBg, color: C.yel, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Icon name="alertTriangle" size={22} /></div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Beta Waitlist database not configured</div>
      <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        The waitlist uses a strictly-separate database. Set <code style={{ fontFamily: MONO, color: C.txt }}>BETA_WAITLIST_DATABASE_URL</code> in the server environment,
        then apply the schema:
      </div>
      <pre style={{ textAlign: 'left', background: C.card2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', fontFamily: MONO, fontSize: 12, color: C.txt2, overflowX: 'auto' }}>cd server
npx prisma db push --schema=prisma/waitlist/schema.prisma</pre>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>Target: <span style={{ fontFamily: MONO }}>{config?.target || 'unset'}</span> · Submissions fail safe (503) until configured — never written to the user database.</div>
    </div>
  );
}

function WaitlistSection() {
  const [data, setData] = useState(null);
  const [loadingM, setLoadingM] = useState(true);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loadingT, setLoadingT] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const searchTimer = useRef(null);
  const filtersRef = useRef({});
  // dateTo is widened to end-of-day so the chosen day is inclusive.
  filtersRef.current = {
    search, status, role, countryCode, emailStatus, sortBy, sortDir,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo ? `${dateTo}T23:59:59.999` : undefined,
  };

  const loadMetrics = useCallback(() => {
    setLoadingM(true);
    adminApi.betaWaitlist.metrics()
      .then((d) => { setData(d); setConfigured(d.configured !== false); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingM(false));
  }, []);

  const loadTable = useCallback((p) => {
    setLoadingT(true);
    const f = filtersRef.current;
    adminApi.betaWaitlist.list({ page: p, limit: WL_PAGE, ...f })
      .then((d) => {
        setConfigured(d.configured !== false);
        setRows(d.rows || []);
        setTotal(d.total || 0);
        setPages(d.pages || 1);
        setPage(d.page || p);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingT(false));
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);
  // Reload table whenever a non-search filter or sort changes (search is debounced).
  useEffect(() => { loadTable(1); }, [status, role, countryCode, emailStatus, sortBy, sortDir, dateFrom, dateTo, loadTable]);

  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadTable(1), 300);
  };
  const clearFilters = () => { setSearch(''); setStatus(''); setRole(''); setCountryCode(''); setEmailStatus(''); setSortBy('createdAt'); setSortDir('desc'); setDateFrom(''); setDateTo(''); };
  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir(col === 'createdAt' ? 'desc' : 'asc'); }
  };
  const refreshAll = () => { loadMetrics(); loadTable(page); };

  const doExport = async () => {
    try {
      const url = adminApi.betaWaitlist.exportUrl(filtersRef.current);
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `beta-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch (e) { setErr(`Export failed: ${e.message}`); }
  };

  const m = data && data.metrics;
  const hasData = m && m.total > 0;

  const SortHead = ({ col, children, width }) => (
    <th onClick={() => toggleSort(col)} style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', width }}>
      {children}{sortBy === col ? <span aria-hidden="true" style={{ color: C.acc }}> {sortDir === 'asc' ? '▲' : '▼'}</span> : null}
    </th>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 4px' }}>Beta Waitlist</h2>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Applicants who joined the public beta waitlist. Stored in a separate database — never mixed with user accounts.</div>
      </div>

      {err && <div role="alert" style={{ margin: '0 0 14px', padding: '9px 12px', background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 8, color: C.red, fontSize: 12.5 }}>{err}</div>}

      {!configured && !loadingM ? (
        <WlConfigNeeded config={data && data.config} />
      ) : (
        <>
          {/* ── Overview metrics (real data only) ─────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            <KpiCard label="Total applicants" value={m ? m.total : null} loading={loadingM} spark={m ? m.trend.map((t) => t.count) : null} />
            <KpiCard label="New today" value={m ? m.today : null} loading={loadingM} color={C.grn} />
            <KpiCard label="Last 7 days" value={m ? m.last7Days : null} loading={loadingM} color={C.grn} />
            <KpiCard label="Last 30 days" value={m ? m.last30Days : null} loading={loadingM} color={C.acc} />
            <KpiCard label="Confirmation emails sent" value={m ? m.email.sent : null} loading={loadingM} color={C.grn} />
            <KpiCard label="Email failures" value={m ? m.email.failed : null} loading={loadingM} color={m && m.email.failed > 0 ? C.red : C.muted} />
          </div>

          {hasData && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>By status</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {WAITLIST_STATUSES.map((s) => (
                  <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 8, background: C.card, border: `1px solid ${C.brd}` }}>
                    <WlBadge status={s} />
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, color: C.txt }}>{m.byStatus[s] || 0}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {hasData && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 18 }}>
              <WlBars title="Top roles" items={m.topRoles} color={C.acc} />
              <WlBars title="Top institutions" items={m.topInstitutions} color={C.purp} />
              <WlBars title="Top countries" items={m.topCountries} color={C.teal} />
              <WlBars title="Top interests" items={m.topInterests} color={C.gold} />
            </div>
          )}

          {/* ── Filters ───────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input aria-label="Search applicants" placeholder="Search name, email, institution…" value={search} onChange={(e) => onSearch(e.target.value)} style={{ ...wlInput, flex: '1 1 200px', minWidth: 160 }} />
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={wlSelect}>
              <option value="">All statuses</option>
              {WAITLIST_STATUSES.map((s) => <option key={s} value={s}>{WAITLIST_STATUS_LABELS[s]}</option>)}
            </select>
            <select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} style={wlSelect}>
              <option value="">All roles</option>
              {WAITLIST_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select aria-label="Filter by country" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={wlSelect}>
              <option value="">All countries</option>
              {COUNTRY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <select aria-label="Filter by confirmation email status" value={emailStatus} onChange={(e) => setEmailStatus(e.target.value)} style={wlSelect}>
              <option value="">All emails</option>
              {WL_EMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.muted }}>From<input type="date" aria-label="Submitted on or after" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} style={wlInput} /></label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.muted }}>To<input type="date" aria-label="Submitted on or before" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} style={wlInput} /></label>
            <button type="button" onClick={clearFilters} style={wlBtn}>Clear</button>
            <button type="button" onClick={refreshAll} style={wlBtn}><Icon name="refresh" size={13} />Refresh</button>
            <button type="button" onClick={doExport} disabled={total === 0} style={{ ...wlBtn, opacity: total === 0 ? 0.5 : 1, color: C.acc, borderColor: alpha(C.acc, '50') }}><Icon name="download" size={13} />Export CSV</button>
          </div>

          {/* ── Applicants table ──────────────────────────────────────────── */}
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.brd}`, background: C.card2 }}>
                    <SortHead col="lastName">Name</SortHead>
                    <SortHead col="email">Email</SortHead>
                    <SortHead col="institutionName">Institution</SortHead>
                    <th style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Role</th>
                    <SortHead col="countryName">Country</SortHead>
                    <SortHead col="status">Status</SortHead>
                    <th style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Interests</th>
                    <SortHead col="createdAt">Submitted</SortHead>
                    <th style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingT ? (
                    <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center' }}><Spinner /></td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding: '44px 16px', textAlign: 'center', color: C.muted, fontSize: 13.5 }}>
                      {total === 0 && !search && !status && !role && !countryCode && !emailStatus
                        ? 'No applicants yet. When people join the waitlist, they will appear here.'
                        : 'No applicants match these filters.'}
                    </td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id} onClick={() => setSelectedId(r.id)} tabIndex={0}
                      aria-label={`View applicant ${applicantDisplayName(r)}`}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(r.id); } }}
                      style={{ borderBottom: `1px solid ${C.brd}`, cursor: 'pointer' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = C.card2}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      onFocus={(e) => { e.currentTarget.style.background = C.card2; e.currentTarget.style.outline = `2px solid ${C.acc}`; e.currentTarget.style.outlineOffset = '-2px'; }}
                      onBlur={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.outline = 'none'; }}>
                      <td style={{ padding: '10px', fontSize: 13, color: C.txt, fontWeight: 600, whiteSpace: 'nowrap' }}>{applicantDisplayName(r)}</td>
                      <td style={{ padding: '10px', fontSize: 12.5, color: C.txt2, fontFamily: MONO, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.email}>{r.email}</td>
                      <td style={{ padding: '10px', fontSize: 12.5, color: C.txt2, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.institutionName}>{r.institutionName}</td>
                      <td style={{ padding: '10px', fontSize: 12.5, color: C.txt2, whiteSpace: 'nowrap' }}>{applicantRoleLabel(r)}</td>
                      <td style={{ padding: '10px', fontSize: 12.5, color: C.txt2, whiteSpace: 'nowrap' }}>{r.countryName || r.countryCode || '—'}</td>
                      <td style={{ padding: '10px' }}><WlBadge status={r.status} /></td>
                      <td style={{ padding: '10px', fontSize: 11.5, color: C.muted, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={(r.areasOfInterest || []).join(', ')}>{(r.areasOfInterest || []).length ? `${r.areasOfInterest.length} selected` : '—'}</td>
                      <td style={{ padding: '10px', fontSize: 12, color: C.txt2, whiteSpace: 'nowrap' }}>{wlFmtDate(r.createdAt)}</td>
                      <td style={{ padding: '10px' }}><WlEmailBadge status={r.confirmationEmailStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: `1px solid ${C.brd}`, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{total} applicant{total === 1 ? '' : 's'}{total > 0 ? ` · page ${page} of ${pages}` : ''}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => page > 1 && loadTable(page - 1)} disabled={page <= 1 || loadingT} style={{ ...wlBtn, opacity: page <= 1 ? 0.5 : 1 }}><Icon name="chevronLeft" size={13} />Prev</button>
                <button type="button" onClick={() => page < pages && loadTable(page + 1)} disabled={page >= pages || loadingT} style={{ ...wlBtn, opacity: page >= pages ? 0.5 : 1 }}>Next<Icon name="chevronRight" size={13} /></button>
              </span>
            </div>
          </div>

          {m && <div style={{ fontSize: 11, color: C.muted, marginTop: 10, fontFamily: FONT }}>Metrics reflect all records as of {wlFmtDateTime(m.generatedAt)}. Trend window: last {m.trendDays} days.</div>}
        </>
      )}

      {selectedId && <WaitlistDrawer id={selectedId} onClose={() => setSelectedId(null)} onChanged={refreshAll} />}
    </div>
  );
}

function WaitlistDrawer({ id, onClose, onChanged }) {
  const [applicant, setApplicant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusVal, setStatusVal] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [notes, setNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [resending, setResending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [msg, setMsg] = useState('');
  const panelRef = useRef(null);
  const prevFocusRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.betaWaitlist.get(id)
      .then((d) => { setApplicant(d.applicant); setStatusVal(d.applicant.status); setNotes(d.applicant.internalNotes || ''); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Modal focus management: move focus into the dialog on open, restore it to the
  // triggering element on close, and trap Tab within the panel (WCAG 2.1.2/2.4.3).
  useEffect(() => {
    prevFocusRef.current = document.activeElement;
    const t = setTimeout(() => {
      const first = panelRef.current?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (first) first.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      const prev = prevFocusRef.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = Array.from(panelRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter((el) => !el.disabled && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveStatus = async () => {
    setSavingStatus(true); setMsg('');
    try {
      const d = await adminApi.betaWaitlist.setStatus(id, statusVal, statusNote.trim() || undefined);
      setApplicant(d.applicant); setStatusNote(''); setMsg('Status updated.'); onChanged();
    } catch (e) { setErr(e.message); } finally { setSavingStatus(false); }
  };
  const saveNotes = async () => {
    setSavingNotes(true); setMsg('');
    try { const d = await adminApi.betaWaitlist.setNotes(id, notes); setApplicant(d.applicant); setMsg('Notes saved.'); }
    catch (e) { setErr(e.message); } finally { setSavingNotes(false); }
  };
  const resend = async () => {
    setResending(true); setMsg('');
    try {
      const d = await adminApi.betaWaitlist.resend(id, true);
      setApplicant(d.applicant);
      setMsg(d.emailConfigured ? 'Confirmation email re-sent.' : 'Email is not configured — nothing was sent.');
      onChanged();
    } catch (e) {
      setErr(e.status === 429 ? 'A confirmation was sent very recently. Try again shortly.' : e.message);
    } finally { setResending(false); }
  };
  const remove = async () => {
    try { await adminApi.betaWaitlist.remove(id); onChanged(); onClose(); }
    catch (e) { setErr(e.message); }
  };

  const Row = ({ label, children }) => (children == null || children === '' || (Array.isArray(children) && !children.length)) ? null : (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.brd}` }}>
      <div style={{ width: 140, flexShrink: 0, fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5, minWidth: 0, wordBreak: 'break-word' }}>{Array.isArray(children) ? children.join(', ') : children}</div>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Applicant details" style={{ position: 'fixed', inset: 0, zIndex: 500 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      <div ref={panelRef} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(560px, 100%)', background: C.surf, borderLeft: `1px solid ${C.brd}`, boxShadow: '-12px 0 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{applicant ? applicantDisplayName(applicant) : 'Applicant'}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, display: 'inline-flex' }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {loading ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner /></div> : err && !applicant ? (
            <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}</div>
          ) : applicant && (
            <>
              {msg && <div style={{ marginBottom: 12, padding: '8px 11px', background: C.grnBg, border: `1px solid ${C.grn}`, borderRadius: 8, color: C.grn, fontSize: 12.5 }}>{msg}</div>}
              {err && <div role="alert" style={{ marginBottom: 12, padding: '8px 11px', background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 8, color: C.red, fontSize: 12.5 }}>{err}</div>}

              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <WlBadge status={applicant.status} />
                <WlEmailBadge status={applicant.confirmationEmailStatus} />
              </div>

              <Row label="Email">{applicant.email}</Row>
              <Row label="Institution">{applicant.institutionName}</Row>
              <Row label="Role">{applicantRoleLabel(applicant)}</Row>
              <Row label="Country">{applicant.countryName || applicant.countryCode}</Row>
              <Row label="Primary use">{applicant.primaryUse}</Row>
              <Row label="Experience">{applicant.researchExperienceLevel}</Row>
              <Row label="Reviews / year">{applicant.annualReviewVolume}</Row>
              <Row label="Works">{applicant.workingStyle === 'Research team' && applicant.teamSize ? `Research team (${applicant.teamSize})` : applicant.workingStyle}</Row>
              <Row label="Interests">{applicant.areasOfInterest}</Row>
              <Row label="Heard via">{applicant.referralSource === 'Other' && applicant.referralOther ? `Other — ${applicant.referralOther}` : applicant.referralSource}</Row>
              <Row label="Message">{applicant.message}</Row>
              <Row label="Submitted">{wlFmtDateTime(applicant.createdAt)}</Row>
              <Row label="Source">{applicant.submissionSource}</Row>
              <Row label="Consent">{applicant.consent ? `Agreed ${wlFmtDateTime(applicant.consentAt)} (v${applicant.consentVersion || '—'})` : 'Not given'}</Row>
              <Row label="Confirmation sent">{wlFmtDateTime(applicant.confirmationEmailSentAt)}</Row>
              <Row label="Last email error">{applicant.lastConfirmationEmailError}</Row>

              {/* Status history */}
              {applicant.statusEvents && applicant.statusEvents.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Status history</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {applicant.statusEvents.map((ev) => (
                      <div key={ev.id} style={{ fontSize: 12, color: C.txt2, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontFamily: MONO, color: C.muted, fontSize: 11 }}>{wlFmtDateTime(ev.createdAt)}</span>
                        <span>{ev.fromStatus ? `${WAITLIST_STATUS_LABELS[ev.fromStatus] || ev.fromStatus} → ` : ''}<strong>{WAITLIST_STATUS_LABELS[ev.toStatus] || ev.toStatus}</strong>{ev.note ? ` · ${ev.note}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Admin actions */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.brd}` }}>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Administrative actions</div>

                <label htmlFor="wl-status" style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, display: 'block', marginBottom: 6 }}>Change status</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <select id="wl-status" value={statusVal} onChange={(e) => setStatusVal(e.target.value)} style={{ ...wlSelect, flex: '1 1 160px' }}>
                    {WAITLIST_STATUSES.map((s) => <option key={s} value={s}>{WAITLIST_STATUS_LABELS[s]}</option>)}
                  </select>
                  <button type="button" onClick={saveStatus} disabled={savingStatus || statusVal === applicant.status} style={{ ...wlBtn, color: C.acc, borderColor: alpha(C.acc, '50'), opacity: (savingStatus || statusVal === applicant.status) ? 0.5 : 1 }}>{savingStatus ? 'Saving…' : 'Update'}</button>
                </div>
                <input placeholder="Optional note for the status change" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} style={{ ...wlInput, width: '100%', marginBottom: 16 }} />

                <label htmlFor="wl-notes" style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, display: 'block', marginBottom: 6 }}>Internal notes <span style={{ color: C.muted, fontWeight: 400 }}>(never shown to the applicant)</span></label>
                <textarea id="wl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...wlInput, width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical', marginBottom: 8 }} />
                <button type="button" onClick={saveNotes} disabled={savingNotes} style={{ ...wlBtn, marginBottom: 16, opacity: savingNotes ? 0.5 : 1 }}>{savingNotes ? 'Saving…' : 'Save notes'}</button>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" onClick={resend} disabled={resending} style={{ ...wlBtn, opacity: resending ? 0.5 : 1 }}><Icon name="mail" size={13} />{resending ? 'Sending…' : 'Resend confirmation'}</button>
                  {!confirmRemove ? (
                    <button type="button" onClick={() => setConfirmRemove(true)} style={{ ...wlBtn, color: C.red, borderColor: alpha(C.red, '50') }}><Icon name="trash" size={13} />Remove</button>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>Delete permanently?</span>
                      <button type="button" onClick={remove} style={{ ...wlBtn, background: C.red, color: '#fff', borderColor: C.red }}>Yes, remove</button>
                      <button type="button" onClick={() => setConfirmRemove(false)} style={wlBtn}>Cancel</button>
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ROOT COMPONENT
   ════════════════════════════════════════════════════════════════════════ */

const NAV_SECTIONS = [
  { id: 'overview',   icon: 'grid',      label: 'Overview'      },
  { id: 'users',      icon: 'users',     label: 'Users'         },
  { id: 'onboarding', icon: 'clipboard', label: 'Onboarding'    },
  { id: 'projects',   icon: 'folders',   label: 'Projects'      },
  { id: 'sift',       icon: 'hexagon',   label: 'Screening'     },
  { id: 'rob',        icon: 'scale',     label: 'Risk of Bias'  },
  { id: 'waitlist',   icon: 'flask',     label: 'Beta Waitlist' },
  { id: 'content',    icon: 'fileText',  label: 'Content'       },
  { id: 'settings',   icon: 'settings',  label: 'Settings'      },
  { id: 'style',      icon: 'eye',       label: 'Appearance'    },
  { id: 'flags',      icon: 'sliders',   label: 'Flags'         },
  { id: 'messages',   icon: 'mail',      label: 'Messages'      },
  { id: 'security',   icon: 'shield',    label: 'Security'      },
  { id: 'health',     icon: 'activity',  label: 'Health'        },
];

// Role-derived section sets — mirror of server getConsole (the server descriptor
// stays the source of truth; these are the bootstrap/failure fallback ONLY).
// Mod: user support (messages + replies) and limited user management. Mods never
// get metrics/settings/flags/security/health/database or screening admin tabs.
const MOD_SECTIONS = ['users', 'messages'];
const roleSections = r => (r === 'admin' ? NAV_SECTIONS.map(s => s.id) : MOD_SECTIONS);

export default function AdminConsole() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  // Session role from AuthContext as a UX bootstrap — anything not verifiably
  // admin starts from the MINIMAL mod set; the /console fetch replaces it.
  const sessionRole = user?.role === 'admin' ? 'admin' : 'mod';
  const [active,   setActive]      = useState(() => (sessionRole === 'admin' ? 'overview' : 'users'));
  const [unread,   setUnread]      = useState(0);
  const [role,     setRole]        = useState(null);     // DB-verified role from /console
  // Allowed section ids. Initialized role-derived so the nav NEVER shows all
  // sections to a mod — not while loading and not on fetch error (prompt6 Task 14).
  const [allowed,  setAllowed]     = useState(() => new Set(roleSections(sessionRole)));
  const [version,  setVersion]     = useState(null);

  const uiRole  = role || sessionRole;
  const isAdmin = uiRole === 'admin';

  // Fetch the console capability descriptor (role + allowed sections) — server truth.
  useEffect(() => {
    adminApi.console()
      .then(d => {
        setRole(d.role);
        const set = new Set(d.sections || []);
        setAllowed(set);
        setActive(prev => set.has(prev) ? prev : (d.sections?.[0] || 'users'));
      })
      .catch(() => {
        // Console-bootstrap failed — fall back to the role-derived MINIMAL set.
        // Never null/show-all: server-side guards 403 anyway, but a mod must not
        // see admin-only nav even as dead links.
        const fallback = roleSections(sessionRole);
        setRole(sessionRole);
        setAllowed(new Set(fallback));
        setActive(prev => fallback.includes(prev) ? prev : fallback[0]);
      });
  }, [user]);

  // Per-staff unread badge (prompt5 Task 9) — works for admin AND mod, and clears
  // as soon as a message is opened (mark-read) regardless of who else has read it.
  useEffect(() => {
    if (!allowed.has('messages')) return;
    adminApi.messages.unreadCount().then(d => setUnread(d.unread || 0)).catch(() => {});
  }, [allowed]);

  // App version line (optional — renders nothing on 404).
  useEffect(() => { fetchVersion().then(setVersion); }, []);

  const sections = {
    // Overview is admin-only (MOD_SECTIONS unchanged): renderActive() never
    // mounts it for mods; isAdmin additionally gates its fetches + EventSource.
    overview:   <OverviewSection onNavigate={setActive} isAdmin={isAdmin} />,
    users:      <UsersSection isAdmin={isAdmin} />,
    onboarding: <OnboardingSection />,
    projects:   <ProjectsSection />,
    sift:       <SiftAdminSection />,
    rob:        <RobAdminSection />,
    waitlist:   <WaitlistSection />,
    content:    <ContentSection />,
    settings:   <SettingsSection />,
    style:      <StyleSection />,
    flags:      <FlagsSection />,
    messages:   <MessagesSection onUnreadChange={setUnread} />,
    security:   <SecuritySection />,
    health:     <HealthSection />,
  };

  // Section labels for the access-denied message.
  const sectionLabel = id => (NAV_SECTIONS.find(s => s.id === id)?.label || id);

  // Render the active section, gated by the allowed set (UX layer; server enforces too).
  // A mod navigating directly to an admin-only section gets the AccessDenied panel — never a crash.
  const renderActive = () => {
    if (!allowed.has(active)) return <AccessDenied section={sectionLabel(active)} />;
    return sections[active];
  };

  // `allowed` is always a Set (role-derived until /console answers) — no show-all path.
  const visibleNav = NAV_SECTIONS.filter(s => allowed.has(s.id));

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes opsPulse { 0% { transform: scale(0.8); opacity: 0.9; } 70% { transform: scale(2.4); opacity: 0; } 100% { transform: scale(2.4); opacity: 0; } }
        .ops-pulse { animation: opsPulse 2s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ops-pulse { animation: none; opacity: 0; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.brd2}; border-radius: 3px; }
        select { appearance: none; }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: TOPBAR_H, background: C.surf, borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px 0 16px', zIndex: 300 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', color: C.acc }}><Icon name="hexagon" size={16} /></span>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: C.txt }}>PecanRev</span>
          {/* Mods see the limited console labeled as such (prompt6 Task 14) —
              matches the "Mod Console" wording of the UserMenu /ops link. */}
          {isAdmin ? (
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '28')}`, borderRadius: 4, padding: '2px 7px', letterSpacing: '0.08em', textTransform: 'uppercase', marginLeft: 2 }}>OPS</span>
          ) : (
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.teal, background: alpha(C.teal, '14'), border: `1px solid ${alpha(C.teal, '28')}`, borderRadius: 4, padding: '2px 7px', letterSpacing: '0.08em', textTransform: 'uppercase', marginLeft: 2 }}>Mod Console</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Return to app button */}
          <button
            onClick={() => navigate('/app')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '28')}`, borderRadius: 7, color: C.acc, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = alpha(C.acc, '22')}
            onMouseLeave={e => e.currentTarget.style.background = alpha(C.acc, '14')}
          >
            <Icon name="hexagon" size={13} />
            <span>Open App</span>
          </button>
          {/* Shared notifications bell (prompt6 Task 1) — inline in the top bar,
              before the user/logout area. Same component as META·LAB / META·SIFT. */}
          <NotificationsBell />
          <span title={user?.email} style={{ fontSize: 11, color: C.muted, fontFamily: MONO, minWidth: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</span>
          <RoleBadge role={uiRole} />
          {/* Shared account dropdown — same component as META·LAB / META·SIFT (Task 8) */}
          <UserMenu context="metalab" />
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <div style={{ position: 'fixed', top: TOPBAR_H, left: 0, width: SIDEBAR_W, bottom: 0, background: C.surf, borderRight: `1px solid ${C.brd}`, overflowY: 'auto', zIndex: 200, paddingTop: 12 }}>
        {visibleNav.map(sec => {
          const isActive = active === sec.id;
          const badge = sec.id === 'messages' && unread > 0 ? unread : null;
          return (
            <button key={sec.id} onClick={() => setActive(sec.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 16px', background: isActive ? alpha(C.acc, '14') : 'transparent', border: 'none', borderLeft: `3px solid ${isActive ? C.acc : 'transparent'}`, cursor: 'pointer', fontFamily: FONT, fontSize: 13, color: isActive ? C.acc : C.txt2, fontWeight: isActive ? 600 : 400, textAlign: 'left', transition: 'all 0.15s' }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = alpha(C.acc, '08'); e.currentTarget.style.color = C.txt; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.txt2; } }}
            >
              <span style={{ width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={sec.icon} size={14} /></span>
              <span style={{ flex: 1 }}>{sec.label}</span>
              {badge && (
                <span style={{ background: C.ylw, color: C.bg, borderRadius: 8, padding: '1px 6px', fontSize: 10, fontFamily: MONO, fontWeight: 700 }}>{badge}</span>
              )}
            </button>
          );
        })}

        {/* Sidebar footer — back to dashboard link + version line */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 16px', borderTop: `1px solid ${C.brd}`, background: C.surf }}>
          <button onClick={() => navigate('/app')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.acc; e.currentTarget.style.color = C.acc; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.brd2; e.currentTarget.style.color = C.txt2; }}
          >
            <span style={{ fontSize: 12 }}>←</span>
            <span>Back to Dashboard</span>
          </button>
          {version && (
            <div style={{ fontSize: 9, color: C.muted, fontFamily: MONO, textAlign: 'center', marginTop: 8, letterSpacing: '0.04em' }}>
              v{version.version}{version.commit ? ` · build ${String(version.commit).slice(0, 7)}` : ''}{version.buildDate ? ` · ${fmtDate(version.buildDate)}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div style={{ marginLeft: SIDEBAR_W, paddingTop: TOPBAR_H, minHeight: '100vh' }}>
        <div style={{ padding: '28px 32px', maxWidth: 1680 }}>
          {renderActive()}
        </div>
      </div>
    </div>
  );
}
