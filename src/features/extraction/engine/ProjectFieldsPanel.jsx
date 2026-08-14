/**
 * features/extraction/engine/ProjectFieldsPanel.jsx — 116.md §35/§37/§39/§40.
 *
 * The PROJECT-LEVEL extraction field library, as a surface: the configured fields
 * rendered as inputs on every study's extraction form, plus the `＋ Add field` menu that
 * browses the §36 catalog by category, searches it, and defines custom fields (§37).
 *
 * WHY IT LOOKS LIKE CaseFieldsPanel: 106.md's patient-variable editor is the proven
 * in-repo shape for "definitions live in the project blob, values live flat on the row",
 * and this is the same machine generalised to the whole review (see fieldRegistry.js).
 * Everything that DECIDES anything is in the pure registry so it can be unit-tested; this
 * file is wiring + markup only.
 *
 * WRITES. Values go out through `onSetValue(storageKey, value)` — the surface's EXISTING
 * extraction write path (engine: setField → writeStudy → applyExtractionWrite; classic:
 * ch → updStudy → applyRowPatch), so autosave, per-value provenance and 108.md undo all
 * work with no new plumbing. Configuration goes out through `onSetFields(nextList)` → the
 * project blob. The two are deliberately separate: a COMPLETED/locked article stops
 * accepting values but the project schema is still configurable (§114/D13 — anyone who
 * can edit META·LAB content may configure fields).
 *
 * DESTRUCTIVE OPS CONFIRM (§39/D13): archiving a field that holds data, and the only
 * hard delete there is (a field nobody ever filled in — the registry refuses the rest).
 */
import { useMemo, useState } from 'react';
import { C, btnS, inp, lbl } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import {
  FIELD_CATEGORIES, FIELD_CATEGORY_LABEL, FIELD_DATA_TYPES, FIELD_DATA_TYPE_LABEL,
  ADDABLE_CATALOG, catalogByCategory, searchCatalog, OPTION_DATA_TYPES, NUMERIC_DATA_TYPES,
} from '../../../research-engine/extraction/fieldCatalog.js';
import {
  storageKeyOf, fieldDisplayLabel, addCatalogField, addCustomField, renameExtractionField,
  moveExtractionField, setExtractionFieldHidden, setExtractionFieldArchived,
  setExtractionFieldUnit, setExtractionFieldOptions, removeExtractionField,
  countFieldValues,
} from '../../../research-engine/extraction/fieldRegistry.js';

/** Header string both extraction surfaces show above the section (pinned by SSR tests). */
export const PROJECT_FIELDS_TITLE = 'PROJECT EXTRACTION FIELDS';
/** The §35 affordance label. */
export const ADD_FIELD_LABEL = '＋ Add field';
/** Shown when the review has configured nothing yet. */
export const PROJECT_FIELDS_EMPTY = 'No extra fields yet — add the study characteristics this review needs and they appear on every article.';

const confirmed = (msg) => (typeof window === 'undefined' || !window.confirm ? true : window.confirm(msg));

/** One typed value input, chosen from the field's §37 data type. */
function ValueInput({ def, value, disabled, onChange, active, onFocusField }) {
  const id = `pex-xf-${def.id}`;
  const testId = `pex-xf-field-${def.id}`;
  const border = active ? C.acc : C.brd;
  const common = {
    id,
    'data-testid': testId,
    value,
    disabled,
    onChange: (e) => onChange && onChange(e.target.value),
    style: { ...inp, fontSize: 12.5, borderColor: border },
  };
  if (def.dataType === 'longtext') {
    return <textarea {...common} style={{ ...common.style, height: 48, resize: 'vertical' }} placeholder={def.description || ''} />;
  }
  if (def.dataType === 'boolean') {
    return (
      <select {...common}>
        <option value="">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (def.dataType === 'categorical' && def.options.length) {
    return (
      <select {...common}>
        <option value="">—</option>
        {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const numeric = NUMERIC_DATA_TYPES.includes(def.dataType);
  return (
    <input
      {...common}
      type={def.dataType === 'date' ? 'date' : 'text'}
      inputMode={numeric ? 'decimal' : undefined}
      onFocus={onFocusField || undefined}
      placeholder={def.dataType === 'multiselect'
        ? (def.options.length ? def.options.join(', ') : 'comma-separated')
        : (def.description || '')}
      style={{ ...common.style, fontFamily: numeric ? "'IBM Plex Mono',monospace" : 'inherit' }}
    />
  );
}

/** The §35 catalog browser + §37 custom-field form. */
function AddFieldMenu({ fields, onAdd, onAddCustom, onClose }) {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ label: '', description: '', dataType: 'text', unit: '', category: 'study', options: '' });
  const enabled = useMemo(() => new Set(fields.filter((f) => !f.archived).map((f) => f.catalogId).filter(Boolean)), [fields]);
  const groups = useMemo(() => catalogByCategory(searchCatalog(query, ADDABLE_CATALOG)), [query]);

  return (
    <div data-testid="pex-add-field-menu" style={{ border: `1px solid ${themeAlpha(C.acc, '55')}`, background: themeAlpha(C.acc, '0a'), borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 11.5, color: C.txt }}>Add a field to this project</strong>
        <span style={{ fontSize: 11, color: C.muted }}>it appears on every article</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...btnS('ghost'), fontSize: 11 }}>Done</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} data-testid="pex-add-field-search"
          aria-label="Search extraction fields" placeholder="Search fields (country, mean age, follow-up…)"
          style={{ ...inp, fontSize: 12, flex: 1, minWidth: 180 }} />
        <button onClick={() => setCustom((v) => !v)} data-testid="pex-add-custom-toggle" style={{ ...btnS(custom ? 'primary' : 'ghost'), fontSize: 11 }}>
          {custom ? 'Browse catalog' : 'Custom field…'}
        </button>
      </div>

      {custom ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={lbl} htmlFor="pex-xf-new-label">Field name</label>
            <input id="pex-xf-new-label" data-testid="pex-xf-new-label" value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Tumour stage" style={{ ...inp, fontSize: 12 }} />
          </div>
          <div>
            <label style={lbl} htmlFor="pex-xf-new-type">Data type</label>
            <select id="pex-xf-new-type" data-testid="pex-xf-new-type" value={draft.dataType}
              onChange={(e) => setDraft({ ...draft, dataType: e.target.value })} style={{ ...inp, fontSize: 12 }}>
              {FIELD_DATA_TYPES.map((t) => <option key={t} value={t}>{FIELD_DATA_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="pex-xf-new-category">Category</label>
            <select id="pex-xf-new-category" value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={{ ...inp, fontSize: 12 }}>
              {FIELD_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="pex-xf-new-unit">Unit (optional)</label>
            <input id="pex-xf-new-unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              placeholder="e.g. years, mg" style={{ ...inp, fontSize: 12 }} />
          </div>
          {OPTION_DATA_TYPES.includes(draft.dataType) && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl} htmlFor="pex-xf-new-options">Allowed options (comma separated)</label>
              <input id="pex-xf-new-options" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })}
                placeholder="Stage I, Stage II, Stage III" style={{ ...inp, fontSize: 12 }} />
            </div>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl} htmlFor="pex-xf-new-desc">Description (optional)</label>
            <input id="pex-xf-new-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What exactly should the reviewer record here?" style={{ ...inp, fontSize: 12 }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button data-testid="pex-xf-new-save" disabled={!draft.label.trim()}
              onClick={() => {
                if (!draft.label.trim()) return;
                onAddCustom({ ...draft, options: draft.options.split(',') });
                setDraft({ label: '', description: '', dataType: 'text', unit: '', category: draft.category, options: '' });
              }}
              style={{ ...btnS('primary'), fontSize: 11.5 }}>Create field</button>
          </div>
        </div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {groups.length === 0 && <div style={{ fontSize: 11.5, color: C.muted }}>No catalog field matches “{query}”. Use <strong>Custom field…</strong> to define your own.</div>}
          {groups.map((g) => (
            <div key={g.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: C.dim, textTransform: 'uppercase', marginBottom: 5 }}>{g.label}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {g.entries.map((e) => {
                  const on = enabled.has(e.catalogId);
                  return (
                    <button key={e.catalogId} data-testid={`pex-catalog-${e.catalogId}`} disabled={on}
                      onClick={() => onAdd(e.catalogId)} title={e.description || (e.mapsTo ? 'Uses the data already extracted in this field' : '')}
                      style={{
                        ...btnS('ghost'), fontSize: 11, padding: '4px 9px',
                        opacity: on ? 0.5 : 1, cursor: on ? 'default' : 'pointer',
                        borderColor: on ? themeAlpha(C.grn, '66') : C.brd,
                      }}>
                      {on ? '✓ ' : '＋ '}{e.label}{e.unit ? ` (${e.unit})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The §39 configuration list: rename, reorder, unit, options, hide, archive, delete. */
function ManageList({ fields, studies, onPatchFields }) {
  if (!fields.length) return <div style={{ fontSize: 11.5, color: C.muted }}>{PROJECT_FIELDS_EMPTY}</div>;
  return (
    <div data-testid="pex-manage-fields" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
        Renaming a field is safe — values are stored against the field, not its name. A field that already holds data can be archived, never deleted.
      </div>
      {fields.map((f, i) => {
        const used = countFieldValues(studies, f);
        return (
          <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', opacity: f.archived ? 0.6 : 1 }}>
            <input defaultValue={f.label} aria-label={`Name of ${f.label}`} data-testid={`pex-xf-label-${f.id}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f.label) onPatchFields(renameExtractionField(fields, f.id, v)); }}
              style={{ ...inp, fontSize: 12, width: 180 }} />
            <span style={{ fontSize: 10.5, color: C.dim, minWidth: 78 }}>{FIELD_DATA_TYPE_LABEL[f.dataType] || f.dataType}</span>
            <span style={{ fontSize: 10.5, color: C.dim, minWidth: 90 }}>{FIELD_CATEGORY_LABEL[f.category] || f.category}</span>
            <input defaultValue={f.unit} aria-label={`Unit of ${f.label}`} placeholder="unit"
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== f.unit) onPatchFields(setExtractionFieldUnit(fields, f.id, v)); }}
              style={{ ...inp, fontSize: 12, width: 70 }} />
            {OPTION_DATA_TYPES.includes(f.dataType) && (
              <input defaultValue={f.options.join(', ')} aria-label={`Options of ${f.label}`} placeholder="option A, option B"
                onBlur={(e) => onPatchFields(setExtractionFieldOptions(fields, f.id, e.target.value))}
                style={{ ...inp, fontSize: 12, flex: 1, minWidth: 130 }} />
            )}
            <span style={{ fontSize: 10.5, color: used ? C.grn : C.dim, minWidth: 74 }}>
              {used ? `${used} value${used === 1 ? '' : 's'}` : 'no values'}
            </span>
            <button onClick={() => onPatchFields(moveExtractionField(fields, f.id, -1))} disabled={i === 0}
              title="Move up" style={{ ...btnS('ghost'), fontSize: 11, padding: '2px 7px' }}>▲</button>
            <button onClick={() => onPatchFields(moveExtractionField(fields, f.id, 1))} disabled={i === fields.length - 1}
              title="Move down" style={{ ...btnS('ghost'), fontSize: 11, padding: '2px 7px' }}>▼</button>
            <button onClick={() => onPatchFields(setExtractionFieldHidden(fields, f.id, !f.hidden))}
              title={f.hidden ? 'Show this field on the extraction forms again' : 'Hide this field from the extraction forms (values are kept)'}
              style={{ ...btnS('ghost'), fontSize: 11 }}>{f.hidden ? 'Unhide' : 'Hide'}</button>
            <button data-testid={`pex-xf-archive-${f.id}`}
              onClick={() => {
                if (f.archived) { onPatchFields(setExtractionFieldArchived(fields, f.id, false)); return; }
                if (used && !confirmed(`Archive “${f.label}”? It holds data in ${used} record${used === 1 ? '' : 's'}. The values are kept and come straight back if you un-archive it, but the field stops appearing on forms, exports and analysis tables.`)) return;
                onPatchFields(setExtractionFieldArchived(fields, f.id, true));
              }}
              style={{ ...btnS('ghost'), fontSize: 11, color: f.archived ? C.acc : C.yel }}>
              {f.archived ? 'Un-archive' : 'Archive'}
            </button>
            <button data-testid={`pex-xf-delete-${f.id}`}
              onClick={() => {
                const r = removeExtractionField(fields, f.id, studies);
                if (r.error) { if (typeof window !== 'undefined' && window.alert) window.alert(r.error); return; }
                if (!confirmed(`Delete “${f.label}” from this project? No record holds a value for it, so nothing is lost.`)) return;
                onPatchFields(r);
              }}
              title={used ? 'This field holds extracted data — archive it instead' : 'Delete this empty field'}
              style={{ ...btnS('ghost'), fontSize: 11, color: used ? C.dim : C.red }}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ProjectFieldsPanel — the §40 propagation surface.
 *
 * @param {object[]} fields    normalized definitions (fieldRegistry.projectExtractionFields)
 * @param {object}   study     the row being extracted (values are read/written flat)
 * @param {object[]} studies   every row — used only to count values before a destructive op
 * @param {function} onSetValue(storageKey, value)
 * @param {function} onSetFields(nextDefinitionList)
 * @param {string}   initialMode 'values' | 'add' | 'manage' (tests render the menus directly)
 */
export default function ProjectFieldsPanel({
  fields = [], study = null, studies = [], readOnly = false, canEdit = true, canConfigure = true,
  onSetValue, onSetFields, hasSource, onJump, picking = false, activeField = '', onFocusField,
  initialMode = 'values',
}) {
  const [mode, setMode] = useState(initialMode);
  const configurable = canConfigure && !readOnly && typeof onSetFields === 'function';
  const valuesEditable = canEdit && !readOnly;
  const visible = useMemo(() => fields.filter((f) => !f.hidden && !f.archived), [fields]);
  const grouped = useMemo(() => FIELD_CATEGORIES
    .map((c) => ({ id: c.id, label: c.label, list: visible.filter((f) => f.category === c.id) }))
    .filter((g) => g.list.length > 0), [visible]);

  const apply = (res) => { if (res && res.fields && onSetFields) onSetFields(res.fields); };

  return (
    <div data-testid="pex-project-fields" style={{ border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: C.muted }}>{PROJECT_FIELDS_TITLE}</div>
        <span style={{ fontSize: 10.5, color: C.dim }}>shown on every article</span>
        <div style={{ flex: 1 }} />
        {configurable && (
          <>
            <button data-testid="pex-add-field" onClick={() => setMode((m) => (m === 'add' ? 'values' : 'add'))}
              title="Browse the extraction-field catalog or define a custom field"
              style={{ ...btnS(mode === 'add' ? 'primary' : 'ghost'), fontSize: 11 }}>{ADD_FIELD_LABEL}</button>
            <button data-testid="pex-manage-field-toggle" onClick={() => setMode((m) => (m === 'manage' ? 'values' : 'manage'))}
              title="Rename, reorder, hide or archive this project's extraction fields"
              style={{ ...btnS('ghost'), fontSize: 11 }}>{mode === 'manage' ? 'Done' : '⚙ Configure'}</button>
          </>
        )}
      </div>

      {mode === 'add' && configurable && (
        <AddFieldMenu fields={fields}
          onAdd={(catalogId) => apply(addCatalogField(fields, catalogId))}
          onAddCustom={(spec) => apply(addCustomField(fields, spec))}
          onClose={() => setMode('values')} />
      )}

      {mode === 'manage' && configurable && (
        <ManageList fields={fields} studies={studies} onPatchFields={apply} />
      )}

      {mode !== 'manage' && !visible.length && (
        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{PROJECT_FIELDS_EMPTY}</div>
      )}

      {mode !== 'manage' && grouped.map((g) => (
        <div key={g.id} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: C.dim, textTransform: 'uppercase', marginBottom: 6 }}>{g.label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {g.list.map((f) => {
              const key = storageKeyOf(f);
              const value = study && study[key] != null ? String(study[key]) : '';
              const active = picking && activeField === key;
              const sourced = !!(hasSource && hasSource(key));
              return (
                <div key={f.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <label style={{ ...lbl, margin: 0, color: active ? C.acc : undefined }} htmlFor={`pex-xf-${f.id}`}>
                      {active ? '◎ ' : ''}{fieldDisplayLabel(f)}
                    </label>
                    {sourced && (
                      <button onClick={() => onJump && onJump(key)} data-pex-jump title="Jump to this value’s source in the PDF"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.acc, fontSize: 10.5, fontWeight: 700, padding: 0 }}>
                        ⌖ source
                      </button>
                    )}
                  </div>
                  <ValueInput def={f} value={value} disabled={!valuesEditable} active={active}
                    onChange={(v) => onSetValue && onSetValue(key, v)}
                    onFocusField={picking && onFocusField ? () => onFocusField(key) : undefined} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
