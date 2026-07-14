/**
 * ConceptCards.jsx — 85.md A2, Concepts stage. One card per concept: inline name,
 * role badge, live-term count, readiness status (glyph + text, never colour-only),
 * suggestion-count badge, and ONE primary action — "Edit terms →" (audit M2/H6:
 * the cards give novices the create/organize mental model without chip jargon).
 *
 * Manual concept deletion asks an INLINE confirm when the concept still carries
 * terms ("Delete concept 'X' and its N terms?") — fixing audit C4's instant,
 * unconfirmed destruction; the parent then records the removal on the undo stack.
 *
 * AND/OR join pills are hidden in beginner mode (op editing lives in the Strategy
 * preview where both operands are visible — critique #5); an OR join still shows a
 * read-only indicator so the preview never lies.
 *
 * Presentational leaf: plain props + callbacks, no fetch. The container keeps the
 * pinned `data-testid="sb-concepts-summary"` (e2e continuity).
 */
import { useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { CONCEPT_STATUS_LABELS } from '../../../research-engine/searchBuilder/searchState.js';
import { liveTermsOf } from '../../../research-engine/searchBuilder/termLiveness.js';
import { conceptAccent, CONCEPT_STATUS_GLYPH, opExplainer } from './uiShared.js';

function StatusChip({ status }) {
  const label = CONCEPT_STATUS_LABELS[status] || status;
  const col = { empty: C.dim, 'needs-review': C.yel, 'mesh-suggested': C.acc, ready: C.grn }[status] || C.muted;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: col, textTransform: 'uppercase', background: alpha(col, '14'), border: `1px solid ${alpha(col, '44')}`, borderRadius: 5, padding: '1px 7px', flexShrink: 0 }}>
      <span aria-hidden="true">{CONCEPT_STATUS_GLYPH[status] || '○'}</span>{label}
    </span>
  );
}

export default function ConceptCards({
  concepts, beginner, statusFor, suggestionCounts,
  onRename, onToggleOp, onAddConcept, onRemoveConcept, onEditTerms,
}) {
  const list = Array.isArray(concepts) ? concepts : [];
  const [confirmId, setConfirmId] = useState(null);
  const counts = suggestionCounts || {};

  const askRemove = (c, liveN) => {
    if (!onRemoveConcept) return;
    if (liveN === 0) { onRemoveConcept(c.id); return; } // nothing to lose → no ceremony
    setConfirmId(c.id);
  };

  return (
    <div data-testid="sb-concepts-summary" style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, marginTop: 12, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>Your concepts</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: C.muted }}>add different words for each idea in Terms &amp; Vocabulary</span>
      </div>
      {list.length === 0 && <div style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>No concepts yet — select keywords above, or add a concept.</div>}
      {list.map((c, ci) => {
        const accent = conceptAccent(ci);
        const liveN = liveTermsOf(c).length;
        const status = statusFor ? statusFor(c) : 'empty';
        const suggN = counts[c.id] || 0;
        const confirming = confirmId === c.id;
        return (
          <div key={c.id || ci}>
            <div data-testid="sb-concept-card" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: C.surf, border: `1px solid ${C.brd2}`, borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: '8px 10px' }}>
              <input value={c.label || ''} onChange={(e) => onRename && onRename(c.id, e.target.value)}
                aria-label={`Concept name: ${c.label || ''}`}
                style={{ fontWeight: 600, flex: '1 1 140px', minWidth: 120, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 12.5, color: C.txt, fontFamily: FONT }} />
              {c.picoField && (
                <span title="One of the five PICO groups — auto-generated from your protocol"
                  style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.acc, textTransform: 'uppercase', background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '44')}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>
                  {c.field || 'PICO'}
                </span>
              )}
              <span style={{ fontSize: 9.5, color: C.dim, fontFamily: MONO, flexShrink: 0 }}>{liveN} term{liveN === 1 ? '' : 's'}</span>
              <StatusChip status={status} />
              {suggN > 0 && (
                <span data-testid="sb-suggestion-badge" title={`${suggN} vocabulary suggestion${suggN === 1 ? '' : 's'} to review in Terms & Vocabulary`}
                  style={{ fontSize: 9, fontWeight: 700, color: C.acc, background: alpha(C.acc, '10'), border: `1px solid ${alpha(C.acc, '44')}`, borderRadius: 99, padding: '1px 8px', flexShrink: 0 }}>
                  {suggN} suggestion{suggN === 1 ? '' : 's'}
                </span>
              )}
              {!confirming && (
                <button type="button" onClick={() => onEditTerms && onEditTerms(c.id)}
                  style={{ marginLeft: 'auto', background: alpha(C.acc, '0c'), border: `1px solid ${alpha(C.acc, '44')}`, borderRadius: 7, color: C.acc, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: FONT, padding: '4px 12px', flexShrink: 0, minHeight: 24 }}>
                  Edit terms →
                </button>
              )}
              {!c.picoField && !confirming && onRemoveConcept && (
                <button type="button" onClick={() => askRemove(c, liveN)}
                  aria-label={`Delete concept ${c.label || ''}`} title="Delete this concept"
                  style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 15, padding: '2px 6px', lineHeight: 1, flexShrink: 0, minWidth: 24, minHeight: 24 }}>
                  ×
                </button>
              )}
              {confirming && (
                <span role="alertdialog" aria-label={`Delete concept ${c.label || ''}?`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: C.txt2 }}>Delete concept “{c.label}” and its {liveN} term{liveN === 1 ? '' : 's'}?</span>
                  <button type="button" onClick={() => { setConfirmId(null); onRemoveConcept && onRemoveConcept(c.id); }}
                    style={{ background: alpha(C.red, '10'), border: `1px solid ${alpha(C.red, '44')}`, borderRadius: 6, color: C.red, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, fontFamily: FONT, padding: '3px 10px' }}>
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)}
                    style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '3px 10px' }}>
                    Cancel
                  </button>
                </span>
              )}
            </div>
            {ci < list.length - 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '3px 0' }}>
                {beginner ? (
                  (c.op === 'OR') ? (
                    <span title={opExplainer('OR')}
                      style={{ fontSize: 9.5, fontWeight: 700, fontFamily: MONO, letterSpacing: 1, color: C.yel, border: `1px solid ${alpha(C.yel, '55')}`, borderRadius: 6, padding: '1px 12px' }}>
                      OR
                    </span>
                  ) : null /* AND is the calm default — no pill noise for beginners (M3) */
                ) : (
                  <button type="button" onClick={() => onToggleOp && onToggleOp(c.id)}
                    title="How this concept combines with the next — click to switch AND/OR"
                    aria-label={`Joined to the next concept with ${c.op || 'AND'} — click to switch`}
                    style={{ background: C.card2, border: `1px solid ${alpha(c.op === 'OR' ? C.yel : C.acc, '55')}`, borderRadius: 6, cursor: 'pointer', fontSize: 9.5, padding: '2px 12px', fontFamily: MONO, letterSpacing: 1, fontWeight: 700, color: c.op === 'OR' ? C.yel : C.acc, minHeight: 24 }}>
                    {c.op || 'AND'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {onAddConcept && (
        <button type="button" onClick={onAddConcept}
          style={{ width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: C.muted, border: `1px dashed ${C.brd2}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: '7px 14px', marginTop: 8 }}>
          + Add concept
        </button>
      )}
    </div>
  );
}
