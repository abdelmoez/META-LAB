/**
 * SiftProject.jsx — META·SIFT project shell (tabbed "command center").
 * Route: /sift-beta/projects/:pid   (active tab via ?tab=)
 * Hosts Overview · Screening · Second Review · Duplicates · Conflicts · Members · Export.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { C, FONT, MONO } from '../ui/theme.js';
import { GlobalStyle, BetaBadge, Badge, Loading, ErrorBanner } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

import OverviewTab     from '../tabs/OverviewTab.jsx';
import ScreeningTab    from '../tabs/ScreeningTab.jsx';
import SecondReviewTab from '../tabs/SecondReviewTab.jsx';
import DuplicatesTab   from '../tabs/DuplicatesTab.jsx';
import ConflictsTab    from '../tabs/ConflictsTab.jsx';
import MembersTab      from '../tabs/MembersTab.jsx';
import ExportTab       from '../tabs/ExportTab.jsx';

const TABS = [
  { key: 'overview',      label: 'Overview',      Comp: OverviewTab },
  { key: 'screening',     label: 'Screening',     Comp: ScreeningTab },
  { key: 'second-review', label: 'Second Review', Comp: SecondReviewTab },
  { key: 'duplicates',    label: 'Duplicates',    Comp: DuplicatesTab },
  { key: 'conflicts',     label: 'Conflicts',     Comp: ConflictsTab },
  { key: 'members',       label: 'Members',       Comp: MembersTab },
  { key: 'export',        label: 'Export',        Comp: ExportTab },
];

const PROGRESS_BADGE = {
  not_started: { label: 'NOT STARTED', color: C.muted },
  in_progress: { label: 'IN PROGRESS', color: C.acc },
  done:        { label: 'DONE',        color: C.grn },
};

export default function SiftProject() {
  const { pid } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [disabled, setDisabled] = useState(null);

  const load = useCallback(async () => {
    setError(null); setDisabled(null);
    try {
      const p = await screeningApi.getProject(pid);
      setProject(p);
    } catch (e) {
      if (e.status === 503 && e.data?.disabled) setDisabled(e.message);
      else if (e.status === 404) setError('Project not found, or you do not have access to it.');
      else setError(e.message || 'Failed to load project');
    } finally { setLoading(false); }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const refreshProject = useCallback(async () => {
    try { setProject(await screeningApi.getProject(pid)); } catch { /* keep prior */ }
  }, [pid]);

  const setTab = (key) => setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', key); return n; }, { replace: true });

  const access = project ? {
    isLeader: project.isLeader, myRole: project.myRole,
    canScreen: project.canScreen, canChat: project.canChat,
    canResolveConflicts: project.canResolveConflicts, blindMode: project.blindMode,
  } : {};

  const active = TABS.find(t => t.key === tab) || TABS[0];
  const ActiveComp = active.Comp;
  const isFullBleed = active.key === 'screening';
  const pb = PROGRESS_BADGE[project?.progressStatus] || PROGRESS_BADGE.not_started;

  return (
    <div style={{ minHeight: '100vh', height: '100vh', background: C.bg, fontFamily: FONT, color: C.txt, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <GlobalStyle />

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.brd}`, background: C.surf, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={() => navigate('/sift-beta')}
            style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 12, fontFamily: FONT, padding: '4px 8px', borderRadius: 6 }}
            onMouseEnter={e => e.currentTarget.style.color = C.txt}
            onMouseLeave={e => e.currentTarget.style.color = C.txt2}>← Projects</button>
          <span style={{ color: C.brd2 }}>|</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.txt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>
            {project?.title || 'Loading…'}
          </span>
          <BetaBadge />
          {project?.blindMode && <Badge color={C.gold}>Blind</Badge>}
          {project && <Badge color={pb.color}>{pb.label}</Badge>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {project?._count && (
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
              {project._count.records} records · {project._count.members} members
            </span>
          )}
          <button onClick={() => navigate(`/sift-beta/projects/${pid}/import`)}
            style={{ background: C.card, border: `1px solid ${C.brd2}`, color: C.txt, fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: '6px 14px', borderRadius: 7, cursor: 'pointer' }}>
            ↑ Import
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, padding: '0 16px', background: C.surf, borderBottom: `1px solid ${C.brd}`, flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(t => {
          const on = t.key === active.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 13, fontWeight: on ? 600 : 500, color: on ? C.txt : C.txt2,
                padding: '11px 14px', borderBottom: `2px solid ${on ? C.acc : 'transparent'}`,
                transition: 'color 0.15s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.color = C.txt; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.color = C.txt2; }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: isFullBleed ? 'hidden' : 'auto', minHeight: 0 }}>
        {loading && <div style={{ padding: 32 }}><Loading label="Loading project…" /></div>}

        {!loading && disabled && (
          <div style={{ padding: 32, maxWidth: 520, margin: '40px auto', textAlign: 'center', border: `1px solid ${C.gold}40`, borderRadius: 12, background: '#dba96a08' }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>🔧</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.gold, marginBottom: 8 }}>META·SIFT is temporarily unavailable</div>
            <div style={{ fontSize: 13, color: C.txt2 }}>{disabled}</div>
          </div>
        )}

        {!loading && error && <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}><ErrorBanner onRetry={load}>{error}</ErrorBanner></div>}

        {!loading && !error && !disabled && project && (
          isFullBleed
            ? <div style={{ height: '100%' }}><ActiveComp pid={pid} project={project} access={access} refreshProject={refreshProject} /></div>
            : <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 24px 56px' }}>
                <ActiveComp pid={pid} project={project} access={access} refreshProject={refreshProject} />
              </div>
        )}
      </div>
    </div>
  );
}
