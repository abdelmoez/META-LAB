/**
 * ProtocolModulePanel — the server-backed Protocol/PICO editor (prompt38).
 *
 * Mounted by the monolith for the "pico" tab ONLY when the
 * serverBackedWorkflowState feature flag is ON (otherwise the legacy in-blob
 * PICOTab renders, unchanged). Demonstrates the full server-backed flow:
 *   server load · per-field debounced autosave · revision · 409 conflict UI ·
 *   permission (read-only) · legacy blob→module migration (via useProtocolState).
 *
 * Phase-1 scope: the core protocol fields. AI helpers + per-field presence locks
 * remain in the legacy editor and are sequenced for a later migration wave.
 */
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { useFieldLock } from '../../frontend/screening/hooks/usePresence.js';
import { TIMEFRAME_OPTIONS, STUDY_DESIGNS } from './constants.js';
import { useProtocolState } from './useProtocolState.js';

const inp = {
  width: '100%', boxSizing: 'border-box', background: C.card, color: C.txt,
  border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px',
  fontSize: 13, fontFamily: FONT, outline: 'none',
};
const lbl = { fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6, display: 'block' };

function StatusPill({ status }) {
  const map = {
    loading: { t: 'Loading…', c: C.muted },
    idle:    { t: 'Server-backed', c: C.muted },
    saving:  { t: 'Saving…', c: C.acc },
    saved:   { t: 'Saved', c: C.grn },
    conflict:{ t: 'Conflict', c: C.red },
    error:   { t: 'Save failed', c: C.red },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: FONT, color: s.c }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.c }} />
      {s.t}
    </span>
  );
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 14 }}><label style={lbl}>{label}</label>{children}</div>;
}

export default function ProtocolModulePanel({ projectId, project, readOnly = false, onMirror, lockCtx }) {
  const ro = readOnly || !!(project && (project._readOnly || (project._permissions && project._permissions.readOnly)));
  const { value, status, conflict, update, flush, dismissConflict } = useProtocolState(projectId, { project, enabled: !!projectId });

  // Per-field presence locks for P/I/C/O (prompt38 — ported from the legacy
  // editor). Same lock field keys ("pico.P"…) so the new + legacy editors lock
  // consistently against the linked workspace. Fail-open: no workspace / lock
  // error → editing is never blocked. Revision conflict is the backstop.
  const lc = lockCtx || {};
  const lockP = useFieldLock({ pid: lc.pid, field: 'pico.P', myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const lockI = useFieldLock({ pid: lc.pid, field: 'pico.I', myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const lockC = useFieldLock({ pid: lc.pid, field: 'pico.C', myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const lockO = useFieldLock({ pid: lc.pid, field: 'pico.O', myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const fieldLocks = { P: lockP, I: lockI, C: lockC, O: lockO };

  // The module state is the conflict-authority; `onMirror` keeps the legacy
  // project.pico blob in sync so other (not-yet-migrated) tabs read fresh data.
  const set = (k) => (e) => {
    const patch = { [k]: e.target.value };
    update(patch);
    if (onMirror) onMirror(patch);
  };
  const dis = ro || status === 'loading';

  return (
    <div style={{ fontFamily: FONT, color: C.txt }} onBlur={() => flush()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Protocol &amp; PICO</h2>
          <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
            Per-module server state — saves only this section, with conflict detection.
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      {conflict && (
        <div style={{ padding: '12px 14px', marginBottom: 16, borderRadius: 10, background: alpha(C.red, 0.08), border: `1px solid ${alpha(C.red, 0.4)}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>
            This section was updated{conflict.updatedBy && conflict.updatedBy.name ? ` by ${conflict.updatedBy.name}` : ''} while you were editing.
          </div>
          <div style={{ fontSize: 12, color: C.txt2, margin: '4px 0 10px' }}>
            The latest saved version is now shown (revision {conflict.currentRevision}). Re-apply your change if needed.
          </div>
          <button onClick={dismissConflict} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 12, fontFamily: FONT, cursor: 'pointer' }}>
            Got it
          </button>
        </div>
      )}

      <Field label="Review question">
        <textarea value={value.question} onChange={set('question')} disabled={dis} rows={2}
          placeholder="e.g. In adults with hypertension, does intervention X vs Y reduce stroke?" style={{ ...inp, resize: 'vertical' }} />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 4 }}>
        {[['P', 'Population / Problem'], ['I', 'Intervention / Exposure'], ['C', 'Comparator / Control'], ['O', 'Outcome(s)']].map(([k, label]) => {
          const fl = fieldLocks[k] || {};
          const lockedBy = fl.lockedByOther;
          return (
            <Field key={k} label={label}>
              <textarea value={value[k]} onChange={set(k)} disabled={dis || !!lockedBy} rows={3}
                onFocus={() => fl.acquire && fl.acquire()}
                onBlur={() => { if (fl.release) fl.release(); }}
                style={{ ...inp, resize: 'vertical', opacity: lockedBy ? 0.6 : 1, cursor: lockedBy ? 'not-allowed' : 'text' }} />
              {lockedBy && (
                <div style={{ fontSize: 10.5, color: C.yel, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>🔒</span>{lockedBy.name} is editing
                </div>
              )}
            </Field>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Field label="Study design">
          <select value={value.studyDesign || 'RCT'} onChange={set('studyDesign')} disabled={dis} style={inp}>
            {STUDY_DESIGNS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Time frame">
          <select value={value.timeframeMode || ''} onChange={set('timeframeMode')} disabled={dis} style={inp}>
            <option value="">— select —</option>
            {TIMEFRAME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {value.timeframeMode === 'custom' && (
          <Field label="Custom years (start / end)">
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" min="1900" max="2100" value={value.tfStart} onChange={set('tfStart')} disabled={dis} placeholder="Start" style={inp} />
              <input type="number" min="1900" max="2100" value={value.tfEnd} onChange={set('tfEnd')} disabled={dis} placeholder="End" style={inp} />
            </div>
          </Field>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <Field label="Inclusion criteria">
          <textarea value={value.incl} onChange={set('incl')} disabled={dis} rows={4} placeholder={'• criterion\n• criterion'} style={{ ...inp, resize: 'vertical' }} />
        </Field>
        <Field label="Exclusion criteria">
          <textarea value={value.excl} onChange={set('excl')} disabled={dis} rows={4} placeholder={'• criterion\n• criterion'} style={{ ...inp, resize: 'vertical' }} />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Field label="PROSPERO ID"><input value={value.prosperoId} onChange={set('prosperoId')} disabled={dis} placeholder="CRD42024…" style={inp} /></Field>
        <Field label="Keywords"><input value={value.keywords} onChange={set('keywords')} disabled={dis} placeholder="comma, separated" style={inp} /></Field>
      </div>

      <Field label="Notes">
        <textarea value={value.notes} onChange={set('notes')} disabled={dis} rows={2} style={{ ...inp, resize: 'vertical' }} />
      </Field>

      {ro && <p style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>You have read-only access to this project.</p>}
    </div>
  );
}
