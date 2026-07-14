/**
 * TermChipRow.jsx — 85.md A2, Terms & Vocabulary master-detail. The included-terms
 * chip row for the ACTIVE concept.
 *
 * CHIP CONTENT = the SEARCHED term (audit C1: never raw [tiab]/[Mesh] syntax):
 *  - controlled + matched vocab → the descriptor + a small "MeSH" badge (the user's
 *    original text as title/secondary when it differs);
 *  - controlled with NO vocab match → an explicit warning chip ("heading not found —
 *    will not match; convert to keyword") — honest about the broken state;
 *  - freetext → the term text.
 * Non-default field / truncation / phrase / disabled ride as tiny text micro-badges
 * (visible in beginner mode too — they change recall). Disabled chips are dimmed
 * with an "off" badge. A `dup` badge NAMES the other concept ("also in
 * Intervention") — resolution actions live in the editor popover.
 *
 * The WHOLE chip is a button (≥24px target) that opens the editor popover; a
 * separate × button removes with the pinned aria-label `Remove ${term.text}`.
 * When the popover closes, focus returns to the chip (focus-trapped-lite).
 */
import { useEffect, useRef } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { termDisplay, termMicroBadges } from './uiShared.js';

export default function TermChipRow({ concept, beginner, dupInfoFor, editingTermId, onOpenEditor, onRemove, renderEditor }) {
  const terms = (concept && Array.isArray(concept.terms)) ? concept.terms.filter((t) => t && String(t.text || '').trim()) : [];
  const chipRefs = useRef({});
  const prevEditing = useRef(editingTermId);

  // Focus-return: when the editor for term X closes, put focus back on X's chip.
  useEffect(() => {
    const prev = prevEditing.current;
    prevEditing.current = editingTermId;
    if (prev && !editingTermId) {
      const el = chipRefs.current[prev];
      if (el && typeof el.focus === 'function') { try { el.focus(); } catch { /* best-effort */ } }
    }
  }, [editingTermId]);

  if (!terms.length) return null;

  return (
    <div data-testid="sb-term-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontFamily: FONT }}>
      {terms.map((t) => {
        const d = termDisplay(t);
        const badges = termMicroBadges(t);
        const off = t.disabled === true;
        const dup = dupInfoFor ? dupInfoFor(t) : null;
        const isControlled = d.kind === 'controlled' && !d.unmatched;
        const border = d.unmatched
          ? `1px solid ${alpha(C.yel, '77')}`
          : isControlled ? `1px solid ${alpha(C.acc, '66')}` : `1px dashed ${C.brd2}`;
        const bg = d.unmatched ? alpha(C.yel, '10') : isControlled ? alpha(C.acc, '0c') : 'transparent';
        return (
          <span key={t.id || t.text} style={{ position: 'relative', display: 'inline-block' }}>
            <span style={{ display: 'inline-flex', alignItems: 'stretch', borderRadius: 8, overflow: 'hidden', border, background: bg, opacity: off ? 0.55 : 1 }}>
              <button
                type="button"
                ref={(el) => { chipRefs.current[t.id] = el; }}
                onClick={() => onOpenEditor && onOpenEditor(t.id)}
                aria-label={`Edit ${t.text}`}
                aria-expanded={editingTermId === t.id}
                title={d.secondary ? `You typed: ${d.secondary}` : undefined}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  background: 'none', border: 'none', padding: '5px 4px 5px 10px', minHeight: 28,
                  fontFamily: FONT, fontSize: 12, color: C.txt, textAlign: 'left',
                }}>
                <span style={{ textDecoration: off ? 'line-through' : 'none' }}>{d.main}</span>
                {isControlled && (
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: C.acc, textTransform: 'uppercase', border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 4, padding: '0 4px' }}>MeSH</span>
                )}
                {d.unmatched && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.yel }}
                    title="This subject heading was not found — it would match nothing. Open the chip to convert it to a keyword.">
                    ⚠ heading not found — will not match
                  </span>
                )}
                {badges.map((b) => (
                  <span key={b.key} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3, color: b.key === 'off' ? C.muted : C.txt2, textTransform: 'uppercase', background: C.card2, border: `1px solid ${C.brd2}`, borderRadius: 4, padding: '0 4px' }}>
                    {b.label}
                  </span>
                ))}
                {dup && (
                  <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3, color: C.yel, textTransform: 'uppercase', background: alpha(C.yel, '14'), border: `1px solid ${alpha(C.yel, '55')}`, borderRadius: 4, padding: '0 4px' }}
                    title={`This term also appears in ${dup.otherLabel}. Concepts are AND-ed, so the duplicate can over-narrow the search — open the chip to resolve it.`}>
                    also in {dup.otherLabel}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onRemove && onRemove(t.id)}
                aria-label={`Remove ${t.text}`}
                title={`Remove "${t.text}"`}
                style={{ background: 'none', border: 'none', borderLeft: `1px solid ${C.brd}`, color: C.muted, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 8px', minWidth: 26, minHeight: 28 }}>
                ×
              </button>
            </span>
            {editingTermId === t.id && renderEditor && renderEditor(t)}
          </span>
        );
      })}
    </div>
  );
}
