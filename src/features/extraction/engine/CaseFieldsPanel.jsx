/**
 * features/extraction/engine/CaseFieldsPanel.jsx — 106.md (Case-level data).
 *
 * The patient-level form for ONE case: age, sex, presentation, symptoms,
 * comorbidities, labs, imaging, treatment, intervention, complications, follow-up,
 * outcome, survival, time-to-event — plus whatever custom variables the review adds.
 *
 * The DEFINITIONS are project-wide (project.caseVariables) so every case of every
 * article is extracted against the same schema; the VALUES live on the case's own study
 * row under the flat key `cv_<id>`. That flatness is the whole trick: per-value
 * provenance is keyed by field name, so each patient variable gets the same "⌖ source"
 * jump-to-PDF affordance as an effect size, and 106.md's `Case 3 → Age = 54` can point
 * at the exact table cell it came from.
 *
 * The variable editor is deliberately minimal (add / rename / retype / remove). It is
 * collapsed by default so the common case — extract against the seeded fields — is one
 * scroll, not a configuration exercise.
 */
import { useMemo, useState } from 'react';
import { C, btnS, inp, lbl } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import {
  CASE_VARIABLE_TYPES, CASE_VARIABLE_GROUPS, mkCaseVariable, caseVarKey,
} from '../../../research-engine/extraction/caseSeries.js';

export default function CaseFieldsPanel({
  study, caseVariables = [], readOnly = false, canEdit = true,
  onSetValue, onSetVariables, hasSource, onJump,
  picking = false, activeField = '', onFocusField,
}) {
  const [editing, setEditing] = useState(false);
  const editable = canEdit && !readOnly;

  // Group for display in the 106.md order; an empty group renders nothing.
  const grouped = useMemo(() => {
    const byGroup = new Map(CASE_VARIABLE_GROUPS.map((g) => [g, []]));
    for (const v of caseVariables) {
      if (!byGroup.has(v.group)) byGroup.set(v.group, []);
      byGroup.get(v.group).push(v);
    }
    return [...byGroup.entries()].filter(([, list]) => list.length > 0);
  }, [caseVariables]);

  const addVariable = () => {
    if (!onSetVariables) return;
    onSetVariables([...caseVariables, mkCaseVariable({ label: 'New variable', type: 'text', group: 'Other' })]);
  };
  const patchVariable = (id, patch) => {
    if (!onSetVariables) return;
    onSetVariables(caseVariables.map((v) => (v.id === id ? mkCaseVariable({ ...v, ...patch }) : v)));
  };
  const removeVariable = (id) => {
    if (!onSetVariables) return;
    const v = caseVariables.find((x) => x.id === id);
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${(v && v.label) || 'this variable'}" from every case in this review? Values already extracted stay on the case rows but stop being shown or exported.`)) return;
    onSetVariables(caseVariables.filter((x) => x.id !== id));
  };

  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: C.muted }}>CASE-LEVEL DATA</div>
        <span style={{ fontSize: 10.5, color: C.dim }}>this patient only</span>
        <div style={{ flex: 1 }} />
        {editable && (
          <button onClick={() => setEditing((e) => !e)} style={{ ...btnS('ghost'), fontSize: 11 }}
            title="Add, rename or remove the patient-level variables this review extracts">
            {editing ? 'Done' : '⚙ Fields'}
          </button>
        )}
      </div>

      {!caseVariables.length && (
        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
          No patient-level variables defined yet.{editable ? ' Use ⚙ Fields to add them.' : ''}
        </div>
      )}

      {!editing && grouped.map(([groupName, list]) => (
        <div key={groupName} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: C.dim, textTransform: 'uppercase', marginBottom: 6 }}>{groupName}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {list.map((v) => {
              const key = caseVarKey(v.id);
              const value = study && study[key] != null ? String(study[key]) : '';
              const active = picking && activeField === key;
              const sourced = !!(hasSource && hasSource(key));
              const border = active ? C.acc : sourced ? themeAlpha(C.acc, '55') : C.brd;
              return (
                <div key={v.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <label style={{ ...lbl, margin: 0, color: active ? C.acc : undefined }} htmlFor={`pex-cv-${v.id}`}>
                      {active ? '◎ ' : ''}{v.label}{v.unit ? ` (${v.unit})` : ''}
                    </label>
                    {sourced && (
                      <button onClick={() => onJump && onJump(key)} data-pex-jump title="Jump to this value’s source in the PDF"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.acc, fontSize: 10.5, fontWeight: 700, padding: 0 }}>
                        ⌖ source
                      </button>
                    )}
                  </div>
                  {v.type === 'select' && v.options.length ? (
                    <select id={`pex-cv-${v.id}`} data-testid={`pex-case-field-${v.id}`} value={value} disabled={!editable}
                      onChange={(e) => onSetValue && onSetValue(key, e.target.value)}
                      style={{ ...inp, fontSize: 12.5, borderColor: border }}>
                      <option value="">—</option>
                      {v.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id={`pex-cv-${v.id}`} data-testid={`pex-case-field-${v.id}`} value={value} disabled={!editable}
                      type={v.type === 'date' ? 'date' : 'text'}
                      inputMode={v.type === 'number' ? 'decimal' : undefined}
                      onFocus={picking && onFocusField ? () => onFocusField(key) : undefined}
                      onChange={(e) => onSetValue && onSetValue(key, e.target.value)}
                      placeholder={v.description || ''}
                      aria-label={active ? `${v.label} — active pick target` : undefined}
                      style={{
                        ...inp, fontSize: 12.5, borderColor: border,
                        fontFamily: v.type === 'number' ? "'IBM Plex Mono',monospace" : 'inherit',
                        boxShadow: active ? `0 0 0 2px ${themeAlpha(C.acc, '33')}` : undefined,
                      }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {editing && editable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            These variables apply to every case in this review. Changing a label is safe — values are stored against the field, not its name.
          </div>
          {caseVariables.map((v) => (
            <div key={v.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={v.label} onChange={(e) => patchVariable(v.id, { label: e.target.value })}
                aria-label="Variable name" placeholder="Variable name" style={{ ...inp, fontSize: 12, width: 170 }} />
              <select value={v.type} onChange={(e) => patchVariable(v.id, { type: e.target.value })}
                aria-label="Variable type" style={{ ...inp, width: 'auto', fontSize: 11.5 }}>
                {CASE_VARIABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={v.group} onChange={(e) => patchVariable(v.id, { group: e.target.value })}
                aria-label="Variable group" style={{ ...inp, width: 'auto', fontSize: 11.5 }}>
                {CASE_VARIABLE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input value={v.unit} onChange={(e) => patchVariable(v.id, { unit: e.target.value })}
                aria-label="Unit" placeholder="unit" style={{ ...inp, fontSize: 12, width: 70 }} />
              {v.type === 'select' && (
                <input value={v.options.join(', ')} onChange={(e) => patchVariable(v.id, { options: e.target.value.split(',').map((o) => o.trim()) })}
                  aria-label="Options, comma separated" placeholder="option A, option B" style={{ ...inp, fontSize: 12, flex: 1, minWidth: 140 }} />
              )}
              <button onClick={() => removeVariable(v.id)} style={{ ...btnS('ghost'), fontSize: 11, color: C.red }} title="Remove this variable">✕</button>
            </div>
          ))}
          <div>
            <button onClick={addVariable} style={{ ...btnS('ghost'), fontSize: 11 }}>＋ Add variable</button>
          </div>
        </div>
      )}
    </div>
  );
}
