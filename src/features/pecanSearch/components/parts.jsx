/**
 * pecanSearch/components/parts.jsx — small presentational building blocks shared
 * across the Search & Discovery workspace, built on the LEGACY workspace tokens
 * (C / btnS / tagS) so the deep tool matches the calm, dense academic surface of
 * the rest of the app in both light and dark mode.
 *
 * Accessibility is baked in: status pills carry text (never colour-only), the
 * stat tiles read as a description list, and disclosures use native <details> so
 * keyboard + screen-reader behaviour is correct for free.
 */
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { Icon } from '../../../frontend/components/icons.jsx';
import { C, btnS, tagS } from '../../../frontend/workspace/ui/styles.js';

/* Map a run/source/preview state to a tag colour + readable label. Never relies
   on colour alone — the label text is always present. */
export const STATE_TONE = {
  queued: 'blue', running: 'blue', pending: 'gray',
  completed: 'green', partial: 'yellow', failed: 'red',
  cancelled: 'gray', skipped: 'gray', cancelling: 'yellow',
};
export function runStateLabel(state) {
  return ({
    queued: 'Queued', running: 'Running', pending: 'Pending', completed: 'Completed',
    partial: 'Partial success', failed: 'Failed', cancelled: 'Cancelled',
    cancelling: 'Cancelling…', skipped: 'Skipped',
  })[state] || (state ? String(state) : 'Unknown');
}

/** A status pill: coloured background + an icon glyph + text (AA, non-color-only). */
export function StatusPill({ state, children }) {
  const tone = STATE_TONE[state] || 'gray';
  return (
    <span style={{ ...tagS(tone) }}>
      <span aria-hidden="true" style={{ marginRight: 4 }}>{glyphFor(state)}</span>
      {children || runStateLabel(state)}
    </span>
  );
}
function glyphFor(state) {
  if (['completed'].includes(state)) return '✓';
  if (['failed'].includes(state)) return '✕';
  if (['partial', 'cancelling'].includes(state)) return '◐';
  if (['cancelled', 'skipped'].includes(state)) return '–';
  if (['running', 'queued', 'pending'].includes(state)) return '•';
  return '•';
}

/** Section card — the standard surface for a product area. */
export function Card({ title, desc, icon, right, children, padding = 18 }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding, marginBottom: 16 }}>
      {(title || right) && (
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: desc ? 6 : 12 }}>
          {icon && (
            <div aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, color: C.acc, background: themeAlpha(C.acc, '16'), border: `1px solid ${themeAlpha(C.acc, '28')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon} size={14} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: C.txt, letterSpacing: -0.2 }}>{title}</h3>}
            {desc && <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{desc}</p>}
          </div>
          {right && <div style={{ flexShrink: 0 }}>{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A compact metric tile — used in the live/completion summaries. The label is
   exposed to assistive tech via aria-label so the big number reads with context. */
export function StatTile({ label, value, tone, hint }) {
  const col = tone === 'green' ? C.grn : tone === 'red' ? C.red : tone === 'yellow' ? C.yel : tone === 'accent' ? C.acc : C.txt;
  const display = value == null ? '—' : value;
  return (
    <div role="group" aria-label={`${label}: ${display}`} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 5, fontSize: 22, fontWeight: 700, color: col, fontFamily: "'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums' }}>
        {display}
      </div>
      {hint && <div style={{ fontSize: 10.5, color: C.dim, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** Progressive-disclosure inspector built on native <details> (keyboard-safe). */
export function Disclosure({ summary, count, children, defaultOpen = false }) {
  return (
    <details open={defaultOpen} style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', userSelect: 'none', fontSize: 11.5, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
        <span aria-hidden="true" style={{ fontSize: 9 }}>▸</span>
        {summary}{count != null && count > 0 ? ` (${count})` : ''}
      </summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}

/** A small inline message box (info / warn / error / success) with an icon + role. */
export function Note({ tone = 'info', children, role }) {
  const col = tone === 'warn' ? C.yel : tone === 'error' ? C.red : tone === 'success' ? C.grn : C.acc;
  return (
    <div role={role} style={{ background: themeAlpha(col, '0e'), border: `1px solid ${themeAlpha(col, '22')}`, borderLeft: `3px solid ${themeAlpha(col, '80')}`, borderRadius: 8, padding: '9px 13px', fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

/** A skeleton block for loading states (respects reduced motion via CSS class). */
export function Skeleton({ height = 14, width = '100%', radius = 6, style }) {
  return <div className="ml-skeleton" aria-hidden="true" style={{ height, width, borderRadius: radius, background: C.card2, ...style }} />;
}

/** A friendly empty state with an icon, headline, and optional action. */
export function EmptyState({ icon = 'search', title, children, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 24px', color: C.muted }}>
      <div aria-hidden="true" style={{ color: C.dim, marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Icon name={icon} size={30} /></div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.txt2, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>{children}</div>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/** A primary/ghost/danger button bound to the legacy btnS token. */
export function Btn({ variant = 'primary', children, busy, ...rest }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} style={{ ...btnS(variant), ...(rest.style || {}), opacity: rest.disabled || busy ? 0.55 : 1, cursor: rest.disabled || busy ? 'not-allowed' : 'pointer' }}>
      {busy ? <span className="spin-ico" aria-hidden="true">⟳</span> : null}
      {children}
    </button>
  );
}

/** A count-preview cell: estimate/exact get a number; the rest get a labelled dash. */
export function CountValue({ count, kind, at }) {
  const known = (kind === 'estimate' || kind === 'exact') && count != null;
  const label = kind === 'exact' ? 'exact' : kind === 'estimate' ? 'estimated' : kind === 'unsupported' ? 'not supported' : kind === 'unavailable' ? 'unavailable' : kind === 'throttled' ? 'updating…' : kind === 'timeout' ? 'timed out — runs in full' : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: known ? C.txt : C.dim, fontVariantNumeric: 'tabular-nums' }}>
        {known ? Number(count).toLocaleString() : '—'}
      </span>
      {label && <span style={{ fontSize: 10, color: C.muted }}>{label}</span>}
      {at && known && <span style={{ fontSize: 9.5, color: C.dim }} title={`Estimated ${formatWhen(at)}`}>· {formatWhen(at)}</span>}
    </span>
  );
}

export function formatWhen(at) {
  try {
    const d = new Date(at);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  } catch { return ''; }
}

/* Mini hook: a small custom toggle that is a real <button role=switch> for a11y. */
export function Toggle({ on, onChange, ariaLabel, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={ariaLabel} disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <span aria-hidden="true" style={{ width: 34, height: 20, borderRadius: 10, position: 'relative', boxSizing: 'border-box', background: on ? C.acc2 : C.dim, border: `1px solid ${on ? C.acc2 : C.brd2}`, transition: 'background 0.2s, border-color 0.2s' }}>
        <span className="ml-switch-knob" style={{ position: 'absolute', top: 1, left: on ? 15 : 1, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.35)', transition: 'left 0.2s var(--ease-out)' }} />
      </span>
    </button>
  );
}

/** A tiny score bar (0..1) for duplicate confidence — labelled, not colour-only. */
export function ScoreBar({ score, threshold }) {
  const pct = Math.max(0, Math.min(1, Number(score) || 0)) * 100;
  const col = pct >= 85 ? C.red : pct >= 60 ? C.yel : C.acc;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.muted, marginBottom: 3 }}>
        <span>Match score</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: C.txt }}>{(Number(score) || 0).toFixed(2)}{threshold != null ? ` / thr ${Number(threshold).toFixed(2)}` : ''}</span>
      </div>
      <div style={{ height: 6, background: C.brd, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: col, borderRadius: 99 }} />
      </div>
    </div>
  );
}

/* Local provider description blurb for the source cards (no secrets, static). */
export function CredsBadge({ requiresCredentials, configured }) {
  if (!requiresCredentials) return <span style={{ ...tagS('gray') }}>No key required</span>;
  return configured
    ? <span style={{ ...tagS('green') }}>Key configured</span>
    : <span style={{ ...tagS('yellow') }}>Key required</span>;
}
