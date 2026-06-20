/**
 * ProtocolModulePanel — the server-backed Protocol/PICO editor (prompt38), brought
 * to full VISUAL PARITY with the legacy in-monolith PICOTab (prompt40 Task 1).
 *
 * Mounted by the monolith for the "pico" tab ONLY when the serverBackedWorkflowState
 * feature flag is ON (otherwise the legacy in-blob PICOTab renders, unchanged). It
 * keeps the server-backed engineering improvements — per-module state, revision /
 * 409 conflict detection, per-field debounced autosave, presence locks, legacy
 * blob→module migration — while restoring the polished UI: SectionHeader, the
 * required-PICO progress card, numbered sections, colour-coded P/I/C/O cards with
 * required asterisks, the interactive CriteriaList, time-frame validation, the
 * monospace keywords field and the InfoBox footer.
 *
 * Deliberate difference from legacy (documented): a server-backed Saved/Saving/
 * Conflict status pill (the legacy editor had none — it is an improvement, not a
 * regression). The AI helper buttons are intentionally absent from BOTH editors
 * (AI_FEATURES_ENABLED is false in the monolith, so AIButton renders nothing).
 */
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { useFieldEditing } from '../../frontend/screening/hooks/usePresence.js';
import { TIMEFRAME_OPTIONS, STUDY_DESIGNS } from './constants.js';
import { useProtocolState } from './useProtocolState.js';
import { SectionHeader, InfoBox, HelpTip, CriteriaList, RequiredPicoCard, PURPLE, inp, lbl } from './picoUi.jsx';

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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: FONT, color: s.c, flexShrink: 0, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.c }} />
      {s.t}
    </span>
  );
}

export default function ProtocolModulePanel({ projectId, project, readOnly = false, onMirror, lockCtx }) {
  const ro = readOnly || !!(project && (project._readOnly || (project._permissions && project._permissions.readOnly)));
  const { value, status, conflict, update, flush, dismissConflict } = useProtocolState(projectId, { project, enabled: !!projectId });

  // prompt44 item 5 — chat-style live field editing for the server-backed state:
  // claim a field on focus (teammates instantly see "X is editing"), hold the lock
  // WHILE typing, and auto-release on blur / 5s idle / unmount (server TTL covers a
  // hard disconnect). Same "pico.X" lock keys as the legacy editor. Fail-open: no
  // workspace / lock error never blocks editing. Fixed hook count → stable order.
  const lc = lockCtx || {};
  const lockEnabled = !!lc.pid;
  const edQuestion = useFieldEditing({ pid: lc.pid, field: 'pico.question', myUserId: lc.myUserId, locks: lc.locks, enabled: lockEnabled });
  const edP = useFieldEditing({ pid: lc.pid, field: 'pico.P', myUserId: lc.myUserId, locks: lc.locks, enabled: lockEnabled });
  const edI = useFieldEditing({ pid: lc.pid, field: 'pico.I', myUserId: lc.myUserId, locks: lc.locks, enabled: lockEnabled });
  const edC = useFieldEditing({ pid: lc.pid, field: 'pico.C', myUserId: lc.myUserId, locks: lc.locks, enabled: lockEnabled });
  const edO = useFieldEditing({ pid: lc.pid, field: 'pico.O', myUserId: lc.myUserId, locks: lc.locks, enabled: lockEnabled });
  const edKeywords = useFieldEditing({ pid: lc.pid, field: 'pico.keywords', myUserId: lc.myUserId, locks: lc.locks, enabled: lockEnabled });
  const fieldEd = { P: edP, I: edI, C: edC, O: edO };

  // The module state is the conflict-authority; `onMirror` keeps the legacy
  // project.pico blob in sync so other (not-yet-migrated) tabs read fresh data.
  const setVal = (k, v) => { const patch = { [k]: v }; update(patch); if (onMirror) onMirror(patch); };
  // A change handler that also keeps the field's edit lock alive while typing. If the
  // field is already held by someone else (snapshot just landed), drop the keystroke
  // rather than write into their field (the textarea is also disabled, but this closes
  // the brief propagation window).
  const setLive = (k, ed) => (e) => { if (ed && ed.lockedByOther) return; setVal(k, e.target.value); if (ed) ed.onActivity(); };
  const set = (k) => (e) => setVal(k, e.target.value);
  const dis = ro || status === 'loading';
  // "<name> is editing…" indicator for a locked-by-other field (render helper, not a
  // nested component, so it never remounts).
  const editingBadge = (ed) => (ed && ed.lockedByOther ? (
    <div style={{ fontSize: 10.5, color: C.yel, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.yel, display: 'inline-block' }} />
      {ed.lockedByOther.name} is editing…
    </div>
  ) : null);

  const reqFilled = ['P', 'I', 'C', 'O'].filter((k) => !!(value[k] && String(value[k]).trim())).length;

  const PICO = [
    { k: 'P', label: 'Population / Problem', ph: 'e.g. Adults ≥18 with Type 2 diabetes, diagnosed ≥1 year', color: C.acc },
    { k: 'I', label: 'Intervention / Exposure', ph: 'e.g. SGLT2 inhibitor added to metformin', color: C.grn },
    { k: 'C', label: 'Comparator / Control', ph: 'e.g. Metformin alone, placebo, or standard care', color: C.yel },
    { k: 'O', label: 'Outcome(s)', ph: 'e.g. MACE; HbA1c reduction (%); all-cause mortality', color: PURPLE },
  ];

  return (
    <div style={{ fontFamily: FONT, color: C.txt }} onBlur={() => flush()}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <SectionHeader icon="target" title="Research Question & PICO"
            desc="Start here. Refine your question, structure it as PICO, and define who's in and who's out. Everything downstream builds on this." />
        </div>
        <StatusPill status={status} />
      </div>

      {conflict && (
        <div style={{ padding: '12px 14px', marginBottom: 16, borderRadius: 10, background: alpha(C.red, '14'), border: `1px solid ${alpha(C.red, '66')}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>
            This section was updated{conflict.updatedBy && conflict.updatedBy.name ? ` by ${conflict.updatedBy.name}` : ''} while you were editing.
          </div>
          <div style={{ fontSize: 12, color: C.txt2, margin: '4px 0 10px' }}>
            The latest saved version is now shown (revision {conflict.currentRevision}). Re-apply your change if needed.
          </div>
          <button onClick={dismissConflict} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 12, fontFamily: FONT, cursor: 'pointer' }}>Got it</button>
        </div>
      )}

      <RequiredPicoCard filled={reqFilled} total={4} />

      {/* ① Research question */}
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16, marginBottom: 14, borderLeft: `3px solid ${C.acc}` }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ ...lbl, marginBottom: 0 }}>① Research Question</label>
          <HelpTip text="A good SR question is focused and answerable. Example: 'In adults with type 2 diabetes, does metformin compared with placebo reduce HbA1c?'" />
        </div>
        <textarea value={value.question || ''} onChange={setLive('question', edQuestion)}
          disabled={dis || !!edQuestion.lockedByOther} onFocus={edQuestion.onFocus} onBlur={edQuestion.onBlur}
          placeholder="e.g. In adults with type 2 diabetes, does adding an SGLT2 inhibitor to metformin, compared with metformin alone, reduce cardiovascular events?"
          style={{ ...inp, height: 60, resize: 'vertical', fontSize: 13, lineHeight: 1.55, opacity: edQuestion.lockedByOther ? 0.6 : 1, cursor: edQuestion.lockedByOther ? 'not-allowed' : 'text' }} />
        {editingBadge(edQuestion)}
      </div>

      {/* ② PICO components */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ ...lbl, marginBottom: 0 }}>② PICO Components</span>
        <HelpTip text="Break your question into its parts. Population, Intervention/Exposure, Comparator/Control, and Outcome are all required." />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 14 }}>
        {PICO.map(({ k, label, ph, color }) => {
          const ed = fieldEd[k];
          const lockedBy = ed.lockedByOther;
          return (
            <div key={k} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 14, borderLeft: `3px solid ${color}` }}>
              <label style={{ ...lbl, color }}>{k} — {label} <span style={{ color: C.red }}>*</span></label>
              <textarea value={value[k] || ''} onChange={setLive(k, ed)} placeholder={ph}
                disabled={dis || !!lockedBy}
                onFocus={ed.onFocus} onBlur={ed.onBlur}
                style={{ ...inp, height: 68, resize: 'vertical', fontSize: 12, lineHeight: 1.5, opacity: lockedBy ? 0.6 : 1, cursor: lockedBy ? 'not-allowed' : 'text' }} />
              {editingBadge(ed)}
            </div>
          );
        })}
      </div>

      {/* Study design / time frame / PROSPERO */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={lbl}>Primary Study Design <HelpTip text="RCTs give the strongest evidence for interventions. Use cohort/case-control for exposures or harms, cross-sectional for prevalence." /></label>
          <select value={value.studyDesign || 'RCT'} onChange={set('studyDesign')} disabled={dis} style={inp}>
            {STUDY_DESIGNS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Time Frame <span style={{ color: C.red }}>*</span></label>
          <select value={value.timeframeMode || ''} onChange={set('timeframeMode')} disabled={dis} style={inp}>
            <option value="">Select…</option>
            {TIMEFRAME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {value.timeframeMode === 'custom' && (() => {
            const s = parseInt(value.tfStart, 10);
            const e = value.tfEnd ? parseInt(value.tfEnd, 10) : null;
            const bad = (value.tfStart && !Number.isFinite(s)) || (Number.isFinite(e) && Number.isFinite(s) && e < s);
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input type="number" min="1900" max="2100" value={value.tfStart || ''} onChange={set('tfStart')} disabled={dis} placeholder="Start year" style={inp} />
                  <input type="number" min="1900" max="2100" value={value.tfEnd || ''} onChange={set('tfEnd')} disabled={dis} placeholder="End year (optional)" style={inp} />
                </div>
                {bad && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>Enter a valid start year; end year must be ≥ start.</div>}
              </div>
            );
          })()}
        </div>
        <div>
          <label style={lbl}>PROSPERO ID <HelpTip text="Register your protocol on PROSPERO before screening. Paste your CRD number here once registered." /></label>
          <input value={value.prosperoId || ''} onChange={set('prosperoId')} disabled={dis} placeholder="CRD42024…" style={inp} />
        </div>
      </div>

      {/* ③ Eligibility criteria */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ ...lbl, marginBottom: 0 }}>③ Eligibility Criteria</span>
        <HelpTip text="Explicit inclusion/exclusion criteria are a PRISMA requirement and prevent arbitrary screening decisions." />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div style={{ background: C.card, border: `1px solid ${alpha(C.grn, '33')}`, borderRadius: 8, padding: 14, borderLeft: `3px solid ${C.grn}` }}>
          <label style={{ ...lbl, color: C.grn }}>✓ Inclusion Criteria</label>
          <CriteriaList value={value.incl} onChange={(v) => setVal('incl', v)} accent={C.grn} disabled={dis}
            placeholders={['Adults ≥18 with confirmed T2DM', 'RCTs with ≥12 weeks follow-up', 'Reports HbA1c or MACE']} />
        </div>
        <div style={{ background: C.card, border: `1px solid ${alpha(C.red, '33')}`, borderRadius: 8, padding: 14, borderLeft: `3px solid ${C.red}` }}>
          <label style={{ ...lbl, color: C.red }}>✗ Exclusion Criteria</label>
          <CriteriaList value={value.excl} onChange={(v) => setVal('excl', v)} accent={C.red} disabled={dis}
            placeholders={['Type 1 diabetes or gestational diabetes', 'Animal or in-vitro studies', 'Conference abstracts without full data']} />
        </div>
      </div>

      {/* Keywords (monospace) + notes */}
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Key Terms &amp; Synonyms <HelpTip text="List the main concepts and their synonyms — they become the building blocks of your database-specific queries." /></label>
        <textarea value={value.keywords || ''} onChange={setLive('keywords', edKeywords)}
          disabled={dis || !!edKeywords.lockedByOther} onFocus={edKeywords.onFocus} onBlur={edKeywords.onBlur}
          placeholder="type 2 diabetes, T2DM, NIDDM | SGLT2 inhibitor, dapagliflozin, empagliflozin | cardiovascular, MACE"
          style={{ ...inp, height: 56, resize: 'vertical', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, opacity: edKeywords.lockedByOther ? 0.6 : 1, cursor: edKeywords.lockedByOther ? 'not-allowed' : 'text' }} />
        {editingBadge(edKeywords)}
      </div>
      {/* prompt44 item 1 — "Additional Protocol Notes" removed from the editor UI to
          declutter (the `notes` data field is KEPT in the module state for back-compat). */}

      <InfoBox>💡 <strong style={{ color: C.txt }}>Next step:</strong> Once your PICO and eligibility are set, register your protocol on <a href="https://www.crd.york.ac.uk/prospero/" target="_blank" rel="noreferrer" style={{ color: C.acc }}>PROSPERO</a>, then move to the Search Builder. Required fields are marked <span style={{ color: C.red }}>*</span>.</InfoBox>

      {ro && <p style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>You have read-only access to this project.</p>}
    </div>
  );
}
