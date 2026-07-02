/**
 * features/extraction/ElementsEditor.jsx — 66.md (P5). Modal form-designer. Lists the
 * active form's Data Elements (name, type, required, unit, armScope), lets an editor
 * add / edit / remove them, and saves via PUT /form { elements }. Server-side
 * validateElement problems (422) are surfaced inline per element.
 *
 * Emitted elements are mkElement-shaped partials — the server normalizes them with
 * mkElement, so this editor only needs to send the fields it edits.
 */
import { useState } from 'react';
import { C, btnS, inp, lbl, themeAlpha } from './parts.jsx';

const ELEMENT_TYPES = [
  'dichotomous_outcome', 'continuous_outcome', 'categorical', 'baseline', 'study_design',
  'intervention_detail', 'comparator_detail', 'timepoint', 'adverse_event', 'text', 'numeric', 'date',
];

const uid = () => Math.random().toString(36).slice(2, 10);

function blankElement() {
  return { id: uid(), name: '', type: 'text', required: false, unit: '', armScope: 'study', allowedValues: [] };
}

export default function ElementsEditor({ initialElements, canEdit, saving, problems, onSave, onClose }) {
  const [elements, setElements] = useState(() =>
    (initialElements || []).map((e) => ({
      id: e.id || uid(), name: e.name || '', type: e.type || 'text', required: !!e.required,
      unit: e.unit || '', armScope: e.armScope === 'arm' ? 'arm' : 'study',
      allowedValues: Array.isArray(e.allowedValues) ? e.allowedValues : [],
      maCompatible: e.maCompatible || null, description: e.description || '',
    })),
  );

  const problemById = {};
  for (const p of (problems || [])) if (p.elementId) problemById[p.elementId] = p.errors || [];

  const patch = (id, key, val) => setElements((els) => els.map((e) => (e.id === id ? { ...e, [key]: val } : e)));
  const remove = (id) => setElements((els) => els.filter((e) => e.id !== id));
  const add = () => setElements((els) => [...els, blankElement()]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 20, width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.txt }}>Extraction form</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Define the data elements every study is extracted against. Arm-scoped elements are captured once per arm.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {elements.length === 0 && (
            <div style={{ fontSize: 12, color: C.muted, padding: '10px 2px' }}>No elements yet — add one below.</div>
          )}
          {elements.map((el) => {
            const errs = problemById[el.id];
            return (
              <div key={el.id} style={{ border: `1px solid ${errs ? themeAlpha(C.red, '55') : C.brd}`, borderRadius: 9, padding: 12, background: C.card }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr', gap: 10, marginBottom: 8 }}>
                  <div>
                    <label style={lbl}>Name</label>
                    <input value={el.name} onChange={(e) => patch(el.id, 'name', e.target.value)} placeholder="e.g. Total sample size (N)"
                      style={{ ...inp, fontSize: 12.5 }} disabled={!canEdit} />
                  </div>
                  <div>
                    <label style={lbl}>Type</label>
                    <select value={el.type} onChange={(e) => patch(el.id, 'type', e.target.value)} style={{ ...inp, fontSize: 12.5 }} disabled={!canEdit}>
                      {ELEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: el.type === 'categorical' ? 8 : 0 }}>
                  <div>
                    <label style={lbl}>Arm scope</label>
                    <select value={el.armScope} onChange={(e) => patch(el.id, 'armScope', e.target.value)} style={{ ...inp, fontSize: 12.5 }} disabled={!canEdit}>
                      <option value="study">Whole study</option>
                      <option value="arm">Per arm</option>
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Unit</label>
                    <input value={el.unit} onChange={(e) => patch(el.id, 'unit', e.target.value)} placeholder="e.g. months"
                      style={{ ...inp, fontSize: 12.5 }} disabled={!canEdit} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: canEdit ? 'pointer' : 'default', fontSize: 12, color: C.txt2 }}>
                      <input type="checkbox" checked={el.required} onChange={(e) => patch(el.id, 'required', e.target.checked)} disabled={!canEdit} style={{ accentColor: 'var(--t-acc)', width: 15, height: 15 }} />
                      Required
                    </label>
                  </div>
                </div>
                {el.type === 'categorical' && (
                  <div>
                    <label style={lbl}>Allowed values (comma-separated)</label>
                    <input
                      value={(el.allowedValues || []).join(', ')}
                      onChange={(e) => patch(el.id, 'allowedValues', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                      placeholder="e.g. Low, Moderate, High"
                      style={{ ...inp, fontSize: 12.5 }} disabled={!canEdit}
                    />
                  </div>
                )}
                {errs && errs.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: C.red, lineHeight: 1.5 }}>
                    {errs.map((msg, i) => <div key={i}>✗ {msg}</div>)}
                  </div>
                )}
                {canEdit && (
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => remove(el.id)} style={{ ...btnS('ghost'), fontSize: 11, color: C.red, borderColor: themeAlpha(C.red, '40') }}>Remove</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {canEdit && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 10, flexWrap: 'wrap' }}>
            <button onClick={add} style={{ ...btnS('ghost'), fontSize: 12 }}>+ Add element</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ ...btnS('ghost'), fontSize: 12 }}>Cancel</button>
              <button onClick={() => onSave(elements)} disabled={saving} style={{ ...btnS('primary'), fontSize: 12, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save form'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
