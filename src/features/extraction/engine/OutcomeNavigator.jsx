/**
 * features/extraction/engine/OutcomeNavigator.jsx — 82.md Part 1.
 *
 * A slim, keyboard-accessible bar shown above the extraction workspace when a study
 * is open. It lists every OUTCOME of the SAME paper (citation group) as switchable
 * chips, and offers "+ Add outcome" (clone the paper's citation into a fresh row — no
 * duplicate study), plus rename/role/duplicate/archive for the active outcome. All
 * mutations go through the pure outcomeGroups engine in the parent; this component is
 * presentational. Status is never communicated by colour alone (text label + %).
 */
import { useState } from 'react';
import { C, btnS, inp } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { groupForStudy, activeOutcomes, OUTCOME_ROLES, OUTCOME_ROLE_LABELS } from '../../../research-engine/extraction/outcomeGroups.js';

const CONV_TONE = { stale: C.yel, unable: C.red, missing: C.muted, generated: C.grn, eligible: C.acc, not_required: C.muted };

export default function OutcomeNavigator({ studies = [], openId, onOpen, onAdd, onRename, onSetRole, onDuplicate, onArchive, canEdit = true }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const group = groupForStudy(studies, openId);
  if (!group) return null;
  const outcomes = activeOutcomes(group);
  // A single-outcome paper with a still-unnamed sole outcome doesn't need the bar yet,
  // but we still show "+ Add outcome" so a secondary outcome never needs a duplicate study.
  const active = outcomes.find((o) => o.id === openId) || null;

  const startRename = () => { setDraft(active && active.name !== '(unnamed outcome)' ? active.name : ''); setRenaming(true); };
  const commitRename = () => { if (onRename) onRename(openId, draft.trim()); setRenaming(false); };

  return (
    <div data-testid="pex-outcome-nav" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: `1px solid ${C.brd}`, background: C.bg, flexWrap: 'wrap', flexShrink: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: C.muted, textTransform: 'uppercase', flexShrink: 0 }}>
        Outcomes{outcomes.length > 1 ? ` (${outcomes.length})` : ''}
      </span>
      <div role="tablist" aria-label="Outcomes for this study" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
        {outcomes.map((o) => {
          const on = o.id === openId;
          const tone = CONV_TONE[o.conversionStatus] || C.muted;
          return (
            <button key={o.id} role="tab" aria-selected={on} onClick={() => onOpen && onOpen(o.id)}
              title={`${o.name}${o.role ? ` · ${OUTCOME_ROLE_LABELS[o.role]}` : ''}${o.timepoint ? ` · ${o.timepoint}` : ''} · ${o.pct}% · ${o.conversionStatus}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? C.acc : C.brd}`, background: on ? themeAlpha(C.acc, '18') : C.card,
                color: on ? C.acc : C.txt2, fontSize: 11.5, fontWeight: on ? 700 : 500, maxWidth: 220,
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
              {o.role ? <span style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase' }}>{OUTCOME_ROLE_LABELS[o.role].slice(0, 4)}</span> : null}
              {o.complete ? <span title="Complete" style={{ color: C.grn }}>✓</span> : <span style={{ fontSize: 9.5, color: C.muted }}>{o.pct}%</span>}
              {o.conversionStatus === 'stale' ? <span title="Conversion out of date" style={{ color: tone }}>↻</span> : null}
            </button>
          );
        })}
      </div>
      {canEdit && (
        <button onClick={() => onAdd && onAdd(openId)} style={{ ...btnS('ghost'), fontSize: 11 }} title="Add another outcome to this same study (no duplicate paper)">+ Add outcome</button>
      )}
      <div style={{ flex: 1 }} />
      {canEdit && active && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {renaming ? (
            <>
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
                placeholder="Outcome name" aria-label="Outcome name" style={{ ...inp, width: 180, fontSize: 12 }} />
              <button onClick={commitRename} style={{ ...btnS('primary'), fontSize: 11 }}>Save</button>
            </>
          ) : (
            <>
              <button onClick={startRename} style={{ ...btnS('ghost'), fontSize: 11 }} title="Rename this outcome">✎ Rename</button>
              <select aria-label="Outcome role" value={active.role || ''} onChange={(e) => onSetRole && onSetRole(openId, e.target.value)} style={{ ...inp, width: 'auto', fontSize: 11 }}>
                <option value="">Role…</option>
                {OUTCOME_ROLES.map((r) => <option key={r} value={r}>{OUTCOME_ROLE_LABELS[r]}</option>)}
              </select>
              <button onClick={() => onDuplicate && onDuplicate(openId)} style={{ ...btnS('ghost'), fontSize: 11 }} title="Duplicate this outcome's structure (e.g. another time point)">⧉</button>
              {outcomes.length > 1 && (
                <button onClick={() => { if (window.confirm('Archive this outcome? Its data is preserved and can be restored.')) onArchive && onArchive(openId); }}
                  style={{ ...btnS('ghost'), fontSize: 11, color: C.red }} title="Archive this outcome (preserved, not deleted)">Archive</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
