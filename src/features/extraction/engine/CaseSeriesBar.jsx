/**
 * features/extraction/engine/CaseSeriesBar.jsx — 106.md (Case Series Extraction Mode).
 *
 * The one bar that owns Case Series Mode, shown above the extraction workspace in the
 * same slot as the 82.md OutcomeNavigator (only one of the two renders — a case series
 * navigates by PATIENT, an ordinary article by OUTCOME, and showing both at once was
 * the confusing part).
 *
 *   OFF → a single, plainly-worded checkbox:
 *         "☐ This article contains multiple cases / case series"
 *   ON  → the compact case navigator 106.md asks for:
 *         `Case 1 | Case 2 | Case 3 | + Add case`, each chip carrying its own
 *         extraction completion ("Case 2 — 80%"), plus rename / duplicate / delete
 *         for the case being edited.
 *
 * Presentational only: every mutation goes through the pure caseSeries engine in the
 * parent. Switching cases only changes which study row is open — the PDF is resolved
 * from the PUBLICATION (outcomeGroups.publicationSourceFor, and a shared
 * `caseSeries.publicationId` is now the strongest citation identity there), so the
 * viewer is never unmounted or re-fetched between cases.
 *
 * Status is never communicated by colour alone: every chip carries a text percentage
 * or a ✓, and the active chip is marked with aria-selected.
 */
import { useState } from 'react';
import { C, btnS, inp } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { caseGroupForStudy, caseSummary, caseInfoOf } from '../../../research-engine/extraction/caseSeries.js';

export default function CaseSeriesBar({
  studies = [], openId, caseVariables = [], canEdit = true,
  onEnable, onDisable, onOpen, onAdd, onDuplicate, onRemove, onRename,
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const open = studies.find((s) => s && s.id === openId) || null;
  if (!open) return null;

  const group = caseGroupForStudy(studies, openId);

  /* ── OFF: the plain-language toggle (106.md §Core requirement) ── */
  if (!group) {
    if (!canEdit) return null;
    return (
      <div data-testid="pex-case-toggle" style={barStyle}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: C.txt }}>
          <input type="checkbox" checked={false} onChange={() => onEnable && onEnable(openId)}
            aria-label="This article contains multiple cases / case series" style={{ cursor: 'pointer' }} />
          <span>This article contains multiple cases / case series</span>
        </label>
        <span style={{ fontSize: 11, color: C.muted }}>
          Extract each patient separately, sharing this article’s authors, year and PDF.
        </span>
      </div>
    );
  }

  /* ── ON: the case navigator ── */
  const cases = group.cases
    .map((st) => caseSummary(st, caseVariables))
    .filter((c) => !c.archived);
  const active = cases.find((c) => c.id === openId) || null;
  const activeInfo = caseInfoOf(open);

  const startRename = () => { setDraft(activeInfo && activeInfo.label ? activeInfo.label : ''); setRenaming(true); };
  const commitRename = () => { if (onRename) onRename(openId, draft.trim()); setRenaming(false); };
  const confirmRemove = () => {
    if (cases.length <= 1) return;
    const label = active ? active.name : 'this case';
    // eslint-disable-next-line no-alert
    if (window.confirm(`Delete ${label}? Its extracted patient data is removed and the remaining cases are renumbered. The article itself is kept.`)) {
      onRemove && onRemove(openId);
    }
  };

  return (
    <div data-testid="pex-case-nav" style={barStyle}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: C.muted, textTransform: 'uppercase', flexShrink: 0 }}>
        Cases ({cases.length})
      </span>

      <div role="tablist" aria-label="Cases reported in this article" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
        {cases.map((c) => {
          const on = c.id === openId;
          return (
            <button key={c.id} role="tab" aria-selected={on} data-testid={`pex-case-chip-${c.caseNumber}`}
              onClick={() => onOpen && onOpen(c.id)}
              title={`${c.name} — ${c.complete ? 'complete' : `${c.pct}% extracted (${c.filled}/${c.total} fields)`}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? C.acc : C.brd}`, background: on ? themeAlpha(C.acc, '18') : C.card,
                color: on ? C.acc : C.txt2, fontSize: 11.5, fontWeight: on ? 700 : 500, maxWidth: 220,
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              {c.complete
                ? <span title="Complete" style={{ color: C.grn }}>✓</span>
                : <span style={{ fontSize: 9.5, color: C.muted }}>{c.pct === 0 ? 'not started' : `${c.pct}%`}</span>}
            </button>
          );
        })}
      </div>

      {canEdit && (
        <button onClick={() => onAdd && onAdd(group.publicationId)} data-testid="pex-case-add"
          style={{ ...btnS('ghost'), fontSize: 11 }}
          title="Add another patient from this same article (the article’s authors, year, journal and PDF are shared)">
          + Add case
        </button>
      )}

      <div style={{ flex: 1 }} />

      {canEdit && active && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {renaming ? (
            <>
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
                placeholder={`Case ${active.caseNumber}`} aria-label="Case name" style={{ ...inp, width: 180, fontSize: 12 }} />
              <button onClick={commitRename} style={{ ...btnS('primary'), fontSize: 11 }}>Save</button>
            </>
          ) : (
            <>
              <button onClick={startRename} style={{ ...btnS('ghost'), fontSize: 11 }} title="Rename this case (e.g. “62F, index patient”)">✎ Rename</button>
              <button onClick={() => onDuplicate && onDuplicate(openId)} style={{ ...btnS('ghost'), fontSize: 11 }}
                title="Duplicate this case, including its extracted values — useful when several patients differ in only one or two fields">⧉</button>
              {cases.length > 1 && (
                <button onClick={confirmRemove} data-testid="pex-case-delete"
                  style={{ ...btnS('ghost'), fontSize: 11, color: C.red }} title="Delete this case">🗑</button>
              )}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: C.muted, marginLeft: 4 }}
                title="Turn Case Series Mode off. No case and no extracted value is deleted — the cases simply become ordinary study rows again.">
                <input type="checkbox" checked readOnly={false}
                  onChange={() => onDisable && onDisable(group.publicationId)}
                  aria-label="This article contains multiple cases / case series" style={{ cursor: 'pointer' }} />
                <span>Case series</span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const barStyle = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
  borderBottom: `1px solid ${C.brd}`, background: C.bg, flexWrap: 'wrap', flexShrink: 0,
};
