/**
 * features/extraction/engine/DemographicsPanel.jsx — 119.md §6.
 *
 * The project-level "Basic Demographics and Study Characteristics" area: the curated
 * library (grouped, with design-aware recommendations), the ARM columns, the table
 * configuration (which fields, in which order, in which groups, with which footnotes)
 * and a live preview of the table those choices produce.
 *
 * IT IS NOT A SPREADSHEET (§6 "do not implement it as a rigid spreadsheet with dozens of
 * irrelevant mandatory columns"). Nothing is mandatory, every field is one click to add
 * and one click to take out of the table, and a field that holds data can be removed
 * from the TABLE without touching a single extracted value.
 *
 * WRITES. Field definitions go out through `onSetFields(list)` (the 116 registry writer)
 * and the table configuration through `onSetConfig(cfg)` — both land in the project blob
 * through the surface's own updateProject, and both delete their key when emptied, so a
 * review that tries the feature and clears it serialises byte-identically to one that
 * never opened this panel.
 *
 * VALUES ARE NOT EDITED HERE. They are extracted per article, on the article's own form
 * (ProjectFieldsPanel), where the PDF, the provenance and the undo stack are. This panel
 * shows them read-only so the reviewer can see the table taking shape.
 */
import { useMemo, useState } from 'react';
import { C, btnS, inp, lbl } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import {
  addCatalogField, projectExtractionFields, activeExtractionFields, countFieldValues,
  fieldDisplayLabel, isArmLevelField, isStatField, slotBaseOf,
} from '../../../research-engine/extraction/fieldRegistry.js';
import {
  demographicsArms, addDemographicsArm, renameDemographicsArm, removeDemographicsArm,
  moveDemographicsArm, addDemographicsItem, removeDemographicsItem, moveDemographicsItem,
  setDemographicsItemNote, setDemographicsNotes, projectDemographicsConfig,
  addDemographicsGroup, setDemographicsItemGroup, DEFAULT_ARMS,
} from '../../../research-engine/extraction/demographics.js';
import {
  buildDemographicsTable, demographicsLibrary, recommendDemographicsFields, demographicsColumns,
} from '../../../research-engine/extraction/demographicsTable.js';

/** Section header — pinned by the SSR tests. */
export const DEMOGRAPHICS_TITLE = 'BASIC DEMOGRAPHICS & STUDY CHARACTERISTICS';
/** Shown before the review has added anything. */
export const DEMOGRAPHICS_EMPTY = 'Nothing configured yet — add the characteristics this review reports and they appear on every article and in the manuscript table.';
/** The one honest sentence about what a recommendation is. */
export const RECOMMEND_NOTE = 'Recommended from the study designs already extracted. Adding a field creates an empty column — it never fills in a value.';
/** The §6 promise about arm columns. */
export const ARMS_NOTE = 'Arm columns apply to fields that can differ between arms (age, sex, sample size…). Values are stored per arm, never merged into one number.';

const cellTh = { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${C.brd}`, fontSize: 10.5, color: C.muted, whiteSpace: 'nowrap' };
const cellTd = { padding: '5px 8px', borderBottom: `1px solid ${C.brd}`, fontSize: 11.5, color: C.txt, whiteSpace: 'nowrap' };

export default function DemographicsPanel({
  project = {}, studies = [], readOnly = false, onSetFields, onSetConfig, defaultOpen = false,
  // `initialTab` mirrors ProjectFieldsPanel's `initialMode`: the SSR tests render one
  // pane directly instead of pretending to click (repo house style for UI tests).
  initialTab = 'fields',
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [tab, setTab] = useState(initialTab);
  const [armName, setArmName] = useState('');
  const [error, setError] = useState('');

  const fields = useMemo(() => projectExtractionFields(project), [project]);
  const active = useMemo(() => activeExtractionFields(project), [project]);
  const cfg = useMemo(() => projectDemographicsConfig(project), [project]);
  const arms = useMemo(() => demographicsArms(project), [project]);
  const library = useMemo(() => demographicsLibrary(project), [project]);
  const recommended = useMemo(() => recommendDemographicsFields(project), [project]);
  const table = useMemo(() => buildDemographicsTable(project, { keepEmptyColumns: true }), [project]);
  const columns = useMemo(() => demographicsColumns(project), [project]);
  const configurable = !readOnly && typeof onSetFields === 'function' && typeof onSetConfig === 'function';

  const inTable = new Set((cfg.items || []).map((i) => i.fieldId));
  const applyFields = (res) => {
    if (res && res.error) { setError(res.error); return; }
    setError('');
    if (res && res.fields && onSetFields) onSetFields(res.fields);
  };
  const applyCfg = (res) => {
    if (res && res.error) { setError(res.error); return; }
    setError('');
    if (res && res.config && onSetConfig) onSetConfig(res.config);
  };
  /* §6 "Group fields" — the reviewer types a heading; an existing one is reused, a new
     one is created. Groups are display structure only: clearing one never moves a value
     and never takes the field out of the table. */
  const setItemGroup = (fieldId, label) => {
    const name = String(label || '').trim();
    if (!name) { applyCfg(setDemographicsItemGroup(cfg, fieldId, '')); return; }
    const existing = (cfg.groups || []).find((g) => g.label.toLowerCase() === name.toLowerCase());
    if (existing) { applyCfg(setDemographicsItemGroup(cfg, fieldId, existing.id)); return; }
    const made = addDemographicsGroup(cfg, name);
    if (made.error) { setError(made.error); return; }
    applyCfg(setDemographicsItemGroup(made.config, fieldId, made.id));
  };

  const addField = (catalogId) => {
    const res = addCatalogField(fields, catalogId);
    if (res.error) { setError(res.error); return; }
    applyFields(res);
    // An EMPTY item list means "every configured field is in the table" (and keeps the
    // blob byte-identical for a review that never curated one), so materialising a list
    // here would silently reduce the table to this one new field. Only an already-curated
    // list gains the new row.
    if ((cfg.items || []).length) applyCfg(addDemographicsItem(cfg, res.id));
  };

  return (
    <div data-testid="pex-demographics" style={{ border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: C.muted }}>{DEMOGRAPHICS_TITLE}</div>
        <span style={{ fontSize: 10.5, color: C.dim }}>
          {columns.length ? `${columns.length} column${columns.length === 1 ? '' : 's'}${arms.length ? ` · ${arms.length} arm${arms.length === 1 ? '' : 's'}` : ''}` : 'not configured'}
        </span>
        <div style={{ flex: 1 }} />
        <button data-testid="pex-demographics-toggle" onClick={() => setOpen((v) => !v)}
          aria-expanded={open} style={{ ...btnS(open ? 'primary' : 'ghost'), fontSize: 11 }}>
          {open ? 'Done' : 'Configure table'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {[['fields', 'Fields'], ['arms', 'Arms'], ['preview', 'Preview']].map(([id, label]) => (
              <button key={id} data-testid={`pex-demo-tab-${id}`} onClick={() => setTab(id)}
                style={{ ...btnS(tab === id ? 'primary' : 'ghost'), fontSize: 11 }}>{label}</button>
            ))}
          </div>

          {error && <div data-testid="pex-demo-error" style={{ fontSize: 11.5, color: C.red, marginBottom: 8 }}>{error}</div>}
          {!configurable && <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>You can view this table but not change it.</div>}

          {tab === 'fields' && (
            <div>
              {recommended.length > 0 && (
                <div data-testid="pex-demo-recommended" style={{ border: `1px solid ${themeAlpha(C.acc, '44')}`, background: themeAlpha(C.acc, '0a'), borderRadius: 8, padding: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.txt, marginBottom: 4 }}>Recommended for this review</div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>{RECOMMEND_NOTE}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {recommended.map((r) => (
                      <button key={r.catalogId} data-testid={`pex-demo-recommend-${r.catalogId}`} disabled={!configurable}
                        title={r.reason} onClick={() => addField(r.catalogId)}
                        style={{ ...btnS('ghost'), fontSize: 11, padding: '4px 9px' }}>＋ {r.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {library.map((g) => (
                <div key={g.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: C.dim, textTransform: 'uppercase', marginBottom: 5 }}>{g.label}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {g.entries.map((e) => (
                      <button key={e.catalogId} data-testid={`pex-demo-add-${e.catalogId}`} disabled={!configurable || e.added}
                        title={e.description || ''} onClick={() => addField(e.catalogId)}
                        style={{
                          ...btnS('ghost'), fontSize: 11, padding: '4px 9px',
                          opacity: e.added ? 0.5 : 1, cursor: e.added ? 'default' : 'pointer',
                          borderColor: e.added ? themeAlpha(C.grn, '66') : C.brd,
                        }}>
                        {e.added ? '✓ ' : '＋ '}{e.label}{e.unit ? ` (${e.unit})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: C.dim, textTransform: 'uppercase', marginBottom: 6 }}>Rows in the table</div>
                {!active.length && <div style={{ fontSize: 11.5, color: C.muted }}>{DEMOGRAPHICS_EMPTY}</div>}
                {(cfg.items || []).length === 0 && active.length > 0 && (
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>
                    Every configured extraction field is in the table. Take one out to build a shorter table — its extracted values are kept.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {active.map((f, i) => {
                    const listed = inTable.size === 0 || inTable.has(f.id);
                    const used = countFieldValues(studies, f);
                    const item = (cfg.items || []).find((x) => x.fieldId === f.id) || {};
                    return (
                      <div key={f.id} data-testid={`pex-demo-item-${f.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', opacity: listed ? 1 : 0.55 }}>
                        <span style={{ fontSize: 11.5, color: C.txt, minWidth: 170 }}>{fieldDisplayLabel(f)}</span>
                        <span style={{ fontSize: 10, color: C.dim, minWidth: 92 }}>
                          {isStatField(f) ? 'statistic' : 'value'}{isArmLevelField(f) ? ' · per arm' : ''}
                        </span>
                        <span style={{ fontSize: 10.5, color: used ? C.grn : C.dim, minWidth: 70 }}>{used ? `${used} value${used === 1 ? '' : 's'}` : 'no values'}</span>
                        <input defaultValue={(cfg.groups || []).find((g) => g.id === item.group)?.label || ''}
                          placeholder="group (optional)" disabled={!configurable || !inTable.has(f.id)}
                          aria-label={`Group for ${f.label}`} data-testid={`pex-demo-group-${f.id}`}
                          onBlur={(e) => { if (inTable.has(f.id)) setItemGroup(f.id, e.target.value); }}
                          style={{ ...inp, fontSize: 11, width: 110, padding: '3px 6px' }} />
                        <input defaultValue={item.note || ''} placeholder="footnote (optional)" disabled={!configurable || !listed}
                          aria-label={`Footnote for ${f.label}`}
                          onBlur={(e) => { if (inTable.has(f.id)) applyCfg(setDemographicsItemNote(cfg, f.id, e.target.value)); }}
                          style={{ ...inp, fontSize: 11, flex: 1, minWidth: 120, padding: '3px 6px' }} />
                        <button data-testid={`pex-demo-up-${f.id}`} disabled={!configurable || !inTable.has(f.id) || i === 0}
                          onClick={() => applyCfg(moveDemographicsItem(cfg, f.id, -1))} title="Move up"
                          style={{ ...btnS('ghost'), fontSize: 11, padding: '2px 7px' }}>▲</button>
                        <button data-testid={`pex-demo-down-${f.id}`} disabled={!configurable || !inTable.has(f.id)}
                          onClick={() => applyCfg(moveDemographicsItem(cfg, f.id, 1))} title="Move down"
                          style={{ ...btnS('ghost'), fontSize: 11, padding: '2px 7px' }}>▼</button>
                        <button data-testid={`pex-demo-toggle-${f.id}`}
                          // A table with no columns is not a table — and an empty item
                          // list already means "all of them", so the last remaining row
                          // cannot be taken out. Said, rather than silently ignored.
                          disabled={!configurable || (listed && active.length === 1)}
                          title={listed && active.length === 1 ? 'The table needs at least one field.' : ''}
                          onClick={() => {
                            if (listed && inTable.size === 0) {
                              // First removal materialises the explicit list (everything
                              // except this one) — the table stops being "all fields".
                              let next = cfg;
                              for (const other of active) {
                                if (other.id === f.id) continue;
                                const r = addDemographicsItem(next, other.id);
                                if (r.config) next = r.config;
                              }
                              applyCfg({ config: next });
                              return;
                            }
                            applyCfg(listed ? removeDemographicsItem(cfg, f.id) : addDemographicsItem(cfg, f.id));
                          }}
                          style={{ ...btnS('ghost'), fontSize: 11 }}>{listed ? 'In table' : 'Add to table'}</button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={lbl} htmlFor="pex-demo-notes">Table footnotes</label>
                <textarea id="pex-demo-notes" data-testid="pex-demo-notes" defaultValue={(cfg.notes || []).join('\n')}
                  disabled={!configurable} placeholder="One footnote per line — e.g. how a statistic was reported, or why a value is unclear."
                  onBlur={(e) => applyCfg(setDemographicsNotes(cfg, e.target.value.split('\n')))}
                  style={{ ...inp, fontSize: 12, height: 52, resize: 'vertical' }} />
              </div>
            </div>
          )}

          {tab === 'arms' && (
            <div data-testid="pex-demo-arms">
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>{ARMS_NOTE}</div>
              {!arms.length && (
                <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>
                  No arm columns — every value is recorded for the study overall. Single-arm studies, cohorts and case series usually need nothing else.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                {arms.map((a, i) => (
                  <div key={a.id} data-testid={`pex-demo-arm-${a.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input defaultValue={a.label} aria-label={`Name of arm ${a.label}`} disabled={!configurable}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== a.label) applyCfg(renameDemographicsArm(cfg, a.id, v)); }}
                      style={{ ...inp, fontSize: 12, width: 200 }} />
                    <button disabled={!configurable || i === 0} onClick={() => applyCfg(moveDemographicsArm(cfg, a.id, -1))}
                      title="Move left" style={{ ...btnS('ghost'), fontSize: 11, padding: '2px 7px' }}>◀</button>
                    <button disabled={!configurable || i === arms.length - 1} onClick={() => applyCfg(moveDemographicsArm(cfg, a.id, 1))}
                      title="Move right" style={{ ...btnS('ghost'), fontSize: 11, padding: '2px 7px' }}>▶</button>
                    <button data-testid={`pex-demo-arm-remove-${a.id}`} disabled={!configurable}
                      onClick={() => applyCfg(removeDemographicsArm(cfg, a.id, studies, fields.map(slotBaseOf)))}
                      style={{ ...btnS('ghost'), fontSize: 11, color: C.red }}>Remove</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input value={armName} onChange={(e) => setArmName(e.target.value)} data-testid="pex-demo-arm-name"
                  aria-label="New arm name" placeholder="e.g. Intervention" disabled={!configurable}
                  style={{ ...inp, fontSize: 12, width: 200 }} />
                <button data-testid="pex-demo-arm-add" disabled={!configurable || !armName.trim()}
                  onClick={() => { applyCfg(addDemographicsArm(cfg, armName.trim())); setArmName(''); }}
                  style={{ ...btnS('primary'), fontSize: 11 }}>Add arm</button>
                {/* The two presets stay available until BOTH are in the table — adding
                    "Intervention" must not hide "Control". */}
                {DEFAULT_ARMS.filter((a) => !arms.some((x) => x.id === a.id)).map((a) => (
                  <button key={a.id} data-testid={`pex-demo-arm-preset-${a.id}`} disabled={!configurable}
                    onClick={() => applyCfg(addDemographicsArm(cfg, a.label))}
                    style={{ ...btnS('ghost'), fontSize: 11 }}>＋ {a.label}</button>
                ))}
              </div>
            </div>
          )}

          {tab === 'preview' && (
            <div data-testid="pex-demo-preview">
              {!table.columns.length || !studies.length ? (
                <div style={{ fontSize: 11.5, color: C.muted }}>
                  {studies.length ? DEMOGRAPHICS_EMPTY : 'No extraction rows yet — the table appears as soon as this review has studies.'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 8 }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={cellTh}>Study</th>
                        {table.columns.map((c) => (
                          <th key={c.key} style={cellTh}>
                            {c.groupLabel && <div style={{ fontSize: 9.5, color: C.dim, textTransform: 'uppercase' }}>{c.groupLabel}</div>}
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {studies.map((st, i) => (
                        <tr key={st.id || i}>
                          <td style={cellTd}>{st.author || st.title || `Study ${i + 1}`}{st.year ? ` ${st.year}` : ''}</td>
                          {table.columns.map((c) => {
                            const v = table.rows[i] ? table.rows[i][c.key] : '';
                            return <td key={c.key} style={cellTd}>{v === '' ? '—' : v}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                Values are extracted on each article&rsquo;s own form, where the PDF and the source link are.
                “—” means nobody has extracted it yet; NR / NA / Unclear are recorded facts about the article.
              </div>
              {(cfg.notes || []).map((n, i) => (
                <div key={i} style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>{n}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
