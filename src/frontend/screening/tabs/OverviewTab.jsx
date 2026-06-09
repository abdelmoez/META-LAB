/**
 * OverviewTab.jsx — META·SIFT project command center (Part 10).
 *
 * The first-impression dashboard for a screening project: top status bar,
 * data summary tiles, whole-project progress, and per-member progress.
 * Read-mostly — members are managed in the Members tab; only the project
 * leader can change the project status here.
 *
 * Props:
 *   pid            — screening project id
 *   project        — current project object (from the shell)
 *   access         — { isLeader, myRole, canScreen, canChat, canResolveConflicts, blindMode }
 *   refreshProject — () => Promise, re-fetches the shell's project after a mutation
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import {
  Loading, ErrorBanner, ProgressBar, StatTile, Badge,
  Avatar, SectionLabel, Card,
} from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

// ── Status model ──────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started', color: C.muted },
  { value: 'in_progress', label: 'In Progress', color: C.acc },
  { value: 'done',        label: 'Done',        color: C.grn },
];

const ROLE_COLOR = { leader: C.gold, reviewer: C.acc, viewer: C.muted };
const STATUS_COLOR = { active: C.grn, inactive: C.muted, pending: C.ylw };

const n = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

// ── Component ─────────────────────────────────────────────────────────────────
export default function OverviewTab({ pid, project, access = {}, refreshProject }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await screeningApi.getOverview(pid);
      setData(d);
    } catch (e) {
      setError(e?.message || 'Failed to load the project overview.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const onStatusChange = useCallback(async (value) => {
    if (saving) return;
    if (data?.project?.progressStatus === value) return;
    setSaving(true);
    setSaveError(null);
    // Optimistic flip so the segmented control feels instant.
    setData(prev => (prev ? { ...prev, project: { ...prev.project, progressStatus: value } } : prev));
    try {
      await screeningApi.updateProject(pid, { progressStatus: value });
      if (refreshProject) await refreshProject();
      await load();
    } catch (e) {
      setSaveError(e?.message || 'Failed to update project status.');
      await load(); // re-sync from the server on failure
    } finally {
      setSaving(false);
    }
  }, [pid, saving, data, refreshProject, load]);

  // ── Loading / error / empty ──
  if (loading && !data) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease' }}>
        <Loading label="Loading project overview…" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease', paddingTop: 8 }}>
        <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ color: C.txt2, fontSize: 13, padding: '40px 0' }}>
        No overview data available for this project.
      </div>
    );
  }

  const proj = data.project || {};
  const ds   = data.dataSummary || {};
  const pp   = data.projectProgress || {};
  const members = Array.isArray(data.members) ? data.members : [];

  const title = proj.title || project?.title || 'Untitled project';
  const blindMode = proj.blindMode ?? access.blindMode ?? false;
  const status = proj.progressStatus || 'not_started';
  const completion = n(pp.completion);
  const completeColor = completion >= 100 ? C.grn : C.acc;
  const totalArticles = n(pp.totalArticles ?? ds.totalArticles);

  return (
    <div style={{ fontFamily: FONT, color: C.txt, animation: 'sift-fade 0.3s ease', maxWidth: 1080 }}>

      {/* ───────── A) Top bar ───────── */}
      <Card style={{ padding: '18px 20px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          {/* Title + meta */}
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <h1 style={{
                fontSize: 19, fontWeight: 700, color: C.txt, margin: 0,
                letterSpacing: '-0.02em', lineHeight: 1.25, wordBreak: 'break-word',
              }}>
                {title}
              </h1>
              {blindMode && <Badge color={C.gold} title="Author / journal info is hidden during screening">Blind Mode</Badge>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: C.teal }}>
                Quorum: <strong style={{ fontFamily: MONO, fontWeight: 600 }}>{n(proj.quorum)}</strong> reviewer{n(proj.quorum) === 1 ? '' : 's'} to advance
              </span>
              {proj.linkedMetaLabProjectId && (
                <span style={{ fontSize: 11.5, color: C.muted }}>
                  Linked to META·LAB <span style={{ fontFamily: MONO, color: C.txt2 }}>#{proj.linkedMetaLabProjectId}</span>
                </span>
              )}
            </div>
          </div>

          {/* Status control */}
          <div style={{ flexShrink: 0 }}>
            <SectionLabel>Project Status</SectionLabel>
            <StatusControl
              status={status}
              editable={!!access.isLeader}
              disabled={saving}
              onChange={onStatusChange}
            />
            {!access.isLeader && (
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, textAlign: 'right' }}>
                Only the project leader can change status.
              </div>
            )}
          </div>
        </div>

        {saveError && (
          <div style={{ marginTop: 14 }}>
            <ErrorBanner>{saveError}</ErrorBanner>
          </div>
        )}
      </Card>

      {/* ───────── B) Data Summary ───────── */}
      <section style={{ marginBottom: 20 }}>
        <SectionLabel right={loading ? <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>refreshing…</span> : null}>
          Data Summary
        </SectionLabel>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 12,
        }}>
          <StatTile label="Total Articles" value={fmt(totalArticles)} color={C.txt} />
          <StatTile label="Eligible for Second Review" value={fmt(n(ds.eligibleSecondReview))} color={C.teal} accent
                    sub="Passed title/abstract" />
          <StatTile label="Accepted to Extraction" value={fmt(n(ds.acceptedToExtraction))} color={C.grn} accent
                    sub={n(ds.rejectedSecond) > 0 ? `${fmt(n(ds.rejectedSecond))} rejected at full-text` : undefined} />
          <StatTile label="Disputed Decisions" value={fmt(n(ds.disputedDecisions))} color={C.gold} accent
                    sub="Reviewers disagree" />
          <StatTile
            label="Unresolved Conflicts"
            value={fmt(n(ds.unresolvedConflicts))}
            color={n(ds.unresolvedConflicts) > 0 ? C.red : C.gold}
            accent
            sub={n(ds.unresolvedConflicts) > 0 ? 'Needs resolution' : 'All clear'}
          />

          {ds.duplicateDetectionRun && (
            <>
              <StatTile label="Confirmed Duplicates" value={fmt(n(ds.confirmedDuplicates))} color={C.txt2} />
              <StatTile
                label="Unresolved Dup Groups"
                value={fmt(n(ds.unresolvedDuplicateGroups))}
                color={n(ds.unresolvedDuplicateGroups) > 0 ? C.ylw : C.txt2}
                accent={n(ds.unresolvedDuplicateGroups) > 0}
                sub={n(ds.resolvedDuplicateGroups) > 0 ? `${fmt(n(ds.resolvedDuplicateGroups))} resolved` : undefined}
              />
            </>
          )}
        </div>

        {!ds.duplicateDetectionRun && (
          <div style={{
            marginTop: 12, background: C.surf, border: `1px dashed ${C.brd}`,
            borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 15, opacity: 0.85 }} aria-hidden>🔍</span>
            <span style={{ fontSize: 12.5, color: C.muted }}>
              Run duplicate detection (<span style={{ color: C.txt2 }}>Duplicates</span> tab) to see duplicate metrics.
            </span>
          </div>
        )}
      </section>

      {/* ───────── C) Whole-Project Progress (leader-only, BUG 6) ───────── */}
      {data.isLeader && data.projectProgress && (
      <section style={{ marginBottom: 22 }}>
        <SectionLabel>Whole-Project Progress</SectionLabel>
        <Card>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: C.txt2 }}>
              Screening completion across all reviewers
            </span>
            <span style={{ fontSize: 28, fontWeight: 700, fontFamily: MONO, color: completeColor, lineHeight: 1 }}>
              {completion}%
            </span>
          </div>

          <ProgressBar pct={completion} color={completeColor} height={10} />

          <div style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
          }}>
            <StatTile label="Screened" value={fmt(n(pp.screened))} color={C.grn} />
            <StatTile label="Unscreened" value={fmt(n(pp.unscreened))} color={C.txt2} />
            <StatTile
              label="Conflicts"
              value={fmt(n(pp.conflicts))}
              color={n(pp.conflicts) > 0 ? C.red : C.txt2}
              accent={n(pp.conflicts) > 0}
            />
          </div>
        </Card>
      </section>
      )}

      {/* ───────── D) Member Progress ───────── */}
      {/* Leaders see every member + team comparison; regular members see only
          their own progress (the server sends only their row to non-leaders). */}
      <section>
        <SectionLabel right={data.isLeader ? (
          <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
            {members.length} member{members.length === 1 ? '' : 's'}
          </span>
        ) : null}>
          {data.isLeader ? 'Review Members' : 'My Progress'}
        </SectionLabel>

        {members.length === 0 ? (
          <Card style={{ textAlign: 'center', padding: '32px 24px', borderStyle: 'dashed' }}>
            <div style={{ fontSize: 26, marginBottom: 10 }} aria-hidden>👥</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, marginBottom: 4 }}>
              {data.isLeader ? 'No reviewers yet' : 'No progress yet'}
            </div>
            <div style={{ fontSize: 12, color: C.txt2 }}>
              {data.isLeader ? 'Add reviewers in the Members tab to start screening.' : 'Start screening records to see your progress here.'}
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {members.map(m => (
              <MemberRow key={m.id ?? m.userId ?? m.email} member={m} totalArticles={totalArticles} />
            ))}
          </div>
        )}

        {data.isLeader && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 12 }}>
            Manage members in the <span style={{ color: C.txt2 }}>Members</span> tab.
          </div>
        )}
      </section>
    </div>
  );
}

// ── Status segmented control ─────────────────────────────────────────────────
function StatusControl({ status, editable, disabled, onChange }) {
  return (
    <div
      role="group"
      aria-label="Project status"
      style={{
        display: 'inline-flex', background: C.surf, border: `1px solid ${C.brd}`,
        borderRadius: 8, padding: 3, gap: 2,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {STATUS_OPTIONS.map(opt => {
        const active = status === opt.value;
        const interactive = editable && !disabled && !active;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={!editable || disabled}
            aria-pressed={active}
            onClick={() => interactive && onChange(opt.value)}
            style={{
              fontFamily: FONT, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.01em',
              padding: '6px 13px', borderRadius: 6, border: '1px solid transparent',
              whiteSpace: 'nowrap',
              cursor: editable ? (disabled ? 'wait' : (active ? 'default' : 'pointer')) : 'default',
              background: active ? opt.color + '1f' : 'transparent',
              borderColor: active ? opt.color + '55' : 'transparent',
              color: active ? opt.color : C.txt2,
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { if (interactive) { e.currentTarget.style.background = C.card; e.currentTarget.style.color = C.txt; } }}
            onMouseLeave={e => { if (interactive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.txt2; } }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Per-member progress row ──────────────────────────────────────────────────
function MemberRow({ member, totalArticles }) {
  const name = member.name || member.email || 'Unknown reviewer';
  const role = member.role || 'reviewer';
  const status = member.status || 'active';
  const progress = n(member.progress);
  const screened = n(member.screened);
  const denom = n(totalArticles);

  const counts = [
    { key: 'included',  label: 'Incl', value: n(member.included),  color: C.grn },
    { key: 'excluded',  label: 'Excl', value: n(member.excluded),  color: C.red },
    { key: 'maybe',     label: 'Maybe', value: n(member.maybe),    color: C.ylw },
    { key: 'undecided', label: 'Todo', value: n(member.undecided), color: C.muted },
  ];

  return (
    <Card hover style={{ padding: '14px 16px' }}>
      {/* Header: identity + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
        <Avatar name={name} size={30} />
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          {member.email && member.email !== name && (
            <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {member.email}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <Badge color={ROLE_COLOR[role] || C.acc} title={`Role: ${role}`}>{role}</Badge>
          <Badge color={STATUS_COLOR[status] || C.muted} title={`Status: ${status}`}>{status}</Badge>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <ProgressBar pct={progress} color={progress >= 100 ? C.grn : C.acc} height={6} />
        </div>
        <span style={{ fontSize: 11, fontFamily: MONO, color: progress >= 100 ? C.grn : C.txt2, minWidth: 34, textAlign: 'right' }}>
          {progress}%
        </span>
      </div>

      {/* Footer: stacked infographic counts + screened ratio */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {counts.map(c => (
            <span key={c.key} title={`${c.value} ${c.key}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: c.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 600, color: c.color }}>{fmt(c.value)}</span>
              <span style={{ fontSize: 10.5, color: C.muted }}>{c.label}</span>
            </span>
          ))}
        </div>
        <span style={{ fontSize: 11, color: C.txt2, fontFamily: MONO }}>
          {fmt(screened)}/{fmt(denom)} screened ({progress}%)
        </span>
      </div>
    </Card>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v) {
  const num = n(v);
  return num >= 1000 ? num.toLocaleString('en-US') : String(num);
}
