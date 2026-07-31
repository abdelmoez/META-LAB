/**
 * ImportHistory.jsx — 96.md Phase 5B/5C (plan D12): the chronological
 * "Search Import History" timeline for a screening project.
 *
 * What changed vs the 58.md batch list: Pecan Search runs are shown as ONE
 * grouped timeline entry each (databases, initiating user, date/time, run state
 * incl. a rolled-back badge, and the honest counts line
 * "312 retrieved · 224 new · 76 already present · 3 updated · 12 duplicates
 * skipped · 0 failed"), while file/API imports keep their per-batch rows with
 * the existing owner/admin type-to-confirm delete. Progressive disclosure: each
 * run expands to a per-source breakdown, the exact query text (monospace,
 * collapsed by default), error details, and its underlying batches.
 *
 * Data source: GET /projects/:pid/import-history (screeningImportHistoryApi —
 * the S-workstream grouped endpoint). If that 404s (endpoint not deployed yet)
 * we soft-fail to the existing GET /import-batches shape — `normalizeHistory`
 * accepts both payloads, so the panel never breaks during the rollout.
 *
 * Reset (96.md Phase 6, plan D11): a "Delete All Imported Search Records"
 * action in the section header, HIDDEN unless the server says `canReset`
 * (capability-flag gating, same pattern as `canDelete`). It opens the
 * typed-confirm ResetImportedRecordsModal.
 *
 * Styled with the screening `C` tokens, so it harmonises automatically in both
 * the legacy theme and the Stitch theme (the --t-* remap).
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Card, Button, Badge, SectionLabel, Spinner, Modal, Field, ErrorBanner } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { screeningImportHistoryApi } from '../../../features/pecanSearch/pecanSearchApi.js';
import { providerLabel } from '../../../research-engine/search/runProgress.js';
import ResetImportedRecordsModal from './ResetImportedRecordsModal.jsx';

const n = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (...vals) => {
  for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const fmt = (v) => { const x = num(v); return x >= 1000 ? x.toLocaleString('en-US') : String(x); };
const SOURCE_LABEL = { 'pecan-search': 'Pecan Search', file: 'File upload', api: 'API' };
function fmtDate(d) { try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } }
function fmtDateTime(d) {
  try { return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

/** Run-state → badge label/colour (text always present, never colour-only). */
export const RUN_STATE_META = {
  completed: { label: 'Completed', color: C.grn },
  partial: { label: 'Partial', color: C.gold },
  failed: { label: 'Failed', color: C.red },
  cancelled: { label: 'Cancelled', color: C.muted },
  running: { label: 'Running', color: C.acc },
  queued: { label: 'Queued', color: C.acc },
};

/**
 * The spec 5B counts line. `updated` is optional (plan D14 defensive rule:
 * segment shown only when the server actually reports the count).
 */
export function runCountsLine(counts) {
  const c = counts || {};
  const parts = [
    `${fmt(c.retrieved)} retrieved`,
    `${fmt(c.added)} new`,
    `${fmt(c.alreadyPresent)} already present`,
  ];
  if (c.updated != null) parts.push(`${fmt(c.updated)} updated`);
  parts.push(`${fmt(c.duplicatesSkipped)} duplicates skipped`, `${fmt(c.failed)} failed`);
  return parts.join(' · ');
}

/* Per-source rows read the /import-history contract's `perSource` values
   (raw/imported/existingMatched/exactDup+fuzzyDup/failed, keyed by provider)
   while tolerating the older PecanSearchSource column names
   (rawCount/importedCount/existingMatchCount/…) and display-model keys. */
function normalizeRunSource(s) {
  const src = s || {};
  return {
    provider: src.provider || src.id || '',
    state: src.state || '',
    retrieved: num(numOrNull(src.retrieved, src.raw, src.rawCount)),
    added: num(numOrNull(src.added, src.new, src.imported, src.importedCount)),
    alreadyPresent: num(numOrNull(src.alreadyPresent, src.existingMatched, src.existingMatchCount, src.existing)),
    updated: numOrNull(src.updated, src.updatedCount),
    duplicatesSkipped: src.duplicatesSkipped != null
      ? num(src.duplicatesSkipped)
      : (src.duplicates != null
        ? num(src.duplicates)
        : (src.exactDup != null || src.fuzzyDup != null)
          ? num(src.exactDup) + num(src.fuzzyDup)
          : num(src.exactDupCount) + num(src.fuzzyDupCount)),
    failed: num(numOrNull(src.failed, src.failedRecordCount)),
    error: src.error || src.errorDetail || '',
  };
}

/* Run-level rollup reads the contract counts (found/imported/existingMatched/
   updated/duplicatesSkipped/failed) while tolerating the frozen PecanSearchRun
   counts JSON names (rawRetrieved/exactDup/…); missing rollups fall back to
   per-source sums so a mid-flight run still shows numbers. */
function normalizeRunCounts(c, sources) {
  const raw = c || {};
  const sum = (k) => sources.reduce((a, s) => a + num(s[k]), 0);
  const sumUpdated = () => (sources.some((s) => s.updated != null)
    ? sources.reduce((a, s) => a + num(s.updated), 0)
    : null);
  return {
    retrieved: numOrNull(raw.retrieved, raw.found, raw.rawRetrieved) ?? sum('retrieved'),
    added: numOrNull(raw.new, raw.added, raw.imported) ?? sum('added'),
    alreadyPresent: numOrNull(raw.alreadyPresent, raw.existingMatched) ?? sum('alreadyPresent'),
    updated: numOrNull(raw.updated) ?? sumUpdated(),
    duplicatesSkipped: raw.duplicatesSkipped != null
      ? num(raw.duplicatesSkipped)
      : (raw.exactDup != null || raw.fuzzyDup != null)
        ? num(raw.exactDup) + num(raw.fuzzyDup)
        : sum('duplicatesSkipped'),
    failed: numOrNull(raw.failed, raw.failedRecords) ?? sum('failed'),
  };
}

function normalizeBatch(b) {
  const raw = b || {};
  return {
    kind: 'batch',
    key: `batch:${raw.id}`,
    id: raw.id,
    filename: raw.filename || '',
    format: raw.format || '',
    source: raw.source || 'file',
    recordCount: num(raw.recordCount),
    preDedupCount: num(raw.preDedupCount) || num(raw.recordCount),
    duplicateCount: num(raw.duplicateCount),
    rejectedCount: num(raw.rejectedCount),
    updatedCount: numOrNull(raw.updatedCount),
    remainingCount: raw.remainingCount != null ? num(raw.remainingCount) : num(raw.recordCount),
    importedByName: raw.importedByName || '',
    createdAt: raw.createdAt || null,
  };
}

function normalizeRun(e) {
  const raw = e || {};
  // The contract's per-database breakdown is `perSource` — an OBJECT keyed by
  // provider id. A legacy `sources` ARRAY is still tolerated (older payloads).
  const perSource = (raw.perSource && typeof raw.perSource === 'object' && !Array.isArray(raw.perSource))
    ? raw.perSource : null;
  const sources = perSource
    ? Object.entries(perSource)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([provider, v]) => normalizeRunSource({ provider, ...v }))
    : (Array.isArray(raw.sources) ? raw.sources.map(normalizeRunSource) : []);
  const batches = Array.isArray(raw.batches) ? raw.batches.map(normalizeBatch) : [];
  // Header database list: explicit list when sent, else the perSource keys.
  const databases = (Array.isArray(raw.databases) && raw.databases.length)
    ? raw.databases.filter((d) => typeof d === 'string')
    : sources.map((s) => s.provider).filter(Boolean);
  return {
    kind: 'run',
    key: `run:${raw.runId || raw.id}`,
    runId: raw.runId || raw.id || '',
    name: raw.name || '',
    state: raw.state || '',
    origin: raw.origin || '',
    rolledBack: !!(raw.rolledBack || raw.rolledBackAt),
    rolledBackAt: raw.rolledBackAt || null,
    initiatedByName: raw.initiatedByName || raw.importedByName || '',
    at: raw.startedAt || raw.createdAt || raw.completedAt || null,
    databases,
    sources,
    batches,
    counts: normalizeRunCounts(raw.counts, sources),
    canonicalText: raw.canonicalText || (raw.query && typeof raw.query === 'object' && (raw.query.canonicalText || raw.query.text)) || '',
    // M21 — the list shape truncates long query text (≤500 chars); flag it so the
    // UI can say "shortened" instead of silently presenting a partial query.
    canonicalTextTruncated: !!raw.canonicalTextTruncated,
    errorSummary: raw.errorSummary || '',
    warningSummary: raw.warningSummary || '',
  };
}

/**
 * normalizeHistory(payload) — shape-tolerant read model for BOTH the grouped
 * /import-history contract ({ canDelete, canReset, projectName?, entries,
 * total, hasMore, limit, offset }) and the legacy /import-batches fallback
 * ({ canDelete, batches }). Entries come out newest-first (chronological
 * timeline); the pagination fields drive the "Load more" affordance (M21).
 */
export function normalizeHistory(payload) {
  const p = payload || {};
  const raw = Array.isArray(p.entries) ? p.entries : (Array.isArray(p.batches) ? p.batches : []);
  const entries = raw
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const t = e.type || e.kind || '';
      const isRun = t === 'run' || t === 'search-run' || t === 'searchRun' || (!!(e.runId || (e.run && typeof e.run === 'object')) && !e.filename);
      if (isRun) return normalizeRun(e.run && typeof e.run === 'object' ? { ...e.run, batches: e.batches ?? e.run.batches } : e);
      return normalizeBatch(e.batch && typeof e.batch === 'object' ? e.batch : e);
    });
  const ts = (x) => {
    const t = Date.parse((x.kind === 'run' ? x.at : x.createdAt) || '');
    return Number.isNaN(t) ? -Infinity : t;
  };
  entries.sort((a, b) => ts(b) - ts(a));
  return {
    entries,
    canDelete: !!p.canDelete,
    canReset: !!p.canReset,
    projectName: typeof p.projectName === 'string' ? p.projectName : '',
    total: numOrNull(p.total) ?? entries.length,
    hasMore: !!p.hasMore,
    limit: numOrNull(p.limit) ?? 50,
    offset: numOrNull(p.offset) ?? 0,
  };
}

/* ── Presentational entry cards (pure — exported for SSR tests) ─────────────── */

const cellHead = { textAlign: 'right', padding: '5px 8px', color: C.muted, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${C.brd}` };
const cellNum = { padding: '5px 8px', textAlign: 'right', color: C.txt2, fontFamily: MONO, fontSize: 11.5, borderBottom: `1px solid ${C.brd}` };

/**
 * One grouped search-run entry. Concise row first; the Details button expands
 * the per-source breakdown, query text (native <details>, collapsed) and errors.
 */
export function RunEntry({ entry, canDelete, expanded, onToggle, onDeleteBatch }) {
  const meta = RUN_STATE_META[entry.state] || { label: entry.state || 'Unknown', color: C.muted };
  const dbNames = entry.databases.map(providerLabel).join(', ');
  const hasUpdated = entry.counts.updated != null || entry.sources.some((s) => s.updated != null);
  const failedSources = entry.sources.filter((s) => s.error);
  return (
    <Card style={{ padding: '13px 16px', opacity: entry.rolledBack ? 0.78 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 300px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span title={entry.name || 'Automated search'} style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
              {entry.name || 'Automated search'}
            </span>
            <Badge color={C.acc} title="Imported by a Search Engine run">Search run</Badge>
            <Badge color={meta.color} title={`Run state: ${meta.label}`}>{meta.label}</Badge>
            {entry.origin === 'living' && (
              <Badge color={C.teal} title="Launched automatically by the Living Review scheduler, not by a user">Living review</Badge>
            )}
            {entry.rolledBack && (
              <Badge color={C.red} title={`This run's imported records were deleted by a project reset${entry.rolledBackAt ? ` on ${fmtDate(entry.rolledBackAt)}` : ''}. The run stays in your search history.`}>
                Rolled back
              </Badge>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            {dbNames}{dbNames ? ' · ' : ''}{entry.initiatedByName ? `by ${entry.initiatedByName} · ` : ''}{fmtDateTime(entry.at)}
          </div>
          {/* Spec 5B counts line — plain text so screen readers get the full sentence. */}
          <div style={{ fontSize: 11.5, color: C.txt2, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {runCountsLine(entry.counts)}
          </div>
        </div>
        {/* Native button (not the shared Button) so aria-expanded reaches the DOM;
            visual style mirrors Button variant="ghost". */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!!expanded}
          title={expanded ? 'Hide the per-database breakdown and query' : 'Show the per-database breakdown and query'}
          style={{
            fontSize: 13, fontWeight: 600, fontFamily: FONT, borderRadius: 8, cursor: 'pointer',
            padding: '8px 18px', background: 'transparent', border: `1px solid ${C.brd2}`,
            color: C.txt2, whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {expanded ? 'Hide details' : 'Details'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
          {entry.rolledBack && (
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10, lineHeight: 1.55 }}>
              The records this run imported were deleted by a project reset
              {entry.rolledBackAt ? ` on ${fmtDate(entry.rolledBackAt)}` : ''}. The run itself is kept for your
              search documentation and PRISMA reporting.
            </div>
          )}

          {/* Per-source breakdown */}
          {entry.sources.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...cellHead, textAlign: 'left' }}>Database</th>
                    <th scope="col" style={{ ...cellHead, textAlign: 'left' }}>Status</th>
                    <th scope="col" style={cellHead}>Retrieved</th>
                    <th scope="col" style={cellHead}>New</th>
                    <th scope="col" style={cellHead}>Already present</th>
                    {hasUpdated && <th scope="col" style={cellHead}>Updated</th>}
                    <th scope="col" style={cellHead}>Duplicates</th>
                    <th scope="col" style={cellHead}>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.sources.map((s) => {
                    const sm = RUN_STATE_META[s.state] || { label: s.state || '—', color: C.muted };
                    return (
                      <tr key={s.provider}>
                        <td style={{ ...cellNum, textAlign: 'left', fontFamily: FONT, color: C.txt }}>{providerLabel(s.provider)}</td>
                        <td style={{ ...cellNum, textAlign: 'left', fontFamily: FONT, color: sm.color }}>{sm.label}</td>
                        <td style={cellNum}>{fmt(s.retrieved)}</td>
                        <td style={cellNum}>{fmt(s.added)}</td>
                        <td style={cellNum}>{fmt(s.alreadyPresent)}</td>
                        {hasUpdated && <td style={cellNum}>{s.updated != null ? fmt(s.updated) : '—'}</td>}
                        <td style={cellNum}>{fmt(s.duplicatesSkipped)}</td>
                        <td style={{ ...cellNum, color: s.failed > 0 ? C.red : C.txt2 }}>{fmt(s.failed)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Exact query text — collapsed by default (progressive disclosure). */}
          {entry.canonicalText && (
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11.5, color: C.txt2, fontWeight: 600 }}>Search query</summary>
              <pre style={{
                margin: '8px 0 0', padding: '10px 12px', background: C.surf, border: `1px solid ${C.brd}`,
                borderRadius: 6, fontFamily: MONO, fontSize: 11, color: C.txt, whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto',
              }}>{entry.canonicalText}{entry.canonicalTextTruncated ? '…' : ''}</pre>
              {/* M21 — the list endpoint truncates long queries; never present a cut
                  query as if it were the whole strategy. */}
              {entry.canonicalTextTruncated && (
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5 }}>
                  Query shortened for display — export the run&rsquo;s report from Search history for the full text.
                </div>
              )}
            </details>
          )}

          {/* Error details (run summary + per-source messages) */}
          {(entry.errorSummary || failedSources.length > 0) && (
            <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.6, marginBottom: 10 }}>
              {entry.errorSummary && <div>{entry.errorSummary}</div>}
              {failedSources.map((s) => (
                <div key={s.provider}>{providerLabel(s.provider)}: {s.error}</div>
              ))}
            </div>
          )}

          {/* Underlying import batches (kept deletable — existing per-batch flow) */}
          {entry.batches.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entry.batches.map((b) => (
                <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: C.txt2, background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '6px 10px' }}>
                  <span style={{ minWidth: 0, flex: '1 1 200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.filename}>
                    {b.filename || '(unnamed batch)'}
                  </span>
                  <span style={{ fontFamily: MONO }}>{fmt(b.recordCount)} imported</span>
                  {canDelete && onDeleteBatch && (
                    <Button variant="ghost" onClick={() => onDeleteBatch(b)} title="Delete this batch and all its records" style={{ color: C.red }}>
                      Delete
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * One file/API import batch — the pre-96.md row, kept as-is (incl. issue list
 * + delete) so the existing per-batch delete flow keeps working unchanged.
 */
export function BatchEntry({ batch: b, canDelete, onDelete, issues, onToggleIssues }) {
  return (
    <Card style={{ padding: '13px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span title={b.filename} style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
              {b.filename || '(unnamed dataset)'}
            </span>
            <Badge color={C.teal} title={`Source: ${SOURCE_LABEL[b.source] || b.source}`}>{SOURCE_LABEL[b.source] || b.source}</Badge>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            {b.importedByName ? `by ${b.importedByName} · ` : ''}{fmtDate(b.createdAt)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <Stat label="Identified" value={fmt(b.preDedupCount || b.recordCount)} />
          <Stat label="Duplicates" value={fmt(b.duplicateCount)} color={n(b.duplicateCount) > 0 ? C.gold : C.txt2} />
          {/* D10 additive updatedCount — shown only when the server reports it. */}
          {b.updatedCount != null && b.updatedCount > 0 && <Stat label="Updated" value={fmt(b.updatedCount)} color={C.teal} />}
          <Stat label="Rejected" value={fmt(b.rejectedCount)} color={n(b.rejectedCount) > 0 ? C.ylw : C.txt2} />
          <Stat label="Imported" value={fmt(b.recordCount)} color={C.grn} />
          <Stat label="Remaining" value={fmt(b.remainingCount)} color={C.txt2} />
          {n(b.rejectedCount) > 0 && onToggleIssues && (
            <Button variant="ghost" onClick={() => onToggleIssues(b.id)} title="Show which rows were rejected and why">
              {issues ? (issues.loading ? 'Loading…' : 'Hide issues') : 'View issues'}
            </Button>
          )}
          {canDelete && onDelete && (
            <Button variant="danger" onClick={() => onDelete(b)} title="Delete this dataset and all its studies">Delete</Button>
          )}
        </div>
      </div>
      {/* 65.md SCR-3 — readable per-row reject/invalid-decision reasons */}
      {issues && !issues.loading && (
        issues.error ? (
          <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{issues.error}</div>
        ) : issues.rows.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
            No per-row detail is available for this dataset (imported before issue reporting, or synchronously).
          </div>
        ) : (
          <div style={{ marginTop: 10, maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.brd}`, borderRadius: 6, background: C.surf }}>
            {issues.rows.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 10px', fontSize: 11.5, color: C.txt2, borderBottom: i < issues.rows.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                <span style={{ fontFamily: MONO, color: C.muted, flexShrink: 0 }}>#{e.index}</span>
                <span title={e.title || undefined} style={{ minWidth: 0, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.txt }}>
                  {e.title || <span style={{ fontStyle: 'italic', color: C.muted }}>(untitled)</span>}
                </span>
                <span style={{ color: C.muted }}>{e.reason}</span>
              </div>
            ))}
          </div>
        )
      )}
    </Card>
  );
}

/**
 * The section-header reset affordance — pure, exported for SSR tests. 96.md 6E:
 * members WITHOUT reset permission see the action DISABLED with an access
 * explanation (never a hidden critical control / silent access failure).
 */
export function ResetHistoryAction({ canReset, onOpen }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {!canReset && (
        <span style={{ fontSize: 10.5, color: C.muted }}>
          Only the project owner or a site admin can delete imported records
        </span>
      )}
      <Button
        variant="ghost"
        onClick={canReset ? onOpen : undefined}
        disabled={!canReset}
        title={canReset
          ? 'Delete every record imported into Screening by Search Engine runs'
          : 'Only the project owner or a site admin can delete imported records'}
        style={{ color: C.red, borderColor: alpha(C.red, '40'), padding: '5px 12px', fontSize: 11.5 }}
      >
        Delete All Imported Search Records
      </Button>
    </span>
  );
}

/* ── Container ──────────────────────────────────────────────────────────────── */

const EMPTY_HISTORY = { entries: [], canDelete: false, canReset: false, projectName: '', total: 0, hasMore: false, limit: 50, offset: 0 };

export default function ImportHistory({ pid, projectName = '', onChanged }) {
  const [state, setState] = useState({ loading: true, error: null, ...EMPTY_HISTORY });
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState({});   // { [entryKey]: true }
  const [target, setTarget] = useState(null);     // batch pending deletion
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [delErr, setDelErr] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  // 65.md SCR-3 — lazily fetched per-batch issue lists: { [batchId]: { loading, error, rows } }
  const [issues, setIssues] = useState({});

  const toggleIssues = useCallback(async (batchId) => {
    // Second click hides; first click fetches once, then shows the cached rows.
    if (issues[batchId] && !issues[batchId].loading) {
      setIssues((s) => { const nx = { ...s }; delete nx[batchId]; return nx; });
      return;
    }
    setIssues((s) => ({ ...s, [batchId]: { loading: true, error: null, rows: [] } }));
    try {
      const r = await screeningApi.getImportBatchErrorReport(pid, batchId);
      setIssues((s) => ({ ...s, [batchId]: { loading: false, error: null, rows: Array.isArray(r?.errorReport) ? r.errorReport : [] } }));
    } catch (e) {
      setIssues((s) => ({ ...s, [batchId]: { loading: false, error: e?.message || 'Could not load issues.', rows: [] } }));
    }
  }, [pid, issues]);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      let payload;
      try {
        payload = await screeningImportHistoryApi.getImportHistory(pid);
      } catch (e) {
        // Grouped endpoint not deployed yet → defensive soft-fail to the
        // existing per-batch list (normalizeHistory reads both shapes).
        if (e && e.status === 404) payload = await screeningApi.listImportBatches(pid);
        else throw e;
      }
      setState({ loading: false, error: null, ...normalizeHistory(payload) });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Could not load import history.', ...EMPTY_HISTORY });
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  // M21 — fetch the next (older) page and append it. Entry keys dedupe a page
  // boundary shifted by a concurrent delete; any mutating action calls load()
  // which resets to the first page.
  const loadMore = useCallback(async () => {
    if (state.loading || loadingMore || !state.hasMore) return;
    setLoadingMore(true);
    try {
      const payload = await screeningImportHistoryApi.getImportHistory(pid, {
        limit: state.limit, offset: state.offset + state.limit,
      });
      const next = normalizeHistory(payload);
      setState((s) => {
        const seen = new Set(s.entries.map((x) => x.key));
        return {
          ...s,
          entries: [...s.entries, ...next.entries.filter((x) => !seen.has(x.key))],
          total: next.total, hasMore: next.hasMore, limit: next.limit, offset: next.offset,
        };
      });
    } catch {
      /* keep the loaded pages — the Load more button doubles as the retry */
    } finally {
      setLoadingMore(false);
    }
  }, [pid, state.loading, state.hasMore, state.limit, state.offset, loadingMore]);

  const toggleExpanded = useCallback((key) => {
    setExpanded((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  const openDelete = (b) => { setTarget(b); setConfirm(''); setDelErr(null); };
  const closeDelete = () => { if (!busy) { setTarget(null); setConfirm(''); setDelErr(null); } };

  const doDelete = useCallback(async () => {
    if (!target || busy) return;
    setBusy(true); setDelErr(null);
    try {
      const r = await screeningApi.deleteImportBatch(pid, target.id, confirm.trim());
      setTarget(null); setConfirm('');
      await load();
      if (onChanged) await onChanged(r);
    } catch (e) {
      setDelErr(e?.message || 'Delete failed.');
    } finally { setBusy(false); }
  }, [target, busy, pid, confirm, load, onChanged]);

  // The reset modal must survive EVERY render branch of this section: the reset
  // itself emits a realtime poke that reloads the history mid-flight (loading
  // branch) and a scope='all' reset empties it entirely (null branch) — if the
  // open modal only rendered in the happy branch it would unmount before the
  // user ever saw the success summary (caught by the 96.md reset e2e journey).
  // It is composed as the SECOND child of one stable fragment below so React
  // never repositions (and therefore never remounts) it when the body branch
  // changes shape mid-flow.
  const resetModal = resetOpen ? (
    <ResetImportedRecordsModal
      pid={pid}
      projectName={state.projectName || projectName || ''}
      onClose={() => setResetOpen(false)}
      onDone={async (r) => {
        setResetOpen(false);
        setExpanded({});
        await load();
        if (onChanged) await onChanged(r);
      }}
    />
  ) : null;
  const withResetModal = (body) => <>{body}{resetModal}</>;

  // Hidden entirely when there is nothing to show (no empty section — 58.md).
  if (state.loading && !state.entries.length) {
    return withResetModal(
      <section style={{ marginBottom: 20 }}>
        <SectionLabel>Search Import History</SectionLabel>
        <Card style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 10 }}><Spinner size={16} /><span style={{ fontSize: 12.5, color: C.txt2 }}>Loading import history…</span></Card>
      </section>
    );
  }
  if (state.error) {
    return withResetModal(
      <section style={{ marginBottom: 20 }}>
        <SectionLabel>Search Import History</SectionLabel>
        <ErrorBanner onRetry={load}>{state.error}</ErrorBanner>
      </section>
    );
  }
  if (!state.entries.length) return withResetModal(null);

  const confirmMatch = target && confirm.trim() === String(target.filename || '').trim();

  const totalCount = Math.max(state.total, state.entries.length);

  return withResetModal(
    <section data-testid="screening-import-history" style={{ marginBottom: 20 }}>
      <SectionLabel right={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
            {fmt(totalCount)} import{totalCount === 1 ? '' : 's'}
          </span>
          {/* 96.md Phase 6A/6E — the reset action renders for every member; the
              server-computed canReset (owner/admin) decides enabled vs a disabled
              state with an access explanation (never a hidden critical control). */}
          <ResetHistoryAction canReset={state.canReset} onOpen={() => setResetOpen(true)} />
        </span>
      }>
        Search Import History
      </SectionLabel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state.entries.map((entry) => (
          entry.kind === 'run' ? (
            <RunEntry
              key={entry.key}
              entry={entry}
              canDelete={state.canDelete}
              expanded={!!expanded[entry.key]}
              onToggle={() => toggleExpanded(entry.key)}
              onDeleteBatch={openDelete}
            />
          ) : (
            <BatchEntry
              key={entry.key}
              batch={entry}
              canDelete={state.canDelete}
              onDelete={openDelete}
              issues={issues[entry.id]}
              onToggleIssues={toggleIssues}
            />
          )
        ))}
      </div>

      {/* M21 — paginated history: living-review projects accumulate entries
          indefinitely, so older pages load on demand instead of one huge payload. */}
      {state.hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Button
            variant="ghost"
            onClick={loadMore}
            disabled={loadingMore}
            title="Load older imports"
            style={{ padding: '6px 16px', fontSize: 12 }}
          >
            {loadingMore ? 'Loading…' : `Load more (showing ${fmt(state.entries.length)} of ${fmt(totalCount)})`}
          </Button>
        </div>
      )}

      {target && (
        <Modal onClose={closeDelete} width={500} label="Delete dataset">
          <div style={{ fontFamily: FONT, color: C.txt }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Delete dataset?</div>
            <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 12 }}>
              This permanently removes the dataset <strong style={{ color: C.txt }}>{target.filename || '(unnamed)'}</strong> and all
              of its studies. Their screening decisions, conflicts, duplicate-group memberships and relevance scores are deleted too. PRISMA
              counts and screening analytics will be recalculated. <strong style={{ color: C.red }}>This cannot be undone.</strong>
            </div>
            <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 13px', marginBottom: 14, fontSize: 12, color: C.txt2 }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, color: C.txt }}>{fmt(target.remainingCount)}</span> records will be removed
              {n(target.recordCount) !== n(target.remainingCount) ? ` (of ${fmt(target.recordCount)} originally imported)` : ''}.
            </div>
            <Field label={<>Type the dataset name <span style={{ fontFamily: MONO, color: C.txt }}>{target.filename}</span> to confirm</>}>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus
                placeholder={target.filename}
                style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${confirmMatch ? alpha(C.red, '70') : C.brd2}`, borderRadius: 7, padding: '9px 11px', color: C.txt, fontFamily: FONT, fontSize: 13, outline: 'none' }} />
            </Field>
            {delErr && <div style={{ marginTop: 10 }}><ErrorBanner>{delErr}</ErrorBanner></div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <Button variant="ghost" onClick={closeDelete} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={doDelete} disabled={busy || !confirmMatch} title={confirmMatch ? 'Delete this dataset' : 'Type the exact dataset name to enable'}>
                {busy ? 'Deleting…' : 'Delete dataset'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

    </section>
  );
}

function Stat({ label, value, color = C.txt }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{label}</div>
    </div>
  );
}
