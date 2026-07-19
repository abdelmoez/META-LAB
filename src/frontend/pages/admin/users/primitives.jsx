/**
 * users/primitives.jsx — 95.md — shared UI atoms for the Ops user-management
 * redesign, using the LEGACY C/FONT/MONO/alpha token system (theme/tokens.js),
 * NOT Stitch, so the area stays visually consistent with the rest of Ops.
 *
 * The extracted users/ components live in their own modules and therefore can't
 * reach AdminConsole's file-local primitives — these are the shared building
 * blocks for this package (Spinner, Avatar, Badge, CopyText, ConfirmDialog, a
 * focus-trap hook, and shared input styles).
 */
import { useEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../theme/tokens.js';
import { initialsFor } from './fmt.js';

/* Shared input/select/button styles (legacy tokens). */
export const inputStyle = {
  width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
  borderRadius: 7, padding: '8px 11px', color: C.txt,
  fontFamily: FONT, fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
export const selectStyle = { ...inputStyle, appearance: 'none', cursor: 'pointer', paddingRight: 26 };
export const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px',
  background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7,
  color: C.txt2, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
};

export function Spinner({ size = 14, color = C.acc }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${alpha(color, '30')}`, borderTop: `2px solid ${color}`,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

/* Initials avatar. Deterministic accent tint from the seed so rows are scannable
   without loading any image. Decorative — the name/email sit beside it. */
export function Avatar({ name, email, size = 30 }) {
  const seed = (email || name || '?');
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const bg = `hsl(${hue}, 55%, 92%)`;
  const fg = `hsl(${hue}, 55%, 32%)`;
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, flexShrink: 0, borderRadius: '50%',
      background: bg, color: fg, display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700,
      fontFamily: FONT, letterSpacing: '0.02em',
    }}>{initialsFor(name, email)}</span>
  );
}

/* Quiet pill badge — text is always present (never color-only signalling). */
export function Badge({ text, color = C.acc, strong = false, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 11, fontSize: 10,
      fontWeight: 700, fontFamily: MONO, letterSpacing: '0.05em', textTransform: 'uppercase',
      color: strong ? C.accText : color,
      background: strong ? color : alpha(color, '18'),
      border: `1px solid ${alpha(color, strong ? '00' : '45')}`, whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

/* Inline copyable value with a mono option and transient "Copied" feedback. */
export function CopyText({ value, mono = false, label }) {
  const [copied, setCopied] = useState(false);
  if (value == null || value === '') return <span style={{ color: C.muted }}>—</span>;
  async function copy() {
    try { await navigator.clipboard.writeText(String(value)); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* clipboard unavailable */ }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, maxWidth: '100%' }}>
      <span style={{ fontFamily: mono ? MONO : FONT, fontSize: mono ? 11.5 : 13, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(value)}>{value}</span>
      <button type="button" onClick={copy} aria-label={`Copy ${label || 'value'}`} style={{
        flexShrink: 0, padding: '2px 7px', background: copied ? alpha(C.grn, '18') : 'transparent',
        border: `1px solid ${copied ? alpha(C.grn, '45') : C.brd2}`, borderRadius: 5,
        color: copied ? C.grn : C.muted, fontSize: 10, fontFamily: MONO, cursor: 'pointer',
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Move focus into `panelRef` on mount, trap Tab within it, close on Escape, and
 * restore focus to the trigger on unmount (WCAG 2.1.2 / 2.4.3). Same contract as
 * the WaitlistDrawer focus trap so every Ops overlay behaves identically.
 */
export function useFocusTrap(panelRef, onClose) {
  const prevFocus = useRef(null);
  useEffect(() => {
    prevFocus.current = document.activeElement;
    const t = setTimeout(() => {
      const first = panelRef.current?.querySelector(FOCUSABLE);
      if (first && typeof first.focus === 'function') first.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      const prev = prevFocus.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key === 'Tab' && panelRef.current) {
        const f = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter((el) => !el.disabled && el.offsetParent !== null);
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, panelRef]);
}

/**
 * Centered confirm dialog with focus trap. Renders `children` (e.g. a reason
 * textarea) between the message and the buttons. States the consequence in
 * `message`; the caller supplies the danger styling + busy state.
 */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger = false, busy = false, onConfirm, onCancel, children }) {
  const ref = useRef(null);
  useFocusTrap(ref, onCancel);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={busy ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: alpha(C.bg, 0.65) }} />
      <div ref={ref} style={{ position: 'relative', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 12, padding: '24px 26px', maxWidth: 460, width: '100%', boxShadow: `0 24px 64px ${C.shadow}` }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 10 }}>{title}</div>
        {message && <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, marginBottom: children ? 14 : 22 }}>{message}</div>}
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: children ? 18 : 0 }}>
          <button type="button" onClick={onCancel} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 16px',
            background: danger ? C.red : C.acc2, border: 'none', borderRadius: 7,
            color: C.accText, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: FONT, opacity: busy ? 0.7 : 1,
          }}>{busy && <Spinner size={12} color={C.accText} />}{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
