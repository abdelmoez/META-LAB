/**
 * StitchHistoryControls.jsx — 108.md §22 "Undo/Redo availability" + §25
 * "do not make important functionality exclusively dependent on keyboard".
 *
 * The visible half of the project-wide history: an Undo/Redo icon pair in the
 * StitchProjectWorkspace header action cluster, disabled from the CURRENT page's
 * availability and carrying the shortcut in a StitchTooltip hint line — the slot
 * `overlay.jsx` documents as being for keyboard shortcuts.
 *
 * ── WHY THE STITCH HEADER AND NOT A PER-ENGINE TOOLBAR ───────────────────────
 * `headerRow`'s right-hand cluster is the only per-engine toolbar surface in the
 * Stitch shell, so one pair serves Search, Screening, Extraction, Analysis and the
 * Manuscript editor without any of them inventing its own (108.md §3 "centralized
 * enough that every engine does not invent its own").
 *
 * ── KNOWN GAP, DELIBERATE ────────────────────────────────────────────────────
 * `headerRow` is `null` in Focus Mode (StitchProjectWorkspace) — the whole row is
 * the "page metadata" 104.md removes there. The buttons therefore disappear in
 * Focus Mode; the KEYBOARD shortcuts keep working, which is the mandatory half of
 * 108.md §22 ("the keyboard shortcuts are mandatory", controls are "optional if the
 * current design would become cluttered"). Re-adding them to the slim focus bar
 * would put chrome back into the mode whose entire purpose is removing it.
 *
 * The view is split from the hook so the disabled states can be asserted under
 * `renderToStaticMarkup` (effects never run there, so a real history can never be
 * populated in a unit test).
 */
import { useProjectHistory } from '../../history/HistoryContext.jsx';
import { StitchIconButton } from '../primitives/core.jsx';
import { StitchTooltip } from '../primitives/overlay.jsx';

/** Pure presentation — no context, no state. */
export function HistoryControlsView({ canUndo, canRedo, onUndo, onRedo }) {
  const btn = (on) => ({
    opacity: on ? 1 : 0.38,
    cursor: on ? 'pointer' : 'not-allowed',
  });
  return (
    <div data-testid="stitch-history-controls" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <StitchTooltip label="Undo" hint="Ctrl+Z">
        <StitchIconButton
          icon="undo" label="Undo" size="sm"
          data-testid="stitch-history-undo"
          disabled={!canUndo}
          aria-disabled={!canUndo}
          onClick={canUndo ? onUndo : undefined}
          style={btn(canUndo)}
        />
      </StitchTooltip>
      <StitchTooltip label="Redo" hint="Ctrl+Shift+Z">
        <StitchIconButton
          icon="redo" label="Redo" size="sm"
          data-testid="stitch-history-redo"
          disabled={!canRedo}
          aria-disabled={!canRedo}
          onClick={canRedo ? onRedo : undefined}
          style={btn(canRedo)}
        />
      </StitchTooltip>
    </div>
  );
}

/** The mounted control pair. Inert (and correctly disabled) outside a provider. */
export function StitchHistoryControls() {
  const { canUndo, canRedo, undo, redo } = useProjectHistory();
  return (
    <HistoryControlsView
      canUndo={canUndo} canRedo={canRedo}
      onUndo={() => { undo(); }} onRedo={() => { redo(); }}
    />
  );
}

export default StitchHistoryControls;
