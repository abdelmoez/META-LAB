/**
 * features/prisma/PrismaInspector.jsx — 116.md §8-§12. The interactive inspection
 * layer below the PRISMA diagram.
 *
 * Clicking a box shows: what the count REPRESENTS (§9.3), the aggregate breakdown
 * the flow already carries (§12), and a PAGINATED record list served by
 * GET /prisma/box/:boxId/records (§11 — the client never receives, filters or
 * renders a 50k-row set; search + facet filters are applied server-side).
 *
 * Metadata edits (§10) go through PATCH /records/:rid — the screening domain
 * endpoint with validation + audit — and refresh the flow so the counts on screen
 * are the counts after the edit. Decision-state changes are NEVER inline edits:
 * the existing finalize / revert-final-review domain actions are surfaced as
 * intentional, confirmed buttons.
 *
 * Undo: each metadata edit registers with the project HistoryContext under the
 * 'prisma.recordEdit' executor (108.md contract — re-validate against the CURRENT
 * row, refuse when stale; the executor is the tail of the same PATCH path).
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { C, btnS, inp } from '../../frontend/workspace/ui/styles.js';
import { boxMeta, DISPOSITION_LABELS } from '../../research-engine/prisma/index.js';
import { useProjectHistory } from '../../frontend/history/HistoryContext.jsx';
import {
  BOX_EXPLANATIONS, facetsForBox, FACET_LABELS,
  identificationSourceOptions, validateRecordPatch, buildBoxRecordsQuery,
} from './inspectorModel.js';

const PAGE_LIMIT = 50;

const api = (screenProjectId, path, opts = {}) => fetch(
  `/api/screening/projects/${encodeURIComponent(screenProjectId)}${path}`,
  {
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  },
);

/* ── the §12 aggregate breakdown (kept from the 103 inspector) ─────────────── */
function boxBreakdown(flow, boxId) {
  if (!flow) return [];
  return boxId === 'removed_before_screening'
    ? (flow.removedBreakdown && flow.removedBreakdown.byStage) || []
    : boxId === 'excluded_full_text_db' ? (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.db) || []
      : boxId === 'excluded_full_text_other' ? (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.other) || []
        : boxId === 'not_retrieved_db' || boxId === 'not_retrieved_other' ? flow.notRetrievedReasons || []
          : boxId === 'identified_db' ? (flow.sources && flow.sources.db) || []
            : boxId === 'identified_other' ? (flow.sources && flow.sources.other) || []
              : [];
}

/* ── one record row: metadata line + editor + domain actions ───────────────── */
function RecordRow({ row, ctx, onSave, onFinalize, onRevert }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const { blind, canEdit, canFinalize } = ctx;
  const isRejected = row.finalStatus === 'rejected';
  const isFinalized = row.finalStatus === 'accepted' || row.finalStatus === 'rejected';
  const canDecide = canFinalize && row.currentStage === 'full_text' && !isFinalized;

  const startEdit = () => {
    setDraft({
      title: row.title || '', authors: row.authors || '', year: row.year || '',
      journal: row.journal || '', doi: row.doi || '', pmid: row.pmid || '',
      sourceDb: row.sourceDb || '',
      identificationSource: row.identificationSource || '',
      sourceDetail: row.sourceDetail || '',
      ...(isRejected ? { rejectedReason: row.rejectedReason || '' } : {}),
    });
    setErr(null);
    setEditing(true);
  };

  const save = async () => {
    // Only send what actually changed — the audit trail then names real edits.
    const patch = {};
    for (const [k, v] of Object.entries(draft)) {
      if (String(v) !== String(row[k] == null ? '' : row[k])) patch[k] = v;
    }
    if (!Object.keys(patch).length) { setEditing(false); return; }
    const check = validateRecordPatch(patch);
    if (!check.ok) { setErr(Object.values(check.errors)[0]); return; }
    setSaving(true);
    setErr(null);
    const ok = await onSave(row, check.clean);
    setSaving(false);
    if (ok) setEditing(false);
    else setErr('Could not save — check your permissions and try again.');
  };

  const metaLine = [
    row.authors, row.year, blind ? null : row.journal,
    row.effectiveSource || row.sourceDb,
    row.doi ? `DOI ${row.doi}` : null,
    row.pmid ? `PMID ${row.pmid}` : null,
  ].filter(Boolean).join(' · ');
  const statusLine = [
    row.importBatch ? `Imported: ${row.importBatch.filename || row.importBatch.format || 'batch'}` : null,
    row.importedAt ? String(row.importedAt).slice(0, 10) : null,
    row.isDuplicate ? (row.isPrimary ? 'Duplicate group (kept copy)' : 'Duplicate (removed)') : null,
    row.dispositionLabel || (row.disposition ? DISPOSITION_LABELS[row.disposition] : null),
    row.notRetrievedReason ? `Not retrieved: ${row.notRetrievedReason}` : null,
    row.exclusionReason ? `Reason: ${row.exclusionReason}` : null,
    row.sourceDetail ? `Detail: ${row.sourceDetail}` : null,
  ].filter(Boolean).join(' · ');

  const field = (label, key, width = '100%') => (
    <label style={{ fontSize: 10.5, color: C.muted, display: 'block' }}>
      {label}
      <input
        value={draft[key] == null ? '' : draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        data-testid={`stitch-prisma-edit-${key}`}
        style={{ ...inp, width, fontSize: 11.5, marginTop: 2 }}
      />
    </label>
  );

  return (
    <div data-testid="stitch-prisma-record-row" style={{
      fontSize: 11.5, padding: '7px 0', borderBottom: `1px solid ${C.brd}`, color: C.txt,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{row.title || row.id}</div>
          {metaLine && <div style={{ color: C.muted, fontSize: 10.5, marginTop: 1 }}>{metaLine}</div>}
          {statusLine && <div style={{ color: C.dim, fontSize: 10, marginTop: 1 }}>{statusLine}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canEdit && !editing && (
            <button type="button" onClick={startEdit} data-testid="stitch-prisma-record-edit"
              style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5 }}>
              Edit
            </button>
          )}
        </div>
      </div>

      {editing && draft && (
        <div data-testid="stitch-prisma-record-editor" style={{
          marginTop: 6, padding: 8, border: `1px solid ${C.brd}`, borderRadius: 8,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: C.bg,
        }}>
          <div style={{ gridColumn: '1 / -1' }}>{field('Title', 'title')}</div>
          {/* Blind mode hides author/journal info from non-leaders — no editing
              what you cannot see (the server refuses these fields too). */}
          {!blind && field('Authors', 'authors')}
          {field('Year', 'year')}
          {!blind && field('Journal', 'journal')}
          {field('DOI', 'doi')}
          {field('PMID', 'pmid')}
          {field('Source database', 'sourceDb')}
          <label style={{ fontSize: 10.5, color: C.muted, display: 'block' }}>
            Identified via (PRISMA)
            <select
              value={draft.identificationSource || ''}
              onChange={(e) => setDraft((d) => ({ ...d, identificationSource: e.target.value }))}
              data-testid="stitch-prisma-edit-identificationSource"
              style={{ ...inp, width: '100%', fontSize: 11.5, marginTop: 2 }}
            >
              {identificationSourceOptions().map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {field('Source detail (free text)', 'sourceDetail')}
          {isRejected && <div style={{ gridColumn: '1 / -1' }}>{field('Exclusion reason', 'rejectedReason')}</div>}
          {err && (
            <div style={{ gridColumn: '1 / -1', color: '#8a1c1c', fontSize: 11 }}>{err}</div>
          )}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="button" onClick={save} disabled={saving}
              data-testid="stitch-prisma-record-save"
              style={{ ...btnS('primary'), padding: '3px 12px', fontSize: 11 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)}
              style={{ ...btnS('ghost'), padding: '3px 10px', fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* §10 — decision-state changes are DOMAIN ACTIONS, never inline edits. */}
      {(canDecide || (isFinalized && canFinalize)) && !editing && (
        <div style={{ marginTop: 5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {canDecide && !rejecting && (
            <>
              <button type="button" data-testid="stitch-prisma-finalize-accept"
                onClick={() => onFinalize(row, 'accept', '')}
                style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5, color: C.grn }}>
                Finalize: include
              </button>
              <button type="button" data-testid="stitch-prisma-finalize-reject"
                onClick={() => setRejecting(true)}
                style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5, color: C.red }}>
                Finalize: exclude…
              </button>
            </>
          )}
          {canDecide && rejecting && (
            <>
              <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Exclusion reason"
                data-testid="stitch-prisma-reject-reason"
                style={{ ...inp, fontSize: 11, width: 220 }} />
              <button type="button"
                onClick={() => { onFinalize(row, 'reject', rejectReason); setRejecting(false); }}
                style={{ ...btnS('primary'), padding: '2px 10px', fontSize: 10.5 }}>
                Confirm exclusion
              </button>
              <button type="button" onClick={() => setRejecting(false)}
                style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5 }}>
                Cancel
              </button>
            </>
          )}
          {isFinalized && canFinalize && (
            <button type="button" data-testid="stitch-prisma-revert-final"
              onClick={() => onRevert(row)}
              style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5 }}>
              Revert final decision…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════ the inspector panel ════════════ */

/**
 * @param {string} boxId            the selected PRISMA box
 * @param {object} flow             slim derivePrismaFlow output (counts + breakdowns)
 * @param {string} screenProjectId  the ScreenProject id (record lists + edits)
 * @param {function} onClose
 * @param {function} onChanged      called after any mutation → caller refetches the flow
 */
export function PrismaInspector({ boxId, flow, screenProjectId, onClose, onChanged }) {
  const meta = boxMeta(boxId);
  const box = flow && flow.boxes && flow.boxes[boxId];

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState({ total: 0, uninspectable: 0, nextCursor: null, facets: null, canEdit: false, canFinalize: false, blindMode: false, isLeader: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState({ q: '', source: '', status: '', reason: '', retrieval: '' });

  const rowsRef = useRef(rows); rowsRef.current = rows;
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;

  const history = useProjectHistory();
  const historyRef = useRef(history); historyRef.current = history;
  const registerExecutor = history.registerExecutor;

  const patchRecord = useCallback(async (recordId, patch) => {
    if (!screenProjectId) return null;
    try {
      const res = await api(screenProjectId, `/records/${encodeURIComponent(recordId)}`, {
        method: 'PATCH', body: patch,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, [screenProjectId]);

  const applyLocal = useCallback((recordId, patch) => {
    setRows((rs) => rs.map((r) => (r.id === recordId ? { ...r, ...patch } : r)));
  }, []);

  /* ── undo/redo (108.md executor contract; scope 'prisma' is relational) ──── */
  useEffect(() => registerExecutor('prisma.recordEdit', async (op) => {
    const row = rowsRef.current.find((r) => r.id === op.recordId);
    // Re-validate against the CURRENT row, never the one at record time; a row no
    // longer loaded (page changed, box closed → executor unmounted anyway) or a
    // row someone else edited since → refuse rather than clobber.
    if (!row) return { ok: false, reason: 'refused' };
    for (const [k, v] of Object.entries(op.expect || {})) {
      if (String(row[k] == null ? '' : row[k]) !== String(v == null ? '' : v)) {
        return { ok: false, reason: 'refused' };
      }
    }
    const res = await patchRecord(op.recordId, op.patch);
    if (!res) return { ok: false, reason: 'failed' };
    applyLocal(op.recordId, op.patch);
    if (onChangedRef.current) onChangedRef.current();
    return true;
  }), [registerExecutor, patchRecord, applyLocal]);

  /* ── record list loading ─────────────────────────────────────────────────── */
  const load = useCallback(async (filters, cursor) => {
    if (!screenProjectId || !boxId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = buildBoxRecordsQuery({ ...filters, cursor, limit: PAGE_LIMIT });
      const res = await api(screenProjectId, `/prisma/box/${encodeURIComponent(boxId)}/records${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRows((prev) => (cursor ? prev.concat(d.records || []) : (d.records || [])));
      setPage((p) => ({
        total: d.total ?? 0,
        uninspectable: d.uninspectable ?? 0,
        nextCursor: d.nextCursor ?? null,
        facets: d.facets || (cursor ? p.facets : null),
        canEdit: !!d.canEdit,
        canFinalize: !!d.canFinalize,
        blindMode: !!d.blindMode,
        isLeader: !!d.isLeader,
      }));
    } catch (e) {
      setError((e && e.message) || 'Could not load the records behind this box.');
    } finally {
      setLoading(false);
    }
  }, [screenProjectId, boxId]);

  useEffect(() => {
    setRows([]);
    setQ('');
    const fresh = { q: '', source: '', status: '', reason: '', retrieval: '' };
    setApplied(fresh);
    load(fresh, '');
  }, [load]);

  const applyFilters = (patch) => {
    const next = { ...applied, ...patch };
    setApplied(next);
    setRows([]);
    load(next, '');
  };

  const reload = useCallback(() => {
    setRows([]);
    load(applied, '');
    if (onChangedRef.current) onChangedRef.current();
  }, [load, applied]);

  /* ── mutations ───────────────────────────────────────────────────────────── */
  const saveEdit = useCallback(async (row, patch) => {
    const res = await patchRecord(row.id, patch);
    if (!res) return false;
    const before = {};
    for (const k of Object.keys(patch)) before[k] = row[k] == null ? '' : row[k];
    applyLocal(row.id, patch);
    // One semantic history entry per save (never a snapshot) — the inverse goes
    // through the SAME PATCH endpoint (108.md: executors are the tail of the
    // forward write path).
    historyRef.current.record({
      kind: 'prisma.recordEdit',
      label: `Edit record — ${(row.title || row.id).slice(0, 60)}`,
      entityKey: `prisma:record:${row.id}`,
      undoOp: { recordId: row.id, patch: before, expect: patch },
      redoOp: { recordId: row.id, patch, expect: before },
    });
    if (onChangedRef.current) onChangedRef.current();
    return true;
  }, [patchRecord, applyLocal]);

  const finalize = useCallback(async (row, decision, reason) => {
    if (decision === 'accept'
      && !window.confirm('Finalize this report as INCLUDED? It will be handed to Data Extraction.')) return;
    try {
      const res = await api(screenProjectId, `/records/${encodeURIComponent(row.id)}/finalize`, {
        method: 'POST', body: { decision, reason: reason || '' },
      });
      if (res.ok) reload();
    } catch { /* the reload above never runs — the row keeps its true state */ }
  }, [screenProjectId, reload]);

  const revert = useCallback(async (row) => {
    if (!window.confirm('Revert this final decision? The record returns to full-text review; an accepted study is withdrawn from Data Extraction.')) return;
    try {
      const res = await api(screenProjectId, `/records/${encodeURIComponent(row.id)}/final-review/revert`, {
        method: 'POST', body: {},
      });
      if (res.ok) reload();
    } catch { /* keep true state */ }
  }, [screenProjectId, reload]);

  if (!box) return null;

  const breakdown = boxBreakdown(flow, boxId);
  const facets = facetsForBox(boxId);
  const facetOptions = page.facets || {};
  const ctx = { blind: page.blindMode && !page.isLeader, canEdit: page.canEdit, canFinalize: page.canFinalize };

  const select = (facetKey) => {
    const opts = facetOptions[facetKey] || [];
    if (!opts.length) return null;
    return (
      <select
        key={facetKey}
        value={applied[facetKey]}
        onChange={(e) => applyFilters({ [facetKey]: e.target.value })}
        aria-label={FACET_LABELS[facetKey]}
        data-testid={`stitch-prisma-facet-${facetKey}`}
        style={{ ...inp, fontSize: 11, width: 'auto', maxWidth: 190 }}
      >
        <option value="">{FACET_LABELS[facetKey]}: all</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label} ({o.n})</option>
        ))}
      </select>
    );
  };

  return (
    <div
      data-testid="stitch-prisma-inspector"
      role="dialog"
      aria-label={`Records behind ${meta ? meta.label : boxId}`}
      style={{
        border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card,
        padding: 14, marginTop: 12, fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.txt }}>
            {meta ? meta.label.replace(/[*:]+$/, '') : boxId}
            <span style={{ marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", color: C.txt2 }}>
              n = {box.n}
            </span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {meta ? `Counts ${meta.unit}. ` : ''}
            {BOX_EXPLANATIONS[boxId] || 'Every number here is the size of a record set — this is that set.'}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close"
          data-testid="stitch-prisma-inspector-close"
          style={{ ...btnS('ghost'), padding: '3px 9px', fontSize: 11, border: `1px solid ${C.brd}` }}>
          Close
        </button>
      </div>

      {breakdown.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
            color: C.muted, fontWeight: 700, marginBottom: 4,
          }}>
            Breakdown
          </div>
          {breakdown.map((r) => (
            <div key={r.key} style={{
              display: 'flex', justifyContent: 'space-between', gap: 10,
              fontSize: 12, padding: '3px 0', borderBottom: `1px solid ${C.brd}`,
            }}>
              <span style={{ color: C.txt2, minWidth: 0 }}>{r.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.txt }}>{r.n}</span>
            </div>
          ))}
        </div>
      )}

      {page.uninspectable > 0 && (
        <div style={{
          fontSize: 11, color: C.txt2, background: 'rgba(214,158,46,0.10)',
          border: '1px solid rgba(214,158,46,0.4)', borderRadius: 8, padding: '7px 9px', marginBottom: 10,
        }}>
          {page.uninspectable} of these were discarded during import before being stored as
          records, so they are counted but cannot be listed individually.
        </div>
      )}

      {/* §12 — search + per-box facet filters. Server-side, so a 50k box stays fast. */}
      <form
        onSubmit={(e) => { e.preventDefault(); applyFilters({ q }); }}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title / DOI / PMID"
          aria-label="Search records"
          data-testid="stitch-prisma-search"
          style={{ ...inp, fontSize: 11.5, flex: '1 1 180px', minWidth: 140 }}
        />
        <button type="submit" style={{ ...btnS('ghost'), padding: '3px 10px', fontSize: 11 }}>
          Search
        </button>
        {facets.map(select)}
      </form>

      <div style={{ maxHeight: 380, overflowY: 'auto' }} data-testid="stitch-prisma-record-list">
        {error && (
          <div style={{ fontSize: 12, color: '#8a1c1c' }}>{error}</div>
        )}
        {!error && rows.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: C.muted }}>
            {page.total === 0 && page.uninspectable > 0
              ? 'No individual records to list for this box.'
              : 'No records match the current filters.'}
          </div>
        )}
        {rows.map((r) => (
          <RecordRow
            key={r.id}
            row={r}
            ctx={ctx}
            onSave={saveEdit}
            onFinalize={finalize}
            onRevert={revert}
          />
        ))}
        {loading && (
          <div style={{ fontSize: 11.5, color: C.muted, padding: '6px 0' }}>Loading records…</div>
        )}
        {!loading && page.nextCursor && (
          <button
            type="button"
            onClick={() => load(applied, page.nextCursor)}
            data-testid="stitch-prisma-load-more"
            style={{ ...btnS('ghost'), marginTop: 8, padding: '4px 12px', fontSize: 11 }}
          >
            Load more ({rows.length} shown)
          </button>
        )}
      </div>
    </div>
  );
}

export default PrismaInspector;
