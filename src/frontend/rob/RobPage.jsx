/**
 * RobPage.jsx — entry point for the META·LAB RoB workspace (rob.md §6).
 *
 * Routed at /rob (project picker) and /rob/:projectId (per-project view). Gated
 * client-side on the rob_engine_v2 public flag (the server also 404s when off).
 * The per-project view shows the robvis summary plot, lists the project's studies
 * with their assessments, lets the owner start an assessment, and opens the
 * keyboard-first RobWorkspace inline.
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { api } from '../api-client/apiClient.js';
import { robFlagEnabled } from './robApi.js';
import ProjectRobPanel from './ProjectRobPanel.jsx';

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
      <div style={{ maxWidth: 'none', margin: 0, padding: '24px 28px 60px' }}>{children}</div>
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

// The per-project view now delegates to the shared, embeddable ProjectRobPanel
// (also used natively inside the META·LAB workspace "Risk of Bias" tab, prompt28
// Part 2). Standalone here: read-only tool selector, full owner editing.
function ProjectRob({ projectId }) {
  return <ProjectRobPanel projectId={projectId} />;
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
