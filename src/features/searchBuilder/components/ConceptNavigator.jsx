/**
 * ConceptNavigator.jsx — 85.md A2, extended by 97.md (Phases 10/11). A horizontal
 * row of search-group pill-buttons: name, status glyph (never colour-only),
 * live-term count, suggestion-count dot. The active pill gets a strong border +
 * aria-current="true". Roving tabindex: ONE tab stop; ArrowLeft/Right move focus
 * AND selection.
 *
 * 97.md drag seams (all optional; SSR renders the idle state):
 *  - registerPillEl(id, el)      — geometry for the shared pointer-drag hook;
 *  - dropTargetGroupId           — a chip is being dragged over this pill → ring;
 *  - showNewGroupTarget          — during a chip drag, render the "New group"
 *                                  drop zone (registerNewGroupEl measures it);
 *  - pillDragHandleFor(id)       — group-reorder drag handles on the pills;
 *  - pillInsertIndex             — insertion line between pills while reordering.
 * Keyboard alternatives stay primary: group reorder = the ↑/↓ toolbar buttons,
 * cross-group moves = the term editor's "Move to group…" menu (Phase 21).
 *
 * Fixed height (single-row, horizontal scroll when crowded). Presentational leaf.
 */
import { useRef } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { liveTermsOf } from '../../../research-engine/searchBuilder/termLiveness.js';
import { conceptAccent, CONCEPT_STATUS_GLYPH } from './uiShared.js';

export default function ConceptNavigator({
  concepts, activeId, onSelect, statusFor, suggestionCounts,
  registerPillEl, dropTargetGroupId, showNewGroupTarget, registerNewGroupEl,
  pillDragHandleFor, pillInsertIndex,
}) {
  const list = Array.isArray(concepts) ? concepts : [];
  const counts = suggestionCounts || {};
  const refs = useRef({});
  const activeIdx = Math.max(0, list.findIndex((c) => c && c.id === activeId));

  const move = (from, delta) => {
    if (!list.length) return;
    const next = (from + delta + list.length) % list.length;
    const target = list[next];
    if (!target) return;
    if (onSelect) onSelect(target.id);
    const el = refs.current[target.id];
    if (el && typeof el.focus === 'function') { try { el.focus(); } catch { /* focus is best-effort */ } }
  };

  const insertionLine = (
    <span data-testid="sb-pill-insert-line" aria-hidden="true"
      style={{ display: 'inline-block', width: 3, alignSelf: 'stretch', minHeight: 30, borderRadius: 2, background: C.acc, boxShadow: `0 0 0 1px ${alpha(C.acc, '66')}`, flexShrink: 0 }} />
  );

  return (
    <div data-testid="sb-concept-navigator" role="tablist" aria-label="Search groups"
      style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', padding: '2px 2px 8px', minHeight: 44, fontFamily: FONT }}>
      {list.map((c, ci) => {
        const active = ci === activeIdx;
        const accent = conceptAccent(ci);
        const liveN = liveTermsOf(c).length;
        const status = statusFor ? statusFor(c) : 'empty';
        const suggN = counts[c.id] || 0;
        const statusCol = { empty: C.dim, 'needs-review': C.yel, 'mesh-suggested': C.acc, ready: C.grn }[status] || C.muted;
        const isDropTarget = dropTargetGroupId === c.id;
        const handle = pillDragHandleFor ? pillDragHandleFor(c.id) : null;
        return (
          <span key={c.id || ci} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {pillInsertIndex === ci && insertionLine}
            <button
              type="button"
              role="tab"
              ref={(el) => { refs.current[c.id] = el; if (registerPillEl) registerPillEl(c.id, el); }}
              aria-selected={active}
              aria-current={active ? 'true' : undefined}
              aria-label={`${c.label || 'Search group'} — ${liveN} term${liveN === 1 ? '' : 's'}${suggN ? `, ${suggN} suggestion${suggN === 1 ? '' : 's'} to review` : ''}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect && onSelect(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(ci, +1); }
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(ci, -1); }
              }}
              {...(isDropTarget ? { 'data-testid': 'sb-pill-drop-target' } : {})}
              {...(handle || {})}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, cursor: 'pointer',
                fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 600,
                color: active ? C.txt : C.txt2,
                background: active ? alpha(C.acc, '10') : C.card,
                border: active ? `2px solid ${C.acc}` : `1px solid ${C.brd2}`,
                borderLeft: `3px solid ${accent}`,
                borderRadius: 99, padding: active ? '5px 13px' : '6px 14px', minHeight: 32,
                ...(isDropTarget ? { outline: `3px solid ${C.acc}`, outlineOffset: 2 } : {}),
                ...((handle && handle.style) || {}),
              }}>
            <span aria-hidden="true" style={{ color: statusCol, fontSize: 10 }}>{CONCEPT_STATUS_GLYPH[status] || '○'}</span>
            <span style={{ whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label || 'Search group'}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: active ? C.txt2 : C.muted }}>{liveN}</span>
            {suggN > 0 && (
              <span data-testid="sb-nav-suggestion-dot" title={`${suggN} suggestion${suggN === 1 ? '' : 's'} to review`}
                style={{ fontSize: 9, fontWeight: 700, color: C.accText, background: C.acc, borderRadius: 99, padding: '0 6px', lineHeight: '14px' }}>
                {suggN}
              </span>
            )}
            </button>
          </span>
        );
      })}
      {pillInsertIndex === list.length && insertionLine}
      {/* 97.md Phase 11 — during a chip drag, a "New group" drop zone appears so a
          term can be dragged straight into a brand-new search group. */}
      {showNewGroupTarget && (
        <span
          data-testid="sb-new-group-target"
          ref={(el) => { if (registerNewGroupEl) registerNewGroupEl(el); }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 11.5, fontWeight: 700,
            color: C.acc, background: alpha(C.acc, '0c'), border: `2px dashed ${C.acc}`, borderRadius: 99,
            padding: '6px 14px', minHeight: 32,
          }}>
          ＋ New group
        </span>
      )}
    </div>
  );
}
