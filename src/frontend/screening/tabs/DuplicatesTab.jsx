/**
 * DuplicatesTab.jsx — META·SIFT duplicate management (vertical layout).
 *
 * Replaces the old horizontal side-by-side duplicate view with a VERTICAL
 * one: each group's candidate records are stacked one per row, making
 * field-by-field comparison easy to scan. Every group carries a visible,
 * explainable similarity score (e.g. "92% similar" + "Exact DOI match").
 *
 * Props:
 *   pid            — screening project id
 *   project        — current project object (from the shell)
 *   access         — { isLeader, myRole, canScreen, ... }
 *   refreshProject — () => Promise, re-fetches the shell's project after a mutation
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, Badge, Card, EmptyState, Modal } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
// 92.md — detection progress is derived ONLY from the persisted job row (no fake %).
import { computeDuplicateJobProgress, formatDurationMs } from '../../../research-engine/screening/duplicateJobProgress.js';

const JOB_POLL_MS = 1500;
const jobIsActive = (j) => !!j && (j.status === 'queued' || j.status === 'processing');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp a possibly-fractional/odd similarity into an int 0-100. */
function pctOf(similarity) {
  let v = Number(similarity);
  if (!Number.isFinite(v)) return 0;
  if (v > 0 && v <= 1) v = v * 100; // tolerate a 0-1 fraction defensively
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Score → palette. ≥90 red-ish, 70-89 gold, <70 muted. */
function scoreColor(pct) {
  if (pct >= 90) return C.red;
  if (pct >= 70) return C.gold;
  return C.muted;
}

/** Colour for the typed duplicate verdict (se2.md §10). Non-mergeable types (related
 *  report / same study family) are teal — informational, "do NOT merge". */
function dupTypeColor(type, mergeable) {
  if (type === 'exact_duplicate') return C.red;
  if (type === 'probable_duplicate') return C.gold;
  if (type === 'possible_duplicate') return C.ylw;
  if (mergeable === false) return C.teal;
  return C.muted;
}

const pctLabel = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

const shortId = (id) => (id == null ? '?' : String(id).slice(-6));

// Small uppercase MONO field label, used to align fields across stacked records.
function FieldLabel({ children }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: C.muted, flexShrink: 0,
    }}>
      {children}
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DuplicatesTab({ pid, project, access = {}, refreshProject }) {
  const [groups, setGroups]   = useState([]);
  const [evaluation, setEvaluation] = useState(null); // se2.md §10 classifier accuracy (leader)
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // 92.md — duplicate detection is a durable background job. `job` mirrors the server
  // row (the ONLY progress source); the page reconnects to a running job on mount, so
  // a refresh or tab switch never loses the run and never starts a second one.
  const [job, setJob]               = useState(null);
  const [starting, setStarting]     = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const [primarySel, setPrimarySel] = useState({}); // { [gid]: recordId }
  const [resolving, setResolving]   = useState({}); // { [gid]: bool }
  const [resolveErr, setResolveErr] = useState({}); // { [gid]: string }
  const [showResolved, setShowResolved] = useState(false);

  // 65.md SCR-4 — bulk "resolve all exact duplicates" (confirm → run → counts).
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy]       = useState(false);
  const [bulkResult, setBulkResult]   = useState(null); // { resolvedGroups, flaggedDuplicates, mergedFieldCount, skippedGroups }
  const [bulkErr, setBulkErr]         = useState(null);

  const isLeader = !!access.isLeader;
  // 92.md rec round — the SERVER grants duplicate management to the owner, leaders,
  // AND members holding canManageDuplicates; the UI previously hid every control
  // from that third group. Mirror the server rule exactly.
  const canManage = !!(access.isOwner || access.isLeader || access.perms?.canManageDuplicates);

  // Seed the primary radio for a set of groups: prefer isPrimary, else first.
  const seedPrimaries = useCallback((gs) => {
    const init = {};
    (gs || []).forEach(g => {
      const recs = g.records || [];
      const primary = recs.find(r => r.isPrimary);
      if (primary) init[g.id] = primary.id;
      else if (recs.length) init[g.id] = recs[0].id;
    });
    setPrimarySel(init);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.listDuplicates(pid);
      const gs = Array.isArray(data?.groups) ? data.groups : [];
      setGroups(gs);
      setEvaluation(data?.evaluation || null);
      seedPrimaries(gs);
    } catch (e) {
      setError(e?.message || 'Failed to load duplicate groups.');
    } finally {
      setLoading(false);
    }
  }, [pid, seedPrimaries]);

  useEffect(() => { load(); }, [load]);

  // Keep stable handles for the poll loop (prop identity may change every render).
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const refreshRef = useRef(refreshProject);
  useEffect(() => { refreshRef.current = refreshProject; }, [refreshProject]);

  // Reconnect on mount / project switch: pick up the project's latest detection
  // job so a refreshed page re-attaches to a running job (or shows the last run's
  // outcome). Rec round: reset first so a pid switch never shows another project's
  // job, and never CLOBBER a job the user just started while this fetch was in
  // flight (functional set keeps the newer job).
  useEffect(() => {
    let gone = false;
    setJob(null);
    screeningApi.getDuplicateDetectStatus(pid)
      .then((r) => { if (!gone && r?.job) setJob((prev) => prev || r.job); })
      .catch(() => { /* status is best-effort; detection can still be started */ });
    return () => { gone = true; };
  }, [pid]);

  // Poll the job row while it is active; on a terminal state refresh the groups list.
  const jobId = job?.id;
  const jobActive = jobIsActive(job);
  useEffect(() => {
    if (!jobActive || !jobId) return undefined;
    let gone = false;
    const t = setInterval(async () => {
      try {
        const r = await screeningApi.getDuplicateJob(pid, jobId);
        if (gone || !r?.job) return;
        setJob(r.job);
        if (!jobIsActive(r.job)) {
          await loadRef.current();
          if (refreshRef.current) await refreshRef.current();
        }
      } catch { /* transient poll error — keep polling */ }
    }, JOB_POLL_MS);
    return () => { gone = true; clearInterval(t); };
  }, [pid, jobId, jobActive]);

  // 92.md rec round — cross-session freshness: while NO job is active locally, a
  // slow status poll notices runs started (or finished) by other members, attaches
  // to them, and refreshes the groups list on their completion. This is the
  // client-side consumer of the worker's completion poke for tabs left open.
  useEffect(() => {
    if (jobActive) return undefined; // the fast poll above owns updates
    let gone = false;
    const t = setInterval(async () => {
      try {
        const r = await screeningApi.getDuplicateDetectStatus(pid);
        if (gone || !r?.job) return;
        const latest = r.job;
        setJob((prev) => {
          if (prev && prev.id === latest.id && prev.status === latest.status) return prev;
          if (!jobIsActive(latest)) loadRef.current().catch(() => {});
          return latest;
        });
      } catch { /* best-effort */ }
    }, 10_000);
    return () => { gone = true; clearInterval(t); };
  }, [pid, jobActive]);

  const handleDetect = useCallback(async () => {
    if (starting || jobActive) return;
    setStarting(true);
    setError(null);
    try {
      // 202 + the job row; if a run is already active the server returns THAT job,
      // so a double click (or two members clicking) can never start a second sweep.
      const res = await screeningApi.detectDuplicates(pid);
      if (res?.job) setJob(res.job);
    } catch (e) {
      setError(e?.message || 'Could not start duplicate detection.');
    } finally {
      setStarting(false);
    }
  }, [pid, starting, jobActive]);

  const handleCancelJob = useCallback(async () => {
    if (!jobId || cancelBusy) return;
    setCancelBusy(true);
    try {
      const r = await screeningApi.cancelDuplicateJob(pid, jobId);
      if (r?.job) setJob(r.job);
    } catch { /* the poll reflects the real state */ }
    finally { setCancelBusy(false); }
  }, [pid, jobId, cancelBusy]);

  const handleResolve = useCallback(async (gid) => {
    const primaryId = primarySel[gid];
    if (!primaryId || resolving[gid]) return;
    setResolving(prev => ({ ...prev, [gid]: true }));
    setResolveErr(prev => ({ ...prev, [gid]: '' }));
    try {
      await screeningApi.resolveDuplicateGroup(pid, gid, { primaryId });
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setResolveErr(prev => ({ ...prev, [gid]: e?.message || 'Failed to resolve this group.' }));
    } finally {
      setResolving(prev => ({ ...prev, [gid]: false }));
    }
  }, [pid, primarySel, resolving, load, refreshProject]);

  // prompt23 Task 10 — "Not duplicates": the suggestion is a false positive; keep
  // every record active and resolve the group without merging.
  const handleKeepAll = useCallback(async (gid) => {
    if (resolving[gid]) return;
    setResolving(prev => ({ ...prev, [gid]: true }));
    setResolveErr(prev => ({ ...prev, [gid]: '' }));
    try {
      await screeningApi.resolveDuplicateGroup(pid, gid, { keepAll: true });
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setResolveErr(prev => ({ ...prev, [gid]: e?.message || 'Failed to update this group.' }));
    } finally {
      setResolving(prev => ({ ...prev, [gid]: false }));
    }
  }, [pid, resolving, load, refreshProject]);

  // 65.md SCR-4 — bulk-resolve every all-exact group server-side (non-destructive:
  // primaries kept + blank-filled, the rest only flagged as duplicates).
  const handleResolveExact = useCallback(async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    setBulkErr(null);
    try {
      const r = await screeningApi.resolveExactDuplicates(pid);
      setBulkResult(r);
      setBulkConfirm(false);
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setBulkErr(e?.message || 'Bulk resolution failed.');
    } finally {
      setBulkBusy(false);
    }
  }, [pid, bulkBusy, load, refreshProject]);

  const unresolved = groups.filter(g => !g.resolved);
  const resolved   = groups.filter(g => g.resolved);
  const exactUnresolved = unresolved.filter(g => g.dupType === 'exact_duplicate').length;

  // ── Loading / error (first paint) ──
  if (loading && groups.length === 0) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease' }}>
        <Loading label="Loading duplicate groups…" />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, color: C.txt, animation: 'sift-fade 0.3s ease', maxWidth: 1400 }}>

      {/* ───────── Header ───────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', marginBottom: 18,
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
            Duplicate Management
          </h1>
          <div style={{ fontSize: 12.5, color: C.txt2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span><strong style={{ fontFamily: MONO, color: unresolved.length > 0 ? C.ylw : C.txt2 }}>{unresolved.length}</strong> unresolved</span>
            <span style={{ color: C.brd2 }}>·</span>
            <span><strong style={{ fontFamily: MONO, color: C.grn }}>{resolved.length}</strong> resolved</span>
          </div>
          {isLeader && <DupAccuracy ev={evaluation} />}
        </div>

        {canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {exactUnresolved > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => { setBulkErr(null); setBulkConfirm(true); }}
                  disabled={bulkBusy}
                  title="Resolve every group whose records share an exact DOI/PMID — keeps the most complete record, flags the rest"
                >
                  {bulkBusy ? 'Resolving…' : `Resolve ${exactUnresolved} exact group${exactUnresolved === 1 ? '' : 's'}`}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={handleDetect}
                disabled={starting || jobActive}
                title={jobActive ? 'A detection run is already in progress for this project' : 'Scan the project for duplicate records'}
              >
                {jobActive ? 'Detection in progress…' : starting ? 'Starting…' : '⟳ Detect Duplicates'}
              </Button>
            </div>
            {bulkResult && (
              <div style={{ fontSize: 11.5, fontFamily: MONO, color: C.grn, textAlign: 'right' }}>
                {bulkResult.resolvedGroups} group{bulkResult.resolvedGroups === 1 ? '' : 's'} resolved · {bulkResult.flaggedDuplicates} flagged
                {bulkResult.mergedFieldCount > 0 ? ` · ${bulkResult.mergedFieldCount} field${bulkResult.mergedFieldCount === 1 ? '' : 's'} filled` : ''}
                {bulkResult.skippedGroups > 0 ? ` · ${bulkResult.skippedGroups} left for review` : ''}
              </div>
            )}
            {bulkErr && !bulkConfirm && (
              <div style={{ fontSize: 11, fontFamily: MONO, color: C.red }}>{bulkErr}</div>
            )}
          </div>
        )}
      </div>

      {/* 65.md SCR-4 — bulk-resolve confirmation */}
      {bulkConfirm && (
        <Modal onClose={() => !bulkBusy && setBulkConfirm(false)} width={460} label="Resolve all exact duplicates">
          <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 10 }}>Resolve all exact duplicates?</div>
          <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, marginBottom: 6 }}>
            This resolves <strong style={{ color: C.txt }}>{exactUnresolved}</strong> group{exactUnresolved === 1 ? '' : 's'} whose
            records share an <strong style={{ color: C.txt }}>exact DOI or PMID</strong>. In each group the most complete record is
            kept as primary (missing abstract/DOI/PMID are filled from the copies — existing values are never overwritten) and the
            other copies are flagged as duplicates. Nothing is deleted; probable/possible groups stay for human review.
          </div>
          {bulkErr && <div style={{ fontSize: 12, color: C.red, marginBottom: 6 }}>{bulkErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Button variant="ghost" onClick={() => setBulkConfirm(false)} disabled={bulkBusy}>Cancel</Button>
            <Button variant="primary" onClick={handleResolveExact} disabled={bulkBusy}>
              {bulkBusy ? 'Resolving…' : 'Resolve exact duplicates'}
            </Button>
          </div>
        </Modal>
      )}

      {/* ───────── Error ───────── */}
      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner onRetry={load}>{error}</ErrorBanner>
        </div>
      )}

      {/* ───────── Detection job: live progress / last outcome (92.md) ───────── */}
      {job && jobActive && (
        <DetectionProgressPanel job={job} canManage={canManage} onCancel={handleCancelJob} cancelBusy={cancelBusy} />
      )}
      {job && !jobActive && (
        <DetectionOutcome job={job} canManage={canManage} onRetry={handleDetect} retryBusy={starting} />
      )}

      {/* ───────── Empty ───────── */}
      {groups.length === 0 ? (
        <EmptyState
          icon="🧬"
          title="No duplicate groups"
          action={canManage ? (
            <Button variant="primary" onClick={handleDetect} disabled={starting || jobActive}>
              {jobActive ? 'Detection in progress…' : starting ? 'Starting…' : '⟳ Detect Duplicates'}
            </Button>
          ) : null}
        >
          Run detection to find duplicates by DOI, PMID, and fuzzy title match.
        </EmptyState>
      ) : (
        <>
          {/* ───────── Unresolved ───────── */}
          {unresolved.length > 0 && (
            <section style={{ marginBottom: 28 }}>
              <SectionHeader label="Unresolved Groups" count={unresolved.length} countColor={C.ylw} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {unresolved.map(group => (
                  <DuplicateGroup
                    key={group.id}
                    group={group}
                    isLeader={canManage}
                    selectedId={primarySel[group.id]}
                    onSelect={(rid) => setPrimarySel(prev => ({ ...prev, [group.id]: rid }))}
                    onResolve={() => handleResolve(group.id)}
                    onKeepAll={() => handleKeepAll(group.id)}
                    resolving={!!resolving[group.id]}
                    resolveError={resolveErr[group.id]}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ───────── Resolved (collapsible) ───────── */}
          {resolved.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowResolved(v => !v)}
                style={{
                  background: 'none', border: 'none', color: C.txt2, cursor: 'pointer',
                  fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em',
                  textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8,
                  marginBottom: 12, padding: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = C.txt; }}
                onMouseLeave={e => { e.currentTarget.style.color = C.txt2; }}
              >
                <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: showResolved ? 'rotate(90deg)' : 'none' }}>▶</span>
                Resolved Groups
                <span style={{
                  background: alpha(C.grn, '20'), border: `1px solid ${alpha(C.grn, '40')}`, color: C.grn,
                  borderRadius: 10, padding: '0 7px', fontSize: 10, letterSpacing: 0,
                }}>{resolved.length}</span>
              </button>

              {showResolved && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'sift-fade 0.25s ease' }}>
                  {resolved.map(group => (
                    <DuplicateGroup
                      key={group.id}
                      group={group}
                      isLeader={canManage}
                      selectedId={primarySel[group.id]}
                      onSelect={() => {}}
                      onResolve={() => {}}
                      resolving={false}
                      resolveError={null}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Detection job progress panel (92.md) ────────────────────────────────────
// Everything shown here comes from the persisted job row: stage, counters, who
// started it and when. The percentage is computed by the shared pure module
// (duplicateJobProgress.js) — never a timer, never fake, never 100 mid-run.
const nfmt = (n) => (Number(n) || 0).toLocaleString();

function DetectionProgressPanel({ job, canManage, onCancel, cancelBusy }) {
  const p = computeDuplicateJobProgress(job, Date.now());
  const barColor = p.state === 'cancelling' ? C.gold : p.state === 'retrying' ? C.gold : C.acc;
  const stateLabel =
    p.state === 'queued' ? 'Queued' :
    p.state === 'retrying' ? 'Retrying after an interruption' :
    p.state === 'cancelling' ? 'Cancelling…' : 'Running';

  const startedBits = [];
  if (job.createdByName) startedBits.push(`Started by ${job.createdByName}`);
  if (job.startedAt || job.createdAt) {
    try { startedBits.push(new Date(job.startedAt || job.createdAt).toLocaleTimeString()); } catch { /* ignore */ }
  }

  return (
    <Card style={{ padding: '14px 18px', marginBottom: 18, borderColor: alpha(barColor, '55') }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: barColor, background: alpha(barColor, '1a'), border: `1px solid ${alpha(barColor, '55')}`,
            borderRadius: 6, padding: '3px 9px', flexShrink: 0,
          }}>
            {stateLabel}
          </span>
          {/* Stage only in the live region — counts change too often to announce. */}
          <span aria-live="polite" style={{ fontSize: 12.5, color: C.txt, fontWeight: 600, minWidth: 0 }}>
            {p.stageLabel}…
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: C.txt }}>{p.percent}%</span>
          {canManage && (
            <Button variant="ghost" onClick={onCancel} disabled={cancelBusy || p.state === 'cancelling'}
              title="Stop this detection run — groups already saved are kept">
              {p.state === 'cancelling' ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
        </div>
      </div>

      <div
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}
        aria-label="Duplicate detection progress"
        style={{ marginTop: 10, height: 8, borderRadius: 4, background: C.brd, overflow: 'hidden' }}
      >
        <div style={{ width: `${p.percent}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width 0.6s ease' }} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 10, fontSize: 11.5, fontFamily: MONO, color: C.txt2 }}>
        <span>{nfmt(job.processedRecords)} / {nfmt(job.totalRecords)} records</span>
        {Number(job.comparisonsTotal) > 0 && (
          <span>{nfmt(job.comparisonsDone)} / {nfmt(job.comparisonsTotal)} comparisons</span>
        )}
        <span style={{ color: Number(job.groupsFound) > 0 ? C.ylw : C.txt2 }}>
          {nfmt(job.groupsFound)} possible group{Number(job.groupsFound) === 1 ? '' : 's'} so far
        </span>
        <span>elapsed {formatDurationMs(p.elapsedMs)}</span>
        {p.etaMs != null && <span>~{formatDurationMs(p.etaMs)} left</span>}
      </div>

      {startedBits.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: C.muted }}>
          {startedBits.join(' · ')} — you can leave this page; detection keeps running.
        </div>
      )}
    </Card>
  );
}

// Terminal outcome of the most recent run: completed summary, actionable failure
// with a safe retry, or a cancelled note. Survives a page reload (comes from the
// latest job row, not component state).
function DetectionOutcome({ job, canManage, onRetry, retryBusy }) {
  if (job.status === 'failed') {
    return (
      // role="alert" — screen readers must hear the failure even though the live
      // progress region unmounted with the panel (rec round).
      <div role="alert" style={{
        marginBottom: 18, padding: '10px 14px', borderRadius: 8,
        background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '44')}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12.5, color: C.red }}>
          Duplicate detection failed{job.error ? ` — ${job.error}` : '.'}
        </span>
        {canManage && (
          <Button variant="ghost" onClick={onRetry} disabled={retryBusy}>{retryBusy ? 'Starting…' : 'Retry detection'}</Button>
        )}
      </div>
    );
  }
  if (job.status === 'cancelled') {
    return (
      <div role="status" style={{ marginBottom: 18, fontSize: 11.5, fontFamily: MONO, color: C.gold }}>
        Last detection run was cancelled — groups saved before cancelling were kept.
      </div>
    );
  }
  // completed
  const found = Number(job.groupsFound) || 0;
  const summary = found === 0
    ? 'Detection finished — no duplicates were found.'
    : `Detection finished — ${nfmt(found)} duplicate group${found === 1 ? '' : 's'} (${nfmt(job.groupsCreated)} new, ${nfmt(job.groupsUpdated)} updated) · ${nfmt(job.recordsFlagged)} record${Number(job.recordsFlagged) === 1 ? '' : 's'} newly flagged`;
  return (
    // role="status" — announce completion once the live progress region is gone.
    <div role="status" style={{ marginBottom: 18, fontSize: 11.5, fontFamily: MONO, color: found === 0 ? C.txt2 : C.grn }}>
      {summary}
      {job.completedAt ? <span style={{ color: C.muted }}> · {new Date(job.completedAt).toLocaleString()}</span> : null}
    </div>
  );
}

// ── Classifier accuracy line (leader; se2.md §10) — honest until enough labels ──
function DupAccuracy({ ev }) {
  if (!ev) return null;
  const logged = ev.labelCount || 0;  // total reviewer decisions recorded (incl. 'uncertain')
  const scored = ev.n || 0;           // labels actually scored by the harness (excl. 'uncertain')
  if (scored < 20) {
    return (
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
        Duplicate classifier not yet validated — {logged} reviewer decision{logged === 1 ? '' : 's'} logged (need ≥ 20 scored to estimate accuracy).
      </div>
    );
  }
  return (
    <div style={{ fontSize: 11, color: C.txt2, marginTop: 4, fontFamily: MONO }}>
      Classifier vs {ev.n} labels: precision {pctLabel(ev.precision)} · recall {pctLabel(ev.recall)} · false-merge {pctLabel(ev.falseMergeRate)}
    </div>
  );
}

// ── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ label, count, countColor = C.muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{
        fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.muted,
      }}>
        {label}
      </span>
      <span style={{
        background: alpha(countColor, '20'), border: `1px solid ${alpha(countColor, '40')}`, color: countColor,
        borderRadius: 10, padding: '0 8px', fontSize: 10, fontFamily: MONO, fontWeight: 600,
      }}>
        {count}
      </span>
    </div>
  );
}

// ── DuplicateGroup ───────────────────────────────────────────────────────────
function DuplicateGroup({ group, isLeader, selectedId, onSelect, onResolve, onKeepAll, resolving, resolveError }) {
  const records  = group.records || [];
  const resolved = !!group.resolved;
  const pct      = pctOf(group.similarity);
  const simColor = scoreColor(pct);
  const typeColor = dupTypeColor(group.dupType, group.mergeable);
  const editable = isLeader && !resolved;

  return (
    <Card style={{ padding: '16px 18px', opacity: resolved ? 0.82 : 1, borderColor: resolved ? C.brd : C.brd2 }}>

      {/* ── Group header: similarity + reason + status ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Group</span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>#{shortId(group.id)}</span>

            {/* Prominent similarity badge — colored by score. */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 12, fontWeight: 700, fontFamily: MONO,
              background: alpha(simColor, '1f'), border: `1px solid ${alpha(simColor, '55')}`, color: simColor,
              borderRadius: 6, padding: '3px 10px', letterSpacing: '0.02em',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: simColor, flexShrink: 0 }} />
              {pct}% similar
            </span>

            {/* Typed verdict (se2.md §10) — colour signals whether a merge may be suggested. */}
            {group.dupTypeLabel && (
              <span title={group.mergeable === false ? 'Likely separate reports of the same study — not a duplicate record to merge.' : undefined}
                style={{
                  fontSize: 10.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.02em',
                  color: typeColor, background: alpha(typeColor, '1a'), border: `1px solid ${alpha(typeColor, '55')}`,
                  borderRadius: 6, padding: '3px 9px',
                }}>
                {group.dupTypeLabel}
              </span>
            )}

            {resolved && <Badge color={C.grn}>Resolved</Badge>}
          </div>

          {group.similarityReason && (
            <div style={{ fontSize: 11.5, fontStyle: 'italic', color: C.txt2, marginTop: 7, lineHeight: 1.4 }}>
              {group.similarityReason}
            </div>
          )}

          {group.dupConflicts?.length > 0 && (
            <div style={{ fontSize: 11, color: C.gold, marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.4 }}>
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span>Conflicting metadata: {group.dupConflicts.join(' · ')}. Verify before merging.</span>
            </div>
          )}
        </div>

        <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {records.length} record{records.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ── Records stacked VERTICALLY (one per row) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {records.map(record => (
          <RecordRow
            key={record.id}
            record={record}
            groupId={group.id}
            isSelected={record.id === selectedId}
            editable={editable}
            onSelect={() => editable && onSelect(record.id)}
          />
        ))}
      </div>

      {/* ── Resolve action (unresolved + leader only) ── */}
      {editable && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: group.mergeable === false ? C.teal : C.muted, maxWidth: 460, lineHeight: 1.45 }}>
            {group.mergeable === false
              ? 'These look like separate reports of the same study (e.g. preprint + journal article, or a secondary analysis). Prefer “Not duplicates — keep all” unless you confirm they are the same record.'
              : 'Keep the selected record and mark the rest as duplicates — or keep them all if these aren’t duplicates.'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            {resolveError && (
              <span style={{ fontSize: 11, color: C.red, fontFamily: MONO }}>{resolveError}</span>
            )}
            <Button
              variant="ghost"
              onClick={onKeepAll}
              disabled={resolving}
              title="These are not duplicates — keep every record as a separate study"
            >
              {resolving ? '…' : 'Not duplicates — keep all'}
            </Button>
            <Button
              variant="primary"
              onClick={onResolve}
              disabled={resolving || !selectedId}
              title={selectedId ? 'Mark the selected record as primary' : 'Select a record to keep first'}
            >
              {resolving ? 'Resolving…' : 'Keep selected & mark others duplicate'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── RecordRow — a single stacked record sub-card ─────────────────────────────
function RecordRow({ record, groupId, isSelected, editable, onSelect }) {
  const title    = record.title || 'Untitled record';
  const metaBits = [record.authors, record.year, record.journal].filter(Boolean);
  const [showFull, setShowFull] = useState(false);
  const abstract = record.abstract || '';
  const isLong = abstract.length > 240; // worth a "Show more" toggle

  return (
    <div
      onClick={onSelect}
      style={{
        position: 'relative',
        background: isSelected ? C.grnBg : C.surf,
        border: `1px solid ${isSelected ? alpha(C.grn, '66') : C.brd}`,
        borderRadius: 8, padding: '12px 14px',
        cursor: editable ? 'pointer' : 'default',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {/* Top line: radio + title + PRIMARY badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {editable ? (
          <input
            type="radio"
            name={`primary-${groupId}`}
            checked={isSelected}
            onChange={onSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label="Keep this as primary"
            style={{ accentColor: C.grn, marginTop: 3, cursor: 'pointer', flexShrink: 0 }}
          />
        ) : (
          <span style={{
            width: 14, height: 14, borderRadius: '50%', flexShrink: 0, marginTop: 3,
            border: `2px solid ${isSelected ? C.grn : C.brd2}`,
            background: isSelected ? C.grn : 'transparent', boxSizing: 'border-box',
          }} />
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: isSelected ? C.txt : C.txt,
              lineHeight: 1.4, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere',
            }}>
              {title}
            </div>
            {isSelected && <Badge color={C.grn}>Primary</Badge>}
          </div>

          {/* Authors · Year · Journal */}
          {metaBits.length > 0 && (
            <div style={{ fontSize: 11.5, color: C.txt2, marginTop: 5, lineHeight: 1.45, minWidth: 0, overflowWrap: 'anywhere' }}>
              {metaBits.map((b, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ color: C.brd2, margin: '0 6px' }}>·</span>}
                  {b}
                </span>
              ))}
            </div>
          )}

          {/* Identifier fields — aligned, subtly labeled */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 9 }}>
            <IdField label="DOI">
              {record.doi ? (
                <a
                  href={`https://doi.org/${record.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: C.acc, textDecoration: 'none', fontFamily: MONO, fontSize: 11 }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  {record.doi}
                </a>
              ) : <Dash />}
            </IdField>

            <IdField label="PMID">
              {record.pmid
                ? <span style={{ fontFamily: MONO, fontSize: 11, color: C.txt2 }}>{record.pmid}</span>
                : <Dash />}
            </IdField>

            <IdField label="Source">
              {record.sourceDb
                ? <span style={{ fontFamily: MONO, fontSize: 11, color: C.txt2 }}>{record.sourceDb}</span>
                : <Dash />}
            </IdField>
          </div>

          {/* Abstract preview — 3-line clamp by default, expandable (prompt23 Task 10) */}
          {abstract && (
            <div style={{ marginTop: 10 }}>
              <FieldLabel>Abstract</FieldLabel>
              <div style={{
                fontSize: 11.5, color: C.txt2, lineHeight: 1.5, marginTop: 3,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                ...(showFull ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
              }}>
                {abstract}
              </div>
              {isLong && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowFull(v => !v); }}
                  style={{ marginTop: 4, background: 'none', border: 'none', color: C.acc, fontSize: 11, fontFamily: FONT, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                >
                  {showFull ? '▲ Show less' : '▼ Show more'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small field helpers ──────────────────────────────────────────────────────
function IdField({ label, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <FieldLabel>{label}</FieldLabel>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>{children}</span>
    </span>
  );
}

function Dash() {
  return <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>—</span>;
}
