/**
 * PlanProtocolPanel — the Plan & Protocol engine's "Protocol (PROSPERO)" editor
 * (prompt46 #1). Two sections in one spacious, guided workspace:
 *
 *   1) Structured PROSPERO fields (grouped by section), char-limited, autosaved.
 *   2) A generated protocol DRAFT — a deterministic draft built from the PICO +
 *      structured fields (buildProtocolDraft), editable, with a "don't overwrite
 *      my edits" guard, a PICO-drift banner, and Copy / Download.
 *
 * The PlanProtocolDispatcher mounts this for the "prospero" tab ALWAYS (the new
 * UI ships regardless of feature flags), choosing persistence:
 *   - serverBackedWorkflowState ON  → the server-backed `planProtocol` module
 *     (per-module state + revision/409 conflict detection + legacy migration);
 *   - flag OFF → the legacy `project.prospero` blob via whole-project autosave.
 * Either way the editor + draft generator are identical. The new module is fully
 * separate from PICO (project.pico) — the screening-keyword chain is untouched.
 */
import { useState, useEffect } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/theme/tokens.js';
import { SectionHeader, InfoBox, HelpTip, inp, lbl } from '../protocol/picoUi.jsx';
import { buildProtocolDraft, protocolDraftPicoKey } from '../../research-engine/docs/protocolDraft.js';
import { getRobTool, normalizeRobTool } from '../../research-engine/rob/tools.js';
import { workflowStateFlagEnabled } from '../../services/workflowState/api.js';
import { flushStorage } from '../../frontend/storage/serverStorage.js';
import { PROSP_FIELDS } from './constants.js';
import { PLAN_PROTOCOL_FIELD_IDS, PLAN_PROTOCOL_DEFAULTS, pickPlanProtocol } from './planProtocolState.js';
import { usePlanProtocolState } from './usePlanProtocolState.js';

// The structured PROSPERO field ids (vs draft/meta keys), for the legacy-blob mirror.
const FIELD_SET = new Set(PLAN_PROTOCOL_FIELD_IDS);

function StatusPill({ status }) {
  const map = {
    loading: { t: 'Loading…', c: C.muted },
    idle:    { t: 'Server-backed', c: C.muted },
    saving:  { t: 'Saving…', c: C.acc },
    saved:   { t: 'Saved', c: C.grn },
    conflict:{ t: 'Conflict', c: C.red },
    error:   { t: 'Save failed', c: C.red },
    local:   { t: 'Autosaved', c: C.muted },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: FONT, color: s.c, flexShrink: 0, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.c }} />
      {s.t}
    </span>
  );
}

const btn = (variant = 'primary') => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
  fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap',
  border: `1px solid ${variant === 'primary' ? C.acc : C.brd2}`,
  background: variant === 'primary' ? C.acc : 'transparent',
  color: variant === 'primary' ? C.accText : C.txt2,
});

function downloadMarkdown(filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch { /* download is best-effort */ }
}

const safeFileName = (s) => (String(s || 'protocol').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'protocol').slice(0, 60);

/** Presentational editor — persistence is injected via value/onUpdate. */
export function PlanProtocolPanel({ project, value, status, conflict, onUpdate, flush, dismissConflict, readOnly = false }) {
  const [copied, setCopied] = useState(false);
  const dis = readOnly || status === 'loading';
  const pico = (project && project.pico) || {};

  const set = (id) => (e) => onUpdate({ [id]: e.target.value });

  // Group the structured fields by their `sec` for clean section dividers.
  const sections = [];
  for (const f of PROSP_FIELDS) {
    let g = sections.find((s) => s.sec === f.sec);
    if (!g) { g = { sec: f.sec, fields: [] }; sections.push(g); }
    g.fields.push(f);
  }

  // ── Draft generation ────────────────────────────────────────────────────────
  const fieldsObj = Object.fromEntries(PLAN_PROTOCOL_FIELD_IDS.map((id) => [id, value[id] || '']));
  const dbs = (project && project.search && project.search.dbs) || {};
  const databases = Object.keys(dbs).filter((k) => dbs[k]);
  const robTool = getRobTool(normalizeRobTool(project && project.robTool))?.description ? `the ${getRobTool(normalizeRobTool(project && project.robTool)).label} tool` : null;
  const picoKey = protocolDraftPicoKey(pico);
  const hasDraft = !!(value.draft && value.draft.trim());
  const drifted = hasDraft && value.draftPicoKey && value.draftPicoKey !== picoKey;

  const handleGenerate = () => {
    if (dis) return;
    if (value.draftEditedManually && hasDraft) {
      const ok = window.confirm('You have edited this draft. Regenerate from your PICO + protocol fields and discard your edits?');
      if (!ok) return;
    }
    const draft = buildProtocolDraft(pico, fieldsObj, { databases, robTool });
    onUpdate({ draft, generatedAt: new Date().toISOString(), draftPicoKey: picoKey, draftEditedManually: false });
  };
  const handleDraftChange = (e) => {
    onUpdate({ draft: e.target.value, draftEditedManually: true, draftEditedAt: new Date().toISOString() });
  };
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(value.draft || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div style={{ fontFamily: FONT, color: C.txt }} onBlur={() => flush && flush()}>
      {/* Header + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <SectionHeader icon="clipboard" title="Protocol (PROSPERO)"
            desc="Draft your registration-ready protocol. Fill the structured fields, then generate an editable protocol draft from your PICO and these fields." />
        </div>
        <StatusPill status={status} />
      </div>

      {conflict && (
        <div style={{ padding: '12px 14px', marginBottom: 16, borderRadius: 10, background: alpha(C.red, '14'), border: `1px solid ${alpha(C.red, '66')}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>
            This protocol was updated{conflict.updatedBy && conflict.updatedBy.name ? ` by ${conflict.updatedBy.name}` : ''} while you were editing.
          </div>
          <div style={{ fontSize: 12, color: C.txt2, margin: '4px 0 10px' }}>
            The latest saved version is now shown (revision {conflict.currentRevision}). Re-apply your change if needed.
          </div>
          <button onClick={dismissConflict} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 12, fontFamily: FONT, cursor: 'pointer' }}>Got it</button>
        </div>
      )}

      {/* Section 1 — structured fields */}
      {sections.map((g) => (
        <div key={g.sec} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, margin: '4px 0 10px', borderBottom: `1px solid ${C.brd}`, paddingBottom: 6 }}>
            {g.sec}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            {g.fields.map((f) => {
              const v = value[f.id] || '';
              const over = f.maxLen && v.length > f.maxLen * 0.92;
              return (
                <div key={f.id} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <label style={{ ...lbl, marginBottom: 0 }}>{f.label}{f.hint && <HelpTip text={f.hint} />}</label>
                    {f.maxLen ? <span style={{ fontSize: 10, fontFamily: MONO, color: over ? C.yel : C.dim, flexShrink: 0 }}>{v.length}/{f.maxLen}</span> : null}
                  </div>
                  <textarea value={v} onChange={set(f.id)} disabled={dis} maxLength={f.maxLen || undefined}
                    rows={f.rows || 3}
                    placeholder={f.hint || ''}
                    style={{ ...inp, minHeight: (f.rows || 3) * 20 + 16, resize: 'vertical', fontSize: 12.5, lineHeight: 1.5 }} />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Section 2 — protocol draft */}
      <div style={{ marginTop: 8, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 16, borderLeft: `3px solid ${C.acc}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ minWidth: 220, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>Protocol draft</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              A deterministic starting draft built from your PICO and the fields above. Edit freely — your edits are preserved until you regenerate.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hasDraft && <button onClick={handleCopy} disabled={dis} style={btn('ghost')}>{copied ? 'Copied' : 'Copy'}</button>}
            {hasDraft && <button onClick={() => downloadMarkdown(`${safeFileName(value.title || (pico && pico.I))}-protocol.md`, value.draft || '')} disabled={dis} style={btn('ghost')}>Download .md</button>}
            <button onClick={handleGenerate} disabled={dis} style={btn('primary')}>{hasDraft ? 'Regenerate draft' : 'Generate draft'}</button>
          </div>
        </div>

        {drifted && (
          <div style={{ padding: '9px 12px', marginBottom: 10, borderRadius: 8, background: alpha(C.yel, '16'), border: `1px solid ${alpha(C.yel, '55')}`, fontSize: 12, color: C.txt2 }}>
            Your PICO has changed since this draft was generated. <button onClick={handleGenerate} disabled={dis} style={{ background: 'none', border: 'none', color: C.acc, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, fontSize: 12, padding: 0 }}>Regenerate</button> to refresh it.
          </div>
        )}
        {value.draftEditedManually && hasDraft && (
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>✎ You have edited this draft. Regenerating will replace it (with confirmation).</div>
        )}

        {hasDraft ? (
          <textarea value={value.draft || ''} onChange={handleDraftChange} disabled={dis}
            style={{ ...inp, minHeight: 360, resize: 'vertical', fontFamily: MONO, fontSize: 12, lineHeight: 1.6 }} />
        ) : (
          <div style={{ padding: '28px 20px', textAlign: 'center', border: `1px dashed ${C.brd2}`, borderRadius: 8, color: C.muted, fontSize: 13 }}>
            No draft yet. Click <strong style={{ color: C.txt }}>Generate draft</strong> to create an editable PROSPERO-style protocol from your PICO and the fields above.
          </div>
        )}
      </div>

      <InfoBox>💡 <strong style={{ color: C.txt }}>Tip:</strong> Register the finished protocol on <a href="https://www.crd.york.ac.uk/prospero/" target="_blank" rel="noreferrer" style={{ color: C.acc }}>PROSPERO</a> and paste the CRD number in the PICO &amp; Question tab. The draft is a starting point — review every section before registration.</InfoBox>

      {readOnly && <p style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>You have read-only access to this project.</p>}
    </div>
  );
}

/**
 * Dispatcher — mounts PlanProtocolPanel for the "prospero" tab, wiring persistence
 * to the server-backed `planProtocol` module when serverBackedWorkflowState is ON,
 * else to the legacy project.prospero blob (whole-project autosave). The new UI +
 * draft generator ship in BOTH cases.
 */
export default function PlanProtocolDispatcher({ project, activeId, upd }) {
  const [flag, setFlag] = useState(null); // null = checking
  useEffect(() => {
    let dead = false;
    (async () => {
      try { await flushStorage(); } catch { /* best-effort */ }
      let v = false; try { v = await workflowStateFlagEnabled(); } catch { v = false; }
      if (!dead) setFlag(!!v);
    })();
    return () => { dead = true; };
  }, []);

  const serverMode = flag === true;
  const st = usePlanProtocolState(activeId, { project, enabled: serverMode });

  if (flag === null) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading Plan &amp; Protocol…</div>;
  }

  const readOnly = !!(project && (project._readOnly || (project._permissions && project._permissions.readOnly)));

  // prompt46 #1 (review fix) — mirror the structured PROSPERO fields into the legacy
  // project.prospero.fields blob so workflow step-status stays correct in BOTH modes:
  // projectHelpers.stepStatus computes the "prospero" step from prospero.fields, and
  // the new panel otherwise writes to the module (server) or flat keys (blob). Draft +
  // draft-meta keys are NOT mirrored (they aren't part of step completion). Same
  // authority-plus-mirror pattern PICODispatcher uses for project.pico.
  const mirrorFields = (patch) => {
    const fk = {}; let has = false;
    for (const k of Object.keys(patch || {})) if (FIELD_SET.has(k)) { fk[k] = patch[k]; has = true; }
    if (!has) return;
    const prev = (project && project.prospero) || {};
    upd('prospero', { ...prev, fields: { ...(prev.fields || {}), ...fk } });
  };

  if (serverMode) {
    // Module is the conflict-authority; mirror structured fields to the blob for step-status.
    const onUpdate = (patch) => { st.update(patch); mirrorFields(patch); };
    return (
      <PlanProtocolPanel project={project} value={st.value} status={st.status} conflict={st.conflict}
        onUpdate={onUpdate} flush={st.flush} dismissConflict={st.dismissConflict} readOnly={readOnly} />
    );
  }

  // Blob-backed fallback (flag OFF): structured fields live under prospero.fields
  // (legacy-compatible → stepStatus + the old PROSPEROTab shape stay valid); draft +
  // draft-meta live at the top level of prospero. One whole-project autosave.
  const value = { ...PLAN_PROTOCOL_DEFAULTS, ...pickPlanProtocol(project) };
  const onUpdate = (patch) => {
    const prev = (project && project.prospero) || {};
    const next = { ...prev };
    const fk = { ...(prev.fields || {}) }; let hasF = false;
    for (const [k, v] of Object.entries(patch || {})) {
      if (FIELD_SET.has(k)) { fk[k] = v; hasF = true; } else { next[k] = v; }
    }
    if (hasF) next.fields = fk;
    upd('prospero', next);
  };
  return (
    <PlanProtocolPanel project={project} value={value} status="local" conflict={null}
      onUpdate={onUpdate} flush={() => {}} dismissConflict={() => {}} readOnly={readOnly} />
  );
}
