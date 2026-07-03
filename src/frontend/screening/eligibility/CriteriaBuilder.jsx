/**
 * CriteriaBuilder.jsx — build/edit the structured yes/no eligibility criteria set
 * for the Criteria Screener (P10).
 *
 * Owner/leader only (respects `canEdit`). Each row is a plain-English inclusion or
 * exclusion QUESTION plus a category, kind, and a required toggle; the advanced
 * fields (polarity, notes) hide behind a per-row expander so the common case stays
 * uncluttered. Rows can be added, removed and reordered; Save persists the whole
 * set via the passed `onSave` (→ PUT eligibility/criteria, which bumps the version).
 *
 * NO user-facing "AI" — this is "Guided eligibility" / "Criteria-based" screening.
 * Presentational: all data + persistence come through props so it renders under SSR.
 */
import { useState, useEffect, useRef } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import { Button, Toggle } from '../ui/components.jsx';

export const CATEGORY_OPTIONS = [
  'population', 'intervention', 'comparator', 'outcome',
  'study design', 'language', 'date', 'setting', 'publication type',
];

const inputStyle = {
  width: '100%', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6,
  padding: '7px 10px', color: C.txt, fontSize: 12.5, fontFamily: FONT, outline: 'none',
  transition: 'border-color 0.15s',
};
const selectStyle = {
  background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6,
  padding: '6px 8px', color: C.txt, fontSize: 12, fontFamily: FONT, outline: 'none', cursor: 'pointer',
};

let ROW_SEQ = 0;
const withUid = (c) => ({ _uid: `elig-${++ROW_SEQ}`, ...c });
const blankRow = (orderIndex) => withUid({
  question: '', category: 'population', kind: 'include',
  required: true, polarity: 'positive', notes: '', active: true, orderIndex,
});

// Strip the local-only _uid before persisting; keep server-side identity fields.
const forSave = (rows) => rows.map((r, i) => {
  const { _uid, ...rest } = r; // eslint-disable-line no-unused-vars
  return { ...rest, orderIndex: i };
});

/**
 * @param {object} props
 * @param {Array}  props.criteria  server criteria list
 * @param {number} [props.version] criteriaVersion — re-seeds the editor when it changes
 * @param {boolean} props.canEdit
 * @param {(criteria:Array)=>Promise} props.onSave
 * @param {() => Promise} [props.onRun]     run the Criteria Screener over undecided records
 * @param {boolean} [props.running]
 * @param {object}  [props.jobStatus]       { status, processed, total }
 * @param {object}  [props.summary]         { assessed, autoApplied, pendingReview }
 * @param {boolean} [props.canRun]
 */
export default function CriteriaBuilder({
  criteria, version, canEdit, onSave,
  onRun, running, jobStatus, summary, canRun,
}) {
  const [rows, setRows] = useState(() => (criteria || []).map(withUid));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState({}); // _uid → advanced-fields open

  // Re-seed from the server whenever a fresh version lands and we have no unsaved edits.
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version !== lastVersion.current && !dirty) {
      setRows((criteria || []).map(withUid));
      lastVersion.current = version;
    }
  }, [version, criteria, dirty]);

  const patch = (uid, key, val) => {
    setDirty(true); setMsg('');
    setRows(rs => rs.map(r => (r._uid === uid ? { ...r, [key]: val } : r)));
  };
  const addRow = () => { setDirty(true); setMsg(''); setRows(rs => [...rs, blankRow(rs.length)]); };
  const removeRow = (uid) => { setDirty(true); setMsg(''); setRows(rs => rs.filter(r => r._uid !== uid)); };
  const move = (uid, dir) => {
    setDirty(true); setMsg('');
    setRows(rs => {
      const i = rs.findIndex(r => r._uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  async function save() {
    setSaving(true); setErr(''); setMsg('');
    try {
      await onSave(forSave(rows));
      setDirty(false);
      setMsg('Saved');
      setTimeout(() => setMsg(''), 2200);
    } catch (e) {
      setErr(e.message || 'Could not save criteria');
    } finally {
      setSaving(false);
    }
  }

  const includeCount = rows.filter(r => r.kind !== 'exclude').length;
  const excludeCount = rows.filter(r => r.kind === 'exclude').length;
  const runBusy = !!running || jobStatus?.status === 'running' || jobStatus?.status === 'queued';

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Run bar — evaluate undecided records against the current criteria. */}
      {onRun && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Button
            variant="subtle"
            onClick={() => onRun()}
            disabled={runBusy || !canRun || rows.length === 0}
            title={rows.length === 0 ? 'Add eligibility criteria first' : 'Assess undecided records against these criteria'}
            style={{ fontSize: 12 }}
          >
            {runBusy
              ? (jobStatus?.total > 0 ? `Screening… ${jobStatus.processed || 0}/${jobStatus.total}` : 'Screening…')
              : 'Run Criteria Screener'}
          </Button>
          {summary && (
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
              {summary.assessed || 0} assessed
              {summary.pendingReview ? ` · ${summary.pendingReview} to review` : ''}
              {summary.autoApplied ? ` · ${summary.autoApplied} auto-applied` : ''}
            </span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{
          border: `1px dashed ${C.brd}`, borderRadius: 9, padding: '18px 16px',
          fontSize: 12.5, color: C.txt2, lineHeight: 1.6, textAlign: 'center',
        }}>
          No eligibility criteria yet — add inclusion/exclusion questions to screen studies before you have enough labels.
          {canEdit && (
            <div style={{ marginTop: 12 }}>
              <Button variant="subtle" onClick={addRow} style={{ fontSize: 12 }}>+ Add criterion</Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.grn, letterSpacing: '0.08em' }}>{includeCount} INCLUDE</span>
            <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.red, letterSpacing: '0.08em' }}>{excludeCount} EXCLUDE</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((r, i) => {
              const accent = r.kind === 'exclude' ? C.red : C.grn;
              const open = !!expanded[r._uid];
              return (
                <div key={r._uid} style={{
                  border: `1px solid ${C.brd}`, borderLeft: `3px solid ${accent}`,
                  borderRadius: 8, padding: '10px 11px', background: C.card,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                    <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, width: 18, flexShrink: 0 }}>{i + 1}</span>
                    <select value={r.kind} disabled={!canEdit} onChange={e => patch(r._uid, 'kind', e.target.value)} style={{ ...selectStyle, flex: '0 0 auto' }}>
                      <option value="include">Include</option>
                      <option value="exclude">Exclude</option>
                    </select>
                    <select value={r.category || 'population'} disabled={!canEdit} onChange={e => patch(r._uid, 'category', e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 0 }}>
                      {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {canEdit && (
                      <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
                        <IconBtn label="Move up" disabled={i === 0} onClick={() => move(r._uid, -1)}>↑</IconBtn>
                        <IconBtn label="Move down" disabled={i === rows.length - 1} onClick={() => move(r._uid, 1)}>↓</IconBtn>
                        <IconBtn label="Remove criterion" onClick={() => removeRow(r._uid)}>×</IconBtn>
                      </span>
                    )}
                  </div>

                  <input
                    className="sift-in"
                    value={r.question || ''}
                    disabled={!canEdit}
                    onChange={e => patch(r._uid, 'question', e.target.value)}
                    placeholder={r.kind === 'exclude' ? 'Exclusion question (e.g. “Is this an animal study?”)' : 'Inclusion question (e.g. “Are adults ≥18 the study population?”)'}
                    style={inputStyle}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                    <Toggle checked={!!r.required} disabled={!canEdit} onChange={v => patch(r._uid, 'required', v)} label="Required" />
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={() => setExpanded(x => ({ ...x, [r._uid]: !x[r._uid] }))}
                      style={{ background: 'none', border: 'none', color: C.acc, fontSize: 11.5, fontFamily: FONT, cursor: 'pointer', padding: 0 }}
                    >{open ? '▾ Fewer options' : '▸ More options'}</button>
                  </div>

                  {open && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt2 }}>
                        <span style={{ width: 62, flexShrink: 0 }}>Polarity</span>
                        <select value={r.polarity || 'positive'} disabled={!canEdit} onChange={e => patch(r._uid, 'polarity', e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                          <option value="positive">Standard — a “Yes” means the condition is present</option>
                          <option value="negative">Inverted — the question is phrased as a negative</option>
                        </select>
                      </label>
                      <div>
                        <span style={{ display: 'block', fontSize: 12, color: C.txt2, marginBottom: 4 }}>Notes</span>
                        <textarea
                          className="sift-in"
                          value={r.notes || ''}
                          disabled={!canEdit}
                          onChange={e => patch(r._uid, 'notes', e.target.value)}
                          placeholder="Optional guidance for reviewers…"
                          rows={2}
                          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <Button variant="subtle" onClick={addRow} style={{ fontSize: 12 }}>+ Add criterion</Button>
              <span style={{ flex: 1 }} />
              {msg && <span style={{ fontSize: 11.5, fontFamily: MONO, color: C.grn }}>{msg}</span>}
              {err && <span style={{ fontSize: 11.5, fontFamily: MONO, color: C.red }}>{err}</span>}
              <Button onClick={save} disabled={saving || !dirty} style={{ fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save criteria'}
              </Button>
            </div>
          )}
        </>
      )}

      <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, marginTop: 12 }}>
        Suggestions are assistive — a reviewer always records the final include/exclude decision.
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2, borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: 13, lineHeight: 1,
      }}
    >{children}</button>
  );
}
