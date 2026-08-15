/**
 * TermChipRow.jsx — 85.md A2, reworked by 97.md (Phases 8/11/12/13). The term
 * chips for the ACTIVE search group.
 *
 * 97.md additions:
 *  - visible OR separators between chips (the group's Boolean meaning is explicit
 *    — Phase 8's "terms within a box are alternatives connected by OR");
 *  - duplicate states via `dupSignalFor(term)` (dupSignals.buildDupModel):
 *      · exact cross-group → strong DARK-RED chip + warning icon + visible
 *        "Duplicate" badge + tooltip + screen-reader label (never colour alone);
 *      · exact in-group (legacy data) → the same strong treatment;
 *      · family variant → a soft, non-blocking "Possible variant" hint;
 *      · a valid intentional override → calm "kept intentionally" badge;
 *  - hand-rolled pointer drag (dragHandleFor / dragState / registerChipEl):
 *    reorder shows an INSERTION LINE (sb-insert-line); dragging onto a chip's
 *    centre shows a DISTINCT merge-target ring (sb-merge-target) that arms after
 *    a hover threshold — the two affordances never share feedback (Phase 6);
 *  - controlled chips render the exact `"Descriptor"[MeSH]` form (Phase 13) and
 *    open a MeshDetailsPopover on hover or on focusing the info affordance —
 *    informational, with per-entry-term "Add this term" actions only.
 *
 * The WHOLE chip is a button that opens the editor popover; a separate × button
 * removes with the pinned aria-label `Remove ${term.text}`. Keyboard/menu
 * alternatives for every drag action live in the editor popover (Phase 21).
 */
import { useEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { termDisplay, termMicroBadges } from './uiShared.js';
import MeshDetailsPopover from './MeshDetailsPopover.jsx';
// 117.md §44 (r2 fix) — an overlay that CONSUMES Escape must claim the browser
// fullscreen exit the same press causes; otherwise §44 reads it as "the researcher left
// full screen" and drops the whole Focus Mode layout. Dependency-free module.
import { markOverlayEscape } from '../../../frontend/focus/overlayEscapeLatch.js';

/* Dark-red duplicate palette — deliberately fixed (not theme-tinted) so the
   "strong dark red" 97.md requires stays high-contrast in day AND night themes.
   Meaning never rides on the colour alone: icon + badge text + tooltip + SR label. */
export const DUP_RED_BORDER = '#b91c1c';
export const DUP_RED_BG = 'rgba(185, 28, 28, 0.14)';
export const DUP_RED_BADGE_BG = '#7f1d1d';

export const EXACT_DUP_TOOLTIP = (text) => (
  `Exact duplicate across AND concepts — “${text}” appears in more than one concept group. `
  + 'Because these groups are connected with AND, this may make the search unnecessarily restrictive.'
);

export default function TermChipRow({
  concept, beginner, readOnly, dupSignalFor, editingTermId, onOpenEditor, onRemove, renderEditor,
  // 97.md — drag seams (all optional; SSR renders the idle state):
  dragState, dragHandleFor, registerChipEl,
  // Imperative focus request ("Find other duplicate" / "Find existing term").
  focusTermId, onFocusedTerm,
  // MeSH details popover seams:
  onAddEntryTerm,
  syntaxDbs, // 98.md §10 — selected databases for the popover's "Syntax by database" row
}) {
  const RO_TITLE = 'Read-only access — ask a project editor to change terms';
  const allTerms = (concept && Array.isArray(concept.terms)) ? concept.terms : [];
  // Rendered chips keep their REAL index in concept.terms (drag geometry + insertion).
  const terms = allTerms
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => t && String(t.text || '').trim());
  const chipRefs = useRef({});
  const prevEditing = useRef(editingTermId);
  const [meshOpenId, setMeshOpenId] = useState(null); // hover/focus-opened MeSH popover

  // Focus-return: when the editor for term X closes, put focus back on X's chip.
  useEffect(() => {
    const prev = prevEditing.current;
    prevEditing.current = editingTermId;
    if (prev && !editingTermId) {
      const el = chipRefs.current[prev];
      if (el && typeof el.focus === 'function') { try { el.focus(); } catch { /* best-effort */ } }
    }
  }, [editingTermId]);

  // "Find other duplicate" / "Find existing term": focus the requested chip.
  useEffect(() => {
    if (!focusTermId) return;
    const el = chipRefs.current[focusTermId];
    if (el && typeof el.focus === 'function') {
      try { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* best-effort */ }
    }
    if (onFocusedTerm) onFocusedTerm(focusTermId);
  }, [focusTermId]); // eslint-disable-line

  if (!terms.length) return null;

  const drag = dragState || null;
  const target = drag && drag.target;
  const insertHere = (index) => !!(target && target.kind === 'insert'
    && concept && target.groupId === concept.id && target.index === index);
  const insertionLine = (
    <span data-testid="sb-insert-line" aria-hidden="true"
      style={{ display: 'inline-block', width: 3, alignSelf: 'stretch', minHeight: 28, borderRadius: 2, background: C.acc, boxShadow: `0 0 0 1px ${alpha(C.acc, '66')}` }} />
  );

  return (
    <div data-testid="sb-term-chips" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontFamily: FONT }}>
      {terms.map(({ t, index }, i) => {
        const d = termDisplay(t);
        const badges = termMicroBadges(t);
        const off = t.disabled === true;
        const dup = dupSignalFor ? dupSignalFor(t) : null;
        const exactDup = dup && (dup.kind === 'exact-cross' || dup.kind === 'exact-in-group') && !dup.intentional && !dup.dismissed;
        const variant = dup && dup.kind === 'variant';
        const intentional = dup && dup.intentional;
        const isControlled = d.kind === 'controlled' && !d.unmatched;
        const isMergeTarget = !!(target && target.kind === 'merge' && target.targetId === t.id);
        const isDragged = !!(drag && drag.dragId === t.id);
        const otherLabels = dup && dup.others ? [...new Set(dup.others.filter((o) => o.conceptId !== (concept && concept.id)).map((o) => o.conceptLabel))] : [];
        const border = exactDup
          ? `2px solid ${DUP_RED_BORDER}`
          : d.unmatched
            ? `1px solid ${alpha(C.yel, '77')}`
            : isControlled ? `1px solid ${alpha(C.acc, '66')}` : `1px dashed ${C.brd2}`;
        const bg = exactDup ? DUP_RED_BG : d.unmatched ? alpha(C.yel, '10') : isControlled ? alpha(C.acc, '0c') : 'transparent';
        const handle = (!readOnly && dragHandleFor) ? dragHandleFor(t.id) : null;
        return (
          <span key={t.id || t.text} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && !insertHere(index) && (
              <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: C.muted }}>OR</span>
            )}
            {insertHere(index) && insertionLine}
            <span
              style={{ position: 'relative', display: 'inline-block' }}
              onMouseEnter={isControlled ? () => setMeshOpenId(t.id) : undefined}
              onMouseLeave={isControlled ? () => setMeshOpenId((id) => (id === t.id ? null : id)) : undefined}>
              <span
                {...(isMergeTarget ? { 'data-testid': 'sb-merge-target', 'data-armed': drag.armed ? 'true' : 'false' } : {})}
                style={{
                  display: 'inline-flex', alignItems: 'stretch', borderRadius: 8, overflow: 'visible', border, background: bg,
                  opacity: isDragged ? 0.4 : off ? 0.55 : 1,
                  ...(isMergeTarget ? {
                    outline: `3px ${drag.armed ? 'solid' : 'dashed'} ${C.acc}`, outlineOffset: 2,
                  } : {}),
                }}>
                <button
                  type="button"
                  className="sb-chip"
                  ref={(el) => { chipRefs.current[t.id] = el; if (registerChipEl) registerChipEl(t.id, el); }}
                  onClick={() => { if (!readOnly && onOpenEditor) onOpenEditor(t.id); }}
                  disabled={!!readOnly}
                  aria-disabled={readOnly || undefined}
                  aria-label={`Edit ${t.text}`}
                  aria-expanded={editingTermId === t.id}
                  title={readOnly ? RO_TITLE : (d.secondary ? `You typed: ${d.secondary}` : undefined)}
                  {...(handle || {})}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: readOnly ? 'not-allowed' : 'pointer',
                    background: 'none', border: 'none', padding: '5px 4px 5px 10px', minHeight: 28,
                    fontFamily: FONT, fontSize: 12, color: C.txt, textAlign: 'left',
                    ...((handle && handle.style) || {}),
                  }}>
                  {/* 97.md Phase 13 — the exact visible `"Descriptor"[MeSH]` form. */}
                  {isControlled ? (
                    <span style={{ textDecoration: off ? 'line-through' : 'none' }}>
                      <span>&quot;{d.main}&quot;</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.acc, marginLeft: 1 }}>[MeSH]</span>
                    </span>
                  ) : (
                    <span style={{ textDecoration: off ? 'line-through' : 'none' }}>{d.main}</span>
                  )}
                  {d.unmatched && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: C.yel }}
                      title="No MeSH term with this name was found — it would match nothing. Open the chip to convert it to free text.">
                      ⚠ no MeSH match — will not match
                    </span>
                  )}
                  {badges.map((b) => (
                    <span key={b.key} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3, color: b.key === 'off' ? C.muted : C.txt2, textTransform: 'uppercase', background: C.card2, border: `1px solid ${C.brd2}`, borderRadius: 4, padding: '0 4px' }}>
                      {b.label}
                    </span>
                  ))}
                  {exactDup && (
                    <span
                      data-testid="sb-dup-badge"
                      role="img"
                      aria-label={dup.kind === 'exact-in-group'
                        ? `Exact duplicate inside this concept — “${t.text}” appears more than once`
                        : `Exact duplicate across AND concepts — “${t.text}” also appears in ${otherLabels.join(' and ') || 'another concept group'}`}
                      title={dup.kind === 'exact-in-group'
                        ? `“${t.text}” appears more than once in this concept. Duplicate copies do not broaden the search — open the chip to resolve it.`
                        : EXACT_DUP_TOOLTIP(t.text)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3, color: '#fff', textTransform: 'uppercase', background: DUP_RED_BADGE_BG, border: `1px solid ${DUP_RED_BORDER}`, borderRadius: 4, padding: '0 5px' }}>
                      <span aria-hidden="true">⚠</span>Duplicate
                    </span>
                  )}
                  {intentional && (
                    <span data-testid="sb-dup-intentional" title="You marked this duplicate as intentional. Open the chip to review it."
                      style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3, color: C.muted, textTransform: 'uppercase', background: C.card2, border: `1px solid ${C.brd2}`, borderRadius: 4, padding: '0 4px' }}>
                      kept intentionally
                    </span>
                  )}
                  {variant && (
                    <span data-testid="sb-dup-variant" role="img"
                      aria-label={`Possible variant — a similar term also appears in ${otherLabels.join(' and ') || 'another concept group'}`}
                      title={`Possible variant of a term in ${otherLabels.join(' and ') || 'another concept group'}. Similar terms can be valid synonyms — nothing is flagged as an exact duplicate.`}
                      style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: 0.3, color: C.txt2, textTransform: 'uppercase', background: 'transparent', border: `1px dashed ${C.brd2}`, borderRadius: 4, padding: '0 4px' }}>
                      Possible variant
                    </span>
                  )}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    className="sb-chip"
                    onClick={() => onRemove && onRemove(t.id)}
                    aria-label={`Remove ${t.text}`}
                    title={`Remove "${t.text}"`}
                    style={{ background: 'none', border: 'none', borderLeft: `1px solid ${exactDup ? DUP_RED_BORDER : C.brd}`, color: C.muted, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 8px', minWidth: 26, minHeight: 28 }}>
                    ×
                  </button>
                )}
              </span>
              {isMergeTarget && (
                <span aria-hidden="true" style={{ position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 60, whiteSpace: 'nowrap', fontSize: 9.5, fontWeight: 700, color: C.accText, background: C.acc, borderRadius: 5, padding: '2px 8px' }}>
                  {drag.armed ? 'Release to combine into one phrase' : 'Hold to combine…'}
                </span>
              )}
              {editingTermId === t.id && renderEditor && renderEditor(t)}
              {isControlled && meshOpenId === t.id && editingTermId !== t.id && !isDragged && (
                <MeshDetailsPopover
                  term={t}
                  readOnly={readOnly}
                  addedTexts={allTerms.map((x) => x && x.text).filter(Boolean)}
                  onAddEntryTerm={onAddEntryTerm ? (text) => onAddEntryTerm(t.id, text) : null}
                  onClose={() => setMeshOpenId(null)}
                  syntaxDbs={syntaxDbs}
                />
              )}
              {/* Keyboard access to the hover popover: a small focusable info affordance.
                  97 QA M23 — onClick is OPEN-ONLY: the click sequence is
                  mouseenter(open) → focus(open) → click, so a toggling click
                  CLOSED the popover it had just opened. Escape (here and inside
                  the popover) and the popover's × close it. onBlur closes only
                  when focus leaves the whole chip wrapper — Tab INTO the popover
                  (its per-entry-term "Add this term" / Close buttons) keeps it
                  open, so keyboard users can actually reach those actions. */}
              {isControlled && (
                <button type="button" className="sb-chip"
                  aria-label={`MeSH details for ${d.main}`}
                  aria-expanded={meshOpenId === t.id}
                  onFocus={() => setMeshOpenId(t.id)}
                  onClick={() => setMeshOpenId(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Escape' && meshOpenId === t.id) { markOverlayEscape(); e.stopPropagation(); setMeshOpenId(null); } /* 99.md — layered dismissal: consume Escape only when it actually closed the popover; 117.md §44 (r2 fix) — mark before consuming */ }}
                  onBlur={(e) => {
                    const wrap = e.currentTarget && e.currentTarget.parentNode;
                    const to = e.relatedTarget;
                    if (to && wrap && typeof wrap.contains === 'function' && wrap.contains(to)) return; // focus moved into the popover
                    setMeshOpenId((id) => (id === t.id ? null : id));
                  }}
                  style={{ position: 'absolute', top: -10, right: -10, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'transparent', color: C.acc, fontSize: 9, fontWeight: 700, lineHeight: 1, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${alpha(C.acc, '66')}`, background: C.card, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>i</span>
                </button>
              )}
            </span>
          </span>
        );
      })}
      {/* Insertion line after the LAST chip (drop at the end of the group). */}
      {target && target.kind === 'insert' && concept && target.groupId === concept.id
        && target.index >= (terms.length ? terms[terms.length - 1].index + 1 : 0) && insertionLine}
    </div>
  );
}
