/**
 * ActiveConceptPanel.jsx — 85.md A2, Terms & Vocabulary master-detail. The DETAIL
 * panel for the active concept: header (inline name, role badge, MeSH-coverage
 * badge, readiness status) + a plain-language guidance line. The parent composes
 * the working surfaces (add box, chip row, suggestions/advanced disclosures) as
 * children so each stays an independently-testable leaf.
 *
 * 96.md QA additions:
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
 * Presentational: plain props + callbacks, no fetch.
 */
import { useState } from 'react';
import { C, FONT, alpha } from '../../../frontend/theme/tokens.js';
import { CONCEPT_STATUS_LABELS } from '../../../research-engine/searchBuilder/searchState.js';
import { liveTermsOf } from '../../../research-engine/searchBuilder/termLiveness.js';
import { conceptAccent, CONCEPT_STATUS_GLYPH } from './uiShared.js';

export default function ActiveConceptPanel({ concept, conceptIndex, status, readOnly, onRename, onUpdateSourcePhrase, onRequestSplit, children }) {
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

  return (
    <section data-testid="sb-active-concept" aria-label={`Concept: ${c.label || ''}`}
      style={{ background: C.card, border: `1px solid ${C.brd}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: 14, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <input value={c.label || ''} onChange={(e) => { if (!readOnly && onRename) onRename(e.target.value); }}
          aria-label={`Concept name: ${c.label || ''}`}
          readOnly={!!readOnly} aria-disabled={readOnly || undefined}
          title={readOnly ? 'Read-only access — ask a project editor to rename this group' : undefined}
          style={{ fontWeight: 700, flex: '1 1 160px', minWidth: 140, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 14, color: C.txt, fontFamily: FONT, cursor: readOnly ? 'not-allowed' : 'text' }} />
        {/* 96.md — legacy groups from the retired PICO sync render safely with a
            NEUTRAL badge; new question-derived groups carry no badge at all. */}
        {c.picoField && (
          <span title="Created by the retired PICO sync — safe to edit, merge or delete"
            style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.muted, textTransform: 'uppercase', background: C.card2, border: `1px solid ${C.brd2}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>
            Legacy group
          </span>
        )}
        {c.picoField !== 'T' && live.length > 0 && (
          <span data-testid="sb-mesh-coverage"
            title={meshN > 0 ? 'This concept includes a matched subject heading (MeSH)' : 'No subject heading yet — accepting one from the suggestions usually improves recall'}
            style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', borderRadius: 4, padding: '0 5px', color: meshN > 0 ? C.grn : C.muted, border: `1px solid ${alpha(meshN > 0 ? C.grn : C.muted, '55')}`, flexShrink: 0 }}>
            {meshN > 0 ? 'has heading' : 'no heading yet'}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: stCol, textTransform: 'uppercase', background: alpha(stCol, '14'), border: `1px solid ${alpha(stCol, '44')}`, borderRadius: 5, padding: '1px 7px', flexShrink: 0 }}>
          <span aria-hidden="true">{CONCEPT_STATUS_GLYPH[st] || '○'}</span>{CONCEPT_STATUS_LABELS[st] || st}
        </span>
      </div>
      {/* 96.md QA M4 — the originating question phrase, editable in place. */}
      {(c.sourcePhrase || phraseEditing) && (
        <div data-testid="sb-source-phrase" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', margin: '0 0 8px', fontSize: 11, color: C.muted }}>
          {!phraseEditing && (
            <>
              <span>From the question phrase “<span style={{ color: C.txt2, fontWeight: 600 }}>{c.sourcePhrase}</span>”</span>
              {!readOnly && onUpdateSourcePhrase && (
                <button type="button" onClick={startPhraseEdit}
                  aria-label={`Update the phrase for ${c.label || 'this group'}`}
                  title="Change which question phrase this group traces back to (drift detection follows it)"
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
                aria-label={`New phrase for ${c.label || 'this group'}`} placeholder="phrase from the question…" autoFocus
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
      <p style={{ margin: '0 0 12px', fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        Add different words researchers may use for {c.label || 'this idea'}. Terms in this group are combined with <strong>OR</strong> — any one of them counts as a match.
        {/* 96.md QA M6 — within-group OR is fixed by design (documented limitation);
            the supported path to AND between terms is separate groups. */}
        {onRequestSplit && (
          <span data-testid="sb-and-hint"> Need <strong>AND</strong> between terms?{' '}
            <button type="button" onClick={onRequestSplit}
              aria-label="Split terms into separate groups to combine them with AND"
              title="Concept groups are joined with AND — move some terms into a new group to require both ideas"
              style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 12, fontFamily: FONT, textDecoration: 'underline', padding: 0 }}>
              Split them into separate groups
            </button>.
          </span>
        )}
      </p>
      {children}
    </section>
  );
}
