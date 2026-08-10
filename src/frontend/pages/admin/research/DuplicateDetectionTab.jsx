/**
 * research/DuplicateDetectionTab.jsx — 109.md §§8-10, 45, 46.
 *
 * Service health, the durable job queue, the environment-managed worker tuning,
 * and the ONE administrative action 109 §9 allows here: a precondition-guarded,
 * reason-carrying requeue of a failed or stuck job.
 *
 * What this deliberately does NOT offer: "force rerun", "invalidate result" or any
 * bulk mutation. The server exposes no such route — reviving a finished job would
 * rewrite history, and a genuine re-run is a new detection job started from the
 * project, which reconciles with the same safe logic as any other run and can
 * never erase decisions or manually resolved duplicates (§9).
 *
 * Every number on this page is backed by a real column (§46 forbids invented
 * metrics); `cpuMs`/`heapUsedMb` never leave the server, so they are absent here.
 */
import { useCallback, useEffect, useState } from 'react';
import { C, MONO, alpha } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import { OPS_SETTINGS } from '../../../../shared/opsSettingsCatalog.js';
import {
  Badge, Chip, ConfirmModal, DangerBadge, ErrorBox, FilterRow, LabelledField,
  NoticeBox, Pager, SectionCard, SettingShell, SourceBadge, Spinner, Table,
  fmtAgo, fmtDateTime, fmtDuration, ghostBtn, inputStyle, selectStyle,
} from './primitives.jsx';
import { ReadOnlyEntry } from './SettingRows.jsx';

const DUP_ENTRIES = OPS_SETTINGS.filter((e) => e.category === 'duplicates');
const ENV_ENTRIES = DUP_ENTRIES.filter((e) => e.envVar);
const AVAILABILITY = DUP_ENTRIES.find((e) => e.key === 'duplicates.allowDuplicateDetection');
const THRESHOLD = DUP_ENTRIES.find((e) => e.key === 'duplicates.titleThreshold');

/** envVar → the key the health endpoint reports the RUNNING value under. */
const WORKER_VALUE_KEYS = {
  SCREEN_DUP_STUCK_MS: 'stuckMs',
  SCREEN_DUP_READ_BATCH: 'readBatch',
  SCREEN_DUP_SAVE_BATCH: 'saveBatch',
  SCREEN_DUP_MAX_BLOCK: 'maxBlock',
  SCREEN_DUP_MAX_COMPARISONS: 'maxComparisons',
  SCREEN_DUP_YIELD_EVERY: 'yieldEvery',
  SCREEN_DUP_PROGRESS_MS: 'progressMs',
  SCREEN_DUP_MAX_ACTIVE_PER_USER: 'maxActivePerUser',
  SCREEN_DUP_MAX_GROUP_SIZE: 'maxGroupSize',
};

const STATUSES = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
const STATUS_TONES = {
  queued: C.acc, processing: C.ylw, completed: C.grn,
  failed: C.red, cancelled: C.muted, stale: C.red,
};
const HEALTH_TONES = { healthy: C.grn, degraded: C.ylw, disabled: C.muted };
const PER_PAGE = 20;

function canRequeue(job) {
  if (!job) return false;
  if (Number(job.retriesRemaining) <= 0) return false;
  if (job.status === 'failed') return true;
  return job.status === 'processing' && job.stale === true;
}

export default function DuplicateDetectionTab() {
  const [health, setHealth] = useState(null);
  const [healthErr, setHealthErr] = useState('');
  const [jobs, setJobs] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PER_PAGE, hasMore: false });
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobsErr, setJobsErr] = useState('');
  const [filters, setFilters] = useState({ status: '', projectId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(null); // job awaiting requeue confirmation
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const loadHealth = useCallback(() => {
    setHealthErr('');
    adminApi.research.duplicateJobHealth()
      .then(setHealth)
      .catch((e) => { setHealth(null); setHealthErr(e?.message || 'Could not load duplicate-detection health.'); });
  }, []);

  const loadJobs = useCallback(() => {
    setLoadingJobs(true);
    setJobsErr('');
    adminApi.research.duplicateJobs({ ...filters, page, limit: PER_PAGE })
      .then((d) => {
        setJobs(Array.isArray(d?.jobs) ? d.jobs : []);
        setMeta({ total: d?.total || 0, page: d?.page || 1, limit: d?.limit || PER_PAGE, hasMore: !!d?.hasMore });
      })
      .catch((e) => { setJobs([]); setJobsErr(e?.message || 'Could not load duplicate-detection jobs.'); })
      .finally(() => setLoadingJobs(false));
  }, [filters, page]);

  useEffect(() => { loadHealth(); }, [loadHealth]);
  useEffect(() => { loadJobs(); }, [loadJobs]);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  async function confirmRequeue() {
    if (!pending) return;
    setBusy(true);
    try {
      await adminApi.research.requeueDuplicateJob(pending.id, reason.trim());
      setPending(null);
      setReason('');
      loadJobs();
      loadHealth();
    } catch (e) {
      setJobsErr(e?.message || 'Requeue failed.');
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const q = health?.queue || {};
  const durations = health?.durations || {};
  const worker = health?.workerConfig || null;

  const columns = [
    {
      key: 'job',
      label: 'Job',
      render: (j) => (
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }} title={j.id}>{String(j.id).slice(0, 8)}</div>
          <div style={{ color: C.txt, marginTop: 2 }}>{j.projectTitle || <span style={{ fontFamily: MONO, color: C.muted }}>{String(j.projectId || '').slice(0, 8)}</span>}</div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (j) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <Badge text={j.status} color={STATUS_TONES[j.status] || C.muted} />
          {j.stale && <Badge text="stale heartbeat" color={C.red} />}
          {j.cancelRequested && <Badge text="cancel requested" color={C.ylw} />}
          <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>{j.stage || '—'}</span>
        </div>
      ),
    },
    {
      key: 'progress',
      label: 'Records / comparisons',
      render: (j) => (
        <div style={{ fontFamily: MONO, fontSize: 11 }}>
          <div>{j.processedRecords ?? 0} / {j.totalRecords ?? 0} records</div>
          <div style={{ color: C.muted }}>{j.comparisonsDone ?? 0} / {j.comparisonsTotal ?? 0} comparisons</div>
        </div>
      ),
    },
    {
      key: 'groups',
      label: 'Duplicates',
      render: (j) => (
        <div style={{ fontFamily: MONO, fontSize: 11 }}>
          <div>{j.groupsFound ?? 0} groups · {j.recordsFlagged ?? 0} flagged</div>
          <div style={{ color: C.muted }}>{j.exactMatches ?? 0} exact · {j.fuzzyMatches ?? 0} fuzzy</div>
        </div>
      ),
    },
    {
      key: 'timing',
      label: 'Timing',
      render: (j) => (
        <div style={{ fontSize: 11 }}>
          <div title={fmtDateTime(j.createdAt)}>started {j.startedAt ? fmtAgo(j.startedAt) : '—'}</div>
          <div style={{ color: C.muted }}>{j.completedAt ? `finished ${fmtAgo(j.completedAt)}` : `heartbeat ${fmtAgo(j.heartbeatAt)}`}</div>
          <div style={{ color: C.muted }}>duration {fmtDuration(j.durationMs)}</div>
        </div>
      ),
    },
    {
      key: 'attempts',
      label: 'Retries',
      render: (j) => (
        <span style={{ fontFamily: MONO, fontSize: 11 }} title={`${j.retriesRemaining} of ${j.maxAttempts} attempts remaining`}>
          {j.attempts ?? 0}/{j.maxAttempts ?? '?'}
        </span>
      ),
    },
    {
      key: 'who',
      label: 'Started by',
      render: (j) => <span style={{ fontSize: 11 }}>{j.createdByName || '—'}</span>,
    },
    {
      key: 'error',
      label: 'Last error',
      render: (j) => (
        <span style={{ color: j.error ? C.red : C.muted, fontSize: 11, display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.error || ''}>
          {j.error || '—'}
        </span>
      ),
    },
    {
      key: 'action',
      label: '',
      render: (j) => (canRequeue(j) ? (
        <button
          data-testid={`rg-requeue-${j.id}`}
          onClick={() => { setReason(''); setPending(j); }}
          style={{ ...ghostBtn, color: C.acc, borderColor: alpha(C.acc, '40'), background: alpha(C.acc, '10') }}
        >
          <Icon name="refresh" size={12} /> Requeue
        </button>
      ) : null),
    },
  ];

  return (
    <div>
      {/* ── Service health (109.md §§8, 46) ─────────────────────────────── */}
      <SectionCard
        testId="rg-dup-health"
        title="Deduplication service health"
        subtitle="Live queue state from the ScreenDuplicateJob table. Degraded means a job failed in the last 24 hours or a processing slot is past its heartbeat cutoff."
        action={
          <button data-testid="rg-dup-reload" onClick={() => { loadHealth(); loadJobs(); }} style={ghostBtn}>
            <Icon name="refresh" size={12} /> Reload
          </button>
        }
      >
        {healthErr && <div style={{ padding: '14px 18px' }}><ErrorBox msg={healthErr} /></div>}
        {!health && !healthErr && <div style={{ padding: 32, textAlign: 'center' }}><Spinner size={18} /></div>}
        {health && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px 0', flexWrap: 'wrap' }}>
              <Badge testId="rg-dup-health-badge" text={health.health} color={HEALTH_TONES[health.health] || C.muted} />
              <span style={{ fontSize: 12, color: C.txt2 }}>
                {health.enabled
                  ? 'Duplicate detection is available to reviewers.'
                  : 'Duplicate detection is switched off for reviewers — the enqueue endpoint refuses new runs with 403.'}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px' }}>
              {STATUSES.map((s) => <Chip key={s} label={s} value={Number(q[s] || 0)} color={STATUS_TONES[s]} testId={`rg-dup-chip-${s}`} />)}
              <Chip label="stale" value={Number(q.stale || 0)} color={C.red} testId="rg-dup-chip-stale" />
              <Chip label="failures 24h" value={Number(health.failures24h || 0)} color={C.red} />
            </div>
            <div style={{ padding: '0 18px 16px', fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
              Processing time over the last {durations.sampleSize || 0} completed run{durations.sampleSize === 1 ? '' : 's'}:{' '}
              average {fmtDuration(durations.averageMs)} · median {fmtDuration(durations.medianMs)}.
              {' '}Failed and cancelled runs are excluded — a partial clock would bias the figure.
            </div>
          </>
        )}
      </SectionCard>

      {/* ── Recent failures (sanitized) ─────────────────────────────────── */}
      {health?.recentFailures?.length > 0 && (
        <SectionCard title="Recent failures" subtitle="The ten most recent failed runs. Requeue them from the job list below.">
          {health.recentFailures.map((j, i) => (
            <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: i < health.recentFailures.length - 1 ? `1px solid ${C.brd}` : 'none', fontSize: 11.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }} title={j.id}>{String(j.id).slice(0, 8)}</span>
              <span style={{ color: C.txt, width: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.projectTitle || '—'}</span>
              <span style={{ color: C.red, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.error || ''}>{j.error || 'failed'}</span>
              <span style={{ color: C.muted }}>{j.attempts ?? 0}/{j.maxAttempts} attempts</span>
              <span style={{ color: C.muted }}>{fmtAgo(j.completedAt || j.createdAt)}</span>
            </div>
          ))}
        </SectionCard>
      )}

      {/* ── Availability + the scientific matching constant ─────────────── */}
      <SectionCard
        testId="rg-dup-availability"
        title="Availability & matching"
        subtitle="Whether reviewers may run detection, and the matching constant the engine uses."
      >
        {AVAILABILITY && (
          <SettingShell
            testId={`rg-setting-${AVAILABILITY.key}`}
            label={AVAILABILITY.label}
            description={AVAILABILITY.description}
            rationale={AVAILABILITY.note}
            badges={<><Badge text="relocated view" color={C.teal} /><SourceBadge entry={AVAILABILITY} /></>}
          >
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '5px 10px' }}>
              {health ? (health.enabled ? 'Enabled' : 'Disabled') : '…'}
            </span>
          </SettingShell>
        )}
        {THRESHOLD && <ReadOnlyEntry entry={THRESHOLD} last />}
      </SectionCard>

      {/* ── Worker tuning: environment-managed (109.md §45) ─────────────── */}
      <SectionCard
        testId="rg-dup-worker"
        title="Worker tuning"
        subtitle="These nine knobs are frozen from the environment when the process starts. They are shown read-only with their variable names — a toggle that silently does nothing would be worse than no control at all."
      >
        <div style={{ padding: '12px 18px 0' }}>
          <NoticeBox tone={C.teal} testId="rg-dup-env-note">
            <strong>Managed by environment.</strong> Changing any of these requires setting the variable and restarting the
            server{worker?.maxAttempts ? ` (retry budget: ${worker.maxAttempts} attempts per job, from the shared job-retry policy)` : ''}.
            Values below are the ones the running worker is actually using.
          </NoticeBox>
        </div>
        {ENV_ENTRIES.map((entry, i) => {
          const runtime = worker?.values?.[WORKER_VALUE_KEYS[entry.envVar]];
          return (
            <SettingShell
              key={entry.key}
              testId={`rg-setting-${entry.key}`}
              label={entry.label}
              description={entry.description}
              rationale={entry.rationale}
              badges={<><DangerBadge entry={entry} /><SourceBadge entry={entry} /></>}
              last={i === ENV_ENTRIES.length - 1}
            >
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '5px 10px' }} title={`Shipped default: ${entry.default}`}>
                {runtime !== undefined ? runtime : entry.default}
              </span>
            </SettingShell>
          );
        })}
      </SectionCard>

      {/* ── Job list (109.md §8) ────────────────────────────────────────── */}
      <SectionCard testId="rg-dup-jobs" title="Detection jobs" subtitle="Filterable and paginated — the browser never loads the whole job history.">
        <FilterRow
          action={<button data-testid="rg-dup-jobs-reload" onClick={loadJobs} style={ghostBtn}><Icon name="refresh" size={12} /> Refresh</button>}
        >
          <LabelledField label="Status">
            <select data-testid="rg-dup-filter-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} style={{ ...selectStyle, width: 150 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </LabelledField>
          <LabelledField label="Project id">
            <input data-testid="rg-dup-filter-project" value={filters.projectId} placeholder="screening project id" onChange={(e) => setFilter('projectId', e.target.value)} style={{ ...inputStyle, width: 220 }} />
          </LabelledField>
          <LabelledField label="From">
            <input data-testid="rg-dup-filter-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </LabelledField>
          <LabelledField label="To">
            <input data-testid="rg-dup-filter-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </LabelledField>
        </FilterRow>
        {jobsErr && <div style={{ padding: '14px 18px 0' }}><ErrorBox msg={jobsErr} /></div>}
        <Table
          testId="rg-dup-jobs-table"
          columns={columns}
          rows={jobs}
          loading={loadingJobs}
          rowKey={(j) => j.id}
          emptyMessage="No duplicate-detection jobs match these filters."
        />
        <Pager testId="rg-dup-pager" page={meta.page} limit={meta.limit} total={meta.total} hasMore={meta.hasMore} onPage={setPage} />
      </SectionCard>

      {/* ── Requeue confirmation (109.md §§9, 40, 42) ───────────────────── */}
      <ConfirmModal
        open={!!pending}
        testId="rg-requeue"
        title="Requeue this duplicate-detection job?"
        confirmLabel="Requeue job"
        busy={busy}
        reason={reason}
        onReason={setReason}
        reasonLabel="Why is this being requeued? (required — recorded in the audit log)"
        requireReason
        onCancel={() => { setPending(null); setReason(''); }}
        onConfirm={confirmRequeue}
      >
        {pending && (
          <>
            <div style={{ marginBottom: 10 }}>
              Job <code style={{ fontFamily: MONO }}>{String(pending.id).slice(0, 8)}</code> on{' '}
              <strong>{pending.projectTitle || pending.projectId}</strong> goes back to <strong>queued</strong> and the worker
              picks it up again.
            </div>
            <div style={{ fontFamily: MONO, fontSize: 12, marginBottom: 10 }}>
              <span style={{ color: C.muted }}>current </span>{pending.status}{pending.stale ? ' (stale)' : ''}
              <span style={{ color: C.muted }}> → new </span><strong style={{ color: C.txt }}>queued</strong>
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
              The retry counter is NOT reset ({pending.retriesRemaining} of {pending.maxAttempts} attempts left), and the run
              reconciles exactly like a normal detection pass: screening decisions, manually resolved duplicates and article
              metadata are never discarded.
            </div>
          </>
        )}
      </ConfirmModal>
    </div>
  );
}
