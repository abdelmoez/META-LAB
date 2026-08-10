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
// 109.md §5/§16 — the `projectUndoRedo` kill switch and `interaction.redoEnabled`.
import { useGovernanceFlag, useOpsGovernance } from '../../featureAccess/opsGovernance.js';
import { StitchIconButton } from '../primitives/core.jsx';
import { StitchTooltip } from '../primitives/overlay.jsx';

/**
 * 108 review §22 — the two DISABLED states are not the same thing and must not read
 * the same. "Nothing to undo" is silence; "there are entries, but the page that knows
 * how to reverse them is not mounted" (every screening sub-tab except Title &
 * Abstract, an extraction article the user navigated away from) needs to say so, or
 * the control looks broken. Same copy as the provider's NO_EXECUTOR note.
 */
export function historyControlLabel(direction, blocked) {
  const dir = direction === 'redo' ? 'Redo' : 'Undo';
  if (!blocked) return dir;
  return `${dir} — return to the page where the change was made`;
}

/** Pure presentation — no context, no state. */
export function HistoryControlsView({ canUndo, canRedo, onUndo, onRedo, undoBlocked, redoBlocked, showRedo = true }) {
  const btn = (on) => ({
    opacity: on ? 1 : 0.38,
    cursor: on ? 'pointer' : 'not-allowed',
  });
  const undoLabel = historyControlLabel('undo', !canUndo && undoBlocked);
  const redoLabel = historyControlLabel('redo', !canRedo && redoBlocked);
  return (
    <div data-testid="stitch-history-controls" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <StitchTooltip label={undoLabel} hint="Ctrl+Z">
        <StitchIconButton
          icon="undo" label="Undo" size="sm"
          data-testid="stitch-history-undo"
          disabled={!canUndo}
          aria-disabled={!canUndo}
          title={undoLabel}
          onClick={canUndo ? onUndo : undefined}
          style={btn(canUndo)}
        />
      </StitchTooltip>
      {showRedo && (
        <StitchTooltip label={redoLabel} hint="Ctrl+Shift+Z">
          <StitchIconButton
            icon="redo" label="Redo" size="sm"
            data-testid="stitch-history-redo"
            disabled={!canRedo}
            aria-disabled={!canRedo}
            title={redoLabel}
            onClick={canRedo ? onRedo : undefined}
            style={btn(canRedo)}
          />
        </StitchTooltip>
      )}
    </div>
  );
}

/**
 * The mounted control pair. Inert (and correctly disabled) outside a provider.
 *
 * `canUndo`/`canRedo` come straight from the provider, which is where BOTH extra
 * rules live: availability is executor-aware (a non-empty stack whose page is
 * unmounted is not available), and a scope may delegate its undo to the page itself
 * (the Search Builder's own stack — without that, this pair was permanently greyed
 * out on the Search stage while Ctrl+Z undid perfectly well, §25).
 */
export function StitchHistoryControls() {
  const {
    canUndo, canRedo, undo, redo, undoBlocked, redoBlocked,
  } = useProjectHistory();
  /* 109.md §5 — `projectUndoRedo` OFF removes the AFFORDANCE, not just its
     availability: two permanently-greyed buttons read as a broken feature, and §5
     says a disabled feature "hides the affordance". The provider already forces
     canUndo/canRedo false, so nothing here can act even if it were rendered.
     109.md §16 — `interaction.redoEnabled` OFF drops the Redo button alone; Undo is
     untouched ("Off keeps undo working"). Both hooks resolve to the shipped defaults
     on the first render, so the pair is unchanged at defaults. */
  const undoRedoOn = useGovernanceFlag('projectUndoRedo');
  const gov = useOpsGovernance();
  if (!undoRedoOn) return null;
  return (
    <HistoryControlsView
      canUndo={canUndo} canRedo={canRedo}
      undoBlocked={undoBlocked} redoBlocked={redoBlocked}
      showRedo={gov.redoEnabled !== false}
      onUndo={() => { undo(); }} onRedo={() => { redo(); }}
    />
  );
}

export default StitchHistoryControls;
