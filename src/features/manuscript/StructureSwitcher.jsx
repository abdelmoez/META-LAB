/**
 * features/manuscript/StructureSwitcher.jsx — 119.md §7.
 *
 * The reporting-STRUCTURE switcher: the surface that turns "pick a template from a
 * dropdown and hope" into the seven things §7 actually asks for —
 *
 *   Preview a template before applying it        → the right-hand section list
 *   See what will be added / renamed / reordered → the diff strip, per section
 *   Switch templates without losing content      → mapping + preservation, below
 *   Map existing sections to the new structure   → one <select> per unmapped section
 *   Preserve unmapped content in a labeled area  → the default for every mapping
 *   Cancel safely                                → nothing is written until Apply
 *   Undo a template change                       → the snapshot Apply takes first
 *
 * Nothing here holds manuscript state or computes a diff of its own: every row on
 * screen comes from `m.previewStructure(...)`, which is the SAME pure planner
 * `m.applyStructure(...)` consumes. The dialog therefore cannot promise one thing
 * and the write do another.
 *
 * Styling: LEGACY tokens only (C/btnS/inp + var(--t-*)) — this renders in both
 * shells, exactly like the rest of the manuscript workspace (ARCH-118).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, btnS, inp } from '../../frontend/workspace/ui/styles.js';
import { alpha } from '../../frontend/theme/tokens.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { markOverlayEscape } from '../../frontend/focus/overlayEscapeLatch.js';
import {
  MANUSCRIPT_STRUCTURES, draftStructure, isCustomizedStructure, journalProfile,
} from '../../research-engine/manuscript/index.js';

/* 119.md §7 — the sentence the whole feature is judged by. Pinned as a constant so
   the dialog, the preserved-section banner and the tests all say the same thing. */
export const PRESERVE_PROMISE = 'Nothing is deleted. Text with no home in the new structure is kept in the manuscript, clearly labelled, and you can move it later.';

/** §7 — templates are aids, never a compliance claim. One wording, one place. */
export const NO_COMPLIANCE_NOTE = 'Reporting structures are writing aids based on the published guideline. They do not check or guarantee compliance — verify your manuscript against the guideline’s own checklist and your journal’s instructions.';

const STATE_COPY = {
  added: 'New',
  renamed: 'Renamed',
  moved: 'Moved',
  kept: '',
};

const STATE_TONE = {
  added: C.grn,
  renamed: C.acc,
  moved: C.yel,
  kept: C.muted,
};

/** A short "3 new · 1 renamed · 2 moved · 1 kept" line from the plan's counts. */
export function summarizeStructurePlan(plan) {
  if (!plan || !plan.ok) return '';
  const c = plan.counts || {};
  const bits = [];
  if (c.added) bits.push(`${c.added} new section${c.added === 1 ? '' : 's'}`);
  if (c.renamed) bits.push(`${c.renamed} renamed`);
  if (c.moved) bits.push(`${c.moved} reordered`);
  if (c.merged) bits.push(`${c.merged} merged into another section`);
  if (c.preserved) bits.push(`${c.preserved} kept as written`);
  if (c.droppedEmpty) bits.push(`${c.droppedEmpty} empty section${c.droppedEmpty === 1 ? '' : 's'} removed`);
  return bits.length ? bits.join(' · ') : 'No structural change.';
}

function Pill({ tone, children, testid }) {
  return (
    <span data-testid={testid} style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
      color: tone, background: alpha(tone, '14'), border: `1px solid ${alpha(tone, '33')}`,
      borderRadius: 999, padding: '1px 7px', flexShrink: 0, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/* ── the guideline provenance block (§7 "show source, last-reviewed, version") ── */
export function StructureProvenance({ structure, compact }) {
  if (!structure) return null;
  return (
    <div data-testid="stitch-manuscript-structure-provenance"
      style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.65 }}>
      <div><strong style={{ color: C.txt2, fontWeight: 700 }}>Guideline:</strong> {structure.guideline}</div>
      <div><strong style={{ color: C.txt2, fontWeight: 700 }}>Version:</strong> {structure.guidelineVersion}</div>
      <div><strong style={{ color: C.txt2, fontWeight: 700 }}>Reviewed:</strong> {structure.reviewedAt} · template v{structure.version}</div>
      {!compact && structure.checklistItems ? (
        <div><strong style={{ color: C.txt2, fontWeight: 700 }}>Checklist:</strong> {structure.checklistItems} items</div>
      ) : null}
      {!compact && structure.source ? (
        <div style={{ wordBreak: 'break-all' }}>
          <strong style={{ color: C.txt2, fontWeight: 700 }}>Source:</strong> {structure.source}
        </div>
      ) : null}
    </div>
  );
}

/* ── the journal profile panel (§7 — a SEPARATE dimension, never the structure) ── */
export function JournalProfileNotes({ templateId }) {
  const profile = useMemo(() => journalProfile(templateId), [templateId]);
  const meta = profile.meta;
  if (!meta) return null;
  return (
    <div data-testid="stitch-manuscript-journal-provenance"
      style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.65 }}>
      {meta.publisher && <div><strong style={{ color: C.txt2, fontWeight: 700 }}>Publisher:</strong> {meta.publisher}</div>}
      <div><strong style={{ color: C.txt2, fontWeight: 700 }}>Source:</strong> {meta.sourceLabel} — {meta.source}</div>
      <div><strong style={{ color: C.txt2, fontWeight: 700 }}>Last reviewed:</strong> {meta.lastReviewedAt} · profile v{meta.version}</div>
      {Array.isArray(meta.facts) && meta.facts.length > 0 && (
        <ul data-testid="stitch-manuscript-journal-verified" style={{ margin: '6px 0 0', paddingLeft: 16 }}>
          {meta.facts.map((f) => <li key={f} style={{ color: C.txt2 }}>{f}</li>)}
        </ul>
      )}
      {Array.isArray(meta.needsUserVerification) && meta.needsUserVerification.length > 0 && (
        <div data-testid="stitch-manuscript-journal-unverified" style={{ marginTop: 6, color: C.yel }}>
          Requires your verification: {meta.needsUserVerification.join(', ')}.
        </div>
      )}
      {meta.reviewNote && (
        <div data-testid="stitch-manuscript-journal-note" style={{ marginTop: 4 }}>{meta.reviewNote}</div>
      )}
    </div>
  );
}

/**
 * The switcher dialog.
 * @param {object}   m         the ONE manuscript handle.
 * @param {function} onClose   () => void — Cancel / Escape / backdrop. NEVER writes.
 */
export function StructureSwitcher({ m, onClose }) {
  const draft = m.activeDraft || {};
  const current = useMemo(() => draftStructure(draft), [draft]);
  const [selected, setSelected] = useState(current.id || 'imrad');
  const [mapping, setMapping] = useState({});
  const cardRef = useRef(null);

  // Changing the TARGET invalidates every mapping choice (the target ids moved).
  const pickStructure = useCallback((id) => {
    setSelected(id);
    setMapping({});
  }, []);

  const plan = useMemo(
    () => (m.previewStructure ? m.previewStructure(selected, mapping) : null),
    [m, selected, mapping],
  );

  const target = useMemo(
    () => MANUSCRIPT_STRUCTURES.find((s) => s.id === selected) || null,
    [selected],
  );

  /* §7 "Cancel safely" — Escape closes and writes nothing. The overlay latch stops
     the same Escape from also dropping Focus Mode (117.md §44). */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      markOverlayEscape();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const el = cardRef.current;
    if (el && typeof el.focus === 'function') el.focus();
  }, []);

  const isCurrent = selected === (current.id || 'imrad');
  const customized = isCustomizedStructure(draft);

  const apply = () => {
    if (!m.applyStructure) return;
    m.applyStructure(selected, mapping);
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Manuscript structure"
      data-testid="stitch-manuscript-structure-dialog"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15,23,42,0.35)', padding: 16,
      }}>
      <div ref={cardRef} tabIndex={-1}
        style={{
          background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12,
          width: '100%', maxWidth: 980, maxHeight: '88vh', outline: 'none',
          display: 'flex', flexDirection: 'column',
        }}>
        {/* ── header ── */}
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${C.brd}` }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 700, color: C.txt }}>
            Manuscript structure
          </h3>
          <p style={{ margin: 0, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
            Which sections this manuscript has, and in what order. This is separate from the
            journal profile and from the citation style — changing a citation style never
            changes your structure.
          </p>
        </div>

        <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
          {/* ── left: the library ── */}
          <div data-testid="stitch-manuscript-structure-library"
            role="radiogroup" aria-label="Reporting structure"
            style={{
              width: 292, flexShrink: 0, borderRight: `1px solid ${C.brd}`,
              overflowY: 'auto', padding: 10,
            }}>
            {MANUSCRIPT_STRUCTURES.map((s) => {
              const active = s.id === selected;
              const isNow = s.id === (current.id || 'imrad');
              return (
                <button key={s.id} type="button" role="radio" aria-checked={active ? 'true' : 'false'}
                  onClick={() => pickStructure(s.id)}
                  data-testid={`stitch-manuscript-structure-option-${s.id}`}
                  data-active={active ? 'true' : undefined}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    padding: '8px 10px', marginBottom: 4, borderRadius: 8,
                    border: `1px solid ${active ? alpha(C.acc, '55') : 'transparent'}`,
                    background: active ? alpha(C.acc, '12') : 'transparent',
                    fontFamily: 'inherit',
                  }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12.5, fontWeight: active ? 700 : 600, color: C.txt,
                  }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
                    {isNow && <Pill tone={C.grn} testid={`stitch-manuscript-structure-current-${s.id}`}>Current</Pill>}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    {s.guideline} · {s.guidelineVersion}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── right: preview + diff + mapping ── */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 18px 18px' }}>
            {target && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 4 }}>{target.label}</div>
                  <p style={{ margin: '0 0 8px', fontSize: 11.5, color: C.txt2, lineHeight: 1.6 }}>{target.note}</p>
                  <StructureProvenance structure={target} />
                </div>

                {/* diff summary */}
                <div data-testid="stitch-manuscript-structure-summary"
                  style={{
                    fontSize: 11.5, color: C.txt2, background: C.card2, border: `1px solid ${C.brd}`,
                    borderRadius: 8, padding: '7px 10px', marginBottom: 12, lineHeight: 1.55,
                  }}>
                  {isCurrent
                    ? (customized
                      ? 'This is the structure you are on, with your own customizations. Re-applying it restores the template’s original section set (your text is still preserved).'
                      : 'This is the structure you are already using.')
                    : summarizeStructurePlan(plan)}
                </div>

                {/* §7 — "Preserve unmapped content in a clearly labeled area" + mapping */}
                {plan && plan.unmapped.length > 0 && (
                  <div data-testid="stitch-manuscript-structure-unmapped"
                    style={{
                      border: `1px solid ${alpha(C.yel, '55')}`, background: alpha(C.yel, '10'),
                      borderRadius: 8, padding: '10px 12px', marginBottom: 12,
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 2 }}>
                      {plan.unmapped.length} section{plan.unmapped.length === 1 ? '' : 's'} with text
                      {' '}{plan.unmapped.length === 1 ? 'has' : 'have'} no match in {target.label}
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: C.txt2, lineHeight: 1.55 }}>
                      {PRESERVE_PROMISE}
                    </p>
                    {plan.unmapped.map((u) => (
                      <div key={u.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                        padding: '5px 0', borderTop: `1px solid ${C.brd}`,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.txt, flex: '1 1 130px', minWidth: 0 }}>
                          {u.label}
                          <span style={{ fontWeight: 500, color: C.muted }}> · {u.words} word{u.words === 1 ? '' : 's'}</span>
                        </span>
                        <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700 }} htmlFor={`ms-struct-map-${u.id}`}>
                          Move text to
                        </label>
                        <select id={`ms-struct-map-${u.id}`}
                          aria-label={`Move ${u.label} text to`}
                          data-testid={`stitch-manuscript-structure-map-${u.id}`}
                          value={u.mappedTo}
                          onChange={(e) => setMapping((prev) => ({ ...prev, [u.id]: e.target.value }))}
                          style={{ ...inp, width: 'auto', fontSize: 11.5, cursor: 'pointer' }}>
                          <option value="">Keep as its own section (preserved)</option>
                          {plan.targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {/* the resulting document, section by section */}
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6 }}>
                  Resulting structure
                </div>
                <ol data-testid="stitch-manuscript-structure-preview"
                  style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {(plan && plan.ok ? plan.sections : []).map((s) => (
                    <li key={s.id} data-testid={`stitch-manuscript-structure-row-${s.id}`}
                      data-state={s.state}
                      style={{ padding: '7px 0', borderTop: `1px solid ${C.brd}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, flex: 1, minWidth: 0 }}>
                          {s.label}
                          {s.state === 'renamed' && s.fromLabel ? (
                            <span style={{ fontWeight: 500, color: C.muted }}> (was “{s.fromLabel}”)</span>
                          ) : null}
                        </span>
                        {s.words > 0 && (
                          <span style={{ fontSize: 10.5, color: C.muted, flexShrink: 0 }}>{s.words} words kept</span>
                        )}
                        {STATE_COPY[s.state] ? (
                          <Pill tone={STATE_TONE[s.state]}>{STATE_COPY[s.state]}</Pill>
                        ) : null}
                      </div>
                      {s.guidance && (
                        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.55, marginTop: 2 }}>{s.guidance}</div>
                      )}
                    </li>
                  ))}
                  {(plan && plan.ok ? plan.unmapped : []).filter((u) => !u.mappedTo).map((u) => (
                    <li key={u.id} data-testid={`stitch-manuscript-structure-row-${u.id}`}
                      data-state="preserved"
                      style={{ padding: '7px 0', borderTop: `1px solid ${C.brd}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, flex: 1, minWidth: 0 }}>{u.label}</span>
                        <span style={{ fontSize: 10.5, color: C.muted, flexShrink: 0 }}>{u.words} words kept</span>
                        <Pill tone={C.yel} testid={`stitch-manuscript-structure-preserved-${u.id}`}>Preserved</Pill>
                      </div>
                      <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.55, marginTop: 2 }}>
                        Not part of this template. Kept at the end of the manuscript, labelled, and included in the export.
                      </div>
                    </li>
                  ))}
                </ol>

                {plan && plan.droppedEmpty.length > 0 && (
                  <div data-testid="stitch-manuscript-structure-dropped"
                    style={{ marginTop: 10, fontSize: 11, color: C.muted, lineHeight: 1.55 }}>
                    Removed because {plan.droppedEmpty.length === 1 ? 'it is' : 'they are'} empty:
                    {' '}{plan.droppedEmpty.map((d) => d.label).join(', ')}.
                  </div>
                )}

                <div style={{ marginTop: 12, fontSize: 10.5, color: C.muted, lineHeight: 1.55 }}>
                  {NO_COMPLIANCE_NOTE}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── footer ── */}
        <div style={{
          padding: '11px 18px', borderTop: `1px solid ${C.brd}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: C.muted }}>
            Currently: <strong style={{ color: C.txt2 }}>{current.label}</strong>
            {customized ? ' (customized)' : ''}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose}
              data-testid="stitch-manuscript-structure-cancel"
              style={{ ...btnS('ghost'), fontSize: 11.5 }}>Cancel</button>
            <button type="button" onClick={apply}
              data-testid="stitch-manuscript-structure-apply"
              style={{ ...btnS('primary'), fontSize: 11.5 }}>
              {isCurrent ? 'Re-apply structure' : `Use ${target ? target.label : 'this structure'}`}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 119.md §7 "Undo a template change" — the affordance that makes the change
 * reversible IN CONTEXT rather than only through the snapshot list. It appears
 * after a switch and stays until it is used or dismissed; the snapshot behind it
 * survives either way, so a researcher who dismissed it can still restore from the
 * Export destination's snapshot list.
 */
export function StructureChangeUndo({ m }) {
  const change = m.lastStructureChange;
  if (!change || !change.applied) return null;
  const preserved = (change.preserved || []).length;
  const merged = (change.merged || []).length;
  return (
    <div data-testid="stitch-manuscript-structure-undo-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: alpha(C.grn, '10'), border: `1px solid ${alpha(C.grn, '40')}`,
        borderRadius: 8, padding: '7px 11px', margin: '0 0 10px',
        fontSize: 11.5, color: C.txt2, lineHeight: 1.55,
      }}>
      <Icon name="check" size={12} />
      <span style={{ flex: 1, minWidth: 0 }}>
        Structure changed to <strong style={{ color: C.txt }}>{change.label}</strong>.
        {merged ? ` ${merged} section${merged === 1 ? '' : 's'} merged into another.` : ''}
        {preserved ? ` ${preserved} section${preserved === 1 ? '' : 's'} kept as written — nothing was deleted.` : ''}
      </span>
      <button type="button" onClick={() => m.undoStructureChange && m.undoStructureChange()}
        data-testid="stitch-manuscript-structure-undo"
        style={{ ...btnS('ghost'), fontSize: 11 }}>Undo structure change</button>
      <button type="button" onClick={() => m.dismissStructureChange && m.dismissStructureChange()}
        data-testid="stitch-manuscript-structure-undo-dismiss"
        aria-label="Dismiss"
        style={{ ...btnS('ghost'), fontSize: 11, padding: '0 8px' }}>Dismiss</button>
    </div>
  );
}

export default StructureSwitcher;
