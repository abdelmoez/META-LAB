/**
 * AdminDesignSwitch.jsx — the admin-only Legacy ⇄ Stitch design control.
 *
 * design.md §5 (ADMIN-ONLY SWITCH): visible only to admins, available in BOTH UI
 * modes (so an admin can always get back to legacy), shows the active design, and
 * switches without losing the route/project (it only flips a preference — React
 * re-renders the same route through the other shell; the URL never changes).
 *
 * Two variants so the legacy header stays visually untouched:
 *   - "floating" — a small fixed pill portaled to <body>, used in LEGACY mode.
 *     It mounts beside (not inside) the legacy header, satisfying "mount the switch
 *     from a shared shell / portal / overlay so the old header is untouched".
 *   - "inline"   — rendered directly inside the StitchTopHeader in STITCH mode.
 *
 * Non-admins render nothing (and the server refuses to persist `stitch` anyway),
 * so this control can never leak the preview to members/leaders/owners/mods.
 */
import { createPortal } from 'react-dom';
import { useDesignMode } from './DesignModeContext.jsx';

const MODES = [
  { id: 'legacy', label: 'Classic' },
  { id: 'stitch', label: 'Stitch' },
];

/** The segmented control itself — shared by both variants. */
function Segmented({ mode, setMode, tone }) {
  const isDark = tone === 'onPurple';
  const trackBg = isDark ? 'rgba(255,255,255,0.14)' : '#ebeef5';
  const idleText = isDark ? 'rgba(255,255,255,0.72)' : '#464555';
  const activeBg = isDark ? '#ffffff' : '#5d509b';
  const activeText = isDark ? '#5d509b' : '#ffffff';

  return (
    <div
      role="radiogroup"
      aria-label="Interface design"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3,
        background: trackBg, borderRadius: 9999,
        fontFamily: "'Manrope','Inter',system-ui,sans-serif",
      }}
    >
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={m.id === 'stitch' ? 'Switch to the new Stitch design (admin preview)' : 'Switch to the classic design'}
            onClick={() => setMode(m.id)}
            style={{
              appearance: 'none', border: 'none', cursor: active ? 'default' : 'pointer',
              borderRadius: 9999, padding: '5px 12px', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.01em', lineHeight: 1.2,
              background: active ? activeBg : 'transparent',
              color: active ? activeText : idleText,
              boxShadow: active && !isDark ? '0 1px 2px rgba(0,0,0,0.18)' : 'none',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminDesignSwitch({ variant = 'inline', tone }) {
  const { mode, setMode, isAdmin, isStitch } = useDesignMode();
  if (!isAdmin) return null;

  if (variant === 'floating') {
    // Only show the floating pill in legacy mode; in Stitch mode the header hosts
    // the inline control, so we avoid a duplicate.
    if (isStitch) return null;
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div
        style={{
          position: 'fixed', top: 12, right: 12, zIndex: 2147483000,
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#ffffff', border: '1px solid #c7c4d8', borderRadius: 9999,
          padding: '5px 8px 5px 12px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          fontFamily: "'Manrope','Inter',system-ui,sans-serif",
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#777587' }}>
          UI
        </span>
        <Segmented mode={mode} setMode={setMode} tone="light" />
      </div>,
      document.body,
    );
  }

  return <Segmented mode={mode} setMode={setMode} tone={tone} />;
}
