/**
 * PresenceIndicator.jsx — the ONE project-presence chip ("who's here right now")
 * for the universal project header (prompt23 Task 13 · prompt24 Tasks 2/3/8/9).
 *
 * Shows active-in-project / total-members. Hovering (or clicking) opens a popover
 * listing each active teammate, their current location, and any field they're
 * editing. It is the single source of truth for project presence and is reused
 * everywhere — the META·LAB universal header and the standalone META·SIFT shell.
 *
 * prompt24 Task 3 — the popover is rendered through a PORTAL into document.body so
 * it can never be clipped by an overflow-hidden parent, a transformed ancestor
 * (`.tab-content` animation), or a low-z navbar; it sits in the root stacking
 * context at z 10000 with viewport collision handling. Hover is "bridge-safe":
 * moving the cursor from the chip into the popover keeps it open (a short close
 * delay spans the gap), and it closes on outside-click or Escape.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Avatar } from '../ui/components.jsx';

const POPOVER_W = 280;

// Map an internal field key to a human label for the "editing …" line (Task 15).
const FIELD_LABELS = {
  'settings.requiredReviewers': 'Required reviewers',
  'settings.title': 'Project title',
  'settings.inclusion': 'Inclusion criteria',
  'settings.exclusion': 'Exclusion criteria',
  'pico.P': 'Population', 'pico.I': 'Intervention', 'pico.C': 'Comparator', 'pico.O': 'Outcome',
};
function fieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const tail = String(field || '').split('.').pop() || 'a field';
  return tail.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

export default function PresenceIndicator({ users = [], locks = [], totalMembers, myUserId }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const closeTimer = useRef(null);

  const active = users.length;

  // Anchor the portaled popover under the chip, clamped into the viewport so it
  // is never cut off on small screens (Task 3 collision handling).
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let left = r.right - POPOVER_W;                       // right-aligned to the chip
    left = Math.max(margin, Math.min(left, window.innerWidth - POPOVER_W - margin));
    const top = Math.min(r.bottom + 6, window.innerHeight - 12);
    setPos({ top, left });
  }, []);

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const openNow = useCallback(() => { cancelClose(); place(); setOpen(true); }, [place]);
  // Slight delay so the cursor can cross the 6px gap from chip → popover without
  // the popover vanishing (the classic "I can't reach the dropdown" bug).
  const scheduleClose = useCallback(() => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 160); }, []);

  useEffect(() => () => cancelClose(), []);

  // While open: reposition on scroll/resize, close on Escape / outside-click.
  useEffect(() => {
    if (!open) return undefined;
    const onMove = () => place();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, place]);

  if (active === 0) return null; // nothing to show until presence is flowing

  const locksByUser = {};
  for (const l of (locks || [])) (locksByUser[l.userId] ||= []).push(l);

  return (
    <div
      ref={triggerRef}
      style={{ position: 'relative', flexShrink: 0 }}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openNow())}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${active} active${totalMembers != null ? ` of ${totalMembers} members` : ''}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          background: alpha(C.grn, 0.12), border: `1px solid ${alpha(C.grn, 0.4)}`,
          color: C.grn, borderRadius: 20, padding: '3px 10px', fontFamily: MONO,
          fontSize: 11, fontWeight: 700,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.grn, flexShrink: 0 }} />
        {active}{totalMembers != null ? ` / ${totalMembers}` : ''}
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          role="menu"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_W, zIndex: 10000,
            background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 10,
            boxShadow: `0 10px 32px ${C.shadow}`, padding: '8px', fontFamily: FONT,
          }}
        >
          <div style={{
            fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: C.muted, padding: '4px 6px 6px',
          }}>
            Active now{totalMembers != null ? ` · ${active}/${totalMembers}` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
            {users.map(u => {
              const myLocks = locksByUser[u.userId] || [];
              const editing = myLocks.length ? `editing ${fieldLabel(myLocks[0].field)}` : null;
              return (
                <div key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 7 }}>
                  <Avatar name={u.name} size={22} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.txt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.name}{u.userId === myUserId ? ' (you)' : ''}
                    </div>
                    <div style={{ fontSize: 10.5, color: editing ? C.acc : C.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {editing || u.location || 'In project'}
                    </div>
                  </div>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.grn, flexShrink: 0 }} title="Active" />
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
