/**
 * SuggestionsDisclosure.jsx — 85.md A2, reworked by 97.md Phase 13 and 98.md §11.
 * The "Show suggestions (N)" area for the active concept group — HIDDEN by
 * default, revealed with one click (controlled `open`/`onToggleOpen` from the
 * parent; children mount only while open, §20):
 *
 *  - kind 'mesh' rows: ONE MeSH term per row (exact terminology — never "subject
 *    heading"), with a confidence marker where the match is low-confidence
 *    ("check this fits") — a low-confidence suggestion is NEVER auto-added;
 *  - kind 'synonyms' (entry-term) suggestions render as INDIVIDUAL rows with a
 *    per-term "Add this term" action; 98.md §11 round 2 adds CAREFULLY DESIGNED
 *    bulk selection — explicit checkboxes + one "Add N selected" action (nothing
 *    preselected; low-confidence MeSH excluded from select-all; dedup-aware; one
 *    undo entry). The 97.md-banned indiscriminate one-click bundle stays gone;
 *  - Dismiss persists (rejectedSuggestions) and "Show dismissed" restores;
 *  - the Hidden-terms restore panel lives INSIDE this disclosure.
 *
 * Presentational leaf: plain props + callbacks, no fetch.
 */
import { useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';

const KIND_LABEL = { mesh: 'MeSH', synonyms: 'Entry terms' };

function actionBtn(color) {
  return { background: 'none', border: `1px solid ${alpha(color, '55')}`, borderRadius: 6, color, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, fontFamily: FONT, padding: '3px 10px', minHeight: 24, flexShrink: 0 };
}

export default function SuggestionsDisclosure({
  suggestions, readOnly, onAccept, onAcceptMany, onDismiss, onAcceptEntryTerm,
  rejectedEntries, showDismissed, onToggleShowDismissed, onUnreject,
  ignoredGroups, onRestoreTerm, onRestoreField, onRestoreAll,
  // 98.md §11 — CONTROLLED visibility: suggestions are hidden by default and
  // revealed with one click; the open state lives with the parent (per concept,
  // session-scoped — §19 "suggestion visibility" in the canonical view state) so
  // a pending-count change can never force the panel open mid-work.
  open, onToggleOpen,
}) {
  const pending = Array.isArray(suggestions) ? suggestions : [];
  const rejected = Array.isArray(rejectedEntries) ? rejectedEntries : [];
  const hidden = Array.isArray(ignoredGroups) ? ignoredGroups : [];
  const hiddenCount = hidden.reduce((n, g) => n + ((g.items && g.items.length) || 0), 0);
  const empty = !pending.length && !rejected.length && !hiddenCount;
  const RO_TITLE = 'Read-only access — ask a project editor to review suggestions';
  const roBtn = (base) => (readOnly ? { ...base, cursor: 'not-allowed', opacity: 0.55 } : base);
  const isOpen = !!open;

  /* 98.md §11 (round 2) — checkbox multi-select. Keys: 'm:<suggKey>' for MeSH
     rows, 'e:<suggKey>:<synonym>' for entry-term rows. Nothing is preselected;
     select-all EXCLUDES low-confidence MeSH rows (they must be reviewed one by
     one — 97's never-auto-add rule); the batch lands through onAcceptMany as
     ONE dedup-aware, single-undo add. */
  const [selected, setSelected] = useState({});
  const toggleSel = (k) => setSelected((m) => ({ ...m, [k]: !m[k] }));
  const selectable = [];
  for (const sg of pending) {
    if (sg.kind === 'mesh' && sg.confidence !== 'review') selectable.push({ key: `m:${sg.key}`, item: { kind: 'mesh', sugg: sg } });
    if (sg.kind === 'synonyms' && Array.isArray(sg.synonyms)) {
      for (const syn of sg.synonyms) selectable.push({ key: `e:${sg.key}:${syn}`, item: { kind: 'entry', text: syn } });
    }
  }
  const chosen = selectable.filter((x) => selected[x.key]);
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;
  const addChosen = () => {
    if (readOnly || !onAcceptMany || !chosen.length) return;
    onAcceptMany(chosen.map((x) => x.item));
    setSelected({});
  };

  return (
    <div data-testid="sb-suggestions" style={{ fontFamily: FONT }}>
      {/* 98.md §11/§20 — one-click reveal with a compact count; children are
          MOUNTED only while open (never hundreds of hidden synonym rows). */}
      <button type="button" data-testid="sb-suggestions-toggle"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 0', marginTop: 8, fontFamily: FONT }}>
        <span aria-hidden="true" style={{ fontSize: 9 }}>{isOpen ? '▾' : '▸'}</span>
        {isOpen ? 'Hide suggestions' : 'Show suggestions'}{pending.length > 0 ? ` (${pending.length})` : ''}
      </button>
      {isOpen && (
      <div style={{ marginTop: 6 }}>
        {!readOnly && onAcceptMany && selectable.length > 1 && (
          <div data-testid="sb-sugg-bulk-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0 6px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: C.txt2, cursor: 'pointer' }}>
              <input type="checkbox" checked={allChosen}
                onChange={() => setSelected(allChosen ? {} : Object.fromEntries(selectable.map((x) => [x.key, true])))}
                aria-label="Select all suggestions (low-confidence MeSH terms excluded)" />
              Select all
              <span style={{ color: C.muted }}>(low-confidence MeSH excluded)</span>
            </label>
            <button type="button" data-testid="sb-sugg-add-selected" onClick={addChosen} disabled={!chosen.length}
              aria-label={`Add ${chosen.length} selected suggestion${chosen.length === 1 ? '' : 's'}`}
              style={{ ...actionBtn(C.grn), opacity: chosen.length ? 1 : 0.5, cursor: chosen.length ? 'pointer' : 'not-allowed' }}>
              Add {chosen.length || ''} selected
            </button>
          </div>
        )}
        {empty && (
          <div style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>
            No suggestions right now — they appear as you add terms.
          </div>
        )}

        {pending.map((s) => (
          <div key={s.key} data-testid="sb-suggestion-row" style={{ padding: '6px 0', borderTop: `1px solid ${C.brd}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {!readOnly && onAcceptMany && s.kind === 'mesh' && s.confidence !== 'review' && (
                <input type="checkbox" checked={!!selected[`m:${s.key}`]} onChange={() => toggleSel(`m:${s.key}`)}
                  aria-label={`Select suggestion ${s.text}`} style={{ flexShrink: 0 }} />
              )}
              <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.txt, fontFamily: s.kind === 'mesh' ? MONO : FONT }}>
                  {s.kind === 'synonyms' ? `Entry terms for “${s.text}”` : s.text}
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: C.acc, textTransform: 'uppercase', border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 4, padding: '0 4px' }}>
                    {KIND_LABEL[s.kind] || s.kind}
                  </span>
                  {/* 97.md — mark low-confidence suggestions clearly; never auto-add them. */}
                  {s.kind === 'mesh' && s.confidence === 'review' && (
                    <span data-testid="sb-sugg-low-confidence"
                      title="Low-confidence match — check this MeSH term fits your topic before adding it. It is never added automatically."
                      style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: C.yel, textTransform: 'uppercase', border: `1px solid ${alpha(C.yel, '66')}`, borderRadius: 4, padding: '0 4px' }}>
                      low confidence — review
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: C.muted }}>{s.why}</span>
              </span>
              {s.kind === 'mesh' && (
                <button type="button" onClick={() => { if (!readOnly && onAccept) onAccept(s); }} disabled={!!readOnly} aria-disabled={readOnly || undefined}
                  title={readOnly ? RO_TITLE : 'Adds only this MeSH term — entry terms and synonyms are never inserted with it'}
                  aria-label={`Accept suggestion ${s.text}`} style={roBtn(actionBtn(C.grn))}>Add this term</button>
              )}
              <button type="button" onClick={() => { if (!readOnly && onDismiss) onDismiss(s); }} disabled={!!readOnly} aria-disabled={readOnly || undefined}
                title={readOnly ? RO_TITLE : undefined} aria-label={`Dismiss suggestion ${s.text}`} style={roBtn(actionBtn(C.muted))}>Dismiss</button>
            </div>
            {/* 97.md Phase 13 — entry terms are INDIVIDUAL rows, each with its own
                explicit "Add this term"; there is no bulk insert of the whole list. */}
            {s.kind === 'synonyms' && Array.isArray(s.synonyms) && s.synonyms.length > 0 && (
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {s.synonyms.map((syn) => (
                  <div key={syn} data-testid="sb-entry-term-row" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 14 }}>
                    {!readOnly && onAcceptMany && (
                      <input type="checkbox" checked={!!selected[`e:${s.key}:${syn}`]} onChange={() => toggleSel(`e:${s.key}:${syn}`)}
                        aria-label={`Select entry term ${syn}`} style={{ flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: C.txt2, overflowWrap: 'anywhere' }}>{syn}</span>
                    <button type="button" onClick={() => { if (!readOnly && onAcceptEntryTerm) onAcceptEntryTerm(s, syn); }}
                      disabled={!!readOnly} aria-disabled={readOnly || undefined}
                      title={readOnly ? RO_TITLE : `Add “${syn}” as an individual free-text term`}
                      aria-label={`Add this term: ${syn}`} style={roBtn(actionBtn(C.acc))}>Add this term</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {rejected.length > 0 && (
          <div style={{ marginTop: 8, borderTop: `1px solid ${C.brd}`, paddingTop: 6 }}>
            <button type="button" onClick={onToggleShowDismissed} aria-expanded={!!showDismissed}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 10.5, fontFamily: MONO, textDecoration: 'underline', padding: 0 }}>
              {showDismissed ? 'Hide dismissed' : `Show dismissed (${rejected.length})`}
            </button>
            {showDismissed && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                {rejected.map((r) => (
                  <span key={r.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.surf, border: `1px dashed ${C.brd2}`, borderRadius: 6, padding: '2px 7px' }}>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.txt2 }}>{r.label}</span>
                    <button type="button" onClick={() => { if (!readOnly && onUnreject) onUnreject(r.key); }} disabled={!!readOnly} aria-disabled={readOnly || undefined}
                      aria-label={`Restore suggestion ${r.label}`}
                      title={readOnly ? RO_TITLE : 'Let this suggestion appear again'}
                      style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, minWidth: 20, minHeight: 20 }}>↩</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {hiddenCount > 0 && (
          <div data-testid="sb-hidden-terms" style={{ marginTop: 10, borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Hidden terms</span>
              <span style={{ fontSize: 10, color: C.muted }}>removed suggestions — won&apos;t return until restored</span>
              {onRestoreAll && (
                <button type="button" onClick={() => { if (!readOnly) onRestoreAll(); }} disabled={!!readOnly} aria-disabled={readOnly || undefined}
                  title={readOnly ? RO_TITLE : `Restore all ${hiddenCount} removed suggestion${hiddenCount === 1 ? '' : 's'} (also clears dismissed suggestions)`}
                  style={{ marginLeft: 'auto', ...roBtn(actionBtn(C.txt2)), borderColor: C.brd2 }}>
                  ↺ Restore all ({hiddenCount})
                </button>
              )}
            </div>
            {hidden.map((grp, gi) => (
              <div key={gi} style={{ marginBottom: gi < hidden.length - 1 ? 8 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{grp.field || grp.label || 'Other'}</span>
                  {onRestoreField && (
                    <button type="button" onClick={() => { if (!readOnly) onRestoreField(grp.field); }} disabled={!!readOnly} aria-disabled={readOnly || undefined}
                      title={readOnly ? RO_TITLE : `Restore all from ${grp.field || 'this field'}`}
                      style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 9.5, fontFamily: MONO, textDecoration: 'underline', padding: 0 }}>
                      restore all from {grp.field || 'field'} ({grp.items.length})
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {grp.items.map((e, ei) => (
                    <span key={ei} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.surf, border: `1px dashed ${C.brd2}`, borderRadius: 6, padding: '2px 7px' }}>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.txt2 }}>{e.text}</span>
                      <button type="button" onClick={() => { if (!readOnly && onRestoreTerm) onRestoreTerm(e); }} disabled={!!readOnly} aria-disabled={readOnly || undefined}
                        title={readOnly ? RO_TITLE : `Restore "${e.text}"`} aria-label={`Restore ${e.text}`}
                        style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, minWidth: 20, minHeight: 20 }}>↩</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
