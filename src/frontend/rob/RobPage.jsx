/**
 * RobPage.jsx — entry point for the META·LAB RoB workspace (rob.md §6).
 *
 * Routed at /rob (project picker) and /rob/:projectId (per-project view). Gated
 * client-side on the rob_engine_v2 public flag (the server also 404s when off).
 * The per-project view shows the robvis summary plot, lists the project's studies
 * with their assessments, lets the owner start an assessment, and opens the
 * keyboard-first RobWorkspace inline.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { api } from '../api-client/apiClient.js';
import { robApi, robFlagEnabled } from './robApi.js';
import RobWorkspace from './RobWorkspace.jsx';
import RobTrafficLight from './RobTrafficLight.jsx';
import { judgmentStyle } from './judgmentStyle.js';

export default function RobPage() {
  const { projectId } = useParams();
  const [flag, setFlag] = useState(null); // null=loading
  useEffect(() => { robFlagEnabled().then(setFlag).catch(() => setFlag(false)); }, []);

  if (flag === null) return <Frame><Center>Checking availability…</Center></Frame>;
  if (flag === false) return <Frame><NotEnabled /></Frame>;
  if (!projectId) return <Frame><ProjectPicker /></Frame>;
  return <Frame><ProjectRob projectId={projectId} /></Frame>;
}

function Frame({ children }) {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.txt, fontFamily: FONT }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: `1px solid ${C.brd}`, background: C.card }}>
        <button onClick={() => navigate('/app')} style={ghost}><Icon name="arrowLeft" size={15} /> Workspace</button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16 }}>
          <Icon name="scale" size={18} /> Risk of Bias
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '34')}`, borderRadius: 6, padding: '2px 7px' }}>RoB 2 · beta</span>
        </span>
      </header>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 22px 60px' }}>{children}</div>
    </div>
  );
}
function Center({ children }) { return <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>{children}</div>; }

function NotEnabled() {
  return (
    <div style={{ padding: '50px 24px', textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'inline-flex', padding: 16, borderRadius: '50%', background: alpha(C.acc, '12'), marginBottom: 16 }}><Icon name="lock" size={26} /></div>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 8px' }}>Risk of Bias is not enabled</h2>
      <p style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.6 }}>The RoB 2 assessment workspace is currently in beta and disabled. An administrator can enable it in <strong>Ops › Feature Flags</strong> (<code style={{ fontFamily: MONO }}>rob_engine_v2</code>).</p>
    </div>
  );
}

function ProjectPicker() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.projects.list().then(d => setProjects(Array.isArray(d) ? d : (d.projects || []))).catch(e => setError(e.message));
  }, []);
  if (error) return <ErrorBox msg={error} />;
  if (!projects) return <Center>Loading projects…</Center>;
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Choose a project</h2>
      <p style={{ fontSize: 13, color: C.txt2, margin: '0 0 18px' }}>Risk-of-bias assessments are made per result within one of your projects.</p>
      {projects.length === 0 ? <Center>No projects yet. Create one in the workspace first.</Center> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {projects.map(p => (
            <button key={p.id} onClick={() => navigate(`/rob/${p.id}`)} style={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="folder" size={18} />
              <span style={{ flex: 1, fontWeight: 700 }}>{p.name}</span>
              <Icon name="chevronRight" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRob({ projectId }) {
  const [project, setProject] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);     // open assessment in the workspace
  const [creatingFor, setCreatingFor] = useState(null); // study being created-for

  const reload = useCallback(async () => {
    try {
      const [proj, list] = await Promise.all([
        api.projects.get(projectId),
        robApi.listAssessments(projectId),
      ]);
      setProject(proj);
      setAssessments(list.assessments || []);
      setMatrix(list.matrix || null);
      setError('');
    } catch (e) { setError(e.message); }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

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
    return <RobWorkspace assessmentId={openId} onClose={() => { setOpenId(null); reload(); }} onChanged={reload} />;
  }
  if (error && !project) return <ErrorBox msg={error} onRetry={reload} />;
  if (!project) return <Center>Loading…</Center>;

  const studies = Array.isArray(project.studies) ? project.studies : [];
  const byStudy = {};
  for (const a of assessments) { (byStudy[a.studyId] = byStudy[a.studyId] || []).push(a); }

  return (
    <div>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>{project.name}</h2>
      <p style={{ fontSize: 13, color: C.txt2, margin: '0 0 18px' }}>{assessments.length} risk-of-bias assessment{assessments.length === 1 ? '' : 's'} · RoB 2 (effect of assignment)</p>

      {assessments.length > 0 && (
        <div style={{ ...card, marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Summary (traffic light)</div>
          <RobTrafficLight matrix={matrix} title={`${project.name} — Risk of bias (RoB 2)`} />
        </div>
      )}

      {studies.length === 0 ? (
        <Center>This project has no studies yet. Add studies in the workspace, then assess their risk of bias here.</Center>
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
                  <button onClick={() => setCreatingFor(creatingFor === s.id ? null : s.id)} style={ghost}><Icon name="plus" size={13} /> Assess a result</button>
                </div>

                {creatingFor === s.id && <CreateForm onCancel={() => setCreatingFor(null)} onCreate={label2 => createFor(s, label2)} />}

                {list.length > 0 && (
                  <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                    {list.map(a => {
                      const st = judgmentStyle(a.overall);
                      return (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd}` }}>
                          <span style={{ width: 11, height: 11, borderRadius: '50%', background: st.hex, flexShrink: 0 }} />
                          <button onClick={() => setOpenId(a.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, color: C.txt, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.resultLabel || 'Result'} — <span style={{ color: st.fg, fontWeight: 700 }}>{st.label}</span> {a.status === 'complete' ? '· finalised' : '· draft'}
                          </button>
                          <button onClick={() => setOpenId(a.id)} style={miniBtn}>Open</button>
                          <button onClick={() => removeAssessment(a.id)} style={{ ...miniBtn, color: C.muted }} title="Delete"><Icon name="trash" size={12} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
