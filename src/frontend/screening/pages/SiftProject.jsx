/**
 * SiftProject.jsx — META·SIFT project shell (tabbed "command center").
 * Route: /sift-beta/projects/:pid   (active tab via ?tab=)
 * Hosts Overview · Screening · Second Review · Duplicates · Conflicts · Members · Export.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { GlobalStyle, BetaBadge, Badge, Loading, ErrorBanner, Modal, Button } from '../ui/components.jsx';
import { Icon } from '../../components/icons.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';
import ChatLauncher from '../components/ChatLauncher.jsx';
import UserMenu from '../../components/UserMenu.jsx';
import NotificationsBell from '../../components/NotificationsBell.jsx';

import OverviewTab       from '../tabs/OverviewTab.jsx';
import ScreeningTab      from '../tabs/ScreeningTab.jsx';
import SecondReviewTab   from '../tabs/SecondReviewTab.jsx';
import DuplicatesTab     from '../tabs/DuplicatesTab.jsx';
import ConflictsTab      from '../tabs/ConflictsTab.jsx';
import ProjectControlTab from '../tabs/ProjectControlTab.jsx';
import ExportTab         from '../tabs/ExportTab.jsx';
import SiftImport        from './SiftImport.jsx';

const TABS = [
  { key: 'overview',      label: 'Overview',        icon: 'grid',        Comp: OverviewTab },
  { key: 'screening',     label: 'Screening',       icon: 'filter',      Comp: ScreeningTab },
  { key: 'second-review', label: 'Second Review',   icon: 'checkSquare', Comp: SecondReviewTab },
  { key: 'duplicates',    label: 'Duplicates',      icon: 'copy',        Comp: DuplicatesTab },
  { key: 'conflicts',     label: 'Conflicts',       icon: 'alert',       Comp: ConflictsTab },
  { key: 'control',       label: 'Project Control', icon: 'sliders',     Comp: ProjectControlTab },
  { key: 'export',        label: 'Export',          icon: 'upload',      Comp: ExportTab },
];

// Legacy deep links used ?tab=members — the roster now lives inside Project Control.
const TAB_ALIASES = { members: 'control' };

// prompt18 — embedded "Screening stage" sub-navigation. The SAME META·SIFT
// engine, rendered INSIDE the META·LAB project workspace as one "Screening"
// stage. "Import" becomes an inline sub-view (SiftImport) instead of a separate
// page; the page chrome, account menu, notifications, and the META·LAB link
// control are all dropped (the host project provides them). Order follows the
// natural screening flow: Import → Duplicates → Title/Abstract → Conflicts →
// Full Text → Settings → Export.
const EMBEDDED_TABS = [
  { key: 'overview',      label: 'Overview',         icon: 'grid',        Comp: OverviewTab },
  { key: 'import',        label: 'Import',           icon: 'upload',      Comp: null },
  { key: 'duplicates',    label: 'Duplicates',       icon: 'copy',        Comp: DuplicatesTab },
  { key: 'screening',     label: 'Title & Abstract', icon: 'filter',      Comp: ScreeningTab },
  { key: 'conflicts',     label: 'Conflicts',        icon: 'alert',       Comp: ConflictsTab },
  { key: 'second-review', label: 'Full Text',        icon: 'checkSquare', Comp: SecondReviewTab },
  { key: 'control',       label: 'Settings',         icon: 'sliders',     Comp: ProjectControlTab },
  { key: 'export',        label: 'Export',           icon: 'download',    Comp: ExportTab },
];

const PROGRESS_BADGE = {
  not_started: { label: 'NOT STARTED', color: C.muted },
  in_progress: { label: 'IN PROGRESS', color: C.acc },
  done:        { label: 'DONE',        color: C.grn },
};

export default function SiftProject({ embedded = false, embeddedPid = null } = {}) {
  const routeParams = useParams();
  const pid = embedded ? embeddedPid : routeParams.pid;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Embedded mode keeps the active sub-tab in local state so it never writes to
  // the host project's URL (?tab= belongs to the META·LAB workspace, not here).
  const [embTab, setEmbTab] = useState('overview');
  const rawTab = embedded ? embTab : (params.get('tab') || 'overview');
  const tab = TAB_ALIASES[rawTab] || rawTab;

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

  // Realtime (prompt6 Task 7) — thin pokes for THIS project trigger a refetch
  // through the authorized getProject endpoint (per-request re-auth; events
  // carry no content). permissions.changed is user-targeted: revalidate, and
  // if access is gone (403/404) say so and return to the dashboard.
  const revalidateAccess = useCallback(async () => {
    try { setProject(await screeningApi.getProject(pid)); }
    catch (e) {
      if (e?.status === 403 || e?.status === 404) {
        setProject(null);
        setError('Your access to this project changed.');
        // Standalone: bounce to the dashboard. Embedded: the host workspace owns
        // navigation — just surface the message in place.
        if (!embedded) setTimeout(() => navigate('/sift-beta'), 1800);
      }
    }
  }, [pid, navigate]);

  useRealtime({
    'project.updated':     ev => { if (ev?.projectId === pid) refreshProject(); },
    'members.changed':     ev => { if (ev?.projectId === pid) refreshProject(); },
    'status.changed':      ev => { if (ev?.projectId === pid) refreshProject(); },
    'handoff.updated':     ev => { if (ev?.projectId === pid) refreshProject(); },
    'permissions.changed': ev => { if (ev?.projectId === pid) revalidateAccess(); },
  });

  const setTab = (key) => setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', key); return n; }, { replace: true });

  const access = project ? {
    isLeader: project.isLeader, myRole: project.myRole,
    canScreen: project.canScreen, canChat: project.canChat,
    canResolveConflicts: project.canResolveConflicts, blindMode: project.blindMode,
  } : {};

  const tabSet = embedded ? EMBEDDED_TABS : TABS;
  const active = tabSet.find(t => t.key === tab) || tabSet[0];
  const ActiveComp = active.Comp;
  const isFullBleed = active.key === 'screening';
  const pb = PROGRESS_BADGE[project?.progressStatus] || PROGRESS_BADGE.not_started;

  // ── Embedded "Screening stage" (prompt18) ───────────────────────────────
  // Rendered inside the META·LAB monolith's Screening tab. No page shell, no
  // account menu / notifications / META·LAB link chip — just the screening
  // sub-navigation + body, sized to sit within the host workspace content area.
  if (embedded) {
    const tabBtn = (t) => {
      const on = t.key === active.key;
      return (
        <button key={t.key} onClick={() => setTab(t.key)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12.5, fontWeight: on ? 600 : 500, color: on ? C.txt : C.txt2,
            padding: '10px 13px', borderBottom: `2px solid ${on ? C.acc : 'transparent'}`,
            transition: 'color 0.15s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { if (!on) e.currentTarget.style.color = C.txt; }}
          onMouseLeave={e => { if (!on) e.currentTarget.style.color = C.txt2; }}>
          <Icon name={t.icon} size={13} style={{ opacity: on ? 1 : 0.75 }} />
          {t.label}
        </button>
      );
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 168px)', minHeight: 520, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', fontFamily: FONT, color: C.txt }}>
        <GlobalStyle />
        {/* Screening sub-navigation — the META·SIFT engine, nested in the stage */}
        <div style={{ display: 'flex', gap: 2, padding: '0 12px', background: C.surf, borderBottom: `1px solid ${C.brd}`, flexShrink: 0, overflowX: 'auto', alignItems: 'center' }}>
          {tabSet.map(tabBtn)}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, paddingRight: 4, flexShrink: 0 }}>
            {project?.blindMode && <Badge color={C.gold}>Blind</Badge>}
            {project?._count && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
                {project._count.records} records · {project._count.members} members
              </span>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflow: isFullBleed ? 'hidden' : 'auto', minHeight: 0 }}>
          {loading && <div style={{ padding: 32 }}><Loading label="Loading screening…" /></div>}

          {!loading && disabled && (
            <div style={{ padding: 32, maxWidth: 520, margin: '40px auto', textAlign: 'center', border: `1px solid ${alpha(C.gold, '40')}`, borderRadius: 12, background: alpha(C.gold, '08') }}>
              <div style={{ fontSize: 32, marginBottom: 14 }}>🔧</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.gold, marginBottom: 8 }}>Screening is temporarily unavailable</div>
              <div style={{ fontSize: 13, color: C.txt2 }}>{disabled}</div>
            </div>
          )}

          {!loading && error && <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}><ErrorBanner onRetry={load}>{error}</ErrorBanner></div>}

          {!loading && !error && !disabled && project && (
            active.key === 'import'
              ? <div style={{ maxWidth: 800, margin: '0 auto', padding: '8px 16px 40px' }}>
                  <SiftImport embedded embeddedPid={pid}
                    onDone={() => { setTab('screening'); refreshProject(); }}
                    onBack={() => setTab('overview')} />
                </div>
              : isFullBleed
                ? <div style={{ height: '100%' }}><ActiveComp pid={pid} project={project} access={access} refreshProject={refreshProject} setTab={setTab} embedded /></div>
                : <div style={{ maxWidth: 1180, margin: '0 auto', padding: '20px 20px 48px' }}>
                    <ActiveComp pid={pid} project={project} access={access} refreshProject={refreshProject} setTab={setTab} embedded />
                  </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', height: '100vh', background: C.bg, fontFamily: FONT, color: C.txt, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <GlobalStyle />

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.brd}`, background: C.surf, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
          <button onClick={() => navigate('/sift-beta')}
            style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 12, fontFamily: FONT, padding: '4px 8px', borderRadius: 6, flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = C.txt}
            onMouseLeave={e => e.currentTarget.style.color = C.txt2}>← Projects</button>
          <span style={{ color: C.brd2 }}>|</span>
          <span title={project?.title || ''} style={{ fontSize: 14, fontWeight: 600, color: C.txt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360, minWidth: 0 }}>
            {project?.title || 'Loading…'}
          </span>
          <BetaBadge />
          {project?.blindMode && <Badge color={C.gold}>Blind</Badge>}
          {project && <Badge color={pb.color}>{pb.label}</Badge>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {project?._count && (
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
              {project._count.records} records · {project._count.members} members
            </span>
          )}
          {project && <LinkBadge pid={pid} isLeader={!!project.isLeader} navigate={navigate} onChanged={refreshProject} />}
          <button onClick={() => navigate(`/sift-beta/projects/${pid}/import`)}
            style={{ background: C.card, border: `1px solid ${C.brd2}`, color: C.txt, fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: '6px 14px', borderRadius: 7, cursor: 'pointer' }}>
            ↑ Import
          </button>
          {/* Utility cluster (prompt8): [chat][bell][account] */}
          {project && <ChatLauncher pid={pid} access={access} />}
          <NotificationsBell />
          <UserMenu context="metasift" />
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
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 13, fontWeight: on ? 600 : 500, color: on ? C.txt : C.txt2,
                padding: '11px 14px', borderBottom: `2px solid ${on ? C.acc : 'transparent'}`,
                transition: 'color 0.15s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.color = C.txt; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.color = C.txt2; }}>
              <Icon name={t.icon} size={14} style={{ opacity: on ? 1 : 0.75 }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: isFullBleed ? 'hidden' : 'auto', minHeight: 0 }}>
        {loading && <div style={{ padding: 32 }}><Loading label="Loading project…" /></div>}

        {!loading && disabled && (
          <div style={{ padding: 32, maxWidth: 520, margin: '40px auto', textAlign: 'center', border: `1px solid ${alpha(C.gold, '40')}`, borderRadius: 12, background: alpha(C.gold, '08') }}>
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
          background: linked && !linked.missing ? alpha(C.grn, '14') : C.card,
          border: `1px solid ${linked && !linked.missing ? alpha(C.grn, '55') : C.brd2}`,
          color: linked && !linked.missing ? C.grn : C.txt2,
          fontSize: 11.5, fontWeight: 600, fontFamily: FONT, padding: '5px 11px', borderRadius: 7, cursor: 'pointer', maxWidth: 240,
        }}>
        <span>🔗</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
