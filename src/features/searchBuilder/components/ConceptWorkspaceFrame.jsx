import React from 'react';

/**
 * ConceptWorkspaceFrame.jsx — 110.md §2. The Concepts area is the Search
 * Engine's centrepiece: it is where the conceptual foundation of the strategy
 * is actually BUILT. Everything around it (the question phrase card, the PICO
 * source sections, the drift/hint banners, the meaning panel) is
 * INFORMATIONAL and sits on `C.card` with a hairline border — so before this
 * frame the board read as one more card in a stack of cards.
 *
 * The hierarchy is inverted instead of shouted: this frame is a recessed BUILD
 * CANVAS (a `--t-surf` plane with a faint accent wash at its head and a whisper
 * of a builder dot-grid) and the concept cards are the raised `--t-card`
 * objects sitting ON it. Depth, not colour, carries "this is the workspace".
 * All of it rides existing `--t-*` tokens, so day/night and the Stitch remap
 * follow automatically.
 *
 * PRESENTATION ONLY. The board itself (`data-testid="sb-concept-board"`) stays
 * in SearchBuilderTab: it owns the concept map, the drag element registries,
 * the click-outside exemption selector and the Escape-collapse contract. This
 * shell therefore stays SSR-testable on its own, and adding it changes no
 * behaviour and no persisted state.
 *
 * Styling lives in the SearchBuilderTab stylesheet (`.sb-concept-canvas` &c.),
 * next to the sibling `.sb-card-shell` rules it coordinates with — the canvas
 * de-emphasises inactive cards through a descendant selector keyed on
 * `data-has-active`, which is why that attribute is part of this contract.
 */
export default function ConceptWorkspaceFrame({ count = 0, hasActive = false, children }) {
  const n = Number.isFinite(count) ? count : 0;
  return (
    <div data-testid="sb-concept-workspace" className="sb-concept-canvas"
      data-has-active={hasActive ? 'true' : 'false'}
      data-empty={n === 0 ? 'true' : 'false'}>
      <div className="sb-canvas-head">
        {/* Mono micro-eyebrow — the house marker for "this is a surface, not prose"
            (matches the Concept N / status pills). aria-hidden: the visible title
            plus the board's own group label already name the region for AT. */}
        <span className="sb-canvas-eyebrow" aria-hidden="true">Workspace</span>
        <h3 className="sb-canvas-title">Concepts</h3>
        {n > 0 && (
          <span data-testid="sb-canvas-count" className="sb-canvas-count">
            {n} concept{n === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
