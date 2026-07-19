/**
 * users/RowMenu.jsx — 95.md Phase 6/11 — an accessible row action menu (kebab).
 *
 * Fully keyboard navigable (ArrowUp/Down, Home/End, Enter/Space, Escape),
 * closes on outside click, and is rendered fixed-positioned from the trigger's
 * rect so the table's horizontal overflow never clips it. Items the viewer may
 * not perform are simply omitted by the caller (server enforces regardless).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { C, FONT, alpha } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';

export default function RowMenu({ items, label = 'Row actions' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const usable = (items || []).filter(Boolean);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 210;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 4, left });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false); };
    const onScroll = () => setOpen(false);
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => { if (open) setActiveIdx(0); }, [open]);
  useEffect(() => {
    if (open) menuRef.current?.querySelectorAll('[role="menuitem"]')?.[activeIdx]?.focus();
  }, [open, activeIdx]);

  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % usable.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i - 1 + usable.length) % usable.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIdx(0); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIdx(usable.length - 1); }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: open ? alpha(C.acc, '16') : 'transparent', border: `1px solid ${open ? alpha(C.acc, '45') : 'transparent'}`,
          borderRadius: 6, color: open ? C.acc : C.muted, cursor: 'pointer', fontSize: 17, lineHeight: 1, fontFamily: FONT,
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = C.card2; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: 210, zIndex: 4000,
            background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 9,
            boxShadow: `0 14px 40px ${C.shadow}`, padding: 5, display: 'flex', flexDirection: 'column',
          }}
        >
          {usable.map((it, i) => (
            <button
              key={it.key || i}
              role="menuitem"
              type="button"
              tabIndex={-1}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              title={it.title}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                padding: '8px 10px', background: 'transparent', border: 'none', borderRadius: 6,
                color: it.disabled ? C.dim : (it.danger ? C.red : C.txt), fontSize: 12.5, fontFamily: FONT,
                cursor: it.disabled ? 'not-allowed' : 'pointer', fontWeight: 500,
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = it.danger ? alpha(C.red, '12') : C.card2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onFocus={(e) => { if (!it.disabled) e.currentTarget.style.background = it.danger ? alpha(C.red, '12') : C.card2; }}
              onBlur={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {it.icon && <Icon name={it.icon} size={14} />}
              <span style={{ flex: 1 }}>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
