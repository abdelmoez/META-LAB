/**
 * core.jsx — Stitch presentation primitives (surfaces, buttons, badges, status,
 * avatars, headers, metrics, progress, and the empty/loading/error states).
 *
 * These are PRESENTATION ONLY: they take data + handlers and render the Vivid
 * Enterprise look. Business logic stays in the shared hooks/services the Stitch
 * pages call. Styling uses inline objects over the `S` token object (var(--stitch-*)),
 * matching the app's established token architecture so a theme flip repaints with
 * no re-render.
 */
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../theme/stitchTokens.js';

/* ─── Icon (re-export the app's line-icon set; no Material Symbols CDN) ─────── */
export { Icon as StitchIcon };

/* ─── Surfaces ────────────────────────────────────────────────────────────── */

/**
 * StitchCard — white elevated surface, 16px radius, soft ambient shadow.
 * `pad` toggles the standard 20px padding; `as` allows a semantic element.
 */
export function StitchCard({ children, pad = true, interactive = false, className = '', style, as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={`stitch-fade-in ${className}`.trim()}
      style={{
        background: S.card,
        borderRadius: S.radiusCard,
        boxShadow: S.shadow1,
        border: `1px solid ${salpha(S.outlineVariant, 0.45)}`,
        padding: pad ? S.cardPad : 0,
        transition: interactive ? 'box-shadow 0.18s ease, transform 0.18s ease' : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A flat panel (no shadow) for nested grouping inside cards. */
export function StitchPanel({ children, tone = 'low', style, ...rest }) {
  const bg = tone === 'container' ? S.surfaceContainer : S.surfaceLow;
  return (
    <div style={{ background: bg, borderRadius: S.radiusCardSm, padding: 16, ...style }} {...rest}>
      {children}
    </div>
  );
}

export function StitchDivider({ vertical = false, style }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      style={vertical
        ? { width: 1, alignSelf: 'stretch', background: salpha(S.outlineVariant, 0.6), ...style }
        : { height: 1, width: '100%', background: salpha(S.outlineVariant, 0.6), ...style }}
    />
  );
}

/* ─── Buttons ─────────────────────────────────────────────────────────────── */

const BTN_TONES = {
  primary:  () => ({ bg: S.brand, fg: S.onBrand, bd: 'transparent', hover: S.brandContainer }),
  success:  () => ({ bg: S.success, fg: S.onSuccess, bd: 'transparent', hover: S.successStrong }),
  danger:   () => ({ bg: S.danger, fg: S.onDanger, bd: 'transparent', hover: S.dangerStrong }),
  neutral:  () => ({ bg: S.card, fg: S.textPrimary, bd: S.outlineVariant, hover: S.surfaceContainer }),
  ghost:    () => ({ bg: 'transparent', fg: S.textSecondary, bd: 'transparent', hover: S.surfaceContainer }),
  soft:     () => ({ bg: S.brandSoft, fg: S.onBrandSoft, bd: 'transparent', hover: salpha(S.brand, 0.18) }),
};
const BTN_SIZES = {
  sm: { padding: '6px 12px', fontSize: 12, gap: 6, icon: 15 },
  md: { padding: '9px 16px', fontSize: 14, gap: 8, icon: 17 },
  lg: { padding: '12px 20px', fontSize: 15, gap: 8, icon: 18 },
};

export function StitchButton({
  children, variant = 'primary', size = 'md', icon, iconRight, block = false,
  loading = false, disabled = false, type = 'button', style, onMouseEnter, onMouseLeave, ...rest
}) {
  const t = (BTN_TONES[variant] || BTN_TONES.primary)();
  const z = BTN_SIZES[size] || BTN_SIZES.md;
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      className="stitch-btn stitch-focusable"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onMouseEnter={(e) => { if (!isDisabled) e.currentTarget.style.background = t.hover; onMouseEnter?.(e); }}
      onMouseLeave={(e) => { if (!isDisabled) e.currentTarget.style.background = t.bg; onMouseLeave?.(e); }}
      style={{
        display: block ? 'flex' : 'inline-flex', width: block ? '100%' : undefined,
        alignItems: 'center', justifyContent: 'center', gap: z.gap,
        padding: z.padding, fontSize: z.fontSize, fontWeight: 700, fontFamily: S.font,
        lineHeight: 1.2, letterSpacing: '0.01em',
        color: t.fg, background: t.bg,
        border: `1px solid ${t.bd === 'transparent' ? 'transparent' : t.bd}`,
        borderRadius: S.radiusControl, cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.55 : 1, boxShadow: variant === 'primary' || variant === 'success' || variant === 'danger' ? S.shadowSm : 'none',
        transition: 'background 0.15s ease, opacity 0.15s ease', whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {loading
        ? <StitchSpinner size={z.icon} tone="currentColor" />
        : (icon ? <Icon name={icon} size={z.icon} /> : null)}
      {children}
      {iconRight ? <Icon name={iconRight} size={z.icon} /> : null}
    </button>
  );
}

export function StitchIconButton({ icon, label, size = 'md', variant = 'ghost', active = false, style, ...rest }) {
  const dims = size === 'sm' ? 30 : size === 'lg' ? 42 : 36;
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 20 : 18;
  const t = (BTN_TONES[variant] || BTN_TONES.ghost)();
  return (
    <button
      type="button"
      className="stitch-btn stitch-focusable"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onMouseEnter={(e) => { e.currentTarget.style.background = active ? t.bg : t.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? salpha(S.brand, 0.14) : t.bg; }}
      style={{
        width: dims, height: dims, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: active ? S.brand : t.fg, background: active ? salpha(S.brand, 0.14) : t.bg,
        border: 'none', borderRadius: S.radiusControl, cursor: 'pointer',
        transition: 'background 0.15s ease, color 0.15s ease', flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

/* ─── Badges & status ─────────────────────────────────────────────────────── */

const BADGE_TONES = {
  brand:   { bg: S.brandSoft, fg: S.onBrandSoft },
  success: { bg: S.successSoft, fg: S.onSuccessSoft },
  danger:  { bg: S.dangerSoft, fg: S.onDangerSoft },
  warn:    { bg: S.warnSoft, fg: S.onWarnSoft },
  info:    { bg: S.infoSoft, fg: S.info },
  neutral: { bg: S.surfaceContainer, fg: S.textSecondary },
};

export function StitchBadge({ children, tone = 'neutral', icon, dot = false, style, ...rest }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: S.radiusPill,
        background: t.bg, color: t.fg, fontSize: 11.5, fontWeight: 700,
        letterSpacing: '0.02em', lineHeight: 1.4, fontFamily: S.font, whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {dot ? <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /> : null}
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

const STATUS_TONE = { online: S.success, busy: S.warn, away: S.warn, offline: S.surfaceHighest, brand: S.brand, danger: S.danger };
export function StitchStatusDot({ status = 'offline', size = 8, ring = false, title }) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: '50%',
        background: STATUS_TONE[status] || STATUS_TONE.offline,
        boxShadow: ring ? `0 0 0 2px ${S.card}` : undefined, flexShrink: 0,
      }}
    />
  );
}

/* ─── Avatars ─────────────────────────────────────────────────────────────── */

function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// Deterministic tint per name (no remote avatar images — design.md forbids them).
const AVATAR_TINTS = [
  ['#e6deff', '#1c0858'], ['#cdf3c7', '#0b3d12'], ['#ffdad6', '#5b0a0a'],
  ['#fdf0d5', '#5a4000'], ['#dfe2e9', '#181c21'], ['#e3e8fd', '#1d2b66'],
];
function tintFor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function StitchAvatar({ name, size = 32, status, title, style }) {
  const [bg, fg] = tintFor(name || '');
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, ...style }} title={title || name}>
      <span
        aria-hidden={title ? undefined : true}
        style={{
          width: size, height: size, borderRadius: '50%', background: bg, color: fg,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.max(10, Math.round(size * 0.38)), fontWeight: 700, fontFamily: S.font,
          boxShadow: S.shadowSm,
        }}
      >
        {initialsOf(name)}
      </span>
      {status ? (
        <span style={{ position: 'absolute', bottom: -1, right: -1 }}>
          <StitchStatusDot status={status} size={Math.max(8, Math.round(size * 0.3))} ring />
        </span>
      ) : null}
    </span>
  );
}

export function StitchAvatarGroup({ names = [], size = 28, max = 4 }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((n, i) => (
        <span key={i} style={{ marginLeft: i ? -8 : 0, border: `2px solid ${S.card}`, borderRadius: '50%' }}>
          <StitchAvatar name={n} size={size} />
        </span>
      ))}
      {extra > 0 ? (
        <span style={{
          marginLeft: -8, width: size, height: size, borderRadius: '50%', border: `2px solid ${S.card}`,
          background: S.surfaceContainer, color: S.textSecondary, fontSize: 11, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: S.font,
        }}>+{extra}</span>
      ) : null}
    </div>
  );
}

/* ─── Headers ─────────────────────────────────────────────────────────────── */

export function StitchPageHeader({ title, subtitle, eyebrow, actions, icon, style }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        {icon ? (
          <span style={{
            width: 44, height: 44, borderRadius: 12, background: S.brandSoft, color: S.onBrandSoft,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}><Icon name={icon} size={22} /></span>
        ) : null}
        <div style={{ minWidth: 0 }}>
          {eyebrow ? <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.brand, marginBottom: 4 }}>{eyebrow}</div> : null}
          {/* overflowWrap:'anywhere' — a long unbroken title (pasted DOI-like
              string) must wrap inside the header instead of overflowing it. */}
          <h1 title={typeof title === 'string' ? title : undefined}
            style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15, color: S.textPrimary, margin: 0, overflowWrap: 'anywhere' }}>{title}</h1>
          {subtitle ? <p style={{ fontSize: 14, color: S.textSecondary, margin: '4px 0 0' }}>{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div> : null}
    </div>
  );
}

export function StitchSectionHeader({ title, desc, action, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, ...style }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: S.textPrimary, margin: 0 }}>{title}</h2>
        {desc ? <p style={{ fontSize: 12.5, color: S.textSecondary, margin: '2px 0 0' }}>{desc}</p> : null}
      </div>
      {action || null}
    </div>
  );
}

/** A compact metric/stat tile. */
export function StitchMetricCard({ label, value, delta, deltaTone = 'success', icon, tone = 'neutral', onClick, style }) {
  const accent = tone === 'brand' ? S.brand : tone === 'success' ? S.success : tone === 'danger' ? S.danger : tone === 'warn' ? S.warn : S.textSecondary;
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={onClick ? 'stitch-btn stitch-focusable' : undefined}
      style={{
        textAlign: 'left', width: '100%', background: S.card, border: `1px solid ${salpha(S.outlineVariant, 0.45)}`,
        borderRadius: S.radiusCard, boxShadow: S.shadow1, padding: S.cardPad, cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: 8, fontFamily: S.font, ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: S.textSecondary, letterSpacing: '0.01em' }}>{label}</span>
        {icon ? <span style={{ color: accent }}><Icon name={icon} size={18} /></span> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: S.textPrimary, lineHeight: 1 }}>{value}</span>
        {delta != null ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: deltaTone === 'danger' ? S.danger : S.success }}>{delta}</span>
        ) : null}
      </div>
    </Comp>
  );
}

/* ─── Progress ────────────────────────────────────────────────────────────── */

export function StitchProgressBar({ value = 0, max = 100, tone = 'brand', height = 8, label, showValue = false, style }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = tone === 'success' ? S.success : tone === 'danger' ? S.danger : tone === 'warn' ? S.warn : S.brand;
  return (
    <div style={style}>
      {(label || showValue) ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: S.textSecondary, fontWeight: 600 }}>
          <span>{label}</span>{showValue ? <span>{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
        aria-label={label || 'Progress'} aria-valuetext={`${Math.round(pct)}%`}
        style={{ height, background: S.surfaceHigh, borderRadius: S.radiusPill, overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: S.radiusPill, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

export function StitchProgressRing({ value = 0, size = 132, stroke = 12, tone = 'brand', label, sublabel }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));
  const offset = circ - (pct / 100) * circ;
  const color = tone === 'success' ? S.success : tone === 'danger' ? S.danger : tone === 'warn' ? S.warn : S.brand;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={label ? `${label}: ${Math.round(pct)}%` : `${Math.round(pct)}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={S.surfaceHigh} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: Math.round(size * 0.24), fontWeight: 700, letterSpacing: '-0.02em', color: S.textPrimary, lineHeight: 1 }}>{Math.round(pct)}%</span>
        {sublabel ? <span style={{ fontSize: 12, color: S.textSecondary, marginTop: 2 }}>{sublabel}</span> : null}
      </div>
    </div>
  );
}

/* ─── Loading / skeleton / states ─────────────────────────────────────────── */

export function StitchSpinner({ size = 20, tone, style }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: '50%',
        border: `${Math.max(2, Math.round(size / 9))}px solid ${salpha(S.outlineVariant, 0.5)}`,
        borderTopColor: tone || S.brand, animation: 'stitchSpin 0.7s linear infinite', ...style,
      }}
    >
      <style>{'@keyframes stitchSpin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){span[aria-hidden="true"]{animation:none}}'}</style>
    </span>
  );
}

export function StitchSkeleton({ width = '100%', height = 14, radius = 6, style }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block', width, height, borderRadius: radius,
        background: `linear-gradient(90deg, ${S.surfaceContainer} 25%, ${S.surfaceHigh} 37%, ${S.surfaceContainer} 63%)`,
        backgroundSize: '400% 100%', animation: 'stitchShimmer 1.4s ease infinite', ...style,
      }}
    >
      <style>{'@keyframes stitchShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}@media (prefers-reduced-motion: reduce){span[aria-hidden="true"]{animation:none}}'}</style>
    </span>
  );
}

export function StitchLoadingState({ label = 'Loading…', height = 240 }) {
  return (
    <div role="status" aria-live="polite" style={{ minHeight: height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: S.textSecondary }}>
      <StitchSpinner size={28} />
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

export function StitchEmptyState({ icon = 'folder', title, desc, action, height = 280 }) {
  return (
    <div style={{ minHeight: height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12, padding: 24 }}>
      <span style={{ width: 56, height: 56, borderRadius: 16, background: S.surfaceContainer, color: S.brand, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} />
      </span>
      <div style={{ fontSize: 16, fontWeight: 600, color: S.textPrimary }}>{title}</div>
      {desc ? <div style={{ fontSize: 13.5, color: S.textSecondary, maxWidth: 420, lineHeight: 1.6 }}>{desc}</div> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

export function StitchErrorState({ title = 'Something went wrong', desc, onRetry, retryLabel = 'Try again', height = 280 }) {
  return (
    <div role="alert" style={{ minHeight: height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12, padding: 24 }}>
      <span style={{ width: 56, height: 56, borderRadius: 16, background: S.dangerSoft, color: S.danger, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="alertTriangle" size={26} />
      </span>
      <div style={{ fontSize: 16, fontWeight: 600, color: S.textPrimary }}>{title}</div>
      {desc ? <div style={{ fontSize: 13.5, color: S.textSecondary, maxWidth: 420, lineHeight: 1.6 }}>{desc}</div> : null}
      {onRetry ? <div style={{ marginTop: 6 }}><StitchButton variant="neutral" size="sm" icon="refresh" onClick={onRetry}>{retryLabel}</StitchButton></div> : null}
    </div>
  );
}
