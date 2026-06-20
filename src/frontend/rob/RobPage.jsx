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
  // prompt42 Task 7 — no page-level scroll while the per-study assessment workspace
  // is open on the standalone route too (mirrors the embedded monolith behaviour).
  // Gated to wide (>=900px) screens: below that the workspace stacks and intentionally
  // page-scrolls, so forcing overflow:hidden would clip the assessment + footer.
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [wide, setWide] = useState(() => { try { return window.innerWidth >= 900; } catch { return true; } });
  useEffect(() => { robFlagEnabled().then(setFlag).catch(() => setFlag(false)); }, []);
  useEffect(() => {
    let raf = 0;
    const onR = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { try { setWide(window.innerWidth >= 900); } catch { /* ignore */ } }); };
    window.addEventListener('resize', onR);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onR); };
  }, []);

  if (flag === null) return <Frame><Center>Checking availability…</Center></Frame>;
  if (flag === false) return <Frame><NotEnabled /></Frame>;
  if (!projectId) return <Frame><ProjectPicker /></Frame>;
  return <Frame noScroll={workspaceOpen && wide}><ProjectRob projectId={projectId} onWorkspaceChange={setWorkspaceOpen} /></Frame>;
}

function Frame({ children, noScroll = false }) {
  const navigate = useNavigate();
  return (
    <div style={{ height: noScroll ? '100vh' : undefined, minHeight: '100vh', background: C.bg, color: C.txt, fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: `1px solid ${C.brd}`, background: C.card, flexShrink: 0 }}>
        <button onClick={() => navigate('/app')} style={ghost}><Icon name="arrowLeft" size={15} /> Workspace</button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16 }}>
          <Icon name="scale" size={18} /> Risk of Bias
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '34')}`, borderRadius: 6, padding: '2px 7px' }}>RoB 2 · beta</span>
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0, maxWidth: 'none', margin: 0, padding: noScroll ? '16px 20px' : '24px 28px 60px', overflow: noScroll ? 'hidden' : 'visible', display: noScroll ? 'flex' : 'block', flexDirection: 'column' }}>{children}</div>
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
function ProjectRob({ projectId, onWorkspaceChange }) {
  return <ProjectRobPanel projectId={projectId} onWorkspaceChange={onWorkspaceChange} />;
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
