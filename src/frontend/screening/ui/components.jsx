/**
 * components.jsx — shared META·SIFT UI primitives (one source for all tabs).
 *
 * Theme-aware (prompt7): all colors come from the token system via ui/theme.js;
 * translucent tints use alpha() (CSS color-mix) instead of hex+alpha suffixes.
 * Consistency: 1px C.brd borders, 8–10px radii, C.shadow for elevation.
 */
import { useEffect } from 'react';
import { C, FONT, MONO, alpha, DECISION_COLORS, DECISION_GLYPH, GLOBAL_CSS } from './theme.js';

/** Inject fonts + keyframes once at the shell root. */
export function GlobalStyle() {
  return <style>{GLOBAL_CSS}</style>;
}

export function BetaBadge() {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', background: alpha(C.teal, '18'), border: `1px solid ${alpha(C.teal, '50')}`,
      color: C.teal, borderRadius: 4, padding: '2px 7px',
    }}>BETA</span>
  );
}

export function Badge({ children, color = C.teal, title }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 9, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
      textTransform: 'uppercase', background: alpha(color, '18'), border: `1px solid ${alpha(color, '40')}`,
      color, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

export function Spinner({ size = 18 }) {
  return (
    <div style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: C.txt2, padding: '40px 0' }}>
      <Spinner /><span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

export function ProgressBar({ pct, color = C.acc, height = 4 }) {
  const v = Math.min(100, Math.max(0, pct || 0));
  return (
    <div style={{ height, background: C.brd, borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ width: `${v}%`, height: '100%', background: color, borderRadius: height / 2, transition: 'width 0.4s ease' }} />
    </div>
  );
}

export function StatPill({ label, value, color = C.txt2 }) {
  return (
    <span style={{ fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontWeight: 600, color, fontFamily: MONO }}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

/** Big metric tile for dashboards. */
export function StatTile({ label, value, color = C.txt, sub, accent }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${accent ? alpha(color, '40') : C.brd}`,
      borderRadius: 10, padding: '14px 16px', minWidth: 0,
    }}>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: MONO, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.txt2, marginTop: 6, letterSpacing: '0.02em' }}>{label}</div>
      {sub != null && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function DecisionChip({ decision, size = 'sm' }) {
  const d = DECISION_COLORS[decision] || DECISION_COLORS.undecided;
  const pad = size === 'sm' ? '2px 8px' : '4px 12px';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: size === 'sm' ? 11 : 12,
      fontWeight: 600, fontFamily: FONT, background: size === 'sm' ? alpha(d.bg, '90') : d.bg,
      border: `1px solid ${d.border}`, color: d.txt, borderRadius: 5, padding: pad,
    }}>
      <span style={{ fontFamily: MONO }}>{DECISION_GLYPH[decision] || '·'}</span>
      <span style={{ textTransform: 'capitalize' }}>{decision}</span>
    </span>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', style, title, full }) {
  const base = {
    fontSize: 13, fontWeight: 600, fontFamily: FONT, borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
    padding: '8px 18px', transition: 'background 0.15s, border-color 0.15s, color 0.15s', opacity: disabled ? 0.55 : 1,
    width: full ? '100%' : undefined, whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  };
  const variants = {
    primary: { background: C.acc2, border: '1px solid transparent', color: C.accText },
    ghost:   { background: 'transparent', border: `1px solid ${C.brd2}`, color: C.txt2 },
    danger:  { background: C.red, border: '1px solid transparent', color: C.accText },
    subtle:  { background: C.card, border: `1px solid ${C.brd}`, color: C.txt },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={e => { if (!disabled && variant === 'primary') e.currentTarget.style.background = C.acc; }}
      onMouseLeave={e => { if (!disabled && variant === 'primary') e.currentTarget.style.background = C.acc2; }}
    >{children}</button>
  );
}

export function Toggle({ checked, onChange, disabled, label, hint }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <span
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative',
          background: checked ? C.acc2 : C.dim, transition: 'background 0.2s',
          border: `1px solid ${checked ? C.acc2 : C.brd2}`, boxSizing: 'border-box',
        }}
      >
        <span style={{
          position: 'absolute', top: 1, left: checked ? 17 : 1, width: 16, height: 16, borderRadius: '50%',
          background: '#fff', boxShadow: `0 1px 3px ${C.shadow}`, transition: 'left 0.2s',
        }} />
      </span>
      {label && (
        <span>
          <span style={{ fontSize: 13, color: C.txt }}>{label}</span>
          {hint && <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>{hint}</span>}
        </span>
      )}
    </label>
  );
}

export function SectionLabel({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>{children}</span>
      {right}
    </div>
  );
}

export function Card({ children, style, hover, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '16px 18px',
      transition: 'background 0.15s, border-color 0.15s', cursor: onClick ? 'pointer' : 'default', ...style,
    }}
      onMouseEnter={hover ? e => { e.currentTarget.style.background = C.cardHover; e.currentTarget.style.borderColor = C.brd2; } : undefined}
      onMouseLeave={hover ? e => { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.brd; } : undefined}
    >{children}</div>
  );
}

/**
 * ScreeningContentShell — the shared centered wrapper for standard Screening
 * subpages (Overview, Duplicates, Final Review, Export) (prompt33 Task 3). Keeps a
 * consistent, centered column at a comfortable reading width with a responsive
 * gutter, instead of each subpage filling an ultra-wide container and reading as
 * "off-center". Title & Abstract opts out (it uses a bespoke full-bleed layout).
 *   width 100% · max-width 1280 · margin-inline auto · padding-inline clamp(24,4vw,64)
 */
export function ScreeningContentShell({ children, maxWidth = 1280, style }) {
  return (
    <div style={{
      width: '100%', maxWidth, margin: '0 auto', boxSizing: 'border-box',
      padding: '24px clamp(24px, 4vw, 64px) 56px', ...style,
    }}>
      {children}
    </div>
  );
}

/**
 * EmptyState — icon slot accepts a ReactNode (preferred: <Icon name=.../> from
 * components/icons.jsx) or a short text glyph; both render muted + monochrome.
 */
export function EmptyState({ icon = null, title, children, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 24px', border: `1px dashed ${C.brd}`, borderRadius: 10, animation: 'sift-fade 0.3s ease' }}>
      {icon != null && (
        <div style={{ fontSize: 30, lineHeight: 1, marginBottom: 14, color: C.muted, display: 'flex', justifyContent: 'center' }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, marginBottom: 8 }}>{title}</div>
      {children && <div style={{ fontSize: 13, color: C.txt2, maxWidth: 400, margin: '0 auto 20px' }}>{children}</div>}
      {action}
    </div>
  );
}

export function ErrorBanner({ children, onRetry }) {
  return (
    <div style={{ background: C.redBg, border: `1px solid ${alpha(C.red, '50')}`, borderRadius: 8, padding: '12px 16px', color: C.red, fontSize: 13, marginBottom: 16 }}>
      {children}
      {onRetry && <button onClick={onRetry} style={{ marginLeft: 12, background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 12 }}>Retry</button>}
    </div>
  );
}

export function Avatar({ name, size = 26 }) {
  const initials = (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  let h = 0; for (const ch of (name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, fontFamily: FONT, color: '#fff',
      background: `hsl(${h},45%,38%)`,
    }}>{initials}</span>
  );
}

export function Modal({ children, onClose, width = 480 }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: alpha(C.bg, 0.82), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'sift-fade 0.15s ease' }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 10, padding: '24px 26px', width: '100%', maxWidth: width, boxShadow: `0 20px 60px ${C.shadow}`, maxHeight: '88vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

// Form field helpers
export const fieldLabel = {
  display: 'block', fontSize: 11, fontWeight: 600, color: C.txt2,
  marginBottom: 5, marginTop: 14, letterSpacing: '0.04em', textTransform: 'uppercase',
};
export const fieldInput = {
  width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
  borderRadius: 6, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: FONT, outline: 'none',
};
export function Field({ label, children }) {
  return (<div><label style={fieldLabel}>{label}</label>{children}</div>);
}
