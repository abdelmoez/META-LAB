/**
 * PresenceIndicator.jsx — "who's here right now" chip for the project utility area
 * (prompt23 Task 13). Shows active-in-project / total-members with a hover popover
 * listing each active teammate, their current location, and any field they're
 * editing. Theme-aware, compact, and self-hiding when nobody else is around.
 */
import { useState } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Avatar } from '../ui/components.jsx';

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
  const active = users.length;
  if (active === 0) return null; // nothing to show until presence is flowing

  const locksByUser = {};
  for (const l of (locks || [])) (locksByUser[l.userId] ||= []).push(l);

  return (
    <div
      style={{ position: 'relative', flexShrink: 0 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`${active} active${totalMembers != null ? ` of ${totalMembers} members` : ''}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default',
          background: alpha(C.grn, 0.12), border: `1px solid ${alpha(C.grn, 0.4)}`,
          color: C.grn, borderRadius: 20, padding: '3px 10px', fontFamily: MONO,
          fontSize: 11, fontWeight: 700,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.grn, flexShrink: 0 }} />
        {active}{totalMembers != null ? ` / ${totalMembers}` : ''}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, minWidth: 220, maxWidth: 300,
          background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 10,
          boxShadow: `0 10px 32px ${C.shadow}`, padding: '8px', fontFamily: FONT,
        }}>
          <div style={{
            fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: C.muted, padding: '4px 6px 6px',
          }}>
            Active now{totalMembers != null ? ` · ${active}/${totalMembers}` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
        </div>
      )}
    </div>
  );
}
