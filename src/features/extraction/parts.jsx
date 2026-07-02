/**
 * features/extraction/parts.jsx — 66.md (P5). Small shared presentational bits for
 * the structured-extraction workspace: banners, cards, chips, skeletons, empty/error
 * states, and the type-appropriate value inputs. All styling goes through the
 * workspace `--t-*` theme tokens (via C / btnS / inp / lbl) and themeAlpha for tints,
 * matching PecanSearchTab's house style. No data fetching lives here.
 */
import { C, btnS, inp, lbl } from '../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../frontend/theme/tokens.js';

/* ── Layout primitives ─────────────────────────────────────────────────────── */

export function Card({ children, style, pad = 14 }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: pad, ...style }}>
      {children}
    </div>
  );
}

export function Skeleton({ h = 14, w = '100%', mb = 8, r = 6 }) {
  return (
    <div style={{
      height: h, width: w, marginBottom: mb, borderRadius: r,
      background: `linear-gradient(90deg, ${themeAlpha(C.brd, '55')}, ${themeAlpha(C.brd, '22')}, ${themeAlpha(C.brd, '55')})`,
    }} />
  );
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div style={{
      background: 'var(--t-red-bg)', border: `1px solid ${themeAlpha(C.red, '44')}`,
      borderLeft: `3px solid ${C.red}`, borderRadius: 8, padding: '10px 14px', marginBottom: 12,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12, color: C.txt, lineHeight: 1.5 }}>
        <strong style={{ color: C.red }}>Something went wrong: </strong>{message || 'Unexpected error.'}
      </span>
      {onRetry && <button onClick={onRetry} style={{ ...btnS('ghost'), fontSize: 11 }}>Retry</button>}
    </div>
  );
}

export function EmptyState({ icon = '📋', title, hint, action }) {
  return (
    <div style={{ background: C.card, border: `1px dashed ${C.brd2}`, borderRadius: 10, padding: 34, textAlign: 'center', color: C.muted }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      {title && <div style={{ fontSize: 14, color: C.txt, marginBottom: 6, fontWeight: 600 }}>{title}</div>}
      {hint && <div style={{ fontSize: 12, marginBottom: action ? 16 : 0, lineHeight: 1.55, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>{hint}</div>}
      {action}
    </div>
  );
}

/* ── Chips / badges ────────────────────────────────────────────────────────── */

const CHIP_COLORS = {
  green: C.grn, red: C.red, amber: C.yel, blue: C.acc, purple: C.purp, muted: C.muted,
};

export function Chip({ tone = 'muted', children, title }) {
  const col = CHIP_COLORS[tone] || C.muted;
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 99,
      fontSize: 10, fontWeight: 600, letterSpacing: 0.2, whiteSpace: 'nowrap',
      background: themeAlpha(col, '14'), color: col, border: `1px solid ${themeAlpha(col, '30')}`,
    }}>{children}</span>
  );
}

export function Dot({ on, title, color = C.grn }) {
  return (
    <span title={title} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: 99,
      background: on ? color : 'transparent', border: `1px solid ${on ? color : C.brd2}`,
    }} />
  );
}

/** The mandatory, always-visible AI-review banner (66.md rule 1). */
export function AiReviewBanner() {
  return (
    <div style={{
      background: themeAlpha(C.yel, '12'), border: `1px solid ${themeAlpha(C.yel, '44')}`,
      borderLeft: `3px solid ${C.yel}`, borderRadius: 8, padding: '9px 12px', marginBottom: 12,
      fontSize: 11.5, color: C.txt, lineHeight: 1.5,
    }}>
      <strong style={{ color: C.yel }}>⚠ AI suggestions require human review</strong> — nothing is saved until you accept.
    </div>
  );
}

/* ── Value inputs (type-appropriate) ───────────────────────────────────────── */

const numInp = { ...inp, fontSize: 12, padding: '6px 8px', fontFamily: "'IBM Plex Mono',monospace" };

function LabeledNum({ label, value, onChange, disabled, placeholder }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.dim, marginBottom: 3, letterSpacing: 0.4 }}>{label}</div>
      <input
        value={value == null ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder || ''}
        inputMode="decimal"
        style={{ ...numInp, opacity: disabled ? 0.6 : 1 }}
      />
    </div>
  );
}

/**
 * ValueInput — renders the right control for an element's TYPE and returns the
 * canonical value object shape via onChange:
 *   dichotomous_outcome → { events, total }
 *   continuous_outcome  → { mean, sd, n }
 *   categorical         → { value } (from allowedValues)
 *   numeric/text/date/… → { value } (+ unit when the element defines one)
 */
export function ValueInput({ element, value, onChange, disabled }) {
  const v = value && typeof value === 'object' ? value : {};
  const set = (patch) => onChange({ ...v, ...patch });

  if (element.type === 'dichotomous_outcome') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <LabeledNum label="Events" value={v.events} onChange={(x) => set({ events: x })} disabled={disabled} placeholder="n" />
        <LabeledNum label="Total" value={v.total} onChange={(x) => set({ total: x })} disabled={disabled} placeholder="N" />
      </div>
    );
  }

  if (element.type === 'continuous_outcome') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <LabeledNum label="Mean" value={v.mean} onChange={(x) => set({ mean: x })} disabled={disabled} />
        <LabeledNum label="SD" value={v.sd} onChange={(x) => set({ sd: x })} disabled={disabled} />
        <LabeledNum label="N" value={v.n} onChange={(x) => set({ n: x })} disabled={disabled} placeholder="n" />
      </div>
    );
  }

  if (element.type === 'categorical' && Array.isArray(element.allowedValues) && element.allowedValues.length) {
    return (
      <select
        value={v.value == null ? '' : v.value}
        onChange={(e) => onChange({ value: e.target.value })}
        disabled={disabled}
        style={{ ...inp, fontSize: 12.5 }}
      >
        <option value="">— select —</option>
        {element.allowedValues.map((av) => <option key={av} value={av}>{av}</option>)}
      </select>
    );
  }

  const isNumeric = ['numeric', 'baseline', 'adverse_event'].includes(element.type);
  const isDate = element.type === 'date';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        value={v.value == null ? '' : v.value}
        onChange={(e) => onChange({ value: e.target.value, ...(element.unit ? { unit: element.unit } : {}) })}
        disabled={disabled}
        placeholder={isDate ? 'YYYY or YYYY-MM-DD' : element.type === 'text' ? 'Enter value…' : ''}
        inputMode={isNumeric ? 'decimal' : undefined}
        style={{ ...inp, fontSize: 12.5, fontFamily: isNumeric ? "'IBM Plex Mono',monospace" : 'inherit', opacity: disabled ? 0.6 : 1 }}
      />
      {element.unit ? <span style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap' }}>{element.unit}</span> : null}
    </div>
  );
}

/** A compact read-only rendering of a canonical value object. */
export function renderValue(element, value) {
  if (!value || typeof value !== 'object') return '—';
  if (element && element.type === 'dichotomous_outcome') {
    if (value.events == null && value.total == null) return '—';
    return `${value.events ?? '?'} / ${value.total ?? '?'}`;
  }
  if (element && element.type === 'continuous_outcome') {
    const parts = [];
    if (value.mean != null) parts.push(`mean ${value.mean}`);
    if (value.sd != null) parts.push(`sd ${value.sd}`);
    if (value.n != null) parts.push(`n ${value.n}`);
    return parts.length ? parts.join(', ') : '—';
  }
  if (value.value == null || value.value === '') return '—';
  return `${value.value}${value.unit ? ` ${value.unit}` : ''}`;
}

export { C, btnS, inp, lbl, themeAlpha };
