/**
 * ProjectControlTab.jsx — META·SIFT consolidated project control / settings (prompt5 Task 5).
 *
 * One place for project management instead of scattering it across screens:
 *   • Project rename (prompt6 Task 18 — syncs the linked ML name if in sync)
 *   • Project status, blind mode, chat permissions  (leader / canManageSettings)
 *   • META·LAB link / unlink + direct deep link + handoff rollup (Task 3)
 *   • Members, roles, and per-member permissions     (embeds MembersTab)
 *
 * Visibility (Task 5):
 *   Owner       → full controls.
 *   Leader      → allowed controls, but cannot edit the owner (enforced server-side).
 *   Member      → read-only project info.
 *   Viewer      → limited info.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, Badge, Toggle, Card, SectionLabel } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import MembersTab from './MembersTab.jsx';

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done',        label: 'Done' },
];
const ROLE_META = {
  owner:    { label: 'Owner',    color: C.gold },
  leader:   { label: 'Leader',   color: C.teal },
  reviewer: { label: 'Reviewer', color: C.acc },
  viewer:   { label: 'Viewer',   color: C.muted },
};

const selectStyle = {
  background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6,
  padding: '7px 10px', color: C.txt, fontSize: 13, fontFamily: FONT, outline: 'none', cursor: 'pointer',
};

export default function ProjectControlTab({ pid, project, access, refreshProject, embedded = false }) {
  const canManageSettings = !!(project?.canManageSettings || project?.isLeader || access?.isLeader);
  const myRole = project?.myRole || access?.myRole || 'reviewer';
  const roleMeta = ROLE_META[myRole] || ROLE_META.reviewer;

  return (
    <div style={{ animation: 'sift-fade 0.3s ease', display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.txt }}>Project Control</div>
          <div style={{ fontSize: 12, color: C.txt2, marginTop: 3 }}>
            Manage project status, blind mode, chat, members, and Screening settings — all in one place.
          </div>
        </div>
        <Badge color={roleMeta.color} title={`Your role: ${roleMeta.label}`}>Your role · {roleMeta.label}</Badge>
      </div>

      {!canManageSettings && (
        <div style={{
          background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: C.txt2, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          You can view project information here. Only the owner or a leader can change settings.
        </div>
      )}

      <SettingsSection pid={pid} project={project} canManage={canManageSettings} refreshProject={refreshProject} />

      {/* prompt18: the META·LAB link is an internal detail — hidden inside the
          unified workspace (you're already in the project), shown only in the
          standalone/admin screening shell. */}
      {!embedded && <LinkSection pid={pid} canManage={canManageSettings} />}

      <div>
        <SectionLabel>Members &amp; permissions</SectionLabel>
        <Card style={{ padding: '18px 18px 8px' }}>
          <MembersTab pid={pid} project={project} access={access} refreshProject={refreshProject} />
        </Card>
      </div>
    </div>
  );
}

// ── Project settings: status / blind mode / chat restriction ────────────────

function SettingsSection({ pid, project, canManage, refreshProject }) {
  const [status, setStatus] = useState(project?.progressStatus || 'not_started');
  const [blind, setBlind] = useState(!!project?.blindMode);
  const [chatRestricted, setChatRestricted] = useState(!!project?.chatRestricted);
  const [reqReviewers, setReqReviewers] = useState(project?.requiredScreeningReviewers ?? 2);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setStatus(project?.progressStatus || 'not_started');
    setBlind(!!project?.blindMode);
    setChatRestricted(!!project?.chatRestricted);
    setReqReviewers(project?.requiredScreeningReviewers ?? 2);
  }, [project?.id, project?.progressStatus, project?.blindMode, project?.chatRestricted, project?.requiredScreeningReviewers]);

  // Returns true on success; callers revert their optimistic state on false.
  const save = useCallback(async (patch) => {
    setBusy(true); setErr('');
    try {
      await screeningApi.updateProject(pid, patch);
      await refreshProject?.();
      setFlash(true); setTimeout(() => setFlash(false), 1400);
      return true;
    } catch (e) {
      setErr(e.message || 'Could not save.');
      return false;
    } finally { setBusy(false); }
  }, [pid, refreshProject]);

  return (
    <div>
      <SectionLabel right={flash ? <span style={{ fontSize: 11, color: C.grn, fontFamily: MONO }}>✓ saved</span> : null}>
        Project status &amp; access
      </SectionLabel>
      <Card>
        {err && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{err}</div>}

        {/* Rename (prompt6 Task 18) — owner/leader only; the server renames the
            linked META·LAB project too iff the titles matched before the edit. */}
        <div style={{ borderBottom: `1px solid ${C.brd}`, marginBottom: 14, paddingBottom: 14 }}>
          <TitleRow title={project?.title} canManage={canManage} busy={busy} save={save} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>Status</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Where this review stands.</div>
          </div>
          {canManage ? (
            <select value={status} disabled={busy}
              onChange={e => { const v = e.target.value, prev = status; setStatus(v); save({ progressStatus: v }).then(ok => { if (!ok) setStatus(prev); }); }}
              style={{ ...selectStyle, opacity: busy ? 0.6 : 1 }}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <Badge color={status === 'done' ? C.grn : status === 'in_progress' ? C.acc : C.muted}>
              {STATUS_OPTIONS.find(o => o.value === status)?.label || status}
            </Badge>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${C.brd}`, margin: '14px 0', paddingTop: 14 }}>
          <Row title="Blind mode" hint="Hide author / journal info from reviewers during screening.">
            {canManage
              ? <Toggle checked={blind} disabled={busy} onChange={next => { const prev = blind; setBlind(next); save({ blindMode: next }).then(ok => { if (!ok) setBlind(prev); }); }} />
              : <Badge color={blind ? C.gold : C.muted}>{blind ? 'On' : 'Off'}</Badge>}
          </Row>
        </div>

        <div style={{ borderTop: `1px solid ${C.brd}`, marginTop: 14, paddingTop: 14 }}>
          <Row title="Restrict chat" hint="When on, only members with the Chat permission can post.">
            {canManage
              ? <Toggle checked={chatRestricted} disabled={busy} onChange={next => { const prev = chatRestricted; setChatRestricted(next); save({ chatRestricted: next }).then(ok => { if (!ok) setChatRestricted(prev); }); }} />
              : <Badge color={chatRestricted ? C.ylw : C.muted}>{chatRestricted ? 'Restricted' : 'Open'}</Badge>}
          </Row>
        </div>

        <div style={{ borderTop: `1px solid ${C.brd}`, marginTop: 14, paddingTop: 14 }}>
          <Row title="Required reviewers" hint="Independent title & abstract decisions needed before a record can advance to Final Review. The research standard is 2; only the owner or a leader can change it.">
            {canManage
              ? <select value={reqReviewers} disabled={busy}
                  onChange={e => { const v = parseInt(e.target.value, 10); const prev = reqReviewers; setReqReviewers(v); save({ requiredScreeningReviewers: v }).then(ok => { if (!ok) setReqReviewers(prev); }); }}
                  style={{ ...selectStyle, opacity: busy ? 0.6 : 1 }}>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} reviewers</option>)}
                </select>
              : <Badge color={C.acc}>{reqReviewers} reviewers</Badge>}
          </Row>
        </div>
      </Card>
    </div>
  );
}

// ── Project rename (prompt6 Task 18) ────────────────────────────────────────

function TitleRow({ title, canManage, busy, save }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title || '');

  // Keep the draft in sync with server refreshes while not editing.
  useEffect(() => { if (!editing) setDraft(title || ''); }, [title, editing]);

  const trimmed = draft.trim();
  const canSave = !!trimmed && trimmed !== (title || '') && !busy;

  async function submit() {
    if (!canSave) return;
    const ok = await save({ title: trimmed });
    if (ok) setEditing(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>Project name</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
          Renaming updates the project name across all of its stages.
        </div>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              value={draft}
              autoFocus
              disabled={busy}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                if (e.key === 'Escape') { setDraft(title || ''); setEditing(false); }
              }}
              style={{
                flex: 1, minWidth: 220, background: C.card, border: `1px solid ${C.brd2}`,
                borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 13, fontFamily: FONT, outline: 'none',
              }}
            />
            <Button onClick={submit} disabled={!canSave}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" onClick={() => { setDraft(title || ''); setEditing(false); }} disabled={busy}>Cancel</Button>
          </div>
        ) : (
          <div title={title || 'Untitled project'} style={{ fontSize: 14, color: C.txt, marginTop: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || 'Untitled project'}
          </div>
        )}
      </div>
      {canManage && !editing && (
        <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy} style={{ padding: '6px 14px', fontSize: 12 }}>
          ✎ Rename
        </Button>
      )}
    </div>
  );
}

function Row({ title, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{title}</div>
        {hint && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// ── META·LAB link / unlink + linked info + handoff rollup ───────────────────

function LinkSection({ pid, canManage }) {
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setInfo(await screeningApi.getLinkable(pid)); } catch (e) { setErr(e.message || 'Could not load link info.'); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  async function apply(metaLabProjectId) {
    setBusy(true); setErr('');
    try { await screeningApi.linkMetaLab(pid, metaLabProjectId || null); await load(); setPick(''); }
    catch (e) { setErr(e.message || 'Could not update the link.'); }
    finally { setBusy(false); }
  }

  const linked = info?.linked;
  const h = info?.handoff;

  return (
    <div>
      <SectionLabel>META·LAB link</SectionLabel>
      <Card>
        {loading ? <Loading label="Loading link…" /> : (
          <>
            <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 14, lineHeight: 1.5 }}>
              Accepted second-review studies hand off to the linked META·LAB project’s Data Extraction, and its PRISMA
              diagram updates from this screening project. Members of this workspace can reach the linked project per
              their permissions.
            </div>

            {/* Linked state (prompt6 Task 3): healthy link → direct deep link to the
                EXACT META·LAB project; missing target → explicit broken-link
                warning instead of a dead button. */}
            {linked && linked.missing ? (
              <div style={{
                background: C.yelBg, border: `1px solid ${alpha(C.ylw, '50')}`, borderRadius: 8,
                padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: C.ylw, lineHeight: 1.5,
              }}>
                ⚠ Link broken — the linked META·LAB project is missing or was deleted.
                {canManage ? ' Re-link to another project below, or unlink.' : ' Ask the owner or a leader to fix the link.'}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: h ? 14 : 0, flexWrap: 'wrap' }}>
                {linked
                  ? (
                    <>
                      <Badge color={C.grn}>{`🔗 ${linked.name}`}</Badge>
                      <button
                        onClick={() => navigate(`/app/project/${linked.id}`)}
                        title={`Open the linked META·LAB project: ${linked.name}`}
                        style={{
                          background: 'none', border: `1px solid ${C.brd2}`, color: C.acc,
                          fontSize: 11.5, fontFamily: FONT, fontWeight: 600,
                          padding: '4px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        Open META·LAB project →
                      </button>
                    </>
                  )
                  : <Badge color={C.muted}>Not linked</Badge>}
              </div>
            )}

            {h && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <Badge color={C.grn}>{h.sent} sent</Badge>
                <Badge color={C.gold}>{h.pending} pending</Badge>
                <Badge color={C.teal}>{h.already_exists} already in extraction</Badge>
                {h.failed > 0 && <Badge color={C.red}>{h.failed} failed</Badge>}
              </div>
            )}

            {err && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{err}</div>}

            {canManage ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={pick} onChange={e => setPick(e.target.value)} disabled={busy}
                  style={{ ...selectStyle, minWidth: 220 }}>
                  <option value="">— Select a META·LAB project —</option>
                  {(info?.available || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Button onClick={() => apply(pick)} disabled={busy || !pick}>
                  {busy ? 'Saving…' : (linked ? 'Change link' : 'Link project')}
                </Button>
                {linked && <Button variant="ghost" onClick={() => apply(null)} disabled={busy}>Unlink</Button>}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Only the owner or a leader can change the link.</div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
