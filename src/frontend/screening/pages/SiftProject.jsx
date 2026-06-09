/**
 * SiftProject.jsx — META·SIFT project shell (tabbed "command center").
 * Route: /sift-beta/projects/:pid   (active tab via ?tab=)
 * Hosts Overview · Screening · Second Review · Duplicates · Conflicts · Members · Export.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { C, FONT, MONO } from '../ui/theme.js';
import { GlobalStyle, BetaBadge, Badge, Loading, ErrorBanner, Modal, Button } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import ChatLauncher from '../components/ChatLauncher.jsx';

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {project?._count && (
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
              {project._count.records} records · {project._count.members} members
            </span>
          )}
          {project && <LinkBadge pid={pid} isLeader={!!project.isLeader} navigate={navigate} onChanged={refreshProject} />}
          {project && <ChatLauncher pid={pid} access={access} />}
          <button onClick={() => navigate(`/sift-beta/projects/${pid}/import`)}
            style={{ background: C.card, border: `1px solid ${C.brd2}`, color: C.txt, fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: '6px 14px', borderRadius: 7, cursor: 'pointer' }}>
            ↑ Import
          </button>
          {isAdmin && (
            <button onClick={() => navigate('/ops')} title="Open the META·SIFT control panel"
              style={{ background: C.acc2 + '1c', border: `1px solid ${C.acc2}55`, color: C.acc, fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: '6px 12px', borderRadius: 7, cursor: 'pointer' }}>
              ⚙ Control Panel
            </button>
          )}
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

/**
 * LinkBadge — shows the linked META·LAB project (Task 4 association) and lets the
 * leader link/unlink + jump to it. Handoff status counts surface here too so the
 * leader can see what reached Data Extraction.
 */
function LinkBadge({ pid, isLeader, navigate, onChanged }) {
  const [info, setInfo]   = useState(null);
  const [open, setOpen]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const [pick, setPick]   = useState('');

  const load = useCallback(async () => {
    try { setInfo(await screeningApi.getLinkable(pid)); } catch { /* non-fatal */ }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  async function apply(metaLabProjectId) {
    setBusy(true); setErr('');
    try {
      await screeningApi.linkMetaLab(pid, metaLabProjectId || null);
      await load();
      onChanged?.();
      setOpen(false);
    } catch (e) { setErr(e.message || 'Could not update the link'); }
    finally { setBusy(false); }
  }

  const linked = info?.linked;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={linked ? `Linked to META·LAB project: ${linked.name}` : 'Not linked to a META·LAB project'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: linked && !linked.missing ? C.grn + '14' : C.card,
          border: `1px solid ${linked && !linked.missing ? C.grn + '55' : C.brd2}`,
          color: linked && !linked.missing ? C.grn : C.txt2,
          fontSize: 11.5, fontWeight: 600, fontFamily: FONT, padding: '5px 11px', borderRadius: 7, cursor: 'pointer', maxWidth: 240,
        }}>
        <span>🔗</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {linked ? (linked.missing ? 'Linked project missing' : linked.name) : 'Link META·LAB'}
        </span>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} width={460}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 4 }}>META·LAB project link</div>
          <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 16, lineHeight: 1.5 }}>
            Accepted second-review studies hand off to the linked META·LAB project’s Data Extraction, and its PRISMA diagram updates from this screening project.
          </div>

          {linked && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {linked.missing ? '⚠ Linked project no longer exists' : `🔗 ${linked.name}`}
              </span>
              {!linked.missing && (
                <button onClick={() => navigate(`/app?project=${linked.id}`)} style={{ background: 'none', border: `1px solid ${C.brd2}`, color: C.acc, fontSize: 11.5, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>Open →</button>
              )}
            </div>
          )}

          {info?.handoff && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <Badge color={C.grn}>{info.handoff.sent} sent</Badge>
              <Badge color={C.gold}>{info.handoff.pending} pending</Badge>
              <Badge color={C.teal}>{info.handoff.already_exists} already in extraction</Badge>
              {info.handoff.failed > 0 && <Badge color={C.red}>{info.handoff.failed} failed</Badge>}
            </div>
          )}

          {isLeader ? (
            <>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.txt2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Link to a META·LAB project</label>
              <select value={pick} onChange={e => setPick(e.target.value)}
                style={{ width: '100%', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: FONT, outline: 'none', marginTop: 6, marginBottom: 12 }}>
                <option value="">— Select a project —</option>
                {(info?.available || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {err && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <Button onClick={() => apply(pick)} disabled={busy || !pick}>{busy ? 'Saving…' : (linked ? 'Change link' : 'Link project')}</Button>
                {linked && <Button variant="ghost" onClick={() => apply(null)} disabled={busy}>Unlink</Button>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Only the project leader can change the link.</div>
          )}
        </Modal>
      )}
    </>
  );
}
