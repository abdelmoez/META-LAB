/**
 * ProjectRobPanel.jsx — the per-project RoB experience, decoupled from any page
 * chrome so it can be rendered BOTH standalone (RobPage at /rob/:projectId) and
 * embedded natively inside the META·LAB project workspace "Risk of Bias" tab
 * (prompt28 Part 2). It always operates on ONE project id passed in by its host —
 * there is no project selector here.
 *
 * It loads the project's studies + assessments, shows the robvis summary plot, the
 * project-specific RoB tool selector (prompt28 Part 4), and opens the keyboard-
 * first RobWorkspace inline. The pure engine stays in research-engine/rob and the
 * data stays behind /api/rob — this component only orchestrates the UI.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { api } from '../api-client/apiClient.js';
import { robApi } from './robApi.js';
import RobWorkspace from './RobWorkspace.jsx';
import RobTrafficLight from './RobTrafficLight.jsx';
import { judgmentStyle } from './judgmentStyle.js';
import { ROB_TOOLS, normalizeRobTool, isRobToolActive } from '../../research-engine/rob/tools.js';

export default function ProjectRobPanel({ projectId, embedded = false, canEdit = true, robTool, onSelectTool }) {
  const [project, setProject] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [openId, setOpenId] = useState(null);          // open assessment in the workspace
  const [creatingFor, setCreatingFor] = useState(null); // study being created-for

  const reload = useCallback(async () => {
    setAccessDenied(false);
    try {
      const [proj, list] = await Promise.all([
        api.projects.get(projectId),
        robApi.listAssessments(projectId),
      ]);
      setProject(proj);
      setAssessments(list.assessments || []);
      setMatrix(list.matrix || null);
      setError('');
    } catch (e) {
      // Owner-scoped API: a non-owner (shared / read-only collaborator) gets 404.
      // Surface that as a clear "managed by the owner" state rather than an error.
      if (e && e.status === 404) { setAccessDenied(true); setError(''); }
      else setError(e.message || 'Failed to load risk-of-bias data');
    }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  // The selected tool is controlled by the host when embedded (persisted to the
  // project); standalone falls back to the project's stored choice or the default.
  const selectedTool = normalizeRobTool(robTool != null ? robTool : project?.robTool);

  async function createFor(study, resultLabel) {
    try {
      const res = await robApi.createAssessment({ projectId, studyId: study.id, resultLabel: resultLabel || '' });
      setCreatingFor(null);
      await reload();
      setOpenId(res.assessment.id);
    } catch (e) { setError(e.message); }
  }
  async function removeAssessment(id) {
    try { await robApi.remove(id); await reload(); } catch (e) { setError(e.message); }
  }

  if (openId) {
    return <RobWorkspace assessmentId={openId} readOnly={!canEdit} onClose={() => { setOpenId(null); reload(); }} onChanged={reload} />;
  }
  if (accessDenied) return <OwnerOnlyNotice />;
  if (error && !project) return <ErrorBox msg={error} onRetry={reload} />;
  if (!project) return <Center>Loading…</Center>;

  const studies = Array.isArray(project.studies) ? project.studies : [];
  const studyIds = new Set(studies.map(s => s.id));
  const byStudy = {};
  for (const a of assessments) { (byStudy[a.studyId] = byStudy[a.studyId] || []).push(a); }
  // Assessments whose study has since been removed from the project (kept safely;
  // shown separately so nothing silently disappears).
  const orphans = assessments.filter(a => !studyIds.has(a.studyId));

  return (
    <div>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}

      <ToolSelector selected={selectedTool} canEdit={canEdit} onSelect={onSelectTool} />

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 2px' }}>{project.name}</h2>
          <p style={{ fontSize: 12.5, color: C.txt2, margin: 0 }}>
            {assessments.length} assessment{assessments.length === 1 ? '' : 's'} · RoB 2 (effect of assignment) · per result
          </p>
        </div>
        {!canEdit && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.muted, fontFamily: MONO }}>
            <Icon name="lock" size={13} /> View only
          </span>
        )}
      </div>

      {assessments.length > 0 && (
        <div style={{ ...card, marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Summary (traffic light)</div>
          <RobTrafficLight matrix={matrix} title={`${project.name} — Risk of bias (RoB 2)`} />
        </div>
      )}

      {studies.length === 0 ? (
        <Center>This project has no studies yet. Add studies in <strong>Data Extraction</strong>, then assess their risk of bias here.</Center>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {studies.map(s => {
            const list = byStudy[s.id] || [];
            const label = `${s.author || ''} ${s.year ? `(${s.year})` : ''}`.trim() || (s.title || s.id);
            return (
              <div key={s.id} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
                    {s.title && <div style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>}
                  </div>
                  {canEdit && (
                    <button onClick={() => setCreatingFor(creatingFor === s.id ? null : s.id)} style={ghost}><Icon name="plus" size={13} /> Assess a result</button>
                  )}
                </div>

                {canEdit && creatingFor === s.id && <CreateForm onCancel={() => setCreatingFor(null)} onCreate={label2 => createFor(s, label2)} />}

                {list.length > 0 ? (
                  <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                    {list.map(a => <AssessmentRow key={a.id} a={a} canEdit={canEdit} onOpen={() => setOpenId(a.id)} onRemove={() => removeAssessment(a.id)} />)}
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No risk-of-bias result assessed yet.</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {orphans.length > 0 && (
        <div style={{ ...card, marginTop: 18, borderColor: alpha(C.yel, '50'), background: alpha(C.yel, '08') }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Icon name="alertTriangle" size={14} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>Assessments for studies no longer in this project</span>
          </div>
          <p style={{ fontSize: 12, color: C.txt2, margin: '0 0 10px' }}>These results were assessed earlier; their study has since been removed from the project. They are kept so no work is lost — open to review, or delete.</p>
          <div style={{ display: 'grid', gap: 6 }}>
            {orphans.map(a => <AssessmentRow key={a.id} a={a} canEdit={canEdit} orphan onOpen={() => setOpenId(a.id)} onRemove={() => removeAssessment(a.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RoB tool selector (prompt28 Part 4) ────────────────────────────────────────
function ToolSelector({ selected, canEdit, onSelect }) {
  const interactive = canEdit && typeof onSelect === 'function';
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="scale" size={14} />
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assessment tool</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ROB_TOOLS.map(t => {
          const active = isRobToolActive(t.id);
          const on = selected === t.id;
          const clickable = interactive && active;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => { if (t.id !== selected) onSelect(t.id); } : undefined}
              title={active ? t.description : `${t.label} — under development`}
              aria-pressed={on}
              style={{
                position: 'relative', textAlign: 'left', minWidth: 168, flex: '1 1 168px', maxWidth: 240,
                padding: '10px 12px', borderRadius: 10, fontFamily: FONT,
                cursor: clickable ? 'pointer' : (active ? 'default' : 'not-allowed'),
                background: on ? alpha(C.acc, '14') : C.surf,
                border: `1px solid ${on ? alpha(C.acc, '60') : C.brd}`,
                opacity: active ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: on ? C.acc : C.txt }}>{t.label}</span>
                {on && active && <Icon name="check" size={13} />}
                {!active && (
                  <span style={{ fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em', color: C.muted, background: alpha(C.txt, '0c'), border: `1px solid ${C.brd}`, borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase', marginLeft: 'auto' }}>Soon</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.35 }}>{t.sublabel}</div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 9, lineHeight: 1.5 }}>
        Only <strong style={{ color: C.txt2 }}>RoB 2</strong> is available today; other instruments are in development. Your choice is saved for this project.
      </div>
    </div>
  );
}

function AssessmentRow({ a, canEdit, onOpen, onRemove, orphan }) {
  const st = judgmentStyle(a.overall);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd}` }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', background: st.hex, flexShrink: 0 }} />
      <button onClick={onOpen} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, color: C.txt, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {a.resultLabel || 'Result'} — <span style={{ color: st.fg, fontWeight: 700 }}>{st.label}</span> {a.status === 'complete' ? '· finalised' : '· draft'}{orphan ? ` · study ${a.studyId}` : ''}
      </button>
      <button onClick={onOpen} style={miniBtn}>{canEdit ? 'Open' : 'View'}</button>
      {canEdit && <button onClick={onRemove} style={{ ...miniBtn, color: C.muted }} title="Delete"><Icon name="trash" size={12} /></button>}
    </div>
  );
}

function CreateForm({ onCancel, onCreate }) {
  const [label, setLabel] = useState('');
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Result / outcome being assessed (e.g. Mortality at 6 months)"
        onKeyDown={e => { if (e.key === 'Enter') onCreate(label); if (e.key === 'Escape') onCancel(); }}
        style={{ flex: 1, minWidth: 240, padding: '8px 11px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 13, fontFamily: FONT }} />
      <button onClick={() => onCreate(label)} style={{ ...ghost, background: C.acc, color: C.accText, border: `1px solid ${C.acc}` }}>Start assessment</button>
      <button onClick={onCancel} style={ghost}>Cancel</button>
    </div>
  );
}

function OwnerOnlyNotice() {
  return (
    <div style={{ ...card, textAlign: 'center', padding: '36px 24px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'inline-flex', padding: 14, borderRadius: '50%', background: alpha(C.acc, '12'), marginBottom: 14 }}><Icon name="lock" size={22} /></div>
      <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px' }}>Risk of Bias is managed by the project owner</h3>
      <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: 0 }}>
        Risk-of-bias assessments are kept with the owner&apos;s copy of this project. Ask the owner to share results or add you as the assessor.
      </p>
    </div>
  );
}

function Center({ children }) { return <div style={{ padding: 50, textAlign: 'center', color: C.muted, fontSize: 13.5, lineHeight: 1.6 }}>{children}</div>; }
function ErrorBox({ msg, onRetry }) {
  return (
    <div style={{ padding: '12px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 8, color: C.red, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span>{msg}</span>
      {onRetry && <button onClick={onRetry} style={{ ...ghost, color: C.txt2 }}><Icon name="refresh" size={13} /> Retry</button>}
    </div>
  );
}

const card = { background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '14px 16px' };
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt2, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT };
const miniBtn = { padding: '4px 10px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 11.5, cursor: 'pointer', fontFamily: FONT };
