/**
 * ActiveConceptPanel.jsx — 85.md A2, reshaped by 98.md §9 into the per-concept
 * CARD of the horizontal concept board. Every concept renders one of these side
 * by side (flex-wrap in SearchBuilderTab); the ACTIVE card carries the working
 * surfaces (add box, chip row, suggestions) as children, inactive cards render
 * compact (chips only) and activate on click. The header keeps: inline name,
 * ordinal, MeSH-coverage badge, readiness status — plus (98.md §9) the group
 * drag handle and the suggestion-count dot that used to live on the retired
 * navigator pills.
 *
 * 96.md QA additions (unchanged):
 *  - M4: the ORIGINATING PHRASE line — shows `sourcePhrase` with a small inline
 *    "Update phrase" editor (onUpdateSourcePhrase) so a kept group can be
 *    re-anchored to the current question and stop re-drifting;
 *  - M6: the within-group operator is deliberately fixed OR (changing it would
 *    require coordinated changes across every compiler + the pecan AST); the
 *    guidance line therefore offers the SUPPORTED path — "Need AND between terms?
 *    Split them into separate groups" (onRequestSplit opens the split panel);
 *  - M8: `readOnly` disables the rename input with an access explanation and
 *    hides the phrase editor.
 *
 * 98.md §8 — terminology: the user-facing noun is CONCEPT (group) everywhere.
 * 98.md §5 — the per-group OR/AND explainer ¶ is Beginner-Mode content.
 *
 * Presentational: plain props + callbacks, no fetch.
 */
import { useState } from 'react';
import { C, FONT, alpha } from '../../../frontend/theme/tokens.js';
import { CONCEPT_STATUS_LABELS } from '../../../research-engine/searchBuilder/searchState.js';
import { liveTermsOf } from '../../../research-engine/searchBuilder/termLiveness.js';
import { conceptAccent, CONCEPT_STATUS_GLYPH } from './uiShared.js';

export default function ActiveConceptPanel({
  concept, conceptIndex, status, readOnly, onRename, onRenameCommit, onRenameBegin, onUpdateSourcePhrase, onRequestSplit, children,
  // 98.md §9 — board-card seams (all optional; the legacy single-panel mount still works):
  compact,            // true → inactive card: tighter padding, no guidance ¶, activate-on-click
  active,             // true → this card is the working card (strong border)
  onActivate,         // click-to-activate (inactive cards)
  dragHandle,         // pointer-drag handle props for group reorder/merge (spread onto the grip)
  registerEl,         // (el) → geometry registration (cross-group drop target + reorder)
  isDropTarget,       // a chip/group drag is hovering this card → ring
  suggestionCount,    // pending vocabulary suggestions (badge; used to be the navigator dot)
  beginner,           // 98.md §5 — gates the explanatory ¶
  testId,             // data-testid override (active card keeps 'sb-active-concept')
}) {
  const c = concept || {};
  const accent = conceptAccent(conceptIndex || 0);
  const live = liveTermsOf(c);
  const meshN = live.filter((t) => t.type === 'controlled' && t.vocab).length;
  const st = status || 'empty';
  const stCol = { empty: C.dim, 'needs-review': C.yel, 'mesh-suggested': C.acc, ready: C.grn }[st] || C.muted;
  // M4 — inline sourcePhrase editing state (local draft; commit via callback).
  const [phraseEditing, setPhraseEditing] = useState(false);
  const [phraseDraft, setPhraseDraft] = useState('');
  const startPhraseEdit = () => { setPhraseDraft(c.sourcePhrase || ''); setPhraseEditing(true); };
  const savePhrase = () => {
    const v = phraseDraft.trim();
    if (v && onUpdateSourcePhrase) onUpdateSourcePhrase(v);
    setPhraseEditing(false);
  };

  // 98.md review (H14) — compact cards must be KEYBOARD-activatable, not
  // click-only (the retired navigator's pills were real buttons). The section
  // itself is focusable with Enter/Space activation; events originating on the
  // card's own interactive children (chips, inputs, the drag grip) are ignored
  // so nested controls keep their semantics.
  const fromInteractive = (e) => {
    const t = e.target;
    return !!(t && typeof t.closest === 'function' && t.closest('button, input, textarea, a, select, [role="dialog"]'));
  };
  return (
    <section data-testid={testId || 'sb-active-concept'} aria-label={`Concept group: ${c.label || ''}`}
      aria-current={active ? 'true' : undefined}
      ref={registerEl}
      onClick={compact && onActivate ? onActivate : undefined}
      tabIndex={compact && onActivate ? 0 : undefined}
      onKeyDown={compact && onActivate ? (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !fromInteractive(e)) { e.preventDefault(); onActivate(); }
      } : undefined}
      title={compact && onActivate ? 'Select this concept to edit it' : undefined}
      style={{
        background: C.card, borderRadius: 10, padding: compact ? '10px 12px' : 14, fontFamily: FONT,
        border: active ? `2px solid ${C.acc}` : `1px solid ${C.brd}`,
        borderLeft: `3px solid ${accent}`,
        flex: 1, minWidth: 0, boxSizing: 'border-box',
        cursor: compact && onActivate ? 'pointer' : undefined,
        ...(isDropTarget ? { outline: `3px solid ${C.acc}`, outlineOffset: 2 } : {}),
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {/* 98.md §9 — the group-reorder/merge drag handle (was the navigator pill).
            Keyboard alternatives stay primary: ↑/↓ Move + Merge into… in the
            active card's toolbar. */}
        {dragHandle && !readOnly && (
          <span aria-hidden="true" title="Drag to reorder this concept, or drop it onto another concept to merge"
            data-testid="sb-card-drag-handle"
            {...dragHandle}
            style={{ cursor: 'grab', color: C.dim, fontSize: 12, letterSpacing: 1, padding: '2px 2px', userSelect: 'none', flexShrink: 0, ...((dragHandle && dragHandle.style) || {}) }}>
            ⠿
          </span>
        )}
        {/* 97.md Phase 8 — neutral ordinal: the header always names its position in
            the AND chain, independent of any custom name. 98.md §8 — "Concept N". */}
        <span data-testid="sb-group-ordinal" title="This concept's position in the AND chain"
          style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.muted, textTransform: 'uppercase', background: C.card2, border: `1px solid ${C.brd2}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>
          Concept {(Number.isInteger(conceptIndex) ? conceptIndex : 0) + 1}
        </span>
        <input value={c.label || ''} onChange={(e) => { if (!readOnly && onRename) onRename(e.target.value); }}
          onFocus={() => { if (!readOnly && onRenameBegin) onRenameBegin(); }} /* 98.md review (M4) — the rename-undo session tracks THIS card, not the active one */
          onBlur={() => { if (!readOnly && onRenameCommit) onRenameCommit(); }}
          onClick={(e) => { if (compact) e.stopPropagation(); }}
          aria-label={`Concept name: ${c.label || ''}`}
          readOnly={!!readOnly} aria-disabled={readOnly || undefined}
          title={readOnly ? 'Read-only access — ask a project editor to rename this concept' : 'Rename this concept'}
          style={{ fontWeight: 700, flex: '1 1 120px', minWidth: 110, background: 'transparent', border: 'none', padding: '2px 0', fontSize: compact ? 13 : 14, color: C.txt, fontFamily: FONT, cursor: readOnly ? 'not-allowed' : 'text' }} />
        {/* (97.md — the "Legacy group" badge is retired; legacy picoField groups render
            like any other concept group. `picoField` itself is RETAINED in state.) */}
        {suggestionCount > 0 && (
          <span data-testid="sb-nav-suggestion-dot" title={`${suggestionCount} suggestion${suggestionCount === 1 ? '' : 's'} to review`}
            style={{ fontSize: 9, fontWeight: 700, color: C.accText, background: C.acc, borderRadius: 99, padding: '0 6px', lineHeight: '14px', flexShrink: 0 }}>
            {suggestionCount}
          </span>
        )}
        {!compact && c.picoField !== 'T' && live.length > 0 && (
          <span data-testid="sb-mesh-coverage"
            title={meshN > 0 ? 'This concept includes a matched MeSH term' : 'No MeSH term yet — adding one from the suggestions usually improves recall'}
            style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', borderRadius: 4, padding: '0 5px', color: meshN > 0 ? C.grn : C.muted, border: `1px solid ${alpha(meshN > 0 ? C.grn : C.muted, '55')}`, flexShrink: 0 }}>
            {meshN > 0 ? 'has MeSH term' : 'no MeSH term yet'}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: stCol, textTransform: 'uppercase', background: alpha(stCol, '14'), border: `1px solid ${alpha(stCol, '44')}`, borderRadius: 5, padding: '1px 7px', flexShrink: 0 }}>
          {/* 97.md Phase 13 — exact vocabulary naming: the retired "Subject heading
              suggested" status label reads "MeSH term suggested" here (UI-layer
              override; the engine constant is swept separately). */}
          <span aria-hidden="true">{CONCEPT_STATUS_GLYPH[st] || '○'}</span>{st === 'mesh-suggested' ? 'MeSH term suggested' : (CONCEPT_STATUS_LABELS[st] || st)}
        </span>
      </div>
      {/* 96.md QA M4 — the originating question phrase, editable in place (active card only). */}
      {!compact && (c.sourcePhrase || phraseEditing) && (
        <div data-testid="sb-source-phrase" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', margin: '0 0 8px', fontSize: 11, color: C.muted }}>
          {!phraseEditing && (
            <>
              <span>From the question phrase “<span style={{ color: C.txt2, fontWeight: 600 }}>{c.sourcePhrase}</span>”</span>
              {!readOnly && onUpdateSourcePhrase && (
                <button type="button" onClick={startPhraseEdit}
                  aria-label={`Update the phrase for ${c.label || 'this concept'}`}
                  title="Change which question phrase this concept traces back to (drift detection follows it)"
                  style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 10.5, fontFamily: FONT, textDecoration: 'underline', padding: 0, minHeight: 20 }}>
                  Update phrase
                </button>
              )}
            </>
          )}
          {phraseEditing && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <input value={phraseDraft} onChange={(e) => setPhraseDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePhrase(); } if (e.key === 'Escape') setPhraseEditing(false); }}
                aria-label={`New phrase for ${c.label || 'this concept'}`} placeholder="phrase from the question…" autoFocus
                style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '4px 8px', color: C.txt, fontFamily: FONT, fontSize: 11, width: 220 }} />
              <button type="button" onClick={savePhrase} disabled={!phraseDraft.trim()}
                style={{ background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 6, color: C.acc, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, fontFamily: FONT, padding: '2px 10px', minHeight: 22, opacity: phraseDraft.trim() ? 1 : 0.5 }}>
                Save phrase
              </button>
              <button type="button" onClick={() => setPhraseEditing(false)}
                style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '2px 10px', minHeight: 22 }}>
                Cancel
              </button>
            </span>
          )}
        </div>
      )}
      {/* 98.md §5 — the OR/AND explainer is Beginner-Mode content (active card only);
          the compact "Need AND?" affordance stays for everyone (it names a real action). */}
      {!compact && beginner && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
          Add different words researchers may use for {c.label || 'this idea'}. Terms in this concept are combined with <strong>OR</strong> — any one of them counts as a match. Separate concepts are combined with <strong>AND</strong>.
          {/* 96.md QA M6 — within-group OR is fixed by design (documented limitation);
              the supported path to AND between terms is separate concepts. */}
          {onRequestSplit && (
            <span data-testid="sb-and-hint"> Need <strong>AND</strong> between terms?{' '}
              <button type="button" onClick={onRequestSplit}
                aria-label="Split terms into separate concepts to combine them with AND"
                title="Concept groups are joined with AND — move some terms into a new concept to require both ideas"
                style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 12, fontFamily: FONT, textDecoration: 'underline', padding: 0 }}>
                Split them into separate concepts
              </button>.
            </span>
          )}
        </p>
      )}
      {children}
    </section>
  );
}
