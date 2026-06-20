/**
 * SiftDashboard.jsx — META·SIFT Beta project list
 * Route: /sift-beta
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import UserMenu from '../../components/UserMenu.jsx';
import NotificationsBell from '../../components/NotificationsBell.jsx';

import { C, FONT, MONO, alpha } from '../ui/theme.js';

function BetaBadge() {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      background: alpha(C.teal, '18'), border: `1px solid ${alpha(C.teal, '50')}`,
      color: C.teal, borderRadius: 4, padding: '2px 7px',
    }}>
      BETA
    </span>
  );
}

function ProgressBar({ pct, color = C.acc }) {
  return (
    <div style={{ height: 3, background: C.brd, borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct))}%`,
        height: '100%',
        background: color,
        borderRadius: 2,
        transition: 'width 0.3s',
      }} />
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      display: 'inline-block', width: 18, height: 18,
      border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

const EMPTY_FORM = { title: '', description: '', reviewQuestion: '', blindMode: false, alsoCreateMetaLab: false };

export default function SiftDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [projects,       setProjects]       = useState([]);
  const [stats,          setStats]          = useState({});   // { [pid]: statsObj }
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [disabled,       setDisabled]       = useState(false);
  const [disabledMsg,    setDisabledMsg]    = useState('');
  const [showNewModal,   setShowNewModal]   = useState(false);
  const [newForm,        setNewForm]        = useState(EMPTY_FORM);
  const [creating,       setCreating]       = useState(false);
  const [createError,    setCreateError]    = useState(null);
  const [deleteConfirm,  setDeleteConfirm]  = useState(null); // project object to delete (prompt9: typed-name confirm)
  const [deleteName,     setDeleteName]     = useState('');   // typed-name confirmation input
  const [deleteError,    setDeleteError]    = useState(null);
  const [deleting,       setDeleting]       = useState(false);
  const [statusFilter,   setStatusFilter]   = useState('all'); // all | not_started | in_progress | done

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDisabled(false);
    try {
      const data = await screeningApi.listProjects();
      const list = data.projects || [];
      setProjects(list);
      // Load stats for each project concurrently
      const statsResults = await Promise.allSettled(
        list.map(p => screeningApi.getStats(p.id))
      );
      const statsMap = {};
      statsResults.forEach((r, i) => {
        if (r.status === 'fulfilled') statsMap[list[i].id] = r.value;
      });
      setStats(statsMap);
    } catch (e) {
      if (e.status === 503 && e.data?.disabled) {
        setDisabled(true);
        setDisabledMsg(e.message);
      } else {
        setError(e.message || 'Failed to load projects');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newForm.title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await screeningApi.createProject({
        title: newForm.title.trim(),
        description: newForm.description.trim() || undefined,
        reviewQuestion: newForm.reviewQuestion.trim() || undefined,
        blindMode: newForm.blindMode,
        // Optional META·LAB pair (prompt6 Task 2) — opt-in only, never forced.
        alsoCreateMetaLab: newForm.alsoCreateMetaLab || undefined,
      });
      setShowNewModal(false);
      setNewForm(EMPTY_FORM);
      await loadProjects();
    } catch (e) {
      setCreateError(e.message || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    // Typed-name confirmation gate (prompt9) — the button is disabled until the
    // input matches, but re-check here so Enter-key paths can't slip through.
    if (!deleteConfirm || deleteName !== deleteConfirm.title) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await screeningApi.deleteProject(deleteConfirm.id); // DELETE, 204 — endpoint unchanged
      setDeleteConfirm(null);
      setDeleteName('');
      await loadProjects();
    } catch (e) {
      setDeleteError(e.message || 'Failed to delete project');
    } finally {
      setDeleting(false);
    }
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${C.brd}`,
        background: C.surf,
        padding: '14px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/app')}
            style={{
              background: 'none', border: 'none', color: C.txt2, cursor: 'pointer',
              fontSize: 12, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', borderRadius: 6, transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = C.txt}
            onMouseLeave={e => e.currentTarget.style.color = C.txt2}
          >
            ← Back to PecanRev
          </button>
          <span style={{ color: C.brd2, fontSize: 14 }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: C.txt, letterSpacing: '-0.01em' }}>
              Screening
            </span>
            <BetaBadge />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => { setShowNewModal(true); setCreateError(null); setNewForm(EMPTY_FORM); }}
            style={{
              background: C.acc2, border: 'none', color: C.accText, fontSize: 12, fontWeight: 600,
              fontFamily: FONT, padding: '7px 16px', borderRadius: 7, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.acc}
            onMouseLeave={e => e.currentTarget.style.background = C.acc2}
          >
            + New Screening Project
          </button>
          <NotificationsBell />
          <UserMenu context="metasift" />
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '36px 24px' }}>

        {/* Page title */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.txt, margin: 0, letterSpacing: '-0.02em' }}>
            Screening Projects
          </h1>
          <p style={{ fontSize: 13, color: C.txt2, marginTop: 6, marginBottom: 0 }}>
            Manage your systematic review title/abstract screening projects.
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: C.txt2, padding: '40px 0' }}>
            <Spinner />
            <span style={{ fontSize: 13 }}>Loading projects…</span>
          </div>
        )}

        {/* Disabled / maintenance */}
        {!loading && disabled && (
          <div style={{
            textAlign: 'center', padding: '64px 24px',
            border: `1px solid ${alpha(C.gold, '40')}`, borderRadius: 12,
            background: alpha(C.gold, '08'),
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🔧</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.gold, marginBottom: 8 }}>
              Screening is temporarily unavailable
            </div>
            <div style={{ fontSize: 13, color: C.txt2, maxWidth: 440, margin: '0 auto' }}>
              {disabledMsg}
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && !disabled && error && (
          <div style={{
            background: C.redBg, border: `1px solid ${alpha(C.red, '50')}`,
            borderRadius: 8, padding: '14px 18px', color: C.red, fontSize: 13, marginBottom: 20,
          }}>
            {error}
            <button
              onClick={loadProjects}
              style={{ marginLeft: 14, background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 12 }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !disabled && projects.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '64px 24px',
            border: `1px dashed ${C.brd}`, borderRadius: 12,
          }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, marginBottom: 8 }}>
              No projects you own or have been added to
            </div>
            <div style={{ fontSize: 13, color: C.txt2, marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
              Create your first project to begin screening — or ask a project owner to add you to theirs.
            </div>
            <button
              onClick={() => { setShowNewModal(true); setCreateError(null); setNewForm(EMPTY_FORM); }}
              style={{
                background: C.acc2, border: 'none', color: C.accText, fontSize: 13, fontWeight: 600,
                fontFamily: FONT, padding: '9px 22px', borderRadius: 7, cursor: 'pointer',
              }}
            >
              + Create Screening Project
            </button>
          </div>
        )}

        {/* Project cards */}
        {!loading && !error && !disabled && projects.length > 0 && (() => {
          const STATUS = [
            { key: 'all',         label: 'All' },
            { key: 'not_started', label: 'Not started' },
            { key: 'in_progress', label: 'In progress' },
            { key: 'done',        label: 'Done' },
          ];
          const countFor = k => k === 'all' ? projects.length : projects.filter(p => (p.progressStatus || 'not_started') === k).length;
          const visible = statusFilter === 'all' ? projects : projects.filter(p => (p.progressStatus || 'not_started') === statusFilter);
          return (
            <>
              {/* Status filter */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {STATUS.map(st => {
                  const on = statusFilter === st.key;
                  return (
                    <button key={st.key} onClick={() => setStatusFilter(st.key)}
                      style={{ cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
                        background: on ? C.acc2 : 'transparent', color: on ? C.accText : C.txt2, border: `1px solid ${on ? C.acc2 : C.brd2}` }}>
                      {st.label} <span style={{ fontFamily: MONO, opacity: 0.8 }}>{countFor(st.key)}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {visible.map(project => {
                  const s = stats[project.id] || {};
                  const total = s.total || 0;
                  const screened = (s.included || 0) + (s.excluded || 0) + (s.maybe || 0);
                  const pct = total > 0 ? Math.round((screened / total) * 100) : 0;
                  const progressColor = pct >= 100 ? C.grn : C.acc;
                  return (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      stats={s}
                      total={total}
                      screened={screened}
                      pct={pct}
                      progressColor={progressColor}
                      formatDate={formatDate}
                      onOpen={() => navigate(`/sift-beta/projects/${project.id}`)}
                      onOpenLinked={project.linkedMetaLabProjectId
                        ? () => navigate(`/app?project=${project.linkedMetaLabProjectId}`)
                        : undefined}
                      onDelete={() => { setDeleteConfirm(project); setDeleteName(''); setDeleteError(null); }}
                    />
                  );
                })}
                {visible.length === 0 && (
                  <div style={{ fontSize: 13, color: C.muted, padding: '24px 0', textAlign: 'center' }}>No projects with this status.</div>
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* New Project Modal */}
      {showNewModal && (
        <Modal onClose={() => !creating && setShowNewModal(false)}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 18 }}>
            New Screening Project
          </div>
          <form onSubmit={handleCreate}>
            <label style={labelStyle}>Project Title *</label>
            <input
              autoFocus
              value={newForm.title}
              onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g., AI in radiology — Title/Abstract screen"
              style={inputStyle}
              disabled={creating}
            />

            <label style={labelStyle}>Description</label>
            <textarea
              value={newForm.description}
              onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional project description"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
              disabled={creating}
            />

            <label style={labelStyle}>Review Question (PICO)</label>
            <input
              value={newForm.reviewQuestion}
              onChange={e => setNewForm(f => ({ ...f, reviewQuestion: e.target.value }))}
              placeholder="e.g., In adult ICU patients, does AI triage reduce mortality?"
              style={inputStyle}
              disabled={creating}
            />

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 14 }}>
              <input
                type="checkbox"
                checked={newForm.blindMode}
                onChange={e => setNewForm(f => ({ ...f, blindMode: e.target.checked }))}
                disabled={creating}
                style={{ width: 14, height: 14, accentColor: C.acc }}
              />
              <span>Blind mode <span style={{ color: C.muted, fontWeight: 400 }}>(hide author/journal info during screening)</span></span>
            </label>

            {/* Optional META·LAB pair (prompt6 Task 2). Default OFF — SIFT-side
                creation never forces a META·LAB project. */}
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 10 }}>
              <input
                type="checkbox"
                checked={newForm.alsoCreateMetaLab}
                onChange={e => setNewForm(f => ({ ...f, alsoCreateMetaLab: e.target.checked }))}
                disabled={creating}
                style={{ width: 14, height: 14, accentColor: C.acc }}
              />
              <span>Also create &amp; link a PecanRev project <span style={{ color: C.muted, fontWeight: 400 }}>(same title, linked workspace)</span></span>
            </label>

            {createError && (
              <div style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{createError}</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                disabled={creating}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !newForm.title.trim()}
                style={{
                  ...primaryBtnStyle,
                  opacity: (!newForm.title.trim() || creating) ? 0.5 : 1,
                }}
              >
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirmation modal — typed-name confirm (prompt9 Task 7) */}
      {deleteConfirm && (() => {
        const nameMatches = deleteName === deleteConfirm.title;
        return (
          <Modal onClose={() => { if (!deleting) { setDeleteConfirm(null); setDeleteName(''); } }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.red, marginBottom: 10 }}>
              Delete “{deleteConfirm.title}”?
            </div>
            <div style={{
              background: alpha(C.red, '10'), border: `1px solid ${alpha(C.red, '40')}`,
              borderRadius: 8, padding: '12px 14px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.red, marginBottom: 8 }}>
                This permanently deletes the screening project and everything in it:
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.txt2, lineHeight: 1.7 }}>
                <li>All imported records and references</li>
                <li>All screening decisions from every reviewer</li>
                <li>The project chat history</li>
                <li>Attached PDFs</li>
                <li>The member roster and pending invites</li>
              </ul>
            </div>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 0, marginBottom: 16, lineHeight: 1.6 }}>
              The linked PecanRev project (if any) is <strong style={{ color: C.txt2 }}>not</strong> deleted
              from this side — it stays available in PecanRev.
            </p>
            <label style={labelStyle}>Type the project name to confirm</label>
            <input
              autoFocus
              value={deleteName}
              onChange={e => setDeleteName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nameMatches && !deleting) handleDelete(); }}
              placeholder={deleteConfirm.title}
              disabled={deleting}
              style={inputStyle}
            />
            {deleteError && (
              <div style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{deleteError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => { setDeleteConfirm(null); setDeleteName(''); }}
                disabled={deleting}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || !nameMatches}
                title={nameMatches ? undefined : 'Type the project name exactly to enable deletion'}
                style={{
                  ...primaryBtnStyle,
                  background: C.red,
                  cursor: (deleting || !nameMatches) ? 'not-allowed' : 'pointer',
                  opacity: (deleting || !nameMatches) ? 0.5 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete Project'}
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

// Owner / leader / member role presentation (prompt5 Task 1 — kept distinct).
const ROLE_META = {
  owner:    { label: 'Owner',    color: C.gold },
  leader:   { label: 'Leader',   color: C.teal },
  reviewer: { label: 'Reviewer', color: C.acc },
  viewer:   { label: 'Viewer',   color: C.muted },
};

function RoleChip({ role, shared }) {
  const meta = ROLE_META[role] || ROLE_META.reviewer;
  const text = role === 'owner' ? 'You are owner'
    : role === 'leader' ? 'You are leader'
    : `${shared ? 'Shared · ' : ''}${meta.label}`;
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
      background: alpha(meta.color, '18'), border: `1px solid ${alpha(meta.color, '40')}`, color: meta.color,
      borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase',
    }}>{text}</span>
  );
}

function ProjectCard({ project, stats, total, screened, pct, progressColor, formatDate, onOpen, onOpenLinked, onDelete }) {
  const [hover, setHover] = useState(false);
  const leaders = Array.isArray(project.leaders) ? project.leaders : [];
  // prompt25 Task 5 — prefer the LIVE owner (joined User row) over the stale
  // denormalized ownerName so renames show immediately.
  const ownerName = project.owner?.name || project.owner?.email || project.ownerName || 'Unknown';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? C.cardHover : C.card,
        border: `1px solid ${hover ? C.brd2 : C.brd}`,
        borderRadius: 10,
        padding: '18px 22px',
        boxShadow: hover ? `0 6px 18px ${C.shadow}` : 'none',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <span title={project.title} style={{ fontSize: 15.5, fontWeight: 600, color: C.txt, letterSpacing: '-0.01em', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.title}
            </span>
            {/* Owner vs Leader vs member role — distinct (Task 1) */}
            <RoleChip
              role={project.isOwner ? 'owner' : (project.myRole || 'reviewer')}
              shared={project.isOwner === false}
            />
            {project.blindMode && (
              <span style={{
                fontSize: 9, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                background: alpha(C.gold, '18'), border: `1px solid ${alpha(C.gold, '40')}`, color: C.gold,
                borderRadius: 4, padding: '1px 6px',
              }}>BLIND</span>
            )}
            {(() => {
              const ps = project.progressStatus || 'not_started';
              if (ps === 'not_started') return null;
              const col = ps === 'done' ? C.grn : C.acc;
              return (
                <span style={{
                  fontSize: 9, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                  background: alpha(col, '18'), border: `1px solid ${alpha(col, '40')}`, color: col,
                  borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase',
                }}>{ps === 'done' ? 'DONE' : 'IN PROGRESS'}</span>
              );
            })()}
          </div>

          {project.description && (
            <div style={{
              fontSize: 12, color: C.txt2, marginBottom: 6,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520,
            }}>
              {project.description}
            </div>
          )}

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <StatPill label="Total" value={total} color={C.txt2} />
            <StatPill label="Included" value={stats.included || 0} color={C.grn} />
            <StatPill label="Excluded" value={stats.excluded || 0} color={C.red} />
            <StatPill label="Maybe" value={stats.maybe || 0} color={C.ylw} />
            {(stats.conflicts || 0) > 0 && (
              <StatPill label="Conflicts" value={stats.conflicts} color={C.gold} />
            )}
            {(stats.duplicates || 0) > 0 && (
              <StatPill label="Dupes" value={stats.duplicates} color={C.muted} />
            )}
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <ProgressBar pct={pct} color={progressColor} />
            </div>
            <span style={{ fontSize: 11, fontFamily: MONO, color: pct >= 100 ? C.grn : C.txt2, minWidth: 36, textAlign: 'right' }}>
              {pct}%
            </span>
          </div>

          {/* Linked META·LAB project (BUG 4) — clickable deep link to the EXACT
              linked project (prompt6 Task 3: never the generic project list). */}
          <div style={{ fontSize: 11.5, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {project.linkedMetaLabProjectId ? (
              <button
                onClick={onOpenLinked}
                title="Open the linked PecanRev project"
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: C.grn, fontSize: 11.5, fontFamily: FONT,
                  display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, maxWidth: '100%',
                }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              >
                <span>🔗</span>
                <span style={{ minWidth: 0 }}>Linked to PecanRev: <strong title={project.linkedMetaLabProjectTitle || 'project'} style={{ color: C.txt, display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{project.linkedMetaLabProjectTitle || 'project'}</strong> →</span>
              </button>
            ) : (
              <span style={{ color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ opacity: 0.6 }}>⛓️‍💥</span> Not linked to PecanRev
              </span>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5, minWidth: 0, overflowWrap: 'anywhere' }}>
            Owner: <span style={{ color: C.txt2 }}>{ownerName}</span>
            {leaders.length > 0 && (
              <> · Leader{leaders.length > 1 ? 's' : ''}: <span style={{ color: C.txt2 }}>{leaders.map(l => l.name || l.email).join(', ')}</span></>
            )}
            {' · '}{(project.memberCount ?? 1)} member{(project.memberCount ?? 1) !== 1 ? 's' : ''}
            {screened > 0 && total > 0 && ` · ${screened}/${total} screened`}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontFamily: MONO }}>
            Created {formatDate(project.createdAt)}
            {project.updatedAt && project.updatedAt !== project.createdAt && ` · Updated ${formatDate(project.updatedAt)}`}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onOpen}
            style={{
              background: C.acc2, border: 'none', color: C.accText,
              fontSize: 12, fontWeight: 600, fontFamily: FONT,
              padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
              transition: 'background 0.15s', whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.acc}
            onMouseLeave={e => e.currentTarget.style.background = C.acc2}
          >
            Open →
          </button>
          {project.isOwner !== false && (
            <button
              onClick={onDelete}
              style={{
                background: 'transparent', border: `1px solid ${C.brd}`,
                color: C.muted, fontSize: 12, fontFamily: FONT,
                padding: '6px 18px', borderRadius: 6, cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = C.red; e.currentTarget.style.borderColor = alpha(C.red, '60'); }}
              onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.brd; }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value, color }) {
  return (
    <span style={{ fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontWeight: 600, color, fontFamily: MONO }}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: alpha(C.bg, 0.82),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: C.surf, border: `1px solid ${C.brd2}`,
        borderRadius: 12, padding: '26px 28px',
        width: '100%', maxWidth: 480,
        boxShadow: `0 20px 60px ${C.shadow}`,
      }}>
        {children}
      </div>
    </div>
  );
}

// Styles
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: C.txt2,
  marginBottom: 5, marginTop: 14, letterSpacing: '0.04em', textTransform: 'uppercase',
};
const inputStyle = {
  width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
  borderRadius: 6, padding: '8px 12px', color: C.txt, fontSize: 13,
  fontFamily: FONT, outline: 'none',
};
const primaryBtnStyle = {
  background: C.acc2, border: 'none', color: C.accText, fontSize: 13, fontWeight: 600,
  fontFamily: FONT, padding: '8px 20px', borderRadius: 7, cursor: 'pointer',
};
const cancelBtnStyle = {
  background: 'transparent', border: `1px solid ${C.brd2}`, color: C.txt2,
  fontSize: 13, fontFamily: FONT, padding: '7px 18px', borderRadius: 7, cursor: 'pointer',
};
