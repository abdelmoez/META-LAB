/**
 * dndModel.js — 97.md Phases 6/11 (plan §12, Decision D1). PURE hit-testing and
 * gesture-model helpers for the hand-rolled pointer-event drag-and-drop in the
 * Select & Build Key Terms workspace. No React, no DOM — geometry comes in as
 * plain rects so every rule is unit-testable (house style).
 *
 * The model deliberately distinguishes the TWO drop affordances 97.md requires to
 * never share feedback:
 *   - { kind:'insert', groupId, index }  → reorder: a visible INSERTION LINE
 *   - { kind:'merge',  targetId }        → combine: a distinct MERGE-TARGET ring,
 *     armed only after the pointer has hovered the target's centre zone for
 *     MERGE_HOVER_MS (accidental merges are hard by construction)
 *   - { kind:'group',  groupId }         → move the chip into another group
 *   - { kind:'new-group' }               → move the chip into a brand-new group
 *
 * A rect is { left, top, right, bottom }. The pointer is { x, y }.
 */

/** Pointer must travel this far (px) from pointerdown before a drag starts —
 *  plain clicks stay clicks. */
export const DRAG_START_PX = 5;

/** How long (ms) the pointer must hover a chip's merge zone before the merge
 *  target arms (97.md Phase 6: "a short hover threshold"). */
export const MERGE_HOVER_MS = 350;

/** The horizontal fraction of a chip counted as its central MERGE zone; the
 *  remaining edges resolve to insertion (reorder) positions. */
export const MERGE_ZONE_FRACTION = 0.5;

const num = (v) => (Number.isFinite(v) ? v : 0);

/** True once the pointer has moved far enough from the press point to start a drag. */
export function shouldStartDrag(start, current, threshold = DRAG_START_PX) {
  if (!start || !current) return false;
  const dx = num(current.x) - num(start.x);
  const dy = num(current.y) - num(start.y);
  return (dx * dx + dy * dy) >= threshold * threshold;
}

export function pointInRect(p, r) {
  if (!p || !r) return false;
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/**
 * resolveDropTarget(geometry, pointer, opts) → target | null
 *
 * geometry = {
 *   chips:  [{ id, groupId, index, rect }]   — the visible term chips, in order
 *   groups: [{ id, rect }]                   — other-group drop zones (navigator pills)
 *   newGroup: { rect } | null                — the "new group" drop zone (during drag)
 * }
 * opts = { dragId, sameGroupOnlyMerge = true, mergeOnly = false }
 *
 * Rules (documented in the plan §12):
 *  1. Pointer inside another-group zone → { kind:'group', groupId } (never a merge —
 *     cross-group combine is not a supported gesture; move first, then combine).
 *  2. Pointer inside the new-group zone → { kind:'new-group' }.
 *  3. Pointer inside a chip: the central MERGE_ZONE_FRACTION resolves to
 *     { kind:'merge', targetId } (excluding the dragged chip itself); the outer
 *     edges resolve to { kind:'insert' } before/after that chip.
 *  4. Pointer inside the chip ROW band but between chips → nearest insertion index.
 *  5. Anywhere else → null (drop cancels).
 *
 * `mergeOnly` (97 QA M15 — the QUESTION-TOKEN tray): the source sentence's word
 * order is fixed, so reordering source tokens is meaningless. With mergeOnly the
 * ONLY droppable target is another chip — the WHOLE chip resolves to
 * { kind:'merge' } (no centre-zone split, so combine is easier to hit) and the
 * insert/gap paths never resolve: the drag can never signal a reorder it would
 * not perform. Documented variation from the generic token-tray contract
 * (term-chip reorder lives on the group chips, which keep the full model).
 */
export function resolveDropTarget(geometry, pointer, opts = {}) {
  const g = geometry || {};
  const p = pointer || { x: 0, y: 0 };
  const dragId = opts.dragId;
  const mergeOnly = opts.mergeOnly === true;

  for (const zone of Array.isArray(g.groups) ? g.groups : []) {
    if (zone && pointInRect(p, zone.rect)) return { kind: 'group', groupId: zone.id };
  }
  if (g.newGroup && pointInRect(p, g.newGroup.rect)) return { kind: 'new-group' };

  const chips = (Array.isArray(g.chips) ? g.chips : []).filter((c) => c && c.rect);
  if (!chips.length) return null;

  // 3. Direct chip hit: centre = merge, edges = insert before/after.
  //    (mergeOnly: the whole chip is the merge zone; edges never resolve.)
  for (const chip of chips) {
    if (!pointInRect(p, chip.rect)) continue;
    if (mergeOnly) {
      return chip.id !== dragId ? { kind: 'merge', targetId: chip.id, groupId: chip.groupId } : null;
    }
    const width = chip.rect.right - chip.rect.left;
    const margin = (width * (1 - MERGE_ZONE_FRACTION)) / 2;
    const inMergeZone = p.x >= chip.rect.left + margin && p.x <= chip.rect.right - margin;
    if (inMergeZone && chip.id !== dragId) {
      return { kind: 'merge', targetId: chip.id, groupId: chip.groupId };
    }
    const before = p.x < chip.rect.left + width / 2;
    return { kind: 'insert', groupId: chip.groupId, index: before ? chip.index : chip.index + 1 };
  }
  if (mergeOnly) return null; // no gap/insert resolution for the question tray

  // 4. Inside the row band (vertically) but between/past chips → nearest gap.
  const bandTop = Math.min(...chips.map((c) => c.rect.top));
  const bandBottom = Math.max(...chips.map((c) => c.rect.bottom));
  if (p.y < bandTop || p.y > bandBottom) return null;
  let best = null;
  for (const chip of chips) {
    // Only consider chips whose vertical band contains the pointer (wrapping rows).
    if (p.y < chip.rect.top || p.y > chip.rect.bottom) continue;
    const mid = (chip.rect.left + chip.rect.right) / 2;
    const before = p.x < mid;
    const edgeX = before ? chip.rect.left : chip.rect.right;
    const d = Math.abs(p.x - edgeX);
    if (!best || d < best.d) best = { d, index: before ? chip.index : chip.index + 1, groupId: chip.groupId };
  }
  return best ? { kind: 'insert', groupId: best.groupId, index: best.index } : null;
}

/**
 * Advance the merge-arming state machine. `hover` is the previous
 * { targetId, since } (or null); returns the next hover state.
 * The caller derives `armed` via mergeArmed(hover, now).
 */
export function trackMergeHover(hover, target, now) {
  if (!target || target.kind !== 'merge') return null;
  if (hover && hover.targetId === target.targetId) return hover; // keep the original timestamp
  return { targetId: target.targetId, since: num(now) };
}

/** True when the pointer has hovered the SAME merge target long enough. */
export function mergeArmed(hover, now, thresholdMs = MERGE_HOVER_MS) {
  return !!hover && (num(now) - num(hover.since)) >= thresholdMs;
}

/**
 * Normalize an insertion index for a same-group reorder: removing the dragged
 * chip first shifts later indices down by one. Returns the FINAL index the term
 * should land at, or null when the drop is a no-op (same position).
 */
export function normalizeReorderIndex(fromIndex, insertIndex) {
  const from = num(fromIndex);
  let to = num(insertIndex);
  if (to > from) to -= 1; // the dragged chip vacates its slot
  return to === from ? null : to;
}

/**
 * combineSpanFromTokens(tokens, i, j) — the question-card drag-to-combine model
 * (97.md Phase 5's "sodium-glucose cotransporter 2" example). Returns
 *   { text, components:[{ text }...] } | null
 * for the CONTIGUOUS token span between i and j inclusive (any order), preserving
 * the tokens' semantic order, collapsing whitespace, and recording the individual
 * token texts as the phrase-component history (plan §7 — term-level `components`
 * makes split-later lossless). Pure.
 */
export function combineSpanFromTokens(tokens, i, j) {
  const list = Array.isArray(tokens) ? tokens : [];
  const a = Number.isInteger(i) ? i : -1;
  const b = Number.isInteger(j) ? j : -1;
  if (!list.length || a < 0 || b < 0 || a >= list.length || b >= list.length || a === b) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const parts = list.slice(lo, hi + 1)
    .map((t) => String((t && t.text) || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { text: parts.join(' '), components: parts.map((text) => ({ text })) };
}
