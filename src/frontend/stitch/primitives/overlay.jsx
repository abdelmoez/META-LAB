/**
 * overlay.jsx — Stitch overlays + structured data primitives.
 *
 * Modal/Drawer: focus-trapped, Escape-to-close, restore focus on close, scroll
 * lock, blurred backdrop. Tooltip: portal, keyboard + hover, ambiguous-icon labels.
 * Tabs: roving role=tablist. Table: semantic <table> with sticky header. Toast:
 * an ARIA live region so async results are announced (design.md accessibility).
 */
import {
  createContext, useContext, useState, useCallback, useEffect, useRef, useId,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../theme/stitchTokens.js';

/* ─── Focus trap helper ───────────────────────────────────────────────────── */
function useFocusTrap(active, onClose) {
  const ref = useRef(null);
  const prevFocus = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    prevFocus.current = document.activeElement;
    const node = ref.current;
    const sel = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const f = node?.querySelectorAll(sel);
      if (f && f.length) f[0].focus();
      else node?.focus();
    };
    const t = setTimeout(focusFirst, 0);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(node?.querySelectorAll(sel) || []).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      try { prevFocus.current?.focus?.(); } catch { /* ignore */ }
    };
  }, [active, onClose]);
  return ref;
}

/* ─── Modal ───────────────────────────────────────────────────────────────── */
export function StitchModal({ open, onClose, title, children, footer, width = 480, labelledBy, name }) {
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-testid="stitch-modal-backdrop"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147482000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
        background: 'rgba(20,22,32,0.42)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={ref}
        role="dialog" aria-modal="true" aria-labelledby={labelledBy || (title ? titleId : undefined)}
        tabIndex={-1}
        data-testid="stitch-modal"
        data-modal={name || undefined}
        className="stitch-scale-in stitch-scope"
        style={{
          width: '100%', maxWidth: width, maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column',
          background: S.card, borderRadius: S.radiusModal, boxShadow: S.shadow2, fontFamily: S.font, overflow: 'hidden',
        }}
      >
        {title ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.5)}` }}>
            <h2 id={titleId} data-testid="stitch-modal-title" style={{ fontSize: 17, fontWeight: 700, color: S.textPrimary, margin: 0 }}>{title}</h2>
            <button type="button" data-testid="stitch-modal-close" aria-label="Close dialog" onClick={onClose} className="stitch-focusable"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textMuted, display: 'inline-flex', padding: 4, borderRadius: 6 }}>
              <Icon name="menu" size={18} style={{ display: 'none' }} />
              <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>×</span>
            </button>
          </div>
        ) : null}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer ? <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: `1px solid ${salpha(S.outlineVariant, 0.5)}`, background: S.surfaceLow }}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ─── Drawer (off-canvas side panel; used for mobile nav) ──────────────────── */
export function StitchDrawer({ open, onClose, side = 'left', width = 300, title, children, label }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2147482000, background: 'rgba(20,22,32,0.42)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={label || title} tabIndex={-1}
        className="stitch-scope"
        style={{
          position: 'absolute', top: 0, bottom: 0, [side]: 0, width: '88%', maxWidth: width,
          background: S.card, boxShadow: S.shadow2, display: 'flex', flexDirection: 'column', fontFamily: S.font,
          animation: `stitchDrawer${side === 'left' ? 'L' : 'R'} 0.22s ease-out`,
        }}
      >
        <style>{`@keyframes stitchDrawerL{from{transform:translateX(-100%)}to{transform:none}}@keyframes stitchDrawerR{from{transform:translateX(100%)}to{transform:none}}@media (prefers-reduced-motion: reduce){[class*="stitchDrawer"]{animation:none!important}}`}</style>
        {title ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.5)}` }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: S.textPrimary, margin: 0 }}>{title}</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="stitch-focusable" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textMuted, fontSize: 20 }}>×</button>
          </div>
        ) : null}
        <div style={{ flex: 1, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Tooltip ─────────────────────────────────────────────────────────────── */
export function StitchTooltip({ label, children, placement = 'top' }) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const reveal = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const map = {
      top: { left: r.left + r.width / 2, top: r.top - 8, tx: '-50%', ty: '-100%' },
      bottom: { left: r.left + r.width / 2, top: r.bottom + 8, tx: '-50%', ty: '0' },
      right: { left: r.right + 10, top: r.top + r.height / 2, tx: '0', ty: '-50%' },
      left: { left: r.left - 10, top: r.top + r.height / 2, tx: '-100%', ty: '-50%' },
    };
    setCoords(map[placement] || map.top);
    setShow(true);
  };
  return (
    <span
      ref={ref}
      onMouseEnter={reveal} onMouseLeave={() => setShow(false)}
      onFocus={reveal} onBlur={() => setShow(false)}
      style={{ display: 'inline-flex' }}
    >
      {children}
      {show && coords && typeof document !== 'undefined' ? createPortal(
        <span role="tooltip" style={{
          position: 'fixed', left: coords.left, top: coords.top, transform: `translate(${coords.tx}, ${coords.ty})`,
          background: S.inverse, color: S.onInverse, fontSize: 12, fontWeight: 600, fontFamily: S.font,
          padding: '6px 10px', borderRadius: 8, boxShadow: S.shadow2, zIndex: 2147483600, pointerEvents: 'none',
          whiteSpace: 'nowrap', maxWidth: 280,
        }}>{label}</span>,
        document.body,
      ) : null}
    </span>
  );
}

/* ─── Tabs ────────────────────────────────────────────────────────────────── */
export function StitchTabs({ tabs = [], value, onChange, style }) {
  return (
    <div role="tablist" aria-label="Sections" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${salpha(S.outlineVariant, 0.6)}`, overflowX: 'auto', ...style }}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id} role="tab" aria-selected={active} type="button"
            className="stitch-focusable"
            onClick={() => onChange?.(t.id)}
            style={{
              appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer',
              padding: '10px 14px', fontSize: 13.5, fontWeight: 600, fontFamily: S.font, whiteSpace: 'nowrap',
              color: active ? S.brand : S.textSecondary,
              borderBottom: `2px solid ${active ? S.brand : 'transparent'}`, marginBottom: -1,
              display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'color 0.15s ease',
            }}
          >
            {t.icon ? <Icon name={t.icon} size={16} /> : null}
            {t.label}
            {t.count != null ? (
              <span style={{ fontSize: 11, fontWeight: 700, background: active ? S.brandSoft : S.surfaceContainer, color: active ? S.onBrandSoft : S.textSecondary, borderRadius: 9999, padding: '1px 7px' }}>{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Table ───────────────────────────────────────────────────────────────── */
export function StitchTable({ columns = [], rows = [], rowKey = (_, i) => i, onRowClick, empty, dense = false, style }) {
  if (!rows.length && empty) return empty;
  const pad = dense ? '8px 12px' : '12px 16px';
  return (
    <div className="stitch-scope" style={{ overflowX: 'auto', borderRadius: S.radiusCardSm, border: `1px solid ${salpha(S.outlineVariant, 0.45)}`, ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: S.font, fontSize: 13.5 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{
                textAlign: c.align || 'left', padding: pad, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', color: S.textMuted, background: S.surfaceLow, position: 'sticky', top: 0,
                borderBottom: `1px solid ${salpha(S.outlineVariant, 0.5)}`, whiteSpace: 'nowrap', width: c.width,
              }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row, i); } : undefined}
              style={{ cursor: onRowClick ? 'pointer' : 'default', transition: 'background 0.12s ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = S.surfaceLow; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {columns.map((c) => (
                <td key={c.key} style={{
                  padding: pad, textAlign: c.align || 'left', color: S.textPrimary,
                  borderBottom: i < rows.length - 1 ? `1px solid ${salpha(S.outlineVariant, 0.35)}` : 'none',
                  verticalAlign: 'middle',
                }}>
                  {c.render ? c.render(row, i) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Pagination ──────────────────────────────────────────────────────────── */
export function StitchPagination({ page = 1, pageCount = 1, onPage, style }) {
  if (pageCount <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style }}>
      <button type="button" className="stitch-btn stitch-focusable" disabled={page <= 1} onClick={() => onPage?.(page - 1)}
        aria-label="Previous page"
        style={{ border: `1px solid ${S.outlineVariant}`, background: S.card, borderRadius: 8, padding: '6px 10px', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1, color: S.textSecondary }}>
        <Icon name="arrowLeft" size={16} />
      </button>
      <span style={{ fontSize: 13, color: S.textSecondary, fontWeight: 600 }}>Page {page} of {pageCount}</span>
      <button type="button" className="stitch-btn stitch-focusable" disabled={page >= pageCount} onClick={() => onPage?.(page + 1)}
        aria-label="Next page"
        style={{ border: `1px solid ${S.outlineVariant}`, background: S.card, borderRadius: 8, padding: '6px 10px', cursor: page >= pageCount ? 'not-allowed' : 'pointer', opacity: page >= pageCount ? 0.5 : 1, color: S.textSecondary }}>
        <Icon name="arrowRight" size={16} />
      </button>
    </div>
  );
}

/* ─── Toast system ────────────────────────────────────────────────────────── */
const ToastContext = createContext({ toast: () => {} });
export function useStitchToast() { return useContext(ToastContext); }

const TOAST_TONES = {
  success: { icon: 'circleCheck', color: S.success, bg: S.successSoft },
  error:   { icon: 'alertTriangle', color: S.danger, bg: S.dangerSoft },
  info:    { icon: 'info', color: S.brand, bg: S.brandSoft },
  warn:    { icon: 'alertTriangle', color: S.warn, bg: S.warnSoft },
};

export function StitchToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const dismiss = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback((message, opts = {}) => {
    const id = ++idRef.current;
    const item = { id, message, tone: opts.tone || 'info', duration: opts.duration ?? 4000 };
    setItems((xs) => [...xs, item]);
    if (item.duration > 0) setTimeout(() => dismiss(id), item.duration);
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {typeof document !== 'undefined' ? createPortal(
        <div aria-live="polite" aria-atomic="false" style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 2147483600, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 380, fontFamily: S.font }}>
          {items.map((it) => {
            const t = TOAST_TONES[it.tone] || TOAST_TONES.info;
            return (
              <div key={it.id} role="status" data-testid="stitch-toast" data-tone={it.tone} className="stitch-scale-in" style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: S.card,
                border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderLeft: `3px solid ${t.color}`,
                borderRadius: 10, boxShadow: S.shadow2,
              }}>
                <span style={{ color: t.color, display: 'inline-flex', marginTop: 1 }}><Icon name={t.icon} size={18} /></span>
                <span style={{ flex: 1, fontSize: 13.5, color: S.textPrimary, lineHeight: 1.5 }}>{it.message}</span>
                <button type="button" aria-label="Dismiss" onClick={() => dismiss(it.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: S.textMuted, fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </ToastContext.Provider>
  );
}
