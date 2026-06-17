/**
 * Tooltip.jsx — the app's reusable, accessible tooltip (prompt29 Part 8).
 *
 * Portal-based (renders into document.body) so it is never clipped by an
 * overflow:hidden / scroll container and always wins z-index. Themed with the
 * `--t-*` design tokens, so it is correct in day AND dark mode. Shows on hover
 * AND keyboard focus, dismisses on Escape, and wires `aria-describedby` so screen
 * readers announce it. Supports a short `content` string, or a richer
 * `title` + `description` pair.
 *
 * Usage:
 *   <Tooltip content="Sent to META·LAB">…trigger…</Tooltip>
 *   <Tooltip title="Dr. Smith — Included" description="Reviewed Jun 16, 2026">…</Tooltip>
 *
 * The trigger is wrapped in an inline-flex span (keeps layout neutral). Pass
 * `as="span"`/`as="div"` and `wrapStyle` if you need a different wrapper.
 */
import { useState, useRef, useId, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { C, FONT } from '../theme/tokens.js';

const GAP = 8;        // px between trigger and bubble
const MAXW = 260;     // max bubble width

export default function Tooltip({
  content, title, description, children,
  placement = 'top', delay = 120, disabled = false,
  as = 'span', wrapStyle, contentMaxWidth = MAXW,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { left, top, place }
  const triggerRef = useRef(null);
  const bubbleRef = useRef(null);
  const showTimer = useRef(null);
  const id = useId();

  const hasContent = !!(content || title || description);

  const compute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bw = Math.min(contentMaxWidth, bubbleRef.current?.offsetWidth || contentMaxWidth);
    const bh = bubbleRef.current?.offsetHeight || 36;
    const vw = window.innerWidth, vh = window.innerHeight;

    // Vertical placement with auto-flip when there isn't room.
    let place = placement;
    if (place === 'top' && r.top - bh - GAP < 4) place = 'bottom';
    else if (place === 'bottom' && r.bottom + bh + GAP > vh - 4) place = 'top';

    let top;
    if (place === 'top') top = r.top - bh - GAP;
    else if (place === 'bottom') top = r.bottom + GAP;
    else top = r.top + r.height / 2 - bh / 2; // left/right (vertical centre)

    let left;
    if (place === 'left') left = r.left - bw - GAP;
    else if (place === 'right') left = r.right + GAP;
    else left = r.left + r.width / 2 - bw / 2; // top/bottom (horizontal centre)

    // Clamp into the viewport so it is never cut off.
    left = Math.max(6, Math.min(left, vw - bw - 6));
    top = Math.max(6, Math.min(top, vh - bh - 6));
    setPos({ left, top, place });
  }, [placement, contentMaxWidth]);

  const show = useCallback(() => {
    if (disabled || !hasContent) return;
    clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => { setOpen(true); }, delay);
  }, [disabled, hasContent, delay]);

  const hide = useCallback(() => {
    clearTimeout(showTimer.current);
    setOpen(false);
    setPos(null);
  }, []);

  // Position AFTER the bubble has rendered (so we can measure it), then keep it
  // pinned to the trigger while open. Recompute on scroll/resize.
  useEffect(() => {
    if (!open) return undefined;
    compute();
    const onMove = () => compute();
    const onKey = e => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, compute, hide]);

  useEffect(() => () => clearTimeout(showTimer.current), []);

  const Wrap = as;
  return (
    <>
      <Wrap
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
        style={{ display: as === 'div' ? 'block' : 'inline-flex', ...wrapStyle }}
      >
        {children}
      </Wrap>
      {open && hasContent && createPortal(
        <div
          id={id}
          ref={bubbleRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos ? pos.left : -9999,
            top: pos ? pos.top : -9999,
            zIndex: 100000,
            maxWidth: contentMaxWidth,
            pointerEvents: 'none',
            opacity: pos ? 1 : 0,
            background: C.card,
            color: C.txt,
            border: `1px solid ${C.brd}`,
            borderRadius: 8,
            boxShadow: `0 6px 22px ${C.shadow}`,
            padding: (title || description) ? '8px 11px' : '6px 10px',
            fontFamily: FONT,
            fontSize: 12,
            lineHeight: 1.45,
            transition: 'opacity 0.1s ease',
          }}
        >
          {title && <div style={{ fontWeight: 700, color: C.txt, marginBottom: description ? 3 : 0 }}>{title}</div>}
          {description && <div style={{ color: C.txt2, fontSize: 11.5 }}>{description}</div>}
          {!title && !description && <span style={{ color: C.txt2 }}>{content}</span>}
        </div>,
        document.body,
      )}
    </>
  );
}
