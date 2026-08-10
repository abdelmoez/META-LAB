/**
 * research/primitives.jsx — 109.md §57 — shared UI atoms for the Research
 * Governance Ops package.
 *
 * LEGACY DESIGN ONLY. `/ops` is pinned to the legacy chrome by ForceLegacyDesign,
 * so every style here is an inline object over the theme CSS variables in
 * theme/tokens.js. Never import a Stitch primitive into this package. Hex+alpha
 * string concatenation does NOT work on CSS vars — use `alpha(C.x, '40')`.
 *
 * These deliberately re-declare a handful of AdminConsole.jsx's file-local atoms:
 * an extracted package cannot reach them (the 95.md `users/` package made the same
 * call), and owning them is what makes this package SSR-testable in isolation.
 */
import { useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../theme/tokens.js';
import { DANGER, SOURCE } from '../../../../shared/opsSettingsCatalog.js';

/* ─── Shared styles ──────────────────────────────────────────────────────── */

export const inputStyle = {
  background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7,
  padding: '7px 10px', color: C.txt, fontFamily: FONT, fontSize: 13,
  outline: 'none', boxSizing: 'border-box',
};
export const selectStyle = { ...inputStyle, appearance: 'none', cursor: 'pointer', paddingRight: 24 };
export const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7,
  color: C.txt2, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
};
export const accentBtn = {
  ...ghostBtn, background: C.acc2, border: 'none', color: C.accText,
};

/* ─── Atoms ──────────────────────────────────────────────────────────────── */

export function Spinner({ size = 14, color = C.acc }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${alpha(color, '30')}`, borderTop: `2px solid ${color}`,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

/** Text-first pill — colour is never the only signal (the label always says it). */
export function Badge({ text, color = C.acc, title, testId }) {
  return (
    <span title={title} data-testid={testId} style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 10,
      fontWeight: 700, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase',
      color, background: alpha(color, '18'), border: `1px solid ${alpha(color, '40')}`,
      whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

export function Toggle({ checked, onChange, disabled = false, testId }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      data-testid={testId}
      style={{
        width: 40, height: 22, borderRadius: 11, background: checked ? C.acc2 : C.brd2,
        position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s', flexShrink: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
        boxShadow: `0 1px 4px ${C.shadow}`,
      }} />
    </div>
  );
}

export function SectionCard({ title, subtitle, action, children, testId }) {
  return (
    <div data-testid={testId} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, padding: '13px 18px', borderBottom: `1px solid ${C.brd}` }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.txt }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, maxWidth: 720, lineHeight: 1.55 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Chip({ label, value, color = C.acc, testId }) {
  return (
    <div data-testid={testId} style={{ flex: '1 1 110px', minWidth: 0, background: alpha(color, '10'), border: `1px solid ${alpha(color, '30')}`, borderRadius: 9, padding: '10px 13px' }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.txt, fontFamily: MONO, lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
    </div>
  );
}

export function NoticeBox({ children, tone = C.ylw, testId }) {
  return (
    <div data-testid={testId} style={{ padding: '10px 14px', background: alpha(tone, '12'), border: `1px solid ${alpha(tone, '40')}`, borderRadius: 7, color: tone, fontSize: 11.5, marginBottom: 14, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

export function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ padding: '10px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 7, color: C.red, fontSize: 12, marginBottom: 14 }}>
      {msg}
    </div>
  );
}

/** Underline sub-navigation — the SIFT_TABS pattern, kept identical on purpose. */
export function SubTabs({ tabs, active, onSelect, testIdPrefix = 'rg-tab' }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 18, borderBottom: `1px solid ${C.brd}`, flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          data-testid={`${testIdPrefix}-${t.id}`}
          onClick={() => onSelect(t.id)}
          style={{
            padding: '8px 15px', background: 'transparent', border: 'none',
            borderBottom: active === t.id ? `2px solid ${C.acc}` : '2px solid transparent',
            color: active === t.id ? C.acc : C.txt2, fontSize: 12,
            fontWeight: active === t.id ? 700 : 400, cursor: 'pointer',
            fontFamily: FONT, marginBottom: -1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 109.md §§40-42 — the confirmation modal for a consequential change. `children`
 * carries the §41 impact preview (Current → New + a plain-language consequence);
 * the reason field feeds AdminAuditLog.reason. `requireReason` is a CLIENT policy
 * for the actions §9 says must explain themselves (job requeue) — the server
 * accepts an empty reason, so this is UX rigour, not authorization.
 */
export function ConfirmModal({
  open, title, children, confirmLabel = 'Confirm', danger = false, busy = false,
  reason = '', onReason, reasonLabel = 'Reason (optional — recorded in the audit log)',
  requireReason = false, onConfirm, onCancel, testId = 'rg-confirm',
}) {
  if (!open) return null;
  const blocked = busy || (requireReason && !String(reason).trim());
  return (
    <div style={{ position: 'fixed', inset: 0, background: alpha(C.bg, 0.65), zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div data-testid={`${testId}-modal`} style={{ background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 12, padding: '24px 26px', maxWidth: 520, width: '100%', boxShadow: `0 24px 64px ${C.shadow}`, maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 12 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.65, marginBottom: 16 }}>{children}</div>
        {onReason && (
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{reasonLabel}</label>
            <textarea
              data-testid={`${testId}-reason`}
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              rows={2}
              maxLength={500}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: FONT }}
            />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button data-testid={`${testId}-cancel`} onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
            disabled={blocked}
            style={{
              ...accentBtn, background: danger ? C.red : C.acc2,
              cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.55 : 1,
            }}
          >
            {busy ? <Spinner size={12} color={C.accText} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Page N of M with prev/next. `hasMore` comes straight from the API envelope. */
export function Pager({ page, limit, total, hasMore, onPage, testId = 'rg-pager' }) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / (Number(limit) || 1)));
  if (pages <= 1 && !hasMore) return null;
  const btn = (disabled) => ({
    ...ghostBtn, padding: '4px 10px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
  });
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', justifyContent: 'flex-end', borderTop: `1px solid ${C.brd}` }}>
      <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>Page {page} of {pages} · {total} total</span>
      <button data-testid={`${testId}-prev`} onClick={() => onPage(page - 1)} disabled={page <= 1} style={btn(page <= 1)}>‹</button>
      <button data-testid={`${testId}-next`} onClick={() => onPage(page + 1)} disabled={!hasMore} style={btn(!hasMore)}>›</button>
    </div>
  );
}

/* ─── Governance badges (109.md §45 + §2) ────────────────────────────────── */

const SOURCE_LABEL = {
  [SOURCE.DATABASE]: 'database',
  [SOURCE.ENVIRONMENT]: 'managed by environment',
  [SOURCE.HARDCODED]: 'hardcoded default',
};
const SOURCE_COLOR = {
  [SOURCE.DATABASE]: C.acc,
  [SOURCE.ENVIRONMENT]: C.teal,
  [SOURCE.HARDCODED]: C.muted,
};

/** Where this value actually comes from — never a toggle that silently does nothing. */
export function SourceBadge({ entry }) {
  if (!entry) return null;
  const label = SOURCE_LABEL[entry.source] || entry.source;
  return <Badge text={entry.envVar ? `env · ${entry.envVar}` : label} color={SOURCE_COLOR[entry.source] || C.muted} title={label} />;
}

/** Governance level — 'scientific' and 'env' rows are read-only by construction. */
export function DangerBadge({ entry }) {
  if (!entry) return null;
  if (entry.danger === DANGER.SCIENTIFIC) return <Badge text="read-only · scientific" color={C.purp} title="Ops must not make scientific decisions for researchers (109.md §2)." />;
  if (entry.danger === DANGER.ENV) return <Badge text="read-only" color={C.teal} title="Changing this needs a deploy." />;
  if (entry.danger === DANGER.GUARDED) return <Badge text="confirm required" color={C.ylw} title="Consequential — saving shows an impact preview first." />;
  return null;
}

/**
 * One label/description/control row. `note` renders below the description in a
 * quieter tone (used for the "applies after client wiring lands" honesty note).
 */
export function SettingShell({ label, description, note, rationale, badges, children, last = false, testId }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 22, padding: '14px 18px', borderBottom: last ? 'none' : `1px solid ${C.brd}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{label}</span>
          {badges}
        </div>
        {description && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, maxWidth: 660, lineHeight: 1.6 }}>{description}</div>}
        {rationale && (
          <div style={{ fontSize: 11.5, color: C.txt2, marginTop: 6, maxWidth: 660, lineHeight: 1.6, borderLeft: `2px solid ${alpha(C.purp, '50')}`, paddingLeft: 9 }}>{rationale}</div>
        )}
        {note && <div style={{ fontSize: 11, color: C.ylw, marginTop: 6, maxWidth: 660, lineHeight: 1.55 }}>{note}</div>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>{children}</div>
    </div>
  );
}

/** A compact filter bar row (inputs/selects laid out inline, wrapping on narrow screens). */
export function FilterRow({ children, action }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${C.brd}` }}>
      {children}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{action}</div>
    </div>
  );
}

export function LabelledField({ label, children, width }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width }}>
      <label style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</label>
      {children}
    </div>
  );
}

/* ─── Tiny table (list/log rendering) ────────────────────────────────────── */

export function Table({ columns, rows, loading, emptyMessage = 'Nothing to show.', rowKey, testId }) {
  const th = { padding: '9px 12px', textAlign: 'left', fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}`, fontWeight: 600, whiteSpace: 'nowrap' };
  const td = { padding: '9px 12px', fontSize: 11.5, color: C.txt2, borderBottom: `1px solid ${C.brd}`, verticalAlign: 'top' };
  if (loading) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center' }}>
        <Spinner size={18} />
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10 }}>Loading…</div>
      </div>
    );
  }
  return (
    <div data-testid={testId} style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ ...th, width: c.width || 'auto' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ ...td, textAlign: 'center', color: C.muted, padding: '28px 12px' }}>{emptyMessage}</td></tr>
          ) : rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i}>
              {columns.map((c) => <td key={c.key} style={td}>{c.render ? c.render(row) : (row[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Formatting helpers ─────────────────────────────────────────────────── */

export function fmtDateTime(d) { return d ? new Date(d).toLocaleString() : '—'; }

export function fmtAgo(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

/** Value → display string for a catalogue value of any catalogue type. */
export function fmtValue(v) {
  if (v === true) return 'Enabled';
  if (v === false) return 'Disabled';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(empty)';
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/**
 * Controlled text input that keeps its own draft until blur/Enter (avoids
 * per-keystroke saves).
 *
 * 109 r2 review fix — COMMIT ONLY WHAT THE ADMIN ACTUALLY TYPED. `draft` is seeded
 * once at mount, which for a row that mounted before the settings GET resolved is
 * the CATALOGUE DEFAULT, and `commit` fired unconditionally on blur. Tabbing through
 * (or clicking into and out of) a NUMBER row therefore wrote the mount-time default
 * over a stored value with zero keystrokes — silently, since `safe` rows have no
 * confirm modal, and with an audit row attributing it to the admin. The render path
 * always used the live `value`, so nothing on screen revealed it.
 *
 * Two guards, both needed: `dirty` means "the admin edited this field", and the
 * value comparison means a draft edited back to the stored value is not a write
 * either. `shown` keeps following `value` while clean, so a save landing elsewhere
 * still refreshes the field.
 */
export const draftIsDirty = (dirty, draft, value) => dirty === true && draft !== String(value ?? '');

export function DraftInput({ value, onCommit, placeholder, width = 150, testId, type = 'text', min, max, step, disabled = false }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const [dirty, setDirty] = useState(false);
  const shown = dirty ? draft : String(value ?? '');
  const commit = () => {
    if (!dirty) return;
    setDirty(false);
    if (!draftIsDirty(true, draft, value)) return;
    onCommit(draft);
  };
  return (
    <input
      data-testid={testId}
      type={type}
      min={min}
      max={max}
      step={step}
      value={shown}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => { setDirty(true); setDraft(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      style={{ ...inputStyle, width, opacity: disabled ? 0.55 : 1 }}
    />
  );
}
