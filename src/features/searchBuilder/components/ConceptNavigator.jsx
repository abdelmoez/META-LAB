/**
 * ConceptNavigator.jsx — 85.md A2, Terms & Vocabulary master-detail. A horizontal
 * row of concept pill-buttons: name, status glyph (never colour-only), live-term
 * count, suggestion-count dot. The active pill gets a strong border + filled bg +
 * aria-current="true". Roving tabindex: the row is ONE tab stop; ArrowLeft/Right
 * move focus AND selection (the mode-cards keyboard pattern).
 *
 * Fixed height (single-row, horizontal scroll when crowded) so switching concepts
 * never shifts the row's own layout. Presentational leaf: plain props + callbacks.
 */
import { useRef } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { liveTermsOf } from '../../../research-engine/searchBuilder/termLiveness.js';
import { conceptAccent, CONCEPT_STATUS_GLYPH } from './uiShared.js';

export default function ConceptNavigator({ concepts, activeId, onSelect, statusFor, suggestionCounts }) {
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

  return (
    <div data-testid="sb-concept-navigator" role="tablist" aria-label="Concepts"
      style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', padding: '2px 2px 8px', minHeight: 44, fontFamily: FONT }}>
      {list.map((c, ci) => {
        const active = ci === activeIdx;
        const accent = conceptAccent(ci);
        const liveN = liveTermsOf(c).length;
        const status = statusFor ? statusFor(c) : 'empty';
        const suggN = counts[c.id] || 0;
        const statusCol = { empty: C.dim, 'needs-review': C.yel, 'mesh-suggested': C.acc, ready: C.grn }[status] || C.muted;
        return (
          <button
            key={c.id || ci}
            type="button"
            role="tab"
            ref={(el) => { refs.current[c.id] = el; }}
            aria-selected={active}
            aria-current={active ? 'true' : undefined}
            aria-label={`${c.label || 'Concept'} — ${liveN} term${liveN === 1 ? '' : 's'}${suggN ? `, ${suggN} suggestion${suggN === 1 ? '' : 's'} to review` : ''}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect && onSelect(c.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(ci, +1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(ci, -1); }
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, cursor: 'pointer',
              fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 600,
              color: active ? C.txt : C.txt2,
              background: active ? alpha(C.acc, '10') : C.card,
              border: active ? `2px solid ${C.acc}` : `1px solid ${C.brd2}`,
              borderLeft: `3px solid ${accent}`,
              borderRadius: 99, padding: active ? '5px 13px' : '6px 14px', minHeight: 32,
            }}>
            <span aria-hidden="true" style={{ color: statusCol, fontSize: 10 }}>{CONCEPT_STATUS_GLYPH[status] || '○'}</span>
            <span style={{ whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label || 'Concept'}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: active ? C.txt2 : C.muted }}>{liveN}</span>
            {suggN > 0 && (
              <span data-testid="sb-nav-suggestion-dot" title={`${suggN} suggestion${suggN === 1 ? '' : 's'} to review`}
                style={{ fontSize: 9, fontWeight: 700, color: C.accText, background: C.acc, borderRadius: 99, padding: '0 6px', lineHeight: '14px' }}>
                {suggN}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
